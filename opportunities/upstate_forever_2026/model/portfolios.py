"""Conservation portfolios from retained planning unit inventories and native scenarios.

The input is the application's actual planning unit CSV. Preference analysis never
reruns or substitutes for NDR/SDR. A chosen treatment is materialized as real
selected geometry and saved through the ordinary Workspace scenario API.
"""
from __future__ import annotations

from collections import Counter
from copy import deepcopy
import csv
from decimal import Decimal, InvalidOperation
from fractions import Fraction
import html
import io
import json
import math
from pathlib import Path
import zipfile

from .common import (
    atomic_bytes, atomic_json, canonical, describe_file, digest, held,
    identifier, read_json, verify_file,
)
from .model_selection import normalize_selection, run_models
from . import portfolio_pairing

KIND = "portfolios"
REPORT_KIND = "portfolio-reports"
METRICS = ("nitrogen_export", "phosphorus_export", "sediment_export")
MASS_FIELDS = {
    "nitrogen_export": "nitrogen_kg_year",
    "phosphorus_export": "phosphorus_kg_year",
    "sediment_export": "sediment_t_year",
}
UNITS = {
    "nitrogen_export": "kg/year",
    "phosphorus_export": "kg/year",
    "sediment_export": "metric tonnes/year",
}
ACTIONS = {
    "portfolio.inventory.build", "portfolio.preview", "portfolio.save", "portfolio.scenario.prepare",
    "portfolio.report.build", "portfolio.decision.build",
}
ANALYSIS_SCHEMA = "upstate.portfolio-analysis/v1"
TOLERANCE = 1e-10


def _text(value, label, *, required=False):
    if value is None and not required:
        return ""
    if not isinstance(value, str) or (required and not value.strip()):
        raise ValueError(label + " must be nonempty text")
    return value.strip()


def _number(value, label, *, minimum=None, maximum=None, optional=False):
    if optional and (value is None or value == ""):
        return None
    if isinstance(value, bool):
        raise ValueError(label + " must be numeric")
    try:
        result = float(value)
    except (ValueError, TypeError, OverflowError) as error:
        raise ValueError(label + " must be a finite number") from error
    if not math.isfinite(result):
        raise ValueError(label + " must be finite")
    if minimum is not None and result < minimum:
        raise ValueError(label + " is below its allowed minimum")
    if maximum is not None and result > maximum:
        raise ValueError(label + " is above its allowed maximum")
    return result


def _integer(value, label, *, optional=False):
    if optional and (value is None or value == ""):
        return None
    if isinstance(value, bool):
        raise ValueError(label + " must be a whole number")
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError) as error:
        raise ValueError(label + " must be a finite whole number") from error
    if (not number.is_finite() or not math.isfinite(float(number))
            or number < 0 or number != number.to_integral_value()):
        raise ValueError(label + " must be a finite nonnegative whole number")
    return int(number)


def _money(value, label, *, optional=True):
    if optional and (value is None or isinstance(value, str) and not value.strip()):
        return None
    if isinstance(value, bool):
        raise ValueError(label + " must be a USD amount")
    try:
        amount = Decimal(str(value))
        finite_amount = math.isfinite(float(amount))
    except (InvalidOperation, ValueError, TypeError, OverflowError) as error:
        raise ValueError(label + " must be a finite USD amount") from error
    if not amount.is_finite() or not finite_amount or amount < 0:
        raise ValueError(label + " must be finite and nonnegative")
    if amount == 0:
        return 0
    # Integer digit arithmetic preserves cents independently of Decimal context.
    parts = amount.as_tuple()
    digits = parts.digits
    shift = parts.exponent + 2
    if shift < 0:
        removed = -shift
        if removed > len(digits) or any(digits[-removed:]):
            raise ValueError(label + " uses at most two decimal places")
        digits = digits[:-removed]
        shift = 0
    coefficient = int("".join(str(digit) for digit in digits) or "0")
    return coefficient * 10 ** shift


