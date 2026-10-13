"""Attach a complete supplier CLI export to an existing native workflow delivery.

The maintained supplier CLI owns comparison, review, finalization and file export.
This module reads that finished export and returns complete sibling file descriptors
for the outer request orchestrator. It does not modify a native result or archive.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import stat

FORMAT = "conapi-supplier-delivery"
_HASH = re.compile(r"[a-f0-9]{64}")
_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*")
_MIME = {
    ".csv": "text/csv; charset=utf-8",
    ".json": "application/json",
    ".html": "text/html; charset=utf-8",
    ".sql": "application/sql; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".py": "text/x-python; charset=utf-8",
    ".zip": "application/zip",
    ".gz": "application/gzip",
    ".pdf": "application/pdf",
}
_REQUIRED = {
    "workspace.json", "report.json", "rules.json", "changes.csv", "report.html"
}
_REVIEWED = {"accepted.csv", "accepted.sql", "lineage.json"}


class SupplierAttachmentError(RuntimeError):
    def __init__(self, code, message, details=None):
        self.code = code
        self.details = details or {}
        super().__init__(message)


def _require(condition, code, message, **details):
    if not condition:
        raise SupplierAttachmentError(code, message, details)


def _name(value, label):
    _require(
        isinstance(value, str) and bool(_NAME.fullmatch(value))
        and len(value.encode("ascii")) <= 255 and value not in {".", ".."}
        and not value.endswith("."),
        "UNSAFE_ATTACHMENT_NAME",
        label + " must be a portable ASCII basename.",
        value=value,
    )
    return value


def _absolute_directory(value, label):
    _require(isinstance(value, (str, os.PathLike)), "INVALID_DIRECTORY", label + " must be a filesystem path.")
    path = Path(value)
    _require(path.is_absolute(), "ABSOLUTE_DIRECTORY_REQUIRED", label + " must be absolute.")
    _require(".." not in path.parts, "PARENT_PATH_SEGMENT", label + " contains a parent path segment.")
    # An installed request directory must retain its actual path, including ancestors.
    current = Path(path.anchor)
    for part in path.parts[1:]:
        current /= part
        info = current.lstat()
        _require(
            stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode),
            "REQUEST_DIRECTORY_CHANGED",
            label + " must be an existing directory without symlink components.",
            path=str(current),
        )
    return path


def _within_workspace(value, workspace):
    _require(isinstance(value, (str, os.PathLike)), "INVALID_FILE_PATH", "An attachment needs a filesystem path.")
    path = Path(value)
    _require(path.is_absolute(), "ABSOLUTE_FILE_REQUIRED", "Every attachment path must be absolute.")
    _require(
        ".." not in path.parts and path.is_relative_to(workspace),
        "ATTACHMENT_OUTSIDE_WORKSPACE",
        "Every supplier attachment must be inside the original request workspace.",
        path=str(path),
        workspace=str(workspace),
    )
    relative = path.relative_to(workspace)
    _require(bool(relative.parts), "ATTACHMENT_FILE_REQUIRED", "An attachment must identify a file.")
    return path, relative


def _open_original(workspace, relative):
    """Open a regular member beneath the original workspace without following links."""
    directory = os.open(workspace, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in relative.parts[:-1]:
            child = os.open(
                part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory
            )
            os.close(directory)
            directory = child
        return os.open(
            relative.parts[-1],
            os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
            dir_fd=directory,
        )
    finally:
        os.close(directory)


def _descriptor(value, name, workspace, *, expected=None, capture=False):
    path, relative = _within_workspace(value, workspace)
    descriptor = _open_original(workspace, relative)
    chunks = [] if capture else None
    checksum = hashlib.sha256()
    with os.fdopen(descriptor, "rb") as stream:
        before = os.fstat(stream.fileno())
        _require(
            stat.S_ISREG(before.st_mode),
            "REGULAR_ATTACHMENT_REQUIRED",
            "A supplier attachment must be a regular file.",
            path=str(path),
        )
        while True:
            chunk = stream.read(1024 * 1024)
            if not chunk:
                break
            checksum.update(chunk)
            if capture:
                chunks.append(chunk)
        after = os.fstat(stream.fileno())
    snapshot = lambda value: (
        value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns
    )
    _require(
        snapshot(before) == snapshot(after),
        "ATTACHMENT_CHANGED_DURING_READ",
        "A supplier attachment changed while its complete contents were read.",
        path=str(path),
    )
    result = {
        "name": name,
        "path": str(path),
        "bytes": before.st_size,
        "sha256": checksum.hexdigest(),
        "contentType": _MIME.get(path.suffix.lower(), "application/octet-stream"),
    }
    if expected is not None:
        _require(
            type(expected.get("bytes")) is int and expected["bytes"] >= 0
            and isinstance(expected.get("sha256"), str)
            and bool(_HASH.fullmatch(expected["sha256"])),
            "INVALID_ATTACHMENT_DECLARATION",
            "Every declared attachment needs its original byte count and lowercase SHA-256.",
            path=str(path),
        )
        _require(
            result["bytes"] == expected["bytes"] and result["sha256"] == expected["sha256"],
            "ATTACHMENT_CONTENT_CHANGED",
            "The complete attachment differs from its original declaration.",
            path=str(path),
            expectedBytes=expected["bytes"],
            actualBytes=result["bytes"],
            expectedSha256=expected["sha256"],
            actualSha256=result["sha256"],
        )
    return result, b"".join(chunks) if capture else None


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        _require(
            key not in result,
            "DUPLICATE_MANIFEST_FIELD",
            "The original supplier manifest contains a duplicate JSON field.",
            field=key,
        )
        result[key] = value
    return result


def _reject_constant(value):
    raise SupplierAttachmentError("INVALID_MANIFEST_NUMBER", "The manifest contains " + value)


def supplier_attachment_files(
    bundle_directory,
    *,
    request_workspace=None,
    expected_manifest_sha256=None,
    expected_request_id=None,
    additional_files=(),
    reserved_names=(),
    prefix="Supplier_Report_",
):
    """Return sibling native descriptors for a complete original supplier export.

    bundle_directory is the new directory completed by:
      node supplier-report-cli.mjs export --workspace reviewed.json --out-dir DIR

    The CLI manifest remains exact and is itself included as an attachment.
    additional_files uses existing native descriptors:
      {"name": "catalogue-coverage.html", "path": ABSOLUTE_PATH,
       "bytes": EXACT_INTEGER, "sha256": EXACT_LOWERCASE_SHA256}

    Every file must live beneath request_workspace, which defaults to the bundle
    directory. The caller can pass names from native_result["files"] in
    reserved_names. Attachment names are prefixed; paths and original bytes remain
    unchanged. The returned list can be joined to the outer delivery's files.
    """
    workspace = _absolute_directory(
        request_workspace if request_workspace is not None else bundle_directory,
        "request_workspace",
    )
    bundle = _absolute_directory(bundle_directory, "bundle_directory")
    _require(
        bundle.is_relative_to(workspace),
        "BUNDLE_OUTSIDE_WORKSPACE",
        "The supplier export must be inside the original request workspace.",
    )
    _require(isinstance(prefix, str), "INVALID_ATTACHMENT_PREFIX", "The attachment prefix must be a string.")
    _name(prefix + "manifest.json", "Prefixed manifest name")
    used = set()
    for name in reserved_names:
        _require(isinstance(name, str), "INVALID_RESERVED_NAME", "Native file names must be strings.")
        _require(
            name.casefold() not in used,
            "DUPLICATE_NATIVE_NAME",
            "The existing native file list contains colliding attachment names.",
            name=name,
        )
        used.add(name.casefold())

    def reserve(filename):
        _name(filename, "Original supplier filename")
        name = _name(prefix + filename, "Supplier attachment name")
        _require(
            name.casefold() not in used,
            "ATTACHMENT_NAME_COLLISION",
            "A supplier attachment collides with an existing delivery name.",
            name=name,
        )
        used.add(name.casefold())
        return name

    manifest_name = reserve("manifest.json")
    manifest_descriptor, manifest_bytes = _descriptor(
        bundle / "manifest.json", manifest_name, workspace, capture=True
    )
    if expected_manifest_sha256 is not None:
        _require(
            isinstance(expected_manifest_sha256, str)
            and bool(_HASH.fullmatch(expected_manifest_sha256)),
            "INVALID_MANIFEST_SHA256",
            "The expected manifest SHA-256 must use lowercase hexadecimal.",
        )
        _require(
            manifest_descriptor["sha256"] == expected_manifest_sha256,
            "MANIFEST_CONTENT_CHANGED",
            "The original supplier manifest differs from its retained SHA-256.",
        )
    try:
        manifest = json.loads(
            manifest_bytes.decode("utf-8"),
            object_pairs_hook=_unique_object,
            parse_constant=_reject_constant,
        )
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SupplierAttachmentError(
            "INVALID_SUPPLIER_MANIFEST", "The supplier manifest must be complete UTF-8 JSON."
        ) from error
    _require(
        isinstance(manifest, dict)
        and manifest.get("format") == FORMAT
        and type(manifest.get("version")) is int
        and manifest["version"] == 1
        and isinstance(manifest.get("files"), list),
        "UNSUPPORTED_SUPPLIER_MANIFEST",
        "Use the complete conapi-supplier-delivery version 1 manifest.",
    )
    if expected_request_id is not None:
        _require(
            manifest.get("requestId") == expected_request_id,
            "SUPPLIER_REQUEST_CHANGED",
            "The supplier export belongs to a different original business request.",
        )
    declared = {}
    for item in manifest["files"]:
        _require(isinstance(item, dict), "INVALID_FILE_ENTRY", "Manifest file entries must be objects.")
        filename = _name(item.get("filename"), "Manifest filename")
        _require(
            filename not in declared and filename != "manifest.json",
            "DUPLICATE_MANIFEST_FILE",
            "The supplier manifest must declare each output exactly once and exclude itself.",
            filename=filename,
        )
        declared[filename] = item
    _require(
        _REQUIRED.issubset(declared)
        and sum(name in declared for name in ("baseline-source.csv", "baseline-source.json")) == 1
        and sum(name in declared for name in ("candidate-source.csv", "candidate-source.json")) == 1,
        "INCOMPLETE_SUPPLIER_EXPORT",
        "The supplier manifest must include the full workspace, report, rules, both sources and review outputs.",
    )
    if manifest.get("status") == "reviewed":
        _require(
            _REVIEWED.issubset(declared),
            "INCOMPLETE_REVIEWED_EXPORT",
            "A reviewed supplier export must include accepted CSV, accepted SQL and lineage.",
        )

    files = []
    for filename, expected in declared.items():
        name = reserve(filename)
        item, _ = _descriptor(bundle / filename, name, workspace, expected=expected)
        files.append(item)
    for expected in additional_files:
        _require(
            isinstance(expected, dict),
            "INVALID_ADDITIONAL_ATTACHMENT",
            "Additional files must use complete native file descriptors.",
        )
        name = reserve(expected.get("name"))
        item, _ = _descriptor(
            expected.get("path"), name, workspace, expected=expected
        )
        files.append(item)
    files.append(manifest_descriptor)
    return files
