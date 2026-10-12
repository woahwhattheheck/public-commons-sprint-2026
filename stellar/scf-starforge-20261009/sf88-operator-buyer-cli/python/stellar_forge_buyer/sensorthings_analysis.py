"""Complete SensorThings source editions in the original Python Analysis workspace.

The original source engine prepares exact document closures. This module uses
AnalysisWorkspace for every import, saved query, report, workbook and portable
workspace operation. It never captures a provider or creates another database.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal, localcontext
from fractions import Fraction
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import time
import uuid
import zipfile

from .analysis_workspace import AnalysisWorkspace
from .analysis_workbooks import WorkbookDelivery
from .response_documents import validate_manifest
from .storage import digest, lock, private_directory, read, sync_directory, write
from .workspace_archive_receive import restore_archive
from .errors import StateError

_SCHEMA = "stellar-forge.sensorthings-analysis-programme.v1"
_INTAKE = "stellar-forge.sensorthings-python-intake.v1"
_TABLES = ("observations", "components", "entities", "observation_index", "numeric_eligibility")
_HASH = re.compile(r"[a-f0-9]{64}")
_ID = re.compile(r"[a-f0-9]{32}")
_LABEL = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,19}")
_FILE = re.compile(r"(?:source\.json|files/[a-f0-9]{64}\.(?:json|bin))")
_CATEGORY = "http://www.opengis.net/def/observationType/OGC-OM/2.0/OM_CategoryObservation"
_MAX_DOCUMENT = 32 * 1024 * 1024
_MAX_SOURCE = 256 * 1024 * 1024


def _need(condition, code):
    if not condition:
        raise StateError("SENSORTHINGS_ANALYSIS_" + code)


def _json(value):
    return (json.dumps(value, ensure_ascii=False, allow_nan=False,
                       sort_keys=True, separators=(",", ":")) + "\n").encode()


def _now():
    return datetime.now(timezone.utc).isoformat()


def _path(value):
    path = Path(value).expanduser().absolute()
    _need(path.resolve() == path, "CANONICAL_PATH_REQUIRED")
    return path


def _qi(value):
    _need(isinstance(value, str) and value and "\0" not in value, "SQL_IDENTIFIER")
    return '"' + value.replace('"', '""') + '"'


def _qs(value):
    return "'" + str(value).replace("'", "''") + "'"


@contextmanager
def _open(path):
    path = _path(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        _need(stat.S_ISREG(before.st_mode), "REGULAR_FILE_REQUIRED")
        yield stream
        after = os.fstat(stream.fileno())
        _need((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
              (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns), "FILE_CHANGED")


def _verify(path, record, maximum=_MAX_SOURCE):
    _need(isinstance(record, dict) and type(record.get("bytes")) is int and
          0 <= record["bytes"] <= maximum and isinstance(record.get("sha256"), str) and
          _HASH.fullmatch(record["sha256"]), "FILE_IDENTITY_REQUIRED")
    with _open(path) as stream:
        _need(os.fstat(stream.fileno()).st_size == record["bytes"] and
              hashlib.file_digest(stream, "sha256").hexdigest() == record["sha256"], "FILE_CHANGED")
    return record


def _read_exact_json(path, record, maximum):
    _verify(path, record, maximum)
    body = read(_path(path), maximum)
    _need(len(body) == record["bytes"] and digest(body) == record["sha256"], "JSON_CHANGED")
    return json.loads(body)


def _immutable(path, body):
    path = _path(path)
    private_directory(path.parent)
    try:
        write(path, body, exclusive=True)
    except FileExistsError:
        _need(read(path, max(len(body), 1)) == body, "EXISTING_OUTPUT_DIFFERS")
    _need(read(path, max(len(body), 1)) == body, "OUTPUT_READBACK")
    return {"path": str(path), "bytes": len(body), "sha256": digest(body)}


def _copy(stream, target, record):
    target = _path(target)
    private_directory(target.parent)
    if target.exists():
        _verify(target, record, max(record["bytes"], 1))
        return {"path": str(target), "bytes": record["bytes"], "sha256": record["sha256"]}
    fd, name = tempfile.mkstemp(prefix=".sensorthings-copy-", suffix=".partial", dir=target.parent)
    temporary = Path(name)
    checksum, size = hashlib.sha256(), 0
    # A failed original copy retains its partial file; only the complete,
    # independently read-back temporary duplicate is retired.
    with os.fdopen(fd, "wb") as writer:
        while True:
            block = stream.read(1024 * 1024)
            if not block:
                break
            size += len(block)
            _need(size <= record["bytes"], "OUTPUT_GREW")
            writer.write(block)
            checksum.update(block)
        writer.flush()
        os.fsync(writer.fileno())
    _need(size == record["bytes"] and checksum.hexdigest() == record["sha256"], "OUTPUT_CHANGED")
    try:
        os.link(temporary, target)
    except FileExistsError:
        _verify(target, record, max(record["bytes"], 1))
    _verify(target, record, max(record["bytes"], 1))
    temporary.unlink()
    sync_directory(target.parent)
    return {"path": str(target), "bytes": size, "sha256": record["sha256"]}


def _download_identity(value):
    # contract.mjs sorts this fixed manifest's ASCII keys before JSON.stringify.
    # Its only numbers are already-validated, safe integral byte counts.
    text = json.dumps(value, ensure_ascii=False, allow_nan=False,
                      sort_keys=True, separators=(",", ":"))
    text = "".join("\\u%04x" % ord(c) if 0xD800 <= ord(c) <= 0xDFFF else c for c in text)
    return digest(text.encode("utf-8"))


def _download_source_input(selection):
    _need(set(selection) == {"name", "download_manifest", "download_manifest_sha256"},
          "DOWNLOAD_SOURCE_SELECTION_REQUIRED")
    manifest_path = _path(selection["download_manifest"])
    body = read(manifest_path, 4 * 1024 * 1024)
    reviewed = selection.get("download_manifest_sha256")
    _need(isinstance(reviewed, str) and _HASH.fullmatch(reviewed) and digest(body) == reviewed,
          "REVIEWED_DOWNLOAD_MANIFEST_CHANGED")
    value = json.loads(body)
    _need(isinstance(value, dict) and set(value) == {
        "schema", "id", "kind", "workspace", "workspaceId", "selection",
        "nativeFilesManifestSha256", "files", "meaning"} and
        value["schema"] == "stellar-forge.sensorthings-download-manifest.v1" and
        value["kind"] == "CLIENT_BOUND_NATIVE_FILE_SET", "DOWNLOAD_MANIFEST_REQUIRED")
    parent = value["selection"]
    _need(isinstance(parent, dict) and set(parent) == {"kind", "id"} and
          parent["kind"] == "analysis" and isinstance(parent["id"], str) and
          1 <= len(parent["id"]) <= 240 and
          isinstance(value["workspace"], str) and value["workspace"] and
          isinstance(value["workspaceId"], str) and value["workspaceId"] and
          isinstance(value["nativeFilesManifestSha256"], str) and
          _HASH.fullmatch(value["nativeFilesManifestSha256"]) and
          isinstance(value["meaning"], str), "DOWNLOAD_NATIVE_SELECTION_REQUIRED")
    files = value["files"]
    _need(isinstance(files, list) and 2 <= len(files) <= 37, "DOWNLOAD_FILE_CLOSURE_REQUIRED")
    names, logical, total = set(), {}, 0
    for item in files:
        _need(isinstance(item, dict) and set(item) == {
            "name", "originalName", "type", "bytes", "sha256", "selection"},
            "DOWNLOAD_FILE_DESCRIPTOR_REQUIRED")
        native = item["selection"]
        _need(isinstance(native, dict) and set(native) == {"kind", "id", "file"} and
              native["kind"] == parent["kind"] and native["id"] == parent["id"] and
              isinstance(native["file"], str) and
              (native["file"] == "intake.json" or _FILE.fullmatch(native["file"])) and
              native["file"] not in logical, "DOWNLOAD_NATIVE_FILE_SELECTION_CHANGED")
        _need(isinstance(item["name"], str) and
              re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,239}", item["name"]) and
              item["name"] not in {"sensorthings-download.json", "download-state"} and
              item["name"] not in names and
              item["originalName"] == native["file"].rsplit("/", 1)[-1] and
              isinstance(item["type"], str) and len(item["type"]) <= 240 and
              not re.search(r"[\x00-\x1f\x7f]", item["type"]) and
              type(item["bytes"]) is int and 0 <= item["bytes"] <= _MAX_SOURCE and
              isinstance(item["sha256"], str) and _HASH.fullmatch(item["sha256"]),
              "DOWNLOAD_FILE_IDENTITY_CHANGED")
        names.add(item["name"])
        logical[native["file"]] = item
        total += item["bytes"]
    _need(total <= _MAX_SOURCE + 4 * 1024 * 1024 and
          {"source.json", "intake.json"}.issubset(logical), "DOWNLOAD_COMPLETE_SOURCE_REQUIRED")
    _need(isinstance(value["id"], str) and _HASH.fullmatch(value["id"]) and
          _download_identity({k: v for k, v in value.items() if k != "id"}) == value["id"],
          "DOWNLOAD_MANIFEST_IDENTITY_CHANGED")
    intake_record = logical["intake.json"]
    intake_path = manifest_path.parent / intake_record["name"]
    _verify(intake_path, intake_record, 4 * 1024 * 1024)
    return {"manifest": value, "files": logical, "intake_path": intake_path,
            "intake_sha256": intake_record["sha256"],
            "record": {"path": str(manifest_path), "bytes": len(body), "sha256": reviewed}}


def _source(selection):
    _need(isinstance(selection, dict) and _LABEL.fullmatch(selection.get("name", "")),
          "SOURCE_NAME_REQUIRED")
    downloaded = _download_source_input(selection) if "download_manifest" in selection else None
    if downloaded is None:
        _need(set(selection) == {"name", "intake", "sha256"}, "SOURCE_INTAKE_SELECTION_REQUIRED")
        intake_path, intake_sha256 = _path(selection["intake"]), selection["sha256"]
    else:
        intake_path, intake_sha256 = downloaded["intake_path"], downloaded["intake_sha256"]
    body = read(intake_path, 4 * 1024 * 1024)
    _need(isinstance(intake_sha256, str) and
          _HASH.fullmatch(intake_sha256) and digest(body) == intake_sha256,
          "REVIEWED_INTAKE_CHANGED")
    intake = json.loads(body)
    _need(intake.get("schema") == _INTAKE and set(intake.get("tables", {})) == set(_TABLES),
          "COMPLETE_FIVE_TABLE_INTAKE_REQUIRED")
    root = intake_path.parent
    def input_path(name):
        if downloaded is None:
            return root / name
        _need(name in downloaded["files"], "DOWNLOAD_SOURCE_FILE_MISSING")
        return root / downloaded["files"][name]["name"]
    if downloaded is not None:
        _need(downloaded["manifest"]["workspaceId"] == intake.get("originalWorkspaceId") and
              downloaded["manifest"]["selection"]["id"] == intake.get("id"),
              "DOWNLOAD_ORIGINAL_PREPARATION_CHANGED")
    files = intake.get("files")
    _need(isinstance(files, list) and len(files) <= 36, "FILE_CLOSURE_REQUIRED")
    by_path = {}
    for item in files:
        name = item.get("file", "")
        _need(_FILE.fullmatch(name) and name not in by_path, "FILE_SELECTION_INVALID")
        if downloaded is not None:
            retained = downloaded["files"].get(name, {})
            _need(all(retained.get(k) == item[k] for k in ("bytes", "sha256")) and
                  retained.get("type") == item["contentType"], "DOWNLOAD_SOURCE_DESCRIPTOR_CHANGED")
        _verify(input_path(name), item)
        by_path[name] = item
    if downloaded is not None:
        _need(set(downloaded["files"]) == set(by_path) | {"intake.json"},
              "DOWNLOAD_SOURCE_CLOSURE_DIFFERS")
    _need(intake["source"]["file"] == "source.json" and
          by_path.get("source.json") == intake["source"], "SOURCE_MANIFEST_SELECTION_CHANGED")
    source = _read_exact_json(input_path("source.json"), intake["source"], 1024 * 1024)
    validate_manifest(source)
    _need(source["document"] == intake["document"], "DOCUMENT_BINDING_CHANGED")
    descriptors = [source["document"], *source["originals"]]
    expected_files = {"source.json", *(x["path"] for x in descriptors)}
    _need(set(by_path) == expected_files, "SOURCE_CLOSURE_DIFFERS")
    for item in descriptors:
        kept = by_path[item["path"]]
        _need(all(kept[k] == item[k] for k in ("bytes", "sha256", "contentType")),
              "SOURCE_DESCRIPTOR_CHANGED")
    originals = {item["role"]: item for item in source["originals"]}
    for role in ("original-source-edition", "original-source-export-receipt",
                 "projection-and-source-interpretation"):
        _need(role in originals, "ORIGINAL_SOURCE_METADATA_REQUIRED")
    edition = _read_exact_json(input_path(originals["original-source-edition"]["path"]),
                              originals["original-source-edition"], _MAX_DOCUMENT)
    exported = _read_exact_json(input_path(originals["original-source-export-receipt"]["path"]),
                               originals["original-source-export-receipt"], _MAX_DOCUMENT)
    _need(exported.get('schema') == 'stellar-forge.sensorthings-transfer-receipt.v1' and
          exported.get('originalWorkspaceId') == intake.get('originalWorkspaceId') and
          edition["id"] == intake["editionId"] == exported["editionId"] and
          exported["id"] == intake["exportId"] and exported["file"]["sha256"] ==
          intake["exportSha256"] == intake["archive"]["sha256"], "ORIGINAL_EDITION_EXPORT_CHANGED")
    original_scope = {"source": edition["source"]["serviceUrl"],
                      "streams": [{"kind": x["kind"], "url": x["url"]} for x in edition["plan"]["streams"]],
                      "query": edition["plan"]["observationQuery"]}
    _need(intake["comparisonScope"] == original_scope and intake["scope"] == edition["scope"],
          "ORIGINAL_SCOPE_CHANGED")
    archive = intake["archive"]
    checksum, offset = hashlib.sha256(), 0
    _need(archive["bytes"] == exported["file"]["bytes"] and archive["exportId"] == exported["id"],
          "ARCHIVE_RECEIPT_CHANGED")
    for index, part in enumerate(archive["parts"]):
        _need(part["offset"] == offset and
              originals.get("source-archive-part-" + str(index + 1).zfill(4)) ==
              {k: v for k, v in part.items() if k != "offset"}, "ARCHIVE_PART_ORDER_CHANGED")
        with _open(input_path(part["path"])) as stream:
            while True:
                block = stream.read(1024 * 1024)
                if not block:
                    break
                checksum.update(block)
                offset += len(block)
    _need(offset == archive["bytes"] and checksum.hexdigest() == archive["sha256"],
          "WHOLE_SOURCE_ARCHIVE_CHANGED")
    document = _read_exact_json(input_path(source["document"]["path"]), source["document"], _MAX_DOCUMENT)
    _need(set(document) == set(_TABLES), "DOCUMENT_COLLECTIONS_CHANGED")
    for table in _TABLES:
        description, rows = intake["tables"][table], document[table]
        columns = description["columns"]
        _need(description["collection"] == "/" + table and isinstance(rows, list) and
              description["rows"] == len(rows) and isinstance(columns, list) and
              1 <= len(columns) <= 256 and len(set(columns)) == len(columns),
              "TABLE_DESCRIPTION_CHANGED")
        _need(all(isinstance(row, dict) and set(row) == set(columns) and
                  all(isinstance(value, str) for value in row.values()) for row in rows),
              "ORIGINAL_TEXT_CELL_CHANGED")
    observations = {row["occurrence_id"]: row for row in document["observations"]}
    _need(len(observations) == len(document["observations"]), "ORIGINAL_OCCURRENCE_DUPLICATE")
    for table in ("observation_index", "numeric_eligibility"):
        _need(len(document[table]) == len(observations) and
              {row["occurrence_id"] for row in document[table]} == set(observations),
              "DERIVED_OCCURRENCE_COVERAGE_CHANGED")
    for row in document["observation_index"]:
        _need(_HASH.fullmatch(row["semantic_sha256"]) and
              row["original_key_state"] in {"value", "missing"} and
              (row["original_key_state"] == "value") == bool(row["original_key"]),
              "ORIGINAL_IDENTITY_INDEX_CHANGED")
    for row in document["numeric_eligibility"]:
        _need(row["eligible"] in {"true", "false"} and
              row["method"] == "original-sensorthings-analysis-numericEligibility" and
              (row["eligible"] == "true") == (row["reason"] == "eligible"),
              "ORIGINAL_CLASSIFICATION_CHANGED")
    return {"name": selection["name"], "intake_path": intake_path, "root": root,
            "intake": intake, "source": source, "document": document, "edition": edition,
            "intake_sha256": intake_sha256, "manifest_path": input_path("source.json"),
            "document_files": None if downloaded is None else
                {item["path"]: str(input_path(item["path"])) for item in descriptors},
            "download": downloaded}


class Programme:
    def __init__(self, request):
        _need(isinstance(request, dict) and request.get("schema") == _SCHEMA and
              _ID.fullmatch(request.get("operation_id", "")), "PROGRAMME_REQUEST_REQUIRED")
        _need(isinstance(request.get("sources"), list) and 1 <= len(request["sources"]) <= 16,
              "SOURCE_SELECTION_REQUIRED")
        self.request = request
        self.operation = request["operation_id"]
        self.namespace = uuid.UUID(hex=self.operation)
        self.control = private_directory(_path(request["control"]))
        self.output = private_directory(_path(request["output"]))
        self.workspace_path = _path(request["workspace"])
        self.received_path = _path(request["received_workspace"])
        _need(len({str(self.control), str(self.output), str(self.workspace_path),
                   str(self.received_path)}) == 4, "DISTINCT_DIRECTORIES_REQUIRED")
        _need(not self.received_path.is_relative_to(self.workspace_path) and
              not self.workspace_path.is_relative_to(self.received_path),
              "RECEIVING_DIRECTORY_MUST_BE_SEPARATE")
        _need(type(request.get("allow_incomplete", False)) is bool, "COMPLETION_SELECTION_REQUIRED")
        self.prefix = "st_" + self.operation[:12] + "_"
        self.workspace = None
        self.outputs = {}
        self.queries = {}

    def identifier(self, key):
        return uuid.uuid5(self.namespace, key).hex

    def intent(self, key, producer):
        path = self.control / (self.identifier(key) + ".json")
        if path.exists():
            record = json.loads(read(path, 4 * 1024 * 1024))
            _need(record.get("operation_id") == self.operation and record.get("key") == key,
                  "ORIGINAL_STEP_IDENTITY_CHANGED")
            return record["request"]
        value = producer()
        _immutable(path, _json({"operation_id": self.operation, "key": key, "request": value}))
        return value

    def event(self, phase, **value):
        print(json.dumps({"operation_id": self.operation, "phase": phase, **value},
                         ensure_ascii=False, allow_nan=False), flush=True)

    def job(self, key, kind, factory, workspace=None):
        workspace = workspace or self.workspace
        spec = self.intent("job:" + key, lambda: {"id": self.identifier("job:" + key), **factory()})
        job = workspace.start(kind, spec)
        announced = time.monotonic()
        while job["status"] == "RUNNING":
            time.sleep(0.15)
            job = workspace.job(spec["id"], limit=1)
            if time.monotonic() - announced >= 30:
                self.event("original_job_running", key=key, kind=kind, id=spec["id"])
                announced = time.monotonic()
        _need(job["status"] == "COMPLETE", "ORIGINAL_JOB_" + job["status"] + "_" + spec["id"])
        self.event("original_job_complete", key=key, kind=kind, id=spec["id"])
        return workspace.job(spec["id"], limit=250)

    def saved_query(self, key, sql, *, workspace=None, revision=1):
        workspace = workspace or self.workspace
        name = self.prefix + key
        _need(len(name) <= 64, "QUERY_NAME_CAPACITY")
        proposed = {"sql": sql, "parameters_text": "[]", "max_rows": 1000}
        proposed = self.intent("query-definition:" + key + ":" + str(revision), lambda: proposed)
        try:
            saved = workspace.saved_query(name, revision=revision)
        except StateError as error:
            if "ANALYSIS_QUERY_NOT_FOUND" not in str(error):
                raise
            saved = workspace.save_query(name, proposed, expected_revision=revision - 1)
        _need(all(saved.get(k) == v for k, v in proposed.items()) and saved["revision"] == revision,
              "SAVED_QUERY_REPLAY_CHANGED")
        return {"name": name, "revision": revision, **proposed}

    def query(self, key, sql, *, title, note, worksheet=True, workspace=None, revision=1):
        workspace = workspace or self.workspace
        definition = self.saved_query(key, sql, workspace=workspace, revision=revision)
        runkey = key + ":r" + str(revision)
        job = self.job("query:" + runkey, "query",
                       lambda: {k: definition[k] for k in ("sql", "parameters_text", "max_rows")} |
                       {"expected_views": workspace.database.view_bindings()}, workspace)
        result = job["result"]
        exported = self.job("query-export:" + runkey, "query-export", lambda: {
            "query_id": job["id"], "result_sha256": result["result_sha256"], "label": title[:160],
            "formats": ["jsonl", "csv"], "timeout": 300, "max_rows": None,
            "max_output_bytes": None, "spreadsheet_safe": True}, workspace)
        directory = self.output / ("queries" if revision == 1 else "receiving") / runkey.replace(":", "_")
        for filename in ("rows.csv", "rows.jsonl", "manifest.json"):
            with workspace.exports.download(exported["id"], filename) as (stream, record):
                self.outputs[key + ":" + str(revision) + ":" + filename] = _copy(stream, directory / filename, record)
        value = {"key": key, "title": title, "note": note, "definition": definition,
                 "job_id": job["id"], "result_sha256": result["result_sha256"],
                 "columns": result["columns"], "query_export_id": exported["id"],
                 "export_sha256": exported["result"]["manifest_sha256"],
                 "worksheet": worksheet, "preview_truncated": result["truncated"]}
        if revision == 1:
            self.queries[key] = value
        return value

    def import_document(self, key, path, collections, *, document_files=None):
        alias = self.prefix + key
        source = self.workspace.responses.register(alias, "document", manifest=path,
            expected_revision=0, document_files=document_files)
        tables = {}
        for table, description in collections.items():
            preview = self.job("preview:" + key + ":" + table, "response-preview", lambda: {
                "source": alias, "source_revision": source["revision"],
                "mapping": {"collection": description["collection"], "sse_data": "text",
                            "columns": [{"name": column, "pointer": "/" + column.replace("~", "~0").replace("/", "~1"),
                                         "type": "text", "missing": "error"} for column in description["columns"]]}})
            imported = self.job("import:" + key + ":" + table, "response-import", lambda: {
                "preview_id": preview["id"], "preview_sha256": preview["result"]["preview_sha256"],
                "allow_incomplete": self.request.get("allow_incomplete", False)})
            version = imported["result"]["version"]
            view = self.prefix + key + "_" + table
            current = self.workspace.database.current(view)
            binding = self.intent("activate:" + view, lambda: {"name": view,
                "version_id": version["id"] if "id" in version else version["version_id"],
                "expected_revision": current["revision"]})
            current_id = None if current["version"] is None else current["version"].get("id", current["version"].get("version_id"))
            if current_id != binding["version_id"]:
                self.workspace.database.activate(view, binding["version_id"],
                                                 expected_revision=binding["expected_revision"])
            else:
                _need(current["revision"] == binding["expected_revision"] + 1,
                      "ORIGINAL_VIEW_REVISION_CHANGED")
            tables[table] = {"view": view, "version_id": binding["version_id"],
                             "rows": description["rows"], "columns": description["columns"]}
        return {"source": source["name"], "document_id": source["document_id"], "tables": tables}

    def export_report(self, key, name, request, *, workspace=None):
        workspace = workspace or self.workspace
        definition_request = self.intent("report-definition:" + key, lambda: request)
        saved = workspace.reports.save(name, definition_request)
        definition = workspace.reports.definition(name, revision=saved["revision"])
        job = self.job("report:" + key, "report", lambda: {
            "name": name, "revision": saved["revision"], "definition_sha256": definition["sha256"],
            "expected_views": workspace.database.view_bindings()}, workspace)
        publish_request = self.intent("report-publication:" + key, lambda: {
            "id": self.identifier("report-publication:" + key),
            "result_sha256": job["result"]["result_sha256"],
            "expected_revision": definition["publication_revision"],
            "note": "Complete retained source editions, original typed identity comparison, exact numerical summaries and original source references."})
        publication = workspace.reports.publish(job["id"], publish_request)
        before, publication_sha = None, None
        while publication_sha is None:
            page = workspace.reports.publications(name=name, before=before, limit=100)
            for item in page["publications"]:
                if item["publication"]["id"] == publication["id"]:
                    publication_sha = item["sha256"]
            if publication_sha is not None or page["next_before"] is None:
                break
            before = page["next_before"]
        _need(publication_sha is not None, "ORIGINAL_PUBLICATION_READBACK_REQUIRED")
        outputs = {}
        for format, extension in (("html", "html"), ("json", "json"), ("csv", "zip")):
            exported = self.job("report-export:" + key + ":" + format, "report-export", lambda: {
                "publication_id": publication["id"], "publication_sha256": publication_sha,
                "format": format}, workspace)
            path, record = workspace.report_export_file(exported["id"])
            with _open(path) as stream:
                copied = _copy(stream, self.output / "reports" / (key + "." + extension), record)
            outputs[format] = copied
            self.outputs["report:" + key + ":" + format] = copied
        return {"name": name, "revision": saved["revision"], "definition_sha256": definition["sha256"],
                "job_id": job["id"], "publication_id": publication["id"],
                "publication_sha256": publication_sha, "request": definition_request, "files": outputs}

    def workbook(self, key, name, request, *, workspace=None):
        workspace = workspace or self.workspace
        request = self.intent("workbook-definition:" + key, lambda: request)
        saved = workspace.workbooks.save(name, request)
        job = self.job("workbook:" + key, "workbook", lambda: {
            "name": name, "revision": saved["revision"],
            "definition_sha256": saved["definition_sha256"]}, workspace)
        outputs = {}
        for filename in ("workbook.xlsx", "handoff.zip", "manifest.json"):
            with workspace.workbooks.download(job["id"], filename) as (stream, record):
                copied = _copy(stream, self.output / "workbooks" / key / filename, record)
            outputs[filename] = copied
            self.outputs["workbook:" + key + ":" + filename] = copied
        received = self.output / "received-workbooks" / key
        if received.exists():
            delivery = WorkbookDelivery(received, expected_manifest_sha256=job["result"]["manifest_sha256"])
        else:
            delivery = WorkbookDelivery.receive(outputs["handoff.zip"]["path"], received,
                                                expected_sha256=outputs["handoff.zip"]["sha256"])
        inspection = delivery.inspect()
        return {"name": name, "revision": saved["revision"], "job_id": job["id"],
                "definition_sha256": saved["definition_sha256"],
                "manifest_sha256": job["result"]["manifest_sha256"], "request": request,
                "files": outputs, "offline_receiving": inspection}

    def archive(self, key, *, workspace=None):
        workspace = workspace or self.workspace
        review = workspace.archives.review(include_previous_backups=False)
        _need(review["ready"], "COMPLETE_WORKSPACE_SOURCE_FILES_REQUIRED")
        job = self.job("workspace-export:" + key, "workspace-export",
                       lambda: {"include_previous_backups": False}, workspace)
        with workspace.archives.download(job["id"], "workspace.zip") as (stream, record):
            copied = _copy(stream, self.output / "workspaces" / (key + ".zip"), record)
        self.outputs["workspace:" + key] = copied
        return {"job_id": job["id"], "workspace_id": workspace.identity, "archive": copied,
                "review": review}

    def _prepare_analysis(self, sources):
        registered = {}
        for source in sources:
            if source["download"] is not None:
                retained = source["download"]["record"]
                with _open(retained["path"]) as stream:
                    copied = _copy(stream, self.output / "source-receiving" /
                                   (source["name"] + "-sensorthings-download.json"), retained)
                self.outputs["source-download:" + source["name"]] = copied
            registered[source["name"]] = self.import_document(
                source["name"], source["manifest_path"], source["intake"]["tables"],
                document_files=source["document_files"])
            for table, record in registered[source["name"]]["tables"].items():
                self.query(source["name"] + "_" + table,
                           "SELECT " + ",".join(_qi(c) for c in record["columns"]) +
                           " FROM " + _qi(record["view"]) + " ORDER BY " + _qi("_sf_row_number"),
                           title=source["name"] + " — " + table.replace("_", " "),
                           note="Complete retained table. Every original projected cell is text; source pointers and original JSON remain available.")
        metadata_path, metadata_tables = _metadata_document(self, sources)
        metadata = self.import_document("method", metadata_path, metadata_tables)
        views = {key: value["view"] for key, value in metadata["tables"].items()}
        for table in metadata_tables:
            self.query("method_" + table, "SELECT * FROM " + _qi(views[table]),
                       title=table.replace("_", " ").capitalize(),
                       note="Derived from the complete retained source editions with the complete calculation module retained as an original document.")
        observation_sql = _union_sources(sources, registered, "observations")
        eligibility_sql = _union_sources(sources, registered, "numeric_eligibility")
        entity_sql = _union_sources(sources, registered, "entities")
        profile = """
