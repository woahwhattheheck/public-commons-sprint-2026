"""Original supplier statements reconciled with retained SF47 account generations.

All monetary positions come from operations_payables/performance. The unchanged
SMB reconciliation engine supplies comparisons. Review editions live in the
original ops_reviews collection and commit through Operations.command.
"""
from __future__ import annotations
from copy import deepcopy
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import html
import io
import json
from pathlib import Path
import re
import subprocess
import uuid
import zipfile

from model import Problem, canonical, digest, csv_bytes, text, now, MAX_BUNDLE
import operations_domain as domain
import operations_work_intake as intake
import operations_payables as payables
import operations_amendments as amendments

SCHEMA = "stellar-forge.sf47-supplier-statement.v1"
PURPOSE = "SUPPLIER_STATEMENT"
ACTION = "supplier-statement.save"
FIELDS = ("documentRef", "rowType", "eventDate", "effectUsd")
CHOICES = ("OPEN", "EXPLAINED", "LINKED_RECORD")
MAX_ROWS = 1000
MAX_REVIEW_BYTES = 8 * 1024 * 1024
STATEMENT_ID = re.compile(r"statement-[a-f0-9]{32}")
REVIEW_ID = re.compile(r"review-[a-f0-9]{32}")
BUNDLE_SCHEMA = SCHEMA + ".bundle"
DERIVED = {"supplier-statement.json", "supplier-statement.html", "statement-rows.csv",
           "ledger-rows.csv", "review-items.csv", "selection.json", "original-source",
           "operations-case.zip", "README.txt"}


def fail(message, code="SUPPLIER_STATEMENT_INPUT", status=422):
    raise Problem(message, status, code)


def obj(value, allowed, label):
    if not isinstance(value, dict) or set(value) - set(allowed):
        fail(label + ": retain the supported complete object.")
    return value


def ident(value, expression, label):
    if not isinstance(value, str) or not expression.fullmatch(value):
        fail("Select the original " + label + ".")
    return value


def utc(value):
    domain.timestamp(value, "Retained generation time")
    stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if stamp.tzinfo is None:
        fail("Retain an explicit UTC offset for the generation time.")
    return stamp.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def minor(value, label, selected=None):
    """Convert exact supplied USD text to the engine's bounded integer cents."""
    value = text(value, label, 100, True)
    sign = -1 if value.startswith("-") else 1
    unsigned = value[1:] if value[:1] in ("-", "+") else value
    if selected:
        # Statement rows retain the original positive parser and explicit sign.
        normalized = intake.amount_value(unsigned, label, selected, 2)
    else:
        normalized = domain.usd(unsigned, label)
    cents = int(Decimal(normalized) * 100) * sign
    if abs(cents) > 9007199254740991:
        fail(label + ": the original engine supports exact safe integer cents.")
    return cents


def engine(value, as_of, receipt=None):
    payload = {"input": value, "asOf": as_of}
    if receipt is not None:
        payload["receipt"] = receipt
    try:
        run = subprocess.run(["node", str(Path(__file__).with_name("supplier_statement_engine.mjs"))],
            input=canonical(payload), text=True, encoding="utf-8", capture_output=True,
            timeout=30, check=False)
    except FileNotFoundError as exc:
        raise Problem("Install the selected Node runtime for the original supplier reconciliation engine.",
                      503, "SUPPLIER_ENGINE_UNAVAILABLE") from exc
    except subprocess.TimeoutExpired as exc:
        raise Problem("The read-only original supplier comparison did not finish.", 504,
                      "SUPPLIER_ENGINE_TIMEOUT") from exc
    if len(run.stdout.encode()) > 16 * 1024 * 1024:
        fail("The original engine response exceeds its complete supported bound.", status=413)
    try:
        output = json.loads(run.stdout)
    except ValueError as exc:
        raise Problem("The original supplier engine response is unreadable.", 502,
                      "SUPPLIER_ENGINE_RESPONSE") from exc
    if not output.get("ok") or run.returncode:
        issue = output.get("error", {})
        fail("Original supplier engine: " + str(issue.get("message", "comparison rejected")),
             str(issue.get("code", "SUPPLIER_ENGINE_INPUT")))
    return output["receipt"]


def records(ops, case_id):
    return [json.loads(row[0]) for row in ops.db.execute(
        "SELECT body_json FROM ops_reviews WHERE program_id=? ORDER BY rowid", (case_id,))
        if json.loads(row[0]).get("purpose") == PURPOSE]


def summary(review):
    saved = review["supplierStatement"]
    return {"id": review["id"], "statementId": saved["document"]["statementId"],
        "revision": saved["revision"], "version": review["version"], "createdAt": review["createdAt"],
        "actor": review["actor"], "note": review["note"], "sha256": review["sha256"],
        "sourceId": saved["document"]["sourceId"], "sourceSha256": saved["source"]["sha256"],
        "contributorId": saved["document"]["contributorId"], "name": saved["document"]["name"],
        "startDate": saved["document"]["startDate"], "endDate": saved["document"]["endDate"],
        "state": saved["document"]["state"], "counts": saved["receipt"]["counts"],
        "balances": saved["receipt"]["balances"], "openItems": saved["openItems"]}


