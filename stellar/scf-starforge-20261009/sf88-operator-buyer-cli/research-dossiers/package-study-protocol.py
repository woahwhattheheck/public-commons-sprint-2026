#!/usr/bin/env python3
"""Transfer the completed original Research protocol delivery; Python 3.11/Linux.

Capture, SourceBundle validation, dossier receiving and portable reopen stay
in the original Research engine. This helper only verifies selected bytes,
packages them, and materializes a verified archive in a fresh directory.
"""
from __future__ import annotations
import argparse
import contextlib
import ctypes
import errno
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import unicodedata
import zipfile

SCHEMA = "sf88-study-protocol-delivery/v1"
SOURCE_SCHEMA = "sf88-study-protocol-source/v1"
ENGINE_SCHEMA = "sf88-study-protocol-engine-source/v1"
RESEARCH = "stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers"
SDK = "stellar/scf-starforge-20261009/sf30-seller-sdk"
PROGRAMME = (
    "study-protocol-source.mjs", "study-protocol-methods.mjs",
    "study-protocol-receiving.mjs", "study-protocol-cli.mjs",
    "package-study-protocol.py", "STUDY-PROTOCOL-RECEIVING.md",
)
REQUIRED_ENGINE = (
    "LICENSE", RESEARCH + "/source-bundles.mjs",
    RESEARCH + "/workspace-client.mjs", RESEARCH + "/workspace-files.mjs",
    RESEARCH + "/workspace-cli.mjs", RESEARCH + "/cli.mjs",
    RESEARCH + "/server.mjs", RESEARCH + "/dossier.mjs",
    RESEARCH + "/public/index.html", RESEARCH + "/public/app.js",
    RESEARCH + "/public/style.css",
    "stellar/scf-starforge-20261009/sf88-operator-buyer-cli/node/store.mjs",
    SDK + "/developer/index.html", SDK + "/developer/browser.mjs",
    SDK + "/developer/style.css",
) + tuple(RESEARCH + "/" + name for name in PROGRAMME)
MAX_FILE = 256 * 1024 * 1024
MAX_TOTAL = 512 * 1024 * 1024
MAX_JSON = 16 * 1024 * 1024
MAX_ARCHIVE = MAX_TOTAL + MAX_JSON + 16 * 1024 * 1024
MAX_MEMBERS = 4096
CHUNK = 1024 * 1024
SHA = re.compile(r"^[0-9a-f]{64}$")
ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$")
MANIFEST = "DELIVERY_MANIFEST.json"
FIRST = "OPEN_FIRST.md"
RECEIPT = "RECEIVED_ARCHIVE.json"


class DeliveryError(Exception):
    def __init__(self, code, detail=None):
        super().__init__(code)
        self.code, self.detail = code, detail


def need(condition, code, detail=None):
    if not condition:
        raise DeliveryError(code, detail)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def json_bytes(value):
    return (json.dumps(value, sort_keys=True, ensure_ascii=False,
                       indent=2, allow_nan=False) + "\n").encode("utf-8")


def parse_json(raw):
    need(len(raw) <= MAX_JSON, "DELIVERY_JSON_TOO_LARGE")
    def pairs(items):
        result = {}
        for key, value in items:
            need(key not in result, "DELIVERY_DUPLICATE_JSON_KEY", key)
            result[key] = value
        return result
    def invalid(value):
        raise DeliveryError("DELIVERY_INVALID_JSON_NUMBER", value)
    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=pairs,
                          parse_constant=invalid)
    except (UnicodeError, json.JSONDecodeError) as error:
        raise DeliveryError("DELIVERY_INVALID_JSON", str(error)) from error


def relname(value):
    need(isinstance(value, str) and 0 < len(value.encode("utf-8")) <= 1024,
         "DELIVERY_MEMBER_NAME_INVALID")
    need(not value.startswith("/") and "\\" not in value and ":" not in value
         and not any(ord(char) < 32 or ord(char) == 127 for char in value)
         and all(part and part not in (".", "..") for part in value.split("/")),
         "DELIVERY_MEMBER_NAME_INVALID", value)
    return value


def unique_names(names):
    names = list(names)
    seen = set()
    for name in names:
        key = unicodedata.normalize("NFC", relname(name)).casefold()
        need(key not in seen, "DELIVERY_DUPLICATE_MEMBER", name)
        seen.add(key)
    for name in names:
        parts = name.split("/")
        for count in range(1, len(parts)):
            parent = unicodedata.normalize("NFC", "/".join(parts[:count])).casefold()
            need(parent not in seen, "DELIVERY_MEMBER_PARENT_IS_FILE", name)


def absolute(value):
    return Path(os.path.abspath(os.fspath(value)))


def check_directories(path):
    for directory in reversed((path,) + tuple(path.parents)):
        info = directory.lstat()
        need(stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode),
             "DELIVERY_DIRECTORY_REQUIRED", str(directory))


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def private_directory(path):
    path = absolute(path)
    missing, cursor = [], path
    while not cursor.exists():
        need(not cursor.is_symlink(), "DELIVERY_SYMLINK_REFUSED", str(cursor))
        missing.append(cursor)
        cursor = cursor.parent
    check_directories(cursor)
    for directory in reversed(missing):
        try:
            directory.mkdir(mode=0o700)
        except FileExistsError:
            pass
        check_directories(directory)
        sync_directory(directory.parent)
    return path


def stat_identity(value):
    return (value.st_dev, value.st_ino, value.st_size,
            value.st_mtime_ns, value.st_ctime_ns)


@contextlib.contextmanager
def regular_reader(path, limit=MAX_FILE):
    path = absolute(path)
    check_directories(path.parent)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as handle:
        before = os.fstat(handle.fileno())
        need(stat.S_ISREG(before.st_mode), "DELIVERY_REGULAR_FILE_REQUIRED", str(path))
        need(before.st_size <= limit, "DELIVERY_FILE_TOO_LARGE", str(path))
        try:
            yield handle
        finally:
            after, current = os.fstat(handle.fileno()), path.lstat()
            need(stat_identity(before) == stat_identity(after) and
                 current.st_dev == before.st_dev and current.st_ino == before.st_ino and
                 stat.S_ISREG(current.st_mode),
                 "DELIVERY_SOURCE_CHANGED_DURING_READ", str(path))


