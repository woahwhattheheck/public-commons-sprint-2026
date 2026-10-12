#!/usr/bin/env python3
"""MIT. Complete PMTiles source/runtime/workspace package, using Python's original ZIP reader."""
from __future__ import annotations
import argparse
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import time
import unicodedata
import zipfile

MAX_FILE = 2 * 1024**3
MAX_PACKAGE = 32 * 1024**3
MAX_JSON = 16 * 1024**2
CHUNK = 262144
SHA = re.compile(r"^[a-f0-9]{64}$")
SCHEMA = "starforge.pmtiles-operations-package.v1"

def require(condition, message):
    if not condition:
        raise ValueError(message)

def stable_bytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")

def sha_file(path, expected=None):
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    with os.fdopen(os.open(path, flags), "rb") as handle:
        before = os.fstat(handle.fileno())
        require(stat.S_ISREG(before.st_mode) and 0 <= before.st_size <= MAX_PACKAGE, "The selected file has an invalid type or size.")
        digest = hashlib.sha256()
        size = 0
        while chunk := handle.read(CHUNK):
            digest.update(chunk)
            size += len(chunk)
        after = os.fstat(handle.fileno())
        require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns) and size == before.st_size,
                "The selected file changed while being read.")
    actual = {"bytes": size, "sha256": digest.hexdigest()}
    if expected:
        require(actual["bytes"] == expected["bytes"] and actual["sha256"] == expected["sha256"], "The original file bytes changed: " + str(path))
    return actual

def member_path(value):
    require(isinstance(value, str) and value and len(value) <= 1024 and
            not any(ord(c) < 32 or ord(c) == 127 or c == "\\" for c in value), "Invalid package member path.")
    require(all(part not in ("", ".", "..") for part in value.split("/")), "Invalid package member path.")
    return value

def descriptor(row):
    require(isinstance(row, dict) and SHA.fullmatch(str(row.get("sha256", ""))) and
            isinstance(row.get("bytes"), int) and not isinstance(row["bytes"], bool) and 0 <= row["bytes"] <= MAX_FILE,
            "Invalid original file descriptor.")
    member_path(row["path"])
    require(row.get("mode", 384) in (384, 448), "Invalid receiving file mode.")
    return row

def selected_manifest(raw, expected_workspace):
    require(len(raw) <= MAX_JSON, "Package manifest exceeds sixteen MiB.")
    value = json.loads(raw.decode("utf-8"))
    require(value.get("schema") == SCHEMA and value.get("workspace", {}).get("id") == expected_workspace,
            "The package belongs to a different original workspace.")
    require(isinstance(value.get("files"), list) and 0 < len(value["files"]) <= 30000, "Invalid complete package inventory.")
    require(isinstance(value.get("bootstrap"), list) and {x.get("path") for x in value["bootstrap"]} ==
            {"RECEIVE.py", "START_HERE.md"}, "The complete receiving instructions are missing.")
    seen = set()
    objects = {}
    for row in value["files"]:
        descriptor(row)
        key = unicodedata.normalize("NFC", row["path"]).lower()
        require(key not in seen, "Case-insensitive package member collision.")
        seen.add(key)
        require(row["path"].split("/")[0] in ("source", "runtime", "workspace-snapshot"), "Unknown product package member.")
        if row["sha256"] in objects:
            require(objects[row["sha256"]]["bytes"] == row["bytes"], "One content identity has different byte sizes.")
        objects[row["sha256"]] = {"bytes": row["bytes"], "sha256": row["sha256"]}
    for key in seen:
        parts = key.split("/")
        require(not any("/".join(parts[:n]) in seen for n in range(1, len(parts))), "A file collides with a receiving directory.")
    for row in value["bootstrap"]:
        descriptor(row)
    require(sum(row["bytes"] for row in objects.values()) + sum(row["bytes"] for row in value["bootstrap"]) <= MAX_PACKAGE,
            "The complete package exceeds its selected thirty-two GiB receiving limit.")
    require(any(row["path"] == "workspace-snapshot/workspace.sqlite3" for row in value["files"]) and
            any(row["path"] == "workspace-snapshot/handover.json" for row in value["files"]), "The original workspace snapshot is missing.")
    return value, objects

