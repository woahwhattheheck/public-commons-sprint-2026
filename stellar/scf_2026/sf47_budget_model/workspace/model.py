"""Retained operator planning over the original SF47 Decimal calculator."""
from __future__ import annotations

from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import fcntl
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import sqlite3
import threading
import uuid
import zipfile
import csv

HERE = Path(__file__).resolve().parent
CALCULATOR = HERE.parent / "budget.py"
spec = importlib.util.spec_from_file_location("sf47_original_budget", CALCULATOR)
budget = importlib.util.module_from_spec(spec)
spec.loader.exec_module(budget)
SCHEMA = "stellar-forge.sf47-planning.v1"
SOURCE_URL = "https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/main/stellar/scf_2026/sf47_budget_model"
MAX_ITEMS = 200
MAX_BUNDLE = 32 * 1024 * 1024


class Problem(ValueError):
    def __init__(self, message, status=422, code="INVALID_PLAN"):
        super().__init__(message)
        self.status, self.code = status, code


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def now():
    return datetime.now(timezone.utc).isoformat()


def text(value, label, maximum=12000, required=False):
    if not isinstance(value, str) or len(value) > maximum or "\x00" in value:
        raise Problem(f"{label}: use text up to {maximum} characters.")
    if required and not value.strip():
        raise Problem(f"{label}: enter a value.")
    return value.strip()


def number(raw, label, maximum=None):
    try:
        result = budget.value(raw, label)
    except (ValueError, TypeError) as exc:
        raise Problem(str(exc)) from exc
    if maximum is not None and result > Decimal(str(maximum)):
        raise Problem(f"{label}: maximum is {maximum}.")
    return result


def day(raw, label, minimum=0, maximum=500):
    if isinstance(raw, bool) or not isinstance(raw, int) or not minimum <= raw <= maximum:
        raise Problem(f"{label}: enter a whole day from {minimum} to {maximum}.")
    return raw


def short_id(raw, label):
    raw = text(raw, label, 100, True)
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", raw):
        raise Problem(f"{label}: use letters, numbers, dots, hyphens or underscores.")
    return raw


def rows(value, label, maximum=MAX_ITEMS):
    if not isinstance(value, list) or len(value) > maximum:
        raise Problem(f"{label}: use an array with at most {maximum} rows.")
    if any(not isinstance(row, dict) for row in value):
        raise Problem(f"{label}: every row must be an object.")
    return value


def checked_model(scenario):
    try:
        return budget.model(scenario)
    except (ValueError, KeyError, TypeError, ArithmeticError, AttributeError) as exc:
        raise Problem(str(exc)) from exc


def merge_scenario(base, patch):
    """A normal edit preserves source metadata, acceptance targets and row identity."""
    if not isinstance(patch, dict):
        raise Problem("Scenario edits must be an object.")
    allowed = {"scenario_name", "award_request_usd", "project_end_day", "milestones", "future_costs"}
    unknown = set(patch) - allowed
    if unknown:
        raise Problem("Use the source import workflow for metadata changes: " + ", ".join(sorted(unknown)))
    scenario = deepcopy(base)
    for key in ("scenario_name", "award_request_usd", "project_end_day"):
        if key in patch:
            scenario[key] = patch[key]
    if "milestones" in patch:
        prior = {row["tranche"]: row for row in base.get("milestones", [])}
        merged = []
        for item in rows(patch["milestones"], "Milestones"):
            if item.get("tranche") not in (1, 2, 3):
                raise Problem("Milestone tranche must be 1, 2 or 3.")
            editable = {"tranche", "submit_day", "review_and_payment_lag_days", "deliverable", "measurable_proof"}
            if set(item) - editable:
                raise Problem("Milestone edits contain an unknown field.")
            merged.append({**deepcopy(prior.get(item["tranche"], {})), **item})
        scenario["milestones"] = merged
    if "future_costs" in patch:
        prior = {row["id"]: row for row in base.get("future_costs", [])}
        merged = []
        editable = {"id", "tranche", "start_day", "end_day", "estimated_hours", "assumed_hourly_rate_usd",
                    "amount_usd", "category", "remaining_work", "measurable_proof"}
        for item in rows(patch["future_costs"], "Work packages"):
            cid = short_id(item.get("id"), "Work package ID")
            if set(item) - editable:
                raise Problem(f"{cid}: an edit contains an unknown field.")
            row = {**deepcopy(prior.get(cid, {"future_only": True,
                   "quote_status": "OPERATOR_PLANNING_INPUT"})), **item}
            merged.append(row)
        scenario["future_costs"] = merged
    text(scenario.get("scenario_name", ""), "Scenario name", 500, True)
    return scenario


