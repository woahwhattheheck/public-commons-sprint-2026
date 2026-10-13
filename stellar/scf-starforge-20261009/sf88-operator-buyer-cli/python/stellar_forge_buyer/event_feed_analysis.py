"""Receive complete SF88 event windows in the existing customer Analysis workspace.

Use review -> apply -> deliver. Original source documents, immutable row tables,
DatasetChanges, saved customer reports, WorkbookRefresh and WorkspaceArchives own
the work. This module retains programme/request choices in that same database.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sqlite3
import subprocess
import sys
import tempfile
import time

from .analysis_workspace import AnalysisWorkspace, serve
from .errors import BuyerError, StateError
from .response_documents import document_path
from .storage import private_directory

SCHEMA = "stellar-forge.event-feed-analysis-programme.v1"
MAX_SOURCE = 32 * 1024 * 1024
NAME = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,23}")
HEX = re.compile(r"[a-f0-9]{32}")
HASH = re.compile(r"[a-f0-9]{64}")
KEYS = ["store_id", "source_id", "event_id"]


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, allow_nan=False,
                       sort_keys=True, separators=(",", ":")) + "\n").encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def need(condition, message):
    if not condition:
        raise ValueError(message)


def regular(path, maximum=MAX_SOURCE):
    path = Path(path).expanduser().absolute()
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        need(stat.S_ISREG(before.st_mode) and before.st_size <= maximum,
             "Select a complete regular source file within its allowance.")
        data = stream.read(maximum + 1)
        after = os.fstat(stream.fileno())
        signature = lambda info: (info.st_dev, info.st_ino, info.st_size,
                                  info.st_mtime_ns, info.st_ctime_ns)
        need(signature(before) == signature(after) and len(data) == before.st_size,
             "The selected source file changed during receiving.")
        return data


def exact_file(path, body):
    path = Path(path)
    private_directory(path.parent, create=True)
    fd, temporary = tempfile.mkstemp(prefix=".event-source-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            need(regular(path, max(len(body), MAX_SOURCE)) == body,
                 "A retained output path already contains different complete bytes.")
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        Path(temporary).unlink(missing_ok=True)


def identifier(value):
    return sha(value.encode())[:32]


def quote(value):
    return '"' + value.replace('"', '""') + '"'


def code(error):
    return getattr(error, "code", None) or str(error)


class EventFeedAnalysis:
    """One native Analysis owner; metadata travels in its original SQLite backup."""

    def __init__(self, workspace, programme, *, progress=None):
        need(NAME.fullmatch(programme) is not None, "Use a short named customer programme.")
        self.workspace, self.name = workspace, programme
        self.progress = progress or (lambda value: None)
        with workspace.database._connection() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("CREATE TABLE IF NOT EXISTS sf_analysis_event_programmes(name TEXT PRIMARY KEY,revision INTEGER NOT NULL,record TEXT NOT NULL,sha256 TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS sf_analysis_event_operations(id TEXT PRIMARY KEY,programme TEXT NOT NULL,kind TEXT NOT NULL,request_sha256 TEXT NOT NULL,record TEXT NOT NULL,sha256 TEXT NOT NULL)")
            db.commit()

    def programme(self):
        with self.workspace.database._connection(readonly=True) as db:
            row = db.execute("SELECT * FROM sf_analysis_event_programmes WHERE name=?", (self.name,)).fetchone()
        if not row:
            return {"schema": SCHEMA, "name": self.name, "revision": 0,
                    "workspace_id": self.workspace.identity, "accepted": None,
                    "pending": None, "report_name": self.name + "_report",
                    "workbook_name": self.name + "_workbook", "history": []}
        need(sha(row["record"].encode()) == row["sha256"], "The saved programme record changed.")
        value = json.loads(row["record"])
        need(value["workspace_id"] == self.workspace.identity and value["revision"] == row["revision"],
             "Continue the programme in its original received workspace.")
        return value

    def save_programme(self, value, *, connection=None):
        raw = encoded({**value, "revision": value["revision"] + 1}).decode()
        def save(db):
            row = db.execute("SELECT revision FROM sf_analysis_event_programmes WHERE name=?", (self.name,)).fetchone()
            need((row[0] if row else 0) == value["revision"], "The customer programme changed; reopen it.")
            db.execute("INSERT INTO sf_analysis_event_programmes VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET revision=excluded.revision,record=excluded.record,sha256=excluded.sha256",
                       (self.name, value["revision"] + 1, raw, sha(raw.encode())))
        if connection is not None:
            save(connection)
        else:
            with self.workspace.database._connection() as db:
                db.execute("BEGIN IMMEDIATE")
                save(db)
                db.commit()
        return json.loads(raw)

    def operation(self, operation_id, kind=None, request=None):
        need(isinstance(operation_id, str) and HEX.fullmatch(operation_id), "Use the original 32-character operation ID.")
        with self.workspace.database._connection(readonly=True) as db:
            row = db.execute("SELECT * FROM sf_analysis_event_operations WHERE id=?", (operation_id,)).fetchone()
        if row:
            need(row["programme"] == self.name and sha(row["record"].encode()) == row["sha256"],
                 "The selected operation belongs to another programme or changed.")
            if kind is not None:
                need(row["kind"] == kind and row["request_sha256"] == sha(encoded(request)),
                     "Continue the original operation with its exact input selection.")
            return json.loads(row["record"])
        need(kind is not None and request is not None, "The original operation is unavailable.")
        value = {"id": operation_id, "programme": self.name, "kind": kind,
                 "request": request, "request_sha256": sha(encoded(request)), "jobs": {}}
        self.save_operation(value)
        return value

    def save_operation(self, value, *, connection=None):
        raw = encoded(value).decode()
        def save(db):
            old = db.execute("SELECT programme,kind,request_sha256 FROM sf_analysis_event_operations WHERE id=?", (value["id"],)).fetchone()
            need(not old or tuple(old) == (self.name, value["kind"], value["request_sha256"]),
                 "The operation identity already selects another request.")
            db.execute("INSERT INTO sf_analysis_event_operations VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record,sha256=excluded.sha256",
                       (value["id"], self.name, value["kind"], value["request_sha256"], raw, sha(raw.encode())))
        if connection is not None:
            save(connection)
        else:
            with self.workspace.database._connection() as db:
                db.execute("BEGIN IMMEDIATE")
                save(db)
                db.commit()

    def stage_id(self, operation, purpose):
        return identifier(operation["id"] + ":" + purpose + ":" + str(operation.get("generation", 0)))

    def run(self, operation, phase, kind, request, *, resume=False):
        if phase not in {"preview", "import", "comparison"}:
            phase = phase + ":generation:" + str(operation.get("generation", 0))
        attempts = operation["jobs"].setdefault(phase, [])
        digest = sha(encoded({"kind": kind, "request": request}))
        if not attempts:
            attempts.append({"id": identifier(operation["id"] + ":" + phase + ":0"),
                             "kind": kind, "request_sha256": digest})
            self.save_operation(operation)
        chosen = attempts[-1]
        need(chosen["kind"] == kind and chosen["request_sha256"] == digest,
             "The original " + phase + " request changed.")
        try:
            current = self.workspace.job(chosen["id"])
        except StateError as error:
            if code(error) != "ANALYSIS_JOB_NOT_FOUND":
                raise
            current = None
        if current and current["status"] in {"FAILED", "INTERRUPTED", "CANCELLED"}:
            need(resume, phase + " needs its original --resume continuation: " +
                 str(current.get("error") or current["status"]))
            if kind != "workspace-export":
                chosen = {"id": identifier(operation["id"] + ":" + phase + ":" + str(len(attempts))),
                          "kind": kind, "request_sha256": digest}
                attempts.append(chosen)
                self.save_operation(operation)
        self.progress({"programme": self.name, "phase": phase, "job_id": chosen["id"]})
        result = self.workspace.start(kind, {"id": chosen["id"], **request})
        while result["status"] == "RUNNING":
            time.sleep(0.05)
            result = self.workspace.job(chosen["id"])
        need(result["status"] == "COMPLETE",
             phase + " stopped: " + str(result.get("error") or result["status"]))
        return result

    def source_paths(self, accepted):
        manifest_path = document_path(self.workspace.database.directory, accepted["document_id"])
        manifest = json.loads(regular(manifest_path, 1024 * 1024))
        by_role = {item["role"]: item for item in manifest["originals"]}
        found = []
        for role in ("original-subscriber-ndjson", "original-subscriber-manifest"):
            item = by_role[role]
            path = manifest_path.parent / item["path"]
            body = regular(path)
            need(len(body) == item["bytes"] and sha(body) == item["sha256"],
                 "The retained original subscriber source changed.")
            found.append(path)
        return found

    def initial_namespace(self, programme):
        for name, read, missing in (
            (self.name + "_types", self.workspace.saved_query, "ANALYSIS_QUERY_NOT_FOUND"),
            (self.name + "_sources", self.workspace.saved_query, "ANALYSIS_QUERY_NOT_FOUND"),
            (programme["report_name"], self.workspace.reports.definition, "ANALYSIS_REPORT_NOT_FOUND"),
            (programme["workbook_name"], self.workspace.workbooks.definition, "ANALYSIS_WORKBOOK_NOT_FOUND"),
        ):
            try:
                read(name)
            except StateError as error:
                if code(error) != missing:
                    raise
            else:
                raise ValueError("Select another programme name; existing customer work already uses " + name)

    def review(self, ndjson, manifest, *, mapping, source_cli, node="node",
               operation_id, resume=False):
        raw, metadata = regular(ndjson), regular(manifest, 4 * 1024 * 1024)
        mapping_raw = regular(mapping, 1024 * 1024) if mapping else b'{"fields":[]}\n'
        source_cli = Path(source_cli).expanduser().resolve(strict=True)
        source_core = source_cli.with_name("analysis-source.mjs")
        need(source_cli.name == "analysis-source-cli.mjs" and source_core.is_file(),
             "Select the original event-feed Analysis source receiver and its sibling core.")
        request = {"ndjson_sha256": sha(raw), "manifest_sha256": sha(metadata),
                   "mapping_sha256": sha(mapping_raw),
                   "receiver_sha256": sha(regular(source_cli)),
                   "core_sha256": sha(regular(source_core))}
        operation = self.operation(operation_id, "review", request)
        if operation.get("review"):
            return operation["review"]
        programme = self.programme()
        need(programme["pending"] is None,
             "Continue the current selected customer operation before another source review.")
        baseline = programme["accepted"]
        if baseline is None:
            self.initial_namespace(programme)
        # Execute the selected receiver against the exact retained source bytes.
        # Re-reading mutable original paths here would split the recorded request.
        cli_raw, core_raw = regular(source_cli), regular(source_core)
        need(sha(cli_raw) == request["receiver_sha256"] and
             sha(core_raw) == request["core_sha256"], "The source receiver changed.")
        with tempfile.TemporaryDirectory(prefix="event-analysis-receive-") as temp:
            selected = Path(temp)
            for name, body in (("analysis-source-cli.mjs", cli_raw),
                               ("analysis-source.mjs", core_raw),
                               ("events.ndjson", raw), ("manifest.json", metadata),
                               ("mapping.json", mapping_raw)):
                exact_file(selected / name, body)
            args = [node, str(selected / "analysis-source-cli.mjs"),
                    "--ndjson", str(selected / "events.ndjson"),
                    "--manifest", str(selected / "manifest.json"),
                    "--mapping", str(selected / "mapping.json")]
            if baseline:
                previous = self.source_paths(baseline)
                for name, path in zip(("previous.ndjson", "previous.json"), previous):
                    exact_file(selected / name, regular(path))
                args += ["--previous-ndjson", str(selected / "previous.ndjson"),
                         "--previous-manifest", str(selected / "previous.json")]
            completed = subprocess.run(args, capture_output=True, check=False)
        need(completed.returncode == 0,
             completed.stderr.decode("utf-8", "replace")[:8000] or "The original source receiver failed.")
        need(len(completed.stdout) <= 48 * 1024 * 1024, "The complete projection is too large.")
        received = json.loads(completed.stdout)
        need(received["original_files"]["ndjson"] == {"bytes": len(raw), "sha256": sha(raw)} and
             received["original_files"]["manifest"] == {"bytes": len(metadata), "sha256": sha(metadata)},
             "The original input changed before native source receiving.")
        projected = received["document"].encode()
        need(len(projected) == received["document_bytes"] and sha(projected) == received["document_sha256"],
             "The complete typed projection changed.")
        need(received["manifest"]["events"] <= 100000,
             "Select an original subscriber window at most 100,000 events for a complete customer report.")
        if baseline:
            need(received["source"] == baseline["source"], "Use another programme for another source selection.")
        source_name = self.name + "_s_" + identifier(received["edition_id"] + received["mapping_sha256"])[:16]
        with tempfile.TemporaryDirectory(prefix="event-analysis-source-") as temp:
            folder = Path(temp)
            def content(body, extension, mime, role=None):
                path = "files/" + sha(body) + "." + extension
                exact_file(folder / path, body)
                return {"path": path, "bytes": len(body), "sha256": sha(body), "contentType": mime,
                        **({"role": role} if role else {})}
            document = {
                "schema": "stellar-forge.analysis-source-document.v1",
                "title": self.name + " — complete acquired event window",
                "format": "json", "complete": True,
                "document": content(projected, "json", "application/json"),
                "originals": [
                    content(raw, "bin", "application/x-ndjson", "original-subscriber-ndjson"),
                    content(metadata, "json", "application/json", "original-subscriber-manifest"),
                    content(mapping_raw, "json", "application/json", "original-field-mapping"),
                    content(core_raw, "txt", "text/javascript", "original-source-projector"),
                    content(cli_raw, "txt", "text/javascript", "original-source-receiver"),
                ],
                "provenance": {
                    "kind": "operator-file", "publisher": "Original SF88 event-feed subscriber",
                    "capturedAt": received["manifest"]["createdAt"],
                    "scope": "Subscription " + received["source"]["id"][:100] + "; feed " +
                             received["source"]["feedId"][:100] + "; through source sequence " +
                             str(received["manifest"]["throughSequence"]) + ". Complete paid-page identities retained.",
                    "description": "Original acquired export and page outcome records. Every mapped scalar is text; null and missing have explicit state columns. Full raw inputs and mapping are retained.",
                },
            }
            exact_file(folder / "source.json", encoded(document))
            registered = self.workspace.responses.register(source_name, "document", manifest=folder / "source.json")
        preview = self.run(operation, "preview", "response-preview", {
            "source": source_name, "source_revision": registered["revision"],
            "mapping": {"collection": "/events", "sse_data": "text",
                        "columns": [{"name": name, "pointer": "/" + name, "type": "text", "missing": "error"}
                                    for name in received["columns"]]}}, resume=resume)
        imported = self.run(operation, "import", "response-import", {
            "preview_id": preview["id"], "preview_sha256": preview["result"]["preview_sha256"],
            "allow_incomplete": False}, resume=resume)
        version = imported["result"]["version"]
        need(version["row_count"] == received["manifest"]["events"], "The complete imported event count differs.")
        current = self.workspace.database.current(self.name)
        comparison = None
        if baseline:
            need(current["version"] is not None and
                 current["version"]["version_id"] == baseline["version_id"] and
                 current["revision"] == baseline["view_revision"],
                 "Review the customer's currently accepted view before receiving another window.")
            if current["version"]["version_id"] != version["version_id"]:
                comparison = self.run(operation, "comparison", "compare", {
                    "view": self.name, "expected_revision": current["revision"],
                    "base_version_id": current["version"]["version_id"],
                    "candidate_version_id": version["version_id"], "keys": KEYS}, resume=resume)
        else:
            need(current["version"] is None, "Choose a new programme name instead of replacing an existing customer view.")
        definitions = None
        if baseline:
            definitions = {"report": self.workspace.reports.definition(programme["report_name"]),
                           "workbook": self.workspace.workbooks.definition(programme["workbook_name"])}
        review = {
            "schema": "stellar-forge.event-feed-analysis-review.v1",
            "programme": self.name, "operation_id": operation_id,
            "workspace_id": self.workspace.identity, "programme_revision": programme["revision"],
            "source": received["source"], "edition_id": received["edition_id"],
            "manifest": received["manifest"], "mapping": received["mapping"],
            "mapping_sha256": received["mapping_sha256"], "columns": received["columns"],
            "document_id": registered["document_id"], "source_name": source_name,
            "source_revision": registered["revision"], "version_id": version["version_id"],
            "base_view": {"revision": current["revision"],
                          "version_id": current["version"]["version_id"] if current["version"] else None},
            "window_comparison": received["comparison"],
            "data_comparison": comparison["result"] if comparison else None,
            "definitions": definitions, "views": self.workspace.database.view_bindings(),
        }
        review["review_sha256"] = sha(encoded(review))
        operation["review"] = review
        self.save_operation(operation)
        return review

    def apply(self, operation_id, review_sha256, *, note, columns=None, resume=False):
        operation = self.operation(operation_id)
        review = operation.get("review")
        need(review and review["review_sha256"] == review_sha256,
             "Apply the complete original review using its exact digest.")
        need(isinstance(note, str) and note.strip() and len(note.encode()) <= 8000,
             "Record the customer decision for this complete window.")
        if operation.get("applied"):
            return operation["applied"]
        requested = {"review_sha256": review_sha256, "note": note}
        if operation.get("apply_request"):
            need(operation["apply_request"] == requested, "Continue the original selected receiving decision.")
        else:
            operation["apply_request"] = requested
            self.save_operation(operation)
        programme = self.programme()
        need(programme["pending"] in {None, operation_id}, "Continue the original current receiving operation.")
        if programme["pending"] is None:
            if programme["accepted"] is None:
                self.initial_namespace(programme)
            need(programme["revision"] == review["programme_revision"], "The programme advanced; prepare a fresh review.")
            if review["definitions"]:
                for kind, manager, field in (
                    ("report", self.workspace.reports, "sha256"),
                    ("workbook", self.workspace.workbooks, "definition_sha256")):
                    original = review["definitions"].get(kind)
                    if original is None:
                        continue
                    latest = manager.definition(programme[kind + "_name"])
                    need(latest[field] == original[field] and latest["head_revision"] == original["head_revision"],
                         "The customer's " + kind + " changed; prepare a fresh source review.")
            need(self.workspace.database.view_bindings() == review["views"],
                 "The customer's reviewed source views changed.")
            programme["pending"] = operation_id
            programme = self.save_programme(programme)
        if not operation.get("activation"):
            comparison = review["data_comparison"]
            if comparison:
                activation = self.workspace.changes.select(comparison["id"], {
                    "id": identifier(operation_id + ":selection"),
                    "result_sha256": comparison["result_sha256"], "note": note})["activation"]
                operation["activation"] = activation
                self.save_operation(operation)
            else:
                with self.workspace.database._connection() as db:
                    db.execute("BEGIN IMMEDIATE")
                    activation = self.workspace.database._activate(
                        db, self.name, review["version_id"],
                        expected_revision=review["base_view"]["revision"])
                    operation["activation"] = activation
                    self.save_operation(operation, connection=db)
                    db.commit()
        current = self.workspace.database.current(self.name)
        need(current["version"]["version_id"] == review["version_id"] and
             current["revision"] == operation["activation"]["revision"],
             "The selected customer view changed after receiving.")
        expected_views = {row["name"]: row for row in review["views"]}
        expected_views[self.name] = {"name": self.name, "version_id": review["version_id"],
                                     "revision": operation["activation"]["revision"]}
        need({row["name"]: row for row in self.workspace.database.view_bindings()} == expected_views,
             "The customer's other source views changed; use refresh-review to select their current complete state.")
        if not programme["accepted"] and not review["definitions"]:
            self.initial_definitions(operation, review, programme)
        elif review["definitions"]:
            current_report = self.workspace.reports.definition(programme["report_name"])
            need(current_report["sha256"] == review["definitions"]["report"]["sha256"],
                 "Reconcile the customer's changed report before continuing the selected operation.")
        if "report_definition" not in operation:
            operation["report_definition"] = self.workspace.reports.definition(programme["report_name"])
            operation["report_views"] = self.workspace.database.view_bindings()
            self.save_operation(operation)
        definition = operation["report_definition"]
        if "events_export" not in operation:
            query = self.run(operation, "events-query", "query", {
                "sql": "SELECT * FROM " + quote(self.name) + " ORDER BY CAST(sequence AS INTEGER)",
                "parameters_text": "[]", "max_rows": 100,
                "expected_views": operation["report_views"]}, resume=resume)
            exported = self.run(operation, "events-export", "query-export", {
                "query_id": query["id"], "result_sha256": query["result"]["result_sha256"],
                "label": self.name + " complete event window", "formats": ["jsonl", "csv"],
                "timeout": 300, "max_rows": 100000, "max_output_bytes": 128 * 1024 * 1024,
                "spreadsheet_safe": True}, resume=resume)
            source = self.workspace.workbooks.source({"kind": "query-export", "id": exported["id"]})
            need(source["row_count"] == review["manifest"]["events"],
                 "The full event export must contain every acquired event.")
            operation["events_export"] = {"job_id": exported["id"], "source": source}
            self.save_operation(operation)
        report = self.run(operation, "report", "report", {
            "name": programme["report_name"], "revision": definition["definition"]["revision"],
            "definition_sha256": definition["sha256"],
            "expected_views": operation["report_views"]}, resume=resume)
        publication = self.workspace.reports.publish(report["id"], {
            "id": self.stage_id(operation, "publish"),
            "result_sha256": report["result"]["result_sha256"],
            "expected_revision": definition["publication_revision"], "note": note})
        operation["publication"] = publication
        self.save_operation(operation)
        if not operation.get("workbook_definition"):
            selected = self.prepare_workbook(operation, review, programme, columns or {})
            if selected.get("state") == "WORKBOOK_COLUMN_CHOICES_REQUIRED":
                return selected
            operation["workbook_definition"] = selected
            self.save_operation(operation)
        workbook_definition = operation["workbook_definition"]
        workbook = self.run(operation, "workbook", "workbook", {
            "name": programme["workbook_name"], "revision": workbook_definition["revision"],
            "definition_sha256": workbook_definition["definition_sha256"]}, resume=resume)
        accepted = {key: review[key] for key in (
            "source", "edition_id", "manifest", "mapping", "mapping_sha256", "columns",
            "document_id", "source_name", "source_revision", "version_id")}
        accepted["events_export_id"] = operation["events_export"]["job_id"]
        accepted["view_revision"] = operation["activation"]["revision"]
        accepted["review_sha256"] = review_sha256
        accepted["operation_id"] = operation_id
        result = {"schema": SCHEMA, "state": "APPLIED", "programme": self.name,
                  "workspace_id": self.workspace.identity, "accepted": accepted,
                  "publication": publication, "report_job_id": report["id"],
                  "workbook_job_id": workbook["id"],
                  "workbook_manifest_sha256": workbook["result"]["manifest_sha256"],
                  "events_export": operation["events_export"]}
        programme = self.programme()
        need(programme["pending"] == operation_id, "The receiving programme changed.")
        programme["accepted"], programme["pending"] = accepted, None
        programme["history"].append({"operation_id": operation_id, "review_sha256": review_sha256,
                                     "edition_id": review["edition_id"], "note": note,
                                     "publication": publication, "workbook_job_id": workbook["id"]})
        operation["applied"] = result
        with self.workspace.database._connection() as db:
            db.execute("BEGIN IMMEDIATE")
            self.save_operation(operation, connection=db)
            self.save_programme(programme, connection=db)
            db.commit()
        return result

    def refresh_review(self, operation_id, review_sha256, *, note):
        """Preserve an interrupted attempt and review current customer edits."""
        operation = self.operation(operation_id)
        programme = self.programme()
        need(programme["pending"] == operation_id and not operation.get("applied"),
             "Refresh the original unfinished customer operation.")
        prior = operation.get("review")
        need(prior and prior["review_sha256"] == review_sha256,
             "Select the exact preceding complete review.")
        need(isinstance(note, str) and note.strip() and len(note.encode()) <= 8000,
             "Record why current customer edits are being selected.")
        activation = operation.get("activation")
        need(activation is not None, "Continue the original source selection before refreshing customer definitions.")
        current = self.workspace.database.current(self.name)
        need(current["version"] and current["version"]["version_id"] == prior["version_id"] and
             current["revision"] == activation["revision"],
             "Restore or deliberately reselect the originally received source view before refreshing this operation.")
        report = self.workspace.reports.definition(programme["report_name"])
        try:
            workbook = self.workspace.workbooks.definition(programme["workbook_name"])
        except StateError as error:
            if code(error) != "ANALYSIS_WORKBOOK_NOT_FOUND":
                raise
            workbook = None
        cleared = ("apply_request", "report_definition", "report_views", "publication",
                   "workbook_review", "workbook_save_request", "workbook_definition",
                   "column_choices", "events_export")
        operation.setdefault("prior_customer_attempts", []).append({
            "generation": operation.get("generation", 0), "note": note,
            "review": prior, **{key: operation[key] for key in cleared if key in operation}})
        for key in cleared:
            operation.pop(key, None)
        operation["generation"] = operation.get("generation", 0) + 1
        review = {key: value for key, value in prior.items() if key != "review_sha256"}
        review.update(programme_revision=programme["revision"],
                      definitions={"report": report, "workbook": workbook},
                      views=self.workspace.database.view_bindings(),
                      customer_review_generation=operation["generation"],
                      customer_review_note=note)
        review["review_sha256"] = sha(encoded(review))
        operation["review"] = review
        self.save_operation(operation)
        return review

    def initial_definitions(self, operation, review, programme):
        queries = [
            ("types", "Event-family counts",
             "SELECT event_type,COUNT(*) AS event_count FROM " + quote(self.name) + " GROUP BY event_type ORDER BY event_type",
             "Counts over this complete received subscriber snapshot."),
            ("sources", "Original source counts",
             "SELECT source_id,COUNT(*) AS event_count FROM " + quote(self.name) + " GROUP BY source_id ORDER BY source_id",
             "Individual events remain distinct within each original source."),
        ]
        selected = []
        for suffix, title, sql, explanation in queries:
            name = self.name + "_" + suffix
            expected = {"sql": sql, "parameters_text": "[]", "max_rows": 100000}
            try:
                saved = self.workspace.saved_query(name, revision=1)
            except StateError as error:
                if code(error) != "ANALYSIS_QUERY_NOT_FOUND":
                    raise
                saved = self.workspace.save_query(name, expected, expected_revision=0)
            need(all(saved[key] == value for key, value in expected.items()),
                 "The original initial query revision differs; retain its actual source before continuing.")
            selected.append({"title": title, "note": explanation,
                             "query_name": name, "query_revision": saved["revision"],
                             "parameters_text": None})
        original = self.workspace.reports.save(programme["report_name"], {
            "id": identifier(operation["id"] + ":initial-report"), "expected_revision": 0,
            "title": self.name + " — acquired event analysis",
            "introduction": "Complete acquired subscriber output, original page references and exact event identities. Payload values are text; missing and null remain explicit. This report uses the selected view, with the original complete files retained in Sources.",
            "sections": selected})
        if "report_definition" not in operation:
            operation["report_definition"] = self.workspace.reports.definition(
                programme["report_name"], revision=original["revision"])
            operation["report_views"] = self.workspace.database.view_bindings()
            self.save_operation(operation)

    def prepare_workbook(self, operation, review, programme, choices):
        publication = operation["publication"]
        old = review["definitions"]["workbook"] if review["definitions"] else None
        if operation.get("workbook_save_request"):
            saved = operation["workbook_save_request"]
            manager = self.workspace.workbooks.refresh if saved["kind"] == "refresh" else self.workspace.workbooks
            return manager.save(programme["workbook_name"], saved["request"])
        if old:
            definition = json.loads(json.dumps(old["definition"]))
            changed, unresolved = [], []
            for index, sheet in enumerate(definition["sheets"]):
                prior = sheet["source"]
                lineage = self.workspace.workbooks.refresh._lineage(prior)
                if prior["kind"] == "query-export":
                    owned_exports = {(programme.get("accepted") or {}).get("events_export_id")}
                    owned_exports.update(attempt.get("events_export", {}).get("job_id")
                                         for attempt in operation.get("prior_customer_attempts", []))
                    if prior["id"] not in owned_exports:
                        continue
                    original_sql = "SELECT * FROM " + quote(self.name) + " ORDER BY CAST(sequence AS INTEGER)"
                    if lineage["sql"] != original_sql or lineage["parameters"] != []:
                        continue
                    source = operation["events_export"]["source"]
                elif lineage.get("report_name") == programme["report_name"]:
                    sections = operation["report_definition"]["definition"]["sections"]
                    matching = [position for position, section in enumerate(sections)
                                if section["query_name"] == lineage["query_name"]]
                    position = matching[0] if len(matching) == 1 else prior["section"]
                    need(position in matching,
                         "The report's source query moved or was removed; choose that worksheet's current source in Workbooks and refresh this review.")
                    source = self.workspace.workbooks.source({
                        "kind": "report", "id": publication["id"], "section": position})
                else:
                    continue
                if str(index) in choices:
                    proposed_columns = choices[str(index)]
                else:
                    labels = source["columns"]
                    if labels and isinstance(labels[0], dict):
                        labels = [row["name"] for row in labels]
                    if all((source["kind"] == "query-export" and column["source"] in labels) or
                           (source["kind"] == "report" and column.get("source_index") is not None and
                            column["source_index"] < len(labels) and
                            labels[column["source_index"]] == column["source"])
                           for column in sheet["columns"]):
                        proposed_columns = sheet["columns"]
                    else:
                        unresolved.append({"sheet": index, "name": sheet["name"],
                                           "original_columns": sheet["columns"],
                                           "new_source": source})
                        continue
                sheet["source"], sheet["columns"] = source, proposed_columns
                changed.append(index)
            if unresolved:
                result = {"state": "WORKBOOK_COLUMN_CHOICES_REQUIRED",
                          "operation_id": operation["id"], "review_sha256": review["review_sha256"],
                          "worksheets": unresolved,
                          "instruction": "Supply each selected worksheet's complete reviewed column array using its zero-based index; keep every other worksheet."}
                operation["column_choices"] = result
                self.save_operation(operation)
                return result
            need(changed, "Select an original programme event or report worksheet in the current workbook before refreshing this operation.")
            request = {"base_revision": old["definition"]["revision"],
                       "definition_sha256": old["definition_sha256"],
                       "expected_revision": old["head_revision"],
                       "reason": operation["apply_request"]["note"], "definition": definition}
            inspected = self.workspace.workbooks.refresh.review(programme["workbook_name"], request)
            need(inspected["ready"], "Correct the original workbook conversion choices before saving.")
            operation["workbook_review"] = inspected
            self.save_operation(operation)
            selected_request = {**request, "id": self.stage_id(operation, "workbook-refresh"),
                                "review_sha256": inspected["review_sha256"]}
            operation["workbook_save_request"] = {"kind": "refresh", "request": selected_request}
            self.save_operation(operation)
            return self.workspace.workbooks.refresh.save(programme["workbook_name"], selected_request)
        sheets = []
        sources = [operation["events_export"]["source"]] + [
            self.workspace.workbooks.source({"kind": "report", "id": publication["id"], "section": index})
            for index in range(2)]
        for index, (label, source) in enumerate(zip(("Events", "Event families", "Sources"), sources)):
            labels = source["columns"]
            if labels and isinstance(labels[0], dict):
                labels = [row["name"] for row in labels]
            sheets.append({"name": label, "source": source,
                "columns": choices.get(str(index), [
                    {"source": name, **({"source_index": position} if source["kind"] == "report" else {}),
                     "header": name, "type": "integer" if name == "event_count" else "text",
                     "null": "text", "null_text": "NULL", "precision": "preserve"}
                    for position, name in enumerate(labels)])})
        selected_request = {
            "id": identifier(operation["id"] + ":initial-workbook"), "expected_revision": 0,
            "title": self.name + " — event window", "notes": "Original payload values and identifiers remain text. Explicit state columns distinguish missing and null. Event counts are integers.",
            "sheets": sheets}
        operation["workbook_save_request"] = {"kind": "initial", "request": selected_request}
        self.save_operation(operation)
        return self.workspace.workbooks.save(programme["workbook_name"], selected_request)

    def deliver(self, operation_id, destination, *, resume=False, delivery_id=None):
        original = self.operation(operation_id)
        applied = original.get("applied")
        need(applied is not None, "Apply the complete reviewed customer window first.")
        # Explicitly request a new current-workspace snapshot without changing
        # the accepted result or replaying its original archive operation.
        accepted_operation_id = original.get("accepted_operation_id", operation_id)
        if delivery_id is not None:
            need(delivery_id != operation_id, "Use a new delivery ID for a fresh workspace snapshot.")
            operation = self.operation(delivery_id, "delivery", {
                "accepted_operation_id": accepted_operation_id,
                "applied_sha256": sha(encoded(applied)),
                "review_sha256": original["review"]["review_sha256"]})
            if "applied" not in operation:
                operation.update(applied=applied, review=original["review"],
                                 accepted_operation_id=accepted_operation_id)
                self.save_operation(operation)
            operation_id = delivery_id
        else:
            operation = original
        destination = private_directory(Path(destination).expanduser().absolute(), create=True)
        if operation.get("delivery") and operation["delivery"]["destination"] == str(destination):
            for record in operation["delivery"]["files"]:
                body = regular(destination / record["name"], 1024 * 1024 * 1024)
                need(len(body) == record["bytes"] and sha(body) == record["sha256"],
                     "A retained delivery file changed.")
            return operation["delivery"]
        publication = applied["publication"]
        report_source = self.workspace.workbooks.source(
            {"kind": "report", "id": publication["id"], "section": 0})
        report_jobs = {}
        # Finish all selected native outputs before the one complete workspace
        # snapshot. No mutable programme text is written into a delivery first.
        for format in ("html", "json", "csv"):
            report_jobs[format] = self.run(operation, "report-export-" + format, "report-export", {
                "publication_id": publication["id"], "publication_sha256": report_source["sha256"],
                "format": format}, resume=resume)
        archive = self.run(operation, "workspace-export", "workspace-export",
                           {"include_previous_backups": False}, resume=resume)
        archive_files = {}
        for name in ("workspace.zip", "archive-manifest.json"):
            with self.workspace.archives.download(archive["id"], name) as (stream, descriptor):
                body = stream.read()
            need(len(body) == descriptor["bytes"] and sha(body) == descriptor["sha256"],
                 "The original complete workspace download changed.")
            archive_files[name] = (body, descriptor)
        # The original archive's retained immutable SQLite copy is authoritative.
        # A late export of window A may intentionally include current workspace B;
        # its accompanying programme must describe that exact snapshot, never a
        # later live self.programme() or an earlier imagined database state.
        manifest = json.loads(archive_files["archive-manifest.json"][0])
        snapshot = self.workspace.archives.root / archive["id"] / "snapshot" / "datasets.sqlite3"
        database = manifest["database"]
        fd = os.open(snapshot, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, "rb") as original:
            need(stat.S_ISREG(os.fstat(original.fileno()).st_mode) and os.fstat(original.fileno()).st_size == database["bytes"] and
                 hashlib.file_digest(original, "sha256").hexdigest() == database["sha256"],
                 "The original archive database snapshot changed.")
        with sqlite3.connect(snapshot.as_uri() + "?mode=ro&immutable=1", uri=True) as db:
            db.execute("PRAGMA trusted_schema=OFF")
            row = db.execute("SELECT record,sha256 FROM sf_analysis_event_programmes WHERE name=?",
                             (self.name,)).fetchone()
        need(row and sha(row[0].encode()) == row[1],
             "The original archive programme record is unavailable or changed.")
        archived_programme = json.loads(row[0])
        need(archived_programme["workspace_id"] == self.workspace.identity and
             any(item["operation_id"] == accepted_operation_id for item in archived_programme["history"]),
             "The workspace snapshot must retain this original applied window.")
        plan = {"schema": "stellar-forge.event-feed-analysis-delivery-plan.v1",
                "operation_id": operation_id, "accepted_operation_id": accepted_operation_id,
                "selected_edition_id": applied["accepted"]["edition_id"],
                "workspace_archive_job_id": archive["id"],
                "workspace_archive_sha256": archive_files["workspace.zip"][1]["sha256"],
                "workspace_programme": archived_programme,
                "programme_record_sha256": row[1]}
        if operation.get("delivery_plan"):
            need(operation["delivery_plan"] == plan,
                 "The original complete delivery plan changed.")
        else:
            operation["delivery_plan"] = plan
            self.save_operation(operation)
        records = []
        def publish(name, body):
            exact_file(destination / name, body)
            record = {"name": name, "bytes": len(body), "sha256": sha(body)}
            records.append(record)
            return record
        for original, output in (("workbook.xlsx", "Event_Analysis.xlsx"),
                                 ("handoff.zip", "Event_Workbook_Handover.zip")):
            with self.workspace.workbooks.download(applied["workbook_job_id"], original) as (stream, descriptor):
                body = stream.read()
            need(len(body) == descriptor["bytes"] and sha(body) == descriptor["sha256"],
                 "The original complete workbook download changed.")
            publish(output, body)
        for format, name in (("html", "Event_Report.html"), ("json", "Event_Report.json"),
                             ("csv", "Event_Report_Tables.zip")):
            path, descriptor = self.workspace.report_export_file(report_jobs[format]["id"])
            body = regular(path, 1024 * 1024 * 1024)
            need(len(body) == descriptor["bytes"] and sha(body) == descriptor["sha256"],
                 "The original report export changed.")
            publish(name, body)
        for original, name in (("rows.jsonl", "Complete_Event_Table.jsonl"),
                               ("rows.csv", "Complete_Event_Table.csv"),
                               ("manifest.json", "Complete_Event_Table_Manifest.json")):
            with self.workspace.exports.download(applied["events_export"]["job_id"], original) as (stream, descriptor):
                body = stream.read()
            need(len(body) == descriptor["bytes"] and sha(body) == descriptor["sha256"],
                 "The original complete typed event table changed.")
            publish(name, body)
        for path, name in zip(self.source_paths(applied["accepted"]),
                              ("Original_events.ndjson", "Original_events.ndjson.manifest.json")):
            publish(name, regular(path))
        publish("Reviewed_customer_window.json", encoded(operation["review"]))
        publish("Customer_programme.json", encoded(plan["workspace_programme"]))
        for original, name in (("workspace.zip", "Event_Analysis_Workspace.zip"),
                               ("archive-manifest.json", "Event_Analysis_Workspace_Manifest.json")):
            publish(name, archive_files[original][0])
        guide = """# Continue the customer's acquired event analysis

