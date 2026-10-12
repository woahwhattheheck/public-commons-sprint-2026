#!/usr/bin/env python3
"""Streaming source archives shared by the original Cloud and SF49 receivers.

Extracted from duckdb/cloud-delivery/native.py (ca718b77e409136be6ccb94a7c134988d2f22233).
The caller supplies its own schema and limits; source bytes and their inventories
keep their original identity. Only the Python standard library is required.
"""
from __future__ import annotations
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import zipfile
import zlib

CHUNK = 1024 * 1024


class ArchiveFault(Exception):
    def __init__(self, code, message=None):
        super().__init__(message or code)
        self.code, self.message = code, message or code


class ArchivePolicy:
    def __init__(self, schema, *, max_expanded_bytes, max_members=20000,
                 max_manifest_bytes=32 * CHUNK, max_file_bytes=None, receipt_name="received-handover.json",
                 prefix="SOURCE_ARCHIVE", error_type=ArchiveFault):
        if not isinstance(schema, str) or not schema or not re.fullmatch(r"[A-Z][A-Z0-9_]*", prefix):
            raise ValueError("An explicit archive schema and error prefix are required")
        for value in (max_expanded_bytes, max_members, max_manifest_bytes):
            if type(value) is not int or value < 1:
                raise ValueError("Positive archive limits are required")
        if receipt_name is not None and (not isinstance(receipt_name, str) or
                not receipt_name or "/" in receipt_name or "\\" in receipt_name or
                receipt_name in (".", "..") or "\x00" in receipt_name):
            raise ValueError("Use a receipt basename")
        self.schema = schema
        if max_file_bytes is not None and (type(max_file_bytes) is not int or max_file_bytes < 1):
            raise ValueError("A positive per-file limit is required")
        self.max_file_bytes = max_expanded_bytes if max_file_bytes is None else max_file_bytes
        self.max_expanded_bytes = max_expanded_bytes
        self.max_archive_bytes = max_expanded_bytes + 16 * CHUNK
        self.max_members = max_members
        self.max_manifest_bytes = max_manifest_bytes
        self.receipt_name = receipt_name
        self.prefix, self.error_type = prefix, error_type

    def fail(self, code, message=None):
        raise self.error_type(self.prefix + "_" + code, message)


def encoded(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False,
                      separators=(",", ":"), sort_keys=True)


def _json(raw, policy):
    def pairs(values):
        result = {}
        for key, value in values:
            if key in result:
                policy.fail("HANDOVER_MANIFEST_INVALID")
            result[key] = value
        return result
    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=pairs,
                          parse_constant=lambda _v: policy.fail("HANDOVER_MANIFEST_INVALID"))
    except (ValueError, UnicodeError):
        policy.fail("HANDOVER_MANIFEST_INVALID")


def _relative(name, policy):
    if not isinstance(name, str) or not name or name.startswith("/") or "\\" in name or "\x00" in name or any(
            part in ("", ".", "..") for part in name.split("/")):
        policy.fail("HANDOVER_PATH_INVALID")
    if name.split("/")[0].startswith(".source-archive-"):
        policy.fail("HANDOVER_PATH_INVALID")
    return name


def _path(root, name, policy):
    target = root / _relative(name, policy)
    if target.resolve() != target or not target.is_relative_to(root):
        policy.fail("HANDOVER_PATH_INVALID")
    return target


def _directory(value, policy, *, create=False):
    root = Path(value)
    if not root.is_absolute() or root.resolve() != root:
        policy.fail("HANDOVER_PATH_INVALID")
    if create:
        root.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = root.lstat()
    if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode):
        policy.fail("HANDOVER_PATH_INVALID")
    return root


