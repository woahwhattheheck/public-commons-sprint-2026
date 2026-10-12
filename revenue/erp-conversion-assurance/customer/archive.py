#!/usr/bin/env python3
"""Complete private customer snapshots for the retained reconciliation workspace."""
from __future__ import annotations
import argparse
import datetime as dt
import hashlib
import json
import os
import re
from pathlib import Path, PurePosixPath
import shutil
import stat
import sys
import tempfile
import uuid
import zipfile

SCHEMA = "erp-reconciliation.customer-backup.v1"
MANIFEST = "CUSTOMER_BACKUP.json"
CHUNK = 1024 * 1024

class ArchiveError(Exception):
    pass

def require(ok, code):
    if not ok:
        raise ArchiveError(code)

def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()

def digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(CHUNK), b""):
            h.update(chunk)
    return h.hexdigest()

def absolute(path):
    path = Path(path)
    require(path.is_absolute(), "ABSOLUTE_PATH_REQUIRED")
    return Path(os.path.abspath(path))

def private_dir(path):
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode),
            "PRIVATE_DIRECTORY_REQUIRED")
    require(not info.st_mode & 0o077 and info.st_uid == os.getuid(),
            "PRIVATE_DIRECTORY_REQUIRED")
    require(path.resolve() == absolute(path), "DIRECTORY_SYMLINK_REJECTED")
    return info

def fingerprint(info):
    return [info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_size,
            info.st_mtime_ns, info.st_ctime_ns]

def transient(parts):
    if parts and parts[0] == "runtime":
        return True
    if (len(parts) >= 5 and parts[0:2] == ("provider", "peers")
            and parts[3:5] == ("service", "runtime")):
        return True
    # The retained AGX custody helper stages <original>.json.tmp-<UUID>.
    # Its durable .json binding remains part of the complete customer snapshot.
    custody_temporary = r"[A-Za-z0-9][A-Za-z0-9._-]{0,95}\.json\.tmp-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"
    return any(part.startswith((".stage-", ".write-", ".replay-", ".snapshot-"))
               or re.fullmatch(custody_temporary, part) is not None
               for part in parts)

def inventory(root):
    files, directories = {}, {}
    def walk(directory, relative=()):
        info = private_dir(directory)
        directories["/".join(relative)] = fingerprint(info)
        for entry in sorted(directory.iterdir(), key=lambda x: x.name):
            parts = relative + (entry.name,)
            if transient(parts):
                continue
            info = entry.lstat()
            require(not stat.S_ISLNK(info.st_mode), "SOURCE_SYMLINK_REJECTED")
            if stat.S_ISDIR(info.st_mode):
                walk(entry, parts)
            else:
                require(stat.S_ISREG(info.st_mode), "REGULAR_FILE_REQUIRED")
                require(not info.st_mode & 0o077 and info.st_uid == os.getuid(),
                        "PRIVATE_FILE_REQUIRED")
                files["/".join(parts)] = fingerprint(info)
    walk(root)
    return files, directories

