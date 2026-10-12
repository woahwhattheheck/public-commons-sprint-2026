"""Citation audit tables, workbook and cold workspace receive on original Analysis."""
from __future__ import annotations

from contextlib import closing
import csv
import hashlib
import json
import os
from pathlib import Path
import tempfile
import time
import uuid

from .analysis_workspace import AnalysisWorkspace
from .errors import StateError
from .research_citations import CitationDelivery, _json, _need, _exists, _immutable, _pin, _object_file, _file_delivery
from .response_documents import validate_manifest, retained_document_files
from .storage import digest, private_directory, write, lock, sync_directory
from .workspace_archive_receive import restore_archive

_COLUMNS = ("position", "phase", "revision", "kind", "notice_id", "notice_doi", "target_doi",
            "question_id", "record_id", "title", "text_json", "text_characters",
            "text_preview_json", "text_preview_complete", "citation_ids_json", "record_json")
_WORKBOOK_COLUMNS = tuple(name for name in _COLUMNS if name not in {"text_json", "record_json", "citation_ids_json"})
_SOURCE = "citation_review"
_SCHEMA = "stellar-forge.citation-analysis-receiving.v1"


def _rows(selection):
    position = 0
    for phase in ("before", "reviewed", "current"):
        selected = selection["snapshots"][phase]
        notice = selected["detail"]["detail"]
        records = [("notice", {key: notice.get(key) for key in
            ("noticeId", "noticeDoi", "targetDoi", "title", "status", "fingerprint", "registeredUpdates")})]
        records.extend(("evidence", row) for row in notice["evidence"])
        records.extend(("finding", row) for row in notice["findings"])
        records.extend(("source", row) for row in notice["noticeSources"])
        records.extend(("review", {key: row.get(key) for key in
            ("id", "requestId", "requestSha256", "actor", "decision", "reason", "originalRevision", "revision", "sha256")})
                       for row in notice["reviews"])
        records.append(("coverage", {"coverage": selected["detail"]["coverage"]}))
        for kind, record in records:
            position += 1
            _need(position <= 1_000_000, "CITATION_ANALYSIS_ROW_LIMIT")
            text = record.get("text", record.get("note", record.get("reason", record.get("title", "")))) or ""
            row = {"position": position, "phase": phase, "revision": selected["revision"],
                "kind": kind, "notice_id": notice["noticeId"], "notice_doi": notice["noticeDoi"],
                "target_doi": notice["targetDoi"], "question_id": record.get("questionId", ""),
                "record_id": record.get("id", record.get("occurrenceId", record.get("noticeId", ""))),
                "title": record.get("title", ""), "text_json": json.dumps(text, ensure_ascii=True),
                "text_characters": len(text), "text_preview_json": json.dumps(text[:2000], ensure_ascii=True),
                "text_preview_complete": str(len(text) <= 2000).lower(),
                "citation_ids_json": _json(record.get("occurrenceIds", [])).decode(),
                "record_json": _json(record).decode()}
            yield row


def _content(root, raw, extension, content_type):
    sha = digest(raw)
    path = root / "files" / (sha + "." + extension)
    if _exists(path):
        actual = _pin(path)
        _need(actual["sha256"] == sha and actual["bytes"] == len(raw), "CITATION_ANALYSIS_SOURCE_CHANGED")
    else:
        write(path, raw, exclusive=True)
    return {"path": "files/" + path.name, "bytes": len(raw), "sha256": sha, "contentType": content_type}