Open Event_Report.html for the selected report and Event_Analysis.xlsx for the
reviewed workbook. Complete_Event_Table.jsonl and Complete_Event_Table.csv
contain every acquired event, with the native typed-export manifest alongside.
Original_events.ndjson and its manifest preserve the original acquired files,
including all event identities and original paid-page references.

Payload values remain text. Adjacent state columns distinguish missing, null
and JSON kinds. Event counts describe acquired events. Use the original buyer
journal and retained page outcome references to account for purchases.

Event_Analysis_Delivery.json identifies both the selected result edition and
the programme edition inside the complete workspace snapshot. A late delivery
of an older result can contain a newer complete workspace, including all prior
windows and current saved customer work. Customer_programme.json is extracted
from that exact archived SQLite snapshot. Repeating this delivery keeps the
same archive, programme and complete result, even after current work advances.

Restore Event_Analysis_Workspace.zip through the original
stellar_forge_buyer.workspace_archive_receive receiver using its SHA-256 from
Event_Analysis_Delivery.json. Open the received directory with the normal
Analysis application to continue Sources, SQL, reports and Workbooks.

The archive retains applied programme history and all source documents; the
sender's final delivery journal is recorded after its snapshot. Continue the
accepted programme using a new operation ID for a later acquired window.
Keep the same programme name and review the complete new source before applying
its exact review digest. Customer report and worksheet edits remain selected.

