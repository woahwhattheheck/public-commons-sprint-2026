"""Exact financial source/period/reconciliation semantics; no tenant requests."""
from __future__ import annotations
import csv
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation, localcontext, ROUND_HALF_EVEN, ROUND_HALF_UP
import io
import json
import re
from migration_store import MigrationError, canonical, identity, text, integer

SCHEMA = "commons.financial-reporting/v1"
AMOUNT = re.compile(r"^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$")
ROLES = ("actual", "budget", "commitment", "forecast", "opening_balance", "report_output")
class OriginalNumber(str):
    """An unchanged JSON numeric token, distinguished from JSON text."""

FIXED = ("account", "posting_date", "document_date")
MAX_ROWS = 1000000
MAX_COLUMNS = 1000

def require(ok, code, message, **details):
    if not ok:
        raise MigrationError(code, message, details)

def strict_object(value, required=(), optional=()):
    require(isinstance(value, dict), "FINANCE_OBJECT", "Use a complete JSON object.")
    require(set(required) <= set(value) and not set(value) - set(required) - set(optional),
            "FINANCE_FIELDS", "Select the documented fields.", required=list(required), actual=list(value))
    return value

def date_value(value):
    require(isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value),
            "FINANCE_DATE", "Use an explicit ISO calendar date; accounting closing dates need an approved mapping.")
    try:
        date.fromisoformat(value)
    except ValueError as exc:
        raise MigrationError("FINANCE_DATE", "Invalid calendar date.") from exc
    return value

def decimal_value(value):
    # Reject floats and locale inference. Original decimal strings remain in raw rows.
    require(isinstance(value, str) and bool(AMOUNT.fullmatch(value)) and len(value) <= 120,
            "FINANCE_AMOUNT", "Use exact plain decimal text, without exponent, grouping, currency or inferred locale.")
    try:
        result = Decimal(value)
    except InvalidOperation as exc:
        raise MigrationError("FINANCE_AMOUNT", "Invalid exact decimal.") from exc
    require(result.is_finite(), "FINANCE_AMOUNT", "Use a finite exact decimal.")
    return result

def decimal_text(value):
    result = format(value, "f")
    return "0" if value == 0 else result

def sum_exact(values):
    with localcontext() as ctx:
        ctx.prec = 256
        total = Decimal(0)
        for value in values:
            total += decimal_value(value) if isinstance(value, str) else value
        return total

def cell(row, field):
    if field.startswith("dimension:"):
        return row["dimensions"].get(field[10:], {"present": False})
    return row.get(field, {"present": False})

def original_kind(value):
    if isinstance(value, OriginalNumber): return "number"
    if value is None: return "null"
    if isinstance(value, bool): return "boolean"
    return "string"

def selected_cell(raw, name):
    return {"present": name in raw, **({"value": raw[name], "kind": original_kind(raw[name])} if name in raw else {})}

def validate_mapping(mapping, columns):
    strict_object(mapping, ("keys", "amount", "currency", "account"),
                  ("posting_date", "document_date", "dimensions"))
    require(isinstance(mapping["keys"], list) and mapping["keys"] and
            len(set(mapping["keys"])) == len(mapping["keys"]),
            "FINANCE_KEYS", "Select distinct original identity columns.")
    for key in mapping["keys"] + [mapping["amount"], mapping["account"]]:
        require(isinstance(key, str) and key in columns, "FINANCE_COLUMN", "Select an actual original column.", column=key)
    currency = strict_object(mapping["currency"], (), ("column", "constant"))
    require(len(currency) == 1, "FINANCE_CURRENCY", "Select one actual currency column or an explicitly reviewed currency constant.")
    if "column" in currency:
        require(currency["column"] in columns, "FINANCE_COLUMN", "Select an actual currency column.")
    else:
        text(currency["constant"], "currency constant", max_length=100)
    for field in ("posting_date", "document_date"):
        if field in mapping:
            require(mapping[field] in columns, "FINANCE_COLUMN", "Select an actual original date column.")
    dimensions = mapping.get("dimensions", {})
    require(isinstance(dimensions, dict) and len(dimensions) <= 100, "FINANCE_DIMENSIONS", "Map named dimensions explicitly.")
    for name, column in dimensions.items():
        text(name, "dimension", max_length=120)
        require(column in columns, "FINANCE_COLUMN", "Select an original dimension column.", column=column)
    return mapping

