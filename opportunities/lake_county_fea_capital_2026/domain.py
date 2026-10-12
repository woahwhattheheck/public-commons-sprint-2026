"""Source-bound facility and capital programme calculations.

The engine records supplied professional findings and aggregates selected amounts.
It does not infer appraisals, condition scales, grants, asset ownership or an EAM API.
"""
from __future__ import annotations
import csv
import hashlib
import io
import json
import re
from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation, localcontext

SCHEMA = "lake-county.capital-programme/v1"
TABLES = {
    "assets": {
        "key": "source_asset_id",
        "fields": ["source_asset_id", "asset_name", "asset_class", "ownership_relation",
                   "responsible_entity", "record_unit", "parent_source_asset_id", "ownership_basis",
                   "as_of", "area", "area_unit", "source_note"],
        "decimal": ["area"], "year": [], "refs": [],
    },
    "assessments": {
        "key": "assessment_id",
        "fields": ["assessment_id", "source_asset_id", "assessment_date", "assessor",
                   "method", "condition_raw", "condition_scale", "risk_raw",
                   "criticality_raw", "remaining_life_years", "source_note"],
        "decimal": ["remaining_life_years"], "year": [], "refs": ["source_asset_id"],
    },
    "valuations": {
        "key": "valuation_id",
        "fields": ["valuation_id", "source_asset_id", "valuation_date", "basis",
                   "currency", "amount", "appraiser_or_author", "restrictions", "source_note"],
        "decimal": ["amount"], "year": [], "refs": ["source_asset_id"],
    },
    "actions": {
        "key": "action_id",
        "fields": ["action_id", "source_asset_id", "scope", "action_type",
                   "planned_year", "capital_cost", "quantity", "unit", "unit_cost",
                   "currency", "price_basis", "cost_basis_date", "operating_impact",
                   "dependencies", "priority_raw", "source_note"],
        "decimal": ["capital_cost", "quantity", "unit_cost", "operating_impact"],
        "year": ["planned_year"], "refs": ["source_asset_id"],
    },
    "funding": {
        "key": "funding_id",
        "fields": ["funding_id", "programme", "amount", "currency", "fiscal_year",
                   "status", "amount_role", "programme_scope", "eligible_actions",
                   "conditions", "receipt_year", "receipt_status", "source_note"],
        "decimal": ["amount"], "year": ["fiscal_year", "receipt_year"], "refs": [],
    },
    "budgets": {
        "key": "budget_observation_id",
        "fields": ["budget_observation_id", "fund", "account", "fiscal_year",
                   "column_label", "basis", "amount", "currency", "source_note"],
        "decimal": ["amount"], "year": ["fiscal_year"], "refs": [],
    },
    "model_outputs": {
        "key": "result_id",
        "fields": ["result_id", "scenario_label", "source_asset_id", "action_id",
                   "fiscal_year", "metric", "amount", "currency", "price_basis",
                   "model_version", "source_note"],
        "decimal": ["amount"], "year": ["fiscal_year"], "refs": [],
    },
}
TABLES["asset_observations"] = {"key": "observation_id",
    "fields": ["observation_id"] + TABLES["assets"]["fields"],
    "decimal": ["area"], "year": [], "refs": []}
FUNDING_STATUS = {"historical_actual", "adopted", "committed", "requested",
                  "anticipated", "proposed", "unknown"}
RECEIPT_STATUS = {"actual_received", "scheduled", "unknown"}
FUNDING_ROLES = {"component", "stated_total", "context"}
FUNDING_SCOPES = {"asset_capital", "study_programme", "operating", "unknown"}
METRICS = {"capital_need", "planned_expenditure", "operating_impact",
           "authorized_funding", "contingent_funding", "cash_receipt",
           "cash_payment", "closing_cash"}
DECIMAL = re.compile(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)\Z")
ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}\Z")
MAX_ROWS = 200000
MAX_COLUMNS = 256
MAX_FIELD = 1024 * 1024

class ProgrammeError(Exception):
    def __init__(self, code, message, details=None, status=400):
        super().__init__(message)
        self.code, self.details, self.status = code, details or {}, status

def require(condition, code, message, details=None, status=400):
    if not condition:
        raise ProgrammeError(code, message, details, status)

def stable(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)

def digest(value):
    if not isinstance(value, bytes):
        value = stable(value).encode("utf-8")
    return hashlib.sha256(value).hexdigest()

