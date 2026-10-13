"""Original account statement reconciliation, saved period closes and receiving.

Statements own their source interpretation and cash intake. Cash Accounts owns
correction chains. This module compares complete native movements in one explicit
period and records the operator's matching and outstanding decisions as immutable
source editions through the original Operations transaction.
"""
from __future__ import annotations

import base64
from copy import deepcopy
from decimal import Decimal
import hashlib
import html
import io
import json
import re
import uuid
import zipfile

from model import Problem, canonical, digest, now, text, short_id, csv_bytes, MAX_BUNDLE
import operations_domain as domain
import operations_statements as statements
import operations_cash_accounts as cash_accounts
import operations_performance as performance

SCHEMA = "stellar-forge.sf47-account-reconciliation.v1"
PREVIEW_SCHEMA = SCHEMA + ".preview"
EDITION_SCHEMA = SCHEMA + ".edition"
SOURCE_PATTERN = re.compile(r"account-reconciliation-([a-f0-9]{32})-r([1-9][0-9]*)\.json")
ID_PATTERN = re.compile(r"reconciliation-[a-f0-9]{32}")
ZERO = Decimal("0")
BODY_KEYS = {"expectedVersion", "reconciliationId", "expectedRevision", "state", "document",
             "expectedPreviewSha256", "actor", "requestId"}
DOCUMENT_KEYS = {"name", "statementSourceId", "periodStart", "periodEnd",
                 "links", "exclusions", "outstanding", "note"}
SOURCE_ROW_FIELDS = ("rowNumber", "original", "reference", "date", "description", "direction",
                     "amount", "currency", "usdValue", "category", "tranche", "allocations",
                     "action", "reason", "sourceLine", "identityBasis", "providerReference", "nativeIdentity")
MAX_SOURCE = 8 * 1024 * 1024
MAX_SOURCES = 24 * 1024 * 1024


def fail(message, code="INVALID_ACCOUNT_RECONCILIATION", status=422):
    domain.fail(message, code, status)


def object_value(value, allowed, label):
    if not isinstance(value, dict) or set(value) - set(allowed):
        fail(label + ": use the declared complete object fields.")
    return value


def native_id(value, prefix):
    if not isinstance(value, str) or not re.fullmatch(re.escape(prefix) + r"-[a-f0-9]{32}", value):
        fail("Select the retained " + prefix + " identity.")
    return value


def number(value):
    return statements.amount_string(value)


def signed(row):
    if row.get("amount") is None or row.get("direction") not in ("IN", "OUT"):
        return None
    amount = Decimal(row["amount"])
    return amount if row["direction"] == "IN" else -amount


def totals(rows):
    values = [signed(row) for row in rows]
    positive = sum((value for value in values if value is not None and value >= ZERO), ZERO)
    negative = -sum((value for value in values if value is not None and value < ZERO), ZERO)
    return {"inflow": number(positive), "outflow": number(negative),
            "net": number(positive - negative), "count": len(rows)}


def case_identity(context):
    return {key: deepcopy(context["program"].get(key))
            for key in ("id", "name", "mode", "state", "version", "planId")}


def source_candidates(context):
    return [row for row in context["sources"].values()
            if SOURCE_PATTERN.fullmatch(row.get("filename", ""))
            and row.get("mediaType") == "application/json"]


def needed_sources(context):
    ids = {row["id"] for row in source_candidates(context)}
    ids.update(row["id"] for row in cash_accounts._correction_sources(context))
    for row in context["sources"].values():
        marker = row.get("statement")
        if isinstance(marker, dict) and marker.get("schema") == statements.SCHEMA:
            ids.add(row["id"])
            if marker.get("role") in ("CSV", "ORIGINAL"):
                ids.add(marker.get("reviewSourceId"))
    return ids


def original_files(ops, context):
    files = {}
    for ident in needed_sources(context):
        if ident not in context["sources"]:
            fail("Retain the complete original statement and review source.", "RECONCILIATION_SOURCE")
        metadata, raw = ops.source(context["program"]["id"], ident)
        if metadata != context["sources"][ident]:
            fail("The original source changed while reading the selected case.", "RECONCILIATION_SOURCE")
        files["sources/" + ident] = raw
    return files


def source_bytes(metadata, files):
    try:
        raw = files["sources/" + metadata["id"]]
    except KeyError as exc:
        raise Problem("The complete reconciliation is missing an original source.", 422,
                      "RECONCILIATION_SOURCE") from exc
    if (not isinstance(raw, bytes) or len(raw) != metadata["bytes"]
            or hashlib.sha256(raw).hexdigest() != metadata["sha256"]):
        fail("An original reconciliation source differs from its retained bytes.", "RECONCILIATION_SOURCE")
    return raw


def load_statements(context, events, files):
    statements.validate_import(context, events, files)
    result = {}
    for metadata in context["sources"].values():
        marker = metadata.get("statement")
        if (not isinstance(marker, dict) or marker.get("schema") != statements.SCHEMA
                or marker.get("role") not in ("CSV", "ORIGINAL")):
            continue
        review_metadata = context["sources"].get(marker.get("reviewSourceId"))
        if not review_metadata:
            fail("Retain the statement's original review source.", "RECONCILIATION_SOURCE")
        raw = source_bytes(metadata, files)
        try:
            review = json.loads(source_bytes(review_metadata, files))
            original = review["preview"]
            inputs = {**review["inputs"], "source": {
                **review["sourceObservation"], "contentBase64": base64.b64encode(raw).decode("ascii")}}
        except (KeyError, ValueError, UnicodeError, TypeError) as exc:
            raise Problem("The original statement interpretation is incomplete.", 422,
                          "RECONCILIATION_SOURCE") from exc
        if (original.get("canImport") is not True
                or review.get("sourceId") != metadata["id"]
                or original.get("source", {}).get("sha256") != metadata["sha256"]):
            fail("Select an original received statement and its complete interpretation.", "RECONCILIATION_SOURCE")
        domain.integer(review.get("caseVersion"), "Original statement receiving version",
                       1, context["program"]["version"])
        # Reuse the source parser and native cash normalizer. The empty cash
        # population makes this a source projection, independent of later voids.
        projected_context = {**context, "program": {**context["program"], "state": "OPEN"},
                             "records": {**context["records"], "cash": []},
                             "sources": {}, "cashCorrections": {}}
        projected = statements.preview(projected_context, inputs)
        if (projected["source"]["sha256"] != metadata["sha256"]
                or projected["source"]["editionSha256"] != marker["editionSha256"]
                or projected["headers"] != original.get("headers")
                or projected["balance"] != original.get("balance")
                or len(projected["rows"]) != len(original["rows"])):
            fail("The retained statement interpretation differs from its original file.", "RECONCILIATION_SOURCE")
        for actual, retained in zip(projected["rows"], original["rows"]):
            if any(actual.get(key) != retained.get(key) for key in SOURCE_ROW_FIELDS):
                fail("A statement row differs from its original mapped source.", "RECONCILIATION_SOURCE")
            if retained["status"] != "EXCLUDED":
                if (not isinstance(actual.get("record"), dict)
                        or statements.cash_facts(actual["record"]) != statements.cash_facts(retained["record"])):
                    fail("A statement movement differs from its native original facts.", "RECONCILIATION_SOURCE")
        for key in ("inflow", "outflow", "net", "completeAmounts"):
            if projected["summary"][key] != original.get("summary", {}).get(key):
                fail("The statement totals differ from its complete original rows.", "RECONCILIATION_SOURCE")
        result[metadata["id"]] = {"source": deepcopy(metadata), "reviewSource": deepcopy(review_metadata),
                                  "review": review, "projection": projected, "inputs": inputs}
    return result


def statement_summary(value):
    original = value["review"]["preview"]
    source, balance = original["source"], original["balance"]
    dates = sorted(row["date"] for row in original["rows"] if row.get("date"))
    return {"sourceId": value["source"]["id"], "reviewSourceId": value["reviewSource"]["id"],
            "accountId": source["accountId"], "accountLabel": source["accountLabel"],
            "currency": source["currency"], "network": "statement/" + source["accountId"],
            "asset": source["currency"], "source": deepcopy(value["source"]),
            "reviewSource": deepcopy(value["reviewSource"]), "sourceSha256": source["sha256"],
            "editionSha256": source["editionSha256"], "observedAt": source["observedAt"],
            "firstDate": dates[0] if dates else None, "lastDate": dates[-1] if dates else None,
            "rows": len(original["rows"]), "excludedRows": original["summary"]["excludedCount"],
            "openingBalance": balance["openingBalance"], "closingBalance": balance["closingBalance"],
            "balanceStatus": balance["status"], "retainedAtVersion": value["review"]["caseVersion"]}


