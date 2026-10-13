"""Reviewed original merchant settlement sources in the existing SF47 case.

The native merchant reader owns transfer eligibility. This module owns explicit
unit, valuation and attribution choices; it uses the original cash/source/event
transaction and the original complete case export/import.
"""
from __future__ import annotations

import base64
from copy import deepcopy
from decimal import Decimal, localcontext
import hashlib
import html
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import threading
import uuid
import zipfile

from model import Problem, canonical, digest, now, text, csv_bytes
import operations_domain as domain
import operations_statements as statement_sources

SCHEMA = "scf.operations.settlement-receiving.v1"
SOURCE_SCHEMA = "scf.operations.merchant-settlement-source.v1"
READER_SCHEMA = "scf.operations.settlement-reader.v1"
MAX_SOURCE = 8 * 1024 * 1024
MAX_OUTPUT = 24 * 1024 * 1024
MAX_ROWS = 5000
MAX_REVIEWS = 500
HELPER = Path(__file__).resolve().with_name("merchant_settlement_handoff.mjs")
_READER = threading.BoundedSemaphore(1)
CASH_INPUT = ("date", "currency", "decimals", "unitSourceIds", "unitNote", "usdValue",
              "valuationSourceIds", "valuationNote", "category", "tranche", "allocations")
UNIT_INPUT = ("currency", "decimals", "unitSourceIds", "unitNote")
SELECTION_INPUT = ("rowId", "decision", "reason", "cashId", "cash", "deploymentIds", "workIds")
CORRECTION_INPUT = ("reviewId", "rowId", "expectedCashId", "decision", "reason", "cashId", "cash", "deploymentIds", "workIds")
CSV_FIELDS = ("reviewId", "reviewVersion", "sourceId", "sourceSha256", "rowId", "eventId", "kind",
              "decision", "cashId", "cashState", "network", "asset", "amountAtomic",
              "currency", "decimals", "amount", "usdValue", "date", "deploymentIds", "workIds",
              "reason", "sourceIssues")
DERIVED_FILES = {"merchant-settlements.json", "merchant-settlements.csv"}

def fail(message, code="SETTLEMENT_INPUT_INVALID", status=422):
    raise Problem(message, status, code)

def fields(value, allowed, label):
    if not isinstance(value, dict) or set(value) - set(allowed):
        fail("Use the declared " + label + ".")
    return value

def original_filename(value):
    value = text(value, "Original merchant filename", 240, True)
    if value in (".", "..") or "/" in value or "\\" in value or any(ord(c) < 32 for c in value):
        fail("Use a plain original merchant filename.")
    return value

