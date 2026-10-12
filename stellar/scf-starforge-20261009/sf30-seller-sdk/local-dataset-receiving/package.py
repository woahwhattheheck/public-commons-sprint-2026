"""Portable original local-data/customer files. No provider, SQL or payment execution."""
from __future__ import annotations
import argparse
import ctypes
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import zipfile

SCHEMA = "stellar-forge.local-dataset-customer-package.v1"
MAX_FILE = 8 * 1024**3
MAX_TOTAL = 16 * 1024**3
MAX_METADATA = 64 * 1024**2
CHUNK = 1024 * 1024
HEX = re.compile(r"[0-9a-f]{64}")
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


def need(value, code):
    if not value:
        raise ValueError(code)


def name(value):
    need(isinstance(value, str) and 0 < len(value) <= 1024
         and "\\" not in value and "\0" not in value
         and all(x and x not in (".", "..") for x in value.split("/")),
         "LOCAL_PACKAGE_NAME_INVALID")
    return value


def private(path, create=False):
    path = Path(path).absolute()
    if create:
        path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.lstat()
    need(path.resolve() == path and stat.S_ISDIR(info.st_mode)
         and not info.st_mode & 0o077, "LOCAL_PACKAGE_PRIVATE_DIRECTORY_REQUIRED")
    return path


def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def read(path, limit=MAX_METADATA):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        need(stat.S_ISREG(info.st_mode) and not info.st_mode & 0o077
             and info.st_size <= limit, "LOCAL_PACKAGE_FILE_INVALID")
        data = stream.read(limit + 1)
        after = os.fstat(stream.fileno())
        need(len(data) == info.st_size and (info.st_size, info.st_mtime_ns, info.st_ctime_ns)
             == (after.st_size, after.st_mtime_ns, after.st_ctime_ns), "LOCAL_PACKAGE_FILE_CHANGED")
        return data


def fingerprint(path):
    path = Path(path).absolute()
    private(path.parent)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        need(stat.S_ISREG(info.st_mode) and not info.st_mode & 0o077
             and info.st_size <= MAX_TOTAL + MAX_METADATA, "LOCAL_PACKAGE_FILE_INVALID")
        result, total = hashlib.sha256(), 0
        while chunk := stream.read(CHUNK):
            result.update(chunk)
            total += len(chunk)
        after = os.fstat(stream.fileno())
        need(total == info.st_size and (info.st_size, info.st_mtime_ns, info.st_ctime_ns)
             == (after.st_size, after.st_mtime_ns, after.st_ctime_ns), "LOCAL_PACKAGE_FILE_CHANGED")
        return {"bytes": total, "sha256": result.hexdigest()}


def parse(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            need(key not in result, "LOCAL_PACKAGE_DUPLICATE_JSON_KEY")
            result[key] = value
        return result
    return json.loads(raw.decode("utf-8"), object_pairs_hook=unique,
                      parse_constant=lambda _: need(False, "LOCAL_PACKAGE_JSON_INVALID"))


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, indent=2) + "\n").encode()


def manifest(raw):
    result = parse(raw)
    need(result.get("schema") == SCHEMA and UUID.fullmatch(result.get("requestId", ""))
         and UUID.fullmatch(result.get("deliveryId", ""))
         and UUID.fullmatch(result.get("workspaceId", ""))
         and re.fullmatch(r"[0-9a-f]{32}", result.get("customerWorkspaceId", ""))
         and isinstance(result.get("files"), list) and len(result["files"]) <= 25000,
         "LOCAL_PACKAGE_MANIFEST_INVALID")
    files, total = {}, 0
    for item in result["files"]:
        filename = name(item.get("name"))
        need(filename not in files and filename != "manifest.json"
             and type(item.get("bytes")) is int and 0 <= item["bytes"] <= MAX_FILE
             and HEX.fullmatch(item.get("sha256", "")), "LOCAL_PACKAGE_MANIFEST_FILE_INVALID")
        total += item["bytes"]
        need(total <= MAX_TOTAL, "LOCAL_PACKAGE_TOTAL_LIMIT")
        files[filename] = {"bytes": item["bytes"], "sha256": item["sha256"]}
    need(result.get("totalBytes") == total
         and name(result.get("warehouse")) + "/warehouse.duckdb" in files
         and name(result.get("warehouse")) + "/handoff.json" in files
         and name(result.get("upstreamSource")) in files, "LOCAL_PACKAGE_COMPLETE_HANDOFF_REQUIRED")
    return result, files