def _usd(cents):
    return None if cents is None else str(cents // 100) + "." + str(cents % 100).zfill(2)


def _ids(value, label):
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError(label + " must be a list of original feature IDs")
    result, seen = [], set()
    for item in value:
        if not isinstance(item, str) or not item.strip():
            raise ValueError(label + " must retain nonempty original string IDs")
        if item in seen:
            raise ValueError(label + " contains a duplicate feature ID")
        seen.add(item)
        result.append(item)
    return result


def _json(value, label):
    def pairs(items):
        result = {}
        for key, item in items:
            if key in result:
                raise ValueError(label + " contains a duplicate JSON key")
            result[key] = item
        return result

    def invalid(token):
        raise ValueError(label + " contains a nonfinite JSON number: " + token)

    try:
        return json.loads(value, object_pairs_hook=pairs, parse_constant=invalid,
                          parse_float=lambda text: _number(text, label + " JSON number"))
    except (json.JSONDecodeError, TypeError) as error:
        raise ValueError(label + " must contain complete JSON") from error


def _weights(value):
    if value is None:
        value = {name: 1 for name in METRICS}
    if not isinstance(value, dict) or set(value) - set(METRICS):
        raise ValueError("Weights use nitrogen_export, phosphorus_export and sediment_export")
    raw = {name: _number(value.get(name, 0), name + " weight", minimum=0)
           for name in METRICS}
    largest = max(raw.values())
    if largest <= 0:
        raise ValueError("At least one pollutant objective needs a positive weight")
    scaled = {name: value / largest for name, value in raw.items()}
    total = math.fsum(scaled.values())
    return {name: scaled[name] / total for name in METRICS}


def _request(selection):
    if not isinstance(selection, dict):
        raise ValueError("Select a portfolio specification")
    delivery_id = selection.get("delivery_id") or None
    inventory_id = selection.get("inventory_id") or None
    if bool(delivery_id) == bool(inventory_id):
        raise ValueError("Choose either a retained delivery inventory or a native planning inventory")
    if delivery_id:
        delivery_id = identifier(delivery_id)
    if inventory_id:
        inventory_id = identifier(inventory_id)
    objective = selection.get("objective") or {}
    if not isinstance(objective, dict):
        raise ValueError("Objective must name its kind, basis and actual scenario")
    kind = objective.get("kind", "restoration")
    if kind not in {"restoration", "avoided-conversion", "current-export"}:
        raise ValueError("Choose restoration, avoided-conversion or current-export")
    basis = objective.get("basis", "total")
    if basis not in {"total", "per-reporting-hectare"}:
        raise ValueError("Choose total or per-reporting-hectare objective values")
    scenario_id = objective.get("scenario_run_id") or None
    if kind != "current-export":
        scenario_id = identifier(scenario_id)
    elif scenario_id is not None:
        raise ValueError("A current-export objective uses the retained baseline")
    original_filters = selection.get("filters") or {}
    if not isinstance(original_filters, dict):
        raise ValueError("Filters must be an object")
    filters = {
        "min_coverage_fraction": _number(
            original_filters.get("min_coverage_fraction", .95), "Minimum coverage", minimum=0, maximum=1),
        "max_protected_fraction": _number(
            original_filters.get("max_protected_fraction", 1), "Maximum protected fraction", minimum=0, maximum=1),
        "source_water": original_filters.get("source_water", "any"),
        "high_quality_water": original_filters.get("high_quality_water", "any"),
        "include_feature_ids": _ids(original_filters.get("include_feature_ids"), "Included features"),
        "exclude_feature_ids": _ids(original_filters.get("exclude_feature_ids"), "Excluded features"),
    }
    for name in ("source_water", "high_quality_water"):
        if filters[name] not in {"any", "yes", "no"}:
            raise ValueError(name + " filter must be any, yes or no")
    if set(filters["include_feature_ids"]) & set(filters["exclude_feature_ids"]):
        raise ValueError("A feature cannot be both explicitly included and excluded")
    raw_constraints = selection.get("constraints") or {}
    if not isinstance(raw_constraints, dict):
        raise ValueError("Constraints must be an object")
    budget = _money(raw_constraints.get("budget_usd"), "Portfolio budget")
    constraints = {
        "budget_usd": _usd(budget),
        "area_ha": _number(raw_constraints.get("area_ha"), "Reporting area limit",
                           minimum=0, optional=True),
        "max_count": _integer(raw_constraints.get("max_count"), "Planning unit count limit", optional=True),
    }
    raw_costs = selection.get("costs") or None
    costs = None
    if raw_costs:
        if not isinstance(raw_costs, dict):
            raise ValueError("Costs must identify a supplied original source table")
        if raw_costs.get("currency", "USD") != "USD":
            raise ValueError("Supply USD costs; this operation does not convert currencies")
        costs = {
            "source_collection_id": identifier(raw_costs.get("source_collection_id")),
            "source_id": _text(raw_costs.get("source_id"), "Cost source ID", required=True),
            "feature_id_field": _text(raw_costs.get("feature_id_field", "feature_id"),
                                       "Cost feature field", required=True),
            "cost_field": _text(raw_costs.get("cost_field", "cost_usd"), "Cost field", required=True),
            "currency": "USD",
        }
    if budget is not None and costs is None:
        raise ValueError("A budget requires a supplied per-feature USD cost table")
    solver = selection.get("solver", "deterministic")
    if solver not in {"deterministic", "scipy-milp"}:
        raise ValueError("Choose deterministic or scipy-milp selection")
    seconds = _number(selection.get("solver_time_limit_seconds", 20),
                      "Optional solver time limit", minimum=.001)
    stability = selection.get("stability", True)
    if isinstance(stability, bool):
        stability = {"enabled": stability}
    if not isinstance(stability, dict):
        raise ValueError("Stability must be enabled/disabled or specify weight profiles")
    supplied_profiles = stability.get("profiles", [])
    if not isinstance(supplied_profiles, list):
        raise ValueError("Stability profiles must be a list of named weights")
    custom_profiles, profile_names = [], {"Selected weights"}
    for index, profile in enumerate(supplied_profiles):
        if not isinstance(profile, dict):
            raise ValueError("Each stability profile must be a named weights object")
        name = _text(profile.get("name"), "Stability profile name", required=True)
        if name in profile_names:
            raise ValueError("Use distinct stability profile names")
        profile_names.add(name)
        custom_profiles.append({"name": name, "weights": _weights(profile.get("weights"))})
    enabled = stability.get("enabled", True)
    if not isinstance(enabled, bool):
        raise ValueError("Stability enabled must be true or false")
    return {
        "title": _text(selection.get("title") or "Planning unit portfolio", "Portfolio title", required=True),
        "purpose": _text(selection.get("purpose") or "Compare selected conservation priorities and resource limits.",
                           "Portfolio purpose", required=True),
        "delivery_id": delivery_id, "inventory_id": inventory_id,
        "objective": {"kind": kind, "basis": basis, "scenario_run_id": scenario_id},
        "weights": _weights(selection.get("weights")), "filters": filters,
        "constraints": constraints, "costs": costs, "solver": solver,
        "solver_time_limit_seconds": seconds,
        "stability": {"enabled": enabled, "profiles": custom_profiles},
    }


def _source_entry(workspace, collection_id, source_id):
    collection = workspace._get("sources", identifier(collection_id))
    entry = next((entry for entry in collection["entries"] if entry["id"] == source_id), None)
    if entry is None:
        raise ValueError("The original source edition has no selected source: " + source_id)
    return collection, entry


def _source_identity(collection_id, entry):
    return {
        "source_collection_id": collection_id, "source_id": entry["id"],
        "title": entry["title"], "uri": entry["uri"], "vintage": entry["vintage"],
        "kind": entry["kind"], "body": deepcopy(entry["body"]),
    }


def _csv(path, required_fields, label):
    with Path(path).open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        fields = reader.fieldnames or []
        if not fields or len(fields) != len(set(fields)):
            raise ValueError(label + " needs unique original column names")
        missing = set(required_fields) - set(fields)
        if missing:
            raise ValueError(label + " lacks columns: " + ", ".join(sorted(missing)))
        for line, row in enumerate(reader, 2):
            if None in row or any(value is None for value in row.values()):
                raise ValueError(label + " row " + str(line) + " has a different column count")
            yield line, row


def _load_inputs(workspace, request):
    delivery_id, inventory_id = request.get("delivery_id"), request.get("inventory_id")
    if inventory_id:
        from .planning_inventory import inspect
        state = inspect(workspace, inventory_id)
        csv_path = verify_file(workspace.root, state["files"]["csv"])
        inventory_path = verify_file(workspace.root, state["files"]["inventory"])
        inventory = read_json(inventory_path)
        if inventory.get("schema") != "upstate.planning-unit-inventory/v1":
            raise ValueError("Select the original native planning-unit inventory")
        unit_kind = state["unit_kind"]
    else:
        directory = workspace.root / "deliveries" / delivery_id
        state = read_json(directory / "delivery-state.json")
        if state.get("id") != delivery_id or state.get("schema") != "upstate.delivery/v1":
            raise ValueError("Select a retained scientific delivery")
        inventory = state.get("parcel_priorities")
        files = state.get("files", {})
        if not inventory or "parcel_csv" not in files or "parcel_inventory" not in files:
            raise ValueError("The selected delivery needs its completed planning unit inventory")
        csv_path = verify_file(directory, files["parcel_csv"])
        inventory_path = verify_file(directory, files["parcel_inventory"])
        if read_json(inventory_path) != inventory:
            raise ValueError("The selected planning unit inventory differs from its delivery record")
        if inventory.get("schema") != "upstate.parcel-priorities/v1":
            raise ValueError("Select the original parcel-priorities inventory")
        unit_kind = "parcel"
    original_selection = inventory["source"]["selection"]
    collection_id = identifier(original_selection["source_collection_id"])
    _, parcel_entry = _source_entry(workspace, collection_id, original_selection["source_id"])
    if parcel_entry["kind"] != "vector" or parcel_entry["body"]["sha256"] != inventory["source"]["sha256"]:
        raise ValueError("The planning unit inventory differs from its original polygon source")
    baseline_id = identifier(state["selection"]["baseline_run_id"])
    baseline = workspace.inspect_run(baseline_id)
    if baseline["state"] != "complete":
        raise ValueError("The retained planning unit inventory needs its original completed baseline")
    scenario_id = request["objective"]["scenario_run_id"]
    alternative = None
    if scenario_id:
        if scenario_id not in state["selection"].get("scenario_run_ids", []):
            raise ValueError("The selected scenario is not part of this planning unit inventory")
        alternative = workspace.inspect_run(scenario_id)
        if alternative["state"] != "complete":
            raise ValueError("Complete the selected native alternative before ranking its actual changes")
        if alternative["selection"]["grid_id"] != baseline["selection"]["grid_id"]:
            raise ValueError("Portfolio comparisons use the same retained model/reporting grid")
        if alternative["selection"]["profile_id"] != baseline["selection"]["profile_id"]:
            raise ValueError("Land-cover portfolio objectives use a common model parameter profile")
        if inventory.get("scenario_direction") != "alternative minus baseline":
            raise ValueError("The inventory must retain its original alternative-minus-baseline direction")
    cost_rows, cost_identity = {}, None
    costs = request["costs"]
    if costs:
        _, cost_entry = _source_entry(workspace, costs["source_collection_id"], costs["source_id"])
        if cost_entry["kind"] != "table":
            raise ValueError("Per-feature estimates must come from a retained source table")
        cost_path, _ = workspace.source_file(costs["source_collection_id"], costs["source_id"])
        cost_identity = {**_source_identity(costs["source_collection_id"], cost_entry),
                         "selection": deepcopy(costs)}
        for line, row in _csv(cost_path, [costs["feature_id_field"], costs["cost_field"]], "Cost CSV"):
            feature_id = row[costs["feature_id_field"]]
            if not feature_id.strip() or feature_id in cost_rows:
                raise ValueError("Cost CSV IDs must be nonempty and unique; row " + str(line))
            cost_rows[feature_id] = _money(row[costs["cost_field"]], "Cost CSV row " + str(line))
    required = [
        "feature_id", "original_attributes", "area_ha", "reporting_area_ha",
        "protected_fraction", "source_water", "high_quality_context",
        "priority_mean", "valid_pixels", "coverage_fraction", "scenario_changes",
        *MASS_FIELDS.values(),
    ]
    rows, seen = [], set()
    for line, original in _csv(csv_path, required, "Planning unit CSV"):
        feature_id = original["feature_id"]
        if not feature_id.strip() or feature_id in seen:
            raise ValueError("Planning unit IDs must be nonempty and unique; row " + str(line))
        seen.add(feature_id)
        attributes = _json(original["original_attributes"], "Original planning unit attributes")
        changes = _json(original["scenario_changes"], "Original planning unit scenario changes")
        if not isinstance(attributes, dict) or not isinstance(changes, dict):
            raise ValueError("Original attributes and scenario changes must be JSON objects")
        row = {
            "feature_id": feature_id, "source_row": line,
            "original_attributes": attributes,
            "original_area_ha": _number(original["area_ha"], "Original planning unit area", minimum=0),
            "area_ha": _number(original["reporting_area_ha"], "Reporting planning unit area", minimum=0),
            "coverage_fraction": _number(original["coverage_fraction"], "Planning unit coverage", minimum=0, maximum=1),
            "protected_fraction": _number(original["protected_fraction"], "Protected fraction",
                                          minimum=0, maximum=1, optional=bool(inventory_id)),
            "valid_pixels": _integer(original["valid_pixels"], "Valid pixel count"),
            "priority_mean": _number(original["priority_mean"], "Original combined priority", optional=True),
            "cost_usd": _usd(cost_rows.get(feature_id)),
            "baseline_metrics": {
                metric: _number(original[field], metric + " original mass", minimum=0, optional=True)
                for metric, field in MASS_FIELDS.items()
            },
        }
        for name in ("source_water", "high_quality_context"):
            flag = _integer(original[name], "Planning unit " + name, optional=bool(inventory_id))
            if flag not in (None, 0, 1):
                raise ValueError("Planning-unit " + name + " must preserve its original 0/1 flag")
            row[name] = None if flag is None else bool(flag)
        selected_changes = changes.get(scenario_id, {}) if scenario_id else {}
        if not isinstance(selected_changes, dict):
            raise ValueError("Each retained alternative must contain pollutant changes")
        row["scenario_changes"] = {
            metric: _number(selected_changes.get(metric), metric + " scenario change", optional=True)
            for metric in METRICS
        }
        sign = -1 if request["objective"]["kind"] == "restoration" else 1
        row["physical_metrics"] = {
            metric: (row["baseline_metrics"][metric]
                     if request["objective"]["kind"] == "current-export"
                     else None if row["scenario_changes"][metric] is None
                     else sign * row["scenario_changes"][metric])
            for metric in METRICS
        }
        rows.append(row)
    if not rows:
        raise ValueError("The original planning unit CSV contains no planning units")
    if inventory.get("features") != len(rows):
        raise ValueError("The planning unit CSV row count differs from its retained inventory")
    context = {
        "project_id": workspace.project["id"], "delivery_id": delivery_id,
        "inventory_id": inventory_id, "unit_kind": unit_kind,
        "delivery_state": state.get("state") if delivery_id else None,
        "baseline_run_id": baseline_id,
        "available_metrics": [metric for metric in METRICS
                              if any(row["physical_metrics"][metric] is not None for row in rows)],
        "coverage_method": (inventory.get("coverage_method") or
                            (inventory.get("coverage", {}).get("support") if inventory_id else None) or
                            ("Common valid native cells across selected runs and pollutants within the reporting-area feature"
                             if inventory_id else
                             "Baseline combined-priority valid pixel fraction within the reporting-area feature")),
        "grid_id": baseline["selection"]["grid_id"], "profile_id": baseline["selection"]["profile_id"],
        "scenario_run_id": scenario_id,
        "scenario_selection": deepcopy(alternative["selection"]) if alternative else None,
        "parcel_source": _source_identity(collection_id, parcel_entry),
        "parcel_source_selection": deepcopy(original_selection),
        "parcel_csv": describe_file(workspace.root, csv_path),
        "parcel_inventory": describe_file(workspace.root, inventory_path),
        "inventory_coverage": deepcopy(inventory.get("coverage", inventory.get("parcel_coverage"))),
        "inventory_overlap_handling": inventory.get("overlap_handling"),
        "cost_source": cost_identity,
        "cost_join": {
            "method": "Exact original string feature_id; no inferred price or currency conversion",
            "supplied_rows": len(cost_rows),
            "unmatched_feature_ids": sorted(set(cost_rows) - seen),
            "matched_known_costs": sum(feature_id in seen and value is not None
                                       for feature_id, value in cost_rows.items()),
        },
        "physical_units": UNITS,
    }
    return rows, context


def _qualify(rows, request):
    filters = request["filters"]
    included, excluded = set(filters["include_feature_ids"]), set(filters["exclude_feature_ids"])
    actual = {row["feature_id"] for row in rows}
    unknown = (included | excluded) - actual
    if unknown:
        raise ValueError("A selected feature ID is absent from this inventory: " + ", ".join(sorted(unknown)[:10]))
    for row in rows:
        reasons = []
        if included and row["feature_id"] not in included:
            reasons.append("Outside selected feature universe")
        if row["feature_id"] in excluded:
            reasons.append("Explicitly excluded")
        if row["area_ha"] <= 0:
            reasons.append("No reporting-area footprint")
        if row["valid_pixels"] <= 0:
            reasons.append("No valid inventory pixels")
        if row["coverage_fraction"] < filters["min_coverage_fraction"]:
            reasons.append("Below minimum inventory coverage")
        if row["protected_fraction"] is None:
            if filters["max_protected_fraction"] < 1:
                reasons.append("Protected-area context is unavailable for the selected limit")
        elif row["protected_fraction"] > filters["max_protected_fraction"]:
            reasons.append("Above maximum protected fraction")
        for field, flag in (("source_water", "source_water"),
                            ("high_quality_water", "high_quality_context")):
            desired = filters[field]
            if desired != "any" and row[flag] is None:
                reasons.append("Unknown " + field.replace("_", " ") + " context")
            elif desired != "any" and row[flag] != (desired == "yes"):
                reasons.append("Outside " + field.replace("_", " ") + " selection")
        objective_values = {}
        for metric in METRICS:
            value = row["physical_metrics"][metric]
            if value is not None and request["objective"]["basis"] == "per-reporting-hectare":
                value = value / row["area_ha"] if row["area_ha"] > 0 else None
            if value is not None and not math.isfinite(value):
                raise ValueError("A planning unit objective is outside finite numeric range")
            objective_values[metric] = value
            if value is None and request["weights"][metric] > 0:
                reasons.append("Missing actual " + metric + " objective")
        row["objective_values"] = objective_values
        row["source_eligible"] = not reasons
        row["exclusions"] = reasons
    normalization = {
        metric: max((abs(row["objective_values"][metric])
                     for row in rows if row["source_eligible"] and row["objective_values"][metric] is not None),
                    default=0.0)
        for metric in METRICS
    }
    budget = _money(request["constraints"]["budget_usd"], "Portfolio budget")
    for row in rows:
        if budget is not None and row["cost_usd"] is None:
            row["exclusions"].append("No supplied cost for a budget selection")
        row["eligible"] = not row["exclusions"]
        row["normalized_metrics"] = {
            metric: (row["objective_values"][metric] / normalization[metric]
                     if row["objective_values"][metric] is not None and normalization[metric] else 0.0)
            for metric in METRICS
        }
    return {
        "method": "Maximum absolute objective value across source-qualified planning units, before cost exclusions",
        "scales": normalization, "basis": request["objective"]["basis"],
        "fixed_across_weight_profiles": True,
        "negative_values": "Retained adverse effects reduce the weighted objective",
    }


def _scored(rows, weights):
    scored = []
    for row in rows:
        # An axis introduced by a sensitivity profile still needs an actual value.
        available = all(row["objective_values"][metric] is not None
                        for metric in METRICS if weights[metric] > 0)
        if row["eligible"] and available:
            score = math.fsum(weights[metric] * row["normalized_metrics"][metric] for metric in METRICS)
            scored.append({
                "feature_id": row["feature_id"], "score": score,
                "cost_cents": _money(row["cost_usd"], "Retained cost"),
                "area_ha": row["area_ha"],
            })
    return sorted(scored, key=lambda row: (-row["score"], row["feature_id"]))


def _limits(constraints):
    return {"budget_cents": _money(constraints["budget_usd"], "Portfolio budget"),
            "area_ha": constraints["area_ha"], "max_count": constraints["max_count"]}


def _finite_sum(values, label):
    try:
        result = math.fsum(values)
    except OverflowError as error:
        raise ValueError(label + " exceeds finite numeric range") from error
    if not math.isfinite(result):
        raise ValueError(label + " must remain finite")
    return result


def _area_capacity(limits):
    area = limits["area_ha"]
    if area is None or area == 0:
        return area
    expanded = area + TOLERANCE * max(1.0, area)
    return expanded if math.isfinite(expanded) else area


def _totals(items):
    known = [item["cost_cents"] for item in items if item["cost_cents"] is not None]
    return {
        "count": len(items), "area_ha": _finite_sum((item["area_ha"] for item in items), "Selected planning unit area"),
        "known_cost_cents": sum(known),
        "unknown_cost_count": len(items) - len(known),
        "objective_score": _finite_sum((item["score"] for item in items), "Selected objective"),
    }


def _fits(totals, limits):
    budget, area, count = limits["budget_cents"], _area_capacity(limits), limits["max_count"]
    return ((budget is None or (totals["unknown_cost_count"] == 0 and totals["known_cost_cents"] <= budget))
            and (area is None or totals["area_ha"] <= area)
            and (count is None or totals["count"] <= count))


def _upper_float(value):
    """Round a nonnegative exact relaxation upward for its published bound."""
    number = float(value)
    return math.nextafter(number, math.inf) if Fraction(number) < value else number


def _fractional_bound(items, resource, capacity):
    # Exact ratios avoid overflow or underflow corrupting density order. The
    # bound is only a linear relaxation; the selected portfolio remains integer.
    free, priced = [], []
    for item in items:
        amount, score = Fraction(item[resource]), Fraction(item["score"])
        if amount == 0:
            free.append(score)
        else:
            priced.append((score / amount, item["feature_id"], amount, score))
    priced.sort(key=lambda row: (-row[0], row[1]))
    total, remaining = sum(free, Fraction(0)), Fraction(capacity)
    for _, _, amount, score in priced:
        if remaining <= 0:
            break
        used = min(amount, remaining)
        total += score * used / amount
        remaining -= used
    return _upper_float(total)


def _bound(items, limits):
    bounds = [("All positive objectives",
               _upper_float(sum((Fraction(item["score"]) for item in items), Fraction(0))))]
    if limits["budget_cents"] is not None:
        bounds.append(("Fractional budget relaxation",
                       _fractional_bound(items, "cost_cents", limits["budget_cents"])))
    if limits["area_ha"] is not None:
        area = _area_capacity(limits)
        # A correctly rounded fsum can accept an exact sum just above its float
        # cap. One outward ULP encloses every independently accepted area sum.
        outward = math.nextafter(area, math.inf)
        bounds.append(("Fractional reporting-area relaxation",
                       _fractional_bound(items, "area_ha", outward if math.isfinite(outward) else area)))
    if limits["max_count"] is not None:
        count_rows = sorted(items, key=lambda row: (-row["score"], row["feature_id"]))[:limits["max_count"]]
        bounds.append(("Exact count-only relaxation",
                       _upper_float(sum((Fraction(item["score"]) for item in count_rows), Fraction(0)))))
    return min(value for _, value in bounds), [{"method": name, "upper_bound": value} for name, value in bounds]


def _deterministic(scored, constraints):
    limits = _limits(constraints)
    positive = [row for row in scored if row["score"] > 0 and _fits(_totals([row]), limits)]
    upper, bounds = _bound(positive, limits)
    if not positive:
        return [], {"status": "optimal", "algorithm": "Empty positive feasible set",
                    "upper_bound": 0.0, "objective_score": 0.0, "relative_gap": 0.0, "bounds": bounds}
    if _fits(_totals(positive), limits):
        score = _totals(positive)["objective_score"]
        return positive, {"status": "optimal", "algorithm": "All positive candidates are feasible",
                          "upper_bound": score, "objective_score": score, "relative_gap": 0.0, "bounds": bounds}
    if limits["budget_cents"] is None and limits["area_ha"] is None:
        chosen = positive[:limits["max_count"]]
        score = _totals(chosen)["objective_score"]
        return chosen, {"status": "optimal", "algorithm": "Exact descending score with count constraint",
                        "upper_bound": score, "objective_score": score, "relative_gap": 0.0, "bounds": bounds}
    orders = [("Objective order", sorted(positive, key=lambda row: (-row["score"], row["feature_id"])))]
    for name, capacity in (("cost_cents", limits["budget_cents"]), ("area_ha", limits["area_ha"])):
        if capacity is not None:
            orders.append((name + " density",
                sorted(positive, key=lambda row: (
                    -math.inf if row[name] == 0 else -row["score"] / row[name], row["feature_id"]))))
    def combined_density(row):
        demands = []
        for resource, capacity in (("cost_cents", limits["budget_cents"]), ("area_ha", limits["area_ha"])):
            if capacity is not None and capacity > 0:
                demands.append(row[resource] / capacity)
        if limits["max_count"] is not None and limits["max_count"] > 0:
            demands.append(1 / limits["max_count"])
        demand = math.fsum(demands)
        return -math.inf if demand == 0 else -row["score"] / demand
    orders.append(("Combined resource density",
                   sorted(positive, key=lambda row: (combined_density(row), row["feature_id"]))))
    candidates = []
    for name, order in orders:
        chosen = []
        running = {"count": 0, "area_ha": 0.0, "known_cost_cents": 0,
                   "unknown_cost_count": 0, "objective_score": 0.0}
        for item in order:
            trial = {
                "count": running["count"] + 1,
                "area_ha": running["area_ha"] + item["area_ha"],
                "known_cost_cents": running["known_cost_cents"] + (item["cost_cents"] or 0),
                "unknown_cost_count": running["unknown_cost_count"] + int(item["cost_cents"] is None),
                "objective_score": running["objective_score"] + item["score"],
            }
            if _fits(trial, limits):
                chosen.append(item)
                running = trial
        # The final independent sum is the same constraint basis reported to the operator.
        while chosen and not _fits(_totals(chosen), limits):
            chosen.pop()
        candidates.append((name, chosen))
    best_single = min(positive, key=lambda row: (-row["score"], row["feature_id"]))
    candidates.append(("Best feasible individual planning unit", [best_single]))
    name, chosen = min(candidates, key=lambda pair: (
        -_totals(pair[1])["objective_score"], tuple(sorted(row["feature_id"] for row in pair[1]))))
    score = _totals(chosen)["objective_score"]
    upper = max(upper, score)
    gap = max(0.0, upper - score)
    return chosen, {
        "status": "optimal" if gap <= TOLERANCE * max(1.0, upper) else "feasible",
        "algorithm": "Deterministic multi-order greedy with best individual planning unit",
        "selected_order": name, "upper_bound": upper, "objective_score": score,
        "absolute_gap": gap, "relative_gap": gap / upper if upper > 0 else 0.0, "bounds": bounds,
        "optimality_tolerance": TOLERANCE * max(1.0, upper),
        "optimality_basis": "Relaxation bound closes within the declared numerical tolerance" if gap <= TOLERANCE * max(1.0, upper) else
                            "Feasible integer selection; remaining gap bounded by fractional relaxations",
    }


def _optimize(scored, request):
    chosen, result = _deterministic(scored, request["constraints"])
    result["requested_solver"] = request["solver"]
    limits = _limits(request["constraints"])
    area_capacity = _area_capacity(limits)
    result["area_feasibility_tolerance_ha"] = (
        0.0 if area_capacity is None else area_capacity - limits["area_ha"])
    result["effective_area_limit_ha"] = area_capacity
    if request["solver"] != "scipy-milp" or result["status"] == "optimal":
        return chosen, result
    try:
        import numpy as np
        from scipy.optimize import Bounds, LinearConstraint, milp
    except (ImportError, AttributeError):
        result["optional_solver"] = {"available": False, "fallback": "Completed deterministic selection"}
        return chosen, result
    limits = _limits(request["constraints"])
    positive = [row for row in scored if row["score"] > 0 and _fits(_totals([row]), limits)]
    matrix, upper = [], []
    try:
        for resource, capacity in (("cost_cents", limits["budget_cents"]), ("area_ha", area_capacity)):
            if capacity is not None:
                scale = max(1, capacity)
                values = [row[resource] / scale for row in positive]
                if any(value == 0 and row[resource] != 0 for row, value in zip(positive, values)):
                    raise ValueError("Selected resource range exceeds optional solver numeric resolution")
                matrix.append(values)
                upper.append(capacity / scale)
        if limits["max_count"] is not None and limits["max_count"] < len(positive):
            matrix.append([1.0] * len(positive))
            upper.append(float(limits["max_count"]))
        answer = milp(
            c=-np.asarray([row["score"] for row in positive], dtype=float),
            integrality=np.ones(len(positive), dtype=int), bounds=Bounds(0, 1),
            constraints=LinearConstraint(np.asarray(matrix), -np.inf, np.asarray(upper)),
            options={"time_limit": request["solver_time_limit_seconds"], "mip_rel_gap": 0.0},
        )
    except Exception as error:
        result["optional_solver"] = {
            "available": True, "error_type": type(error).__name__, "message": str(error),
            "fallback": "Completed deterministic selection",
        }
        return chosen, result
    receipt = {"available": True, "status": int(answer.status), "message": str(answer.message)}
    if answer.x is None or len(answer.x) != len(positive) or any(
            not math.isfinite(float(x)) or float(x) < -1e-6 or float(x) > 1 + 1e-6
            or abs(float(x) - round(float(x))) > 1e-6 for x in answer.x):
        result["optional_solver"] = receipt
        return chosen, result
    proposed = [row for row, value in zip(positive, answer.x) if float(value) > .5]
    if not _fits(_totals(proposed), limits):
        receipt["selection_feasible"] = False
        result["optional_solver"] = receipt
        return chosen, result
    proposed_score = _totals(proposed)["objective_score"]
    receipt["selection_feasible"] = True
    if proposed_score < result["objective_score"]:
        receipt["incumbent_retained"] = True
        result["optional_solver"] = receipt
        return chosen, result
    chosen = proposed
    upper_bound = result["upper_bound"]
    dual = getattr(answer, "mip_dual_bound", None)
    if dual is not None and math.isfinite(float(dual)):
        observed_bound = -float(dual)
        receipt["dual_bound_consistent"] = observed_bound + TOLERANCE * max(
            1.0, proposed_score) >= proposed_score
        if receipt["dual_bound_consistent"]:
            upper_bound = min(upper_bound, observed_bound)
    upper_bound = max(proposed_score, upper_bound)
    reported_objective = getattr(answer, "fun", None)
    exact = (int(answer.status) == 0 and reported_objective is not None
             and receipt.get("dual_bound_consistent", True)
             and math.isfinite(float(reported_objective))
             and abs(float(reported_objective) + proposed_score) <= 1e-6 * max(1.0, proposed_score))
    gap = max(0.0, upper_bound - proposed_score)
    result.update({
        "status": "optimal" if exact or gap <= TOLERANCE * max(1.0, upper_bound) else "feasible",
        "algorithm": "SciPy HiGHS mixed-integer selection",
        "objective_score": proposed_score, "upper_bound": proposed_score if exact else upper_bound,
        "absolute_gap": 0.0 if exact else gap,
        "relative_gap": 0.0 if exact or upper_bound == 0 else gap / upper_bound,
        "optional_solver": receipt,
        "optimality_basis": "Native solver optimal status and independently feasible integer selection"
                            if exact else "Native solver feasible selection and retained relaxation bound",
    })
    return chosen, result


def _profile_set(request):
    nominal = request["weights"]
    available = tuple(request.get("available_metrics", METRICS))
    profiles = [{"name": "Selected weights", "weights": nominal}]
    if not request["stability"]["enabled"]:
        return profiles
    supplied = request["stability"]["profiles"]
    if supplied:
        for profile in supplied:
            if any(profile["weights"][metric] > 0 for metric in METRICS if metric not in available):
                raise ValueError("A sensitivity profile requires an unavailable native pollutant objective")
        profiles.extend(supplied)
    elif available:
        profiles.append({"name": "Equal available pollutant weights",
                         "weights": _weights({metric: 1 for metric in available})})
        for metric in available:
            profiles.append({"name": metric + " only", "weights": _weights({metric: 1})})
            if nominal[metric] > 0:
                for multiplier in (.5, 2):
                    changed = dict(nominal)
                    changed[metric] *= multiplier
                    profiles.append({"name": metric + " weight x" + str(multiplier), "weights": _weights(changed)})
    unique, seen = [], set()
    for profile in profiles:
        key = tuple(round(profile["weights"][metric], 14) for metric in METRICS)
        if key not in seen:
            seen.add(key)
            unique.append(profile)
    return unique


def _stability(rows, request, nominal_selected, nominal_optimization):
    profiles = _profile_set(request)
    by_feature = {row["feature_id"]: {"ranks": [], "selected": 0, "eligible_profiles": 0} for row in rows}
    receipts = []
    for index, profile in enumerate(profiles):
        scored = _scored(rows, profile["weights"])
        if index == 0:
            selected, optimization = nominal_selected, nominal_optimization
        else:
            selected, optimization = _deterministic(scored, request["constraints"])
        selected_ids = {row["feature_id"] for row in selected}
        for rank, item in enumerate(scored, 1):
            observed = by_feature[item["feature_id"]]
            observed["ranks"].append(rank)
            observed["eligible_profiles"] += 1
            observed["selected"] += int(item["feature_id"] in selected_ids)
        receipts.append({
            **profile, "selected_feature_ids": sorted(selected_ids), "selected_count": len(selected_ids),
            "optimization": optimization, "ranked_count": len(scored),
        })
    for row in rows:
        observed = by_feature[row["feature_id"]]
        ranks = observed["ranks"]
        row["rank_stability"] = {
            "min_rank": min(ranks) if ranks else None, "max_rank": max(ranks) if ranks else None,
            "mean_rank": math.fsum(ranks) / len(ranks) if ranks else None,
            "selected_profiles": observed["selected"], "profile_count": len(profiles),
            "eligible_profiles": observed["eligible_profiles"],
            "selected_fraction": observed["selected"] / len(profiles),
        }
    return {
        "enabled": request["stability"]["enabled"], "profiles": receipts,
        "method": "Preference sensitivity on retained objective values; fixed normalization and constraints",
        "rank_ties": "Descending score, then exact original feature ID",
        "selection_method": "Nominal selected solver; deterministic bounded selection for other preference profiles",
        "interpretation": "Selection frequency across named preferences, not a probability or scientific uncertainty interval",
    }


def _selection_summary(chosen, rows):
    chosen_ids = {item["feature_id"] for item in chosen}
    originals = [row for row in rows if row["feature_id"] in chosen_ids]
    totals = _totals(chosen)
    physical = {}
    for metric in METRICS:
        values = [row["physical_metrics"][metric] for row in originals]
        known_sum = _finite_sum((value for value in values if value is not None), "Selected " + metric)
        physical[metric] = {
            "sum": None if any(value is None for value in values) else known_sum,
            "known_sum": known_sum,
            "known_parcels": sum(value is not None for value in values),
            "missing_parcels": sum(value is None for value in values), "units": UNITS[metric],
        }
    return {
        "feature_ids": sorted(chosen_ids), "count": len(chosen_ids),
        "area_ha": totals["area_ha"], "known_cost_usd": _usd(totals["known_cost_cents"]),
        "unknown_cost_count": totals["unknown_cost_count"],
        "cost_usd": None if totals["unknown_cost_count"] else _usd(totals["known_cost_cents"]),
        "objective_score": totals["objective_score"], "physical_metrics": physical,
        "aggregation": "Independent planning unit reporting-area footprints in the selected original scenario",
    }


def preview(workspace, selection):
    request = _request(selection)
    rows, context = _load_inputs(workspace, request)
    request["available_metrics"] = list(context["available_metrics"])
    if selection.get("weights") is None:
        request["weights"] = _weights({metric: 1 for metric in request["available_metrics"]})
    unavailable = [metric for metric, weight in request["weights"].items()
                   if weight > 0 and metric not in request["available_metrics"]]
    if unavailable:
        raise ValueError("Positive weights require available native inventory outputs: " +
                         ", ".join(unavailable))
    normalization = _qualify(rows, request)
    scored = _scored(rows, request["weights"])
    ranking = {item["feature_id"]: (index + 1, item["score"]) for index, item in enumerate(scored)}
    chosen, optimization = _optimize(scored, request)
    selected_ids = {row["feature_id"] for row in chosen}
    for row in rows:
        row["rank"], row["score"] = ranking.get(row["feature_id"], (None, None))
        row["selected"] = row["feature_id"] in selected_ids
        row["eligible"] = row["feature_id"] in ranking
    stability = _stability(rows, request, chosen, optimization)
    counts = Counter(reason for row in rows for reason in row["exclusions"])
    ordered = sorted(rows, key=lambda row: (
        row["rank"] is None, row["rank"] if row["rank"] is not None else 0, row["feature_id"]))
    return {
        "schema": ANALYSIS_SCHEMA, "context": context, "request": request,
        "normalization": normalization,
        "counts": {
            "inventory": len(rows), "eligible": len(scored), "excluded": len(rows) - len(scored),
            "selected": len(chosen), "unknown_costs": sum(row["cost_usd"] is None for row in rows),
            "exclusion_reasons": dict(sorted(counts.items())),
        },
        "candidates": ordered, "selection": _selection_summary(chosen, rows),
        "optimization": optimization, "stability": stability,
        "methods": {
            "objective_direction": {
                "restoration": "Benefit = baseline minus actual alternative planning unit export",
                "avoided-conversion": "Exposure = actual conversion alternative minus baseline planning unit export",
                "current-export": "Current planning unit export footprint",
            }[request["objective"]["kind"]],
            "coverage": context["coverage_method"],
            "costs": "Supplied per-feature USD estimates; blanks and absent rows remain unknown",
            "score": "Weighted signed normalized objectives; zero and negative total scores are not selected",
            "area": "Reporting-area planning unit hectares; original overlapping planning units remain independent",
            "combined_effect": "Selected planning unit sums locate contributions in the saved scenario. Execute the saved portfolio land-cover scenario to obtain the combined treatment result.",
            "current_priority": "Original priority_mean is retained separately; planning unit objective weighting is a distinct decision calculation",
            "restoration_scope": "Avoided-conversion and restoration use different explicitly selected native alternatives",
            "numerics": "Budget arithmetic uses integer USD cents; ranking and area arithmetic use finite double precision",
        },
    }


def _csv_bytes(rows, fields):
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore", lineterminator="\n")
    writer.writeheader()
    for row in rows:
        writer.writerow({field: (json.dumps(row.get(field), ensure_ascii=False, sort_keys=True, allow_nan=False)
                                if isinstance(row.get(field), (dict, list)) else row.get(field))
                         for field in fields})
    return stream.getvalue().encode("utf-8")


def save_portfolio(workspace, selection):
    analysis = preview(workspace, selection)
    analysis_id = digest(analysis)
    directory = workspace.root / "portfolio-data" / analysis_id
    with held(workspace.root / ".portfolio.lock"):
        atomic_json(directory / "analysis.json", analysis, immutable=True)
        candidate_fields = [
            "feature_id", "rank", "selected", "eligible", "score", "area_ha", "original_area_ha",
            "coverage_fraction", "protected_fraction", "source_water", "high_quality_context",
            "cost_usd", "priority_mean", "baseline_metrics", "scenario_changes", "physical_metrics",
            "objective_values", "normalized_metrics", "rank_stability", "exclusions", "original_attributes",
        ]
        atomic_bytes(directory / "candidate-ranking.csv",
                     _csv_bytes(analysis["candidates"], candidate_fields), immutable=True)
        selected = [row for row in analysis["candidates"] if row["selected"]]
        atomic_bytes(directory / "selected-parcels.csv", _csv_bytes(selected, candidate_fields), immutable=True)
        for source_name, filename in (("parcel_csv", "input-parcels.csv"), ("parcel_inventory", "input-inventory.json")):
            source = verify_file(workspace.root, analysis["context"][source_name])
            atomic_bytes(directory / filename, source.read_bytes(), immutable=True)
        source_manifest = {
            "schema": "upstate.portfolio-inputs/v1", "analysis_sha256": analysis_id,
            "context": analysis["context"], "request": analysis["request"],
        }
        atomic_json(directory / "source-manifest.json", source_manifest, immutable=True)
        files = {name: describe_file(workspace.root, directory / filename) for name, filename in (
            ("analysis", "analysis.json"), ("candidate_ranking", "candidate-ranking.csv"),
            ("selected_parcels", "selected-parcels.csv"), ("source_manifest", "source-manifest.json"),
            ("input_parcels", "input-parcels.csv"), ("input_inventory", "input-inventory.json"))}
        stability_summary = {
            "enabled": analysis["stability"]["enabled"],
            "profile_count": len(analysis["stability"]["profiles"]),
            "profiles": [{"name": p["name"], "weights": p["weights"], "selected_count": p["selected_count"],
                           "optimization": p["optimization"]} for p in analysis["stability"]["profiles"]],
            "method": analysis["stability"]["method"], "interpretation": analysis["stability"]["interpretation"],
        }
        value = {
            "title": analysis["request"]["title"], "purpose": analysis["request"]["purpose"],
            "project_id": workspace.project["id"], "analysis_sha256": analysis_id,
            "request": analysis["request"], "context": analysis["context"], "counts": analysis["counts"],
            "normalization": analysis["normalization"], "selection": analysis["selection"],
            "optimization": analysis["optimization"], "stability": stability_summary,
            "methods": analysis["methods"], "files": files,
        }
        return workspace._save(KIND, value)


def verify_portfolio(workspace, record):
    if record.get("project_id") != workspace.project["id"]:
        raise ValueError("The portfolio belongs to another original scientific project")
    for member in record["files"].values():
        verify_file(workspace.root, member)
    analysis = read_json(verify_file(workspace.root, record["files"]["analysis"]))
    if analysis.get("schema") != ANALYSIS_SCHEMA or digest(analysis) != record["analysis_sha256"]:
        raise ValueError("The portfolio analysis differs from its retained identity")
    for name in ("context", "request", "selection", "counts", "normalization", "optimization", "methods"):
        if analysis[name] != record[name]:
            raise ValueError("The portfolio summary differs from its original analysis: " + name)
    context = record["context"]
    for name, copy_name in (("parcel_csv", "input_parcels"), ("parcel_inventory", "input_inventory")):
        retained = record["files"][copy_name]
        if any(retained[key] != context[name][key] for key in ("bytes", "sha256")):
            raise ValueError("The retained portfolio input copy differs from its original inventory")
    for source in (context["parcel_source"], context.get("cost_source")):
        if source:
            _, entry = _source_entry(workspace, source["source_collection_id"], source["source_id"])
            if entry["body"] != source["body"]:
                raise ValueError("A retained portfolio source selection changed")
    chosen = {row["feature_id"] for row in analysis["candidates"] if row["selected"]}
    if chosen != set(record["selection"]["feature_ids"]) or len(chosen) != record["selection"]["count"]:
        raise ValueError("The original portfolio feature selection differs")
    return {"portfolio_id": record.get("id"), "analysis_sha256": record["analysis_sha256"],
            "selected_features": len(chosen), "source_files": len(record["files"])}


def get_portfolio(workspace, portfolio_id, *, details=True):
    record = workspace._get(KIND, identifier(portfolio_id))
    verify_portfolio(workspace, record)
    if details:
        record = deepcopy(record)
        record["analysis"] = read_json(verify_file(workspace.root, record["files"]["analysis"]))
    return record


def overview(workspace):
    return {"portfolios": workspace._list(KIND), "portfolio_reports": workspace._list(REPORT_KIND)}


def _treatments(value, selected_ids):
    originals = value.get("treatments")
    if originals is None:
        originals = [{
            "feature_ids": sorted(selected_ids), "from_codes": value.get("from_codes"),
            "to_code": value.get("to_code"), "reason": value.get("reason"),
        }]
    if not isinstance(originals, list) or not originals:
        raise ValueError("Describe the actual selected-parcel land-cover treatment")
    result, assigned = [], set()
    for position, original in enumerate(originals, 1):
        if not isinstance(original, dict):
            raise ValueError("Each treatment must be an object")
        ids = _ids(original.get("feature_ids"), "Treatment feature IDs")
        if not ids or set(ids) - selected_ids:
            raise ValueError("A treatment must use selected original portfolio features")
        if set(ids) & assigned:
            raise ValueError("Assign each selected feature to one explicit treatment")
        assigned.update(ids)
        codes = original.get("from_codes")
        target = original.get("to_code")
        if not isinstance(codes, list) or not codes or any(type(code) is not int or code < 0 for code in codes):
            raise ValueError("Treatment from_codes must contain the actual integer land-cover classes")
        if len(codes) != len(set(codes)) or type(target) is not int or target < 0:
            raise ValueError("Use distinct integer source classes and one integer destination class")
        if all(code == target for code in codes):
            raise ValueError("A treatment must change at least one selected land-cover class")
        result.append({
            "id": "treatment-" + str(position), "feature_ids": sorted(ids), "from_codes": codes,
            "to_code": target, "reason": _text(original.get("reason"), "Treatment reason", required=True),
        })
    if assigned != selected_ids:
        raise ValueError("Every selected planning unit needs an explicit land-cover treatment")
    return result


def _scenario_id_field(context, entry, candidates, selected_ids, rows):
    """Use the original inventory's ID contract, including older delivery records."""
    selected = context["parcel_source_selection"].get("id_field")
    if selected or context.get("inventory_id") or not context.get("delivery_id"):
        return selected
    # Older delivery inventories did not freeze the effective field. Prefer the
    # original Fiona mapping when it reproduces every selected attribute row;
    # otherwise resolve the declared field against those same retained records.
    def matches(field):
        found = set()
        for row in rows:
            feature_id = str(row["properties"].get(field)) if field else row["id"]
            if feature_id not in selected_ids:
                continue
            if (feature_id in found or feature_id not in candidates
                    or row["properties"] != candidates[feature_id]["original_attributes"]):
                return False
            found.add(feature_id)
        return found == selected_ids

    if matches(None):
        return None
    declared = entry.get("id_field")
    if declared and matches(declared):
        return declared
    return None


def prepare_scenario(workspace, selection):
    record = get_portfolio(workspace, identifier(selection.get("portfolio_id")), details=True)
    selected_ids = set(record["selection"]["feature_ids"])
    if not selected_ids:
        raise ValueError("Save a portfolio with selected planning units before creating a land-cover scenario")
    title = _text(selection.get("title") or record["title"] + " land-cover treatment", "Scenario title", required=True)
    reason = _text(selection.get("reason"), "Actual scenario assumptions", required=True)
    treatments = _treatments(selection, selected_ids)
    context = record["context"]
    native_selection = context["parcel_source_selection"]
    original, entry = workspace.source_file(native_selection["source_collection_id"], native_selection["source_id"])
    if entry["body"] != context["parcel_source"]["body"]:
        raise ValueError("The selected planning unit geometry differs from the portfolio's source edition")
    import fiona
    import os
    import tempfile
    from pyproj import CRS
    from shapely.geometry import mapping, MultiPolygon
    from shapely.ops import unary_union
    from .common import file_digest
    from . import rasters
    grid = workspace.get_grid(context["grid_id"])
    grid_crs = CRS.from_user_input(grid["grid"]["crs"])
    rows, _ = rasters.vector_geometry(
        original, layer=native_selection.get("layer") or entry.get("layer"),
        where=native_selection.get("where"), target_crs=grid_crs)
    grid_directory = workspace.root / "grids" / grid["id"]
    reporting_path = verify_file(grid_directory, grid["files"]["reporting_area"])
    boundaries, _ = rasters.vector_geometry(reporting_path, target_crs=grid_crs)
    reporting = rasters.polygon_union(boundaries)
    treatment_by_id = {feature_id: treatment["id"] for treatment in treatments for feature_id in treatment["feature_ids"]}
    original_candidates = {row["feature_id"]: row for row in record["analysis"]["candidates"] if row["selected"]}
    id_field = _scenario_id_field(context, entry, original_candidates, selected_ids, rows)
    features, found = [], set()
    for row in rows:
        feature_id = str(row["properties"].get(id_field)) if id_field else row["id"]
        if feature_id not in selected_ids:
            continue
        if feature_id in found:
            raise ValueError("Selected original planning unit identities are not unique")
        if row["properties"] != original_candidates[feature_id]["original_attributes"]:
            raise ValueError("Original selected planning unit attributes differ from the retained inventory")
        # Match priorities.parcel_inventory: clip in the retained grid CRS.
        # A boundary-only contact has no polygonal treatment area.
        clipped = row["geometry"].intersection(reporting)
        parts, pending = [], [clipped]
        while pending:
            part = pending.pop()
            if part.is_empty:
                continue
            if part.geom_type == "Polygon":
                parts.append(part)
            elif part.geom_type in ("MultiPolygon", "GeometryCollection"):
                pending.extend(part.geoms)
        geometry = unary_union(parts)
        if geometry.is_empty or geometry.area <= 0:
            raise ValueError("A selected planning unit has no original reporting-area polygon")
        if geometry.geom_type == "Polygon":
            geometry = MultiPolygon([geometry])
        if geometry.geom_type != "MultiPolygon":
            raise ValueError("Selected planning unit clipping must retain polygon geometry")
        found.add(feature_id)
        features.append({
            "type": "Feature", "id": feature_id, "geometry": mapping(geometry),
            "properties": {
                "portfolio_feature_id": feature_id, "treatment_id": treatment_by_id[feature_id],
                "original_attributes": json.dumps(row["properties"], ensure_ascii=False, sort_keys=True, allow_nan=False),
            },
        })
    if found != selected_ids:
        raise ValueError("The original source does not contain every selected portfolio feature")
    features.sort(key=lambda feature: feature["id"])
    body = {"type": "FeatureCollection", "features": features}
    source_key = digest({
        "portfolio_id": record["id"], "title": title, "treatments": treatments,
        "reporting_area": grid["files"]["reporting_area"],
        "geometry_crs": grid_crs.to_wkt(), "geometry": body,
    })
    directory = workspace.root / "portfolio-sources" / source_key
    layer = "portfolio_selected_parcels"
    manifest = {
        "schema": "upstate.sources/v1", "title": title + " selected original planning units",
        "entries": [{
            "id": "portfolio-selected-parcels", "path": "selected-parcels.gpkg",
            "kind": "vector", "layer": layer,
            "title": title + " treatment geometry", "uri": "urn:upstate:portfolio-mask:" + source_key,
            "vintage": entry["vintage"],
            "scope": "Selected original planning unit geometry clipped to the retained reporting boundary",
            "lineage": {
                "portfolio_id": record["id"], "source": context["parcel_source"],
                "original_selection": native_selection, "selected_feature_ids": sorted(selected_ids),
                "reporting_grid_id": grid["id"], "reporting_area": grid["files"]["reporting_area"],
                "coordinate_operation": "Original native planning unit and reporting geometries intersected in the retained model grid CRS; selected coordinates retained in GeoPackage without a geographic round trip",
                "geometry_crs": grid_crs.to_wkt(), "treatments": treatments,
            },
        }],
    }
    with held(workspace.root / ".portfolio-scenario.lock"):
        directory.mkdir(parents=True, exist_ok=True)
        mask_path = directory / "selected-parcels.gpkg"
        if not mask_path.exists():
            schema = {"geometry": "MultiPolygon", "properties": {
                "portfolio_feature_id": "str", "treatment_id": "str", "original_attributes": "str",
            }}
            with tempfile.TemporaryDirectory(prefix=".mask-", dir=directory) as temporary:
                temporary_path = Path(temporary) / "selected-parcels.gpkg"
                with rasters.vector_environment(), fiona.open(
                        temporary_path, "w", driver="GPKG", layer=layer,
                        crs_wkt=grid_crs.to_wkt(), schema=schema) as writer:
                    writer.writerecords({"geometry": feature["geometry"], "properties": feature["properties"]}
                                        for feature in features)
                os.replace(temporary_path, mask_path)
        retained, retained_crs = rasters.vector_geometry(mask_path, layer=layer)
        retained_features = [{
            "type": "Feature", "id": row["properties"].get("portfolio_feature_id"),
            "geometry": mapping(row["geometry"]), "properties": row["properties"],
        } for row in retained]
        if (retained_crs != grid_crs
                or any(not isinstance(feature["id"], str) for feature in retained_features)):
            raise ValueError("The retained selected planning unit source differs in grid CRS or feature identity")
        retained_features.sort(key=lambda feature: feature["id"])
        if canonical({"type": "FeatureCollection", "features": retained_features}) != canonical(body):
            raise ValueError("The retained treatment mask differs from the original selected planning unit geometry")
        manifest["entries"][0]["sha256"] = file_digest(mask_path)
        atomic_json(directory / "sources.json", manifest, immutable=True)
        collection = workspace.import_sources(directory / "sources.json")
        scenario = {
            "title": title, "reason": reason, "kind": "landcover",
            "source_collection_id": collection["id"], "portfolio_id": record["id"],
            "portfolio_analysis_sha256": record["analysis_sha256"],
            "portfolio_source": context["parcel_source"], "portfolio_feature_ids": sorted(selected_ids),
            "portfolio_treatments": treatments, "portfolio_reporting_grid_id": grid["id"],
            "patches": [{
                "mask_source_id": "portfolio-selected-parcels", "where": {"treatment_id": treatment["id"]},
                "from_codes": treatment["from_codes"], "to_code": treatment["to_code"],
                "reason": treatment["reason"],
            } for treatment in treatments],
            "overlap_policy": "Original distinct planning unit overlaps use the declared treatment order",
        }
        return workspace.save_scenario(scenario)


def _evaluation(workspace, record, selection):
    run_id = selection.get("evaluation_run_id")
    comparison_id = selection.get("comparison_id")
    if comparison_id and not run_id:
        raise ValueError("Select the actual portfolio evaluation run for a comparison")
    if not run_id:
        return None
    run = workspace.inspect_run(identifier(run_id))
    scenario = workspace._get("scenarios", run["selection"]["scenario_id"])
    if scenario.get("portfolio_id") != record["id"]:
        raise ValueError("The evaluation run belongs to another portfolio scenario")
    if run["selection"]["grid_id"] != record["context"]["grid_id"]:
        raise ValueError("The evaluated portfolio must retain its reporting/model grid")
    baseline = workspace.inspect_run(record["context"]["baseline_run_id"])
    for artifact in baseline.get("artifacts", {}).values():
        verify_file(workspace.root / "runs" / baseline["id"], artifact)
    result = {"run_id": run["id"], "state": run["state"], "selection": run["selection"],
              "scenario_id": scenario["id"], "artifacts": deepcopy(run.get("artifacts", {})),
              "baseline_run_id": baseline["id"],
              "baseline_artifacts": deepcopy(baseline.get("artifacts", {})),
              "profile_changed": run["selection"]["profile_id"] != record["context"]["profile_id"],
              "selected_models": list(run_models(run)),
              "ranking_baseline_run_id": baseline["id"],
              "ranking_baseline_models": list(run_models(baseline)),
              "models_changed": run_models(run) != run_models(baseline),
              "native_versions": {"ranking_baseline": portfolio_pairing.native_version(baseline),
                                  "evaluation": portfolio_pairing.native_version(run)}}
    for artifact in run.get("artifacts", {}).values():
        verify_file(workspace.root / "runs" / run["id"], artifact)
    if comparison_id:
        if run["state"] != "complete":
            raise ValueError("The comparison must contain the actual completed portfolio evaluation")
        comparison, baseline = _decision_comparison(workspace, record, run, selection)
        alternative = next(row for row in comparison["alternatives"] if row["run_id"] == run["id"])
        for artifact in baseline.get("artifacts", {}).values():
            verify_file(workspace.root / "runs" / baseline["id"], artifact)
        result.update({
            "baseline_run_id": baseline["id"],
            "baseline_selection": deepcopy(baseline["selection"]),
            "baseline_artifacts": deepcopy(baseline.get("artifacts", {})),
            "native_pair": portfolio_pairing.binding(
                workspace.inspect_run(record["context"]["baseline_run_id"]), run, baseline),
            "comparison": {
                "id": comparison["id"], "baseline_run_id": baseline["id"],
                "direction": comparison["direction"], "alternative": deepcopy(alternative),
            },
        })
    return result


def _display(value, *, money=False):
    if value is None:
        return "Unknown"
    if money:
        return "USD " + format(Decimal(str(value)), ",.2f")
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, (float, int)):
        return format(value, ",.4g")
    return str(value)