SELECT edition_label,stream_kind,stream_id_type,stream_id,stream_name,observation_type,unit,
       COUNT(*) AS retained_occurrences,
       SUM(CASE WHEN phenomenon_time_kind='explicit_instant' THEN 1 ELSE 0 END) AS explicit_instants,
       SUM(CASE WHEN phenomenon_time_kind='explicit_interval' THEN 1 ELSE 0 END) AS explicit_intervals,
       MIN(NULLIF(phenomenon_start_utc,'')) AS first_source_time,
       MAX(NULLIF(phenomenon_end_utc,phenomenon_start_utc)) AS last_explicit_interval_end,
       MAX(NULLIF(phenomenon_start_utc,'')) AS last_source_start
FROM observations GROUP BY edition_label,stream_kind,stream_id_type,stream_id,stream_name,observation_type,unit
ORDER BY edition_label,stream_kind,stream_id_type,stream_id,observation_type,unit
"""
        category = """
SELECT edition_label,stream_kind,stream_id_type,stream_id,stream_name,result_state,result_type,result,
       COUNT(*) AS observed_occurrences
FROM observations WHERE observation_type=""" + _qs(_CATEGORY) + """
GROUP BY edition_label,stream_kind,stream_id_type,stream_id,stream_name,result_state,result_type,result
ORDER BY edition_label,stream_id_type,stream_id,result_state,result_type,result
"""
        quality = """
