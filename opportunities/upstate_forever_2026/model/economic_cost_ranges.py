"""Sourced cost ranges over an immutable, completed Economic edition.

Reuses the original decision engine and its physical support, targets and units.
Quantity line extraction reads the unchanged original draft with exact rational
arithmetic; it does not author a second quantity worksheet or run a native model.
Copyright (c) 2026 TokenJunkie Labs. MIT License.
"""
from __future__ import annotations

from copy import deepcopy
import csv
from datetime import date
from decimal import Decimal, InvalidOperation
from fractions import Fraction
import hashlib
from html import escape
import io
import json
import math
import re

from . import decision_analysis as decision

SCHEMA = "upstate.economic-cost-ranges/v1"
DEFINITION_SCHEMA = "upstate.economic-cost-ranges-definition/v1"
CASES = ("lower", "reference", "upper")
_HEX = re.compile(r"^[0-9a-f]{64}$")
_DECIMAL = re.compile(r"^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$")
_MAX_CENTS = 9007199254740991
_UNITS = {
    "m2": ("area", Fraction(1)), "square_metre": ("area", Fraction(1)),
    "square_foot": ("area", Fraction(9290304, 100000000)),
    "ha": ("area", Fraction(10000)), "acre": ("area", Fraction(40468564224, 10000000)),
    "m": ("length", Fraction(1)), "metre": ("length", Fraction(1)),
    "ft": ("length", Fraction(3048, 10000)), "foot": ("length", Fraction(3048, 10000)),
    "mile": ("length", Fraction(1609344, 1000)), "each": ("count", Fraction(1)),
    "hour": ("time", Fraction(1)), "week": ("week", Fraction(1)),
    "DiaInFt": ("diameter-inch-foot", Fraction(1)),
}


class CostRangeError(ValueError):
    """A range or its selected original Economic source needs correction."""


def _need(condition, message):
    if not condition:
        raise CostRangeError(message)


def _canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def _hash(value):
    return hashlib.sha256(_canonical(value)).hexdigest()


def _text(value, label):
    _need(isinstance(value, str) and bool(value.strip()), label + " is required.")
    return value


def _decimal_text(value):
    result = format(Decimal(str(value)), "f")
    return result.rstrip("0").rstrip(".") if "." in result else result


def _amount(value, label):
    _need(isinstance(value, str) and len(value) <= 340 and _DECIMAL.fullmatch(value),
          label + " must be a nonnegative plain decimal string.")
    try:
        result = Decimal(value)
        number = float(result)
    except (InvalidOperation, OverflowError, ValueError) as error:
        raise CostRangeError(label + " must be finite.") from error
    _need(result.is_finite() and math.isfinite(number)
          and (result == 0 or number > 0), label + " is outside the decision engine's numeric range.")
    return result


def _source(value, label):
    _need(isinstance(value, dict), label + " needs its actual source.")
    result = {key: _text(value.get(key), label + " " + key) for key in ("title", "uri", "as_of")}
    try:
        parsed = date.fromisoformat(result["as_of"])
    except ValueError as error:
        raise CostRangeError(label + " as_of must be an ISO calendar date.") from error
    _need(parsed.isoformat() == result["as_of"], label + " as_of must use YYYY-MM-DD.")
    return result


def _range(value, reference, label):
    _need(isinstance(value, dict), label + " needs lower, reference and upper amounts.")
    amounts = {key: _amount(value.get(key), label + " " + key) for key in CASES}
    _need(amounts["reference"] == Decimal(str(reference)),
          label + " reference must equal the saved original amount.")
    _need(amounts["lower"] <= amounts["reference"] <= amounts["upper"],
          label + " must satisfy lower <= reference <= upper.")
    _source(value.get("source"), label + " range source")
    _need(isinstance(value.get("note", ""), str), label + " note must be text.")
    return amounts



def _same_json(left, right):
    """Preserve JSON booleans while tolerating JSON number 1 versus 1.0."""
    if isinstance(left, bool) or isinstance(right, bool):
        return isinstance(left, bool) and isinstance(right, bool) and left == right
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return math.isfinite(left) and math.isfinite(right) and left == right
    if type(left) is not type(right):
        return False
    if isinstance(left, dict):
        return left.keys() == right.keys() and all(_same_json(left[key], right[key]) for key in left)
    if isinstance(left, list):
        return len(left) == len(right) and all(_same_json(a, b) for a, b in zip(left, right))
    return left == right


