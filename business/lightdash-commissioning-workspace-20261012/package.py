#!/usr/bin/env python3
"""Export a complete, portable commissioning workspace with an actual SQLite backup."""
from __future__ import annotations
import argparse
import datetime as dt
import hashlib
import html
import json
import os
from pathlib import Path, PurePosixPath
import sqlite3
import stat
import sys
import tempfile
import zipfile

SCHEMA = "lightdash.commissioning-package.v1"
CHUNK = 1024 * 1024

def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")

def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")

def digest_file(filename):
    digest = hashlib.sha256()
    size = 0
    with filename.open("rb") as stream:
        while chunk := stream.read(CHUNK):
            digest.update(chunk)
            size += len(chunk)
    return {"bytes": size, "sha256": digest.hexdigest()}

def relative(value):
    if not isinstance(value, str) or not value or "\\" in value or "\0" in value:
        raise ValueError("A complete relative file path is required")
    parts = PurePosixPath(value)
    if parts.is_absolute() or any(p in ("", ".", "..") for p in value.split("/")):
        raise ValueError("File path leaves its selected source: " + value)
    return value

def selected(root, value):
    rel = relative(value)
    current = root
    for part in rel.split("/"):
        current = current / part
        if current.is_symlink():
            raise ValueError("Symbolic links are not portable source files: " + rel)
    real = current.resolve(strict=True)
    if root != real and root not in real.parents:
        raise ValueError("File leaves the selected source root: " + rel)
    if not real.is_file():
        raise ValueError("Select a regular source file: " + rel)
    return real

def read_json(filename):
    with filename.open("r", encoding="utf-8") as source:
        return json.load(source)

def write_json(filename, value):
    with filename.open("xb") as stream:
        stream.write(encoded(value))
        stream.flush()
        os.fsync(stream.fileno())
    filename.chmod(0o600)

def report_page(snapshot, included, omitted):
    meta = snapshot["metadata"]
    editions = snapshot["editions"]
    operations = snapshot["operations"]
    rows = "".join("<tr><td>" + html.escape(e["label"]) + "</td><td>" +
                   str(e["fileCount"]) + "</td><td>" + str(e["bytes"]) +
                   "</td><td><code>" + html.escape(e["sourceSha256"]) +
                   "</code></td></tr>" for e in editions)
    native = "".join("<tr><td><code>" + html.escape(o["id"]) + "</code></td><td>" +
                     html.escape(o["action"]) + "</td><td>" + html.escape(o["status"]) +
                     "</td><td>" + html.escape(str(o.get("resultSummary") or "")) +
                     "</td></tr>" for o in operations)
    style = "body{font:15px/1.6 system-ui,sans-serif;color:#24282b;background:#f5f5f3;margin:0}main{max-width:1180px;margin:40px auto;padding:32px;background:white;border:1px solid #cfd2d3}h1{font-size:28px}h2{font-size:19px;margin-top:32px}table{border-collapse:collapse;width:100%;font-size:13px}td,th{border-bottom:1px solid #d5d8d9;padding:10px;text-align:left;vertical-align:top}code{font:12px/1.5 monospace;overflow-wrap:anywhere}pre{padding:16px;background:#f2f3f2;border:1px solid #d7d9da;white-space:pre-wrap}p{max-width:960px}a{color:#303a43}@media(max-width:700px){main{margin:0;padding:20px}.table{overflow:auto}}"
    return ("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Lightdash commissioning handover</title><style>" + style +
            "</style><main><p>LIGHTDASH COMMISSIONING</p><h1>" + html.escape(meta["label"]) +
            "</h1><p>Complete receiving package created " + html.escape(snapshot["exportedAt"]) +
            ". The retained source, drafts, reviews and original operation results are included. The receiving SQLite copy has its host connection detached.</p>"
            "<h2>Open the workspace</h2><pre>node app/server.mjs --workspace workspace --port 8846</pre>"
            "<p>Use the local address printed by that process. Read the source editions and native results, then configure the actual receiving runtime, private profile and selected Lightdash project before a new native operation.</p>"
            "<p><a href=\"app/README.md\">Application guide</a> · <a href=\"workspace.json\">Complete workspace selection</a> · <a href=\"manifest.json\">Complete archive inventory</a></p>"
            "<h2>Source editions</h2><div class=\"table\"><table><tr><th>Edition</th><th>Files</th><th>Bytes</th><th>Source identity</th></tr>" + rows +
            "</table></div><h2>Original native operations</h2><div class=\"table\"><table><tr><th>Operation</th><th>Action</th><th>State</th><th>Result</th></tr>" + native +
            "</table></div><h2>Native content and diagnostics</h2><p>" + str(included) +
            " original native artifacts are included. " + str(len(omitted)) +
            " private diagnostic artifacts are listed in the package manifest without their file contents. Host-bound private profiles, API credentials and the Lightdash user configuration are outside the archive.</p>"
            "<h2>Source review</h2><p>" + str(len(snapshot["reviews"])) +
            " operator reviews and " + str(len(snapshot["drafts"])) +
            " complete draft overlays are retained in the SQLite file and workspace selection. These are engineering records; they do not establish a purchase order or customer acceptance.</p></main></html>\n").encode("utf-8")