def source_bytes(value):
    if not isinstance(value, str) or len(value) > ((MAX_SOURCE + 2) // 3) * 4:
        fail("Select one complete original merchant TAR up to 8 MiB.", "SETTLEMENT_SOURCE_SIZE", 413)
    try:
        raw = base64.b64decode(value, validate=True)
    except (ValueError, TypeError) as exc:
        raise Problem("The original merchant source encoding is invalid.", 422, "SETTLEMENT_SOURCE_INVALID") from exc
    if not raw or len(raw) > MAX_SOURCE or base64.b64encode(raw).decode("ascii") != value:
        fail("Select one complete original merchant TAR up to 8 MiB.", "SETTLEMENT_SOURCE_SIZE", 413)
    return raw

def archive_members(raw):
    """Read the original plain TAR in memory; never extract caller paths."""
    result, seen, total, last_end = [], set(), 0, 0
    try:
        with tarfile.open(fileobj=io.BytesIO(raw), mode="r:") as archive:
            for count, member in enumerate(archive, 1):
                if count > 4096:
                    fail("The original source contains too many archive entries.", "SETTLEMENT_SOURCE_SIZE", 413)
                name = member.name
                while name.startswith("./"):
                    name = name[2:]
                if name in ("", ".") and member.isdir():
                    last_end = max(last_end, member.offset_data)
                    continue
                if member.isdir():
                    name = name.rstrip("/")
                if (not name or len(name) > 400 or name.startswith("/") or "\\" in name
                        or any(ord(c) < 32 or ord(c) == 127 for c in name)
                        or any(part in ("", ".", "..") for part in name.split("/"))
                        or name in seen):
                    fail("Every original archive entry needs its own safe relative path.", "SETTLEMENT_SOURCE_PATH")
                seen.add(name)
                if not member.isfile() and not member.isdir() or member.issparse():
                    fail("Keep ordinary source files and directories; archive links and special entries are unsupported.",
                         "SETTLEMENT_SOURCE_PATH")
                if not isinstance(member.size, int) or member.size < 0 or member.size > MAX_SOURCE:
                    fail("The original source member exceeds the source bound.", "SETTLEMENT_SOURCE_SIZE", 413)
                last_end = max(last_end, member.offset_data + ((member.size + 511) // 512) * 512)
                if member.isdir():
                    if member.size:
                        fail("An original archive directory has an unexpected body.", "SETTLEMENT_SOURCE_PATH")
                    continue
                total += member.size
                if total > MAX_SOURCE:
                    fail("The expanded original source exceeds 8 MiB.", "SETTLEMENT_SOURCE_SIZE", 413)
                stream = archive.extractfile(member)
                content = stream.read(member.size + 1) if stream else None
                if content is None or len(content) != member.size:
                    fail("An original archive member is incomplete.", "SETTLEMENT_SOURCE_INCOMPLETE")
                result.append({"path": name, "bytes": len(content),
                    "sha256": hashlib.sha256(content).hexdigest(),
                    "contentBase64": base64.b64encode(content).decode("ascii")})
        if not result or len(raw) - last_end < 1024 or any(raw[last_end:]):
            fail("Select one complete original TAR with its original archive terminator.",
                 "SETTLEMENT_SOURCE_INCOMPLETE")
    except Problem:
        raise
    except (tarfile.TarError, OSError, ValueError, UnicodeError, OverflowError) as exc:
        raise Problem("The original merchant source must be a complete plain TAR.", 422, "SETTLEMENT_SOURCE_INVALID") from exc
    return result

def inspect(raw, filename):
    name = original_filename(filename)
    members = archive_members(raw)
    selected = os.environ.get("SF47_SETTLEMENT_NODE") or os.environ.get("SF47_BUYER_NODE") or shutil.which("node")
    if not selected or not Path(selected).is_absolute() or not Path(selected).is_file():
        fail("Select the installed Node runtime to read the original merchant product.",
             "SETTLEMENT_NODE_UNAVAILABLE", 503)
    if not _READER.acquire(blocking=False):
        fail("Another original merchant source review is running. Continue the same selection after it finishes.",
             "SETTLEMENT_REVIEW_BUSY", 409)
    try:
        envelope = {"schema": "scf.operations.settlement-reader-input.v1",
            "source": {"sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw),
                       "filename": name, "format": "tar"}, "files": members}
        try:
            process = subprocess.run([selected, "--max-old-space-size=192", str(HELPER)],
                input=canonical(envelope).encode("utf-8"), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                timeout=45, check=False)
        except subprocess.TimeoutExpired as exc:
            raise Problem("The original merchant reader timed out. Retain this same source selection.",
                          503, "SETTLEMENT_READER_TIMEOUT") from exc
        except OSError as exc:
            raise Problem("The installed original merchant reader could not start.",
                          503, "SETTLEMENT_READER_UNAVAILABLE") from exc
        if len(process.stdout) > MAX_OUTPUT:
            fail("Select a smaller complete original accounting period.", "SETTLEMENT_SOURCE_SIZE", 413)
        try:
            result = json.loads(process.stdout)
        except (ValueError, UnicodeError) as exc:
            raise Problem("The original merchant reader did not return its complete result.",
                          503, "SETTLEMENT_READER_INCOMPLETE") from exc
        if process.returncode or not isinstance(result, dict) or result.get("error"):
            error = result.get("error", {}) if isinstance(result, dict) else {}
            code = error.get("code")
            code = code if isinstance(code, str) and re.fullmatch(r"[A-Z0-9_]{1,120}", code) else "SETTLEMENT_READER_INCOMPLETE"
            status = 503 if error.get("status") == 503 or not error else 422
            fail("The original merchant reader needs attention: " + code + ".", code, status)
        report = result.get("report")
        if (result.get("schema") != READER_SCHEMA or not isinstance(report, dict)
                or report.get("schema") != SOURCE_SCHEMA
                or report.get("source", {}).get("sha256") != envelope["source"]["sha256"]
                or report["source"].get("bytes") != len(raw) or report["source"].get("filename") != name
                or not isinstance(report.get("rows"), list) or len(report["rows"]) > MAX_ROWS
                or not isinstance(result.get("html"), str)):
            fail("The merchant reader result differs from the selected original source.",
                 "SETTLEMENT_READER_CHANGED", 503)
        return result
    finally:
        _READER.release()

def _version(context, expected):
    expected = domain.integer(expected, "Reviewed operations version", 1, 10000000)
    if context["program"]["version"] != expected:
        fail("The operations case changed. Refresh before reviewing this source.", "OPERATIONS_CONFLICT", 409)
    return expected

def _association(source):
    value = source.get("settlementHandoff")
    return value if isinstance(value, dict) and value.get("schema") == SCHEMA else None

def _review_rows(context):
    for source in context["sources"].values():
        association = _association(source)
        if association:
            for review in association.get("reviews", []):
                yield source, association, review

def _source_for_sha(context, sha):
    return next((source for source in context["sources"].values()
                 if source["sha256"] == sha and _association(source)), None)

def _latest_rows(context):
    """Only the effective edition for each exact source, preserving all history."""
    for source in context["sources"].values():
        association = _association(source)
        if association and association.get("reviews"):
            for row in association["reviews"][-1]["rows"]:
                yield source, row

def _cash_map(context):
    return {row["id"]: row for row in context["records"]["cash"]}

def _native_matches(context, row):
    transfer = row.get("transfer")
    if not transfer:
        return []
    refs = {transfer["externalRef"], transfer["transaction"]}
    return [cash for cash in context["records"]["cash"]
            if cash["state"] != "VOID" and cash["network"] == transfer["network"]
            and cash["asset"] == transfer["asset"] and cash["externalRef"] in refs]

def _attribution(context, selection):
    deployments = {row["id"]: row for row in context["records"]["deployments"]}
    work = {row["id"]: row for row in context["records"]["work"]}
    dids = domain.reference_list(selection.get("deploymentIds", []), deployments, "Merchant deployments")
    wids = domain.reference_list(selection.get("workIds", []), work, "Attributed work")
    if any(deployments[ident]["role"] not in ("MERCHANT", "BOTH") for ident in dids):
        fail("Attribute merchant settlement to an original merchant or combined deployment.")
    if not context.get("restoring") and any(work[ident]["state"] == "VOID" for ident in wids):
        fail("Choose retained nonvoid work for a new attribution.")
    return sorted(dids), sorted(wids)

def _unit(context, row, value, unit_only=False):
    fields(value, UNIT_INPUT if unit_only else CASH_INPUT, "reviewed asset-unit inputs")
    currency = text(value.get("currency"), "Reviewed currency or asset symbol", 40, True).upper()
    if currency == "USD":
        fail("Retain this Stellar asset's own unit. Use an explicit separate USD valuation.",
             "SETTLEMENT_ASSET_UNIT_REQUIRED")
    decimals = domain.integer(value.get("decimals"), "Reviewed asset decimals", 0, 12)
    note = text(value.get("unitNote"), "Asset-unit review basis", 4000, True)
    refs = sorted(domain.reference_list(value.get("unitSourceIds", []), context["sources"], "Asset-unit sources"))
    transfer = row.get("transfer")
    if not row.get("canRecordCash") or not isinstance(transfer, dict):
        fail("This row needs complete eligible original transfer evidence before any cash entry or link.",
             "SETTLEMENT_TRANSFER_NOT_ELIGIBLE")
    atomic = transfer.get("amountAtomic")
    if not isinstance(atomic, str) or not re.fullmatch(r"[1-9][0-9]{0,38}", atomic):
        fail("Keep the original positive atomic amount.", "SETTLEMENT_TRANSFER_CHANGED")
    with localcontext() as precision:
        precision.prec = 96
        amount = domain.quantity(Decimal(atomic).scaleb(-decimals), "Original transfer quantity", 12, True)
    return {"currency": currency, "decimals": decimals, "unitSourceIds": refs, "unitNote": note}, amount

def _decimal_input(value, label):
    if not isinstance(value, str) or not re.fullmatch(r"(?:0|[1-9][0-9]*)(?:\.[0-9]+)?", value):
        fail(label + ": retain an exact decimal string.")
    return value

def _cash_inputs(context, row, value):
    unit, amount = _unit(context, row, value)
    valuation = value.get("usdValue")
    if valuation in (None, ""):
        valuation = None
    else:
        valuation = _decimal_input(valuation, "Reviewed USD valuation")
    valuation_refs = sorted(domain.reference_list(value.get("valuationSourceIds", []), context["sources"], "Valuation sources"))
    valuation_note = text(value.get("valuationNote", ""), "USD valuation basis", 4000)
    if valuation is not None and not valuation_note:
        fail("Record the explicit USD valuation basis; merchant quote fields do not provide it.",
             "SETTLEMENT_VALUATION_BASIS_REQUIRED")
    category = value.get("category") or ("REFUND" if row["kind"] == "REFUND" else "CUSTOMER")
    allowed = ("REFUND",) if row["kind"] == "REFUND" else ("CUSTOMER", "INVOICE", "OTHER")
    category = domain.enum(category, allowed, "Original merchant cash category")
    allocations = value.get("allocations", [])
    if not isinstance(allocations, list) or len(allocations) > 200:
        fail("Use the original invoice allocation rows.")
    for item in allocations:
        fields(item, ("invoiceId", "amountUsd"), "invoice allocation")
        _decimal_input(item.get("amountUsd"), "Invoice allocation")
    inputs = {**unit, "date": domain.calendar(value.get("date"), "Reviewed transfer date"),
        "usdValue": valuation, "valuationSourceIds": valuation_refs, "valuationNote": valuation_note,
        "category": category, "tranche": domain.integer(value.get("tranche"), "Receipt tranche", 0, 3, True),
        "allocations": deepcopy(allocations)}
    transfer = row["transfer"]
    data = {"direction": transfer["direction"], "category": category, "date": inputs["date"],
        "currency": unit["currency"], "network": transfer["network"], "asset": transfer["asset"],
        "amount": amount, "usdValue": valuation, "valuationSourceIds": valuation_refs,
        "valuationNote": valuation_note, "externalRef": transfer["externalRef"], "tranche": inputs["tranche"],
        "allocations": allocations, "sourceIds": sorted(set(unit["unitSourceIds"] + valuation_refs)),
        "sourceNote": "Original merchant transfer " + transfer["transaction"] + "; event " +
            transfer["matchingEventId"] + ". Reviewed unit: " + unit["unitNote"]}
    with localcontext() as precision:
        precision.prec = 96
        prepared = domain.prepare("cash", data, context)
    inputs["usdValue"] = prepared["usdValue"]
    inputs["allocations"] = deepcopy(prepared["allocations"])
    return inputs, prepared

def _linked_cash(context, row, cash_id, value):
    if (not isinstance(cash_id, str) or not re.fullmatch(r"[a-z][a-z0-9-]{1,99}", cash_id)
            or not cash_id.startswith("cash-")):
        fail("Select one original cash identity.", "SETTLEMENT_CASH_NOT_FOUND", 404)
    unit, amount = _unit(context, row, value, unit_only=True)
    cash = _cash_map(context).get(cash_id)
    if not cash or cash["state"] == "VOID":
        fail("Select the original active cash observation.", "SETTLEMENT_CASH_NOT_FOUND", 404)
    t = row["transfer"]
    if (cash["direction"] != t["direction"] or cash["network"] != t["network"] or cash["asset"] != t["asset"]
            or cash["currency"] != unit["currency"] or cash["amount"] != amount
            or cash["externalRef"] not in (t["externalRef"], t["transaction"])):
        fail("The selected cash's original network, asset, quantity, direction and transfer reference must match.",
             "SETTLEMENT_CASH_SOURCE_CONFLICT", 409)
    if any(match["id"] != cash["id"] for match in _native_matches(context, row)):
        fail("More than one active cash record names this original transfer. Resolve that native cash history before linking.",
             "SETTLEMENT_CASH_SOURCE_CONFLICT", 409)
    return unit, deepcopy(cash)

def _transfer_links(context, row, cash_id=None):
    transfer = row.get("transfer")
    if not transfer:
        return
    live = _cash_map(context)
    for _, link in _latest_rows(context):
        old_id, old_key = link.get("cashId"), link.get("transferKey")
        if not old_id or live.get(old_id, {}).get("state") == "VOID":
            continue
        if old_key == transfer["transferKey"] and cash_id != old_id:
            fail("This original transfer already belongs to its retained cash observation. Link that exact cash.",
                 "SETTLEMENT_TRANSFER_ALREADY_RECORDED", 409)
        if cash_id and old_id == cash_id and old_key != transfer["transferKey"]:
            fail("The selected cash is already linked to another native transfer event.",
                 "SETTLEMENT_CASH_SOURCE_CONFLICT", 409)

def _plain_selection(value, row):
    fields(value, SELECTION_INPUT, "original settlement row selection")
    if value.get("rowId") != row["rowId"]:
        fail("Choose the exact original source row.")
    decision = domain.enum(value.get("decision"), ("RECORD_CASH", "LINK_CASH", "OBSERVE", "OMIT"), "Row decision")
    result = {"rowId": row["rowId"], "decision": decision,
        "reason": text(value.get("reason"), "Row decision reason", 4000, True),
        "cashId": value.get("cashId"), "cash": deepcopy(value.get("cash")),
        "deploymentIds": deepcopy(value.get("deploymentIds", [])), "workIds": deepcopy(value.get("workIds", []))}
    if decision != "LINK_CASH" and result["cashId"] is not None:
        fail("Only LINK_CASH selects an existing cash identity.")
    if decision in ("OBSERVE", "OMIT") and result["cash"] is not None:
        fail("Observation and omission decisions carry no cash inputs.")
    return result

def _effect(row, decision, cash=None, cash_id=None, **extra):
    return {"rowId": row["rowId"], "decision": decision, "cash": cash, "cashId": cash_id,
            "existingCashId": cash_id, "replacedCashId": None, "voidedCashId": None,
            "deploymentIds": [], "workIds": [], "findings": [], **extra}

def _problem_finding(exc):
    return {"code": getattr(exc, "code", "SETTLEMENT_REVIEW_REQUIRED"), "message": str(exc)}

def _source_context_digest(context):
    return digest({"plan": context["plan"], "records": context["records"], "sources": context["sources"],
                   "program": context["program"], "completionPlans": context.get("completionPlans", []),
                   "installationRefs": context.get("installationRefs", [])})

def _preview_basis(context, native, selection, effects):
    return {"schema": SCHEMA + ".preview", "caseId": context["program"]["id"],
        "version": context["program"]["version"], "contextSha256": _source_context_digest(context),
        "sourceSha256": native["report"]["source"]["sha256"],
        "inspectionSha256": hashlib.sha256((canonical(native) + "\n").encode()).hexdigest(),
        "selection": deepcopy(selection), "effects": deepcopy(effects)}

def _propose(context, native, name, selections):
    name = text(name, "Settlement review name", 300, True)
    rows = {row["rowId"]: row for row in native["report"]["rows"]}
    if not isinstance(selections, list) or not (0 if not rows else 1) <= len(selections) <= max(1, len(rows)):
        fail("Select one or more original source rows for this review.", "SETTLEMENT_SELECTION_REQUIRED")
    if len({value.get("rowId") for value in selections if isinstance(value, dict)}) != len(selections):
        fail("Select each original source row once.")
    source = _source_for_sha(context, native["report"]["source"]["sha256"])
    previous = _association(source)["reviews"][-1] if source and _association(source).get("reviews") else None
    old_rows = {value["rowId"]: value for value in previous["rows"]} if previous else {}
    staged = deepcopy(context)
    effects, normalized, selected_cash = [], [], {}
    for value in sorted(selections, key=lambda item: str(item.get("rowId", "")) if isinstance(item, dict) else ""):
        row = rows.get(value.get("rowId")) if isinstance(value, dict) else None
        if row is None:
            fail("Select a row from this exact original merchant source.")
        selected = _plain_selection(value, row)
        effect = _effect(row, selected["decision"])
        try:
            dids, wids = _attribution(staged, selected)
            selected["deploymentIds"], selected["workIds"] = dids, wids
            effect.update(deploymentIds=dids, workIds=wids)
            prior = old_rows.get(row["rowId"])
            if prior and prior.get("cashId"):
                comparable = {key: prior.get(key) for key in SELECTION_INPUT}
                comparable["cashId"] = prior["cashId"] if prior["decision"] == "LINK_CASH" else None
                if selected != comparable:
                    fail("Use a reviewed correction to change this row's retained cash decision.",
                         "SETTLEMENT_CORRECTION_REQUIRED", 409)
                retained_cash = _cash_map(staged).get(prior["cashId"])
                if not retained_cash:
                    fail("The retained original cash observation is missing.", "SETTLEMENT_CASH_NOT_FOUND", 409)
                effect.update(cash=deepcopy(retained_cash), cashId=retained_cash["id"],
                              existingCashId=retained_cash["id"], unchanged=True)
            elif selected["decision"] == "RECORD_CASH":
                _transfer_links(staged, row)
                if _native_matches(staged, row):
                    fail("An active cash entry already has this original transfer. Choose LINK_CASH.",
                         "SETTLEMENT_TRANSFER_ALREADY_RECORDED", 409)
                selected["cash"], cash = _cash_inputs(staged, row, selected["cash"])
                effect["cash"] = cash
                staged["records"]["cash"].append({**cash, "id": "cash-preview-" + row["rowId"]})
            elif selected["decision"] == "LINK_CASH":
                selected["cash"], cash = _linked_cash(staged, row, selected["cashId"], selected["cash"])
                _transfer_links(staged, row, cash["id"])
                if cash["id"] in selected_cash and selected_cash[cash["id"]] != row["transfer"]["transferKey"]:
                    fail("One cash observation cannot cover different native transfer events.")
                selected_cash[cash["id"]] = row["transfer"]["transferKey"]
                effect.update(cash=cash, cashId=cash["id"], existingCashId=cash["id"])
            else:
                effect["findings"] = [{"code": item, "message": item, "sourceOnly": True} for item in row["issues"]]
        except Problem as exc:
            effect["findings"] = [_problem_finding(exc)]
            effect["blocked"] = True
        effects.append(effect)
        normalized.append(selected)
    blocked = sum(bool(effect.get("blocked")) for effect in effects)
    return {"name": name, "selections": normalized, "effects": effects,
        "counts": {"selected": len(effects), "record": sum(e["decision"] == "RECORD_CASH" and not e.get("unchanged") and not e.get("blocked") for e in effects),
                   "link": sum(e["decision"] == "LINK_CASH" and not e.get("blocked") for e in effects),
                   "observed": sum(e["decision"] == "OBSERVE" for e in effects),
                   "omitted": sum(e["decision"] == "OMIT" for e in effects), "blocked": blocked},
        "canApply": blocked == 0}

def _preview(context, native, body):
    report = native["report"]
    selected = ("name" in body or "selections" in body)
    proposed = _propose(context, native, body.get("name"), body.get("selections")) if selected else None
    rows = []
    for value in report["rows"]:
        matches = _native_matches(context, value)
        rows.append({**deepcopy(value), "matches": deepcopy(matches),
            "suggestedCashId": matches[0]["id"] if len(matches) == 1 else None})
    result = {"schema": SCHEMA, "caseId": context["program"]["id"], "version": context["program"]["version"],
        "source": deepcopy(report["source"]), "reader": deepcopy(report["reader"]), "counts": deepcopy(report["counts"]),
        "rows": rows, "units": deepcopy(report["units"]), "html": native["html"],
        "interpretation": report["interpretation"],
        "deployments": deepcopy(context["records"]["deployments"]), "work": deepcopy(context["records"]["work"]),
        "cash": deepcopy(context["records"]["cash"]), "invoices": deepcopy(context["records"]["invoices"]),
        "retainedReviews": [review_summary(source, review) for source, _, review in _review_rows(context)
                            if source["sha256"] == report["source"]["sha256"]]}
    selection = {"name": proposed["name"], "selections": proposed["selections"]} if proposed else None
    result["previewSha256"] = digest(_preview_basis(context, native, selection, proposed["effects"] if proposed else []))
    if proposed:
        result["proposed"] = proposed
    return result

def _inspect_selected(context, raw, filename):
    name = original_filename(filename)
    original = _source_for_sha(context, hashlib.sha256(raw).hexdigest())
    if original:
        name = _association(original)["originalFilename"]
    return inspect(raw, name)

def preview(context, body):
    fields(body, ("expectedVersion", "filename", "contentBase64", "name", "selections"), "settlement preview")
    _version(context, body.get("expectedVersion"))
    return _preview(context, _inspect_selected(context, source_bytes(body.get("contentBase64")), body.get("filename")), body)


def _raw_source(ops, context, source_id):
    source = context["sources"].get(source_id)
    if not source:
        fail("The retained original source is missing.", "SETTLEMENT_SOURCE_MISSING", 409)
    row = ops.db.execute("SELECT content FROM ops_sources WHERE program_id=? AND id=?",
                         (context["program"]["id"], source_id)).fetchone()
    raw = bytes(row[0]) if row else None
    if raw is None or len(raw) != source["bytes"] or hashlib.sha256(raw).hexdigest() != source["sha256"]:
        fail("The original source differs from its retained bytes.", "SETTLEMENT_SOURCE_CHANGED", 409)
    return raw

def _retained_native(ops, context, source):
    association = _association(source)
    if not association:
        fail("Select a retained merchant source.", "SETTLEMENT_SOURCE_MISSING", 404)
    raw = _raw_source(ops, context, association["inspectionSourceId"])
    if hashlib.sha256(raw).hexdigest() != association["inspectionSha256"]:
        fail("The retained native source inspection changed.", "SETTLEMENT_SOURCE_CHANGED", 409)
    try:
        native = json.loads(raw)
    except (ValueError, UnicodeError) as exc:
        raise Problem("The retained original source inspection is unreadable.", 409, "SETTLEMENT_SOURCE_CHANGED") from exc
    if (native.get("schema") != READER_SCHEMA or native.get("report", {}).get("schema") != SOURCE_SCHEMA
            or native["report"]["source"]["sha256"] != source["sha256"]
            or native["report"]["source"]["bytes"] != source["bytes"]
            or native["report"]["source"]["filename"] != association["originalFilename"]
            or native["report"]["source"] != association["source"] or native["report"]["reader"] != association["reader"]):
        fail("The original native source binding changed.", "SETTLEMENT_SOURCE_CHANGED", 409)
    return native

def _save_source(ops, context, raw, filename, observed_at, media):
    identity = hashlib.sha256(raw).hexdigest()
    for source in context["sources"].values():
        if source["sha256"] == identity and source["bytes"] == len(raw):
            if _raw_source(ops, context, source["id"]) == raw:
                return deepcopy(source)
    row = ops._source_add(context["program"]["id"], {"filename": original_filename(filename),
        "mediaType": media, "kind": "payment", "sourceUrl": "", "observedAt": observed_at,
        "contentBase64": base64.b64encode(raw).decode("ascii")})
    context["sources"][row["id"]] = row
    return deepcopy(row)

def _retained_selection(ops, context, native, raw):
    source = native["report"]["source"]
    original = _source_for_sha(context, source["sha256"])
    if original:
        if _raw_source(ops, context, original["id"]) != raw or _retained_native(ops, context, original) != native:
            fail("This original source is retained with a different reader edition.", "SETTLEMENT_READER_CHANGED", 409)
        return deepcopy(original)
    prefix = "settlement-" + source["sha256"][:20]
    rendered = native["html"].encode("utf-8")
    inspection = (canonical(native) + "\n").encode("utf-8")
    if len(inspection) > MAX_SOURCE or len(rendered) > MAX_SOURCE:
        fail("Select a smaller complete original source period for its retained review.", "SETTLEMENT_SOURCE_SIZE", 413)
    original = _save_source(ops, context, raw, prefix + "--" + source["filename"][:190],
                            source["capturedAt"], "application/x-tar")
    checked = _save_source(ops, context, inspection, prefix + ".native.json", source["capturedAt"], "application/json")
    presentation = _save_source(ops, context, rendered, prefix + ".native.html", source["capturedAt"], "text/html")
    original["settlementHandoff"] = {"schema": SCHEMA, "sourceSha256": original["sha256"],
        "originalFilename": source["filename"], "inspectionSourceId": checked["id"],
        "inspectionSha256": checked["sha256"], "reportSourceId": presentation["id"],
        "reportSha256": presentation["sha256"], "source": deepcopy(source),
        "reader": deepcopy(native["report"]["reader"]), "counts": deepcopy(native["report"]["counts"]), "reviews": []}
    # The association is published with its first full review in _finish.
    return original

def _new_cash(ops, context, row, inputs, sources, actor, version):
    _, normalized = _cash_inputs(context, row, inputs)
    normalized["sourceIds"] = sorted(set(normalized["sourceIds"] + sources))
    normalized["sourceNote"] += "\nOriginal merchant archive and native inspection are retained in this case."
    with localcontext() as precision:
        precision.prec = 96
        normalized = domain.prepare("cash", normalized, context)
    stamp = now()
    cash = {**normalized, "id": "cash-" + uuid.uuid4().hex, "version": version,
            "createdAt": stamp, "updatedAt": stamp, "recordedBy": actor}
    ops._save(context["program"]["id"], "cash", cash)
    context["records"]["cash"].append(cash)
    return cash

def _void_cash(ops, context, cash, actor, reason, version):
    if cash["state"] != "OBSERVED":
        fail("The original cash is no longer available for this reviewed transition.",
             "SETTLEMENT_CASH_CHANGED", 409)
    result = {**cash, "state": "VOID", "version": version, "updatedAt": now(),
              "reviewedBy": actor, "reviewNote": reason}
    ops._save(context["program"]["id"], "cash", result)
    context["records"]["cash"] = [result if row["id"] == cash["id"] else row
                                   for row in context["records"]["cash"]]
    return result

def _link_row(native_row, selected, cash):
    return {"rowId": native_row["rowId"], "eventId": native_row["eventId"], "kind": native_row["kind"],
        "sourceRowSha256": native_row["sourceRowSha256"], "transfer": deepcopy(native_row.get("transfer")),
        "transferKey": (native_row.get("transfer") or {}).get("transferKey"),
        "decision": selected["decision"], "reason": selected["reason"],
        "cashId": cash["id"] if cash else None, "cash": deepcopy(selected.get("cash")),
        "cashSnapshot": deepcopy(cash),
        "deploymentIds": deepcopy(selected["deploymentIds"]), "workIds": deepcopy(selected["workIds"])}

def _review_counts(rows, total):
    return {"sourceRows": total, "selected": len(rows), "unselected": total - len(rows),
        "cash": sum(row.get("cashId") is not None for row in rows),
        "observed": sum(row["decision"] == "OBSERVE" for row in rows),
        "omitted": sum(row["decision"] == "OMIT" for row in rows),
        "voided": sum(row["decision"] == "VOID_CASH" for row in rows)}

def _finish(ops, context, original, native, before_source, rows, changes, basis,
            name, actor, version, request_id, note, review_type, changed_rows, selection_inputs):
    association = deepcopy(original["settlementHandoff"])
    if sum(1 for _ in _review_rows(context)) >= MAX_REVIEWS:
        fail("This case has reached its retained settlement-review bound.", "SETTLEMENT_REVIEW_LIMIT", 413)
    previous = association["reviews"][-1] if association["reviews"] else None
    rows = sorted(rows, key=lambda item: item["rowId"])
    review = {"schema": SCHEMA + ".review", "id": "settlement-" + uuid.uuid4().hex,
        "name": name, "type": review_type, "version": version, "createdAt": now(),
        "actor": actor, "requestId": request_id, "note": note,
        "sourceId": original["id"], "sourceSha256": original["sha256"],
        "inspectionSourceId": association["inspectionSourceId"],
        "previousReviewId": previous["id"] if previous else None,
        "rows": rows, "changedRowIds": sorted(changed_rows), "selectionInputs": deepcopy(selection_inputs),
        "cashChanges": deepcopy(changes), "preview": deepcopy(basis), "previewSha256": digest(basis),
        "counts": _review_counts(rows, len(native["report"]["rows"]))}
    review["sha256"] = digest(review)
    association["reviews"].append(review)
    after_source = {**original, "settlementHandoff": association}
    ops.db.execute("UPDATE ops_sources SET metadata_json=? WHERE program_id=? AND id=?",
        (canonical(after_source), context["program"]["id"], original["id"]))
    context["sources"][original["id"]] = after_source
    return {"unchanged": False, "before": {"reviewId": previous["id"] if previous else None,
                "cash": [deepcopy(change["before"]) for change in changes]},
        "after": {"review": deepcopy(review), "cash": [deepcopy(change["after"]) for change in changes],
                  "sourceSha256": original["sha256"]},
        "kind": "settlementReceiving", "recordId": review["id"],
        "sourceChange": {"before": deepcopy(before_source), "after": deepcopy(after_source)},
        "reviewId": review["id"], "sourceId": original["id"], "sourceSha256": original["sha256"],
        "cashIds": sorted({row["cashId"] for row in rows if row.get("cashId")})}

def receive(ops, context, data, actor, version, request_id, note):
    fields(data, ("filename", "contentBase64", "expectedPreviewSha256", "name", "selections"),
           "merchant settlement receiving command")
    raw = source_bytes(data.get("contentBase64"))
    native = _inspect_selected(context, raw, data.get("filename"))
    reviewed = _preview(context, native, data)
    expected = domain.sha(data.get("expectedPreviewSha256"), "Reviewed settlement selection", False)
    if expected != reviewed["previewSha256"]:
        fail("The original source, selected effects or operations case changed. Review the same complete selection again.",
             "SETTLEMENT_PREVIEW_CONFLICT", 409)
    proposed = reviewed.get("proposed")
    if not proposed or not proposed["canApply"]:
        fail("Resolve the native selection findings before receiving.", "SETTLEMENT_REVIEW_REQUIRED")
    record_count = sum(len(value) for value in context["records"].values())
    if record_count + proposed["counts"]["record"] > MAX_ROWS:
        fail("This operations case has reached its retained-record bound.", "SETTLEMENT_RECORD_LIMIT", 413)
    prior_source = _source_for_sha(context, native["report"]["source"]["sha256"])
    prior_association = _association(prior_source) if prior_source else None
    prior = prior_association["reviews"][-1] if prior_association and prior_association["reviews"] else None
    effective = {row["rowId"]: deepcopy(row) for row in prior["rows"]} if prior else {}
    native_rows = {row["rowId"]: row for row in native["report"]["rows"]}
    basis = _preview_basis(context, native, {"name": proposed["name"], "selections": proposed["selections"]},
                           proposed["effects"])
    # Nothing has changed before this original transaction has validated the full preview.
    original = _retained_selection(ops, context, native, raw)
    before_source = deepcopy(context["sources"][original["id"]])
    refs = [original["id"], original["settlementHandoff"]["inspectionSourceId"],
            original["settlementHandoff"]["reportSourceId"]]
    changes, changed_rows = [], []
    for selected, effect in zip(proposed["selections"], proposed["effects"]):
        row = native_rows[selected["rowId"]]
        if effect.get("unchanged"):
            continue
        cash = None
        if selected["decision"] == "RECORD_CASH":
            cash = _new_cash(ops, context, row, selected["cash"], refs, actor, version)
            changes.append({"before": None, "after": deepcopy(cash)})
        elif selected["decision"] == "LINK_CASH":
            _, cash = _linked_cash(context, row, selected["cashId"], selected["cash"])
        link = _link_row(row, selected, cash)
        if effective.get(row["rowId"]) != link:
            changed_rows.append(row["rowId"])
            effective[row["rowId"]] = link
    if prior and not changed_rows and prior["name"] == proposed["name"]:
        return {"unchanged": True, "before": None, "after": None, "kind": "settlementReceiving",
            "recordId": prior["id"], "reviewId": prior["id"], "sourceId": original["id"],
            "sourceSha256": original["sha256"], "cashIds": sorted({row["cashId"] for row in prior["rows"] if row.get("cashId")})}
    return _finish(ops, context, original, native, before_source, list(effective.values()), changes, basis,
        proposed["name"], actor, version, request_id, note, "RECEIVE", changed_rows, proposed["selections"])

def _selected_review(context, review_id):
    review_id = text(review_id, "Retained settlement review", 100, True)
    for source, association, review in _review_rows(context):
        if review["id"] == review_id:
            return source, association, review
    fail("Select a retained settlement review.", "SETTLEMENT_REVIEW_NOT_FOUND", 404)

def review_summary(source, review):
    return {key: deepcopy(review[key]) for key in
        ("id", "name", "type", "version", "createdAt", "actor", "counts", "previousReviewId", "sha256")} | {
        "sourceId": source["id"], "sourceSha256": source["sha256"]}

def listing(context):
    return {"schema": SCHEMA, "caseId": context["program"]["id"], "version": context["program"]["version"],
        "items": sorted((review_summary(source, review) for source, _, review in _review_rows(context)),
                         key=lambda item: (item["version"], item["id"]), reverse=True)}

def read(ops, context, review_id):
    source, association, review = _selected_review(context, review_id)
    native = _retained_native(ops, context, source)
    choices = {row["rowId"]: row for row in review["rows"]}
    rows = []
    for row in native["report"]["rows"]:
        selected = choices.get(row["rowId"])
        rows.append({**deepcopy(row), **({key: deepcopy(selected.get(key)) for key in
            ("decision", "reason", "cashId", "cash", "cashSnapshot", "deploymentIds", "workIds")} if selected else {
                "decision": "UNSELECTED", "reason": "", "cashId": None, "cash": None,
                "cashSnapshot": None, "deploymentIds": [], "workIds": []})})
    ids = {row["cashId"] for row in review["rows"] if row.get("cashId")}
    return {"schema": SCHEMA, "caseId": context["program"]["id"], "version": context["program"]["version"],
        "review": deepcopy(review), "source": deepcopy(native["report"]["source"]),
        "reader": deepcopy(native["report"]["reader"]), "rows": rows,
        "currentCash": [deepcopy(row) for row in context["records"]["cash"] if row["id"] in ids],
        "history": [review_summary(source, value) for value in association["reviews"]],
        "downloadSourceId": source["id"], "inspectionSourceId": association["inspectionSourceId"],
        "nativeReportSourceId": association["reportSourceId"],
        "latestReviewId": association["reviews"][-1]["id"]}

def _correction(ops, context, data):
    fields(data, CORRECTION_INPUT, "settlement correction")
    source, association, review = _selected_review(context, data.get("reviewId"))
    if association["reviews"][-1]["id"] != review["id"]:
        fail("Open this source's latest retained review before correcting it.", "SETTLEMENT_REVIEW_CHANGED", 409)
    native = _retained_native(ops, context, source)
    native_rows = {row["rowId"]: row for row in native["report"]["rows"]}
    native_row = native_rows.get(data.get("rowId"))
    old = next((row for row in review["rows"] if row["rowId"] == data.get("rowId")), None)
    if not native_row or not old:
        fail("Choose a row already received in this original review.", "SETTLEMENT_ROW_NOT_FOUND", 404)
    if "expectedCashId" not in data or data["expectedCashId"] != old.get("cashId"):
        fail("The reviewed original cash identity changed.", "SETTLEMENT_CASH_CHANGED", 409)
    selected = {"reviewId": review["id"], "rowId": old["rowId"], "expectedCashId": old.get("cashId"),
        "decision": domain.enum(data.get("decision"), ("CORRECT_CASH", "VOID_CASH", "LINK_CASH", "RELINK"), "Correction decision"),
        "reason": text(data.get("reason"), "Correction reason", 4000, True),
        "cash": deepcopy(data.get("cash")), "deploymentIds": deepcopy(data.get("deploymentIds", old["deploymentIds"])),
        "workIds": deepcopy(data.get("workIds", old["workIds"]))}
    if selected["decision"] == "LINK_CASH":
        selected["cashId"] = deepcopy(data.get("cashId"))
    elif data.get("cashId") is not None:
        fail("Only LINK_CASH correction selects an existing cash identity.")
    effect = _effect(native_row, selected["decision"], cash_id=old.get("cashId"))
    cash = _cash_map(context).get(old.get("cashId"))
    try:
        dids, wids = _attribution(context, selected)
        selected["deploymentIds"], selected["workIds"] = dids, wids
        effect.update(deploymentIds=dids, workIds=wids)
        if selected["decision"] == "LINK_CASH":
            if old.get("cashId") and not cash:
                fail("The prior original linked cash is missing.", "SETTLEMENT_CASH_NOT_FOUND", 409)
            selected["cash"], linked = _linked_cash(context, native_row, selected["cashId"], selected["cash"])
            _transfer_links(context, native_row, linked["id"])
            effect.update(cash=linked, cashId=linked["id"], existingCashId=linked["id"],
                          previousCashId=old.get("cashId"))
        elif selected["decision"] == "RELINK":
            if selected["cash"] is not None:
                fail("An attribution correction does not replace the original cash or its valuation.")
            effect["cash"] = deepcopy(cash)
            if old.get("cashId") and not cash:
                fail("The original linked cash is missing.", "SETTLEMENT_CASH_NOT_FOUND", 409)
        else:
            if not cash or cash["state"] != "OBSERVED":
                fail("The original cash is no longer an active observation. Reopen its current state.",
                     "SETTLEMENT_CASH_CHANGED", 409)
            if selected["decision"] == "VOID_CASH":
                if selected["cash"] is not None:
                    fail("A void decision retains the original cash inputs.")
                effect.update(cash={**deepcopy(cash), "state": "VOID"}, voidedCashId=cash["id"])
            else:
                staged = deepcopy(context)
                staged["records"]["cash"] = [{**row, "state": "VOID"} if row["id"] == cash["id"] else row
                                              for row in staged["records"]["cash"]]
                _transfer_links(staged, native_row)
                if _native_matches(staged, native_row):
                    fail("Another active cash already records this native transfer.",
                         "SETTLEMENT_TRANSFER_ALREADY_RECORDED", 409)
                selected["cash"], prepared = _cash_inputs(staged, native_row, selected["cash"])
                effect.update(cash=prepared, cashId=None, replacedCashId=cash["id"], voidedCashId=cash["id"])
    except Problem as exc:
        effect.update(blocked=True, findings=[_problem_finding(exc)])
    proposed = {"selection": selected, "effects": [effect], "canApply": not effect.get("blocked", False),
        "counts": {"selected": 1, "blocked": int(bool(effect.get("blocked")))}}
    return source, native, review, old, proposed

def correction_preview(ops, context, body):
    fields(body, ("expectedVersion", *CORRECTION_INPUT), "settlement correction preview")
    _version(context, body.get("expectedVersion"))
    data = {key: value for key, value in body.items() if key != "expectedVersion"}
    source, native, review, old, proposed = _correction(ops, context, data)
    basis = _preview_basis(context, native, {"correction": proposed["selection"]}, proposed["effects"])
    return {"schema": SCHEMA, "caseId": context["program"]["id"], "version": context["program"]["version"],
        "source": deepcopy(native["report"]["source"]), "review": deepcopy(review),
        "row": {**deepcopy(next(row for row in native["report"]["rows"] if row["rowId"] == old["rowId"])), **deepcopy(old)},
        "proposed": proposed, "previewSha256": digest(basis)}

def correct(ops, context, data, actor, version, request_id, note):
    fields(data, (*CORRECTION_INPUT, "expectedPreviewSha256"), "settlement correction command")
    requested = {key: value for key, value in data.items() if key != "expectedPreviewSha256"}
    original, native, previous, old, proposed = _correction(ops, context, requested)
    basis = _preview_basis(context, native, {"correction": proposed["selection"]}, proposed["effects"])
    if digest(basis) != domain.sha(data.get("expectedPreviewSha256"), "Reviewed correction", False):
        fail("The native correction or current case differs from its reviewed selection.", "SETTLEMENT_PREVIEW_CONFLICT", 409)
    if not proposed["canApply"]:
        fail("Resolve the native correction findings first.", "SETTLEMENT_REVIEW_REQUIRED")
    chosen = proposed["selection"]
    if chosen["decision"] == "CORRECT_CASH" and sum(len(value) for value in context["records"].values()) >= MAX_ROWS:
        fail("This case has reached its original record bound.", "SETTLEMENT_RECORD_LIMIT", 413)
    before_source = deepcopy(original)
    native_row = next(row for row in native["report"]["rows"] if row["rowId"] == old["rowId"])
    cash = _cash_map(context).get(old.get("cashId"))
    changes = []
    if chosen["decision"] in ("CORRECT_CASH", "VOID_CASH"):
        voided = _void_cash(ops, context, cash, actor, chosen["reason"], version)
        changes.append({"before": deepcopy(cash), "after": deepcopy(voided)})
        cash = voided
    if chosen["decision"] == "CORRECT_CASH":
        association = original["settlementHandoff"]
        cash = _new_cash(ops, context, native_row, chosen["cash"],
            [original["id"], association["inspectionSourceId"], association["reportSourceId"]], actor, version)
        changes.append({"before": None, "after": deepcopy(cash)})
    elif chosen["decision"] == "LINK_CASH":
        cash = _cash_map(context)[chosen["cashId"]]
    selected = {**deepcopy(old), "decision": chosen["decision"], "reason": chosen["reason"],
                "deploymentIds": chosen["deploymentIds"], "workIds": chosen["workIds"],
                "cash": chosen["cash"] if chosen["decision"] in ("CORRECT_CASH", "LINK_CASH") else deepcopy(old["cash"])}
    link = _link_row(native_row, selected, cash)
    rows = [link if row["rowId"] == old["rowId"] else deepcopy(row) for row in previous["rows"]]
    return _finish(ops, context, original, native, before_source, rows, changes, basis,
        previous["name"], actor, version, request_id, note, "CORRECTION", [old["rowId"]], chosen)

def observations(context):
    current_cash = _cash_map(context)
    result = []
    for source in context["sources"].values():
        association = _association(source)
        if not association or not association.get("reviews"):
            continue
        review = association["reviews"][-1]
        result.append({"sourceId": source["id"], "sourceSha256": source["sha256"],
            "originalFilename": association["originalFilename"], "source": deepcopy(association["source"]),
            "reader": deepcopy(association["reader"]), "counts": deepcopy(association["counts"]),
            "inspectionSourceId": association["inspectionSourceId"], "nativeReportSourceId": association["reportSourceId"],
            "review": review_summary(source, review),
            "history": [review_summary(source, value) for value in association["reviews"]],
            "rows": [{**deepcopy(row), "currentCash": deepcopy(current_cash.get(row.get("cashId")))} for row in review["rows"]]})
    return sorted(result, key=lambda row: row["sourceId"])

def csv_rows(context):
    result = []
    for source in observations(context):
        for row in source["rows"]:
            t, current = row.get("transfer") or {}, row.get("currentCash") or {}
            unit = row.get("cash") or {}
            result.append({"reviewId": source["review"]["id"], "reviewVersion": source["review"]["version"],
                "sourceId": source["sourceId"], "sourceSha256": source["sourceSha256"],
                "rowId": row["rowId"], "eventId": row["eventId"], "kind": row["kind"], "decision": row["decision"],
                "cashId": row["cashId"], "cashState": current.get("state"), "network": t.get("network"),
                "asset": t.get("asset"), "amountAtomic": t.get("amountAtomic"), "currency": unit.get("currency"),
                "decimals": unit.get("decimals"), "amount": current.get("amount"), "usdValue": current.get("usdValue"),
                "date": current.get("date"), "deploymentIds": canonical(row["deploymentIds"]),
                "workIds": canonical(row["workIds"]), "reason": row["reason"],
                "sourceIssues": source["reader"].get("issue") or ""})
    return result

def report(context):
    sources = observations(context)
    if not sources:
        return None
    cash = _cash_map(context)
    ids = sorted({row["cashId"] for source in sources for row in source["rows"] if row.get("cashId")})
    return {"sourceEditions": len(sources), "reviewEditions": sum(len(source["history"]) for source in sources),
        "receivedSourceRows": sum(len(source["rows"]) for source in sources), "cashIds": ids,
        "activeCashIds": [ident for ident in ids if cash.get(ident, {}).get("state") == "OBSERVED"],
        "voidCashIds": [ident for ident in ids if cash.get(ident, {}).get("state") == "VOID"],
        "testnetCashIds": [ident for ident in ids if "testnet" in cash.get(ident, {}).get("network", "").lower()],
        "unvaluedCashIds": [ident for ident in ids if cash.get(ident, {}).get("state") == "OBSERVED" and cash[ident].get("usdValue") is None],
        "sources": sources,
        "basis": "Original merchant transfer sources with explicit unit, valuation and attribution decisions. Cash remains in the original cash ledger. Testnet, returned book assignments and merchant quotations do not create real grant receipts or recognized revenue."}

def _zip(files, schema):
    if sum(len(raw) for raw in files.values()) > 32 * 1024 * 1024:
        fail("The complete selected settlement handover exceeds 32 MiB.", "SETTLEMENT_EXPORT_SIZE", 413)
    manifest = {"schema": schema, "files": [{"path": path, "bytes": len(raw),
                "sha256": hashlib.sha256(raw).hexdigest()} for path, raw in sorted(files.items())]}
    payload = dict(files, **{"MANIFEST.json": (canonical(manifest) + "\n").encode()})
    target = io.BytesIO()
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path, raw in sorted(payload.items()):
            info = zipfile.ZipInfo(path, (2026, 1, 1, 0, 0, 0))
            info.external_attr = 0o600 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, raw)
    return target.getvalue()

def export_review(ops, context, review_id):
    selected = read(ops, context, review_id)
    source, association, review = _selected_review(context, review_id)
    requested = {source["id"], association["inspectionSourceId"], association["reportSourceId"]}
    lineage = []
    for value in association["reviews"]:
        lineage.append(value)
        for row in value["rows"]:
            chosen = row.get("cash") or {}
            requested.update(chosen.get("unitSourceIds", []))
            requested.update(chosen.get("valuationSourceIds", []))
            snapshot = row.get("cashSnapshot") or {}
            requested.update(snapshot.get("sourceIds", []))
            requested.update(snapshot.get("valuationSourceIds", []))
        if value["id"] == review_id:
            break
    files = {"settlement-review.json": (canonical(selected) + "\n").encode(),
        "review-history.json": (canonical(lineage) + "\n").encode(),
        "original-merchant-source.tar": _raw_source(ops, context, source["id"]),
        "native-inspection.json": _raw_source(ops, context, association["inspectionSourceId"]),
        "native-review.html": _raw_source(ops, context, association["reportSourceId"])}
    refs = []
    for ident in sorted(requested):
        metadata = context["sources"].get(ident)
        if not metadata:
            fail("A reviewed original source is absent from this case.", "SETTLEMENT_SOURCE_MISSING", 409)
        files["sources/" + ident] = _raw_source(ops, context, ident)
        refs.append(metadata)
    files["source-references.json"] = (canonical(refs) + "\n").encode()
    table = []
    current = {row["id"]: row for row in selected["currentCash"]}
    for row in selected["rows"]:
        transfer, chosen, cash = row.get("transfer") or {}, row.get("cash") or {}, current.get(row.get("cashId"), {})
        table.append({"reviewId": review_id, "reviewVersion": review["version"], "sourceId": source["id"],
            "sourceSha256": source["sha256"], "rowId": row["rowId"], "eventId": row["eventId"], "kind": row["kind"],
            "decision": row["decision"], "cashId": row["cashId"], "cashState": cash.get("state"),
            "network": transfer.get("network") or row.get("original", {}).get("network"), "asset": transfer.get("asset"),
            "amountAtomic": transfer.get("amountAtomic") or row.get("original", {}).get("amountAtomic"),
            "currency": chosen.get("currency"), "decimals": chosen.get("decimals"), "amount": cash.get("amount"),
            "usdValue": cash.get("usdValue"), "date": cash.get("date"), "deploymentIds": canonical(row["deploymentIds"]),
            "workIds": canonical(row["workIds"]), "reason": row["reason"], "sourceIssues": "; ".join(row["issues"])})
    files["selected-rows.csv"] = csv_bytes(CSV_FIELDS, table)
    cells = "".join("<tr>" + "".join("<td>" + html.escape(str(row.get(key) or "")) + "</td>"
        for key in ("kind", "eventId", "decision", "cashId", "amount", "currency", "usdValue", "reason")) + "</tr>" for row in table)
    files["settlement-review.html"] = ('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
        '<title>Merchant settlement review</title><style>body{font:14px/1.5 system-ui;color:#222;background:#fafafa;padding:24px}'
        'table{border-collapse:collapse;background:#fff}td,th{padding:8px;border:1px solid #bbb;vertical-align:top;overflow-wrap:anywhere}'
        '.scroll{overflow:auto}code{overflow-wrap:anywhere}</style><h1>' + html.escape(review["name"]) +
        '</h1><p>Retained review <code>' + html.escape(review_id) + '</code>; original source <code>' + source["sha256"] +
        '</code>.</p><p>This selected source and review bundle preserves original bytes, decisions and cash history. '
        'Use the complete Grant Operations case export for continued editing, reopening and restore.</p><div class="scroll"><table>'
        '<thead><tr><th>Kind</th><th>Event</th><th>Decision</th><th>Cash</th><th>Quantity</th><th>Unit</th><th>USD</th><th>Reason</th></tr></thead>'
        '<tbody>' + cells + '</tbody></table></div></html>').encode()
    files["README.txt"] = ("Original merchant settlement source and selected review\n\n"
        "The source TAR, native inspection, frozen review/history, exact unit and valuation attachments, and selected-row CSV are complete.\n"
        "Current cash states are shown separately from original reviewed snapshots. Testnet stays excluded by the original cash report.\n"
        "This selected source/review ZIP is not the editable case backup. Export the complete Grant Operations case and use its original import to continue.\n").encode()
    return _zip(files, SCHEMA + ".selected-review")


def validate_import(context, events, frozen_reviews, files):
    """Validate source associations through the original reader and event chain.

    Every cash value remains an original native cash row. Imported metadata
    cannot make a report-only row eligible or detach a cash correction from its
    original before/after transaction.
    """
    inspected = {}
    sources = context["sources"]
    reviews_by_id = {}
    sources_with_reviews = {}
    attribution_contexts = {}

    def invalid(message):
        fail(message, "SETTLEMENT_IMPORT_SOURCE", 422)

    def cash_shape(value, label):
        if not isinstance(value, dict) or value.get("state") not in ("OBSERVED", "VOID"):
            invalid(label + " needs its original cash body.")
        staging = deepcopy(context)
        staging["restoring"] = True
        staging["records"]["cash"] = [value]
        try:
            with localcontext() as precision:
                precision.prec = 96
                normalized = domain.prepare("cash", value, staging, value)
        except Problem:
            raise
        for key, field in normalized.items():
            if key != "state" and value.get(key) != field:
                invalid(label + " differs from its original normalized cash fields.")


    def attribution_context(version):
        """Reopen the deployment role when this row's attribution was selected."""
        if version in attribution_contexts:
            return attribution_contexts[version]
        deployments = {row["id"]: row for row in context["records"]["deployments"]}
        for event in reversed(events):
            if event["version"] <= version:
                break
            if event.get("kind") != "deployments":
                continue
            before, after = event.get("before"), event.get("after")
            if not isinstance(after, dict) or deployments.get(after.get("id")) != after:
                invalid("The original deployment transition lost its retained after body.")
            ident = after["id"]
            if before is None:
                deployments.pop(ident)
            elif (not isinstance(before, dict) or before.get("id") != ident
                    or before.get("version", event["version"]) >= event["version"]):
                invalid("The original deployment transition lost its retained preimage.")
            else:
                deployments[ident] = before
        if any(row.get("version", version + 1) > version for row in deployments.values()):
            invalid("The original deployment attribution cannot be restored at its selected version.")
        restored = {**context, "restoring": True,
                    "records": {**context["records"], "deployments": list(deployments.values())}}
        attribution_contexts[version] = restored
        return restored

    def statement_cash(event, first_preimages):
        """Recover statement-created observations from their original native bodies."""
        after = event.get("after")
        if event.get("kind") != "statement" or not isinstance(after, dict):
            invalid("The original statement cash creation has no retained receiving event.")
        event_actor = text(event.get("actor"), "Original statement recording operator", 300, True)
        source_id, review_id = after.get("sourceId"), after.get("reviewSourceId")
        source, review_source = sources.get(source_id), sources.get(review_id)
        marker = source.get("statement", {}) if isinstance(source, dict) else {}
        review_marker = review_source.get("statement", {}) if isinstance(review_source, dict) else {}
        if (not source or not review_source or marker.get("schema") != statement_sources.SCHEMA
                or marker.get("role") != "CSV" or marker.get("reviewSourceId") != review_id
                or review_marker.get("schema") != statement_sources.SCHEMA
                or review_marker.get("role") != "REVIEW" or review_marker.get("csvSourceId") != source_id
                or event.get("recordId") != source_id or event.get("before") is not None):
            invalid("The original statement cash creation differs from its source association.")
        raw = files.get("sources/" + review_id)
        if (not isinstance(raw, bytes) or len(raw) != review_source["bytes"]
                or hashlib.sha256(raw).hexdigest() != review_source["sha256"]):
            invalid("The original statement cash review is missing or changed.")
        try:
            review = json.loads(raw)
        except (ValueError, UnicodeError) as exc:
            raise Problem("The original statement cash review cannot be read.",
                          422, "SETTLEMENT_IMPORT_SOURCE") from exc
        preview = review.get("preview", {}) if isinstance(review, dict) else {}
        if (not isinstance(review, dict) or review.get("schema") != statement_sources.SCHEMA + ".review"
                or review.get("sourceId") != source_id or review.get("sourceSha256") != source["sha256"]
                or review.get("caseVersion") != event["version"] or review.get("recordedBy") != event_actor
                or review.get("cashRows") != after.get("cashRows")
                or review.get("editionSha256") != after.get("editionSha256")
                or not isinstance(preview, dict) or preview.get("previewSha256") != after.get("previewSha256")):
            invalid("The statement cash rows differ from their original receiving decision.")
        rows = {row["rowNumber"]: row for row in preview.get("rows", [])}
        current_cash = _cash_map(context)
        staged = {**context, "restoring": True, "records": {**context["records"], "cash": []}}
        result = []
        for selection in review["cashRows"]:
            ident = selection["cashId"]
            original = rows.get(selection["rowNumber"])
            observation = first_preimages.get(ident, current_cash.get(ident))
            if (not original or original.get("status") != "NEW" or not isinstance(observation, dict)
                    or observation.get("id") != ident or observation.get("state") != "OBSERVED"
                    or observation.get("version") != event["version"]
                    or observation.get("recordedBy") != event_actor):
                invalid("A statement creation needs its original observed cash body at the receiving version.")
            native = {**original["record"], "sourceIds": [source_id, review_id],
                      "valuationSourceIds": [source_id] if original["currency"] != "USD"
                      and original["usdValue"] is not None else []}
            native.pop("id", None)
            prepared = domain.prepare("cash", native, staged)
            domain.timestamp(observation.get("createdAt"), "Original statement cash creation")
            domain.timestamp(observation.get("updatedAt"), "Original statement cash observation")
            expected = {**prepared, "id": ident, "version": event["version"],
                        "createdAt": observation["createdAt"], "updatedAt": observation["updatedAt"],
                        "recordedBy": event_actor}
            if observation != expected:
                invalid("The original statement cash body differs from its native reviewed creation.")
            result.append(deepcopy(observation))
        return result

    def inspect_source(source):
        association = _association(source)
        if not association:
            return None
        if source["id"] in inspected:
            return inspected[source["id"]]
        raw = files.get("sources/" + source["id"])
        if not isinstance(raw, bytes) or hashlib.sha256(raw).hexdigest() != source["sha256"] or len(raw) != source["bytes"]:
            invalid("The original merchant archive is missing or changed.")
        native = inspect(raw, association.get("originalFilename"))
        encoded = (canonical(native) + "\n").encode()
        report_raw = native["html"].encode()
        expected = (("inspectionSourceId", "inspectionSha256", encoded),
                    ("reportSourceId", "reportSha256", report_raw))
        for key, hash_key, content in expected:
            metadata = sources.get(association.get(key))
            selected = files.get("sources/" + str(association.get(key)))
            if (not metadata or selected != content or metadata["bytes"] != len(content)
                    or metadata["sha256"] != hashlib.sha256(content).hexdigest()
                    or association.get(hash_key) != metadata["sha256"]):
                invalid("The original merchant inspection and HTML must match its retained reader.")
        if (association.get("sourceSha256") != source["sha256"]
                or association.get("source") != native["report"]["source"]
                or association.get("reader") != native["report"]["reader"]
                or association.get("counts") != native["report"]["counts"]):
            invalid("The retained merchant source or transfer eligibility changed.")
        inspected[source["id"]] = native
        return native

    try:
        for source in sources.values():
            if "settlementHandoff" not in source:
                continue
            association = _association(source)
            if not association:
                invalid("The settlement association schema is invalid.")
            native = inspect_source(source)
            originals = {row["rowId"]: row for row in native["report"]["rows"]}
            retained = association.get("reviews")
            if not isinstance(retained, list) or not 1 <= len(retained) <= MAX_REVIEWS:
                invalid("Retain the complete merchant review history.")
            previous = None
            attribution_versions = {}
            for review in retained:
                if (not isinstance(review, dict) or review.get("schema") != SCHEMA + ".review"
                        or not isinstance(review.get("id"), str) or not re.fullmatch(r"settlement-[a-f0-9]{32}", review["id"])
                        or review["id"] in reviews_by_id
                        or review.get("sourceId") != source["id"] or review.get("sourceSha256") != source["sha256"]
                        or review.get("inspectionSourceId") != association["inspectionSourceId"]
                        or review.get("previousReviewId") != (previous["id"] if previous else None)
                        or digest({key: value for key, value in review.items() if key != "sha256"}) != review.get("sha256")):
                    invalid("The original settlement review identity or lineage is incomplete.")
                version = domain.integer(review.get("version"), "Original settlement review version", 2, context["program"]["version"])
                if previous and version <= previous["version"]:
                    invalid("Original settlement review versions must advance.")
                domain.timestamp(review.get("createdAt"), "Original settlement review time")
                text(review.get("actor"), "Original settlement reviewer", 300, True)
                text(review.get("name"), "Original settlement review name", 300, True)
                text(review.get("note", ""), "Original settlement command note", 12000)
                if review.get("type") not in ("RECEIVE", "CORRECTION"):
                    invalid("The settlement review uses an unknown operation.")
                basis = review.get("preview")
                if (not isinstance(basis, dict) or basis.get("schema") != SCHEMA + ".preview"
                        or basis.get("version") != version - 1 or basis.get("sourceSha256") != source["sha256"]
                        or basis.get("inspectionSha256") != association["inspectionSha256"]
                        or digest(basis) != review.get("previewSha256")):
                    invalid("The original reviewed source and chosen effects are not bound.")
                domain.sha(basis.get("contextSha256"), "Original reviewed case snapshot", False)
                choice_key = "selections" if review["type"] == "RECEIVE" else "correction"
                selected_basis = basis.get("selection", {})
                if (selected_basis.get(choice_key) != review.get("selectionInputs")
                        or review["type"] == "RECEIVE" and selected_basis.get("name") != review["name"]):
                    invalid("The retained original selection differs from its reviewed inputs.")
                rows = review.get("rows")
                if not isinstance(rows, list) or len(rows) > len(originals):
                    invalid("Retain the selected original source rows.")
                row_map = {}
                for row in rows:
                    if not isinstance(row, dict) or row.get("rowId") not in originals or row["rowId"] in row_map:
                        invalid("Each original merchant source row may occur once in a review.")
                    row_map[row["rowId"]] = row
                    original = originals[row["rowId"]]
                    if any(row.get(key) != original.get(key) for key in ("eventId", "kind", "sourceRowSha256", "transfer")):
                        invalid("A retained merchant row differs from the unchanged original reader.")
                    if row.get("transferKey") != (original.get("transfer") or {}).get("transferKey"):
                        invalid("A retained original transfer key changed.")
                    if row.get("decision") not in ("RECORD_CASH", "LINK_CASH", "OBSERVE", "OMIT", "CORRECT_CASH", "VOID_CASH", "RELINK"):
                        invalid("The original row decision is unavailable.")
                    text(row.get("reason"), "Original row decision", 4000, True)
                    if row["rowId"] in review.get("changedRowIds", []):
                        attribution_versions[row["rowId"]] = version - 1
                    attribution_version = attribution_versions.get(row["rowId"])
                    if attribution_version is None:
                        invalid("The original row is missing its selected attribution edition.")
                    restoration = attribution_context(attribution_version)
                    dids, wids = _attribution(restoration, row)
                    if dids != row.get("deploymentIds") or wids != row.get("workIds"):
                        invalid("The original deployment/work selection changed.")
                    if row.get("cashId") is None:
                        if row.get("cash") is not None or row.get("cashSnapshot") is not None or row["decision"] not in ("OBSERVE", "OMIT", "RELINK"):
                            invalid("An observation-only row must retain no cash.")
                        continue
                    if not original.get("canRecordCash") or not original.get("transfer"):
                        invalid("An observation-only original source cannot become cash during import.")
                    cash = row.get("cashSnapshot")
                    if not isinstance(cash, dict) or cash.get("id") != row["cashId"]:
                        invalid("Retain the original selected cash snapshot.")
                    cash_shape(cash, "The selected settlement cash")
                    unit_fields = {key: row.get("cash", {}).get(key) for key in UNIT_INPUT}
                    unit, amount = _unit(restoration, original, unit_fields, unit_only=True)
                    if row["decision"] == "LINK_CASH":
                        fields(row["cash"], UNIT_INPUT, "retained existing-cash unit selection")
                        if row["cash"] != unit or cash["state"] != "OBSERVED":
                            invalid("The retained link must preserve its reviewed unit and original active cash snapshot.")
                    transfer = original["transfer"]
                    if (cash["network"] != transfer["network"] or cash["asset"] != transfer["asset"]
                            or cash["direction"] != transfer["direction"] or cash["amount"] != amount
                            or cash["currency"] != unit["currency"]
                            or cash["externalRef"] not in (transfer["externalRef"], transfer["transaction"])):
                        invalid("The imported cash differs from the original native transfer and reviewed asset unit.")
                    if row["decision"] == "VOID_CASH" and cash["state"] != "VOID":
                        invalid("A voided settlement row must retain the original void result.")
                    if row["decision"] in ("RECORD_CASH", "CORRECT_CASH"):
                        staged = deepcopy(restoration)
                        staged["records"]["cash"] = []
                        inputs, expected_cash = _cash_inputs(staged, original, row["cash"])
                        if inputs != row["cash"]:
                            invalid("The original exact unit or valuation selection changed.")
                        financial = ("direction", "category", "date", "currency", "network", "asset", "amount", "usdValue",
                                     "valuationSourceIds", "valuationNote", "externalRef", "referenceKey", "tranche", "allocations")
                        if any(cash.get(key) != expected_cash.get(key) for key in financial):
                            invalid("The recorded cash differs from its complete reviewed native effects.")
                        if not {source["id"], association["inspectionSourceId"], association["reportSourceId"]}.issubset(cash["sourceIds"]):
                            invalid("Recorded settlement cash must retain its original source and native inspection.")
                if review.get("counts") != _review_counts(rows, len(originals)):
                    invalid("Settlement review counts differ from its complete selected rows.")
                changed = review.get("changedRowIds")
                if (not isinstance(changed, list) or changed != sorted(set(changed))
                        or any(key not in row_map for key in changed)
                        or review["type"] == "CORRECTION" and len(changed) != 1):
                    invalid("The settlement review's changed-row selection is incomplete.")
                previous_rows = {row["rowId"]: row for row in previous["rows"]} if previous else {}
                if any(row_map.get(key) != value for key, value in previous_rows.items() if key not in changed):
                    invalid("A later settlement review changed an unselected original row.")
                if any(key not in changed for key in set(row_map) - set(previous_rows)):
                    invalid("A new settlement row lacks its original receiving decision.")
                if not isinstance(review.get("cashChanges"), list) or len(review["cashChanges"]) > len(changed) * 2:
                    invalid("The settlement cash effects are incomplete or excessive.")
                if review["type"] == "CORRECTION" and review["selectionInputs"].get("decision") == "LINK_CASH":
                    choice = review["selectionInputs"]
                    fields(choice, CORRECTION_INPUT, "retained cash-link correction")
                    prior = previous_rows.get(choice.get("rowId"))
                    linked = row_map.get(choice.get("rowId"))
                    if (not previous or not prior or not linked or choice.get("reviewId") != previous["id"]
                            or "expectedCashId" not in choice or choice["expectedCashId"] != prior.get("cashId")
                            or changed != [choice["rowId"]] or review["cashChanges"]
                            or linked["cashId"] != choice.get("cashId") or linked["decision"] != "LINK_CASH"
                            or any(linked.get(key) != choice.get(key) for key in
                                   ("cash", "reason", "deploymentIds", "workIds"))):
                        invalid("The original cash-link correction must retain its prior source link and unchanged selected cash.")
                event = events[version - 1]
                command = "settlement.receive" if review["type"] == "RECEIVE" else "settlement.correct"
                if (event.get("action") != command or event.get("recordId") != review["id"]
                        or event.get("requestId") != review.get("requestId")
                        or text(event.get("actor"), "Original settlement recording operator", 300, True) != review["actor"]
                        or event.get("after", {}).get("review") != review
                        or event.get("after", {}).get("cash") != [change.get("after") for change in review["cashChanges"]]
                        or event.get("before", {}).get("cash") != [change.get("before") for change in review["cashChanges"]]):
                    invalid("The settlement review does not join its original atomic command.")
                change = event.get("sourceChange")
                after = change.get("after") if isinstance(change, dict) else None
                if (not isinstance(after, dict) or after.get("id") != source["id"]
                        or after.get("sha256") != source["sha256"]
                        or after.get("settlementHandoff", {}).get("reviews") != retained[:len(sources_with_reviews.get(source["id"], [])) + 1]):
                    invalid("The original source association does not join its full review edition.")
                sources_with_reviews.setdefault(source["id"], []).append(review)
                reviews_by_id[review["id"]] = (source, review)
                previous = review
            if events[retained[-1]["version"] - 1].get("sourceChange", {}).get("after") != source:
                invalid("The current merchant association differs from its last original receiving event.")
        if len(reviews_by_id) > MAX_REVIEWS:
            invalid("The retained settlement history exceeds the supported bound.")
        if {event.get("recordId") for event in events if event.get("action") in ("settlement.receive", "settlement.correct")} != set(reviews_by_id):
            invalid("The original operations history is missing a retained settlement review.")

        # A statement creation records row identities in its compound event.
        # Its unchanged observation or first native void preimage retains the
        # complete creation body, including the original timestamps and actor.
        first_preimages = {}
        for event in events:
            if event.get("kind") == "cash" and isinstance(event.get("before"), dict):
                before = event["before"]
                first_preimages.setdefault(before["id"], before)
            if event.get("action") in ("settlement.receive", "settlement.correct"):
                _, review = reviews_by_id[event["recordId"]]
                for change in review["cashChanges"]:
                    before = change.get("before")
                    if isinstance(before, dict):
                        first_preimages.setdefault(before["id"], before)

        # Reconstruct ordinary, statement-created and settlement cash at their
        # original event versions before validating each selected snapshot.
        cash_history = {}
        for event in events:
            if event.get("action") == "statement.receive":
                for observation in statement_cash(event, first_preimages):
                    if observation["id"] in cash_history:
                        invalid("The statement cash history repeats a created identity.")
                    cash_history[observation["id"]] = observation
            if event.get("kind") == "cash" and isinstance(event.get("after"), dict):
                before, after = event.get("before"), event["after"]
                if before is not None and cash_history.get(before["id"]) != before:
                    invalid("The original cash transition lost its retained preimage.")
                if before is None and after["id"] in cash_history:
                    invalid("The original cash history repeats a created identity.")
                cash_history[after["id"]] = deepcopy(after)
            if event.get("action") not in ("settlement.receive", "settlement.correct"):
                continue
            source, review = reviews_by_id[event["recordId"]]
            for change in review["cashChanges"]:
                before, after = change.get("before"), change.get("after")
                cash_shape(after, "A retained settlement cash effect")
                if before is None:
                    if after["id"] in cash_history or after.get("state") != "OBSERVED":
                        invalid("A settlement creation must use one new original cash identity.")
                else:
                    if (cash_history.get(before.get("id")) != before or after["id"] != before["id"]
                            or before.get("state") != "OBSERVED" or after.get("state") != "VOID"
                            or any(after.get(key) != value for key, value in before.items()
                                   if key not in ("state", "version", "updatedAt", "reviewedBy", "reviewNote"))):
                        invalid("The original cash void changed its immutable observation.")
                if after["version"] != review["version"]:
                    invalid("A settlement cash effect differs from its atomic review version.")
                cash_history[after["id"]] = deepcopy(after)
            for row in review["rows"]:
                if row["rowId"] in review["changedRowIds"] and row.get("cashId"):
                    if cash_history.get(row["cashId"]) != row["cashSnapshot"]:
                        invalid("The original selected cash snapshot differs from the same-version cash journal.")
        used_cash = {row["cashId"] for _, _, review in _review_rows(context) for row in review["rows"] if row.get("cashId")}
        final_cash = _cash_map(context)
        if any(cash_history.get(ident) != final_cash.get(ident) for ident in used_cash):
            invalid("The current settlement cash differs from its retained native history.")

        # The original whole-case reviews retain source metadata at their own
        # point in history; current source updates must not rewrite those copies.
        for review in frozen_reviews:
            snapshot = review.get("snapshot", {})
            if not isinstance(snapshot, dict) or not isinstance(snapshot.get("sources"), list):
                continue
            for source in snapshot["sources"]:
                association = _association(source) if isinstance(source, dict) else None
                if not association:
                    continue
                current = sources.get(source["id"])
                if not current or current["sha256"] != source["sha256"]:
                    invalid("A frozen business review lost its original merchant source.")
                historical = association.get("reviews")
                if not isinstance(historical, list) or not historical:
                    invalid("A frozen merchant source is missing its original reviews.")
                current_history = current["settlementHandoff"]["reviews"]
                if historical != current_history[:len(historical)]:
                    invalid("A frozen merchant review differs from its original immutable history.")
                last = historical[-1]
                if events[last["version"] - 1].get("sourceChange", {}).get("after") != source:
                    invalid("A frozen source association differs from its original receiving edition.")

        for frozen in frozen_reviews:
            snapshot = frozen.get("snapshot", {})
            if isinstance(snapshot, dict) and isinstance(snapshot.get("sources"), list) and isinstance(snapshot.get("records"), dict):
                selected_context = {"sources": {item["id"]: item for item in snapshot["sources"]},
                                    "records": snapshot["records"]}
                expected_report = report(selected_context)
                actual_report = frozen.get("report", {}).get("merchantSettlements")
                if actual_report != expected_report:
                    invalid("A frozen business review changed its original merchant settlement report.")

        # Same transfer may appear in multiple original source editions. Every
        # active association must still point to one cash row and exact units.
        transfers, cash_keys = {}, {}
        live = _cash_map(context)
        for _, row in _latest_rows(context):
            ident, key = row.get("cashId"), row.get("transferKey")
            if not ident or live.get(ident, {}).get("state") == "VOID":
                continue
            if key in transfers and transfers[key] != ident or ident in cash_keys and cash_keys[ident] != key:
                invalid("The original native transfer has divergent active cash associations.")
            transfers[key], cash_keys[ident] = ident, key
        return bool(reviews_by_id)
    except Problem:
        raise
    except (KeyError, TypeError, ValueError, AttributeError, IndexError) as exc:
        raise Problem("The complete merchant settlement source/history is invalid.",
                      422, "SETTLEMENT_IMPORT_SOURCE") from exc