def selected(ops, case_id, review_id):
    ident(review_id, REVIEW_ID, "supplier review")
    row = next((r for r in records(ops, case_id) if r["id"] == review_id), None)
    if row is None:
        fail("This saved supplier statement edition is unavailable.", "SUPPLIER_REVIEW_NOT_FOUND", 404)
    return row


def latest(history, statement_id):
    return next((r for r in reversed(history)
                 if r["supplierStatement"]["document"]["statementId"] == statement_id), None)


def seed(context):
    return {"statementId": "statement-" + uuid.uuid4().hex, "previousReviewId": None,
        "name": "", "contributorId": "", "sourceId": "", "startDate": None,
        "endDate": datetime.now(timezone.utc).date().isoformat(), "evaluatedAt": utc(now()),
        "openingUsd": "0.00", "closingUsd": "", "complete": False, "state": "DRAFT",
        "format": deepcopy(intake.DEFAULT_FORMAT),
        "mapping": {field: {"column": i} for i, field in enumerate(FIELDS)},
        "rowEdits": [], "ledgerReferences": [], "decisions": [],
        "possibleMatches": False, "dateWindowDays": 3}


def document(value, context, parsed):
    obj(value, seed(context).keys(), "Supplier statement document")
    out = {}
    out["statementId"] = ident(value.get("statementId"), STATEMENT_ID, "statement identity")
    previous = value.get("previousReviewId")
    out["previousReviewId"] = None if previous is None else ident(previous, REVIEW_ID, "previous edition")
    out["name"] = text(value.get("name"), "Statement name", 300, True)
    out["contributorId"] = text(value.get("contributorId"), "Original supplier", 100, True)
    if not any(row["id"] == out["contributorId"] for row in context["records"]["contributors"]):
        fail("Select an existing original supplier.")
    out["sourceId"] = text(value.get("sourceId"), "Original source", 100, True)
    if out["sourceId"] not in context["sources"]:
        fail("Select the attached original supplier statement.")
    out["startDate"] = domain.calendar(value.get("startDate"), "Statement start", True)
    out["endDate"] = domain.calendar(value.get("endDate"), "Statement end")
    if out["startDate"] and out["startDate"] > out["endDate"]:
        fail("The statement start must be on or before its end.")
    out["evaluatedAt"] = utc(value.get("evaluatedAt"))
    if out["evaluatedAt"][:10] < out["endDate"]:
        fail("Select a generation evaluation at or after the statement period.")
    for field in ("openingUsd", "closingUsd"):
        amount = minor(value.get(field), field)
        out[field] = format(Decimal(amount) / 100, ".2f")
    if value.get("complete") is not True:
        fail("Confirm that this is the complete supplier statement for the selected period.")
    out["complete"] = True
    out["state"] = domain.enum(value.get("state", "DRAFT"), ("DRAFT", "REVIEWED"), "Review state")
    out["format"] = intake.format_input(value.get("format", {}))
    mapping = obj(value.get("mapping", {}), FIELDS, "Statement column mapping")
    out["mapping"] = {}
    for field in FIELDS:
        item = obj(mapping.get(field, {}), ("column", "value"), field)
        if set(item) == {"column"}:
            out["mapping"][field] = {"column": domain.integer(item["column"], field + " column", 0,
                                                            len(parsed["columns"]) - 1)}
        elif set(item) == {"value"}:
            out["mapping"][field] = {"value": text(item["value"], field, 12000)}
        else:
            fail("Map every statement field to one original column or an explicit value.")
    out["rowEdits"] = []
    seen = set()
    for row in value.get("rowEdits", []):
        obj(row, ("row", "values", "reason"), "Statement correction")
        number = domain.integer(row.get("row"), "Original source row", 1, 1000000)
        if number in seen or number not in {r["row"] for r in parsed["rows"]}:
            fail("Select each corrected original row exactly once.")
        seen.add(number)
        values = obj(row.get("values"), FIELDS, "Corrected fields")
        out["rowEdits"].append({"row": number, "values": {k: text(v, k, 12000) for k, v in values.items()},
                                "reason": text(row.get("reason"), "Correction reason", 4000, True)})
    out["ledgerReferences"] = []
    seen = set()
    for row in value.get("ledgerReferences", []):
        obj(row, ("recordId", "documentRef", "reason"), "Native reference mapping")
        identity = text(row.get("recordId"), "Original record", 100, True)
        if identity in seen:
            fail("Map each original ledger record once.")
        seen.add(identity)
        out["ledgerReferences"].append({"recordId": identity,
            "documentRef": text(row.get("documentRef"), "Selected document reference", 96, True),
            "reason": text(row.get("reason"), "Reference mapping reason", 4000, True)})
    out["possibleMatches"] = value.get("possibleMatches", False)
    if type(out["possibleMatches"]) is not bool:
        fail("Choose whether to include possible-match review.")
    out["dateWindowDays"] = domain.integer(value.get("dateWindowDays", 3), "Possible-match date window", 1, 31)
    out["decisions"] = []
    seen = set()
    rows = value.get("decisions", [])
    if not isinstance(rows, list) or len(rows) > 4000:
        fail("Retain the bounded complete exception decisions.")
    for row in rows:
        obj(row, ("key", "choice", "note", "record"), "Exception decision")
        key = domain.sha(row.get("key"), "Original exception", False)
        if key in seen:
            fail("Choose each exception once.")
        seen.add(key)
        choice = domain.enum(row.get("choice"), CHOICES, "Exception review")
        link = row.get("record")
        if choice == "LINKED_RECORD":
            obj(link, ("kind", "id", "version"), "Original record selection")
            kind = domain.enum(link.get("kind"), ("invoices", "cash"), "Original record kind")
            target = next((r for r in context["records"][kind] if r["id"] == link.get("id")), None)
            if target is None or link.get("version") != target["version"]:
                fail("The selected original record changed. Reopen and review it.", "SUPPLIER_LINK_CONFLICT", 409)
            link = {"kind": kind, "id": target["id"], "version": target["version"]}
        elif link is not None:
            fail("An unlinked decision must not retain an unrelated record.")
        out["decisions"].append({"key": key, "choice": choice,
            "note": text(row.get("note", ""), "Exception review note", 4000, choice != "OPEN"),
            "record": link})
    return out


