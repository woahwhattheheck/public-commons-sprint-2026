"""Dated lifecycle costs and explicit establishment trajectories.

Consumes the existing decision report's completed annual physical outputs.
All lifecycle settings are authored assumptions; this module never runs or
changes a native model. No external packages are required.
"""
from __future__ import annotations

from calendar import monthrange
from datetime import date
import math
import re

SELECTION_SCHEMA = "upstate.lifecycle-selection/v1"
REPORT_SCHEMA = "upstate.lifecycle-report/v1"
GROSS_KINDS = ("establishment", "maintenance", "replacement", "other")
CREDIT_KINDS = ("assistance", "salvage")
KINDS = GROSS_KINDS + CREDIT_KINDS
MASS_UNITS = {"nitrogen_export": "kg", "phosphorus_export": "kg", "sediment_export": "t"}
METHODS = [
    "Dated cash flows are discounted to the start date. Exact calendar anniversaries are integer years; intervening days divide by the actual days between those anniversaries. February 29 anniversaries use February 28 in non-leap years.",
    "Constant-price cash flows require a real discount rate; nominal cash flows require a nominal rate. The selected price date states the authored price basis. This calculator performs no inflation, escalation, exchange-rate or tax conversion.",
    "Gross expenditure, assistance and salvage are reported separately. Net funded cost is gross expenditure minus assistance and salvage; assistance is a transfer and does not reduce gross resource expenditure.",
    "The annual avoided-load value is the unchanged completed native scenario's baseline-minus-alternative result on its original common support. Each explicit year factor scales that value as an analyst-authored trajectory assumption; it is not a new native model run or a measured establishment response.",
    "Annual loads are assigned to the year-end anniversary. Total avoided load is the undiscounted sum. Discounted avoided load is a financial weighting used only to solve the constant unit-value break-even equation.",
    "Break-even unit value equals present-value cost divided by discounted avoided load. Present-value cost per total unit uses undiscounted total avoided load instead. Both require positive avoided load and common physical support; negative loads remain visible. Pollutants are never added together.",
    "Sensitivity cases vary the supplied discount rate, gross-cost multiplier and benefit multiplier independently. Credits are retained at their authored amounts. These cases have no assigned probabilities and do not replace profile-paired native sensitivity.",
    "Each pollutant view uses the full programme cost independently; these views do not allocate joint cost between pollutants and must not be added together.",
    "The existing annual cost, targets and frontier remain the original decision analysis. The lifecycle comparison is a separate explicitly selected perspective.",
]


def _object(value, label):
    if not isinstance(value, dict):
        raise ValueError(label + " must be an object.")
    return value


def _fields(value, allowed, label):
    _object(value, label)
    extras = set(value) - set(allowed)
    if extras:
        raise ValueError(label + " has unsupported fields: " + ", ".join(sorted(extras)) + ".")
    return value


def _text(value, label, *, empty=False):
    if not isinstance(value, str) or (not empty and not value.strip()) or "\0" in value:
        raise ValueError(label + " must be " + ("text." if empty else "nonempty text."))
    return value if empty else value.strip()


def _number(value, label, *, nonnegative=True):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(label + " must be a finite number.")
    try:
        value = float(value)
    except (ValueError, OverflowError) as error:
        raise ValueError(label + " must be a finite number.") from error
    if not math.isfinite(value) or (nonnegative and value < 0):
        raise ValueError(label + " must be a finite " + ("nonnegative " if nonnegative else "") + "number.")
    return value


def _day(value, label):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        raise ValueError(label + " must use YYYY-MM-DD.")
    try:
        return date.fromisoformat(value)
    except ValueError as error:
        raise ValueError(label + " must be a valid calendar date.") from error


def _source(value, label):
    _fields(value, ("title", "uri", "as_of"), label)
    return {"title": _text(value.get("title"), label + " title"),
            "uri": _text(value.get("uri"), label + " URI"),
            "as_of": _day(value.get("as_of"), label + " as-of date").isoformat()}


def anniversary(start, year):
    try:
        selected_year = start.year + year
        return date(selected_year, start.month,
                    min(start.day, monthrange(selected_year, start.month)[1]))
    except (ValueError, OverflowError) as error:
        raise ValueError("The lifecycle horizon must end within the supported calendar.") from error