def read_bytes(path, limit=MAX_JSON):
    with regular_reader(path, limit) as handle:
        raw = handle.read(limit + 1)
    need(len(raw) <= limit, "DELIVERY_FILE_TOO_LARGE", str(path))
    return raw


def file_identity(path, limit=MAX_FILE):
    total, hasher = 0, hashlib.sha256()
    with regular_reader(path, limit) as handle:
        while part := handle.read(CHUNK):
            total += len(part)
            need(total <= limit, "DELIVERY_FILE_TOO_LARGE", str(path))
            hasher.update(part)
    return {"bytes": total, "sha256": hasher.hexdigest()}


def same_bytes(actual, expected, code, name):
    need(isinstance(actual, dict) and isinstance(expected, dict) and
         type(actual.get("bytes")) is int and type(expected.get("bytes")) is int and
         isinstance(actual.get("sha256"), str) and isinstance(expected.get("sha256"), str) and
         actual["bytes"] == expected["bytes"] and actual["sha256"] == expected["sha256"],
         code, name)


def descriptor(row, field="file"):
    need(isinstance(row, dict), "DELIVERY_DESCRIPTOR_REQUIRED")
    name = relname(row.get(field))
    size, checksum = row.get("bytes"), row.get("sha256")
    need(type(size) is int and 0 <= size <= MAX_FILE and
         isinstance(checksum, str) and SHA.fullmatch(checksum),
         "DELIVERY_DESCRIPTOR_INVALID", name)
    return {"name": name, "bytes": size, "sha256": checksum}


def private_mode(source_mode):
    return 0o700 if source_mode == "100755" else 0o600


def mode(value):
    need(value in ("100644", "100755"), "DELIVERY_SOURCE_MODE_INVALID", value)
    return value


def table(rows, field="file"):
    need(isinstance(rows, list) and 0 < len(rows) <= MAX_MEMBERS,
         "DELIVERY_FILE_LIST_REQUIRED")
    values = [descriptor(row, field) for row in rows]
    unique_names(row["name"] for row in values)
    need(sum(row["bytes"] for row in values) <= MAX_TOTAL, "DELIVERY_TOTAL_TOO_LARGE")
    return {row["name"]: row for row in values}


def immutable_bytes(path, data):
    """Publish complete control bytes create-only; recover its exact staging name."""
    private_directory(path.parent)
    temporary = path.parent / ("." + path.name + ".write-" + digest(data))
    try:
        previous = read_bytes(path)
    except FileNotFoundError:
        previous = None
    if previous is not None:
        need(previous == data, "DELIVERY_RETAINED_FILE_CHANGED", str(path))
        if temporary.exists() or temporary.is_symlink():
            need(read_bytes(temporary) == data, "DELIVERY_STAGING_CHANGED", str(temporary))
            remove_owned_temporary(temporary, MAX_JSON)
        return
    if temporary.exists() or temporary.is_symlink():
        retained = read_bytes(temporary)
        need(len(retained) <= len(data) and retained == data[:len(retained)],
             "DELIVERY_STAGING_CHANGED", str(temporary))
        if retained != data:
            remove_owned_temporary(temporary, MAX_JSON)
    if not temporary.exists():
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        sync_directory(path.parent)
    need(read_bytes(temporary) == data, "DELIVERY_STAGING_CHANGED", str(temporary))
    try:
        os.link(temporary, path, follow_symlinks=False)
        sync_directory(path.parent)
    except FileExistsError:
        need(read_bytes(path) == data, "DELIVERY_RETAINED_FILE_CHANGED", str(path))
    remove_owned_temporary(temporary, MAX_JSON)


def remove_owned_temporary(path, limit):
    """Only call for a private staging name bound by a held frozen selection."""
    check_directories(path.parent)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        opened, named = os.fstat(fd), path.lstat()
        need(stat.S_ISREG(opened.st_mode) and opened.st_size <= limit and
             (named.st_dev, named.st_ino) == (opened.st_dev, opened.st_ino),
             "DELIVERY_STAGING_CHANGED", str(path))
        path.unlink()
        sync_directory(path.parent)
    finally:
        os.close(fd)


@contextlib.contextmanager
def held_lock(path):
    private_directory(path.parent)
    fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    try:
        info = os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and
             info.st_uid == os.geteuid() and (info.st_mode & 0o077) == 0,
             "DELIVERY_LOCK_INVALID")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise DeliveryError("DELIVERY_OPERATION_ACTIVE") from error
        yield
    finally:
        os.close(fd)


