"""Complete portable field evidence on the existing implementation revision store.

The ZIP carries an unchanged plan document and every original local-file source.
Archive bytes are validated before they enter the workspace attachment bank.
"""
from __future__ import annotations

import copy
from contextlib import contextmanager
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import tempfile
import zipfile

from .implementation import (
    ImplementationError, ImplementationStore, canonical_bytes, document_digest,
    load_json, validate_plan, _atomic_bytes, _fsync_directory,
)

SCHEMA = "upstate.implementation-evidence/v1"
EXPORT_SCHEMA = "upstate.implementation-evidence-export/v1"
MAX_FILES = 128
MAX_FILE_BYTES = 64 * 1024 * 1024
MAX_TOTAL_BYTES = 128 * 1024 * 1024
MAX_PLAN_BYTES = 16 * 1024 * 1024
MAX_MANIFEST_BYTES = 1024 * 1024
MAX_ARCHIVE_BYTES = MAX_TOTAL_BYTES + MAX_PLAN_BYTES + MAX_MANIFEST_BYTES + 1024 * 1024


def _require(condition, message):
    if not condition:
        raise ImplementationError(message)


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def _size(value, maximum, name):
    _require(type(value) is int and 0 <= value <= maximum,
             name + " must be a nonnegative whole byte count within capacity.")
    return value


def _media_type(value):
    if value is None or value == "":
        return "application/octet-stream"
    _require(isinstance(value, str) and
             len(value.encode("utf-16-le", errors="surrogatepass")) // 2 <= 255 and
             not any(character in value for character in ("\r", "\n", "\0")),
             "Invalid evidence media type.")
    return value


def _safe_name(original):
    _require(isinstance(original, str) and bool(original) and
             original not in (".", "..") and "/" not in original and
             "\\" not in original and "\0" not in original,
             "Evidence original_filename must be an ordinary filename.")
    return re.sub(r"[^A-Za-z0-9_.-]", "_", original)[:120].lstrip(".") or "attachment"


def _path(name):
    _require(isinstance(name, str) and bool(name) and "\\" not in name and
             "\0" not in name and not PurePosixPath(name).is_absolute() and
             all(part not in ("", ".", "..") for part in name.split("/")),
             "Evidence member paths must be ordinary relative file paths.")
    return name


def _links(plan):
    result = {}
    unique_members = {}
    for link in plan["source_links"]:
        if link["kind"] != "local_file":
            continue
        checksum = link.get("sha256")
        _require(isinstance(checksum, str) and re.fullmatch(r"[0-9a-f]{64}", checksum),
                 "Each local-file source requires its original SHA256.")
        count = _size(link.get("size_bytes"), MAX_FILE_BYTES, "Evidence size_bytes")
        original = link.get("original_filename")
        _safe_name(original)
        reference = _path(link.get("reference"))
        parent = "implementation/plans/" + plan["id"] + "/attachments/"
        name = reference.removeprefix(parent)
        _require(reference.startswith(parent) and re.fullmatch(r"[A-Za-z0-9_.-]+", name)
                 and name.startswith(checksum + "-") and len(name) > 65,
                 "Local-file source must retain its original same-plan attachment path.")
        _require(link["id"] not in result, "Evidence source IDs must be unique.")
        result[link["id"]] = link
        unique_members["evidence/" + checksum + "/" + _safe_name(original)] = count
    _require(len(result) <= MAX_FILES, "The evidence package exceeds 128 original files.")
    _require(sum(unique_members.values()) <= MAX_TOTAL_BYTES, "The evidence package exceeds 128 MiB of original files.")
    return result


@contextmanager
def _archive_source(source):
    if isinstance(source, (bytes, bytearray)):
        _require(len(source) <= MAX_ARCHIVE_BYTES, "The evidence ZIP exceeds capacity.")
        with io.BytesIO(source) as handle:
            yield handle
    else:
        path = Path(source)
        _require(not path.is_symlink() and path.is_file(),
                 "The evidence archive must be an original regular file.")
        _require(path.stat().st_size <= MAX_ARCHIVE_BYTES,
                 "The evidence ZIP exceeds the package capacity.")
        with path.open("rb") as handle:
            yield handle


def _fingerprint(handle, maximum):
    checksum = hashlib.sha256()
    count = 0
    while True:
        chunk = handle.read(1024 * 1024)
        if not chunk:
            break
        count += len(chunk)
        _require(count <= maximum, "An original evidence stream exceeds capacity.")
        checksum.update(chunk)
    return count, checksum.hexdigest()


def _verify_file(path, count, checksum):
    path = Path(path)
    _require(not path.is_symlink() and path.is_file(),
             "An original evidence file is unavailable.")
    with path.open("rb") as handle:
        actual = _fingerprint(handle, max(count, 0))
    _require(actual == (count, checksum), "Original evidence bytes differ from their recorded identity.")