def private_directory(path):
    path = Path(path)
    require(path.is_absolute(), "Use an absolute receiving path.")
    missing = []
    current = path
    while not current.exists():
        missing.append(current)
        current = current.parent
    for target in reversed(missing):
        target.mkdir(mode=0o700)
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode) and path.resolve() == path,
            "The receiving directory must be a real directory without symlink parents.")
    require(info.st_uid == os.getuid() and info.st_mode & 0o077 == 0, "The receiving directory must be private to this user.")
    return path

def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

@contextlib.contextmanager
def owned_lock(root):
    path = root / ".pmtiles-receiving.lock"
    fd = os.open(path, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == os.getuid(), "Invalid original receiving lock.")
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield fd
    finally:
        os.close(fd)

def read_small(path):
    with os.fdopen(os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)), "rb") as source:
        require(stat.S_ISREG(os.fstat(source.fileno()).st_mode), "Expected an original regular file.")
        raw = source.read(MAX_JSON + 1)
        require(len(raw) <= MAX_JSON, "The selected document exceeds sixteen MiB.")
        return raw

def save_new(path, raw):
    private_directory(path.parent)
    if path.exists():
        require(read_small(path) == raw, "The retained receiving request changed: " + str(path))
        return
    fd, temporary_name = tempfile.mkstemp(prefix=".receiving-json-", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(raw)
            output.flush()
            os.fsync(output.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            require(read_small(path) == raw, "The retained receiving request changed.")
        sync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)

def check_zip(archive, expected_workspace, expected_manifest_sha=None):
    infos = archive.infolist()
    require(len(infos) <= 30003, "Too many archive members.")
    names = [entry.filename for entry in infos]
    require(len(names) == len(set(names)) and "PACKAGE.json" in names, "Duplicate archive members or missing package manifest.")
    require(archive.getinfo("PACKAGE.json").file_size <= MAX_JSON, "Package manifest exceeds sixteen MiB.")
    raw = archive.read("PACKAGE.json")
    if expected_manifest_sha:
        require(hashlib.sha256(raw).hexdigest() == expected_manifest_sha, "The selected package manifest changed.")
    manifest, objects = selected_manifest(raw, expected_workspace)
    expected_names = {"PACKAGE.json"} | {row["path"] for row in manifest["bootstrap"]} | {"objects/" + key for key in objects}
    require(set(names) == expected_names, "The archive differs from its complete original file inventory.")
    for entry in infos:
        require(not entry.is_dir() and not entry.flag_bits & 1 and entry.compress_type in
                (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED), "Unsupported encrypted or non-file archive member.")
        mode = (entry.external_attr >> 16) & 0xFFFF
        require(not stat.S_ISLNK(mode) and (not stat.S_IFMT(mode) or stat.S_ISREG(mode)), "Non-regular archive member.")
        if entry.filename.startswith("objects/"):
            require(entry.file_size == objects[entry.filename[8:]]["bytes"], "Archive entry size differs from its descriptor.")
    for row in manifest["bootstrap"]:
        require(row["bytes"] <= MAX_JSON and archive.getinfo(row["path"]).file_size == row["bytes"], "Invalid receiving instructions size.")
        raw_bootstrap = archive.read(row["path"])
        require(len(raw_bootstrap) == row["bytes"] and hashlib.sha256(raw_bootstrap).hexdigest() == row["sha256"],
                "The receiving instructions changed.")
    return manifest, objects, hashlib.sha256(raw).hexdigest()

def verify_payloads(archive, objects):
    for identity, expected in objects.items():
        digest = hashlib.sha256()
        count = 0
        with archive.open("objects/" + identity) as source:
            while chunk := source.read(CHUNK):
                count += len(chunk)
                require(count <= expected["bytes"], "Expanded original file exceeds its selected size.")
                digest.update(chunk)
        require(count == expected["bytes"] and digest.hexdigest() == identity, "An original package file changed.")

def zip_info(name):
    entry = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
    entry.create_system = 3
    entry.external_attr = (stat.S_IFREG | 0o600) << 16
    entry.compress_type = zipfile.ZIP_DEFLATED
    return entry

def write_archive(args):
    root = private_directory(Path(args.root))
    output = Path(args.output)
    require(output.is_absolute() and output.parent.resolve() == output.parent, "Use an absolute archive path without symlink parents.")
    require(output != root and not output.is_relative_to(root), "The final archive must be outside the staging directory.")
    raw = read_small(root / "PACKAGE.json")
    require(hashlib.sha256(raw).hexdigest() == args.manifest_sha256, "The selected package manifest changed.")
    manifest, objects = selected_manifest(raw, args.workspace_id)
    if output.exists():
        with zipfile.ZipFile(output) as archive:
            check_zip(archive, args.workspace_id, args.manifest_sha256)
            verify_payloads(archive, objects)
        return {"status": "COMPLETE", "reused": True, "path": str(output), "packageId": manifest["id"],
                "workspaceId": args.workspace_id, "manifestSha256": args.manifest_sha256, **sha_file(output)}
    require(output.parent.exists(), "Create the final archive's parent directory first.")
    fd, name = tempfile.mkstemp(prefix=".pmtiles-package-", suffix=".zip", dir=output.parent)
    temporary = Path(name)
    os.close(fd)
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=2, allowZip64=True) as archive:
            archive.writestr(zip_info("PACKAGE.json"), raw)
            for row in sorted(manifest["bootstrap"], key=lambda row: row["path"]):
                content = read_small(root / row["path"])
                require(len(content) == row["bytes"] and hashlib.sha256(content).hexdigest() == row["sha256"],
                        "The retained bootstrap changed.")
                archive.writestr(zip_info(row["path"]), content)
            for identity, expected in sorted(objects.items()):
                path = root / "objects" / identity
                sha_file(path, expected)
                with os.fdopen(os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)), "rb") as source, \
                        archive.open(zip_info("objects/" + identity), "w", force_zip64=True) as target:
                    digest = hashlib.sha256()
                    size = 0
                    while chunk := source.read(CHUNK):
                        target.write(chunk)
                        digest.update(chunk)
                        size += len(chunk)
                    require(size == expected["bytes"] and digest.hexdigest() == identity, "A selected source changed while packaging.")
        with temporary.open("rb") as handle:
            os.fsync(handle.fileno())
        try:
            os.link(temporary, output)
        except FileExistsError:
            with zipfile.ZipFile(output) as archive:
                check_zip(archive, args.workspace_id, args.manifest_sha256)
                verify_payloads(archive, objects)
        sync_directory(output.parent)
    finally:
        temporary.unlink(missing_ok=True)
    return {"status": "COMPLETE", "reused": False, "path": str(output), "packageId": manifest["id"],
            "workspaceId": args.workspace_id, "manifestSha256": args.manifest_sha256, **sha_file(output)}

