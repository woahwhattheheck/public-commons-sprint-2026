"""Accepted original Work to explicit customer hourly obligations.

Work, source files and acceptance remain in Grant Operations. This module records
customer authority and quantity reservations; native Receivables owns all money
documents and uses the common original-request journal.
"""
from __future__ import annotations
import base64
import copy
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import io
import json
import re
import uuid
import zipfile
from html import escape
from model import Problem, canonical, digest, now, short_id, csv_bytes
import operations_domain as domain
from operations_source_billing import (SourceBillingJournal, validate_rows,
    compile_native_steps, assert_native_document)
from operations_commercial_receivables import _required, _amount, _date, _ids
from operations_commercial_changes import _money, _source, _fingerprint, _native_optional
from operations_installation_effort import content_identity

SCHEMA = "stellar-forge.customer-work-billing.v1"
AUTHORITY_SCHEMA = "stellar-forge.customer-hourly-authority.v1"
MODES = ("NEW", "DRAFT_EDIT", "CREDIT", "VOID", "REPLACE")
MAX_SOURCES = 32 * 1024 * 1024
MAX_LINES = 200

def fail(message, code="WORK_BILLING_CONFLICT", status=409):
    raise Problem(message, status, code)

def exact(value, allowed, required=()):
    if not isinstance(value, dict) or set(value) - set(allowed) or not set(required) <= set(value):
        fail("Retain the declared hourly billing fields.", "WORK_BILLING_INPUT", 422)
    return value

def review_refusal(action, operation):
    try:
        return operation()
    except Problem as error:
        if getattr(error, "status", 500) not in (400, 404, 409, 413, 422):
            raise
        raise Problem(str(error), error.status, "WORK_BILLING_" + action + "_REVIEW") from error

def units(value, label="Hour units"):
    if not isinstance(value, str) or not re.fullmatch(r"(?:0|[1-9][0-9]{0,99})", value):
        fail(label + " must be an exact nonnegative integer string.", status=422)
    return int(value)

def hour_units(value):
    if not isinstance(value, str) or not re.fullmatch(r"(?:0|[1-9][0-9]{0,19})(?:\.[0-9]{1,4})?", value):
        fail("Hours must be an exact nonnegative decimal with at most four places.", status=422)
    return int(Decimal(value) * 10000)