def compare(context, metadata, raw, inputs, *, verify_time=True):
    if len(raw) != metadata["bytes"] or hashlib.sha256(raw).hexdigest() != metadata["sha256"]:
        fail("The original supplier file differs from its retained source.", "SUPPLIER_SOURCE_CHANGED", 409)
    parsed = intake.parse_source(raw, intake.format_input(inputs.get("format", {})))
    if len(parsed["rows"]) > MAX_ROWS:
        fail("The original reconciliation engine supports 1,000 complete rows per generation.", status=413)
    doc = document(inputs, context, parsed)
    evaluated = doc["evaluatedAt"]
    if verify_time and evaluated > utc(now()):
        fail("The retained evaluation cannot be in the future.")
    # Capture time means this retained source edition, not a claim of new issuer data.
    captured = utc(metadata["createdAt"])
    if captured > evaluated or utc(context["program"]["updatedAt"]) > evaluated:
        fail("Refresh the generation time after the selected source/case change.")
    report = payables.build(context, doc["contributorId"], doc["startDate"], doc["endDate"])
    supplier_ref = "supplier:" + doc["contributorId"]
    common = {"supplierRef": supplier_ref, "currency": "USD", "periodEnd": doc["endDate"], "complete": True}
    statement_rows, source_rows, errors = [], [], []
    edits = {r["row"]: r for r in doc["rowEdits"]}
    for original in parsed["rows"]:
        values = {}
        for key, selection in doc["mapping"].items():
            values[key] = selection.get("value", "") if "value" in selection else (
                original["cells"][selection["column"]].strip() if selection["column"] < len(original["cells"]) else "")
        correction = edits.get(original["row"])
        if correction:
            values.update(correction["values"])
        try:
            row_type = domain.enum(values["rowType"], ("INVOICE", "CREDIT", "PAYMENT", "ADJUSTMENT"), "Row type")
            event_date = intake.date_value(values["eventDate"], "Statement event date", doc["format"])
            if event_date > doc["endDate"] or (doc["startDate"] and event_date < doc["startDate"]):
                fail("This row falls outside the selected statement period.")
            effect = minor(values["effectUsd"], "Signed original USD effect", doc["format"])
            row = {"statementRowId": "statement-row-" + str(original["row"]), "documentRef": values["documentRef"],
                "rowType": row_type, "eventDate": event_date, "effectMinor": effect,
                "evidenceRef": "source:" + metadata["sha256"] + "/row/" + str(original["row"]),
                "evidenceDigest": digest({"sourceSha256": metadata["sha256"], "original": original})}
            statement_rows.append(row)
        except (Problem, ValueError, ArithmeticError) as exc:
            errors.append({"row": original["row"], "message": str(exc)})
        source_rows.append({"original": original, "values": values, "correction": correction})
    if errors:
        return {"schema": SCHEMA + ".preview", "document": doc, "source": metadata,
                "sourceRows": source_rows, "columns": parsed["columns"], "errors": errors,
                "ready": False, "account": report}
    if len(report["activity"]) > MAX_ROWS:
        fail("The complete native supplier activity exceeds the original engine's 1,000-row generation bound.", status=413)
    overrides = {r["recordId"]: r for r in doc["ledgerReferences"]}
    if set(overrides) - {r["recordId"] for r in report["activity"]}:
        fail("A mapped native reference is outside this exact account period.")
    ledger_rows = []
    for row in report["activity"]:
        effect = minor(row["balanceChangeUsd"], "Original ledger USD effect")
        if effect == 0:
            continue
        ledger_rows.append({"ledgerRowId": row["recordId"],
            "documentRef": overrides.get(row["recordId"], {}).get("documentRef", row["label"]),
            "rowType": "ADJUSTMENT" if row["kind"] == "REFUND" else row["kind"],
            "eventDate": row["date"], "effectMinor": effect,
            "evidenceRef": "sf47:" + context["program"]["id"] + "/" + row["recordId"],
            "evidenceDigest": digest(row)})
    source = {"generationId": "statement-" + metadata["sha256"], **common, "capturedAt": captured,
        "openingBalanceMinor": minor(doc["openingUsd"], "Statement opening USD"),
        "closingBalanceMinor": minor(doc["closingUsd"], "Statement closing USD"),
        "evidenceRef": "source:" + metadata["sha256"], "evidenceDigest": metadata["sha256"],
        "rows": statement_rows}
    ledger = {"generationId": "ledger-" + report["reportSha256"], **common, "capturedAt": evaluated,
        "openingBalanceMinor": minor(report["balances"]["opening"]["balanceUsd"], "Native opening USD"),
        "closingBalanceMinor": minor(report["balances"]["closing"]["balanceUsd"], "Native closing USD"),
        "evidenceRef": "sf47:" + context["program"]["id"] + "/supplier/" + doc["contributorId"],
        "evidenceDigest": report["reportSha256"], "rows": ledger_rows}
    engine_input = {"schemaVersion": "smb.supplier-statement-reconciliation.input/v1",
        "policy": {"maxAgeHours": 744, "enablePossibleMatchReview": doc["possibleMatches"],
                   "possibleMatchDateWindowDays": doc["dateWindowDays"]}, "statement": source, "ledger": ledger}
    receipt = engine(engine_input, evaluated)
    decisions = {row["key"]: row for row in doc["decisions"]}
    queue = []
    for row in receipt["reviewQueue"]:
        key = digest(row)
        decision = decisions.get(key, {"key": key, "choice": "OPEN", "note": "", "record": None})
        linked = None
        if decision["record"]:
            linked = next(r for r in context["records"][decision["record"]["kind"]]
                          if r["id"] == decision["record"]["id"])
            belongs = (linked.get("contributorId") == doc["contributorId"] if decision["record"]["kind"] == "invoices"
                       else any(a["invoiceId"] in {i["id"] for i in report["invoices"]} for a in linked["allocations"]))
            if not belongs:
                fail("Link an original record belonging to this supplier account.")
        queue.append({"key": key, "exception": row, "decision": decision, "record": linked})
    stale = set(decisions) - {r["key"] for r in queue}
    if stale:
        fail("The exception set changed. Retain the earlier edition and explicitly review current exceptions.",
             "SUPPLIER_DECISIONS_CHANGED", 409)
    opened = sum(row["decision"]["choice"] == "OPEN" for row in queue)
    if doc["state"] == "REVIEWED" and opened:
        fail("Review every current exception before marking this edition reviewed.")
    result = {"schema": SCHEMA + ".preview", "document": doc, "source": metadata,
        "sourceRows": source_rows, "columns": parsed["columns"], "errors": [], "ready": True,
        "account": report, "input": engine_input, "receipt": receipt, "items": queue, "openItems": opened}
    result["previewSha256"] = digest(result)
    if len(canonical(result).encode()) > MAX_REVIEW_BYTES:
        fail("This complete review exceeds its 8 MiB retained edition bound.", status=413)
    return result