def citation_analysis_source(delivery, directory):
    """Retain exact complete Research bytes beside an explicitly scoped audit index."""
    manifest = delivery.verify()
    root = private_directory(Path(directory))
    private_directory(root / "files")
    with lock(root):
        fd, temporary = tempfile.mkstemp(prefix=".citation-rows-", dir=root)
        row_count = 0
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="") as stream:
                writer = csv.DictWriter(stream, fieldnames=_COLUMNS)
                writer.writeheader()
                for row in _rows(delivery.selection):
                    writer.writerow(row)
                    row_count += 1
                stream.flush()
                os.fsync(stream.fileno())
            pin = _pin(temporary)
            destination = root / "files" / (pin["sha256"] + ".csv")
            if _exists(destination):
                _need(_pin(destination)["sha256"] == pin["sha256"], "CITATION_ANALYSIS_SOURCE_CHANGED")
            else:
                os.link(temporary, destination)
                sync_directory(destination.parent)
        finally:
            Path(temporary).unlink(missing_ok=True)
        document = {"path": "files/" + destination.name, "bytes": pin["bytes"], "sha256": pin["sha256"],
                    "contentType": "text/csv; charset=utf-8"}
        originals = []
        for role, file in (("citation-selection", delivery.selection_file),
                           ("citation-delivery-index", delivery.directory / "delivery.json")):
            with _file_delivery(_pin(file)).open() as stream:
                raw = stream.read()
            _need(len(raw) <= 32 * 1024 * 1024, "CITATION_ANALYSIS_ORIGINAL_LIMIT")
            originals.append({**_content(root, raw, "json", "application/json"), "role": role})
        archive = next(item for item in manifest["files"] if item["label"] == "current" and item["format"] == "json.gz")
        archive_parts, offset = [], 0
        with _file_delivery({**archive, "file": str(delivery.files / archive["name"])}).open() as stream:
            while raw := stream.read(16 * 1024 * 1024):
                role = "original-portable-" + str(len(archive_parts)).zfill(4)
                part = {**_content(root, raw, "bin", "application/octet-stream"), "role": role}
                originals.append(part)
                archive_parts.append({**part, "offset": offset})
                offset += len(raw)
        _need(offset == archive["bytes"], "CITATION_ANALYSIS_ORIGINAL_CHANGED")
        source_receipt = {"schema": _SCHEMA, "selectionSha256": delivery.selection_pin["sha256"],
            "rows": row_count, "columns": list(_COLUMNS), "workbookColumns": list(_WORKBOOK_COLUMNS),
            "originalPortable": {**{key: archive[key] for key in ("name", "bytes", "sha256")}, "parts": archive_parts},
            "scope": "All notice, evidence, finding, source, review-index and coverage rows for the selected notice at each of three pinned revisions."}
        originals.append({**_content(root, _json(source_receipt) + b"\n", "json", "application/json"),
                          "role": "citation-analysis-receipt"})
        value = {"schema": "stellar-forge.analysis-source-document.v1",
            "title": "Citation review — before, reviewed and current", "format": "csv",
            "document": document, "originals": originals, "complete": True,
            "provenance": {"kind": "operator-file", "publisher": "Stellar Forge Research",
                "capturedAt": delivery.selection["review"]["createdAt"],
                "scope": "Dossier " + delivery.selection["dossierId"] + "; review " + delivery.selection["review"]["id"],
                "description": "The audit index preserves complete per-evidence/finding/source records and explicit provider coverage. "
                    "Review index rows point to the entire immutable requests and decisions in the exact selection original. "
                    "The complete current Research portable archive, including all previous revisions and original source bytes, "
                    "is retained in ordered hash-checked parts. Workbook text previews are separately labelled."}}
        validate_manifest(value)
        _immutable(root / "source.json", value)
        _immutable(root / "analysis-source.json", source_receipt)
    mapping = {"collection": "", "sse_data": "text", "columns": [
        {"name": name, "pointer": "/" + name,
         "type": "integer" if name in {"position", "revision", "text_characters"} else "text",
         "missing": "error"} for name in _COLUMNS]}
    return {"manifest": str(root / "source.json"), "documentId": _pin(root / "source.json")["sha256"],
            "rows": row_count, "mapping": mapping, "columns": list(_COLUMNS)}


def _download(context, path):
    private_directory(path.parent)
    with context as (stream, record):
        if _exists(path):
            actual = _pin(path)
            _need(all(actual[key] == record[key] for key in ("bytes", "sha256")), "CITATION_ANALYSIS_EXPORT_CHANGED")
            return {**record, "file": str(path)}
        fd, temporary = tempfile.mkstemp(prefix=".citation-download-", dir=path.parent)
        try:
            sha, count = hashlib.sha256(), 0
            with os.fdopen(fd, "wb") as output:
                while block := stream.read(1024 * 1024):
                    count += len(block)
                    _need(count <= record["bytes"], "CITATION_ANALYSIS_EXPORT_CHANGED")
                    sha.update(block)
                    output.write(block)
                _need(count == record["bytes"] and sha.hexdigest() == record["sha256"], "CITATION_ANALYSIS_EXPORT_CHANGED")
                output.flush()
                os.fsync(output.fileno())
            os.link(temporary, path)
            sync_directory(path.parent)
        finally:
            Path(temporary).unlink(missing_ok=True)
    return {**record, "file": str(path)}


