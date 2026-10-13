"""Retained grant delivery and cash operations inside the original SF47 workspace."""
from __future__ import annotations

import base64
from copy import deepcopy
from contextlib import contextmanager
import hashlib
import io
import json
import re
import uuid
import zipfile

from model import Problem, canonical, digest, now, text, short_id, csv_bytes, MAX_BUNDLE
import operations_domain as domain
import forecast as forecasts
import portfolio as portfolios
import operations_support as support
import operations_buyer as buyer
import operations_completion as completion
import operations_cohort as cohort
import operations_installations as installations
import operations_implementation as implementation

SCHEMA = "stellar-forge.sf47-operations.v1"
MAX_SOURCE = 8 * 1024 * 1024
MAX_SOURCES_TOTAL = 24 * 1024 * 1024
MAX_RECORDS = 5000
STATES = {
    "contributors": {"ACTIVE"},
    "work": {"LOGGED", "SUBMITTED", "ACCEPTED", "VOID"},
    "invoices": {"RECEIVED", "REVIEWED", "DISPUTED", "VOID"},
    "cash": {"OBSERVED", "VOID"},
    "awards": {"RECORDED"},
    "deployments": {"PLANNED", "INSTALLED", "OPERATING", "HANDED_OVER", "RETIRED"},
    "purchases": {"RECORDED", "VOID"},
    "outcomes": {"IN_PROGRESS", "SUBMITTED", "ACCEPTED", "CHANGES_REQUESTED", "WITHDRAWN"},
}


def decoded(raw):
    if not isinstance(raw, str):
        domain.fail("Attachment content must be base64 text.")
    if len(raw) > (MAX_SOURCE + 2) * 4 // 3 + 16:
        domain.fail("An original source attachment may be at most 8 MiB.", status=413)
    try:
        value = base64.b64decode(raw, validate=True)
    except Exception as exc:
        raise Problem("The original source encoding is invalid.", 422, "INVALID_SOURCE") from exc
    if not value or len(value) > MAX_SOURCE:
        domain.fail("Attach a nonempty original source up to 8 MiB.", status=413)
    return value


def identifier(value, prefix=None):
    value = text(value, "Record identity", 100, True)
    if not re.fullmatch(r"[a-z][a-z0-9-]{1,99}", value) or prefix and not value.startswith(prefix + "-"):
        domain.fail("Use the retained original record identity.")
    return value


def generated(prefix):
    return prefix + "-" + uuid.uuid4().hex


