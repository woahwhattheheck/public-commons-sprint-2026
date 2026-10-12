#!/usr/bin/env python3
"""Create, inspect or receive the complete frozen field-successor handover.

This portable file receiver never opens PostgreSQL, synchronizes a field return,
runs QGIS, or executes code carried by the incoming archive.
"""
from __future__ import annotations
import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import tempfile
import uuid
import zipfile

SCHEMA = "starforge.postgis-field-delivery.v1"
LIMIT = 256 * 1024 * 1024


def require(condition, message):
    if not condition:
        raise ValueError(message)


def ordinary(path, *, directory=False, exists=True):
    value = Path(path)
    require(value.is_absolute() and str(value) == str(value.absolute()), "Use an explicit absolute path.")
    require(not any(p.is_symlink() for p in (value, *value.parents)), "A selected path contains a symbolic link.")
    if exists:
        require(value.is_dir() if directory else value.is_file(), "The original selected path is unavailable.")
    return value


def name(value):
    require(isinstance(value, str) and value and "\\" not in value and "\x00" not in value and
            not value.startswith("/") and str(PurePosixPath(value)) == value and
            all(p not in ("", ".", "..") for p in value.split("/")), "The archive member path is not portable.")
    return value


def member(root, value):
    return ordinary(root / name(value), exists=False)


