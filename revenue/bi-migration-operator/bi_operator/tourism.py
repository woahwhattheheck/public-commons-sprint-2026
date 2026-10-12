"""City tourism funding, monthly forecasting and source-bound reporting.

Uses the existing versioned Store and original operation journal. All money is
integer minor units; collections, distributions and operator cash stay separate.
"""
from __future__ import annotations

import base64
import copy
import csv
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP, localcontext
from datetime import date
import html
import io
import json
from pathlib import Path
import re
import zipfile
from .store import Conflict, digest, encoded, identifier, now

KINDS = ("tourism_source", "tourism_fund", "tourism_plan", "tourism_period", "tourism_export")
TABLES = ("collections", "distributions", "cash", "budgets", "lodging", "demand")
MAX_ROWS = 100000
MONEY_LIMIT = 9000000000000000
BUDGET_MONEY = ("opening_cash", "operating_reserve", "tgt_income", "other_income",
                "personnel", "sales_marketing", "administration",
                "reported_resources", "reported_available", "reported_expenditures",
                "reported_closing")
CASH_SIGN = {"receipt": 1, "expense": -1, "receipt_return": -1, "expense_return": 1}
FIELDS = {
    "collections": ("period", "amount", "jurisdiction", "basis", "source_ref"),
    "distributions": ("start", "end", "amount", "jurisdiction", "basis", "source_ref"),
    "cash": ("entry_id", "date", "direction", "amount", "fund", "category", "program",
             "counterparty", "original_entry_id", "source_ref", "note"),
    "budgets": ("budget_id", "year", "status", "jurisdiction", *BUDGET_MONEY, "source_ref"),
    "lodging": ("period", "provider", "market", "occupancy_pct", "adr",
                "available_rooms", "source_ref"),
    "demand": ("event_id", "period", "label", "room_nights", "basis", "source_ref"),
}


def text(value, maximum=10000, required=False):
    if value is None:
        value = ""
    if not isinstance(value, str):
        value = str(value)
    value = value.strip()
    if len(value) > maximum or any(ord(c) < 32 and c not in "\n\t\r" for c in value):
        raise ValueError("A text field is too long or contains control characters.")
    if required and not value:
        raise ValueError("Complete the required source or review field.")
    return value


def decimal(value, title="Number"):
    raw = str(value).replace(",", "").replace("$", "").strip()
    if len(raw) > 300:
        raise ValueError(title + " is too long.")
    try:
        result = Decimal(raw)
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError(title + " must be a finite decimal number.") from None
    if not result.is_finite():
        raise ValueError(title + " must be a finite decimal number.")
    return result


def integer(value, low, high, title):
    if isinstance(value, bool) or not re.fullmatch(r"-?\d+", str(value)):
        raise ValueError(title + " must be a whole number.")
    number = int(value)
    if not low <= number <= high:
        raise ValueError(title + " is outside its supported range.")
    return number


def bounded_money(value, title="Calculated amount"):
    number = int(value)
    if abs(number) > MONEY_LIMIT:
        raise ValueError(title + " exceeds the supported exact currency range.")
    return number


def sum_money(values, title="Calculated total"):
    return bounded_money(sum(values), title)


def money(value, units=2, title="Amount", allow_negative=False):
    amount = decimal(value, title)
    parts = amount.as_tuple()
    coefficient = int("".join(map(str, parts.digits)))
    if coefficient == 0:
        return 0
    scale = parts.exponent + units
    if scale >= 0:
        if len(parts.digits) + scale > len(str(MONEY_LIMIT)):
            raise ValueError(title + " is outside its supported range.")
        number = coefficient * (10 ** scale)
    else:
        places = -scale
        if places > len(parts.digits) or coefficient % (10 ** places):
            raise ValueError(title + " has more precision than the selected currency.")
        number = coefficient // (10 ** places)
    if parts.sign:
        number = -number
    if number < 0 and not allow_negative:
        raise ValueError(title + " must be nonnegative.")
    return bounded_money(number, title)


def money_text(value, units=2):
    return format(Decimal(int(value)) / Decimal(10 ** units), "." + str(units) + "f")


def rounded(value):
    return bounded_money(Decimal(value).to_integral_value(rounding=ROUND_HALF_UP))


def scaled_money(value, factor, adjustment=0):
    with localcontext() as context:
        context.prec = 60
        return bounded_money(rounded(Decimal(value) * factor) + adjustment)


def month(value):
    value = text(value, 7, True)
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", value) or not 1900 <= int(value[:4]) <= 2200:
        raise ValueError("Use a calendar month in YYYY-MM form.")
    return value


def month_number(value):
    year, part = map(int, month(value).split("-"))
    return year * 12 + part - 1


def shifted(value, count):
    y, m = divmod(month_number(value) + count, 12)
    return f"{y:04d}-{m + 1:02d}"