def sync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def source_bytes(root, name, expected):
    fd = os.open(root / name, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as source:
        require(fingerprint(os.fstat(source.fileno())) == expected, "SOURCE_CHANGED")
        yield source
        require(fingerprint(os.fstat(source.fileno())) == expected, "SOURCE_CHANGED")

def private_json(path, maximum=262144):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as f:
        info = os.fstat(f.fileno())
        require(stat.S_ISREG(info.st_mode) and not info.st_mode & 0o077
                and info.st_uid == os.getuid() and info.st_size <= maximum,
                "PRIVATE_JSON_REQUIRED")
        raw = f.read(maximum + 1)
    require(len(raw) <= maximum, "JSON_LIMIT_EXCEEDED")
    return json.loads(raw)

def snapshot(root, archive):
    root, archive = absolute(root), absolute(archive)
    private_dir(root)
    require(root not in archive.parents and archive != root, "BACKUP_DESTINATION_OUTSIDE_WORKSPACE")
    require(archive.parent.resolve() == archive.parent, "DIRECTORY_SYMLINK_REJECTED")
    private_dir(archive.parent)
    before = inventory(root)
    customer = private_json(root / "customer.json")
    require(customer.get("schema") == "erp-reconciliation.customer.v1",
            "CUSTOMER_CONFIGURATION_REQUIRED")
    require("customer.json" in before[0] and "profile.json" in before[0],
            "CUSTOMER_CONFIGURATION_REQUIRED")
    captured = now()
    manifest = {"schema": SCHEMA, "backupId": str(uuid.uuid4()),
                "customerId": customer["customerId"], "customerName": customer["name"],
                "capturedAt": captured, "files": {}, "directories": sorted(before[1]),
                "runtime": "Original native leases are re-created when this workspace opens."}
    created = False
    try:
        fd = os.open(archive, os.O_CREAT | os.O_EXCL | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        created = True
        with os.fdopen(fd, "w+b") as target:
            with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED,
                                 compresslevel=6, allowZip64=True) as output:
                for name, pin in sorted(before[0].items()):
                    entry = zipfile.ZipInfo("workspace/" + name)
                    entry.create_system = 3
                    entry.external_attr = (stat.S_IFREG | 0o600) << 16
                    entry.compress_type = zipfile.ZIP_DEFLATED
                    h, size = hashlib.sha256(), 0
                    for source in source_bytes(root, name, pin):
                        with output.open(entry, "w", force_zip64=True) as receiving:
                            for chunk in iter(lambda: source.read(CHUNK), b""):
                                receiving.write(chunk)
                                h.update(chunk)
                                size += len(chunk)
                    require(size == pin[4], "SOURCE_CHANGED")
                    manifest["files"][name] = {"bytes": size, "sha256": h.hexdigest()}
                require(inventory(root) == before, "SOURCE_CHANGED_DURING_BACKUP")
                raw = (json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()
                require(len(raw) <= 16 * 1024 * 1024, "BACKUP_MANIFEST_LIMIT_EXCEEDED")
                entry = zipfile.ZipInfo(MANIFEST)
                entry.create_system = 3
                entry.external_attr = (stat.S_IFREG | 0o600) << 16
                entry.compress_type = zipfile.ZIP_DEFLATED
                output.writestr(entry, raw)
            target.flush()
            os.fsync(target.fileno())
        sync_dir(archive.parent)
        return {"schema": "erp-reconciliation.customer-backup-receipt.v1",
                "backupId": manifest["backupId"], "customerId": manifest["customerId"],
                "capturedAt": captured, "archive": str(archive),
                "sha256": digest(archive), "bytes": archive.stat().st_size,
                "manifestSha256": hashlib.sha256(raw).hexdigest(),
                "files": len(manifest["files"]),
                "sourceBytes": sum(pin["bytes"] for pin in manifest["files"].values())}
    except BaseException:
        if created:
            archive.unlink(missing_ok=True)
        raise

def valid_member(name):
    path = PurePosixPath(name)
    return (isinstance(name, str) and bool(name) and "\\" not in name
            and "\x00" not in name and not path.is_absolute()
            and str(path) == name and all(part not in ("", ".", "..") for part in path.parts)
            and ":" not in path.parts[0])

def inspect_archive(source, expected=None):
    source = absolute(source)
    info = source.lstat()
    require(stat.S_ISREG(info.st_mode) and not stat.S_ISLNK(info.st_mode)
            and not info.st_mode & 0o077 and info.st_uid == os.getuid(),
            "PRIVATE_ARCHIVE_REQUIRED")
    fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
    incoming = os.fdopen(fd, "rb")
    original = fingerprint(os.fstat(incoming.fileno()))
    hasher = hashlib.sha256()
    for chunk in iter(lambda: incoming.read(CHUNK), b""):
        hasher.update(chunk)
    archive_sha = hasher.hexdigest()
    incoming.seek(0)
    try:
        if expected:
            require(len(expected) == 64 and all(c in "0123456789abcdef" for c in expected),
                    "INVALID_ARCHIVE_SHA256")
            require(archive_sha == expected, "ARCHIVE_SHA256_CONFLICT")
        require(fingerprint(os.fstat(incoming.fileno())) == original, "ARCHIVE_CHANGED")
        archive = zipfile.ZipFile(incoming, "r")
        archive._customer_source = incoming
        archive._customer_original = original
        archive._customer_sha256 = archive_sha
    except BaseException:
        incoming.close()
        raise
    try:
        infos = archive.infolist()
        names = [info.filename for info in infos]
        require(len(names) == len(set(names)) and MANIFEST in names, "INVALID_BACKUP_INVENTORY")
        require(archive.getinfo(MANIFEST).file_size <= 16 * 1024 * 1024,
                "BACKUP_MANIFEST_LIMIT_EXCEEDED")
        raw = archive.read(MANIFEST)
        manifest = json.loads(raw)
        require(manifest.get("schema") == SCHEMA and isinstance(manifest.get("files"), dict)
                and isinstance(manifest.get("directories"), list), "INVALID_BACKUP_MANIFEST")
        for name, pin in manifest["files"].items():
            require(valid_member(name) and isinstance(pin, dict)
                    and isinstance(pin.get("bytes"), int) and not isinstance(pin["bytes"], bool)
                    and pin["bytes"] >= 0 and isinstance(pin.get("sha256"), str)
                    and len(pin["sha256"]) == 64
                    and all(c in "0123456789abcdef" for c in pin["sha256"]),
                    "INVALID_BACKUP_MANIFEST")
        expected_names = {MANIFEST} | {"workspace/" + name for name in manifest["files"]}
        require(set(names) == expected_names, "BACKUP_INVENTORY_CONFLICT")
        for info in infos:
            require(not info.is_dir() and not info.flag_bits & 1
                    and stat.S_IFMT(info.external_attr >> 16) in (0, stat.S_IFREG),
                    "INVALID_BACKUP_MEMBER")
            if info.filename != MANIFEST:
                require(info.file_size == manifest["files"][info.filename[10:]]["bytes"],
                        "BACKUP_MEMBER_SIZE_CONFLICT")
        files = set(manifest["files"])
        for name in files:
            require(not any(str(parent) in files for parent in PurePosixPath(name).parents
                            if str(parent) != "."), "BACKUP_PATH_CONFLICT")
        for directory in manifest["directories"]:
            require(directory == "" or (valid_member(directory) and directory not in files),
                    "INVALID_BACKUP_DIRECTORY")
        require("customer.json" in files and "profile.json" in files,
                "CUSTOMER_CONFIGURATION_REQUIRED")
        return archive, manifest, raw
    except BaseException:
        archive.close()
        incoming.close()
        raise

def close_archive(archive):
    archive.close()
    archive._customer_source.close()

def unchanged_archive(archive):
    require(fingerprint(os.fstat(archive._customer_source.fileno())) == archive._customer_original,
            "ARCHIVE_CHANGED")

def verify_members(archive, manifest, destination=None):
    for name, pin in sorted(manifest["files"].items()):
        h, size = hashlib.sha256(), 0
        target = None
        try:
            if destination is not None:
                path = destination / name
                path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
                target = os.fdopen(fd, "wb")
            with archive.open("workspace/" + name, "r") as source:
                for chunk in iter(lambda: source.read(CHUNK), b""):
                    size += len(chunk)
                    require(size <= pin["bytes"], "BACKUP_MEMBER_SIZE_CONFLICT")
                    h.update(chunk)
                    if target is not None:
                        target.write(chunk)
            require(size == pin["bytes"] and h.hexdigest() == pin["sha256"],
                    "BACKUP_FILE_CHANGED")
            if target is not None:
                target.flush()
                os.fsync(target.fileno())
        finally:
            if target is not None:
                target.close()

def restore(source, destination, expected=None):
    source, destination = absolute(source), absolute(destination)
    private_dir(destination.parent)
    require(destination.parent.resolve() == destination.parent, "DIRECTORY_SYMLINK_REJECTED")
    require(not destination.exists() and not destination.is_symlink(), "RESTORE_DESTINATION_EXISTS")
    archive, manifest, raw = inspect_archive(source, expected)
    capacity = os.statvfs(destination.parent)
    required_bytes = sum(pin["bytes"] for pin in manifest["files"].values())
    if required_bytes > capacity.f_bavail * capacity.f_frsize:
        close_archive(archive)
        raise ArchiveError("INSUFFICIENT_DISK_SPACE")
    staging = Path(tempfile.mkdtemp(prefix=".receiving-", dir=destination.parent))
    try:
        os.chmod(staging, 0o700)
        with archive:
            for name in manifest["directories"]:
                if name:
                    (staging / name).mkdir(mode=0o700, parents=True, exist_ok=True)
            verify_members(archive, manifest, staging)
        unchanged_archive(archive)
        customer = private_json(staging / "customer.json")
        require(customer.get("schema") == "erp-reconciliation.customer.v1"
                and customer.get("customerId") == manifest["customerId"],
                "CUSTOMER_IDENTITY_CONFLICT")
        for directory, _, _ in os.walk(staging, topdown=False):
            sync_dir(Path(directory))
        require(not destination.exists() and not destination.is_symlink(), "RESTORE_DESTINATION_EXISTS")
        # The new destination is reserved atomically; existing customer roots are preserved.
        os.mkdir(destination, 0o700)
        try:
            os.rename(staging, destination)
            sync_dir(destination)
            sync_dir(destination.parent)
        except BaseException:
            # Only the empty reservation created by this operation is removed.
            try:
                destination.rmdir()
            except OSError:
                pass
            raise
        return {"schema": "erp-reconciliation.customer-restore-receipt.v1",
                "backupId": manifest["backupId"], "customerId": manifest["customerId"],
                "capturedAt": manifest["capturedAt"], "restoredAt": now(),
                "directory": str(destination), "archiveSha256": archive._customer_sha256,
                "manifestSha256": hashlib.sha256(raw).hexdigest(),
                "files": len(manifest["files"]),
                "sourceBytes": sum(pin["bytes"] for pin in manifest["files"].values())}
    finally:
        close_archive(archive)
        shutil.rmtree(staging, ignore_errors=True)

def verify(source, expected=None):
    archive, manifest, raw = inspect_archive(source, expected)
    try:
        verify_members(archive, manifest)
        unchanged_archive(archive)
        return {"schema": "erp-reconciliation.customer-backup-verification.v1",
                "backupId": manifest["backupId"], "customerId": manifest["customerId"],
                "capturedAt": manifest["capturedAt"], "files": len(manifest["files"]),
                "archiveSha256": archive._customer_sha256,
                "manifestSha256": hashlib.sha256(raw).hexdigest(),
                "sourceBytes": sum(pin["bytes"] for pin in manifest["files"].values())}
    finally:
        close_archive(archive)


def reconcile_received(source, destination, expected=None):
    """Recover the original published receiving after its final status write was lost."""
    source, destination = absolute(source), absolute(destination)
    private_dir(destination)
    archive, manifest, raw = inspect_archive(source, expected)
    try:
        before = inventory(destination)
        require(set(before[0]) == set(manifest["files"]) and
                sorted(before[1]) == manifest["directories"], "RECEIVED_INVENTORY_CHANGED")
        verify_members(archive, manifest)
        for name, pin in sorted(before[0].items()):
            h, size = hashlib.sha256(), 0
            for incoming in source_bytes(destination, name, pin):
                for chunk in iter(lambda: incoming.read(CHUNK), b""):
                    h.update(chunk)
                    size += len(chunk)
            expected_file = manifest["files"][name]
            require(size == expected_file["bytes"] and h.hexdigest() == expected_file["sha256"],
                    "RECEIVED_FILE_CHANGED")
        require(inventory(destination) == before, "RECEIVED_WORKSPACE_CHANGED")
        unchanged_archive(archive)
        return {"schema": "erp-reconciliation.customer-restore-receipt.v1",
                "backupId": manifest["backupId"], "customerId": manifest["customerId"],
                "capturedAt": manifest["capturedAt"], "reconciledAt": now(),
                "directory": str(destination), "archiveSha256": archive._customer_sha256,
                "manifestSha256": hashlib.sha256(raw).hexdigest(),
                "files": len(manifest["files"]), "matchedExisting": True,
                "sourceBytes": sum(pin["bytes"] for pin in manifest["files"].values())}
    finally:
        close_archive(archive)

def copy_private_tree(source, destination):
    source, destination = absolute(source), absolute(destination)
    private_dir(source)
    private_dir(destination.parent)
    require(source not in destination.parents and source != destination,
            "COPY_DESTINATION_OUTSIDE_SOURCE")
    require(not destination.exists() and not destination.is_symlink(), "COPY_DESTINATION_EXISTS")
    before = inventory(source)
    staging = Path(tempfile.mkdtemp(prefix=".receiving-", dir=destination.parent))
    copied = {}
    try:
        os.chmod(staging, 0o700)
        for directory in before[1]:
            if directory:
                (staging / directory).mkdir(parents=True, exist_ok=True, mode=0o700)
        for name, pin in sorted(before[0].items()):
            path = staging / name
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
            h, size = hashlib.sha256(), 0
            with os.fdopen(fd, "wb") as target:
                for incoming in source_bytes(source, name, pin):
                    for chunk in iter(lambda: incoming.read(CHUNK), b""):
                        target.write(chunk)
                        h.update(chunk)
                        size += len(chunk)
                require(size == pin[4], "SOURCE_CHANGED")
                target.flush()
                os.fsync(target.fileno())
            copied[name] = {"bytes": size, "sha256": h.hexdigest()}
        require(inventory(source) == before, "SOURCE_CHANGED_DURING_COPY")
        for directory, _, _ in os.walk(staging, topdown=False):
            sync_dir(Path(directory))
        os.mkdir(destination, 0o700)
        try:
            os.rename(staging, destination)
            sync_dir(destination)
            sync_dir(destination.parent)
        except BaseException:
            try:
                destination.rmdir()
            except OSError:
                pass
            raise
        return {"schema": "erp-reconciliation.private-copy.v1", "copiedAt": now(),
                "directory": str(destination), "files": copied,
                "sourceBytes": sum(pin["bytes"] for pin in copied.values())}
    finally:
        shutil.rmtree(staging, ignore_errors=True)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("snapshot")
    create.add_argument("--source", required=True)
    create.add_argument("--archive", required=True)
    copying = commands.add_parser("copy")
    copying.add_argument("--source", required=True)
    copying.add_argument("--destination", required=True)
    for command in ("restore", "verify", "reconcile"):
        sub = commands.add_parser(command)
        sub.add_argument("--archive", required=True)
        sub.add_argument("--sha256")
        if command in ("restore", "reconcile"):
            sub.add_argument("--destination", required=True)
    args = parser.parse_args()
    os.umask(0o077)
    if args.command == "snapshot":
        result = snapshot(args.source, args.archive)
    elif args.command == "copy":
        result = copy_private_tree(args.source, args.destination)
    elif args.command == "restore":
        result = restore(args.archive, args.destination, args.sha256)
    elif args.command == "reconcile":
        result = reconcile_received(args.archive, args.destination, args.sha256)
    else:
        result = verify(args.archive, args.sha256)
    print(json.dumps(result, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    try:
        main()
    except (ArchiveError, OSError, ValueError, zipfile.BadZipFile) as error:
        code = str(error) if isinstance(error, ArchiveError) else getattr(error, "errno", None)
        print(json.dumps({"error": {"code": code or type(error).__name__}}), file=sys.stderr)
        sys.exit(1)
