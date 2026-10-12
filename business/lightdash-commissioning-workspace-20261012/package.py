#!/usr/bin/env python3
"""Create, resume and inspect one complete Lightdash commissioning handover."""
from __future__ import annotations
import argparse
import datetime as dt
import fcntl
import hashlib
import html
import json
import os
from pathlib import Path, PurePosixPath
import re
import sqlite3
import stat
import sys
import uuid
import zipfile

SCHEMA = "lightdash.commissioning-package.v1"
REQUEST_SCHEMA = "lightdash.commissioning-handover-request.v1"
BASIS_SCHEMA = "lightdash.commissioning-package-basis.v1"
CHUNK = 1024 * 1024

class SelectionMismatch(ValueError):
    pass

def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")

def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")

def digest_file(filename):
    digest, size = hashlib.sha256(), 0
    with filename.open("rb") as stream:
        while chunk := stream.read(CHUNK):
            digest.update(chunk)
            size += len(chunk)
    return {"bytes": size, "sha256": digest.hexdigest()}

def relative(value):
    if not isinstance(value, str) or not value or "\\" in value or "\0" in value:
        raise ValueError("A complete relative file path is required")
    if PurePosixPath(value).is_absolute() or any(p in ("", ".", "..") for p in value.split("/")):
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
    with filename.open("r", encoding="utf-8") as stream:
        return json.load(stream)

def sync_directory(directory):
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def atomic_bytes(filename, value, replace=False, mode=0o600):
    filename.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = filename.with_name("." + filename.name + "." + str(uuid.uuid4()) + ".pending")
    try:
        with temporary.open("xb") as stream:
            os.fchmod(stream.fileno(), mode)
            stream.write(value)
            stream.flush()
            os.fsync(stream.fileno())
        if replace:
            os.replace(temporary, filename)
        else:
            os.link(temporary, filename)
        sync_directory(filename.parent)
    finally:
        if temporary.exists():
            temporary.unlink()

def atomic_json(filename, value, replace=False):
    atomic_bytes(filename, encoded(value), replace=replace)

def verify_file(filename, expected):
    if filename.is_symlink() or not filename.is_file():
        raise ValueError("The retained complete basis file is absent or not regular: " + str(filename))
    observed = digest_file(filename)
    if observed != {"bytes": int(expected["bytes"]), "sha256": expected["sha256"]}:
        raise ValueError("The original complete file changed: " + str(filename))
    return observed

def copy_exact(source, destination, expected, executable=False):
    if destination.exists():
        return verify_file(destination, expected)
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = destination.with_name("." + destination.name + ".copying")
    if temporary.exists():
        try:
            verify_file(temporary, expected)
        except (OSError, ValueError):
            temporary.unlink()
        else:
            os.link(temporary, destination)
            temporary.unlink()
            sync_directory(destination.parent)
            return expected
    original = selected(*source)
    before = original.stat()
    if before.st_size != int(expected["bytes"]):
        raise ValueError("The original source byte count changed: " + str(original))
    digest, size = hashlib.sha256(), 0
    with original.open("rb") as reader, temporary.open("xb") as writer:
        os.fchmod(writer.fileno(), 0o600 | (0o100 if executable else 0))
        while chunk := reader.read(CHUNK):
            writer.write(chunk)
            digest.update(chunk)
            size += len(chunk)
        writer.flush()
        os.fsync(writer.fileno())
    after = original.stat()
    observed = {"bytes": size, "sha256": digest.hexdigest()}
    if before.st_size != after.st_size or before.st_mtime_ns != after.st_mtime_ns or observed != expected:
        raise ValueError("The original source changed during its complete copy: " + str(original))
    os.link(temporary, destination)
    temporary.unlink()
    sync_directory(destination.parent)
    return observed