SELECT edition_label,observation_type,result_state,result_type,result_quality_state,result_quality,
       phenomenon_time_kind,issues,COUNT(*) AS retained_occurrences
FROM observations
GROUP BY edition_label,observation_type,result_state,result_type,result_quality_state,result_quality,
         phenomenon_time_kind,issues
ORDER BY edition_label,observation_type,result_state,result_type,result_quality_state,result_quality,phenomenon_time_kind,issues
"""
        eligibility = """
SELECT o.edition_label,o.stream_kind,o.stream_id_type,o.stream_id,o.observation_type,o.unit,
       e.eligible,e.reason,COUNT(*) AS retained_occurrences
FROM observations o JOIN eligibility e
ON o.edition_label=e.edition_label AND o.occurrence_id=e.occurrence_id
GROUP BY o.edition_label,o.stream_kind,o.stream_id_type,o.stream_id,o.observation_type,o.unit,e.eligible,e.reason
ORDER BY o.edition_label,o.stream_id_type,o.stream_id,e.eligible,e.reason
"""
        events = """
,placed AS (
 SELECT *,COUNT(*) OVER (
  PARTITION BY edition_label,stream_kind,stream_id_type,stream_id,phenomenon_start_utc) AS time_multiplicity
 FROM observations
 WHERE observation_type=""" + _qs(_CATEGORY) + """ AND phenomenon_time_kind='explicit_instant'
),ordered AS (
 SELECT *,LAG(result) OVER w AS previous_result,LAG(result_state) OVER w AS previous_state,
          LAG(time_multiplicity) OVER w AS previous_multiplicity,
          LAG(phenomenon_start_utc) OVER w AS previous_source_time
 FROM placed
 WINDOW w AS (PARTITION BY edition_label,stream_kind,stream_id_type,stream_id
              ORDER BY phenomenon_start_utc,occurrence_id)
)
SELECT edition_label,stream_kind,stream_id_type,stream_id,
 COUNT(*) AS placed_occurrences,
 SUM(CASE WHEN time_multiplicity>1 THEN 1 ELSE 0 END) AS coincident_occurrences,
 SUM(CASE WHEN time_multiplicity=1 AND previous_multiplicity=1 AND
  result_state='value' AND previous_state='value' AND previous_source_time<phenomenon_start_utc
  THEN 1 ELSE 0 END) AS unambiguous_observed_adjacent_pairs,
 SUM(CASE WHEN time_multiplicity=1 AND previous_multiplicity=1 AND
  result_state='value' AND previous_state='value' AND previous_source_time<phenomenon_start_utc AND result<>previous_result
  THEN 1 ELSE 0 END) AS observed_adjacent_code_changes