def normalize_document(value, context, original_statements):
    value = object_value(value, DOCUMENT_KEYS, "Reconciliation document")
    source_id = native_id(value.get("statementSourceId"), "source")
    if source_id not in original_statements:
        fail("Select a retained original account statement.", "RECONCILIATION_STATEMENT")
    start = domain.calendar(value.get("periodStart"), "Original statement period start")
    end = domain.calendar(value.get("periodEnd"), "Original statement period end")
    if end < start:
        fail("The statement period end must not precede its start.")
    document = {"name": text(value.get("name"), "Reconciliation name", 300, True),
                "statementSourceId": source_id, "periodStart": start, "periodEnd": end,
                "links": [], "exclusions": [], "outstanding": [],
                "note": text(value.get("note", ""), "Reconciliation note", 12000)}
    row_ids = {row["rowNumber"] for row in original_statements[source_id]["review"]["preview"]["rows"]}
    cash_ids = {row["id"] for row in context["records"]["cash"]}
    used_rows, used_cash = set(), set()
    links = value.get("links", [])
    if not isinstance(links, list) or len(links) > 5000:
        fail("Use the complete original match groups, up to 5,000 groups.")
    for link in links:
        object_value(link, {"rowNumbers", "cashIds", "reason"}, "Explicit match group")
        rows, cash = link.get("rowNumbers"), link.get("cashIds")
        if (not isinstance(rows, list) or not rows or len(rows) > 5000
                or any(isinstance(row, bool) or not isinstance(row, int) or row not in row_ids for row in rows)
                or len(set(rows)) != len(rows) or used_rows.intersection(rows)):
            fail("Each original statement row can occur in only one explicit match group.")
        if (not isinstance(cash, list) or not cash or len(cash) > 5000
                or any(not isinstance(ident, str) or ident not in cash_ids for ident in cash)
                or len(set(cash)) != len(cash) or used_cash.intersection(cash)):
            fail("Each complete native cash record can occur in only one explicit match group.")
        used_rows.update(rows)
        used_cash.update(cash)
        document["links"].append({"rowNumbers": sorted(rows), "cashIds": sorted(cash),
                                  "reason": text(link.get("reason"), "Original matching reason", 12000, True)})
    exclusions = value.get("exclusions", [])
    if not isinstance(exclusions, list) or len(exclusions) > 5000:
        fail("Use the complete retained informational-row decisions.")
    for item in exclusions:
        object_value(item, {"rowNumber", "reason"}, "Original informational-row decision")
        row = domain.integer(item.get("rowNumber"), "Original source row", 2, 10000000)
        if row not in row_ids or row in used_rows:
            fail("Choose an original row not already included in a matching or informational decision.")
        used_rows.add(row)
        document["exclusions"].append({"rowNumber": row,
                                       "reason": text(item.get("reason"), "Informational-row reason", 12000, True)})
    outstanding = value.get("outstanding", [])
    if not isinstance(outstanding, list) or len(outstanding) > 5000:
        fail("Use the complete outstanding movement selection.")
    for item in outstanding:
        object_value(item, {"cashId", "reason", "expectedClearDate", "sourceIds"}, "Outstanding movement")
        ident = native_id(item.get("cashId"), "cash")
        if ident not in cash_ids or ident in used_cash:
            fail("An outstanding native movement must be distinct from every other selected cash record.")
        used_cash.add(ident)
        document["outstanding"].append({
            "cashId": ident, "reason": text(item.get("reason"), "Outstanding movement reason", 12000, True),
            "expectedClearDate": domain.calendar(item.get("expectedClearDate"), "Expected statement clearance", True),
            "sourceIds": domain.reference_list(item.get("sourceIds", []), context["sources"],
                                               "Outstanding movement sources")})
    document["links"].sort(key=lambda row: (row["rowNumbers"], row["cashIds"]))
    document["exclusions"].sort(key=lambda row: row["rowNumber"])
    document["outstanding"].sort(key=lambda row: row["cashId"])
    return document


def _cash_before_void(context, event, after):
    """Read one original native void through its exact command/source binding."""
    def invalid():
        fail("The saved reconciliation requires the original cash void history.", "RECONCILIATION_HISTORY")

    if not isinstance(event, dict) or event.get("version") != after["version"]:
        invalid()
    if event.get("action") == "cash.void":
        if event.get("kind") != "cash" or event.get("after") != after:
            invalid()
        before = event.get("before")
    elif event.get("action") == "settlement.correct":
        try:
            original = event["after"]
            review = original["review"]
            change = event["sourceChange"]
            source_before, source_after = change["before"], change["after"]
            retained = context["sources"][review["sourceId"]]
            history = retained["settlementHandoff"]["reviews"]
            position = next(index for index, value in enumerate(history) if value["id"] == review["id"])
            changes = review["cashChanges"]
            selected = [value for value in changes if value.get("after") == after]
            if (event.get("kind") != "settlementReceiving"
                    or review.get("schema") != "scf.operations.settlement-receiving.v1.review"
                    or review.get("type") != "CORRECTION" or review["version"] != event["version"]
                    or review["id"] != event["recordId"] or review["requestId"] != event["requestId"]
                    or review["actor"] != text(event["actor"], "Original settlement operator", 300, True)
                    or digest({key: value for key, value in review.items() if key != "sha256"}) != review["sha256"]
                    or history[position] != review or position == 0
                    or event["before"].get("reviewId") != review["previousReviewId"]
                    or review["previousReviewId"] != history[position - 1]["id"]
                    or source_before["id"] != retained["id"] or source_after["id"] != retained["id"]
                    or any(value != retained["sha256"] for value in
                           (source_before["sha256"], source_after["sha256"],
                            review["sourceSha256"], original["sourceSha256"]))
                    or source_before["settlementHandoff"]["reviews"] != history[:position]
                    or source_after["settlementHandoff"]["reviews"] != history[:position + 1]
                    or event["before"].get("cash") != [value.get("before") for value in changes]
                    or original.get("cash") != [value.get("after") for value in changes]
                    or len(selected) != 1
                    or review["selectionInputs"].get("decision") not in ("CORRECT_CASH", "VOID_CASH")
                    or review["selectionInputs"].get("expectedCashId") != after["id"]):
                invalid()
            before = selected[0].get("before")
        except (KeyError, TypeError, AttributeError, StopIteration):
            invalid()
    else:
        invalid()
    if (not isinstance(before, dict) or before.get("id") != after["id"]
            or before.get("state") != "OBSERVED" or after.get("state") != "VOID"
            or not isinstance(before.get("version"), int) or before["version"] >= after["version"]
            or set(before) - set(after)
            or set(after) - set(before) - {"reviewedBy", "reviewNote"}
            or any(after.get(key) != value for key, value in before.items()
                   if key not in ("state", "version", "updatedAt", "reviewedBy", "reviewNote"))):
        invalid()
    return deepcopy(before)


def context_at(context, events, version, identity=None):
    """Reopen original cash across ordinary and compound native voids."""
    event_map = {event["version"]: event for event in events}
    cash = []
    for current in context["records"]["cash"]:
        row = deepcopy(current)
        if row["state"] == "VOID" and row["version"] > version:
            row = _cash_before_void(context, event_map.get(row["version"]), row)
        if row["version"] <= version:
            cash.append(row)
    sources = deepcopy(context["sources"])
    for event in events:
        if event["version"] <= version:
            continue
        if event.get("action") == "source.add":
            sources.pop(event.get("recordId"), None)
        change = event.get("sourceChange") or {}
        for metadata in change.get("added", []):
            sources.pop(metadata.get("id"), None)
    program = deepcopy(context["program"])
    if identity is not None:
        program.update(deepcopy(identity))
    program["version"] = version
    return {**context, "program": program, "records": {**context["records"], "cash": cash},
            "sources": sources}


def same_account(row, selected):
    return all(row.get(key) == selected[key] for key in ("network", "currency", "asset"))


def in_period(row, selected):
    return bool(row.get("date") and selected["startDate"] <= row["date"] <= selected["endDate"])