def _sync(root):
    fd = os.open(root, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def file_hash(value, policy, *, maximum=None):
    path = Path(value)
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        before = os.fstat(fd)
        maximum = policy.max_expanded_bytes if maximum is None else maximum
        if not stat.S_ISREG(before.st_mode) or before.st_size > maximum:
            policy.fail("REGULAR_FILE_REQUIRED")
        checksum, size = hashlib.sha256(), 0
        with os.fdopen(fd, "rb", closefd=False) as handle:
            for chunk in iter(lambda: handle.read(CHUNK), b""):
                size += len(chunk)
                if size > maximum or size > before.st_size:
                    policy.fail("ORIGINAL_FILE_CHANGED")
                checksum.update(chunk)
        after = os.fstat(fd)
        current = path.lstat()
        fields = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
        if size != before.st_size or any(getattr(before, key) != getattr(after, key) for key in fields) or (
                current.st_dev, current.st_ino) != (before.st_dev, before.st_ino) or stat.S_ISLNK(current.st_mode):
            policy.fail("ORIGINAL_FILE_CHANGED")
        return {"bytes": str(size), "sha256": checksum.hexdigest()}
    finally:
        os.close(fd)


def _pin(file, policy):
    if not isinstance(file, dict):
        policy.fail("HANDOVER_INVENTORY_MISMATCH")
    _relative(file.get("path"), policy)
    size, digest = file.get("bytes"), file.get("sha256")
    if not isinstance(size, str) or not re.fullmatch(r"0|[1-9][0-9]{0,15}", size) or (
            int(size) > policy.max_file_bytes) or not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest):
        policy.fail("HANDOVER_FILE_INVALID")
    return {"bytes": size, "sha256": digest}


def _manifest(manifest, policy):
    if not isinstance(manifest, dict) or manifest.get("schema") != policy.schema:
        policy.fail("HANDOVER_SCHEMA_INVALID")
    raw = (encoded(manifest) + "\n").encode("utf-8")
    if len(raw) > policy.max_manifest_bytes:
        policy.fail("HANDOVER_MANIFEST_INVALID")
    files = manifest.get("files")
    if not isinstance(files, list) or len(files) + 1 > policy.max_members:
        policy.fail("HANDOVER_INVENTORY_MISMATCH")
    names, total = set(), len(raw)
    for file in files:
        pin = _pin(file, policy)
        name = file["path"]
        if name in names or (policy.receipt_name is not None and name == policy.receipt_name):
            policy.fail("HANDOVER_INVENTORY_MISMATCH")
        names.add(name)
        total += int(pin["bytes"])
        if total > policy.max_expanded_bytes:
            policy.fail("HANDOVER_SIZE_LIMIT")
    return files, raw


@contextmanager
def _owner(root, name, policy):
    key = hashlib.sha256(name.encode("utf-8")).hexdigest()
    path = root / (".source-archive-" + key + ".sqlite")
    fd = os.open(path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_mode & 0o077:
            policy.fail("HANDOVER_PATH_INVALID")
    finally:
        os.close(fd)
    owner = sqlite3.connect(path, timeout=0)
    try:
        try:
            owner.execute("BEGIN EXCLUSIVE")
        except sqlite3.OperationalError as error:
            if (getattr(error, "sqlite_errorcode", 0) & 0xff) not in (sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED):
                raise
            raise policy.error_type(policy.prefix + "_HANDOVER_ALREADY_RUNNING",
                                    "The original archive destination has an active writer.") from error
        yield
    finally:
        owner.close()


def _stage(path, digest, *, root=None):
    # A source filename must never be mistaken for one of our recovery files.
    # Extraction supplies its root so even nested source paths use the reserved
    # top-level namespace, which _relative() excludes from every inventory.
    root = path.parent if root is None else root
    identity = str(path.relative_to(root)).encode("utf-8") + b"\x00" + digest.encode("ascii")
    return root / (".source-archive-stage-" + hashlib.sha256(identity).hexdigest() + ".partial")


def _remove_stage(path, policy):
    try:
        info = path.lstat()
    except FileNotFoundError:
        return
    if not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode):
        policy.fail("HANDOVER_PATH_INVALID")
    path.unlink()


def _publish(path, temporary, pin, policy):
    try:
        os.link(temporary, path, follow_symlinks=False)
    except FileExistsError:
        if file_hash(path, policy, maximum=policy.max_archive_bytes) != pin:
            policy.fail("RECEIVED_FILE_CONFLICT")
    _sync(path.parent)
    temporary.unlink(missing_ok=True)
    if temporary.parent != path.parent:
        _sync(temporary.parent)


def _retain_metadata(path, raw, policy):
    pin = {"bytes": str(len(raw)), "sha256": hashlib.sha256(raw).hexdigest()}
    if path.exists():
        if file_hash(path, policy, maximum=policy.max_manifest_bytes) != pin:
            policy.fail("HANDOVER_SNAPSHOT_CONFLICT")
        return
    temporary = _stage(path, pin["sha256"])
    if temporary.exists():
        try:
            ready = file_hash(temporary, policy, maximum=policy.max_manifest_bytes) == pin
        except policy.error_type:
            ready = False
        if ready:
            _publish(path, temporary, pin, policy)
            return
        _remove_stage(temporary, policy)
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        with os.fdopen(fd, "wb", closefd=False) as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        _publish(path, temporary, pin, policy)
    finally:
        os.close(fd)