def year_fraction(start, target):
    year = target.year - start.year
    if target < anniversary(start, year):
        year -= 1
    before = anniversary(start, year)
    if target == before:
        return float(year)
    after = anniversary(start, year + 1)
    return year + (target - before).days / (after - before).days


def discount(rate, time):
    return math.exp(-time * math.log1p(rate))


def annuity_factor(rate, horizon):
    return float(horizon) if rate == 0 else -math.expm1(-horizon * math.log1p(rate)) / rate


def _sum(values, label):
    try:
        result = math.fsum(values)
    except (ValueError, OverflowError) as error:
        raise ValueError(label + " exceeds finite arithmetic.") from error
    return _number(result, label, nonnegative=False)


def _finite(value, label):
    return _number(value, label, nonnegative=False)


def _supported(item):
    outputs = item.get("outputs", {})
    return bool(outputs) and all(
        isinstance(value, dict) and isinstance(value.get("support"), dict)
        and value["support"].get("status") in ("paired", "same_support")
        and value["support"].get("id")
        for value in outputs.values())


def _settings(value):
    _fields(value, ("schema", "currency", "price_basis", "price_date", "start_date",
                   "horizon_years", "discount_rate", "note", "scenarios",
                   "sensitivity_cases"), "Lifecycle selection")
    if value.get("schema") != SELECTION_SCHEMA:
        raise ValueError("Choose a lifecycle selection with schema " + SELECTION_SCHEMA + ".")
    currency = value.get("currency")
    if not isinstance(currency, str) or not re.fullmatch(r"[A-Z]{3}", currency):
        raise ValueError("Lifecycle currency must be a three-letter uppercase code.")
    basis = value.get("price_basis")
    if basis not in ("constant", "nominal"):
        raise ValueError("Lifecycle price basis must be constant or nominal.")
    horizon = value.get("horizon_years")
    if isinstance(horizon, bool) or not isinstance(horizon, int) or horizon < 1:
        raise ValueError("Lifecycle horizon must be a positive whole number of years.")
    start = _day(value.get("start_date"), "Lifecycle start date")
    anniversary(start, horizon)
    result = {key: value[key] for key in ("currency", "price_basis", "horizon_years")}
    result.update(price_date=_day(value.get("price_date"), "Lifecycle price date").isoformat(),
                  start_date=start.isoformat(),
                  discount_rate=_number(value.get("discount_rate"), "Lifecycle discount rate"),
                  note=_text(value.get("note", ""), "Lifecycle note", empty=True))
    return result


def _cases(value, settings):
    cases = [{"id": "base", "label": "Authored schedule",
              "discount_rate": settings["discount_rate"],
              "cost_multiplier": 1.0, "benefit_multiplier": 1.0}]
    supplied = value.get("sensitivity_cases", [])
    if not isinstance(supplied, list):
        raise ValueError("Lifecycle sensitivity cases must be a list.")
    seen = {"base"}
    for entry in supplied:
        _fields(entry, ("id", "label", "discount_rate", "cost_multiplier",
                        "benefit_multiplier"), "Lifecycle sensitivity case")
        key = _text(entry.get("id"), "Sensitivity case ID")
        if key in seen:
            raise ValueError("Lifecycle sensitivity case IDs must be unique; base is reserved.")
        seen.add(key)
        cases.append({"id": key, "label": _text(entry.get("label"), "Sensitivity case label"),
                      **{name: _number(entry.get(name), "Sensitivity " + name.replace("_", " "))
                         for name in ("discount_rate", "cost_multiplier", "benefit_multiplier")}})
    return cases