def _original(source):
    _need(isinstance(source, dict), "Receive the complete original Economic source.")
    edition, report, packet = (source.get(key) for key in ("edition", "report", "packet"))
    _need(all(isinstance(value, dict) for value in (edition, report, packet)),
          "Receive the original edition, decision report and physical packet.")
    _need(edition.get("schema") == "upstate.economic-edition/v1"
          and report.get("schema") == decision.REPORT_SCHEMA, "Choose a completed Economic edition.")
    _need(bool(_HEX.fullmatch(str(source.get("edition_sha256", "")))),
          "Retain the verified exact edition.json byte hash.")
    _need(edition.get("id") == _hash({"input": edition.get("input"),
                                    "implementation": edition.get("implementation")}),
          "The Economic edition differs from its original input and implementation.")
    binding = edition.get("input") or {}
    _need(edition.get("report_id") == report.get("id")
          and binding.get("selection") == report.get("selection"),
          "The original report and Economic edition selection differ.")
    _need(packet.get("project") == report.get("project"),
          "The Economic packet and original report belong to different projects.")
    physical = report.get("physical_source") or {}
    _need(binding.get("report_sha256") == (physical.get("source") or {}).get("sha256")
          and packet.get("physical_source") == physical,
          "Retain the original physical report, source hash and reporting zone.")
    selection = report["selection"]
    projected = decision._scoped_packet(deepcopy(packet), deepcopy(selection))
    _need(report["id"] == decision._hash({"packet": projected, "selection": selection}),
          "The retained physical packet and selection do not reproduce the original report identity.")
    _need(isinstance(report.get("created_at"), str), "Retain the original report date.")
    _canonical(source)
    costs = {}
    for cost in selection.get("costs", []):
        _need(isinstance(cost, dict) and cost.get("run_id") not in costs,
              "The original selection repeats a cost row.")
        costs[cost["run_id"]] = cost
    alternatives = report.get("alternatives", [])
    _need(isinstance(alternatives, list) and len({item["run_id"] for item in alternatives}) == len(alternatives),
          "The original report repeats a scenario.")
    return edition, report, packet, costs


def _fraction(value, label):
    _need(not isinstance(value, bool) and isinstance(value, (str, int, float)), label + " is invalid.")
    text = str(value)
    _need(len(text) <= 700 and re.fullmatch(r"(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?", text),
          label + " needs the original nonnegative number.")
    try:
        decimal = Decimal(text)
        _need(decimal.is_finite() and abs(decimal.as_tuple().exponent) <= 1000,
              label + " exceeds the original supported precision.")
        if "e" in text.lower():
            _need(abs(int(text.lower().split("e")[1])) <= 308,
                  label + " exceeds the original exponent range.")
        return Fraction(decimal)
    except (InvalidOperation, ValueError) as error:
        raise CostRangeError(label + " is invalid.") from error


def _cents(value):
    # Original JS: floor((2*n + d) / (2*d)); round AFTER annual occurrences.
    result = (value.numerator * 2 + value.denominator) // (value.denominator * 2)
    _need(0 <= result <= _MAX_CENTS, "The quantity amount exceeds the original exact integer cents.")
    return result


