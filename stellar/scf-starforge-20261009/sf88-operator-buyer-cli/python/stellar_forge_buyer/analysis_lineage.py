"""Reviewed OpenLineage publications owned by the original Analysis workspace.

Plans, event bytes, original publication jobs and observations are in the same
SQLite database as Analysis. The original Runtime and LineageClient perform
the only HTTP submission. A retry always uses the same saved source and key.
"""
from __future__ import annotations

from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import shutil
import threading
from urllib.parse import urlsplit
import uuid

from .analysis_lineage_projection import (
    SCHEMA as PROJECTION_SCHEMA, SUPPORTED, capture, checksum, encode, identifier, need)
from .errors import BuyerError, NativeError, StateError
from .runtime import Runtime
from .storage import digest, dump, parse, private_directory, read, write

SCHEMA = "stellar-forge.analysis-lineage.v1"
CONFIG_SCHEMA = "stellar-forge.analysis-lineage-connections.v1"
BRIDGE_SCHEMA = "stellar-forge.analysis-lineage-bridge-request.v1"
BRIDGE_MODE = "ANALYSIS_LINEAGE_BRIDGE"
_NAME = re.compile(r"[A-Za-z][A-Za-z0-9_-]{0,63}")
_ERROR = re.compile(r"[A-Z0-9_]{1,120}")
_MAX_CONFIG = 1024 * 1024
_MAX_PLAN = 48 * 1024 * 1024
_MAX_RECEIPT = 2 * 1024 * 1024


def now():
    return datetime.now(timezone.utc).isoformat()


def fields(value, required, optional=()):
    need(isinstance(value, dict) and set(required) <= set(value)
         and not set(value) - set(required) - set(optional), "FIELDS_INVALID")
    return value


def text(value, maximum, *, empty=False, multiline=False):
    need(isinstance(value, str) and len(value) <= maximum and
         (empty or value.strip()) and all((ord(c) >= 32 and ord(c) != 127) or (multiline and c in "\r\n\t") for c in value),
         "TEXT_INVALID")
    return value


def target_id(value):
    try:
        canonical = str(uuid.UUID(value)) if isinstance(value, str) else None
    except ValueError:
        canonical = None
    need(canonical == value and canonical is not None, "COLLECTOR_ID_INVALID")
    return value


def safe_origin(value):
    need(isinstance(value, str), "COLLECTOR_ORIGIN_INVALID")
    try:
        url = urlsplit(value)
        port = url.port
    except ValueError:
        raise StateError("ANALYSIS_LINEAGE_COLLECTOR_ORIGIN_INVALID") from None
    need(url.scheme in {"http", "https"} and url.hostname and
         url.username is None and url.password is None and
         url.path in {"", "/"} and not url.query and not url.fragment and
         not any(ord(c) <= 32 or ord(c) == 127 for c in value) and
         (port is None or 1 <= port <= 65535), "COLLECTOR_ORIGIN_INVALID")
    return value.rstrip("/")


def collector_origin_allowed(reviewed, current):
    original, actual = urlsplit(safe_origin(reviewed)), urlsplit(safe_origin(current))
    def identity(value):
        return value.scheme, value.hostname, value.port or (443 if value.scheme == "https" else 80)
    if identity(original) == identity(actual):
        return True
    # The original local server can choose another port on a same-workspace
    # restart. A new network destination or protocol needs another review.
    return (original.scheme == actual.scheme and original.hostname == actual.hostname
            and original.hostname in {"127.0.0.1", "::1"})


def page(before, limit):
    need(type(limit) is int and 1 <= limit <= 100 and
         (before is None or type(before) is int and before >= 1), "PAGE_INVALID")