def identifier(value, label="Identifier"):
    require(isinstance(value, str) and ID.fullmatch(value), "identifier",
            label + " must be a nonempty explicit identifier of at most 200 characters.")
    return value

def missing(value):
    return value is None or value == ""

def decimal(value, label="Amount", allow_negative=True):
    require(isinstance(value, str) and DECIMAL.fullmatch(value), "decimal",
            label + " must be an exact decimal string; no currency marks, exponents or separators.")
    try:
        number = Decimal(value)
    except InvalidOperation:
        raise ProgrammeError("decimal", label + " is not a decimal.")
    require(number.is_finite() and len(value) <= 120 and number.adjusted() <= 30,
            "decimal", label + " exceeds the supported finite precision.")
    require(allow_negative or number >= 0, "decimal", label + " cannot be negative.")
    return number

def amount(value):
    value = Decimal(value)
    return format(value, "f")

def year(value, label="Year"):
    require(isinstance(value, (str, int)) and not isinstance(value, bool),
            "year", label + " must be an explicit four-digit calendar/fiscal label.")
    text = str(value)
    require(re.fullmatch(r"[0-9]{4}", text) and 1900 <= int(text) <= 2500,
            "year", label + " must be between 1900 and 2500.")
    return int(text)

def fact_issue(kind, message, field=None, severity="error", **details):
    return {"kind": kind, "severity": severity, "field": field,
            "message": message, "details": details}

def validate_mapping(table, mapping):
    require(table in TABLES, "table", "Select a supported register.", {"tables": list(TABLES)})
    require(isinstance(mapping, dict), "mapping", "Column mapping must be an object.")
    columns = mapping.get("columns")
    require(isinstance(columns, dict) and columns, "mapping", "Select explicit source columns.")
    require(set(columns) <= set(TABLES[table]["fields"]), "mapping", "Mapping contains an unknown target field.")
    require(TABLES[table]["key"] in columns, "mapping", "Map the original record identifier.")
    require(all(isinstance(v, str) and v for v in columns.values()), "mapping", "Source columns must be names.")
    require(len(set(columns.values())) == len(columns), "mapping", "Map a source column once per register.")
    require(set(mapping) <= {"columns", "delimiter", "key_trim", "key_casefold", "json_pointer"},
            "mapping", "Unknown mapping option.")
    delimiter = mapping.get("delimiter", ",")
    require(isinstance(delimiter, str) and len(delimiter) == 1 and delimiter not in "\r\n\0",
            "mapping", "CSV delimiter must be one character.")
    for name in ("key_trim", "key_casefold"):
        require(isinstance(mapping.get(name, False), bool), "mapping", name + " must be true or false.")
    return mapping

def pointer(document, selected):
    require(isinstance(selected, str) and (selected == "" or selected.startswith("/")),
            "json_pointer", "Select an RFC 6901 JSON pointer.")
    value = document
    for item in selected.split("/")[1:]:
        require(not re.search(r"~(?![01])", item), "json_pointer", "Invalid JSON pointer escape.")
        key = item.replace("~1", "/").replace("~0", "~")
        try:
            if isinstance(value, list):
                require(re.fullmatch(r"0|[1-9][0-9]*", key), "json_pointer", "Select a real array position.")
                value = value[int(key)]
            else:
                require(isinstance(value, dict), "json_pointer", "Pointer does not select an object.")
                value = value[key]
        except (KeyError, IndexError):
            raise ProgrammeError("json_pointer", "Selected JSON pointer is absent.")
    return value

def normalized_key(value, mapping):
    if not isinstance(value, str) or not value:
        return None
    if mapping.get("key_trim", False):
        value = value.strip()
    if mapping.get("key_casefold", False):
        value = value.casefold()
    return value or None