def _scenario(value, item, settings, cases):
    _fields(value, ("run_id", "note", "trajectory_source", "benefit_factors",
                    "cashflows"), "Lifecycle scenario")
    note = _text(value.get("note", ""), "Lifecycle scenario note", empty=True)
    trajectory_source = _source(value.get("trajectory_source"), "Establishment trajectory source")
    start = _day(settings["start_date"], "Lifecycle start date")
    end = anniversary(start, settings["horizon_years"])
    rows = value.get("cashflows")
    if not isinstance(rows, list):
        raise ValueError("Each lifecycle scenario needs an explicit cashflow list.")
    cashflows, seen = [], set()
    for row in rows:
        _fields(row, ("id", "label", "date", "kind", "amount", "source", "note"),
                "Lifecycle cashflow")
        key = _text(row.get("id"), "Cashflow ID")
        if key in seen:
            raise ValueError("Cashflow IDs must be unique within each lifecycle scenario.")
        seen.add(key)
        day = _day(row.get("date"), "Cashflow date")
        if not start <= day <= end:
            raise ValueError("Every cashflow must fall within the lifecycle start and end dates.")
        kind = row.get("kind")
        if kind not in KINDS:
            raise ValueError("Cashflow kind must be one of: " + ", ".join(KINDS) + ".")
        amount = _number(row.get("amount"), "Cashflow amount")
        time = year_fraction(start, day)
        factor = discount(settings["discount_rate"], time)
        cashflows.append({"id": key, "label": _text(row.get("label"), "Cashflow label"),
                          "date": day.isoformat(), "kind": kind, "amount": amount,
                          "source": _source(row.get("source"), "Cashflow source"),
                          "note": _text(row.get("note", ""), "Cashflow note", empty=True),
                          "time_years": time, "discount_factor": factor,
                          "present_value": _finite(amount * factor, "Cashflow present value")})
    factors = value.get("benefit_factors")
    if not isinstance(factors, list) or len(factors) != settings["horizon_years"]:
        raise ValueError("Supply one explicit benefit factor for every lifecycle year.")
    by_year = {}
    for row in factors:
        _fields(row, ("year", "factor", "note"), "Establishment year")
        year = row.get("year")
        if (isinstance(year, bool) or not isinstance(year, int)
                or not 1 <= year <= settings["horizon_years"] or year in by_year):
            raise ValueError("Establishment years must cover the horizon once, starting at year 1.")
        by_year[year] = {"year": year, "factor": _number(row.get("factor"), "Annual benefit factor"),
                         "note": _text(row.get("note", ""), "Annual benefit note", empty=True)}
    supported = _supported(item)
    native = {}
    for metric, output in item.get("outputs", {}).items():
        if metric not in MASS_UNITS or output.get("units") != MASS_UNITS[metric] + "/year":
            raise ValueError("Lifecycle comparison requires original annual pollutant-mass units.")
        native[metric] = _number(output.get("reduction"), "Native annual avoided load", nonnegative=False)
    benefits = []
    for year in sorted(by_year):
        row = dict(by_year[year])
        factor = discount(settings["discount_rate"], year)
        outputs = {}
        for metric, reduction in native.items():
            amount = _finite(reduction * row["factor"], "Annual avoided load") if supported else None
            outputs[metric] = {"annual_native_reduction": reduction, "avoided_load": amount,
                               "present_value_load": _finite(amount * factor, "Discounted avoided load") if amount is not None else None,
                               "units": MASS_UNITS[metric]}
        row.update(date=anniversary(start, year).isoformat(), discount_factor=factor, outputs=outputs)
        benefits.append(row)
    outcomes = []
    for case in cases:
        rate = case["discount_rate"]
        totals = {kind: _sum((flow["amount"] * discount(rate, flow["time_years"])
                             * (case["cost_multiplier"] if kind in GROSS_KINDS else 1.0)
                             for flow in cashflows if flow["kind"] == kind), kind + " present value")
                  for kind in KINDS}
        gross = _sum((totals[kind] for kind in GROSS_KINDS), "Gross present value")
        assistance, salvage = totals["assistance"], totals["salvage"]
        net = _sum((gross, -assistance, -salvage), "Net present value")
        factor = annuity_factor(rate, settings["horizon_years"])
        if factor <= 0:
            raise ValueError("This discount rate produces no finite annual-equivalent denominator.")
        metrics = {}
        for metric, reduction in native.items():
            total = (_sum((row["outputs"][metric]["avoided_load"] * case["benefit_multiplier"]
                           for row in benefits), "Total avoided load") if supported else None)
            weighted = (_sum((row["outputs"][metric]["avoided_load"] * case["benefit_multiplier"]
                              * discount(rate, row["year"]) for row in benefits),
                             "Discounted avoided load") if supported else None)
            def ratio(cost, denominator):
                return _finite(cost / denominator, "Lifecycle unit value") if denominator is not None and denominator > 0 else None
            metrics[metric] = {
                "units": MASS_UNITS[metric], "annual_native_reduction": reduction,
                "total_avoided_load": total, "discounted_avoided_load": weighted,
                "gross_cost_per_total_unit": ratio(gross, total),
                "net_cost_per_total_unit": ratio(net, total),
                "gross_break_even_unit_value": ratio(gross, weighted),
                "net_break_even_unit_value": ratio(net, weighted),
                "unit_value_units": settings["currency"] + "/" + MASS_UNITS[metric],
            }
        outcomes.append({**case, "gross_present_value": gross,
                         "assistance_present_value": assistance, "salvage_present_value": salvage,
                         "net_present_value": net,
                         "gross_annual_equivalent": _finite(gross / factor, "Gross annual equivalent"),
                         "net_annual_equivalent": _finite(net / factor, "Net annual equivalent"),
                         "metrics": metrics})
    return {"run_id": item["run_id"], "label": item["label"], "note": note,
            "support_ready": supported, "trajectory_source": trajectory_source,
            "cashflows": cashflows, "benefit_years": benefits, "cases": outcomes}