def read_request(output):
    request = read_json(selected(output.parent, "request.json"))
    if request.get("schema") != REQUEST_SCHEMA or request.get("id") != output.parent.name:
        raise ValueError("Select the original handover directory and complete request")
    revision = request.get("workspaceRevision")
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
        raise ValueError("The original handover must retain its exact workspace revision")
    if not isinstance(request.get("workspaceId"), str) or not request["workspaceId"]:
        raise ValueError("The original workspace identity is absent")
    if not re.fullmatch(r"[a-f0-9]{64}", request.get("applicationSourceSha256", "")):
        raise ValueError("The original application source identity is absent")
    if not isinstance(request.get("includeOperatorPrivate"), bool):
        raise ValueError("The original diagnostic selection is absent")
    identity = request.get("originalDatabase")
    if identity is not None:
        if not isinstance(identity, dict) or isinstance(identity.get("bytes"), bool) or not isinstance(identity.get("bytes"), int) or identity["bytes"] <= 0 or not re.fullmatch(r"[a-f0-9]{64}", identity.get("sha256", "")):
            raise ValueError("The original selected SQLite identity is incomplete")
    return request

def verify_inherited_receiving_lease():
    descriptor = os.environ.get("LDW_RECEIVING_LEASE_FD")
    identity_text = os.environ.get("LDW_RECEIVING_LEASE_IDENTITY")
    if descriptor is None and identity_text is None:
        return
    if descriptor is None or not descriptor.isdecimal() or int(descriptor) < 3 or identity_text is None:
        raise ValueError("The inherited original receiving lease is incomplete")
    identity = json.loads(identity_text)
    info = os.fstat(int(descriptor))
    if not stat.S_ISREG(info.st_mode) or identity.get("device") != info.st_dev or identity.get("inode") != info.st_ino:
        raise ValueError("The inherited receiving lease no longer names its original regular file")
    if not identity.get("operationId") or not re.fullmatch(r"[a-f0-9]{64}", identity.get("inputSha256", "")):
        raise ValueError("The inherited receiving lease lost its original operation identity")
    # Keep this inherited open descriptor for this process's entire writing lifetime.

def database_snapshot(filename, request):
    with sqlite3.connect(filename.as_uri() + "?mode=ro", uri=True, timeout=5) as database:
        integrity = database.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise ValueError("The original SQLite snapshot did not reopen completely: " + str(integrity))
        row = database.execute("SELECT revision,body FROM meta WHERE id=1").fetchone()
        if not row:
            raise ValueError("Original workspace metadata is absent")
        revision, body = row
        metadata = json.loads(body)
        if metadata.get("schema") != "lightdash.commissioning-workspace.v1" or metadata.get("id") != request["workspaceId"] or revision != request["workspaceRevision"]:
            raise SelectionMismatch("The snapshot does not name the original requested workspace revision")
        editions = [json.loads(row[0]) for row in database.execute("SELECT body FROM editions ORDER BY created_at,id")]
        reviews = [json.loads(row[0]) for row in database.execute("SELECT body FROM reviews ORDER BY created_at,id")]
        operations = [json.loads(row[0]) for row in database.execute("SELECT body FROM operations ORDER BY created_at,id")]
        database.row_factory = sqlite3.Row
        drafts = []
        for row in database.execute("SELECT * FROM drafts ORDER BY created_at,id"):
            draft = dict(row)
            draft["files"] = [dict(item) for item in database.execute("SELECT * FROM draft_files WHERE draft_id=? ORDER BY path", (draft["id"],))]
            drafts.append(draft)
    return {"schema": "lightdash.commissioning-handover.v1", "exportedAt": request["createdAt"],
            "metadata": dict(metadata, revision=revision), "editions": editions,
            "reviews": reviews, "drafts": drafts, "operations": operations}

def capture_original_database(workspace, basis, request):
    # The application durably selects origin.sqlite before publishing request.json
    # or acknowledging HTTP creation. Packaging never snapshots the live workspace.
    destination = selected(basis, "origin.sqlite")
    if request.get("originalDatabase"):
        verify_file(destination, request["originalDatabase"])
    return destination, database_snapshot(destination, request)