def run_citation_analysis(delivery, directory, *, checkout, node="node", wait_seconds=900):
    """One original response import, saved SQL, full exports, workbook and cold restore."""
    root = private_directory(Path(directory))
    records = private_directory(root / "records")
    outputs = private_directory(root / "outputs")
    _need(type(wait_seconds) is int and 1 <= wait_seconds <= 3600, "CITATION_ANALYSIS_WAIT_INVALID")
    with lock(root):
        operation_file = root / "operation.json"
        if _exists(operation_file):
            operation = _object_file(operation_file)
            _need(operation.get("selectionSha256") == delivery.selection_pin["sha256"], "CITATION_ANALYSIS_SELECTION_CHANGED")
        else:
            operation = {"schema": _SCHEMA, "selectionSha256": delivery.selection_pin["sha256"],
                "jobs": {name: uuid.uuid4().hex for name in ("preview", "import", "query", "export", "workbook", "archive")},
                "workbookRequest": uuid.uuid4().hex, "restoreOperation": uuid.uuid4().hex}
            _immutable(operation_file, operation)
        complete_file = root / "complete.json"
        if _exists(complete_file):
            complete = _object_file(complete_file)
            for file in complete["files"].values():
                actual = _pin(file["file"])
                _need(all(actual[key] == file[key] for key in ("bytes", "sha256")), "CITATION_ANALYSIS_EXPORT_CHANGED")
            return complete
        source = citation_analysis_source(delivery, root / "source")

        def job(ws, name, kind, body):
            path = records / ("request-" + name + ".json")
            if _exists(path):
                request = _object_file(path)
                _need(request["kind"] == kind, "CITATION_ANALYSIS_JOB_CHANGED")
                # Reuse the original view selection and reviewed preview, even
                # when another later operation has changed the live view.
            else:
                request = {"kind": kind, "body": {"id": operation["jobs"][name], **body}}
                _immutable(path, request)
            current = ws.start(kind, request["body"])
            deadline = time.monotonic() + wait_seconds
            while current["status"] == "RUNNING":
                if time.monotonic() >= deadline:
                    raise StateError("CITATION_ANALYSIS_JOB_RUNNING:" + current["id"])
                time.sleep(0.2)
                current = ws.job(current["id"])
            _need(current["status"] == "COMPLETE", "CITATION_ANALYSIS_JOB_" + current["status"] + ":" + current["id"])
            _immutable(records / ("job-" + name + ".json"), {key: current.get(key) for key in
                ("id", "kind", "request", "result", "finished_at")})
            return current

        files = {}
        with closing(AnalysisWorkspace(root / "workspace", checkout=checkout, node=node)) as ws:
            _immutable(records / "workspace.json", {"workspaceId": ws.identity})
            registration = ws.responses.register(_SOURCE, "document", manifest=source["manifest"],
                                                  format="csv", expected_revision=0)
            preview = job(ws, "preview", "response-preview", {"source": _SOURCE,
                "source_revision": registration["revision"], "mapping": source["mapping"]})
            imported = job(ws, "import", "response-import", {
                "preview_id": preview["id"], "preview_sha256": preview["result"]["preview_sha256"],
                "allow_incomplete": False})
            version = imported["result"]["version"]
            _need(version["row_count"] == source["rows"], "CITATION_ANALYSIS_ROW_COUNT_CHANGED")
            view = next((item for item in ws.state()["views"] if item["name"] == _SOURCE), None)
            if view is None:
                ws.database.activate(_SOURCE, version["version_id"], expected_revision=0)
            else:
                _need(view["version_id"] == version["version_id"], "CITATION_ANALYSIS_VIEW_CHANGED")
            sql = "SELECT " + ",".join('"' + name + '"' for name in _COLUMNS) + ' FROM "' + _SOURCE + '" ORDER BY "position"'
            query_spec = {"sql": sql, "parameters_text": "[]", "max_rows": 100000}
            try:
                saved = ws.saved_query("CitationReview", revision=1)
                _need(all(saved[key] == value for key, value in query_spec.items()), "CITATION_ANALYSIS_QUERY_CHANGED")
            except StateError as error:
                if error.code != "ANALYSIS_QUERY_NOT_FOUND":
                    raise
                saved = ws.save_query("CitationReview", query_spec, expected_revision=0)
            query = job(ws, "query", "query", {**query_spec, "expected_views": ws.state()["views"]})
            exported = job(ws, "export", "query-export", {"query_id": query["id"],
                "result_sha256": query["result"]["result_sha256"], "label": "Citation review audit",
                "formats": ["jsonl", "csv", "sqlite"], "timeout": 300, "spreadsheet_safe": True})
            for name in ("rows.jsonl", "rows.csv", "rows.sqlite3", "manifest.json"):
                files["query/" + name] = _download(ws.exports.download(exported["id"], name), outputs / "query" / name)
            typed = ws.workbooks.source({"kind": "query-export", "id": exported["id"]})
            _need(typed["row_count"] == source["rows"], "CITATION_ANALYSIS_FULL_EXPORT_REQUIRED")
            definition = ws.workbooks.save("CitationReview", {
                "id": operation["workbookRequest"], "expected_revision": 0,
                "title": "Citation review — original, reviewed and current",
                "notes": "All selected occurrences and provider coverage remain in the full typed exports and original Research portable. "
                    "The spreadsheet uses explicit ASCII JSON text previews limited to 2,000 characters, with full length and completeness.",
                "sheets": [{"name": "Citation review", "source": {
                    "kind": "query-export", "id": exported["id"], "sha256": typed["sha256"]},
                    "columns": [{"source": name, "header": name,
                        "type": "integer" if name in {"position", "revision", "text_characters"} else "text",
                        "null": "text", "null_text": "NULL", "precision": "preserve"} for name in _WORKBOOK_COLUMNS]}]})
            workbook = job(ws, "workbook", "workbook", {"name": "CitationReview", "revision": definition["revision"],
                                                      "definition_sha256": definition["definition_sha256"]})
            for name in ("workbook.xlsx", "handoff.zip", "manifest.json"):
                files["workbook/" + name] = _download(ws.workbooks.download(workbook["id"], name), outputs / "workbook" / name)
            _need(ws.archives.review(include_previous_backups=False)["ready"], "CITATION_ANALYSIS_ARCHIVE_NOT_READY")
            archive = job(ws, "archive", "workspace-export", {"include_previous_backups": False})
            for name in ("workspace.zip", "archive-manifest.json"):
                files["workspace/" + name] = _download(ws.archives.download(archive["id"], name), outputs / "workspace" / name)
            result = {"schema": _SCHEMA, "selectionSha256": operation["selectionSha256"],
                "workspaceId": ws.identity, "source": source, "version": version, "queryId": query["id"],
                "queryResultSha256": query["result"]["result_sha256"], "exportId": exported["id"],
                "workbookId": workbook["id"], "archiveId": archive["id"], "files": files,
                "sourceFiles": retained_document_files(ws.database.directory, source["documentId"])}
            _immutable(records / "saved.json", result)
        portable = files["workspace/workspace.zip"]
        restored = restore_archive(portable["file"], root / "restored", operation=operation["restoreOperation"],
                                   expected_sha256=portable["sha256"])
        with closing(AnalysisWorkspace(root / "restored")) as ws:
            _need(ws.identity == result["workspaceId"], "CITATION_ANALYSIS_RESTORED_ID_CHANGED")
            _need(ws.job(query["id"])["result"]["result_sha256"] == result["queryResultSha256"],
                  "CITATION_ANALYSIS_RESTORED_QUERY_CHANGED")
            native_files = retained_document_files(ws.database.directory, source["documentId"])
            _need(native_files == result["sourceFiles"], "CITATION_ANALYSIS_RESTORED_SOURCE_CHANGED")
            for context, key in ((ws.workbooks.download(workbook["id"], "workbook.xlsx"), "workbook/workbook.xlsx"),
                                 (ws.exports.download(exported["id"], "rows.jsonl"), "query/rows.jsonl")):
                with context as (stream, record):
                    expected = files[key]
                    _need(all(record[key] == expected[key] for key in ("bytes", "sha256")),
                          "CITATION_ANALYSIS_RESTORED_EXPORT_CHANGED")
                    sha, count = hashlib.sha256(), 0
                    while block := stream.read(1024 * 1024):
                        sha.update(block)
                        count += len(block)
                    _need(count == expected["bytes"] and sha.hexdigest() == expected["sha256"],
                          "CITATION_ANALYSIS_RESTORED_EXPORT_CHANGED")
            result["receiving"] = {"restore": restored, "workspaceId": ws.identity, "sourceFiles": native_files,
                                   "canImportWithoutCheckout": ws.state()["can_import"]}
        _immutable(complete_file, result)
        return result