FROM ordered GROUP BY edition_label,stream_kind,stream_id_type,stream_id
ORDER BY edition_label,stream_id_type,stream_id
"""
        metadata_counts = """
SELECT edition_label,entity_kind,capture_phase,COUNT(*) AS retained_occurrences,
       COUNT(DISTINCT source_page_sha256) AS retained_source_pages
FROM entities GROUP BY edition_label,entity_kind,capture_phase ORDER BY edition_label,entity_kind,capture_phase
"""
        inventory_sql = ("SELECT edition_label,edition_id,source_url,traversal_status,source_complete,"
                         "observations,components,entities,unique_record_keys,ambiguous_record_keys,"
                         "unkeyed_occurrences,source_export_sha256 FROM " + _qi(views["inventory"]) +
                         " ORDER BY edition_label")
        summaries = [
            ("source_inventory", inventory_sql, "Source editions and retained coverage",
             "Each edition keeps its original query, source licence, complete original archive and connector records. The complete retained archive and provider traversal are separate facts."),
            ("stream_coverage", "WITH observations AS (" + observation_sql + ") " + profile,
             "Stream coverage and original time fields",
             "These are retained source occurrences and source time extrema. They do not imply fixed sample duration, interpolated coverage, availability, uptime or current capacity."),
            ("category_counts", "WITH observations AS (" + observation_sql + ") " + category,
             "Observed categorical codes",
             "Declared categorical observations remain literal categories. Counts are occurrences; no category is mapped to a number or converted to elapsed duration."),
            ("quality_states", "WITH observations AS (" + observation_sql + ") " + quality,
             "Source quality, missing values and interpretation issues",
             "Source quality labels and issue values are retained exactly. A publisher quality label does not become an analyst approval or a current state assertion."),
            ("numeric_eligibility", "WITH observations AS (" + observation_sql + "),eligibility AS (" +
             eligibility_sql + ") " + eligibility, "Original scalar numeric eligibility",
             "The unchanged source analysis classifier supplies each reason. Original nonnumeric, unresolved-time, multidimensional and out-of-browser-range values remain in the raw tables."),
            ("exact_statistics", "SELECT * FROM " + _qi(views["exact_numeric_statistics"]) +
             " ORDER BY edition_label,stream_kind,stream_id_type,stream_id,unit",
             "Exact summaries of eligible original numbers",
             "Minimum and maximum retain an original number literal. Sum, mean and median are exact rational values. The companion mean_decimal_34 value is rounded to 34 significant decimal digits. No binary floating-point aggregation is used."),
            ("event_changes", "WITH observations AS (" + observation_sql + ")" + events,
             "Observed adjacent categorical changes",
             "Pairs require distinct explicitly placed source instants and a unique observation at both instants. Coincident or unresolved values remain visible. An observed code change is not an inferred change time or elapsed operating state."),
            ("metadata_captures", "WITH entities AS (" + entity_sql + ") " + metadata_counts,
             "Opening and closing metadata captures",
             "Original metadata capture phases and source pages remain separate from observation comparisons. Metadata changing beyond a fixed observation cutoff does not change that window's observation result.")
        ]
        summary_keys = []
        for key, sql, title, note in summaries:
            self.query(key, sql, title=title, note=note)
            summary_keys.append(key)
        by_name = {item["name"]: item for item in sources}
        comparisons = self.request.get("comparisons", [])
        _need(isinstance(comparisons, list) and len(comparisons) <= 32, "COMPARISON_SELECTION_INVALID")
        comparison_keys, count_unions = [], []
        for index, pair in enumerate(comparisons):
            _need(isinstance(pair, dict) and set(pair) == {"left", "right"} and
                  pair["left"] in by_name and pair["right"] in by_name and pair["left"] != pair["right"],
                  "EXACT_COMPARISON_PAIR_REQUIRED")
            left, right = by_name[pair["left"]], by_name[pair["right"]]
            compatible = left["intake"]["comparisonScope"] == right["intake"]["comparisonScope"]
            lview = registered[left["name"]]["tables"]["observation_index"]["view"]
            rview = registered[right["name"]]["tables"]["observation_index"]["view"]
            detail = _comparison_sql(lview, rview)
            key = "comparison_" + str(index + 1)
            label = left["name"] + " → " + right["name"]
            self.query(key, detail, title="Observed records: " + label,
                       note="Original typed record keys and source-engine semantic hashes determine matching. Duplicate keys are ambiguous; missing keys remain unkeyed. Source scopes " +
                            ("match exactly." if compatible else "differ and are not directly interchangeable."))
            comparison_keys.append(key)
            count_unions.append("SELECT " + _qs(label) + " AS comparison," +
                                _qs(str(compatible).lower()) + " AS scope_compatible,classification,"
                                "COUNT(*) AS record_groups,SUM(left_occurrences) AS left_occurrences,"
                                "SUM(right_occurrences) AS right_occurrences FROM (" + detail +
                                ") GROUP BY classification")
        if count_unions:
            self.query("comparison_summary", " UNION ALL ".join(count_unions) +
                       " ORDER BY comparison,classification",
                       title="Observed record comparison",
                       note="This matches the original SensorThings comparison rules, including stream meaning and relationships. Observed-only records do not establish provider insertion or deletion, and no synchronized snapshot is asserted.")
            summary_keys.append("comparison_summary")
        return registered, summary_keys, comparison_keys, observation_sql

    def run(self):
        with lock(self.control):
            _immutable(self.control / "operation.json", _json(self.request))
            final = self.control / "complete.json"
            if final.exists():
                retained = json.loads(read(final, 4 * 1024 * 1024))
                _need(retained.get("operation_id") == self.operation, "COMPLETED_OPERATION_CHANGED")
                for record in retained["files"]:
                    _verify(record["path"], record, max(record["bytes"], 1))
                _verify(retained["delivery"]["path"], retained["delivery"],
                        max(retained["delivery"]["bytes"], 1))
                self.event("complete_reopened", delivery=retained["delivery"])
                return retained
            started = self.intent("started", lambda: {"at": _now()})["at"]
            sources = [_source(item) for item in self.request["sources"]]
            _need(len({source["name"].lower() for source in sources}) == len(sources),
                  "SOURCE_NAMES_MUST_DIFFER")
            _need(len({source["intake"]["editionId"] for source in sources}) == len(sources),
                  "SELECT_DISTINCT_ORIGINAL_EDITIONS")
            self.event("complete_original_sources_verified", sources=[
                {"name": x["name"], "edition_id": x["intake"]["editionId"],
                 "observations": x["intake"]["tables"]["observations"]["rows"],
                 "archive_bytes": x["intake"]["archive"]["bytes"]} for x in sources])
            self.workspace = AnalysisWorkspace(self.workspace_path,
                checkout=self.request.get("checkout"), node=self.request.get("node", "node"))
            try:
                registered, summary_keys, comparison_keys, observation_sql = self._prepare_analysis(sources)
                sections = [{"title": self.queries[key]["title"], "note": self.queries[key]["note"],
                             "query_name": self.queries[key]["definition"]["name"],
                             "query_revision": self.queries[key]["definition"]["revision"]}
                            for key in summary_keys]
                report_name = self.prefix + "source_report"
                report_request = {"id": self.identifier("report-definition:original"),
                    "expected_revision": 0, "title": self.request.get("title", "SensorThings source analysis"),
                    "introduction": "Analysis of complete retained source editions. Original observations, components, entity metadata, connector records and source archives remain available. The report uses the original source engine's identity and eligibility semantics and exact source-number arithmetic. Original queries, report revisions and workbook definitions remain editable in the receiving workspace.",
                    "sections": sections}
                report = self.export_report("original", report_name, report_request)
                ordered_keys = summary_keys + comparison_keys + [
                    key for key in self.queries if key not in summary_keys and key not in comparison_keys]
                books = []
                for start in range(0, len(ordered_keys), 32):
                    keys = ordered_keys[start:start + 32]
                    key = "source_" + str(len(books) + 1)
                    sheets = [_query_sheet(self.queries[item], index + 1)
                              for index, item in enumerate(keys)]
                    request = {"id": self.identifier("workbook-definition:" + key), "expected_revision": 0,
                               "title": "SensorThings source analysis — " + str(len(books) + 1),
                               "notes": "All source cells are preserved as text. Original IDs, decimal lexemes, units, quality values, JSON, pointers and source hashes retain their meaning. The report's numerical summaries include exact rational values. Complete full-query JSONL and CSV exports accompany this workbook.",
                               "sheets": sheets}
                    book = self.workbook(key, self.prefix + key, request)
                    book["query_keys"] = keys
                    books.append(book)
                original_archive = self.archive("original")
                original_workspace_id = self.workspace.identity
            finally:
                self.workspace.close()
                self.workspace = None
            receive_operation = self.identifier("original-workspace-receiving")
            receiving = restore_archive(original_archive["archive"]["path"], self.received_path,
                                        operation=receive_operation,
                                        expected_sha256=original_archive["archive"]["sha256"])
            receiving_intent = self.intent("received-original", lambda: receiving)
            with_workspace = AnalysisWorkspace(self.received_path,
                checkout=self.request.get("checkout"), node=self.request.get("node", "node"))
            try:
                _need(with_workspace.identity == original_workspace_id,
                      "RECEIVING_WORKSPACE_IDENTITY_CHANGED")
                daily_sql = ("WITH observations AS (" + observation_sql + ") " +
                    "SELECT edition_label,stream_kind,stream_id_type,stream_id,"
                    "substr(phenomenon_start_utc,1,10) AS source_utc_day,COUNT(*) AS retained_occurrences "
                    "FROM observations WHERE phenomenon_time_kind='explicit_instant' "
                    "GROUP BY edition_label,stream_kind,stream_id_type,stream_id,source_utc_day "
                    "ORDER BY edition_label,stream_id_type,stream_id,source_utc_day")
                continued = self.query("stream_coverage", daily_sql, workspace=with_workspace, revision=2,
                    title="Receiving edit: daily source coverage",
                    note="An actual saved-query revision in the reopened workspace. It groups explicit source instants by UTC date while preserving the original stream coverage recipe at revision 1.")
                new_sections = [dict(section) for section in report_request["sections"]]
                for section in new_sections:
                    if section["query_name"] == continued["definition"]["name"]:
                        section.update(title="Receiving edit: daily source coverage",
                                       query_revision=2, note=continued["note"])
                continued_report = self.export_report("receiving", report_name, {
                    "id": self.identifier("report-definition:receiving"), "expected_revision": report["revision"],
                    "title": report_request["title"] + " — receiving revision",
                    "introduction": report_request["introduction"] +
                        " This revision was created in the restored workspace and includes an edited daily-coverage query.",
                    "sections": new_sections}, workspace=with_workspace)
                first = books[0]
                new_sheets = [dict(sheet) for sheet in first["request"]["sheets"]]
                position = first["query_keys"].index("stream_coverage")
                new_sheets[position] = _query_sheet(continued, position + 1)
                continued_book = self.workbook("receiving", first["name"], {
                    "id": self.identifier("workbook-definition:receiving"),
                    "expected_revision": first["revision"],
                    "title": first["request"]["title"] + " — receiving revision",
                    "notes": first["request"]["notes"] +
                        " The daily-coverage sheet was replaced with the actual saved query revision 2 from this receiving workspace.",
                    "sheets": new_sheets}, workspace=with_workspace)
                continued_archive = self.archive("receiving", workspace=with_workspace)
                received_queries = {
                    "original": with_workspace.saved_query(continued["definition"]["name"], revision=1)["revision"],
                    "edited": with_workspace.saved_query(continued["definition"]["name"], revision=2)["revision"]}
            finally:
                with_workspace.close()
            result = {"schema": _SCHEMA, "operation_id": self.operation, "status": "COMPLETE",
                "started_at": started, "completed_at": _now(), "workspace_id": original_workspace_id,
                "sources": [{"name": item["name"], "edition_id": item["intake"]["editionId"],
                             "intake_sha256": item["intake_sha256"],
                             "archive": {k: item["intake"]["archive"][k] for k in ("bytes", "sha256")},
                             "tables": item["intake"]["tables"]} for item in sources],
                "registered": registered, "queries": list(self.queries.values()), "report": report,
                "workbooks": books, "original_workspace": original_archive,
                "receiving": {"operation_id": receive_operation, "result": receiving_intent,
                              "continued_query": continued, "saved_query_revisions": received_queries,
                              "report": continued_report, "workbook": continued_book,
                              "continued_workspace": continued_archive},
                "interpretation": "Original source facts, query scope, metadata phases and analytical derivations remain separate. Categorical occurrences are not elapsed durations. Numerical source values remain exact text, and numerical summaries retain exact rational values."}
            guide = _handover_guide(result)
            self.outputs["handover-guide"] = _immutable(self.output / "README.txt", guide.encode())
            result["files"] = sorted(self.outputs.values(), key=lambda x: x["path"])
            result_file = _immutable(self.output / "programme-result.json", _json(result))
            delivery = _handover_zip(self.output, [*result["files"], result_file])
            completed = {**result, "delivery": delivery}
            _immutable(final, _json(completed))
            self.event("complete", workspace_id=original_workspace_id, source_editions=len(sources),
                       saved_queries=len(self.queries), workbooks=len(books),
                       receiving_query_revisions=received_queries, delivery=delivery)
            return completed


def _union_sources(sources, registered, table):
    return " UNION ALL ".join(
        "SELECT " + _qs(item["name"]) + " AS edition_label," +
        ",".join(_qi(column) for column in registered[item["name"]]["tables"][table]["columns"]) +
        " FROM " + _qi(registered[item["name"]]["tables"][table]["view"])
        for item in sources)


def _comparison_sql(left, right):
    return """
