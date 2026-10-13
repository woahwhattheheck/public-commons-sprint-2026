"""Original Grant Operations cash accounts and atomic observation corrections."""
from __future__ import annotations

import base64
from copy import deepcopy
from datetime import date, timedelta
from decimal import Decimal
import hashlib
import html
import io
import json
import re
import zipfile

import operations_domain as domain
import operations_performance as performance
import operations_completion as completion
import forecast as forecasts
from model import Problem, canonical, digest, now, text, csv_bytes, MAX_BUNDLE

SCHEMA = "stellar-forge.sf47-cash-account.v1"
CORRECTION_SCHEMA = "stellar-forge.sf47-cash-correction.v1"
PREVIEW_SCHEMA = CORRECTION_SCHEMA + ".preview"
SOURCE_PREFIX = "cash-correction-"
ZERO = Decimal("0")
CASH_FIELDS = ("direction", "category", "date", "currency", "network", "asset",
               "amount", "usdValue", "valuationSourceIds", "valuationNote",
               "externalRef", "referenceKey", "tranche", "allocations",
               "sourceIds", "sourceNote", "sourceBasis")
INPUT_FIELDS = tuple(key for key in CASH_FIELDS if key not in ("referenceKey", "sourceBasis"))
CASH_TOTALS = ("inUsd", "outUsd", "netUsd", "grantReceiptsUsd", "customerReceiptsUsd", "paidUsd")
INVOICE_TOTALS = ("invoicedUsd", "paidUsd", "openUsd", "creditUsd")
ASSET_TOTALS = ("openingIn", "openingOut", "openingNet", "periodIn", "periodOut",
                "periodNet", "closingIn", "closingOut", "closingNet")
BODY_KEYS = {"selection", "expectedVersion", "originalCashId", "replacement", "reason",
             "attachments", "expectedPreviewSha256", "actor", "requestId"}


def fail(message, code="INVALID_CASH_ACCOUNT", status=422):
    domain.fail(message, code, status)


def object_value(value, allowed, label):
    if not isinstance(value, dict) or set(value) - set(allowed):
        fail("Use the declared " + label + " object.")
    return value


def cash_facts(row):
    return {key: deepcopy(row.get(key)) for key in CASH_FIELDS}


def cash_identity(row):
    return digest([row["currency"], row["network"], row["asset"]])


def selection(context, value=None):
    value = object_value(value or {}, ("startDate", "endDate", "network", "currency", "asset", "recordStateBasis"), "cash account selection")
    if value.get("recordStateBasis", "SELECTED_CASE_VERSION") != "SELECTED_CASE_VERSION":
        fail("Use the original current-case record state basis.")
    selected = performance.selection(context, value.get("startDate"), value.get("endDate"))
    result = {"startDate": selected["startDate"], "endDate": selected["endDate"],
              "recordStateBasis": "SELECTED_CASE_VERSION"}
    for key, maximum in (("network", 200), ("currency", 40), ("asset", 500)):
        raw = value.get(key)
        if raw is not None and not isinstance(raw, str):
            fail("The selected " + key + " must be its original text or null.")
        result[key] = None if raw is None else text(raw, "Selected " + key, maximum)
    if result["currency"] is not None:
        result["currency"] = result["currency"].upper()
    return result


def selected_cash(row, selected):
    return all(selected[key] is None or row[key] == selected[key] for key in ("network", "currency", "asset"))


def before_date(selected):
    start = selected["startDate"]
    return (date.fromisoformat(start) - timedelta(days=1)).isoformat() if start and start > date.min.isoformat() else None


def amounts(value, keys):
    return {key: performance.money(value[key]) for key in keys}


def positions(invoices, cash, selected, keys):
    opening = performance._financial(invoices, cash, before_date(selected))
    closing = performance._financial(invoices, cash, selected["endDate"])
    return {"opening": amounts(opening, keys),
            "period": {key: performance.money(closing[key] - opening[key]) for key in keys},
            "closing": amounts(closing, keys)}


def original_history(ops, program_id):
    return [json.loads(row[0]) for row in ops.db.execute(
        "SELECT body_json FROM ops_events WHERE program_id=? ORDER BY version", (program_id,))]


def original_forecasts(ops, program_id):
    return [json.loads(row[0]) for row in ops.db.execute(
        "SELECT body_json FROM ops_forecasts WHERE program_id=? ORDER BY rowid", (program_id,))]


def original_reviews(ops, program_id):
    return [json.loads(row[0]) for row in ops.db.execute(
        "SELECT body_json FROM ops_reviews WHERE program_id=? ORDER BY rowid", (program_id,))]


def _correction_sources(context):
    return [row for row in context["sources"].values()
            if re.fullmatch(r"cash-correction-[a-f0-9]{24}\.json", row.get("filename", "")) and row.get("mediaType") == "application/json"]


