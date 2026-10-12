#!/usr/bin/env python3
"""Stream the exact manifested operator directory into a create-only ZIP64 archive."""
import hashlib
import json
import os
from pathlib import Path
import stat
import signal
import sys
import uuid
import zipfile

CHUNK = 1024 * 1024
LIMIT = 64 * CHUNK
stop_signal = 0

def stop(signum, frame):
    global stop_signal
    if not stop_signal:
        stop_signal = signum
        raise InterruptedError('Native archive interrupted; the original source is retained.')

signal.signal(signal.SIGINT, stop)
signal.signal(signal.SIGTERM, stop)

def require(ok, message):
    if not ok:
        raise ValueError(message)

def regular(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and path.resolve() == path, "Use canonical regular receiving members.")
    return info

def member(root, name):
    require(isinstance(name, str) and name and not name.startswith("/") and "\\" not in name
            and all(part and part not in (".", "..") for part in name.split("/")), "Invalid receiving member.")
    return root / name

def check_directory(path):
    require(path.is_absolute() and path.resolve() == path and path.is_dir(), "Use a canonical receiving directory.")

def sha_file(path):
    before = regular(path)
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while True:
            data = source.read(CHUNK)
            if not data:
                break
            digest.update(data)
    after = regular(path)
    require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
            (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns), "The original archive changed.")
    return {"sha256": digest.hexdigest(), "bytes": after.st_size}

def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def inspect_archive(path, manifest_bytes, records):
    regular(path)
    with zipfile.ZipFile(path, "r") as archive:
        members = archive.infolist()
        require(len(members) == len(records) + 1 and len({item.filename for item in members}) == len(members),
                "The receiving archive has a different member inventory.")
        expected = {item["path"]: item for item in records}
        expected["geoserver-receiving.json"] = {"bytes": len(manifest_bytes),
            "sha256": hashlib.sha256(manifest_bytes).hexdigest()}
        for item in members:
            record = expected.get(item.filename)
            require(record and item.file_size == record["bytes"] and not item.is_dir() and
                    not (item.flag_bits & 1) and stat.S_IFMT(item.external_attr >> 16) == stat.S_IFREG, "The archive member differs from the retained receiving manifest.")
            digest = hashlib.sha256()
            with archive.open(item) as source:
                for data in iter(lambda: source.read(CHUNK), b""):
                    digest.update(data)
            require(digest.hexdigest() == record["sha256"], "The archive member bytes changed.")
    return sha_file(path)

def main():
    require(len(sys.argv) == 4, "Use receiving directory, archive path and exact manifest SHA256.")
    root, output = Path(sys.argv[1]), Path(sys.argv[2])
    check_directory(root); check_directory(output.parent)
    require(output.is_absolute() and output.parent.resolve() == output.parent, "Use a canonical archive path.")
    manifest_path = root / "geoserver-receiving.json"
    require(regular(manifest_path).st_size <= LIMIT, "Receiving manifest is too large.")
    manifest_bytes = manifest_path.read_bytes()
    require(hashlib.sha256(manifest_bytes).hexdigest() == sys.argv[3], "The original receiving manifest changed.")
    manifest = json.loads(manifest_bytes)
    require(manifest.get("schema") == "starforge.geoserver-receiving.v1" and
            isinstance(manifest.get("files"), list), "Use the complete GeoServer receiving manifest.")
    records = manifest["files"]
    require(len(records) <= 1000000 and len({item["path"] for item in records}) == len(records),
            "The receiving member inventory is invalid.")
    for item in records:
        member(root, item["path"])
        require(item["path"] != "geoserver-receiving.json" and isinstance(item["bytes"], int) and
                item["bytes"] >= 0 and isinstance(item["sha256"], str) and len(item["sha256"]) == 64,
                "The receiving member descriptor is invalid.")
    if output.exists():
        result = inspect_archive(output, manifest_bytes, records)
        sync_directory(output.parent)
    else:
        temporary = output.parent / (".geoserver-archive-" + str(uuid.uuid4()))
        descriptor = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_RDWR, 0o600)
        owned = os.fstat(descriptor)
        try:
            with os.fdopen(descriptor, "w+b") as target:
                with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6,
                                     allowZip64=True) as archive:
                    for record in records + [{"path": "geoserver-receiving.json", "bytes": len(manifest_bytes),
                                             "sha256": sys.argv[3]}]:
                        path = member(root, record["path"]); before = regular(path)
                        require(before.st_size == record["bytes"], "The receiving source size changed.")
                        info = zipfile.ZipInfo(record["path"], date_time=(1980, 1, 1, 0, 0, 0))
                        info.create_system = 3; info.external_attr = (stat.S_IFREG | 0o600) << 16
                        info.compress_type = zipfile.ZIP_DEFLATED
                        digest = hashlib.sha256(); size = 0
                        with path.open("rb") as source, archive.open(info, "w", force_zip64=True) as destination:
                            for data in iter(lambda: source.read(CHUNK), b""):
                                digest.update(data); size += len(data); destination.write(data)
                        after = regular(path)
                        require(size == record["bytes"] and digest.hexdigest() == record["sha256"] and
                                (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
                                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns),
                                "The receiving source changed during archive creation.")
                target.flush(); os.fsync(target.fileno())
            try:
                os.link(temporary, output)
            except FileExistsError:
                pass
            sync_directory(output.parent)
            result = inspect_archive(output, manifest_bytes, records)
        finally:
            try:
                current = temporary.lstat()
                if (current.st_dev, current.st_ino) == (owned.st_dev, owned.st_ino):
                    temporary.unlink(); sync_directory(output.parent)
            except FileNotFoundError:
                pass
    sys.stdout.write(json.dumps({"schema": "starforge.geoserver-archive.v1", "path": str(output),
        "manifestSha256": sys.argv[3], **result}, separators=(",", ":")) + "\n")

if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, zipfile.BadZipFile) as error:
        sys.stderr.write(str(error) + "\n")
        raise SystemExit(128 + stop_signal if stop_signal else 2)