WITH left_keys AS (
 SELECT original_key,COUNT(*) AS n,MIN(semantic_sha256) AS semantic_sha256
 FROM """ + _qi(left) + """ WHERE original_key_state='value' GROUP BY original_key
),right_keys AS (
 SELECT original_key,COUNT(*) AS n,MIN(semantic_sha256) AS semantic_sha256
 FROM """ + _qi(right) + """ WHERE original_key_state='value' GROUP BY original_key
),keys AS (
 SELECT original_key FROM left_keys UNION SELECT original_key FROM right_keys
)
SELECT k.original_key,
 CASE WHEN COALESCE(l.n,0)>1 OR COALESCE(r.n,0)>1 THEN 'ambiguous'
      WHEN l.n IS NULL THEN 'observedOnlyRight'
      WHEN r.n IS NULL THEN 'observedOnlyLeft'
      WHEN l.semantic_sha256=r.semantic_sha256 THEN 'same' ELSE 'changed' END AS classification,
 COALESCE(l.n,0) AS left_occurrences,COALESCE(r.n,0) AS right_occurrences,
 CASE WHEN l.n=1 THEN l.semantic_sha256 END AS left_semantic_sha256,
 CASE WHEN r.n=1 THEN r.semantic_sha256 END AS right_semantic_sha256,
 NULL AS unkeyed_side,NULL AS unkeyed_occurrence_id