def read_connections(value):
    if value is None:
        return {}
    if not isinstance(value, dict):
        value = parse(read(Path(value).expanduser().absolute(), _MAX_CONFIG))
    fields(value, {"schema", "connections"})
    need(value["schema"] == CONFIG_SCHEMA and isinstance(value["connections"], list)
         and len(value["connections"]) <= 64, "CONFIGURATION_INVALID")
    result = {}
    for item in value["connections"]:
        fields(item, {"name", "label", "connection_file", "expected_workspace_id"},
               {"token_file", "request_timeout_ms"})
        name = item["name"]
        need(isinstance(name, str) and _NAME.fullmatch(name) and name not in result,
             "CONNECTION_NAME_INVALID")
        paths = {}
        for key in ("connection_file", "token_file"):
            path = item.get(key)
            if key == "token_file" and path is None:
                paths[key] = None
                continue
            need(isinstance(path, str) and Path(path).is_absolute() and "\0" not in path,
                 "ABSOLUTE_CONNECTION_FILE_REQUIRED")
            paths[key] = str(Path(path).absolute())
        timeout = item.get("request_timeout_ms", 30000)
        need(type(timeout) is int and 1000 <= timeout <= 300000, "TIMEOUT_INVALID")
        result[name] = {"name": name, "label": text(item["label"], 160),
                        "workspace_id": target_id(item["expected_workspace_id"]),
                        "request_timeout_ms": timeout, **paths}
    return result


def _saved(row, record_key="record", hash_key="sha256"):
    need(row is not None, "NOT_FOUND")
    raw = row[record_key].encode()
    need(digest(raw) == row[hash_key], "RETAINED_RECORD_CHANGED")
    return parse(raw)


def _code(error):
    value = getattr(error, "code", None) or str(error)
    return value if isinstance(value, str) and _ERROR.fullmatch(value) else type(error).__name__.upper()


