"""Expense coding and period views over original native statement rows."""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from uuid import uuid4
from native import COLUMNS, utc_day

SCHEMA = "stellar-forge.buyer-expense-workspace.v1"
INTEGER = re.compile(r"(?:0|[1-9][0-9]{0,99})")


class Problem(ValueError):
    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code, self.status = code, status


def now():
    return datetime.now(timezone.utc).isoformat()


def canonical(value):
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"))


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def identifier(prefix):
    return prefix + "-" + str(uuid4())


def text(value, label, *, maximum=1000, optional=False):
    if not isinstance(value, str):
        raise Problem("INVALID_TEXT", label + " must be text")
    value = value.strip()
    if (not value and not optional) or len(value) > maximum or any(ord(c) < 32 and c not in "\n\t" for c in value):
        raise Problem("INVALID_TEXT", label + " is empty, too long, or contains control characters")
    return value


def day(value):
    try:
        return utc_day(value)
    except (ValueError, TypeError) as exc:
        raise Problem("INVALID_DATE", "Use a complete calendar date in YYYY-MM-DD form") from exc


def amount(value):
    if not isinstance(value, str) or INTEGER.fullmatch(value) is None:
        raise Problem("INVALID_AMOUNT", "Enter an exact nonnegative base-unit integer as text")
    return int(value)


def row_key(source_id, request_id):
    return digest([source_id, request_id])


def basis(row, missing=False):
    value = {"row": {key: row[key] for key in COLUMNS}, "missing": bool(missing)}
    if row.get("native_context_sha256"):
        value["native_context_sha256"] = row["native_context_sha256"]
    return digest(value)


def native_changes(previous, current):
    before = {r["request_id"]: r for r in (previous or {}).get("rows", [])}
    after = {r["request_id"]: r for r in current["rows"]}
    changes = []
    for request_id in sorted(before.keys() | after.keys()):
        a, b = before.get(request_id), after.get(request_id)
        if a is None:
            changes.append({"request_id": request_id, "kind": "ADDED", "before": None, "after": b})
        elif b is None:
            changes.append({"request_id": request_id, "kind": "ABSENT", "before": a, "after": None})
        elif any(a.get(k) != b.get(k) for k in (*COLUMNS, "native_context_sha256")):
            changes.append({"request_id": request_id, "kind": "CHANGED", "before": a, "after": b,
                            "fields": [k for k in (*COLUMNS, "native_context_sha256") if a.get(k) != b.get(k)]})
    return changes


def validate_coding(item, payload, centers):
    row = item["row"]
    if item["missing"] or row["state"] != "settled":
        raise Problem("NATIVE_SETTLEMENT_REQUIRED", "Code a present, settled native row; review other rows as period exceptions")
    if payload.get("basis") != item["basis"]:
        raise Problem("ROW_CHANGED", "The native row changed. Review its current values before saving", 409)
    recognition = day(payload.get("recognition_date"))
    allocations = payload.get("allocations")
    if not isinstance(allocations, list) or not 1 <= len(allocations) <= 100:
        raise Problem("INVALID_ALLOCATIONS", "Add one to 100 allocation lines")
    normalized = []
    total = 0
    for line in allocations:
        if not isinstance(line, dict):
            raise Problem("INVALID_ALLOCATIONS", "Each allocation must be an object")
        center = centers.get(line.get("center_id"))
        if center is None or not center["active"]:
            raise Problem("COST_CENTER_REQUIRED", "Choose an active cost center for each line")
        value = amount(line.get("amount"))
        total += value
        normalized.append({"center_id": center["id"], "amount": str(value),
                           "project": text(line.get("project", ""), "Project", maximum=160, optional=True),
                           "account_code": text(line.get("account_code", ""), "Account code", maximum=120, optional=True),
                           "memo": text(line.get("memo", ""), "Line memo", maximum=1000, optional=True)})
    if total != int(row["settled_base_units"]):
        raise Problem("ALLOCATION_TOTAL", "Allocation lines must equal the native settled actual of " + row["settled_base_units"] + " base units")
    return {"item_id": item["id"], "basis": item["basis"], "recognition_date": recognition,
            "memo": text(payload.get("memo", ""), "Expense memo", maximum=4000, optional=True),
            "operator": text(payload.get("operator"), "Coding owner", maximum=240), "allocations": normalized}


