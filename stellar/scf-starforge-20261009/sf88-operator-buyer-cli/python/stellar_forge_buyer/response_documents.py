"""Retain exact source documents inside the original Analysis workspace.

This is local document custody for public captures and operator-selected files.
The existing response projection, DatasetDatabase, SQL and export jobs remain
the owners of analysis. Relative content addresses survive a workspace restore.
"""
from __future__ import annotations

from datetime import datetime
import hashlib
import os
from pathlib import Path
import re
import stat
import tempfile
from urllib.parse import urlsplit, urlunsplit

from .errors import StateError
from .result import FileDelivery
from .storage import digest, parse, private_directory, read, sync_directory, write

SCHEMA = "stellar-forge.analysis-source-document.v1"
DIRECTORY = "analysis-response-documents"
MAX_MANIFEST_BYTES = 1_048_576
MAX_SOURCE_BYTES = 256 * 1024 * 1024
MAX_JSON_BYTES = 32 * 1024 * 1024
MAX_ORIGINAL_BYTES = 32 * 1024 * 1024
_HASH = re.compile(r"[a-f0-9]{64}")
_FILE = re.compile(r"files/([a-f0-9]{64})\.(json|csv|bin|txt)")
_MIME = re.compile(r"[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+(?:;[ -~]{1,160})?")
_CHUNK = 1024 * 1024


def _need(condition, code):
    if not condition:
        raise StateError("ANALYSIS_DOCUMENT_" + code)


def _text(value, maximum, *, empty=False):
    _need(isinstance(value, str) and len(value) <= maximum and
          (empty or bool(value.strip())) and "\x00" not in value, "TEXT_INVALID")
    return value


def _url(value):
    _text(value, 3000)
    try:
        parsed = urlsplit(value)
        _need(parsed.scheme == "https" and parsed.hostname and not parsed.username and
              not parsed.password and not parsed.query and not parsed.fragment and
              not any(ord(c) <= 32 for c in value), "PUBLIC_SOURCE_URL_INVALID")
        port = parsed.port
    except ValueError:
        raise StateError("ANALYSIS_DOCUMENT_PUBLIC_SOURCE_URL_INVALID") from None
    _need(port is None or 1 <= port <= 65535, "PUBLIC_SOURCE_URL_INVALID")
    # Keep the actual published URL; credentials and transient query state are
    # deliberately not part of a reusable document source reference.
    _need(urlunsplit(parsed) == value, "PUBLIC_SOURCE_URL_INVALID")
    return value


def _keys(value, required, optional=()):
    _need(isinstance(value, dict) and set(required) <= value.keys() and
          value.keys() <= set(required) | set(optional), "FIELDS_INVALID")


def _file(value, *, original=False):
    required = {"path", "bytes", "sha256", "contentType"}
    _keys(value, required | ({"role"} if original else set()),
          {"sourceUrl"} if original else set())
    match = _FILE.fullmatch(value.get("path", "")) if isinstance(value.get("path"), str) else None
    _need(match and match[1] == value.get("sha256"), "CONTENT_ADDRESS_INVALID")
    limit = MAX_ORIGINAL_BYTES if original else MAX_SOURCE_BYTES
    _need(type(value.get("bytes")) is int and 0 <= value["bytes"] <= limit, "FILE_SIZE_INVALID")
    _need(isinstance(value.get("contentType"), str) and _MIME.fullmatch(value["contentType"]),
          "CONTENT_TYPE_INVALID")
    if original:
        _text(value.get("role"), 80)
        if "sourceUrl" in value:
            _url(value["sourceUrl"])
    return value