def _read_zip(bundle, policy, expected=None):
    members = bundle.infolist()
    if len(members) > policy.max_members or sum(item.file_size for item in members) > policy.max_expanded_bytes:
        policy.fail("HANDOVER_SIZE_LIMIT")
    names = [item.filename for item in members]
    if len(set(names)) != len(names) or "handover.json" not in names or (
            bundle.getinfo("handover.json").file_size > policy.max_manifest_bytes):
        policy.fail("HANDOVER_MANIFEST_INVALID")
    for item in members:
        kind = (item.external_attr >> 16) & 0o170000
        if kind not in (0, stat.S_IFREG) or item.flag_bits & 1 or (
                item.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)):
            policy.fail("HANDOVER_FILE_INVALID")
    manifest = _json(bundle.read("handover.json"), policy)
    files, raw = _manifest(manifest, policy)
    if expected is not None and encoded(manifest) != encoded(expected):
        policy.fail("HANDOVER_SNAPSHOT_CONFLICT")
    if set(names) != {"handover.json"} | {"files/" + file["path"] for file in files}:
        policy.fail("HANDOVER_INVENTORY_MISMATCH")
    for file in files:
        if str(bundle.getinfo("files/" + file["path"]).file_size) != file["bytes"]:
            policy.fail("HANDOVER_FILE_SIZE_MISMATCH")
    return manifest, files, raw


def _verify_member(bundle, file, policy):
    checksum, size = hashlib.sha256(), 0
    with bundle.open("files/" + file["path"]) as member:
        for chunk in iter(lambda: member.read(CHUNK), b""):
            checksum.update(chunk)
            size += len(chunk)
            if size > int(file["bytes"]):
                policy.fail("HANDOVER_FILE_SIZE_MISMATCH")
    if str(size) != file["bytes"] or checksum.hexdigest() != file["sha256"]:
        policy.fail("HANDOVER_FILE_DIGEST_MISMATCH")


def _verify_zip(path, policy, expected=None):
    before = file_hash(path, policy, maximum=policy.max_archive_bytes)
    with zipfile.ZipFile(path) as bundle:
        manifest, files, _raw = _read_zip(bundle, policy, expected)
        for file in files:
            _verify_member(bundle, file, policy)
    if before != file_hash(path, policy, maximum=policy.max_archive_bytes):
        policy.fail("HANDOVER_SOURCE_CHANGED")
    return {"archive": before, "members": len(files) + 1}, manifest


def inspect(input, *, policy):
    result, manifest = _verify_zip(Path(input["archive"]), policy)
    return {**result, "manifest": manifest}