def project_record(table, raw, mapping, structural=None):
    schema = TABLES[table]
    projected = {field: raw.get(column) for field, column in mapping["columns"].items()}
    issues = list(structural or [])
    for field, column in mapping["columns"].items():
        if column not in raw:
            issues.append(fact_issue("missing_column", "Mapped source column is absent.", field, column=column))
        elif isinstance(raw[column], (list, dict, bool, float)):
            issues.append(fact_issue("non_scalar", "Retain the raw value and choose an explicit scalar mapping.", field))
    key = normalized_key(projected.get(schema["key"]), mapping)
    if key is None:
        issues.append(fact_issue("blank_or_nontext_key", "Original identifier is missing, blank or not text.", schema["key"]))
    for field in schema["decimal"]:
        value = projected.get(field)
        if not missing(value):
            try:
                decimal(value, field, allow_negative=field in {"amount", "operating_impact"})
            except ProgrammeError as exc:
                issues.append(fact_issue("invalid_decimal", str(exc), field, value=value))
    for field in schema["year"]:
        value = projected.get(field)
        if not missing(value):
            try:
                year(value, field)
            except ProgrammeError as exc:
                issues.append(fact_issue("invalid_year", str(exc), field, value=value))
    if table in {"assets", "asset_observations"}:
        value = projected.get("ownership_relation")
        if missing(value):
            issues.append(fact_issue("ownership_unestablished", "Ownership or maintenance responsibility is not established.", "ownership_relation", "warning"))
        elif value not in {"owned", "maintained_nonowned", "managed", "leased", "unknown", "other"}:
            issues.append(fact_issue("ownership_mapping", "Keep the source wording and explicitly map the ownership relationship.", "ownership_relation"))
    if table == "assessments":
        for field in ("assessor", "assessment_date", "method", "condition_scale"):
            if missing(projected.get(field)):
                issues.append(fact_issue("assessment_context", "The professional finding needs its original context.", field, "warning"))
    if table == "valuations":
        for field in ("basis", "valuation_date", "appraiser_or_author"):
            if missing(projected.get(field)):
                issues.append(fact_issue("valuation_context", "Valuation basis, date and author remain explicit.", field, "warning"))
    if table == "funding":
        for field, accepted in (("status", FUNDING_STATUS), ("amount_role", FUNDING_ROLES),
                                ("programme_scope", FUNDING_SCOPES)):
            if projected.get(field) not in accepted:
                issues.append(fact_issue("funding_classification", "Select an explicit funding classification; no default is inferred.", field, accepted=sorted(accepted)))
        value = projected.get("receipt_status")
        if not missing(value) and value not in RECEIPT_STATUS:
            issues.append(fact_issue("receipt_classification", "Receipt status must remain separate from appropriation or commitment.", "receipt_status"))
    if table == "model_outputs":
        if projected.get("metric") not in METRICS:
            issues.append(fact_issue("model_metric", "Map the supplied output to one supported metric.", "metric"))
        if missing(projected.get("model_version")):
            issues.append(fact_issue("model_version", "Retain the original model version.", "model_version"))
    return projected, key, issues

def read_table(path, fmt, mapping):
    """Yield every decoded source row with its original row and physical line."""
    require(fmt in {"csv", "json"}, "format", "Data-register input supports explicit CSV or JSON.")
    if fmt == "csv":
        csv.field_size_limit(MAX_FIELD)
        with open(path, "r", encoding="utf-8-sig", errors="strict", newline="") as handle:
            reader = csv.reader(handle, delimiter=mapping.get("delimiter", ","), strict=True)
            header = next(reader, None)
            require(header is not None and 0 < len(header) <= MAX_COLUMNS, "csv_header", "CSV needs a bounded header.")
            require(all(isinstance(x, str) and x and "\0" not in x for x in header), "csv_header", "CSV headers must be nonempty.")
            duplicates = sorted(k for k, n in Counter(header).items() if n > 1)
            require(not duplicates, "csv_header", "CSV headers must be unique; original bytes remain retained.", {"duplicates": duplicates})
            for ordinal, fields in enumerate(reader, 1):
                require(ordinal <= MAX_ROWS, "row_limit", "Register exceeds the declared 200,000-row limit.")
                issues = []
                if len(fields) != len(header):
                    issues.append(fact_issue("row_width", "CSV row width differs from its header.",
                                             expected=len(header), actual=len(fields)))
                raw = dict(zip(header, fields))
                if len(fields) > len(header):
                    raw["__unmapped_extra_fields__"] = fields[len(header):]
                yield ordinal, reader.line_num, raw, issues
    else:
        with open(path, "r", encoding="utf-8-sig", errors="strict") as handle:
            def reject_constant(value):
                raise ProgrammeError("json_number", "JSON must not contain nonfinite numbers.")
            def unique_object(pairs):
                result = {}
                for key, value in pairs:
                    require(key not in result, "json_duplicate_key", "A JSON object repeats a source field; original bytes remain retained.")
                    result[key] = value
                return result
            document = json.load(handle, parse_constant=reject_constant, object_pairs_hook=unique_object)
        rows = pointer(document, mapping.get("json_pointer", ""))
        require(isinstance(rows, list) and len(rows) <= MAX_ROWS, "json_rows", "Select a JSON array of at most 200,000 source records.")
        for ordinal, raw in enumerate(rows, 1):
            if not isinstance(raw, dict) or len(raw) > MAX_COLUMNS:
                yield ordinal, None, {"__original_value__": raw}, [fact_issue("row_object", "JSON source row is not a bounded object.")]
            else:
                yield ordinal, None, raw, []

