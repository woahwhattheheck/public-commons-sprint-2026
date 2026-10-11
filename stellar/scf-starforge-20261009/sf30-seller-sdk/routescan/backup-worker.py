#!/usr/bin/env python3
"""Private Routescan project archives. Standard-library ZIP; no provider calls."""
import argparse
import hashlib
import json
import os
import re
import stat
import sys
import tempfile
import zipfile
from pathlib import Path

SCHEMA = "stellar-forge.routescan-backup.v1"
MAX_FILE = 64 * 1024 * 1024
MAX_TOTAL = 256 * 1024 * 1024
MAX_FILES = 10000
ID = r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}"
PROJECT_FILE = re.compile(
    r"(?:project\.json|revisions/[1-9][0-9]*\.json|quota/quota\.json|"
    r"previews/" + ID + r"/(?:request|result)\.json|"
    r"exports/" + ID + r"/(?:merchant|review|seller-openapi|export|export-plan|customer-handoff)\.json|"
    r"exports/" + ID + r"/client/(?:seller-client\.mjs|seller-client\.d\.mts|seller-openapi\.json|package\.json|README\.md|client-export\.json)|"
    r"exports/" + ID + r"/customer/(?:customer\.mjs|customer\.py|README\.md|request\.json))"
)
CUSTOMER_FILE = re.compile(
    r"(?:(?:merchant|review|seller-openapi|export|export-plan|customer-handoff)\.json|"
    r"client/(?:seller-client\.mjs|seller-client\.d\.mts|seller-openapi\.json|package\.json|README\.md|client-export\.json)|"
    r"customer/(?:customer\.mjs|customer\.py|README\.md|request\.json))"
)


def fail(message):
    raise ValueError(message)


def private_root(value, create=False):
    path = Path(value)
    if not path.is_absolute() or path == Path("/") or path.resolve() != path:
        fail("Use a canonical absolute private directory.")
    if create:
        path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_mode & 0o077:
        fail("The archive directory must be private.")
    return path


def allowed(name, kind):
    return bool((PROJECT_FILE if kind == "project" else CUSTOMER_FILE).fullmatch(name))


def inventory(root, kind):
    members = []
    for directory, names, files in os.walk(root, followlinks=False):
        for name in names:
            child = Path(directory) / name
            if child.is_symlink():
                fail("Workspace directories must not be symbolic links.")
        for name in files:
            path = Path(directory) / name
            relative = path.relative_to(root).as_posix()
            if name.endswith(".lock") or name.startswith((".write-", ".body-", ".client-export-", ".customer-")):
                continue
            if not allowed(relative, kind):
                fail("Unexpected workspace member: " + relative)
            members.append(relative)
    if len(members) > MAX_FILES:
        fail("Workspace exceeds the archive file-count limit.")
    return sorted(members)


def read_member(root, name):
    path = root / name
    if path.resolve() != path:
        fail("Workspace member changed to a symbolic link.")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_mode & 0o077 or before.st_size > MAX_FILE:
            fail("Invalid private workspace member: " + name)
        with os.fdopen(os.dup(fd), "rb") as source:
            data = source.read(MAX_FILE + 1)
        after = os.fstat(fd)
        if len(data) > MAX_FILE or (before.st_ino, before.st_size, before.st_mtime_ns) != (
            after.st_ino, after.st_size, after.st_mtime_ns
        ):
            fail("Workspace changed while the backup was being read.")
        return data
    finally:
        os.close(fd)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def entry(name, data):
    return {"path": name, "bytes": len(data), "sha256": digest(data)}


def put_zip(archive, name, data):
    item = zipfile.ZipInfo(name)
    item.create_system = 3
    item.external_attr = (stat.S_IFREG | 0o600) << 16
    item.compress_type = zipfile.ZIP_DEFLATED
    archive.writestr(item, data)