def resolve_cash(ident, native_cash, successors):
    value = successors.get(ident)
    if value:
        return value["replacement"]["id"], [item["sourceId"] for item in value["chain"]]
    return ident, []


def body_selection(body, context, original_statements, editions):
    body = object_value(body, BODY_KEYS, "Reconciliation operation")
    expected = domain.integer(body.get("expectedVersion"), "Reviewed case version", 1, 10000000)
    if expected != context["program"]["version"]:
        fail("The case changed. Review the current complete reconciliation.", "RECONCILIATION_VERSION", 409)
    ident = body.get("reconciliationId")
    previous = None
    revision = domain.integer(body.get("expectedRevision", 0), "Reviewed reconciliation revision", 0, 10000000)
    if ident is not None:
        if not isinstance(ident, str) or not ID_PATTERN.fullmatch(ident):
            fail("Select the retained original reconciliation.")
        candidates = [item for item in editions if item["record"]["id"] == ident]
        if not candidates:
            fail("The selected original reconciliation is unavailable.", "RECONCILIATION_NOT_FOUND", 404)
        previous = max(candidates, key=lambda item: item["record"]["revision"])
        if revision != previous["record"]["revision"]:
            fail("A later reconciliation edition is retained. Review its original head.", "RECONCILIATION_REVISION", 409)
    elif revision != 0:
        fail("A new reconciliation starts before its first saved revision.")
    state = domain.enum(body.get("state", "DRAFT"), ("DRAFT", "CLOSED"), "Reconciliation state")
    document = normalize_document(body.get("document"), context, original_statements)
    return {"expectedVersion": expected, "reconciliationId": ident, "expectedRevision": revision,
            "state": state, "document": document}, previous