def retain_portable_database(origin, destination, snapshot, request):
    if destination.exists():
        with sqlite3.connect(destination.as_uri() + "?mode=ro", uri=True, timeout=5) as database:
            row = database.execute("SELECT revision,body FROM meta WHERE id=1").fetchone()
            meta = json.loads(row[1])
            receiving = meta.get("receiving", {})
            if row[0] != request["workspaceRevision"] + 1 or meta.get("id") != request["workspaceId"] or meta.get("connection") != {} or receiving.get("originRevision") != request["workspaceRevision"] or not receiving.get("connectionDetached"):
                raise SelectionMismatch("The retained receiving SQLite file belongs to another source selection")
            if database.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("The retained receiving SQLite file no longer reopens")
        return digest_file(destination)
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = destination.with_name("commissioning.sqlite.copying")
    if temporary.exists():
        temporary.unlink()
    source = sqlite3.connect(origin.as_uri() + "?mode=ro", uri=True, timeout=5)
    target = sqlite3.connect(temporary, timeout=5)
    try:
        source.backup(target, pages=128, sleep=0.1)
        portable = dict(snapshot["metadata"])
        portable.pop("revision", None)
        portable["connection"] = {}
        portable["receiving"] = {"connectionDetached": True, "exportedAt": request["createdAt"],
                                 "originWorkspaceId": request["workspaceId"], "originRevision": request["workspaceRevision"]}
        target.execute("UPDATE meta SET revision=?,body=? WHERE id=1",
                       (request["workspaceRevision"] + 1, json.dumps(portable, ensure_ascii=False)))
        target.commit()
        target.execute("PRAGMA journal_mode=DELETE")
        if target.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("The complete receiving SQLite copy did not reopen")
    finally:
        target.close()
        source.close()
    temporary.chmod(0o600)
    with temporary.open("rb") as stream:
        os.fsync(stream.fileno())
    os.link(temporary, destination)
    temporary.unlink()
    sync_directory(destination.parent)
    return digest_file(destination)

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


def archive_selection(manifest, request):
    if manifest.get("schema") != SCHEMA:
        raise SelectionMismatch("Select the original commissioning archive schema")
    expected = {"handoverId": request["id"], "workspaceId": request["workspaceId"],
                "workspaceRevision": request["workspaceRevision"],
                "includeOperatorPrivate": request["includeOperatorPrivate"]}
    for key, value in expected.items():
        if manifest.get(key) != value:
            raise SelectionMismatch("The original handover archive has a different " + key)
    if manifest.get("applicationSourceManifest", {}).get("sha256") != request["applicationSourceSha256"]:
        raise SelectionMismatch("The original handover contains another application source edition")

def check_archive(filename, request):
    if filename.is_symlink() or not filename.is_file():
        raise ValueError("Select the original regular handover archive")
    with zipfile.ZipFile(filename, "r") as archive:
        manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
        archive_selection(manifest, request)
        names = [relative(item["path"]) for item in manifest["files"]]
        actual = archive.namelist()
        if len(set(names)) != len(names) or set(actual) != set(names) | {"manifest.json"} or len(actual) != len(names) + 1:
            raise ValueError("The complete original archive inventory changed")
        for item in manifest["files"]:
            digest, size = hashlib.sha256(), 0
            with archive.open(item["path"], "r") as reader:
                while chunk := reader.read(CHUNK):
                    digest.update(chunk)
                    size += len(chunk)
            if size != int(item["bytes"]) or digest.hexdigest() != item["sha256"]:
                raise ValueError("The complete original archive member changed: " + item["path"])
    return manifest

def finish_result(output, request, manifest, adopted=False):
    result_file = output.parent / "result.json"
    identity = {"path": str(output), **digest_file(output)}
    if result_file.exists():
        result = read_json(result_file)
        if result.get("state") != "SUCCEEDED" or result.get("archive") != identity or result.get("handoverId") != request["id"]:
            raise SelectionMismatch("The retained result names a different original handover")
        return result
    result = {"schema": SCHEMA, "state": "SUCCEEDED", "handoverId": request["id"],
              "createdAt": request["createdAt"], "completedAt": utc(),
              "workspaceId": request["workspaceId"], "workspaceRevision": request["workspaceRevision"],
              "archive": identity, "memberCount": len(manifest["files"]) + 1,
              "editionCount": manifest["editionCount"], "draftCount": manifest["draftCount"],
              "operationCount": manifest["operationCount"], "nativeArtifactCount": manifest["nativeArtifactCount"],
              "omittedPrivateArtifactCount": len(manifest["omittedArtifacts"]),
              "applicationSourceManifest": manifest["applicationSourceManifest"],
              "receivingConnectionDetached": True, "adoptedOriginalArchive": adopted}
    atomic_json(result_file, result)
    return result

