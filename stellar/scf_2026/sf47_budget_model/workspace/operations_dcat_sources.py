"""Complete .ckanw transport custody inside the original Operations source writer.

This validates framing and retained bytes only. The original Node workspace
receiver and DCAT domain remain the catalogue and review authorities.
"""
from __future__ import annotations

import gzip
import hashlib
import io
import json
import posixpath
import re
import struct
import zipfile
import zlib

from model import Problem
import operations_domain as domain

ACTION = "dcat-source.add"
SCHEMA = "stellar-forge.operations-dcat-source.v1"
ARCHIVE_SCHEMA = "stellar-forge.ckan-workspace-archive.v1"
OPERATIONS_SCHEMA = "stellar-forge.sf47-operations.v1"
MAX_SOURCE = 128 * 1024 * 1024
MAX_TOTAL = 256 * 1024 * 1024
MAX_BUNDLE = 320 * 1024 * 1024
MAX_JSON_REQUEST = ((MAX_SOURCE + 2) // 3) * 4 + 1024 * 1024
MAX_ORDINARY_TOTAL = 24 * 1024 * 1024
MAX_ORDINARY_BUNDLE = 32 * 1024 * 1024
MAX_MANIFEST = 32 * 1024 * 1024
MAX_EXPANDED = 8 * 1024 * 1024 * 1024
MAX_MEMBERS = 100000
MAGIC = b"SCF-CKAN-WORKSPACE/1\n"
HASH = re.compile(r"[a-f0-9]{64}")
ROOTS = {"editions", "sources", "publications", "datasets", "merchant-packages",
         "buyer-requests", "seller-releases", "transfers", "refreshes", "dcat",
         "remote", "capture-plans"}
INTERNAL = {"publisher.lock", ".ckan-receive.json", "workspace-archives", "workspace-incoming"}


def fail(message, code="DCAT_SOURCE_INVALID", status=422):
    raise Problem(message, status, code)


def integer(value, maximum):
    return type(value) is int and 0 <= value <= maximum


def object_pairs(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            fail("The retained transport metadata repeats a JSON key.")
        value[key] = item
    return value


def json_value(raw):
    return json.loads(raw.decode("utf-8"), object_pairs_hook=object_pairs,
                      parse_constant=lambda value: fail("Use finite JSON metadata."))


def member(value):
    if (not isinstance(value, str) or not value or
            len(value.encode("utf-16-be")) // 2 > 4096 or "\\" in value or
            re.search(r"[\x00-\x1f\x7f]", value) or value.startswith("/") or
            posixpath.normpath(value) != value or
            any(part in ("", ".", "..") for part in value.split("/"))):
        fail("Use the original relative workspace member path.")
    return value


def omitted(path):
    parts = path.split("/")
    leaf = parts[-1]
    if len(parts) == 1 and leaf in INTERNAL:
        return True
    if leaf in ("publisher.lock", "writer.lease", "writer.lock") or leaf.endswith(".sock"):
        return True
    if parts[0] == "seller-releases":
        if len(parts) == 2 and parts[1] not in ("state.json", "releases", "ckan-packages"):
            return True
        if parts[1:2] == ["releases"] and len(parts) == 4 and leaf == "pilot-runtime.json":
            return True
    return False


def exact_read(stream, count):
    value = stream.read(count)
    if len(value) != count:
        fail("The complete retained workspace archive is truncated.")
    return value


def inspect(raw):
    if not isinstance(raw, bytes) or not 0 < len(raw) <= MAX_SOURCE:
        fail("A complete DCAT workspace source must be at most 128 MiB.", status=413)
    try:
        with gzip.GzipFile(fileobj=io.BytesIO(raw), mode="rb") as stream:
            header = exact_read(stream, len(MAGIC) + 4)
            if header[:len(MAGIC)] != MAGIC:
                fail("Select the complete original .ckanw gzip-framed workspace.")
            length = struct.unpack(">I", header[len(MAGIC):])[0]
            if not 2 <= length <= MAX_MANIFEST:
                fail("The retained workspace manifest exceeds its original 32 MiB bound.", status=413)
            manifest_raw = exact_read(stream, length)
            manifest = json_value(manifest_raw)
            source = manifest.get("source") if isinstance(manifest, dict) else None
            if (not isinstance(manifest, dict) or manifest.get("schema") != ARCHIVE_SCHEMA
                    or not isinstance(source, dict)
                    or not isinstance(source.get("workbenchSha256"), str)
                    or not HASH.fullmatch(source["workbenchSha256"])
                    or not isinstance(source.get("directory"), str)
                    or not source["directory"].startswith("/")
                    or not isinstance(source.get("projectCreatedAt"), str)
                    or not isinstance(source.get("catalogOrigin"), str)):
                fail("The complete original workspace source binding is required.")
            files, directories = manifest.get("files"), manifest.get("directories")
            if (not isinstance(files, list) or not 1 <= len(files) <= MAX_MEMBERS
                    or not isinstance(directories, list) or len(directories) > MAX_MEMBERS):
                fail("The workspace member inventory exceeds its original bound.")
            dirs = set()
            for name in directories:
                member(name)
                if name in dirs or name == "workbench.json" or name.split("/")[0] not in ROOTS or omitted(name):
                    fail("The workspace directory inventory is invalid.")
                dirs.add(name)
            for name in dirs:
                parent = posixpath.dirname(name)
                if parent and parent not in dirs:
                    fail("The workspace archive omits an original parent directory.")
            names, total, last, state = set(), 0, b"", None
            for entry in files:
                if not isinstance(entry, dict):
                    fail("Retain every original workspace file descriptor.")
                path = member(entry.get("path"))
                ordered = path.encode("utf-16-be")
                if (ordered <= last or path in names or path in dirs or omitted(path)
                        or path != "workbench.json" and path.split("/")[0] not in ROOTS
                        or not isinstance(entry.get("sha256"), str)
                        or not HASH.fullmatch(entry["sha256"])
                        or not integer(entry.get("bytes"), MAX_EXPANDED)):
                    fail("The original workspace file inventory is invalid.")
                parent = posixpath.dirname(path)
                while parent:
                    if parent not in dirs:
                        fail("The workspace file is missing its retained parent directory.")
                    parent = posixpath.dirname(parent)
                names.add(path)
                last = ordered
                total += entry["bytes"]
                if total > MAX_EXPANDED:
                    fail("The original workspace expanded bytes exceed 8 GiB.", status=413)
                if path == "workbench.json":
                    if entry["bytes"] > 16 * 1024 * 1024 or entry["sha256"] != source["workbenchSha256"]:
                        fail("The retained workbench identity differs.")
                    state_raw = exact_read(stream, entry["bytes"])
                    if hashlib.sha256(state_raw).hexdigest() != entry["sha256"]:
                        fail("The complete workbench differs from its retained SHA256.")
                    state = json_value(state_raw)
                else:
                    remaining, checked = entry["bytes"], hashlib.sha256()
                    while remaining:
                        part = exact_read(stream, min(1024 * 1024, remaining))
                        checked.update(part)
                        remaining -= len(part)
                    if checked.hexdigest() != entry["sha256"]:
                        fail("A complete workspace member differs from its retained SHA256.")
            if not integer(manifest.get("totalBytes"), MAX_EXPANDED) or total != manifest["totalBytes"]:
                fail("The original workspace byte inventory differs.")
            if (state is None or not isinstance(state, dict)
                    or state.get("schema") != "stellar-forge.ckan-workbench.v1"
                    or state.get("createdAt") != source["projectCreatedAt"]
                    or state.get("catalogOrigin") != source["catalogOrigin"]
                    or not isinstance(state.get("dcat"), dict)):
                fail("Select a complete workspace containing its original DCAT state.")
            if stream.read(1):
                fail("The workspace archive has trailing unbound expanded bytes.")
            return {"schema": SCHEMA, "archiveSchema": ARCHIVE_SCHEMA,
                    "manifestSha256": hashlib.sha256(manifest_raw).hexdigest(),
                    "workbenchSha256": source["workbenchSha256"], "files": len(files),
                    "unpackedBytes": total,
                    "source": {key: source[key] for key in ("directory", "projectCreatedAt", "catalogOrigin")}}
    except Problem:
        raise
    except (OSError, EOFError, ValueError, TypeError, KeyError, UnicodeError, struct.error, zlib.error) as exc:
        raise Problem("The complete original DCAT workspace transport is unreadable.", 422, "DCAT_SOURCE_INVALID") from exc


def validate_marker(value):
    if (not isinstance(value, dict) or set(value) != {"schema", "archiveSchema", "manifestSha256",
            "workbenchSha256", "files", "unpackedBytes", "source"}
            or value.get("schema") != SCHEMA or value.get("archiveSchema") != ARCHIVE_SCHEMA
            or any(not isinstance(value.get(key), str) or not HASH.fullmatch(value[key])
                   for key in ("manifestSha256", "workbenchSha256"))
            or not integer(value.get("files"), MAX_MEMBERS) or not value["files"]
            or not integer(value.get("unpackedBytes"), MAX_EXPANDED)
            or not isinstance(value.get("source"), dict)
            or set(value["source"]) != {"directory", "projectCreatedAt", "catalogOrigin"}
            or any(not isinstance(value["source"][key], str) for key in value["source"])
            or not value["source"]["directory"].startswith("/")):
        fail("The retained DCAT source transport descriptor is invalid.")
    return value


def validate_source(metadata, raw):
    marker = validate_marker(metadata.get("dcatWorkspace"))
    if (not str(metadata.get("filename", "")).lower().endswith(".ckanw")
            or not isinstance(raw, bytes) or len(raw) != metadata.get("bytes")
            or hashlib.sha256(raw).hexdigest() != metadata.get("sha256")
            or inspect(raw) != marker):
        fail("The complete DCAT source differs from its retained transport receipt.")
    return marker


def source_budget(rows):
    ordinary, dcat, count = 0, 0, 0
    for row in rows:
        count += 1
        size = row.get("bytes") if isinstance(row, dict) else None
        if not integer(size, MAX_TOTAL):
            fail("The retained source byte count is invalid.")
        if "dcatWorkspace" in row:
            validate_marker(row["dcatWorkspace"])
            if size > MAX_SOURCE:
                fail("A DCAT source exceeds 128 MiB.", status=413)
            dcat += size
        else:
            ordinary += size
    if count > 200 or ordinary > MAX_ORDINARY_TOTAL or dcat > MAX_TOTAL:
        fail("Retain at most 200 sources, 24 MiB ordinary bytes and 256 MiB DCAT workspace bytes.", status=413)
    return MAX_BUNDLE if dcat else MAX_ORDINARY_BUNDLE


def validate_events(rows, events):
    originals = {row["id"]: row for row in rows if "dcatWorkspace" in row}
    seen = set()
    for event in events:
        if event.get("action") != ACTION:
            continue
        ident = event.get("recordId")
        if (ident not in originals or ident in seen or event.get("kind") != "source"
                or event.get("before") is not None or event.get("after") != originals[ident]):
            fail("The complete DCAT source does not join its original attachment event.")
        seen.add(ident)
    if seen != set(originals):
        fail("A retained DCAT source is missing its original attachment event.")


def native_bundle(raw):
    """Recognize only the original flat case; report wrappers retain their limits."""
    if not isinstance(raw, bytes) or len(raw) > MAX_BUNDLE:
        fail("The complete Operations case exceeds 320 MiB.", status=413)
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            infos = archive.infolist()
            names = [item.filename for item in infos]
            if len(infos) > 220 or len(names) != len(set(names)):
                fail("The complete Operations member inventory is invalid.")
            if "MANIFEST.json" not in names:
                return False
            info = archive.getinfo("MANIFEST.json")
            if info.file_size > 1024 * 1024:
                fail("The Operations manifest exceeds its native metadata bound.", status=413)
            value = json_value(archive.read(info))
            return isinstance(value, dict) and value.get("schema") == OPERATIONS_SCHEMA + ".bundle"
    except Problem:
        raise
    except (zipfile.BadZipFile, OSError, ValueError, KeyError, RuntimeError) as exc:
        raise Problem("The complete Operations archive is unreadable.", 422, "INVALID_BUNDLE") from exc


def request_limit(path):
    if path == "/api/operations/import":
        return MAX_BUNDLE
    if re.fullmatch(r"/api/operations/operation-[a-f0-9]{32}/dcat-source", path):
        return MAX_JSON_REQUEST
    return MAX_ORDINARY_BUNDLE