def validate_receiving(raw, read):
    """Bind original receipts; original engine validators remain authoritative."""
    result = parse_json(raw)
    need(isinstance(result, dict) and result.get("schema") == SOURCE_SCHEMA and
         result.get("state") == "RECEIVED_AND_EXPORTED", "PROTOCOL_RECEIVING_REQUIRED")
    for key in ("operation", "workspaceId", "dossierId", "questionId", "editionId"):
        need(isinstance(result.get(key), str) and ID.fullmatch(result[key]),
             "PROTOCOL_RECEIVING_ID_INVALID", key)
    need(re.fullmatch(r"research_[0-9a-f]{64}", result["workspaceId"]),
         "PROTOCOL_WORKSPACE_INVALID")
    for key in ("baseRevision", "revision"):
        need(type(result.get(key)) is int and result[key] >= 1, "PROTOCOL_REVISION_INVALID", key)
    need(result["revision"] >= result["baseRevision"], "PROTOCOL_REVISION_INVALID")
    need(isinstance(result.get("bundleSha256"), str) and SHA.fullmatch(result["bundleSha256"]),
         "PROTOCOL_BUNDLE_HASH_INVALID")
    files = table(result.get("files"))
    def doc(name):
        need(name in files, "PROTOCOL_DELIVERY_MEMBER_MISSING", name)
        value = read(name, MAX_JSON)
        same_bytes({"bytes": len(value), "sha256": digest(value)}, files[name],
                   "PROTOCOL_DELIVERY_MEMBER_CHANGED", name)
        parsed = parse_json(value)
        need(isinstance(parsed, dict), "PROTOCOL_RECEIPT_OBJECT_REQUIRED", name)
        return parsed
    required = (
        "source-bundle.json", "Research_Dossier.json.gz", "Research_Report.html",
        "Research_Report.md", "receiving-selection.json", "records/baseline.json",
        "records/received.json", "records/source-binding.json",
        "original-source/CAPTURE_COMPLETE.json", "original-source/source-selection.json",
        "original-source/source-manifest.json", "original-source/source-bundle.json",
        "original-source/index.html", "original-source/protocol-pages.txt",
        "original-source/protocol-pages.json", "original-source/protocol-methods.json",
        "original-source/protocol-source.json", "original-source/registered-document.json",
        "ENGINE_SOURCE.json",
    ) + tuple("programme-source/" + name for name in PROGRAMME)
    need(all(name in files for name in required), "PROTOCOL_DELIVERY_INCOMPLETE",
         [name for name in required if name not in files])
    selection = doc("receiving-selection.json")
    for key in ("operation", "workspaceId", "dossierId", "questionId", "baseRevision", "bundleSha256"):
        need(selection.get(key) == result[key], "PROTOCOL_RECEIVING_SELECTION_CHANGED", key)
    baseline, received = doc("records/baseline.json"), doc("records/received.json")
    binding = doc("records/source-binding.json")
    need(baseline.get("id") == result["dossierId"] and
         baseline.get("revision") == result["baseRevision"] and
         isinstance(baseline.get("questions"), list) and
         any(isinstance(q, dict) and q.get("id") == result["questionId"] for q in baseline["questions"]),
         "PROTOCOL_BASELINE_CHANGED")
    need(received.get("id") == result["dossierId"] and received.get("revision") == result["revision"],
         "PROTOCOL_RECEIVED_REVISION_CHANGED")
    for key in ("workspaceId", "dossierId", "questionId", "revision", "editionId", "key", "bundleSha256"):
        need(binding.get(key) == result.get(key), "PROTOCOL_SOURCE_BINDING_CHANGED", key)
    need(result.get("sourceBindingFile") == "records/source-binding.json" and
         result.get("sourceIndex") == "original-source/index.html", "PROTOCOL_SOURCE_REFERENCE_CHANGED")
    portable = result.get("portable")
    need(isinstance(portable, dict) and portable.get("file") == "Research_Dossier.json.gz" and
         portable.get("receiver") == "Original ResearchWorkspaceClient.reopenFile" and
         portable.get("expectedSha256") == files["Research_Dossier.json.gz"]["sha256"],
         "PROTOCOL_PORTABLE_REFERENCE_CHANGED")
    capture, source_selection = doc("original-source/CAPTURE_COMPLETE.json"), doc("original-source/source-selection.json")
    need(capture.get("schema") == SOURCE_SCHEMA and capture.get("state") == "CAPTURED" and
         capture.get("operation") == result["operation"] and
         capture.get("bundleSha256") == result["bundleSha256"] and
         capture.get("bundleBytes") == files["source-bundle.json"]["bytes"] and
         source_selection.get("operation") == result["operation"] and
         source_selection.get("methodsSha256") == capture.get("methodsSha256"),
         "PROTOCOL_CAPTURE_SELECTION_CHANGED")
    need(files["source-bundle.json"]["sha256"] == result["bundleSha256"], "PROTOCOL_BUNDLE_CHANGED")
    same_bytes(files["source-bundle.json"], files["original-source/source-bundle.json"],
               "PROTOCOL_CAPTURE_BUNDLE_CHANGED", "source-bundle.json")
    for key in ("registry", "protocol"):
        need(capture.get(key) == result.get(key), "PROTOCOL_ORIGINAL_SOURCE_CHANGED", key)
        original = descriptor(result.get(key), "filename" if key == "registry" else "name")
        target = "original-source/" + original["name"]
        need(target in files, "PROTOCOL_ORIGINAL_SOURCE_MISSING", target)
        same_bytes(files[target], original, "PROTOCOL_ORIGINAL_SOURCE_CHANGED", target)
    captured_files = table(capture.get("files"), "name")
    need(len(captured_files) == 10, "PROTOCOL_CAPTURE_INVENTORY_CHANGED")
    for name, original in captured_files.items():
        target = "original-source/" + name
        need(target in files, "PROTOCOL_CAPTURE_MEMBER_MISSING", target)
        same_bytes(files[target], original, "PROTOCOL_CAPTURE_MEMBER_CHANGED", target)
    engine = doc("ENGINE_SOURCE.json")
    need(engine.get("schema") == ENGINE_SCHEMA and engine.get("engineRoot") == "engine-source",
         "PROTOCOL_ENGINE_SOURCE_REQUIRED")
    need(bool(engine.get("sourceCohort")) and isinstance(engine.get("repository"), str) and
         bool(engine["repository"]), "PROTOCOL_ENGINE_PROVENANCE_REQUIRED")
    engine_files = table(engine.get("files"), "path")
    need(engine.get("sourceFiles") == len(engine_files) and
         engine.get("sourceBytes") == sum(row["bytes"] for row in engine_files.values()),
         "PROTOCOL_ENGINE_INVENTORY_CHANGED")
    overlays = table(engine.get("overlays"), "path")
    need(set(overlays) == {RESEARCH + "/" + name for name in PROGRAMME},
         "PROTOCOL_ENGINE_OVERLAYS_CHANGED")
    for name, row in overlays.items():
        need(name in engine_files, "PROTOCOL_ENGINE_OVERLAY_MISSING", name)
        same_bytes(row, engine_files[name], "PROTOCOL_ENGINE_OVERLAY_CHANGED", name)
    engine_rows = {row["path"]: row for row in engine["files"]}
    for row in engine["overlays"]:
        need(row == engine_rows.get(row["path"]), "PROTOCOL_ENGINE_OVERLAY_CHANGED", row["path"])
    selected_engine = engine.get("engineSelection")
    if selected_engine is None:
        need(len(engine_files) == 292 and result.get("engineSelection") is None,
             "PROTOCOL_ENGINE_INVENTORY_CHANGED")
    else:
        selection_ref = descriptor(selected_engine)
        need(selection_ref["name"] == "records/engine-selection.json" and
             selected_engine == result.get("engineSelection"),
             "PROTOCOL_ENGINE_SELECTION_CHANGED")
        selection_name = selection_ref["name"]
        selected = doc(selection_name)
        same_bytes(files[selection_name], selection_ref,
                   "PROTOCOL_ENGINE_SELECTION_CHANGED", selection_name)
        selected_files = table(selected.get("files"), "path")
        need(isinstance(selected.get("id"), str) and ID.fullmatch(selected["id"]) and
             isinstance(selected.get("repository"), str) and
             re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", selected["repository"]) and
             isinstance(selected.get("ref"), str) and
             re.fullmatch(r"[0-9a-f]{40}", selected["ref"]) and
             type(selected.get("baseFiles")) is int and
             selected["baseFiles"] == len(selected_files) and
             type(selected.get("baseBytes")) is int and
             selected["baseBytes"] == sum(row["bytes"] for row in selected_files.values()),
             "PROTOCOL_ENGINE_COHORT_INVENTORY_CHANGED")
        cohort_metadata = {key: value for key, value in selected.items() if key != "files"}
        need(engine["sourceCohort"] == cohort_metadata and
             engine["repository"] == selected["repository"] and engine.get("ref") == selected["ref"],
             "PROTOCOL_ENGINE_PROVENANCE_CHANGED")
        need(set(engine_files) == set(selected_files) | set(overlays),
             "PROTOCOL_ENGINE_INVENTORY_CHANGED")
        for row in selected["files"]:
            need(row == engine_rows.get(row["path"]),
                 "PROTOCOL_ENGINE_SELECTED_SOURCE_CHANGED", row["path"])
    need(all(name in engine_files for name in REQUIRED_ENGINE), "PROTOCOL_ENGINE_SOURCE_INCOMPLETE",
         [name for name in REQUIRED_ENGINE if name not in engine_files])
    modes = {}
    for row in engine["files"]:
        destination = "engine-source/" + row["path"]
        need(destination in files, "PROTOCOL_ENGINE_MEMBER_MISSING", destination)
        same_bytes(files[destination], engine_files[row["path"]], "PROTOCOL_ENGINE_MEMBER_CHANGED", destination)
        modes[destination] = mode(row.get("mode"))
    need({name for name in files if name.startswith("engine-source/")} == set(modes),
         "PROTOCOL_ENGINE_INVENTORY_CHANGED")
    for name in PROGRAMME:
        same_bytes(files["programme-source/" + name],
                   files["engine-source/" + RESEARCH + "/" + name],
                   "PROTOCOL_PROGRAMME_EDITION_CHANGED", name)
    identity = {key: result[key] for key in (
        "operation", "workspaceId", "dossierId", "questionId",
        "baseRevision", "revision", "editionId", "key", "bundleSha256")}
    identity.update({"registry": result["registry"], "protocol": result["protocol"],
                     "portableSha256": portable["expectedSha256"],
                     "engineSourceSha256": files["ENGINE_SOURCE.json"]["sha256"],
                     "engineFiles": len(engine_files)})
    return {"identity": identity, "files": files, "modes": modes, "receiving": result}