def receive_file(archive, row, root, manifest_sha, linked):
    path = root / row["path"]
    private_directory(path.parent)
    mode = row.get("mode", 384)
    if path.exists():
        sha_file(path, row)
        require(stat.S_IMODE(path.lstat().st_mode) == mode, "An existing receiving file has a different mode.")
        linked.setdefault((row["sha256"], mode), path)
        return
    previous = linked.get((row["sha256"], mode))
    if previous:
        sha_file(previous, row)
        try:
            os.link(previous, path)
        except FileExistsError:
            sha_file(path, row)
        sync_directory(path.parent)
        return
    suffix = hashlib.sha256((manifest_sha + "\0" + row["path"]).encode()).hexdigest()
    temporary = path.parent / (".receiving-" + suffix)
    flags = os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(temporary, flags, 0o600)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == os.getuid(),
                "The original partial receiving file changed.")
        os.ftruncate(fd, 0)
        digest = hashlib.sha256()
        count = 0
        with os.fdopen(fd, "wb", closefd=False) as target, archive.open("objects/" + row["sha256"]) as source:
            while chunk := source.read(CHUNK):
                count += len(chunk)
                require(count <= row["bytes"], "Expanded source exceeds its selected size.")
                target.write(chunk)
                digest.update(chunk)
            require(count == row["bytes"] and digest.hexdigest() == row["sha256"], "Received original file bytes changed.")
            target.flush()
            os.fchmod(fd, mode)
            os.fsync(fd)
        try:
            os.link(temporary, path)
        except FileExistsError:
            sha_file(path, row)
        sync_directory(path.parent)
        linked[(row["sha256"], mode)] = path
    finally:
        os.close(fd)
        temporary.unlink(missing_ok=True)