def _report_html(record, analysis, evaluation, title):
    esc = lambda value: html.escape(str(value), quote=True)
    selection = record["selection"]
    context = record["context"]
    selected = [row for row in analysis["candidates"] if row["selected"]]
    rows = []
    for row in selected:
        stability = row["rank_stability"]
        rows.append("<tr>" + "".join("<td>" + esc(value) + "</td>" for value in (
            row["feature_id"], _display(row["area_ha"]), _display(row["cost_usd"], money=True),
            _display(row["score"]), str(stability["selected_profiles"]) + "/" + str(stability["profile_count"]),
            _display(row["physical_metrics"]["nitrogen_export"]),
            _display(row["physical_metrics"]["phosphorus_export"]),
            _display(row["physical_metrics"]["sediment_export"]),
        )) + "</tr>")
    physical = "".join(
        "<tr><th>" + esc(metric.replace("_export", "").title()) + "</th><td>" +
        esc(_display(value["sum"])) + "</td><td>" + esc(value["units"]) +
        "</td><td>" + esc(value["known_parcels"]) + " known / " + esc(value["missing_parcels"]) +
        " missing</td></tr>" for metric, value in selection["physical_metrics"].items())
    method_rows = "".join("<dt>" + esc(name.replace("_", " ").capitalize()) +
                          "</dt><dd>" + esc(value) + "</dd>" for name, value in record["methods"].items())
    profiles = "".join("<tr><td>" + esc(profile["name"]) + "</td><td>" +
                       esc(profile["selected_count"]) + "</td><td>" +
                       esc(profile["optimization"]["status"]) + "</td><td>" +
                       esc(_display(profile["optimization"]["relative_gap"] * 100)) + "%</td></tr>"
                       for profile in analysis["stability"]["profiles"])
    evaluated = ""
    if evaluation:
        comparison = evaluation.get("comparison", {}).get("alternative", {}).get("artifacts", {})
        evaluated_rows = []
        for metric in METRICS:
            baseline = evaluation.get("baseline_artifacts", {}).get(metric, {})
            actual = evaluation.get("artifacts", {}).get(metric, {})
            change = comparison.get(metric, {})
            evaluated_rows.append("<tr>" + "".join("<td>" + esc(value) + "</td>" for value in (
                metric.replace("_export", "").title(),
                _display(baseline.get("sum")), _display(actual.get("sum")),
                actual.get("sum_units") or baseline.get("sum_units") or UNITS[metric],
                _display(change.get("sum_change")) if change else "Comparison pending",
                _display(change.get("valid_cells")) if change else "—",
            )) + "</tr>")
        native_pair = evaluation.get("native_pair", {})
        version_rows = []
        for key, label in (("ranking_baseline", "Original ranking baseline"),
                           ("baseline", "Matched comparison baseline"), ("evaluation", "Portfolio evaluation")):
            selected_run = native_pair.get(key) or {}
            for model, version in (selected_run.get("model_versions") or {}).items():
                version_rows.append("<tr><th>" + esc(label + " · " + model.upper()) + "</th><td class=\"identity\">" +
                    esc(selected_run.get("id", "")) + "</td><td>" +
                    esc(version.get("observed_stage_version") or version.get("observed_run_version") or "Unavailable") +
                    "</td><td>" + esc(version.get("requested_version") or "Unavailable") + "</td><td>" +
                    esc(version.get("basis") or "unavailable") + "</td></tr>")
        native_table = ("<h3>Retained native pairing</h3><table><thead><tr><th>Role</th><th>Run</th>"
                        "<th>Observed engine</th><th>Declared engine</th><th>Comparison basis</th>"
                        "</tr></thead><tbody>" + "".join(version_rows) + "</tbody></table>") if version_rows else ""
        evaluated = (
            "<section><h2>Native portfolio evaluation</h2><p>Original model run: " +
            esc(evaluation["state"]) + ". Parameter profile: " +
            esc("changed from the screening baseline" if evaluation["profile_changed"] else "same as the screening baseline") +
            ".</p><table><thead><tr><th>Pollutant</th><th>Baseline annual export</th>"
            "<th>Portfolio annual export</th><th>Units</th><th>Common-cell annual change</th>"
            "<th>Comparison cells</th></tr></thead><tbody>" + "".join(evaluated_rows) +
            "</tbody></table><p>Annual totals use each run's retained valid cells. Changes use the "
            "original comparison's common cells and are alternative minus baseline; negative values "
            "indicate lower modeled export.</p><p class=\"identity\">Baseline " +
            esc(evaluation.get("baseline_run_id", context["baseline_run_id"])) + " · Portfolio run " +
            esc(evaluation["run_id"]) + "</p>" + native_table +
            "<details><summary>Native run and comparison record</summary><pre>" +
            esc(json.dumps(evaluation, indent=2, ensure_ascii=False, allow_nan=False)) +
            "</pre></details></section>"
        )
    context = record["context"]
    return (
        "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
        "<title>" + esc(title) + "</title><style>"
        ":root{font:15px/1.5 system-ui,sans-serif;color:#202020;background:#fff}"
        "body{margin:0 auto;padding:36px;max-width:1200px}h1{font-size:28px;line-height:1.2}h2{font-size:20px}"
        "header{border-bottom:2px solid #333;padding-bottom:20px}section{margin:28px 0}"
        ".summary{display:grid;grid-template-columns:repeat(4,1fr);gap:18px}.summary div{border:1px solid #ccc;padding:14px}"
        ".summary strong{display:block;font-size:21px}.label{color:#555;font-size:13px}"
        "table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;font-size:13px}"
        "th,td{text-align:left;padding:8px;border-bottom:1px solid #ddd;vertical-align:top}th{background:#f3f3f3}"
        "dt{font-weight:600;margin-top:12px}dd{margin:3px 0 0}a{color:inherit}pre{white-space:pre-wrap;overflow-wrap:anywhere}"
        ".identity{font-family:ui-monospace,monospace;font-size:12px;overflow-wrap:anywhere}"
        "@media print{body{padding:0}.summary{display:block}.summary div{display:inline-block;width:20%;margin:0 1% 8px 0}"
        "thead{display:table-header-group}tr{break-inside:avoid}a{text-decoration:none}}"
        "</style><header><p class=\"label\">UPPER SAVANNAH · CONSERVATION PORTFOLIO</p><h1>" + esc(title) +
        "</h1><p>" + esc(record["purpose"]) + "</p><p class=\"identity\">Portfolio " + esc(record["id"]) +
        "</p></header><section class=\"summary\"><div><span class=\"label\">Selected planning units</span><strong>" +
        esc(selection["count"]) + "</strong></div><div><span class=\"label\">Reporting hectares</span><strong>" +
        esc(_display(selection["area_ha"])) + "</strong></div><div><span class=\"label\">Supplied cost total</span><strong>" +
        esc(_display(selection["cost_usd"], money=True)) + "</strong><small>" +
        esc(selection["unknown_cost_count"]) + " selected costs unknown</small></div><div><span class=\"label\">Selection status</span><strong>" +
        esc(record["optimization"]["status"].title()) + "</strong><small>Upper-bound gap " +
        esc(_display(record["optimization"]["relative_gap"] * 100)) + "%</small></div></section>"
        "<section><h2>Objective and limits</h2><p>" + esc(record["methods"]["objective_direction"]) +
        ". Basis: " + esc(record["request"]["objective"]["basis"]) + ".</p><pre>" +
        esc(json.dumps({"weights": record["request"]["weights"], "constraints": record["request"]["constraints"],
                        "filters": record["request"]["filters"]}, indent=2, ensure_ascii=False)) +
        "</pre><p>" + esc(record["optimization"]["algorithm"]) + ".</p></section>"
        "<section><h2>Selected planning unit contributions in the saved scenario</h2><table><thead><tr><th>Metric</th><th>Sum</th><th>Units</th><th>Coverage</th>"
        "</tr></thead><tbody>" + physical + "</tbody></table><p>" + esc(record["methods"]["combined_effect"]) +
        "</p><p>" + esc(context.get("inventory_overlap_handling") or record["methods"]["area"]) + "</p></section>"
        "<section><h2>Selected planning units</h2><table><thead><tr><th>Original feature</th><th>Hectares</th><th>Supplied cost</th>"
        "<th>Score</th><th>Selected preferences</th><th>N kg/year</th><th>P kg/year</th><th>Sediment t/year</th></tr></thead><tbody>" +
        "".join(rows) + "</tbody></table></section><section><h2>Preference stability</h2><p>" +
        esc(analysis["stability"]["interpretation"]) + "</p><table><thead><tr><th>Weight profile</th><th>Selected</th>"
        "<th>Selection status</th><th>Upper-bound gap</th></tr></thead><tbody>" + profiles +
        "</tbody></table></section>" + evaluated +
        "<section><h2>Original inputs</h2><p>" + esc(context["parcel_source"]["title"]) + " · " +
        esc(context["parcel_source"]["vintage"]) + "</p><p class=\"identity\">" +
        esc(context["parcel_source"]["uri"]) + "</p><p class=\"identity\">Source inventory " +
        esc(context.get("inventory_id") or context.get("delivery_id")) + " · Unit kind " +
        esc(context.get("unit_kind", "parcel")) +
        " · Baseline " + esc(context["baseline_run_id"]) + "</p><p class=\"identity\">Planning unit source SHA-256 " +
        esc(context["parcel_source"]["body"]["sha256"]) +
        "</p><p>The complete report archive contains selected-parcels.csv, candidate-ranking.csv, "
        "analysis.json and source-manifest.json alongside this report.</p></section>"
        "<section><h2>Methods</h2><dl>" + method_rows + "</dl></section></html>"
    ).encode("utf-8")