def preview(ops, context, body):
    obj(body, ("expectedVersion", "document"), "Statement preview")
    if body.get("expectedVersion") != context["program"]["version"]:
        fail("Reopen the current native account before review.", "OPERATIONS_CONFLICT", 409)
    inputs = body.get("document")
    if not isinstance(inputs, dict):
        fail("Supply the complete editable statement document.")
    metadata, raw = ops.source(context["program"]["id"], inputs.get("sourceId"))
    result = compare(context, metadata, raw, inputs)
    previous = latest(records(ops, context["program"]["id"]), inputs.get("statementId"))
    if inputs.get("previousReviewId") != (previous["id"] if previous else None):
        fail("Select the actual previous saved statement edition.", "SUPPLIER_EDITION_CONFLICT", 409)
    return result


def save(ops, context, data, actor, version, note):
    obj(data, ("document", "expectedPreviewSha256"), "Supplier statement save")
    text(note, "Saved edition note", 12000, True)
    candidate = preview(ops, context, {"expectedVersion": version - 1, "document": data.get("document")})
    if not candidate.get("ready") or candidate.get("previewSha256") != data.get("expectedPreviewSha256"):
        fail("Save the exact complete reviewed comparison.", "SUPPLIER_PREVIEW_CONFLICT", 409)
    previous = latest(records(ops, context["program"]["id"]), candidate["document"]["statementId"])
    snapshot = deepcopy(context)
    row = {"id": "review-" + uuid.uuid4().hex, "version": version, "createdAt": now(),
        "actor": actor, "note": note, "purpose": PURPOSE, "snapshot": snapshot,
        "businessSha256": digest(snapshot), "report": {"supplierStatement": candidate["receipt"]},
        "supplierStatement": {**candidate, "revision": previous["supplierStatement"]["revision"] + 1 if previous else 1,
            "previousSha256": previous["sha256"] if previous else None}}
    row["sha256"] = digest(row)
    ops.db.execute("INSERT INTO ops_reviews VALUES(?,?,?)",
                   (context["program"]["id"], row["id"], canonical(row)))
    return {"before": summary(previous) if previous else None, "after": summary(row),
        "kind": "review", "recordId": row["id"], "supplierStatement": summary(row)}



