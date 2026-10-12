"""Exact source interpretation and financial projections for the retained Berkeley workspace."""
from __future__ import annotations

import copy
import csv
from datetime import date, datetime
import hashlib
import io
import json
import re
from zoneinfo import ZoneInfo

LANES = ("permits", "receivables", "processor", "cashier")
EVENTS = ("payment", "refund", "void", "chargeback", "return", "adjustment", "denial", "settlement", "balance")
STATUSES = ("included", "pending", "denied", "excluded")
REQUIRED = ("transaction_id", "business_date", "currency", "event", "status", "amount_minor")
AMOUNTS = ("amount_minor", "requested_minor", "paid_minor", "net_minor", "fee_minor")
FIELD_NAMES = ("record_id", "transaction_id", "permit_id", "invoice_id", "fee_code", "session_id",
               "business_date", "currency", "event", "status", "amount_minor", "requested_minor",
               "paid_minor", "net_minor", "fee_minor", "related_transaction_id", "denial_reason", "payment_type")
FIELDS = [{"key": k, "label": k.replace("_minor", "").replace("_", " ").title(),
           "type": "amount" if k in AMOUNTS else "date" if k == "business_date" else "text",
           "required_for": list(LANES) if k in REQUIRED else []} for k in FIELD_NAMES]
DEFAULT_SETTINGS = {"scales": {"USD": 2}, "timezone": "UTC", "scope_note": "",
                    "required_lanes": ["permits", "receivables"], "balance_tolerance_minor": {"USD": "0"},
                    "close_reviewers_required": 2, "balance_payment_types": {"cashier": None, "processor": None}}
DEFAULT_MAPPING = {"fields": {}, "amount_mode": "major", "amount_sign": "as_supplied",
                   "event_signs": {"payment": "1", "refund": "-1", "void": "-1", "chargeback": "-1",
                                   "return": "-1", "adjustment": "1", "denial": "0",
                                   "settlement": "1", "balance": "1"},
                   "event_map": {}, "status_map": {}, "date_format": "iso", "net_mode": "amount", "note": ""}
MAX_ROWS = 500000
REVIEW_STATES = ("open", "investigating", "accepted_exception", "resolved")
RECEIPT_STATES = ("transmitted", "accepted", "rejected", "posted", "void")