def build_report(workspace, selection):
    record = get_portfolio(workspace, identifier(selection.get("portfolio_id")), details=True)
    analysis = record.pop("analysis")
    title = _text(selection.get("title") or record["title"], "Report title", required=True)
    evaluation = _evaluation(workspace, record, selection)
    if evaluation:
        if evaluation["state"] != "complete":
            raise ValueError("Complete the selected native portfolio evaluation before reporting its result")
        if not evaluation.get("comparison"):
            run = workspace.inspect_run(evaluation["run_id"])
            comparison, _ = _decision_comparison(workspace, record, run, selection)
            evaluation = _evaluation(workspace, record, dict(selection, comparison_id=comparison["id"]))
    key = digest({"portfolio_id": record["id"], "title": title, "evaluation": evaluation, "version": 2})
    directory = workspace.root / "portfolio-reports" / key
    with held(workspace.root / ".portfolio-report.lock"):
        for name, filename in (("analysis", "analysis.json"), ("candidate_ranking", "candidate-ranking.csv"),
                               ("selected_parcels", "selected-parcels.csv"), ("source_manifest", "source-manifest.json"),
                               ("input_parcels", "input-parcels.csv"), ("input_inventory", "input-inventory.json")):
            original = verify_file(workspace.root, record["files"][name])
            atomic_bytes(directory / filename, original.read_bytes(), immutable=True)
        atomic_bytes(directory / "index.html", _report_html(record, analysis, evaluation, title), immutable=True)
        if evaluation:
            atomic_json(directory / "evaluation.json", evaluation, immutable=True)
        files = {
            name: describe_file(workspace.root, directory / filename)
            for name, filename in (("report", "index.html"), ("analysis", "analysis.json"),
                                   ("candidate_ranking", "candidate-ranking.csv"),
                                   ("selected_parcels", "selected-parcels.csv"),
                                   ("source_manifest", "source-manifest.json"),
                                   ("input_parcels", "input-parcels.csv"), ("input_inventory", "input-inventory.json"))
        }
        if evaluation:
            files["evaluation"] = describe_file(workspace.root, directory / "evaluation.json")
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as output:
            for name, item in sorted(files.items()):
                path = verify_file(workspace.root, item)
                member = zipfile.ZipInfo(path.name, date_time=(1980, 1, 1, 0, 0, 0))
                member.compress_type = zipfile.ZIP_DEFLATED
                member.external_attr = 0o100644 << 16
                output.writestr(member, path.read_bytes())
        atomic_bytes(directory / "portfolio-report.zip", archive.getvalue(), immutable=True)
        files["archive"] = describe_file(workspace.root, directory / "portfolio-report.zip")
        return workspace._save(REPORT_KIND, {
            "title": title, "project_id": workspace.project["id"], "portfolio_id": record["id"],
            "analysis_sha256": record["analysis_sha256"], "selection": record["selection"],
            "optimization": record["optimization"], "context": record["context"],
            "evaluation": evaluation, "files": files,
        })