def build_preview(context, selected_body, original_statements, corrections):
    chosen = selected_body["document"]
    statement = original_statements[chosen["statementSourceId"]]
    review, native = statement["review"], {row["id"]: row for row in context["records"]["cash"]}
    source_preview = review["preview"]
    source_description = source_preview["source"]
    selected = {"statementSourceId": chosen["statementSourceId"],
                "reviewSourceId": statement["reviewSource"]["id"],
                "accountId": source_description["accountId"],
                "network": "statement/" + source_description["accountId"],
                "currency": source_description["currency"], "asset": source_description["currency"],
                "startDate": chosen["periodStart"], "endDate": chosen["periodEnd"]}
    successors = cash_accounts.successor_map(context, corrections)
    created = {row["rowNumber"]: row["cashId"] for row in review["cashRows"]}
    source_rows, referenced = [], set()
    for original in source_preview["rows"]:
        cash_id = created.get(original["rowNumber"]) if original["status"] == "NEW" else original.get("recordId")
        if cash_id:
            referenced.add(cash_id)
            referenced.add(resolve_cash(cash_id, native, successors)[0])
        if original.get("originalRecordId"):
            referenced.add(original["originalRecordId"])
        value = signed(original)
        source_rows.append({
            **{key: deepcopy(original.get(key)) for key in
               ("rowNumber", "original", "date", "reference", "description", "direction", "amount", "currency", "usdValue")},
            "signedAmount": number(value) if value is not None else None,
            "intakeStatus": original["status"], "intakeAction": original["action"],
            "intakeReason": original.get("reason", ""), "originalCashId": cash_id,
            "status": "EXCLUDED" if original["status"] == "EXCLUDED" else "SOURCE_ONLY",
            "cashIds": [], "correctionSourceIds": [], "matchGroupId": None, "reason": "",
            "problems": deepcopy(original.get("problems", [])), "insidePeriod": in_period(original, selected)})
    for link in chosen["links"]:
        for ident in link["cashIds"]:
            referenced.update((ident, resolve_cash(ident, native, successors)[0]))
    for item in chosen["outstanding"]:
        referenced.update((item["cashId"], resolve_cash(item["cashId"], native, successors)[0]))
    transactions = []
    for row in context["records"]["cash"]:
        if not ((same_account(row, selected) and in_period(row, selected)) or row["id"] in referenced):
            continue
        eligible = same_account(row, selected) and in_period(row, selected) and performance._valid_cash(row)
        if row["state"] == "VOID":
            status = "EXCLUDED_VOID"
        elif not same_account(row, selected):
            status = "OTHER_ACCOUNT"
        elif not in_period(row, selected):
            status = "OUTSIDE_PERIOD"
        elif not performance._valid_cash(row):
            status = "EXCLUDED_TESTNET"
        else:
            status = "LEDGER_ONLY"
        transactions.append({**deepcopy(row), "signedAmount": number(signed(row)),
                             "eligible": eligible, "status": status, "sourceRowNumbers": [],
                             "matchGroupId": None, "reason": "", "expectedClearDate": None,
                             "selectedCashIds": [], "correctionSourceIds": []})
    transactions.sort(key=lambda row: (row["date"], row["id"]))
    source_map = {row["rowNumber"]: row for row in source_rows}
    transaction_map = {row["id"]: row for row in transactions}
    findings, matches, used_cash = [], [], set()

    def finding(code, message, rows=None, cash=None, severity="error"):
        findings.append({"code": code, "severity": severity, "message": message,
                         "rowNumbers": sorted(set(rows or [])), "cashIds": sorted(set(cash or []))})

    def match_group(ident, kind, rows, cash_ids, supplied_ids, reason, correction_ids):
        original_rows = [source_map[number_] for number_ in rows]
        current_rows = [transaction_map[cash_id] for cash_id in cash_ids if cash_id in transaction_map]
        source_values = [signed(row) for row in original_rows]
        source_net = sum((value for value in source_values if value is not None), ZERO)
        cash_net = sum((signed(row) for row in current_rows), ZERO)
        errors = []
        if any(value is None for value in source_values):
            errors.append("The original source group includes an unreadable movement amount.")
        if len(set(cash_ids)) != len(cash_ids):
            errors.append("Selected predecessors resolve to the same current cash movement.")
        if len(current_rows) != len(cash_ids) or any(not row["eligible"] for row in current_rows):
            errors.append("Match original movements in this exact account and selected period.")
        if used_cash.intersection(cash_ids):
            errors.append("A native cash movement is already used by another source group.")
        if source_net != cash_net:
            errors.append("The complete native and statement group amounts differ.")
        group = {"id": ident, "kind": kind, "rowNumbers": list(rows), "cashIds": list(cash_ids),
                 "selectedCashIds": list(supplied_ids), "sourceNet": number(source_net),
                 "ledgerNet": number(cash_net), "difference": number(cash_net - source_net),
                 "reason": reason, "correctionSourceIds": sorted(set(correction_ids)),
                 "status": "CONFLICT" if errors else "MATCHED"}
        matches.append(group)
        for row in original_rows:
            row.update({"cashIds": list(cash_ids), "correctionSourceIds": group["correctionSourceIds"],
                        "matchGroupId": ident, "reason": reason})
            if errors:
                row["status"] = "CHANGED"
                row["problems"].extend(errors)
            else:
                row["status"] = ("LINKED" if kind == "EXPLICIT" else
                                 "CORRECTED" if group["correctionSourceIds"] else "MATCHED")
        if errors:
            finding("MATCH_GROUP_CONFLICT", " ".join(errors), rows, cash_ids)
            return False
        used_cash.update(cash_ids)
        for row in current_rows:
            row.update({"status": "LINKED" if kind == "EXPLICIT" else "MATCHED",
                        "sourceRowNumbers": list(rows), "matchGroupId": ident, "reason": reason,
                        "selectedCashIds": list(supplied_ids), "correctionSourceIds": group["correctionSourceIds"]})
        return True

    reserved_rows = set()
    for index, link in enumerate(chosen["links"], 1):
        reserved_rows.update(link["rowNumbers"])
        resolved, correction_ids = [], []
        for ident in link["cashIds"]:
            terminal, chain = resolve_cash(ident, native, successors)
            resolved.append(terminal)
            correction_ids.extend(chain)
        match_group("explicit-" + str(index), "EXPLICIT", link["rowNumbers"], resolved,
                    link["cashIds"], link["reason"], correction_ids)
    for item in chosen["exclusions"]:
        row = source_map[item["rowNumber"]]
        reserved_rows.add(row["rowNumber"])
        if row["intakeAction"] != "EXCLUDE" or signed(row) != ZERO:
            finding("INFORMATIONAL_ROW_VALUE",
                    "Only an originally excluded zero-value informational row can be acknowledged. "
                    "Resolve a nonzero source movement through original cash intake or exact matching.",
                    [row["rowNumber"]])
            row["reason"] = item["reason"]
        else:
            row.update({"status": "ACKNOWLEDGED", "reason": item["reason"]})
    originals = {row["rowNumber"]: row for row in source_preview["rows"]}
    for row in source_rows:
        if row["rowNumber"] in reserved_rows or row["intakeAction"] == "EXCLUDE":
            continue
        ident = row["originalCashId"]
        if not ident or ident not in native:
            continue
        terminal, correction_ids = resolve_cash(ident, native, successors)
        original = originals[row["rowNumber"]]
        if original.get("originalRecordId") in successors:
            full_terminal, full_chain = resolve_cash(original["originalRecordId"], native, successors)
            if full_terminal == terminal:
                correction_ids = full_chain
        current = transaction_map.get(terminal)
        movement_equal = (current is not None and current["eligible"]
                          and current["date"] == row["date"] and current["currency"] == row["currency"]
                          and current["direction"] == row["direction"]
                          and Decimal(current["amount"]) == Decimal(row["amount"]))
        if not movement_equal or terminal in used_cash:
            row.update({"status": "CHANGED", "cashIds": [terminal], "correctionSourceIds": correction_ids})
            row["problems"].append("The retained original movement needs a current cash or matching decision.")
            continue
        match_group("source-" + str(row["rowNumber"]),
                    "CORRECTION" if correction_ids else "RETAINED", [row["rowNumber"]],
                    [terminal], [ident], "", correction_ids)
    outstanding_used = set()
    for item in chosen["outstanding"]:
        terminal, correction_ids = resolve_cash(item["cashId"], native, successors)
        row = transaction_map.get(terminal)
        if (row is None or not row["eligible"] or terminal in used_cash or terminal in outstanding_used):
            finding("OUTSTANDING_MOVEMENT_CONFLICT",
                    "An outstanding decision needs one unmatched current movement in the selected account period.",
                    cash=[item["cashId"], terminal])
            continue
        outstanding_used.add(terminal)
        row.update({"status": "OUTSTANDING", "reason": item["reason"],
                    "expectedClearDate": item["expectedClearDate"], "selectedCashIds": [item["cashId"]],
                    "correctionSourceIds": correction_ids,
                    "outstandingSourceIds": deepcopy(item["sourceIds"])})
    for row in source_rows:
        value = signed(row)
        if value is None:
            finding("SOURCE_AMOUNT_UNREADABLE", "Read the original statement movement before closing this period.",
                    [row["rowNumber"]])
        elif value != ZERO and not row["insidePeriod"]:
            finding("STATEMENT_PERIOD_COVERAGE",
                    "The selected period must cover every nonzero movement in this original statement.",
                    [row["rowNumber"]])
        if row["status"] in ("SOURCE_ONLY", "CHANGED", "EXCLUDED"):
            finding("SOURCE_MOVEMENT_UNRESOLVED",
                    "Resolve this original source movement or acknowledge its original zero-value informational exclusion.",
                    [row["rowNumber"]], row["cashIds"])
    for row in transactions:
        if row["status"] == "LEDGER_ONLY":
            finding("LEDGER_MOVEMENT_UNRESOLVED",
                    "Match this native movement or retain its explicit outstanding reason.", cash=[row["id"]])
    source_balance = source_preview["balance"]
    if source_balance["status"] != "MATCH":
        finding("ORIGINAL_BALANCES_REQUIRED",
                "A period close needs the original opening and closing balances reconciled by Statements. "
                "Open the original source there to retain its complete balance interpretation.")
    if not source_preview["summary"]["completeAmounts"]:
        finding("COMPLETE_STATEMENT_REQUIRED", "A period close needs every original source movement amount.")
    eligible = [row for row in transactions if row["eligible"]]
    matched = [row for row in eligible if row["status"] in ("MATCHED", "LINKED")]
    outstanding = [row for row in eligible if row["status"] == "OUTSTANDING"]
    ledger_totals, matched_totals, outstanding_totals = totals(eligible), totals(matched), totals(outstanding)
    ledger_totals.update({"matchedInflow": matched_totals["inflow"], "matchedOutflow": matched_totals["outflow"],
                          "matchedNet": matched_totals["net"], "matchedCount": matched_totals["count"]})
    cleared_net = Decimal(ledger_totals["net"]) - Decimal(outstanding_totals["net"])
    opening, closing = source_balance["openingBalance"], source_balance["closingBalance"]
    anchored = Decimal(opening) + Decimal(ledger_totals["net"]) if opening is not None else None
    cleared = Decimal(opening) + cleared_net if opening is not None else None
    difference = anchored - Decimal(closing) if anchored is not None and closing is not None else None
    remaining = cleared - Decimal(closing) if cleared is not None and closing is not None else None
    if remaining is not None and remaining != ZERO:
        finding("UNRESOLVED_ACCOUNT_DIFFERENCE",
                "The statement opening plus matched-period native movement differs from its original closing balance by "
                + number(remaining) + " " + selected["currency"] + ".")
    counts = {
        "sourceRows": len(source_rows),
        "matchedSourceRows": sum(row["status"] in ("MATCHED", "CORRECTED", "LINKED") for row in source_rows),
        "excludedSourceRows": sum(row["intakeAction"] == "EXCLUDE" for row in source_rows),
        "acknowledgedSourceRows": sum(row["status"] == "ACKNOWLEDGED" for row in source_rows),
        "sourceOnlyRows": sum(row["status"] == "SOURCE_ONLY" for row in source_rows),
        "changedRows": sum(row["status"] == "CHANGED" for row in source_rows),
        "ledgerRows": len(eligible), "matchedLedgerRows": len(matched),
        "ledgerOnlyRows": sum(row["status"] == "LEDGER_ONLY" for row in eligible),
        "outstandingRows": len(outstanding), "excludedLedgerRows": len(transactions) - len(eligible)}
    can_save = context["program"]["state"] == "OPEN" and len(context["sources"]) < 200
    if context["program"]["state"] != "OPEN":
        finding("OPERATIONS_CLOSED", "Reopen the original operations case to record a reconciliation edition.")
    if len(context["sources"]) >= 200:
        finding("RECONCILIATION_SOURCE_CAPACITY", "The original case has no remaining source slot for a complete edition.")
    report = {
        "schema": PREVIEW_SCHEMA, "case": case_identity(context),
        "expectedVersion": selected_body["expectedVersion"], "reconciliationId": selected_body["reconciliationId"],
        "expectedRevision": selected_body["expectedRevision"], "requestedState": selected_body["state"],
        "document": deepcopy(chosen), "selection": selected,
        "statement": {"source": deepcopy(statement["source"]), "reviewSource": deepcopy(statement["reviewSource"]),
                      **{key: source_description[key] for key in ("accountId", "accountLabel", "currency", "editionSha256")},
                      "network": selected["network"], "asset": selected["asset"],
                      "headers": deepcopy(source_preview["headers"]), "originalBalance": deepcopy(source_balance),
                      "originalSummary": deepcopy(source_preview["summary"])},
        "sourceRows": source_rows, "transactions": transactions, "matches": matches,
        "totals": {
            "statement": {"openingBalance": opening, "closingBalance": closing,
                          **{key: source_preview["summary"][key] for key in ("inflow", "outflow", "net")},
                          "calculatedClosing": source_balance["calculatedBalance"],
                          "difference": source_balance["difference"], "balanceStatus": source_balance["status"]},
            "ledger": ledger_totals, "outstanding": outstanding_totals,
            "reconciliation": {
                "sourceAnchoredLedgerClosing": number(anchored) if anchored is not None else None,
                "sourceDifference": number(difference) if difference is not None else None,
                "clearedLedgerNet": number(cleared_net),
                "sourceAnchoredClearedClosing": number(cleared) if cleared is not None else None,
                "remainingDifference": number(remaining) if remaining is not None else None,
                "absoluteLedgerOpening": None}},
        "counts": counts, "findings": findings,
        "basis": {"account": "EXACT_STATEMENT_NETWORK_CURRENCY_ASSET",
                  "period": "EXPLICIT_COMPLETE_STATEMENT_PERIOD",
                  "cash": "CURRENT_NATIVE_OBSERVED_NON_TESTNET_MOVEMENTS",
                  "opening": "ORIGINAL_STATEMENT_ANCHOR",
                  "outstanding": "EXPLICIT_COMPLETE_NATIVE_MOVEMENTS",
                  "caseVersion": context["program"]["version"]},
        "cashBasisSha256": digest({"cash": [deepcopy(native[row["id"]]) for row in transactions],
                                  "correctionSourceIds": sorted({sid for row in source_rows + transactions
                                                                for sid in row["correctionSourceIds"]})}),
        "inputSha256": digest(selected_body)}
    estimated = len(canonical(report).encode()) + len(canonical(chosen).encode()) + 2048
    available = MAX_SOURCES - sum(row["bytes"] for row in context["sources"].values())
    if estimated > MAX_SOURCE or estimated > available:
        can_save = False
        finding("RECONCILIATION_SOURCE_CAPACITY",
                "This complete reconciliation edition exceeds the original case's remaining source capacity.")
    report["canSave"] = can_save
    report["canClose"] = can_save and not any(item["severity"] == "error" for item in findings)
    report["canApply"] = can_save and (selected_body["state"] != "CLOSED" or report["canClose"])
    report["previewSha256"] = digest(report)
    return report


