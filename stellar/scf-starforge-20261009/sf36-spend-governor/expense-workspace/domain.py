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
    return digest({"row": {key: row[key] for key in COLUMNS}, "missing": bool(missing)})


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
        elif any(a.get(k) != b.get(k) for k in COLUMNS):
            changes.append({"request_id": request_id, "kind": "CHANGED", "before": a, "after": b,
                            "fields": [k for k in COLUMNS if a.get(k) != b.get(k)]})
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


def period_view(period, items, sources, centers, dispositions):
    """Dates are operator recognition dates; native days never become settlement dates."""
    start, through = period["from_day"], period["through_day"]
    source_views = [{k: s.get(k) for k in ("id", "name", "path", "current_capture", "capture_time", "projection_sha256", "journal_events", "last_sequence")}
                    for s in sources]
    issues, candidates, exposures = [], [], []
    disposition_by_key = {(d["item_id"], d["code"]): d for d in dispositions}

    def issue(code, item, description, *, group=None, kinds=None):
        item_id = item["id"] if item else ""
        selected = disposition_by_key.get((item_id, code))
        issue_basis = digest({"code": code, "basis": item["basis"] if item else None, "group": group})
        allowed = ["carry_forward", "exclude_from_period"] if kinds is None else kinds
        valid = bool(selected and selected["basis"] == issue_basis and selected["kind"] in allowed)
        result = {"code": code, "item_id": item_id, "request_id": item["row"]["request_id"] if item else None,
                  "source_name": item.get("source_name") if item else None, "description": description,
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

    receipt_groups = {}
    for item in items:
        row = item["row"]
        if row["state"] == "settled" and row.get("receipt_ref") and not item["missing"]:
            key = (row["network"], row["asset"], row["receipt_ref"])
            receipt_groups.setdefault(key, []).append(item)

    for item in items:
        row, coding = item["row"], item.get("coding")
        relevant = row["day"] <= through or bool(coding and start <= coding["recognition_date"] <= through)
        if not relevant:
            continue
        if row["state"] == "reserved":
            exposures.append({"item_id": item["id"], "request_id": row["request_id"], "source_name": item["source_name"],
                              "network": row["network"], "asset": row["asset"], "amount": row["reserved_base_units"],
                              "native_reservation_day": row["day"], "missing": item["missing"]})
        if item["missing"]:
            issue("ABSENT_FROM_CURRENT_SOURCE", item, "This original row is absent from the accepted source capture; its previous bytes remain retained")
            continue
        if row["state"] == "reserved":
            issue("UNRESOLVED_RESERVATION", item, "The original maximum remains reserved. Carry it for native finalization; it is not settled expense")
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
        selected_lines = []
        for index, line in enumerate(coding["allocations"]):
            center = centers.get(line["center_id"])
            if center is None:
                raise Problem("COST_CENTER_MISSING", "A retained allocation references a missing cost center", 409)
            selected_lines.append({"item_id": item["id"], "source_id": item["source_id"], "source_name": item["source_name"],
                                   "request_id": row["request_id"], "request_digest": row["request_digest"],
                                   "native_reservation_day": row["day"], "recognition_date": coding["recognition_date"],
                                   "network": row["network"], "asset": row["asset"], "scheme": row["scheme"],
                                   "settled_actual": row["settled_base_units"], "reserved_maximum": row["amount"],
                                   "receipt_ref": row["receipt_ref"], "proof_sha256": row["proof_sha256"],
                                   "center_id": center["id"], "center_code": center["code"], "center_name": center["name"],
                                   "project": line["project"], "account_code": line["account_code"], "amount": line["amount"],
                                   "memo": line["memo"] or coding["memo"], "coding_id": coding["id"], "line": index + 1,
                                   "source_capture": item["capture_id"], "basis": item["basis"]})
        group = receipt_groups.get((row["network"], row["asset"], row["receipt_ref"]), [])
        exclude = False
        if len(group) > 1:
            shared = issue("SHARED_RECEIPT_REFERENCE", item, "More than one registered native row uses this receipt reference; review their distinct charges",
                           group={"items": sorted([{"id": x["id"], "basis": x["basis"]} for x in group], key=lambda x: x["id"])},
                           kinds=["separate_native_rows", "exclude_from_period"])
            exclude = bool(shared["resolved"] and shared["disposition"]["kind"] == "exclude_from_period")
        if not exclude:
            candidates.extend(selected_lines)

    unresolved = [x for x in issues if not x["resolved"]]
    context = {"period": {k: period[k] for k in ("id", "name", "from_day", "through_day", "generation")},
               "sources": source_views, "items": [{"id": i["id"], "basis": i["basis"], "coding": i.get("coding")} for i in items],
               "centers": sorted(centers.values(), key=lambda x: x["id"]), "dispositions": dispositions,
               "pending_sources": [{"id": s["id"], "pending": s.get("pending", [])} for s in sources]}
    return {"schema": "stellar-forge.buyer-expense-period.v1", "period": period, "source_captures": source_views,
            "context_sha256": digest(context), "ready": not unresolved, "issues": issues,
            "unresolved": len(unresolved), "allocations": candidates, "totals": group_amounts(candidates),
            "by_cost_center": group_amounts(candidates, ("center_code", "center_name")),
            "by_project": group_amounts(candidates, ("project",)), "outstanding_reservations": exposures,
            "outstanding_totals": group_amounts(exposures),
            "basis": "Original SF36 statement projection; original ledger finalization remains authoritative",
            "date_basis": "Operator-assigned recognition dates; native reservation days are retained separately",
            "unit_basis": "Exact native base-unit strings, grouped by network and asset; no fiat conversion"}