def receive_archive(args):
    archive_path = Path(args.archive)
    require(SHA.fullmatch(args.expected_sha256 or ""), "Select the original complete archive SHA256.")
    observed = sha_file(archive_path)
    require(observed["sha256"] == args.expected_sha256, "The complete selected archive changed.")
    root = private_directory(Path(args.destination))
    with owned_lock(root), zipfile.ZipFile(archive_path) as archive:
        manifest, objects, manifest_sha = check_zip(archive, args.workspace_id)
        request = {"schema": "starforge.pmtiles-package-receiving-request.v1", "archiveSha256": observed["sha256"],
                   "manifestSha256": manifest_sha, "packageId": manifest["id"], "workspaceId": args.workspace_id}
        request_path = root / "package-receiving-request.json"
        if not request_path.exists():
            require(not any((root / name).exists() for name in ("source", "runtime", "workspace-snapshot")),
                    "The selected receiving directory already contains a different product.")
        save_new(request_path, stable_bytes(request))
        linked = {}
        for row in manifest["files"]:
            receive_file(archive, row, root, manifest_sha, linked)
        for row in manifest["bootstrap"]:
            save_new(root / row["path"], archive.read(row["path"]))
        save_new(root / "PACKAGE.json", archive.read("PACKAGE.json"))
        final = sha_file(archive_path)
        require(final == observed, "The archive changed during receiving.")
        result_path = root / "package-source-complete.json"
        if result_path.exists():
            result = json.loads(read_small(result_path))
            require(result["manifestSha256"] == manifest_sha and result["archiveSha256"] == observed["sha256"],
                    "The original receiving completion changed.")
            return result
        result = {"schema": "starforge.pmtiles-package-source-received.v1", "status": "SOURCE_COMPLETE",
                  "packageId": manifest["id"], "workspaceId": args.workspace_id, "archiveSha256": observed["sha256"],
                  "manifestSha256": manifest_sha, "directory": str(root), "files": len(manifest["files"]),
                  "receivedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                  "nextCommand": "node " + str(root / manifest["source"]["entry"]) + " receive-installed --input /ABSOLUTE/receiving-input.json"}
        save_new(result_path, stable_bytes(result))
        return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="operation", required=True)
    write = sub.add_parser("write")
    write.add_argument("--root", required=True)
    write.add_argument("--output", required=True)
    write.add_argument("--manifest-sha256", required=True)
    write.add_argument("--workspace-id", required=True)
    receive = sub.add_parser("receive")
    receive.add_argument("--archive", required=True)
    receive.add_argument("--destination", required=True)
    receive.add_argument("--expected-sha256", required=True)
    receive.add_argument("--workspace-id", required=True)
    args = parser.parse_args()
    result = write_archive(args) if args.operation == "write" else receive_archive(args)
    print(json.dumps(result, ensure_ascii=False), flush=True)

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"status": "FAILED", "error": type(error).__name__, "message": str(error)}), file=sys.stderr, flush=True)
        raise SystemExit(1)