def _money(cents):
    return str(cents // 100) + "." + str(cents % 100).zfill(2)


def _quantity_components(cost, edition, project_id):
    """Return source-bound components only when they exactly reproduce saved costs."""
    draft = cost.get("quantity_estimate")
    if not draft:
        return [], "The saved cost has no retained quantity draft; use aggregate amount ranges."
    try:
        _need(isinstance(draft, dict) and draft.get("schema") == "upstate.economic-quantity-estimate/v1"
              and isinstance(draft.get("lines"), list), "The original quantity draft is incomplete.")
        context = draft.get("context") or {}
        binding = context.get("binding") or {}
        _need(context.get("schema") == "upstate.economic-quantity-source/v1",
              "The original quantity context is incomplete.")
        expected = {"project_id": project_id, "run_id": cost["run_id"], "report_id": edition["input"]["report_id"],
                    "report_sha256": edition["input"]["report_sha256"],
                    "zone_id": edition["input"]["zone_id"]}
        _need(all(binding.get(key) == value for key, value in expected.items()),
              "The original quantities belong to another run, source or zone.")
        _need(cost.get("currency", "").upper() == "USD", "Original quantity catalogues use USD.")
        seen, components, groups = set(), [], {}
        totals = {"capital": 0, "annual": 0}
        for line in draft["lines"]:
            _need(isinstance(line, dict), "The original quantity line is incomplete.")
            ident = _text(line.get("id"), "Quantity line identity")
            _need(ident not in seen, "The original quantity draft repeats a line.")
            seen.add(ident)
            catalogues = [item for item in context.get("catalogues", []) if item.get("id") == line.get("catalogue_id")]
            _need(len(catalogues) == 1, "The original quantity catalogue is ambiguous.")
            catalogue = catalogues[0]
            rows = [item for item in catalogue.get("rows", []) if item.get("id") == line.get("row_id")]
            _need(len(rows) == 1, "The original source price row is ambiguous.")
            row = rows[0]
            documents = [item for item in catalogue.get("sources", []) if item.get("id") == row.get("source_id")]
            _need(bool(documents) and row.get("currency") == "USD" and catalogue.get("currency") == "USD",
                  "Retain the original USD source document.")
            document = documents[0]
            classification = line.get("classification")
            _need(classification in ("capital", "annual", "context"), "The original cost classification is invalid.")
            _text(line.get("applicability_reason"), "Original applicability reason")
            _need(row.get("price_kind") in ("assistance_payment", "service_component", "material_component",
                                           "historical_scenario_benchmark", "observed_survey_gross"),
                  "The original price kind is unsupported.")
            _need(row.get("price_kind") != "assistance_payment" or classification == "context",
                  "Assistance payments are reference context, not implementation costs.")
            quantity = line.get("quantity") or {}
            if quantity.get("kind") == "native":
                found = [item for item in context.get("quantities", []) if item.get("key") == quantity.get("key")]
                _need(len(found) == 1 and found[0].get("basis") in
                      ("native_changed_area", "native_transition_area", "native_implementation_quantity")
                      and found[0].get("source_ref"), "Retain the original verified treatment quantity.")
                basis = found[0]
                amount, unit = _fraction(basis.get("value"), "Original quantity"), basis.get("unit")
            elif quantity.get("kind") == "manual":
                _text(quantity.get("reason"), "Original entered quantity basis")
                basis = quantity
                amount, unit = _fraction(quantity.get("value"), "Original entered quantity"), quantity.get("unit")
            else:
                raise CostRangeError("The original quantity kind is unsupported.")
            before, after = _UNITS.get(unit), _UNITS.get(row.get("quantity_unit"))
            _need(before and after and before[0] == after[0], "The original quantity and rate units are incompatible.")
            _need(before[0] != "count" or amount.denominator == 1, "The original item count must be whole.")
            converted = amount * before[1] / after[1]
            pricing = row.get("pricing") or {}
            _need(pricing.get("type") in ("linear", "per_thousand"), "The original source pricing rule is unsupported.")
            rate = pricing.get("rate_cents") if pricing.get("rate_cents") is not None else row.get("rate_cents")
            override = line.get("rate_override")
            if override is not None:
                _need(isinstance(override, dict), "The original rate override is incomplete.")
                rate = override.get("rate_cents")
                if isinstance(rate, str) and re.fullmatch(r"(?:0|[1-9][0-9]*)", rate):
                    rate = int(rate)
                _text(override.get("reason"), "Original rate override reason")
                _text(override.get("source_ref"), "Original rate override source")
            _need(isinstance(rate, (int, float)) and not isinstance(rate, bool)
                  and math.isfinite(rate) and int(rate) == rate and 0 <= rate <= _MAX_CENTS,
                  "The original rate must retain exact nonnegative cents.")
            divisor = _fraction(pricing["divisor"] if pricing.get("divisor") is not None else 1000, "Original source divisor") if pricing["type"] == "per_thousand" else Fraction(1)
            _need(divisor > 0, "The original source divisor must be positive.")
            if pricing.get("minimum_quantity") is not None:
                _need(converted >= _fraction(pricing["minimum_quantity"], "Original minimum quantity"),
                      "The original quantity is below its source minimum.")
            occurrence = converted * int(rate) / divisor
            frequency = Fraction(1)
            if classification == "annual":
                frequency = _fraction(line.get("annual_occurrences"), "Original annual occurrence frequency")
                _need(frequency > 0, "The original annual occurrence frequency must be positive.")
                _text(line.get("recurrence_reason"), "Original annual recurrence basis")
            cents = _cents(occurrence * frequency)
            if classification == "context":
                continue
            scope = line.get("scope_group") if isinstance(line.get("scope_group"), str) and line["scope_group"].strip() else "selected-intervention"
            declared = next((item for cat in context.get("catalogues", []) for item in cat.get("component_bindings", [])
                             if item.get("catalogue_id") == catalogue.get("id") and item.get("row_id") == row.get("id")), {})
            includes = (row["includes_components"] if row.get("includes_components") is not None else declared.get("includes_components", [])) or []
            for previous, previous_line in groups.get(scope, []):
                overlap = set(includes).intersection(previous)
                if overlap:
                    _text(line.get("overlap_reason"), "Original overlapping-component allocation")
                    _text(previous_line.get("overlap_reason"), "Original overlapping-component allocation")
            groups.setdefault(scope, []).append((includes, line))
            totals[classification] += cents
            _need(totals[classification] <= _MAX_CENTS, "Original total exceeds exact integer cents.")
            title = line.get("title") or row.get("title") or ident
            original_line = {"draft": deepcopy(line), "quantity_basis": deepcopy(basis),
                "quantity_in_source_units": {"numerator": str(converted.numerator),
                    "denominator": str(converted.denominator), "unit": row["quantity_unit"]},
                "source_row": deepcopy(row), "source_document": deepcopy(document),
                "rate_cents": int(rate), "rate_override": deepcopy(override),
                "per_occurrence_cents": _cents(occurrence), "amount_cents": cents,
                "binding": deepcopy(binding)}
            components.append({"id": ident, "title": title, "classification": classification,
                **{key: _money(cents) for key in CASES},
                "source": deepcopy(cost["source"]), "note": "Reference amount reconstructed from the unchanged saved quantity draft.",
                "original_line": original_line})
        _need(bool(components), "The original quantity draft contains no implementation costs.")
        _need(Decimal(_money(totals["capital"])) == Decimal(str(cost["capital"]))
              and Decimal(_money(totals["annual"])) == Decimal(str(cost["annual_operating"])),
              "The saved quantity component totals differ from the saved Economic costs; use aggregate ranges.")
        return components, "Original component totals exactly reproduce the saved capital and annual costs."
    except (CostRangeError, KeyError, TypeError, ArithmeticError) as error:
        return [], str(error)


def template(source):
    """Start explicit ranges at the actual saved amounts, with original sources."""
    edition, report, packet, costs = _original(source)
    rows = []
    for item in report["alternatives"]:
        cost = costs.get(item["run_id"])
        if cost is None:
            continue
        components, status = _quantity_components(cost, edition, report["project"]["id"])
        row = {"run_id": item["run_id"], "label": item.get("label") or item["run_id"], "mode": "aggregate",
               "components": components, "component_status": status}
        for key in ("capital", "annual_operating"):
            row[key] = {**{case: _decimal_text(cost[key]) for case in CASES},
                        "source": deepcopy(cost["source"]), "note": ""}
        rows.append(row)
    return {"schema": DEFINITION_SCHEMA, "title": "Sourced cost ranges — " + str(report.get("title", "Economic edition")),
            "note": "", "edition_id": edition["id"], "edition_sha256": source["edition_sha256"], "rows": rows}


def _physical(item):
    return {key: deepcopy(item.get(key)) for key in
            ("run_id", "scenario_id", "scenario_key", "profile_id", "grid_id", "outputs", "modeled_metrics")}


def analyze(source, definition):
    """Evaluate three explicit cost cases through the existing decision engine."""
    edition, report, packet, costs = _original(source)
    _need(isinstance(definition, dict) and definition.get("schema") == DEFINITION_SCHEMA,
          "Use a complete sourced cost-range definition.")
    _need(definition.get("edition_id") == edition["id"]
          and definition.get("edition_sha256") == source["edition_sha256"],
          "The ranges name a different original Economic edition.")
    _text(definition.get("title"), "Cost-range title")
    _need(isinstance(definition.get("note", ""), str), "Cost-range note must be text.")
    rows = definition.get("rows")
    _need(isinstance(rows, list) and bool(rows), "Select at least one originally costed scenario.")
    original_by_id = {item["run_id"]: item for item in report["alternatives"]}
    selected, range_values = {}, {}
    for row in rows:
        _need(isinstance(row, dict), "Every selected scenario needs a complete range row.")
        run = row.get("run_id")
        _need(isinstance(run, str) and run in original_by_id and run in costs and run not in selected,
              "Each range must name one distinct costed scenario in the original report.")
        cost = costs[run]
        selected[run] = deepcopy(row)
        mode = row.get("mode")
        _need(mode in ("aggregate", "components"), "Choose aggregate or original-component amount ranges.")
        if mode == "aggregate":
            range_values[run] = {key: _range(row.get(key), cost[key], row.get("label", run) + " " + key)
                                 for key in ("capital", "annual_operating")}
        else:
            expected, reason = _quantity_components(cost, edition, report["project"]["id"])
            _need(bool(expected), reason)
            expected_by_id = {item["id"]: item for item in expected}
            members = row.get("components")
            _need(isinstance(members, list) and len(members) == len(expected),
                  "Component ranges must retain every original implementation cost line.")
            found = set()
            sums = {key: {case: Fraction(0) for case in CASES} for key in ("capital", "annual_operating")}
            for member in members:
                _need(isinstance(member, dict), "Enter the complete original component range.")
                ident = member.get("id")
                _need(isinstance(ident, str) and ident in expected_by_id and ident not in found,
                      "Component identities must match the distinct original quantity lines.")
                found.add(ident)
                original = expected_by_id[ident]
                _need(member.get("classification") == original["classification"]
                      and _same_json(member.get("original_line"), original["original_line"]),
                      "Retain the original component classification, quantity, rate and source.")
                amounts = _range(member, original["reference"], str(original["title"]))
                key = "capital" if original["classification"] == "capital" else "annual_operating"
                for case in CASES:
                    sums[key][case] += Fraction(amounts[case])
            # Finite decimal inputs have terminating decimal sums; Fraction prevents context rounding.
            range_values[run] = {key: {case: _amount(_fraction_decimal(sums[key][case]), key + " " + case)
                                      for case in CASES} for key in sums}
    identity = _hash({"source_edition_id": edition["id"], "source_edition_sha256": source["edition_sha256"],
                      "definition": definition})
    cases = {}
    for case in CASES:
        selection = deepcopy(report["selection"])
        selection.pop("lifecycle", None)
        for cost in selection.get("costs", []):
            if cost["run_id"] in range_values:
                for key in ("capital", "annual_operating"):
                    cost[key] = float(range_values[cost["run_id"]][key][case])
                cost["cost_range"] = {"definition_id": identity, "case": case,
                                     "quantity_estimate_basis": "Unchanged original reference quantities and rates"}
        try:
            evaluated = decision.analyze_packet(deepcopy(packet), selection)
        except (ValueError, OverflowError) as error:
            raise CostRangeError("The " + case + " cost case needs correction: " + str(error)) from error
        evaluated["created_at"] = report["created_at"]
        evaluated["cost_range_context"] = {"definition_id": identity, "case": case,
            "source_edition_id": edition["id"],
            "date_basis": "Original Economic report date; range record creation is recorded by the operator"}
        _need(evaluated["scope"] == report["scope"] and evaluated["assessment"] == report["assessment"],
              "Cost ranges must preserve the original physical scope, budget and targets.")
        _need([item["run_id"] for item in evaluated["alternatives"]] == list(original_by_id),
              "Cost ranges must preserve all original candidate identities and order.")
        for item in evaluated["alternatives"]:
            _need(_physical(item) == _physical(original_by_id[item["run_id"]]),
                  "The original physical results changed during cost evaluation.")
        cases[case] = evaluated
    for item in cases["reference"]["alternatives"]:
        old = original_by_id[item["run_id"]].get("cost")
        new = item.get("cost")
        _need((old is None) == (new is None), "The reference case changed the original cost coverage.")
        if old is not None:
            for key in ("capital", "annual_operating", "horizon_years", "discount_rate", "present_value", "annualized"):
                _need(old.get(key) == new.get(key), "The reference case differs from the saved original " + key + ".")
    maps = {case: {item["run_id"]: item for item in cases[case]["alternatives"]} for case in CASES}
    scenarios = []
    for run, original in original_by_id.items():
        cost = costs.get(run)
        statuses = {case: maps[case][run]["decision"]["budget_status"] for case in CASES}
        if "unknown_cost" in statuses.values():
            status = "unknown_cost"
        elif all(value == "not_set" for value in statuses.values()):
            status = "budget_not_set"
        elif all(value == "within_budget" for value in statuses.values()):
            status = "within_budget_across_range"
        elif all(value == "over_budget" for value in statuses.values()):
            status = "over_budget_across_range"
        else:
            status = "changes_with_cost_case"
        scenarios.append({"run_id": run, "label": original.get("label") or run,
            "range_selected": run in selected, "currency": cost.get("currency") if cost else None,
            "scope": deepcopy(cost.get("scope")) if cost else None,
            "original_cost": deepcopy(original.get("cost")),
            "quantity_estimate": deepcopy(cost.get("quantity_estimate")) if cost else None,
            "cases": {case: {key: deepcopy(maps[case][run].get(key)) for key in ("cost", "decision", "economics")} for case in CASES},
            "physical": {"outputs": deepcopy(original["outputs"]), "modeled_metrics": deepcopy(report["scope"]["modeled_metrics"])},
            "affordability": {**statuses, "status": status}})
    result = {"schema": SCHEMA, "id": identity, "title": definition["title"], "note": definition.get("note", ""),
        "source": {"edition_id": edition["id"], "edition_sha256": source["edition_sha256"],
                   "report_id": report["id"], "created_at": report["created_at"],
                   "producer_report_id": edition.get("producer_report_id"),
                   "zone_id": edition.get("zone_id"), "project": deepcopy(report["project"])},
        "definition": deepcopy(definition), "assessment": deepcopy(report["assessment"]),
        "scope": deepcopy(report["scope"]), "scenarios": scenarios, "cases": cases,
        "original_lifecycle": deepcopy(report.get("lifecycle")),
        "unavailable_alternatives": deepcopy(report.get("unavailable_alternatives", [])),
        "limitations": [
            "Lower, reference and upper are explicitly authored amount cases, not probabilities or confidence intervals.",
            "All selected lower amounts occur together in the lower case; all upper amounts occur together in the upper case. These joint cases do not establish independent quantity-rate feasibility.",
            "Physical results, common support, model versions, reporting zone, original horizon, discount rate, budget and physical targets remain the saved source values.",
            "Component costs use unchanged original quantities and rates only to reconstruct reference amounts. Entered bounds vary amounts; they do not rerun quantity, native-model or lifecycle calculations.",
            "Scenario affordability and Pareto membership apply to the full set of candidates in each named case. They do not establish a robust ranking over every combination of ranges.",
            "The original lifecycle analysis remains in the saved source edition; this range comparison uses capital and constant annual operating costs.",
            "Zero, negative, unavailable and unsupported physical benefits keep the original decision engine's signs, support and null unit-cost results. Unselected scenarios keep their original costs.",
        ]}
    _canonical(result)
    return result


def _fraction_decimal(value):
    """Exact terminating decimal string without the process Decimal context."""
    numerator, denominator = value.numerator, value.denominator
    whole, remainder = divmod(numerator, denominator)
    digits = []
    while remainder:
        remainder *= 10
        digit, remainder = divmod(remainder, denominator)
        digits.append(str(digit))
        _need(len(digits) <= 340, "The component amount exceeds supported decimal precision.")
    return str(whole) + ("." + "".join(digits) if digits else "")


def _safe_cell(value):
    if value is None:
        return ""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value
    text = str(value)
    return "'" + text if text.lstrip().startswith(("=", "+", "-", "@")) or text.startswith(("\t", "\r")) else text


def csv_text(result):
    """One auditable row per original scenario, authored case and modeled axis."""
    _need(result.get("schema") == SCHEMA, "Select a complete sourced cost-range result.")
    fields = ["source_edition_id", "source_edition_sha256", "range_id", "run_id", "label", "range_selected",
              "case", "currency", "capital", "annual_operating", "annualized", "present_value",
              "horizon_years", "discount_rate", "budget_status", "target_status", "eligible",
              "pareto", "pareto_basis", "dominated_by", "affordability_across_range",
              "metric", "unit", "baseline", "alternative", "reduction", "delta", "support_status",
              "annualized_cost_per_unit", "cost_per_unit_units", "range_mode", "range_sources"]
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    definitions = {row["run_id"]: row for row in result["definition"]["rows"]}
    for scenario in result["scenarios"]:
        definition = definitions.get(scenario["run_id"])
        sources = []
        if definition:
            members = (definition["components"] if definition["mode"] == "components"
                       else [definition["capital"], definition["annual_operating"]])
            sources = [{"title": member.get("title"), "source": member["source"],
                        "lower": member["lower"], "reference": member["reference"], "upper": member["upper"],
                        "note": member.get("note", "")} for member in members]
        for case in CASES:
            item = scenario["cases"][case]
            cost, choice = item.get("cost") or {}, item["decision"]
            for metric in scenario["physical"]["modeled_metrics"]:
                output = scenario["physical"]["outputs"][metric]
                economics = item["economics"].get(metric) or {}
                row = {"source_edition_id": result["source"]["edition_id"],
                    "source_edition_sha256": result["source"]["edition_sha256"], "range_id": result["id"],
                    "run_id": scenario["run_id"], "label": scenario["label"], "range_selected": scenario["range_selected"],
                    "case": case, **{key: cost.get(key) for key in ("currency", "capital", "annual_operating",
                        "annualized", "present_value", "horizon_years", "discount_rate")},
                    **{key: choice.get(key) for key in ("budget_status", "target_status", "eligible", "pareto", "pareto_basis")},
                    "dominated_by": ";".join(choice.get("dominated_by", [])),
                    "affordability_across_range": scenario["affordability"]["status"],
                    "metric": metric, "unit": result["scope"]["units"].get(metric),
                    **{key: output.get(key) for key in ("baseline", "alternative", "reduction", "delta")},
                    "support_status": (output.get("support") or {}).get("status"),
                    "annualized_cost_per_unit": economics.get("annualized_cost_per_unit"),
                    "cost_per_unit_units": economics.get("units"), "range_mode": definition["mode"] if definition else "",
                    "range_sources": json.dumps(sources, ensure_ascii=False, sort_keys=True)}
                writer.writerow({key: _safe_cell(row.get(key)) for key in fields})
    return stream.getvalue()


def _shown(value):
    if value is None:
        return "Unavailable"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    return str(value)


def _e(value):
    return escape(_shown(value), quote=True)


def _table(headers, rows):
    return '<div class="table-wrap"><table><thead><tr>' + "".join("<th>" + _e(item) + "</th>" for item in headers) + "</tr></thead><tbody>" + "".join("<tr>" + "".join("<td>" + _e(item) + "</td>" for item in row) + "</tr>" for row in rows) + "</tbody></table></div>"


def render_html(result):
    """Self-contained readable report, without scripts or remote resources."""
    _need(result.get("schema") == SCHEMA, "Select a complete sourced cost-range result.")
    parts = ['<!doctype html><html lang="en"><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src \'none\'; base-uri \'none\'; form-action \'none\'">',
        "<title>" + _e(result["title"]) + "</title>",
        "<style>body{font:16px/1.55 system-ui,sans-serif;color:#171717;background:#fff;margin:0}main{max-width:1180px;margin:auto;padding:32px 24px}h1{font-size:2rem;line-height:1.2}h2{margin-top:2.3rem;border-top:2px solid #444;padding-top:1rem}h3{margin-top:1.7rem}p,li{max-width:92ch}.metadata,small{color:#444;overflow-wrap:anywhere}.table-wrap{overflow:auto;border:1px solid #aaa;margin:1rem 0}table{border-collapse:collapse;min-width:100%;font-size:.9rem}th,td{padding:.6rem .7rem;text-align:left;vertical-align:top;border-bottom:1px solid #ccc;overflow-wrap:anywhere}th{background:#eee}tr:last-child td{border-bottom:0}details{border:1px solid #bbb;padding:.7rem;margin:1rem 0}summary{cursor:pointer;font-weight:600}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.45 ui-monospace,monospace}code{overflow-wrap:anywhere}a{color:inherit}@media(max-width:600px){main{padding:20px 12px}h1{font-size:1.55rem}th,td{padding:.45rem}}@media print{main{max-width:none;padding:0}.table-wrap{overflow:visible}h2,h3{break-after:avoid}tr{break-inside:avoid}details{break-inside:avoid}summary{display:none}details>*{display:block}}</style></head><body><main>",
        "<h1>" + _e(result["title"]) + "</h1>",
        "<p>Compare explicitly sourced lower, reference and upper costs against the same saved physical results, budget and targets.</p>",
        '<p class="metadata">Source Economic edition <code>' + _e(result["source"]["edition_id"]) + "</code><br>Original report date: " + _e(result["source"]["created_at"]) + "<br>Range identity: <code>" + _e(result["id"]) + "</code></p>"]
    if result.get("note"):
        parts.append("<p>" + _e(result["note"]) + "</p>")
    parts.extend(["<h2>Assessment</h2>", _table(["Item", "Saved value"], [
        ["Project", result["source"].get("project")], ["Reporting unit", result["scope"].get("reporting_unit")],
        ["Budget", result["assessment"].get("budget")], ["Physical reduction targets", result["assessment"].get("targets")],
        ["Modeled metrics and units", result["scope"].get("units")]]),
        "<h2>Affordability across the authored range</h2>",
        "<p>Affordability describes the saved budget. Eligibility also requires the original physical support and targets. A budget that has not been set stays explicitly unassessed.</p>",
        _table(["Scenario", "Range selected", "Currency", "Lower budget status", "Reference budget status", "Upper budget status", "Across range"],
               [[row["label"], row["range_selected"], row["currency"], *[row["affordability"][case] for case in CASES], row["affordability"]["status"]] for row in result["scenarios"]])])
    definitions = {row["run_id"]: row for row in result["definition"]["rows"]}
    for scenario in result["scenarios"]:
        parts.extend(["<h2>" + _e(scenario["label"]) + "</h2>",
            '<p class="metadata">Original run <code>' + _e(scenario["run_id"]) + "</code></p>",
            _table(["Case", "Capital", "Annual operating", "Annualized", "Present value", "Budget", "Targets", "Eligible", "Pareto"],
                   [[case.title(), *[(scenario["cases"][case].get("cost") or {}).get(key) for key in
                     ("capital", "annual_operating", "annualized", "present_value")],
                     scenario["cases"][case]["decision"]["budget_status"], scenario["cases"][case]["decision"]["target_status"],
                     scenario["cases"][case]["decision"]["eligible"], scenario["cases"][case]["decision"].get("pareto")] for case in CASES]),
            "<p>Currency: " + _e(scenario["currency"]) + ". Original cost scope: " + _e(scenario["scope"]) +
            ". Planning horizon: " + _e((scenario["original_cost"] or {}).get("horizon_years")) +
            " years. Real discount rate: " + _e((scenario["original_cost"] or {}).get("discount_rate")) + ".</p>",
            "<h3>Unchanged physical results</h3>",
            _table(["Metric", "Units", "Baseline", "Alternative", "Avoided export", "Export change", "Support"],
                [[metric, result["scope"]["units"][metric], *[scenario["physical"]["outputs"][metric].get(key) for key in ("baseline", "alternative", "reduction", "delta")],
                  scenario["physical"]["outputs"][metric].get("support")] for metric in scenario["physical"]["modeled_metrics"]]),
            "<h3>Annualized cost per avoided unit</h3>",
            _table(["Metric", "Units", "Lower", "Reference", "Upper"],
                [[metric, scenario["cases"]["reference"]["economics"][metric].get("units"),
                  *[scenario["cases"][case]["economics"][metric].get("annualized_cost_per_unit") for case in CASES]]
                 for metric in scenario["physical"]["modeled_metrics"]])])
        definition = definitions.get(scenario["run_id"])
        if definition:
            components = definition["components"] if definition["mode"] == "components" else [
                {"title": "Capital", **definition["capital"]}, {"title": "Annual operating", **definition["annual_operating"]}]
            parts.extend(["<h3>Authored amount ranges and sources</h3>",
                "<p>Range method: " + _e(definition["mode"]) + ".</p>",
                _table(["Amount", "Classification", "Lower", "Reference", "Upper", "Source", "Reference", "As of", "Basis / note"],
                    [[item.get("title") or item.get("id"), item.get("classification", "Aggregate"), *[item[case] for case in CASES],
                      item["source"]["title"], item["source"]["uri"], item["source"]["as_of"], item.get("note", "")] for item in components])])
            if definition["mode"] == "components":
                for component in components:
                    original = component["original_line"]
                    parts.extend(["<details><summary>Original quantity and rate — " + _e(component["title"]) + "</summary>",
                        _table(["Item", "Original retained value"], [
                            ["Quantity in source units", original["quantity_in_source_units"]],
                            ["Quantity basis", original["quantity_basis"]], ["Rate in cents", original["rate_cents"]],
                            ["Rate override and its actual source", original["rate_override"]],
                            ["Cost after occurrences, in cents", original["amount_cents"]],
                            ["Source price row", original["source_row"]], ["Source document", original["source_document"]],
                            ["Original draft line", original["draft"]]]), "</details>"])
        else:
            parts.append("<p>This scenario retains its original saved cost in every case.</p>")
        for case in CASES:
            choice = scenario["cases"][case]["decision"]
            parts.append("<p><strong>" + _e(case.title()) + " decision:</strong> " +
                _e("; ".join(choice.get("reasons", [])) or "Original support, budget and target checks are satisfied.") +
                " Pareto basis: " + _e(choice.get("pareto_basis")) + ". Dominated by: " + _e(choice.get("dominated_by", [])) + ".</p>")
    if result.get("unavailable_alternatives"):
        parts.extend(["<h2>Original unavailable alternatives</h2>",
                      "<pre>" + _e(json.dumps(result["unavailable_alternatives"], ensure_ascii=False, indent=2)) + "</pre>"])
    parts.extend(["<h2>Interpretation</h2><ul>", *["<li>" + _e(item) + "</li>" for item in result["limitations"]], "</ul>",
        "<h2>Original source</h2>", _table(["Item", "Value"], [
            ["Economic edition", result["source"]["edition_id"]], ["Exact edition.json SHA-256", result["source"]["edition_sha256"]],
            ["Decision report", result["source"]["report_id"]], ["Native producer report", result["source"].get("producer_report_id")],
            ["Reporting zone", result["source"].get("zone_id")], ["Original lifecycle retained", result.get("original_lifecycle") is not None]]),
        "<p>The complete download includes the original Economic package, original edition, physical packet, full case reports, authored definition, CSV and implementation source.</p>",
        "<h3>Open and download the complete files</h3><ul>",
        '<li><a href="original-economic-package.zip" download>Original complete Economic edition</a></li>',
        '<li><a href="original-edition.json" download>Original saved edition and source manifest</a></li>',
        '<li><a href="original-report.json" download>Original complete physical and economic report</a></li>',
        '<li><a href="physical-input.json" download>Original physical input packet</a></li>',
        '<li><a href="result.json" download>Full lower, reference and upper case reports</a></li>',
        '<li><a href="definition.json" download>Editable authored range definition</a></li>',
        '<li><a href="scenarios.csv" download>Complete scenario and metric table</a></li>',
        '<li><a href="manifest.json" download>Complete package member manifest</a></li></ul>',
        "</main></body></html>"])
    return "".join(parts)