def read_package(source):
    """Validate the complete ZIP in bounded chunks; retain original descriptors."""
    try:
        with _archive_source(source) as handle:
            count, checksum = _fingerprint(handle, MAX_ARCHIVE_BYTES)
            handle.seek(0)
            with zipfile.ZipFile(handle, "r") as archive:
                _require(not archive.comment, "Evidence ZIP comments are unsupported.")
                entries = archive.infolist()
                _require(2 <= len(entries) <= MAX_FILES + 2,
                         "An evidence ZIP contains manifest.json, plan.json and its original files.")
                indexed = {}
                for info in entries:
                    name = _path(info.filename)
                    mode = info.external_attr >> 16
                    _require(name not in indexed, "The evidence ZIP repeats a member path.")
                    _require(not info.is_dir() and stat.S_IFMT(mode) in (0, stat.S_IFREG),
                             "Evidence ZIP members must be regular files.")
                    _require(info.flag_bits in (0, 0x800) and not info.extra and not info.comment
                             and info.compress_type == zipfile.ZIP_STORED,
                             "Evidence ZIP members must use unencrypted stored bytes.")
                    _require(info.compress_size == info.file_size,
                             "Stored evidence member sizes differ.")
                    indexed[name] = info
                _require("manifest.json" in indexed and "plan.json" in indexed,
                         "The evidence ZIP needs manifest.json and plan.json.")
                _size(indexed["manifest.json"].file_size, MAX_MANIFEST_BYTES, "Manifest bytes")
                _size(indexed["plan.json"].file_size, MAX_PLAN_BYTES, "Plan bytes")
                _require(sum(row.file_size for row in entries) <=
                         MAX_TOTAL_BYTES + MAX_PLAN_BYTES + MAX_MANIFEST_BYTES,
                         "The evidence ZIP expanded size exceeds capacity.")
                manifest = load_json(archive.read("manifest.json"))
                _require(isinstance(manifest, dict) and manifest.get("schema") == SCHEMA,
                         "Choose an upstate.implementation-evidence/v1 package.")
                record = manifest.get("plan")
                _require(isinstance(record, dict) and record.get("path") == "plan.json",
                         "Evidence manifest must identify the original plan.json.")
                raw_plan = archive.read("plan.json")
                _require(_size(record.get("size_bytes"), MAX_PLAN_BYTES, "Plan size_bytes")
                         == len(raw_plan) and record.get("sha256") == _sha(raw_plan),
                         "The original plan bytes differ from the evidence manifest.")
                plan = validate_plan(load_json(raw_plan))
                _require(record.get("id") == plan["id"], "Evidence manifest identifies another plan.")
                links = _links(plan)
                records = manifest.get("files")
                _require(isinstance(records, list) and len(records) == len(links),
                         "The package must describe every local-file source exactly once.")
                files = {}
                seen_paths = {"manifest.json", "plan.json"}
                verified = {}
                for row in records:
                    _require(isinstance(row, dict), "Each evidence file descriptor must be an object.")
                    source_id = row.get("source_id")
                    _require(isinstance(source_id, str) and source_id in links
                             and source_id not in files,
                             "Evidence descriptors need unique original source IDs.")
                    link = links[source_id]
                    original = row.get("original_filename")
                    expected_path = "evidence/" + link["sha256"] + "/" + _safe_name(original)
                    path = _path(row.get("path"))
                    _require(path == expected_path and path in indexed,
                             "Evidence member path must match its original SHA256 and filename.")
                    _require(original == link["original_filename"]
                             and row.get("source_ref") == link["reference"]
                             and row.get("sha256") == link["sha256"]
                             and _size(row.get("size_bytes"), MAX_FILE_BYTES, "File size_bytes")
                             == link["size_bytes"],
                             "Evidence descriptor differs from its original source link.")
                    _require(row.get("media_type") == _media_type(link.get("media_type")),
                             "Evidence media type differs from its original source link.")
                    expected = (link["size_bytes"], link["sha256"])
                    _require(indexed[path].file_size == expected[0],
                             "Evidence member size differs from its source link.")
                    if path not in verified:
                        with archive.open(path) as member:
                            verified[path] = _fingerprint(member, MAX_FILE_BYTES)
                    _require(verified[path] == expected,
                             "Evidence original bytes differ from their recorded SHA256.")
                    files[source_id] = dict(descriptor=copy.deepcopy(row))
                    seen_paths.add(path)
                _require(seen_paths == set(indexed), "The evidence ZIP contains unlisted members.")
                handle.seek(0)
                _require(_fingerprint(handle, MAX_ARCHIVE_BYTES) == (count, checksum),
                         "The original archive changed while its members were validated.")
                return dict(plan=plan, manifest=manifest, plan_bytes=raw_plan, files=files,
                            bytes=count, sha256=checksum)
    except (zipfile.BadZipFile, zipfile.LargeZipFile, RuntimeError, OSError) as error:
        raise ImplementationError("The evidence ZIP cannot be read: " + str(error)) from error