class Operations:
    def __init__(self, workspace):
        self.workspace = workspace
        with workspace.mutex:
            workspace.db.executescript("""
                CREATE TABLE IF NOT EXISTS ops_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS ops_programs(
                    id TEXT PRIMARY KEY,plan_id TEXT NOT NULL REFERENCES plans(id),
                    plan_revision INTEGER NOT NULL,version INTEGER NOT NULL,state TEXT NOT NULL,
                    name TEXT NOT NULL,mode TEXT NOT NULL,calendar_start TEXT,plan_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,updated_at TEXT NOT NULL,origin_json TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS ops_records(
                    program_id TEXT NOT NULL REFERENCES ops_programs(id),kind TEXT NOT NULL,
                    id TEXT NOT NULL,state TEXT NOT NULL,body_json TEXT NOT NULL,
                    PRIMARY KEY(program_id,kind,id));
                CREATE TABLE IF NOT EXISTS ops_sources(
                    program_id TEXT NOT NULL REFERENCES ops_programs(id),id TEXT NOT NULL,
                    metadata_json TEXT NOT NULL,content BLOB NOT NULL,PRIMARY KEY(program_id,id));
                CREATE TABLE IF NOT EXISTS ops_events(
                    program_id TEXT NOT NULL REFERENCES ops_programs(id),version INTEGER NOT NULL,
                    body_json TEXT NOT NULL,PRIMARY KEY(program_id,version));
                CREATE TABLE IF NOT EXISTS ops_reviews(
                    program_id TEXT NOT NULL REFERENCES ops_programs(id),id TEXT NOT NULL,
                    body_json TEXT NOT NULL,PRIMARY KEY(program_id,id));
                CREATE TABLE IF NOT EXISTS ops_forecasts(
                    program_id TEXT NOT NULL REFERENCES ops_programs(id),id TEXT NOT NULL,
                    body_json TEXT NOT NULL,PRIMARY KEY(program_id,id));
                CREATE TABLE IF NOT EXISTS ops_portfolios(
                    program_id TEXT NOT NULL REFERENCES ops_programs(id),id TEXT NOT NULL,
                    body_json TEXT NOT NULL,PRIMARY KEY(program_id,id));
            """)
            completion.install(workspace.db)
            installations.install(workspace.db)
            row = workspace.db.execute("SELECT value FROM ops_metadata WHERE key='schema'").fetchone()
            if row and row[0] != SCHEMA:
                domain.fail("This workspace uses a newer operations schema.", "OPERATIONS_SCHEMA", 409)
            workspace.db.execute("INSERT OR IGNORE INTO ops_metadata VALUES('schema',?)", (SCHEMA,))

    @property
    def db(self):
        return self.workspace.db

    def _program(self, program_id):
        row = self.db.execute("SELECT id,plan_id,plan_revision,version,state,name,mode,calendar_start,plan_json,created_at,updated_at,origin_json FROM ops_programs WHERE id=?", (program_id,)).fetchone()
        if not row:
            domain.fail("Delivery operations case not found.", "OPERATIONS_NOT_FOUND", 404)
        return ({"id": row[0], "planId": row[1], "planRevision": row[2], "version": row[3], "state": row[4],
                 "name": row[5], "mode": row[6], "calendarStart": row[7], "createdAt": row[9],
                 "updatedAt": row[10], "origin": json.loads(row[11])}, json.loads(row[8]))

    def _context(self, program_id):
        program, plan = self._program(program_id)
        records = {key: [] for key in domain.KINDS}
        for kind, raw in self.db.execute("SELECT kind,body_json FROM ops_records WHERE program_id=? ORDER BY kind,id", (program_id,)):
            records[kind].append(json.loads(raw))
        sources = {row["id"]: row for row in (json.loads(raw[0]) for raw in self.db.execute(
            "SELECT metadata_json FROM ops_sources WHERE program_id=? ORDER BY id", (program_id,)))}
        result = {"program": program, "plan": plan, "records": records, "sources": sources,
                  "completionPlans": completion.load_plans(self, program_id)}
        refs = installations.latest_refs(installations.load(self, program_id))
        if refs:
            result["installationRefs"] = refs
        return result

    @staticmethod
    def _business(context):
        p = context["program"]
        result = {"program": {key: p[key] for key in ("id", "name", "mode", "calendarStart")},
                  "plan": context["plan"], "records": context["records"],
                  "sources": sorted(context["sources"].values(), key=lambda row: row["id"])}
        if context.get("completionPlans"):
            result["completionPlans"] = context["completionPlans"]
        if context.get("installationRefs"):
            result["installationRefs"] = context["installationRefs"]
        return result

    def _read(self, program_id):
        context = self._context(program_id)
        result = {**context, "sources": list(context["sources"].values()),
                  "report": domain.report(**context)}
        result["completion"] = completion.dashboard(context)
        cohort_history = self._cohort_history(program_id)
        result["installations"] = installations.latest_summaries(installations.load(self, program_id))
        result["reviews"] = [{**{key: row[key] for key in ("id", "version", "createdAt", "actor", "note", "businessSha256")},
                              "purpose": row.get("purpose"),
                              **({"completionTranche": row["completion"]["clock"]["tranche"],
                                  "receiptId": row["completion"]["receipt"]["id"]} if row.get("purpose") == "TRANCHE_COMPLETION" else {}),
                              **(cohort.summary(row, context, cohort_history) if row.get("purpose") == "COHORT_EVALUATION" else {}),
                              **(implementation.summary(row, context) if row.get("purpose") == implementation.PURPOSE else {})}
            for row in (json.loads(raw[0]) for raw in self.db.execute(
                "SELECT body_json FROM ops_reviews WHERE program_id=? ORDER BY rowid DESC", (program_id,)))]
        latest = self.db.execute("SELECT current_revision FROM plans WHERE id=?", (result["program"]["planId"],)).fetchone()
        result["program"]["currentPlanRevision"] = latest[0]
        result["forecasts"] = [forecasts.summary(json.loads(row[0])) for row in self.db.execute(
            "SELECT body_json FROM ops_forecasts WHERE program_id=? ORDER BY rowid DESC", (program_id,))]
        result["portfolios"] = [portfolios.summary(json.loads(row[0])) for row in self.db.execute(
            "SELECT body_json FROM ops_portfolios WHERE program_id=? ORDER BY rowid DESC", (program_id,))]
        return result

    def read(self, program_id):
        with self.workspace.mutex:
            return self._read(identifier(program_id, "operation"))

    def report(self, program_id):
        return self.read(program_id)["report"]

    def list(self, plan_id=None):
        with self.workspace.mutex:
            params = () if plan_id is None else (plan_id,)
            where = "" if plan_id is None else " WHERE plan_id=?"
            return [{"id": row[0], "planId": row[1], "planRevision": row[2], "version": row[3],
                     "state": row[4], "name": row[5], "mode": row[6], "updatedAt": row[7]}
                for row in self.db.execute("SELECT id,plan_id,plan_revision,version,state,name,mode,updated_at FROM ops_programs" + where + " ORDER BY updated_at DESC,id", params)]

    def _event(self, program_id, version, body, action, before=None, after=None, kind=None, record_id=None, source_change=None):
        event = {"version": version, "at": now(), "actor": body["actor"], "note": body.get("note", ""),
                 "requestId": body["requestId"], "action": action, "kind": kind, "recordId": record_id,
                 "before": before, "after": after}
        if source_change is not None:
            event["sourceChange"] = source_change
        event["sha256"] = digest(event)
        self.db.execute("INSERT INTO ops_events VALUES(?,?,?)", (program_id, version, canonical(event)))

    def create(self, body):
        if not isinstance(body, dict):
            domain.fail("Provide a case creation object.")
        actor = text(body.get("actor"), "Recording operator", 300, True)
        name = text(body.get("name"), "Operations case name", 300, True)
        mode = domain.enum(body.get("mode"), ("OPERATIONS", "WALKTHROUGH"), "Case purpose")
        revision = domain.integer(body.get("selectedRevision"), "Saved plan revision", 1, 1000000)
        expected = domain.sha(body.get("expectedContentSha256"), "Reviewed plan content", False)
        anchor = domain.calendar(body.get("calendarStart"), "Operational calendar anchor", True)
        payload = {"domain": SCHEMA, "action": "create", "body": body}
        def action():
            plan = self.workspace._read(body["planId"], revision)
            if plan["contentSha256"] != expected:
                domain.fail("The selected saved plan differs from the reviewed source.", "PLAN_SOURCE_CONFLICT", 409)
            pid, stamp = generated("operation"), now()
            actual_anchor = anchor or plan["planning"].get("calendarStart")
            self.db.execute("INSERT INTO ops_programs VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                (pid, plan["id"], revision, 1, "OPEN", name, mode, actual_anchor, canonical(plan), stamp, stamp, "{}"))
            self._event(pid, 1, {**body, "actor": actor, "note": "Opened from selected immutable planning revision"},
                        "create", after={"planId": plan["id"], "revision": revision, "contentSha256": expected,
                                         "sourceSha256": plan["source"]["sha256"], "mode": mode})
            return {"id": pid, "version": 1, "action": "create", "planId": plan["id"], "planRevision": revision}
        return self.workspace._transaction(body.get("requestId"), payload, action)

    def _record(self, program_id, kind, record_id):
        row = self.db.execute("SELECT body_json FROM ops_records WHERE program_id=? AND kind=? AND id=?",
                              (program_id, kind, record_id)).fetchone()
        if not row:
            domain.fail("The selected operations record is unavailable.", "RECORD_NOT_FOUND", 404)
        return json.loads(row[0])

    def _save(self, program_id, kind, row):
        self.db.execute("INSERT INTO ops_records VALUES(?,?,?,?,?) ON CONFLICT(program_id,kind,id) DO UPDATE SET state=excluded.state,body_json=excluded.body_json",
                        (program_id, kind, row["id"], row["state"], canonical(row)))

    def _source_add(self, program_id, data):
        content = decoded(data.get("contentBase64"))
        name = text(data.get("filename"), "Original source filename", 240, True)
        if "/" in name or "\\" in name or name in (".", "..") or any(ord(char) < 32 for char in name):
            domain.fail("Use a plain original filename.")
        media = text(data.get("mediaType", "application/octet-stream"), "Source media type", 200, True)
        if not re.fullmatch(r"[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+", media):
            domain.fail("Use a plain MIME media type.")
        total, count = self.db.execute("SELECT COALESCE(SUM(length(content)),0),COUNT(*) FROM ops_sources WHERE program_id=?", (program_id,)).fetchone()
        if total + len(content) > MAX_SOURCES_TOTAL or count >= 200:
            domain.fail("The case source bundle exceeds its 24 MiB / 200-file bound.", status=413)
        row = {"id": generated("source"), "filename": name, "mediaType": media,
               "kind": domain.enum(data.get("kind", "other"), ("invoice", "work", "grant", "payment", "deployment", "purchase", "other"), "Source kind"),
               "sourceUrl": domain.url(data.get("sourceUrl", ""), "Original source URL"),
               "observedAt": domain.timestamp(data.get("observedAt") or now(), "Source observation"),
               "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest(), "createdAt": now()}
        self.db.execute("INSERT INTO ops_sources VALUES(?,?,?,?)", (program_id, row["id"], canonical(row), content))
        return row

    def command(self, program_id, body):
        program_id = identifier(program_id, "operation")
        if not isinstance(body, dict) or not isinstance(body.get("data", {}), dict):
            domain.fail("Use an operations command object.")
        expected = domain.integer(body.get("expectedVersion"), "Reviewed operations version", 1, 10000000)
        actor = text(body.get("actor"), "Recording operator", 300, True)
        note = text(body.get("note", ""), "Operation note", 12000)
        command = text(body.get("action"), "Operations action", 100, True)
        data = body.get("data", {})
        payload = {"domain": SCHEMA, "programId": program_id, "body": body}
        def action():
            context = self._context(program_id)
            program = context["program"]
            if program["version"] != expected:
                domain.fail("Another operations change was saved. Reopen the case and reconcile it.", "OPERATIONS_CONFLICT", 409)
            if program["state"] == "CLOSED" and command != "reopen":
                domain.fail("Reopen this closed review before recording new work.", "OPERATIONS_CLOSED", 409)
            next_version = expected + 1
            before, after, kind, record_id = None, None, None, None
            extra_receipt, source_change = {}, None
            if command == "source.add":
                after = self._source_add(program_id, data)
                kind, record_id = "source", after["id"]
            elif command == "support.receive":
                result = support.receive(self, context, data, actor, next_version)
                source_change = result["sourceChange"]
                before, after, kind = result["before"], result["after"], "deployments"
                record_id = after["id"]
                extra_receipt = {"sourceIds": result["sourceIds"], "sourceSha256": result["sourceSha256"],
                                 "unchanged": result["unchanged"]}
                if result["unchanged"]:
                    return {"id": program_id, "version": expected, "action": command, "kind": kind,
                            "recordId": record_id, **extra_receipt}
            elif command == "buyer.receive":
                result = buyer.receive(self, context, data, actor, next_version)
                before, after, kind, record_id = (result[key] for key in ("before", "after", "kind", "recordId"))
                source_change = result.get("sourceChange")
                extra_receipt = {key: value for key, value in result.items()
                                 if key not in ("before", "after", "kind", "recordId", "sourceChange")}
                if result["unchanged"]:
                    return {"id": program_id, "version": expected, "action": command, "kind": kind,
                            "recordId": record_id, **extra_receipt}
            elif command == "implementation.prepare":
                result = implementation.prepare(self, context, data, actor, next_version)
                before, after, kind, record_id = (result[key] for key in ("before", "after", "kind", "recordId"))
                extra_receipt = {key: value for key, value in result.items()
                                 if key not in ("before", "after", "kind", "recordId")}
            elif command == "cohort.prepare":
                result = cohort.prepare(self, context, data, actor, next_version, self._cohort_history(program_id))
                before, after, kind, record_id = (result[key] for key in ("before", "after", "kind", "recordId"))
                extra_receipt = {key: value for key, value in result.items()
                                 if key not in ("before", "after", "kind", "recordId")}
            elif command.startswith("completion."):
                if command == "completion.submit" and self.db.execute("SELECT COUNT(*) FROM ops_records WHERE program_id=?", (program_id,)).fetchone()[0] >= MAX_RECORDS:
                    domain.fail("This operations case has reached its retained-record bound.", status=413)
                result = completion.command(self, context, command, data, actor, next_version)
                before, after, kind, record_id = (result[key] for key in ("before", "after", "kind", "recordId"))
                extra_receipt = {key: value for key, value in result.items()
                                 if key not in ("before", "after", "kind", "recordId")}
                if result["unchanged"]:
                    return {"id": program_id, "version": expected, "action": command, "kind": kind,
                            "recordId": record_id, **extra_receipt}
            elif command == "installation.save":
                result = installations.save(self, context, data, actor, next_version, note)
                before, after, kind, record_id = (result[key] for key in ("before", "after", "kind", "recordId"))
                extra_receipt = {key: value for key, value in result.items()
                                 if key not in ("before", "after", "kind", "recordId")}
            elif command == "forecast.save":
                candidate = forecasts.preview(context, data.get("inputs"))
                if candidate["previewSha256"] != domain.sha(data.get("expectedPreviewSha256"), "Reviewed forecast", False):
                    domain.fail("The forecast inputs or source differ from the reviewed preview.", "FORECAST_PREVIEW_CONFLICT", 409)
                if self.db.execute("SELECT COUNT(*) FROM ops_forecasts WHERE program_id=?", (program_id,)).fetchone()[0] >= forecasts.MAX_FORECASTS:
                    domain.fail("This case has reached its retained forecast bound.", status=413)
                record_id, kind = generated("forecast"), "forecast"
                row = {**candidate, "id": record_id, "version": next_version, "createdAt": now(),
                       "actor": actor, "note": note, "snapshot": context}
                row["sha256"] = digest(row)
                forecasts.validate_saved(row, context["plan"])
                self.db.execute("INSERT INTO ops_forecasts VALUES(?,?,?)", (program_id, record_id, canonical(row)))
                after = forecasts.summary(row)
            elif command == "portfolio.save":
                if not isinstance(data.get("inputs"), dict):
                    domain.fail("Use a portfolio input object.", "INVALID_PORTFOLIO")
                saved_forecast = self._portfolio_forecast(program_id, data.get("inputs", {}).get("forecastId"))
                candidate = portfolios.preview(context, saved_forecast, data.get("inputs"))
                if candidate["previewSha256"] != domain.sha(data.get("expectedPreviewSha256"), "Reviewed portfolio", False):
                    domain.fail("The portfolio inputs or source differ from the reviewed preview.", "PORTFOLIO_PREVIEW_CONFLICT", 409)
                if self.db.execute("SELECT COUNT(*) FROM ops_portfolios WHERE program_id=?", (program_id,)).fetchone()[0] >= portfolios.MAX_PORTFOLIOS:
                    domain.fail("This case has reached its retained portfolio bound.", status=413)
                record_id, kind = generated("portfolio"), "portfolio"
                row = {**candidate, "id": record_id, "version": next_version, "createdAt": now(),
                       "actor": actor, "note": note, "snapshot": context, "baseForecastSnapshot": saved_forecast}
                row["sha256"] = digest(row)
                portfolios.validate_saved(row, context["plan"])
                self.db.execute("INSERT INTO ops_portfolios VALUES(?,?,?)", (program_id, record_id, canonical(row)))
                after = portfolios.summary(row)
            elif command in ("review", "close", "reopen"):
                if not note:
                    domain.fail("Retain the reason for this review, close or reopening.")
                if command == "review":
                    snapshot = self._business(context)
                    row = {"id": generated("review"), "version": next_version, "createdAt": now(),
                           "actor": actor, "note": note, "businessSha256": digest(snapshot),
                           "snapshot": snapshot, "report": domain.report(**context)}
                    self.db.execute("INSERT INTO ops_reviews VALUES(?,?,?)", (program_id, row["id"], canonical(row)))
                    after = {key: row[key] for key in ("id", "version", "businessSha256")}
                    record_id, kind = row["id"], "review"
                elif command == "close":
                    row = self.db.execute("SELECT body_json FROM ops_reviews WHERE program_id=? AND id=?", (program_id, data.get("reviewId"))).fetchone()
                    if not row:
                        domain.fail("Select the retained review being closed.")
                    review = json.loads(row[0])
                    if review["businessSha256"] != data.get("expectedReviewSha256") or review["businessSha256"] != digest(self._business(context)):
                        domain.fail("The case changed after that review. Review its current results before closing.", "REVIEW_CONFLICT", 409)
                    before, after = {"state": program["state"]}, {"state": "CLOSED", "reviewId": review["id"]}
                    self.db.execute("UPDATE ops_programs SET state='CLOSED' WHERE id=?", (program_id,))
                else:
                    if program["state"] != "CLOSED":
                        domain.fail("This operations case is already open.")
                    before, after = {"state": "CLOSED"}, {"state": "OPEN"}
                    self.db.execute("UPDATE ops_programs SET state='OPEN' WHERE id=?", (program_id,))
            else:
                bits = command.split(".")
                names = {"contributor": "contributors", "work": "work", "invoice": "invoices", "cash": "cash",
                         "award": "awards", "deployment": "deployments", "purchase": "purchases", "outcome": "outcomes"}
                if len(bits) != 2 or bits[0] not in names:
                    domain.fail("Unknown operations command.")
                kind, verb = names[bits[0]], bits[1]
                record_id = data.get("id")
                if record_id:
                    record_id = identifier(record_id, domain.PREFIX[kind])
                    before = self._record(program_id, kind, record_id)
                if verb in ("save", "record", "observe"):
                    valid = {"contributors": "save", "work": "save", "invoices": "save", "cash": "record",
                             "awards": "save", "deployments": "save", "purchases": "record", "outcomes": "save"}
                    if verb != valid[kind] and not (kind == "purchases" and verb == "observe" and before):
                        domain.fail("This record uses another lifecycle action.")
                    if not before and self.db.execute("SELECT COUNT(*) FROM ops_records WHERE program_id=?", (program_id,)).fetchone()[0] >= MAX_RECORDS:
                        domain.fail("This operations case has reached its retained-record bound.", status=413)
                    if kind == "purchases" and before and (verb != "observe" or not note):
                        domain.fail("Use purchase.observe with a reason to retain a later source observation.")
                    values = domain.prepare(kind, data, context, before)
                    record_id = record_id or generated(domain.PREFIX[kind])
                    after = {**values, "id": record_id, "version": next_version,
                             "createdAt": before["createdAt"] if before else now(), "updatedAt": now(),
                             "recordedBy": actor}
                else:
                    if not before or not note:
                        domain.fail("Select a retained record and record the reason for this transition.")
                    transitions = {
                        "work": {"submit": ({"LOGGED"}, "SUBMITTED"), "accept": ({"SUBMITTED"}, "ACCEPTED"),
                                 "reopen": ({"SUBMITTED", "ACCEPTED"}, "LOGGED"), "void": ({"LOGGED", "SUBMITTED", "ACCEPTED"}, "VOID")},
                        "invoices": {"review": ({"RECEIVED"}, "REVIEWED"), "dispute": ({"RECEIVED", "REVIEWED"}, "DISPUTED"),
                                     "reopen": ({"REVIEWED", "DISPUTED", "VOID"}, "RECEIVED"), "void": ({"RECEIVED", "REVIEWED", "DISPUTED"}, "VOID")},
                        "cash": {"void": ({"OBSERVED"}, "VOID")},
                        "purchases": {"void": ({"RECORDED"}, "VOID")}}
                    transition = transitions.get(kind, {}).get(verb)
                    if not transition or before["state"] not in transition[0]:
                        domain.fail("That action is not available from the retained record state.")
                    after = {**before, "state": transition[1], "version": next_version, "updatedAt": now(),
                             "reviewedBy": actor, "reviewNote": note}
                self._save(program_id, kind, after)
            self.db.execute("UPDATE ops_programs SET version=?,updated_at=? WHERE id=?", (next_version, now(), program_id))
            self._event(program_id, next_version, {**body, "actor": actor, "note": note}, command, before, after, kind, record_id,
                        source_change=source_change)
            return {"id": program_id, "version": next_version, "action": command, "kind": kind, "recordId": record_id,
                    **extra_receipt, **({"businessSha256": after["businessSha256"]} if command == "review" else {})}
        return self.workspace._transaction(body.get("requestId"), payload, action)


    def _cohort_history(self, program_id):
        events = [json.loads(row[0]) for row in self.db.execute(
            "SELECT body_json FROM ops_events WHERE program_id=? ORDER BY version", (program_id,))]
        return cohort.history_from_events(events)

    def _cohort_reviews(self, program_id, selected):
        if not isinstance(selected, list) or len(selected) > 20 or any(not isinstance(x, str) for x in selected) or len(selected) != len(set(selected)):
            domain.fail("Select at most twenty distinct original cohort reviews.", "INVALID_COHORT")
        result = []
        for ident in selected:
            review = self.review(program_id, ident)
            cohort.validate_review(review)
            result.append(review)
        return result

    def seed_cohort(self, program_id, body):
        with self.workspace.mutex:
            context = self._completion_context(program_id, body, ("tranche",))
            return cohort.seed(context, body.get("tranche"))

    def preview_cohort(self, program_id, body):
        with self.workspace.mutex:
            context = self._completion_context(program_id, body, ("inputs",))
            return cohort.preview(context, body.get("inputs"), self._cohort_history(context["program"]["id"]))

    def export_cohort(self, program_id, review_id):
        with self.workspace.mutex:
            review = self.review(program_id, review_id)
            return cohort.review_files(review, lambda source_id: self.source(program_id, source_id))

    def _implementation_reviews(self, program_id, selected):
        if not isinstance(selected, list) or len(selected) > 20 or any(not isinstance(x, str) for x in selected) or len(selected) != len(set(selected)):
            implementation.fail("Select at most twenty distinct original implementation reviews.")
        result = []
        for ident in selected:
            review = self.review(program_id, ident)
            implementation.verify_review(review, lambda source_id: self.source(program_id, source_id))
            result.append(review)
        return result

    def seed_implementation(self, program_id, body):
        with self.workspace.mutex:
            context = deepcopy(self._completion_context(program_id, body, ("sourceId", "asOfAt")))
            metadata, raw = self.source(program_id, body.get("sourceId"))
        native = implementation.inspect(raw, body.get("asOfAt") or implementation.utc_now())
        return implementation.seed(context, metadata, native)

    def preview_implementation(self, program_id, body):
        with self.workspace.mutex:
            context = deepcopy(self._completion_context(program_id, body, ("inputs",)))
            supplied = body.get("inputs")
            if not isinstance(supplied, dict):
                implementation.fail("Use the selected original implementation inputs.")
            metadata, raw = self.source(program_id, supplied.get("sourceId"))
            selected = implementation.select_installations(installations.load(self, program_id),
                                                           supplied.get("installationRefs", []))
        native = implementation.inspect(raw, supplied.get("asOfAt"))
        return implementation.evaluate(context, native, supplied, selected)

    def export_implementation(self, program_id, review_id):
        with self.workspace.mutex:
            review = self.review(program_id, review_id)
            return implementation.review_files(review, lambda source_id: self.source(program_id, source_id))

    def implementation_original(self, program_id, source_id, sha256):
        domain.sha(sha256, "Original implementation file SHA-256", False)
        metadata, raw = self.source(program_id, source_id)
        originals = implementation.original_files(raw)
        if sha256 not in originals:
            implementation.fail("This file is not in the selected original implementation.", "IMPLEMENTATION_FILE_NOT_FOUND", 404)
        _, state, _ = implementation.original_state(raw)
        material = next((row for row in state.get("materials", []) if row.get("sha256") == sha256), None)
        return {"filename": material["name"] if material else "original-" + sha256,
                "sha256": sha256, "bytes": len(originals[sha256]), "sourceId": metadata["id"]}, originals[sha256]

    def completion_calendar(self, program_id, as_of=None):
        with self.workspace.mutex:
            return completion.dashboard(self._context(identifier(program_id, "operation")), as_of)

    def _completion_context(self, program_id, body, keys):
        completion.object_value(body, ("expectedVersion", *keys), "completion operation")
        expected = domain.integer(body.get("expectedVersion"), "Reviewed operations version", 1, 10000000)
        context = self._context(identifier(program_id, "operation"))
        if context["program"]["version"] != expected:
            domain.fail("The original case changed. Reopen it before continuing.", "OPERATIONS_CONFLICT", 409)
        return context

    def seed_completion(self, program_id, body):
        with self.workspace.mutex:
            return completion.seed(self._completion_context(program_id, body, ("tranche",)), body.get("tranche"))

    def preview_completion(self, program_id, body):
        with self.workspace.mutex:
            context = self._completion_context(program_id, body, ("receiptId", "asOfDate", "summary", "cohortReviewIds", "implementationReviewIds"))
            reviews = self._cohort_reviews(program_id, body["cohortReviewIds"]) if "cohortReviewIds" in body else None
            evidence = self._implementation_reviews(program_id, body["implementationReviewIds"]) if "implementationReviewIds" in body else None
            return completion.preview(context, {key: value for key, value in body.items() if key != "expectedVersion"},
                                      reviews, self._cohort_history(program_id) if reviews is not None else None, evidence)

    def export_completion(self, program_id, review_id):
        with self.workspace.mutex:
            review = self.review(program_id, review_id)
            return completion.review_files(review, lambda source_id: self.source(program_id, source_id))

    def preview_buyer(self, program_id, body):
        with self.workspace.mutex:
            context = deepcopy(self._context(identifier(program_id, "operation")))
        return buyer.preview(context, body)

    def preview_support(self, program_id, body):
        with self.workspace.mutex:
            context = deepcopy(self._context(identifier(program_id, "operation")))
        return support.preview(context, body)

    def preview_forecast(self, program_id, body):
        if not isinstance(body, dict) or set(body) - {"expectedVersion", "inputs"}:
            domain.fail("Use the declared forecast preview object.", "INVALID_FORECAST")
        expected = domain.integer(body.get("expectedVersion"), "Reviewed operations version", 1, 10000000)
        with self.workspace.mutex:
            context = self._context(identifier(program_id, "operation"))
            if context["program"]["version"] != expected:
                domain.fail("The original case changed. Reopen it before previewing.", "OPERATIONS_CONFLICT", 409)
            return forecasts.preview(context, body.get("inputs"))

    def list_forecasts(self, program_id):
        with self.workspace.mutex:
            self._program(identifier(program_id, "operation"))
            return [forecasts.summary(json.loads(row[0])) for row in self.db.execute(
                "SELECT body_json FROM ops_forecasts WHERE program_id=? ORDER BY rowid DESC", (program_id,))]

    def forecast(self, program_id, forecast_id):
        with self.workspace.mutex:
            context = self._context(identifier(program_id, "operation"))
            row = self.db.execute("SELECT body_json FROM ops_forecasts WHERE program_id=? AND id=?",
                                 (program_id, identifier(forecast_id, "forecast"))).fetchone()
            if not row:
                domain.fail("The original saved forecast is unavailable.", "FORECAST_NOT_FOUND", 404)
            value = json.loads(row[0])
            if digest({key: item for key, item in value.items() if key != "sha256"}) != value.get("sha256"):
                domain.fail("The original saved forecast differs from its retained identity.", "FORECAST_CHANGED", 409)
            current = forecasts.source_identity(context)
            return {**value, "current": {"programId": program_id, "version": current["version"],
                    "businessSha256": current["businessSha256"],
                    "sourceChanged": current["factsSha256"] != value["source"]["factsSha256"],
                    "retainedOriginalProgramId": value["source"]["programId"]}}

    def export_forecast(self, program_id, forecast_id):
        value = self.forecast(program_id, forecast_id)
        value.pop("current")
        return forecasts.export(value)

    def _portfolio_forecast(self, program_id, forecast_id):
        row = self.db.execute("SELECT body_json FROM ops_forecasts WHERE program_id=? AND id=?",
            (program_id, identifier(forecast_id, "forecast"))).fetchone()
        if not row:
            domain.fail("Select an immutable forecast from this original case.", "FORECAST_NOT_FOUND", 404)
        return json.loads(row[0])

    def _portfolio_context(self, program_id, expected):
        expected = domain.integer(expected, "Reviewed operations version", 1, 10000000)
        context = self._context(identifier(program_id, "operation"))
        if context["program"]["version"] != expected:
            domain.fail("The original case changed. Reopen it before allocating work.", "OPERATIONS_CONFLICT", 409)
        return context

    def seed_portfolio(self, program_id, body):
        if not isinstance(body, dict) or set(body) - {"expectedVersion", "forecastId"}:
            domain.fail("Use the declared portfolio seed object.", "INVALID_PORTFOLIO")
        with self.workspace.mutex:
            context = self._portfolio_context(program_id, body.get("expectedVersion"))
            return portfolios.seed(context, self._portfolio_forecast(program_id, body.get("forecastId")))

    def preview_portfolio(self, program_id, body):
        if not isinstance(body, dict) or set(body) - {"expectedVersion", "inputs"} or not isinstance(body.get("inputs"), dict):
            domain.fail("Use the declared portfolio preview object.", "INVALID_PORTFOLIO")
        with self.workspace.mutex:
            context = self._portfolio_context(program_id, body.get("expectedVersion"))
            saved = self._portfolio_forecast(program_id, body["inputs"].get("forecastId"))
            return portfolios.preview(context, saved, body["inputs"])

    def list_portfolios(self, program_id):
        with self.workspace.mutex:
            self._program(identifier(program_id, "operation"))
            return [portfolios.summary(json.loads(row[0])) for row in self.db.execute(
                "SELECT body_json FROM ops_portfolios WHERE program_id=? ORDER BY rowid DESC", (program_id,))]

    def portfolio(self, program_id, portfolio_id):
        with self.workspace.mutex:
            context = self._context(identifier(program_id, "operation"))
            row = self.db.execute("SELECT body_json FROM ops_portfolios WHERE program_id=? AND id=?",
                (program_id, identifier(portfolio_id, "portfolio"))).fetchone()
            if not row:
                domain.fail("The saved portfolio is unavailable.", "PORTFOLIO_NOT_FOUND", 404)
            value = json.loads(row[0])
            if digest({key: item for key, item in value.items() if key != "sha256"}) != value.get("sha256"):
                domain.fail("The saved portfolio differs from its retained identity.", "PORTFOLIO_CHANGED", 409)
            current = forecasts.source_identity(context)
            return {**value, "current": {"programId": program_id, "version": current["version"],
                    "sourceChanged": current["factsSha256"] != value["source"]["factsSha256"],
                    "retainedOriginalProgramId": value["source"]["programId"]}}

    def export_portfolio(self, program_id, portfolio_id):
        value = self.portfolio(program_id, portfolio_id)
        value.pop("current")
        return portfolios.export(value)

    def select_portfolio(self, program_id, body):
        if not isinstance(body, dict) or set(body) - {"expectedVersion", "portfolioId", "alternativeId"}:
            domain.fail("Use the declared portfolio selection object.", "INVALID_PORTFOLIO")
        with self.workspace.mutex:
            context = self._portfolio_context(program_id, body.get("expectedVersion"))
            value = self.portfolio(program_id, body.get("portfolioId"))
            value.pop("current")
            return portfolios.select(context, value, short_id(body.get("alternativeId"), "Alternative ID"))

    def installation_workflows(self, program_id, body):
        from operations_installation_workflows import inventory
        with self._snapshot():
            context = self._context(identifier(program_id, "operation"))
            return inventory(self, context, body)

    def seed_workflow_installation(self, program_id, body):
        from operations_installation_workflows import seed
        with self._snapshot():
            context = self._context(identifier(program_id, "operation"))
            return seed(self, context, body)

    def seed_installation(self, program_id, body):
        installations.object_value(body, ("expectedVersion",), "installation seed")
        with self._snapshot():
            context = self._context(identifier(program_id, "operation"))
            installations._current(context, body.get("expectedVersion"))
            return {"document": installations.seed(context), "source": installations._source(context)}

    def preview_installation(self, program_id, body):
        with self._snapshot():
            context = self._context(identifier(program_id, "operation"))
            return installations.preview(self, context, body)

    def list_installations(self, program_id):
        with self._snapshot():
            self._program(identifier(program_id, "operation"))
            return installations.latest_summaries(installations.load(self, program_id))

    def installation(self, program_id, installation_id, revision=None):
        with self._snapshot():
            context = self._context(identifier(program_id, "operation"))
            return installations.show(self, context, installation_id, revision)

    def installation_history(self, program_id, installation_id, before=None, limit=25):
        with self._snapshot():
            self._program(identifier(program_id, "operation"))
            return installations.history(self, program_id, installation_id, before, limit)

    def export_installation(self, program_id, installation_id, revision):
        return self.export(program_id, installation_id=installation_id, installation_revision=revision)

    def history(self, program_id, after=0, limit=100):
        domain.integer(after, "History cursor", 0, 10000000)
        domain.integer(limit, "History page size", 1, 200)
        with self.workspace.mutex:
            program, _ = self._program(program_id)
            values = [json.loads(row[0]) for row in self.db.execute(
                "SELECT body_json FROM ops_events WHERE program_id=? AND version>? ORDER BY version LIMIT ?",
                (program_id, after, limit))]
            cursor = values[-1]["version"] if values else after
            return {"events": values, "nextAfter": cursor if cursor < program["version"] else None, "currentVersion": program["version"]}

    def review(self, program_id, review_id):
        with self.workspace.mutex:
            self._program(program_id)
            row = self.db.execute("SELECT body_json FROM ops_reviews WHERE program_id=? AND id=?", (program_id, review_id)).fetchone()
            if not row:
                domain.fail("The original frozen review is unavailable.", "REVIEW_NOT_FOUND", 404)
            return json.loads(row[0])

    def source(self, program_id, source_id):
        with self.workspace.mutex:
            self._program(program_id)
            row = self.db.execute("SELECT metadata_json,content FROM ops_sources WHERE program_id=? AND id=?", (program_id, source_id)).fetchone()
            if not row:
                domain.fail("Original operations source not found.", "SOURCE_NOT_FOUND", 404)
            metadata, raw = json.loads(row[0]), bytes(row[1])
            if len(raw) != metadata["bytes"] or hashlib.sha256(raw).hexdigest() != metadata["sha256"]:
                domain.fail("The retained original source differs from its stored identity.", "SOURCE_CHANGED", 409)
            return metadata, raw

    @contextmanager
    def _snapshot(self):
        """Borrow the original connection and retain one aggregate read view."""
        with self.workspace.mutex:
            own = not self.db.in_transaction
            if own:
                self.db.execute("BEGIN")
            try:
                yield
            finally:
                if own:
                    self.db.execute("ROLLBACK")

    def export(self, program_id, installation_id=None, installation_revision=None):
        with self._snapshot():
            context = self._context(program_id)
            program = context["program"]
            reviews = [json.loads(row[0]) for row in self.db.execute("SELECT body_json FROM ops_reviews WHERE program_id=? ORDER BY rowid", (program_id,))]
            events = [json.loads(row[0]) for row in self.db.execute("SELECT body_json FROM ops_events WHERE program_id=? ORDER BY version", (program_id,))]
            original = self.workspace.export(program["planId"])
            saved_forecasts = [json.loads(row[0]) for row in self.db.execute(
                "SELECT body_json FROM ops_forecasts WHERE program_id=? ORDER BY rowid", (program_id,))]
            saved_portfolios = [json.loads(row[0]) for row in self.db.execute(
                "SELECT body_json FROM ops_portfolios WHERE program_id=? ORDER BY rowid", (program_id,))]
            saved_installations = installations.load(self, program_id)
            document = {"schema": SCHEMA, "exportedAt": now(), **context, "sources": list(context["sources"].values()),
                        "reviews": reviews, "events": events, "forecasts": saved_forecasts, "portfolios": saved_portfolios}
            if saved_installations:
                document["installations"] = saved_installations
            report = domain.report(**context)
            files = {"planning.zip": original,
                     "operations.json": (canonical(document) + "\n").encode(),
                     "summary.json": (canonical(report) + "\n").encode(),
                     "completion-calendar.json": (canonical(completion.dashboard(context)) + "\n").encode(),
                     "recorded-cash.csv": csv_bytes(["id", "state", "date", "direction", "category", "currency", "network", "asset", "amount", "usdValue", "externalRef", "sourceBasis"], context["records"]["cash"]),
                     "invoice-balances.csv": csv_bytes(["id", "number", "state", "totalUsd", "paidUsd", "openUsd", "overpaidUsd", "dueDate"], report["invoices"]),
                     "recorded-work.csv": csv_bytes(["id", "state", "contributorId", "costId", "description", "startDate", "endDate", "hours", "fundingBasis", "sourceBasis"], context["records"]["work"]),
                     "plan-versus-actual.csv": csv_bytes(["id", "tranche", "plannedUsd", "plannedHours", "recordedHours", "acceptedHours", "preawardHours", "invoicedUsd", "paidUsd", "invoiceVarianceUsd"], report["packages"]),
                     "README.txt": ("SF47 delivery and cash operations\n\nMode: " + program["mode"] + "\n"
                         "Open through the existing workspace's operations import. This bundle preserves the original planner history, selected immutable plan, recorded source attachments, operations events, close reviews complete saved operating forecasts and delivery allocation portfolios.\n"
                         "Conditional planning amounts are separate from recorded cash. Testnet purchases are product operations. A work review or case close does not create an award, payment, customer agreement or external tranche acceptance.\n"
                         "Private access keys are not included.\n").encode()}
            for metadata in context["sources"].values():
                _, raw = self.source(program_id, metadata["id"])
                files["sources/" + metadata["id"]] = raw
            if installation_id is not None or installation_revision is not None:
                files.update(installations.selected_files(context, saved_installations, installation_id, installation_revision, files))
        if sum(len(raw) for raw in files.values()) > MAX_BUNDLE:
            domain.fail("The complete operations bundle exceeds 32 MiB.", status=413)
        manifest = {"schema": SCHEMA + ".bundle", "files": [{"path": name, "bytes": len(raw),
                    "sha256": hashlib.sha256(raw).hexdigest()} for name, raw in sorted(files.items())]}
        files["MANIFEST.json"] = (canonical(manifest) + "\n").encode()
        if sum(len(raw) for raw in files.values()) > MAX_BUNDLE:
            domain.fail("The complete operations bundle including its manifest exceeds 32 MiB.", status=413)
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for name, raw in sorted(files.items()):
                info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
                info.external_attr = 0o600 << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, raw)
        raw = output.getvalue()
        if len(raw) > MAX_BUNDLE:
            domain.fail("The compressed complete operations bundle exceeds 32 MiB.", status=413)
        return raw

    @staticmethod
    def _unpack(raw):
        if not isinstance(raw, bytes) or len(raw) > MAX_BUNDLE:
            domain.fail("Use a complete operations ZIP up to 32 MiB.", status=413)
        try:
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                infos = archive.infolist()
                names = [row.filename for row in infos]
                if len(names) != len(set(names)) or len(names) > 220 or sum(row.file_size for row in infos) > MAX_BUNDLE:
                    domain.fail("The operations bundle has duplicate, excessive or oversized entries.")
                manifest = json.loads(archive.read("MANIFEST.json"))
                if manifest.get("schema") != SCHEMA + ".bundle":
                    domain.fail("Select a complete SF47 operations export.")
                descriptors = manifest.get("files", [])
                if not isinstance(descriptors, list) or len(descriptors) != len(names) - 1 or {row["path"] for row in descriptors} != set(names) - {"MANIFEST.json"}:
                    domain.fail("The operations manifest does not name its exact payload.")
                files = {}
                for item in descriptors:
                    content = archive.read(item["path"])
                    if len(content) != item["bytes"] or hashlib.sha256(content).hexdigest() != item["sha256"]:
                        domain.fail("An operations bundle member differs from its retained identity.")
                    files[item["path"]] = content
        except (zipfile.BadZipFile, KeyError, TypeError, ValueError, RuntimeError) as exc:
            if isinstance(exc, Problem):
                raise
            raise Problem("The complete operations ZIP is unreadable.", 422, "INVALID_BUNDLE") from exc
        document = json.loads(files["operations.json"])
        if document.get("schema") != SCHEMA:
            domain.fail("The operations document uses an unsupported schema.")
        source_ids = {row["id"] for row in document["sources"]}
        expected = {"planning.zip", "operations.json", "summary.json", "recorded-cash.csv", "invoice-balances.csv",
                    "recorded-work.csv", "plan-versus-actual.csv", "README.txt"} | {"sources/" + ident for ident in source_ids}
        # This derived view was added with Completion; older complete cases omit it.
        # Original completion plans and source records retain their native validation below.
        if "completion-calendar.json" in files:
            expected.add("completion-calendar.json")
        selected_names = {"installation-selection.json", "installation.html"}
        if selected_names.intersection(files):
            expected.update(selected_names)
        if set(files) != expected or len(source_ids) != len(document["sources"]):
            domain.fail("The operations source set is not exact.")
        for item in document["sources"]:
            identifier(item["id"], "source")
            filename = text(item.get("filename"), "Original source filename", 240, True)
            if "/" in filename or "\\" in filename or filename in (".", "..") or any(ord(char) < 32 for char in filename):
                domain.fail("Use a plain retained original filename.")
            domain.url(item.get("sourceUrl"), "Original source URL")
            domain.timestamp(item.get("observedAt"), "Original source observation")
            domain.timestamp(item.get("createdAt"), "Original source capture")
            domain.enum(item.get("kind"), ("invoice", "work", "grant", "payment", "deployment", "purchase", "other"), "Source kind")
            if not re.fullmatch(r"[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+", item.get("mediaType", "")):
                domain.fail("Use a plain source media type.")
            content = files["sources/" + item["id"]]
            if len(content) != item["bytes"] or hashlib.sha256(content).hexdigest() != item["sha256"] or len(content) > MAX_SOURCE:
                domain.fail("An original attachment differs from its source record.")
        installations.selection_from_files(document, files)
        return document, files

    def import_bundle(self, raw, name, request_id, actor):
        name = text(name, "Imported operations case name", 300, True)
        actor = text(actor, "Receiving operator", 300, True)
        request_id = short_id(request_id, "Request ID")
        original_payload = {"domain": SCHEMA, "action": "import", "sha256": hashlib.sha256(raw).hexdigest(),
                            "name": name, "actor": actor}
        # A committed original import is recoverable even if its earlier reader
        # release is not installed now. Changed bytes keep the existing conflict.
        with self.workspace.mutex:
            existing = self.db.execute("SELECT fingerprint,result_json FROM requests WHERE request_id=?",
                                       (request_id,)).fetchone()
            if existing:
                if existing[0] != digest(original_payload):
                    raise Problem("This request identity already describes a different operation.", 409, "REQUEST_CONFLICT")
                return json.loads(existing[1])
        document, files = self._unpack(raw)
        source_program, plan = document["program"], document["plan"]
        if not isinstance(source_program, dict) or not isinstance(plan, dict):
            domain.fail("The retained operations program and plan must be objects.")
        identifier(source_program.get("id"), "operation")
        identifier(source_program.get("planId"), "plan")
        domain.timestamp(source_program.get("createdAt"), "Original case creation")
        domain.integer(source_program.get("version"), "Retained case version", 1, 10000000)
        if source_program["mode"] not in ("OPERATIONS", "WALKTHROUGH") or source_program["state"] not in ("OPEN", "CLOSED"):
            domain.fail("The retained case purpose or state is invalid.")
        if digest({"scenario": plan["scenario"], "planning": plan["planning"]}) != plan["contentSha256"]:
            domain.fail("The pinned plan content identity differs.")
        if not isinstance(document["records"], dict) or set(document["records"]) != set(domain.KINDS):
            domain.fail("The operations record collections are incomplete.")
        if sum(len(values) for values in document["records"].values()) > MAX_RECORDS:
            domain.fail("The operations bundle has too many records.")
        sources = {row["id"]: row for row in document["sources"]}
        if sum(row["bytes"] for row in sources.values()) > MAX_SOURCES_TOTAL:
            domain.fail("The original attachment total exceeds its supported bound.", status=413)
        context = {"program": source_program, "plan": plan, "records": document["records"], "sources": sources,
                   "restoring": True, "completionPlans": document.get("completionPlans", [])}
        for kind, values in document["records"].items():
            seen = set()
            for row in values:
                identifier(row["id"], domain.PREFIX[kind])
                if row["id"] in seen or row["state"] not in STATES[kind]:
                    domain.fail("The imported record identity or state is invalid.")
                seen.add(row["id"])
                domain.integer(row["version"], "Record version", 1, source_program["version"])
                prepared = domain.prepare(kind, row, context, row)
                for key, value in prepared.items():
                    if key != "state" and row.get(key) != value:
                        domain.fail("A retained record differs from its normalized source: " + row["id"])
        events = document["events"]
        if not isinstance(events, list) or len(events) != source_program["version"]:
            domain.fail("The operations event history is incomplete.")
        for sequence, event in enumerate(events, 1):
            body = {key: value for key, value in event.items() if key != "sha256"}
            if event.get("version") != sequence or digest(body) != event.get("sha256"):
                domain.fail("An operations event differs from its retained identity.")
        reviews = document.get("reviews")
        if not isinstance(reviews, list) or len(reviews) > source_program["version"]:
            domain.fail("The retained frozen reviews are incomplete or excessive.")
        review_ids = set()
        for review in reviews:
            if not isinstance(review, dict):
                domain.fail("Each retained review must be an object.")
            review_id = identifier(review.get("id"), "review")
            if review_id in review_ids:
                domain.fail("The operations bundle repeats a frozen review identity.")
            review_ids.add(review_id)
            domain.integer(review.get("version"), "Original review version", 1, source_program["version"])
            domain.timestamp(review.get("createdAt"), "Original review creation")
            text(review.get("actor"), "Original reviewing operator", 300, True)
            text(review.get("note"), "Original review note", 12000, True)
            domain.sha(review.get("businessSha256"), "Original review digest", False)
            if not isinstance(review.get("snapshot"), dict) or not isinstance(review.get("report"), dict):
                domain.fail("The complete original review snapshot and report are required.")
            if digest(review["snapshot"]) != review["businessSha256"]:
                domain.fail("A frozen review differs from its retained business snapshot.")
        cohort.validate_import(reviews, events)
        completion.validate_import(context, document.get("completionPlans", []), reviews, events, source_program["version"])
        saved_installations = document.get("installations", [])
        installations.validate_import(context, saved_installations, events, source_program["version"], files)
        implementation.validate_import(context, reviews, events, saved_installations, files)
        refs = installations.latest_refs(saved_installations)
        if document.get("installationRefs", []) != refs:
            domain.fail("The selected installation heads differ from their complete retained editions.")
        selected_installation = installations.selection_from_files(document, files)
        saved_forecasts = document.get("forecasts", [])
        if not isinstance(saved_forecasts, list) or len(saved_forecasts) > forecasts.MAX_FORECASTS:
            domain.fail("The complete retained forecast set is invalid.", "INVALID_FORECAST")
        forecast_ids = set()
        for value in saved_forecasts:
            forecasts.validate_saved(value, plan)
            fid = identifier(value["id"], "forecast")
            if fid in forecast_ids:
                domain.fail("The operations bundle repeats a saved forecast.", "INVALID_FORECAST")
            forecast_ids.add(fid)
            version = domain.integer(value.get("version"), "Forecast save version", 2, source_program["version"])
            event = events[version - 1]
            if (event.get("action") != "forecast.save" or event.get("recordId") != fid
                    or event.get("after", {}).get("sha256") != value["sha256"]
                    or value["source"]["version"] != version - 1):
                domain.fail("The saved forecast does not join its original save event.", "FORECAST_SOURCE_CONFLICT", 409)
        if {row.get("recordId") for row in events if row.get("action") == "forecast.save"} != forecast_ids:
            domain.fail("The complete operations history is missing a saved forecast.", "INVALID_FORECAST")
        saved_portfolios = document.get("portfolios", [])
        if not isinstance(saved_portfolios, list) or len(saved_portfolios) > portfolios.MAX_PORTFOLIOS:
            domain.fail("The retained portfolio set is invalid.", "INVALID_PORTFOLIO")
        portfolio_ids, original_forecasts = set(), {row["id"]: row for row in saved_forecasts}
        for value in saved_portfolios:
            portfolios.validate_saved(value, plan)
            ident = identifier(value["id"], "portfolio")
            if ident in portfolio_ids:
                domain.fail("The operations bundle repeats a saved portfolio.", "INVALID_PORTFOLIO")
            portfolio_ids.add(ident)
            version = domain.integer(value.get("version"), "Portfolio save version", 2, source_program["version"])
            event = events[version - 1]
            base = original_forecasts.get(value["baseForecast"]["id"])
            if (event.get("action") != "portfolio.save" or event.get("recordId") != ident
                    or event.get("after", {}).get("sha256") != value["sha256"]
                    or value["source"]["version"] != version - 1
                    or not base or base != value["baseForecastSnapshot"]):
                domain.fail("The portfolio does not join its original forecast and save event.", "PORTFOLIO_SOURCE_CONFLICT", 409)
        if {row.get("recordId") for row in events if row.get("action") == "portfolio.save"} != portfolio_ids:
            domain.fail("The complete operations history is missing a saved portfolio.", "INVALID_PORTFOLIO")
        payload = {"domain": SCHEMA, "action": "import", "sha256": hashlib.sha256(raw).hexdigest(),
                   "name": name, "actor": actor}
        request_id = short_id(request_id, "Request ID")
        # The original planner remains the sole archive validator/importer.
        # Check this join before its first mutation, then let it validate every
        # native member and recalculate each retained planning revision.
        try:
            with zipfile.ZipFile(io.BytesIO(files["planning.zip"])) as archive:
                infos = archive.infolist()
                if len(infos) > 20 or sum(item.file_size for item in infos) > MAX_BUNDLE:
                    domain.fail("The retained original planning archive exceeds its bound.")
                original_document = json.loads(archive.read("workspace.json"))
            original_plan = original_document["plan"]
            original_revision = next((item for item in original_document["revisions"]
                                      if item.get("revision") == plan["revision"]), None)
            if (original_plan["id"] != plan["id"]
                    or source_program["planId"] != plan["id"]
                    or source_program["planRevision"] != plan["revision"]
                    or original_plan["source"] != plan["source"]
                    or not original_revision
                    or any(original_revision.get(key) != plan.get(key) for key in
                           ("scenario", "planning", "report", "savedAt", "note", "contentSha256"))):
                domain.fail("The original planning archive does not match the pinned operations revision.")
        except (zipfile.BadZipFile, KeyError, TypeError, ValueError, RuntimeError) as exc:
            if isinstance(exc, Problem):
                raise
            raise Problem("The retained original planning join is unreadable.", 422, "INVALID_BUNDLE") from exc
        suffix = " — retained plan"
        native_name = name[:200 - len(suffix)] + suffix
        plan_receipt = "ops-plan-import-" + digest({"operationsRequestId": request_id, **payload})[:64]
        def action():
            pid, stamp = generated("operation"), now()
            origin = {"programId": source_program["id"], "planId": source_program["planId"],
                      "archiveSha256": hashlib.sha256(raw).hexdigest(), "importedAt": stamp, "importedBy": actor}
            self.db.execute("INSERT INTO ops_programs VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                (pid, imported["id"], plan["revision"], source_program["version"], source_program["state"],
                 name, source_program["mode"], source_program.get("calendarStart"), canonical(pinned),
                 source_program["createdAt"], stamp, canonical(origin)))
            for kind, values in document["records"].items():
                for row in values:
                    self._save(pid, kind, row)
            for metadata in document["sources"]:
                self.db.execute("INSERT INTO ops_sources VALUES(?,?,?,?)",
                    (pid, metadata["id"], canonical(metadata), files["sources/" + metadata["id"]]))
            for event in events:
                self.db.execute("INSERT INTO ops_events VALUES(?,?,?)", (pid, event["version"], canonical(event)))
            for review in document["reviews"]:
                self.db.execute("INSERT INTO ops_reviews VALUES(?,?,?)", (pid, review["id"], canonical(review)))
            for value in document.get("completionPlans", []):
                completion.save_row(self, pid, value)
            for value in saved_installations:
                self.db.execute("INSERT INTO ops_installations VALUES(?,?,?,?)",
                                (pid, value["id"], value["revision"], canonical(value)))
            for value in saved_forecasts:
                self.db.execute("INSERT INTO ops_forecasts VALUES(?,?,?)", (pid, value["id"], canonical(value)))
            for value in saved_portfolios:
                self.db.execute("INSERT INTO ops_portfolios VALUES(?,?,?)", (pid, value["id"], canonical(value)))
            return {"id": pid, "version": source_program["version"], "action": "import", "planId": imported["id"], "mode": source_program["mode"],
                    **({"selectedInstallation": selected_installation} if selected_installation else {})}
        with self.workspace.mutex:
            # Reuse the original receipt table before the original plan import.
            # A rejected reuse or invalid request cannot create an extra plan.
            existing = self.db.execute("SELECT fingerprint,result_json FROM requests WHERE request_id=?",
                                       (request_id,)).fetchone()
            if existing:
                if existing[0] != digest(payload):
                    raise Problem("This request identity already describes a different operation.", 409, "REQUEST_CONFLICT")
                return json.loads(existing[1])
            imported = self.workspace.import_bundle(files["planning.zip"], native_name, plan_receipt)
            pinned = self.workspace.read(imported["id"], plan["revision"])
            return self.workspace._transaction(request_id, payload, action)