def reconcile_links(path, prefix):
    """Collect only this publisher's already-committed temporary inode links."""
    path = Path(path)
    info = path.lstat()
    need(stat.S_ISREG(info.st_mode) and not info.st_mode & 0o077, "LOCAL_PACKAGE_FILE_INVALID")
    if info.st_nlink > 1:
        for temporary in path.parent.glob(prefix + "*"):
            candidate = temporary.lstat()
            if stat.S_ISREG(candidate.st_mode) and (candidate.st_dev, candidate.st_ino) == (info.st_dev, info.st_ino):
                temporary.unlink()
        sync(path.parent)
    need(path.lstat().st_nlink == 1, "LOCAL_PACKAGE_EXTERNAL_HARDLINK")


def publish_directory(stage, destination):
    """Linux no-replace directory publication; never replace another receiving root."""
    library = ctypes.CDLL(None, use_errno=True)
    rename = getattr(library, "renameat2", None)
    need(rename is not None, "LOCAL_PACKAGE_LINUX_RENAME_REQUIRED")
    rename.argtypes = (ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint)
    rename.restype = ctypes.c_int
    if rename(-100, os.fsencode(stage), -100, os.fsencode(destination), 1) != 0:
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code), str(destination))
    sync(destination.parent)


def retain_json(path, value):
    raw = encoded(value)
    if path.exists():
        reconcile_links(path, ".local-record-")
        need(read(path) == raw, "LOCAL_PACKAGE_RETAINED_RECORD_CHANGED")
        return
    fd, temp = tempfile.mkstemp(prefix=".local-record-", dir=path.parent)
    temp = Path(temp)
    try:
        with os.fdopen(fd, "wb") as out:
            out.write(raw)
            out.flush()
            os.fsync(out.fileno())
        try:
            os.link(temp, path)
        except FileExistsError:
            need(read(path) == raw, "LOCAL_PACKAGE_RETAINED_RECORD_CHANGED")
        sync(path.parent)
    finally:
        temp.unlink(missing_ok=True)
        sync(path.parent)


def verify_files(directory, files):
    for filename, expected in files.items():
        selected = directory / filename
        private(selected.parent)
        need(fingerprint(selected) == expected, "LOCAL_PACKAGE_FILE_DIGEST_CHANGED")