PROGRAM_BASE_FIELDS = ("id", "planId", "name", "mode", "calendarStart", "createdAt")
ANCESTRY = "supplierStatementPrograms"


def program_base(program):
    value = {key: deepcopy(program[key]) for key in PROGRAM_BASE_FIELDS}
    value["origin"] = {key: deepcopy(item) for key, item in program.get("origin", {}).items() if key != ANCESTRY}
    return value


def program_ancestry(program):
    rows = deepcopy(program.get("origin", {}).get(ANCESTRY, []))
    if not isinstance(rows, list) or len(rows) > 1000:
        fail("Retain the bounded original supplier programme ancestry.", "SUPPLIER_RECEIVING")
    seen = set()
    for index, row in enumerate(rows):
        if (not isinstance(row, dict) or set(row) != set(PROGRAM_BASE_FIELDS) | {"origin"}
                or row["id"] in seen or not isinstance(row["origin"], dict)):
            fail("An original supplier programme identity is incomplete or repeated.", "SUPPLIER_RECEIVING")
        ident(row["id"], re.compile(r"operation-[a-f0-9]{32}"), "ancestor programme")
        ident(row["planId"], re.compile(r"plan-[a-f0-9]{32}"), "ancestor planning source")
        if index and row["origin"].get("programId") != rows[index - 1]["id"]:
            fail("The original supplier receiving ancestry has a missing source programme.", "SUPPLIER_RECEIVING")
        seen.add(row["id"])
    if rows and program.get("origin", {}).get("programId") != rows[-1]["id"]:
        fail("The current programme is not the retained ancestry's actual receiver.", "SUPPLIER_RECEIVING")
    current = program_base(program)
    if current["id"] in seen:
        fail("The original supplier ancestry repeats its current receiver.", "SUPPLIER_RECEIVING")
    return rows + [current]


def retained_program_ancestry(source_program):
    """Called by the existing importer when forming its ordinary origin object."""
    return program_ancestry(source_program)


def sources_at(events, version):
    result = {}
    for event in events[:version]:
        if event.get("kind") == "source":
            after = event.get("after")
            if not isinstance(after, dict) or after.get("id") != event.get("recordId"):
                fail("An original source event is incomplete.", "SUPPLIER_RECEIVING")
            prior = result.get(after["id"])
            if prior is not None and event.get("before") != prior:
                fail("An original source update lost its preceding metadata.", "SUPPLIER_RECEIVING")
            result[after["id"]] = deepcopy(after)
        change = event.get("sourceChange")
        if change is not None:
            if not isinstance(change, dict) or set(change) - {"added", "removed"}:
                fail("Retain the original source-change representation.", "SUPPLIER_RECEIVING")
            for old in change.get("removed", []):
                identity = old.get("id") if isinstance(old, dict) else old
                if identity not in result or (isinstance(old, dict) and result[identity] != old):
                    fail("A source removal differs from its original available metadata.", "SUPPLIER_RECEIVING")
                del result[identity]
            for new in change.get("added", []):
                if not isinstance(new, dict) or not isinstance(new.get("id"), str) or new["id"] in result:
                    fail("An original source addition is missing or repeated.", "SUPPLIER_RECEIVING")
                result[new["id"]] = deepcopy(new)
    return result


def validate_program(snapshot, context, events, review):
    program, version = snapshot["program"], review["version"] - 1
    author = next((item for item in program_ancestry(context["program"]) if item["id"] == program.get("id")), None)
    if author is None or program_base(program) != author:
        fail("The supplier review was relabelled to another original programme.", "SUPPLIER_RECEIVING")
    state = "OPEN"
    for event in events[:version]:
        if event.get("action") in ("close", "reopen"):
            state = event["after"]["state"]
    applied = [event["version"] for event in events[:version] if event.get("action") == "amendment.apply"]
    if (program["version"] != version or program["state"] != state
            or program["mode"] != events[0].get("after", {}).get("mode")
            or program["planId"] != snapshot["plan"]["id"]
            or program["planRevision"] != snapshot["plan"]["revision"]
            or program.get("lastPlanAmendmentVersion") != (applied[-1] if applied else None)):
        fail("The saved supplier programme differs from its original event prefix.", "SUPPLIER_RECEIVING")
    created = datetime.fromisoformat(domain.timestamp(program["createdAt"], "Original case creation").replace("Z", "+00:00"))
    updated = datetime.fromisoformat(domain.timestamp(program["updatedAt"], "Original case update").replace("Z", "+00:00"))
    saved = datetime.fromisoformat(domain.timestamp(review["createdAt"], "Original supplier review").replace("Z", "+00:00"))
    if not created <= updated <= saved:
        fail("The saved supplier programme has inconsistent original times.", "SUPPLIER_RECEIVING")