def opening_guide(identity):
    text = """# Registered protocol and Research dossier

Open [the complete protocol source](receiving/original-source/index.html) or
[the saved Research report](receiving/Research_Report.html).

The original PDF, registry JSON, page text, methods index and exact source
bundle are retained under receiving/. The editable dossier is
receiving/Research_Dossier.json.gz. Its original Research engine, public
assets, licence and six protocol programme files are included.

Read [the installation and continuation guide](receiving/programme-source/STUDY-PROTOCOL-RECEIVING.md).
Use the original Research client to reopen the portable dossier in the
selected existing workspace. Extracting this archive alone does not import
or change an application workspace.

## Saved identities

| Identity | Retained value |
|---|---|
"""
    labels = (
        ("Operation", "operation"), ("Original workspace", "workspaceId"),
        ("Dossier", "dossierId"), ("Question", "questionId"),
        ("Baseline revision", "baseRevision"), ("Exported revision", "revision"),
        ("Source edition", "editionId"), ("Bundle SHA-256", "bundleSha256"),
        ("Portable SHA-256", "portableSha256"), ("Engine selection SHA-256", "engineSourceSha256"),
    )
    for label, key in labels:
        text += "| " + label + " | " + str(identity[key]) + " |\n"
    text += """
DELIVERY_MANIFEST.json names every included byte sequence and original source mode.
Extracted files use private permissions (0600; 0700 for executable source).
The accompanying archive receipt supplies the SHA-256 of the complete ZIP.
The packager's inspect command verifies the full manifest and original
receiving bindings; receive materializes a verified copy into a fresh
directory. Neither command contacts a provider or starts a service.

Protocol notes describe planned methods. The original appraisal and review
workflows retain responsibility for reviewed interpretations and decisions.
Original sponsor notices remain in the PDF; the included application licence
applies to application source.
"""
    return text.encode("utf-8")