The publisher's private source state and the buyer's financial operations use
their original owner-operated handovers and recovery journals.
"""
        publish("Open_and_use.md", guide.encode())
        result = {"schema": "stellar-forge.event-feed-analysis-delivery.v1",
                  "programme": self.name, "operation_id": operation_id,
                  "accepted_operation_id": accepted_operation_id,
                  "workspace_id": self.workspace.identity,
                  "edition_id": applied["accepted"]["edition_id"],
                  "review_sha256": applied["accepted"]["review_sha256"],
                  "report": publication, "workbook_job_id": applied["workbook_job_id"],
                  "workspace_archive_job_id": archive["id"],
                  "workspace_programme_edition_id": archived_programme["accepted"]["edition_id"],
                  "workspace_programme_revision": archived_programme["revision"],
                  "files": list(records)}
        publish("Event_Analysis_Delivery.json", encoded(result))
        operation["delivery"] = {**result, "files": list(records), "destination": str(destination)}
        self.save_operation(operation)
        return operation["delivery"]

    def status(self):
        with self.workspace.database._connection(readonly=True) as db:
            rows = db.execute("SELECT id,kind,record FROM sf_analysis_event_operations WHERE programme=? ORDER BY rowid", (self.name,)).fetchall()
        return {"programme": self.programme(), "operations": [
            {"id": row["id"], "kind": row["kind"], **{
                key: value for key, value in json.loads(row["record"]).items()
                if key in {"review", "applied", "delivery", "column_choices", "prior_customer_attempts"}}} for row in rows]}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for action in ("review", "apply", "refresh-review", "deliver", "status"):
        command = commands.add_parser(action)
        command.add_argument("--workspace", required=True)
        command.add_argument("--programme", required=True)
        if action != "status":
            command.add_argument("--operation-id", required=True)
            command.add_argument("--resume", action="store_true")
        if action == "review":
            command.add_argument("--ndjson", required=True)
            command.add_argument("--manifest", required=True)
            command.add_argument("--mapping")
            command.add_argument("--source-cli", required=True)
            command.add_argument("--node", default="node")
        elif action in {"apply", "refresh-review"}:
            command.add_argument("--review-sha256", required=True)
            command.add_argument("--note", required=True)
            command.add_argument("--columns", help="JSON object of worksheet index to complete reviewed column array")
        elif action == "deliver":
            command.add_argument("--destination", required=True)
            command.add_argument("--delivery-id", help="New retained delivery identity for a fresh current-workspace snapshot")
    receive = commands.add_parser("receive")
    receive.add_argument("--archive", required=True)
    receive.add_argument("--sha256", required=True)
    receive.add_argument("--workspace", required=True)
    receive.add_argument("--operation-id", required=True)
    launch = commands.add_parser("serve")
    launch.add_argument("--workspace", required=True)
    launch.add_argument("--port", type=int, default=0)
    args = parser.parse_args(argv)
    workspace = None
    try:
        if args.command == "receive":
            from .workspace_archive_receive import restore_archive
            result = restore_archive(args.archive, args.workspace,
                                     operation=args.operation_id, expected_sha256=args.sha256)
        else:
            workspace = AnalysisWorkspace(args.workspace)
            if args.command == "serve":
                server, control, url = serve(workspace, port=args.port)
                try:
                    print(json.dumps({"url": url, "workspace_id": workspace.identity}), flush=True)
                    server.serve_forever(poll_interval=0.2)
                finally:
                    server.server_close()
                    control.unlink(missing_ok=True)
                return 0
            current = EventFeedAnalysis(workspace, args.programme,
                progress=lambda value: print(json.dumps(value), file=sys.stderr, flush=True))
            if args.command == "review":
                result = current.review(args.ndjson, args.manifest, mapping=args.mapping,
                    source_cli=args.source_cli, node=args.node,
                    operation_id=args.operation_id, resume=args.resume)
            elif args.command == "refresh-review":
                result = current.refresh_review(args.operation_id, args.review_sha256, note=args.note)
            elif args.command == "apply":
                columns = json.loads(regular(args.columns)) if args.columns else {}
                result = current.apply(args.operation_id, args.review_sha256,
                                       note=args.note, columns=columns, resume=args.resume)
            elif args.command == "deliver":
                result = current.deliver(args.operation_id, args.destination, resume=args.resume,
                                         delivery_id=args.delivery_id)
            else:
                result = current.status()
        print(json.dumps(result, ensure_ascii=False, allow_nan=False), flush=True)
        return 0
    except KeyboardInterrupt:
        return 130
    except (BuyerError, OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        print(json.dumps({"schema": SCHEMA, "error": str(error)}), file=sys.stderr)
        return 1
    finally:
        if workspace is not None:
            workspace.close()


if __name__ == "__main__":
    raise SystemExit(main())