def validate_manifest(value):
    """Validate the portable v1 descriptor without touching files or a database."""
    _keys(value, {"schema", "title", "format", "document", "originals", "provenance", "complete"})
    _need(value["schema"] == SCHEMA, "SCHEMA_INVALID")
    _text(value["title"], 200)
    _need(isinstance(value["format"], str) and value["format"] in {"json", "csv"}, "FORMAT_INVALID")
    document = _file(value["document"])
    _need(document["path"].endswith("." + value["format"]), "FORMAT_PATH_MISMATCH")
    _need(value["format"] != "json" or document["bytes"] <= MAX_JSON_BYTES, "JSON_SIZE_INVALID")
    _need(type(value["complete"]) is bool, "COMPLETION_REQUIRED")
    originals = value["originals"]
    _need(isinstance(originals, list) and len(originals) <= 32, "ORIGINALS_INVALID")
    roles = set()
    for item in originals:
        _file(item, original=True)
        _need(item["role"] not in roles, "DUPLICATE_ORIGINAL_ROLE")
        roles.add(item["role"])
    provenance = value["provenance"]
    _keys(provenance, {"kind", "publisher", "capturedAt", "scope", "description"},
          {"sourceUrl", "transform"})
    _need(isinstance(provenance["kind"], str) and provenance["kind"] in {"public-source", "operator-file"}, "ORIGIN_INVALID")
    _text(provenance["publisher"], 200)
    _text(provenance["scope"], 500)
    _text(provenance["description"], 12000, empty=True)
    _text(provenance["capturedAt"], 80)
    try:
        captured = datetime.fromisoformat(provenance["capturedAt"].replace("Z", "+00:00"))
        _need(captured.utcoffset() is not None, "CAPTURE_TIME_OFFSET_REQUIRED")
    except ValueError:
        raise StateError("ANALYSIS_DOCUMENT_CAPTURE_TIME_INVALID") from None
    if provenance["kind"] == "public-source":
        _need("sourceUrl" in provenance, "PUBLIC_SOURCE_URL_REQUIRED")
    if "sourceUrl" in provenance:
        _url(provenance["sourceUrl"])
    if "transform" in provenance:
        transform = provenance["transform"]
        _keys(transform, {"name", "sourceUrl", "sha256"})
        _text(transform["name"], 200)
        _url(transform["sourceUrl"])
        _need(isinstance(transform["sha256"], str) and _HASH.fullmatch(transform["sha256"]),
              "TRANSFORM_DIGEST_INVALID")
    records = _unique_files(value)
    _need(sum(item["bytes"] for item in records) <= MAX_SOURCE_BYTES, "TOTAL_SOURCE_SIZE_INVALID")
    return value


def _unique_files(manifest):
    records = {}
    for item in [manifest["document"], *manifest["originals"]]:
        selected = {key: item[key] for key in ("path", "bytes", "sha256", "contentType")}
        old = records.get(item["path"])
        _need(old is None or old == selected, "CONFLICTING_FILE_IDENTITY")
        records[item["path"]] = selected
    return [records[name] for name in sorted(records)]


def _manifest(path):
    path = Path(path).expanduser().absolute()
    raw = read(path, MAX_MANIFEST_BYTES)
    _need(raw, "MANIFEST_EMPTY")
    value = validate_manifest(parse(raw))
    return value, raw


def _root(path):
    path = Path(path).expanduser().absolute()
    try:
        info = path.lstat()
        _need(stat.S_ISDIR(info.st_mode), "DIRECTORY_REQUIRED")
        return path.resolve(strict=True)
    except OSError:
        raise StateError("ANALYSIS_DOCUMENT_DIRECTORY_UNAVAILABLE") from None


def _payload(root, record):
    root = _root(root)
    # v1 permits exactly one directory and a content-addressed regular file.
    parent = root / "files"
    _need(_root(parent) == parent, "PAYLOAD_DIRECTORY_CHANGED")
    return parent / record["path"].split("/", 1)[1]


def _delivery(root, record):
    path = _payload(root, record)
    return FileDelivery({"returncode": 0, "native": {
        "status": "RETAINED_SOURCE_DOCUMENT",
        "file": {"path": str(path), **{key: record[key] for key in ("bytes", "sha256", "contentType")}},
    }}, path, MAX_SOURCE_BYTES)


def _signature(info):
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns



def _settle_publication(path, stream, prefix):
    """Finish an interrupted no-replace publication in its owned directory."""
    info = os.fstat(stream.fileno())
    directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        current = os.stat(path.name, dir_fd=directory_fd, follow_symlinks=False)
        _need(stat.S_ISREG(current.st_mode) and
              (current.st_dev, current.st_ino) == (info.st_dev, info.st_ino),
              "PUBLISHED_FILE_CHANGED")
        # Only the writer's temporary hard links to this verified final inode
        # are removable. Other files, symlinks and unrelated temporary writes
        # stay untouched, including another registration's unfinished copy.
        for name in os.listdir(directory_fd):
            if not name.startswith(prefix):
                continue
            try:
                alias = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
            except FileNotFoundError:
                continue
            if (stat.S_ISREG(alias.st_mode) and
                    (alias.st_dev, alias.st_ino) == (info.st_dev, info.st_ino)):
                try:
                    os.unlink(name, dir_fd=directory_fd)
                except FileNotFoundError:
                    pass
        current = os.stat(path.name, dir_fd=directory_fd, follow_symlinks=False)
        settled = os.fstat(stream.fileno())
        _need(stat.S_ISREG(current.st_mode) and
              (current.st_dev, current.st_ino) == (info.st_dev, info.st_ino) and
              (settled.st_size, settled.st_mtime_ns) == (info.st_size, info.st_mtime_ns),
              "PUBLISHED_FILE_CHANGED")
        _need(settled.st_nlink == 1, "PUBLICATION_LINKS_UNSETTLED")
        os.fsync(stream.fileno())
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def _publish_file(origin, target, record):
    destination = _payload(target, record)
    if destination.exists() or destination.is_symlink():
        with _delivery(target, record).open() as retained:
            _settle_publication(destination, retained, ".document-")
        return
    fd, temporary = tempfile.mkstemp(prefix=".document-", dir=destination.parent)
    try:
        with os.fdopen(fd, "wb") as output, _delivery(origin, record).open() as source:
            before = os.fstat(source.fileno())
            count, checksum = 0, hashlib.sha256()
            while block := source.read(_CHUNK):
                count += len(block)
                _need(count <= record["bytes"], "SOURCE_CHANGED_DURING_COPY")
                checksum.update(block)
                output.write(block)
            _need(count == record["bytes"] and checksum.hexdigest() == record["sha256"] and
                  _signature(before) == _signature(os.fstat(source.fileno())),
                  "SOURCE_CHANGED_DURING_COPY")
            output.flush()
            os.fsync(output.fileno())
        try:
            os.link(temporary, destination)
            sync_directory(destination.parent)
        except FileExistsError:
            # Another identical registration may have published first. Existing
            # custody is verified and reused; it is never replaced.
            with _delivery(target, record).open():
                pass
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass

    with _delivery(target, record).open() as retained:
        _settle_publication(destination, retained, ".document-")


def document_path(directory, document_id):
    """Resolve an original document ID in the current (possibly restored) DB."""
    _need(isinstance(document_id, str) and _HASH.fullmatch(document_id), "ID_INVALID")
    root = private_directory(Path(directory), create=False)
    collection = root / DIRECTORY
    _need(private_directory(collection, create=False) == collection, "DIRECTORY_CHANGED")
    selected = collection / document_id
    _need(private_directory(selected, create=False) == selected, "DIRECTORY_CHANGED")
    return selected / "source.json"


def retain_document(manifest_file, directory):
    """Copy one exact reviewed source closure; publish its original manifest last.

    Interrupted copies resume by verifying already-published content addresses.
    Nothing opens a provider or changes another source registration.
    """
    manifest_file = Path(manifest_file).expanduser().absolute()
    manifest, raw = _manifest(manifest_file)
    document_id = digest(raw)
    origin = _root(manifest_file.parent)
    root = private_directory(Path(directory), create=False)
    collection = private_directory(root / DIRECTORY)
    _need(collection == root / DIRECTORY, "DIRECTORY_CHANGED")
    target = private_directory(collection / document_id)
    _need(target == collection / document_id, "DIRECTORY_CHANGED")
    private_directory(target / "files")
    for record in _unique_files(manifest):
        _publish_file(origin, target, record)
    # Source metadata cannot change while its files are being retained.
    after = read(manifest_file, MAX_MANIFEST_BYTES)
    _need(after == raw, "MANIFEST_CHANGED_DURING_COPY")
    destination = target / "source.json"
    try:
        write(destination, raw, exclusive=True)
    except FileExistsError:
        _need(read(destination, MAX_MANIFEST_BYTES) == raw, "MANIFEST_IDENTITY_CHANGED")
    manifest_delivery = FileDelivery({"returncode": 0, "native": {
        "status": "RETAINED_SOURCE_DOCUMENT",
        "file": {"path": str(destination), "bytes": len(raw), "sha256": document_id,
                 "contentType": "application/json"},
    }}, destination, MAX_MANIFEST_BYTES)
    with manifest_delivery.open() as retained:
        _settle_publication(destination, retained, ".write-")
    # Make both complete publication and newly created ancestry durable before
    # the caller can register this source in the original SQLite database.
    for completed_directory in (target / "files", target, collection, root):
        sync_directory(completed_directory)
    return {"document_id": document_id, "manifest": str(destination), "bytes": len(raw),
            "title": manifest["title"], "format": manifest["format"]}