def make_selection(root):
    check_directories(root)
    raw = read_bytes(root / "RECEIVING_COMPLETE.json")
    contract = validate_receiving(raw, lambda name, limit: read_bytes(root / relname(name), limit))
    sources = {"receiving/RECEIVING_COMPLETE.json": raw}
    rows = [{"name": "receiving/RECEIVING_COMPLETE.json", "bytes": len(raw),
             "sha256": digest(raw), "mode": "100644"}]
    for name, expected in contract["files"].items():
        source = root / name
        same_bytes(file_identity(source), expected, "PROTOCOL_DELIVERY_MEMBER_CHANGED", name)
        output = "receiving/" + name
        rows.append({"name": output, "bytes": expected["bytes"], "sha256": expected["sha256"],
                     "mode": contract["modes"].get(name, "100644")})
        sources[output] = source
    guide = opening_guide(contract["identity"])
    sources[FIRST] = guide
    rows.append({"name": FIRST, "bytes": len(guide), "sha256": digest(guide), "mode": "100644"})
    rows.sort(key=lambda row: row["name"])
    unique_names([row["name"] for row in rows] + [MANIFEST])
    need(len(rows) + 1 <= MAX_MEMBERS and sum(row["bytes"] for row in rows) <= MAX_TOTAL,
         "DELIVERY_TOTAL_TOO_LARGE")
    core = {"schema": SCHEMA, "state": "COMPLETE_SOURCE_AND_RECEIVING",
            "identity": contract["identity"], "files": rows,
            "format": {"container": "zip", "compression": "stored",
                       "timestamp": "1980-01-01T00:00:00", "paths": "relative",
                       "permissions": "private-0600-0700"}}
    return {**core, "selectionSha256": digest(canonical(core))}, sources


def validate_manifest(raw):
    value = parse_json(raw)
    need(isinstance(value, dict) and value.get("schema") == SCHEMA and
         value.get("state") == "COMPLETE_SOURCE_AND_RECEIVING", "DELIVERY_MANIFEST_INVALID")
    need(set(value) == {"schema", "state", "identity", "files", "format", "selectionSha256"},
         "DELIVERY_MANIFEST_FIELDS_CHANGED")
    need(value.get("format") == {"container": "zip", "compression": "stored",
         "timestamp": "1980-01-01T00:00:00", "paths": "relative",
                       "permissions": "private-0600-0700"}, "DELIVERY_FORMAT_CHANGED")
    core = {key: item for key, item in value.items() if key != "selectionSha256"}
    need(value.get("selectionSha256") == digest(canonical(core)) and raw == json_bytes(value),
         "DELIVERY_MANIFEST_CHANGED")
    files = table(value.get("files"), "name")
    need(MANIFEST not in files and FIRST in files and "receiving/RECEIVING_COMPLETE.json" in files and
         all(name == FIRST or name.startswith("receiving/") for name in files),
         "DELIVERY_PAYLOAD_ROOT_CHANGED")
    for row in value["files"]:
        need(set(row) == {"name", "bytes", "sha256", "mode"}, "DELIVERY_DESCRIPTOR_FIELDS_CHANGED")
        files[row["name"]]["mode"] = mode(row.get("mode"))
    return value, files


def archive_info(archive, expected_sha256=None, expected_manifest=None):
    if expected_sha256 is not None:
        need(SHA.fullmatch(expected_sha256), "DELIVERY_EXPECTED_HASH_INVALID")
    with regular_reader(archive, MAX_ARCHIVE) as handle:
        hasher, size = hashlib.sha256(), 0
        while part := handle.read(CHUNK):
            hasher.update(part)
            size += len(part)
        checksum = hasher.hexdigest()
        need(expected_sha256 is None or checksum == expected_sha256, "DELIVERY_ARCHIVE_HASH_CHANGED")
        handle.seek(0)
        with zipfile.ZipFile(handle, "r") as zipped:
            entries = zipped.infolist()
            need(0 < len(entries) <= MAX_MEMBERS, "DELIVERY_ARCHIVE_INVENTORY_INVALID")
            names = [entry.filename for entry in entries]
            unique_names(names)
            need(zipped.comment == b"", "DELIVERY_ARCHIVE_COMMENT_UNEXPECTED")
            need(MANIFEST in names, "DELIVERY_MANIFEST_MISSING")
            manifest_entry = zipped.getinfo(MANIFEST)
            need(manifest_entry.file_size <= MAX_JSON and
                 manifest_entry.compress_type == zipfile.ZIP_STORED, "DELIVERY_MANIFEST_TOO_LARGE")
            raw = zipped.read(MANIFEST)
            manifest, files = validate_manifest(raw)
            if expected_manifest is not None:
                need(manifest == expected_manifest, "DELIVERY_SELECTION_CHANGED")
            need(set(names) == set(files) | {MANIFEST} and names == sorted(names),
                 "DELIVERY_ARCHIVE_INVENTORY_CHANGED")
            selected = {**files, MANIFEST: {"bytes": len(raw), "sha256": digest(raw), "mode": "100644"}}
            for entry in entries:
                expected = selected[entry.filename]
                wanted_mode = stat.S_IFREG | private_mode(expected["mode"])
                need(not entry.is_dir() and entry.compress_type == zipfile.ZIP_STORED and
                     not (entry.flag_bits & 1) and entry.date_time == (1980, 1, 1, 0, 0, 0) and
                     entry.create_system == 3 and (entry.external_attr >> 16) == wanted_mode and
                     entry.file_size == expected["bytes"] and entry.compress_size == expected["bytes"] and
                     entry.extra == b"" and entry.comment == b"",
                     "DELIVERY_ARCHIVE_MEMBER_METADATA_CHANGED", entry.filename)
                total, body_hash = 0, hashlib.sha256()
                with zipped.open(entry, "r") as member:
                    while part := member.read(CHUNK):
                        total += len(part)
                        need(total <= expected["bytes"], "DELIVERY_ARCHIVE_MEMBER_TOO_LARGE", entry.filename)
                        body_hash.update(part)
                same_bytes({"bytes": total, "sha256": body_hash.hexdigest()}, expected,
                           "DELIVERY_ARCHIVE_MEMBER_CHANGED", entry.filename)
            complete_name = "receiving/RECEIVING_COMPLETE.json"
            def read_receiving(name, limit):
                full = "receiving/" + relname(name)
                need(full in files and files[full]["bytes"] <= limit, "DELIVERY_RECEIPT_MEMBER_INVALID", full)
                return zipped.read(full)
            contract = validate_receiving(zipped.read(complete_name), read_receiving)
            need(contract["identity"] == manifest["identity"], "DELIVERY_RECEIVING_IDENTITY_CHANGED")
            expected_names = {"receiving/" + name for name in contract["files"]}
            need(set(files) == expected_names | {complete_name, FIRST}, "DELIVERY_RECEIVING_INVENTORY_CHANGED")
            for name, row in contract["files"].items():
                selected_row = files["receiving/" + name]
                same_bytes(selected_row, row, "DELIVERY_RECEIVING_MEMBER_CHANGED", name)
                need(selected_row["mode"] == contract["modes"].get(name, "100644"),
                     "DELIVERY_RECEIVING_MODE_CHANGED", name)
            need(zipped.read(FIRST) == opening_guide(contract["identity"]), "DELIVERY_OPENING_GUIDE_CHANGED")
    return {"schema": SCHEMA, "state": "VERIFIED",
            "archive": {"filename": archive.name, "bytes": size, "sha256": checksum},
            "manifest": {"filename": MANIFEST, "bytes": len(raw), "sha256": digest(raw),
                         "selectionSha256": manifest["selectionSha256"]},
            "identity": manifest["identity"], "members": len(entries), "manifestValue": manifest}