def analyze(report, selection):
    """Calculate an optional lifecycle perspective from an existing report."""
    settings = _settings(selection)
    cases = _cases(selection, settings)
    scenarios = selection.get("scenarios")
    if not isinstance(scenarios, list) or not scenarios:
        raise ValueError("Select at least one actual scenario for lifecycle analysis.")
    available = {item["run_id"]: item for item in report.get("alternatives", [])}
    values, seen = [], set()
    for value in scenarios:
        _object(value, "Lifecycle scenario")
        run_id = _text(value.get("run_id"), "Lifecycle scenario run ID")
        if run_id not in available:
            raise ValueError("Lifecycle scenario must name a completed alternative in this exact report.")
        if run_id in seen:
            raise ValueError("Each scenario may have only one lifecycle schedule.")
        seen.add(run_id)
        values.append(_scenario(value, available[run_id], settings, cases))
    return {"schema": REPORT_SCHEMA, "settings": settings,
            "scenarios": values, "methodology": list(METHODS)}


def csv_tables(lifecycle):
    """Return complete export tables for the existing safe CSV writer."""
    settings = lifecycle["settings"]
    context = {key: settings[key] for key in (
        "currency", "price_basis", "price_date", "start_date", "horizon_years")}
    cost_fields = ["run_id", "scenario", *context, "discount_rate", "id", "label", "date",
                   "kind", "amount", "time_years", "discount_factor", "present_value",
                   "source_title", "source_uri", "source_as_of", "note"]
    benefit_fields = ["run_id", "scenario", *context, "discount_rate", "year", "date",
                      "factor", "pollutant", "annual_native_reduction", "avoided_load",
                      "present_value_load", "units", "discount_factor", "note",
                      "trajectory_source_title", "trajectory_source_uri", "trajectory_source_as_of"]
    summary_fields = ["run_id", "scenario", *context, "support_ready", "case_id", "case_label",
                      "discount_rate", "cost_multiplier", "benefit_multiplier",
                      "gross_present_value", "assistance_present_value", "salvage_present_value",
                      "net_present_value", "gross_annual_equivalent", "net_annual_equivalent",
                      "pollutant", "units", "annual_native_reduction", "total_avoided_load",
                      "discounted_avoided_load", "gross_cost_per_total_unit", "net_cost_per_total_unit",
                      "gross_break_even_unit_value", "net_break_even_unit_value", "unit_value_units"]
    cash, benefit, summary = [], [], []
    for scenario in lifecycle["scenarios"]:
        base = {"run_id": scenario["run_id"], "scenario": scenario["label"], **context}
        for row in scenario["cashflows"]:
            cash.append({**base, "discount_rate": settings["discount_rate"],
                         **{key: value for key, value in row.items() if key != "source"},
                         **{"source_" + key: value for key, value in row["source"].items()}})
        for row in scenario["benefit_years"]:
            for metric, output in row["outputs"].items():
                benefit.append({**base, "discount_rate": settings["discount_rate"],
                                **{key: value for key, value in row.items() if key != "outputs"},
                                "pollutant": metric, **output,
                                **{"trajectory_source_" + key: value
                                   for key, value in scenario["trajectory_source"].items()}})
        for case in scenario["cases"]:
            for metric, output in case["metrics"].items():
                summary.append({**base, "support_ready": scenario["support_ready"],
                                "case_id": case["id"], "case_label": case["label"],
                                **{key: value for key, value in case.items() if key not in ("id", "label", "metrics")},
                                "pollutant": metric, **output})
    return {
        "lifecycle-cashflows.csv": (cost_fields, cash),
        "lifecycle-benefits.csv": (benefit_fields, benefit),
        "lifecycle-comparison.csv": (summary_fields, summary),
    }