FROM keys k LEFT JOIN left_keys l USING(original_key) LEFT JOIN right_keys r USING(original_key)
UNION ALL
SELECT NULL,'unkeyed',1,0,semantic_sha256,NULL,'left',occurrence_id
FROM """ + _qi(left) + """ WHERE original_key_state='missing'
UNION ALL
SELECT NULL,'unkeyed',0,1,NULL,semantic_sha256,'right',occurrence_id
FROM """ + _qi(right) + """ WHERE original_key_state='missing'
"""


def _rational(value):
    return str(value.numerator) + "/" + str(value.denominator)


def _metadata_document(programme, sources):
    statistics_columns = ["edition_label", "stream_kind", "stream_id_type", "stream_id",
                          "stream_name", "observation_type", "observed_property", "unit",
                          "eligible_occurrences", "minimum_original_literal", "maximum_original_literal",
                          "sum_fraction", "mean_fraction", "mean_decimal_34", "median_fraction",
                          "first_source_time", "last_source_time", "method"]
    inventory_columns = ["edition_label", "edition_id", "source_url", "selected_query_json",
                         "traversal_status", "source_complete", "observations", "components", "entities",
                         "unique_record_keys", "ambiguous_record_keys", "unkeyed_occurrences",
                         "source_export_id", "source_export_bytes", "source_export_sha256",
                         "source_license_json"]
    inventory, statistics = [], []
    for source in sources:
        intake, document = source["intake"], source["document"]
        keys = defaultdict(int)
        unkeyed = 0
        for row in document["observation_index"]:
            if row["original_key_state"] == "missing":
                unkeyed += 1
            else:
                keys[row["original_key"]] += 1
        inventory.append({
            "edition_label": source["name"], "edition_id": intake["editionId"],
            "source_url": source["edition"]["source"]["serviceUrl"],
            "selected_query_json": json.dumps(source["edition"]["plan"]["observationQuery"],
                                             ensure_ascii=False, separators=(",", ":")),
            "traversal_status": str(intake["scope"]["status"]),
            "source_complete": str(source["source"]["complete"]).lower(),
            "observations": str(len(document["observations"])),
            "components": str(len(document["components"])), "entities": str(len(document["entities"])),
            "unique_record_keys": str(len(keys)),
            "ambiguous_record_keys": str(sum(n > 1 for n in keys.values())),
            "unkeyed_occurrences": str(unkeyed), "source_export_id": intake["exportId"],
            "source_export_bytes": str(intake["archive"]["bytes"]),
            "source_export_sha256": intake["archive"]["sha256"],
            "source_license_json": json.dumps(intake["sourceLicense"], ensure_ascii=False,
                                             separators=(",", ":"))})
        eligibility = {row["occurrence_id"]: row for row in document["numeric_eligibility"]}
        groups = defaultdict(list)
        for row in document["observations"]:
            if eligibility[row["occurrence_id"]]["eligible"] != "true":
                continue
            _need(row["result_state"] == "value" and row["result_type"] == "number" and
                  row["phenomenon_time_kind"] == "explicit_instant", "NUMERIC_SOURCE_STATE_CHANGED")
            number = Decimal(row["result"])
            _need(number.is_finite(), "ORIGINAL_NUMERIC_VALUE_NOT_FINITE")
            group = tuple(row[field] for field in (
                "stream_kind", "stream_id_type", "stream_id", "stream_name",
                "observation_type", "observed_property", "unit"))
            groups[group].append((number, row["result"], row["phenomenon_start_utc"]))
        for group, values in sorted(groups.items()):
            values.sort(key=lambda item: item[0])
            count = len(values)
            exact_sum = sum((Fraction(item[0]) for item in values), Fraction(0))
            mean = exact_sum / count
            middle = count // 2
            median = (Fraction(values[middle][0]) if count % 2 else
                      (Fraction(values[middle - 1][0]) + Fraction(values[middle][0])) / 2)
            with localcontext() as context:
                context.prec = 34
                rounded_mean = str(Decimal(mean.numerator) / Decimal(mean.denominator))
            times = [item[2] for item in values]
            row = dict(zip(statistics_columns[1:8], group))
            row.update(edition_label=source["name"], eligible_occurrences=str(count),
                       minimum_original_literal=values[0][1], maximum_original_literal=values[-1][1],
                       sum_fraction=_rational(exact_sum), mean_fraction=_rational(mean),
                       mean_decimal_34=rounded_mean, median_fraction=_rational(median),
                       first_source_time=min(times), last_source_time=max(times),
                       method="Original numericEligibility selection; Decimal literals and exact Fraction arithmetic; decimal mean rounded to 34 significant digits.")
            statistics.append(row)
    root = private_directory(programme.output / "analysis-method-source")
    private_directory(root / "files")
    value = {"inventory": inventory, "exact_numeric_statistics": statistics}
    body = _json(value)
    _need(len(body) <= _MAX_DOCUMENT, "METHOD_DOCUMENT_CAPACITY")
    document = {"path": "files/" + digest(body) + ".json", "bytes": len(body),
                "sha256": digest(body), "contentType": "application/json"}
    _immutable(root / document["path"], body)
    originals = []
    for index, source in enumerate(sources):
        raw = read(source["intake_path"], 4 * 1024 * 1024)
        _need(digest(raw) == source["intake_sha256"], "METHOD_SOURCE_INTAKE_CHANGED")
        item = {"path": "files/" + digest(raw) + ".json", "bytes": len(raw),
                "sha256": digest(raw), "contentType": "application/json",
                "role": "source-intake-" + str(index + 1)}
        _immutable(root / item["path"], raw)
        originals.append(item)
    module = read(_path(__file__), 1024 * 1024)
    module_record = {"path": "files/" + digest(module) + ".txt", "bytes": len(module),
                     "sha256": digest(module), "contentType": "text/plain;charset=utf-8",
                     "role": "complete-calculation-programme-source"}
    _immutable(root / module_record["path"], module)
    originals.append(module_record)
    captured = programme.intent("method-capture-time", lambda: {"at": _now()})["at"]
    manifest = {
        "schema": "stellar-forge.analysis-source-document.v1",
        "title": "SensorThings original source inventory and exact numeric summaries",
        "format": "json", "document": document, "originals": originals,
        "complete": all(source["source"]["complete"] for source in sources),
        "provenance": {"kind": "operator-file", "publisher": "SensorThings analysis workspace",
            "capturedAt": captured, "scope": "The exact retained source editions selected by operation " + programme.operation,
            "description": "Derived inventory and exact source-number summaries. Original source intake descriptors and the complete calculation module accompany this document; every original source edition and its complete archive are separately retained in this same Analysis workspace. The classifier is the unchanged SensorThings analysis numericEligibility function. Numerical summaries preserve source number text and use exact rational arithmetic. The decimal mean alone is rounded to 34 significant digits. No source query, capture, quality label or payment status is invented or changed."}}
    validate_manifest(manifest)
    manifest_path = root / "source.json"
    _immutable(manifest_path, _json(manifest))
    programme.outputs['analysis-method:source.json'] = _immutable(manifest_path, _json(manifest))
    for item in [document, *originals]:
        programme.outputs['analysis-method:' + item['path']] = {
            'path': str(root / item['path']), 'bytes': item['bytes'], 'sha256': item['sha256']}
    return manifest_path, {
        "inventory": {"collection": "/inventory", "rows": len(inventory), "columns": inventory_columns},
        "exact_numeric_statistics": {"collection": "/exact_numeric_statistics",
                                     "rows": len(statistics), "columns": statistics_columns}}


def _query_sheet(query, ordinal):
    title = re.sub(r"[\x00-\x1f\\/*?:\[\]]", " ", query["title"]).strip().strip("'")
    name = (str(ordinal).zfill(2) + " " + title)[:31].rstrip("'")
    return {"name": name, "source": {"kind": "query-export", "id": query["query_export_id"],
                                    "sha256": query["export_sha256"]},
            "columns": [{"source": column, "header": column, "type": "text",
                         "null": "text", "null_text": "NULL", "precision": "preserve"}
                        for column in query["columns"]]}


def _handover_guide(result):
    source_lines = "\n".join(
        "- " + item["name"] + ": source edition " + item["edition_id"] + "; " +
        str(item["tables"]["observations"]["rows"]) + " observations, " +
        str(item["tables"]["components"]["rows"]) + " component rows, " +
        str(item["tables"]["entities"]["rows"]) + " entity occurrences."
        for item in result["sources"])
    return """SENSORTHINGS SOURCE ANALYSIS
