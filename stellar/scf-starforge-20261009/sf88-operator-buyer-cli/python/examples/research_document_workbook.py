#!/usr/bin/env python3
"""Retained Documents/Pipelines edition -> native Analysis -> workbook -> restore.

Run prepare, review its exact native preview, then finish with that digest.
Every provider/job/output identity comes from the retained edition. This caller
does not submit, poll, cancel or recreate a provider job.
"""
from __future__ import annotations

import argparse
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import time
import uuid

from stellar_forge_buyer.analysis_workspace import AnalysisWorkspace
from stellar_forge_buyer.errors import StateError
from stellar_forge_buyer.research_documents import ResearchDocumentSource
from stellar_forge_buyer.response_documents import document_path, retained_document_files
from stellar_forge_buyer.storage import dump, lock, parse, private_directory, read, sync_directory
from stellar_forge_buyer.workspace_archive_receive import restore_archive

SCHEMA = "stellar-forge.research-document-workbook-operation.v1"
HASH = re.compile(r"[a-f0-9]{64}")
SOURCE = "document_elements"
QUERY = "DocumentElements"
WORKBOOK = "DocumentElements"
JOBS = ("preview", "import", "query", "query_export", "workbook", "workspace_export")
WORKBOOK_COLUMNS = (
    "position", "provider", "operation_id", "profile_id", "text_preview_json",
    "text_preview_complete", "text_characters", "document_sha256",
    "output_sha256", "edition_sha256",
)


def need(condition, code):
    if not condition:
        raise StateError(code)


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False,
                      separators=(",", ":")).encode("utf-8")


def pin(path, maximum=None):
    path = Path(path).expanduser().absolute()
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), "rb") as stream:
        before = os.fstat(stream.fileno())
        need(stat.S_ISREG(before.st_mode), "DOCUMENT_WORKBOOK_REGULAR_FILE_REQUIRED")
        if maximum is not None:
            need(before.st_size <= maximum, "DOCUMENT_WORKBOOK_FILE_LIMIT")
        sha = hashlib.file_digest(stream, "sha256").hexdigest()
        after = os.fstat(stream.fileno())
        fields = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
        need(all(getattr(before, key) == getattr(after, key) for key in fields),
             "DOCUMENT_WORKBOOK_SOURCE_CHANGED")
    return {"path": str(path), "bytes": before.st_size, "sha256": sha}


def retained(path, value, *, identity=None):
    """Keep the first exact local receipt; native operation IDs remain primary."""
    if path.exists():
        old = parse(read(path, 32 * 1024 * 1024))
        need(canonical(old if identity is None else {key: old.get(key) for key in identity}) ==
             canonical(value if identity is None else {key: value.get(key) for key in identity}),
             "DOCUMENT_WORKBOOK_RECEIPT_CHANGED")
        return old
    dump(path, value, exclusive=True)
    return value


def download(context, destination):
    """Consume the original checked export stream; never overwrite a delivery."""
    destination = Path(destination)
    private_directory(destination.parent)
    with context as (stream, record):
        expected = {"bytes": record["bytes"], "sha256": record["sha256"]}
        if destination.exists():
            actual = pin(destination)
            need(all(actual[key] == value for key, value in expected.items()),
                 "DOCUMENT_WORKBOOK_DELIVERY_CHANGED")
            return {**record, "path": str(destination)}
        fd, temporary = tempfile.mkstemp(prefix=".document-workbook-", dir=destination.parent)
        try:
            count, sha = 0, hashlib.sha256()
            with os.fdopen(fd, "wb") as output:
                while block := stream.read(1024 * 1024):
                    count += len(block)
                    need(count <= expected["bytes"], "DOCUMENT_WORKBOOK_DELIVERY_CHANGED")
                    output.write(block)
                    sha.update(block)
                need(count == expected["bytes"] and sha.hexdigest() == expected["sha256"],
                     "DOCUMENT_WORKBOOK_DELIVERY_CHANGED")
                output.flush()
                os.fsync(output.fileno())
            os.link(temporary, destination)
            os.unlink(temporary)
            sync_directory(destination.parent)
        finally:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass
    return {**record, "path": str(destination)}


def verify_download(context, expected):
    with context as (stream, record):
        need(record["bytes"] == expected["bytes"] and record["sha256"] == expected["sha256"],
             "DOCUMENT_WORKBOOK_RESTORED_DELIVERY_CHANGED")
        count, sha = 0, hashlib.sha256()
        while block := stream.read(1024 * 1024):
            count += len(block)
            sha.update(block)
        need(count == expected["bytes"] and sha.hexdigest() == expected["sha256"],
             "DOCUMENT_WORKBOOK_RESTORED_DELIVERY_CHANGED")
        return {"bytes": count, "sha256": sha.hexdigest()}