def month_range(start, end):
    start, end = month(start), month(end)
    count = month_number(end) - month_number(start)
    if not 0 <= count <= 1200:
        raise ValueError("The source period is reversed or longer than 100 years.")
    return [shifted(start, i) for i in range(count + 1)]


def strict_json(data):
    def pairs(values):
        result = {}
        for key, value in values:
            if key in result:
                raise ValueError("JSON contains a repeated key: " + str(key))
            result[key] = value
        return result
    return json.loads(data, object_pairs_hook=pairs,
                      parse_constant=lambda value: (_ for _ in ()).throw(
                          ValueError("JSON contains a nonfinite number.")))


def csv_bytes(headers, rows):
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=headers, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({key: row.get(key, "") for key in headers})
    return output.getvalue().encode("utf-8")


def normalise_row(kind, raw, index, units, defaults):
    if not isinstance(raw, dict):
        raise ValueError("Every source row must be an object.")
    row = {key: raw.get(key, defaults.get(key, "")) for key in FIELDS[kind]}
    row["source_ref"] = text(row.get("source_ref") or defaults.get("source_ref") or
                             f"{defaults['filename']}#row={index}", 3000, True)
    row["source_row"] = index
    if kind in ("collections", "distributions", "budgets"):
        row["jurisdiction"] = text(row["jurisdiction"], 200, True)
    if kind in ("collections", "distributions"):
        row["amount_minor"] = money(row.pop("amount"), units, allow_negative=True)
        row["basis"] = text(row["basis"], 180, True)
        if kind == "collections":
            row["period"] = month(row["period"])
        else:
            row["start"], row["end"] = month(row["start"]), month(row["end"])
            month_range(row["start"], row["end"])
    elif kind == "cash":
        row["entry_id"] = identifier(row["entry_id"])
        row["date"] = date.fromisoformat(text(row["date"], 10, True)).isoformat()
        row["direction"] = text(row["direction"], 30, True)
        if row["direction"] not in CASH_SIGN:
            raise ValueError("Cash direction must be receipt, expense, receipt_return or expense_return.")
        row["amount_minor"] = money(row.pop("amount"), units)
        for field in ("fund", "category", "program"):
            row[field] = text(row[field], 200, True)
        row["counterparty"] = text(row["counterparty"], 300)
        row["original_entry_id"] = text(row["original_entry_id"], 100)
        if row["direction"].endswith("_return") and not row["original_entry_id"]:
            raise ValueError("A cash return must identify its original entry.")
        row["note"] = text(row["note"])
    elif kind == "budgets":
        row["budget_id"] = identifier(row["budget_id"])
        row["year"] = integer(row["year"], 1900, 2200, "Budget year")
        row["status"] = text(row["status"], 20, True).upper()
        if row["status"] not in ("ACTUAL", "BUDGET", "ESTIMATE", "PROPOSED"):
            raise ValueError("Retain the original ACTUAL, BUDGET, ESTIMATE or PROPOSED budget column.")
        for field in BUDGET_MONEY:
            row[field + "_minor"] = money(row.pop(field), units, field.replace("_", " "),
                                          allow_negative=field in ("opening_cash", "reported_closing"))
    elif kind == "lodging":
        row["period"] = month(row["period"])
        row["provider"] = text(row["provider"], 180, True)
        row["market"] = text(row["market"], 300, True)
        if not any(str(row[k]).strip() for k in ("occupancy_pct", "adr", "available_rooms")):
            raise ValueError("Retain at least one lodging metric.")
        for field in ("occupancy_pct", "available_rooms"):
            if str(row[field]).strip():
                value = decimal(row[field], field)
                if value < 0 or (field == "occupancy_pct" and value > 100):
                    raise ValueError("Lodging occupancy is 0–100 percent; available rooms are nonnegative.")
                row[field] = str(value)
            else:
                row[field] = None
        row["adr_minor"] = money(row["adr"], units, "ADR") if str(row["adr"]).strip() else None
        row.pop("adr")
    elif kind == "demand":
        row["event_id"] = identifier(row["event_id"])
        row["period"] = month(row["period"])
        row["label"], row["basis"] = text(row["label"], 300, True), text(row["basis"], 500, True)
        row["room_nights"] = integer(row["room_nights"], 0, 1000000000, "Room nights")
    return row