def _validate_corrections(context, events, values):
    """Bind every original correction to its immutable bytes and native events."""
    sources = {row["id"]: row for row in _correction_sources(context)}
    cash = {row["id"]: row for row in context["records"]["cash"]}
    event_map = {row["version"]: row for row in events}
    if not isinstance(values, list) or len(values) != len(sources):
        fail("Retain every original cash correction source.", "CASH_CORRECTION_SOURCE")
    originals, replacements, source_ids, normalized = set(), set(), set(), []
    for value in values:
        if not isinstance(value, dict) or not isinstance(value.get("record"), dict) or not isinstance(value.get("source"), dict):
            fail("A cash correction needs its complete original source and record.", "CASH_CORRECTION_SOURCE")
        metadata, packet = value["source"], value["record"]
        sid = metadata.get("id")
        if sid in source_ids or sources.get(sid) != metadata:
            fail("A cash correction source identity differs from the original case.", "CASH_CORRECTION_SOURCE")
        source_ids.add(sid)
        raw = (canonical(packet) + "\n").encode()
        if len(raw) != metadata["bytes"] or hashlib.sha256(raw).hexdigest() != metadata["sha256"]:
            fail("The cash correction differs from its original source bytes.", "CASH_CORRECTION_SOURCE")
        if packet.get("schema") != CORRECTION_SCHEMA:
            fail("Unsupported original cash correction source.", "CASH_CORRECTION_SOURCE")
        old_id, new_id = packet.get("originalCashId"), packet.get("replacementCashId")
        if (not isinstance(old_id, str) or not isinstance(new_id, str)
                or not re.fullmatch(r"cash-[a-f0-9]{32}", old_id) or not re.fullmatch(r"cash-[a-f0-9]{32}", new_id)
                or old_id == new_id or old_id in originals or new_id in replacements or old_id not in cash or new_id not in cash):
            fail("Cash correction identities must form original successor chains.", "CASH_CORRECTION_CHAIN")
        originals.add(old_id)
        replacements.add(new_id)
        original, voided, replacement = packet.get("original"), packet.get("voided"), packet.get("replacement")
        if not all(isinstance(row, dict) for row in (original, voided, replacement)):
            fail("Retain the original, void and replacement observations.", "CASH_CORRECTION_SOURCE")
        if (original.get("id") != old_id or voided.get("id") != old_id or replacement.get("id") != new_id
                or original.get("state") not in ("OBSERVED", "VOID") or voided.get("state") != "VOID"
                or replacement.get("state") != "OBSERVED"
                or cash_facts(original) != cash_facts(voided)
                or cash_facts(cash[old_id]) != cash_facts(voided)
                or cash_facts(cash[new_id]) != cash_facts(replacement)
                or cash[old_id]["state"] != "VOID"):
            fail("The retained observations differ from their original correction.", "CASH_CORRECTION_RECORD")
        if packet.get("originalSha256") != digest(original) or packet.get("replacementSha256") != digest(replacement):
            fail("The original cash correction record identities differ.", "CASH_CORRECTION_RECORD")
        from_version = domain.integer(packet.get("fromVersion"), "Correction source version", 1, context["program"]["version"])
        void_version = domain.integer(packet.get("voidVersion"), "Original void version", 2, context["program"]["version"])
        record_version = domain.integer(packet.get("recordVersion"), "Replacement version", 2, context["program"]["version"])
        final_version = domain.integer(packet.get("version"), "Correction source version", 2, context["program"]["version"])
        if not (from_version < record_version < final_version and void_version < record_version):
            fail("The original correction operation order differs.", "CASH_CORRECTION_HISTORY")
        if original["state"] == "OBSERVED" and not (from_version < void_version < record_version):
            fail("The correction must void its active predecessor in the same original operation.", "CASH_CORRECTION_HISTORY")
        if original["state"] == "VOID" and (voided != original or void_version != original["version"] or void_version > from_version):
            fail("The earlier original void must remain intact.", "CASH_CORRECTION_HISTORY")
        void_event, record_event, source_event = (event_map.get(v) for v in (void_version, record_version, final_version))
        if (not void_event or void_event.get("action") != "cash.void"
                or void_event.get("recordId") != old_id or void_event.get("after") != voided
                or (original["state"] == "OBSERVED" and void_event.get("before") != original)
                or not record_event or record_event.get("action") != "cash.record"
                or record_event.get("recordId") != new_id or record_event.get("after") != replacement
                or not source_event or source_event.get("action") != "source.add"
                or source_event.get("recordId") != sid or source_event.get("after") != metadata):
            fail("The correction must retain its exact original native events.", "CASH_CORRECTION_HISTORY")
        request_id = packet.get("requestId")
        if (not isinstance(request_id, str) or not request_id
                or record_event.get("requestId") != request_id or source_event.get("requestId") != request_id
                or (original["state"] == "OBSERVED" and void_event.get("requestId") != request_id)):
            fail("The correction must retain one original request identity.", "CASH_CORRECTION_HISTORY")
        if (not isinstance(packet.get("attachments"), list)
                or any(not isinstance(item, dict) or context["sources"].get(item.get("id")) != item for item in packet["attachments"])):
            fail("The complete original correction documents are required.", "CASH_CORRECTION_SOURCE")
        text(packet.get("reason"), "Correction reason", 12000, True)
        domain.timestamp(packet.get("recordedAt"), "Original correction time")
        normalized.append({"source": deepcopy(metadata), "record": deepcopy(packet)})
    if source_ids != set(sources):
        fail("The original case is missing a cash correction source.", "CASH_CORRECTION_SOURCE")
    edges = {value["record"]["originalCashId"]: value["record"] for value in normalized}
    for origin, packet in edges.items():
        seen, current, version = {origin}, packet["replacementCashId"], packet["recordVersion"]
        while current in edges:
            if current in seen or edges[current]["voidVersion"] <= version:
                fail("The original correction chain has an invalid order.", "CASH_CORRECTION_CHAIN")
            seen.add(current)
            following = edges[current]
            current, version = following["replacementCashId"], following["recordVersion"]
    return sorted(normalized, key=lambda value: (value["record"]["version"], value["source"]["id"]))


def validate_corrections(context, events, values):
    try:
        return _validate_corrections(context, events, values)
    except Problem:
        raise
    except (KeyError, TypeError, ValueError, AttributeError, ArithmeticError) as exc:
        raise Problem("The original cash correction is incomplete or malformed.", 422, "CASH_CORRECTION_SOURCE") from exc


def load_corrections(ops, context, events=None):
    events = original_history(ops, context["program"]["id"]) if events is None else events
    values = []
    for metadata in _correction_sources(context):
        retained, raw = ops.source(context["program"]["id"], metadata["id"])
        try:
            packet = json.loads(raw)
        except (ValueError, UnicodeError) as exc:
            raise Problem("The original cash correction cannot be read.", 422, "CASH_CORRECTION_SOURCE") from exc
        values.append({"source": retained, "record": packet})
    return validate_corrections(context, events, values)


def validate_import(context, events, files):
    values = []
    for metadata in _correction_sources(context):
        try:
            raw = files["sources/" + metadata["id"]]
            packet = json.loads(raw)
        except (KeyError, ValueError, UnicodeError) as exc:
            raise Problem("The complete case is missing its original cash correction.", 422, "CASH_CORRECTION_SOURCE") from exc
        values.append({"source": metadata, "record": packet})
    return validate_corrections(context, events, values)


def successor_map(context, corrections):
    cash = {row["id"]: row for row in context["records"]["cash"]}
    edges = {value["record"]["originalCashId"]: value for value in corrections}
    result = {}
    for old_id, first in edges.items():
        current, chain = old_id, []
        while current in edges:
            value = edges[current]
            chain.append({"sourceId": value["source"]["id"], "sourceSha256": value["source"]["sha256"],
                          "version": value["record"]["version"], "reason": value["record"]["reason"],
                          "originalCashId": current, "replacementCashId": value["record"]["replacementCashId"]})
            current = value["record"]["replacementCashId"]
        result[old_id] = {"original": deepcopy(first["record"]["original"]),
                          "replacement": deepcopy(cash[current]), "chain": chain}
    return result


def statement_successors(ops, context):
    """Only source- and event-bound successors may reconcile an older statement."""
    with ops._snapshot():
        return successor_map(context, load_corrections(ops, context))


def _statement_origins(row, sources, successors):
    source_ids = set(row.get("sourceIds", []))
    for old_id, value in successors.items():
        if value["replacement"]["id"] == row["id"]:
            source_ids.update(value["original"].get("sourceIds", []))
    result = []
    for sid in sorted(source_ids):
        source = sources.get(sid)
        marker = source.get("statement") if source else None
        if isinstance(marker, dict) and marker.get("role") in ("CSV", "ORIGINAL"):
            result.append({"kind": "STATEMENT", "accountId": marker.get("accountId"),
                           "sourceId": sid, "reviewSourceId": marker.get("reviewSourceId"),
                           "editionSha256": marker.get("editionSha256"), "filename": source["filename"]})
    return result


def _cash_reference_paths(value, wanted, path=()):
    found = []
    if isinstance(value, dict):
        for key, item in value.items():
            here = path + (key,)
            if key in ("cashIds", "directCashIds") and isinstance(item, list):
                found.extend({"path": list(here + (index,)), "cashId": ident}
                             for index, ident in enumerate(item) if ident in wanted)
            elif key == "cashId" and isinstance(item, str) and item in wanted:
                found.append({"path": list(here), "cashId": item})
            else:
                found.extend(_cash_reference_paths(item, wanted, here))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            found.extend(_cash_reference_paths(item, wanted, path + (index,)))
    return found