def _decision_economics(record, run_id, value):
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError("Portfolio economics must state its supplied cost basis and assumptions")
    basis = value.get("basis")
    allowed = {"selected-parcel-capital", "selected-parcel-annual-operating", "whole-scenario"}
    if basis not in allowed:
        raise ValueError("Choose selected-parcel-capital, selected-parcel-annual-operating or whole-scenario costs")
    currency = _text(value.get("currency", "USD"), "Economic currency", required=True).upper()
    selected_cost = record["selection"]["cost_usd"]
    if basis != "whole-scenario":
        if currency != "USD":
            raise ValueError("Selected planning unit estimates retain their original USD currency")
        if selected_cost is None or record["selection"]["unknown_cost_count"]:
            raise ValueError("Supply every selected planning unit estimate or choose explicit whole-scenario costs")
        selected_amount = _number(selected_cost, "Complete selected planning unit estimate", minimum=0)
        # Reject a conversion that loses original cents in the companion's floats.
        if _money(selected_amount, "Decision capital/operating amount") != _money(selected_cost, "Selected estimate"):
            raise ValueError("Selected estimate exceeds the decision companion's exact-cent numeric range")
    capital = (selected_amount if basis == "selected-parcel-capital"
               else _number(value.get("capital"), "Supplied capital cost", minimum=0))
    operating = (selected_amount if basis == "selected-parcel-annual-operating"
                 else _number(value.get("annual_operating"), "Supplied annual operating cost", minimum=0))
    horizon = _number(value.get("horizon_years"), "Supplied cost horizon", minimum=0)
    if horizon == 0:
        raise ValueError("Supply a positive implementation cost horizon")
    discount = _number(value.get("discount_rate"), "Supplied real discount rate", minimum=0)
    original_source = value.get("source")
    if not isinstance(original_source, dict):
        raise ValueError("Supply the economic assumptions' source title, URI and as-of date")
    source = {field: _text(original_source.get(field), "Economic source " + field, required=True)
              for field in ("title", "uri", "as_of")}
    from datetime import date
    try:
        date.fromisoformat(source["as_of"])
    except ValueError as error:
        raise ValueError("Economic source as_of must be an ISO calendar date") from error
    note = _text(value.get("note"), "Economic note")
    basis_note = {
        "selected-parcel-capital": "Original selected per-feature USD estimates are explicitly classified as capital; annual operating cost is separately supplied.",
        "selected-parcel-annual-operating": "Original selected per-feature USD estimates are explicitly classified as annual operating cost; capital is separately supplied.",
        "whole-scenario": "Capital and annual operating costs are supplied for the complete modeled treatment.",
    }[basis]
    return {
        "run_id": run_id, "currency": currency, "capital": capital,
        "annual_operating": operating, "horizon_years": horizon, "discount_rate": discount,
        "source": source, "note": basis_note + (" " + note if note else ""),
        "portfolio_cost_basis": basis, "portfolio_id": record["id"],
        "original_selected_estimate_usd": selected_cost,
        "original_cost_source": record["context"].get("cost_source"),
    }