def parse_source(data, filename, request):
    units = integer(request.get("minor_unit", 2), 0, 4, "Currency minor unit")
    currency = text(request.get("currency", "USD"), 3, True).upper()
    if not re.fullmatch("[A-Z]{3}", currency):
        raise ValueError("Use the three-letter source currency.")
    given_defaults = request.get("defaults", {})
    if not isinstance(given_defaults, dict):
        raise ValueError("Source defaults must be an object.")
    defaults = {**given_defaults, "filename": filename}
    documents = []
    if filename.lower().endswith(".json"):
        packet = strict_json(data.decode("utf-8-sig"))
        if not isinstance(packet, dict) or packet.get("schema") != "commons.tourism-source.v1" or not isinstance(packet.get("tables"), dict):
            raise ValueError("Select a commons.tourism-source.v1 JSON packet, or map a CSV source.")
        if packet.get("currency", currency) != currency or packet.get("minor_unit", units) != units:
            raise ValueError("The packet's currency differs from this import.")
        unknown = set(packet["tables"]) - set(TABLES)
        if unknown:
            raise ValueError("The packet contains an unknown source table.")
        tables = packet["tables"]
        documents = packet.get("source_documents", [])
        if not isinstance(documents, list) or len(documents) > 1000:
            raise ValueError("The source document inventory is invalid.")
        for document in documents:
            if not isinstance(document, dict):
                raise ValueError("Each source document needs a title and original URL.")
            text(document.get("title"), 500, True)
            text(document.get("url"), 3000, True)
    else:
        kind = request.get("table")
        if kind not in TABLES:
            raise ValueError("Choose the kind of CSV source.")
        reader = csv.DictReader(io.StringIO(data.decode("utf-8-sig"), newline=""))
        headers = reader.fieldnames or []
        if not headers or len(set(headers)) != len(headers) or len(headers) > 256:
            raise ValueError("Use a CSV with distinct named columns.")
        mapping = request.get("mapping", {})
        if not isinstance(mapping, dict):
            raise ValueError("Column mapping must be an object.")
        for field, column in mapping.items():
            if field not in FIELDS[kind] or (column is not None and column not in headers):
                raise ValueError("A selected source column does not exist.")
        rows = []
        for raw in reader:
            if None in raw:
                raise ValueError("A CSV row has more fields than its header.")
            rows.append({field: (defaults.get(field, "") if mapping.get(field, field) is None else
                                 raw.get(mapping.get(field, field), defaults.get(field, "")))
                         for field in FIELDS[kind]})
            if len(rows) > MAX_ROWS:
                raise ValueError("One source may contain at most 100,000 rows.")
        tables = {kind: rows}
    if any(not isinstance(rows, list) for rows in tables.values()):
        raise ValueError("Each source table must be an array.")
    if not any(tables.values()) or sum(len(rows) for rows in tables.values()) > MAX_ROWS:
        raise ValueError("Import between one and 100,000 source rows.")
    normalised = {}
    for kind, rows in tables.items():
        if not isinstance(rows, list):
            raise ValueError("Each source table must be an array.")
        normalised[kind] = [normalise_row(kind, row, index, units, defaults)
                            for index, row in enumerate(rows, 1)]
    return {"schema": "commons.tourism-normalised.v1", "currency": currency, "minor_unit": units,
            "tables": normalised, "source_documents": documents}


def source_control_rows(tables, jurisdiction):
    observations = {r["period"]: r for r in tables.get("collections", [])
                    if r["jurisdiction"] == jurisdiction}
    checks = []
    for row in tables.get("distributions", []):
        if row["jurisdiction"] != jurisdiction:
            continue
        periods = month_range(row["start"], row["end"])
        selected = [observations[p] for p in periods if p in observations]
        same_basis = len({r["basis"] for r in selected}) <= 1
        subtotal = sum_money((r["amount_minor"] for r in selected), "Selected collection subtotal")
        checks.append({"start": row["start"], "end": row["end"],
            "published_distribution_minor": row["amount_minor"],
            "collection_subtotal_minor": subtotal,
            "missing_months": [p for p in periods if p not in observations],
            "collection_basis": selected[0]["basis"] if selected else "",
            "distribution_basis": row["basis"], "source_ref": row["source_ref"],
            "difference_minor": bounded_money(row["amount_minor"] - subtotal, "Distribution difference"),
            "complete_collection_window": len(selected) == len(periods) and same_basis,
            "meaning": "Published distributions are retained independently from monthly collections."})
    return checks


def unique_rows(tables):
    keys = {
        "collections": lambda r: (r["jurisdiction"], r["period"]),
        "distributions": lambda r: (r["jurisdiction"], r["start"], r["end"], r["basis"]),
        "cash": lambda r: r["entry_id"],
        "budgets": lambda r: r["budget_id"],
        "lodging": lambda r: (r["provider"], r["market"], r["period"]),
        "demand": lambda r: r["event_id"],
    }
    for kind, rows in tables.items():
        seen = set()
        for row in rows:
            key = keys[kind](row)
            if key in seen:
                raise ValueError("Overlapping " + kind + " rows were selected. Choose one retained source edition.")
            seen.add(key)