class Workflow:
    def __init__(self, directory, *, checkout=None, node="node", wait_seconds=900):
        self.root = private_directory(Path(directory).expanduser().absolute())
        self.checkout = str(Path(checkout).expanduser().resolve()) if checkout else None
        self.node = node
        self.wait_seconds = wait_seconds
        self.records = private_directory(self.root / "records")
        self.deliveries = private_directory(self.root / "deliveries")
        self.operation = None

    def read_operation(self):
        value = parse(read(self.root / "operation.json", 1024 * 1024))
        need(value.get("schema") == SCHEMA, "DOCUMENT_WORKBOOK_OPERATION_CHANGED")
        self.operation = value
        return value

    def receipt(self, name, value, *, identity=None):
        return retained(self.records / (name + ".json"), value, identity=identity)

    def saved(self, name):
        return parse(read(self.records / (name + ".json"), 32 * 1024 * 1024))

    def workspace(self):
        return AnalysisWorkspace(self.root / "analysis", checkout=self.checkout, node=self.node)

    def bind_workspace(self, ws):
        self.receipt("workspace", {"workspace_id": ws.identity})

    def job(self, ws, name, kind, body):
        request = {"id": self.operation["jobs"][name], **body}
        selected = self.receipt("request-" + name, {"kind": kind, "request": request})
        job = ws.start(selected["kind"], selected["request"])
        deadline = time.monotonic() + self.wait_seconds
        while job["status"] == "RUNNING":
            if time.monotonic() >= deadline:
                raise StateError("DOCUMENT_WORKBOOK_JOB_STILL_RUNNING:" + job["id"])
            time.sleep(0.2)
            job = ws.job(job["id"])
        need(job["status"] == "COMPLETE",
             "DOCUMENT_WORKBOOK_NATIVE_JOB_" + job["status"] + ":" + job["id"] + ":" + str(job.get("error")))
        self.receipt("job-" + name, {key: job.get(key) for key in
            ("id", "kind", "request", "result", "finished_at")})
        return job

    def source(self):
        path = self.root / "source"
        if (path / "source.json").is_file():
            source = ResearchDocumentSource(path)
        else:
            need(self.checkout is not None, "DOCUMENT_WORKBOOK_ORIGINAL_RUNTIME_REQUIRED")
            source = ResearchDocumentSource.create(
                self.operation["selection"]["edition_file"], path, checkout=self.checkout, node=self.node,
                expected_sha256=self.operation["selection"]["file_sha256"],
                expected_edition_sha256=self.operation["selection"]["edition_sha256"],
                title=self.operation["selection"]["title"], captured_at=self.operation["created_at"])
        identity = source.receipt["identity"]
        need(identity["rawEditionSha256"] == self.operation["selection"]["file_sha256"] and
             identity["editionSha256"] == self.operation["selection"]["edition_sha256"] and
             source.manifest["title"] == self.operation["selection"]["title"],
             "DOCUMENT_WORKBOOK_EDITION_CHANGED")
        source.verify()
        self.receipt("source", {"document_id": source.document_id, "provider": identity["provider"],
                               "edition_sha256": identity["editionSha256"],
                               "row_count": source.receipt["rowCount"], "mapping": source.mapping})
        return source

    def prepare(self, *, edition, file_sha256, edition_sha256, title):
        need(self.checkout is not None, "DOCUMENT_WORKBOOK_ORIGINAL_RUNTIME_REQUIRED")
        need(all(isinstance(value, str) and HASH.fullmatch(value)
                 for value in (file_sha256, edition_sha256)), "DOCUMENT_WORKBOOK_REVIEWED_DIGESTS_REQUIRED")
        selected = {"edition_file": str(Path(edition).expanduser().absolute()),
                    "file_sha256": file_sha256, "edition_sha256": edition_sha256, "title": title}
        operation_file = self.root / "operation.json"
        if operation_file.exists():
            self.read_operation()
            need(self.operation["selection"] == selected, "DOCUMENT_WORKBOOK_SELECTION_CHANGED")
        else:
            actual = pin(selected["edition_file"], 64 * 1024 * 1024)
            need(actual["sha256"] == file_sha256, "DOCUMENT_WORKBOOK_EDITION_CHANGED")
            self.operation = {
                "schema": SCHEMA, "id": uuid.uuid4().hex,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "selection": selected, "jobs": {name: uuid.uuid4().hex for name in JOBS},
                "workbook_definition_request": uuid.uuid4().hex, "restore_operation": uuid.uuid4().hex,
            }
            dump(operation_file, self.operation, exclusive=True)
        source = self.source()
        with closing(self.workspace()) as ws:
            self.bind_workspace(ws)
            registration = source.register(ws, SOURCE, expected_revision=0)
            self.receipt("registration", registration)
            preview = self.job(ws, "preview", "response-preview", {
                "source": SOURCE, "source_revision": registration["revision"], "mapping": source.mapping})
            result = preview["result"]
            reviewed = {
                "operation_id": self.operation["id"], "workspace_id": ws.identity,
                "document_id": source.document_id, "source": registration,
                "preview_id": preview["id"], "preview_sha256": result["preview_sha256"],
                "preview": result, "mapping": source.mapping,
                "source_complete": source.manifest["complete"], "source_rows": source.receipt["rowCount"],
                "originals": source.receipt["archives"],
                "workbook_columns": list(WORKBOOK_COLUMNS),
                "text_preview": source.receipt.get("workbookTextPreview"),
            }
            return self.receipt("review", reviewed)

    def finish(self, *, preview_sha256, allow_incomplete=False):
        self.read_operation()
        reviewed = self.saved("review")
        need(preview_sha256 == reviewed["preview_sha256"], "DOCUMENT_WORKBOOK_EXACT_PREVIEW_REQUIRED")
        if (self.records / "complete.json").is_file():
            complete = self.saved("complete")
            need(complete["import"]["decision"]["allow_incomplete"] == bool(allow_incomplete),
                 "DOCUMENT_WORKBOOK_IMPORT_DECISION_CHANGED")
            for group in ("query_export", "workbook", "workspace_archive"):
                for file in complete[group]["files"].values():
                    actual = pin(file["path"])
                    need(actual["bytes"] == file["bytes"] and actual["sha256"] == file["sha256"],
                         "DOCUMENT_WORKBOOK_DELIVERY_CHANGED")
            return complete
        need(self.checkout is not None, "DOCUMENT_WORKBOOK_ORIGINAL_RUNTIME_REQUIRED")
        source = self.source()
        decision = self.receipt("import-decision", {
            "preview_id": reviewed["preview_id"], "preview_sha256": preview_sha256,
            "allow_incomplete": bool(allow_incomplete)})
        with closing(self.workspace()) as ws:
            self.bind_workspace(ws)
            imported = self.job(ws, "import", "response-import", decision)
            version = imported["result"]["version"]
            views = ws.state()["views"]
            prior = next((value for value in views if value["name"] == SOURCE), None)
            if prior is None:
                activated = ws.database.activate(SOURCE, version["version_id"], expected_revision=0)
            else:
                need(prior["version_id"] == version["version_id"], "DOCUMENT_WORKBOOK_VIEW_CHANGED")
                activated = prior
            self.receipt("activation", {
                "view": SOURCE, "version_id": version["version_id"], "table": version["table"],
                "revision": activated["revision"], "row_count": version["row_count"]})
            columns = [item["name"] for item in source.mapping["columns"]]
            need(all(name in columns for name in WORKBOOK_COLUMNS), "DOCUMENT_WORKBOOK_PREVIEW_COLUMNS_REQUIRED")
            sql = 'SELECT ' + ",".join('"' + name.replace('"', '""') + '"' for name in columns)
            sql += ' FROM "' + SOURCE + '" ORDER BY "position"'
            query_spec = {"sql": sql, "parameters_text": "[]", "max_rows": 100000}
            try:
                saved_query = ws.saved_query(QUERY, revision=1)
                need(all(saved_query[key] == value for key, value in query_spec.items()),
                     "DOCUMENT_WORKBOOK_QUERY_CHANGED")
            except StateError as error:
                if error.code != "ANALYSIS_QUERY_NOT_FOUND":
                    raise
                saved_query = ws.save_query(QUERY, query_spec, expected_revision=0)
            self.receipt("query-definition", {key: saved_query[key] for key in (*query_spec.keys(), "name", "revision")})
            # The original query preview and the complete query export have
            # separate native limits. Workbook rows come from the latter.
            query = self.job(ws, "query", "query", {**query_spec, "expected_views": ws.state()["views"]})
            exported = self.job(ws, "query_export", "query-export", {
                "query_id": query["id"], "result_sha256": query["result"]["result_sha256"],
                "label": source.manifest["title"], "formats": ["jsonl", "csv", "sqlite"],
                "timeout": 300, "spreadsheet_safe": True})
            query_files = {}
            for name in ("rows.jsonl", "rows.csv", "rows.sqlite3", "manifest.json"):
                query_files[name] = download(ws.exports.download(exported["id"], name),
                                             self.deliveries / "query" / name)
            typed = ws.workbooks.source({"kind": "query-export", "id": exported["id"]})
            need(typed["row_count"] == version["row_count"], "DOCUMENT_WORKBOOK_FULL_QUERY_ROW_COUNT_CHANGED")
            need(all(name in typed["columns"] for name in WORKBOOK_COLUMNS),
                 "DOCUMENT_WORKBOOK_TYPED_COLUMNS_CHANGED")
            definition_request = {
                "id": self.operation["workbook_definition_request"], "expected_revision": 0,
                "title": source.manifest["title"],
                "notes": "Every original occurrence is retained. Text preview is an ASCII JSON string "
                         "of the first 2,000 Unicode characters; its completeness and full character "
                         "count are separate columns. Full text, page, metadata, citations and original "
                         "provider records are in the typed query export and complete source archive.",
                "sheets": [{
                    "name": "Elements",
                    "source": {"kind": "query-export", "id": exported["id"], "sha256": typed["sha256"]},
                    "columns": [{
                        "source": name, "header": name.replace("_", " ").capitalize(),
                        "type": "integer" if name in {"position", "text_characters"} else "text",
                        "null": "text", "null_text": "NULL", "precision": "preserve",
                    } for name in WORKBOOK_COLUMNS],
                }],
            }
            definition = ws.workbooks.save(WORKBOOK, definition_request)
            self.receipt("workbook-definition", definition)
            workbook = self.job(ws, "workbook", "workbook", {
                "name": WORKBOOK, "revision": definition["revision"],
                "definition_sha256": definition["definition_sha256"]})
            workbook_files = {}
            for name in ("workbook.xlsx", "handoff.zip", "manifest.json"):
                workbook_files[name] = download(ws.workbooks.download(workbook["id"], name),
                                                self.deliveries / "workbook" / name)
            archive_plan = ws.archives.review(include_previous_backups=False)
            need(archive_plan["ready"], "DOCUMENT_WORKBOOK_PORTABLE_SOURCE_MISSING")
            archive = self.job(ws, "workspace_export", "workspace-export", {"include_previous_backups": False})
            archive_files = {}
            for name in ("workspace.zip", "archive-manifest.json"):
                archive_files[name] = download(ws.archives.download(archive["id"], name),
                                               self.deliveries / "workspace" / name)
            result = {
                "schema": SCHEMA, "operation_id": self.operation["id"], "workspace_id": ws.identity,
                "selection": self.operation["selection"], "source_document_id": source.document_id,
                "source_files": retained_document_files(ws.database.directory, source.document_id),
                "source_complete": source.manifest["complete"], "source_rows": source.receipt["rowCount"],
                "import": {"id": imported["id"], "version": version, "decision": decision},
                "query": {"id": query["id"], "result_sha256": query["result"]["result_sha256"],
                          "preview_truncated": query["result"]["truncated"], "spec": query_spec},
                "query_export": {"id": exported["id"], "source": typed, "files": query_files},
                "workbook": {"id": workbook["id"], "definition": definition, "files": workbook_files},
                "workspace_archive": {"id": archive["id"], "files": archive_files},
                "restore_operation": self.operation["restore_operation"],
            }
            return self.receipt("complete", result)

    def reopen(self, target=None):
        self.read_operation()
        complete = self.saved("complete")
        archive = complete["workspace_archive"]["files"]["workspace.zip"]
        target = Path(target).expanduser().absolute() if target else self.root / "restored-analysis"
        original = restore_archive(archive["path"], target,
            operation=self.operation["restore_operation"], expected_sha256=archive["sha256"])
        # An ordinary Python Analysis reader opens the received workspace with
        # no checkout or provider connection. Native retained outputs remain usable.
        with closing(AnalysisWorkspace(target)) as ws:
            need(ws.identity == complete["workspace_id"], "DOCUMENT_WORKBOOK_RESTORED_WORKSPACE_CHANGED")
            query = ws.job(complete["query"]["id"])
            need(query["status"] == "COMPLETE" and
                 query["result"]["result_sha256"] == complete["query"]["result_sha256"],
                 "DOCUMENT_WORKBOOK_RESTORED_QUERY_CHANGED")
            version = complete["import"]["version"]
            table = '"' + version["table"].replace('"', '""') + '"'
            count = ws.database.query("SELECT COUNT(*) AS row_count FROM " + table, max_rows=1,
                                      expected_views=ws.state()["views"])
            need(count.rows[0][0] == version["row_count"], "DOCUMENT_WORKBOOK_RESTORED_ROWS_CHANGED")
            native_files = retained_document_files(ws.database.directory, complete["source_document_id"])
            need(native_files == complete["source_files"], "DOCUMENT_WORKBOOK_RESTORED_SOURCE_CHANGED")
            source = ResearchDocumentSource(document_path(ws.database.directory, complete["source_document_id"]).parent)
            source_check = source.verify()
            workbook = verify_download(ws.workbooks.download(complete["workbook"]["id"], "workbook.xlsx"),
                                       complete["workbook"]["files"]["workbook.xlsx"])
            typed = verify_download(ws.exports.download(complete["query_export"]["id"], "rows.jsonl"),
                                    complete["query_export"]["files"]["rows.jsonl"])
            result = {
                "operation_id": self.operation["id"], "workspace_id": ws.identity,
                "archive_sha256": archive["sha256"], "restore": original,
                "source_document_id": source.document_id, "source": source_check,
                "rows": version["row_count"], "query_result_sha256": query["result"]["result_sha256"],
                "workbook_sha256": workbook["sha256"], "typed_rows_sha256": typed["sha256"],
                "can_import_without_checkout": ws.state()["can_import"],
                "current_views": ws.state()["views"],
            }
            self.receipt("reopen", result, identity=(
                "operation_id", "workspace_id", "archive_sha256", "source_document_id",
                "rows", "query_result_sha256", "workbook_sha256", "typed_rows_sha256"))
            return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", required=True, help="Private caller state and complete customer deliveries")
    parser.add_argument("--checkout", help="Original installed source root for prepare/finish")
    parser.add_argument("--node", default="node")
    parser.add_argument("--wait-seconds", type=int, default=900)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("prepare", "receive"):
        selected = commands.add_parser(name, help="Review mapping" if name == "prepare" else
            "Receive the selected edition using the shipped mapping, produce all exports and reopen the archive")
        selected.add_argument("--edition", required=True)
        selected.add_argument("--file-sha256", required=True)
        selected.add_argument("--edition-sha256", required=True)
        selected.add_argument("--title", default="Retained document elements")
        if name == "receive":
            selected.add_argument("--allow-incomplete", action="store_true")
    finish = commands.add_parser("finish")
    finish.add_argument("--preview-sha256", required=True)
    finish.add_argument("--allow-incomplete", action="store_true")
    reopen = commands.add_parser("reopen")
    reopen.add_argument("--target")
    commands.add_parser("inspect")
    args = parser.parse_args()
    need(1 <= args.wait_seconds <= 3600, "DOCUMENT_WORKBOOK_WAIT_INVALID")
    workflow = Workflow(args.directory, checkout=args.checkout, node=args.node, wait_seconds=args.wait_seconds)
    try:
        with lock(workflow.root):
            if args.command in {"prepare", "receive"}:
                result = workflow.prepare(edition=args.edition, file_sha256=args.file_sha256,
                                          edition_sha256=args.edition_sha256, title=args.title)
                if args.command == "receive":
                    # This explicit command selects the shipped complete
                    # occurrence mapping. The exact native preview digest is
                    # retained before import, alongside the reviewed selection.
                    complete = workflow.finish(preview_sha256=result["preview_sha256"],
                                               allow_incomplete=args.allow_incomplete)
                    result = {"review": {key: result[key] for key in (
                        "operation_id", "preview_id", "preview_sha256", "document_id",
                        "source_complete", "source_rows", "workbook_columns")},
                        "complete": complete, "reopen": workflow.reopen()}
            elif args.command == "finish":
                result = workflow.finish(preview_sha256=args.preview_sha256,
                                         allow_incomplete=args.allow_incomplete)
            elif args.command == "reopen":
                result = workflow.reopen(args.target)
            else:
                result = {"operation": workflow.read_operation(),
                          "receipts": sorted(path.name for path in workflow.records.glob("*.json"))}
        print(json.dumps(result, ensure_ascii=False, allow_nan=False, sort_keys=True, indent=2))
    except (StateError, OSError, ValueError, KeyError) as error:
        print(json.dumps({"ok": False, "error": getattr(error, "code", type(error).__name__),
                          "message": str(error), "directory": str(workflow.root)}, sort_keys=True))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