def _decision_comparison(workspace, record, run, value):
    run_missing = value.get("run_missing_baseline", True)
    if not isinstance(run_missing, bool):
        raise ValueError("run_missing_baseline must be true or false")
    original = portfolio_pairing.context(workspace, record, run)
    comparison_id = value.get("comparison_id")
    explicit_baseline = value.get("baseline_run_id")
    if comparison_id:
        comparison_id = identifier(comparison_id)
        comparison = read_json(workspace.root / "comparisons" / comparison_id / "comparison.json")
        run_ids = [comparison.get("baseline_run_id")] + [
            item["run_id"] for item in comparison.get("alternatives", [])]
        if (comparison.get("schema") != "upstate.run-comparison/v1"
                or comparison.get("id") != comparison_id
                or comparison.get("direction") != "alternative minus baseline"
                or len(run_ids) < 2 or len(set(run_ids)) != len(run_ids)):
            raise ValueError("Select the original completed native comparison")
        identity = {"runs": run_ids, "direction": comparison["direction"]}
        if "native_version_provenance" in comparison:
            # Current native comparisons bind the executed per-model versions.
            # Recompute that binding from the original completed runs; legacy
            # comparisons retain their original two-field identity unchanged.
            from .model_selection import common_comparison_outputs
            from .native_versions import comparison_versions, models_for_outputs
            compared_runs = [workspace.inspect_run(identifier(key)) for key in run_ids]
            if any(item.get("state") != "complete" for item in compared_runs):
                raise ValueError("Complete the original native runs before reopening their comparison")
            common_outputs = common_comparison_outputs(compared_runs)
            provenance = comparison_versions(compared_runs, models_for_outputs(common_outputs))
            if (comparison.get("common_artifacts") != list(common_outputs)
                    or comparison.get("native_version_provenance") != provenance):
                raise ValueError("The retained comparison differs from its original native version provenance")
            if any(item["selection"]["grid_id"] != compared_runs[0]["selection"]["grid_id"]
                   for item in compared_runs[1:]):
                raise ValueError("The retained native comparison uses different reporting/model grids")
            identity["native_version_provenance"] = provenance
        if digest(identity) != comparison_id:
            raise ValueError("Select the original completed native comparison")
        if run["id"] not in run_ids[1:]:
            raise ValueError("The decision comparison must contain the selected portfolio evaluation")
        if explicit_baseline and identifier(explicit_baseline) != run_ids[0]:
            raise ValueError("The selected baseline and comparison identify different original runs")
        baseline = workspace.inspect_run(identifier(run_ids[0]))
        portfolio_pairing.require_pair(original, run, baseline)
    else:
        comparison = None
        baseline = portfolio_pairing.resolve(workspace, record, run,
                    baseline_run_id=explicit_baseline, execute=run_missing)
    if comparison is None:
        comparison = workspace.compare_runs([baseline["id"], run["id"]])
    else:
        directory = workspace.root / "comparisons" / comparison["id"]
        alternative = next(item for item in comparison["alternatives"] if item["run_id"] == run["id"])
        if alternative.get("selection") != run["selection"]:
            raise ValueError("The native comparison differs from its selected portfolio run")
        for item in alternative["artifacts"].values():
            verify_file(directory, item)
    return comparison, baseline