def prepare(scenario, raw_planning=None):
    scenario = deepcopy(scenario)
    if not isinstance(scenario, dict):
        raise Problem("Import a scenario JSON object.")
    costs = rows(scenario.get("future_costs"), "Work packages")
    if not costs:
        raise Problem("Add at least one work package.")
    planning = deepcopy(raw_planning or {})
    if not isinstance(planning, dict):
        raise Problem("Planning settings must be an object.")
    allowed = {"calendarStart", "capitalUsd", "capitalNote", "contributors", "assignments",
               "pricing", "payments", "deliveryNotes", "notes"}
    if set(planning) - allowed:
        raise Problem("Unknown planning setting: " + ", ".join(sorted(set(planning) - allowed)))
    pricing = planning.get("pricing", {})
    payments = planning.get("payments", {})
    if not isinstance(pricing, dict) or not isinstance(payments, dict):
        raise Problem("Pricing and payment schedules must be objects.")
    ids = []
    total_hours = Decimal(0)
    rates = set()
    for item in costs:
        cid = short_id(item.get("id"), "Work package ID")
        ids.append(cid)
        mode = pricing.get(cid, "hours" if "estimated_hours" in item and "assumed_hourly_rate_usd" in item else "fixed")
        if mode not in ("hours", "fixed"):
            raise Problem(f"{cid}: choose hours or fixed pricing.")
        pricing[cid] = mode
        hours = number(item.get("estimated_hours", 0), f"{cid}: estimated hours", 100000)
        item["estimated_hours"] = str(hours)
        total_hours += hours
        if mode == "hours":
            rate = number(item.get("assumed_hourly_rate_usd"), f"{cid}: hourly rate", 100000)
            if hours <= 0 or rate <= 0:
                raise Problem(f"{cid}: enter positive hours and hourly rate.")
            item["assumed_hourly_rate_usd"] = str(rate)
            item["amount_usd"] = budget.cents(hours * rate)
            rates.add(str(rate))
        else:
            item["amount_usd"] = budget.cents(number(item.get("amount_usd"), f"{cid}: amount"))
        for field in ("remaining_work", "measurable_proof"):
            text(item.get(field, ""), f"{cid}: {field.replace('_', ' ')}", required=field == "measurable_proof")
    if len(ids) != len(set(ids)):
        raise Problem("Work package IDs must be unique.")
    if set(pricing) - set(ids) or set(payments) - set(ids):
        raise Problem("Remove pricing or payment entries for deleted work packages.")
    planning["pricing"] = pricing
    # A local revision retains the original basis text and reports current totals separately.
    original_report = checked_model(scenario)
    calendar_start = planning.get("calendarStart") or None
    if calendar_start:
        try:
            calendar_start = date.fromisoformat(calendar_start).isoformat()
        except (TypeError, ValueError) as exc:
            raise Problem("Day-zero calendar date must be YYYY-MM-DD.") from exc
    planning["calendarStart"] = calendar_start
    capital = planning.get("capitalUsd")
    planning["capitalUsd"] = None if capital in (None, "") else budget.cents(number(capital, "Working-capital input", 100000000))
    planning["capitalNote"] = text(planning.get("capitalNote", ""), "Working-capital note", 4000)
    planning["notes"] = text(planning.get("notes", ""), "Planning notes", 20000)
    contributors = rows(planning.get("contributors", []), "Contributors")
    seen = set()
    for person in contributors:
        pid = short_id(person.get("id"), "Contributor ID")
        if pid in seen:
            raise Problem("Contributor IDs must be unique.")
        seen.add(pid)
        person["name"] = text(person.get("name"), "Contributor name", 200, True)
        person["weeklyHours"] = str(number(person.get("weeklyHours"), "Weekly capacity", 168))
        person["note"] = text(person.get("note", ""), "Contributor source / note", 2000)
    planning["contributors"] = contributors
    by_cost = {item["id"]: item for item in costs}
    allocated = {cid: Decimal(0) for cid in ids}
    assignments = rows(planning.get("assignments", []), "Assignments")
    for assignment in assignments:
        cid, pid = assignment.get("costId"), assignment.get("contributorId")
        if cid not in by_cost or pid not in seen:
            raise Problem("Every assignment needs a current work package and contributor.")
        hours = number(assignment.get("hours"), "Assigned hours", 100000)
        if hours <= 0:
            raise Problem("Assigned hours must be positive.")
        assignment["hours"] = str(hours)
        allocated[cid] += hours
    for cid, count in allocated.items():
        if count > number(by_cost[cid]["estimated_hours"], "Estimated hours"):
            raise Problem(f"{cid}: assigned hours exceed the package's estimated hours.")
    planning["assignments"] = assignments
    normalized_payments = {}
    for item in costs:
        cid, amount = item["id"], number(item["amount_usd"], "Work package amount")
        payment = deepcopy(payments.get(cid, {"mode": "accrual"}))
        if not isinstance(payment, dict):
            raise Problem(f"{cid}: payment schedule must be an object.")
        mode = payment.get("mode", "accrual")
        payment["mode"] = mode
        payment["note"] = text(payment.get("note", ""), f"{cid}: payment timing source", 4000)
        if mode == "completion":
            payment["lagDays"] = day(payment.get("lagDays", 0), f"{cid}: payment delay", 0, 365)
            if item["end_day"] + payment["lagDays"] > 500:
                raise Problem(f"{cid}: planned payment exceeds day 500.")
            payment.pop("installments", None)
        elif mode == "installments":
            entries = rows(payment.get("installments", []), f"{cid}: installments")
            if not entries:
                raise Problem(f"{cid}: add the payment installments.")
            total = Decimal(0)
            for entry in entries:
                entry["day"] = day(entry.get("day"), f"{cid}: installment day")
                part = number(entry.get("usd"), f"{cid}: installment USD")
                if part <= 0:
                    raise Problem(f"{cid}: installments must be positive.")
                entry["usd"] = budget.cents(part)
                total += Decimal(entry["usd"])
            if total != amount:
                raise Problem(f"{cid}: installment total {budget.cents(total)} must equal {budget.cents(amount)}.")
            payment["installments"] = sorted(entries, key=lambda entry: entry["day"])
            payment.pop("lagDays", None)
        elif mode == "accrual":
            payment.pop("installments", None)
            payment.pop("lagDays", None)
        else:
            raise Problem(f"{cid}: choose accrual, completion or installments.")
        normalized_payments[cid] = payment
    planning["payments"] = normalized_payments
    notes = planning.get("deliveryNotes", {})
    if not isinstance(notes, dict) or set(notes) - {"1", "2", "3"}:
        raise Problem("Delivery notes use tranche keys 1, 2 and 3.")
    planning["deliveryNotes"] = {key: text(value, "Delivery owner / notes", 12000) for key, value in notes.items()}
    return scenario, planning, original_report