def build(directory, output):
    directory = private(directory)
    output = Path(output).absolute()
    private(output.parent)
    raw = read(directory / "manifest.json")
    selected, files = manifest(raw)
    declared = {"manifest.json": {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}, **files}
    if output.exists():
        reconcile_links(output, ".local-package-")
        # An earlier completed archive is reused only after validating its complete contents.
        inspect_zip(output, declared)
        return {"file": str(output), **fingerprint(output), "manifestSha256": hashlib.sha256(raw).hexdigest()}
    fd, path = tempfile.mkstemp(prefix=".local-package-", dir=output.parent)
    temporary = Path(path)
    try:
        with os.fdopen(fd, "wb") as sink, zipfile.ZipFile(sink, "w", compression=zipfile.ZIP_DEFLATED,
                                                       compresslevel=6, allowZip64=True) as archive:
            for filename, expected in declared.items():
                source = directory / filename
                private(source.parent)
                source_fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
                with os.fdopen(source_fd, "rb") as original:
                    before = os.fstat(original.fileno())
                    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1
                         and not before.st_mode & 0o077 and before.st_size == expected["bytes"],
                         "LOCAL_PACKAGE_SOURCE_CHANGED")
                    item = zipfile.ZipInfo(filename, (1980, 1, 1, 0, 0, 0))
                    item.compress_type = zipfile.ZIP_DEFLATED
                    item.external_attr = (stat.S_IFREG | 0o600) << 16
                    item.create_system = 3
                    digest, count = hashlib.sha256(), 0
                    with archive.open(item, "w", force_zip64=True) as destination:
                        while chunk := original.read(CHUNK):
                            digest.update(chunk)
                            count += len(chunk)
                            need(count <= expected["bytes"], "LOCAL_PACKAGE_SOURCE_CHANGED")
                            destination.write(chunk)
                    after = os.fstat(original.fileno())
                    need(count == expected["bytes"] and digest.hexdigest() == expected["sha256"]
                         and (before.st_size, before.st_mtime_ns, before.st_ctime_ns)
                         == (after.st_size, after.st_mtime_ns, after.st_ctime_ns),
                         "LOCAL_PACKAGE_SOURCE_CHANGED")
        fd = os.open(temporary, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
        need(fingerprint(temporary)["bytes"] <= MAX_FILE, "LOCAL_PACKAGE_ARCHIVE_SIZE_LIMIT")
        try:
            os.link(temporary, output)
        except FileExistsError:
            need(fingerprint(output) == fingerprint(temporary), "LOCAL_PACKAGE_ARCHIVE_CONFLICT")
        sync(output.parent)
        temporary.unlink()
        sync(output.parent)
        return {"file": str(output), **fingerprint(output),
                "manifestSha256": hashlib.sha256(raw).hexdigest(), "files": len(declared)}
    finally:
        temporary.unlink(missing_ok=True)


def inspect_zip(path, declared=None):
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), "rb") as original, zipfile.ZipFile(original, "r") as archive:
        before = os.fstat(original.fileno())
        need(stat.S_ISREG(before.st_mode) and not before.st_mode & 0o077, "LOCAL_PACKAGE_ARCHIVE_INVALID")
        entries = archive.infolist()
        need(len(entries) <= 25001, "LOCAL_PACKAGE_MEMBER_LIMIT")
        names, total = set(), 0
        for item in entries:
            filename = name(item.filename)
            mode = item.external_attr >> 16
            need(filename not in names and not item.is_dir() and not item.flag_bits & 1
                 and (stat.S_IFMT(mode) in (0, stat.S_IFREG))
                 and item.file_size <= MAX_FILE, "LOCAL_PACKAGE_MEMBER_INVALID")
            names.add(filename)
            total += item.file_size
            need(total <= MAX_TOTAL + MAX_METADATA, "LOCAL_PACKAGE_TOTAL_LIMIT")
        info = archive.getinfo("manifest.json")
        need(info.file_size <= MAX_METADATA, "LOCAL_PACKAGE_MANIFEST_LIMIT")
        raw = archive.read(info)
        selected, files = manifest(raw)
        actual_declared = {"manifest.json": {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}, **files}
        need(names == set(actual_declared), "LOCAL_PACKAGE_MEMBERS_CHANGED")
        if declared is not None:
            need(actual_declared == declared, "LOCAL_PACKAGE_ARCHIVE_CONFLICT")
        for filename, expected in actual_declared.items():
            item = archive.getinfo(filename)
            need(item.file_size == expected["bytes"], "LOCAL_PACKAGE_MEMBER_SIZE_CHANGED")
            digest, count = hashlib.sha256(), 0
            with archive.open(item) as stream:
                while chunk := stream.read(CHUNK):
                    digest.update(chunk)
                    count += len(chunk)
                    need(count <= expected["bytes"], "LOCAL_PACKAGE_MEMBER_SIZE_CHANGED")
            need(count == expected["bytes"] and digest.hexdigest() == expected["sha256"],
                 "LOCAL_PACKAGE_MEMBER_DIGEST_CHANGED")
        after = os.fstat(original.fileno())
        need((before.st_size, before.st_mtime_ns, before.st_ctime_ns) == (after.st_size, after.st_mtime_ns, after.st_ctime_ns), "LOCAL_PACKAGE_ARCHIVE_CHANGED")
        return selected, actual_declared