class AnalysisLineage:
    def __init__(self, workspace, *, connections=None):
        self.workspace, self.database = workspace, workspace.database
        self.identity = identifier(workspace.identity)
        self.connections = read_connections(connections)
        self._condition = threading.Condition()
        self._active = {}
        self._job_events = {}
        self._closed = False
        with self.database._connection() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("CREATE TABLE IF NOT EXISTS sf_analysis_lineage_format(id INTEGER PRIMARY KEY CHECK(id=1),schema TEXT NOT NULL)")
            row = db.execute("SELECT schema FROM sf_analysis_lineage_format WHERE id=1").fetchone()
            if row is None:
                db.execute("INSERT INTO sf_analysis_lineage_format VALUES(1,?)", (SCHEMA,))
            else:
                need(row[0] == SCHEMA, "FORMAT_MISMATCH")
            db.execute("CREATE TABLE IF NOT EXISTS sf_analysis_lineage_plans(sequence INTEGER PRIMARY KEY,id TEXT UNIQUE NOT NULL,request TEXT NOT NULL,record TEXT NOT NULL,sha256 TEXT NOT NULL,events BLOB NOT NULL,events_sha256 TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS sf_analysis_lineage_submissions(plan_id TEXT PRIMARY KEY,job_id TEXT UNIQUE NOT NULL,cancel_requested INTEGER NOT NULL DEFAULT 0,accepted TEXT,accepted_sha256 TEXT,accepted_at TEXT)")
            db.execute("CREATE TABLE IF NOT EXISTS sf_analysis_lineage_observations(sequence INTEGER PRIMARY KEY,job_id TEXT NOT NULL,attempt INTEGER NOT NULL,kind TEXT NOT NULL,created_at TEXT NOT NULL,record TEXT NOT NULL,sha256 TEXT NOT NULL,UNIQUE(job_id,attempt,kind))")
            db.commit()
        self.recover_completed()

    @contextmanager
    def _operation(self, job_id=None):
        event = threading.Event()
        owner = object()
        with self._condition:
            need(not self._closed, "CLOSED")
            if job_id:
                need(job_id not in self._job_events, "JOB_ALREADY_OWNED")
            self._active[owner] = event
            if job_id:
                self._job_events[job_id] = event
        try:
            yield event
        finally:
            with self._condition:
                self._active.pop(owner, None)
                if job_id and self._job_events.get(job_id) is event:
                    self._job_events.pop(job_id, None)
                self._condition.notify_all()

    def close(self):
        with self._condition:
            self._closed = True
            for event in self._active.values():
                event.set()
            while self._active:
                self._condition.wait()

    @staticmethod
    def stopped(event):
        if event.is_set():
            raise StateError("ANALYSIS_LINEAGE_CANCELLED")

    def _connection(self, name, expected=None, *, inspect=False):
        need(isinstance(name, str) and name in self.connections, "CONNECTION_NOT_CONFIGURED")
        selected = self.connections[name]
        if expected is not None:
            need(selected["workspace_id"] == expected, "COLLECTOR_SELECTION_CHANGED")
        result = deepcopy(selected)
        if inspect:
            value = parse(read(Path(selected["connection_file"]), 65536))
            need(isinstance(value, dict) and value.get("schema") == "commons.openlineage.startup.v1"
                 and value.get("workspaceId") == selected["workspace_id"],
                 "COLLECTOR_SELECTION_CHANGED")
            result["endpoint"] = safe_origin(value.get("url"))
        return result

    def configuration(self):
        with self._operation():
            values = []
            for name, record in self.connections.items():
                item = {key: record[key] for key in ("name", "label", "workspace_id", "request_timeout_ms")}
                item["token_configured"] = record["token_file"] is not None
                try:
                    item["endpoint"] = self._connection(name, inspect=True)["endpoint"]
                    item["available"] = True
                except (BuyerError, OSError, ValueError) as error:
                    item.update(available=False, error=_code(error))
                values.append(item)
            return {"schema": SCHEMA, "workspace_id": self.identity,
                    "can_publish": bool(self.workspace.checkout) and bool(values),
                    "connections": values, "supported_jobs": list(SUPPORTED)}

    def jobs(self, *, before=None, limit=25):
        page(before, limit)
        with self._operation():
            with self.database._connection(readonly=True) as db:
                rows = db.execute(
                    "SELECT sequence,id,kind,created_at,finished_at,result FROM sf_analysis_jobs "
                    "WHERE status='COMPLETE' AND kind IN ('import','response-import','query','query-export','workbook') "
                    + ("AND sequence<? " if before is not None else "") +
                    "ORDER BY sequence DESC LIMIT ?", ((before, limit + 1) if before is not None else (limit + 1,))).fetchall()
            items = []
            for row in rows[:limit]:
                result = parse(row["result"].encode())
                item = {key: row[key] for key in ("sequence", "id", "kind", "created_at", "finished_at")}
                item["status"] = "COMPLETE"
                if row["kind"] == "query":
                    item.update(rows=len(result.get("rows", [])), truncated=result.get("truncated"),
                                result_sha256=result.get("result_sha256"))
                elif row["kind"] in {"import", "response-import"}:
                    item.update(rows=result.get("version", {}).get("row_count"),
                                version_id=result.get("version", {}).get("version_id"))
                elif row["kind"] == "query-export":
                    item.update(rows=result.get("manifest", {}).get("rowCount"),
                                manifest_sha256=result.get("manifest_sha256"), label=result.get("label"))
                else:
                    item.update(rows=result.get("row_count"), label=result.get("title"),
                                manifest_sha256=result.get("manifest_sha256"))
                items.append(item)
            return {"items": items, "next_before": rows[limit - 1]["sequence"] if len(rows) > limit else None}

    def review(self, request):
        fields(request, {"job_id"}, {"include_sql"})
        with self._operation() as event:
            result = capture(self.workspace, identifier(request["job_id"]),
                             include_sql=request.get("include_sql", False),
                             stopped=lambda: self.stopped(event))
            return self._review_view(result)

    @staticmethod
    def _review_view(result):
        return {key: result[key] for key in ("snapshot_sha256", "events_sha256", "events", "summary")} | {
            "events_bytes": len(result["events_bytes"]),
            "jobs": result["snapshot"]["jobs"], "datasets": result["snapshot"]["datasets"]}

    def _plan_row(self, db, plan_id):
        row = db.execute("SELECT * FROM sf_analysis_lineage_plans WHERE id=?", (identifier(plan_id),)).fetchone()
        record = _saved(row)
        need(record.get("schema") == SCHEMA and record.get("id") == plan_id and
             record.get("workspace_id") == self.identity, "PLAN_BINDING_CHANGED")
        events = bytes(row["events"])
        need(digest(events) == row["events_sha256"] == record["events_sha256"] and
             len(events) == record["events_bytes"] and
             digest(encode(record["snapshot"])) == record["snapshot_sha256"],
             "PLAN_SOURCE_CHANGED")
        return row, record, events

    def _publication(self, db, plan):
        row = db.execute("SELECT * FROM sf_analysis_lineage_submissions WHERE plan_id=?", (plan["id"],)).fetchone()
        if row is None:
            return None
        job = db.execute("SELECT status,error,created_at,finished_at FROM sf_analysis_jobs WHERE id=? AND kind='lineage-publish'", (row["job_id"],)).fetchone()
        value = {"job_id": row["job_id"], "cancel_requested": bool(row["cancel_requested"]),
                 "status": job["status"] if job else "ADMITTED",
                 "error": job["error"] if job else None}
        if row["accepted"] is not None:
            accepted = _saved(row, "accepted", "accepted_sha256")
            self._validate_acceptance(accepted, plan, row["job_id"])
            value.update(status="ACCEPTED", accepted=accepted)
        return value

    def _view(self, db, row, record, events, *, with_events):
        value = {key: deepcopy(value) for key, value in record.items() if key != "snapshot"}
        value.update(plan_sha256=row["sha256"], sequence=row["sequence"],
                     jobs=record["snapshot"]["jobs"], datasets=record["snapshot"]["datasets"],
                     publication=self._publication(db, record))
        if with_events:
            value["events"] = parse(events)
        return value

    def plan(self, plan_id):
        with self._operation():
            with self.database._connection(readonly=True) as db:
                row, record, events = self._plan_row(db, plan_id)
                return self._view(db, row, record, events, with_events=True)

    def plans(self, *, before=None, limit=25):
        page(before, limit)
        with self._operation():
            with self.database._connection(readonly=True) as db:
                rows = db.execute("SELECT * FROM sf_analysis_lineage_plans " +
                    ("WHERE sequence<? " if before is not None else "") +
                    "ORDER BY sequence DESC LIMIT ?", ((before, limit + 1) if before is not None else (limit + 1,))).fetchall()
                items = []
                for source in rows[:limit]:
                    row, record, events = self._plan_row(db, source["id"])
                    value = self._view(db, row, record, events, with_events=False)
                    value.pop("jobs", None)
                    value.pop("datasets", None)
                    items.append(value)
                return {"items": items, "next_before": rows[limit - 1]["sequence"] if len(rows) > limit else None}

    def save_plan(self, request):
        fields(request, {"id", "job_id", "expected_snapshot_sha256", "connection",
                         "expected_workspace_id", "title", "note"}, {"include_sql"})
        selected = {"id": identifier(request["id"]), "job_id": identifier(request["job_id"]),
                    "expected_snapshot_sha256": checksum(request["expected_snapshot_sha256"]),
                    "connection": text(request["connection"], 64),
                    "expected_workspace_id": target_id(request["expected_workspace_id"]),
                    "title": text(request["title"], 160), "note": text(request["note"], 4000, empty=True, multiline=True),
                    "include_sql": request.get("include_sql", False)}
        need(type(selected["include_sql"]) is bool, "SQL_SELECTION_INVALID")
        raw_request = encode(selected).decode()
        with self._operation() as event:
            with self.database._connection(readonly=True) as db:
                old = db.execute("SELECT request FROM sf_analysis_lineage_plans WHERE id=?", (selected["id"],)).fetchone()
                if old:
                    need(old["request"] == raw_request, "PLAN_ID_REUSED")
                    row, record, events = self._plan_row(db, selected["id"])
                    return self._view(db, row, record, events, with_events=True)
            connection = self._connection(selected["connection"], selected["expected_workspace_id"], inspect=True)
            captured = capture(self.workspace, selected["job_id"], include_sql=selected["include_sql"],
                               stopped=lambda: self.stopped(event))
            need(captured["snapshot_sha256"] == selected["expected_snapshot_sha256"], "REVIEW_CHANGED")
            plan_id = selected["id"]
            record = {"schema": SCHEMA, "projection_schema": PROJECTION_SCHEMA,
                      "id": plan_id, "workspace_id": self.identity, "created_at": now(),
                      "request": selected, "summary": captured["summary"],
                      "snapshot": captured["snapshot"], "snapshot_sha256": captured["snapshot_sha256"],
                      "events_sha256": captured["events_sha256"], "events_bytes": len(captured["events_bytes"]),
                      "operation_id": "analysis-" + self.identity + "-" + plan_id,
                      "source_name": "analysis-lineage-" + plan_id + ".json",
                      "source_url": "urn:stellar-forge:analysis:" + self.identity + ":lineage:" + plan_id,
                      "target": {"name": connection["name"], "label": connection["label"],
                                 "workspace_id": connection["workspace_id"],
                                 "reviewed_endpoint": connection["endpoint"]}}
            raw = encode(record)
            need(len(raw) <= _MAX_PLAN, "PLAN_TOO_LARGE")
            self.stopped(event)
            with self.database._connection() as db:
                db.execute("BEGIN IMMEDIATE")
                old = db.execute("SELECT request FROM sf_analysis_lineage_plans WHERE id=?", (plan_id,)).fetchone()
                if old:
                    need(old["request"] == raw_request, "PLAN_ID_REUSED")
                else:
                    db.execute("INSERT INTO sf_analysis_lineage_plans(id,request,record,sha256,events,events_sha256) VALUES(?,?,?,?,?,?)",
                        (plan_id, raw_request, raw.decode(), digest(raw), captured["events_bytes"], captured["events_sha256"]))
                row, saved, events = self._plan_row(db, plan_id)
                value = self._view(db, row, saved, events, with_events=True)
                db.commit()
                return value

    def prepare(self, request):
        fields(request, {"id", "plan_id", "plan_sha256"})
        spec = {"plan_id": identifier(request["plan_id"]), "plan_sha256": checksum(request["plan_sha256"])}
        with self._operation():
            with self.database._connection(readonly=True) as db:
                row, _, _ = self._plan_row(db, spec["plan_id"])
                need(row["sha256"] == spec["plan_sha256"], "PLAN_REVIEW_CHANGED")
        return spec

    def validate(self, db, spec):
        row, plan, _ = self._plan_row(db, spec["plan_id"])
        need(row["sha256"] == spec["plan_sha256"], "PLAN_REVIEW_CHANGED")
        prior = db.execute("SELECT * FROM sf_analysis_lineage_submissions WHERE plan_id=?", (plan["id"],)).fetchone()
        if prior:
            need(prior["job_id"] == spec["id"], "USE_ORIGINAL_PUBLICATION_JOB")
        else:
            self._connection(plan["target"]["name"], plan["target"]["workspace_id"])
            db.execute("INSERT INTO sf_analysis_lineage_submissions(plan_id,job_id) VALUES(?,?)", (plan["id"], spec["id"]))

    def resume(self, db, spec):
        self.validate(db, spec)
        db.execute("UPDATE sf_analysis_lineage_submissions SET cancel_requested=0 WHERE job_id=?", (spec["id"],))

    def _observation(self, db, job_id, attempt, kind, record):
        raw = encode(record).decode()
        sha = digest(raw.encode())
        old = db.execute("SELECT record,sha256 FROM sf_analysis_lineage_observations WHERE job_id=? AND attempt=? AND kind=?", (job_id, attempt, kind)).fetchone()
        if old:
            need(old["record"] == raw and old["sha256"] == sha, "OBSERVATION_CHANGED")
        else:
            db.execute("INSERT INTO sf_analysis_lineage_observations(job_id,attempt,kind,created_at,record,sha256) VALUES(?,?,?,?,?,?)",
                       (job_id, attempt, kind, now(), raw, sha))

    def _observations(self, db, job_id):
        rows = db.execute("SELECT * FROM sf_analysis_lineage_observations WHERE job_id=? ORDER BY sequence", (job_id,)).fetchall()
        return [{key: row[key] for key in ("sequence", "attempt", "kind", "created_at")} |
                {"record": _saved(row)} for row in rows]

    def progress(self, job_id):
        job_id = identifier(job_id)
        with self.database._connection(readonly=True) as db:
            row = db.execute("SELECT * FROM sf_analysis_lineage_submissions WHERE job_id=?", (job_id,)).fetchone()
            if not row:
                return {"job_id": job_id, "state": "NOT_ADMITTED"}
            observations = self._observations(db, job_id)
            return {"job_id": job_id, "plan_id": row["plan_id"],
                    "state": "ACCEPTED" if row["accepted"] is not None else
                             (observations[-1]["record"].get("outcome", "PENDING") if observations else "PENDING"),
                    "cancel_requested": bool(row["cancel_requested"]),
                    "attempts": max((v["attempt"] for v in observations), default=0),
                    "observations": observations[-20:], "observation_count": len(observations)}

    def cancel(self, job_id):
        job_id = identifier(job_id)
        with self._operation():
            with self.database._connection() as db:
                db.execute("BEGIN IMMEDIATE")
                row = db.execute("SELECT * FROM sf_analysis_lineage_submissions WHERE job_id=?", (job_id,)).fetchone()
                need(row is not None, "PUBLICATION_NOT_FOUND")
                if row["accepted"] is None:
                    db.execute("UPDATE sf_analysis_lineage_submissions SET cancel_requested=1 WHERE job_id=?", (job_id,))
                db.commit()
            with self._condition:
                event = self._job_events.get(job_id)
                if event:
                    event.set()
            return self.progress(job_id)

    @staticmethod
    def _valid_reply(output, plan):
        need(isinstance(output, dict) and output.get("mode") == BRIDGE_MODE and output.get("ok") is True,
             "NATIVE_REPLY_INVALID")
        need(output.get("operationId") == plan["operation_id"] and
             output.get("workspaceId") == plan["target"]["workspace_id"] and
             output.get("sourceSha256") == plan["events_sha256"] and
             output.get("sourceBytes") == plan["events_bytes"], "NATIVE_REPLY_BINDING_CHANGED")
        need(collector_origin_allowed(plan["target"]["reviewed_endpoint"], output.get("endpoint")),
             "COLLECTOR_ENDPOINT_CHANGED")
        receipt = output.get("receipt")
        need(isinstance(receipt, dict) and receipt.get("workspaceId") == plan["target"]["workspace_id"]
             and receipt.get("operationId") == plan["operation_id"], "PRODUCER_RECEIPT_CHANGED")
        source = receipt.get("source")
        need(isinstance(source, dict) and source.get("id") == plan["events_sha256"] and
             source.get("name") == plan["source_name"] and source.get("bytes") == plan["events_bytes"] and
             source.get("contentEncoding") == "identity" and source.get("format") == "array",
             "PRODUCER_SOURCE_CHANGED")
        need(type(receipt.get("revision")) is int and receipt["revision"] >= 0 and
             type(receipt.get("added")) is int and type(receipt.get("retained")) is int and
             0 <= receipt["added"] <= receipt["retained"] == plan["summary"]["event_count"] and
             type(receipt.get("replayed")) is bool, "PRODUCER_RECEIPT_INVALID")
        need(len(encode(output)) <= _MAX_RECEIPT, "PRODUCER_RECEIPT_TOO_LARGE")
        return output

    def _validate_acceptance(self, accepted, plan, job_id):
        need(accepted.get("schema") == SCHEMA and accepted.get("workspace_id") == self.identity and
             accepted.get("plan_id") == plan["id"] and accepted.get("job_id") == job_id,
             "ACCEPTANCE_BINDING_CHANGED")
        self._valid_reply(accepted.get("native"), plan)
        return accepted

    def _accept(self, db, job_id, plan, attempt, native, runtime):
        self._valid_reply(native, plan)
        existing = db.execute("SELECT * FROM sf_analysis_lineage_submissions WHERE job_id=?", (job_id,)).fetchone()
        need(existing is not None and existing["plan_id"] == plan["id"], "PUBLICATION_BINDING_CHANGED")
        if existing["accepted"] is not None:
            return self._validate_acceptance(_saved(existing, "accepted", "accepted_sha256"), plan, job_id)
        accepted = {"schema": SCHEMA, "workspace_id": self.identity, "job_id": job_id,
                    "plan_id": plan["id"], "accepted_at": now(), "attempt": attempt,
                    "native": native, "runtime": runtime}
        raw = encode(accepted).decode()
        db.execute("UPDATE sf_analysis_lineage_submissions SET accepted=?,accepted_sha256=?,accepted_at=?,cancel_requested=0 WHERE job_id=?",
                   (raw, digest(raw.encode()), accepted["accepted_at"], job_id))
        return accepted

    def recover_completed(self):
        with self.database._connection() as db:
            db.execute("BEGIN IMMEDIATE")
            rows = db.execute("SELECT * FROM sf_analysis_lineage_submissions WHERE accepted IS NOT NULL").fetchall()
            for submission in rows:
                plan_row, plan, _ = self._plan_row(db, submission["plan_id"])
                accepted = self._validate_acceptance(_saved(submission, "accepted", "accepted_sha256"),
                                                     plan, submission["job_id"])
                job = db.execute("SELECT * FROM sf_analysis_jobs WHERE id=?", (submission["job_id"],)).fetchone()
                need(job is not None and job["kind"] == "lineage-publish" and
                     parse(job["request"].encode()) == {"id": submission["job_id"],
                         "plan_id": plan["id"], "plan_sha256": plan_row["sha256"]},
                     "PUBLICATION_JOB_CHANGED")
                if job["status"] != "COMPLETE":
                    db.execute("UPDATE sf_analysis_jobs SET status='COMPLETE',result=?,error=NULL,finished_at=? WHERE id=?",
                               (encode(accepted).decode(), accepted["accepted_at"], submission["job_id"]))
                else:
                    need(parse(job["result"].encode()) == accepted, "PUBLICATION_RESULT_CHANGED")
            db.commit()

    def run(self, job_id, spec):
        job_id = identifier(job_id)
        stage = None
        recorded_outcome = False
        with self._operation(job_id) as event:
            with self.database._connection() as db:
                db.execute("BEGIN IMMEDIATE")
                self.validate(db, spec)
                _, plan, event_bytes = self._plan_row(db, spec["plan_id"])
                publication = self._publication(db, plan)
                if publication and publication.get("accepted"):
                    db.commit()
                    return publication["accepted"]
                cancellation = db.execute("SELECT cancel_requested FROM sf_analysis_lineage_submissions WHERE job_id=?", (job_id,)).fetchone()[0]
                if cancellation:
                    event.set()
                last = db.execute("SELECT MAX(attempt) FROM sf_analysis_lineage_observations WHERE job_id=?", (job_id,)).fetchone()[0] or 0
                attempt = last + 1
                intent = {"schema": SCHEMA, "job_id": job_id, "plan_id": plan["id"],
                          "operation_id": plan["operation_id"], "source_sha256": plan["events_sha256"],
                          "source_bytes": plan["events_bytes"], "target_workspace_id": plan["target"]["workspace_id"],
                          "outcome": "INTENT_RETAINED"}
                self._observation(db, job_id, attempt, "INTENT", intent)
                db.commit()
            started = False
            output = None
            native_error = None
            runtime_record = {"processStarted": False, "returncode": None, "error": None, "interrupted": False}
            try:
                self.stopped(event)
                selected = self._connection(plan["target"]["name"], plan["target"]["workspace_id"], inspect=True)
                need(collector_origin_allowed(plan["target"]["reviewed_endpoint"], selected["endpoint"]),
                     "COLLECTOR_ENDPOINT_CHANGED")
                need(self.workspace.checkout is not None, "ORIGINAL_RUNTIME_REQUIRED")
                root = private_directory(self.database.directory / "analysis-lineage-private")
                directory = private_directory(root / job_id)
                stage = private_directory(directory / ("attempt-" + str(attempt).zfill(8)))
                write(stage / "events.json", event_bytes, exclusive=True)
                request = {"schema": BRIDGE_SCHEMA, "action": "emit",
                           "connection_file": selected["connection_file"], "token_file": selected["token_file"],
                           "expected_workspace_id": plan["target"]["workspace_id"],
                           "reviewed_endpoint": plan["target"]["reviewed_endpoint"],
                           "timeout_ms": selected["request_timeout_ms"], "operation_id": plan["operation_id"],
                           "source": {"path": str(stage / "events.json"), "sha256": plan["events_sha256"],
                                      "bytes": plan["events_bytes"], "name": plan["source_name"],
                                      "url": plan["source_url"]}}
                dump(stage / "request.json", request, exclusive=True)
                logs = private_directory(stage / "logs")
                runtime = Runtime(self.workspace.checkout, node=self.workspace.node,
                                  timeout=selected["request_timeout_ms"] / 1000 + 20,
                                  output_limit=_MAX_RECEIPT)
                def mark_started(_pid):
                    nonlocal started
                    started = True
                    with self.database._connection() as db:
                        self._observation(db, job_id, attempt, "PROCESS",
                                          {"processStarted": True, "outcome": "ORIGINAL_RUNTIME_STARTED"})
                native = runtime.run(["--request", str(stage / "request.json")], target="analysis-lineage",
                                     logs=logs, started=mark_started, cancel_event=event)
                output = native.output
                runtime_record = {"processStarted": started, "returncode": native.returncode,
                                  "error": native.error, "interrupted": native.interrupted}
                if native.returncode == 0 and isinstance(output, dict) and output.get("ok") is True:
                    self._valid_reply(output, plan)
                else:
                    native_error = (output.get("error") if isinstance(output, dict) and
                                    output.get("mode") == BRIDGE_MODE else None) or native.error or "NATIVE_COMMAND_FAILED"
            except BaseException as error:
                native_error = _code(error)
                runtime_record.update(processStarted=started, error=native_error,
                                      interrupted=event.is_set())
            try:
                accepted = None
                if native_error is None and isinstance(output, dict):
                    # A complete validated native success is authoritative even
                    # when Runtime observed a later cancellation or deadline.
                    with self.database._connection() as db:
                        db.execute("BEGIN IMMEDIATE")
                        accepted = self._accept(db, job_id, plan, attempt, output, runtime_record)
                        self._observation(db, job_id, attempt, "RESULT",
                                          {"outcome": "ACCEPTED", "runtime": runtime_record,
                                           "native": output, "accepted_at": accepted["accepted_at"]})
                        db.commit()
                else:
                    failure = {"outcome": "OUTCOME_UNKNOWN" if started else "NOT_STARTED",
                               "error": native_error, "runtime": runtime_record}
                    if isinstance(output, dict) and output.get("mode") == BRIDGE_MODE:
                        failure["native"] = output
                        if output.get("dispatchStarted") is False:
                            failure["outcome"] = "NOT_DISPATCHED"
                        elif (output.get("error") == "LINEAGE_HTTP_ERROR" and
                              type(output.get("status")) is int and
                              output["status"] in {400, 401, 403, 404, 405, 409, 413, 415}):
                            # These complete native preflight responses prove rejection.
                            # A malformed 2xx receipt or any 5xx can follow a commit.
                            failure["outcome"] = "HTTP_REJECTED"
                    with self.database._connection() as db:
                        self._observation(db, job_id, attempt, "RESULT", failure)
                recorded_outcome = True
                if accepted is not None:
                    return accepted
                if event.is_set():
                    raise StateError("ANALYSIS_LINEAGE_CANCELLED")
                raise StateError("ANALYSIS_LINEAGE_PUBLICATION_NOT_ACCEPTED")
            finally:
                # If a receipt could not be recorded, keep the exact original
                # request/log files for diagnosis. Any later retry still uses
                # the same plan/key/bytes and the collector's original replay.
                if stage is not None and recorded_outcome:
                    shutil.rmtree(stage, ignore_errors=True)

    def _download_bundle(self, plan_id, event):
        """Render one original read transaction; the index binds its exact bytes."""
        with self.database._connection(readonly=True) as db:
            db.execute("BEGIN")
            row, record, events = self._plan_row(db, plan_id)
            publication = self._publication(db, record)
            history = self._observations(db, publication["job_id"]) if publication else []
            view = self._view(db, row, record, events, with_events=False)
        self.stopped(event)
        from .analysis_lineage_reports import files
        members = files(view, record["snapshot"], events, history)
        self.stopped(event)
        entries = []
        for name, (data, mime) in sorted(members.items()):
            need(len(data) <= 128 * 1024 * 1024, "HANDOVER_TOO_LARGE")
            entries.append({"name": name, "bytes": len(data), "sha256": digest(data), "mime": mime})
        index = {"schema": "stellar-forge.analysis-lineage-downloads.v1",
                 "workspace_id": self.identity, "plan_id": plan_id,
                 "plan_sha256": view["plan_sha256"], "events_sha256": view["events_sha256"],
                 "manifest_sha256": next(item["sha256"] for item in entries if item["name"] == "manifest.json"),
                 "files": entries}
        index["index_sha256"] = digest(encode(index))
        return index, members

    def downloads(self, plan_id):
        """Read a hash-bound index of the original event, receipt and report files."""
        with self._operation() as event:
            index, _ = self._download_bundle(identifier(plan_id), event)
            return index

    def download(self, plan_id, name, *, expected_sha256=None):
        allowed = {"events.json", "plan.json", "native-bindings.json", "receipts.json",
                   "report.html", "manifest.json", "handover.zip"}
        need(name in allowed, "DOWNLOAD_INVALID")
        if expected_sha256 is not None:
            checksum(expected_sha256)
        with self._operation() as event:
            index, members = self._download_bundle(identifier(plan_id), event)
            data, mime = members[name]
            selected = next(item for item in index["files"] if item["name"] == name)
            need(expected_sha256 is None or selected["sha256"] == expected_sha256,
                 "DOWNLOAD_CHANGED")
            return {"bytes": data, "mime": mime, "filename": "analysis-lineage-" + plan_id + "-" + name,
                    "sha256": selected["sha256"]}