def load_editions(context, events, files, original_statements, corrections, rebuild=False):
    event_map = {event["version"]: event for event in events}
    loaded = []
    for metadata in source_candidates(context):
        raw = source_bytes(metadata, files)
        try:
            packet = json.loads(raw)
        except (ValueError, UnicodeError) as exc:
            raise Problem("The original reconciliation edition is unreadable.", 422,
                          "RECONCILIATION_EDITION") from exc
        if not isinstance(packet, dict) or packet.get("schema") != EDITION_SCHEMA:
            fail("Use the complete native reconciliation edition.", "RECONCILIATION_EDITION")
        ident = packet.get("id")
        if not isinstance(ident, str) or not ID_PATTERN.fullmatch(ident):
            fail("The reconciliation source has an invalid original identity.", "RECONCILIATION_EDITION")
        revision = domain.integer(packet.get("revision"), "Original reconciliation revision", 1, 10000000)
        version = domain.integer(packet.get("version"), "Original reconciliation save version", 2,
                                 context["program"]["version"])
        if (metadata["filename"] != "account-reconciliation-" + ident[15:] + "-r" + str(revision) + ".json"
                or raw != (canonical(packet) + "\n").encode()):
            fail("Retain the complete original canonical reconciliation source.", "RECONCILIATION_EDITION")
        if packet.get("fromVersion") != version - 1:
            fail("A reconciliation edition must follow its exact reviewed case version.", "RECONCILIATION_HISTORY")
        native_id(packet.get("caseId"), "operation")
        domain.enum(packet.get("state"), ("DRAFT", "CLOSED"), "Original reconciliation state")
        actor = text(packet.get("recordedBy"), "Original reconciliation operator", 300, True)
        domain.timestamp(packet.get("recordedAt"), "Original reconciliation time")
        request = short_id(packet.get("requestId"), "Original reconciliation request")
        event = event_map.get(version)
        if (not event or event.get("action") != "source.add" or event.get("recordId") != metadata["id"]
                or event.get("after") != metadata or event.get("before") is not None
                or event.get("requestId") != request or event.get("actor") != actor
                or metadata.get("observedAt") != packet["recordedAt"]):
            fail("Retain the reconciliation's exact original source event and request.", "RECONCILIATION_HISTORY")
        preview = packet.get("preview")
        if (not isinstance(preview, dict) or preview.get("schema") != PREVIEW_SCHEMA
                or digest({key: value for key, value in preview.items() if key != "previewSha256"}) != preview.get("previewSha256")
                or preview.get("document") != packet.get("document") or preview.get("requestedState") != packet["state"]
                or preview.get("expectedVersion") != packet["fromVersion"]
                or preview.get("case", {}).get("id") != packet["caseId"]
                or preview.get("case", {}).get("version") != packet["fromVersion"]
                or preview.get("case", {}).get("mode") != context["program"]["mode"]
                or preview.get("case", {}).get("state") != "OPEN"
                or preview.get("canApply") is not True
                or (packet["state"] == "CLOSED" and preview.get("canClose") is not True)):
            fail("The original reconciliation preview differs from its saved edition.", "RECONCILIATION_EDITION")
        loaded.append({"source": deepcopy(metadata), "record": packet})
    loaded.sort(key=lambda item: (item["record"]["version"], item["record"]["id"], item["record"]["revision"]))
    accepted, heads, source_ids, request_ids = [], {}, set(), set()
    for item in loaded:
        packet, metadata = item["record"], item["source"]
        ident, revision = packet["id"], packet["revision"]
        previous = heads.get(ident)
        expected_revision = previous["record"]["revision"] if previous else 0
        if (revision != expected_revision + 1
                or packet.get("parentSourceId") != (previous["source"]["id"] if previous else None)
                or packet.get("parentSourceSha256") != (previous["source"]["sha256"] if previous else None)
                or packet["preview"].get("expectedRevision") != expected_revision
                or packet["preview"].get("reconciliationId") != (ident if previous else None)
                or (previous and packet["fromVersion"] < previous["record"]["version"])
                or metadata["id"] in source_ids or packet["requestId"] in request_ids):
            fail("The complete reconciliation editions must retain one ordered original successor chain.",
                 "RECONCILIATION_HISTORY")
        source_ids.add(metadata["id"])
        request_ids.add(packet["requestId"])
        if rebuild:
            at = context_at(context, events, packet["fromVersion"], packet["preview"]["case"])
            statements_at = {key: value for key, value in original_statements.items()
                             if value["review"]["caseVersion"] <= packet["fromVersion"]
                             and key in at["sources"] and value["reviewSource"]["id"] in at["sources"]}
            corrections_at = [value for value in corrections if value["record"]["version"] <= packet["fromVersion"]]
            body = {"expectedVersion": packet["fromVersion"],
                    "reconciliationId": ident if previous else None, "expectedRevision": expected_revision,
                    "state": packet["state"], "document": packet["document"]}
            selected, _ = body_selection(body, at, statements_at, accepted)
            rebuilt = build_preview(at, selected, statements_at, corrections_at)
            if rebuilt != packet["preview"]:
                fail("The saved reconciliation must describe its original cash, statement and case version.",
                     "RECONCILIATION_SOURCE_CHANGED", 409)
        accepted.append(item)
        heads[ident] = item
    return loaded


def _state(context, events, files, rebuild=False):
    corrections = cash_accounts.validate_import(context, events, files)
    original_statements = load_statements(context, events, files)
    editions = load_editions(context, events, files, original_statements, corrections, rebuild)
    return original_statements, corrections, editions


def read_state(ops, program_id):
    context = ops._context(program_id)
    events = cash_accounts.original_history(ops, program_id)
    files = original_files(ops, context)
    return context, events, files, _state(context, events, files)


def edition_summary(value):
    record, source = value["record"], value["source"]
    preview, document = record["preview"], record["document"]
    return {"id": record["id"], "name": document["name"], "revision": record["revision"],
            "state": record["state"], "version": record["version"], "fromVersion": record["fromVersion"],
            "sourceId": source["id"], "sourceSha256": source["sha256"],
            "statementSourceId": document["statementSourceId"], "accountId": preview["selection"]["accountId"],
            "currency": preview["selection"]["currency"], "periodStart": document["periodStart"],
            "periodEnd": document["periodEnd"], "recordedAt": record["recordedAt"],
            "recordedBy": record["recordedBy"], "requestId": record["requestId"],
            "previewSha256": preview["previewSha256"],
            "remainingDifference": preview["totals"]["reconciliation"]["remainingDifference"],
            "unresolvedRows": len({number_ for finding in preview["findings"] if finding["severity"] == "error"
                                   for number_ in finding["rowNumbers"]})
                              + len({cash_id for finding in preview["findings"] if finding["severity"] == "error"
                                     for cash_id in finding["cashIds"]})}


