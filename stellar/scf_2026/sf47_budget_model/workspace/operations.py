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
import operations_workbook as workbooks
import operations_supplier_statements as supplier_statements
import forecast as forecasts
import portfolio as portfolios
import portfolio_installations as portfolio_installations
import operations_support as support
import operations_buyer as buyer
import operations_settlement as settlement_sources
import operations_completion as completion
import operations_completion_corrections as completion_corrections
import operations_calendar as calendar_model
import operations_agenda as agenda_model
import operations_use_calendar as use_calendar
import operations_cohort as cohort
import operations_installations as installations
import operations_installation_effort as installation_effort
import operations_installation_returns as installation_returns
import operations_company_returns as company_returns
import operations_dispatch as dispatch
import operations_statements as statements
import operations_statement_profiles as statement_profiles
import operations_performance as performance
import operations_ledger_intake as ledger_intake
import operations_payables as payables
import operations_task_outcomes as task_outcomes
import operations_funding as funding
import award_terms
import issuer_receiving
import operations_cash_accounts as cash_accounts
import operations_account_reconciliation as account_reconciliation
import operations_workflows as operating_workflows
import operations_implementation as implementation
import operations_engagements as engagements
import engagement_working
import operations_risks as risks
import operations_risk_comparison as risk_comparison
import engagement_handover
import operations_amendments as amendments
import operations_amendment_calendar as amendment_calendar
import operations_work_intake as work_intake
import operations_commercial_receivables as commercial_receivables
import operations_commercial_changes as commercial_changes
import operations_expenses as expenses
import operations_expense_billing as expense_billing
import operations_work_billing as work_billing
import operations_dcat_sources as dcat_sources

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