def _ordinary_directory(path, root):
    path = Path(path)
    root = Path(root).resolve()
    _require(path.resolve().is_relative_to(root), "Evidence storage must remain in its workspace.")
    relative = path.relative_to(root)
    current = root
    for part in relative.parts:
        current = current / part
        _require(not current.is_symlink(), "Evidence storage must not traverse a symlink.")
        current.mkdir(exist_ok=True)
        _require(current.is_dir(), "Evidence storage needs ordinary directories.")
    return path


def _publish(path, data):
    try:
        _atomic_bytes(path, data)
    except FileExistsError:
        _require(not path.is_symlink() and path.is_file() and
                 path.stat().st_size == len(data) and path.read_bytes() == data,
                 "Existing evidence bytes differ from their original content identity.")


def _publish_stream(path, handle, count, checksum):
    """Retain exact original bytes atomically without a second in-memory archive."""
    path = Path(path)
    if path.exists():
        _verify_file(path, count, checksum)
        return
    descriptor, temporary_name = tempfile.mkstemp(prefix=".evidence-", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        actual_hash = hashlib.sha256()
        actual_count = 0
        with os.fdopen(descriptor, "wb") as output:
            while True:
                chunk = handle.read(1024 * 1024)
                if not chunk:
                    break
                actual_count += len(chunk)
                _require(actual_count <= count, "Original evidence stream exceeds its recorded size.")
                actual_hash.update(chunk)
                output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
        _require((actual_count, actual_hash.hexdigest()) == (count, checksum),
                 "Original evidence bytes changed while retaining the file.")
        try:
            os.link(temporary, path)
        except FileExistsError:
            _verify_file(path, count, checksum)
        _fsync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def import_package(store, source, *, expected_revision=None, actor="", expected_plan_id=None):
    """Validate all bytes, retain originals and invoke one durable plan import."""
    if not isinstance(store, ImplementationStore):
        store = ImplementationStore(store)
    received = read_package(source)
    plan = received["plan"]
    _require(expected_plan_id is None or expected_plan_id == plan["id"],
             "The uploaded evidence package identifies another implementation plan.")
    if expected_revision is not None:
        _require(type(expected_revision) is int and expected_revision >= 0,
                 "expected_revision must be a nonnegative whole revision.")
    directory = store._directory(plan["id"], create=True)
    attachments = _ordinary_directory(directory / "attachments", store.root)
    incoming = _ordinary_directory(directory / "evidence-imports", store.root)
    archive_path = incoming / (received["sha256"] + ".zip")
    with _archive_source(source) as handle:
        _publish_stream(archive_path, handle, received["bytes"], received["sha256"])
    # Use the verified retained archive for all writes and preserve source aliases.
    with zipfile.ZipFile(archive_path, "r") as archive:
        for value in received["files"].values():
            descriptor = value["descriptor"]
            target = store.root / descriptor["source_ref"]
            _require(target.parent == attachments, "Evidence destination leaves its original plan bank.")
            with archive.open(descriptor["path"]) as member:
                _publish_stream(target, member, descriptor["size_bytes"], descriptor["sha256"])
    _fsync_directory(attachments)
    result = store.import_document(plan, expected_revision=expected_revision, actor=actor)
    return dict(result, evidence=dict(
        schema=SCHEMA, files=len(received["files"]), bytes=received["bytes"],
        sha256=received["sha256"], archive_ref=str(archive_path),
    ))

def _export_paths(store, plan):
    root = store.base / plan["id"] / "exports"
    stem = f"{plan['revision']:016d}-{document_digest(plan)}-evidence"
    return root / (stem + ".zip"), root / (stem + ".json")


def _zip_member(archive, name, data):
    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.create_system = 3
    info.external_attr = (stat.S_IFREG | 0o644) << 16
    info.compress_type = zipfile.ZIP_STORED
    archive.writestr(info, data)


def export_package(store, plan_id, *, revision=None):
    """Stream a complete handover for one retained native revision."""
    if not isinstance(store, ImplementationStore):
        store = ImplementationStore(store)
    plan = store.get(plan_id, revision)
    links = _links(plan)
    raw_plan = canonical_bytes(plan) + b"\n"
    _require(len(raw_plan) <= MAX_PLAN_BYTES, "The portable evidence plan exceeds 16 MiB.")
    files, records = {}, []
    attachments = store.base / plan["id"] / "attachments"
    _require(not attachments.is_symlink(), "The original attachment bank must be an ordinary directory.")
    for source_id, link in links.items():
        path = store.root / link["reference"]
        _require(path.parent == attachments and not path.is_symlink() and path.is_file(),
                 "An original evidence file is unavailable in its plan attachment bank.")
        _verify_file(path, link["size_bytes"], link["sha256"])
        name = "evidence/" + link["sha256"] + "/" + _safe_name(link["original_filename"])
        records.append(dict(source_id=source_id, source_ref=link["reference"], path=name,
                            original_filename=link["original_filename"],
                            media_type=_media_type(link.get("media_type")),
                            size_bytes=link["size_bytes"], sha256=link["sha256"]))
        files.setdefault(name, (path, link["size_bytes"], link["sha256"]))
    manifest = dict(schema=SCHEMA,
                    plan=dict(id=plan["id"], path="plan.json", sha256=_sha(raw_plan),
                              size_bytes=len(raw_plan)), files=records)
    raw_manifest = canonical_bytes(manifest) + b"\n"
    _require(len(raw_manifest) <= MAX_MANIFEST_BYTES, "The evidence manifest exceeds 1 MiB.")
    archive_path, receipt_path = _export_paths(store, plan)
    _ordinary_directory(archive_path.parent, store.root)
    descriptor, temporary_name = tempfile.mkstemp(prefix=".evidence-export-", dir=archive_path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w+b") as output:
            with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED, allowZip64=False) as archive:
                _zip_member(archive, "manifest.json", raw_manifest)
                _zip_member(archive, "plan.json", raw_plan)
                for name, (path, count, checksum) in sorted(files.items()):
                    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                    info.create_system = 3
                    info.external_attr = (stat.S_IFREG | 0o644) << 16
                    info.compress_type = zipfile.ZIP_STORED
                    info.file_size = count
                    actual_hash, actual_count = hashlib.sha256(), 0
                    with path.open("rb") as original, archive.open(info, "w") as target:
                        while True:
                            chunk = original.read(1024 * 1024)
                            if not chunk:
                                break
                            actual_count += len(chunk)
                            _require(actual_count <= count, "An original attachment changed during export.")
                            actual_hash.update(chunk)
                            target.write(chunk)
                    _require((actual_count, actual_hash.hexdigest()) == (count, checksum),
                             "An original attachment changed during export.")
            output.flush()
            os.fsync(output.fileno())
            output.seek(0)
            count, checksum = _fingerprint(output, MAX_ARCHIVE_BYTES)
            try:
                os.link(temporary, archive_path)
            except FileExistsError:
                _verify_file(archive_path, count, checksum)
            _fsync_directory(archive_path.parent)
        receipt = dict(schema=EXPORT_SCHEMA, plan_id=plan["id"], revision=plan["revision"],
                       document_digest=document_digest(plan), evidence_files=len(records),
                       reference=archive_path.relative_to(store.root).as_posix(),
                       bytes=count, sha256=checksum, filename=archive_path.name)
        _publish(receipt_path, canonical_bytes(receipt) + b"\n")
        return receipt
    finally:
        temporary.unlink(missing_ok=True)

def exported_package(store, plan):
    """Return the original descriptor only after a complete export receipt exists."""
    if not isinstance(store, ImplementationStore):
        store = ImplementationStore(store)
    archive_path, receipt_path = _export_paths(store, plan)
    if not receipt_path.exists():
        return None
    _require(not receipt_path.is_symlink() and receipt_path.is_file(),
             "The evidence export receipt must be an ordinary file.")
    _require(receipt_path.stat().st_size <= MAX_MANIFEST_BYTES,
             "The evidence export receipt exceeds capacity.")
    receipt = load_json(receipt_path.read_bytes())
    _require(isinstance(receipt, dict) and receipt.get("schema") == EXPORT_SCHEMA and
             receipt.get("plan_id") == plan["id"] and receipt.get("revision") == plan["revision"] and
             receipt.get("document_digest") == document_digest(plan) and
             receipt.get("reference") == archive_path.relative_to(store.root).as_posix() and
             receipt.get("filename") == archive_path.name,
             "The evidence export receipt identifies another retained plan.")
    _size(receipt.get("bytes"), MAX_ARCHIVE_BYTES, "Evidence archive bytes")
    _require(isinstance(receipt.get("sha256"), str) and
             re.fullmatch(r"[0-9a-f]{64}", receipt["sha256"]) and
             archive_path.is_file() and not archive_path.is_symlink(),
             "The completed evidence export is unavailable.")
    return receipt