def build_decision_report(workspace, selection):
    """Export the peer decision desk from an actual completed portfolio run."""
    if not isinstance(selection, dict):
        raise ValueError("Select a saved portfolio and its completed native evaluation")
    from . import decision_analysis as decisions
    record = get_portfolio(workspace, identifier(selection.get("portfolio_id")), details=False)
    run_id = identifier(selection.get("evaluation_run_id"))
    evaluation = _evaluation(workspace, record, {"evaluation_run_id": run_id})
    run = workspace.inspect_run(run_id)
    if run["state"] != "complete":
        raise ValueError("Execute the portfolio's native scenario before building its decision desk")
    supplied = selection.get("decision") or {}
    if not isinstance(supplied, dict):
        raise ValueError("Decision choices must contain supplied costs, budget, targets and comparison choices")
    decision = deepcopy(supplied)
    decision["schema"] = decisions.SELECTION_SCHEMA
    decision["title"] = _text(selection.get("title") or decision.get("title") or
                               record["title"] + " evaluated decisions", "Decision title", required=True)
    decision.setdefault("costs", [])
    decision.setdefault("targets", {})
    decision.setdefault("sensitivity_comparison_ids", [])
    decision.setdefault("notes", [])
    decision.setdefault("top_parcels_per_pollutant", 10)
    if not isinstance(decision["costs"], list) or not isinstance(decision["notes"], list):
        raise ValueError("Decision costs and reviewer notes must be lists")
    # Resolve explicit economic input before an optional native baseline run.
    economics = _decision_economics(record, run_id, selection.get("economics"))
    if economics:
        if any(item.get("run_id") == run_id for item in decision["costs"] if isinstance(item, dict)):
            raise ValueError("Supply one economic definition for the portfolio evaluation")
        decision["costs"].append(economics)
    comparison, baseline = _decision_comparison(workspace, record, run, selection)
    if decision.get("comparison_id") not in (None, comparison["id"]):
        raise ValueError("Decision choices must use the selected portfolio comparison")
    decision["comparison_id"] = comparison["id"]
    for artifact in baseline["artifacts"].values():
        verify_file(workspace.root / "runs" / baseline["id"], artifact)
    alternative = next(item for item in comparison["alternatives"] if item["run_id"] == run_id)
    evaluation.update({
        "ranking_baseline_run_id": record["context"]["baseline_run_id"],
        "baseline_run_id": baseline["id"],
        "baseline_selection": deepcopy(baseline["selection"]),
        "baseline_artifacts": deepcopy(baseline["artifacts"]),
        "native_pair": portfolio_pairing.binding(
            workspace.inspect_run(record["context"]["baseline_run_id"]), run, baseline),
        "comparison": {
            "id": comparison["id"], "baseline_run_id": baseline["id"],
            "direction": comparison["direction"], "alternative": deepcopy(alternative),
        },
    })
    # A previous ranking delivery predates this new evaluation. Only the caller
    # may select a new completed delivery containing the actual comparison.
    lineage = {
        "schema": "upstate.portfolio-decision-link/v1", "portfolio_id": record["id"],
        "analysis_sha256": record["analysis_sha256"], "request": record["request"],
        "selected_parcels": record["selection"], "context": record["context"],
        "evaluation_run_id": run_id, "paired_baseline_run_id": baseline["id"],
        "paired_profile_id": baseline["selection"]["profile_id"],
        "native_pair": deepcopy(evaluation["native_pair"]),
        "economics": deepcopy(economics),
        "cost_assumptions": deepcopy(selection.get("economics")),
    }
    key = digest({"portfolio": lineage, "decision": decision, "adapter_version": 2})
    directory = workspace.root / "portfolio-decision-data" / key
    with held(workspace.root / (".portfolio-decision-" + key + ".lock")):
        for previous in workspace._list(REPORT_KIND):
            if previous.get("bridge_request_sha256") == key:
                for member in previous["files"].values():
                    verify_file(workspace.root, member)
                return previous
        if directory.exists():
            manifest = read_json(directory / "manifest.json")
            if manifest.get("schema") != "upstate.decision-delivery/v1":
                raise ValueError("The retained decision export has a different source schema")
            for member in manifest["members"]:
                verify_file(directory, member)
            report = read_json(directory / "report.json")
            packet = read_json(directory / "physical-input.json")
            if (report.get("selection") != decision or packet.get("portfolio_selection") != lineage
                    or report.get("id") != manifest.get("report_id")):
                raise ValueError("The existing decision edition differs from its portfolio request")
        else:
            packet = decisions.workspace_packet(workspace, decision)
            packet["portfolio_selection"] = lineage
            for name in ("analysis", "source_manifest", "input_parcels", "input_inventory"):
                item = record["files"][name]
                verify_file(workspace.root, item)
                packet["sources"].append({**item, "role": "portfolio_" + name})
            report = decisions.analyze_packet(packet, decision)
            actual = next((item for item in report["alternatives"] if item["run_id"] == run_id), None)
            if actual is None:
                reasons = [item.get("reason", "Original physical input requires correction")
                           for item in report.get("unavailable_alternatives", []) if item.get("run_id") == run_id]
                raise ValueError("The portfolio evaluation could not enter the decision desk: " + "; ".join(reasons))
            decisions.export_report(report, directory, input_packet=packet)
            manifest = read_json(directory / "manifest.json")
        aliases = {
            "index.html": "report", "report.json": "decision_report",
            "selection.json": "decision_selection", "physical-input.json": "physical_input",
            "alternatives.csv": "alternatives", "costs.csv": "costs", "sensitivity.csv": "sensitivity",
            "parcel-targets.csv": "parcel_targets", "sources.csv": "sources",
        }
        files = {}
        for member in manifest["members"]:
            path = verify_file(directory, member)
            name = aliases.get(member["path"], "member:" + member["path"])
            files[name] = describe_file(workspace.root, path)
        files["manifest"] = describe_file(workspace.root, directory / "manifest.json")
        files["archive"] = describe_file(workspace.root, directory / "decision-package.zip")
        return workspace._save(REPORT_KIND, {
            "title": decision["title"], "project_id": workspace.project["id"],
            "report_type": "whole-scenario-decision", "portfolio_id": record["id"],
            "bridge_request_sha256": key, "analysis_sha256": record["analysis_sha256"],
            "selection": record["selection"], "optimization": record["optimization"],
            "context": record["context"], "evaluation": evaluation, "files": files,
            "decision": {
                "id": report["id"], "comparison_id": comparison["id"],
                "baseline_run_id": baseline["id"], "portfolio_run_id": run_id,
                "profile_id": baseline["selection"]["profile_id"],
                "alternatives": len(report["alternatives"]),
                "eligible_candidates": len(report["frontier"]["eligible_ids"]),
                "selection": decision, "cost_assumptions": selection.get("economics"),
            },
        })


def invoke(workspace, action, payload):
    if action == "portfolio.inventory.build":
        from .planning_inventory import build
        return build(workspace, payload)
    if action == "portfolio.preview":
        return preview(workspace, payload)
    if action == "portfolio.save":
        return save_portfolio(workspace, payload)
    if action == "portfolio.scenario.prepare":
        return prepare_scenario(workspace, payload)
    if action == "portfolio.report.build":
        return build_report(workspace, payload)
    if action == "portfolio.decision.build":
        return build_decision_report(workspace, payload)
    raise ValueError("Unknown portfolio action: " + str(action))