def raw_json(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode()


def digest(path):
    path = ordinary(path)
    initial = path.stat()
    h = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        opened = os.fstat(stream.fileno())
        require((initial.st_dev, initial.st_ino, initial.st_size, initial.st_mtime_ns) ==
                (opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns), "The selected file changed.")
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
            size += len(block)
        final = os.fstat(stream.fileno())
    named = path.stat()
    require((opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns) ==
            (final.st_dev, final.st_ino, final.st_size, final.st_mtime_ns) ==
            (named.st_dev, named.st_ino, named.st_size, named.st_mtime_ns) and size == final.st_size,
            "The selected file changed while being read.")
    return {"bytes": size, "sha256": h.hexdigest()}


def verify(path, record):
    require(type(record.get("bytes")) is int and record["bytes"] >= 0 and
            re.fullmatch(r"[a-f0-9]{64}", record.get("sha256", "")), "Retain a complete original file descriptor.")
    require(digest(path) == {k: record[k] for k in ("bytes", "sha256")}, "A retained member differs: " + str(path))


def publish(path, content, *, staging=None):
    path = ordinary(path, exists=False)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.exists():
        require(path.read_bytes() == content, "A different retained file occupies the original destination.")
        return
    parent = ordinary(staging or path.parent, directory=True)
    temporary = parent / (".field-publish-" + uuid.uuid4().hex)
    try:
        with temporary.open("xb") as output:
            os.chmod(temporary, 0o600)
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            require(path.read_bytes() == content, "A concurrent retained file differs.")
        fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        temporary.unlink(missing_ok=True)


@contextlib.contextmanager
def lock(root):
    import fcntl
    selected = ordinary(root / ".field-delivery.lock", exists=False)
    with selected.open("a+b") as handle:
        os.chmod(selected, 0o600)
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def manifest(raw):
    require(len(raw) <= LIMIT, "The original handover manifest exceeds its supported metadata size.")
    data = json.loads(raw)
    require(data.get("schema") == SCHEMA and data.get("credentialsIncluded") is False and
            isinstance(data.get("files"), list), "Use the complete field-successor handover manifest.")
    seen = set()
    for record in data["files"]:
        path = name(record["path"])
        require(path != "delivery.json" and path not in seen, "The handover repeats a member.")
        require(type(record.get("bytes")) is int and record["bytes"] >= 0 and
                re.fullmatch(r"[a-f0-9]{64}", record.get("sha256", "")), "A member descriptor is incomplete.")
        seen.add(path)
    for required in ("original-operations.json", "FIELD_PUBLICATION.md",
                     "receiving/postgis-receiving.json", "database-backup/postgis-backup.json",
                     "qgis/qgis-native-result.json", "qgis/Starforge_PostGIS_QGIS_Complete_Project.zip"):
        require(required in seen, "The complete handover is missing " + required)
    return data


def inspect(archive):
    archive = ordinary(archive)
    identity = digest(archive)
    with zipfile.ZipFile(archive) as package:
        infos = package.infolist()
        require(len({r.filename for r in infos}) == len(infos), "The archive repeats a member name.")
        for entry in infos:
            name(entry.filename)
            kind = stat.S_IFMT(entry.external_attr >> 16)
            require(kind in (0, stat.S_IFREG) and not entry.is_dir() and not entry.flag_bits & 1,
                    "The archive has an unsupported encrypted or special member.")
        manifest_info = package.getinfo("delivery.json")
        require(manifest_info.file_size <= LIMIT, "The handover manifest exceeds its supported size.")
        raw = package.read(manifest_info)
        data = manifest(raw)
        expected = {r["path"]: r for r in data["files"]}
        expected["delivery.json"] = {"path": "delivery.json", "bytes": len(raw),
                                     "sha256": hashlib.sha256(raw).hexdigest()}
        require(set(expected) == {r.filename for r in infos}, "The archive has an incomplete or additional member.")
        for entry in infos:
            record = expected[entry.filename]
            require(entry.file_size == record["bytes"], "The original member size differs.")
            h = hashlib.sha256()
            total = 0
            with package.open(entry) as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    total += len(block)
                    require(total <= record["bytes"], "The member expanded beyond its original size.")
                    h.update(block)
            require(total == record["bytes"] and h.hexdigest() == record["sha256"],
                    "The original member bytes differ: " + entry.filename)
    require(digest(archive) == identity, "The archive changed during verification.")
    return {"schema": "starforge.postgis-field-delivery-inspection.v1", "archive": str(archive),
            **identity, "manifestSha256": hashlib.sha256(raw).hexdigest(), "manifest": data,
            "fileCount": len(expected), "decodedBytes": sum(r["bytes"] for r in expected.values()),
            "databaseRestored": False, "qgisExecuted": False}


def pack(directory, archive):
    root = ordinary(directory, directory=True)
    archive = ordinary(archive, exists=False)
    source = ordinary(root / "delivery.json")
    raw = source.read_bytes()
    data = manifest(raw)
    if archive.exists():
        result = inspect(archive)
        require(result["manifestSha256"] == hashlib.sha256(raw).hexdigest(), "The existing archive binds another delivery.")
        return result
    archive.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = archive.parent / (".field-handover-" + uuid.uuid4().hex + ".tmp")
    try:
        with temporary.open("xb") as output:
            os.chmod(temporary, 0o600)
            with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as package:
                for record in data["files"]:
                    path = member(root, record["path"])
                    verify(path, record)
                    info = zipfile.ZipInfo(record["path"], date_time=(1980, 1, 1, 0, 0, 0))
                    info.external_attr = (stat.S_IFREG | 0o600) << 16
                    info.compress_type = zipfile.ZIP_DEFLATED
                    h = hashlib.sha256()
                    total = 0
                    with path.open("rb") as incoming, package.open(info, "w", force_zip64=True) as outgoing:
                        for block in iter(lambda: incoming.read(1024 * 1024), b""):
                            h.update(block)
                            total += len(block)
                            outgoing.write(block)
                    require(total == record["bytes"] and h.hexdigest() == record["sha256"], "A source member changed during packing.")
                    verify(path, record)
                info = zipfile.ZipInfo("delivery.json", date_time=(1980, 1, 1, 0, 0, 0))
                info.external_attr = (stat.S_IFREG | 0o600) << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                package.writestr(info, raw)
            output.flush()
            os.fsync(output.fileno())
        verify(source, {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()})
        result = inspect(temporary)
        try:
            os.link(temporary, archive)
        except FileExistsError:
            actual = inspect(archive)
            require(actual["manifestSha256"] == result["manifestSha256"], "A concurrent original package differs.")
        return inspect(archive)
    finally:
        temporary.unlink(missing_ok=True)


def receive(archive, destination):
    source = inspect(archive)
    root = ordinary(destination, exists=False)
    root.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    request = {"schema": "starforge.postgis-field-delivery-request.v1",
               "archiveSha256": source["sha256"], "archiveBytes": source["bytes"],
               "manifestSha256": source["manifestSha256"], "operationId": source["manifest"]["operationId"]}
    request_path = root / "field-delivery-request.json"
    if root.exists() and not request_path.exists():
        require(root.is_dir() and not any(root.iterdir()), "Use an empty or original receiving destination.")
    root.mkdir(mode=0o700, exist_ok=True)
    # Stage outside the newly created slot so an interrupted pre-link request
    # leaves the empty original destination available to the same continuation.
    publish(request_path, raw_json(request), staging=root.parent)
    with lock(root), zipfile.ZipFile(archive) as package:
        records = source["manifest"]["files"] + [{"path": "delivery.json",
            "bytes": package.getinfo("delivery.json").file_size, "sha256": source["manifestSha256"]}]
        for record in records:
            path = member(root, record["path"])
            if path.exists():
                verify(path, record)
                continue
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            temporary = path.parent / (".field-receive-" + uuid.uuid4().hex)
            try:
                h = hashlib.sha256()
                size = 0
                with package.open(record["path"]) as incoming, temporary.open("xb") as output:
                    os.chmod(temporary, 0o600)
                    for block in iter(lambda: incoming.read(1024 * 1024), b""):
                        h.update(block)
                        size += len(block)
                        require(size <= record["bytes"], "The received member exceeds its original size.")
                        output.write(block)
                    output.flush()
                    os.fsync(output.fileno())
                require(size == record["bytes"] and h.hexdigest() == record["sha256"], "The received member changed.")
                try:
                    os.link(temporary, path)
                except FileExistsError:
                    verify(path, record)
            finally:
                temporary.unlink(missing_ok=True)
        require(digest(Path(archive)) == {"bytes": source["bytes"], "sha256": source["sha256"]},
                "The original archive changed during receiving.")
        receipt = {"schema": "starforge.postgis-field-delivery-receipt.v1", **request,
                   "directory": str(root), "fileCount": len(records),
                   "databaseRestored": False, "qgisExecuted": False,
                   "instructions": "Read FIELD_PUBLICATION.md and use the original database/QGIS receiving commands with local credentials."}
        receipt["schema"] = "starforge.postgis-field-delivery-receipt.v1"
        publish(root / "field-delivery-receipt.json", raw_json(receipt))
        return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("pack", "inspect", "receive"))
    parser.add_argument("--archive", required=True)
    parser.add_argument("--directory")
    parser.add_argument("--destination")
    args = parser.parse_args()
    if args.action == "pack":
        require(args.directory is not None, "Packing requires --directory.")
        result = pack(args.directory, args.archive)
    elif args.action == "receive":
        require(args.destination is not None, "Receiving requires --destination.")
        result = receive(args.archive, args.destination)
    else:
        result = inspect(args.archive)
    # The manifest and member source remain in the archive; return compact evidence.
    print(json.dumps({k: v for k, v in result.items() if k != "manifest"}, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"state": "incomplete", "error": type(error).__name__, "message": str(error)}))
        raise SystemExit(1)
