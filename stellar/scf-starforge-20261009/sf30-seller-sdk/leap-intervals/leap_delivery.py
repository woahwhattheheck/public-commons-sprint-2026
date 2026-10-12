"""MIT. Complete Leap customer export and independent workspace restore."""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import sqlite3
import stat
import tempfile
import zipfile

from leap_contracts import SCHEMA, LeapError, require, json_bytes, now_text, sha_value
from leap_workspace import digest_file

DELIVERY_SCHEMA = "stellar-forge.leap-interval-delivery.v1"
MAX_PACKET_BYTES = 4 * 1024 * 1024 * 1024
MAX_EXPANDED_BYTES = 8 * 1024 * 1024 * 1024


def write_private(path, data):
    with open(path, "xb") as out:
        os.chmod(path, 0o600)
        out.write(data)
        out.flush()
        os.fsync(out.fileno())


def export_path(workspace, ident):
    meta = workspace.get("exports", sha_value(ident, "Original export"))
    path = workspace.root / "exports" / (ident + ".zip")
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == os.getuid(),
            "LOCAL_EXPORT", "Use the original retained customer export.")
    size, digest = digest_file(path)
    require(size == meta["bytes"] and digest == meta["sha256"], "LOCAL_EXPORT_CHANGED", "The retained customer export changed.")
    return path, meta


def export_delivery(workspace, batch_id, request_id):
    batch = workspace.get("batches", sha_value(batch_id, "Original batch"))
    ident = hashlib.sha256(json_bytes({"batch_id": batch_id, "request_id": request_id})).hexdigest()
    existing = workspace.db.execute("SELECT document FROM objects WHERE collection='exports' AND id=?", (ident,)).fetchone()
    if existing:
        return export_path(workspace, ident)[1]
    staging = Path(tempfile.mkdtemp(prefix=".delivery-", dir=workspace.root / "staging"))
    os.chmod(staging, 0o700)
    destination = workspace.root / "exports" / (ident + ".zip")
    try:
        database = staging / "leap.sqlite"
        connection = sqlite3.connect(database)
        os.chmod(database, 0o600)
        try:
            workspace.db.backup(connection)
            # A package cannot contain its own completed byte identity.
            # Preserve all earlier operations and the exact pre-export data snapshot.
            connection.execute("DELETE FROM operations WHERE id=?", (request_id,))
            connection.commit()
        finally:
            connection.close()
        members = {"workspace/leap.sqlite": database}
        for file in workspace.documents("files"):
            members["workspace/blobs/" + file["id"]] = workspace.blob_path(file["id"])
        for name, document in (
            ("prepared/batch.json", batch),
            ("prepared/mapping.json", workspace.get("mappings", batch["mapping_id"])),
            ("prepared/inputs.json", [workspace.get("imports", ident) for ident in batch["source_ids"]]),
        ):
            file = staging / name.replace("/", "-")
            write_private(file, json_bytes(document))
            members[name] = file
        members["prepared/upload.csv"] = workspace.blob_path(batch["upload"]["id"])
        for name, query, args in (
            ("prepared/rows.ndjson", "SELECT document FROM batch_rows WHERE batch_id=? ORDER BY row_index", (batch_id,)),
            ("prepared/local-issues.ndjson", "SELECT document FROM issues WHERE batch_id=? ORDER BY id", (batch_id,)),
            ("provider/validation-errors.ndjson", "SELECT document FROM job_errors WHERE job_id=? ORDER BY row_index", (batch.get("job_id", ""),)),
            ("provider/requests.ndjson", "SELECT document FROM objects WHERE collection='api_receipts' ORDER BY rowid", ()),
            ("provider/missing-windows.ndjson", "SELECT document FROM missing_rows ORDER BY snapshot_id,row_index", ()),
        ):
            file = staging / name.replace("/", "-")
            with open(file, "x", encoding="utf-8", newline="") as out:
                os.chmod(file, 0o600)
                for row in workspace.db.execute(query, args):
                    out.write(row[0].rstrip("\n") + "\n")
                out.flush()
                os.fsync(out.fileno())
            members[name] = file
        source_files = {}
        here = Path(__file__).resolve().parent
        for root in (here, here.parent / "utility-energy", here.parent / "ndjson", here.parent / "xml"):
            if not root.is_dir():
                continue
            for file in sorted(root.rglob("*")):
                if file.is_file() and not file.is_symlink() and "__pycache__" not in file.parts and file.suffix in {".py", ".mjs", ".js", ".json", ".md", ".html", ".css"}:
                    size, digest = digest_file(file)
                    source_files[file.relative_to(here.parent).as_posix()] = {"bytes": size, "sha256": digest}
        readme = """# Leap device interval receiving

This delivery contains the complete original workspace database, every retained source and provider response, the selected mapping, complete prepared CSV, row provenance, errors, and missing-window searches.

Open it with the completed Leap application installed from the accompanying selected Starforge runtime. The runtime supplies the original Utility/NDJSON/XML dependencies and the browser.

    starforge leap-intervals --workspace NEW_PRIVATE_DIRECTORY restore --file THIS_DELIVERY.zip
    starforge leap-intervals --workspace NEW_PRIVATE_DIRECTORY status
    starforge leap-intervals --workspace NEW_PRIVATE_DIRECTORY serve

Restore keeps the logical workspace and original source, mapping, batch, upload and request identities. The new listener writes a fresh private connection. Configure the named Leap API-key environment variable in the receiving process to continue provider reads and explicitly selected submissions.

Review original inputs and ownership periods, the selected device UUIDs and energy columns, complete interval issues, saved provider states, and missing-window status before continuing. A successful upload acknowledgement identifies its job. COMPLETED is the provider ingestion state; later program calculations retain their own timing.

For an interrupted submission, use Reconcile. It lists current jobs, downloads complete original upload files through Leap's temporary file links, and compares their bytes with this saved CSV. A chosen provider job must pass the same complete comparison. Corrected editions retain the rejected original file and its complete errors.

The workspace snapshot is taken immediately before this export completes. Earlier export records remain in history; create a new export from the restored batch to materialize files on the receiving machine. Export archives themselves are regenerated from the retained data, so previous archives are not nested recursively.

delivery.json declares every member's exact byte identity and the installed source files used for this export. API credentials and browser connection secrets are supplied by the receiving process.
"""
        file = staging / "LEAP_DELIVERY.md"
        write_private(file, readme.encode())
        members["LEAP_DELIVERY.md"] = file
        identities = {}
        for name, file in members.items():
            size, digest = digest_file(file)
            identities[name] = {"bytes": size, "sha256": digest}
        manifest = {"schema": DELIVERY_SCHEMA, "application_schema": SCHEMA, "created_at": now_text(),
                    "workspace_id": workspace.meta("workspace_id"), "snapshot_revision": workspace.meta("revision"),
                    "batch_id": batch_id, "upload_sha256": batch["upload"]["sha256"], "source_files": source_files, "files": identities}
        archive = staging / "delivery.zip"
        with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as out:
            os.chmod(archive, 0o600)
            for name, file in sorted(members.items()):
                out.write(file, name)
            out.writestr("delivery.json", json_bytes(manifest))
        with open(archive, "rb") as out:
            os.fsync(out.fileno())
        size, digest = digest_file(archive)
        require(size <= MAX_PACKET_BYTES, "LOCAL_DELIVERY_CAPACITY", "The complete customer delivery exceeds the 4 GiB receiving capacity.")
        os.link(archive, destination)
        metadata = {"id": ident, "name": "Leap_Device_Interval_Delivery_" + ident[:12] + ".zip",
                    "bytes": size, "sha256": digest, "download_url": "/api/export?id=" + ident,
                    "created_at": now_text(), "batch_id": batch_id, "workspace_id": workspace.meta("workspace_id"),
                    "member_count": len(identities), "manifest_sha256": hashlib.sha256(json_bytes(manifest)).hexdigest()}
        workspace.put("exports", ident, metadata)
        return metadata
    finally:
        shutil.rmtree(staging)