def canonical(v):
    return json.dumps(v, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def fingerprint(v):
    return hashlib.sha256(canonical(v).encode()).hexdigest()


def text(v, name="value", *, required=False, maximum=12000):
    if not isinstance(v, str) or len(v) > maximum or "\x00" in v:
        raise ValueError(name + " must be text without NUL, within " + str(maximum) + " characters.")
    if required and not v.strip():
        raise ValueError(name + " is required.")
    return v


def integer(v, name="amount"):
    if type(v) is int:
        v = str(v)
    if not isinstance(v, str) or not re.fullmatch(r"[+-]?\d{1,100}", v):
        raise ValueError(name + " must be an exact signed integer string.")
    return str(int(v))


def amount(v, mode, scale, name="amount"):
    if v is None or v == "":
        return None
    if type(v) is int:
        v = str(v)
    if not isinstance(v, str):
        raise ValueError(name + " must preserve its original numeric text.")
    if mode == "minor":
        return integer(v, name)
    match = re.fullmatch(r"([+-]?)(\d{1,100})(?:\.(\d{0,100}))?", v.strip())
    if not match:
        raise ValueError(name + " needs plain decimal currency text without separators or exponent.")
    fraction = match[3] or ""
    if len(fraction) > scale and any(c != "0" for c in fraction[scale:]):
        raise ValueError(name + " has fractional precision beyond the declared currency scale.")
    digits = match[2] + fraction[:scale].ljust(scale, "0")
    return str((-1 if match[1] == "-" else 1) * int(digits))


def major(v, scale):
    if v is None:
        return ""
    v = integer(v)
    sign = "-" if v.startswith("-") else ""
    digits = v.lstrip("-").rjust(scale + 1, "0")
    return sign + (digits[:-scale] + "." + digits[-scale:] if scale else digits)


def day(v, fmt="iso"):
    if not isinstance(v, str):
        raise ValueError("Business date must be text.")
    try:
        if fmt == "iso":
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
                raise ValueError()
            return date.fromisoformat(v).isoformat()
        return datetime.strptime(v, "%m/%d/%Y" if fmt == "mdy" else "%d/%m/%Y").date().isoformat()
    except ValueError:
        raise ValueError("Date does not match the declared " + fmt + " date format.") from None


def instant(v):
    text(v, "captured/observed time", required=True, maximum=100)
    try:
        dt = datetime.fromisoformat(v.replace("Z", "+00:00"))
    except ValueError:
        raise ValueError("Supply an ISO timestamp with an explicit offset.") from None
    if dt.tzinfo is None or dt.utcoffset() is None:
        raise ValueError("Supply an ISO timestamp with an explicit offset.")
    return v


def validate_settings(value):
    if not isinstance(value, dict):
        raise ValueError("Supply complete financial settings.")
    if set(value) - set(DEFAULT_SETTINGS):
        raise ValueError("Unknown financial setting.")
    out = {**copy.deepcopy(DEFAULT_SETTINGS), **copy.deepcopy(value)}
    if not isinstance(out["scales"], dict) or not out["scales"]:
        raise ValueError("Declare at least one currency and exact scale.")
    for code, scale in out["scales"].items():
        if not re.fullmatch(r"[A-Z]{3}", code) or type(scale) is not int or not 0 <= scale <= 12:
            raise ValueError("Currency scales use uppercase three-letter codes and integer precision 0..12.")
    text(out["timezone"], "timezone", required=True, maximum=100)
    try:
        ZoneInfo(out["timezone"])
    except Exception:
        raise ValueError("Declare an installed IANA timezone.") from None
    text(out["scope_note"], "scope note")
    lanes = out["required_lanes"]
    if not isinstance(lanes, list) or len(set(lanes)) != len(lanes) or any(x not in LANES for x in lanes):
        raise ValueError("Required lanes must be distinct native financial lane names.")
    if type(out["close_reviewers_required"]) is not int or not 2 <= out["close_reviewers_required"] <= 10:
        raise ValueError("The deposit close needs at least two distinct reviewers, up to ten.")
    tol = out["balance_tolerance_minor"]
    if not isinstance(tol, dict) or set(tol) - set(out["scales"]):
        raise ValueError("Declare tolerance only in configured currencies.")
    out["balance_tolerance_minor"] = {k: integer(tol.get(k, "0"), "tolerance") for k in out["scales"]}
    if any(int(x) < 0 for x in out["balance_tolerance_minor"].values()):
        raise ValueError("Tolerance cannot be negative.")
    scopes = out["balance_payment_types"]
    if not isinstance(scopes, dict) or set(scopes) != {"cashier", "processor"}:
        raise ValueError("Declare tender applicability separately for cashier and processor.")
    for lane, values in scopes.items():
        if values is not None and (not isinstance(values, list) or any(not isinstance(x, str) or len(x) > 300 for x in values)):
            raise ValueError("Tender applicability is null for all or an explicit list (empty means none).")
        if values is not None:
            scopes[lane] = list(dict.fromkeys(values))
    return out


def coverage(value):
    if not isinstance(value, dict):
        raise ValueError("Describe original report coverage.")
    out = {"start_date": "", "end_date": "", "session_ids": [], "payment_types": [], "currencies": [],
           "complete": False, "note": "", "data_mode": "event_stream", "source_system": "", "report_family": ""}
    if set(value) - set(out):
        raise ValueError("Unknown report coverage field.")
    out.update(copy.deepcopy(value))
    if out["start_date"]:
        out["start_date"] = day(out["start_date"])
    if out["end_date"]:
        out["end_date"] = day(out["end_date"])
    if out["start_date"] and out["end_date"] and out["start_date"] > out["end_date"]:
        raise ValueError("Coverage end precedes its start.")
    for field in ("session_ids", "payment_types", "currencies"):
        if not isinstance(out[field], list) or len(out[field]) > 10000:
            raise ValueError("Coverage " + field + " must be a list.")
        out[field] = list(dict.fromkeys(text(x, field, maximum=300) for x in out[field]))
    if type(out["complete"]) is not bool:
        raise ValueError("Coverage complete must be an explicit boolean.")
    for field in ("note", "source_system", "report_family"):
        text(out[field], field)
    if out["complete"] and (not out["start_date"] or not out["end_date"] or not out["note"].strip()):
        raise ValueError("A complete scope declaration requires dates and its actual report coverage explanation.")
    if out["data_mode"] not in ("event_stream", "snapshot"):
        raise ValueError("Declare whether this original is an event stream or a state snapshot.")
    return out


class NumberLexeme(str):
    pass


def parse_capture(raw, filename):
    if not isinstance(raw, bytes):
        raise ValueError("Original source bytes are required.")
    decoded = raw.decode("utf-8-sig")
    if filename.lower().endswith(".csv"):
        reader = csv.reader(io.StringIO(decoded, newline=""))
        try:
            headers = next(reader)
        except StopIteration:
            raise ValueError("CSV needs a header record.") from None
        if not headers or any(not h.strip() for h in headers) or len(set(headers)) != len(headers):
            raise ValueError("CSV headers must be nonblank and distinct.")
        rows = []
        for line, vals in enumerate(reader, 2):
            if not vals or all(x == "" for x in vals):
                continue
            if len(vals) != len(headers):
                raise ValueError("CSV record " + str(line) + " has a different number of fields.")
            rows.append({"line": line, "values": dict(zip(headers, vals)), "types": {h: "string" for h in headers}})
            if len(rows) > MAX_ROWS:
                raise ValueError("Source exceeds 500000 financial records.")
        return {"headers": headers, "rows": rows}
    if not filename.lower().endswith(".json"):
        raise ValueError("Data captures must be CSV or JSON originals.")
    def pairs(items):
        result = {}
        for key, val in items:
            if key in result:
                raise ValueError("Original JSON repeats key " + key + ".")
            result[key] = val
        return result
    def bad_number(value):
        raise ValueError("Nonfinite original JSON number: " + value)
    value = json.loads(decoded, parse_int=NumberLexeme, parse_float=NumberLexeme,
                       parse_constant=bad_number, object_pairs_hook=pairs)
    if isinstance(value, dict):
        value = value.get("records")
    if not isinstance(value, list) or any(not isinstance(row, dict) for row in value):
        raise ValueError("JSON needs an array of record objects or an object containing records.")
    if len(value) > MAX_ROWS:
        raise ValueError("Source exceeds 500000 financial records.")
    headers = []
    rows = []
    def flatten(obj, prefix="", output=None, types=None):
        output = {} if output is None else output
        types = {} if types is None else types
        for key, val in obj.items():
            name = prefix + key
            if isinstance(val, dict):
                flatten(val, name + ".", output, types)
            else:
                if name in output:
                    raise ValueError("JSON dotted field paths collide; supply an unambiguous original layout.")
                typ = ("number" if isinstance(val, NumberLexeme) else "null" if val is None
                       else "boolean" if type(val) is bool else "array" if isinstance(val, list) else "string")
                output[name] = str(val) if isinstance(val, NumberLexeme) else val
                types[name] = typ
        return output, types
    for line, row in enumerate(value, 1):
        vals, types = flatten(row)
        for header in vals:
            if header not in headers:
                headers.append(header)
        rows.append({"line": line, "values": vals, "types": types})
    return {"headers": headers, "rows": rows}


def validate_mapping(value, headers):
    if not isinstance(value, dict) or set(value) - set(DEFAULT_MAPPING):
        raise ValueError("Supply the defined financial mapping fields.")
    out = {**copy.deepcopy(DEFAULT_MAPPING), **copy.deepcopy(value)}
    if not isinstance(out["fields"], dict) or set(out["fields"]) - set(FIELD_NAMES):
        raise ValueError("Mapping contains an unknown canonical field.")
    for field, binding in out["fields"].items():
        if not isinstance(binding, dict) or set(binding) not in ({"column"}, {"literal"}):
            raise ValueError(field + " must map exactly one column or literal.")
        if "column" in binding and binding["column"] not in headers:
            raise ValueError(field + " references a column absent from this original source.")
        if "literal" in binding and (isinstance(binding["literal"], (dict, list)) or type(binding["literal"]) is float):
            raise ValueError("Literal fields must preserve scalar text, integer, boolean or null.")
    for field, allowed in (("amount_mode", ("major", "minor")), ("amount_sign", ("as_supplied", "event")),
                           ("date_format", ("iso", "mdy", "dmy")), ("net_mode", ("amount", "reported"))):
        if out[field] not in allowed:
            raise ValueError("Unknown " + field + ".")
    for field in ("event_map", "status_map"):
        allowed = EVENTS if field == "event_map" else STATUSES
        if not isinstance(out[field], dict) or any(not isinstance(k, str) or v not in allowed for k, v in out[field].items()):
            raise ValueError(field + " must map exact source labels to canonical choices.")
    if not isinstance(out["event_signs"], dict) or any(k not in EVENTS or v not in ("-1", "0", "1") for k, v in out["event_signs"].items()):
        raise ValueError("Event signs must explicitly be -1, 0 or 1.")
    text(out["note"], "mapping note")
    return out


def normalized_row(capture_id, source, mapping, settings, mapping_version):
    vals = {}
    for field in FIELD_NAMES:
        binding = mapping["fields"].get(field)
        value = None if binding is None else binding.get("literal") if "literal" in binding else source["values"].get(binding["column"])
        if isinstance(value, (dict, list)) or type(value) is bool or type(value) is float:
            raise ValueError(field + " needs an exact scalar source value.")
        vals[field] = value
    for field in REQUIRED:
        if vals[field] in (None, ""):
            raise ValueError("Map a nonblank " + field + ".")
    currency = text(str(vals["currency"]), "currency", required=True, maximum=3)
    if currency not in settings["scales"]:
        raise ValueError("Currency " + currency + " has no declared scale.")
    raw_event, raw_status = str(vals["event"]), str(vals["status"])
    event = mapping["event_map"].get(raw_event, raw_event)
    status = mapping["status_map"].get(raw_status, raw_status)
    if event not in EVENTS or status not in STATUSES:
        raise ValueError("Explicitly map this source event/status label.")
    out = {}
    for field in FIELD_NAMES:
        if field not in AMOUNTS:
            out[field] = "" if vals[field] is None else text(str(vals[field]), field, maximum=12000)
    out.update(currency=currency, business_date=day(str(vals["business_date"]), mapping["date_format"]), event=event, status=status)
    for field in AMOUNTS:
        out[field] = amount(vals[field], mapping["amount_mode"], settings["scales"][currency], field)
    if mapping["amount_sign"] == "event":
        if event not in mapping["event_signs"]:
            raise ValueError("Supply the explicit amount sign for " + event + ".")
        if int(out["amount_minor"]) < 0:
            raise ValueError("Event-sign interpretation requires a nonnegative source magnitude.")
        out["amount_minor"] = str(int(out["amount_minor"]) * int(mapping["event_signs"][event]))
        if out["net_minor"] is not None:
            if int(out["net_minor"]) < 0:
                raise ValueError("Event-sign net must also be a nonnegative source magnitude.")
            out["net_minor"] = str(int(out["net_minor"]) * int(mapping["event_signs"][event]))
    out["reported_net_minor"] = out["net_minor"]
    out["net_minor"] = out["amount_minor"] if mapping["net_mode"] == "amount" else out["net_minor"]
    out["net_basis"] = mapping["net_mode"]
    out.update(record_key=capture_id + ":" + str(source["line"]), raw_event=raw_event, raw_status=raw_status,
               source_mapping_version=mapping_version, source_amount_sign=mapping["amount_sign"], original={"capture_id": capture_id, **copy.deepcopy(source)},
               excluded=False, exclusion_reason="", correction_ids=[])
    return out


def normalize(capture, raw, mapping, settings, mapping_version):
    parsed = parse_capture(raw, capture["filename"])
    output, issues = [], []
    absent = [k for k in REQUIRED if k not in mapping["fields"]]
    if absent:
        issues.append({"line": None, "code": "mapping_required", "message": "Map required fields: " + ", ".join(absent)})
    if mapping["net_mode"] == "reported" and "net_minor" not in mapping["fields"]:
        issues.append({"line": None, "code": "net_mapping_required", "message": "Reported-net interpretation requires its original column or supplied literal."})
    if not issues:
        for original in parsed["rows"]:
            try:
                output.append(normalized_row(capture["id"], original, mapping, settings, mapping_version))
            except (ValueError, TypeError) as exc:
                issues.append({"line": original["line"], "code": "interpretation", "message": str(exc),
                               "original": original})
    return output, issues


def correction_changes(value, settings):
    if not isinstance(value, dict) or not value:
        raise ValueError("Supply the exact interpreted fields to correct.")
    allowed = set(FIELD_NAMES) - {"record_id"} | {"excluded", "exclusion_reason"}
    if set(value) - allowed:
        raise ValueError("Correction cannot replace source/record identity or an unknown field.")
    out = copy.deepcopy(value)
    for field, val in out.items():
        if field in AMOUNTS:
            out[field] = None if val in ("", None) else integer(val, field)
            if field == "amount_minor" and out[field] is None:
                raise ValueError("Amount cannot be made missing.")
        elif field == "excluded":
            if type(val) is not bool:
                raise ValueError("Excluded must be an explicit boolean.")
        else:
            out[field] = text(val, field, maximum=12000)
    for field in REQUIRED:
        if field in out and out[field] == "":
            raise ValueError("Required canonical field cannot be blank.")
    if "business_date" in out:
        out["business_date"] = day(out["business_date"])
    if "currency" in out and out["currency"] not in settings["scales"]:
        raise ValueError("Corrected currency has no declared scale.")
    if "event" in out and out["event"] not in EVENTS or "status" in out and out["status"] not in STATUSES:
        raise ValueError("Use an explicit canonical event/status.")
    if out.get("excluded") and not out.get("exclusion_reason", "").strip():
        raise ValueError("Explain why the original row is excluded from this working interpretation.")
    return out


def source_group_hash(rows):
    return fingerprint([{k: row.get(k) for k in ("record_key", "transaction_id", "currency", "net_minor",
                                                 "source_mapping_version", "correction_ids", "in_scope")}
                        for row in sorted(rows, key=lambda x: x["record_key"])])


def _sum(rows, field="net_minor"):
    values = [row.get(field) for row in rows]
    return None if any(v is None for v in values) else str(sum(int(v) for v in values))


def _difference(a, b):
    return None if a is None or b is None else str(int(a) - int(b))


def calculate(body):
    settings, run = body["settings"], body["run"]
    rows = {lane: [] for lane in LANES}
    findings, groups, balances = [], [], []
    reviews = body.get("reviews", {})
    evidence_context = {"settings": settings, "period": [run["start_date"], run["end_date"]],
                        "sources": [{k: cap.get(k) for k in ("capture_id", "sha256", "mapping_version", "coverage")}
                                    for cap in body["manifest"]]}
    def issue(code, message, details, waivable=True, severity="warning"):
        source_ids = set(details.get("capture_ids", []))
        if details.get("capture_id"):
            source_ids.add(details["capture_id"])
        record_keys = list(details.get("record_keys", []))
        if details.get("record_key"):
            record_keys.append(details["record_key"])
        source_ids.update(key.rsplit(":", 1)[0] for key in record_keys)
        context = copy.deepcopy(evidence_context)
        if source_ids:
            context["sources"] = [cap for cap in context["sources"] if cap["capture_id"] in source_ids]
        elif details.get("kind") in LANES:
            relevant_kinds = {details["kind"]}
            if code.startswith("daily_"):
                relevant_kinds.add("permits")
            selected_ids = {cap["capture_id"] for cap in body["manifest"] if cap["kind"] in relevant_kinds}
            context["sources"] = [cap for cap in context["sources"] if cap["capture_id"] in selected_ids]
        ident = "f-" + fingerprint([code, details, context])[:28]
        review = copy.deepcopy(reviews.get(ident, {"status": "open", "owner": "", "note": "", "updated_at": ""}))
        findings.append({"id": ident, "code": code, "severity": severity, "message": message,
                         "details": details, "waivable": waivable, "review": review})
    all_rows = {r["record_key"]: copy.deepcopy(r) for lane in LANES for r in body["rows"][lane]}
    for correction in body.get("corrections", []):
        if not correction.get("active", True):
            continue
        row = all_rows.get(correction["record_key"])
        if row is None or row["source_mapping_version"] != correction["source_mapping_version"]:
            issue("stale_correction", "An earlier correction is bound to a different original source edition.",
                  {"correction_id": correction["id"], "record_key": correction["record_key"]}, False)
            continue
        row.update(copy.deepcopy(correction["changes"]))
        row["correction_ids"].append(correction["id"])
        if "net_minor" in correction["changes"]:
            row["reported_net_minor"] = row["net_minor"]
            row["net_basis"] = "reported"
        elif "amount_minor" in correction["changes"] and row.get("net_basis") == "amount":
            row["net_minor"] = row["amount_minor"]
    lane_for = {r["record_key"]: lane for lane in LANES for r in body["rows"][lane]}
    for key, row in all_rows.items():
        row["in_scope"] = run["start_date"] <= row["business_date"] <= run["end_date"]
        row["observed_contribution_minor"] = row["net_minor"]
        if row["excluded"] or row["status"] != "included":
            row["net_minor"] = "0"
        rows[lane_for[key]].append(row)
        if row["in_scope"]:
            if row["status"] == "denied" or row["event"] == "denial":
                issue("denied_observation", "An actual denied transaction requires a retained disposition.",
                      {"record_key": key, "event": row["event"], "raw_status": row["raw_status"], "denial_reason": row["denial_reason"],
                       "requested_minor": row.get("requested_minor"), "paid_minor": row.get("paid_minor")})
            if row["status"] == "pending":
                issue("pending_observation", "A source transaction is still pending, not posted.",
                      {"record_key": key, "amount_minor": row["amount_minor"], "raw_status": row["raw_status"]})
            if row["status"] == "denied" and row.get("paid_minor") is not None and int(row["paid_minor"]) != 0:
                issue("denied_with_paid_amount", "A denied source observation also reports a paid amount.",
                      {"record_key": key, "paid_minor": row["paid_minor"], "reason": row["denial_reason"]})
            if row["status"] == "included" and not row["excluded"] and row["net_minor"] is None:
                issue("missing_financial_value", "The declared reported-net value is missing.",
                      {"record_key": key, "basis": row.get("net_basis")})
            if row["event"] in ("refund", "void", "chargeback", "return") and row.get("source_amount_sign") == "as_supplied" and int(row["amount_minor"]) > 0:
                issue("positive_reversal_interpretation", "The reversal source is contributing a positive amount under the declared as-supplied interpretation.",
                      {"record_key": key, "event": row["event"], "amount_minor": row["amount_minor"]})
            if row["event"] in ("refund", "void", "chargeback", "return") and not row["related_transaction_id"]:
                issue("missing_reversal_reference", "A reversal event has no supplied original transaction reference.",
                      {"record_key": key, "event": row["event"], "transaction_id": row["transaction_id"]})
    selected_lanes = {x["kind"] for x in body["manifest"]}
    for lane in settings["required_lanes"]:
        if lane not in selected_lanes:
            issue("missing_required_source", "The declared required " + lane + " source is absent.", {"kind": lane})
    manifest = body["manifest"]
    for capture in manifest:
        if not capture["coverage"]["complete"]:
            issue("unconfirmed_report_coverage", "This original report does not declare a complete accounting scope.",
                  {"capture_id": capture["capture_id"], "kind": capture["kind"], "coverage": capture["coverage"]})
    for i, first in enumerate(manifest):
        for second in manifest[i + 1:]:
            if first["kind"] != second["kind"]:
                continue
            a, b = first["coverage"], second["coverage"]
            overlap = (a.get("start_date") and a.get("end_date") and b.get("start_date") and b.get("end_date")
                       and max(a["start_date"], b["start_date"]) <= min(a["end_date"], b["end_date"]))
            def disjoint(field):
                return a.get(field) and b.get(field) and set(a[field]).isdisjoint(b[field])
            if overlap and not any(disjoint(k) for k in ("session_ids", "payment_types", "currencies")):
                issue("overlapping_source_coverage", "Selected same-lane originals declare overlapping coverage; inspect event versus snapshot duplication.",
                      {"kind": first["kind"], "capture_ids": [first["capture_id"], second["capture_id"]],
                       "data_modes": [a["data_mode"], b["data_mode"]]})
    by_id = {}
    for lane in LANES:
        grouped = {}
        for row in rows[lane]:
            if row["in_scope"] and not row["excluded"]:
                grouped.setdefault((row["transaction_id"], row["currency"]), []).append(row)
        for (tx, currency), members in sorted(grouped.items()):
            ident = "g-" + fingerprint([lane, tx, currency])[:28]
            group = {"id": ident, "kind": lane, "transaction_id": tx, "currency": currency,
                     "net_minor": _sum(members), "allocated_minor": "0", "remaining_minor": _sum(members),
                     "record_keys": [x["record_key"] for x in members], "source_hash": source_group_hash(members)}
            for field, plural in (("permit_id", "permit_ids"), ("invoice_id", "invoice_ids"), ("fee_code", "fee_codes"),
                                  ("payment_type", "payment_types"), ("session_id", "session_ids")):
                group[plural] = sorted({x[field] for x in members if x[field]})
            groups.append(group)
            by_id[ident] = group
    allocations = copy.deepcopy(body.get("allocations", []))
    valid_allocations = []
    for alloc in allocations:
        if not alloc.get("active", True):
            alloc["current"] = False
            continue
        source, target = by_id.get(alloc["source_group_id"]), by_id.get(alloc["target_group_id"])
        amount_value = int(alloc["amount_minor"])
        reason = None
        if not source or not target or source["kind"] != "permits" or target["kind"] != "receivables":
            reason = "The original permit/receivables endpoint is absent."
        elif source["currency"] != target["currency"] or source["currency"] != alloc["currency"]:
            reason = "Allocation currencies changed."
        elif source["source_hash"] != alloc.get("source_hash") or target["source_hash"] != alloc.get("target_hash"):
            reason = "The allocated original evidence changed."
        elif source["remaining_minor"] is None or target["remaining_minor"] is None:
            reason = "An allocated amount is now unknown."
        elif amount_value == 0 or any((int(g["remaining_minor"]) > 0) != (amount_value > 0) or abs(amount_value) > abs(int(g["remaining_minor"])) for g in (source, target)):
            reason = "This allocation exceeds, or opposes, the current remaining amounts."
        alloc["current"] = reason is None
        if reason:
            issue("stale_allocation", reason, {"allocation_id": alloc["id"], "source_group_id": alloc["source_group_id"],
                                              "target_group_id": alloc["target_group_id"], "amount_minor": alloc["amount_minor"]}, False)
        else:
            valid_allocations.append(alloc)
            for group in (source, target):
                group["allocated_minor"] = str(int(group["allocated_minor"]) + amount_value)
                group["remaining_minor"] = str(int(group["net_minor"]) - int(group["allocated_minor"]))
    for group in groups:
        if group["kind"] in ("permits", "receivables") and (group["remaining_minor"] is None or int(group["remaining_minor"]) != 0):
            issue("unallocated_balance", "A " + group["kind"] + " transaction has an unexplained remaining amount.",
                  {k: group[k] for k in ("id", "kind", "transaction_id", "currency", "net_minor", "remaining_minor", "record_keys", "source_hash")})
    def complete_for(lane, axis):
        business_date, session_id, payment_type, currency = axis
        for cap in manifest:
            scope = cap["coverage"]
            if cap["kind"] != lane or not scope["complete"] or not scope["start_date"] <= business_date <= scope["end_date"]:
                continue
            if any(scope[field] and val not in scope[field] for field, val in
                   (("session_ids", session_id), ("payment_types", payment_type), ("currencies", currency))):
                continue
            return True
        return False
    axis_rows = {lane: {} for lane in LANES}
    axes = set()
    for lane in LANES:
        for row in rows[lane]:
            if row["in_scope"] and not row["excluded"]:
                axis = tuple(row[k] for k in ("business_date", "session_id", "payment_type", "currency"))
                axes.add(axis)
                axis_rows[lane].setdefault(axis, []).append(row)
    for axis in sorted(axes):
        entry = dict(zip(("business_date", "session_id", "payment_type", "currency"), axis))
        values = {}
        for lane in LANES:
            members = axis_rows[lane].get(axis)
            values[lane] = _sum(members) if members else "0" if complete_for(lane, axis) else None
        entry.update(expected_minor=values["permits"], cashier_minor=values["cashier"], processor_minor=values["processor"],
                     cashier_difference_minor=_difference(values["cashier"], values["permits"]),
                     processor_difference_minor=_difference(values["processor"], values["permits"]))
        balances.append(entry)
        for lane in ("cashier", "processor"):
            applicable_types = settings.get("balance_payment_types", {}).get(lane)
            applicable = applicable_types is None or axis[2] in applicable_types
            entry[lane + "_applicable"] = applicable
            if not applicable:
                entry[lane + "_difference_minor"] = None
                continue
            delta = entry[lane + "_difference_minor"]
            if values[lane] is None or values["permits"] is None:
                issue("daily_coverage_missing", "This daily " + lane + " comparison has an unknown original observation.",
                      {**dict(zip(("business_date", "session_id", "payment_type", "currency"), axis)),
                       "kind": lane, "expected_minor": values["permits"], "observed_minor": values[lane]})
            elif abs(int(delta)) > int(settings["balance_tolerance_minor"].get(axis[3], "0")):
                issue("daily_difference", "The daily " + lane + " observation differs from permit activity.",
                      {**dict(zip(("business_date", "session_id", "payment_type", "currency"), axis)),
                       "kind": lane, "expected_minor": values["permits"], "observed_minor": values[lane], "difference_minor": delta})
    currencies = sorted({r["currency"] for lane in LANES for r in rows[lane] if r["in_scope"]})
    totals = []
    for currency in currencies:
        entry = {"currency": currency}
        for lane, field in (("permits", "permit_minor"), ("receivables", "receivables_minor"),
                            ("processor", "processor_minor"), ("cashier", "cashier_minor")):
            members = [r for r in rows[lane] if r["in_scope"] and not r["excluded"] and r["currency"] == currency]
            entry[field] = _sum(members) if members else None
        entry["allocated_minor"] = str(sum(int(a["amount_minor"]) for a in valid_allocations if a["currency"] == currency))
        for lane, field in (("permits", "permit_remaining_minor"), ("receivables", "receivables_remaining_minor")):
            members = [g for g in groups if g["kind"] == lane and g["currency"] == currency]
            entry[field] = _sum(members, "remaining_minor") if members else None
        totals.append(entry)
    blocking = [f for f in findings if f["review"].get("status") != "accepted_exception" or not f["waivable"]]
    counts = {"source_rows": sum(len(x) for x in rows.values()), "in_scope_rows": sum(r["in_scope"] for x in rows.values() for r in x),
              "excluded_rows": sum(r["excluded"] for x in rows.values() for r in x), "groups": len(groups),
              "allocations": len(allocations), "active_allocations": len(valid_allocations), "findings": len(findings),
              "unaccepted_findings": len(blocking), "accepted_exceptions": len(findings) - len(blocking),
              "balances": len(balances), "corrections": len(body.get("corrections", []))}
    counts.update({lane: len(rows[lane]) for lane in LANES})
    financial = {"run": run, "settings": settings, "manifest": manifest, "rows": rows, "groups": groups,
                 "allocations": allocations, "findings": findings, "balances": balances, "totals": totals}
    return {**financial, "counts": counts, "snapshot_hash": fingerprint(financial)}