def group_amounts(lines, dimensions=()):
    groups = {}
    for line in lines:
        key = tuple(line[k] for k in ("network", "asset", *dimensions))
        entry = groups.setdefault(key, {k: line[k] for k in ("network", "asset", *dimensions)} | {"amount": 0, "lines": 0})
        entry["amount"] += int(line["amount"])
        entry["lines"] += 1
    return [value | {"amount": str(value["amount"])} for _, value in sorted(groups.items())]


def period_view(period, items, sources, centers, dispositions, closed_transfers=None):
    """Dates are operator recognition dates; native days never become settlement dates."""
    start, through = period["from_day"], period["through_day"]
    source_views = [{k: s.get(k) for k in ("id", "name", "kind", "path", "current_capture", "capture_time", "projection_sha256", "journal_events", "last_sequence", "record_kind", "source_basis", "date_basis")}
                    for s in sources]
    issues, candidates, exposures, native_outcomes = [], [], [], []
    disposition_by_key = {(d["item_id"], d["code"]): d for d in dispositions}
    closed_transfers = sorted(closed_transfers or [], key=lambda v:(v["period_id"], v["close_id"], v["item_id"]))
    previously_issued = {}
    for entry in closed_transfers:
        previously_issued.setdefault(entry["transfer_identity"], []).append(entry)

    def issue(code, item, description, *, group=None, kinds=None):
        item_id = item["id"] if item else ""
        selected = disposition_by_key.get((item_id, code))
        issue_basis = digest({"code": code, "basis": item["basis"] if item else None, "group": group})
        allowed = ["carry_forward", "exclude_from_period"] if kinds is None else kinds
        valid = bool(selected and selected["basis"] == issue_basis and selected["kind"] in allowed)
        result = {"code": code, "item_id": item_id, "request_id": item["row"]["request_id"] if item else None,
                  "source_name": item.get("source_name") if item else None, "description": description,
                  "source_capture": item.get("capture_id") if item else None,
                  "basis": issue_basis, "allowed_kinds": allowed, "resolved": valid,
                  "disposition": selected if valid else None, "group": group}
        issues.append(result)
        return result

    for source in sources:
        if source.get("pending"):
            issue("SOURCE_REVIEW_" + source["id"], None, source["name"] + " has captured source awaiting acceptance or rejection",
                  group={"source_id": source["id"], "captures": source["pending"]}, kinds=[])
        elif not source.get("current_capture"):
            issue("SOURCE_CAPTURE_" + source["id"], None, source["name"] + " has no accepted native capture",
                  group={"source_id": source["id"]}, kinds=[])

    def receipt_key(row):
        ref = row.get("receipt_ref", "")
        matched = re.fullmatch(re.escape(row["network"]) + r"/([0-9a-fA-F]{64})", ref)
        if matched:
            ref = row["network"] + "/" + matched.group(1).lower()
        elif re.fullmatch(r"[0-9a-fA-F]{64}", ref):
            ref = row["network"] + "/" + ref.lower()
        return (row["network"], row["asset"], ref)

    receipt_groups, exact_transfers = {}, {}
    for item in items:
        row = item["row"]
        if row["state"] == "settled" and row.get("receipt_ref") and not item["missing"]:
            key = receipt_key(row)
            receipt_groups.setdefault(key, []).append(item)
            transfer = row.get("native_detail", {}).get("transfer_identity")
            if transfer:
                exact_transfers.setdefault(transfer, []).append(item)

    for item in items:
        row, coding = item["row"], item.get("coding")
        relevant = row["day"] <= through or bool(coding and start <= coding["recognition_date"] <= through)
        if not relevant:
            continue
        detail = row.get("native_detail")
        if isinstance(detail, dict):
            native_outcomes.append({"item_id":item["id"], "request_id":row["request_id"], "source_name":item["source_name"],
                "source_capture":item["capture_id"], "quote_day":row["day"], "native_status":detail["native_status"],
                "payment_classification":detail["classification"], "network":row["network"], "asset":row["asset"],
                "quoted_amount":detail.get("quoted_amount"), "settled_actual":row["settled_base_units"],
                "receipt_ref":row["receipt_ref"], "observation_sha256":detail.get("observation_sha256"),
                "transfer_identity":detail.get("transfer_identity"), "payer":detail.get("payer"),
                "recipient":detail.get("recipient"), "result_file":detail.get("result_file"),
                "result_preview":detail.get("result_preview"), "missing":item["missing"]})
        if row["state"] == "reserved":
            exposures.append({"item_id": item["id"], "request_id": row["request_id"], "source_name": item["source_name"],
                              "network": row["network"], "asset": row["asset"], "amount": row["reserved_base_units"],
                              "native_reservation_day": row["day"], "missing": item["missing"],
                              "source_capture": item["capture_id"], "request_digest": row["request_digest"]})
        if item["missing"]:
            issue("ABSENT_FROM_CURRENT_SOURCE", item, "This original row is absent from the accepted source capture; its previous bytes remain retained")
            continue
        if row["state"] == "reserved":
            issue("UNRESOLVED_RESERVATION", item, "The original maximum remains reserved. Carry it for native finalization; it is not settled expense")
            continue
        if row["state"] == "not_dispatched":
            continue
        if row["state"] == "failed":
            issue("FAILED_NATIVE_PAYMENT", item, "The original saved RPC observation reports this transaction failed. Record its period disposition; the quote amount is not an expense.")
            continue
        if row["state"] == "unresolved":
            issue("NATIVE_PAYMENT_UNRESOLVED", item, "The original buyer retains a signed dispatch without a matched transfer observation. Carry or exclude this quote while its original payment recovery continues; its quoted amount is not a spending reservation.")
            continue
        if row["state"] == "observation_review":
            issue("NATIVE_OBSERVATION_BINDING", item, "The saved original payment observation does not match this quote's retained native binding. Inspect the original buyer observation and refresh its source.", group={"source_id":item["source_id"]}, kinds=[])
            continue
        if coding and coding["recognition_date"] < start:
            if coding["basis"] != item["basis"]:
                issue("EARLIER_PERIOD_SOURCE_CHANGED", item, "The native row changed after earlier-date coding; review that original period")
            continue
        if coding and coding["recognition_date"] > through:
            if coding["basis"] != item["basis"]:
                issue("FUTURE_CODING_SOURCE_CHANGED", item, "The native row changed after future-date coding; update the allocation")
            continue
        if coding is None:
            issue("UNCODED_SETTLED_ROW", item, "Assign an accounting date and exact cost-center allocation, or record its disposition")
            continue
        if coding["basis"] != item["basis"]:
            issue("CODING_SOURCE_CHANGED", item, "The native row differs from the allocation's reviewed source; update coding or record its disposition")
            continue
        transfer_identity = row.get("native_detail", {}).get("transfer_identity")
        prior = previously_issued.get(transfer_identity, [])
        if prior:
            issue("TRANSFER_ALREADY_ISSUED", item,
                  "The same original transfer is included in another currently closed period. Exclude this representation, or reopen and correct the earlier period before recognising it here.",
                  group={"issued_charges":prior}, kinds=["exclude_from_period"])
            continue
        selected_lines = []
        for index, line in enumerate(coding["allocations"]):
            center = centers.get(line["center_id"])
            if center is None:
                raise Problem("COST_CENTER_MISSING", "A retained allocation references a missing cost center", 409)
            selected_lines.append({"item_id": item["id"], "source_id": item["source_id"], "source_name": item["source_name"],
                                   "request_id": row["request_id"], "request_digest": row["request_digest"],
                                   "native_reservation_day": row["day"] if row.get("source_kind") != "mcp_quote" else None,
                                   "native_source_day":row["day"], "native_date_basis":row.get("native_date_basis", "SF36 reservation day"),
                                   "source_kind":row.get("source_kind", "sf36_ledger"), "recognition_date": coding["recognition_date"],
                                   "network": row["network"], "asset": row["asset"], "scheme": row["scheme"],
                                   "settled_actual": row["settled_base_units"],
                                   "reserved_maximum":row["amount"] if row.get("source_kind") != "mcp_quote" else None,
                                   "quoted_amount":row["amount"] if row.get("source_kind") == "mcp_quote" else None,
                                   "receipt_ref": row["receipt_ref"], "proof_sha256": row["proof_sha256"],
                                   "center_id": center["id"], "center_code": center["code"], "center_name": center["name"],
                                   "project": line["project"], "account_code": line["account_code"], "amount": line["amount"],
                                   "memo": line["memo"] or coding["memo"], "coding_id": coding["id"], "line": index + 1,
                                   "source_capture": item["capture_id"], "basis": item["basis"],
                                   "native_payment": row.get("native_detail")})
        group = receipt_groups.get(receipt_key(row), [])
        exact = exact_transfers.get(row.get("native_detail", {}).get("transfer_identity"), [])
        exclude = False
        if len(group) > 1:
            same_transfer = len(exact) > 1
            shared = issue("SHARED_RECEIPT_REFERENCE", item,
                           "These original rows record the same native transfer event. Include one original charge and exclude duplicates." if same_transfer else
                           "More than one registered native row uses this transaction reference; review whether these are distinct charges or a duplicate source.",
                           group={"items": sorted([{"id": x["id"], "basis": x["basis"]} for x in group], key=lambda x: x["id"]),
                                  "same_transfer_items":sorted(x["id"] for x in exact) if same_transfer else []},
                           kinds=["include_original_charge", "exclude_from_period"] if same_transfer else ["separate_native_rows", "exclude_from_period"])
            exclude = bool(shared["resolved"] and shared["disposition"]["kind"] == "exclude_from_period")
        if not exclude:
            candidates.extend(selected_lines)

    # Two source rows with the same original native event cannot both become expense.
    included = {line["item_id"] for line in candidates}
    for values in exact_transfers.values():
        selected = included.intersection(item["id"] for item in values)
        if len(selected) > 1:
            for shared in issues:
                if shared["code"] == "SHARED_RECEIPT_REFERENCE" and shared["item_id"] in selected:
                    shared["resolved"] = False
                    shared["description"] = "The same original native transfer is still allocated more than once. Keep one included charge and exclude the duplicate source rows."
    unresolved = [x for x in issues if not x["resolved"]]
    context = {"period": {k: period[k] for k in ("id", "name", "from_day", "through_day", "generation")},
               "sources": source_views, "items": [{"id": i["id"], "basis": i["basis"], "coding": i.get("coding")} for i in items],
               "centers": sorted(centers.values(), key=lambda x: x["id"]), "dispositions": dispositions,
               "pending_sources": [{"id": s["id"], "pending": s.get("pending", [])} for s in sources],
               "closed_native_transfers":closed_transfers}
    return {"schema": "stellar-forge.buyer-expense-period.v1", "period": period, "source_captures": source_views,
            "context_sha256": digest(context), "ready": not unresolved, "issues": issues,
            "unresolved": len(unresolved), "allocations": candidates, "totals": group_amounts(candidates),
            "by_cost_center": group_amounts(candidates, ("center_code", "center_name")),
            "by_project": group_amounts(candidates, ("project",)), "outstanding_reservations": exposures,
            "outstanding_totals": group_amounts(exposures), "native_payment_outcomes":native_outcomes,
            "basis": "Original SF36 ledger projections and retained MCP quote/payment observations; source finalization remains with each original buyer",
            "date_basis": "Operator-assigned recognition dates; original reservation or quote-creation days retain their own source meaning",
            "unit_basis": "Exact native base-unit strings, grouped by network and asset; no fiat conversion"}