def receive(archive_file, expected, output, request_id):
    need(HEX.fullmatch(expected or "") and UUID.fullmatch(request_id or ""), "LOCAL_PACKAGE_RECEIVE_BINDING_REQUIRED")
    output = Path(output).absolute()
    parent = private(output.parent)
    need(output.resolve() == output, "LOCAL_PACKAGE_OUTPUT_PATH_CHANGED")
    lock_path = parent / (".local-receive-target-" + hashlib.sha256(os.fsencode(output)).hexdigest() + ".lock")
    lock_fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        lock_info = os.fstat(lock_fd)
        need(stat.S_ISREG(lock_info.st_mode) and lock_info.st_nlink == 1 and not lock_info.st_mode & 0o077,
             "LOCAL_PACKAGE_PRIVATE_LOCK_REQUIRED")
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        receipt = output / "receiving.json"
        if receipt.exists():
            private(output)
            result = parse(read(receipt))
            need(result["requestId"] == request_id and result["archiveSha256"] == expected
                 and result["directory"] == str(output), "LOCAL_PACKAGE_RECEIVE_BINDING_CHANGED")
            selected, files = manifest(read(output / "manifest.json"))
            verify_files(output, files)
            need(hashlib.sha256(read(output / "manifest.json")).hexdigest() == result["manifestSha256"],
                 "LOCAL_PACKAGE_MANIFEST_CHANGED")
            sync(parent)
            return {**result, "reused": True}
        stage = parent / (".local-receive-" + request_id)
        staged_receipt = stage / "receiving.json"
        if staged_receipt.exists():
            private(stage)
            result = parse(read(staged_receipt))
            need(result["requestId"] == request_id and result["archiveSha256"] == expected
                 and result["directory"] == str(output), "LOCAL_PACKAGE_RECEIVE_BINDING_CHANGED")
            selected, files = manifest(read(stage / "manifest.json"))
            verify_files(stage, files)
            need(hashlib.sha256(read(stage / "manifest.json")).hexdigest() == result["manifestSha256"],
                 "LOCAL_PACKAGE_MANIFEST_CHANGED")
            publish_directory(stage, output)
            return {**result, "reused": True}
        actual = fingerprint(archive_file)
        need(actual["sha256"] == expected, "LOCAL_PACKAGE_ARCHIVE_DIGEST_CHANGED")
        selected, files = inspect_zip(archive_file)
        stage = parent / (".local-receive-" + request_id)
        private(stage, create=True)
        binding = {"requestId": request_id, "archiveSha256": expected, "directory": str(output)}
        retain_json(stage / "receiving-request.json", binding)
        with os.fdopen(os.open(archive_file, os.O_RDONLY | os.O_NOFOLLOW), "rb") as original, zipfile.ZipFile(original, "r") as archive:
            for filename, expected_file in files.items():
                path = stage / filename
                private(path.parent, create=True)
                if path.exists():
                    need(fingerprint(path) == expected_file, "LOCAL_PACKAGE_RECEIVED_FILE_CHANGED")
                    continue
                temporary = path.with_name("." + path.name + ".receiving")
                fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
                try:
                    with os.fdopen(fd, "wb") as target, archive.open(filename) as source:
                        count, digest = 0, hashlib.sha256()
                        while chunk := source.read(CHUNK):
                            count += len(chunk)
                            digest.update(chunk)
                            need(count <= expected_file["bytes"], "LOCAL_PACKAGE_MEMBER_SIZE_CHANGED")
                            if chunk.count(0) == len(chunk):
                                target.seek(len(chunk), os.SEEK_CUR)
                            else:
                                target.write(chunk)
                        need(count == expected_file["bytes"] and digest.hexdigest() == expected_file["sha256"],
                             "LOCAL_PACKAGE_MEMBER_DIGEST_CHANGED")
                        target.truncate(count)
                        target.flush()
                        os.fsync(target.fileno())
                    os.replace(temporary, path)
                    sync(path.parent)
                finally:
                    temporary.unlink(missing_ok=True)
        verify_files(stage, files)
        need(fingerprint(archive_file) == actual, "LOCAL_PACKAGE_ARCHIVE_CHANGED")
        result = {"schema": "stellar-forge.local-dataset-customer-receiving.v1", **binding,
                  "manifestSha256": files["manifest.json"]["sha256"],
                  "deliveryId": selected["deliveryId"], "sourceWorkspaceId": selected["workspaceId"],
                  "customerWorkspaceId": selected["customerWorkspaceId"], "files": len(files),
                  "warehouseDirectory": str(output / selected["warehouse"]),
                  "sourceArchive": str(output / selected["upstreamSource"]),
                  "complete": True, "reused": False,
                  "reopen": "Make a distinct working copy of warehouseDirectory before opening the original DuckDBWorkspace; keep this verified receiving directory immutable."}
        retain_json(stage / "receiving.json", result)
        need(not output.exists(), "LOCAL_PACKAGE_OUTPUT_EXISTS")
        publish_directory(stage, output)
        return result
    finally:
        os.close(lock_fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    built = commands.add_parser("build")
    built.add_argument("--directory", required=True)
    built.add_argument("--output", required=True)
    received = commands.add_parser("receive")
    received.add_argument("--archive", required=True)
    received.add_argument("--sha256", required=True)
    received.add_argument("--output", required=True)
    received.add_argument("--request-id", required=True)
    args = parser.parse_args()
    os.umask(0o077)
    result = build(args.directory, args.output) if args.command == "build" else receive(
        args.archive, args.sha256, args.output, args.request_id)
    print(json.dumps(result, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
