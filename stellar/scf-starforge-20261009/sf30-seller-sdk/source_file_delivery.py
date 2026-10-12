"""Lossless source-file restoration from the original SF88 dataset delivery.

Providers supply manifest and release validators. Original DatasetDelivery owns
page, recovery, accounting and transport state; this module reconstructs bytes.
"""
from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass
import hashlib
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import tempfile
from typing import Callable, ClassVar

CHUNK_BYTES = 49_152
COMMON_FIELDS = frozenset({
    "capture_id", "path", "file_sha256", "file_bytes", "chunk_index",
    "chunk_count", "chunk_sha256", "content_base64",
})
_SHA256 = re.compile(r"[0-9a-f]{64}\Z")


class SourceFileDeliveryError(ValueError):
    def __init__(self, code: str, **details):
        self.code, self.details = code, details
        super().__init__(code)


@dataclass(frozen=True)
class SourceFileContract:
    manifest_path: str
    manifest_schema: str
    prefix: str
    error_type: type
    required_fields: frozenset
    row_identity: Callable
    validate_manifest: Callable
    staging_prefix: str = ".source-receive-"

    def fail(self, code, **details):
        raise self.error_type(self.prefix + "_" + code, **details)

    def name(self, value) -> str:
        if (not isinstance(value, str) or not value or "\\" in value
                or "\x00" in value or PurePosixPath(value).is_absolute()
                or any(part in ("", ".", "..") for part in value.split("/"))):
            self.fail("SOURCE_PATH_INVALID")
        return value

    def sha(self, value, field) -> str:
        if not isinstance(value, str) or not _SHA256.fullmatch(value):
            self.fail("SHA256_INVALID", field=field)
        return value

    def integer(self, value, field, minimum=0) -> int:
        if type(value) is not int or value < minimum:
            self.fail("INTEGER_INVALID", field=field)
        return value


def read_member(directory: Path, member: dict, contract: SourceFileContract, *, collect=False):
    """Check identity, permission, length and digest on the same opened file."""
    name = contract.name(member["path"])
    path = directory / name
    try:
        if path.resolve(strict=True) != path or directory not in path.parents:
            contract.fail("SOURCE_PATH_CHANGED", path=name)
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, "rb") as stream:
            info = os.fstat(stream.fileno())
            if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                    or info.st_mode & 0o077 or info.st_size != member["bytes"]):
                contract.fail("SOURCE_FILE_CHANGED", path=name)
            digest, size = hashlib.sha256(), 0
            chunks = [] if collect else None
            while raw := stream.read(1_048_576):
                size += len(raw)
                digest.update(raw)
                if collect:
                    chunks.append(raw)
        if size != member["bytes"] or digest.hexdigest() != member["sha256"]:
            contract.fail("SOURCE_FILE_CHANGED", path=name)
        return b"".join(chunks) if collect else None
    except OSError:
        contract.fail("SOURCE_FILE_UNAVAILABLE", path=name)


@dataclass(frozen=True)
class SourceFiles:
    directory: Path
    capture_id: str
    manifest: dict
    native_status: str
    payment_status: str
    acquired_rows: int
    reopened: bool
    contract: ClassVar[SourceFileContract]

    def member(self, name: str) -> dict:
        name = self.contract.name(name)
        for item in self.manifest["files"]:
            if item["path"] == name:
                return dict(item)
        self.contract.fail("SOURCE_MEMBER_UNDECLARED", path=name)

    def read_file(self, name: str) -> bytes:
        return read_member(self.directory, self.member(name), self.contract, collect=True)

    def source_path(self, name: str) -> Path:
        read_member(self.directory, self.member(name), self.contract)
        return self.directory / name


def _row(row, contract):
    if not isinstance(row, dict) or not contract.required_fields <= row.keys():
        contract.fail("SOURCE_FILES_PROJECTION_REQUIRED")
    identity = contract.row_identity(row, contract)
    capture_id = contract.sha(row["capture_id"], "capture_id")
    name = contract.name(row["path"])
    size = contract.integer(row["file_bytes"], "file_bytes")
    count = contract.integer(row["chunk_count"], "chunk_count", 1)
    index = contract.integer(row["chunk_index"], "chunk_index")
    if count != max(1, (size + CHUNK_BYTES - 1) // CHUNK_BYTES) or index >= count:
        contract.fail("CHUNK_GEOMETRY_INVALID", path=name)
    encoded = row["content_base64"]
    if not isinstance(encoded, str) or len(encoded) > 65_536:
        contract.fail("CHUNK_ENCODING_INVALID", path=name)
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, UnicodeError, binascii.Error):
        contract.fail("CHUNK_ENCODING_INVALID", path=name)
    if (len(raw) != min(CHUNK_BYTES, size - index * CHUNK_BYTES)
            or base64.b64encode(raw).decode("ascii") != encoded):
        contract.fail("CHUNK_SIZE_INVALID", path=name)
    if hashlib.sha256(raw).hexdigest() != contract.sha(row["chunk_sha256"], "chunk_sha256"):
        contract.fail("CHUNK_HASH_MISMATCH", path=name, chunk=index)
    item = {"path": name, "bytes": size,
            "sha256": contract.sha(row["file_sha256"], "file_sha256"), "chunks": count}
    return (capture_id, identity), item, index, raw