def compare_records(before, after, key_fields, guard_fields=(), editable_fields=None):
    """Full comparison. Duplicates and missing keys never choose a winning row."""
    require(isinstance(key_fields, list) and key_fields, "comparison", "Select explicit comparison key fields.")
    guards = set(guard_fields)
    editable = None if editable_fields is None else set(editable_fields)
    buckets = []
    for records in (before, after):
        index = defaultdict(list)
        for row in records:
            values = row["values"]
            key = [values.get(field) for field in key_fields]
            if any(not isinstance(v, str) or not v for v in key):
                index[None].append(row)
            else:
                index[stable(key)].append(row)
        buckets.append(index)
    findings = []
    counts = Counter()
    def emit(kind, key, old=None, new=None, field=None, expected=None, actual=None, message=""):
        item = {"kind": kind, "key": None if key is None else json.loads(key),
                "baseline_row_id": old and old["row_id"], "candidate_row_id": new and new["row_id"],
                "field": field, "expected": expected, "actual": actual, "message": message}
        item["id"] = digest(item)
        findings.append(item)
        counts[kind] += 1
    baseline, candidate = buckets
    for key in sorted(set(baseline) | set(candidate), key=lambda x: "" if x is None else x):
        old, new = baseline.get(key, []), candidate.get(key, [])
        if key is None:
            for row in old:
                emit("invalid_key", key, old=row, message="Baseline identifier is incomplete.")
            for row in new:
                emit("invalid_key", key, new=row, message="Candidate identifier is incomplete.")
            continue
        if len(old) > 1 or len(new) > 1:
            for row in old:
                emit("duplicate_key", key, old=row, message="Ambiguous baseline/candidate key; every original row is retained.")
            for row in new:
                emit("duplicate_key", key, new=row, message="Ambiguous baseline/candidate key; every original row is retained.")
            continue
        if not old:
            emit("added", key, new=new[0])
            continue
        if not new:
            emit("removed", key, old=old[0])
            continue
        left, right = old[0], new[0]
        for field in sorted(set(left["values"]) | set(right["values"])):
            a, b = left["values"].get(field), right["values"].get(field)
            # JSON null, empty text, numeric zero and the string "0" remain distinct.
            if stable(a) != stable(b):
                kind = "guard_changed" if field in guards or (editable is not None and field not in editable) else "changed"
                emit(kind, key, left, right, field, a, b)
    return {"schema": "lake-county.complete-comparison/v1", "baseline_rows": len(before),
            "candidate_rows": len(after), "counts": dict(counts), "findings": findings,
            "complete": True, "adoptable": not any(counts[k] for k in ("invalid_key", "duplicate_key", "guard_changed"))}