def validate_context(context):
    strict_object(context, ("company", "system", "source_reference", "captured_at", "coverage", "role",
                            "measure", "currency_basis", "window", "parameters", "review"),
                  ("budget_edition", "basis_role", "opening_as_of", "execution_seconds",
                   "preparation_minutes", "freshness_seconds", "review_minutes"))
    for name in ("company", "system", "source_reference", "measure", "currency_basis"):
        text(context[name], name, max_length=4000)
    try:
        dt = datetime.fromisoformat(context["captured_at"].replace("Z", "+00:00"))
        require(dt.tzinfo is not None, "FINANCE_CAPTURE_TIME", "Capture time needs its explicit timezone.")
    except (ValueError, AttributeError, TypeError) as exc:
        raise MigrationError("FINANCE_CAPTURE_TIME", "Use the actual timezone-aware source capture time.") from exc
    require(context["coverage"] in ("complete", "partial", "unknown"), "FINANCE_COVERAGE", "Declare actual source coverage.")
    require(context["role"] in ROLES, "FINANCE_ROLE", "Select an explicit financial population role.")
    window = strict_object(context["window"], ("start", "end"))
    require(date_value(window["start"]) <= date_value(window["end"]), "FINANCE_WINDOW", "Source dates are reversed.")
    require(isinstance(context["parameters"], dict), "FINANCE_PARAMETERS", "Retain original extraction/report parameters.")
    review = strict_object(context["review"], ("actor", "note", "evidence_files"))
    text(review["actor"], "coverage reviewer"); text(review["note"], "coverage review")
    require(isinstance(review["evidence_files"], list), "FINANCE_EVIDENCE", "Retain original evidence file identities.")
    role = context.get("basis_role", context["role"])
    if context["role"] in ("report_output", "opening_balance"):
        require(role in ("actual", "budget", "commitment", "forecast"), "FINANCE_BASIS", "Retain the report/opening financial basis.")
    if role == "budget":
        text(context.get("budget_edition"), "original budget edition")
    if context["role"] == "opening_balance":
        date_value(context.get("opening_as_of"))
    for name in ("execution_seconds", "preparation_minutes", "freshness_seconds", "review_minutes"):
        if name in context:
            require(decimal_value(context[name]) >= 0, "FINANCE_MEASUREMENT", "Retain nonnegative exact measured times.")
    return context

def original_rows(raw_bytes, format_name, dialect):
    require(format_name in ("csv", "json-table"), "FINANCE_FORMAT", "Use CSV or a complete JSON array of original rows.")
    require(isinstance(dialect, dict), "FINANCE_DIALECT", "Select the source encoding and delimiter explicitly.")
    encoding = dialect.get("encoding", "utf-8-sig")
    require(encoding in ("utf-8", "utf-8-sig", "utf-16", "utf-16-le", "utf-16-be"), "FINANCE_ENCODING", "Unsupported original encoding.")
    try:
        source = raw_bytes.decode(encoding)
    except UnicodeError as exc:
        raise MigrationError("FINANCE_ENCODING", "The complete original cannot be decoded using the selected encoding.") from exc
    if format_name == "csv":
        delimiter = dialect.get("delimiter", ",")
        require(delimiter in (",", ";", "\t", "|"), "FINANCE_DELIMITER", "Choose an explicit delimiter.")
        rows = csv.reader(io.StringIO(source, newline=""), delimiter=delimiter, strict=True)
        columns = next(rows, None)
        require(columns is not None and columns and len(columns) <= MAX_COLUMNS and
                all(isinstance(c, str) and c for c in columns) and len(set(columns)) == len(columns),
                "FINANCE_HEADER", "Retain one nonempty, unique original header row.")
        out = []
        for ordinal, values in enumerate(rows, 1):
            require(ordinal <= MAX_ROWS, "FINANCE_ROW_LIMIT", "Complete source exceeds the declared row bound.")
            require(len(values) == len(columns), "FINANCE_ROW_WIDTH", "An original row does not match its complete header.", ordinal=ordinal)
            out.append(dict(zip(columns, values)))
        return columns, out
    try:
        # Exact original numeric lexemes retain a distinct type for source keys,
        # dimension grouping and output comparison; no coercion to JSON text.
        rows = json.loads(source, parse_float=OriginalNumber, parse_int=OriginalNumber,
                          parse_constant=lambda x: (_ for _ in ()).throw(ValueError(x)),
                          object_pairs_hook=unique_pairs)
    except (ValueError, TypeError) as exc:
        raise MigrationError("FINANCE_JSON", "Use a complete JSON row array with unique object keys.") from exc
    require(isinstance(rows, list) and len(rows) <= MAX_ROWS and all(isinstance(r, dict) for r in rows),
            "FINANCE_JSON", "Use a complete JSON row array; retain API page bodies separately.")
    columns = list(dict.fromkeys(k for row in rows for k in row))
    require(columns and len(columns) <= MAX_COLUMNS and all(isinstance(c, str) and c for c in columns),
            "FINANCE_COLUMNS", "The original JSON table needs named columns.")
    require(all(all(v is None or isinstance(v, (str, bool)) for v in row.values()) for row in rows),
            "FINANCE_NESTING", "Select a reviewed flat export; nested vendor values require an explicit source transformation.")
    return columns, rows