def validate_import(context, reviews, events, files, plan_for_version, work_intakes=()):
    books = sorted((r for r in reviews if r.get("purpose") == PURPOSE), key=lambda r: r["version"])
    if {e.get("recordId") for e in events if e.get("action") == ACTION} != {r["id"] for r in books}:
        fail("The complete case is missing a supplier statement review.", "SUPPLIER_RECEIVING")
    heads = {}
    for row in books:
        ident(row.get("id"), REVIEW_ID, "supplier review")
        version = domain.integer(row.get("version"), "Original review version", 2, len(events))
        if row.get("sha256") != digest({k: v for k, v in row.items() if k != "sha256"}):
            fail("The saved supplier review differs from its exact bytes.", "SUPPLIER_RECEIVING")
        saved, snapshot = row["supplierStatement"], row["snapshot"]
        original = amendments._records_at(events, version - 1, work_intakes)
        if (amendments._record_set(snapshot["records"]) != original
                or not amendments.same_plan(snapshot["plan"], plan_for_version(version - 1))
                or snapshot["program"]["version"] != version - 1):
            fail("The supplier review differs from the original native case edition.", "SUPPLIER_RECEIVING")
        validate_program(snapshot, context, events, row)
        if snapshot["sources"] != sources_at(events, version - 1):
            fail("The supplier snapshot differs from the exact sources available at its saved version.", "SUPPLIER_RECEIVING")
        metadata = saved["source"]
        if snapshot["sources"].get(metadata["id"]) != metadata or context["sources"].get(metadata["id"]) != metadata:
            fail("The statement lost its exact original source metadata.", "SUPPLIER_RECEIVING")
        for source_id, source in snapshot["sources"].items():
            if source != context["sources"].get(source_id):
                fail("A review snapshot replaced an original source.", "SUPPLIER_RECEIVING")
        candidate = compare(snapshot, metadata, files["sources/" + metadata["id"]], saved["document"], verify_time=False)
        previous = heads.get(saved["document"]["statementId"])
        if (saved != {**candidate, "revision": previous["supplierStatement"]["revision"] + 1 if previous else 1,
                      "previousSha256": previous["sha256"] if previous else None}
                or saved["document"]["previousReviewId"] != (previous["id"] if previous else None)
                or row["report"] != {"supplierStatement": candidate["receipt"]}):
            fail("The complete original comparison/edition chain changed.", "SUPPLIER_RECEIVING")
        event = events[version - 1]
        if (event.get("action") != ACTION or event.get("recordId") != row["id"]
                or event.get("after") != summary(row) or event.get("before") != (summary(previous) if previous else None)
                or event.get("actor") != row["actor"] or event.get("note") != row["note"]):
            fail("The supplier review does not bind its original native save.", "SUPPLIER_RECEIVING")
        heads[saved["document"]["statementId"]] = row
    return books