def comparison(saved, current):
    old_cash = {row["id"]: row for row in saved["transactions"]}
    new_cash = {row["id"]: row for row in current["transactions"]}
    old_rows = {row["rowNumber"]: row for row in saved["sourceRows"]}
    new_rows = {row["rowNumber"]: row for row in current["sourceRows"]}
    changed_cash = sorted(ident for ident in set(old_cash) & set(new_cash) if old_cash[ident] != new_cash[ident])
    changed_rows = sorted(ident for ident in set(old_rows) | set(new_rows) if old_rows.get(ident) != new_rows.get(ident))
    before, after = saved["totals"]["reconciliation"], current["totals"]["reconciliation"]
    cash_changed = saved["cashBasisSha256"] != current["cashBasisSha256"]
    return {"changed": cash_changed or bool(changed_rows) or saved["totals"] != current["totals"],
            "savedCaseVersion": saved["expectedVersion"], "currentCaseVersion": current["expectedVersion"],
            "cashChanged": cash_changed, "addedCashIds": sorted(set(new_cash) - set(old_cash)),
            "removedCashIds": sorted(set(old_cash) - set(new_cash)), "changedCashIds": changed_cash,
            "sourceRowsChanged": changed_rows, "savedSourceDifference": before["sourceDifference"],
            "currentSourceDifference": after["sourceDifference"],
            "savedRemainingDifference": before["remainingDifference"],
            "currentRemainingDifference": after["remainingDifference"],
            "savedCanClose": saved["canClose"], "currentCanClose": current["canClose"]}


def build_account(context, events, files, body=None, loaded=None):
    body = object_value(body or {}, {"selection", "expectedVersion"}, "Reconciliation account view")
    if body.get("expectedVersion") is not None:
        expected = domain.integer(body["expectedVersion"], "Selected case version", 1, 10000000)
        if expected != context["program"]["version"]:
            fail("The original case changed before opening this reconciliation.", "RECONCILIATION_VERSION", 409)
    chosen = object_value(body.get("selection") or {}, {"reconciliationId", "revision"}, "Reconciliation selection")
    original_statements, corrections, editions = loaded or _state(context, events, files)
    ident, revision = chosen.get("reconciliationId"), chosen.get("revision")
    if ident is not None and (not isinstance(ident, str) or not ID_PATTERN.fullmatch(ident)):
        fail("Select a retained original reconciliation.")
    if revision is not None:
        revision = domain.integer(revision, "Selected reconciliation revision", 1, 10000000)
        if ident is None:
            fail("Select the original reconciliation for this revision.")
    heads = {}
    for item in editions:
        heads[item["record"]["id"]] = item
    selected, current, change, history = None, None, None, []
    if ident is not None:
        history = [deepcopy(item) for item in editions if item["record"]["id"] == ident]
        if not history:
            fail("The selected reconciliation is unavailable.", "RECONCILIATION_NOT_FOUND", 404)
        revision = revision or heads[ident]["record"]["revision"]
        selected = next((deepcopy(item) for item in history if item["record"]["revision"] == revision), None)
        if selected is None:
            fail("The selected reconciliation edition is unavailable.", "RECONCILIATION_NOT_FOUND", 404)
        selected_body, _ = body_selection({
            "expectedVersion": context["program"]["version"], "reconciliationId": ident,
            "expectedRevision": heads[ident]["record"]["revision"], "state": selected["record"]["state"],
            "document": selected["record"]["document"]}, context, original_statements, editions)
        current = build_preview(context, selected_body, original_statements, corrections)
        change = comparison(selected["record"]["preview"], current)
    report = {"schema": SCHEMA, "case": case_identity(context),
              "statements": sorted((statement_summary(value) for value in original_statements.values()),
                                   key=lambda row: (row["accountId"], row["currency"], row["observedAt"], row["sourceId"])),
              "reconciliations": sorted((edition_summary(value) for value in heads.values()),
                                       key=lambda row: (-row["version"], row["id"])),
              "selection": {"reconciliationId": ident, "revision": revision},
              "selected": selected, "current": current, "history": history, "comparison": change}
    report["reportSha256"] = digest(report)
    return report


def account(ops, program_id, body=None):
    with ops._snapshot():
        context, events, files, loaded = read_state(ops, program_id)
        return build_account(context, events, files, body, loaded)


def preview(ops, program_id, body):
    with ops._snapshot():
        context, _, _, (original_statements, corrections, editions) = read_state(ops, program_id)
        selected, _ = body_selection(body, context, original_statements, editions)
        return build_preview(context, selected, original_statements, corrections)


def statement_inputs(ops, program_id, statement_source_id):
    with ops._snapshot():
        context, _, _, (original_statements, _, _) = read_state(ops, program_id)
        native_id(statement_source_id, "source")
        if statement_source_id not in original_statements:
            fail("Select the original retained statement.", "RECONCILIATION_STATEMENT", 404)
        statement = original_statements[statement_source_id]
        return {"caseId": program_id, "expectedVersion": context["program"]["version"],
                "statementSourceId": statement_source_id, "reviewSourceId": statement["reviewSource"]["id"],
                "inputs": deepcopy(statement["inputs"])}


def apply(ops, program_id, body):
    program_id = native_id(program_id, "operation")
    body = object_value(body, BODY_KEYS, "Reconciliation save")
    reviewed = domain.sha(body.get("expectedPreviewSha256"), "Reviewed reconciliation", False)
    actor = text(body.get("actor"), "Recording operator", 300, True)
    request_id = short_id(body.get("requestId"), "Original reconciliation request")
    payload = {"domain": EDITION_SCHEMA, "caseId": program_id, "body": body}

    def action():
        context, _, _, (original_statements, corrections, editions) = read_state(ops, program_id)
        if any(item["record"]["requestId"] == request_id for item in editions):
            fail("This request identity already describes a retained reconciliation edition. "
                 "Use a new original request for the continuing case.", "REQUEST_CONFLICT", 409)
        selected, previous = body_selection(body, context, original_statements, editions)
        candidate = build_preview(context, selected, original_statements, corrections)
        if candidate["previewSha256"] != reviewed:
            fail("The original statement, native account, decisions or case changed after review.",
                 "RECONCILIATION_PREVIEW_CONFLICT", 409)
        if not candidate["canApply"]:
            errors = [row["message"] for row in candidate["findings"] if row["severity"] == "error"]
            fail(errors[0] if errors else "Review the complete original reconciliation before saving.",
                 "RECONCILIATION_REVIEW", 409)
        ident = selected["reconciliationId"] or "reconciliation-" + uuid.uuid4().hex
        revision = selected["expectedRevision"] + 1
        packet = {"schema": EDITION_SCHEMA, "id": ident, "revision": revision,
                  "parentSourceId": previous["source"]["id"] if previous else None,
                  "parentSourceSha256": previous["source"]["sha256"] if previous else None,
                  "caseId": program_id, "fromVersion": selected["expectedVersion"],
                  "version": selected["expectedVersion"] + 1, "state": selected["state"],
                  "document": selected["document"], "preview": candidate,
                  "requestId": request_id, "recordedAt": now(), "recordedBy": actor}
        raw = (canonical(packet) + "\n").encode()
        result = ops.command(program_id, {
            "action": "source.add", "expectedVersion": selected["expectedVersion"], "actor": actor,
            "note": selected["document"]["note"] or selected["document"]["name"], "requestId": request_id,
            "data": {"filename": "account-reconciliation-" + ident[15:] + "-r" + str(revision) + ".json",
                     "kind": "payment", "mediaType": "application/json", "observedAt": packet["recordedAt"],
                     "contentBase64": base64.b64encode(raw).decode("ascii")}}, _within_transaction=True)
        metadata, _ = ops.source(program_id, result["recordId"])
        return {"id": program_id, "version": result["version"], "action": "account-reconciliation.save",
                "reconciliationId": ident, "revision": revision, "state": packet["state"],
                "sourceId": metadata["id"], "sourceSha256": metadata["sha256"], "requestId": request_id,
                "previewSha256": reviewed, "selection": {"reconciliationId": ident, "revision": revision}}

    # The original request store recovers its committed result before action()
    # reads a newer case/head or creates another timestamp, UUID or source.
    return ops.workspace._transaction(request_id, payload, action)


def validate_import(context, events, files):
    try:
        return _state(context, events, files, rebuild=True)[2]
    except Problem:
        raise
    except (KeyError, TypeError, ValueError, AttributeError, ArithmeticError, RecursionError) as exc:
        raise Problem("The original reconciliation sources, history or current account are incomplete.",
                      422, "RECONCILIATION_RECEIVING") from exc