def create(root, output, kind):
    root = private_root(root)
    output = Path(output)
    private_root(str(output.parent), create=True)
    if output.exists() or output.is_symlink():
        fail("Choose a new backup filename.")
    names = inventory(root, kind)
    if kind == "project" and "project.json" not in names:
        fail("The saved project configuration is required.")
    fd, temp_name = tempfile.mkstemp(prefix=".archive-", dir=output.parent)
    os.close(fd)
    records, total = [], 0
    try:
        with zipfile.ZipFile(temp_name, "w", allowZip64=False) as archive:
            for name in names:
                data = read_member(root, name)
                total += len(data)
                if total > MAX_TOTAL:
                    fail("Workspace exceeds the 256 MiB archive limit.")
                records.append(entry(name, data))
                put_zip(archive, name, data)
            manifest = {"schema": SCHEMA, "kind": kind, "files": records, "totalBytes": total}
            put_zip(archive, "manifest.json", (json.dumps(manifest, indent=2) + "\n").encode())
        if inventory(root, kind) != names:
            fail("Workspace changed while the backup was being read. Reopen it and create another backup.")
        for record in records:
            if entry(record["path"], read_member(root, record["path"])) != record:
                fail("Workspace changed while the backup was being read. Reopen it and create another backup.")
        with open(temp_name, "rb") as saved:
            os.fsync(saved.fileno())
        os.link(temp_name, output)
        with open(output, "rb") as saved:
            archive_sha = hashlib.file_digest(saved, "sha256").hexdigest()
        folder_fd = os.open(output.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(folder_fd)
        finally:
            os.close(folder_fd)
        return {"path": str(output), "bytes": output.stat().st_size, "sha256": archive_sha, "files": len(records), "kind": kind}
    finally:
        Path(temp_name).unlink(missing_ok=True)


def restore(source, destination):
    source = Path(source)
    if source.resolve() != source or not source.is_file() or source.stat().st_size > MAX_TOTAL:
        fail("Use a regular workspace archive up to 256 MiB.")
    destination = Path(destination)
    if not destination.is_absolute() or destination.resolve() != destination or destination.exists():
        fail("Restore requires a new canonical absolute directory.")
    private_root(str(destination.parent), create=True)
    with zipfile.ZipFile(source) as archive:
        infos = archive.infolist()
        if len(infos) > MAX_FILES + 1:
            fail("Archive has too many files.")
        by_name = {}
        total = 0
        for item in infos:
            mode = (item.external_attr >> 16) & 0o170000
            if item.filename in by_name or item.is_dir() or mode not in (0, stat.S_IFREG):
                fail("Archive contains duplicate or unsupported members.")
            if item.flag_bits & 1 or item.file_size > MAX_FILE:
                fail("Archive contains encrypted or oversized files.")
            total += item.file_size
            if total > MAX_TOTAL + 4 * 1024 * 1024:
                fail("Archive exceeds the expanded-size limit.")
            by_name[item.filename] = item
        manifest_info = by_name.get("manifest.json")
        if not manifest_info or manifest_info.file_size > 4 * 1024 * 1024:
            fail("Archive manifest is missing or too large.")
        manifest = json.loads(archive.read(manifest_info))
        if manifest.get("schema") != SCHEMA or manifest.get("kind") != "project" or not isinstance(manifest.get("files"), list):
            fail("Use a complete Routescan project backup.")
        expected = {}
        for row in manifest["files"]:
            if not isinstance(row, dict) or set(row) != {"path", "bytes", "sha256"}:
                fail("Invalid archive file record.")
            name = row["path"]
            if not isinstance(name, str) or not allowed(name, "project") or name in expected:
                fail("Invalid archive member path.")
            if not isinstance(row["bytes"], int) or isinstance(row["bytes"], bool) or not 0 <= row["bytes"] <= MAX_FILE:
                fail("Invalid archive member size.")
            if not re.fullmatch(r"[a-f0-9]{64}", row["sha256"]):
                fail("Invalid archive digest.")
            expected[name] = row
        if set(by_name) != set(expected) | {"manifest.json"} or "project.json" not in expected:
            fail("Archive contents differ from their manifest.")
        if sum(row["bytes"] for row in expected.values()) != manifest.get("totalBytes"):
            fail("Archive total differs from its manifest.")
        destination.mkdir(mode=0o700)
        for name, row in expected.items():
            data = archive.read(by_name[name])
            if entry(name, data) != row:
                fail("Archive member differs from its recorded bytes: " + name)
            target = destination / name
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "wb") as saved:
                saved.write(data)
                saved.flush()
                os.fsync(saved.fileno())
        return {"directory": str(destination), "files": len(expected), "bytes": manifest["totalBytes"], "state": "RESTORED"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["create", "restore"])
    parser.add_argument("--root")
    parser.add_argument("--output")
    parser.add_argument("--archive")
    parser.add_argument("--destination")
    parser.add_argument("--kind", choices=["project", "customer"], default="project")
    args = parser.parse_args()
    if args.command == "create":
        if not args.root or not args.output:
            parser.error("create requires --root and --output")
        result = create(args.root, args.output, args.kind)
    else:
        if not args.archive or not args.destination:
            parser.error("restore requires --archive and --destination")
        result = restore(args.archive, args.destination)
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, zipfile.BadZipFile, json.JSONDecodeError, KeyError, TypeError) as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        sys.exit(1)