def dependencies(context, cash_ids, saved_forecasts=None, reviews=None, as_of=None):
    wanted = set(cash_ids)
    clocks = [row for row in completion.dashboard(context, as_of)["clocks"] if row["receiptId"] in wanted]
    confirmations = [{"completionId": row["id"], "tranche": row["tranche"], "extension": deepcopy(item)}
                     for row in context.get("completionPlans", []) for item in row.get("extensions", [])
                     if item["receiptId"] in wanted]
    outcomes = [deepcopy(row) for row in context["records"]["outcomes"] if row.get("completion", {}).get("receiptId") in wanted]
    prepared = [{"id": row["id"], "version": row["version"], "createdAt": row["createdAt"],
                 "actor": row["actor"], "businessSha256": row["businessSha256"],
                 "receiptId": row["completion"]["receipt"]["id"]}
                for row in (reviews or []) if row.get("purpose") == "TRANCHE_COMPLETION"
                and row.get("completion", {}).get("receipt", {}).get("id") in wanted]
    linked = []
    for row in saved_forecasts or []:
        paths = _cash_reference_paths(row.get("inputs", {}), wanted)
        if paths:
            linked.append({"id": row["id"], "name": row["inputs"]["name"], "version": row["version"],
                           "createdAt": row["createdAt"], "source": deepcopy(row["source"]),
                           "sha256": row["sha256"], "references": paths, "inputs": deepcopy(row["inputs"])})
    return {"completion": {"clocks": clocks, "extensions": confirmations, "outcomes": outcomes, "reviews": prepared},
            "forecasts": linked}


def _invoice_rows(context, ids, selected):
    originals = {row["id"]: row for row in context["records"]["invoices"]}
    people = {row["id"]: row for row in context["records"]["contributors"]}
    opening = performance._financial(context["records"]["invoices"], context["records"]["cash"], before_date(selected))
    closing = performance._financial(context["records"]["invoices"], context["records"]["cash"], selected["endDate"])
    rows = []
    for ident in sorted(ids):
        native = originals[ident]
        first, last = opening["invoices"][ident], closing["invoices"][ident]
        rows.append({**deepcopy(native), "contributorName": people[native["contributorId"]]["name"],
                     "positions": {"opening": amounts(first, INVOICE_TOTALS),
                                   "period": {key: performance.money(last[key] - first[key]) for key in INVOICE_TOTALS},
                                   "closing": amounts(last, INVOICE_TOTALS)},
                     "paidUsd": performance.money(last["paidUsd"]), "openUsd": performance.money(last["openUsd"]),
                     "creditUsd": performance.money(last["creditUsd"])})
    return rows


def build(context, start_date=None, end_date=None, network=None, currency=None, asset=None,
          history=None, corrections=None, forecasts=None, reviews=None):
    selected = selection(context, {"startDate": start_date, "endDate": end_date,
                                  "network": network, "currency": currency, "asset": asset})
    history, corrections = history or [], corrections or []
    native = performance.build(context, selected["startDate"], selected["endDate"])
    successor = successor_map(context, corrections)
    rows = [row for row in native["cash"] if selected_cash(row, selected)]
    original_cash = [row for row in context["records"]["cash"] if selected_cash(row, selected)]
    cash_ids = {row["id"] for row in rows}
    invoice_ids = {allocation["invoiceId"] for row in rows for allocation in row["allocations"]}
    invoice_map = {row["id"]: row for row in context["records"]["invoices"]}
    person_map = {row["id"]: row for row in context["records"]["contributors"]}
    invoices = _invoice_rows(context, invoice_ids, selected)
    source_ids = set()
    transactions = []
    for row in rows:
        total = sum((Decimal(item["amountUsd"]) for item in row["allocations"]), ZERO)
        allocations = []
        for item in row["allocations"]:
            invoice = invoice_map[item["invoiceId"]]
            person = person_map[invoice["contributorId"]]
            allocations.append({**deepcopy(item), "invoiceNumber": invoice["number"],
                                "contributorId": person["id"], "contributorName": person["name"],
                                "invoiceState": invoice["state"], "sourceIds": deepcopy(invoice["sourceIds"])})
        predecessors = [{"cashId": key, "chain": value["chain"]} for key, value in successor.items()
                        if value["replacement"]["id"] == row["id"]]
        following = successor.get(row["id"])
        origins = _statement_origins(row, context["sources"], successor)
        transactions.append({**deepcopy(row), "allocatedUsd": performance.money(total),
                             "unallocatedUsd": None if row["usdValue"] is None else performance.money(Decimal(row["usdValue"]) - total),
                             "allocations": allocations, "origins": origins, "predecessors": predecessors,
                             "successors": [] if following is None else following["chain"],
                             "currentSuccessorId": following["replacement"]["id"] if following else None})
        source_ids.update(row.get("sourceIds", []))
        source_ids.update(row.get("valuationSourceIds", []))
        for origin in origins:
            source_ids.update(ident for ident in (origin["sourceId"], origin["reviewSourceId"]) if ident)
    work_ids = {wid for row in invoices for line in row["lines"] for wid in line["workIds"]}
    work_rows = [deepcopy(row) for row in context["records"]["work"] if row["id"] in work_ids]
    person_ids = {row["contributorId"] for row in invoices}
    suppliers = [deepcopy(row) for row in context["records"]["contributors"] if row["id"] in person_ids]
    for row in invoices + work_rows + suppliers:
        source_ids.update(row.get("sourceIds", []))
    for value in corrections:
        source_ids.add(value["source"]["id"])
        for row in (value["record"]["original"], value["record"]["replacement"]):
            source_ids.update(row.get("sourceIds", []))
            source_ids.update(row.get("valuationSourceIds", []))
    related_ids = cash_ids | invoice_ids | work_ids | person_ids | source_ids
    relevant_events = [deepcopy(row) for row in history if row.get("recordId") in related_ids]
    for event in relevant_events:
        for row in (event.get("before"), event.get("after")):
            if isinstance(row, dict):
                source_ids.update(ident for ident in row.get("sourceIds", []) if ident in context["sources"])
                source_ids.update(ident for ident in row.get("valuationSourceIds", []) if ident in context["sources"])
    assets = [row for row in native["assets"] if selected_cash(row, selected)]
    native_assets = {cash_identity(row): row for row in native["assets"]}
    groups = {}
    for row in context["records"]["cash"]:
        groups.setdefault(cash_identity(row), []).append(row)
    accounts = []
    for key, members in sorted(groups.items(), key=lambda item: (item[1][0]["network"], item[1][0]["currency"], item[1][0]["asset"])):
        first = members[0]
        asset_position = native_assets.get(key, {})
        finance = positions([], members, selected, CASH_TOTALS)
        account = {"key": key, "network": first["network"], "currency": first["currency"], "asset": first["asset"],
                   "label": (first["network"][10:] if first["network"].startswith("statement/") else first["network"] or "Recorded cash")
                            + " · " + first["currency"] + (" · " + first["asset"] if first["asset"] and first["asset"] != first["currency"] else ""),
                   "transactionCount": len([row for row in members if row["date"] <= selected["endDate"]]),
                   "voidCount": len([row for row in members if row["date"] <= selected["endDate"] and row["state"] == "VOID"]),
                   "unvaluedCount": len([row for row in members if row["date"] <= selected["endDate"] and performance._valid_cash(row) and row["usdValue"] is None]),
                   "testnetCount": len([row for row in members if row["date"] <= selected["endDate"] and row["state"] != "VOID" and not performance._valid_cash(row)])}
        for period in ("opening", "period", "closing"):
            account[period] = {**finance[period],
                               "in": asset_position.get(period + "In", "0"),
                               "out": asset_position.get(period + "Out", "0"),
                               "net": asset_position.get(period + "Net", "0")}
        accounts.append(account)
    program, plan = context["program"], context["plan"]
    report = {"schema": SCHEMA, "selection": selected,
              "case": {key: program[key] for key in ("id", "name", "version", "state", "mode")},
              "plan": {"id": plan["id"], "revision": plan["revision"], "name": plan["name"],
                       "contentSha256": plan["contentSha256"], "sourceSha256": plan["source"]["sha256"]},
              "recordsSha256": digest(context["records"]), "accounts": accounts,
              "finances": positions([], original_cash, selected, CASH_TOTALS), "caseFinances": native["finances"],
              "assets": deepcopy(assets), "transactions": transactions, "invoices": invoices,
              "suppliers": suppliers, "workRecords": work_rows,
              "sources": [deepcopy(context["sources"][ident]) for ident in sorted(source_ids)],
              "history": relevant_events, "corrections": deepcopy(corrections),
              "dependencies": dependencies(context, cash_ids, forecasts, reviews, selected["endDate"]),
              "forecastContinuations": _all_forecast_continuations(context, forecasts or [], corrections, cash_ids),
              "basis": [
                  "The selected dates use each observation's original cash date and the record state at this case version.",
                  "Opening covers dates before the selected start; closing covers dates through the end; period is closing less opening.",
                  "Cash totals and original invoice payment/refund signs come from the existing Performance financial helper.",
                  "Native quantities remain grouped by exact currency, network and asset. Testnet and void rows remain visible outside operating totals.",
                  "Invoice balances use every original cash allocation in the case, including allocations from other accounts.",
                  "Corrections retain the original observation, its void, a new native observation and the complete original request history.",
              ]}
    report["reportSha256"] = digest(report)
    return report