def ratio_at(observations, as_of, window):
    pairs = []
    for offset in range(window - 1, -1, -1):
        current = shifted(as_of, -offset)
        prior = shifted(current, -12)
        if current not in observations or prior not in observations:
            raise ValueError("The seasonal comparison needs both " + current + " and " + prior +
                             ". Import the original month or choose an explicit fixed growth assumption.")
        pairs.append({"current": current, "prior": prior,
                      "current_minor": observations[current]["amount_minor"],
                      "prior_minor": observations[prior]["amount_minor"]})
    denominator = sum(p["prior_minor"] for p in pairs)
    if denominator <= 0:
        raise ValueError("The prior-year comparison has a zero denominator.")
    with localcontext() as context:
        context.prec = 40
        ratio = Decimal(sum(p["current_minor"] for p in pairs)) / Decimal(denominator)
    return ratio, pairs


def forecast(plan, observations):
    periods = month_range(plan["start"], shifted(plan["start"], 11))
    actual_end = plan["as_of"]
    if plan["method"] == "seasonal_ratio":
        factor, pairs = ratio_at(observations, actual_end, plan["comparison_months"])
    else:
        factor = Decimal(1) + Decimal(plan["growth_bps"]) / Decimal(10000)
        pairs = []
    adjustments = {row["period"]: row for row in plan["adjustments"]}
    output = []
    for period in periods:
        if period <= actual_end:
            row = observations.get(period)
            output.append({"period": period, "state": "OBSERVED" if row else "MISSING",
                "observed_minor": row["amount_minor"] if row else None,
                "base_minor": row["amount_minor"] if row else None,
                "downside_minor": row["amount_minor"] if row else None,
                "upside_minor": row["amount_minor"] if row else None,
                "source_refs": [row["source_ref"]] if row else [],
                "baseline_period": None, "adjustment": None})
            continue
        baseline = shifted(period, -12)
        if baseline not in observations:
            raise ValueError("Forecast " + period + " needs the original " + baseline + " collection.")
        value = observations[baseline]["amount_minor"]
        adjustment = adjustments.get(period)
        shift = adjustment["amount_minor"] if adjustment else 0
        scenario = {}
        for name, bps in (("base", 0), ("downside", plan["downside_bps"]), ("upside", plan["upside_bps"])):
            with localcontext() as context:
                context.prec = 60
                # Percentage-point sensitivities use the original baseline's magnitude.
                # A published net correction keeps its sign in the base projection.
                projection = Decimal(value) * factor + Decimal(abs(value)) * Decimal(bps) / Decimal(10000)
                result = bounded_money(rounded(projection) + shift)
            if result < 0:
                raise ValueError("Forecast " + period + " is negative after its " + baseline +
                                 " baseline. Review its explicit growth or source-based adjustment.")
            scenario[name + "_minor"] = result
        output.append({"period": period, "state": "FORECAST", "observed_minor": None,
            **scenario, "source_refs": [observations[baseline]["source_ref"]],
            "baseline_period": baseline, "adjustment": adjustment})
    backtest = []
    for period in periods:
        if period > actual_end or period not in observations or shifted(period, -12) not in observations:
            continue
        try:
            if plan["method"] == "seasonal_ratio":
                trial, trial_pairs = ratio_at(observations, shifted(period, -1), plan["comparison_months"])
            else:
                trial, trial_pairs = factor, []
        except ValueError:
            continue
        prediction = scaled_money(observations[shifted(period, -12)]["amount_minor"], trial)
        actual = observations[period]["amount_minor"]
        backtest.append({"period": period, "forecast_minor": prediction, "observed_minor": actual,
            "error_minor": bounded_money(prediction - actual, "Historical error"),
            "absolute_error_minor": bounded_money(abs(prediction - actual), "Absolute historical error"),
            "calibration_ends": shifted(period, -1), "pairs": trial_pairs,
            "actual_source_ref": observations[period]["source_ref"]})
    denominator = sum(abs(r["observed_minor"]) for r in backtest)
    error = sum(r["absolute_error_minor"] for r in backtest)
    return {"months": output, "factor": str(factor), "calibration_pairs": pairs, "backtest": backtest,
        "backtest_wape": str(Decimal(error) / Decimal(denominator)) if denominator else None,
        "backtest_mean_error_minor": str(Decimal(sum(r["error_minor"] for r in backtest)) /
                                            Decimal(len(backtest))) if backtest else None,
        "backtest_method": "Rolling historical forecast using earlier calendar-month rows in the selected source editions; no manual event adjustment or archived publication-vintage reconstruction.",
        "scenarios": "The base uses the signed original prior-year collection multiplied by the selected growth factor. Downside and upside add their basis-point changes against the absolute prior-year collection, then apply the same explicit future-month adjustment. This preserves directional sensitivities when a publisher reports a negative net correction; the ranges are not statistical confidence intervals."}