def unique_pairs(pairs):
    out = {}
    for key, value in pairs:
        require(key not in out, "FINANCE_DUPLICATE_KEY", "Original JSON repeats a member.", key=key)
        out[key] = value
    return out

def normalize(raw_rows, mapping):
    rows, counts = [], {}
    for ordinal, raw in enumerate(raw_rows, 1):
        key = [selected_cell(raw, c) for c in mapping["keys"]]
        issues = []
        if any(not x["present"] or x.get("value") in ("", None) for x in key):
            issues.append("MISSING_IDENTITY")
        amount = selected_cell(raw, mapping["amount"])
        try:
            decimal_value(amount.get("value"))
        except MigrationError:
            issues.append("INVALID_OR_ABSENT_AMOUNT")
        currency = (selected_cell(raw, mapping["currency"]["column"]) if "column" in mapping["currency"]
                    else {"present": True, "value": mapping["currency"]["constant"], "kind": "string"})
        if not isinstance(currency.get("value"), str) or not currency["value"].strip():
            issues.append("MISSING_CURRENCY")
        values = {field: selected_cell(raw, mapping[field]) if field in mapping else {"present": False} for field in FIXED}
        for field in ("posting_date", "document_date"):
            if values[field]["present"]:
                try: date_value(values[field].get("value"))
                except MigrationError: issues.append("INVALID_" + field.upper())
        row = {"ordinal": ordinal, "key": key, "key_sha256": identity(key), "raw": raw,
               "raw_types": {key: original_kind(value) for key, value in raw.items()},
               "amount": amount, "currency": currency, **values,
               "dimensions": {name: selected_cell(raw, col) for name, col in mapping.get("dimensions", {}).items()},
               "issues": issues}
        counts[row["key_sha256"]] = counts.get(row["key_sha256"], 0) + 1
        rows.append(row)
    for row in rows:
        if counts[row["key_sha256"]] > 1:
            row["issues"].append("DUPLICATE_IDENTITY")
    return rows

def validate_definition(value):
    strict_object(value, ("title", "family", "company", "tool", "native_files", "basis_role", "measure",
                          "currency_basis", "group_fields", "filters", "sign", "rounding", "review"),
                  ("budget_edition", "parent_id", "change_id", "description"))
    for field in ("title", "family", "company", "tool", "measure", "currency_basis"):
        text(value[field], field, max_length=4000)
    require(value["basis_role"] in ("actual", "budget", "commitment", "forecast"), "FINANCE_BASIS", "Keep each financial basis distinct.")
    if value["basis_role"] == "budget": text(value.get("budget_edition"), "budget edition")
    require(isinstance(value["native_files"], list) and value["native_files"], "FINANCE_NATIVE_FILES",
            "Retain the original report/workbook/row/column/configuration definitions before creating an edition.")
    groups = value["group_fields"]
    require(isinstance(groups, list) and groups and len(groups) <= 30 and len(set(groups)) == len(groups) and
            all(g == "account" or (isinstance(g, str) and g.startswith("dimension:") and len(g) > 10) for g in groups),
            "FINANCE_GROUPS", "Group by explicit account/dimension fields; currency is always part of each key.")
    require(isinstance(value["filters"], list), "FINANCE_FILTERS", "Use explicit exact-value filters.")
    for f in value["filters"]:
        strict_object(f, ("field", "values"))
        require(f["field"] in ("account", "currency") or f["field"].startswith("dimension:"),
                "FINANCE_FILTER", "Filter an explicit account, currency or dimension field.")
        require(isinstance(f["values"], list) and f["values"] and all(isinstance(v, str) for v in f["values"]),
                "FINANCE_FILTER", "Filter values are exact original strings; blank remains distinct from absent.")
    require(value["sign"] in ("1", "-1"), "FINANCE_SIGN", "Review the explicit sign convention.")
    rounding = strict_object(value["rounding"], ("mode", "scale"))
    require(rounding["mode"] in ("none", "half_even", "half_up"), "FINANCE_ROUND", "Choose the reviewed rounding convention.")
    integer(rounding["scale"], "rounding scale", maximum=18)
    review = strict_object(value["review"], ("actor", "note", "evidence_files"))
    text(review["actor"], "definition reviewer"); text(review["note"], "definition review")
    require(isinstance(review["evidence_files"], list), "FINANCE_EVIDENCE", "Retain reviewed definition evidence.")
    return value