def public_info(info):
    return {key: value for key, value in info.items() if key != "manifestValue"}


def archive_shape_complete(path):
    with regular_reader(path, MAX_ARCHIVE) as handle:
        try:
            with zipfile.ZipFile(handle, "r") as zipped:
                zipped.infolist()
            return True
        except zipfile.BadZipFile:
            return False


def write_zip(path, manifest, sources):
    raw = json_bytes(manifest)
    selected = {row["name"]: row for row in manifest["files"]}
    selected[MANIFEST] = {"name": MANIFEST, "bytes": len(raw), "sha256": digest(raw), "mode": "100644"}
    sources = {**sources, MANIFEST: raw}
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as handle:
        with zipfile.ZipFile(handle, "w", compression=zipfile.ZIP_STORED, allowZip64=False) as zipped:
            for name in sorted(selected):
                expected = selected[name]
                entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                entry.create_system, entry.compress_type = 3, zipfile.ZIP_STORED
                entry.external_attr = (stat.S_IFREG | (
                    private_mode(expected["mode"]))) << 16
                entry.file_size = expected["bytes"]
                hasher, total = hashlib.sha256(), 0
                with zipped.open(entry, "w") as output:
                    source = sources[name]
                    if isinstance(source, bytes):
                        output.write(source)
                        total = len(source)
                        hasher.update(source)
                    else:
                        with regular_reader(source) as input_file:
                            while part := input_file.read(CHUNK):
                                total += len(part)
                                need(total <= expected["bytes"], "DELIVERY_SOURCE_CHANGED", name)
                                output.write(part)
                                hasher.update(part)
                same_bytes({"bytes": total, "sha256": hasher.hexdigest()}, expected,
                           "DELIVERY_SOURCE_CHANGED", name)
        handle.flush()
        os.fsync(handle.fileno())
    sync_directory(path.parent)


def package_delivery(directory, archive):
    directory, archive = absolute(directory), absolute(archive)
    need(archive.suffix.lower() == ".zip", "DELIVERY_ZIP_FILENAME_REQUIRED")
    private_directory(archive.parent)
    with held_lock(archive.parent / ("." + archive.name + ".lock")):
        manifest, sources = make_selection(directory)
        prepared_path = archive.parent / (archive.name + ".prepared.json")
        immutable_bytes(prepared_path, json_bytes({
            "schema": SCHEMA, "kind": "immutable-package-selection",
            "archiveFilename": archive.name, "manifest": manifest}))
        receipt_path = archive.parent / (archive.name + ".receipt.json")
        try:
            old_receipt = parse_json(read_bytes(receipt_path))
        except FileNotFoundError:
            old_receipt = None
        part = archive.parent / ("." + archive.name + ".part-" + manifest["selectionSha256"])
        if archive.exists() or archive.is_symlink():
            info = archive_info(archive, expected_manifest=manifest)
        else:
            need(old_receipt is None, "DELIVERY_RETAINED_ARCHIVE_MISSING")
            if part.exists() or part.is_symlink():
                if not archive_shape_complete(part):
                    remove_owned_temporary(part, MAX_ARCHIVE)
                    write_zip(part, manifest, sources)
            else:
                write_zip(part, manifest, sources)
            staged = archive_info(part, expected_manifest=manifest)
            try:
                os.link(part, archive, follow_symlinks=False)
                sync_directory(archive.parent)
            except FileExistsError:
                archive_info(archive, expected_sha256=staged["archive"]["sha256"],
                             expected_manifest=manifest)
            info = archive_info(archive, expected_sha256=staged["archive"]["sha256"],
                                expected_manifest=manifest)
        if part.exists() or part.is_symlink():
            archive_info(part, expected_sha256=info["archive"]["sha256"], expected_manifest=manifest)
            remove_owned_temporary(part, MAX_ARCHIVE)
        receipt = {**public_info(info), "state": "PACKAGED"}
        need(old_receipt is None or old_receipt == receipt, "DELIVERY_RECEIPT_CHANGED")
        immutable_bytes(receipt_path, json_bytes(receipt))
        return {**receipt, "archivePath": str(archive), "receiptPath": str(receipt_path),
                "preparedSelectionPath": str(prepared_path)}


def selected_files(info):
    manifest = info["manifestValue"]
    raw = json_bytes(manifest)
    files = {row["name"]: row for row in manifest["files"]}
    files[MANIFEST] = {"name": MANIFEST, "bytes": len(raw), "sha256": digest(raw), "mode": "100644"}
    return files


def receive_receipt(info, original_filename):
    return {"schema": SCHEMA, "state": "MATERIALIZED",
            "archive": {**info["archive"], "filename": original_filename},
            "manifest": info["manifest"], "identity": info["identity"],
            "members": info["members"],
            "continuation": "Use the original ResearchWorkspaceClient.reopenFile with portableSha256."}