def budget_report(row):
    resources = sum_money((row[k + "_minor"] for k in ("opening_cash", "operating_reserve", "tgt_income", "other_income")), "Budget resources")
    expenses = sum_money((row[k + "_minor"] for k in ("personnel", "sales_marketing", "administration")), "Budget expenditures")
    available = bounded_money(resources - row["operating_reserve_minor"], "Available budget resources")
    closing = bounded_money(resources - expenses, "Budget closing balance")
    computed = {"resources": resources, "available": available, "expenditures": expenses, "closing": closing}
    return {**row, "calculated": computed,
            "reported_differences": {k: bounded_money(row["reported_" + k + "_minor"] - value, "Budget difference") for k, value in computed.items()}}


def cash_report(rows, fund, start, end):
    selected = [row for row in rows if row["fund"] == fund["fund_code"]]
    by_id = {row["entry_id"]: row for row in selected}
    returned = {}
    for row in selected:
        if not row["direction"].endswith("_return"):
            continue
        original = by_id.get(row["original_entry_id"])
        expected = "receipt" if row["direction"] == "receipt_return" else "expense"
        if not original or original["direction"] != expected or original["date"] > row["date"]:
            raise ValueError("Every cash return needs its original same-fund receipt or expenditure.")
        returned[original["entry_id"]] = returned.get(original["entry_id"], 0) + row["amount_minor"]
        if returned[original["entry_id"]] > original["amount_minor"]:
            raise ValueError("Selected returns exceed their original cash entry.")
    in_period = [r for r in selected if start <= r["date"][:7] <= end]
    groups = {}
    for row in in_period:
        key = (row["category"], row["program"])
        group = groups.setdefault(key, {"category": key[0], "program": key[1],
            "receipts_minor": 0, "expenditures_minor": 0, "receipt_returns_minor": 0, "expense_returns_minor": 0})
        field = {"receipt": "receipts_minor", "expense": "expenditures_minor",
                 "receipt_return": "receipt_returns_minor", "expense_return": "expense_returns_minor"}[row["direction"]]
        group[field] += row["amount_minor"]
    for group in groups.values():
        for field in ("receipts_minor", "expenditures_minor", "receipt_returns_minor", "expense_returns_minor"):
            group[field] = bounded_money(group[field], "Category cash total")
        group["net_receipts_minor"] = bounded_money(group["receipts_minor"] - group["receipt_returns_minor"], "Net receipts")
        group["net_expenditures_minor"] = bounded_money(group["expenditures_minor"] - group["expense_returns_minor"], "Net expenditures")
    totals = {field: sum_money((g[field] for g in groups.values()), "Fund cash total") for field in
              ("receipts_minor", "expenditures_minor", "receipt_returns_minor", "expense_returns_minor",
               "net_receipts_minor", "net_expenditures_minor")}
    opening = fund["opening_cash_minor"]
    return {"rows": in_period, "groups": list(groups.values()), "totals": totals,
        "opening_cash_minor": opening,
        "closing_cash_minor": bounded_money(opening + totals["net_receipts_minor"] - totals["net_expenditures_minor"], "Closing cash"),
        "recorded_reserve_minor": fund["reserve_minor"],
        "coverage": "SELECTED_OPERATOR_CASH" if in_period else "NO_OPERATOR_CASH_SELECTED",
        "meaning": "Only imported operator receipts and expenditures affect this cash statement."}