def validate_received(report, document, files):
    if report is None:
        return
    context = {"program": document["program"], "plan": document["plan"], "records": document["records"],
               "sources": {row["id"]: row for row in document["sources"]},
               "completionPlans": document.get("completionPlans", [])}
    rebuilt = build_account(context, document["events"], files, {"selection": report.get("selection")})
    if rebuilt != report:
        fail("The received reconciliation must describe its complete original case and saved edition.",
             "RECONCILIATION_SOURCE_CHANGED", 409)


def received_selection(report):
    if report is None:
        return None
    return {**report["selection"], "sourceCaseId": report["case"]["id"],
            "sourceCaseVersion": report["case"]["version"], "reportSha256": report["reportSha256"]}


def _flat(rows):
    return [{key: canonical(value) if isinstance(value, (dict, list)) else value
             for key, value in row.items()} for row in rows]


def table(headers, rows):
    def cell(value):
        if value is None:
            return ""
        if isinstance(value, (dict, list)):
            value = canonical(value)
        return html.escape(str(value))
    return ("<table><thead><tr>" + "".join("<th>" + cell(value) + "</th>" for value in headers)
            + "</tr></thead><tbody>" + "".join("<tr>" + "".join("<td>" + cell(value) + "</td>" for value in row)
                                               + "</tr>" for row in rows) + "</tbody></table>")


def render_html(report):
    selected, current = report["selected"], report["current"]
    case = report["case"]
    title = selected["record"]["document"]["name"] if selected else "Account reconciliations"
    content = ["<!doctype html><html lang=\"en\"><meta charset=\"utf-8\">",
               "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
               "<title>" + html.escape(title) + "</title><style>",
               "body{font:15px/1.5 system-ui,sans-serif;color:#202020;background:white;margin:32px;max-width:1600px}"
               "h1,h2,h3{line-height:1.2}table{border-collapse:collapse;width:100%;margin:16px 0}"
               "th,td{border:1px solid #bbb;padding:7px;text-align:left;vertical-align:top;overflow-wrap:anywhere}"
               "th{background:#eee}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}"
               ".scroll{overflow-x:auto}details{margin:16px 0}@media print{body{margin:12mm}thead{display:table-header-group}}",
               "</style><body><h1>" + html.escape(title) + "</h1>",
               "<p>Original case " + html.escape(str(case["name"])) + " · " + html.escape(str(case["id"]))
               + " · version " + str(case["version"]) + " · " + html.escape(str(case["mode"])) + "</p>",
               "<h2>Retained reconciliations</h2>",
               table(["Name", "Revision", "State", "Account", "Period", "Currency", "Remaining difference",
                      "Operator", "Recorded at", "Original request"],
                     [[row["name"], row["revision"], row["state"], row["accountId"],
                       row["periodStart"] + " to " + row["periodEnd"], row["currency"], row["remainingDifference"],
                       row["recordedBy"], row["recordedAt"], row["requestId"]] for row in report["reconciliations"]]),
               "<h2>Original statements</h2>",
               table(["Account", "Currency", "Original file", "Source", "Opening", "Closing", "Balance review", "Movements"],
                     [[row["accountLabel"] or row["accountId"], row["currency"], row["source"]["filename"], row["sourceId"],
                       row["openingBalance"], row["closingBalance"], row["balanceStatus"], row["rows"]]
                      for row in report["statements"]])]
    if current is not None:
        record = selected["record"]
        content.extend([
            "<h2>Selected original edition</h2>",
            table(["Reconciliation", "Revision", "State", "Reviewed case version", "Saved case version", "Original source"],
                  [[record["id"], record["revision"], record["state"], record["fromVersion"],
                    record["version"], selected["source"]["id"]]]),
            "<p>Period: " + html.escape(record["document"]["periodStart"]) + " to "
            + html.escape(record["document"]["periodEnd"]) + ". "
            + html.escape(record["document"]["note"]) + "</p>",
            "<h2>Current source and native movement comparison</h2>",
            "<p>These native-currency comparisons start from the retained statement opening balance. "
            "The source anchor does not create a native absolute opening-cash observation. "
            "Outstanding movements retain their explicit original decisions.</p>"])
        account_totals = current["totals"]
        rows = []
        for group, values in account_totals.items():
            for key, value in values.items():
                rows.append([group, key, value])
        content.append(table(["Basis", "Measure", "Exact value"], rows))
        content.append("<h3>Change since the selected original edition</h3>")
        content.append(table(["Measure", "Original", "Current"], [
            ["Case version", report["comparison"]["savedCaseVersion"], report["comparison"]["currentCaseVersion"]],
            ["Source-anchored difference", report["comparison"]["savedSourceDifference"], report["comparison"]["currentSourceDifference"]],
            ["Remaining difference", report["comparison"]["savedRemainingDifference"], report["comparison"]["currentRemainingDifference"]],
            ["Can close on this complete basis", report["comparison"]["savedCanClose"], report["comparison"]["currentCanClose"]]]))
        content.extend(["<h2>Complete original statement movements</h2>",
                        table(["Source row", "Date", "Reference", "Description", "Direction", "Amount", "Currency",
                               "Original intake", "Current reconciliation", "Native cash", "Reason", "Original cells"],
                              [[row["rowNumber"], row["date"], row["reference"], row["description"], row["direction"],
                                row["amount"], row["currency"], row["intakeStatus"], row["status"], row["cashIds"],
                                row["reason"] or row["intakeReason"], row["original"]] for row in current["sourceRows"]]),
                        "<h2>Complete native account movements and retained originals</h2>",
                        table(["Cash", "State", "Date", "Reference", "Direction", "Amount", "Currency", "USD value",
                               "Category", "Current reconciliation", "Source rows", "Invoice allocations", "Reason"],
                              [[row["id"], row["state"], row["date"], row["externalRef"], row["direction"], row["amount"],
                                row["currency"], row["usdValue"], row["category"], row["status"], row["sourceRowNumbers"],
                                row["allocations"], row["reason"]] for row in current["transactions"]]),
                        "<h2>Explicit and original matching groups</h2>",
                        table(["Group", "Basis", "Source rows", "Current cash", "Source net", "Native net", "Difference",
                               "Result", "Reason"],
                              [[row["id"], row["kind"], row["rowNumbers"], row["cashIds"], row["sourceNet"],
                                row["ledgerNet"], row["difference"], row["status"], row["reason"]]
                               for row in current["matches"]]),
                        "<h2>Findings</h2>",
                        table(["Severity", "Finding", "Source rows", "Native cash"],
                              [[row["severity"], row["message"], row["rowNumbers"], row["cashIds"]]
                               for row in current["findings"]]),
                        "<h2>Original reconciliation history</h2>",
                        table(["Revision", "State", "Reviewed version", "Saved version", "Operator", "Recorded at", "Source"],
                              [[item["record"]["revision"], item["record"]["state"], item["record"]["fromVersion"],
                                item["record"]["version"], item["record"]["recordedBy"], item["record"]["recordedAt"],
                                item["source"]["id"]] for item in report["history"]]),
                        "<details><summary>Complete selected original decisions and saved preview</summary><pre>"
                        + html.escape(json.dumps(record, ensure_ascii=False, indent=2)) + "</pre></details>"])
    content.append("<p>Complete case and original source bytes accompany this report. Report SHA256: "
                   + html.escape(report["reportSha256"]) + "</p></body></html>")
    return "\n".join(content).encode()


def statement_member(metadata):
    marker = metadata.get("statement", {})
    source_format = marker.get("sourceFormat") if isinstance(marker, dict) else None
    if source_format == "OFX":
        extension = "qfx" if metadata.get("filename", "").lower().endswith(".qfx") else "ofx"
    else:
        extension = "mt940" if source_format == "MT940" else "csv"
    return "original-statement." + extension