Complete retained source, editable analysis and portable customer receiving

Operation: """ + result["operation_id"] + """
Original Analysis workspace: """ + result["workspace_id"] + """

START HERE
Open reports/original.html for the original report and reports/receiving.html
for the actual report revision made after workspace receiving. The first
workbook in workbooks/source_1/workbook.xlsx contains the report tables and
full query rows. Additional source workbooks carry every remaining table.
workbooks/receiving/workbook.xlsx includes the daily-coverage edit performed
in the restored workspace.

Each workbook also has its complete handoff.zip, original definition and
manifest. The original WorkbookDelivery receiver has opened and inspected
every supplied workbook handoff. These are ordinary editable XLSX files;
original IDs, number literals, JSON and source time fields remain text.
Use the source engine's existing numeric view for plotted scalar values.
Excel automatic coercion is unnecessary and may change source precision.

ORIGINAL SOURCES
""" + source_lines + """

The retained observations, components and entities are the original source
engine's complete table projections. observation_index adds the original
typed source keys and semantic hashes. numeric_eligibility retains the
original source engine's numeric-view decision and reason for every
observation. Source archives retain original response bodies, request URLs,
connector records, query scope, metadata phases and licence terms.

All five tables are imported through the original Analysis response-document
path. The complete document and original source archive are stored once per
edition inside the workspace's content-addressed document collection. The
three raw tables are not replaced by the derived index or classifier.