def hours(value):
    return str(int(value) // 10000) + "." + str(int(value) % 10000).zfill(4)

def money(value, scale):
    return _amount(value, scale, "Reviewed hourly customer amount")

def currency_value(value):
    exact(value, ("code", "scale"), ("code", "scale"))
    if not isinstance(value["code"], str) or not re.fullmatch(r"[A-Z]{3}", value["code"]) or type(value["scale"]) is not int or not 0 <= value["scale"] <= 6:
        fail("Use a three-letter native currency and zero-to-six decimal precision.", status=422)
    return copy.deepcopy(value)

def work_key(record):
    return digest({"workId": record["id"]})

def active_heads(rows):
    result = {}
    for row in sorted(rows, key=lambda r: (r["chainId"], r["sequence"])):
        if row["state"] != "CANCELLED":
            result[row["chainId"]] = row
    return result

def exposure(rows):
    """A pending correction keeps the greatest old/new exposure per chain.

    Quantity is one original Work identity. Authority amount/hour caps use the
    maximum edition total, not sums of unrelated per-line maxima.
    """
    result = {}
    for chain in {r["chainId"] for r in rows}:
        ordered = sorted((r for r in rows if r["chainId"] == chain and r["state"] != "CANCELLED"), key=lambda r: r["sequence"])
        if not ordered:
            continue
        applied = max((i for i, r in enumerate(ordered) if r["state"] == "APPLIED"), default=-1)
        quantities, limits, authority_totals = {}, {}, {}
        for row in (ordered[applied:] if applied >= 0 else ordered):
            p = row["proposal"]
            selected = [] if row["state"] == "APPLIED" and p["mode"] == "VOID" else p["lines"]
            total_hours, total_amount = 0, 0
            for line in selected:
                key = line["originalKey"]
                quantity = units(line["nativeAmount"])
                quantities[key] = max(quantities.get(key, 0), quantity)
                limits[key] = max(limits.get(key, 0), hour_units(line["work"]["hours"]))
                total_hours += quantity
                total_amount += money(line["amount"], p["currency"]["scale"])[1]
            authority = p["authority"]["familyId"]
            current = authority_totals.setdefault(authority, {"hours": 0, "amount": 0})
            current["hours"] = max(current["hours"], total_hours)
            current["amount"] = max(current["amount"], total_amount)
        result[chain] = {"quantities": quantities, "limits": limits, "authorities": authority_totals}
    return result

def authority_heads(authorities):
    result = {}
    for row in sorted(authorities, key=lambda r: (r["familyId"], r["revision"])):
        result[row["familyId"]] = row
    return result

def validate_exposure(rows, authorities):
    quantities, limits, totals = {}, {}, {}
    for part in exposure(rows).values():
        for key, value in part["quantities"].items():
            quantities[key] = quantities.get(key, 0) + value
            limits[key] = max(limits.get(key, 0), part["limits"][key])
        for key, value in part["authorities"].items():
            total = totals.setdefault(key, {"hours": 0, "amount": 0})
            total["hours"] += value["hours"]
            total["amount"] += value["amount"]
    if any(value > limits.get(key, 0) for key, value in quantities.items()):
        fail("Combined customer charges over-reserve original Work across receiving copies.")
    for key, total in totals.items():
        authority = authority_heads(authorities).get(key)
        if authority is None:
            fail("Retain the original hourly authority with every linked charge.", status=422)
        terms = authority["terms"]
        if terms["hoursCap"] is not None and total["hours"] > hour_units(terms["hoursCap"]):
            fail("The retained customer work charges exceed the whole authority's hour cap.")
        if terms["amountCap"] is not None and total["amount"] > money(terms["amountCap"], terms["currency"]["scale"])[1]:
            fail("The retained customer work charges exceed the whole authority's amount cap.")
    return {"work": quantities, "authorities": totals}

def rate_amount(quantity, rate, scale, rounding):
    numerator = quantity * money(rate, scale)[1]
    if rounding == "EXACT" and numerator % 10000:
        fail("These hours and hourly rate do not produce an exact native minor unit; review a declared rounding policy.", status=422)
    minor = numerator // 10000 if rounding == "EXACT" else (numerator + 5000) // 10000
    return _money(minor, scale)

def normalize_terms(value):
    allowed = ("title", "authorization", "authorizedOn", "sourceIds", "endpointId", "customerId",
        "currency", "periodStart", "periodEnd", "rates", "rounding", "hoursCap", "amountCap")
    exact(value, allowed, allowed)
    currency = currency_value(value["currency"])
    result = {"title": _required(value["title"], "Customer hourly authority", 300),
        "authorization": _required(value["authorization"], "Actual customer terms", 12000),
        "authorizedOn": _date(value["authorizedOn"], "Authorization date"),
        "sourceIds": sorted(_ids(value["sourceIds"], "Customer authority sources")),
        "endpointId": _required(value["endpointId"], "Original accounting connection", 200),
        "customerId": _required(value["customerId"], "Original native customer", 100),
        "currency": currency, "periodStart": _date(value["periodStart"], "Service period start"),
        "periodEnd": _date(value["periodEnd"], "Service period end"), "rates": [],
        "rounding": value["rounding"], "hoursCap": value["hoursCap"], "amountCap": value["amountCap"]}
    if not result["sourceIds"] or result["periodEnd"] < result["periodStart"] or result["rounding"] not in ("EXACT", "HALF_UP"):
        fail("Retain actual customer files, a valid service period and explicit EXACT or HALF_UP rounding.", status=422)
    if result["hoursCap"] is not None:
        result["hoursCap"] = hours(hour_units(result["hoursCap"]))
    if result["amountCap"] is not None:
        result["amountCap"] = money(result["amountCap"], currency["scale"])[0]
    if not isinstance(value["rates"], list) or not 1 <= len(value["rates"]) <= MAX_LINES:
        fail("Retain one-to-200 explicitly scoped hourly rates.", status=422)
    for rate in value["rates"]:
        exact(rate, ("id", "label", "contributorIds", "costIds", "hourlyRate"),
            ("id", "label", "contributorIds", "costIds", "hourlyRate"))
        row = {"id": short_id(rate["id"], "Hourly rate ID"),
            "label": _required(rate["label"], "Hourly rate description", 300),
            "contributorIds": sorted(_ids(rate["contributorIds"], "Rate contributors")),
            "costIds": sorted(_ids(rate["costIds"], "Rate work packages")),
            "hourlyRate": money(rate["hourlyRate"], currency["scale"])[0]}
        if not row["contributorIds"] or not row["costIds"] or money(row["hourlyRate"], currency["scale"])[1] <= 0:
            fail("Each positive rate needs explicitly named contributors and work packages.", status=422)
        result["rates"].append(row)
    if len({r["id"] for r in result["rates"]}) != len(result["rates"]):
        fail("Hourly rate identities must be distinct.", status=422)
    return result

def source_files(operations, program_id, ids):
    result = []
    for ident in sorted(set(ids)):
        metadata, raw = operations.source(program_id, ident)
        result.append({"id": ident, "metadata": copy.deepcopy(metadata), "contentBase64": base64.b64encode(raw).decode("ascii")})
    if sum(len(_source(s)) for s in result) > MAX_SOURCES:
        fail("The complete selected source files exceed 32 MiB.", status=413)
    return result

def work_line(context, selected, authority, correction=False):
    exact(selected, ("workId", "expectedWorkSha256", "rateId", "hours", "description"),
        ("workId", "expectedWorkSha256", "rateId", "hours", "description"))
    work = next((r for r in context["records"]["work"] if r["id"] == selected["workId"]), None)
    if work is None or digest(work) != selected["expectedWorkSha256"]:
        fail("Review the current original Work edition.")
    quantity = hour_units(selected["hours"])
    releasing = correction and quantity == 0
    if not releasing and (work["state"] != "ACCEPTED" or work["fundingBasis"] != "CUSTOMER"):
        fail("Positive customer billing requires accepted CUSTOMER-funded original Work.")
    if quantity > hour_units(work["hours"]) or not correction and quantity == 0:
        fail("Choose a positive portion within the original Work hours.", status=422)
    terms = authority["terms"]
    rate = next((r for r in terms["rates"] if r["id"] == selected["rateId"]), None)
    if rate is None:
        fail("Select an actual retained customer hourly rate.", status=422)
    if not releasing and (work["contributorId"] not in rate["contributorIds"] or work["costId"] not in rate["costIds"] or
            work["startDate"] < terms["periodStart"] or work["endDate"] > terms["periodEnd"]):
        fail("The selected Work falls outside this customer's contributor, package or service-period authority.")
    key = work_key(work)
    return {"portionKey": key, "originalKey": key, "work": copy.deepcopy(work),
        "workSha256": digest(work), "workContentSha256": content_identity(work),
        "rate": copy.deepcopy(rate), "nativeAmount": str(quantity), "hours": hours(quantity),
        "amount": rate_amount(quantity, rate["hourlyRate"], terms["currency"]["scale"], terms["rounding"]),
        "description": _required(selected["description"], "Original hourly invoice description", 3000)}

def compile_steps(proposal):
    return compile_native_steps(proposal, line_prefix="work",
        source_label="Reviewed customer hourly Work", failure=fail)

def assert_document(proposal, document):
    return assert_native_document(proposal, document, failure=fail)

def capture_snapshot(operations, program_id, context, ids):
    events = [json.loads(r[0]) for r in operations.db.execute(
        "SELECT body_json FROM ops_events WHERE program_id=? ORDER BY version", (program_id,))]
    selected = set(ids)
    for record in context["records"]["work"]:
        selected.update(record.get("sourceIds", []))
    for record in context["records"]["contributors"]:
        selected.update(record.get("sourceIds", []))
    return {"context": copy.deepcopy({k: context[k] for k in ("program", "plan", "records", "sources")}),
        "events": events, "files": source_files(operations, program_id, selected)}

def validate_snapshot(snapshot, context, events, files):
    historic = snapshot["context"]
    original_files = {}
    for source in snapshot["files"]:
        if source["id"] in original_files or historic["sources"].get(source["id"]) != source["metadata"]:
            fail("An original hourly source identity is repeated or changed.", status=422)
        original_files[source["id"]] = _source(source)
        if source["id"] in context["sources"] and (context["sources"][source["id"]] != source["metadata"] or
                files.get("sources/" + source["id"]) != original_files[source["id"]]):
            fail("Shared original hourly source files differ between receiving cases.", status=422)
    if sum(map(len, original_files.values())) > MAX_SOURCES:
        fail("The complete hourly source context exceeds 32 MiB.", status=413)
    original_events = snapshot["events"]
    if len(original_events) != historic["program"]["version"]:
        fail("The original hourly case event history is incomplete.", status=422)
    for sequence, event in enumerate(original_events, 1):
        if event["version"] != sequence or digest({k: v for k, v in event.items() if k != "sha256"}) != event["sha256"]:
            fail("An original hourly source event changed.", status=422)
    if context["program"]["id"] == historic["program"]["id"] and [e for e in events if e["version"] <= historic["program"]["version"]] != original_events:
        fail("The current original case differs from its retained hourly event prefix.", status=422)
    for record in historic["records"]["work"]:
        normalized = domain.prepare("work", record, {**historic, "restoring": True}, record)
        if any(record.get(k) != v for k, v in normalized.items() if k != "state") or record["state"] not in ("LOGGED", "SUBMITTED", "ACCEPTED", "VOID"):
            fail("The original Work row violates its native domain contract.", status=422)
        chain = [e for e in original_events if e.get("kind") == "work" and e.get("recordId") == record["id"]]
        if not chain or chain[-1]["after"] != record:
            fail("An hourly Work edition is absent from its original native event history.", status=422)
        for previous, current in zip(chain, chain[1:]):
            if current["before"] != previous["after"]:
                fail("An original Work transition lost its preceding edition.", status=422)
        for ident in record.get("sourceIds", []):
            if ident not in original_files:
                fail("Retain each original Work evidence file.", status=422)
    return historic, original_files

def validate_authorities(values, context, events, files):
    if not isinstance(values, list) or len(values) > 10000:
        fail("Retain the complete hourly authority editions.", status=422)
    by_id, families = {}, {}
    for value in values:
        exact(value, ("schema", "id", "familyId", "revision", "previousId", "createdAt",
            "actor", "programId", "expectedVersion", "terms", "termsSha256", "accountingIdentity",
            "customer", "sources", "sourceSnapshot", "sourceSnapshotSha256", "request", "sha256"),
            ("schema", "id", "familyId", "revision", "previousId", "createdAt", "actor", "programId",
            "expectedVersion", "terms", "termsSha256", "accountingIdentity", "customer", "sources",
            "sourceSnapshot", "sourceSnapshotSha256", "request", "sha256"))
        if value["schema"] != AUTHORITY_SCHEMA or digest({k: v for k, v in value.items() if k != "sha256"}) != value["sha256"]:
            fail("The immutable customer hourly authority changed.", status=422)
        if value["id"] in by_id or not re.fullmatch(r"hourly-authority-[a-f0-9]{32}", value["familyId"]) or type(value["revision"]) is not int or value["revision"] < 1 or value["id"] != value["familyId"] + "-r" + str(value["revision"]):
            fail("An original hourly authority identity is invalid or repeated.", status=422)
        by_id[value["id"]] = value
        families.setdefault(value["familyId"], []).append(value)
        terms = normalize_terms(value["terms"])
        if terms != value["terms"] or digest(terms) != value["termsSha256"] or value["customer"]["id"] != terms["customerId"]:
            fail("The original hourly terms or customer changed.", status=422)
        if any(not re.fullmatch(r"[a-f0-9]{64}", value["accountingIdentity"][k]) for k in ("workspaceId", "sourcesSha256")):
            fail("The original accounting identity is invalid.", status=422)
        snapshot = value["sourceSnapshot"]
        if digest(snapshot) != value["sourceSnapshotSha256"]:
            fail("The complete original hourly authority context changed.", status=422)
        historic, original_files = validate_snapshot(snapshot, context, events, files)
        contributor_ids = {r["id"] for r in historic["records"]["contributors"]}
        cost_ids = {r["id"] for r in historic["plan"]["scenario"]["future_costs"]}
        if any(not set(r["contributorIds"]) <= contributor_ids or not set(r["costIds"]) <= cost_ids for r in terms["rates"]):
            fail("An authority rate names a contributor or package outside its original case.", status=422)
        if historic["program"]["id"] != value["programId"] or historic["program"]["version"] != value["expectedVersion"]:
            fail("The authority changed its reviewed original case edition.", status=422)
        if {s["id"] for s in value["sources"]} != set(terms["sourceIds"]) or len(value["sources"]) != len(terms["sourceIds"]):
            fail("The complete customer authority files are required.", status=422)
        for source in value["sources"]:
            if original_files.get(source["id"]) != _source(source) or historic["sources"].get(source["id"]) != source["metadata"]:
                fail("The original customer hourly authorization file changed.", status=422)
        request = value["request"]
        body = request["body"]
        if request["sha256"] != digest(body) or body["expectedVersion"] != value["expectedVersion"] or body.get("previousId") != value["previousId"] or normalize_terms(body["terms"]) != terms or _required(body["actor"], "Original authority operator", 300) != value["actor"]:
            fail("The original hourly authority request changed.", status=422)
        short_id(body["requestId"], "Original authority request")
    for family in families.values():
        ordered = sorted(family, key=lambda a: a["revision"])
        previous = None
        for index, value in enumerate(ordered, 1):
            if value["revision"] != index or value["previousId"] != (previous["id"] if previous else None):
                fail("Retain the complete original authority revision history.", status=422)
            if previous and value["request"]["body"].get("expectedAuthoritySha256") != previous["sha256"]:
                fail("The authority revision lost its exact preceding reviewed terms.", status=422)
            if previous and (value["accountingIdentity"] != previous["accountingIdentity"] or any(value["terms"][k] != previous["terms"][k] for k in ("endpointId", "customerId", "currency"))):
                fail("An authority revision cannot change its original customer or accounting identity.", status=422)
            previous = value
    return copy.deepcopy(values)

class WorkBilling(SourceBillingJournal):
    schema = SCHEMA
    table = "ops_work_billing"
    id_prefix = "work-billing-"
    error_prefix = "WORK_BILLING"
    _fail = staticmethod(fail)
    _money = staticmethod(money)
    _exact = staticmethod(exact)
    _review_refusal = staticmethod(review_refusal)
    _active_heads = staticmethod(active_heads)
    _assert_document = staticmethod(assert_document)

    def __init__(self, operations):
        super().__init__(operations)
        self.db.execute("""CREATE TABLE IF NOT EXISTS ops_hourly_authorities (
            id TEXT PRIMARY KEY,family_id TEXT NOT NULL,revision INTEGER NOT NULL,
            body_json TEXT NOT NULL,UNIQUE(family_id,revision))""")
        self.db.execute("""CREATE TABLE IF NOT EXISTS ops_hourly_authority_cases (
            program_id TEXT NOT NULL,authority_id TEXT NOT NULL,PRIMARY KEY(program_id,authority_id))""")

    def _all_authorities(self):
        return [json.loads(r[0]) for r in self.db.execute(
            "SELECT body_json FROM ops_hourly_authorities ORDER BY family_id,revision")]

    def _authorities(self, program_id):
        self.operations._context(program_id)
        ids = {r[0] for r in self.db.execute(
            "SELECT authority_id FROM ops_hourly_authority_cases WHERE program_id=?", (program_id,))}
        families = {r["familyId"] for r in self._all_authorities() if r["id"] in ids}
        return [r for r in self._all_authorities() if r["familyId"] in families]

    def authority(self, program_id, ident):
        return next((r for r in self._authorities(program_id) if r["id"] == ident), None) or self._authority_missing()

    def _authority_missing(self):
        fail("The selected customer hourly authority is absent.", "WORK_BILLING_AUTHORITY_NOT_FOUND", 404)

    def _validate_exposure(self, rows):
        return validate_exposure(rows, self._all_authorities())

    def save_authority(self, program_id, body):
        exact(body, ("requestId", "actor", "expectedVersion", "previousId", "expectedAuthoritySha256", "terms"),
            ("requestId", "actor", "expectedVersion", "terms"))
        request_id = short_id(body["requestId"], "Authority request")
        actor = _required(body["actor"], "Recording operator", 300)
        payload = {"domain": AUTHORITY_SCHEMA, "programId": program_id, "body": body}
        with self.workspace.mutex:
            retained = next((a for a in self._authorities(program_id) if a["request"]["body"]["requestId"] == request_id), None)
            if retained:
                if retained["request"]["body"] != body:
                    fail("The original authority request has different terms.", "REQUEST_CONFLICT")
                return copy.deepcopy(retained)
            context = self._context(program_id, body["expectedVersion"])
            terms = normalize_terms(body["terms"])
            contributor_ids = {r["id"] for r in context["records"]["contributors"]}
            cost_ids = {r["id"] for r in context["plan"]["scenario"]["future_costs"]}
            for rate in terms["rates"]:
                if not set(rate["contributorIds"]) <= contributor_ids or not set(rate["costIds"]) <= cost_ids:
                    fail("Rate scopes must name original case contributors and work packages.", status=422)
            previous = self.authority(program_id, body["previousId"]) if body.get("previousId") else None
            if previous:
                head = authority_heads(self._all_authorities())[previous["familyId"]]
                if head["id"] != previous["id"] or previous["sha256"] != body.get("expectedAuthoritySha256"):
                    fail("Review the latest complete original customer authority before revising it.")
                if any(terms[k] != previous["terms"][k] for k in ("endpointId", "customerId", "currency")):
                    fail("A revision preserves the original native account, customer and currency.")
            sources = source_files(self.operations, program_id, terms["sourceIds"])
            snapshot = capture_snapshot(self.operations, program_id, context, terms["sourceIds"])
        identity = self.billing._identity(terms["endpointId"])
        if previous:
            self.billing._assert_identity(previous["accountingIdentity"], identity)
            identity = previous["accountingIdentity"]
        customers = self.billing._native("customers", {"endpointId": terms["endpointId"]})
        customer = next((r for r in customers["customers"] if r["id"] == terms["customerId"]), None)
        if customer is None:
            fail("The selected customer is absent from the original native account.")
        family = previous["familyId"] if previous else "hourly-authority-" + uuid.uuid4().hex
        revision = previous["revision"] + 1 if previous else 1
        row = {"schema": AUTHORITY_SCHEMA, "id": family + "-r" + str(revision),
            "familyId": family, "revision": revision, "previousId": previous["id"] if previous else None,
            "createdAt": now(), "actor": actor, "programId": program_id, "expectedVersion": body["expectedVersion"],
            "terms": terms, "termsSha256": digest(terms), "accountingIdentity": identity,
            "customer": copy.deepcopy(customer), "sources": sources,
            "sourceSnapshot": snapshot, "sourceSnapshotSha256": digest(snapshot),
            "request": {"body": copy.deepcopy(body), "sha256": digest(body)}}
        row["sha256"] = digest(row)
        def save():
            self._context(program_id, body["expectedVersion"])
            if previous and authority_heads(self._all_authorities())[family]["id"] != previous["id"]:
                fail("Another original authority revision was saved.")
            if source_files(self.operations, program_id, terms["sourceIds"]) != sources:
                fail("The original customer authority sources changed.")
            validate_exposure(self._all(), self._all_authorities() + [row])
            self.db.execute("INSERT INTO ops_hourly_authorities VALUES(?,?,?,?)",
                (row["id"], family, revision, canonical(row)))
            self.db.execute("INSERT INTO ops_hourly_authority_cases VALUES(?,?)", (program_id, row["id"]))
            return {"id": row["id"]}
        result = review_refusal("AUTHORITY", lambda: self.workspace._transaction(request_id, payload, save))
        return self.authority(program_id, result["id"])

    def _capacity(self, proposal, replacing_chain=None):
        rows = self._all()
        parts = exposure(rows)
        current = parts.get(replacing_chain, {"quantities": {}})
        used = {}
        for chain, part in parts.items():
            if chain != replacing_chain:
                for key, quantity in part["quantities"].items():
                    used[key] = used.get(key, 0) + quantity
        for line in proposal["lines"]:
            key = line["originalKey"]
            allowed = max(hour_units(line["work"]["hours"]), used.get(key, 0) + current["quantities"].get(key, 0)) if replacing_chain else hour_units(line["work"]["hours"])
            if used.get(key, 0) + units(line["nativeAmount"]) > allowed:
                fail("Another original customer charge already reserves these Work hours.")
        trial = {"chainId": proposal["chainId"], "sequence": max((r["sequence"] for r in rows if r["chainId"] == proposal["chainId"]), default=0)+1,
            "state": "PREPARED", "proposal": proposal}
        validate_exposure(rows + [trial], self._all_authorities())

    def _source_current(self, program_id, proposal):
        context = self._context(program_id)
        authority = self.authority(program_id, proposal["authority"]["id"])
        if authority != proposal["authority"]:
            fail("The original customer hourly authority changed.")
        if authority_heads(self._all_authorities())[authority["familyId"]]["id"] != authority["id"] and proposal["mode"] not in ("CREDIT", "VOID"):
            fail("Review the latest customer hourly terms before a new positive charge.")
        for line in proposal["lines"]:
            selected = {"workId": line["work"]["id"], "expectedWorkSha256": line["workSha256"],
                "rateId": line["rate"]["id"], "hours": line["hours"], "description": line["description"]}
            if work_line(context, selected, authority, proposal["mode"] in ("CREDIT", "VOID")) != line:
                fail("The original accepted Work or hourly allocation changed.")
        for source in proposal["sources"]:
            metadata, raw = self.operations.source(program_id, source["id"])
            if metadata != source["metadata"] or raw != _source(source):
                fail("An original Work evidence or customer terms file changed.")
        self._capacity(proposal, proposal["chainId"])
        return context

    def catalog(self, program_id):
        with self.workspace.mutex:
            context = self.operations._context(program_id)
            totals = {}
            for part in exposure(self._all()).values():
                for key, value in part["quantities"].items():
                    totals[key] = totals.get(key, 0) + value
            work = [{"record": copy.deepcopy(record), "workSha256": digest(record),
                "workContentSha256": content_identity(record), "originalKey": work_key(record),
                "reservedHours": hours(totals.get(work_key(record), 0)),
                "availableHours": hours(max(0, hour_units(record["hours"])-totals.get(work_key(record), 0))),
                "selectable": record["state"] == "ACCEPTED" and record["fundingBasis"] == "CUSTOMER" and context["program"]["state"] == "OPEN"}
                for record in context["records"]["work"]]
            authorities = self._authorities(program_id)
            heads = authority_heads(authorities)
            return {"schema": SCHEMA, "programId": program_id, "version": context["program"]["version"],
                "mode": context["program"]["mode"], "sources": list(context["sources"].values()),
                "contributors": copy.deepcopy(context["records"]["contributors"]),
                "costs": copy.deepcopy(context["plan"]["scenario"]["future_costs"]),
                "work": work, "authorities": [{"authority": a, "current": heads[a["familyId"]]["id"] == a["id"]} for a in authorities],
                "items": [self._summary(r) for r in self._rows(program_id)]}

    def preview(self, program_id, body):
        exact(body, ("requestId", "actor", "expectedVersion", "previousId", "mode",
            "authorityId", "expectedAuthoritySha256", "reason", "issueDate", "dueDate",
            "effectiveDate", "resolution", "purchaseOrder", "note", "lines", "expectedPreviewSha256"),
            ("requestId", "actor", "expectedVersion", "mode", "authorityId",
             "expectedAuthoritySha256", "reason", "lines"))
        request_id = short_id(body["requestId"], "Preparation request")
        actor = _required(body["actor"], "Recording operator", 300)
        mode = body["mode"]
        if mode not in MODES:
            fail("Choose a new charge, draft correction, credit, void or replacement.", status=422)
        reason = _required(body["reason"], "Hourly charge or correction reason", 3000)
        with self.workspace.mutex:
            context = self._context(program_id, body["expectedVersion"])
            prior = self._read(program_id, body["previousId"]) if body.get("previousId") else None
            if prior:
                self._head(prior)
                if prior["state"] == "PREPARED" or any(c["state"] == "PENDING" for c in prior["commands"]):
                    fail("Continue or cancel the retained review and reconcile pending original commands first.")
                if prior["state"] == "RUNNING" and not any(c["state"] == "REJECTED" for c in prior["commands"]):
                    fail("Complete the acknowledged native operation before its successor.")
                if mode == "NEW":
                    fail("Correct the original charge instead of opening another chain.", status=422)
            elif mode != "NEW":
                fail("Select the original customer hourly charge to correct.", status=422)
            authority = self.authority(program_id, body["authorityId"])
            if authority["sha256"] != body["expectedAuthoritySha256"]:
                fail("Review the exact retained customer hourly authority.")
            if authority_heads(self._all_authorities())[authority["familyId"]]["id"] != authority["id"] and mode not in ("CREDIT", "VOID"):
                fail("Select the latest customer authority for a positive hourly charge.")
            if prior and authority["familyId"] != prior["proposal"]["authority"]["familyId"]:
                fail("A correction preserves the original customer's authority and cumulative cap.")
            terms = authority["terms"]
            chain = prior["chainId"] if prior else "work-chain-" + digest({"programId": program_id, "requestId": request_id})[:32]
            if not isinstance(body["lines"], list) or not 1 <= len(body["lines"]) <= MAX_LINES:
                fail("Retain one-to-200 original Work portions.", status=422)
            lines = [work_line(context, value, authority, mode in ("CREDIT", "VOID")) for value in body["lines"]]
            if len({r["portionKey"] for r in lines}) != len(lines):
                fail("Combine each original Work record once in this charge.", status=422)
            if mode == "VOID" and any(units(r["nativeAmount"]) or money(r["amount"], terms["currency"]["scale"])[1] for r in lines):
                fail("A void releases all original hours and their customer amount.", status=422)
            if prior and mode in ("CREDIT", "VOID"):
                original = {r["portionKey"]: r for r in prior["proposal"]["lines"]}
                if set(original) != {r["portionKey"] for r in lines} or any(units(r["nativeAmount"]) > units(original[r["portionKey"]]["nativeAmount"]) for r in lines):
                    fail("Credit or void retains the original Work population and only reduces its reserved hours.")
            ids = set(terms["sourceIds"])
            for line in lines:
                ids.update(line["work"]["sourceIds"])
            sources = source_files(self.operations, program_id, ids)
            snapshot = capture_snapshot(self.operations, program_id, context, ids)
            case_version, case_mode = context["program"]["version"], context["program"]["mode"]
        identity = self.billing._identity(terms["endpointId"])
        self.billing._assert_identity(authority["accountingIdentity"], identity)
        customers = self.billing._native("customers", {"endpointId": terms["endpointId"]})
        customer = next((r for r in customers["customers"] if r["id"] == terms["customerId"]), None)
        if customer is None:
            fail("The original native customer is absent.")
        detail, invoice_id = None, None
        if prior:
            self.billing._assert_identity(prior["proposal"]["accountingIdentity"], identity)
            acknowledged = next((c for c in reversed(prior["commands"]) if c["action"] == "draft" and c["state"] == "ACKNOWLEDGED"), None)
            invoice_id = acknowledged["result"]["operation"]["result"]["invoiceId"] if acknowledged else (
                prior.get("activeInvoiceId") or prior["proposal"].get("invoiceId"))
            if not invoice_id:
                fail("Cancel the unused rejected preparation and review the corrected original Work.")
            detail = self._native(prior["proposal"], "detail", {"invoiceId": invoice_id})
        defaults = detail["draft"] if detail else {}
        issue_date = _date(body.get("issueDate", defaults.get("issueDate")), "Invoice date")
        due_date = _date(body.get("dueDate", defaults.get("dueDate")), "Due date")
        effective_date = _date(body.get("effectiveDate", issue_date), "Correction date")
        if due_date < issue_date:
            fail("Due date cannot precede invoice date.", status=422)
        resolution = body.get("resolution", "CREDIT")
        if resolution not in ("CREDIT", "VOID"):
            fail("Choose the native original invoice's credit or void disposition.", status=422)
        commercial = {"authorityId": authority["id"], "authoritySha256": authority["sha256"],
            "terms": terms, "reason": reason, "amounts": [
                {k: r[k] for k in ("portionKey", "nativeAmount", "hours", "rate", "amount", "description")} for r in lines]}
        proposal = {"schema": SCHEMA, "programId": program_id, "expectedVersion": case_version,
            "caseMode": case_mode, "requestId": request_id, "chainId": chain,
            "sourceSnapshot": snapshot, "sourceSnapshotSha256": digest(snapshot),
            "previousId": prior["id"] if prior else None, "mode": mode, "actor": actor,
            "authority": copy.deepcopy(authority), "endpointId": terms["endpointId"],
            "accountingIdentity": copy.deepcopy(authority["accountingIdentity"]),
            "customerId": terms["customerId"], "customer": copy.deepcopy(customer),
            "currency": copy.deepcopy(terms["currency"]), "invoiceId": invoice_id, "sources": sources,
            "authorization": terms["authorization"], "authorizedOn": terms["authorizedOn"],
            "authorizationSourceIds": terms["sourceIds"],
            "reason": reason, "issueDate": issue_date, "dueDate": due_date, "effectiveDate": effective_date,
            "resolution": resolution, "purchaseOrder": _native_optional(body.get("purchaseOrder", defaults.get("purchaseOrder", "")) or "", "Purchase order", 300),
            "note": _native_optional(body.get("note", defaults.get("note", "")) or "", "Invoice note", 6000),
            "lines": lines, "terms": commercial, "termsSha256": digest(commercial),
            "amount": _money(sum(money(r["amount"], terms["currency"]["scale"])[1] for r in lines), terms["currency"]["scale"]),
            "nativeBefore": detail, "nativeFingerprint": _fingerprint(detail) if detail else None}
        proposal["steps"] = compile_steps(proposal)
        proposal["consequences"] = {"hours": "Original Work hours are reserved once across case copies in this Operations workspace. Pending corrections retain prior billed exposure.",
            "authority": "Customer terms, rates, period and whole-authority caps are explicit. Work acceptance and customer authorization are separate.",
            "payments": "Native receipts, allocations and refunds remain unchanged; issue uses a separate native preview.",
            "rounding": "The selected hourly authority declares exact minor-unit arithmetic or half-up rounding per invoice line."}
        with self.workspace.mutex:
            self._capacity(proposal, chain if prior else None)
        return {"schema": SCHEMA, "proposal": proposal, "previewSha256": digest(proposal)}

    def export_rows(self, program_id):
        result = super().export_rows(program_id)
        families = {r["proposal"]["authority"]["familyId"] for r in result["items"]}
        families.update(r["familyId"] for r in self._authorities(program_id))
        result["authorities"] = [r for r in self._all_authorities() if r["familyId"] in families]
        return result

    def restore_rows(self, program_id, value):
        for authority in value["authorities"]:
            prior = self.db.execute("SELECT body_json FROM ops_hourly_authorities WHERE id=?", (authority["id"],)).fetchone()
            if prior:
                if json.loads(prior[0]) != authority:
                    fail("A received hourly authority diverges from the original retained terms.")
            else:
                conflict = self.db.execute("SELECT id FROM ops_hourly_authorities WHERE family_id=? AND revision=?",
                    (authority["familyId"], authority["revision"])).fetchone()
                if conflict:
                    fail("The received authority contains a conflicting original revision.")
                self.db.execute("INSERT INTO ops_hourly_authorities VALUES(?,?,?,?)",
                    (authority["id"], authority["familyId"], authority["revision"], canonical(authority)))
            self.db.execute("INSERT OR IGNORE INTO ops_hourly_authority_cases VALUES(?,?)", (program_id, authority["id"]))
        return super().restore_rows(program_id, {"schema": SCHEMA, "items": value["items"]})
    def export_bundle(self, program_id, ident):
        with self.operations._snapshot():
            selected = self.get(program_id, ident)
            original = self.operations.export(program_id)
            retained = self.export_rows(program_id)
            local_fingerprint = digest(retained)
        proposal = selected["proposal"]
        native_revision = self._native(proposal, "customers", {})["revision"]
        account = self._native(proposal, "export", {"customerId": proposal["customerId"]})
        files = {"operations.zip": original,
            "work-billing.json": (canonical(retained) + "\n").encode(),
            "selected-charge.json": (canonical(selected) + "\n").encode(),
            "native-customer-account.tar": base64.b64decode(account["contentBase64"], validate=True)}
        linked = []
        invoice_ids = set()
        for row in retained["items"]:
            if row["proposal"]["accountingIdentity"] == proposal["accountingIdentity"] and row["proposal"]["customerId"] == proposal["customerId"]:
                if row["proposal"].get("invoiceId"):
                    invoice_ids.add(row["proposal"]["invoiceId"])
                if row.get("activeInvoiceId"):
                    invoice_ids.add(row["activeInvoiceId"])
        for invoice_id in sorted(invoice_ids):
            detail = self._native(proposal, "detail", {"invoiceId": invoice_id})
            if detail["invoice"]["customerId"] != proposal["customerId"]:
                fail("A linked native document belongs to another customer.")
            records = ([{"id": invoice_id, "files": detail["files"]}] if detail.get("document") else []) + detail["credits"]
            for record in records:
                names = ("credit.json", "credit.csv", "credit.html", "manifest.json") if "document" in record else (
                    "invoice.json", "invoice.csv", "invoice.html", "manifest.json")
                folder = "native/documents/" + hashlib.sha256(record["id"].encode()).hexdigest() + "/"
                if folder + names[0] in files:
                    continue
                for name in names:
                    fetched = self._native(proposal, "document", {"invoiceId": record["id"], "name": name})
                    raw = base64.b64decode(fetched["contentBase64"], validate=True)
                    metadata = record["files"][name]
                    if len(raw) != metadata["bytes"] or hashlib.sha256(raw).hexdigest() != metadata["sha256"]:
                        fail("The linked immutable native document differs from its original bytes.", status=502)
                    files[folder + name] = raw
                linked.append({"invoiceId": invoice_id, "documentId": record["id"], "directory": folder})
        if self._native(proposal, "customers", {})["revision"] != native_revision:
            fail("The native account changed during export. Reopen and export its current original edition.")
        with self.operations._snapshot():
            if digest(self.export_rows(program_id)) != local_fingerprint:
                fail("The work-billing history changed during export. Reopen its current original edition.")
        files["native/linked-documents.json"] = (canonical(linked) + "\n").encode()
        files["export-observations.json"] = (canonical({"localHistorySha256": local_fingerprint,
            "nativeRevisionBeforeAndAfter": native_revision, "accountingIdentity": proposal["accountingIdentity"],
            "interpretation": "One local aggregate snapshot and the unchanged native revision observed around the original customer archive and all linked documents."}) + "\n").encode()
        records = []
        for row in retained["items"]:
            p = row["proposal"]
            for line in p["lines"]:
                records.append({"chargeId": row["id"], "chainId": row["chainId"], "sequence": row["sequence"],
                    "state": row["state"], "mode": p["mode"], "customerId": p["customerId"],
                    "invoiceId": row.get("activeInvoiceId"), "currency": p["currency"]["code"],
                    "authorityId": p["authority"]["id"], "workId": line["work"]["id"],
                    "contributorId": line["work"]["contributorId"], "costId": line["work"]["costId"],
                    "hours": line["hours"], "hourlyRate": line["rate"]["hourlyRate"],
                    "rounding": p["authority"]["terms"]["rounding"], "amount": line["amount"],
                    "description": line["description"]})
        headers = ["chargeId", "chainId", "sequence", "state", "mode", "customerId", "invoiceId", "currency",
                   "authorityId", "workId", "contributorId", "costId", "hours", "hourlyRate", "rounding", "amount", "description"]
        files["work-billing.csv"] = csv_bytes(headers, records)
        cells = lambda values: "".join("<td>" + escape(str(v if v is not None else "")) + "</td>" for v in values)
        table = "<table><thead><tr>" + "".join("<th>" + escape(h) + "</th>" for h in headers) + "</tr></thead><tbody>"
        table += "".join("<tr>" + cells([r.get(k) for k in headers]) + "</tr>" for r in records) + "</tbody></table>"
        files["work-billing.html"] = ('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>Customer hourly Work billing</title><style>*{box-sizing:border-box}body{margin:0;padding:24px;background:#fff;color:#222;font:16px/1.5 system-ui}'
            'h1,h2,p,td,th{overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;font-size:13px}td,th{padding:8px;border:1px solid #bbb;text-align:left;vertical-align:top}'
            '.table{overflow:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid #bbb;padding:16px;background:#f5f5f5;color:#222}</style>'
            '<h1>Customer hourly Work billing</h1><p>Complete original Work hours, customer charge reviews and native command history.</p><div class="table">' + table +
            '</div><h2>Selected customer terms</h2><pre>' + escape(selected["proposal"]["authorization"]) +
            '</pre><h2>Hourly authority and caps</h2><pre>' + escape(canonical(selected["proposal"]["authority"]["terms"])) +
            '</pre><p>Open operations.zip in Grant Operations to continue the whole case. The original customer-account archive retains native invoices, credits, allocations and documents. Configure the same accounting identity at its current service URL before financial continuation.</p></html>').encode()
        files["README.txt"] = ("CUSTOMER HOURLY WORK BILLING\n\noperations.zip is the complete original Grant case and its retained hourly authorities.  "
            "work-billing.json and CSV retain every charge edition and original command. native-customer-account.tar is the actual native full customer export. "
            "Reopen the complete operating case and its original native account; preserve the accounting identity pair and original request IDs. "
            "A customer-account export does not replace the authenticated full-account backup for native account restore. "
            "Inspect all outgoing HTML, CSV and native invoice documents; operate the rendered desk at desktop and phone widths, in light and dark embedding contexts, and cold-reopen the complete saved case.\n").encode()
        manifest = {"schema": SCHEMA, "id": ident, "createdAt": now(), "files": [
            {"path": name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()} for name, raw in sorted(files.items())]}
        files["manifest.json"] = (canonical(manifest) + "\n").encode()
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
            for name, raw in sorted(files.items()):
                archive.writestr(name, raw)
        raw = output.getvalue()
        return {"filename": ident + ".zip", "mediaType": "application/zip", "bytes": len(raw),
                "sha256": hashlib.sha256(raw).hexdigest(), "contentBase64": base64.b64encode(raw).decode(), "manifest": manifest}


def validate_proposal(p, context, events, files, authorities):
    authority = next((a for a in authorities if a["id"] == p["authority"]["id"]), None)
    if authority is None or authority != p["authority"]:
        fail("The charge lost its complete original customer authority.", status=422)
    snapshot = p["sourceSnapshot"]
    if digest(snapshot) != p["sourceSnapshotSha256"]:
        fail("The original Work context changed.", status=422)
    historic, original_files = validate_snapshot(snapshot, context, events, files)
    if historic["program"]["id"] != p["programId"] or historic["program"]["version"] != p["expectedVersion"] or historic["program"]["mode"] != p["caseMode"]:
        fail("The charge changed its original case or reviewed edition.", status=422)
    terms = authority["terms"]
    if any(p[k] != terms[k] for k in ("endpointId", "customerId", "currency", "authorization", "authorizedOn")) or p["accountingIdentity"] != authority["accountingIdentity"] or p["customer"]["id"] != terms["customerId"]:
        fail("The charge differs from its retained customer and accounting authority.", status=422)
    if p["authorizationSourceIds"] != terms["sourceIds"]:
        fail("The charge lost its complete original customer authority sources.", status=422)
    _required(p["actor"], "Original recording operator", 300)
    short_id(p["requestId"], "Original preparation request")
    _required(p["reason"], "Original charge reason", 3000)
    for key in ("issueDate", "dueDate", "effectiveDate"):
        _date(p[key], key)
    if p["dueDate"] < p["issueDate"] or p["resolution"] not in ("CREDIT", "VOID"):
        fail("The original invoice dates or correction disposition changed.", status=422)
    if not isinstance(p["lines"], list) or not 1 <= len(p["lines"]) <= MAX_LINES:
        fail("Retain the complete original Work line population.", status=422)
    seen, required_sources = set(), set(terms["sourceIds"])
    for line in p["lines"]:
        selected = {"workId": line["work"]["id"], "expectedWorkSha256": line["workSha256"],
            "rateId": line["rate"]["id"], "hours": line["hours"], "description": line["description"]}
        expected = work_line(historic, selected, authority, p["mode"] in ("CREDIT", "VOID"))
        if expected != line or line["portionKey"] in seen:
            fail("The retained hourly line differs from its actual original Work and customer rate.", status=422)
        seen.add(line["portionKey"])
        required_sources.update(line["work"]["sourceIds"])
        if p["mode"] == "VOID" and (units(line["nativeAmount"]) or money(line["amount"], p["currency"]["scale"])[1]):
            fail("A voided original Work portion retains a charge.", status=422)
    commercial = {"authorityId": authority["id"], "authoritySha256": authority["sha256"],
        "terms": terms, "reason": p["reason"], "amounts": [
            {k: r[k] for k in ("portionKey", "nativeAmount", "hours", "rate", "amount", "description")} for r in p["lines"]]}
    if p["terms"] != commercial or p["termsSha256"] != digest(commercial):
        fail("The immutable reviewed hourly charge terms changed.", status=422)
    if len(p["sources"]) != len(required_sources) or {r["id"] for r in p["sources"]} != required_sources:
        fail("The complete original Work and customer authority files are required.", status=422)
    for source in p["sources"]:
        if historic["sources"].get(source["id"]) != source["metadata"] or original_files.get(source["id"]) != _source(source):
            fail("An original hourly billing source file changed.", status=422)
    if p["amount"] != _money(sum(money(r["amount"], p["currency"]["scale"])[1] for r in p["lines"]), p["currency"]["scale"]):
        fail("The customer total differs from the retained exact hourly amounts.", status=422)


def validate_preparation(p, body):
    exact(body, ("requestId", "actor", "expectedVersion", "previousId", "mode",
        "authorityId", "expectedAuthoritySha256", "reason", "issueDate", "dueDate",
        "effectiveDate", "resolution", "purchaseOrder", "note", "lines", "expectedPreviewSha256"),
        ("requestId", "actor", "expectedVersion", "mode", "authorityId",
         "expectedAuthoritySha256", "reason", "lines", "expectedPreviewSha256"))
    if body["authorityId"] != p["authority"]["id"] or body["expectedAuthoritySha256"] != p["authority"]["sha256"] or _required(body["reason"], "Original reason", 3000) != p["reason"]:
        fail("The original hourly preparation identifies another customer authority or reason.", status=422)
    historic = p["sourceSnapshot"]["context"]
    lines = [work_line(historic, value, p["authority"], p["mode"] in ("CREDIT", "VOID")) for value in body["lines"]]
    if lines != p["lines"]:
        fail("The original hourly preparation differs from its reviewed Work selection.", status=422)
    defaults = p["nativeBefore"]["draft"] if p["nativeBefore"] else {}
    issued = _date(body.get("issueDate", defaults.get("issueDate")), "Original invoice date")
    expected = {"issueDate": issued, "dueDate": _date(body.get("dueDate", defaults.get("dueDate")), "Original due date"),
        "effectiveDate": _date(body.get("effectiveDate", issued), "Original correction date"),
        "resolution": body.get("resolution", "CREDIT"),
        "purchaseOrder": _native_optional(body.get("purchaseOrder", defaults.get("purchaseOrder", "")) or "", "Original purchase order", 300),
        "note": _native_optional(body.get("note", defaults.get("note", "")) or "", "Original note", 6000)}
    if any(p[k] != value for k, value in expected.items()):
        fail("The original hourly request differs from its reviewed invoice terms.", status=422)


def validate_import(value, context, events, files):
    if value is None:
        return {"schema": SCHEMA, "items": [], "authorities": []}
    try:
        exact(value, ("schema", "items", "authorities"), ("schema", "items", "authorities"))
        authorities = validate_authorities(value["authorities"], context, events, files)
        rows = validate_rows({"schema": value["schema"], "items": value["items"]},
            schema=SCHEMA, id_prefix="work-billing-", chain_prefix="work-chain-", error_prefix="WORK_BILLING",
            validate_proposal=lambda p: validate_proposal(p, context, events, files, authorities),
            compile_steps=compile_steps, assert_document=assert_document,
            validate_exposure=lambda rows: validate_exposure(rows, authorities), fail=fail, exact=exact,
            validate_preparation=validate_preparation)
        for chain in {r["chainId"] for r in rows["items"]}:
            families = {r["proposal"]["authority"]["familyId"] for r in rows["items"] if r["chainId"] == chain}
            if len(families) != 1:
                fail("A correction changed its original hourly authority and cumulative cap.", status=422)
        rows["authorities"] = authorities
        return rows
    except Problem:
        raise
    except (KeyError, TypeError, ValueError, IndexError, AttributeError) as error:
        raise Problem("The complete original hourly billing history is malformed.", 422, "WORK_BILLING_IMPORT") from error