def timeline(scenario, planning, original_report):
    """Daily presentation of native accrual plus a separately entered cash schedule."""
    costs = scenario["future_costs"]
    payouts = original_report["payouts"]
    cutoff = max(scenario["project_end_day"], max(row["hypothetical_paid_day"] for row in payouts))
    for item in costs:
        p = planning["payments"][item["id"]]
        if p["mode"] == "completion":
            cutoff = max(cutoff, item["end_day"] + p["lagDays"])
        elif p["mode"] == "installments":
            cutoff = max(cutoff, max(row["day"] for row in p["installments"]))
    daily = []
    peak, worst = Decimal(0), 0
    total_accrued = Decimal(0)
    capital = None if planning["capitalUsd"] is None else Decimal(planning["capitalUsd"])
    start = date.fromisoformat(planning["calendarStart"]) if planning["calendarStart"] else None
    for offset in range(cutoff + 1):
        accrued, due = Decimal(0), Decimal(0)
        for item in costs:
            amount = Decimal(item["amount_usd"])
            span = item["end_day"] - item["start_day"] + 1
            elapsed = max(0, min(offset, item["end_day"]) - item["start_day"] + 1)
            partial = amount * Decimal(elapsed) / Decimal(span)
            accrued += partial
            p = planning["payments"][item["id"]]
            if p["mode"] == "accrual":
                due += partial
            elif p["mode"] == "completion":
                due += amount if offset >= item["end_day"] + p["lagDays"] else 0
            else:
                due += sum((Decimal(row["usd"]) for row in p["installments"] if row["day"] <= offset), Decimal(0))
        received = sum((Decimal(str(scenario["award_request_usd"])) * budget.SHARES[row["tranche"]]
                        for row in payouts if row["hypothetical_paid_day"] <= offset), Decimal(0))
        gap = max(Decimal(0), due - received)
        if gap > peak:
            peak, worst = gap, offset
        daily.append({"day": offset, "date": (start + timedelta(days=offset)).isoformat() if start else "",
                      "accruedUsd": budget.cents(accrued), "plannedOutflowUsd": budget.cents(due),
                      "conditionalInflowUsd": budget.cents(received), "cashGapUsd": budget.cents(gap),
                      "gapAfterCapitalInputUsd": None if capital is None else budget.cents(max(Decimal(0), gap-capital)),
                      "accruedUnpaidUsd": budget.cents(max(Decimal(0), accrued-due))})
        total_accrued = accrued
    return {"days": daily, "peakCashGapUsd": budget.cents(peak), "peakCashGapDay": worst,
            "capitalInputUsd": planning["capitalUsd"],
            "gapAfterCapitalInputUsd": None if capital is None else budget.cents(max(Decimal(0), peak-capital)),
            "lastModeledDay": cutoff, "totalCostUsd": budget.cents(total_accrued)}


