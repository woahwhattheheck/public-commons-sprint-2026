#!/usr/bin/env python3
"""MIT. Stream a complete Central workspace to and from an indexed tar archive."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import sqlite3
import tarfile
import tempfile
import uuid

SCHEMA = "stellar-forge.odk-central-workspace.v1"
ARCHIVE = "stellar-forge.odk-central-archive.v1"
TABLES = {"metadata", "records", "resources", "pages", "rows", "submissions"}

def sha_file(path):
    digest = hashlib.sha256()
    size = 0
    with open(path, "rb") as stream:
        for body in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(body)
            size += len(body)
    return {"sha256": digest.hexdigest(), "bytes": size}

def relative(value):
    if not isinstance(value, str) or not value or len(value) > 2048 or "\\" in value or "\x00" in value:
        raise ValueError("Invalid portable file path.")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in ("", ".", "..") for part in value.split("/")):
        raise ValueError("Portable file paths must remain inside the selected workspace.")
    return value

def plain_file(path):
    if path.is_symlink() or not path.is_file():
        raise ValueError("An original portable source must be a regular file: " + str(path))
    return path

def database(path, writable=False):
    connection = sqlite3.connect(str(path) if writable else path.as_uri() + "?mode=ro", uri=not writable)
    connection.row_factory = sqlite3.Row
    observed = {row["name"] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
    if observed != TABLES or connection.execute("SELECT 1 FROM sqlite_master WHERE type IN ('trigger','view') LIMIT 1").fetchone():
        connection.close()
        raise ValueError("This file is not the original Central workspace database schema.")
    schema = connection.execute("SELECT value FROM metadata WHERE key='schema'").fetchone()
    if not schema or schema[0] != SCHEMA:
        connection.close()
        raise ValueError("Unsupported Central workspace database.")
    return connection

def source_hashes(connection):
    hashes = set()
    for row in connection.execute("SELECT sha256 FROM resources"):
        hashes.add(row[0])
    for row in connection.execute("SELECT source_hash,rows_hash FROM pages"):
        hashes.update(row)
    for row in connection.execute("SELECT value FROM records WHERE kind='connection'"):
        value = json.loads(row[0])
        for receipt in value.get("receipts", {}).values():
            hashes.add(receipt["sha256"])
    for value in hashes:
        if not isinstance(value, str) or len(value) != 64 or any(c not in "0123456789abcdef" for c in value):
            raise ValueError("Invalid source identity in the original database.")
    return sorted(hashes)

def output_files(connection):
    files = {}
    for row in connection.execute("SELECT kind,id,value FROM records WHERE kind IN ('export','report') ORDER BY kind,id"):
        value = json.loads(row["value"])
        prefix = "exports" if row["kind"] == "export" else "reports"
        for name in value.get("files", []):
            full = relative(prefix + "/" + row["id"] + "/" + relative(name))
            if full in files:
                raise ValueError("The original workspace repeats an output path.")
            files[full] = value.get("receipts", {}).get(name)
    return files

class CheckedReader:
    def __init__(self, stream):
        self.stream = stream
        self.digest = hashlib.sha256()
        self.size = 0
    def read(self, size=-1):
        body = self.stream.read(size)
        self.digest.update(body)
        self.size += len(body)
        return body

def build(snapshot, root, output):
    snapshot = Path(snapshot).resolve()
    root = Path(root).resolve()
    output = Path(output).resolve()
    connection = database(snapshot, writable=True)
    try:
        connection.execute("PRAGMA journal_mode=DELETE")
        # Keep prior transfer history without nesting earlier complete archives.
        for row in connection.execute("SELECT id,value FROM records WHERE kind='archive'").fetchall():
            value = json.loads(row["value"])
            if value.get("files"):
                value["externalFiles"] = value["files"]
                value["files"] = []
                value["priorTransfer"] = True
                connection.execute("UPDATE records SET value=? WHERE kind='archive' AND id=?", (json.dumps(value), row["id"]))
        connection.commit()
        hashes = source_hashes(connection)
        outputs = output_files(connection)
        identity = dict(connection.execute("SELECT key,value FROM metadata"))
        counts = {kind: connection.execute("SELECT COUNT(*) FROM records WHERE kind=?", (kind,)).fetchone()[0]
                  for kind in ("connection", "plan", "capture", "review", "export", "report")}
    finally:
        connection.close()
    inventory = {"central.sqlite": {"path": snapshot, **sha_file(snapshot)}}
    for value in hashes:
        path = plain_file(root / "sources" / value)
        receipt = sha_file(path)
        if receipt["sha256"] != value:
            raise ValueError("An original source body changed: " + value)
        inventory["sources/" + value] = {"path": path, **receipt}
    for name, expected in outputs.items():
        path = plain_file(root / name)
        receipt = sha_file(path)
        if expected and (receipt["sha256"] != expected["sha256"] or receipt["bytes"] != expected["bytes"]):
            raise ValueError("An original output file changed: " + name)
        inventory[name] = {"path": path, **receipt}
    manifest = {"schema": ARCHIVE, "workspaceSchema": SCHEMA, "workspaceId": identity["workspaceId"],
                "workspaceRevision": int(identity["revision"]), "counts": counts,
                "files": [{"path": name, "sha256": record["sha256"], "bytes": record["bytes"]}
                          for name, record in sorted(inventory.items())]}
    manifest_bytes = (json.dumps(manifest, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    if output.exists():
        verify_archive(output, manifest)
        return {"schema": ARCHIVE, "workspaceId": identity["workspaceId"], "workspaceRevision": int(identity["revision"]),
                "file": str(output), "counts": counts, "files": len(inventory),
                "uncompressedBytes": sum(item["bytes"] for item in inventory.values()), **sha_file(output)}
    temporary = output.with_name(output.name + "." + str(uuid.uuid4()) + ".part")
    try:
        import io
        import gzip
        with open(temporary, "xb") as raw:
            os.chmod(temporary, 0o600)
            with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as compressed:
                with tarfile.open(fileobj=compressed, mode="w|", format=tarfile.PAX_FORMAT) as archive:
                    info = tarfile.TarInfo("manifest.json")
                    info.size = len(manifest_bytes)
                    info.mode = 0o600
                    archive.addfile(info, io.BytesIO(manifest_bytes))
                    for name, record in sorted(inventory.items()):
                        info = tarfile.TarInfo(name)
                        info.size = record["bytes"]
                        info.mode = 0o600
                        with open(plain_file(record["path"]), "rb") as original:
                            if os.fstat(original.fileno()).st_size != info.size:
                                raise ValueError("A portable source size changed during export.")
                            checked = CheckedReader(original)
                            archive.addfile(info, checked)
                            if checked.size != info.size or checked.digest.hexdigest() != record["sha256"]:
                                raise ValueError("A portable source changed during export.")
            raw.flush()
            os.fsync(raw.fileno())
        os.link(temporary, output)
        fd = os.open(output.parent, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        temporary.unlink(missing_ok=True)
    return {"schema": ARCHIVE, "workspaceId": identity["workspaceId"], "workspaceRevision": int(identity["revision"]),
            "file": str(output), "counts": counts, "files": len(inventory), "uncompressedBytes": sum(item["bytes"] for item in inventory.values()),
            **sha_file(output)}

def verify_archive(path, expected_manifest):
    with tarfile.open(path, mode="r|gz") as archive:
        members = iter(archive)
        first = next(members, None)
        if not first or first.name != "manifest.json" or not first.isfile():
            raise ValueError("The retained archive lacks its original manifest.")
        manifest = json.load(archive.extractfile(first))
        if manifest != expected_manifest:
            raise ValueError("The retained archive belongs to another original snapshot.")
        expected = {item["path"]: item for item in manifest["files"]}
        received = set()
        for member in members:
            item = expected.get(member.name)
            if not item or member.name in received or not member.isfile() or member.size != item["bytes"]:
                raise ValueError("The retained archive member differs from its original source.")
            stream = archive.extractfile(member)
            checksum = hashlib.sha256()
            for body in iter(lambda: stream.read(1024 * 1024), b""):
                checksum.update(body)
            if checksum.hexdigest() != item["sha256"]:
                raise ValueError("The retained archive source bytes changed.")
            received.add(member.name)
        if received != set(expected):
            raise ValueError("The retained archive is incomplete.")

def publish_directory(staging, destination):
    # Linux no-replace rename protects even a concurrently created empty target.
    import ctypes
    libc = ctypes.CDLL(None, use_errno=True)
    operation = libc.renameat2
    operation.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    operation.restype = ctypes.c_int
    if operation(-100, os.fsencode(staging), -100, os.fsencode(destination), 1) != 0:
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code), str(destination))

def restore(archive_path, destination, expected_sha=None):
    archive_path = Path(archive_path).resolve()
    destination = Path(destination).absolute()
    existed_empty = False
    if destination.exists() and (destination.is_symlink() or not destination.is_dir()):
        raise FileExistsError("Restore to a new or empty workspace directory.")
    if destination.exists() and next(destination.iterdir(), None) is not None:
        original_db = destination / "central.sqlite"
        if original_db.is_symlink() or not original_db.is_file():
            raise FileExistsError("This existing directory is not the original restored workspace.")
        connection = database(original_db)
        try:
            identity = dict(connection.execute("SELECT key,value FROM metadata"))
            receipt = json.loads(identity.get("receivedArchive", "null"))
        finally:
            connection.close()
        selected_sha = expected_sha or sha_file(plain_file(archive_path))["sha256"]
        if receipt and receipt.get("archiveSha256") == selected_sha and receipt.get("workspaceId") == identity["workspaceId"]:
            return {"schema": SCHEMA, "directory": str(destination), **receipt, "replayed": True,
                    "currentWorkspaceRevision": int(identity["revision"])}
        raise FileExistsError("This workspace already contains a different original receiving or later work.")
    original = sha_file(plain_file(archive_path))
    if expected_sha and original["sha256"] != expected_sha:
        raise ValueError("The selected archive differs from its expected SHA-256.")
    if destination.exists():
        destination.rmdir()
        existed_empty = True
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    staging = Path(tempfile.mkdtemp(prefix="central-restore-", dir=destination.parent))
    manifest = None
    try:
        with tarfile.open(archive_path, mode="r|gz") as archive:
            members = iter(archive)
            first = next(members, None)
            if not first or first.name != "manifest.json" or not first.isfile() or first.size > 256 * 1024 * 1024:
                raise ValueError("The archive must begin with its original manifest.")
            manifest = json.load(archive.extractfile(first))
            if manifest.get("schema") != ARCHIVE or manifest.get("workspaceSchema") != SCHEMA or not isinstance(manifest.get("files"), list):
                raise ValueError("Unsupported Central portable archive.")
            expected = {}
            for item in manifest["files"]:
                name = relative(item["path"])
                if name in expected or not isinstance(item.get("bytes"), int) or item["bytes"] < 0:
                    raise ValueError("Invalid or repeated portable file.")
                if name != "central.sqlite" and not name.startswith(("sources/", "exports/", "reports/")):
                    raise ValueError("The archive contains a file outside the original workspace format.")
                checksum = item.get("sha256", "")
                if len(checksum) != 64 or any(c not in "0123456789abcdef" for c in checksum):
                    raise ValueError("Invalid portable file hash.")
                expected[name] = item
            received = set()
            for member in members:
                name = relative(member.name)
                item = expected.get(name)
                if not member.isfile() or not item or name in received or member.size != item["bytes"]:
                    raise ValueError("The archive member differs from its declared source file.")
                path = staging / name
                path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                source = archive.extractfile(member)
                digest = hashlib.sha256()
                size = 0
                with open(path, "xb") as target:
                    os.chmod(path, 0o600)
                    for body in iter(lambda: source.read(1024 * 1024), b""):
                        size += len(body)
                        digest.update(body)
                        target.write(body)
                    target.flush()
                    os.fsync(target.fileno())
                if size != item["bytes"] or digest.hexdigest() != item["sha256"]:
                    raise ValueError("A portable source body differs from its original hash.")
                received.add(name)
            if received != set(expected):
                raise ValueError("The archive omits an original source file.")
        connection = database(staging / "central.sqlite", writable=True)
        try:
            if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("The original workspace database is incomplete.")
            identity = dict(connection.execute("SELECT key,value FROM metadata"))
            if identity["workspaceId"] != manifest["workspaceId"] or int(identity["revision"]) != manifest["workspaceRevision"]:
                raise ValueError("The workspace identity differs from the archive manifest.")
            required = {"central.sqlite"} | {"sources/" + value for value in source_hashes(connection)} | set(output_files(connection))
            if required != received:
                raise ValueError("The archive source graph differs from its original database references.")
            connection.execute("PRAGMA journal_mode=DELETE")
            for row in connection.execute("SELECT kind,id,value FROM records WHERE kind IN ('export','report','archive')").fetchall():
                value = json.loads(row["value"])
                prefix = {"export": "exports", "report": "reports", "archive": "transfers"}[row["kind"]]
                value["receivedFromDirectory"] = value.get("directory")
                value["directory"] = str(destination / prefix / row["id"])
                connection.execute("UPDATE records SET value=? WHERE kind=? AND id=?", (json.dumps(value), row["kind"], row["id"]))
            receipt = {"archiveSha256": original["sha256"], "archiveBytes": original["bytes"], "workspaceId": identity["workspaceId"],
                       "workspaceRevision": int(identity["revision"]), "files": len(received)}
            connection.execute("INSERT OR REPLACE INTO metadata(key,value) VALUES ('receivedArchive',?)", (json.dumps(receipt),))
            connection.commit()
        finally:
            connection.close()
        for name in ("sources", "exports", "reports", "transfers", "temporary"):
            (staging / name).mkdir(exist_ok=True, mode=0o700)
        publish_directory(staging, destination)
        return {"schema": SCHEMA, "directory": str(destination), **receipt}
    finally:
        if staging.exists():
            shutil.rmtree(staging)
        if existed_empty and not destination.exists():
            destination.mkdir(mode=0o700)

def main():
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("create")
    create.add_argument("--snapshot", required=True)
    create.add_argument("--root", required=True)
    create.add_argument("--output", required=True)
    receive = commands.add_parser("restore")
    receive.add_argument("--archive", required=True)
    receive.add_argument("--directory", required=True)
    receive.add_argument("--expected-sha256")
    args = parser.parse_args()
    result = build(args.snapshot, args.root, args.output) if args.command == "create" else restore(args.archive, args.directory, args.expected_sha256)
    print(json.dumps(result, separators=(",", ":")))

if __name__ == "__main__":
    main()