def inspect_original(output, request):
    if output.exists():
        return finish_result(output, request, check_archive(output, request), adopted=True)
    staging = output.with_name(output.name + ".partial")
    if staging.exists():
        try:
            manifest = check_archive(staging, request)
        except SelectionMismatch:
            raise
        except (OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
            return {"schema": SCHEMA, "state": "INTERRUPTED", "handoverId": request["id"],
                    "workspaceRevision": request["workspaceRevision"], "completeArchive": False,
                    "basisRetained": (output.parent / "basis" / "origin.sqlite").is_file(),
                    "error": {"message": str(error)}, "continuation": "Resume this same handover ID from its retained complete basis."}
        with staging.open("rb") as stream:
            os.fsync(stream.fileno())
        os.link(staging, output)
        sync_directory(output.parent)
        staging.unlink()
        return finish_result(output, request, manifest, adopted=True)
    return {"schema": SCHEMA, "state": "INTERRUPTED" if (output.parent / "basis" / "origin.sqlite").is_file() else "PENDING",
            "handoverId": request["id"], "workspaceRevision": request["workspaceRevision"],
            "completeArchive": False, "basisRetained": (output.parent / "basis" / "origin.sqlite").is_file(),
            "continuation": "Resume this same handover ID; its requested workspace revision will not change."}

def verify_basis(basis, request):
    sealed = read_json(selected(basis, "basis.json"))
    if sealed.get("schema") != BASIS_SCHEMA or sealed.get("requestSha256") != hashlib.sha256(encoded(request)).hexdigest():
        raise SelectionMismatch("The retained complete export basis names another original request")
    payload = basis / "payload"
    manifest = read_json(selected(payload, "manifest.json"))
    archive_selection(manifest, request)
    verify_file(selected(payload, "manifest.json"), sealed["manifest"])
    verify_file(selected(basis, "origin.sqlite"), sealed["originalDatabase"])
    for item in manifest["files"]:
        verify_file(selected(payload, item["path"]), item)
    return payload, manifest

def prepare_basis(workspace, app, output, request):
    basis = output.parent / "basis"
    basis.mkdir(exist_ok=True, mode=0o700)
    if (basis / "basis.json").exists():
        return verify_basis(basis, request)
    origin, snapshot = capture_original_database(workspace, basis, request)
    payload = basis / "payload"
    payload.mkdir(exist_ok=True, mode=0o700)
    manifest = {"schema": SCHEMA, "handoverId": request["id"], "createdAt": request["createdAt"],
                "workspaceId": request["workspaceId"], "workspaceRevision": request["workspaceRevision"],
                "includeOperatorPrivate": request["includeOperatorPrivate"], "files": [], "omittedArtifacts": []}
    names = set()

    def member(name, expected, role, executable=False, source=None, content=None):
        relative(name)
        if name in names:
            raise ValueError("Duplicate complete archive member: " + name)
        destination = payload / name
        if content is not None:
            if destination.exists():
                verify_file(destination, expected)
            else:
                atomic_bytes(destination, content, mode=0o600 | (0o100 if executable else 0))
        elif source is not None:
            copy_exact(source, destination, expected, executable)
        else:
            verify_file(destination, expected)
        names.add(name)
        manifest["files"].append({"path": name, **expected, "role": role, "executable": bool(executable)})
        return destination

    def bytes_member(name, value, role):
        return member(name, {"bytes": len(value), "sha256": hashlib.sha256(value).hexdigest()}, role, content=value)

    portable = payload / "workspace" / "commissioning.sqlite"
    portable_identity = retain_portable_database(origin, portable, snapshot, request)
    member("workspace/commissioning.sqlite", portable_identity, "receiving-workspace")
    retained_app_manifest = payload / "app" / "source-manifest.json"
    source_manifest_file = retained_app_manifest if retained_app_manifest.exists() else selected(app, "source-manifest.json")
    source_manifest_identity = digest_file(source_manifest_file)
    if source_manifest_identity["sha256"] != request["applicationSourceSha256"]:
        raise SelectionMismatch("Restore the original complete application source before resuming this handover")
    source_manifest = read_json(source_manifest_file)
    if not isinstance(source_manifest.get("files"), list) or not source_manifest["files"]:
        raise ValueError("The application requires its complete published source-manifest.json")
    manifest["applicationSourceManifest"] = source_manifest_identity
    member("app/source-manifest.json", source_manifest_identity, "application-source-manifest", source=(app, "source-manifest.json"))
    for item in source_manifest["files"]:
        name = relative(item["path"])
        if name == "source-manifest.json":
            raise ValueError("The application source manifest must not inventory itself")
        member("app/" + name, {"bytes": int(item["bytes"]), "sha256": item["sha256"]}, "application-source",
               item.get("executable", False), source=(app, name))
    for edition in snapshot["editions"]:
        edition_id = relative(edition["id"])
        if "/" in edition_id:
            raise ValueError("Use the original complete edition identity")
        source_manifest_name = "editions/" + edition_id + "/manifest.json"
        member_name = "workspace/" + source_manifest_name
        retained_manifest = payload / member_name
        original_manifest = retained_manifest if retained_manifest.exists() else selected(workspace, source_manifest_name)
        identity = digest_file(original_manifest)
        if identity["sha256"] != edition["manifestSha256"]:
            raise SelectionMismatch("A retained complete source manifest changed: " + edition_id)
        source_inventory = read_json(original_manifest)
        edition["manifest"] = source_inventory
        member(member_name, identity, "source-edition-manifest", source=(workspace, source_manifest_name))
        for item in source_inventory["files"]:
            name = "editions/" + edition_id + "/source/" + relative(item["path"])
            member("workspace/" + name, {"bytes": int(item["bytes"]), "sha256": item["sha256"]}, "source-edition",
                   item.get("executable", False), source=(workspace, name))
    native_count = 0
    for operation in snapshot["operations"]:
        operation_id = relative(operation["id"])
        if "/" in operation_id:
            raise ValueError("Use the original native operation identity")
        result = operation.get("nativeResult") or {}
        artifact_manifest = result.get("artifactManifest")
        prefix = "operations/" + operation_id + "/native/"
        if artifact_manifest:
            name = prefix + relative(artifact_manifest["relativePath"])
            member("workspace/" + name, {"bytes": int(artifact_manifest["bytes"]), "sha256": artifact_manifest["sha256"]},
                   "native-artifact-manifest", source=(workspace, name))
        for item in result.get("artifacts") or []:
            if item.get("scope") != "native-content" and not request["includeOperatorPrivate"]:
                manifest["omittedArtifacts"].append({"operationId": operation_id, "artifact": item,
                    "reason": "Private diagnostic file contents were not selected for this receiving package"})
                continue
            name = prefix + relative(item["relativePath"])
            member("workspace/" + name, {"bytes": int(item["bytes"]), "sha256": item["sha256"]},
                   "native-content" if item.get("scope") == "native-content" else "operator-private",
                   item.get("executable", False), source=(workspace, name))
            native_count += 1
    manifest.update({"editionCount": len(snapshot["editions"]), "draftCount": len(snapshot["drafts"]),
                     "operationCount": len(snapshot["operations"]), "nativeArtifactCount": native_count,
                     "activeOperations": [{"id": op["id"], "state": op["status"]} for op in snapshot["operations"] if op["status"] in ("RUNNING", "BUSY")]})
    bytes_member("workspace.json", encoded(snapshot), "complete-workspace-selection")
    bytes_member("START_HERE.html", report_page(snapshot, native_count, manifest["omittedArtifacts"]), "receiving-guide")
    manifest["files"].sort(key=lambda item: item["path"])
    manifest_path = payload / "manifest.json"
    manifest_bytes = encoded(manifest)
    manifest_identity = {"bytes": len(manifest_bytes), "sha256": hashlib.sha256(manifest_bytes).hexdigest()}
    if manifest_path.exists():
        verify_file(manifest_path, manifest_identity)
    else:
        atomic_bytes(manifest_path, manifest_bytes)
    atomic_json(basis / "basis.json", {"schema": BASIS_SCHEMA, "requestSha256": hashlib.sha256(encoded(request)).hexdigest(),
                "workspaceId": request["workspaceId"], "workspaceRevision": request["workspaceRevision"],
                "originalDatabase": digest_file(origin), "manifest": manifest_identity})
    return verify_basis(basis, request)

def build_archive(workspace, app, output, request):
    inspected = inspect_original(output, request)
    if inspected["state"] == "SUCCEEDED":
        return inspected
    payload, manifest = prepare_basis(workspace, app, output, request)
    staging = output.with_name(output.name + ".partial")
    if staging.exists():
        # The permanent kernel lock proves that no original archive writer is alive.
        # Only this operation's incomplete reproducible ZIP is replaced; the original
        # SQLite snapshot and every selected complete source/artifact remain in basis/.
        staging.unlink()
    with zipfile.ZipFile(staging, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
        for item in manifest["files"] + [{"path": "manifest.json", **digest_file(payload / "manifest.json"), "executable": False}]:
            original = selected(payload, item["path"])
            digest, size = hashlib.sha256(), 0
            info = zipfile.ZipInfo(item["path"])
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (0o100600 | (0o100 if item.get("executable") else 0)) << 16
            with original.open("rb") as reader, archive.open(info, "w", force_zip64=True) as writer:
                while chunk := reader.read(CHUNK):
                    writer.write(chunk)
                    digest.update(chunk)
                    size += len(chunk)
            if size != item["bytes"] or digest.hexdigest() != item["sha256"]:
                raise ValueError("A complete export basis file changed while packaging: " + item["path"])
    staging.chmod(0o600)
    verified = check_archive(staging, request)
    with staging.open("rb") as stream:
        os.fsync(stream.fileno())
    os.link(staging, output)
    sync_directory(output.parent)
    staging.unlink()
    return finish_result(output, request, verified)

def run(workspace, app, output, inspect=False):
    workspace = workspace.resolve(strict=True)
    app = app.resolve(strict=True)
    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    output = output.parent.resolve(strict=True) / output.name
    request = read_request(output)
    with sqlite3.connect(selected(workspace, "commissioning.sqlite").as_uri() + "?mode=ro", uri=True, timeout=5) as database:
        metadata = json.loads(database.execute("SELECT body FROM meta WHERE id=1").fetchone()[0])
        if metadata.get("id") != request["workspaceId"]:
            raise SelectionMismatch("This original handover belongs to a different workspace")
    verify_inherited_receiving_lease()
    lock_path = output.parent / "package.lock"
    descriptor = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        lock_info = os.fstat(descriptor)
        named_info = lock_path.stat(follow_symlinks=False)
        if not stat.S_ISREG(lock_info.st_mode) or (lock_info.st_dev, lock_info.st_ino) != (named_info.st_dev, named_info.st_ino):
            raise ValueError("The original permanent handover lock identity changed")
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {"schema": SCHEMA, "state": "RUNNING", "handoverId": request["id"],
                    "workspaceRevision": request["workspaceRevision"], "originalWriterLeaseHeld": True,
                    "continuation": "Read or inspect this original handover after its current writer finishes."}
        attempt = {"schema": "lightdash.commissioning-package-status.v1", "handoverId": request["id"],
                   "attemptId": str(uuid.uuid4()), "pid": os.getpid(), "startedAt": utc(),
                   "workspaceRevision": request["workspaceRevision"], "inspection": inspect}
        status_path = output.parent / "status.json"
        atomic_json(status_path, {**attempt, "state": "RUNNING"}, replace=True)
        try:
            result = inspect_original(output, request) if inspect else build_archive(workspace, app, output, request)
            atomic_json(status_path, {**attempt, "state": result["state"], "completedAt": utc(), "result": result}, replace=True)
            return result
        except Exception as error:
            try:
                atomic_json(status_path, {**attempt, "state": "INTERRUPTED", "completedAt": utc(),
                            "error": {"message": str(error)}, "basisRetained": (output.parent / "basis" / "origin.sqlite").is_file()}, replace=True)
            except OSError:
                pass
            raise
    finally:
        # The lock inode is permanent; releasing this descriptor cannot create two owners.
        os.close(descriptor)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--app", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--inspect-existing", action="store_true")
    args = parser.parse_args()
    result = run(args.workspace, args.app, args.output.absolute(), inspect=args.inspect_existing)
    print(json.dumps(result, ensure_ascii=False))
    return 0

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"state": "INTERRUPTED", "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