class Tourism:
    def __init__(self, service):
        self.service, self.store = service, service.store
        self.actions = {
            "tourism.source.prepare": self.source_prepare,
            "tourism.source.accept": self.source_accept,
            "tourism.example": self.example,
            "tourism.fund.save": self.fund_save,
            "tourism.plan.save": self.plan_save,
            "tourism.period.prepare": self.period_prepare,
            "tourism.period.review": self.period_review,
            "tourism.period.finalize": self.period_finalize,
            "tourism.period.reopen": self.period_reopen,
            "tourism.period.export": self.period_export,
        }

    def ref(self, record):
        return self.service.reference(record)

    def record(self, kind, reference):
        if not isinstance(reference, dict) or reference.get("kind", kind) != kind:
            raise ValueError("Select an exact retained " + kind + " revision.")
        return self.store.get(kind, reference["id"], integer(reference["revision"], 1, 1000000000, "Revision"))

    def write(self, kind, payload, request=None):
        request = request or {}
        return self.service.write(kind, payload, request.get("id"), request.get("expected", 0))

    def json_blob(self, value, name):
        return self.store.blob((encoded(value) + "\n").encode(), name, "application/json")

    def source_prepare(self, request):
        try:
            data = base64.b64decode(request["base64"], validate=True)
        except (KeyError, ValueError):
            raise ValueError("Choose a complete CSV or tourism source JSON file.") from None
        if len(data) > 64 * 1024 * 1024:
            raise ValueError("One original source may contain at most 64 MiB.")
        filename = Path(text(request.get("filename"), 300, True)).name
        parsed = parse_source(data, filename, request)
        unique_rows(parsed["tables"])
        original = self.store.blob(data, filename, "application/json" if filename.endswith(".json") else "text/csv")
        normalised = self.json_blob(parsed, "tourism-normalised.json")
        parent = self.record("tourism_source", request["parent"]) if request.get("parent") else None
        if parent and not text(request.get("correction_note")):
            raise ValueError("Describe why this source edition replaces its predecessor.")
        return self.write("tourism_source", {
            "label": text(request.get("label", filename), 300, True), "state": "DRAFT",
            "currency": parsed["currency"], "minor_unit": parsed["minor_unit"],
            "original": original, "normalised": normalised,
            "tables": {kind: len(rows) for kind, rows in parsed["tables"].items()},
            "source_url": text(request.get("source_url"), 3000),
            "source_documents": parsed["source_documents"], "mapping": request.get("mapping", {}),
            "defaults": request.get("defaults", {}), "parent": self.ref(parent) if parent else None,
            "correction_note": text(request.get("correction_note")), "created": now()})

    def example(self, request):
        path = Path(__file__).resolve().parent.parent / "examples" / "overland-park" / "public-source.json"
        return self.source_prepare({"filename": path.name, "base64": base64.b64encode(path.read_bytes()).decode(),
            "label": "Overland Park — original public collections and budget",
            "source_url": "https://www.ksrevenue.gov/prtgreports.html", "currency": "USD", "minor_unit": 2})

    def source_accept(self, request):
        record = self.store.get("tourism_source", request["id"])
        if record["payload"]["state"] != "DRAFT":
            raise ValueError("This original source edition has already been accepted.")
        payload = {**record["payload"], "state": "ACCEPTED",
            "review": {"note": text(request.get("note"), required=True), "actor": self.service.actor, "at": now()}}
        return self.write("tourism_source", payload, request)

    def fund_save(self, request):
        payload = request.get("fund", {})
        units = integer(payload.get("minor_unit", 2), 0, 4, "Currency minor unit")
        currency = text(payload.get("currency", "USD"), 3, True).upper()
        if not re.fullmatch("[A-Z]{3}", currency):
            raise ValueError("Use the three-letter fund currency.")
        numerator = integer(payload.get("allocation_numerator", 2), 0, 1000000, "Allocation numerator")
        denominator = integer(payload.get("allocation_denominator", 9), 1, 1000000, "Allocation denominator")
        if numerator > denominator:
            raise ValueError("The planning allocation cannot exceed the selected collection.")
        value = {
            "label": text(payload.get("label"), 300, True),
            "fund_code": identifier(payload.get("fund_code", "TGT")),
            "jurisdiction": text(payload.get("jurisdiction"), 200, True),
            "currency": currency, "minor_unit": units,
            "opening_period": month(payload.get("opening_period")),
            "opening_cash_minor": money(payload.get("opening_cash", "0"), units, allow_negative=True),
            "reserve_minor": money(payload.get("reserve", "0"), units),
            "opening_basis": text(payload.get("opening_basis"), required=True),
            "allocation_numerator": numerator, "allocation_denominator": denominator,
            "allocation_basis": text(payload.get("allocation_basis"), required=True),
            "timezone": text(payload.get("timezone", "America/Chicago"), 100, True),
            "annual_plan": text(payload.get("annual_plan"), 40000),
            "source_url": text(payload.get("source_url"), 3000),
        }
        return self.write("tourism_fund", value, request)

    def selected_sources(self, references, fund):
        if not isinstance(references, list) or not 1 <= len(references) <= 500:
            raise ValueError("Select one or more accepted original source editions.")
        seen, records = set(), []
        tables = {kind: [] for kind in TABLES}
        for reference in references:
            record = self.record("tourism_source", reference)
            if record["id"] in seen:
                raise ValueError("Choose one edition of each source.")
            seen.add(record["id"])
            payload = record["payload"]
            if payload["state"] != "ACCEPTED":
                raise ValueError("Review and accept each original source before preparing the report.")
            if (payload["currency"], payload["minor_unit"]) != (fund["currency"], fund["minor_unit"]):
                raise ValueError("The selected source currency differs from the fund.")
            parsed = strict_json(self.store.bytes(payload["normalised"]["digest"]))
            for kind, rows in parsed["tables"].items():
                for row in rows:
                    tables[kind].append({**row, "input": self.ref(record)})
            records.append(record)
        unique_rows(tables)
        return records, tables

    def plan_save(self, request):
        raw = request.get("plan", {})
        fund = self.record("tourism_fund", raw.get("fund"))
        sources, tables = self.selected_sources(raw.get("sources"), fund["payload"])
        start, as_of = month(raw.get("start")), month(raw.get("as_of"))
        end = shifted(start, 11)
        if not start <= as_of <= end:
            raise ValueError("Choose an as-of month within the twelve-month reporting year.")
        if fund["payload"]["opening_period"] != start:
            raise ValueError("The fund's opening balance period must match the reporting start.")
        method = raw.get("method", "seasonal_ratio")
        if method not in ("seasonal_ratio", "fixed_growth"):
            raise ValueError("Choose seasonal ratio or explicit fixed growth.")
        adjustments = []
        seen = set()
        for value in raw.get("adjustments", []):
            period = month(value["period"])
            if period in seen or not as_of < period <= end:
                raise ValueError("Each adjustment must identify one distinct future month in this reporting year.")
            seen.add(period)
            adjustments.append({"period": period,
                "amount_minor": money(value["amount"], fund["payload"]["minor_unit"], allow_negative=True),
                "basis": text(value.get("basis"), required=True),
                "source_ref": text(value.get("source_ref"), 3000, True)})
        downside = integer(raw.get("downside_bps", -500), -10000, 100000, "Downside basis points")
        upside = integer(raw.get("upside_bps", 500), -10000, 100000, "Upside basis points")
        if downside > 0 or upside < 0:
            raise ValueError("Downside is a nonpositive growth change and upside is nonnegative.")
        budget_id = text(raw.get("budget_id"), 100)
        if budget_id and not any(r["budget_id"] == budget_id and
                                 r["jurisdiction"] == fund["payload"]["jurisdiction"] for r in tables["budgets"]):
            raise ValueError("Select a budget row for this exact jurisdiction.")
        value = {"label": text(raw.get("label"), 300, True), "fund": self.ref(fund),
            "sources": [self.ref(r) for r in sources], "start": start, "as_of": as_of,
            "method": method, "comparison_months": integer(raw.get("comparison_months", 6), 1, 12, "Comparison months"),
            "growth_bps": integer(raw.get("growth_bps", 0), -10000, 100000, "Growth basis points"),
            "downside_bps": downside, "upside_bps": upside, "adjustments": adjustments,
            "budget_id": budget_id, "assumptions": text(raw.get("assumptions"), 20000, True),
            "annual_plan": text(raw.get("annual_plan", fund["payload"]["annual_plan"]), 40000),
            "prepared_by": self.service.actor}
        return self.write("tourism_plan", value, request)

    def period_prepare(self, request):
        plan_record = self.record("tourism_plan", request.get("plan"))
        plan = plan_record["payload"]
        fund_record = self.record("tourism_fund", plan["fund"])
        fund = fund_record["payload"]
        sources, tables = self.selected_sources(plan["sources"], fund)
        selected = [r for r in tables["collections"] if r["jurisdiction"] == fund["jurisdiction"]]
        if not selected:
            raise ValueError("Select monthly collections for this jurisdiction.")
        if len({r["basis"] for r in selected}) != 1:
            raise ValueError("Select a single consistent collection basis; net, gross and distributions cannot be combined.")
        observations = {r["period"]: r for r in selected if r["period"] <= plan["as_of"]}
        result = forecast(plan, observations)
        totals = {}
        for column in ("observed_minor", "base_minor", "downside_minor", "upside_minor"):
            values = [r[column] for r in result["months"] if r[column] is not None]
            totals[column] = sum_money(values, "Reporting year total")
        ratio = Decimal(fund["allocation_numerator"]) / Decimal(fund["allocation_denominator"])
        for row in result["months"]:
            row["planning_allocation_minor"] = scaled_money(row["base_minor"], ratio) if row["base_minor"] is not None else None
        totals["planning_allocation_minor"] = sum_money((r["planning_allocation_minor"] or 0 for r in result["months"]), "Annual planning allocation")
        result.update({"totals": totals, "missing_observed_months": [r["period"] for r in result["months"] if r["state"] == "MISSING"],
            "collection_basis": selected[0]["basis"], "planning_allocation_basis": fund["allocation_basis"],
            "planning_allocation_meaning": "A forecast allocation is distinct from a recorded city distribution or operator receipt."})
        controls = source_control_rows(tables, fund["jurisdiction"])
        budgets = [budget_report(r) for r in tables["budgets"] if r["jurisdiction"] == fund["jurisdiction"]]
        selected_budget = next((r for r in budgets if r["budget_id"] == plan["budget_id"]), None)
        cash = cash_report(tables["cash"], fund, plan["start"], plan["as_of"])
        issues = []
        if result["missing_observed_months"]:
            issues.append({"id": "missing-months", "detail": "Actual collection months are missing: " + ", ".join(result["missing_observed_months"])})
        for row in budgets:
            if any(row["reported_differences"].values()):
                issues.append({"id": "budget-" + row["budget_id"],
                    "detail": "The original budget's reported totals differ from its component arithmetic.",
                    "differences_minor": row["reported_differences"]})
        for index, control in enumerate(controls):
            if control["complete_collection_window"] and control["difference_minor"]:
                issues.append({"id": "distribution-" + str(index),
                    "detail": "Published distribution differs from the same-window net collections.",
                    "difference_minor": control["difference_minor"]})
        snapshot = {"schema": "commons.tourism-report.v1", "fund": fund_record, "plan": plan_record,
            "sources": sources, "forecast": result, "controls": controls, "budgets": budgets,
            "selected_budget": selected_budget, "cash": cash,
            "lodging": tables["lodging"], "demand": tables["demand"], "issues": issues}
        report = self.json_blob(snapshot, "tourism-prepared-report.json")
        return self.write("tourism_period", {"label": plan["label"], "state": "PREPARED",
            "plan": self.ref(plan_record), "fund": self.ref(fund_record), "start": plan["start"], "end": shifted(plan["start"], 11),
            "as_of": plan["as_of"], "report": report, "currency": fund["currency"], "minor_unit": fund["minor_unit"],
            "totals": totals, "issues": issues, "cash_coverage": cash["coverage"],
            "source_count": len(sources), "prepared": now()})

    def period_review(self, request):
        record = self.store.get("tourism_period", request["id"])
        if record["payload"]["state"] not in ("PREPARED", "REVIEWED"):
            raise ValueError("Reopen a finalized report before a new review.")
        acknowledged = request.get("acknowledged", [])
        required = {item["id"] for item in record["payload"]["issues"]}
        if not isinstance(acknowledged, list) or set(acknowledged) != required:
            raise ValueError("Review each listed source difference without changing the original values.")
        payload = {**record["payload"], "state": "REVIEWED",
            "review": {"actor": self.service.actor, "note": text(request.get("note"), 20000, True),
                      "acknowledged": sorted(required), "report_digest": record["payload"]["report"]["digest"], "at": now()}}
        return self.write("tourism_period", payload, request)

    def period_finalize(self, request):
        record = self.store.get("tourism_period", request["id"])
        payload = record["payload"]
        if payload["state"] != "REVIEWED" or payload["review"]["report_digest"] != payload["report"]["digest"]:
            raise ValueError("Review this exact prepared report before finalizing.")
        if request.get("expected_report_digest") != payload["report"]["digest"]:
            raise Conflict("The prepared report changed; reopen the current review.")
        return self.write("tourism_period", {**payload, "state": "FINALIZED", "finalized": now()}, request)

    def period_reopen(self, request):
        record = self.store.get("tourism_period", request["id"])
        if record["payload"]["state"] != "FINALIZED":
            raise ValueError("Choose a finalized report.")
        payload = {**record["payload"], "state": "PREPARED",
            "prior_finalized": self.ref(record), "reopen_note": text(request.get("note"), required=True)}
        payload.pop("review", None)
        payload.pop("finalized", None)
        return self.write("tourism_period", payload, request)

    def period_export(self, request):
        from .tourism_export import export_report
        record = self.record("tourism_period", request.get("period"))
        if record["payload"]["state"] != "FINALIZED":
            raise ValueError("Finalize the exact report edition before export.")
        files, summary = export_report(self.store, record)
        manifest = {"schema": "commons.tourism-export.v1", "period": self.ref(record),
                    "report_sha256": record["payload"]["report"]["digest"],
                    "files": [{"name": name, "bytes": len(data), "sha256": digest(data)}
                              for name, data in sorted(files.items())]}
        files["manifest.json"] = (encoded(manifest) + "\n").encode()
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as package:
            for name, data in sorted(files.items()):
                info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100600 << 16
                package.writestr(info, data)
        package = self.store.blob(output.getvalue(), "Tourism_Reporting_Complete.zip", "application/zip")
        return self.write("tourism_export", {"label": record["payload"]["label"] + " — finalized r" + str(record["revision"]),
            "period": self.ref(record), "package": package, "files": len(files), "summary": summary,
            "manifest": self.json_blob(manifest, "tourism-export-manifest.json")})

    def preview(self, request):
        kind = request.get("kind")
        record = self.store.get(kind, request["id"], request.get("revision"))
        offset = integer(request.get("offset", 0), 0, MAX_ROWS, "Row offset")
        limit = integer(request.get("limit", 100), 1, 500, "Page size")
        if kind == "tourism_source":
            parsed = strict_json(self.store.bytes(record["payload"]["normalised"]["digest"]))
            table = request.get("table", next(iter(parsed["tables"])))
            if table not in TABLES:
                raise ValueError("Choose a source table.")
            rows = parsed["tables"].get(table, [])
            return {"record": self.ref(record), "table": table, "rows": rows[offset:offset + limit],
                "total": len(rows), "next_offset": offset + limit if offset + limit < len(rows) else None}
        if kind == "tourism_period":
            return strict_json(self.store.bytes(record["payload"]["report"]["digest"]))
        raise ValueError("Choose a tourism source or prepared report.")