def restore_workspace(workspace, file_id):
    require(all(workspace.list_collection(name, 0, 1)["total"] == 0 for name in ("imports", "mappings", "batches", "missing_snapshots")),
            "LOCAL_RESTORE_TARGET", "Restore into a new private workspace directory.")
    source = workspace.blob_path(sha_value(file_id, "Original complete delivery"))
    staging = Path(tempfile.mkdtemp(prefix=".restore-", dir=workspace.root / "staging"))
    os.chmod(staging, 0o700)
    try:
        with zipfile.ZipFile(source, "r") as archive:
            items = archive.infolist()
            names = [item.filename for item in items]
            require(len(names) == len(set(names)) and "delivery.json" in names, "LOCAL_PACKET", "The delivery must have one exact manifest and no duplicate members.")
            require(sum(item.file_size for item in items) <= MAX_EXPANDED_BYTES, "LOCAL_PACKET_CAPACITY", "The complete expanded delivery exceeds 8 GiB.")
            header = archive.getinfo("delivery.json")
            require(header.file_size <= 32 * 1024 * 1024, "LOCAL_PACKET", "The delivery manifest exceeds its receiving capacity.")
            manifest = json.loads(archive.read(header).decode("utf-8"))
            require(isinstance(manifest, dict) and manifest.get("schema") == DELIVERY_SCHEMA
                    and manifest.get("application_schema") == SCHEMA and isinstance(manifest.get("files"), dict),
                    "LOCAL_PACKET", "Use a complete original Leap customer delivery.")
            require(set(names) == set(manifest["files"]) | {"delivery.json"}, "LOCAL_PACKET", "The delivery members do not match the complete manifest.")
            require("workspace/leap.sqlite" in manifest["files"], "LOCAL_PACKET", "The original workspace database is missing.")
            for name, declared in manifest["files"].items():
                path = PurePosixPath(name)
                require(not path.is_absolute() and "\\" not in name and all(part not in {"", ".", ".."} for part in path.parts),
                        "LOCAL_PACKET_PATH", "The delivery contains an invalid member path.")
                require(isinstance(declared, dict) and isinstance(declared.get("bytes"), int)
                        and declared["bytes"] >= 0, "LOCAL_PACKET", "Every member needs its exact complete byte length.")
                sha_value(declared.get("sha256"), "Declared member")
                info = archive.getinfo(name)
                require(info.file_size == declared["bytes"] and not stat.S_ISLNK(info.external_attr >> 16),
                        "LOCAL_PACKET", "The member has a different size or is a symbolic link.")
                target = None
                if name == "workspace/leap.sqlite":
                    target = staging / "leap.sqlite"
                elif name.startswith("workspace/blobs/"):
                    ident = name.removeprefix("workspace/blobs/")
                    sha_value(ident, "Original blob filename")
                    require(ident == declared["sha256"], "LOCAL_PACKET", "A source filename differs from its actual content identity.")
                    target = staging / ident
                digest, size = hashlib.sha256(), 0
                out = open(target, "xb") if target else None
                try:
                    if out:
                        os.chmod(target, 0o600)
                    with archive.open(info, "r") as member:
                        for block in iter(lambda: member.read(1024 * 1024), b""):
                            size += len(block)
                            require(size <= declared["bytes"], "LOCAL_PACKET", "A delivery member exceeded its declared length.")
                            digest.update(block)
                            if out:
                                out.write(block)
                    require(size == declared["bytes"] and digest.hexdigest() == declared["sha256"], "LOCAL_PACKET_CHANGED",
                            "A complete delivery member differs from its declared original bytes.", member=name)
                    if out:
                        out.flush()
                        os.fsync(out.fileno())
                finally:
                    if out:
                        out.close()
        original = sqlite3.connect("file:" + str(staging / "leap.sqlite") + "?mode=ro", uri=True)
        try:
            original.execute("PRAGMA trusted_schema=OFF")
            require(original.execute("PRAGMA integrity_check").fetchone()[0] == "ok", "LOCAL_PACKET_DATABASE", "The complete database did not reopen.")
            schema = original.execute("SELECT value FROM metadata WHERE key='schema'").fetchone()
            identity = original.execute("SELECT value FROM metadata WHERE key='workspace_id'").fetchone()
            require(schema and json.loads(schema[0]) == SCHEMA and identity and json.loads(identity[0]) == manifest["workspace_id"],
                    "LOCAL_PACKET_DATABASE", "The restored database does not match the original application and workspace.")
            require(not original.execute("SELECT 1 FROM sqlite_master WHERE type IN ('trigger','view') LIMIT 1").fetchone(),
                    "LOCAL_PACKET_DATABASE", "The workspace contains an unexpected executable database object.")
            required = {"metadata", "objects", "operations", "batch_rows", "issues", "missing_rows", "job_errors"}
            actual = {row[0] for row in original.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            require(actual == required, "LOCAL_PACKET_DATABASE", "The original database table set changed.")
            for ident, document in original.execute("SELECT id,document FROM objects WHERE collection='files'"):
                file = json.loads(document)
                sha_value(ident, "Original source")
                require("workspace/blobs/" + ident in manifest["files"] and file["sha256"] == ident
                        and file["bytes"] == manifest["files"]["workspace/blobs/" + ident]["bytes"],
                        "LOCAL_PACKET_DATABASE", "A retained file is missing from the complete delivery.")
                target = workspace.root / "blobs" / ident
                try:
                    os.link(staging / ident, target)
                except FileExistsError:
                    workspace.blob_path(ident)
            original.backup(workspace.db)
        finally:
            original.close()
        for batch in workspace.documents("batches"):
            if batch["status"] == "SENDING":
                batch.update(status="UNKNOWN", interrupted_at=now_text())
                workspace.put("batches", batch["id"], batch)
        return {"status": "RESTORED", "workspace_id": workspace.meta("workspace_id"),
                "delivery_sha256": file_id, "batch_id": manifest["batch_id"],
                "upload_sha256": manifest["upload_sha256"], "state": workspace.state()}
    finally:
        shutil.rmtree(staging)