def archive(input, *, policy):
    manifest = input["manifest"]
    files, raw = _manifest(manifest, policy)
    if encoded(files) != encoded(input["inventory"]):
        policy.fail("HANDOVER_INVENTORY_MISMATCH")
    output = Path(input["destination"])
    root = _directory(output.parent, policy)
    if output.resolve() != output:
        policy.fail("HANDOVER_PATH_INVALID")
    key = hashlib.sha256(raw).hexdigest()
    with _owner(root, output.name, policy):
        _retain_metadata(root / (".source-archive-" + hashlib.sha256(output.name.encode()).hexdigest() + ".request.json"),
                         (encoded({"manifestSha256": key, "schema": policy.schema}) + "\n").encode(), policy)
        if output.exists():
            result, _manifest_value = _verify_zip(output, policy, manifest)
            return {**result, "reused": True}
        temporary = _stage(output, key)
        if temporary.exists():
            try:
                result, _manifest_value = _verify_zip(temporary, policy, manifest)
            except (policy.error_type, zipfile.BadZipFile, EOFError, RuntimeError, zlib.error):
                _remove_stage(temporary, policy)
            else:
                _publish(output, temporary, result["archive"], policy)
                return {**result, "reused": True, "reconciled": True}
        source = _directory(input["source"], policy)
        fd = os.open(temporary, os.O_RDWR | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
        try:
            with os.fdopen(fd, "w+b", closefd=False) as stream:
                with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
                    bundle.writestr("handover.json", raw)
                    for file in files:
                        original_path = _path(source, file["path"], policy)
                        before = file_hash(original_path, policy)
                        if before != _pin(file, policy):
                            policy.fail("HANDOVER_SOURCE_CHANGED")
                        checksum, size = hashlib.sha256(), 0
                        input_fd = os.open(original_path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
                        try:
                            with os.fdopen(input_fd, "rb", closefd=False) as original, bundle.open(
                                    "files/" + file["path"], "w", force_zip64=True) as target:
                                for chunk in iter(lambda: original.read(CHUNK), b""):
                                    size += len(chunk)
                                    if size > int(file["bytes"]):
                                        policy.fail("HANDOVER_SOURCE_CHANGED")
                                    checksum.update(chunk)
                                    target.write(chunk)
                        finally:
                            os.close(input_fd)
                        if str(size) != file["bytes"] or checksum.hexdigest() != file["sha256"] or file_hash(original_path, policy) != before:
                            policy.fail("HANDOVER_SOURCE_CHANGED")
                stream.flush()
                os.fsync(stream.fileno())
            pin = file_hash(temporary, policy, maximum=policy.max_archive_bytes)
            _publish(output, temporary, pin, policy)
            return {"archive": pin, "members": len(files) + 1}
        except BaseException:
            # This exact manifest-bound stage belongs to the held destination
            # lease. Process death leaves it for the same request to reconcile.
            _remove_stage(temporary, policy)
            raise
        finally:
            os.close(fd)


def extract(input, *, policy):
    source = Path(input["archive"])
    before = file_hash(source, policy, maximum=policy.max_archive_bytes)
    destination = _directory(input["destination"], policy, create=True)
    with _owner(destination, "extract", policy):
        with zipfile.ZipFile(source) as bundle:
            manifest, files, raw = _read_zip(bundle, policy)
            _retain_metadata(destination / ".source-archive-request.json",
                             (encoded({"archive": before, "manifestSha256": hashlib.sha256(raw).hexdigest(),
                                       "schema": policy.schema}) + "\n").encode(), policy)
            receipt = destination / policy.receipt_name if policy.receipt_name is not None else None
            if receipt is not None and receipt.exists():
                if file_hash(receipt, policy, maximum=policy.max_manifest_bytes) != {
                        "bytes": str(len(raw)), "sha256": hashlib.sha256(raw).hexdigest()}:
                    policy.fail("HANDOVER_SNAPSHOT_CONFLICT")
            for file in files:
                target = _path(destination, file["path"], policy)
                target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                _path(destination, file["path"], policy)
                expected = _pin(file, policy)
                if target.exists():
                    # Reusing a correct output is not evidence that this ZIP
                    # carries those bytes. Read it through CRC and SHA checks.
                    _verify_member(bundle, file, policy)
                    if file_hash(target, policy) != expected:
                        policy.fail("RECEIVED_FILE_CONFLICT")
                    continue
                temporary = _stage(target, file["sha256"], root=destination)
                if temporary.exists():
                    try:
                        ready = file_hash(temporary, policy) == expected
                    except policy.error_type:
                        ready = False
                    if ready:
                        _verify_member(bundle, file, policy)
                        if file_hash(temporary, policy) != expected:
                            policy.fail("ORIGINAL_FILE_CHANGED")
                        _publish(target, temporary, expected, policy)
                        continue
                    _remove_stage(temporary, policy)
                fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
                try:
                    checksum, size = hashlib.sha256(), 0
                    with bundle.open("files/" + file["path"]) as original, os.fdopen(fd, "wb", closefd=False) as retained:
                        for chunk in iter(lambda: original.read(CHUNK), b""):
                            size += len(chunk)
                            if size > int(file["bytes"]):
                                policy.fail("HANDOVER_FILE_SIZE_MISMATCH")
                            checksum.update(chunk)
                            retained.write(chunk)
                        retained.flush()
                        os.fsync(retained.fileno())
                    if str(size) != file["bytes"] or checksum.hexdigest() != file["sha256"]:
                        policy.fail("HANDOVER_FILE_DIGEST_MISMATCH")
                    _publish(target, temporary, expected, policy)
                except BaseException:
                    _remove_stage(temporary, policy)
                    raise
                finally:
                    os.close(fd)
        if before != file_hash(source, policy, maximum=policy.max_archive_bytes):
            policy.fail("HANDOVER_SOURCE_CHANGED")
        if receipt is not None:
            _retain_metadata(receipt, raw, policy)
    return {"manifest": manifest, "archive": before}