def _read_context(ops, program_id):
    context = ops._context(program_id)
    events = original_history(ops, program_id)
    return context, events, load_corrections(ops, context, events), original_forecasts(ops, program_id), original_reviews(ops, program_id)


def account(ops, program_id, body=None):
    body = object_value(body or {}, ("selection", "expectedVersion"), "cash account request")
    with ops._snapshot():
        context, events, corrections, saved_forecasts, reviews = _read_context(ops, program_id)
        if body.get("expectedVersion") is not None:
            expected = domain.integer(body["expectedVersion"], "Reviewed cash account version", 1, 10000000)
            if expected != context["program"]["version"]:
                fail("The cash account changed after it was selected.", "OPERATIONS_CONFLICT", 409)
        chosen = selection(context, body.get("selection"))
        return build(context, chosen["startDate"], chosen["endDate"], chosen["network"], chosen["currency"], chosen["asset"],
                     events, corrections, saved_forecasts, reviews)


def _attachment_inputs(context, values):
    from operations import decoded
    if values is None:
        values = []
    if not isinstance(values, list) or len(values) > 199:
        fail("Use the complete original correction document list.")
    result, identities = [], set(context["sources"])
    for index, value in enumerate(values):
        value = object_value(value, ("filename", "contentBase64", "mediaType", "kind", "sourceUrl", "observedAt"), "correction document")
        raw = decoded(value.get("contentBase64"))
        filename = text(value.get("filename"), "Original document filename", 240, True)
        if "/" in filename or "\\" in filename or filename in (".", "..") or any(ord(char) < 32 for char in filename):
            fail("Use a plain original correction document filename.")
        if re.fullmatch(r"cash-correction-[a-f0-9]{24}\.json", filename):
            fail("Use the original document name; cash-correction names belong to the retained operation.")
        media = text(value.get("mediaType", "application/octet-stream"), "Original document media type", 200, True)
        if not re.fullmatch(r"[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+", media):
            fail("Use the original document's plain MIME media type.")
        source_url = domain.url(value.get("sourceUrl", ""), "Original source URL")
        observed = domain.timestamp(value.get("observedAt"), "Original source observation", True)
        kind = domain.enum(value.get("kind", "payment"), ("invoice", "work", "grant", "payment", "deployment", "purchase", "other"), "Source kind")
        key = "@attachment:" + str(index)
        metadata = {"filename": filename, "mediaType": media, "kind": kind, "sourceUrl": source_url,
                    "observedAt": observed, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
        ident = "source-" + digest({"attachment": index, **metadata})[:32]
        while ident in identities:
            ident = "source-" + digest({"attachment": ident, **metadata})[:32]
        identities.add(ident)
        result.append({"key": key, "id": ident, "metadata": metadata, "raw": raw,
                       "input": {**value, "filename": filename, "mediaType": media, "kind": kind,
                                 "sourceUrl": source_url, "observedAt": observed}})
    return result


def _replace_attachment_ids(data, attachments, actual=None):
    replacements = {item["key"]: (actual[item["key"]] if actual else item["id"]) for item in attachments}
    replacements.update({item["id"]: (actual[item["key"]] if actual else item["id"]) for item in attachments})
    output = deepcopy(data)
    for key in ("sourceIds", "valuationSourceIds"):
        values = output.get(key, [])
        if not isinstance(values, list) or any(not isinstance(item, str) for item in values):
            fail("Use the original " + key + " document identities.")
        output[key] = [replacements.get(item, item) for item in values]
    for item in attachments:
        ident = actual[item["key"]] if actual else item["id"]
        if ident not in output["sourceIds"]:
            output["sourceIds"].append(ident)
    return output


def _projection(context, selected):
    report = performance.build(context, selected["startDate"], selected["endDate"])
    cash = [row for row in context["records"]["cash"] if selected_cash(row, selected)]
    return {"finances": report["finances"], "accountFinances": positions([], cash, selected, CASH_TOTALS),
            "assets": report["assets"], "invoices": report["invoices"], "packages": report["packages"]}


def _impact(before, after, selected, invoice_ids):
    first, last = _projection(before, selected), _projection(after, selected)
    deltas = {}
    for kind in ("finances", "accountFinances"):
        deltas[kind] = {period: {key: performance.money(Decimal(last[kind][period][key]) - Decimal(value))
                                for key, value in first[kind][period].items()}
                        for period in ("opening", "period", "closing")}
    before_invoice = {row["id"]: row for row in _invoice_rows(before, invoice_ids, selected)}
    after_invoice = {row["id"]: row for row in _invoice_rows(after, invoice_ids, selected)}
    invoices = []
    for ident in sorted(invoice_ids):
        original, replacement = before_invoice[ident], after_invoice[ident]
        invoices.append({"id": ident, "number": original["number"], "contributorId": original["contributorId"],
                         "contributorName": original["contributorName"], "before": original["positions"],
                         "after": replacement["positions"],
                         "deltas": {period: {key: performance.money(Decimal(replacement["positions"][period][key])
                                                                  - Decimal(original["positions"][period][key]))
                                            for key in INVOICE_TOTALS}
                                    for period in ("opening", "period", "closing")}})
    before_assets = {cash_identity(row): row for row in first["assets"]}
    after_assets = {cash_identity(row): row for row in last["assets"]}
    assets = []
    for key in sorted(set(before_assets) | set(after_assets)):
        original, replacement = before_assets.get(key), after_assets.get(key)
        change = {field: performance.hours(Decimal((replacement or {}).get(field, "0"))
                                          - Decimal((original or {}).get(field, "0"))) for field in ASSET_TOTALS}
        if any(Decimal(value) != ZERO for value in change.values()):
            basis = replacement or original
            assets.append({"key": key, "network": basis["network"], "currency": basis["currency"], "asset": basis["asset"],
                           "before": original, "after": replacement, "deltas": change})
    before_packages = {row["id"]: row for row in first["packages"]}
    packages = []
    for row in last["packages"]:
        original = before_packages[row["id"]]
        if row != original:
            fields = [key for key in row if key.endswith("Usd") and row[key] is not None and original.get(key) is not None]
            packages.append({"id": row["id"], "description": row["description"], "before": original, "after": row,
                             "deltas": {key: performance.money(Decimal(row[key]) - Decimal(original[key])) for key in fields}})
    return {"before": first, "after": last, "deltas": deltas, "invoices": invoices, "packages": packages, "assets": assets}


def _forecast_continuations(context, linked, new_id, include_preview=False):
    output = []
    for original in linked:
        inputs = deepcopy(original["inputs"])
        for reference in original["references"]:
            target = inputs
            for key in reference["path"][:-1]:
                target = target[key]
            target[reference["path"][-1]] = new_id
        row = {"forecastId": original["id"], "name": original["name"], "originalSha256": original["sha256"],
               "inputs": inputs, "expectedVersion": context["program"]["version"]}
        try:
            result = forecasts.preview(context, inputs)
            row["status"] = "READY"
            if include_preview:
                row["report"] = result["report"]
        except Problem as exc:
            row["status"] = "REVIEW"
            row["message"] = str(exc)
        output.append(row)
    return output


def _all_forecast_continuations(context, saved, corrections, selected_ids=None):
    successors = successor_map(context, corrections)
    output = []
    for original in saved:
        references = _cash_reference_paths(original.get("inputs", {}), set(successors))
        if not references:
            continue
        if selected_ids is not None and not any(
                ref["cashId"] in selected_ids or successors[ref["cashId"]]["replacement"]["id"] in selected_ids
                for ref in references):
            continue
        inputs, source_ids, source_cash, target_cash = deepcopy(original["inputs"]), set(), set(), set()
        for reference in references:
            selected = successors[reference["cashId"]]
            target = inputs
            for key in reference["path"][:-1]:
                target = target[key]
            target[reference["path"][-1]] = selected["replacement"]["id"]
            source_ids.update(item["sourceId"] for item in selected["chain"])
            source_cash.add(reference["cashId"])
            target_cash.add(selected["replacement"]["id"])
        item = {"forecastId": original["id"], "name": original["inputs"]["name"],
                "originalSha256": original["sha256"], "expectedVersion": context["program"]["version"],
                "sourceCorrectionIds": sorted(source_ids), "originalCashIds": sorted(source_cash),
                "replacementCashIds": sorted(target_cash), "inputs": inputs}
        try:
            forecasts.preview(context, inputs)
            item["status"] = "READY"
        except Problem as exc:
            item["status"] = "REVIEW"
            item["message"] = str(exc)
        output.append(item)
    return output


def prepare(ops, program_id, body):
    body = object_value(body, BODY_KEYS, "cash correction")
    expected = domain.integer(body.get("expectedVersion"), "Reviewed case version", 1, 10000000)
    context, events, corrections, saved_forecasts, reviews = _read_context(ops, program_id)
    if context["program"]["version"] != expected:
        fail("The original case changed after the correction was selected. Review its current observation.", "OPERATIONS_CONFLICT", 409)
    selected = selection(context, body.get("selection"))
    original_id = body.get("originalCashId")
    original = next((row for row in context["records"]["cash"] if row["id"] == original_id), None)
    if original is None:
        fail("Select the original cash observation in this case.", "CASH_NOT_FOUND", 404)
    successors = successor_map(context, corrections)
    if original_id in successors:
        fail("This observation already has a retained correction. Open its current successor "
             + successors[original_id]["replacement"]["id"] + ".", "CASH_HAS_SUCCESSOR", 409)
    reason = text(body.get("reason"), "Correction reason", 12000, True)
    replacement = body.get("replacement")
    if not isinstance(replacement, dict):
        fail("Provide the complete corrected native cash observation.")
    attachments = _attachment_inputs(context, body.get("attachments"))
    staged = deepcopy(context)
    for item in attachments:
        staged["sources"][item["id"]] = {**item["metadata"], "id": item["id"], "createdAt": None}
    for row in staged["records"]["cash"]:
        if row["id"] == original_id:
            row["state"] = "VOID"
    supplied = {key: deepcopy(value) for key, value in replacement.items() if key in INPUT_FIELDS}
    supplied = _replace_attachment_ids(supplied, attachments)
    corrected = domain.prepare("cash", supplied, staged)
    input_identity = digest({"caseVersion": expected, "originalCashId": original_id, "originalSha256": digest(original),
                             "replacement": corrected, "reason": reason, "selection": selected,
                             "attachments": [item["metadata"] for item in attachments]})
    preview_id = "cash-" + input_identity[:32]
    known_ids = {row["id"] for row in staged["records"]["cash"]}
    while preview_id in known_ids:
        preview_id = "cash-" + digest({"preview": preview_id, "input": input_identity})[:32]
    new_version = expected + len(attachments) + (1 if original["state"] == "OBSERVED" else 0) + 1
    staged["records"]["cash"].append({**corrected, "id": preview_id, "version": new_version,
                                     "createdAt": None, "updatedAt": None, "recordedBy": "Correction preview"})
    staged["program"]["version"] = new_version + 1
    changes = [{"field": key, "before": deepcopy(original.get(key)), "after": deepcopy(corrected.get(key))}
               for key in CASH_FIELDS if original.get(key) != corrected.get(key)]
    findings = []
    if context["program"]["state"] != "OPEN":
        findings.append({"code": "OPERATIONS_CLOSED", "severity": "error", "message": "Reopen this case through its original review before saving a correction."})
    if not changes and original["state"] == "OBSERVED":
        findings.append({"code": "CASH_UNCHANGED", "severity": "error", "message": "The corrected observation has the same native facts. Select the intended allocation, valuation or source change."})
    if sum(len(rows) for rows in context["records"].values()) >= 5000:
        findings.append({"code": "CASH_RECORD_LIMIT", "severity": "error", "message": "The case has reached its native retained-record capacity."})
    source_bytes = sum(row["bytes"] for row in context["sources"].values())
    estimate = len((canonical({"original": original, "voided": original, "replacement": corrected,
                              "reason": reason, "attachments": [item["metadata"] for item in attachments]}) + "\n").encode()) + 16000
    if len(context["sources"]) + len(attachments) + 1 > 200 or source_bytes + sum(len(item["raw"]) for item in attachments) + estimate > 24 * 1024 * 1024:
        findings.append({"code": "CASH_SOURCE_LIMIT", "severity": "error", "message": "The complete correction and original documents exceed this case's native source capacity."})
    linked = dependencies(context, {original_id}, saved_forecasts, reviews, selected["endDate"])
    replacement_clock = dependencies(staged, {preview_id}, [], [], selected["endDate"])["completion"]["clocks"]
    if replacement_clock:
        replacement_clock = [{**row, "receiptId": "@replacement"} for row in replacement_clock]
    linked["replacementCompletion"] = replacement_clock
    linked["statementOrigins"] = _statement_origins(original, context["sources"], successors)
    continuation_preview = _forecast_continuations(staged, linked["forecasts"], preview_id, include_preview=True)
    for item in continuation_preview:
        item.pop("inputs", None)
        item["replacementCashId"] = "@replacement"
    linked["forecastContinuations"] = continuation_preview
    if linked["completion"]["extensions"] or linked["completion"]["outcomes"] or linked["completion"]["reviews"]:
        findings.append({"code": "CASH_COMPLETION_HISTORY", "severity": "information",
                         "message": "The existing tranche confirmation, prepared form and submission retain their original receipt identity. The current replacement and original deadline projection are shown together."})
    if linked["forecasts"]:
        findings.append({"code": "CASH_FORECAST_CONTINUATION", "severity": "information",
                         "message": "Saved forecasts retain their original source. The correction supplies complete editable continuation inputs using its new cash identity."})
    invoice_ids = {item["invoiceId"] for row in (original, corrected) for item in row["allocations"]}
    public = {"schema": PREVIEW_SCHEMA, "case": {key: context["program"][key] for key in ("id", "name", "version", "state", "mode")},
              "selection": selected, "original": deepcopy(original), "replacement": corrected,
              "originalCashId": original_id, "originalSha256": digest(original), "reason": reason,
              "attachments": [{"key": item["key"], "id": item["id"], **item["metadata"]} for item in attachments],
              "changes": changes, "impact": _impact(context, staged, selected, invoice_ids), "dependencies": linked,
              "findings": findings, "canApply": not any(item["severity"] == "error" for item in findings),
              "inputSha256": input_identity, "expectedFinalVersion": staged["program"]["version"]}
    public["previewSha256"] = digest(public)
    return public, context, events, corrections, saved_forecasts, reviews, attachments, supplied


def preview(ops, program_id, body):
    with ops._snapshot():
        return prepare(ops, program_id, body)[0]


def apply(ops, program_id, body):
    from operations import identifier
    program_id = identifier(program_id, "operation")
    body = object_value(body, BODY_KEYS, "cash correction command")
    expected = domain.integer(body.get("expectedVersion"), "Reviewed case version", 1, 10000000)
    reviewed = domain.sha(body.get("expectedPreviewSha256"), "Reviewed cash correction", False)
    actor = text(body.get("actor"), "Recording operator", 300, True)
    payload = {"domain": CORRECTION_SCHEMA, "caseId": program_id, "body": body}

    def action():
        candidate, context, events, corrections, saved_forecasts, reviews, attachments, supplied = prepare(ops, program_id, body)
        if candidate["previewSha256"] != reviewed:
            fail("The original observation, correction documents or case differ from the reviewed correction.",
                 "CASH_CORRECTION_PREVIEW_CONFLICT", 409)
        if not candidate["canApply"]:
            fail(next(item["message"] for item in candidate["findings"] if item["severity"] == "error"),
                 "CASH_CORRECTION_REVIEW", 409)
        original = candidate["original"]
        version, actual_sources = expected, {}
        attached = []

        def command(name, data):
            nonlocal version
            result = ops.command(program_id, {"action": name, "data": data, "expectedVersion": version,
                "actor": actor, "note": candidate["reason"], "requestId": body["requestId"]}, _within_transaction=True)
            version = result["version"]
            return result

        for item in attachments:
            result = command("source.add", {**item["input"], "contentBase64": base64.b64encode(item["raw"]).decode("ascii")})
            actual_sources[item["key"]] = result["recordId"]
            metadata, _ = ops.source(program_id, result["recordId"])
            attached.append(metadata)
        if original["state"] == "OBSERVED":
            command("cash.void", {"id": original["id"]})
        voided = deepcopy(ops._record(program_id, "cash", original["id"]))
        corrected_data = _replace_attachment_ids(supplied, attachments, actual_sources)
        result = command("cash.record", corrected_data)
        replacement = deepcopy(ops._record(program_id, "cash", result["recordId"]))
        packet = {"schema": CORRECTION_SCHEMA, "caseId": program_id, "fromVersion": expected,
                  "voidVersion": voided["version"], "recordVersion": result["version"], "version": version + 1,
                  "originalCashId": original["id"], "replacementCashId": replacement["id"],
                  "originalSha256": digest(original), "replacementSha256": digest(replacement),
                  "original": original, "voided": voided, "replacement": replacement,
                  "attachments": attached, "reason": candidate["reason"], "selection": candidate["selection"],
                  "previewSha256": reviewed, "inputSha256": candidate["inputSha256"],
                  "requestId": body["requestId"], "actor": actor, "recordedAt": now()}
        raw = (canonical(packet) + "\n").encode()
        source = command("source.add", {"filename": SOURCE_PREFIX + candidate["inputSha256"][:24] + ".json",
            "mediaType": "application/json", "kind": "payment", "observedAt": packet["recordedAt"],
            "contentBase64": base64.b64encode(raw).decode("ascii")})
        current = ops._context(program_id)
        current_corrections = load_corrections(ops, current)
        continuations = _all_forecast_continuations(current, saved_forecasts, current_corrections)
        return {"id": program_id, "version": version, "action": "cash.correction", "requestId": body["requestId"],
                "originalCashId": original["id"], "replacementCashId": replacement["id"], "sourceId": source["recordId"],
                "previewSha256": reviewed, "inputSha256": candidate["inputSha256"], "selection": candidate["selection"],
                "attachments": attached, "forecastContinuations": continuations,
                "completion": dependencies(current, {original["id"], replacement["id"]}, [], reviews,
                                             candidate["selection"]["endDate"])["completion"]}

    return ops.workspace._transaction(body.get("requestId"), payload, action)


def _flat(rows):
    return [{key: canonical(value) if isinstance(value, (dict, list)) else value for key, value in row.items()} for row in rows]


def _table(headers, rows):
    return "<div class='table'><table><thead><tr>" + "".join("<th scope='col'>" + html.escape(str(value)) + "</th>" for value in headers) + \
        "</tr></thead><tbody>" + "".join("<tr>" + "".join("<td>" + html.escape(str(value if value is not None else "Unvalued")) +
        "</td>" for value in row) + "</tr>" for row in rows) + "</tbody></table></div>"


def render_html(report):
    selected, case = report["selection"], report["case"]
    periods = report["finances"]
    content = ["<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>",
        "<title>Cash accounts — " + html.escape(case["name"]) + "</title><style>",
        "body{margin:0;background:#f4f4f4;color:#222;font:15px/1.5 system-ui,sans-serif}main{max-width:1200px;margin:auto;padding:28px}",
        "h1,h2,h3{line-height:1.2}h1{font-size:28px}h2{font-size:21px;margin-top:34px}h3{font-size:17px}",
        "section,details{background:#fff;border:1px solid #ccc;padding:16px;margin:14px 0}summary{cursor:pointer;font-weight:600}",
        ".table{overflow:auto}table{width:100%;border-collapse:collapse;text-align:left}th,td{padding:8px;border:1px solid #ccc;vertical-align:top;overflow-wrap:anywhere}",
        "th{background:#eee;font-weight:600}p,li{max-width:95ch}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}a{color:#222}",
        "@media(max-width:600px){main{padding:12px}th,td{padding:6px}}@media print{body{background:#fff}main{max-width:none;padding:0}details{break-inside:avoid}summary{list-style:none}}",
        "</style><main><header><h1>Cash accounts</h1><p><strong>" + html.escape(case["name"]) + "</strong> · " + html.escape(case["mode"]) +
        " · case version " + str(case["version"]) + "</p><p>Original cash dates: " + html.escape(selected["startDate"] or "All recorded dates") +
        " through " + html.escape(selected["endDate"]) + ". Network: " + html.escape(selected["network"] if selected["network"] is not None else "All") +
        " · Currency: " + html.escape(selected["currency"] if selected["currency"] is not None else "All") +
        " · Asset: " + html.escape(selected["asset"] if selected["asset"] is not None else "All") + "</p></header>",
        "<h2>Selected cash account in USD</h2>",
        _table(["Position", "Inflow", "Outflow", "Net movement", "Grant receipts", "Customer receipts", "Invoice payment allocation"],
               [[period.title(), *(periods[period][key] for key in CASH_TOTALS)] for period in ("opening", "period", "closing")]),
        "<h2>Original asset quantities</h2>",
        _table(["Network", "Currency", "Asset", "Opening net", "Period inflow", "Period outflow", "Period net", "Closing net"],
               [[row["network"], row["currency"], row["asset"], row["openingNet"], row["periodIn"], row["periodOut"], row["periodNet"], row["closingNet"]]
                for row in report["assets"]]),
        "<h2>Complete original cash observations</h2>",
        _table(["Date", "Reference", "State / basis", "Direction / category", "Original quantity", "USD value", "Allocated USD", "Unallocated USD", "Current successor"],
               [[row["date"], row["externalRef"], row["state"] + " / " + row["usdBasis"], row["direction"] + " / " + row["category"],
                 row["amount"] + " " + row["currency"], row["usdValue"], row["allocatedUsd"], row["unallocatedUsd"], row["currentSuccessorId"] or ""]
                for row in report["transactions"]])]
    for row in report["transactions"]:
        content.append("<details><summary>" + html.escape(row["externalRef"]) + " · " + html.escape(row["date"]) + "</summary>")
        content.append(_table(["Supplier", "Invoice", "Allocation USD", "Original invoice state"],
            [[item["contributorName"], item["invoiceNumber"], item["amountUsd"], item["invoiceState"]] for item in row["allocations"]]))
        content.append("<p>" + html.escape(row["sourceNote"]) + "</p><pre>" + html.escape(json.dumps(row, ensure_ascii=False, indent=2)) + "</pre></details>")
    content.extend(["<h2>Original invoices and full-case balances</h2>",
        _table(["Supplier", "Invoice", "State", "Issued", "Due", "Source total USD", "Paid USD", "Open USD", "Credit USD"],
               [[row["contributorName"], row["number"], row["state"], row["issuedDate"], row["dueDate"] or "",
                 row["totalUsd"], row["paidUsd"], row["openUsd"], row["creditUsd"]] for row in report["invoices"]]),
        "<h2>Recorded corrections</h2>",
        _table(["Version", "Operator", "Original observation", "Current replacement", "Reason", "Original source"],
               [[value["record"]["version"], value["record"]["actor"], value["record"]["originalCashId"],
                 value["record"]["replacementCashId"], value["record"]["reason"], value["source"]["filename"]]
                for value in report["corrections"]]),
        "<h2>Original documents</h2>",
        _table(["Filename", "Kind", "Bytes", "Original observation", "Source URL", "SHA-256"],
               [[row["filename"], row["kind"], row["bytes"], row["observedAt"], row["sourceUrl"], row["sha256"]] for row in report["sources"]]),
        "<h2>Original operation history</h2>",
        _table(["Version", "Date", "Operator", "Action", "Record", "Reason"],
               [[row["version"], row["at"], row["actor"], row["action"], row.get("recordId") or "", row["note"]] for row in report["history"]]),
        "<h2>Continue the work</h2><p>Receive this complete ZIP with Grant Operations → Import complete case. The original planner, cash observations, invoice allocations, source bytes, corrections, forecasts, completion records and complete history travel in operations-case.zip. The cash account selection reopens in the receiving case.</p>",
        "<p>Current forecast continuation inputs and the linked tranche records are included in cash-account.json. The operating workspace opens the same original Forecast and Tranche completion workflows.</p>",
        "<h2>Calculation basis</h2><ul>" + "".join("<li>" + html.escape(value) + "</li>" for value in report["basis"]) + "</ul>",
        "<details><summary>Complete retained account and dependency report</summary><pre>" +
        html.escape(json.dumps(report, ensure_ascii=False, indent=2)) + "</pre></details>",
        "<p>Report identity: " + html.escape(report["reportSha256"]) + "</p></main></html>"])
    return "".join(content).encode()


def _account_csv(report):
    rows = []
    for account_row in report["accounts"]:
        row = {key: value for key, value in account_row.items() if key not in ("opening", "period", "closing")}
        for period in ("opening", "period", "closing"):
            row.update({period + key[0].upper() + key[1:]: value for key, value in account_row[period].items()})
        rows.append(row)
    return rows


def export_bundle(report, original_case):
    allocations = [{**item, "cashId": row["id"], "date": row["date"], "externalRef": row["externalRef"],
                    "state": row["state"], "direction": row["direction"], "category": row["category"],
                    "currency": row["currency"], "network": row["network"], "asset": row["asset"],
                    "originalAmount": row["amount"], "originalUsdValue": row["usdValue"], "usdBasis": row["usdBasis"]}
                   for row in report["transactions"] for item in row["allocations"]]
    account_fields = ("key", "label", "network", "currency", "asset", "transactionCount", "voidCount", "unvaluedCount", "testnetCount",
                      *(period + key[0].upper() + key[1:] for period in ("opening", "period", "closing")
                        for key in (*CASH_TOTALS, "in", "out", "net")))
    files = {"operations-case.zip": original_case,
        "cash-account.json": (canonical(report) + "\n").encode(),
        "selection.json": (canonical(report["selection"]) + "\n").encode(),
        "cash-account.html": render_html(report),
        "transactions.csv": csv_bytes(("id", "state", *CASH_FIELDS, "inPeriod", "usdBasis", "includedInUsd",
                                       "allocatedUsd", "unallocatedUsd", "currentSuccessorId"), _flat(report["transactions"])),
        "allocations.csv": csv_bytes(("cashId", "date", "externalRef", "state", "direction", "category", "currency", "network", "asset",
                                      "originalAmount", "originalUsdValue", "usdBasis", "invoiceId", "invoiceNumber",
                                      "contributorId", "contributorName", "invoiceState", "amountUsd", "sourceIds"), _flat(allocations)),
        "accounts.csv": csv_bytes(account_fields, _account_csv(report)),
        "invoices.csv": csv_bytes(("id", "number", "contributorId", "contributorName", "state", "issuedDate", "dueDate",
                                  "currency", "totalUsd", "paidUsd", "openUsd", "creditUsd", "positions", "lines", "sourceIds", "sourceNote"),
                                 _flat(report["invoices"])),
        "activity.csv": csv_bytes(("version", "at", "actor", "action", "recordId", "kind", "note", "requestId", "before", "after", "sha256"),
                                 _flat(report["history"])),
        "corrections.json": (canonical(report["corrections"]) + "\n").encode(),
        "source-index.csv": csv_bytes(("id", "filename", "mediaType", "kind", "sourceUrl", "observedAt", "bytes", "sha256"), report["sources"]),
        "README.txt": ("Grant Operations cash account handover\n\n"
            "Open cash-account.html for the complete original account. cash-account.json includes every selected observation, allocation, "
            "invoice, source identity, correction, operation and linked forecast/completion input. CSV files carry the full corresponding rows.\n\n"
            "To continue, open Grant planning and delivery, choose Import complete case and select this complete ZIP. "
            "The inner operations-case.zip also reopens through the original case receiver. It contains all exact original attachments, "
            "planner revisions, native records, correction sources, saved forecasts, completion records and history. "
            "selection.json retains the original dates and currency/network/asset selection.\n\n"
            "Amounts use the original current record states and original cash dates at the displayed case version. "
            "The original Performance financial helper computes cash and invoice-payment signs. "
            "Invoice balances include all observed allocations in the original case. Native quantities retain their exact original strings.\n").encode()}
    if sum(map(len, files.values())) > MAX_BUNDLE:
        fail("The complete cash account handover exceeds the original 32 MiB archive capacity.", status=413)
    manifest = {"schema": SCHEMA + ".bundle", "reportSha256": report["reportSha256"],
                "files": [{"path": name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
                          for name, raw in sorted(files.items())]}
    files["MANIFEST.json"] = (canonical(manifest) + "\n").encode()
    if sum(map(len, files.values())) > MAX_BUNDLE:
        fail("The complete cash account and manifest exceed the original archive capacity.", status=413)
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, raw in sorted(files.items()):
            info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            info.external_attr = 0o600 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, raw)
    raw = output.getvalue()
    if len(raw) > MAX_BUNDLE:
        fail("The compressed cash account handover exceeds the original archive capacity.", status=413)
    return raw


def unwrap_bundle(raw):
    if not isinstance(raw, bytes) or len(raw) > MAX_BUNDLE:
        fail("Use the complete original cash account or operations ZIP up to 32 MiB.", status=413)
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            infos = archive.infolist()
            if len(infos) > 220 or sum(item.file_size for item in infos) > MAX_BUNDLE:
                fail("The complete cash account archive exceeds its original capacity.", status=413)
            names = [item.filename for item in infos]
            manifest = json.loads(archive.read("MANIFEST.json"))
            if not isinstance(manifest, dict) or manifest.get("schema") != SCHEMA + ".bundle":
                return raw, None
            expected = {"operations-case.zip", "cash-account.json", "selection.json", "cash-account.html",
                        "transactions.csv", "allocations.csv", "accounts.csv", "invoices.csv",
                        "activity.csv", "corrections.json", "source-index.csv", "README.txt", "MANIFEST.json"}
            if len(names) != len(set(names)) or set(names) != expected:
                fail("The cash account handover must retain its complete original file set.", "INVALID_CASH_ACCOUNT_BUNDLE")
            descriptors = manifest.get("files")
            if not isinstance(descriptors, list) or len(descriptors) != len(expected) - 1:
                fail("Retain the complete cash account file descriptors.", "INVALID_CASH_ACCOUNT_BUNDLE")
            members = {}
            for item in descriptors:
                if not isinstance(item, dict):
                    fail("Use the original cash account file descriptors.", "INVALID_CASH_ACCOUNT_BUNDLE")
                name = item["path"]
                if name in members or name not in expected - {"MANIFEST.json"}:
                    fail("The cash account file list changes or repeats an original member.", "INVALID_CASH_ACCOUNT_BUNDLE")
                content = archive.read(name)
                if len(content) != item["bytes"] or hashlib.sha256(content).hexdigest() != item["sha256"]:
                    fail("A cash account file differs from its original retained bytes.", "INVALID_CASH_ACCOUNT_BUNDLE")
                members[name] = content
            report = json.loads(members["cash-account.json"])
            if not isinstance(report, dict) or report.get("schema") != SCHEMA:
                fail("Use the complete original cash account report.", "INVALID_CASH_ACCOUNT_BUNDLE")
            original_hash = report.get("reportSha256")
            if (original_hash != manifest.get("reportSha256")
                    or digest({key: value for key, value in report.items() if key != "reportSha256"}) != original_hash
                    or json.loads(members["selection.json"]) != report.get("selection")
                    or json.loads(members["corrections.json"]) != report.get("corrections")):
                fail("The cash account report, selection or corrections differ from their original edition.", "INVALID_CASH_ACCOUNT_BUNDLE")
            return members["operations-case.zip"], report
    except Problem:
        raise
    except (zipfile.BadZipFile, KeyError, TypeError, ValueError, RuntimeError) as exc:
        raise Problem("The complete cash account or operations handover is unreadable.", 422, "INVALID_CASH_ACCOUNT_BUNDLE") from exc


def validate_received(report, document):
    if report is None:
        return
    context = {"program": document["program"], "plan": document["plan"], "records": document["records"],
               "sources": {row["id"]: row for row in document["sources"]},
               "completionPlans": document.get("completionPlans", [])}
    if document.get("installationRefs"):
        context["installationRefs"] = document["installationRefs"]
    if document.get("workIntakeRefs"):
        context["workIntakeRefs"] = document["workIntakeRefs"]
    events = document["events"]
    corrections = validate_corrections(context, events, report.get("corrections"))
    chosen = report.get("selection", {})
    rebuilt = build(context, chosen.get("startDate"), chosen.get("endDate"), chosen.get("network"),
                    chosen.get("currency"), chosen.get("asset"), events, corrections,
                    document.get("forecasts", []), document.get("reviews", []))
    if rebuilt != report:
        fail("The cash account report must describe its complete original case and selected period.",
             "CASH_ACCOUNT_SOURCE_CHANGED", 409)


def received_selection(report):
    if report is None:
        return None
    return {**report["selection"], "reportSha256": report["reportSha256"],
            "sourceCaseId": report["case"]["id"], "sourceCaseVersion": report["case"]["version"]}