def inspect_existing(output, expected_workspace_id=None, expected_application=None, expected_private=None):
    """Adopt an existing complete original ZIP; never run a native operation."""
    output = output.resolve(strict=True)
    with zipfile.ZipFile(output, "r") as archive:
        manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
        if manifest.get("schema") != SCHEMA:
            raise ValueError("Select the original commissioning archive")
        if expected_workspace_id is not None and manifest.get("workspaceId") != expected_workspace_id:
            raise ValueError("This original handover belongs to another workspace")
        if expected_application is not None and manifest.get("applicationSourceManifest") != expected_application:
            raise ValueError("This original handover contains a different application source edition")
        if expected_private is not None and bool(manifest.get("includeOperatorPrivate")) != expected_private:
            raise ValueError("This original handover used a different diagnostic selection")
        names = [item["path"] for item in manifest["files"]]
        if len(set(names)) != len(names) or set(archive.namelist()) != set(names) | {"manifest.json"} or len(archive.namelist()) != len(names) + 1:
            raise ValueError("The original archive inventory changed")
        for item in manifest["files"]:
            relative(item["path"])
            digest = hashlib.sha256()
            size = 0
            with archive.open(item["path"], "r") as reader:
                while chunk := reader.read(CHUNK):
                    digest.update(chunk)
                    size += len(chunk)
            if size != item["bytes"] or digest.hexdigest() != item["sha256"]:
                raise ValueError("The complete original artifact changed: " + item["path"])
    identity = {"path": str(output), **digest_file(output)}
    result_path = output.parent / "result.json"
    if result_path.exists():
        result = read_json(result_path)
        if result.get("archive") != identity:
            raise ValueError("The retained result names a different original archive")
        return result
    result = {"schema": SCHEMA, "state": "SUCCEEDED", "createdAt": manifest["createdAt"], "completedAt": utc(),
              "archive": identity, "memberCount": len(names) + 1, "editionCount": manifest["editionCount"],
              "draftCount": manifest["draftCount"], "operationCount": manifest["operationCount"],
              "nativeArtifactCount": manifest["nativeArtifactCount"],
              "omittedPrivateArtifactCount": len(manifest["omittedArtifacts"]),
              "applicationSourceManifest": manifest["applicationSourceManifest"],
              "receivingConnectionDetached": True, "adoptedOriginalArchive": True}
    write_json(result_path, result)
    return result