def capacity(scenario, planning):
    costs = {item["id"]: item for item in scenario["future_costs"]}
    people = []
    assigned = {cid: Decimal(0) for cid in costs}
    for person in planning["contributors"]:
        daily = [Decimal(0)] * (scenario["project_end_day"] + 1)
        total = Decimal(0)
        for item in planning["assignments"]:
            if item["contributorId"] != person["id"]:
                continue
            row, hours = costs[item["costId"]], Decimal(item["hours"])
            assigned[item["costId"]] += hours
            total += hours
            per_day = hours / Decimal(row["end_day"] - row["start_day"] + 1)
            for offset in range(row["start_day"], row["end_day"] + 1):
                daily[offset] += per_day
        weekly = Decimal(person["weeklyHours"])
        overload = [i for i, hours in enumerate(daily) if hours * 7 > weekly]
        people.append({"id": person["id"], "name": person["name"], "totalHours": str(total),
                       "weeklyCapacityHours": str(weekly), "peakWeeklyRequiredHours": budget.cents(max(daily) * 7),
                       "overloadedDays": len(overload), "firstOverloadedDay": min(overload) if overload else None,
                       "lastOverloadedDay": max(overload) if overload else None})
    unassigned = [{"costId": cid, "hours": str(Decimal(row["estimated_hours"]) - assigned[cid])}
                  for cid, row in costs.items()]
    return {"contributors": people, "unassigned": unassigned,
            "unassignedHours": str(sum((Decimal(row["hours"]) for row in unassigned), Decimal(0))),
            "totalHours": str(sum((Decimal(row["estimated_hours"]) for row in costs.values()), Decimal(0))),
            "allocationBasis": "Package hours are distributed evenly across its inclusive calendar-day span; weekly equivalent is seven days."}


def report(scenario, planning):
    scenario, planning, native = prepare(scenario, planning)
    comparisons = []
    for lag in (14, 30, 60):
        variation = deepcopy(scenario)
        for milestone in variation["milestones"]:
            milestone["review_and_payment_lag_days"] = lag
        try:
            computed = checked_model(variation)
            cash = timeline(variation, planning, computed)
            comparisons.append({"lagDays": lag, "valid": True, "nativePeakUsd": computed["peak_prefunding_gap_usd"],
                                "nativePeakDay": computed["peak_gap_day"], "cashPeakUsd": cash["peakCashGapUsd"],
                                "cashPeakDay": cash["peakCashGapDay"],
                                "lastPaymentDay": max(row["hypothetical_paid_day"] for row in computed["payouts"]),
                                "payouts": computed["payouts"]})
        except Problem as exc:
            comparisons.append({"lagDays": lag, "valid": False, "error": str(exc)})
    result = {"schema": SCHEMA, "calculatorSha256": hashlib.sha256(CALCULATOR.read_bytes()).hexdigest(),
              "scenarioSha256": digest(scenario), "originalModel": native,
              "cash": timeline(scenario, planning, native), "capacity": capacity(scenario, planning),
              "lagComparisons": comparisons,
              "deliveryPlan": deepcopy(scenario.get("deployment_acceptance_plan")),
              "sourceUrl": SOURCE_URL}
    return scenario, planning, result


def csv_bytes(headers, records):
    stream = io.StringIO(newline="")
    writer = csv.writer(stream, lineterminator="\r\n")
    writer.writerow(headers)
    for record in records:
        values = []
        for header in headers:
            value = record.get(header, "")
            value = "" if value is None else str(value)
            if value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")):
                value = "'" + value
            values.append(value)
        writer.writerow(values)
    return stream.getvalue().encode("utf-8-sig")