def inventory(root):
    check_directories(root)
    names, directories = set(), set()
    for current, dirs, files in os.walk(root, followlinks=False):
        for name in dirs:
            path = Path(current) / name
            relative = path.relative_to(root).as_posix()
            info = path.lstat()
            need(stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode),
                 "DELIVERY_DIRECTORY_REQUIRED", relative)
            need((info.st_mode & 0o077) == 0, "DELIVERY_PRIVATE_DIRECTORY_REQUIRED", relative)
            directories.add(relative)
        for name in files:
            path = Path(current) / name
            relative = path.relative_to(root).as_posix()
            need(stat.S_ISREG(path.lstat().st_mode) and not path.is_symlink(),
                 "DELIVERY_REGULAR_FILE_REQUIRED", relative)
            names.add(relative)
    return names, directories


def parent_names(names):
    result = set()
    for name in names:
        parts = name.split("/")
        for end in range(1, len(parts)):
            result.add("/".join(parts[:end]))
    return result


def part_name(name, checksum, kind="part"):
    path = Path(name)
    return (path.parent / ("." + path.name + "." + kind + "-" + checksum)).as_posix()


def verify_materialized(root, info, receipt=None):
    files = selected_files(info)
    names, directories = inventory(root)
    need(names == set(files) | {RECEIPT} and directories == parent_names(names),
         "DELIVERY_MATERIALIZED_INVENTORY_CHANGED")
    need((root.stat().st_mode & 0o077) == 0, "DELIVERY_PRIVATE_DIRECTORY_REQUIRED", str(root))
    for name, selected in files.items():
        same_bytes(file_identity(root / name), selected, "DELIVERY_MATERIALIZED_FILE_CHANGED", name)
        need(stat.S_IMODE((root / name).lstat().st_mode) == private_mode(selected["mode"]),
             "DELIVERY_MATERIALIZED_MODE_CHANGED", name)
    actual_receipt = parse_json(read_bytes(root / RECEIPT))
    need(stat.S_IMODE((root / RECEIPT).lstat().st_mode) == 0o600,
         "DELIVERY_MATERIALIZED_MODE_CHANGED", RECEIPT)
    if receipt is not None:
        need(actual_receipt == receipt, "DELIVERY_RECEIVING_RECEIPT_CHANGED")
    else:
        original = actual_receipt.get("archive") if isinstance(actual_receipt, dict) else None
        need(isinstance(original, dict) and isinstance(original.get("filename"), str),
             "DELIVERY_RECEIVING_RECEIPT_INVALID")
        need(actual_receipt == receive_receipt(info, original["filename"]),
             "DELIVERY_RECEIVING_RECEIPT_CHANGED")
    need(read_bytes(root / MANIFEST) == json_bytes(info["manifestValue"]), "DELIVERY_MANIFEST_CHANGED")
    return {**actual_receipt, "directory": str(root)}


def copy_member(zipped, name, root, expected):
    target = root / name
    temporary = root / part_name(name, expected["sha256"])
    private_directory(target.parent)
    if target.exists() or target.is_symlink():
        same_bytes(file_identity(target), expected, "DELIVERY_MATERIALIZED_FILE_CHANGED", name)
        need(stat.S_IMODE(target.lstat().st_mode) == private_mode(expected["mode"]),
             "DELIVERY_MATERIALIZED_MODE_CHANGED", name)
        if temporary.exists() or temporary.is_symlink():
            same_bytes(file_identity(temporary), expected, "DELIVERY_STAGING_CHANGED", str(temporary))
            remove_owned_temporary(temporary, MAX_FILE)
        return
    if temporary.exists() or temporary.is_symlink():
        current = file_identity(temporary)
        if current["bytes"] == expected["bytes"]:
            same_bytes(current, expected, "DELIVERY_STAGING_CHANGED", str(temporary))
        else:
            need(current["bytes"] < expected["bytes"], "DELIVERY_STAGING_CHANGED", str(temporary))
            # This unpublished name is owned by the exact frozen extraction.
            # Check its retained prefix before restarting the interrupted write.
            with regular_reader(temporary) as previous, zipped.open(name, "r") as source:
                while part := previous.read(CHUNK):
                    need(source.read(len(part)) == part, "DELIVERY_STAGING_CHANGED", str(temporary))
            remove_owned_temporary(temporary, MAX_FILE)
    if not temporary.exists():
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                     private_mode(expected["mode"]))
        with os.fdopen(fd, "wb") as output, zipped.open(name, "r") as source:
            hasher, total = hashlib.sha256(), 0
            while part := source.read(CHUNK):
                total += len(part)
                need(total <= expected["bytes"], "DELIVERY_ARCHIVE_MEMBER_TOO_LARGE", name)
                output.write(part)
                hasher.update(part)
            same_bytes({"bytes": total, "sha256": hasher.hexdigest()}, expected,
                       "DELIVERY_ARCHIVE_MEMBER_CHANGED", name)
            os.fchmod(output.fileno(), private_mode(expected["mode"]))
            output.flush()
            os.fsync(output.fileno())
        sync_directory(temporary.parent)
    same_bytes(file_identity(temporary), expected, "DELIVERY_STAGING_CHANGED", str(temporary))
    try:
        os.link(temporary, target, follow_symlinks=False)
        sync_directory(target.parent)
    except FileExistsError:
        same_bytes(file_identity(target), expected, "DELIVERY_MATERIALIZED_FILE_CHANGED", name)
    need(stat.S_IMODE(target.lstat().st_mode) == private_mode(expected["mode"]),
         "DELIVERY_MATERIALIZED_MODE_CHANGED", name)
    remove_owned_temporary(temporary, MAX_FILE)