def evaluate_scenario(spec, rows, *, source_edition, model_exchange=None):
    require(isinstance(spec, dict), "scenario", "Scenario must be an object.")
    name = spec.get("name")
    require(isinstance(name, str) and name.strip(), "scenario", "Name the scenario.")
    currency = spec.get("currency")
    require(isinstance(currency, str) and re.fullmatch(r"[A-Z]{3}", currency), "currency", "Use an explicit three-letter currency.")
    require(spec.get("horizon_years") == 15, "horizon", "Use the agreed 15-year horizon; five/ten years are views of it.")
    mode = spec.get("mode")
    require(mode in {"selected_actions", "received_model"}, "scenario_mode", "Select supplied actions or a reviewed returned model.")
    require(spec.get("price_basis") in {"nominal_supplied", "constant_supplied"}, "price_basis", "Declare supplied nominal or constant amounts.")
    start = spec.get("horizon_start")
    required = []
    if start is None:
        required.append("Select the original model's actual horizon start.")
    else:
        start = year(start, "Horizon start")
    selected_ids = spec.get("selected_row_ids", [])
    require(isinstance(selected_ids, list) and len(set(selected_ids)) == len(selected_ids),
            "selection", "Select each original source row once.")
    index = {r["row_id"]: r for r in rows}
    require(all(i in index for i in selected_ids), "selection", "A selected source row is absent from this edition.")
    selected = [index[i] for i in selected_ids]
    if not selected:
        required.append("Select the supplied capital actions or original model result rows.")
    if mode == "received_model":
        require(model_exchange and model_exchange.get("adoption", {}).get("status") == "accepted",
                "model_exchange", "Select an explicitly accepted original model return.")
        allowed = set(model_exchange["adoption"]["row_ids"])
        require(set(selected_ids) <= allowed, "model_exchange", "The scenario must use the accepted returned rows.")
    expected_table = "model_outputs" if mode == "received_model" else "actions"
    require(all(row["table"] == expected_table for row in selected), "selection", "Scenario rows must come from the selected mode.")
    funding_ids = spec.get("funding_row_ids", [])
    require(isinstance(funding_ids, list) and len(set(funding_ids)) == len(funding_ids), "funding", "Select each funding row once.")
    require(all(i in index and index[i]["table"] == "funding" for i in funding_ids),
            "funding", "Select existing funding observations.")
    require(not (mode == "received_model" and funding_ids), "funding",
            "Received-model funding metrics stay authoritative. Do not add separate funding rows a second time.")
    overrides = spec.get("schedule_overrides", [])
    require(isinstance(overrides, list), "schedule", "Schedule overrides must be explicit rows.")
    by_override = {}
    for item in overrides:
        require(isinstance(item, dict) and item.get("row_id") in selected_ids and mode == "selected_actions",
                "schedule", "Override only a selected action.")
        require(item["row_id"] not in by_override and item.get("actor") and item.get("reason"),
                "schedule", "Each override requires one named actor and reason.")
        by_override[item["row_id"]] = year(item.get("year"))
    horizon = [] if start is None else list(range(start, start + 15))
    annual = {y: {m: Decimal(0) for m in METRICS} for y in horizon}
    supplied = {y: Counter() for y in horizon}
    unknown = []
    excluded = []
    schedule = []
    for row in selected:
        v = row["values"]
        errors = [x for x in row.get("issues", []) if x["severity"] == "error"]
        if errors:
            unknown.append({"row_id": row["row_id"], "reason": "Resolve original register errors.", "issues": errors})
            continue
        if v.get("currency") != currency:
            unknown.append({"row_id": row["row_id"], "reason": "Currency differs; no exchange rate is inferred."})
            continue
        if v.get("price_basis") != spec["price_basis"]:
            unknown.append({"row_id": row["row_id"], "reason": "Price basis differs or is absent; no inflation is inferred."})
            continue
        target = v.get("fiscal_year") if mode == "received_model" else v.get("planned_year")
        target = by_override.get(row["row_id"], target)
        if missing(target):
            unknown.append({"row_id": row["row_id"], "reason": "Original timing is unknown."})
            continue
        try:
            target = year(target)
            if mode == "received_model":
                metric = v.get("metric")
                require(metric in METRICS, "metric", "Unknown model metric.")
                value = decimal(v.get("amount"), "Supplied model amount")
            else:
                metric = "capital_need"
                direct, q, u = v.get("capital_cost"), v.get("quantity"), v.get("unit_cost")
                if not missing(direct):
                    value = decimal(direct, "Supplied capital cost", False)
                    if not missing(q) and not missing(u):
                        require(value == decimal(q, "Quantity", False) * decimal(u, "Unit cost", False),
                                "cost_basis", "Direct capital cost differs from quantity times unit cost; choose the agreed complete cost basis.")
                else:
                    require(not missing(q) and not missing(u) and not missing(v.get("unit")), "cost_basis",
                            "Supply the complete capital cost or explicit quantity, unit and unit cost.")
                    value = decimal(q, "Quantity", False) * decimal(u, "Unit cost", False)
            record = {"row_id": row["row_id"], "year": target, "metric": metric, "amount": amount(value),
                      "source_file_id": row["file_id"], "source_row": row["source_row"],
                      "override": row["row_id"] in by_override}
            schedule.append(record)
            if target not in annual:
                excluded.append({**record, "reason": "Outside the selected horizon."})
                continue
            if mode == "received_model" and metric == "closing_cash" and supplied[target][metric]:
                unknown.append({"row_id": row["row_id"], "reason": "Multiple closing-cash outputs cannot be summed. Select the original combined output."})
                continue
            annual[target][metric] += value
            supplied[target][metric] += 1
            if mode == "selected_actions":
                opex = v.get("operating_impact")
                if missing(opex):
                    unknown.append({"row_id": row["row_id"], "reason": "Operating impact is unknown; no zero is assumed.", "metric": "operating_impact"})
                else:
                    annual[target]["operating_impact"] += decimal(opex, "Supplied operating impact")
                    supplied[target]["operating_impact"] += 1
        except ProgrammeError as exc:
            unknown.append({"row_id": row["row_id"], "reason": str(exc), "code": exc.code})
    funding_observations = []
    for row_id in funding_ids:
        row, v = index[row_id], index[row_id]["values"]
        entry = {"row_id": row_id, "status": v.get("status"), "amount_role": v.get("amount_role"),
                 "programme_scope": v.get("programme_scope"), "amount": v.get("amount"),
                 "currency": v.get("currency"), "eligible_actions": v.get("eligible_actions"),
                 "conditions": v.get("conditions"), "source_file_id": row["file_id"], "source_row": row["source_row"]}
        funding_observations.append(entry)
        reason = None
        if any(issue["severity"] == "error" for issue in row.get("issues", [])):
            unknown.append({"row_id": row_id, "reason": "Resolve the original funding register errors.", "issues": row["issues"]})
            continue
        if v.get("amount_role") != "component":
            reason = "Stated totals and contextual amounts are not additive funding."
        elif v.get("programme_scope") != "asset_capital":
            reason = "This amount is not identified as asset-capital funding."
        elif v.get("currency") != currency:
            reason = "Currency differs or is missing."
        elif v.get("status") not in FUNDING_STATUS:
            reason = "Funding status is unresolved."
        if reason:
            excluded.append({**entry, "reason": reason})
            continue
        try:
            target, value = year(v.get("fiscal_year")), decimal(v.get("amount"), "Funding amount", False)
            if target not in annual:
                excluded.append({**entry, "reason": "Funding year is outside the selected horizon."})
                continue
            metric = "authorized_funding" if v["status"] in {"adopted", "committed", "historical_actual"} else "contingent_funding"
            annual[target][metric] += value
            supplied[target][metric] += 1
            # Appropriation and commitment never become a cash receipt.
            if v.get("receipt_status") == "actual_received":
                received = year(v.get("receipt_year"), "Actual receipt year")
                require(v["status"] in {"historical_actual", "adopted", "committed"}, "cash_status",
                        "An anticipated/requested/proposed amount cannot also be an actual receipt.")
                if received in annual:
                    annual[received]["cash_receipt"] += value
                    supplied[received]["cash_receipt"] += 1
                else:
                    excluded.append({**entry, "reason": "Actual receipt lies outside the horizon."})
        except ProgrammeError as exc:
            unknown.append({"row_id": row_id, "reason": str(exc), "code": exc.code})
    years = []
    for y in horizon:
        metrics = {}
        for metric, total in annual[y].items():
            # A metric never supplied remains unknown; an explicitly supplied zero remains zero.
            metrics[metric] = amount(total) if supplied[y][metric] else None
        years.append({"year": y, **metrics, "supplied_counts": dict(supplied[y])})
    views = {}
    for length in (5, 10, 15):
        chosen = years[:length]
        totals = {}
        for metric in METRICS - {"closing_cash"}:
            values = [r[metric] for r in chosen if r[metric] is not None]
            totals[metric] = {"known_sum": amount(sum((Decimal(v) for v in values), Decimal(0))) if values else None,
                              "years_supplied": len(values), "years_in_view": len(chosen),
                              "complete_annual_coverage": bool(chosen) and len(values) == len(chosen)}
        totals["closing_cash"] = chosen[-1]["closing_cash"] if chosen else None
        views[str(length)] = {"years": [r["year"] for r in chosen], "totals": totals}
    return {"schema": "lake-county.capital-scenario-result/v1", "name": name, "mode": mode,
            "source_edition": source_edition, "currency": currency, "price_basis": spec["price_basis"],
            "horizon_start": start, "horizon_years": 15, "years": years, "views": views,
            "schedule": schedule, "funding_observations": funding_observations,
            "excluded": excluded, "unresolved": unknown, "required_inputs": required,
            "complete": not required and not unknown,
            "professional_status": "supplied_findings_and_selected_arithmetic_only",
            "cash_note": "Authorized, contingent and cash amounts are separate. No closing cash, financing, inflation or replacement cycles are invented.",
            "model_exchange": model_exchange and model_exchange.get("id")}