def export_bundle(report, original_case):
    if not isinstance(report, dict) or report.get("schema") != SCHEMA:
        fail("Export the complete original account reconciliation report.")
    if digest({key: value for key, value in report.items() if key != "reportSha256"}) != report.get("reportSha256"):
        fail("The selected reconciliation report changed before export.", "RECONCILIATION_SOURCE_CHANGED", 409)
    current = report.get("current")
    source_rows = current["sourceRows"] if current else []
    movements = current["transactions"] if current else []
    matches = current["matches"] if current else []
    files = {
        "operations-case.zip": original_case,
        "reconciliation.json": (canonical(report) + "\n").encode(),
        "selection.json": (canonical(report["selection"]) + "\n").encode(),
        "reconciliation.html": render_html(report),
        "reconciliations.csv": csv_bytes(
            ["id", "name", "revision", "state", "version", "fromVersion", "statementSourceId", "accountId",
             "currency", "periodStart", "periodEnd", "remainingDifference", "recordedBy", "recordedAt",
             "requestId", "sourceId", "sourceSha256"], _flat(report["reconciliations"])),
        "statements.csv": csv_bytes(
            ["sourceId", "reviewSourceId", "accountId", "accountLabel", "currency", "network", "asset",
             "firstDate", "lastDate", "rows", "excludedRows", "openingBalance", "closingBalance",
             "balanceStatus", "sourceSha256", "editionSha256"], _flat(report["statements"])),
        "source-rows.csv": csv_bytes(
            ["rowNumber", "date", "reference", "description", "direction", "amount", "signedAmount", "currency",
             "usdValue", "intakeStatus", "intakeAction", "intakeReason", "originalCashId", "status", "cashIds",
             "correctionSourceIds", "matchGroupId", "reason", "insidePeriod", "problems", "original"], _flat(source_rows)),
        "native-movements.csv": csv_bytes(
            ["id", "state", "date", "externalRef", "direction", "category", "currency", "network", "asset", "amount",
             "signedAmount", "usdValue", "eligible", "status", "sourceRowNumbers", "matchGroupId", "reason",
             "expectedClearDate", "allocations", "sourceIds", "valuationSourceIds", "valuationNote",
             "correctionSourceIds"], _flat(movements)),
        "match-groups.csv": csv_bytes(
            ["id", "kind", "rowNumbers", "cashIds", "selectedCashIds", "sourceNet", "ledgerNet", "difference",
             "status", "reason", "correctionSourceIds"], _flat(matches)),
        "outstanding.csv": csv_bytes(
            ["id", "date", "externalRef", "direction", "amount", "signedAmount", "currency", "reason",
             "expectedClearDate", "selectedCashIds", "outstandingSourceIds"],
            _flat([row for row in movements if row["status"] == "OUTSTANDING"])),
        "reconciliation-history.json": (canonical(report["history"]) + "\n").encode(),
        "README.txt": (
            "Original Grant Operations account reconciliation\n\n"
            "Open this complete ZIP through the original Operations importer. It carries the full native case, "
            "every original source and saved reconciliation edition, readable HTML and complete row tables.\n\n"
            "Statement balances are retained external source facts. The comparison adds the complete selected "
            "native account-period net movement to the original statement opening, then compares its closing. "
            "It does not create an absolute native opening balance. Outstanding movements retain their full "
            "native amounts and explicit operator decisions. Original excluded rows retain their original intake meaning.\n\n"
            "Use Account statements to receive or reinterpret its original CSV. Use Cash accounts to inspect and "
            "correct actual observations, allocations or valuations. Reopen a reconciliation to save a following "
            "edition from the current native case; all earlier closes remain available.\n").encode()}
    if current is not None:
        try:
            with zipfile.ZipFile(io.BytesIO(original_case)) as archive:
                original_name = statement_member(current["statement"]["source"])
                if original_name != "original-statement.csv":
                    files["README.txt"] = files["README.txt"].replace(b"its original CSV.", b"its original bank statement file.")
                for key, name in (("source", original_name), ("reviewSource", "original-statement-review.json")):
                    metadata = current["statement"][key]
                    raw = archive.read("sources/" + metadata["id"])
                    if len(raw) != metadata["bytes"] or hashlib.sha256(raw).hexdigest() != metadata["sha256"]:
                        fail("The selected original statement differs from its complete case.", "RECONCILIATION_SOURCE")
                    files[name] = raw
        except (zipfile.BadZipFile, KeyError, TypeError, ValueError) as exc:
            raise Problem("The complete case is missing its original selected statement.", 422,
                          "RECONCILIATION_SOURCE") from exc
    if sum(len(raw) for raw in files.values()) > MAX_BUNDLE:
        fail("The complete reconciliation handover exceeds the original 32 MiB capacity.", status=413)
    manifest = {"schema": SCHEMA + ".bundle", "reportSha256": report["reportSha256"],
                "files": [{"path": name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
                          for name, raw in sorted(files.items())]}
    files["MANIFEST.json"] = (canonical(manifest) + "\n").encode()
    if sum(len(raw) for raw in files.values()) > MAX_BUNDLE:
        fail("The complete reconciliation and manifest exceed the original 32 MiB capacity.", status=413)
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, raw in sorted(files.items()):
            info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            info.external_attr = 0o600 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, raw)
    raw = output.getvalue()
    if len(raw) > MAX_BUNDLE:
        fail("The compressed reconciliation handover exceeds the original 32 MiB capacity.", status=413)
    return raw


def unwrap_bundle(raw):
    if not isinstance(raw, bytes) or len(raw) > MAX_BUNDLE:
        fail("Use the complete native operations or account-reconciliation ZIP up to 32 MiB.", status=413)
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            infos = archive.infolist()
            if len(infos) > 220 or sum(item.file_size for item in infos) > MAX_BUNDLE:
                fail("The complete reconciliation archive exceeds its original capacity.", status=413)
            names = [item.filename for item in infos]
            manifest = json.loads(archive.read("MANIFEST.json"))
            if not isinstance(manifest, dict) or manifest.get("schema") != SCHEMA + ".bundle":
                return raw, None
            base = {"operations-case.zip", "reconciliation.json", "selection.json", "reconciliation.html",
                    "reconciliations.csv", "statements.csv", "source-rows.csv", "native-movements.csv",
                    "match-groups.csv", "outstanding.csv", "reconciliation-history.json", "README.txt"}
            complete_sets = [base | {"MANIFEST.json"}] + [
                base | {name, "original-statement-review.json", "MANIFEST.json"}
                for name in ("original-statement.csv", "original-statement.ofx", "original-statement.qfx", "original-statement.mt940")]
            if (len(names) != len(set(names)) or set(names) not in complete_sets):
                fail("Retain the complete original reconciliation file set.", "INVALID_RECONCILIATION_BUNDLE")
            descriptors = manifest.get("files")
            if not isinstance(descriptors, list) or len(descriptors) != len(names) - 1:
                fail("Retain the complete reconciliation manifest.", "INVALID_RECONCILIATION_BUNDLE")
            members = {}
            for item in descriptors:
                if not isinstance(item, dict):
                    fail("Use the original reconciliation manifest descriptors.", "INVALID_RECONCILIATION_BUNDLE")
                name = item["path"]
                if name not in set(names) - {"MANIFEST.json"} or name in members:
                    fail("The reconciliation manifest changes an original member.", "INVALID_RECONCILIATION_BUNDLE")
                content = archive.read(name)
                if len(content) != item["bytes"] or hashlib.sha256(content).hexdigest() != item["sha256"]:
                    fail("A reconciliation member differs from its original bytes.", "INVALID_RECONCILIATION_BUNDLE")
                members[name] = content
            report = json.loads(members["reconciliation.json"])
            if (not isinstance(report, dict) or report.get("schema") != SCHEMA
                    or report.get("reportSha256") != manifest.get("reportSha256")
                    or digest({key: value for key, value in report.items() if key != "reportSha256"}) != report["reportSha256"]
                    or json.loads(members["selection.json"]) != report.get("selection")
                    or json.loads(members["reconciliation-history.json"]) != report.get("history")):
                fail("The reconciliation report or selected edition differs.", "INVALID_RECONCILIATION_BUNDLE")
            expected = export_bundle(report, members["operations-case.zip"])
            # The export is deterministic from complete source facts. Compare
            # every member, including all readable CSV/HTML and original bytes.
            with zipfile.ZipFile(io.BytesIO(expected)) as rebuilt:
                if set(rebuilt.namelist()) != set(names):
                    fail("The original source attachments are incomplete.", "INVALID_RECONCILIATION_BUNDLE")
                for name in names:
                    if rebuilt.read(name) != archive.read(name):
                        fail("A readable reconciliation member differs from its original complete report.",
                             "INVALID_RECONCILIATION_BUNDLE")
            return members["operations-case.zip"], report
    except Problem:
        raise
    except (zipfile.BadZipFile, KeyError, TypeError, ValueError, RuntimeError, ArithmeticError) as exc:
        raise Problem("The complete account reconciliation or operations handover is unreadable.",
                      422, "INVALID_RECONCILIATION_BUNDLE") from exc