def _manifest(raw, identity, restored, contract):
    from stellar_forge_buyer.storage import parse

    if hashlib.sha256(raw).hexdigest() != identity[0]:
        contract.fail("CAPTURE_ID_MISMATCH")
    value = parse(raw)
    if not isinstance(value, dict) or value.get("schema") != contract.manifest_schema:
        contract.fail("CAPTURE_MANIFEST_INVALID")
    members = value.get("files")
    if not isinstance(members, list) or not members:
        contract.fail("CAPTURE_FILES_INVALID")
    expected = {}
    for item in members:
        if not isinstance(item, dict):
            contract.fail("CAPTURE_FILES_INVALID")
        name = contract.name(item.get("path"))
        if name == contract.manifest_path or name in expected:
            contract.fail("CAPTURE_DUPLICATE_PATH", path=name)
        expected[name] = {
            "path": name, "bytes": contract.integer(item.get("bytes"), "bytes"),
            "sha256": contract.sha(item.get("sha256"), "sha256")}
    actual_names = set(restored) - {contract.manifest_path}
    if set(expected) != actual_names:
        contract.fail("CAPTURE_FILE_INVENTORY_MISMATCH",
            missing=sorted(set(expected) - actual_names),
            unexpected=sorted(actual_names - set(expected)))
    for name, item in expected.items():
        actual = restored[name]["item"]
        if any(actual[field] != item[field] for field in ("path", "bytes", "sha256")):
            contract.fail("CAPTURE_FILE_METADATA_MISMATCH", path=name)
    contract.validate_manifest(value, identity[1], expected, contract)
    return value


def restore_file_projection(delivery, destination, *, result_type,
                            expected_capture_id=None, check_identity=None):
    """Restore one complete acquired inventory and reopen matching output.

    Chunks for a file arrive in ascending order; different files may interleave.
    The manifest must enumerate every acquired member except itself.
    """
    from stellar_forge_buyer.storage import private_directory, sync_directory

    contract = result_type.contract
    if expected_capture_id is not None:
        contract.sha(expected_capture_id, "expected_capture_id")
    native = delivery.native
    if not isinstance(native, dict) or native.get("schema") != "stellar-forge.sf88.dataset-delivery.v1":
        raise contract.error_type("ORIGINAL_SF88_DATASET_DELIVERY_REQUIRED")
    output = Path(os.path.abspath(Path(destination).expanduser()))
    parent = private_directory(output.parent)
    if parent != output.parent:
        contract.fail("OUTPUT_CANONICAL_PATH_REQUIRED")
    staging = Path(tempfile.mkdtemp(prefix=contract.staging_prefix, dir=parent))
    states, identity, row_count = {}, None, 0
    try:
        for row in delivery.jsonl_rows():
            row_identity, item, index, raw = _row(row, contract)
            if identity is None:
                identity = row_identity
                if expected_capture_id is not None and identity[0] != expected_capture_id:
                    contract.fail("CAPTURE_ID_MISMATCH")
                if check_identity:
                    check_identity(identity[1])
            elif row_identity != identity:
                contract.fail("CAPTURE_MIXED_IDENTITIES")
            name = item["path"]
            state = states.get(name)
            if state is None:
                state = {"item": item, "next": 0, "bytes": 0, "digest": hashlib.sha256()}
                states[name] = state
            if state["item"] != item or index != state["next"]:
                contract.fail("CHUNK_ORDER_OR_METADATA_MISMATCH", path=name, chunk=index)
            target = staging / name
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            flags = os.O_WRONLY | os.O_NOFOLLOW
            flags |= os.O_CREAT | os.O_EXCL if index == 0 else os.O_APPEND
            try:
                fd = os.open(target, flags, 0o600)
                with os.fdopen(fd, "wb") as stream:
                    stream.write(raw)
                    stream.flush()
                    if index + 1 == item["chunks"]:
                        os.fsync(stream.fileno())
            except OSError:
                contract.fail("OUTPUT_FILE_FAILED", path=name)
            state["digest"].update(raw)
            state["bytes"] += len(raw)
            state["next"] += 1
            row_count += 1
        if identity is None or contract.manifest_path not in states:
            contract.fail("CAPTURE_MANIFEST_MISSING")
        for name, state in states.items():
            item = state["item"]
            if (state["next"] != item["chunks"] or state["bytes"] != item["bytes"]
                    or state["digest"].hexdigest() != item["sha256"]):
                contract.fail("SOURCE_FILE_INCOMPLETE", path=name)
        manifest_item = states[contract.manifest_path]["item"]
        manifest_raw = read_member(staging, manifest_item, contract, collect=True)
        manifest = _manifest(manifest_raw, identity, states, contract)
        reopened = output.exists() or output.is_symlink()
        if reopened:
            if private_directory(output, create=False) != output:
                contract.fail("OUTPUT_CANONICAL_PATH_REQUIRED")
            if read_member(output, manifest_item, contract, collect=True) != manifest_raw:
                contract.fail("OUTPUT_CAPTURE_CONFLICT")
            for item in manifest["files"]:
                read_member(output, item, contract)
        else:
            os.rename(staging, output)
            staging = None
            sync_directory(parent)
        return result_type(
            directory=output, capture_id=identity[0], manifest=manifest,
            native_status=delivery.status, payment_status=delivery.payment_status,
            acquired_rows=row_count, reopened=reopened)
    finally:
        if staging is not None:
            shutil.rmtree(staging)