def read_document_source(paths, format=None):
    """Return the existing ResponseSource constructor inputs from retained bytes."""
    manifest_file = Path(paths["manifest"]).expanduser().absolute()
    manifest, raw = _manifest(manifest_file)
    root = _root(manifest_file.parent)
    document_id = digest(raw)
    if paths.get("document_id") is not None:
        _need(paths["document_id"] == document_id, "REGISTERED_ID_CHANGED")
    _need(format is None or format == manifest["format"], "SELECTED_FORMAT_MISMATCH")
    inputs = [{"role": "source-document", "path": str(manifest_file),
               "bytes": len(raw), "sha256": document_id}]
    for record in manifest["originals"]:
        delivery = _delivery(root, record)
        with delivery.open():
            pass
        inputs.append({"role": record["role"], "path": str(delivery.expected_destination),
                       "bytes": record["bytes"], "sha256": record["sha256"]})
    context = {
        "nativeKind": "RETAINED_SOURCE_DOCUMENT",
        "nativeStatus": "RETAINED",
        "transportComplete": manifest["complete"],
        "documentId": document_id, "title": manifest["title"],
        "provenance": manifest["provenance"],
        "originalDocuments": [{key: value for key, value in record.items() if key != "path"}
                              for record in manifest["originals"]],
    }
    return _delivery(root, manifest["document"]), None, manifest["format"], inputs, context


def allowed_document_payload(relative):
    """Exact data-only path grammar for the original WorkspaceArchives owner."""
    return isinstance(relative, str) and bool(re.fullmatch(
        r"analysis-response-documents/[a-f0-9]{64}/(?:source\.json|files/[a-f0-9]{64}\.(?:json|csv|bin|txt))",
        relative))


def retained_document_files(directory, document_id):
    """Verified file descriptors for one DB-referenced document, with no abs paths.

    WorkspaceArchives calls this from its existing SQLite snapshot selection.
    The returned data-only names are relative to that same database directory.
    """
    manifest_path = document_path(directory, document_id)
    manifest, raw = _manifest(manifest_path)
    _need(digest(raw) == document_id, "REGISTERED_ID_CHANGED")
    prefix = DIRECTORY + "/" + document_id + "/"
    records = [{"path": prefix + "source.json", "bytes": len(raw), "sha256": document_id}]
    for item in _unique_files(manifest):
        with _delivery(manifest_path.parent, item).open():
            pass
        records.append({"path": prefix + item["path"], "bytes": item["bytes"], "sha256": item["sha256"]})
    return sorted(records, key=lambda item: item["path"])


def snapshot_document_files(directory, connection):
    """Select all original registered document revisions in the owner's snapshot."""
    exists = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='sf_analysis_response_sources'"
    ).fetchone()
    if exists is None:
        return []
    documents = set()
    for row in connection.execute("SELECT record FROM sf_analysis_response_sources ORDER BY name,revision"):
        source = parse(row[0].encode())
        if source.get("input_kind") == "document":
            document_id = source.get("document_id")
            _need(isinstance(document_id, str) and _HASH.fullmatch(document_id), "REGISTERED_ID_INVALID")
            documents.add(document_id)
    result = {}
    for document_id in sorted(documents):
        for item in retained_document_files(directory, document_id):
            previous = result.get(item["path"])
            _need(previous is None or previous == item, "SNAPSHOT_IDENTITY_CONFLICT")
            result[item["path"]] = item
    return [result[path] for path in sorted(result)]