def validate_period(value):
    strict_object(value, ("label", "start", "end", "date_basis", "mode"))
    text(value["label"], "period label")
    require(date_value(value["start"]) <= date_value(value["end"]), "FINANCE_PERIOD", "Period dates are reversed.")
    require(value["date_basis"] in ("posting_date", "document_date"), "FINANCE_DATE_BASIS", "Select posting date or document date explicitly.")
    require(value["mode"] in ("movement", "balance"), "FINANCE_PERIOD_MODE", "Choose net movement or opening-plus-movement balance.")
    return value

def basis(context):
    return {"company": context["company"], "basis_role": context.get("basis_role", context["role"]),
            "measure": context["measure"], "currency_basis": context["currency_basis"],
            "budget_edition": context.get("budget_edition")}

def compatible(definition, context):
    expected = {k: definition.get(k) for k in ("company", "basis_role", "measure", "currency_basis", "budget_edition")}
    require(basis(context) == expected, "FINANCE_SCOPE", "Company, financial basis, currency basis, measure or budget edition differs.",
            expected=expected, actual=basis(context))

def group_key(row, definition):
    parts = [cell(row, g) for g in definition["group_fields"]] + [row["currency"]]
    return parts, identity(parts)

def calculate(definition, dataset, rows, period, opening=None):
    validate_definition(definition); validate_period(period)
    context = dataset["context"]; compatible(definition, context)
    require(context["role"] == definition["basis_role"], "FINANCE_POPULATION", "Select the original transactional population.")
    require(context["window"]["start"] <= period["start"] and context["window"]["end"] >= period["end"],
            "FINANCE_WINDOW", "The selected source window does not cover the complete reporting period.")
    require((opening is not None) == (period["mode"] == "balance"), "FINANCE_OPENING",
            "A balance requires one explicit original opening-balance dataset; movement does not use one.")
    groups, population, exclusions, problems = {}, [], [], []
    quality = {"source_coverage": context["coverage"], "opening_coverage": None}
    def consume(row, source, opening_row=False):
        reasons = []
        day = cell(row, period["date_basis"])
        if not opening_row:
            try: date_value(day.get("value"))
            except MigrationError: reasons.append("INVALID_OR_ABSENT_SELECTED_DATE")
            if not reasons and not period["start"] <= day["value"] <= period["end"]:
                exclusions.append({"dataset_id": source["id"], "ordinal": row["ordinal"], "key_sha256": row["key_sha256"], "reason": "OUTSIDE_PERIOD"})
                return
        for f in definition["filters"]:
            selected = cell(row, f["field"])
            if not selected["present"] or selected.get("value") not in f["values"]:
                exclusions.append({"dataset_id": source["id"], "ordinal": row["ordinal"], "key_sha256": row["key_sha256"], "reason": "FILTER", "filter": f})
                return
        reasons += [x for x in row["issues"] if x not in ("INVALID_POSTING_DATE", "INVALID_DOCUMENT_DATE")]
        parts, key = group_key(row, definition)
        if any(not c["present"] or c.get("value") is None for c in parts): reasons.append("ABSENT_GROUP_KEY")
        ref = {"dataset_id": source["id"], "ordinal": row["ordinal"], "key_sha256": row["key_sha256"], "group_key": key, "opening": opening_row}
        if reasons:
            problems.append({**ref, "issues": sorted(set(reasons))}); return
        group = groups.setdefault(key, {"id": key, "key": parts, "values": [], "members": []})
        group["values"].append(row["amount"]["value"])
        group["members"].append(ref); population.append(ref)
    if opening:
        opened, opening_rows = opening
        compatible(definition, opened["context"])
        require(opened["context"]["role"] == "opening_balance" and
                opened["context"].get("opening_as_of") == (date.fromisoformat(period["start"]) - timedelta(days=1)).isoformat(),
                "FINANCE_OPENING", "Opening balances must identify the preceding calendar day and same reporting basis.")
        quality["opening_coverage"] = opened["context"]["coverage"]
        for row in opening_rows: consume(row, opened, True)
    for row in rows: consume(row, dataset)
    output = []
    with localcontext() as ctx:
        ctx.prec = 256
        for key in sorted(groups):
            group = groups[key]
            amount = sum_exact(group["values"]) * Decimal(definition["sign"])
            unrounded = decimal_text(amount)
            if definition["rounding"]["mode"] != "none":
                quantum = Decimal(1).scaleb(-definition["rounding"]["scale"])
                amount = amount.quantize(quantum, rounding=ROUND_HALF_EVEN if definition["rounding"]["mode"] == "half_even" else ROUND_HALF_UP)
            output.append({"id": key, "key": group["key"], "amount": decimal_text(amount), "unrounded": unrounded,
                           "members": group["members"], "member_count": len(group["members"])})
    return {"rows": output, "population": population, "exclusions": exclusions, "issues": problems,
            "quality": quality, "input_count": len(rows) + (len(opening[1]) if opening else 0),
            "included_count": len(population), "excluded_count": len(exclusions), "issue_count": len(problems),
            "complete": context["coverage"] == "complete" and
              (opening is None or opening[0]["context"]["coverage"] == "complete") and not problems,
            "meaning": "Exact selected source calculation. Completeness is the retained source review, not an independently inferred tenant population."}

