"""Restore Census source files from the original SF88 dataset delivery.

DatasetAcquisition retains acquisition, recovery, accounting and page state.
This consumer reads its verified DatasetDelivery.jsonl_rows() and restores the
source_files projection without creating requests or payment records.
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
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from stellar_forge_buyer.datasets import DatasetDelivery

MANIFEST_PATH = "_census/capture-manifest.json"
MANIFEST_SCHEMA = "stellar-forge.census-acs-capture.v1"
NATIVE_PACKAGE_PATH = "native-source-package.json"
CHUNK_BYTES = 49_152
_SHA256 = re.compile(r"[0-9a-f]{64}\Z")
_REQUIRED = {
    "release_year", "period_start", "period_end", "capture_id", "path",
    "file_sha256", "file_bytes", "chunk_index", "chunk_count",
    "chunk_sha256", "content_base64",
}


class CensusDeliveryError(ValueError):
    """A source-format or output conflict after original acquisition handling."""

    def __init__(self, code: str, **details):
        self.code, self.details = code, details
        super().__init__(code)


def _name(value) -> str:
    if (not isinstance(value, str) or not value or "\\" in value
            or "\x00" in value or PurePosixPath(value).is_absolute()
            or any(part in ("", ".", "..") for part in value.split("/"))):
        raise CensusDeliveryError("CENSUS_SOURCE_PATH_INVALID")
    return value


def _sha(value, field: str) -> str:
    if not isinstance(value, str) or not _SHA256.fullmatch(value):
        raise CensusDeliveryError("CENSUS_SHA256_INVALID", field=field)
    return value


def _integer(value, field: str, minimum=0) -> int:
    if type(value) is not int or value < minimum:
        raise CensusDeliveryError("CENSUS_INTEGER_INVALID", field=field)
    return value


def _read_member(directory: Path, member: dict, *, collect=False):
    """Verify the same opened source file before returning its bytes."""
    name = _name(member["path"])
    path = directory / name
    try:
        if path.resolve(strict=True) != path or directory not in path.parents:
            raise CensusDeliveryError("CENSUS_SOURCE_PATH_CHANGED", path=name)
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, "rb") as stream:
            info = os.fstat(stream.fileno())
            if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                    or info.st_mode & 0o077 or info.st_size != member["bytes"]):
                raise CensusDeliveryError("CENSUS_SOURCE_FILE_CHANGED", path=name)
            digest, size = hashlib.sha256(), 0
            chunks = [] if collect else None
            while raw := stream.read(1_048_576):
                size += len(raw)
                digest.update(raw)
                if collect:
                    chunks.append(raw)
        if size != member["bytes"] or digest.hexdigest() != member["sha256"]:
            raise CensusDeliveryError("CENSUS_SOURCE_FILE_CHANGED", path=name)
        return b"".join(chunks) if collect else None
    except OSError:
        raise CensusDeliveryError("CENSUS_SOURCE_FILE_UNAVAILABLE", path=name) from None


@dataclass(frozen=True)
class CensusSourceDelivery:
    directory: Path
    capture_id: str
    manifest: dict
    native_status: str
    payment_status: str
    acquired_rows: int
    reopened: bool

    def member(self, name: str) -> dict:
        name = _name(name)
        for item in self.manifest["files"]:
            if item["path"] == name:
                return dict(item)
        raise CensusDeliveryError("CENSUS_SOURCE_MEMBER_UNDECLARED", path=name)

    def read_file(self, name: str) -> bytes:
        return _read_member(self.directory, self.member(name), collect=True)

    def source_path(self, name: str) -> Path:
        _read_member(self.directory, self.member(name))
        return self.directory / name

    def native_package_bytes(self) -> bytes:
        """Return the optional original assembler package without re-encoding."""
        return self.read_file(NATIVE_PACKAGE_PATH)

    def method_sources(self) -> list[tuple[Path, Path]]:
        """Return explicitly declared original method/receipt pairs."""
        return [(self.source_path(item["path"]), self.source_path(item["receipt_path"]))
                for item in self.manifest.get("annotations", [])
                if item.get("receipt_path") is not None]

    def summary(self) -> dict:
        value = {
            "schema": "stellar-forge.census-acs-received.v1",
            "capture_id": self.capture_id,
            "year": self.manifest["year"],
            "period": self.manifest["period"],
            "source_directory": str(self.directory),
            "manifest_path": str(self.directory / MANIFEST_PATH),
            "source_files": len(self.manifest["files"]),
            "acquired_rows": self.acquired_rows,
            "native_status": self.native_status,
            "payment_status": self.payment_status,
            "reopened": self.reopened,
        }
        package = next((item for item in self.manifest["files"]
                        if item["path"] == NATIVE_PACKAGE_PATH), None)
        if package is not None:
            value["native_package"] = {
                **package, "path": str(self.directory / NATIVE_PACKAGE_PATH)}
        return value


def _validated_row(row: dict):
    if not isinstance(row, dict) or not _REQUIRED <= row.keys():
        raise CensusDeliveryError("CENSUS_SOURCE_FILES_PROJECTION_REQUIRED")
    identity = (
        _integer(row["release_year"], "release_year"),
        _integer(row["period_start"], "period_start"),
        _integer(row["period_end"], "period_end"),
        _sha(row["capture_id"], "capture_id"),
    )
    name = _name(row["path"])
    size = _integer(row["file_bytes"], "file_bytes")
    count = _integer(row["chunk_count"], "chunk_count", 1)
    index = _integer(row["chunk_index"], "chunk_index")
    if count != max(1, (size + CHUNK_BYTES - 1) // CHUNK_BYTES) or index >= count:
        raise CensusDeliveryError("CENSUS_CHUNK_GEOMETRY_INVALID", path=name)
    encoded = row["content_base64"]
    if not isinstance(encoded, str) or len(encoded) > 65_536:
        raise CensusDeliveryError("CENSUS_CHUNK_ENCODING_INVALID", path=name)
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, UnicodeError, binascii.Error):
        raise CensusDeliveryError("CENSUS_CHUNK_ENCODING_INVALID", path=name) from None
    if (len(raw) != min(CHUNK_BYTES, size - index * CHUNK_BYTES)
            or base64.b64encode(raw).decode("ascii") != encoded):
        raise CensusDeliveryError("CENSUS_CHUNK_SIZE_INVALID", path=name)
    if hashlib.sha256(raw).hexdigest() != _sha(row["chunk_sha256"], "chunk_sha256"):
        raise CensusDeliveryError("CENSUS_CHUNK_HASH_MISMATCH", path=name, chunk=index)
    item = {"path": name, "bytes": size,
            "sha256": _sha(row["file_sha256"], "file_sha256"), "chunks": count}
    return identity, item, index, raw


def _manifest(raw: bytes, identity: tuple, restored: dict) -> dict:
    from stellar_forge_buyer.storage import parse

    if hashlib.sha256(raw).hexdigest() != identity[3]:
        raise CensusDeliveryError("CENSUS_CAPTURE_ID_MISMATCH")
    value = parse(raw)
    if not isinstance(value, dict) or value.get("schema") != MANIFEST_SCHEMA:
        raise CensusDeliveryError("CENSUS_CAPTURE_MANIFEST_INVALID")
    period = value.get("period")
    if (not isinstance(period, dict)
            or type(value.get("year")) is not int
            or type(period.get("start")) is not int
            or type(period.get("end")) is not int
            or (value["year"], period["start"], period["end"]) != identity[:3]):
        raise CensusDeliveryError("CENSUS_RELEASE_IDENTITY_MISMATCH")
    for field in ("tables", "geography_ids"):
        values = value.get(field)
        if (not isinstance(values, list) or not values
                or any(not isinstance(item, str) or not item for item in values)
                or len(values) != len(set(values))):
            raise CensusDeliveryError("CENSUS_CAPTURE_SELECTION_INVALID", field=field)
    members = value.get("files")
    if not isinstance(members, list) or not members:
        raise CensusDeliveryError("CENSUS_CAPTURE_FILES_INVALID")
    expected = {}
    for item in members:
        if not isinstance(item, dict):
            raise CensusDeliveryError("CENSUS_CAPTURE_FILES_INVALID")
        name = _name(item.get("path"))
        if name == MANIFEST_PATH or name in expected:
            raise CensusDeliveryError("CENSUS_CAPTURE_DUPLICATE_PATH", path=name)
        expected[name] = {
            "path": name, "bytes": _integer(item.get("bytes"), "bytes"),
            "sha256": _sha(item.get("sha256"), "sha256")}
    actual_names = set(restored) - {MANIFEST_PATH}
    if set(expected) != actual_names:
        raise CensusDeliveryError("CENSUS_CAPTURE_FILE_INVENTORY_MISMATCH",
            missing=sorted(set(expected) - actual_names),
            unexpected=sorted(actual_names - set(expected)))
    for name, item in expected.items():
        actual = restored[name]["item"]
        if any(actual[field] != item[field] for field in ("path", "bytes", "sha256")):
            raise CensusDeliveryError("CENSUS_CAPTURE_FILE_METADATA_MISMATCH", path=name)
    annotations = value.get("annotations", [])
    if not isinstance(annotations, list):
        raise CensusDeliveryError("CENSUS_ANNOTATIONS_INVALID")
    for item in annotations:
        if not isinstance(item, dict):
            raise CensusDeliveryError("CENSUS_ANNOTATIONS_INVALID")
        name = _name(item.get("path"))
        if name not in expected or expected[name]["sha256"] != item.get("sha256"):
            raise CensusDeliveryError("CENSUS_ANNOTATION_SOURCE_MISMATCH", path=name)
        if item.get("receipt_path") is not None and _name(item["receipt_path"]) not in expected:
            raise CensusDeliveryError("CENSUS_ANNOTATION_RECEIPT_MISSING", path=name)
    return value


def restore_source_files(delivery: "DatasetDelivery", destination, *,
                         expected_capture_id=None, expected_year=None) -> CensusSourceDelivery:
    """Restore every declared source file from one original data room.

    A file's chunks arrive in ascending order; different files may interleave.
    The acquired manifest rejects delivery that omitted a whole file. Matching
    existing output is verified and reopened; different output is preserved.
    """
    from stellar_forge_buyer.storage import private_directory, sync_directory

    if expected_capture_id is not None:
        _sha(expected_capture_id, "expected_capture_id")
    if expected_year is not None:
        _integer(expected_year, "expected_year")
    native = delivery.native
    if not isinstance(native, dict) or native.get("schema") != "stellar-forge.sf88.dataset-delivery.v1":
        raise CensusDeliveryError("ORIGINAL_SF88_DATASET_DELIVERY_REQUIRED")
    output = Path(os.path.abspath(Path(destination).expanduser()))
    parent = private_directory(output.parent)
    if parent != output.parent:
        raise CensusDeliveryError("CENSUS_OUTPUT_CANONICAL_PATH_REQUIRED")
    staging = Path(tempfile.mkdtemp(prefix=".census-receive-", dir=parent))
    states, identity, row_count = {}, None, 0
    try:
        for row in delivery.jsonl_rows():
            row_identity, item, index, raw = _validated_row(row)
            if identity is None:
                identity = row_identity
                if expected_capture_id is not None and identity[3] != expected_capture_id:
                    raise CensusDeliveryError("CENSUS_CAPTURE_ID_MISMATCH")
                if expected_year is not None and identity[0] != expected_year:
                    raise CensusDeliveryError("CENSUS_RELEASE_IDENTITY_MISMATCH")
            elif row_identity != identity:
                raise CensusDeliveryError("CENSUS_CAPTURE_MIXED_IDENTITIES")
            name = item["path"]
            state = states.get(name)
            if state is None:
                state = {"item": item, "next": 0, "bytes": 0, "digest": hashlib.sha256()}
                states[name] = state
            if state["item"] != item or index != state["next"]:
                raise CensusDeliveryError("CENSUS_CHUNK_ORDER_OR_METADATA_MISMATCH",
                                          path=name, chunk=index)
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
                raise CensusDeliveryError("CENSUS_OUTPUT_FILE_FAILED", path=name) from None
            state["digest"].update(raw)
            state["bytes"] += len(raw)
            state["next"] += 1
            row_count += 1
        if identity is None or MANIFEST_PATH not in states:
            raise CensusDeliveryError("CENSUS_CAPTURE_MANIFEST_MISSING")
        for name, state in states.items():
            item = state["item"]
            if (state["next"] != item["chunks"] or state["bytes"] != item["bytes"]
                    or state["digest"].hexdigest() != item["sha256"]):
                raise CensusDeliveryError("CENSUS_SOURCE_FILE_INCOMPLETE", path=name)
        manifest_item = states[MANIFEST_PATH]["item"]
        manifest_raw = _read_member(staging, manifest_item, collect=True)
        manifest = _manifest(manifest_raw, identity, states)
        reopened = output.exists() or output.is_symlink()
        if reopened:
            if private_directory(output, create=False) != output:
                raise CensusDeliveryError("CENSUS_OUTPUT_CANONICAL_PATH_REQUIRED")
            if _read_member(output, manifest_item, collect=True) != manifest_raw:
                raise CensusDeliveryError("CENSUS_OUTPUT_CAPTURE_CONFLICT")
            for item in manifest["files"]:
                _read_member(output, item)
        else:
            os.rename(staging, output)
            staging = None
            sync_directory(parent)
        return CensusSourceDelivery(
            directory=output, capture_id=identity[3], manifest=manifest,
            native_status=delivery.status, payment_status=delivery.payment_status,
            acquired_rows=row_count, reopened=reopened)
    finally:
        if staging is not None:
            shutil.rmtree(staging)


def receive_acquisition(acquisition, delivery_directory, source_directory, **expectations):
    """Reopen the original SF100 delivery, then restore its acquired capture."""
    return restore_source_files(acquisition.deliver(delivery_directory),
                                source_directory, **expectations)