class Workspace:
    def __init__(self, root, source_path):
        self.root = Path(root).expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.lock_handle = None
        self.db = None
        self.mutex = threading.RLock()
        try:
            self.lock_handle = open(self.root / "workspace.lock", "a+b")
            try:
                fcntl.flock(self.lock_handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as exc:
                raise Problem("This planning workspace is already open.", 409, "WORKSPACE_OPEN") from exc
            self.db = sqlite3.connect(self.root / "planning.sqlite3", timeout=20, check_same_thread=False, isolation_level=None)
            self.db.execute("PRAGMA foreign_keys=ON")
            self.db.execute("PRAGMA journal_mode=WAL")
            self.db.executescript("""
                CREATE TABLE IF NOT EXISTS plans(
                  id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL,
                  source_json TEXT NOT NULL, source_sha TEXT NOT NULL, source_name TEXT NOT NULL,
                  source_url TEXT NOT NULL, current_revision INTEGER NOT NULL, source_bytes BLOB NOT NULL);
                CREATE TABLE IF NOT EXISTS revisions(
                  plan_id TEXT NOT NULL REFERENCES plans(id), revision INTEGER NOT NULL,
                  scenario_json TEXT NOT NULL, planning_json TEXT NOT NULL, report_json TEXT NOT NULL,
                  created_at TEXT NOT NULL, note TEXT NOT NULL, content_sha TEXT NOT NULL,
                  PRIMARY KEY(plan_id,revision));
                CREATE TABLE IF NOT EXISTS requests(
                  request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result_json TEXT NOT NULL);
            """)
            if "source_bytes" not in {row[1] for row in self.db.execute("PRAGMA table_info(plans)")}:
                self.db.execute("ALTER TABLE plans ADD COLUMN source_bytes BLOB")
                candidate = Path(source_path).read_bytes() if Path(source_path).is_file() else b""
                for pid, body, sha in self.db.execute("SELECT id,source_json,source_sha FROM plans"):
                    for raw in (candidate, body.encode()):
                        if hashlib.sha256(raw).hexdigest() == sha:
                            self.db.execute("UPDATE plans SET source_bytes=? WHERE id=?", (raw, pid))
                            break
            if not self.db.execute("SELECT 1 FROM plans LIMIT 1").fetchone():
                path = Path(source_path).resolve()
                raw = path.read_bytes()
                scenario = json.loads(raw)
                self.create("Current SCF delivery plan", scenario, {}, "Imported current source scenario",
                            "initial-current-scenario", source_name=path.name,
                            source_sha=hashlib.sha256(raw).hexdigest(), source_url=SOURCE_URL, source_bytes=raw)
            for path in self.root.glob("planning.sqlite3*"):
                os.chmod(path, 0o600)
        except BaseException:
            self.close()
            raise

    def close(self):
        with self.mutex:
            try:
                if self.db is not None:
                    self.db.close()
                    self.db = None
            finally:
                if self.lock_handle is not None:
                    self.lock_handle.close()
                    self.lock_handle = None

    def _transaction(self, request_id, payload, action):
        request_id = short_id(request_id, "Request ID")
        fingerprint = digest(payload)
        with self.mutex:
            self.db.execute("BEGIN IMMEDIATE")
            try:
                prior = self.db.execute("SELECT fingerprint,result_json FROM requests WHERE request_id=?", (request_id,)).fetchone()
                if prior:
                    if prior[0] != fingerprint:
                        raise Problem("This request ID already belongs to a different action.", 409, "REQUEST_CONFLICT")
                    self.db.execute("COMMIT")
                    return json.loads(prior[1])
                result = action()
                self.db.execute("INSERT INTO requests VALUES(?,?,?)", (request_id, fingerprint, canonical(result)))
                self.db.execute("COMMIT")
                return result
            except BaseException:
                self.db.execute("ROLLBACK")
                raise

    def list(self):
        with self.mutex:
            return [{"id": row[0], "name": row[1], "revision": row[2], "createdAt": row[3]}
                    for row in self.db.execute("SELECT id,name,current_revision,created_at FROM plans ORDER BY created_at,id")]

    def _read(self, plan_id, revision=None):
        item = self.db.execute("SELECT id,name,created_at,source_json,source_sha,source_name,source_url,current_revision FROM plans WHERE id=?", (plan_id,)).fetchone()
        if not item:
            raise Problem("Planning scenario not found.", 404, "PLAN_NOT_FOUND")
        chosen = item[7] if revision is None else day(revision, "Revision", 1, 1000000)
        row = self.db.execute("SELECT revision,scenario_json,planning_json,report_json,created_at,note,content_sha FROM revisions WHERE plan_id=? AND revision=?", (plan_id, chosen)).fetchone()
        if not row:
            raise Problem("Saved revision not found.", 404, "REVISION_NOT_FOUND")
        return {"id": item[0], "name": item[1], "createdAt": item[2], "currentRevision": item[7],
                "source": {"sha256": item[4], "filename": item[5], "url": item[6]},
                "revision": row[0], "scenario": json.loads(row[1]), "planning": json.loads(row[2]),
                "report": json.loads(row[3]), "savedAt": row[4], "note": row[5], "contentSha256": row[6]}

    def read(self, plan_id, revision=None):
        with self.mutex:
            return self._read(plan_id, revision)

    def history(self, plan_id):
        with self.mutex:
            self._read(plan_id)
            return [{"revision": row[0], "savedAt": row[1], "note": row[2], "sha256": row[3]}
                    for row in self.db.execute("SELECT revision,created_at,note,content_sha FROM revisions WHERE plan_id=? ORDER BY revision DESC", (plan_id,))]

    def _append(self, plan_id, revision, scenario, planning, computed, note):
        body_sha = digest({"scenario": scenario, "planning": planning})
        self.db.execute("INSERT INTO revisions VALUES(?,?,?,?,?,?,?,?)",
                        (plan_id, revision, canonical(scenario), canonical(planning), canonical(computed), now(), note, body_sha))
        self.db.execute("UPDATE plans SET current_revision=? WHERE id=?", (revision, plan_id))
        return self._read(plan_id)

    def create(self, name, scenario, planning, note, request_id, source_name="imported-scenario.json", source_sha=None, source_url=SOURCE_URL, original_source=None, source_bytes=None):
        name = text(name, "Plan name", 200, True)
        note = text(note, "Revision note", 4000, True)
        source = deepcopy(scenario if original_source is None else original_source)
        raw_source = canonical(source).encode() if source_bytes is None else bytes(source_bytes)
        raw_sha = hashlib.sha256(raw_source).hexdigest()
        if source_sha is not None and source_sha != raw_sha:
            raise Problem("The original source bytes do not match their source digest.")
        try:
            if canonical(json.loads(raw_source)) != canonical(source):
                raise Problem("The original source bytes do not match their parsed scenario.")
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise Problem("The original source bytes are not readable JSON.") from exc
        source_sha = raw_sha
        scenario, planning, computed = report(scenario, planning)
        payload = {"action": "create", "name": name, "source": source, "scenario": scenario, "planning": planning, "note": note,
                   "sourceName": source_name, "sourceSha": source_sha, "sourceUrl": source_url}
        def action():
            plan_id = "plan-" + uuid.uuid4().hex
            self.db.execute("INSERT INTO plans VALUES(?,?,?,?,?,?,?,0,?)",
                            (plan_id, name, now(), canonical(source), source_sha, source_name, source_url, raw_source))
            return self._append(plan_id, 1, scenario, planning, computed, note)
        return self._transaction(request_id, payload, action)

    def estimate(self, plan_id, expected_revision, patch, planning):
        with self.mutex:
            current = self._read(plan_id)
            if current["currentRevision"] != expected_revision:
                raise Problem("A newer saved revision exists. Reopen it before editing.", 409, "REVISION_CONFLICT")
            scenario, planning, computed = report(merge_scenario(current["scenario"], patch), planning)
            return {"scenario": scenario, "planning": planning, "report": computed}

    def save(self, plan_id, expected_revision, patch, planning, note, request_id):
        note = text(note, "Revision note", 4000, True)
        payload = {"action": "save", "id": plan_id, "expectedRevision": expected_revision,
                   "patch": patch, "planning": planning, "note": note}
        def action():
            current = self._read(plan_id)
            if current["currentRevision"] != expected_revision:
                raise Problem("A newer saved revision exists. Reopen it before editing.", 409, "REVISION_CONFLICT")
            scenario, normalized, computed = report(merge_scenario(current["scenario"], patch), planning)
            if digest({"scenario": scenario, "planning": normalized}) == current["contentSha256"]:
                return {**current, "unchanged": True}
            return self._append(plan_id, current["currentRevision"] + 1, scenario, normalized, computed, note)
        return self._transaction(request_id, payload, action)

    def restore(self, plan_id, expected_revision, selected_revision, note, request_id):
        note = text(note, "Restore note", 4000, True)
        payload = {"action": "restore", "id": plan_id, "expectedRevision": expected_revision,
                   "selectedRevision": selected_revision, "note": note}
        def action():
            current = self._read(plan_id)
            if current["currentRevision"] != expected_revision:
                raise Problem("A newer saved revision exists. Reopen it before restoring.", 409, "REVISION_CONFLICT")
            old = self._read(plan_id, selected_revision)
            scenario, planning, computed = report(old["scenario"], old["planning"])
            return self._append(plan_id, current["currentRevision"] + 1, scenario, planning, computed,
                                f"Restored revision {selected_revision}. {note}")
        return self._transaction(request_id, payload, action)

    def clone(self, plan_id, expected_revision, name, request_id):
        name = text(name, "Plan name", 200, True)
        payload = {"action": "clone", "id": plan_id, "expectedRevision": expected_revision, "name": name}
        def action():
            current = self._read(plan_id)
            if current["currentRevision"] != expected_revision:
                raise Problem("A newer saved revision exists. Reopen it before copying.", 409, "REVISION_CONFLICT")
            original = self.db.execute("SELECT source_json,source_sha,source_name,source_url,source_bytes FROM plans WHERE id=?", (plan_id,)).fetchone()
            scenario, planning, computed = report(current["scenario"], current["planning"])
            pid = "plan-" + uuid.uuid4().hex
            self.db.execute("INSERT INTO plans VALUES(?,?,?,?,?,?,?,0,?)",
                            (pid, name, now(), original[0], original[1], original[2], original[3], original[4]))
            return self._append(pid, 1, scenario, planning, computed,
                                f"Copied from {current['name']} revision {current['revision']}")
        return self._transaction(request_id, payload, action)

    def export(self, plan_id):
        with self.mutex:
            current = self._read(plan_id)
            revisions = [self._read(plan_id, row["revision"]) for row in reversed(self.history(plan_id))]
            source_row = self.db.execute("SELECT source_json,source_bytes FROM plans WHERE id=?", (plan_id,)).fetchone()
            original, raw_source = json.loads(source_row[0]), source_row[1]
            if raw_source is None or hashlib.sha256(raw_source).hexdigest() != current["source"]["sha256"]:
                raise Problem("Re-import this plan's original source file to recover its exact retained source bytes.")
        document = {"schema": SCHEMA, "exportedAt": now(), "plan": {"id": current["id"], "name": current["name"],
                    "source": current["source"], "originalScenario": original}, "revisions": revisions}
        files = {
            "original-source.json": bytes(raw_source),
            "workspace.json": (json.dumps(document, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode(),
            "scenario.json": (json.dumps(current["scenario"], ensure_ascii=False, indent=2) + "\n").encode(),
            "planning.json": (json.dumps(current["planning"], ensure_ascii=False, indent=2) + "\n").encode(),
            "original-model.json": (json.dumps(current["report"]["originalModel"], ensure_ascii=False, indent=2) + "\n").encode(),
            "delivery-plan.json": (json.dumps(current["report"]["deliveryPlan"], ensure_ascii=False, indent=2) + "\n").encode(),
            "daily-cash-flow.csv": csv_bytes(["day", "date", "accruedUsd", "plannedOutflowUsd", "conditionalInflowUsd",
                                            "cashGapUsd", "gapAfterCapitalInputUsd", "accruedUnpaidUsd"], current["report"]["cash"]["days"]),
            "work-packages.csv": csv_bytes(["id", "tranche", "start_day", "end_day", "estimated_hours",
                                           "assumed_hourly_rate_usd", "amount_usd", "category", "remaining_work",
                                           "measurable_proof"], current["scenario"]["future_costs"]),
            "contributors.csv": csv_bytes(["id", "name", "weeklyCapacityHours", "totalHours",
                                          "peakWeeklyRequiredHours", "overloadedDays", "firstOverloadedDay",
                                          "lastOverloadedDay"], current["report"]["capacity"]["contributors"]),
            "README.txt": ("SF47 planning workspace\n\nOpen this complete ZIP in the SF47 workspace import control to retain its revision history.\n"
                           "original-source.json retains the exact imported source bytes and their advertised source digest.\n"
                           "scenario.json remains directly usable by the original budget.py calculator.\n"
                           "The current original model, private payment timing, contributor allocation, daily calculations and full deployment plan are included.\n"
                           "Amounts and day offsets are planning inputs. Conditional grant inflows follow the selected original model; contributor payment dates retain each complete package amount.\n"
                           f"Source: {current['source']['url']}\nSource SHA-256: {current['source']['sha256']}\n"
                           f"Saved revision: {current['revision']}\n").encode()
        }
        manifest = {"schema": SCHEMA + ".bundle", "files": [{"path": path, "bytes": len(data),
                    "sha256": hashlib.sha256(data).hexdigest()} for path, data in sorted(files.items())]}
        files["MANIFEST.json"] = (json.dumps(manifest, indent=2) + "\n").encode()
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for path, data in sorted(files.items()):
                info = zipfile.ZipInfo(path, (2026, 1, 1, 0, 0, 0))
                info.external_attr = 0o600 << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, data)
        return out.getvalue()

    def import_bundle(self, raw, name, request_id):
        if len(raw) > MAX_BUNDLE:
            raise Problem("Import is larger than 32 MiB.", 413)
        try:
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                infos = archive.infolist()
                if len(infos) > 20 or len({i.filename for i in infos}) != len(infos):
                    raise Problem("Bundle contains duplicate or excessive entries.")
                if sum(i.file_size for i in infos) > MAX_BUNDLE:
                    raise Problem("Expanded bundle is larger than 32 MiB.", 413)
                allowed = {"workspace.json", "original-source.json", "scenario.json", "planning.json", "original-model.json",
                           "delivery-plan.json", "daily-cash-flow.csv", "work-packages.csv",
                           "contributors.csv", "README.txt", "MANIFEST.json"}
                if {i.filename for i in infos} != allowed:
                    raise Problem("Use a complete SF47 workspace export.")
                manifest = json.loads(archive.read("MANIFEST.json"))
                if manifest.get("schema") != SCHEMA + ".bundle":
                    raise Problem("Unrecognized planning bundle.")
                records = manifest.get("files", [])
                if not isinstance(records, list) or len(records) != len(allowed) - 1 or {r.get("path") for r in records} != allowed - {"MANIFEST.json"}:
                    raise Problem("Bundle manifest is incomplete.")
                for row in records:
                    contents = archive.read(row["path"])
                    if len(contents) != row.get("bytes") or hashlib.sha256(contents).hexdigest() != row.get("sha256"):
                        raise Problem(f"Bundle file differs from its manifest: {row['path']}")
                document = json.loads(archive.read("workspace.json"))
                raw_source = archive.read("original-source.json")
        except (zipfile.BadZipFile, json.JSONDecodeError, KeyError, TypeError, RuntimeError) as exc:
            raise Problem("The selected file is not a complete readable SF47 bundle.") from exc
        if document.get("schema") != SCHEMA:
            raise Problem("Unrecognized workspace document.")
        name = text(name or document["plan"]["name"] + " — imported", "Plan name", 200, True)
        original = document["plan"]["originalScenario"]
        checked_model(original)
        revision_rows = rows(document.get("revisions"), "Saved revisions", maximum=10000)
        if not revision_rows:
            raise Problem("Bundle has no saved revisions.")
        prepared = []
        for sequence, record in enumerate(revision_rows, 1):
            if record.get("revision") != sequence:
                raise Problem("Bundle revisions are not consecutive.")
            if digest({"scenario": record["scenario"], "planning": record["planning"]}) != record.get("contentSha256"):
                raise Problem(f"Revision {sequence}: content digest differs.")
            report(record["scenario"], record["planning"])
            retained_report = record.get("report")
            if not isinstance(retained_report, dict) or retained_report.get("schema") != SCHEMA or retained_report.get("scenarioSha256") != digest(record["scenario"]):
                raise Problem(f"Revision {sequence}: retained report does not match its scenario.")
            prepared.append((record["scenario"], record["planning"], retained_report, text(record["note"], "Revision note", 4000),
                             text(record["savedAt"], "Revision time", 100, True)))
        source = document["plan"]["source"]
        source_sha = text(source.get("sha256"), "Source digest", 64, True)
        if not re.fullmatch("[a-f0-9]{64}", source_sha):
            raise Problem("Invalid source digest.")
        if hashlib.sha256(raw_source).hexdigest() != source_sha:
            raise Problem("The original source file differs from its retained source digest.")
        try:
            if canonical(json.loads(raw_source)) != canonical(original):
                raise Problem("The exact original source file differs from its parsed source scenario.")
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise Problem("The original source file is unreadable JSON.") from exc
        payload = {"action": "import-bundle", "sha256": hashlib.sha256(raw).hexdigest(), "name": name}
        def action():
            pid = "plan-" + uuid.uuid4().hex
            self.db.execute("INSERT INTO plans VALUES(?,?,?,?,?,?,?,0,?)", (
                pid, name, now(), canonical(original), source_sha,
                text(source.get("filename", "imported-scenario.json"), "Source filename", 500, True),
                text(source.get("url", SOURCE_URL), "Source URL", 4000, True), raw_source))
            for sequence, (scenario, planning, computed, note, saved_at) in enumerate(prepared, 1):
                self._append(pid, sequence, scenario, planning, computed, note)
                self.db.execute("UPDATE revisions SET created_at=? WHERE plan_id=? AND revision=?", (saved_at, pid, sequence))
            return self._read(pid)
        return self._transaction(request_id, payload, action)