def compare_output(definition, run, output_dataset, output_rows):
    compatible(definition, output_dataset["context"])
    require(output_dataset["context"]["role"] == "report_output", "FINANCE_OUTPUT", "Select an original native report output.")
    require(output_dataset["context"]["window"] == {"start": run["period"]["start"], "end": run["period"]["end"]},
            "FINANCE_OUTPUT_PERIOD", "The original native output's retained window differs from the selected complete period.")
    observed, items = {}, []
    for row in output_rows:
        parts, key = group_key(row, definition)
        observed.setdefault(key, []).append((parts, row))
    expected = {row["id"]: row for row in run["calculation"]["rows"]}
    for key in sorted(set(expected) | set(observed)):
        left, right = expected.get(key), observed.get(key, [])
        issues = [issue for _, row in right for issue in row["issues"]
                  if issue not in ("INVALID_POSTING_DATE", "INVALID_DOCUMENT_DATE")]
        if len(right) > 1: status = "AMBIGUOUS"
        elif issues: status = "UNKNOWN"
        elif left is None: status = "UNEXPECTED" if run["calculation"]["complete"] else "UNKNOWN"
        elif not right: status = "MISSING" if output_dataset["context"]["coverage"] == "complete" else "UNKNOWN"
        else: status = "MATCH" if decimal_value(left["amount"]) == decimal_value(right[0][1]["amount"]["value"]) else "DIFFERENT"
        actual = right[0][1]["amount"].get("value") if len(right) == 1 else None
        delta = None
        if left and actual is not None and not issues and len(right) == 1:
            delta = decimal_text(sum_exact([actual, decimal_value(left["amount"]).copy_negate()]))
        items.append({"id": key, "key": left["key"] if left else right[0][0], "status": status,
                      "expected": left["amount"] if left else None, "observed": actual, "delta": delta,
                      "expected_members": left["members"] if left else [],
                      "observed_ordinals": [row["ordinal"] for _, row in right], "issues": issues})
    counts = {status: sum(item["status"] == status for item in items)
              for status in ("MATCH", "DIFFERENT", "UNKNOWN", "AMBIGUOUS", "MISSING", "UNEXPECTED")}
    return {"items": items, "counts": counts, "expected_groups": len(expected), "observed_rows": len(output_rows),
            "complete": run["calculation"]["complete"] and output_dataset["context"]["coverage"] == "complete",
            "all_matched": run["calculation"]["complete"] and output_dataset["context"]["coverage"] == "complete" and all(item["status"] == "MATCH" for item in items),
            "meaning": "Every report key is compared separately. Equal grand totals never cancel row-level differences."}