def build(workspace, app, output, include_operator_private=False):
    workspace = workspace.resolve(strict=True)
    app = app.resolve(strict=True)
    output = output.absolute()
    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    source_database = selected(workspace, "commissioning.sqlite")
    source_manifest_path = selected(app, "source-manifest.json")
    source_manifest = read_json(source_manifest_path)
    if not isinstance(source_manifest.get("files"), list) or not source_manifest["files"]:
        raise ValueError("The application requires its complete published source-manifest.json")
    if output.exists():
        with sqlite3.connect(source_database.as_uri() + "?mode=ro", uri=True, timeout=5) as selected_database:
            source_metadata = json.loads(selected_database.execute("SELECT body FROM meta WHERE id=1").fetchone()[0])
        return inspect_existing(output, source_metadata["id"], digest_file(source_manifest_path), include_operator_private)
    created_at = utc()
    archive_manifest = {"schema": SCHEMA, "createdAt": created_at, "applicationSourceManifest": digest_file(source_manifest_path),
                        "includeOperatorPrivate": include_operator_private, "files": [], "omittedArtifacts": []}
    names = set()

    with tempfile.TemporaryDirectory(prefix=".receiving-", dir=output.parent) as temporary:
        temporary = Path(temporary)
        backup_path = temporary / "commissioning.sqlite"
        origin = sqlite3.connect(source_database.as_uri() + "?mode=ro", uri=True, timeout=5)
        backup = sqlite3.connect(backup_path, timeout=5)
        try:
            origin.backup(backup, pages=128, sleep=0.1)
            row = backup.execute("SELECT revision,body FROM meta WHERE id=1").fetchone()
            if not row:
                raise ValueError("Original workspace metadata is absent")
            revision, body = row
            metadata = json.loads(body)
            if metadata.get("schema") != "lightdash.commissioning-workspace.v1":
                raise ValueError("Select the original commissioning workspace schema")
            editions = [json.loads(row[0]) for row in backup.execute("SELECT body FROM editions ORDER BY created_at,id")]
            reviews = [json.loads(row[0]) for row in backup.execute("SELECT body FROM reviews ORDER BY created_at,id")]
            operations = [json.loads(row[0]) for row in backup.execute("SELECT body FROM operations ORDER BY created_at,id")]
            backup.row_factory = sqlite3.Row
            drafts = []
            for row in backup.execute("SELECT * FROM drafts ORDER BY created_at,id"):
                draft = dict(row)
                draft["files"] = [dict(item) for item in backup.execute("SELECT * FROM draft_files WHERE draft_id=? ORDER BY path", (draft["id"],))]
                drafts.append(draft)
            snapshot = {"schema": "lightdash.commissioning-handover.v1", "exportedAt": created_at,
                        "metadata": dict(metadata, revision=revision), "editions": editions,
                        "reviews": reviews, "drafts": drafts, "operations": operations}
            portable = dict(metadata)
            portable["connection"] = {}
            portable["receiving"] = {"connectionDetached": True, "exportedAt": created_at,
                                     "originWorkspaceId": metadata["id"], "originRevision": revision}
            backup.execute("UPDATE meta SET revision=?,body=? WHERE id=1", (revision + 1, json.dumps(portable, ensure_ascii=False)))
            backup.commit()
            integrity = backup.execute("PRAGMA integrity_check").fetchone()[0]
            if integrity != "ok":
                raise ValueError("The actual SQLite backup did not reopen cleanly: " + str(integrity))
        finally:
            backup.close()
            origin.close()
        backup_path.chmod(0o600)
        staging = output.with_name(output.name + ".partial")
        if staging.exists():
            raise FileExistsError("An original partial handover already exists; reconcile its selected output first")

        def inventory(name, content_digest, role, executable=False):
            relative(name)
            if name in names:
                raise ValueError("Duplicate archive member: " + name)
            names.add(name)
            archive_manifest["files"].append({"path": name, **content_digest, "role": role, "executable": bool(executable)})

        def add_bytes(archive, name, value, role, executable=False):
            inventory(name, {"bytes": len(value), "sha256": hashlib.sha256(value).hexdigest()}, role, executable)
            info = zipfile.ZipInfo(name)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (0o100600 | (0o100 if executable else 0)) << 16
            archive.writestr(info, value)

        def add_file(archive, name, filename, role, expected=None, executable=False):
            before = filename.stat()
            if not stat.S_ISREG(before.st_mode) or filename.is_symlink():
                raise ValueError("Select a regular original file: " + str(filename))
            if expected and int(expected["bytes"]) != before.st_size:
                raise ValueError("Original file byte count changed: " + str(filename))
            digest = hashlib.sha256()
            size = 0
            info = zipfile.ZipInfo(name)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (0o100600 | (0o100 if executable else 0)) << 16
            relative(name)
            if name in names:
                raise ValueError("Duplicate archive member: " + name)
            with filename.open("rb") as reader, archive.open(info, "w", force_zip64=True) as writer:
                while chunk := reader.read(CHUNK):
                    writer.write(chunk)
                    digest.update(chunk)
                    size += len(chunk)
            after = filename.stat()
            value = {"bytes": size, "sha256": digest.hexdigest()}
            if before.st_size != after.st_size or before.st_mtime_ns != after.st_mtime_ns:
                raise ValueError("Original file changed during the complete export: " + str(filename))
            if expected and (int(expected["bytes"]) != size or expected["sha256"] != value["sha256"]):
                raise ValueError("Original file identity changed: " + str(filename))
            inventory(name, value, role, executable)

        native_count = 0
        try:
            with zipfile.ZipFile(staging, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
                add_file(archive, "workspace/commissioning.sqlite", backup_path, "receiving-workspace")
                add_file(archive, "app/source-manifest.json", source_manifest_path, "application-source-manifest")
                for item in source_manifest["files"]:
                    name = relative(item["path"])
                    if name == "source-manifest.json":
                        raise ValueError("The source manifest must not inventory itself")
                    add_file(archive, "app/" + name, selected(app, name), "application-source", item, item.get("executable", False))
                for edition in editions:
                    edition_id = relative(edition["id"])
                    if "/" in edition_id:
                        raise ValueError("Use the original edition identity")
                    manifest_path = selected(workspace, "editions/" + edition_id + "/manifest.json")
                    manifest_digest = digest_file(manifest_path)
                    if manifest_digest["sha256"] != edition["manifestSha256"]:
                        raise ValueError("A retained source manifest changed: " + edition_id)
                    manifest = read_json(manifest_path)
                    edition["manifest"] = manifest
                    add_file(archive, "workspace/editions/" + edition_id + "/manifest.json", manifest_path, "source-edition-manifest", manifest_digest)
                    source_root = (workspace / "editions" / edition_id / "source").resolve(strict=True)
                    for item in manifest["files"]:
                        file_name = relative(item["path"])
                        add_file(archive, "workspace/editions/" + edition_id + "/source/" + file_name,
                                 selected(source_root, file_name), "source-edition", item, item.get("executable", False))
                for operation in operations:
                    operation_id = relative(operation["id"])
                    if "/" in operation_id:
                        raise ValueError("Use the original operation identity")
                    native_result = operation.get("nativeResult") or {}
                    artifacts = native_result.get("artifacts") or []
                    manifest_identity = native_result.get("artifactManifest")
                    native_root = workspace / "operations" / operation_id / "native"
                    if artifacts or manifest_identity:
                        native_root = native_root.resolve(strict=True)
                    if manifest_identity:
                        manifest_rel = relative(manifest_identity["relativePath"])
                        add_file(archive, "workspace/operations/" + operation_id + "/native/" + manifest_rel,
                                 selected(native_root, manifest_rel), "native-artifact-manifest", manifest_identity)
                    for item in artifacts:
                        if item.get("scope") != "native-content" and not include_operator_private:
                            archive_manifest["omittedArtifacts"].append({"operationId": operation_id, "artifact": item,
                                "reason": "Private diagnostic file contents were not selected for this receiving package"})
                            continue
                        name = relative(item["relativePath"])
                        add_file(archive, "workspace/operations/" + operation_id + "/native/" + name,
                                 selected(native_root, name), "native-content" if item.get("scope") == "native-content" else "operator-private",
                                 item, item.get("executable", False))
                        native_count += 1
                archive_manifest["workspaceId"] = metadata["id"]
                archive_manifest["workspaceRevision"] = revision
                archive_manifest["editionCount"] = len(editions)
                archive_manifest["draftCount"] = len(drafts)
                archive_manifest["operationCount"] = len(operations)
                archive_manifest["nativeArtifactCount"] = native_count
                archive_manifest["activeOperations"] = [{"id": o["id"], "state": o["status"]} for o in operations if o["status"] in ("RUNNING", "BUSY")]
                add_bytes(archive, "workspace.json", encoded(snapshot), "complete-workspace-selection")
                add_bytes(archive, "START_HERE.html", report_page(snapshot, native_count, archive_manifest["omittedArtifacts"]), "receiving-guide")
                archive_manifest["files"].sort(key=lambda item: item["path"])
                archive.writestr("manifest.json", encoded(archive_manifest))
            staging.chmod(0o600)
            with zipfile.ZipFile(staging, "r") as reopened:
                expected_names = names | {"manifest.json"}
                if set(reopened.namelist()) != expected_names or len(reopened.namelist()) != len(expected_names):
                    raise ValueError("The complete archive member inventory did not reopen exactly")
                for item in archive_manifest["files"]:
                    digest = hashlib.sha256()
                    size = 0
                    with reopened.open(item["path"], "r") as reader:
                        while chunk := reader.read(CHUNK):
                            digest.update(chunk)
                            size += len(chunk)
                    if size != item["bytes"] or digest.hexdigest() != item["sha256"]:
                        raise ValueError("A complete exported member failed its reopen: " + item["path"])
            with staging.open("rb") as retained:
                os.fsync(retained.fileno())
            os.link(staging, output)
            staging.unlink()
            result = {"schema": SCHEMA, "state": "SUCCEEDED", "createdAt": created_at, "completedAt": utc(),
                      "archive": {"path": str(output), **digest_file(output)}, "memberCount": len(names) + 1,
                      "editionCount": len(editions), "draftCount": len(drafts), "operationCount": len(operations),
                      "nativeArtifactCount": native_count, "omittedPrivateArtifactCount": len(archive_manifest["omittedArtifacts"]),
                      "applicationSourceManifest": archive_manifest["applicationSourceManifest"],
                      "receivingConnectionDetached": True}
            write_json(output.parent / "result.json", result)
            return result
        except BaseException:
            # This operation owns only its newly created incomplete archive.
            # The source workspace, complete source editions and native outputs remain intact.
            if staging.exists():
                staging.unlink()
            raise

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--app", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--include-operator-private", action="store_true")
    parser.add_argument("--inspect-existing", action="store_true")
    args = parser.parse_args()
    if args.inspect_existing and not args.output.is_file():
        raise FileNotFoundError("The original complete archive is not yet available; retain its original operation directory")
    if args.inspect_existing:
        database = selected(args.workspace.resolve(strict=True), "commissioning.sqlite")
        with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, timeout=5) as current:
            metadata = json.loads(current.execute("SELECT body FROM meta WHERE id=1").fetchone()[0])
        result = inspect_existing(args.output, expected_workspace_id=metadata["id"])
    else:
        result = build(args.workspace, args.app, args.output, args.include_operator_private)
    print(json.dumps(result, ensure_ascii=False))
    return 0

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"state": "FAILED", "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