def render(review):
    value = review["supplierStatement"]
    esc = lambda item: html.escape(str(item if item is not None else ""), quote=True)
    def table(headers, rows):
        return "<table><thead><tr>" + "".join("<th>" + esc(h) + "</th>" for h in headers) + "</tr></thead><tbody>" + "".join(
            "<tr>" + "".join("<td>" + esc(c) + "</td>" for c in row) + "</tr>" for row in rows) + "</tbody></table>"
    sections = []
    for row in value["items"]:
        item, decision = row["exception"], row["decision"]
        sections.append("<section><h2>" + esc(item["kind"].replace("_", " ").title()) + "</h2>" + table(
            ["Reference", "Type", "Statement cents", "Ledger cents", "Decision", "Note"],
            [[item["documentRef"], item["rowType"], item["statementEffectMinor"], item["ledgerEffectMinor"],
              decision["choice"], decision["note"]]]) + "<p>" + esc(item["reason"]) + "</p></section>")
    return ('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        '<title>Supplier statement review</title><style>body{font:15px system-ui;max-width:1100px;margin:32px auto;padding:0 20px;color:#171717;background:#fff}'
        'table{border-collapse:collapse;width:100%;margin:16px 0}th,td{border:1px solid #aaa;padding:8px;text-align:left;overflow-wrap:anywhere}'
        'th{background:#eee}section{border-top:1px solid #aaa;margin-top:24px}a{color:inherit}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style>'
        '<h1>' + esc(value["document"]["name"]) + '</h1><p>' + esc(value["account"]["account"]["name"]) +
        ' · ' + esc(value["document"]["startDate"] or "All recorded dates") + ' through ' + esc(value["document"]["endDate"]) +
        '</p><p>Saved review ' + esc(review["id"]) + ' · ' + esc(review["sha256"]) + '</p><p><a href="original-source">Original supplier file</a> · '
        '<a href="supplier-statement.json">Complete saved review</a> · <a href="operations-case.zip">Complete operating case</a></p>' +
        table(["Position", "Statement cents", "Native account cents"], [
            ["Opening", value["receipt"]["balances"]["statementOpeningBalanceMinor"], value["receipt"]["balances"]["ledgerOpeningBalanceMinor"]],
            ["Closing", value["receipt"]["balances"]["statementClosingBalanceMinor"], value["receipt"]["balances"]["ledgerClosingBalanceMinor"]]]) +
        "<p>Exact USD cents retain the original account basis. Exception decisions are saved review notes; use original Work, Invoices and Cash controls for record changes.</p>" +
        "".join(sections) + "<h2>Complete retained source rows</h2>" + table(
            ["Row", "Lines", "Original cells", "Selected values", "Correction"],
            [[r["original"]["row"], str(r["original"]["lineStart"]) + "–" + str(r["original"]["lineEnd"]),
              canonical(r["original"]["cells"]), canonical(r["values"]), canonical(r["correction"])] for r in value["sourceRows"]]) +
        "</html>").encode()


def bundle_files(review, raw, original_case):
    value = review["supplierStatement"]
    flattened = [{**r["exception"], "key": r["key"], "choice": r["decision"]["choice"],
                  "note": r["decision"]["note"], "record": canonical(r["decision"]["record"])} for r in value["items"]]
    choice = {"schema": SCHEMA + ".selection", "reviewId": review["id"], "reviewSha256": review["sha256"],
              "originalCaseId": review["snapshot"]["program"]["id"], "sourceSha256": value["source"]["sha256"]}
    return {"supplier-statement.json": (canonical(review) + "\n").encode(),
        "supplier-statement.html": render(review),
        "statement-rows.csv": csv_bytes(["statementRowId", "documentRef", "rowType", "eventDate", "effectMinor", "evidenceRef", "evidenceDigest"], value["input"]["statement"]["rows"]),
        "ledger-rows.csv": csv_bytes(["ledgerRowId", "documentRef", "rowType", "eventDate", "effectMinor", "evidenceRef", "evidenceDigest"], value["input"]["ledger"]["rows"]),
        "review-items.csv": csv_bytes(["key", "kind", "documentRef", "rowType", "statementEffectMinor", "ledgerEffectMinor", "choice", "note", "record"], flattened),
        "selection.json": (canonical(choice) + "\n").encode(), "original-source": raw,
        "operations-case.zip": original_case,
        "README.txt": ("Open supplier-statement.html and the complete CSV/JSON members. Import this complete ZIP through the original Grant Operations importer to retain all original case records, attachments, statement editions and reviews. Continue original record actions, then prepare a following statement edition.\n").encode()}


def export(ops, case_id, review_id):
    review = selected(ops, case_id, review_id)
    metadata, raw = ops.source(case_id, review["supplierStatement"]["source"]["id"])
    if metadata != review["supplierStatement"]["source"]:
        fail("The selected original source changed.")
    files = bundle_files(review, raw, ops.export(case_id))
    manifest = {"schema": BUNDLE_SCHEMA, "files": [{"path": name, "bytes": len(raw),
        "sha256": hashlib.sha256(raw).hexdigest()} for name, raw in sorted(files.items())]}
    files["MANIFEST.json"] = (canonical(manifest) + "\n").encode()
    if sum(map(len, files.values())) > MAX_BUNDLE:
        fail("The complete statement handover exceeds the original 32 MiB case bound.", status=413)
    target = io.BytesIO()
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, raw in sorted(files.items()):
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.external_attr = 0o100600 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, raw)
    return target.getvalue()


def unwrap_bundle(raw):
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            if "supplier-statement.json" not in archive.namelist():
                return raw, None
            infos = archive.infolist()
            names = [r.filename for r in infos]
            if set(names) != DERIVED | {"MANIFEST.json"} or len(names) != len(set(names)) or sum(r.file_size for r in infos) > MAX_BUNDLE:
                fail("The complete supplier handover has an invalid member set.", "SUPPLIER_RECEIVING")
            manifest = json.loads(archive.read("MANIFEST.json"))
            if manifest.get("schema") != BUNDLE_SCHEMA or len(manifest.get("files", [])) != len(DERIVED):
                fail("The original supplier manifest is invalid.", "SUPPLIER_RECEIVING")
            files = {}
            for row in manifest["files"]:
                name = row.get("path")
                if name not in DERIVED or name in files:
                    fail("The original supplier manifest repeats or replaces a member.", "SUPPLIER_RECEIVING")
                body = archive.read(name)
                if len(body) != row.get("bytes") or hashlib.sha256(body).hexdigest() != row.get("sha256"):
                    fail("A complete supplier member changed.", "SUPPLIER_RECEIVING")
                files[name] = body
            if set(files) != DERIVED:
                fail("The supplier handover is missing an original member.", "SUPPLIER_RECEIVING")
            review = json.loads(files["supplier-statement.json"])
            original = bundle_files(review, files["original-source"], files["operations-case.zip"])
            if files != original:
                fail("The supplier reports differ from their original review.", "SUPPLIER_RECEIVING")
            return files["operations-case.zip"], {"review": review, "source": files["original-source"]}
    except zipfile.BadZipFile:
        return raw, None
    except (KeyError, TypeError, ValueError, RuntimeError) as exc:
        if isinstance(exc, Problem):
            raise
        raise Problem("The supplier handover is unreadable.", 422, "SUPPLIER_RECEIVING") from exc