def decoded(raw, *, maximum=MAX_SOURCE):
    if not isinstance(raw, str):
        domain.fail("Attachment content must be base64 text.")
    if len(raw) > (maximum + 2) * 4 // 3 + 16:
        domain.fail("The original source attachment exceeds its selected native byte bound.", status=413)
    try:
        value = base64.b64decode(raw, validate=True)
    except Exception as exc:
        raise Problem("The original source encoding is invalid.", 422, "INVALID_SOURCE") from exc
    if not value or len(value) > maximum:
        domain.fail("Attach a nonempty original source within its selected native byte bound.", status=413)
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
            amendments.install(workspace.db)
            work_intake.install(workspace.db)
            expenses.install(workspace.db)
            row = workspace.db.execute("SELECT value FROM ops_metadata WHERE key='schema'").fetchone()
            if row and row[0] != SCHEMA:
                domain.fail("This workspace uses a newer operations schema.", "OPERATIONS_SCHEMA", 409)
            workspace.db.execute("INSERT OR IGNORE INTO ops_metadata VALUES('schema',?)", (SCHEMA,))
            self.commercial = commercial_receivables.CommercialReceivables(self)
            self.commercial_changes = commercial_changes.CommercialChanges(self.commercial)
            self.expense_billing = expense_billing.ExpenseBilling(self)
            self.work_billing = work_billing.WorkBilling(self)

    @property
    def db(self):
        return self.workspace.db

    def _program(self, program_id):
        row = self.db.execute("SELECT id,plan_id,plan_revision,version,state,name,mode,calendar_start,plan_json,created_at,updated_at,origin_json FROM ops_programs WHERE id=?", (program_id,)).fetchone()
        if not row:
            domain.fail("Delivery operations case not found.", "OPERATIONS_NOT_FOUND", 404)
        program = {"id": row[0], "planId": row[1], "planRevision": row[2], "version": row[3], "state": row[4],
                   "name": row[5], "mode": row[6], "calendarStart": row[7], "createdAt": row[9],
                   "updatedAt": row[10], "origin": json.loads(row[11])}
        applied_version = amendments.last_applied_version(self, program_id)
        if applied_version:
            program["lastPlanAmendmentVersion"] = applied_version
        return program, json.loads(row[8])

    def _context(self, program_id):
        program, plan = self._program(program_id)
        records = {key: [] for key in domain.KINDS}
        for kind, raw in self.db.execute("SELECT kind,body_json FROM ops_records WHERE program_id=? ORDER BY kind,id", (program_id,)):
            records[kind].append(json.loads(raw))
        sources = {row["id"]: row for row in (json.loads(raw[0]) for raw in self.db.execute(
            "SELECT metadata_json FROM ops_sources WHERE program_id=? ORDER BY id", (program_id,)))}
        result = {"program": program, "plan": plan, "records": records, "sources": sources,
                  "completionPlans": completion.load_plans(self, program_id)}
        expense_records = expenses.load(self, program_id)
        if expenses.has_records(expense_records):
            result["expenseRecords"] = expense_records
        refs = installations.latest_refs(installations.load_heads(self, program_id))
        if refs:
            result["installationRefs"] = refs
        intake_refs = work_intake.refs(work_intake.load(self, program_id))
        if intake_refs:
            result["workIntakeRefs"] = intake_refs
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
        if context.get("workIntakeRefs"):
            result["workIntakeRefs"] = context["workIntakeRefs"]
        if expenses.has_records(expenses.retained(context)):
            result["expenseRecords"] = context["expenseRecords"]
        return result

    def _read(self, program_id):
        context = self._context(program_id)
        result = {**context, "sources": list(context["sources"].values()),
                  "report": domain.report(**context)}
        result["awardTerms"] = [award_terms.summary(row) for row in award_terms.heads(award_terms.records(self, program_id))]
        result["statementSetups"] = [statement_profiles.summary(row) for row in statement_profiles.records(self, program_id)]
        result["completion"] = completion.dashboard(context)
        result["expenseAttribution"] = expenses.dashboard(context)
        result["amendments"] = [amendments.summary(row, context, digest(self._business(context)))
                                 for row in amendments.heads(amendments.load(self, program_id))]
        cohort_history = self._cohort_history(program_id)
        result["installations"] = installations.latest_summaries(installations.load_heads(self, program_id))
        result["workIntakes"] = [work_intake.summary(row) for row in work_intake.heads(work_intake.load(self, program_id))]
        result["reviews"] = [{**{key: row[key] for key in ("id", "version", "createdAt", "actor", "note", "businessSha256")},
                              "purpose": row.get("purpose"),
                              **(supplier_statements.summary(row) if row.get("purpose") == supplier_statements.PURPOSE else {}),
                              **({"completionTranche": row["completion"]["clock"]["tranche"],
                                  "receiptId": row["completion"]["receipt"]["id"]} if row.get("purpose") == "TRANCHE_COMPLETION" else {}),
                              **(completion_corrections.summary(row) if row.get("purpose") == completion_corrections.PURPOSE else {}),
                              **(cohort.summary(row, context, cohort_history) if row.get("purpose") == "COHORT_EVALUATION" else {}),
                              **(implementation.summary(row, context) if row.get("purpose") == implementation.PURPOSE else {}),
                              **(engagements.summary(row) if row.get("purpose") == engagements.PURPOSE else {}),
                              **(engagements.receiving_summary(row) if row.get("purpose") == engagements.RECEIVING_PURPOSE else {})}
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

    def _source_add(self, program_id, data, *, _maximum=MAX_SOURCE, _dcat=False):
        if ((_dcat and _maximum != dcat_sources.MAX_SOURCE) or
                not _dcat and _maximum not in (MAX_SOURCE, buyer.MAX_CUSTOMER_USE_HANDOFF)):
            domain.fail("Use the supported original source bound.", status=413)
        content = decoded(data.get("contentBase64"), maximum=_maximum)
        if not _dcat and _maximum > MAX_SOURCE:
            if json.loads(content).get("schema") != buyer.CUSTOMER_USE_SCHEMA:
                domain.fail("The larger source bound is reserved for the native customer-use return.", status=413)
        name = text(data.get("filename"), "Original source filename", 240, True)
        if "/" in name or "\\" in name or name in (".", "..") or any(ord(char) < 32 for char in name):
            domain.fail("Use a plain original filename.")
        media = text(data.get("mediaType", "application/octet-stream"), "Source media type", 200, True)
        if not re.fullmatch(r"[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+", media):
            domain.fail("Use a plain MIME media type.")
        retained = [{**json.loads(metadata), "bytes": size} for metadata, size in self.db.execute(
            "SELECT metadata_json,length(content) FROM ops_sources WHERE program_id=?", (program_id,))]
        transport = None
        if _dcat:
            if not name.lower().endswith(".ckanw"):
                domain.fail("Select the complete original .ckanw source filename.")
            expected = domain.sha(data.get("expectedSha256"), "Selected complete DCAT workspace SHA256", False)
            if hashlib.sha256(content).hexdigest() != expected:
                domain.fail("The selected DCAT workspace bytes differ.", "DCAT_SOURCE_CHANGED", 409)
            transport = dcat_sources.inspect(content)
        row = {"id": generated("source"), "filename": name, "mediaType": media,
               "kind": domain.enum(data.get("kind", "other"), ("invoice", "work", "grant", "payment", "deployment", "purchase", "other"), "Source kind"),
               "sourceUrl": domain.url(data.get("sourceUrl", ""), "Original source URL"),
               "observedAt": domain.timestamp(data.get("observedAt") or now(), "Source observation"),
               "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest(), "createdAt": now()}
        if transport is not None:
            row["dcatWorkspace"] = transport
        dcat_sources.source_budget(retained + [row])
        self.db.execute("INSERT INTO ops_sources VALUES(?,?,?,?)", (program_id, row["id"], canonical(row), content))
        return row

    def preview_settlement(self, program_id, body):
        with self._snapshot():
            return settlement_sources.preview(self._context(identifier(program_id, "operation")), body)

    def preview_settlement_correction(self, program_id, body):
        with self._snapshot():
            return settlement_sources.correction_preview(self, self._context(identifier(program_id, "operation")), body)

    def settlements(self, program_id):
        with self._snapshot():
            return settlement_sources.listing(self._context(identifier(program_id, "operation")))

    def settlement(self, program_id, review_id):
        with self._snapshot():
            return settlement_sources.read(self, self._context(identifier(program_id, "operation")), review_id)

    def export_settlement(self, program_id, review_id):
        with self._snapshot():
            return settlement_sources.export_review(self, self._context(identifier(program_id, "operation")), review_id)

    def command(self, program_id, body, *, _within_transaction=False):
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
            elif command == dcat_sources.ACTION:
                after = self._source_add(program_id, data, _maximum=dcat_sources.MAX_SOURCE, _dcat=True)
                kind, record_id = "source", after["id"]
            elif command == statement_profiles.ACTION:
                result = statement_profiles.save(self, context, data, actor, next_version, note)
                before, after, kind, record_id = (result[key] for key in ("before", "after", "kind", "recordId"))
                extra_receipt = {"statementSetup": result["statementSetup"]}
            elif command == "funding.save":
                result = funding.save(self, context, data, actor, next_version, note)
                before, after, kind, record_id = (result[key] for key in ("before", "after", "kind", "recordId"))
                extra_receipt = {"funding": result["funding"]}
            elif command == issuer_receiving.ACTION:
                if not _within_transaction:
                    domain.fail("Use the complete original message receiving action.")
                result = issuer_receiving.bind(self, context, data, actor, next_version, note)
                before, after, kind, record_id = (result[key] for key in ("before", "after", "kind", "recordId"))
                extra_receipt = {"correspondence": result["correspondence"]}
            elif command in award_terms.ACTIONS:
                if command == "award-terms.plan-bind" and not _within_transaction:
                    domain.fail("Use the complete reviewed terms-to-plan commissioning action.")
                result = (award_terms.save if command == "award-terms.save" else award_terms.bind)(
                    self, context, data, actor, next_version, note)
                before, after, kind, record_id = (result[key] for key in ("before", "after", "kind", "recordId"))
                source_change = result.get("sourceChange")
                extra_receipt = {key: value for key, value in result.items()
                                 if key not in ("before", "after", "kind", "recordId", "sourceChange")}
            elif command == risks.ACTION:
                result = risks.save(self, context, data, actor, next_version, note)
                before, after, kind, record_id = (result[key] for key in ("before", "after", "kind", "recordId"))
                extra_receipt = {"reviewSha256": result["reviewSha256"], "riskRegister": result["riskRegister"]}
            elif command == "task-outcomes.save":
                result = task_outcomes.save(self, context, data, actor, next_version, note)
                before, after, kind, record_id = (result[key] for key in ("before", "after", "kind", "recordId"))
                extra_receipt = {"taskOutcomes": result["taskOutcomes"]}
            elif command == "statement.receive":
                context["statementSetups"] = [statement_profiles.summary(row) for row in statement_profiles.records(self, program_id)]
                context["cashCorrections"] = cash_accounts.statement_successors(self, context)
                result = statements.receive(self, context, data, actor, next_version)
                before, after, kind, record_id = (result[key] for key in ("before", "after", "kind", "recordId"))
                source_change = result.get("sourceChange")
                extra_receipt = {key: value for key, value in result.items()
                                 if key not in ("before", "after", "kind", "recordId", "sourceChange")}
                if result["unchanged"]:
                    return {"id": program_id, "version": expected, "action": command, "kind": kind,
                            "recordId": record_id, **extra_receipt}
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
            elif command == supplier_statements.ACTION:
                result = supplier_statements.save(self, context, data, actor, next_version, note)
                before, after, kind, record_id = (result[key] for key in ("before", "after", "kind", "recordId"))
                extra_receipt = {"supplierStatement": result["supplierStatement"]}
            elif command in workbooks.ACTIONS:
                if command == "workbook.record-application" and not _within_transaction:
                    domain.fail("Use the complete reviewed workbook application.")
                result = workbooks.save(self, context, command, data, actor, next_version, note)
                before, after, kind, record_id = (result[key] for key in ("before", "after", "kind", "recordId"))
                source_change = result.get("sourceChange")
                extra_receipt = {"workbook": result["workbook"]}
            elif command in work_intake.ACTIONS:
                result = work_intake.command(self, context, command, data, actor, next_version, note)
                before, after, kind, record_id = (result[key] for key in ("before", "after", "kind", "recordId"))
                source_change = result.get("sourceChange")
                extra_receipt = {key: value for key, value in result.items()
                                 if key not in ("before", "after", "kind", "recordId", "sourceChange")}
                if result["unchanged"]:
                    return {"id": program_id, "version": expected, "action": command, "kind": kind,
                            "recordId": record_id, **extra_receipt}
            elif command in ("settlement.receive", "settlement.correct"):
                handler = settlement_sources.receive if command == "settlement.receive" else settlement_sources.correct
                result = handler(self, context, data, actor, next_version, body.get("requestId"), note)
                before, after, kind, record_id = (result[key] for key in ("before", "after", "kind", "recordId"))
                source_change = result.get("sourceChange")
                extra_receipt = {key: value for key, value in result.items()
                                 if key not in ("before", "after", "kind", "recordId", "sourceChange")}
                if result["unchanged"]:
                    return {"id": program_id, "version": expected, "action": command, "kind": kind,
                            "recordId": record_id, **extra_receipt}
            elif command in expenses.ACTIONS:
                result = (expenses.receive(self, context, data, actor, next_version)
                          if command == "expense.receive"
                          else expenses.attribution_command(self, context, command, data, actor, next_version, note))
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
                if command == "completion.submit" and expenses.record_count(self, program_id) >= MAX_RECORDS:
                    domain.fail("This operations case has reached its retained-record bound.", status=413)
                result = completion.command(self, context, command, data, actor, next_version)
                before, after, kind, record_id = (result[key] for key in ("before", "after", "kind", "recordId"))
                extra_receipt = {key: value for key, value in result.items()
                                 if key not in ("before", "after", "kind", "recordId")}
                if result["unchanged"]:
                    return {"id": program_id, "version": expected, "action": command, "kind": kind,
                            "recordId": record_id, **extra_receipt}
            elif command in ("installation.return", "installation.return-stage"):
                method = installation_returns.record if command == "installation.return" else installation_returns.stage
                result = method(self, context, data, actor, next_version, note)
                before, after, kind, record_id = (result[key] for key in ("before", "after", "kind", "recordId"))
                source_change = result.get("sourceChange")
                extra_receipt = {key: value for key, value in result.items()
                                 if key not in ("before", "after", "kind", "recordId", "sourceChange")}
            elif command == "installation.save":
                result = installations.save(self, context, data, actor, next_version, note)
                before, after, kind, record_id = (result[key] for key in ("before", "after", "kind", "recordId"))
                extra_receipt = {key: value for key, value in result.items()
                                 if key not in ("before", "after", "kind", "recordId")}
            elif command in amendments.ACTIONS:
                result = amendments.command(self, context, command, data, actor, next_version, note)
                before, after, kind, record_id = (result[key] for key in ("before", "after", "kind", "recordId"))
                extra_receipt = {key: value for key, value in result.items()
                                 if key not in ("before", "after", "kind", "recordId")}
            elif command in ("engagement.prepare", "engagement.receiving"):
                if not note:
                    domain.fail("Record the review note for this contributor engagement edition.")
                result = (engagements.prepare if command == "engagement.prepare" else engagement_handover.receive)(
                    self, context, data, actor, next_version, note)
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
                context = portfolio_installations.capture(self, context, data["inputs"])
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
                    if not before and expenses.record_count(self, program_id) >= MAX_RECORDS:
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
            if command == supplier_statements.ACTION or command in workbooks.ACTIONS or command in amendments.ACTIONS or command in award_terms.ACTIONS or command in ("funding.save", risks.ACTION, statement_profiles.ACTION):
                # Reject atomically if these complete decisions would make the
                # original case impossible to hand over through its native limit.
                self.export(program_id)
            return {"id": program_id, "version": next_version, "action": command, "kind": kind, "recordId": record_id,
                    **extra_receipt, **({"businessSha256": after["businessSha256"]} if command == "review" else {})}
        if _within_transaction:
            if not self.db.in_transaction:
                raise RuntimeError("Bulk operations require the original active workspace transaction.")
            return action()
        return self.workspace._transaction(body.get("requestId"), payload, action)


    def operating_workflows(self, program_id, expected_version, allowed_sections=None):
        with self._snapshot():
            return operating_workflows.read_index(
                self, identifier(program_id, "operation"), expected_version, allowed_sections)

    def funding_catalog(self, program_id):
        with self._snapshot():
            context = self._context(identifier(program_id, "operation"))
            return {"catalog": funding.catalog(context),
                    "history": [funding.summary(row) for row in reversed(funding.records(self, program_id))]}

    def seed_funding(self, program_id, body):
        with self._snapshot():
            return funding.seed(self, self._context(identifier(program_id, "operation")), body)

    def preview_funding(self, program_id, body):
        with self._snapshot():
            return funding.preview(self, self._context(identifier(program_id, "operation")), body)

    def funding(self, program_id, revision=None):
        with self._snapshot():
            return funding.get(self, self._context(identifier(program_id, "operation")), revision)

    def funding_request(self, program_id, request_id):
        with self._snapshot():
            return funding.request(self, identifier(program_id, "operation"), request_id)

    def export_funding(self, program_id, revision, expected_version, expected_report_sha256):
        with self._snapshot():
            context = self._context(identifier(program_id, "operation"))
            funding.expected_version(context, {"expectedVersion": expected_version})
            return funding.export_bundle(self, context, revision, expected_report_sha256)


    def inspect_issuer_correspondence(self, program_id, body):
        with self.workspace.mutex:
            context = self._context(identifier(program_id, "operation"))
            issuer_receiving.fields(body, ("expectedVersion", "input"))
            if domain.integer(body.get("expectedVersion"), "Reviewed case version", 1, 10000000) != context["program"]["version"]:
                domain.fail("The case changed. Review its current source.", "OPERATIONS_CONFLICT", 409)
            return issuer_receiving.inspect(body.get("input"))

    def receive_issuer_correspondence(self, program_id, body):
        return issuer_receiving.receive(self, identifier(program_id, "operation"), body)

    def issuer_correspondence(self, program_id, source_id):
        with self.workspace.mutex:
            self._program(identifier(program_id, "operation"))
            return issuer_receiving.get(self, program_id, identifier(source_id, "source"))

    def seed_award_terms(self, program_id, body):
        with self.workspace.mutex:
            context = self._context(identifier(program_id, "operation"))
            award_terms.obj(body, ("expectedVersion",), "issuer-terms seed")
            if domain.integer(body.get("expectedVersion"), "Reviewed case version", 1, 10000000) != context["program"]["version"]:
                domain.fail("The case changed. Reopen its current source.", "OPERATIONS_CONFLICT", 409)
            value = award_terms.seed(context)
            plan = value.pop("plan")
            return {"inputs": value, "plan": plan}

    def list_award_terms(self, program_id):
        with self.workspace.mutex:
            context = self._context(identifier(program_id, "operation"))
            rows = award_terms.records(self, program_id)
            return {"terms": [award_terms.summary(row) for row in award_terms.heads(rows)],
                    "commissioning": [award_terms.binding_summary(row) for row in award_terms.bindings(self, program_id)],
                    "plan": context["plan"], "program": context["program"],
                    "sources": list(context["sources"].values()),
                    "correspondence": [issuer_receiving.summary(row) for row in issuer_receiving.records(self, program_id)]}

    def award_terms(self, program_id, terms_id, revision=None):
        with self.workspace.mutex:
            self._program(identifier(program_id, "operation"))
            chosen = award_terms.get(self, program_id, terms_id, revision)
            rows = [row for row in award_terms.records(self, program_id) if row["edition"]["id"] == terms_id]
            joined = [row for row in award_terms.bindings(self, program_id) if row["edition"]["terms"]["id"] == terms_id]
            return {**chosen, "history": [award_terms.summary(row) for row in reversed(rows)],
                    "commissioning": joined}

    def preview_award_terms(self, program_id, body):
        with self.workspace.mutex:
            return award_terms.preview(self, self._context(identifier(program_id, "operation")), body)

    def seed_award_terms_plan(self, program_id, body):
        with self.workspace.mutex:
            context = self._context(identifier(program_id, "operation"))
            award_terms.obj(body, ("expectedVersion", "termsId", "termsRevision"), "terms-to-plan seed")
            if domain.integer(body.get("expectedVersion"), "Reviewed case version", 1, 10000000) != context["program"]["version"]:
                domain.fail("The case changed. Reopen its current source.", "OPERATIONS_CONFLICT", 409)
            return {"inputs": award_terms.commission_seed(self, context, body.get("termsId"), body.get("termsRevision")),
                    "nativePlan": self.workspace._read(context["program"]["planId"])}

    def preview_award_terms_plan(self, program_id, body):
        with self.workspace.mutex:
            return award_terms.commission_preview(self, self._context(identifier(program_id, "operation")), body)

    def commission_award_terms(self, program_id, body):
        return award_terms.commission(self, identifier(program_id, "operation"), body)

    def export_award_terms(self, program_id, terms_id, revision, expected_version):
        with self._snapshot():
            context = self._context(identifier(program_id, "operation"))
            if domain.integer(expected_version, "Reviewed case version", 1, 10000000) != context["program"]["version"]:
                domain.fail("The case changed. Review its current whole handover.", "OPERATIONS_CONFLICT", 409)
            return self.export(program_id, award_terms_id=terms_id, award_terms_revision=revision)

    def seed_task_outcomes(self, program_id, body):
        with self.workspace.mutex:
            context = self._context(identifier(program_id, "operation"))
            task_outcomes.obj(body, ("expectedVersion",), "Customer task seed")
            if domain.integer(body.get("expectedVersion"), "Reviewed case version", 1, 10000000) != context["program"]["version"]:
                task_outcomes.fail("The case changed. Reopen its current selection.", "OPERATIONS_CONFLICT", 409)
            return task_outcomes.seed(context)

    def list_task_outcomes(self, program_id):
        with self.workspace.mutex:
            self._program(identifier(program_id, "operation"))
            return [task_outcomes.summary(row) for row in task_outcomes.heads(task_outcomes.records(self, program_id))]

    def task_outcomes(self, program_id, study_id, revision=None):
        with self.workspace.mutex:
            context = self._context(identifier(program_id, "operation"))
            return {**task_outcomes.get(self, program_id, study_id, revision),
                    "case": {"id": program_id, "version": context["program"]["version"], "state": context["program"]["state"]}}

    def preview_task_outcomes(self, program_id, body):
        with self.workspace.mutex:
            return task_outcomes.preview(self, self._context(identifier(program_id, "operation")), body)

    def export_task_outcomes(self, program_id, study_id, revision, expected_version):
        with self._snapshot():
            context = self._context(identifier(program_id, "operation"))
            if domain.integer(expected_version, "Reviewed export case version", 1, 10000000) != context["program"]["version"]:
                task_outcomes.fail("The case changed. Review its current version before exporting the complete case.", "OPERATIONS_CONFLICT", 409)
            return self.export(program_id, task_outcome_id=study_id, task_outcome_revision=revision)


    def list_supplier_statements(self, program_id):
        with self._snapshot():
            return supplier_statements.listing(self, self._context(identifier(program_id, "operation")))
    
    def seed_supplier_statement(self, program_id, body):
        with self._snapshot():
            return supplier_statements.seed_document(self, self._context(identifier(program_id, "operation")), body)
    
    def inspect_supplier_statement_source(self, program_id, body):
        with self._snapshot():
            return supplier_statements.inspect_source(self, self._context(identifier(program_id, "operation")), body)
    
    def preview_supplier_statement(self, program_id, body):
        with self._snapshot():
            return supplier_statements.preview(self, self._context(identifier(program_id, "operation")), body)
    
    def supplier_statement(self, program_id, review_id):
        with self._snapshot():
            return supplier_statements.show(self, self._context(identifier(program_id, "operation")), review_id)
    
    def supplier_statement_request(self, program_id, body):
        with self._snapshot():
            return supplier_statements.request(self, self._context(identifier(program_id, "operation")), body, SCHEMA)
    
    def export_supplier_statement(self, program_id, review_id):
        with self._snapshot():
            return supplier_statements.export(self, identifier(program_id, "operation"), review_id)

    def list_workbooks(self, program_id):
        with self.workspace.mutex:
            self._program(program_id)
            return [workbooks.summary(row) for row in workbooks.saved(self, program_id)]

    def work_book(self, program_id, book_id):
        with self.workspace.mutex:
            self._program(program_id)
            return workbooks.selected(self, program_id, book_id)

    def preview_workbook(self, program_id, body):
        with self._snapshot():
            context = self._context(program_id)
            if context["program"]["version"] != body.get("expectedVersion"):
                domain.fail("Reopen the current case before comparing the workbook.", "OPERATIONS_CONFLICT", 409)
            return workbooks.preview(self, context, body)

    def inspect_workbook_return(self, program_id, body):
        with self._snapshot():
            self._program(program_id)
            return workbooks.inspect_return(self, program_id, body)

    def apply_workbook(self, program_id, body):
        return workbooks.apply(self, identifier(program_id, "operation"), body)


    def list_work_intakes(self, program_id):
        with self.workspace.mutex:
            self._program(identifier(program_id, "operation"))
            return [work_intake.summary(row) for row in work_intake.heads(work_intake.load(self, program_id))]

    def work_intake(self, program_id, intake_id, revision=None):
        with self.workspace.mutex:
            return work_intake.get(self, self._context(identifier(program_id, "operation")), intake_id, revision)

    def preview_work_intake(self, program_id, body):
        with self.workspace.mutex:
            work_intake.keys(body, ("expectedVersion", "intakeId", "revision", "document"), "Intake preview")
            context = self._context(identifier(program_id, "operation"))
            expected = domain.integer(body.get("expectedVersion"), "Reviewed case version", 1, 10000000)
            if context["program"]["version"] != expected:
                domain.fail("The case changed. Refresh it and preview the retained intake again.", "OPERATIONS_CONFLICT", 409)
            return work_intake.preview_selected(self, context, {key: value for key, value in body.items() if key != "expectedVersion"})

    def _engagement_context(self, program_id, body, fields):
        engagements.obj(body, {"expectedVersion", *fields}, "Contributor engagement request")
        return self._portfolio_context(program_id, body.get("expectedVersion"))

    def _risk_context(self, program_id, body, fields):
        risks.obj(body, {"expectedVersion", *fields}, "Risk register request")
        context = self._context(identifier(program_id, "operation"))
        if domain.integer(body.get("expectedVersion"), "Reviewed case version", 1, 10000000) != context["program"]["version"]:
            domain.fail("The case changed. Reopen its current source before reviewing risks.", "OPERATIONS_CONFLICT", 409)
        return context

    def list_risks(self, program_id):
        with self._snapshot():
            return risks.listing(self, self._context(identifier(program_id, "operation")))

    def seed_risks(self, program_id, body):
        with self._snapshot():
            return risks.seed(self, self._risk_context(program_id, body, ("reviewId",)), body.get("reviewId"))

    def preview_risks(self, program_id, body):
        with self._snapshot():
            return risks.preview(self, self._risk_context(program_id, body, ("document",)), body.get("document"))

    def risk_register(self, program_id, review_id):
        with self._snapshot():
            return risks.show(self, self._context(identifier(program_id, "operation")), identifier(review_id, "review"))

    def risk_history(self, program_id, risk_id):
        with self._snapshot():
            return risks.history(self, self._context(identifier(program_id, "operation")), identifier(risk_id))

    def risk_request(self, program_id, body):
        """Reconcile one exact original command without admitting another write."""
        risks.obj(body, {"command"}, "Risk request lookup")
        command = risks.obj(body.get("command"), {"expectedVersion", "actor", "action", "data", "note", "requestId"},
                            "Original retained risk command")
        if command.get("action") != risks.ACTION:
            risks.fail("Select the original retained risk-register.save command.")
        domain.integer(command.get("expectedVersion"), "Original case version", 1, 10000000)
        actor = text(command.get("actor"), "Original recording operator", 300, True)
        text(command.get("note"), "Original review note", 12000, True)
        risks.obj(command.get("data"), {"document", "expectedPreviewSha256"}, "Original risk save data")
        request_id = short_id(command.get("requestId"), "Original request ID")
        with self._snapshot():
            self._program(identifier(program_id, "operation"))
            fingerprint = digest({"domain": SCHEMA, "programId": program_id, "body": command})
            row = self.db.execute("SELECT fingerprint,result_json FROM requests WHERE request_id=?", (request_id,)).fetchone()
            if row is None:
                return {"found": False, "requestId": request_id}
            if row[0] != fingerprint:
                raise Problem("This request ID already belongs to a different action.", 409, "REQUEST_CONFLICT")
            result = json.loads(row[1])
            event_row = self.db.execute("SELECT body_json FROM ops_events WHERE program_id=? AND version=?",
                                        (program_id, result.get("version"))).fetchone()
            if event_row is None:
                risks.fail("The accepted risk request has no matching case event.", "RISK_REQUEST_CHANGED", 409)
            event = json.loads(event_row[0])
            review = risks.raw_review(self, program_id, result.get("recordId"))
            if (result.get("id") != program_id or result.get("action") != risks.ACTION or result.get("kind") != "review"
                    or result.get("reviewSha256") != review["sha256"] or result.get("riskRegister") != risks.summary(review)
                    or event.get("action") != risks.ACTION or event.get("requestId") != request_id
                    or event.get("recordId") != review["id"] or event.get("after") != risks.summary(review)
                    or event.get("actor") != actor or event.get("version") != command["expectedVersion"] + 1
                    or digest({k: v for k, v in event.items() if k != "sha256"}) != event.get("sha256")):
                risks.fail("The accepted original risk request differs from its case history.", "RISK_REQUEST_CHANGED", 409)
            return {"found": True, "requestId": request_id, "fingerprint": row[0], "result": result}

    def compare_risks(self, program_id, selection):
        with self._snapshot():
            return risk_comparison.compare(self, self._context(identifier(program_id, "operation")), selection)

    def export_risk_comparison(self, program_id, selection, expected_comparison_sha256, *,
                               kind="export.zip", expected_version=None):
        with self._snapshot():
            context = self._context(identifier(program_id, "operation"))
            value = risk_comparison.compare(self, context, selection)["comparison"]
            risk_comparison.require_digest(value, expected_comparison_sha256)
            if kind == "export.zip":
                if domain.integer(expected_version, "Reviewed case version", 1, 10000000) != context["program"]["version"]:
                    raise Problem("Reopen the current case before exporting its complete comparison.", 409, "OPERATIONS_CONFLICT")
                return self.export(program_id, risk_comparison_selection=selection)
            if expected_version is not None:
                raise Problem("The case version condition is only available for the complete ZIP.", 422, "INVALID_RISK_COMPARISON")
            return risk_comparison.export_file(value, kind)

    def export_risks(self, program_id, review_id):
        return self.export(identifier(program_id, "operation"), risk_register_id=identifier(review_id, "review"))

    def engagement_request(self, program_id, body):
        with self._snapshot():
            return engagement_working.lookup(self, identifier(program_id, "operation"), body)

    def seed_engagement(self, program_id, body):
        with self._snapshot():
            context = self._engagement_context(program_id, body, ("reviewId",))
            return engagements.seed(self, context, body.get("reviewId"))

    def preview_engagement(self, program_id, body):
        with self._snapshot():
            context = self._engagement_context(program_id, body, ("document",))
            candidate = engagements.preview(context, body.get("document"))
            engagements.previous_review(self, context, candidate["document"])
            return candidate

    def list_engagements(self, program_id):
        with self._snapshot():
            self._program(identifier(program_id, "operation"))
            return engagements.list_editions(self, program_id)

    def engagement(self, program_id, review_id):
        with self._snapshot():
            context = self._context(identifier(program_id, "operation"))
            return engagements.show(self, context, identifier(review_id, "review"))

    def preview_engagement_forecast(self, program_id, body):
        with self._snapshot():
            context = self._engagement_context(program_id, body, ("selection",))
            if not isinstance(body.get("selection"), dict):
                engagements.fail("Use the complete contributor forecast selection.")
            return engagement_handover.preview_forecast(self, context, body["selection"])

    def preview_engagement_portfolio(self, program_id, body):
        with self._snapshot():
            context = self._engagement_context(program_id, body, ("selection",))
            if not isinstance(body.get("selection"), dict):
                engagements.fail("Use the complete contributor allocation selection.")
            return engagement_handover.preview_portfolio(self, context, body["selection"])

    def export_engagement(self, program_id, review_id):
        return self.export(identifier(program_id, "operation"), engagement_id=identifier(review_id, "review"))

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

    def amendments(self, program_id):
        with self._snapshot():
            return amendments.view(self, self._context(program_id))

    def amendment(self, program_id, amendment_id, revision=None):
        with self._snapshot():
            context = self._context(program_id)
            row = amendments.selected(self, program_id, amendment_id, revision)
            latest = amendments.selected(self, program_id, amendment_id)
            return {"amendment": row, "calendarImpact": amendment_calendar.review(row["preview"], row),
                    "current": amendments.summary(latest, context, digest(self._business(context))),
                    "history": [amendments.summary(value) for value in amendments.load(self, program_id)
                                if value["id"] == row["id"]]}

    def preview_amendment(self, program_id, body):
        if not isinstance(body, dict) or set(body) != {"expectedVersion", "inputs"}:
            domain.fail("Select the original case version and complete amendment inputs.", "INVALID_AMENDMENT")
        expected = domain.integer(body.get("expectedVersion"), "Reviewed case version", 1, 10000000)
        with self._snapshot():
            context = self._context(program_id)
            if context["program"]["version"] != expected:
                domain.fail("The case changed. Compare the selected plan against its current records.",
                            "AMENDMENT_SOURCE_CONFLICT", 409)
            preview = amendments.preview(self, context, body["inputs"])
            return {**preview, "calendarImpact": amendment_calendar.review(preview)}

    def export_amendment_calendar(self, program_id, body):
        if not isinstance(body, dict):
            amendments.fail("Select the exact amendment calendar to export.", "INVALID_AMENDMENT_CALENDAR")
        with self._snapshot():
            context = self._context(program_id)
            edition = None
            if "amendmentId" in body:
                if set(body) != {"amendmentId", "revision", "expectedAmendmentSha256", "expectedImpactSha256"}:
                    amendments.fail("Select the original saved amendment edition and calendar.", "INVALID_AMENDMENT_CALENDAR")
                revision = domain.integer(body["revision"], "Selected amendment edition", 1, amendments.MAX_EDITIONS)
                edition = amendments.selected(self, program_id, body["amendmentId"], revision)
                expected = domain.sha(body["expectedAmendmentSha256"], "Selected amendment edition", False)
                if edition["sha256"] != expected:
                    amendments.fail("The selected saved amendment differs from this export.", "AMENDMENT_CONFLICT", 409)
                preview = edition["preview"]
            else:
                if set(body) != {"expectedVersion", "inputs", "expectedPreviewSha256", "expectedImpactSha256"}:
                    amendments.fail("Select the complete original draft comparison.", "INVALID_AMENDMENT_CALENDAR")
                expected = domain.integer(body["expectedVersion"], "Reviewed case version", 1, 10000000)
                if context["program"]["version"] != expected:
                    amendments.fail("The case changed. Reopen its amendment calendar before exporting.",
                                    "AMENDMENT_SOURCE_CONFLICT", 409)
                preview = amendments.preview(self, context, body["inputs"])
                if preview["previewSha256"] != domain.sha(body["expectedPreviewSha256"], "Original amendment preview", False):
                    amendments.fail("The amendment preview changed. Reopen its calendar comparison.",
                                    "AMENDMENT_PREVIEW_CONFLICT", 409)
            report = amendment_calendar.review(preview, edition)
            if report["impactSha256"] != domain.sha(body["expectedImpactSha256"], "Original calendar impact", False):
                amendments.fail("The calendar differs from the reviewed selection. Refresh that comparison.",
                                "AMENDMENT_CALENDAR_CONFLICT", 409)
            return amendment_calendar.export_bytes(report, preview, self.export(program_id), edition)

    def completion_calendar(self, program_id, as_of=None):
        with self.workspace.mutex:
            return completion.dashboard(self._context(identifier(program_id, "operation")), as_of)

    def delivery_agenda(self, case_ids, as_of=None, expected_versions=None):
        return agenda_model.read(self, case_ids, as_of, expected_versions)

    def export_delivery_agenda(self, case_ids, as_of=None, format="ics", expected_versions=None):
        with self._snapshot():
            report = self.delivery_agenda(case_ids, as_of, expected_versions)
            return agenda_model.export_bytes(report, format)

    def delivery_calendar(self, program_id, as_of=None, expected_version=None):
        with self._snapshot():
            context = self._context(identifier(program_id, "operation"))
            if expected_version is not None:
                expected = domain.integer(expected_version, "Selected calendar case version", 1, 10000000)
                if context["program"]["version"] != expected:
                    domain.fail("The grant case changed. Refresh the delivery calendar.", "OPERATIONS_CONFLICT", 409)
            return calendar_model.calendar(context, as_of)

    def export_delivery_calendar(self, program_id, as_of=None, format="ics", expected_version=None):
        with self._snapshot():
            report = self.delivery_calendar(program_id, as_of, expected_version)
            return calendar_model.export_bytes(report, format)

    def customer_use_calendar(self, program_id, body):
        with self._snapshot():
            context = self._completion_context(program_id, body, ("installationRefs", "asOfDate"))
            selected = use_calendar.selected_rows(self, context, body.get("installationRefs"))
            return use_calendar.calendar(context, selected, body.get("asOfDate"))

    def expand_customer_use_calendar(self, program_id, body):
        with self._snapshot():
            context = self._completion_context(program_id, body, ("document", "pattern"))
            document = installations.normalized(context, body.get("document"))
            result = use_calendar.expand(context, document, body.get("pattern"))
            result["document"] = installations.normalized(context, result["document"])
            result["source"] = installations._source(context)
            return result

    def seed_customer_use_cohort(self, program_id, body):
        with self._snapshot():
            context = self._completion_context(program_id, body, ("installationRefs", "groupId", "asOfAt"))
            selected = use_calendar.selected_rows(self, context, body.get("installationRefs"))
            return use_calendar.seed_cohort(context, selected, body.get("groupId"), body.get("asOfAt"))

    def export_customer_use_calendar(self, program_id, body, format="json"):
        with self._snapshot():
            value = self.customer_use_calendar(program_id, body)
            return use_calendar.export_bytes(value, format)

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

    def completion_installations(self, program_id, body):
        from operations_completion_installations import catalog
        with self._snapshot():
            context = self._completion_context(program_id, body, ("tranche",))
            return catalog(self, context, body.get("tranche"))

    def preview_completion_installations(self, program_id, body):
        from operations_completion_installations import transfer
        with self._snapshot():
            context = self._completion_context(program_id, body, ("inputs", "asOfDate"))
            return transfer(self, context, body)

    def _completion_correction_review(self, program_id, review_id):
        selected = self.review(program_id, review_id)
        if selected.get("purpose") != completion_corrections.PURPOSE:
            domain.fail("Select the original correction review.", "COMPLETION_CORRECTIONS", 409)
        latest = completion_corrections.head(completion_corrections.reviews(self, program_id),
                                              selected["corrections"]["inputs"]["roundId"])
        if not latest or latest["id"] != selected["id"]:
            domain.fail("This correction round has a newer edition. Review the complete latest findings before re-preparation.",
                        "COMPLETION_CORRECTIONS_HEAD_CHANGED", 409)
        return selected

    def seed_completion_corrections(self, program_id, body):
        with self.workspace.mutex:
            context = self._completion_context(program_id, body, ("outcomeId", "reviewId"))
            return completion_corrections.seed(self, context, body.get("outcomeId"), body.get("reviewId"))

    def preview_completion_corrections(self, program_id, body):
        with self.workspace.mutex:
            context = self._completion_context(program_id, body, ("inputs", "asOfDate"))
            return completion_corrections.preview(self, context, body.get("inputs"), body.get("asOfDate"))

    def export_completion_corrections(self, program_id, review_id):
        with self.workspace.mutex:
            return completion_corrections.export(self.review(program_id, review_id),
                lambda source_id: self.source(program_id, source_id))

    def preview_completion(self, program_id, body):
        with self.workspace.mutex:
            context = self._completion_context(program_id, body, ("receiptId", "asOfDate", "summary", "cohortReviewIds", "implementationReviewIds", "correctionReviewId"))
            reviews = self._cohort_reviews(program_id, body["cohortReviewIds"]) if "cohortReviewIds" in body else None
            evidence = self._implementation_reviews(program_id, body["implementationReviewIds"]) if "implementationReviewIds" in body else None
            return completion.preview(context, {key: value for key, value in body.items() if key != "expectedVersion"},
                                      reviews, self._cohort_history(program_id) if reviews is not None else None, evidence,
                                      correction_review=self._completion_correction_review(program_id, body["correctionReviewId"]) if "correctionReviewId" in body else None)

    def export_completion(self, program_id, review_id):
        with self.workspace.mutex:
            review = self.review(program_id, review_id)
            return completion.review_files(review, lambda source_id: self.source(program_id, source_id))

    def expense_request(self, program_id, body):
        program_id = identifier(program_id, "operation")
        if not isinstance(body, dict) or body.get("action") not in expenses.ACTIONS or not isinstance(body.get("data"), dict):
            domain.fail("Select the complete original expense request.", "EXPENSE_REQUEST_INVALID")
        request_id = short_id(body.get("requestId"), "Original request ID")
        fingerprint = digest({"domain": SCHEMA, "programId": program_id, "body": body})
        with self.workspace.mutex:
            program, _ = self._program(program_id)
            row = self.db.execute("SELECT fingerprint,result_json FROM requests WHERE request_id=?", (request_id,)).fetchone()
            if row:
                if row[0] != fingerprint:
                    domain.fail("This original request ID belongs to different selected inputs.", "REQUEST_CONFLICT", 409)
                return {"status": "COMMITTED", "requestId": request_id, "caseId": program_id,
                        "receipt": json.loads(row[1]), "currentVersion": program["version"]}
            return {"status": "NOT_RECORDED", "requestId": request_id, "caseId": program_id,
                    "currentVersion": program["version"]}

    def preview_expense(self, program_id, body):
        with self.workspace.mutex:
            return expenses.preview(self._context(identifier(program_id, "operation")), body)

    def expense_attribution(self, program_id):
        with self.workspace.mutex:
            return expenses.dashboard(self._context(identifier(program_id, "operation")))

    def expense_file(self, program_id, filename):
        if filename not in expenses.EXPORT_NAMES:
            domain.fail("Choose an original expense attribution export.", "NOT_FOUND", 404)
        with self._snapshot():
            context = self._context(identifier(program_id, "operation"))
            files = expenses.export_files(context)
            if filename not in files:
                domain.fail("Receive the original issued expense source before exporting its attribution.", "EXPENSE_SOURCE_REQUIRED", 409)
            return files[filename]

    def preview_buyer(self, program_id, body):
        with self.workspace.mutex:
            context = deepcopy(self._context(identifier(program_id, "operation")))
            return buyer.preview(context, body, operations=self)

    def inspect_statement(self, program_id, body):
        with self._snapshot():
            context = deepcopy(self._completion_context(program_id, body, ("inputs",)))
        return statements.inspect(context, body.get("inputs"))

    def preview_statement(self, program_id, body):
        with self._snapshot():
            context = deepcopy(self._completion_context(program_id, body, ("inputs",)))
            context["cashCorrections"] = cash_accounts.statement_successors(self, context)
            context["statementSetups"] = [statement_profiles.summary(row) for row in statement_profiles.records(self, program_id)]
            return statements.preview(context, body.get("inputs"))

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
        if not isinstance(body, dict) or set(body) - {"expectedVersion", "forecastId", "installationSelections", "inputs"}:
            domain.fail("Use the declared portfolio seed object.", "INVALID_PORTFOLIO")
        if "inputs" in body and not isinstance(body["inputs"], dict):
            domain.fail("Retain the existing Portfolio draft as a complete input object.", "INVALID_PORTFOLIO")
        with self._snapshot():
            context = self._portfolio_context(program_id, body.get("expectedVersion"))
            saved = self._portfolio_forecast(program_id, body.get("forecastId"))
            context = portfolio_installations.capture(self, context, body.get("inputs"),
                body.get("installationSelections"), inventory=True, allow_old=True)
            return portfolios.seed(context, saved, body.get("installationSelections"), body.get("inputs"),
                                   include_inventory=True)

    def preview_portfolio(self, program_id, body):
        if not isinstance(body, dict) or set(body) - {"expectedVersion", "inputs"} or not isinstance(body.get("inputs"), dict):
            domain.fail("Use the declared portfolio preview object.", "INVALID_PORTFOLIO")
        with self._snapshot():
            context = self._portfolio_context(program_id, body.get("expectedVersion"))
            saved = self._portfolio_forecast(program_id, body["inputs"].get("forecastId"))
            context = portfolio_installations.capture(self, context, body["inputs"])
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
            installation_current = {}
            if portfolio_installations.has_plans_field(value["inputs"]):
                heads = {row["id"]: row for row in installations.load_heads(self, program_id)}
                installation_current["installationSourceChanged"] = any(
                    selected["installationId"] not in heads
                    or portfolio_installations.row_ref(heads[selected["installationId"]]) != selected
                    for selected in portfolio_installations.raw_references(value["inputs"]))
            return {**value, "current": {"programId": program_id, "version": current["version"],
                    "sourceChanged": current["factsSha256"] != value["source"]["factsSha256"],
                    "retainedOriginalProgramId": value["source"]["programId"], **installation_current}}

    def export_portfolio(self, program_id, portfolio_id):
        value = self.portfolio(program_id, portfolio_id)
        value.pop("current")
        return portfolios.export(value)

    def select_portfolio(self, program_id, body):
        if not isinstance(body, dict) or set(body) - {"expectedVersion", "portfolioId", "alternativeId"}:
            domain.fail("Use the declared portfolio selection object.", "INVALID_PORTFOLIO")
        with self._snapshot():
            context = self._portfolio_context(program_id, body.get("expectedVersion"))
            value = self.portfolio(program_id, body.get("portfolioId"))
            value.pop("current")
            alternative_id = short_id(body.get("alternativeId"), "Alternative ID")
            selected = next((row for row in value["inputs"]["alternatives"] if row["id"] == alternative_id), {})
            fields = portfolios.allocation_fields(selected, value["inputs"])
            context = portfolio_installations.capture(self, context, fields)
            return portfolios.select(context, value, alternative_id)

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

    def installation_commercial(self, program_id, body):
        from operations_commercial_installations import inventory
        with self._snapshot():
            context = self._context(identifier(program_id, "operation"))
            return inventory(self, context, body)

    def seed_commercial_installation(self, program_id, body):
        from operations_commercial_installations import seed
        with self._snapshot():
            context = self._context(identifier(program_id, "operation"))
            return seed(self, context, body)

    def installation_workshares(self, program_id, body):
        from operations_workshare_installations import case_inventory
        with self._snapshot():
            context = self._context(identifier(program_id, "operation"))
            return case_inventory(self, context, body)

    def seed_workshare_installation(self, program_id, body):
        from operations_workshare_installations import seed
        with self._snapshot():
            context = self._context(identifier(program_id, "operation"))
            return seed(self, context, body)

    def seed_installation_commissioning(self, program_id, body):
        from operations_commissioning import seed
        with self._snapshot():
            context = self._context(identifier(program_id, "operation"))
            return seed(self, context, body)

    def review_installation_commissioning(self, program_id, body):
        from operations_commissioning import review
        with self._snapshot():
            context = self._context(identifier(program_id, "operation"))
            return review(self, context, body)

    def seed_installation_effort(self, program_id, body):
        with self._snapshot():
            context = self._context(identifier(program_id, "operation"))
            return installation_effort.seed(self, context, body)

    def select_installation_effort(self, program_id, body):
        with self._snapshot():
            context = self._context(identifier(program_id, "operation"))
            return installation_effort.selection(self, context, body)

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

    def inspect_company_return(self, program_id, body):
        with self._snapshot():
            return company_returns.inspect_package(self, self._context(identifier(program_id, "operation")), body)

    def linked_company_return(self, program_id, body):
        with self._snapshot():
            return company_returns.linked_package(self, self._context(identifier(program_id, "operation")), body)

    def installation_returns(self, program_id):
        with self._snapshot():
            return installation_returns.list_reviews(self, self._context(program_id))

    def seed_installation_return(self, program_id, body):
        with self._snapshot():
            return installation_returns.seed(self, self._context(program_id), body)

    def preview_installation_return(self, program_id, body):
        with self._snapshot():
            return installation_returns.preview(self, self._context(program_id), body)

    def seed_installation_return_review(self, program_id, body):
        with self._snapshot():
            return installation_returns.review_seed(self, self._context(program_id), body)

    def preview_installation_return_review(self, program_id, body):
        with self._snapshot():
            return installation_returns.review_preview(self, self._context(program_id), body)

    def export_installation_return(self, program_id, review_id):
        return self.export(program_id, installation_return_review_id=review_id)

    def ledger_intake(self, program_id):
        return ledger_intake.describe(self, identifier(program_id, "operation"))

    def inspect_ledger_intake(self, program_id, body):
        with self._snapshot():
            self._program(identifier(program_id, "operation"))
            if not isinstance(body, dict) or set(body) != {"file"}:
                domain.fail("Select one original source file for inspection.", "INVALID_LEDGER_INTAKE")
            return ledger_intake.inspect(body["file"])

    def preview_ledger_intake(self, program_id, body):
        return ledger_intake.preview(self, identifier(program_id, "operation"), body)

    def apply_ledger_intake(self, program_id, body):
        return ledger_intake.apply(self, program_id, body)

    def ledger_intake_original(self, program_id, source_id):
        return ledger_intake.original(self, identifier(program_id, "operation"), identifier(source_id, "source"))

    def account_reconciliation(self, program_id, selection=None, expected_version=None):
        body = {"selection": selection or {}}
        if expected_version is not None:
            body["expectedVersion"] = expected_version
        return account_reconciliation.account(self, identifier(program_id, "operation"), body)

    def account_reconciliation_preview(self, program_id, body):
        return account_reconciliation.preview(self, identifier(program_id, "operation"), body)

    def account_reconciliation_apply(self, program_id, body):
        return account_reconciliation.apply(self, identifier(program_id, "operation"), body)

    def account_reconciliation_statement_inputs(self, program_id, source_id):
        return account_reconciliation.statement_inputs(self, identifier(program_id, "operation"),
                                                        identifier(source_id, "source"))

    def export_account_reconciliation(self, program_id, selection, expected_version, expected_report_sha256):
        with self._snapshot():
            report = self.account_reconciliation(program_id, selection,
                domain.integer(expected_version, "Reviewed reconciliation case version", 1, 10000000))
            if domain.sha(expected_report_sha256, "Reviewed reconciliation account", False) != report["reportSha256"]:
                domain.fail("Reopen the original reconciliation edition before exporting its complete handover.",
                            "RECONCILIATION_SOURCE_CHANGED", 409)
            return account_reconciliation.export_bundle(report, self.export(program_id))

    def cash_account(self, program_id, selection=None, expected_version=None):
        body = {"selection": selection or {}}
        if expected_version is not None:
            body["expectedVersion"] = expected_version
        return cash_accounts.account(self, identifier(program_id, "operation"), body)

    def cash_correction_preview(self, program_id, body):
        return cash_accounts.preview(self, identifier(program_id, "operation"), body)

    def cash_correction_apply(self, program_id, body):
        return cash_accounts.apply(self, identifier(program_id, "operation"), body)

    def export_cash_account(self, program_id, selection, expected_version, expected_report_sha256):
        with self._snapshot():
            report = self.cash_account(program_id, selection,
                domain.integer(expected_version, "Reviewed cash account case version", 1, 10000000))
            if domain.sha(expected_report_sha256, "Reviewed cash account", False) != report["reportSha256"]:
                domain.fail("Reopen the original cash account before exporting its complete handover.",
                            "CASH_ACCOUNT_SOURCE_CHANGED", 409)
            return cash_accounts.export_bundle(report, self.export(program_id))

    def supplier_account(self, program_id, contributor_id=None, start_date=None, end_date=None, expected_version=None):
        with self._snapshot():
            context = self._context(identifier(program_id, "operation"))
            if expected_version is not None and domain.integer(expected_version, "Reviewed case version", 1, 10000000) != context["program"]["version"]:
                domain.fail("Refresh the original case before reading this supplier account.", "VERSION_CONFLICT", 409)
            return payables.build(context, contributor_id, start_date, end_date)

    def export_supplier_account(self, program_id, contributor_id, start_date, end_date, expected_version, expected_report_sha256):
        with self._snapshot():
            report = self.supplier_account(program_id, contributor_id, start_date, end_date,
                domain.integer(expected_version, "Reviewed case version", 1, 10000000))
            if domain.sha(expected_report_sha256, "Reviewed supplier account", False) != report["reportSha256"]:
                domain.fail("Reopen the supplier and dates before exporting the complete account.",
                            "SUPPLIER_ACCOUNT_SOURCE_CHANGED", 409)
            return payables.export_bundle(report, self.export(program_id))

    def performance(self, program_id, start_date=None, end_date=None, expected_version=None):
        with self._snapshot():
            context = self._context(identifier(program_id, "operation"))
            if expected_version is not None and domain.integer(expected_version, "Reviewed case version", 1, 10000000) != context["program"]["version"]:
                domain.fail("The case changed. Refresh the report to read its current version.", "VERSION_CONFLICT", 409)
            return performance.build(context, start_date, end_date)

    def export_performance(self, program_id, start_date, end_date, expected_version, expected_report_sha256):
        with self._snapshot():
            report = self.performance(program_id, start_date, end_date,
                domain.integer(expected_version, "Reviewed case version", 1, 10000000))
            if domain.sha(expected_report_sha256, "Reviewed performance report", False) != report["reportSha256"]:
                domain.fail("Refresh the selected period before exporting its complete handover.", "PERFORMANCE_SOURCE_CHANGED", 409)
            return performance.export_bundle(report, self.export(program_id))

    def delivery_queue(self, program_id, as_of=None):
        with self._snapshot():
            context = self._context(identifier(program_id, "operation"))
            return dispatch.build(context, installations.load_heads(self, program_id), as_of)

    def export_delivery_queue(self, program_id, as_of=None):
        with self._snapshot():
            context = self._context(identifier(program_id, "operation"))
            queue = dispatch.build(context, installations.load_heads(self, program_id), as_of)
            return dispatch.export_bundle(queue, self.export(program_id))

    def list_installations(self, program_id):
        with self._snapshot():
            self._program(identifier(program_id, "operation"))
            return installations.latest_summaries(installations.load_heads(self, program_id))

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
            if "dcatWorkspace" in metadata:
                dcat_sources.validate_source(metadata, raw)
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

    def export(self, program_id, installation_id=None, installation_revision=None, installation_return_review_id=None, engagement_id=None, task_outcome_id=None, task_outcome_revision=None, award_terms_id=None, award_terms_revision=None, risk_register_id=None, risk_comparison_selection=None):
        with self._snapshot():
            context = self._context(program_id)
            program = context["program"]
            bundle_limit = dcat_sources.source_budget(context["sources"].values())
            reviews = [json.loads(row[0]) for row in self.db.execute("SELECT body_json FROM ops_reviews WHERE program_id=? ORDER BY rowid", (program_id,))]
            events = [json.loads(row[0]) for row in self.db.execute("SELECT body_json FROM ops_events WHERE program_id=? ORDER BY version", (program_id,))]
            dcat_sources.validate_events(context["sources"].values(), events)
            original = self.workspace.export(program["planId"])
            saved_forecasts = [json.loads(row[0]) for row in self.db.execute(
                "SELECT body_json FROM ops_forecasts WHERE program_id=? ORDER BY rowid", (program_id,))]
            saved_portfolios = [json.loads(row[0]) for row in self.db.execute(
                "SELECT body_json FROM ops_portfolios WHERE program_id=? ORDER BY rowid", (program_id,))]
            saved_installations = installations.load(self, program_id)
            saved_amendments = amendments.load(self, program_id)
            saved_work_intakes = work_intake.load(self, program_id)
            document = {"schema": SCHEMA, "exportedAt": now(), **context, "sources": list(context["sources"].values()),
                        "reviews": reviews, "events": events, "forecasts": saved_forecasts, "portfolios": saved_portfolios}
            if saved_installations:
                document["installations"] = saved_installations
            if saved_amendments:
                document["amendments"] = saved_amendments
            if saved_work_intakes:
                document["workIntakes"] = saved_work_intakes
            commercial_rows = self.commercial.export_rows(program_id)
            if commercial_rows["prepared"]:
                document["commercialReceivables"] = commercial_rows
            change_rows = self.commercial_changes.export_rows(program_id)
            if change_rows["items"]:
                document["commercialChanges"] = change_rows
            expense_billing_rows = self.expense_billing.export_rows(program_id)
            if expense_billing_rows["items"]:
                document["expenseBilling"] = expense_billing_rows
            work_billing_rows = self.work_billing.export_rows(program_id)
            if work_billing_rows["items"] or work_billing_rows["authorities"]:
                document["workBilling"] = work_billing_rows
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
            files.update(amendments.export_files(saved_amendments))
            settlement_view = settlement_sources.observations(context)
            if settlement_view:
                files["merchant-settlements.json"] = (canonical(settlement_view) + "\n").encode()
                files["merchant-settlements.csv"] = csv_bytes(settlement_sources.CSV_FIELDS, settlement_sources.csv_rows(context))
            files.update(expenses.export_files(context))
            node_view = buyer.node_observations(context)
            if node_view:
                files["node-accounting-observations.json"] = (canonical(node_view) + "\n").encode()
                files["node-accounting-observations.csv"] = csv_bytes(buyer.NODE_CSV_FIELDS, buyer.node_csv_rows(context))
            for metadata in context["sources"].values():
                _, raw = self.source(program_id, metadata["id"])
                files["sources/" + metadata["id"]] = raw
            if installation_return_review_id is not None:
                files.update(installation_returns.selected_files(context, reviews, installation_return_review_id))
            if installation_id is not None or installation_revision is not None:
                files.update(installations.selected_files(context, saved_installations, installation_id, installation_revision, files))
            if risk_register_id is not None:
                files.update(risks.selected_files(context, reviews, risk_register_id))
            if risk_comparison_selection is not None:
                files.update(risk_comparison.selected_files(context, reviews, risk_comparison_selection))
            if engagement_id is not None:
                files.update(engagements.selected_files(context, reviews, engagement_id))
            if task_outcome_id is not None or task_outcome_revision is not None:
                files.update(task_outcomes.selected_files(self, program_id, task_outcome_id, task_outcome_revision))
            if award_terms_id is not None or award_terms_revision is not None:
                files.update(award_terms.selected_files(self, program_id, award_terms_id, award_terms_revision))
        if sum(len(raw) for raw in files.values()) > bundle_limit:
            domain.fail("The complete operations bundle exceeds its selected ordinary/DCAT capacity.", status=413)
        manifest = {"schema": SCHEMA + ".bundle", "files": [{"path": name, "bytes": len(raw),
                    "sha256": hashlib.sha256(raw).hexdigest()} for name, raw in sorted(files.items())]}
        files["MANIFEST.json"] = (canonical(manifest) + "\n").encode()
        if sum(len(raw) for raw in files.values()) > bundle_limit:
            domain.fail("The complete operations bundle including its manifest exceeds its selected ordinary/DCAT capacity.", status=413)
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for name, raw in sorted(files.items()):
                info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
                info.external_attr = 0o600 << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, raw)
        raw = output.getvalue()
        if len(raw) > bundle_limit:
            domain.fail("The compressed complete operations bundle exceeds its selected ordinary/DCAT capacity.", status=413)
        return raw

    @staticmethod
    def _unpack(raw):
        if not isinstance(raw, bytes) or len(raw) > dcat_sources.MAX_BUNDLE:
            domain.fail("Use a complete operations ZIP within its selected source capacity.", status=413)
        try:
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                infos = archive.infolist()
                names = [row.filename for row in infos]
                expanded = sum(row.file_size for row in infos)
                if len(names) != len(set(names)) or len(names) > 220 or expanded > dcat_sources.MAX_BUNDLE:
                    domain.fail("The operations bundle has duplicate, excessive or oversized entries.")
                if (archive.getinfo("MANIFEST.json").file_size > 1024 * 1024
                        or archive.getinfo("operations.json").file_size > MAX_BUNDLE):
                    domain.fail("The original operations metadata exceeds its bound.", status=413)
                document = json.loads(archive.read("operations.json"))
                if not isinstance(document, dict) or document.get("schema") != SCHEMA:
                    domain.fail("Select the complete original Operations document.")
                bundle_limit = dcat_sources.source_budget(document.get("sources", []))
                if len(raw) > bundle_limit or expanded > bundle_limit:
                    domain.fail("The complete case exceeds its selected ordinary/DCAT bound.", status=413)
                dcat_names = {"sources/" + row["id"] for row in document["sources"] if "dcatWorkspace" in row}
                if any(row.file_size > (dcat_sources.MAX_SOURCE if row.filename in dcat_names else MAX_BUNDLE)
                       for row in infos):
                    domain.fail("An original case member exceeds its selected bound.", status=413)
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
        if expenses.has_records(document.get("expenseRecords") or expenses.empty()):
            expected.update(expenses.EXPORT_NAMES)
        node_names = {"node-accounting-observations.json", "node-accounting-observations.csv"}
        if node_names.intersection(files) or any(isinstance(row.get("buyerHandoff"), dict)
                and row["buyerHandoff"].get("sourceSchema") == buyer.NODE_SCHEMA for row in document["sources"]):
            expected.update(node_names)
        if settlement_sources.DERIVED_FILES.intersection(files) or any("settlementHandoff" in row for row in document["sources"]):
            expected.update(settlement_sources.DERIVED_FILES)
        selected_names = {"installation-selection.json", "installation.html"}
        if selected_names.intersection(files):
            expected.update(selected_names)
            if "installation-effort.json" in files:
                expected.add("installation-effort.json")
        if task_outcomes.SELECTION_FILES.intersection(files):
            expected.update(task_outcomes.SELECTION_FILES)
        if award_terms.SELECTION_FILES.intersection(files):
            expected.update(award_terms.SELECTION_FILES)
        if risks.SELECTION_FILES.intersection(files):
            expected.update(risks.SELECTION_FILES)
        if risk_comparison.SELECTION_FILES.intersection(files):
            expected.update(risk_comparison.SELECTION_FILES)
        engagement_names = {"engagement-selection.json", "engagement.html"}
        if engagement_names.intersection(files):
            expected.update(engagement_names)
        return_names = {"installation-return-selection.json", "installation-return.html"}
        if return_names.intersection(files):
            expected.update(return_names)
        if document.get("amendments") or {"amendment-history.json", "amendment-changes.csv"}.intersection(files):
            expected.update({"amendment-history.json", "amendment-changes.csv"})
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
            association = item.get("buyerHandoff", {})
            maximum = buyer.MAX_CUSTOMER_USE_HANDOFF if (isinstance(association, dict)
                and association.get("sourceSchema") == buyer.CUSTOMER_USE_SCHEMA) else MAX_SOURCE
            if "dcatWorkspace" in item:
                maximum = dcat_sources.MAX_SOURCE
                if association:
                    domain.fail("A DCAT workspace cannot impersonate a customer-use source.")
                dcat_sources.validate_source(item, content)
            if len(content) != item["bytes"] or hashlib.sha256(content).hexdigest() != item["sha256"] or len(content) > maximum:
                domain.fail("An original attachment differs from its source record.")
        dcat_sources.source_budget(document["sources"])
        dcat_sources.validate_events(document["sources"], document.get("events", []))
        installations.selection_from_files(document, files)
        task_outcomes.selection_from_files(document, files)
        award_terms.selection_from_files(document, files)
        installation_returns.selection_from_files(document, files)
        engagements.validate_selection(document, files)
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
        if dcat_sources.native_bundle(raw):
            # A native case is not a report wrapper. Its own complete importer
            # validates the selected capacity, every source and original history.
            native_raw = raw
            supplier_selection = funding_report = reconciliation_account = None
            cash_account = supplier_account = performance_report = delivery_queue = None
        else:
            native_raw, supplier_selection = supplier_statements.unwrap_bundle(raw)
            native_raw, funding_report = funding.unwrap_bundle(native_raw)
            native_raw, reconciliation_account = account_reconciliation.unwrap_bundle(native_raw)
            native_raw, cash_account = cash_accounts.unwrap_bundle(native_raw)
            native_raw, supplier_account = payables.unwrap_bundle(native_raw)
            native_raw, performance_report = performance.unwrap_bundle(native_raw)
            native_raw, delivery_queue = dispatch.unwrap_bundle(native_raw)
        document, files = self._unpack(native_raw)
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
        dcat_sources.source_budget(sources.values())
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
        cash_accounts.validate_import(context, events, files)
        statements.validate_import(context, events, files)
        statement_profiles.validate_import(context, events, files)
        has_settlements = settlement_sources.validate_import(context, events, reviews, files)
        if bool(has_settlements) != settlement_sources.DERIVED_FILES.issubset(files):
            domain.fail("The complete merchant source report set is missing or unbound.", "SETTLEMENT_IMPORT_SOURCE")
        if has_settlements:
            if (files["merchant-settlements.json"] != (canonical(settlement_sources.observations(context)) + "\n").encode()
                    or files["merchant-settlements.csv"] != csv_bytes(settlement_sources.CSV_FIELDS, settlement_sources.csv_rows(context))
                    or json.loads(files["summary.json"]).get("merchantSettlements") != settlement_sources.report(context)):
                domain.fail("A merchant source report differs from its original source and cash associations.", "SETTLEMENT_IMPORT_SOURCE")
        account_reconciliation.validate_import(context, events, files)
        has_node = buyer.validate_node_import(context, events, reviews, files)
        node_names = {"node-accounting-observations.json", "node-accounting-observations.csv"}
        node_view = buyer.node_observations(context)
        if bool(node_view) != node_names.issubset(files):
            domain.fail("The complete Node source report set is missing or unbound.", "BUYER_NODE_RECEIVING_SOURCE")
        if node_view:
            if (files["node-accounting-observations.json"] != (canonical(node_view) + "\n").encode()
                    or files["node-accounting-observations.csv"] != csv_bytes(buyer.NODE_CSV_FIELDS, buyer.node_csv_rows(context))
                    or json.loads(files["summary.json"]).get("delivery", {}).get("nodeAccounting") != buyer.node_report(context)):
                domain.fail("A Node operating report differs from its original source associations.", "BUYER_NODE_RECEIVING_SOURCE")
        saved_amendments = amendments.validate_import(self, context, document.get("amendments", []), events, files["planning.zip"],
                                                       work_intakes=document.get("workIntakes", []))
        amendments.validate_files(saved_amendments, files)
        def selected_plan_at(version):
            return amendments.plan_at(saved_amendments, plan, version)
        expense_records = expenses.validate_import(context, document.get("expenseRecords"), events, reviews, files,
                                                    plan_for_version=selected_plan_at)
        if expenses.has_records(expense_records):
            context["expenseRecords"] = expense_records
        cohort.validate_import(reviews, events)
        completion.validate_import(context, document.get("completionPlans", []), reviews, events, source_program["version"],
                                   plan_history=saved_amendments)
        saved_installations = document.get("installations", [])
        installations.validate_import(context, saved_installations, events, source_program["version"], files,
                                      plan_for_version=selected_plan_at)
        from operations_completion_installations import validate_import as validate_completion_installations
        validate_completion_installations(document.get("completionPlans", []), reviews, events, saved_installations)
        buyer.validate_customer_use_import(context, events, reviews, files, saved_installations)
        task_outcomes.validate_import(context, events, files, saved_installations, plan_for_version=selected_plan_at)
        issuer_receiving.validate_import(context, events, files)
        award_terms.validate_import(context, events, files, plan_for_version=selected_plan_at, saved_amendments=saved_amendments)
        selected_award_terms = award_terms.selection_from_files(document, files)
        selected_task_outcomes = task_outcomes.selection_from_files(document, files)
        expense_billing_rows = expense_billing.validate_import(document.get("expenseBilling"), context, events, files)
        work_billing_rows = work_billing.validate_import(document.get("workBilling"), context, events, files)
        commercial_rows = document.get("commercialReceivables")
        if commercial_rows is not None:
            commercial_rows = commercial_receivables.validate_import(
                commercial_rows, reader=lambda ident: files["sources/" + ident])
        change_rows = document.get("commercialChanges")
        if change_rows is not None:
            change_rows = commercial_changes.validate_import(change_rows)
            if commercial_rows is None:
                domain.fail("Milestone changes require their original billing source.", "COMMERCIAL_CHANGE_SOURCE", 422)
        dispatch.validate_received(delivery_queue, document)
        performance.validate_received(performance_report, document)
        payables.validate_received(supplier_account, document)
        cash_accounts.validate_received(cash_account, document)
        account_reconciliation.validate_received(reconciliation_account, document, files)
        implementation.validate_import(context, reviews, events, saved_installations, files)
        installation_returns.validate_import(context, reviews, events, saved_installations, files,
                                              plan_for_version=selected_plan_at)
        selected_installation_return = installation_returns.selection_from_files(document, files)
        refs = installations.latest_refs(saved_installations)
        if document.get("installationRefs", []) != refs:
            domain.fail("The selected installation heads differ from their complete retained editions.")
        saved_work_intakes = work_intake.validate_import(context, document.get("workIntakes", []), events, files,
                                                        plan_for_version=selected_plan_at)
        funding.validate_import(context, events, files, saved_work_intakes, plan_for_version=selected_plan_at)
        selected_funding = funding.validate_received(funding_report, document, files)
        workbooks.validate_import(context, reviews, events, files, selected_plan_at, saved_work_intakes)
        supplier_statements.validate_import(context, reviews, events, files, selected_plan_at, saved_work_intakes)
        supplier_statements.validate_received(supplier_selection, document, files)
        intake_refs = work_intake.refs(saved_work_intakes)
        if document.get("workIntakeRefs", []) != intake_refs:
            domain.fail("The current work/invoice intake selections differ from their complete saved editions.", "INTAKE_RECEIVING")
        selected_installation = installations.selection_from_files(document, files)
        saved_forecasts = document.get("forecasts", [])
        if not isinstance(saved_forecasts, list) or len(saved_forecasts) > forecasts.MAX_FORECASTS:
            domain.fail("The complete retained forecast set is invalid.", "INVALID_FORECAST")
        forecast_ids = set()
        for value in saved_forecasts:
            original_version = domain.integer(value.get("version"), "Forecast save version", 2, source_program["version"])
            forecasts.validate_saved(value, selected_plan_at(original_version - 1))
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
            original_version = domain.integer(value.get("version"), "Portfolio save version", 2, source_program["version"])
            portfolios.validate_saved(value, selected_plan_at(original_version - 1))
            portfolio_installations.validate_import(value, context, saved_installations, files)
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
        selected_risks = risks.validate_import(context, reviews, events, files, selected_plan_at)
        selected_risk_comparison = risk_comparison.validate_import(context, reviews, files)
        selected_engagement = engagements.validate_import(
            context, reviews, events, saved_forecasts, saved_portfolios, files)
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
            if any(review.get("purpose") == supplier_statements.PURPOSE for review in reviews) or source_program.get("origin", {}).get("supplierStatementPrograms"):
                origin["supplierStatementPrograms"] = supplier_statements.retained_program_ancestry(source_program)
            if performance_report:
                origin["performance"] = performance.received_selection(performance_report)
            if supplier_account:
                origin["supplierAccount"] = payables.received_selection(supplier_account)
            if cash_account:
                origin["cashAccount"] = cash_accounts.received_selection(cash_account)
            if reconciliation_account:
                origin["accountReconciliation"] = account_reconciliation.received_selection(reconciliation_account)
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
            expenses.save_import(self, pid, expense_records)
            for value in document.get("completionPlans", []):
                completion.save_row(self, pid, value)
            amendments.import_rows(self, pid, saved_amendments)
            for value in saved_installations:
                self.db.execute("INSERT INTO ops_installations VALUES(?,?,?,?)",
                                (pid, value["id"], value["revision"], canonical(value)))
            for value in saved_work_intakes:
                work_intake.save_row(self, pid, value)
            if commercial_rows is not None:
                self.commercial.restore_rows(pid, commercial_rows)
            if change_rows is not None:
                self.commercial_changes.restore_rows(pid, change_rows)
            self.expense_billing.restore_rows(pid, expense_billing_rows)
            self.work_billing.restore_rows(pid, work_billing_rows)
            for value in saved_forecasts:
                self.db.execute("INSERT INTO ops_forecasts VALUES(?,?,?)", (pid, value["id"], canonical(value)))
            for value in saved_portfolios:
                self.db.execute("INSERT INTO ops_portfolios VALUES(?,?,?)", (pid, value["id"], canonical(value)))
            return {"id": pid, "version": source_program["version"], "action": "import", "planId": imported["id"], "mode": source_program["mode"],
                    **({"selectedSupplierStatement": {"id": supplier_selection["review"]["id"],
                        "sha256": supplier_selection["review"]["sha256"],
                        "statementId": supplier_selection["review"]["supplierStatement"]["document"]["statementId"]}} if supplier_selection else {}),
                    **({"selectedInstallation": selected_installation} if selected_installation else {}),
                    **({"selectedTaskOutcomes": selected_task_outcomes} if selected_task_outcomes else {}),
                    **({"selectedFunding": selected_funding} if selected_funding else {}),
                    **({"selectedAwardTerms": selected_award_terms} if selected_award_terms else {}),
                    **({"selectedRisks": selected_risks} if selected_risks else {}),
                    **({"selectedRiskComparison": selected_risk_comparison} if selected_risk_comparison else {}),
                    **({"selectedEngagement": selected_engagement} if selected_engagement else {}),
                    **({"selectedInstallationReturn": selected_installation_return} if selected_installation_return else {}),
                    **({"deliveryQueue": {"asOfDate": delivery_queue["asOfDate"], "sha256": delivery_queue["sha256"]}} if delivery_queue else {}),
                    **({"performance": performance.received_selection(performance_report)} if performance_report else {}),
                    **({"supplierAccount": payables.received_selection(supplier_account)} if supplier_account else {}),
                    **({"cashAccount": cash_accounts.received_selection(cash_account)} if cash_account else {}),
                    **({"accountReconciliation": account_reconciliation.received_selection(reconciliation_account)} if reconciliation_account else {})}
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