READ THE NUMBERS CORRECTLY
Category codes remain categories. The report counts observed occurrences
and unambiguous adjacent observed code differences. It does not assign an
elapsed duration to an observation, infer uptime, interpolate coverage or
assert current station capacity. A source time is not a capture clock.

Numeric summaries include only rows admitted by the unchanged scalar
analysis numericEligibility function. Each group retains its original
stream kind, typed ID, observation type, observed property and unit. It
does not combine different units or implicitly select a multidimensional
component. Minimum and maximum preserve original source number literals.
Sum, mean and median use exact rational arithmetic. mean_decimal_34 is
the sole rounded companion field, with 34 significant decimal digits.
The complete calculation source is retained with the derived document.

The comparison uses original typed observation/stream keys and original
semantic hashes, including stream meaning and relationships. Repeated keys
remain ambiguous. Missing keys remain unkeyed. An observed-only record does
not prove insertion or deletion at the source. Scope compatibility is
reported explicitly. Opening and closing metadata captures remain separate
from fixed-window observation comparisons.

CONTINUE WORK IN THE ORIGINAL APPLICATION
workspaces/original.zip contains the complete original Analysis workspace:
original sources and archives, immutable imported versions, named views,
saved SQL histories, full query exports, report definitions/publications,
workbook definitions/outputs and the original job records.

workspaces/receiving.zip contains the workspace after an actual cold restore,
saved-query revision, report publication, workbook revision and second export.
The original stream_coverage recipe remains at revision 1. Revision 2 groups
explicit source instants by UTC date. Both histories remain readable.
Receiving used the original restore_archive operation and preserved the
original workspace identity. It did not create a replacement Analysis engine.

To receive a workspace with the installed original package:
  from stellar_forge_buyer.workspace_archive_receive import restore_archive
  restore_archive("workspaces/receiving.zip", "/absolute/new/customer-workspace",
                  operation="<one retained UUID32>",
                  expected_sha256="<the exact workspace file SHA-256>")

The original application opens that directory:
  python -m stellar_forge_buyer.analysis_workspace --help

Use its existing open/serve command and the original package's displayed
operator session. There is no additional account, workspace token gate,
payment layer or provider credential in this receiving programme. A provider
recapture is an explicit later source action; reading this handover does not
contact a provider.

FULL DATA AND REPRODUCIBILITY
queries/ contains complete original query-export JSONL, CSV and manifests.
The workbooks read those full exports, including when a small interactive
query preview was truncated. JSONL retains the original typed export format.
CSV is produced by the original spreadsheet-safe exporter.

analysis-method-source/ contains the original document manifest, all selected
intake descriptors and the complete calculation source. All underlying
source documents also travel inside both portable workspace archives.
programme-result.json lists actual source IDs, immutable imported versions,
query/job identities, report/publication revisions, workbook identities,
receiving operation and every supplied file's byte count and SHA-256.

All paths in the outer handover ZIP are relative. The original workspace
receiver reconstructs the original internal relative content addresses.
Vendor connections and credentials remain outside this handover.
"""


def _handover_zip(directory, records):
    directory = _path(directory)
    by_name = {}
    for item in records:
        path = _path(item["path"])
        _need(path.is_relative_to(directory), "HANDOVER_PATH_REQUIRED")
        relative = path.relative_to(directory).as_posix()
        _need(relative not in by_name and not relative.startswith("."),
              "HANDOVER_DUPLICATE_OR_PRIVATE_FILE")
        _verify(path, item, max(item["bytes"], 1))
        by_name[relative] = item
    target = directory / "SensorThings_Analysis_Complete_Handover.zip"
    if not target.exists():
        fd, name = tempfile.mkstemp(prefix=".sensorthings-handover-", suffix=".partial", dir=directory)
        temporary = Path(name)
        with os.fdopen(fd, "w+b") as stream:
            with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED,
                                 compresslevel=6, allowZip64=True) as archive:
                for relative, item in sorted(by_name.items()):
                    info = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
                    info.compress_type = zipfile.ZIP_DEFLATED
                    info.external_attr = 0o100600 << 16
                    with _open(item["path"]) as source, archive.open(info, "w", force_zip64=True) as destination:
                        while True:
                            block = source.read(1024 * 1024)
                            if not block:
                                break
                            destination.write(block)
            stream.flush()
            os.fsync(stream.fileno())
        # Verify every completed member before publishing this owned archive.
        _verify_handover(temporary, by_name)
        try:
            os.link(temporary, target)
        except FileExistsError:
            _verify_handover(target, by_name)
        _verify_handover(target, by_name)
        temporary.unlink()
        sync_directory(directory)
    else:
        _verify_handover(target, by_name)
    with _open(target) as stream:
        return {"path": str(target), "bytes": os.fstat(stream.fileno()).st_size,
                "sha256": hashlib.file_digest(stream, "sha256").hexdigest(),
                "contentType": "application/zip"}


def _verify_handover(path, expected):
    with _open(path) as source, zipfile.ZipFile(source) as archive:
        entries = archive.infolist()
        _need(len(entries) == len(expected) and len({x.filename for x in entries}) == len(entries)
              and {x.filename for x in entries} == set(expected), "HANDOVER_MEMBER_CLOSURE")
        for entry in entries:
            record = expected[entry.filename]
            _need(entry.file_size == record["bytes"], "HANDOVER_MEMBER_SIZE")
            with archive.open(entry) as stream:
                _need(hashlib.file_digest(stream, "sha256").hexdigest() == record["sha256"],
                      "HANDOVER_MEMBER_CHANGED")


def main():
    parser = argparse.ArgumentParser(
        description="Receive complete original SensorThings editions, produce editable analysis/report/workbooks, then cold-restore and continue the same Analysis workspace.")
    parser.add_argument("--input", required=True, help="Absolute original programme JSON request.")
    args = parser.parse_args()
    request = json.loads(read(_path(args.input), 4 * 1024 * 1024))
    programme = Programme(request)
    try:
        result = programme.run()
    except Exception as error:
        programme.event("failed", error_type=type(error).__name__, error=str(error))
        raise
    print(json.dumps({"status": result["status"], "operation_id": result["operation_id"],
                      "delivery": result["delivery"]}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