def validate_received(selection, document, files):
    if selection is None:
        return
    review = selection["review"]
    if review not in document.get("reviews", []):
        fail("The selected supplier review is absent from its original case.", "SUPPLIER_RECEIVING")
    metadata = review["supplierStatement"]["source"]
    if files.get("sources/" + metadata["id"]) != selection["source"]:
        fail("The selected supplier statement differs from the original case source.", "SUPPLIER_RECEIVING")


def listing(ops, context):
    return {"case": deepcopy(context["program"]),
            "editions": [summary(row) for row in records(ops, context["program"]["id"])]}


def seed_document(ops, context, body):
    obj(body, ("expectedVersion", "reviewId"), "Statement draft selection")
    if body.get("expectedVersion") != context["program"]["version"]:
        fail("Reopen the current case before selecting an edition.", "OPERATIONS_CONFLICT", 409)
    if body.get("reviewId"):
        original = selected(ops, context["program"]["id"], body["reviewId"])
        current = latest(records(ops, context["program"]["id"]), original["supplierStatement"]["document"]["statementId"])
        value = deepcopy(original["supplierStatement"]["document"])
        value["previousReviewId"] = current["id"]
        value["evaluatedAt"] = utc(now())
        value["state"] = "DRAFT"
        # Keep every earlier decision visible. The operator explicitly selects which
        # current exceptions it applies to after previewing the following generation.
    else:
        value = seed(context)
    return {"case": deepcopy(context["program"]), "document": value,
            "suppliers": deepcopy(context["records"]["contributors"]),
            "sources": list(deepcopy(context["sources"]).values())}


def show(ops, context, review_id):
    row = selected(ops, context["program"]["id"], review_id)
    original = row["supplierStatement"]
    current = payables.build(context, original["document"]["contributorId"],
                             original["document"]["startDate"], original["document"]["endDate"])
    return {"case": deepcopy(context["program"]), "review": row, "currentAccount": current,
            "changed": current["reportSha256"] != original["account"]["reportSha256"],
            "history": [summary(r) for r in records(ops, context["program"]["id"])
                        if r["supplierStatement"]["document"]["statementId"] == original["document"]["statementId"]]}


def request(ops, context, body, operations_schema):
    from model import short_id
    obj(body, ("command",), "Original statement request")
    command = obj(body.get("command"), ("expectedVersion", "actor", "action", "data", "note", "requestId"),
                  "Original retained statement command")
    if command.get("action") != ACTION:
        fail("Select the original supplier-statement.save request.")
    domain.integer(command.get("expectedVersion"), "Original case version", 1, 10000000)
    actor = text(command.get("actor"), "Original recording operator", 300, True)
    text(command.get("note"), "Original review note", 12000, True)
    obj(command.get("data"), ("document", "expectedPreviewSha256"), "Original statement save data")
    request_id = short_id(command.get("requestId"), "Original request ID")
    fingerprint = digest({"domain": operations_schema, "programId": context["program"]["id"], "body": command})
    found = ops.db.execute("SELECT fingerprint,result_json FROM requests WHERE request_id=?", (request_id,)).fetchone()
    if found is None:
        return {"found": False, "requestId": request_id}
    if found[0] != fingerprint:
        fail("This request ID belongs to another original action.", "REQUEST_CONFLICT", 409)
    result = json.loads(found[1])
    row = selected(ops, context["program"]["id"], result.get("recordId"))
    event_row = ops.db.execute("SELECT body_json FROM ops_events WHERE program_id=? AND version=?",
                               (context["program"]["id"], result.get("version"))).fetchone()
    if event_row is None:
        fail("The accepted original statement has no native event.", "SUPPLIER_REQUEST_CHANGED", 409)
    event = json.loads(event_row[0])
    if (result.get("id") != context["program"]["id"] or result.get("action") != ACTION
            or result.get("kind") != "review" or result.get("supplierStatement") != summary(row)
            or event.get("action") != ACTION or event.get("requestId") != request_id
            or event.get("recordId") != row["id"] or event.get("after") != summary(row)
            or event.get("actor") != actor or event.get("version") != command["expectedVersion"] + 1
            or digest({k: v for k, v in event.items() if k != "sha256"}) != event.get("sha256")):
        fail("The accepted statement differs from its original native request.", "SUPPLIER_REQUEST_CHANGED", 409)
    return {"found": True, "requestId": request_id, "fingerprint": fingerprint, "result": result}


def inspect_source(ops, context, body):
    obj(body, ("expectedVersion", "sourceId", "format"), "Original statement source selection")
    if body.get("expectedVersion") != context["program"]["version"]:
        fail("Reopen the current native case before source inspection.", "OPERATIONS_CONFLICT", 409)
    metadata, raw = ops.source(context["program"]["id"], body.get("sourceId"))
    parsed = intake.parse_source(raw, intake.format_input(body.get("format", {})))
    return {"case": deepcopy(context["program"]), "source": metadata, **parsed}