def rename_directory_no_replace(source, destination):
    need(sys.platform.startswith("linux"), "DELIVERY_ATOMIC_DIRECTORY_PLATFORM_REQUIRED")
    library = ctypes.CDLL(None, use_errno=True)
    rename = getattr(library, "renameat2", None)
    need(rename is not None, "DELIVERY_ATOMIC_DIRECTORY_API_REQUIRED")
    rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    result = rename(-100, os.fsencode(source), -100, os.fsencode(destination), 1)
    if result != 0:
        code = ctypes.get_errno()
        if code == errno.EEXIST:
            raise FileExistsError(code, os.strerror(code), str(destination))
        raise DeliveryError("DELIVERY_ATOMIC_DIRECTORY_PUBLICATION_FAILED",
                            {"errno": code, "message": os.strerror(code)})
    sync_directory(destination.parent)


def receive_archive(archive, directory, expected_sha256=None):
    archive, directory = absolute(archive), absolute(directory)
    need(directory != directory.parent and directory.name not in ("", ".", ".."),
         "DELIVERY_FRESH_DIRECTORY_REQUIRED")
    private_directory(directory.parent)
    with held_lock(directory.parent / ("." + directory.name + ".receive.lock")):
        info = archive_info(archive, expected_sha256=expected_sha256)
        if directory.exists() or directory.is_symlink():
            # A completed copy is reusable; an unrelated or partial target is preserved.
            return verify_materialized(directory, info)
        selection_path = directory.parent / ("." + directory.name + ".receive-selection.json")
        try:
            selection = parse_json(read_bytes(selection_path))
        except FileNotFoundError:
            selection = None
        if selection is None:
            stage_id = digest(canonical({"targetName": directory.name,
                "archiveSha256": info["archive"]["sha256"],
                "manifestSha256": info["manifest"]["sha256"]}))[:32]
            stage_name = "." + directory.name + ".receiving-" + stage_id
            selection = {"schema": SCHEMA, "kind": "immutable-receiving-selection",
                         "targetName": directory.name, "stageName": stage_name,
                         "archive": info["archive"], "manifest": info["manifest"]}
            immutable_bytes(selection_path, json_bytes(selection))
        need(isinstance(selection, dict) and set(selection) ==
             {"schema", "kind", "targetName", "stageName", "archive", "manifest"} and
             selection.get("schema") == SCHEMA and
             selection.get("kind") == "immutable-receiving-selection" and
             selection.get("targetName") == directory.name and
             isinstance(selection.get("stageName"), str) and
             re.fullmatch(re.escape("." + directory.name + ".receiving-") + r"[0-9a-f]{32}",
                          selection["stageName"]) is not None and
             selection.get("manifest") == info["manifest"],
             "DELIVERY_RECEIVING_SELECTION_CHANGED")
        same_bytes(selection.get("archive", {}), info["archive"], "DELIVERY_RECEIVING_ARCHIVE_CHANGED", archive.name)
        original_filename = selection["archive"].get("filename")
        need(isinstance(original_filename, str) and original_filename and
             "/" not in original_filename and "\\" not in original_filename,
             "DELIVERY_RECEIVING_SELECTION_CHANGED")
        stage = directory.parent / selection["stageName"]
        private_directory(stage)
        need((stage.stat().st_mode & 0o077) == 0, "DELIVERY_PRIVATE_DIRECTORY_REQUIRED", str(stage))
        files = selected_files(info)
        receipt = receive_receipt(info, original_filename)
        receipt_bytes = json_bytes(receipt)
        permitted = set(files) | {RECEIPT}
        permitted.update(part_name(name, row["sha256"]) for name, row in files.items())
        permitted.add(part_name(RECEIPT, digest(receipt_bytes), "write"))
        names, directories = inventory(stage)
        need(names <= permitted and directories <= parent_names(permitted),
             "DELIVERY_RECEIVING_STAGING_INVENTORY_CHANGED")
        with regular_reader(archive, MAX_ARCHIVE) as handle:
            total, hasher = 0, hashlib.sha256()
            while part := handle.read(CHUNK):
                total += len(part)
                hasher.update(part)
            same_bytes({"bytes": total, "sha256": hasher.hexdigest()}, info["archive"],
                       "DELIVERY_ARCHIVE_CHANGED_DURING_RECEIVE", archive.name)
            handle.seek(0)
            with zipfile.ZipFile(handle, "r") as zipped:
                for name in sorted(files):
                    copy_member(zipped, name, stage, files[name])
        immutable_bytes(stage / RECEIPT, receipt_bytes)
        verify_materialized(stage, info, receipt)
        try:
            rename_directory_no_replace(stage, directory)
        except FileExistsError:
            # Never replace a path that appeared while publishing.
            return verify_materialized(directory, info, receipt)
        return verify_materialized(directory, info, receipt)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    package = commands.add_parser("package", help="Package one completed original receiving directory.")
    package.add_argument("--directory", required=True)
    package.add_argument("--out", required=True)
    inspect = commands.add_parser("inspect", help="Verify the complete selected ZIP without extracting it.")
    inspect.add_argument("--archive", required=True)
    inspect.add_argument("--expected-sha256")
    receive = commands.add_parser("receive", help="Materialize the exact ZIP in a fresh private directory.")
    receive.add_argument("--archive", required=True)
    receive.add_argument("--directory", required=True)
    receive.add_argument("--expected-sha256")
    args = parser.parse_args(argv)
    try:
        if args.command == "package":
            result = package_delivery(args.directory, args.out)
        elif args.command == "inspect":
            result = public_info(archive_info(absolute(args.archive), expected_sha256=args.expected_sha256))
        else:
            result = receive_archive(args.archive, args.directory, args.expected_sha256)
        print(json.dumps(result, ensure_ascii=False, sort_keys=True, allow_nan=False))
        return 0
    except (DeliveryError, OSError, zipfile.BadZipFile, zipfile.LargeZipFile, ValueError) as error:
        result = {"schema": SCHEMA, "state": "ERROR", "error": getattr(error, "code", type(error).__name__),
                  "detail": getattr(error, "detail", None) or str(error)}
        print(json.dumps(result, ensure_ascii=False, sort_keys=True), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
