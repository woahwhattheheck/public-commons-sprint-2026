"""Optimize retained conservation candidates through the maintained portfolio solver.

Conservation studies and plans remain authoritative. This adapter preserves
pollutant-specific support, original source identities and supplied cost units.
It stores decision analyses beneath their original study; chosen land is saved
only through conservation.save_plan.
"""
from __future__ import annotations

import argparse
from collections import Counter
from copy import deepcopy
import csv
import hashlib
import html
import io
import json
import math
from pathlib import Path
import shutil
import zipfile

from . import conservation, conservation_joint_choices
from .common import (
    atomic_bytes, atomic_json, canonical, describe_file, digest, file_digest,
    held, identifier, now, read_json, verify_file,
)

VERSION = "1.0.0"
SCHEMA = "upstate.conservation-optimization/v1"
REFERENCE_SCHEMA = "upstate.conservation-optimization-reference/v1"
PHYSICAL_AXES = tuple(conservation.POLLUTANTS)
PUBLISHED_AXES = ("published_points",)
CONTEXT_AXES = (
    "reporting_area_ha", "source_water_area_ha",
    "unprotected_area_ha", "high_quality_context",
)
CONTEXT_UNITS = {
    "reporting_area_ha": "ha",
    "source_water_area_ha": "ha",
    "unprotected_area_ha": "ha",
    "high_quality_context": "selected designation relation (0 or 1)",
}


def _engine():
    from . import portfolios
    required = ("_optimize", "_money", "_usd", "_area_capacity")
    if tuple(portfolios.METRICS) != PHYSICAL_AXES or any(
            not callable(getattr(portfolios, name, None)) for name in required):
        raise ValueError("Install the maintained C8FF portfolio solver with its original numeric contract")
    return portfolios


def _number(value, label, *, minimum=None, maximum=None, optional=False):
    if optional and value is None:
        return None
    if isinstance(value, bool):
        raise ValueError(label + " must be numeric")
    try:
        result = float(value)
    except (TypeError, ValueError, OverflowError) as error:
        raise ValueError(label + " must be finite") from error
    if not math.isfinite(result):
        raise ValueError(label + " must be finite")
    if minimum is not None and result < minimum:
        raise ValueError(label + " is below its allowed minimum")
    if maximum is not None and result > maximum:
        raise ValueError(label + " exceeds its allowed maximum")
    return result


def _text(value, label, default=None):
    if value is None:
        value = default
    if not isinstance(value, str) or not value.strip():
        raise ValueError(label + " must be nonempty text")
    return value.strip()


def _ids(value, label):
    if value is None:
        return []
    if (not isinstance(value, list) or any(not isinstance(x, str) or not x for x in value)
            or len(set(value)) != len(value)):
        raise ValueError(label + " must retain unique original string feature IDs")
    return list(value)


def _weights(value, axes, available):
    if value is None:
        value = {axis: 1 for axis in available}
    if not isinstance(value, dict) or set(value) - set(axes):
        raise ValueError("Weights must use this objective's declared axes")
    values = {axis: _number(value.get(axis, 0), axis + " weight", minimum=0) for axis in axes}
    if any(weight > 0 and axis not in available for axis, weight in values.items()):
        absent = [axis for axis, weight in values.items() if weight > 0 and axis not in available]
        raise ValueError("Positive weights require retained selected inputs: " + ", ".join(absent))
    largest = max(values.values(), default=0)
    if largest <= 0:
        raise ValueError("At least one available objective weight must be positive")
    scaled = {axis: value / largest for axis, value in values.items()}
    total = math.fsum(scaled.values())
    return {axis: value / total for axis, value in scaled.items()}


def _available(study, kind, alternative):
    if kind == "published-method":
        if (study["selection"]["spec"]["score"]["basis"] != "published_method"
                or not study["selection"]["bindings"].get("published_method")):
            raise ValueError("Choose the original study scored by its retained published practice method")
        return PUBLISHED_AXES
    if kind == "source-context":
        sources = study["selection"]["bindings"]["sources"]
        result = ["reporting_area_ha"]
        for axis, role in (
                ("source_water_area_ha", "drinking_water"),
                ("unprotected_area_ha", "protected_lands"),
                ("high_quality_context", "high_quality_waters")):
            if role in sources:
                result.append(axis)
        return tuple(result)
    if study["mode"] != "native_model":
        raise ValueError("Choose source-context objectives or bind completed native cases first")
    if kind in ("matched-restoration", "matched-disturbance"):
        from .conservation_families import available
        return available(study, alternative)
    runs = study["selection"]["bindings"]["runs"]
    baseline = study["selection"]["spec"]["baseline_run_id"]
    result = set(runs[baseline]["outputs"])
    if kind != "current-export":
        if alternative not in study["selection"]["spec"]["alternative_run_ids"]:
            raise ValueError("Select an original alternative already retained by this conservation study")
        result &= set(runs[alternative]["outputs"])
    return tuple(axis for axis in PHYSICAL_AXES if axis in result)



def _criterion(value, study):
    """Bind an analyst criterion to one original quantity; never invent a source."""
    if not isinstance(value, dict):
        raise ValueError("Each criterion must be an object")
    key = _text(value.get("id"), "Criterion ID")
    if (not key[0].isalpha() or not all(char.isascii() and (char.isalnum() or char == "_") for char in key)):
        raise ValueError("Criterion IDs must begin with a letter and contain ASCII letters, digits or underscores")
    kind = value.get("kind")
    if kind not in ("source-context", "current-export", "restoration", "avoided-conversion",
                    "published-method", "source-attribute", "matched-restoration", "matched-disturbance"):
        raise ValueError("Choose an original physical, context, published-method or source-attribute criterion")
    direction = value.get("direction", "maximize")
    if direction not in ("maximize", "minimize"):
        raise ValueError("Criterion direction must be maximize or minimize")
    result = {"id": key, "label": _text(value.get("label"), "Criterion label", key),
              "kind": kind, "direction": direction}
    basis = value.get("basis", "total")
    if basis not in ("total", "per-reporting-hectare"):
        raise ValueError("Criterion basis must be total or per-reporting-hectare")
    if kind in ("source-context", "source-attribute") and basis != "total":
        raise ValueError("Context and original attributes retain their declared source units")
    result["basis"] = basis
    if kind == "source-attribute":
        field = _text(value.get("field"), "Original attribute field")
        if value.get("scenario_run_id") is not None:
            raise ValueError("An original attribute does not select a native alternative")
        result.update(field=field, unit=_text(value.get("unit"), "Original attribute unit"),
                      reference=_text(value.get("reference"), "Attribute source/method reference"),
                      source=deepcopy(study["selection"]["bindings"]["sources"]["parcels"]),
                      scenario_run_id=None)
        result["available"] = any(_attribute_number(row.get("original_attributes", {}).get(field)) is not None
                                  for row in study["candidates"])
        return result
    axis = _text(value.get("axis"), "Original criterion axis")
    permitted = (CONTEXT_AXES if kind == "source-context" else
                 PUBLISHED_AXES if kind == "published-method" else PHYSICAL_AXES)
    if axis not in permitted:
        raise ValueError("Criterion axis is not declared by its original quantity kind")
    alternative = value.get("scenario_run_id")
    if kind in ("restoration", "avoided-conversion"):
        alternative = identifier(alternative)
    elif alternative is not None:
        raise ValueError("Only a paired native criterion selects an alternative")
    result.update(axis=axis, scenario_run_id=alternative)
    if kind in ("matched-restoration", "matched-disturbance"):
        from .conservation_families import binding
        result["family_id"] = _text(value.get("family_id"), "Matched family ID")
        result["source"] = binding(study, result["family_id"], axis)
        result["available"] = axis in _available(study, kind, result["family_id"])
    else:
        if value.get("family_id") is not None:
            raise ValueError("Only a matched-family criterion selects family_id")
        result["available"] = axis in _available(study, kind, alternative)
    result["unit"] = (CONTEXT_UNITS[axis] if kind == "source-context" else
                      "points" if kind == "published-method" else conservation.POLLUTANTS[axis][2])
    if basis == "per-reporting-hectare":
        result["unit"] += "/reporting_ha"
    if kind == "source-context":
        role = {"source_water_area_ha": "drinking_water", "unprotected_area_ha": "protected_lands",
                "high_quality_context": "high_quality_waters"}.get(axis)
        result["source"] = deepcopy(study["selection"]["bindings"]["sources"].get(role)) if role else {
            "geometry_inventory": deepcopy(study["files"]["geometries"])}
    elif kind not in ("published-method", "matched-restoration", "matched-disturbance"):
        bindings = study["selection"]["bindings"]["runs"]
        baseline = study["selection"]["spec"]["baseline_run_id"]
        result["source"] = {"baseline_run_id": baseline, "baseline": deepcopy(bindings[baseline]),
                            "alternative_run_id": alternative,
                            "alternative": deepcopy(bindings.get(alternative)) if alternative else None}
    return result


def _attribute_number(value):
    # Numeric-looking text and booleans are still their original source types.
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        number = float(value)
    except (OverflowError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _multi_request(value, study, engine):
    original = value["objective"]
    criteria = original.get("criteria")
    if not isinstance(criteria, list) or not criteria:
        raise ValueError("Select at least one source-bound decision criterion")
    criteria = [_criterion(item, study) for item in criteria]
    axes = [item["id"] for item in criteria]
    if len(axes) != len(set(axes)):
        raise ValueError("Decision criteria must retain unique IDs")
    available = [item["id"] for item in criteria if item["available"]]
    # Reuse the original resource/filter/solver validator without changing its
    # legacy request representation or reinterpreting its budget arithmetic.
    base = deepcopy(value)
    base.pop("scenario_stability", None)
    base.update(objective={"kind": "source-context", "basis": "total"},
                weights={"reporting_area_ha": 1}, stability=False)
    result = _request(base, study, engine)
    result.update(objective={"kind": "multi-criteria", "basis": "per-criterion",
                             "scenario_run_id": None, "criteria": criteria},
                  axes=axes, available_axes=available,
                  weights=_weights(value.get("weights"), axes, available))
    for criterion in criteria:
        if criterion["kind"] == "published-method":
            single = _request({"study_id": study["id"],
                               "objective": {"kind": "published-method", "basis": criterion["basis"]},
                               "stability": False}, study, engine)
            criterion["published_method"] = single["published_method"]
    raw_stability = value.get("stability", True)
    if isinstance(raw_stability, bool):
        raw_stability = {"enabled": raw_stability}
    if (not isinstance(raw_stability, dict)
            or set(raw_stability) - {"enabled", "profiles"}
            or not isinstance(raw_stability.get("enabled", True), bool)):
        raise ValueError("Stability must name enabled and optional preference profiles")
    supplied = raw_stability.get("profiles") or []
    if not isinstance(supplied, list):
        raise ValueError("Preference profiles must be a list")
    profiles, names = [], {"Selected weights"}
    for item in supplied:
        if not isinstance(item, dict):
            raise ValueError("Each preference profile must name its weights")
        name = _text(item.get("name"), "Preference profile name")
        if name in names:
            raise ValueError("Preference profile names must be distinct")
        names.add(name)
        profiles.append({"name": name, "weights": _weights(item.get("weights"), axes, available)})
    enabled = raw_stability.get("enabled", True)
    if enabled and not profiles:
        profiles = [{"name": item["label"] + " only",
                     "weights": _weights({item["id"]: 1}, axes, available)}
                    for item in criteria if item["available"]]
    result["stability"] = {"enabled": enabled, "profiles": profiles}
    setting = value.get("scenario_stability") or {"enabled": False, "cases": []}
    if (not isinstance(setting, dict) or set(setting) - {"enabled", "cases"}
            or not isinstance(setting.get("enabled", True), bool)
            or not isinstance(setting.get("cases", []), list)):
        raise ValueError("Scenario stability must name enabled and explicit retained cases")
    cases, case_names = [], {"Selected case"}
    by_id = {item["id"]: item for item in criteria}
    for item in setting.get("cases", []):
        if not isinstance(item, dict):
            raise ValueError("Each scenario case must name its retained run mapping")
        name = _text(item.get("name"), "Scenario case name")
        if name in case_names:
            raise ValueError("Scenario case names must be distinct")
        case_names.add(name)
        supplied_runs = item.get("scenario_run_ids", {})
        supplied_families = item.get("family_ids", {})
        if (not isinstance(supplied_runs, dict) or not isinstance(supplied_families, dict)
                or not (supplied_runs or supplied_families)):
            raise ValueError("Each scenario case needs an actual alternative or matched-family override")
        runs = {}
        for key, run_id in supplied_runs.items():
            criterion = by_id.get(key)
            if not criterion or criterion["kind"] not in ("restoration", "avoided-conversion"):
                raise ValueError("Only declared paired native criteria may vary a retained case")
            run_id = identifier(run_id)
            _available(study, criterion["kind"], run_id)
            runs[key] = run_id
        families = {}
        for key, family_id in supplied_families.items():
            criterion = by_id.get(key)
            if not criterion or criterion["kind"] not in ("matched-restoration", "matched-disturbance"):
                raise ValueError("Only declared matched-family criteria may vary family_ids")
            family_id = _text(family_id, "Matched family ID")
            _available(study, criterion["kind"], family_id)
            families[key] = family_id
        cases.append({"name": name, "scenario_run_ids": runs,
                      **({"family_ids": families} if families else {})})
    result["scenario_stability"] = {"enabled": setting.get("enabled", True), "cases": cases}
    return result


def _multi_axis_values(candidate, request):
    values, supports, units = {}, {}, {}
    for criterion_index, criterion in enumerate(request["objective"]["criteria"]):
        key = criterion["id"]
        if criterion["kind"] == "source-attribute":
            raw = candidate.get("original_attributes", {}).get(criterion["field"])
            number = _attribute_number(raw)
            values[key], units[key] = number, criterion["unit"]
            supports[key] = {
                "availability": "original_source_attribute" if number is not None else "unavailable_attribute",
                "availability_reason": None if number is not None else
                    "The retained original field is missing or is not a finite numeric source value",
                "coverage_fraction": None, "eligible_support": number is not None,
                "support_basis": "Unmodified numeric attribute of the original planning-unit source",
                "original_value": deepcopy(raw) if not isinstance(raw, float) or math.isfinite(raw) else None,
                "nonfinite_source_representation": repr(raw) if isinstance(raw, float) and not math.isfinite(raw) else None,
                "field": criterion["field"],
                "reference": criterion["reference"],
                "unit_qualification": "Analyst-declared source unit; no conversion or connectivity inference",
            }
        else:
            single = dict(request)
            single["objective"] = {"kind": criterion["kind"], "basis": criterion["basis"],
                                   "scenario_run_id": criterion["scenario_run_id"],
                                   **({"family_id": criterion["family_id"]} if "family_id" in criterion else {})}
            if criterion["kind"] == "published-method":
                single["published_method"] = criterion["published_method"]
            original_values, original_supports, original_units = _axis_values(candidate, single)
            axis = criterion["axis"]
            values[key], units[key] = original_values[axis], original_units[axis]
            supports[key] = deepcopy(original_supports[axis])
        # Complete immutable bindings live once in the resolved criterion record.
        # Pointers address this same analysis, including its explicit case index.
        supports[key]["criterion_id"] = key
        supports[key]["source_ref"] = request.get("_criterion_source_prefix", "/request/objective/criteria") + "/" + str(criterion_index)
        supports[key]["criterion"] = {"id": key, "label": criterion["label"], "kind": criterion["kind"],
                                     "direction": criterion["direction"], "basis": criterion["basis"],
                                     "axis": criterion.get("axis"), "scenario_run_id": criterion["scenario_run_id"],
                                     **({"family_id": criterion["family_id"]} if "family_id" in criterion else {})}
    return values, supports, units


def _multi_case_request(request, case, study):
    selected = deepcopy(request)
    for criterion in selected["objective"]["criteria"]:
        family_id = case.get("family_ids", {}).get(criterion["id"])
        if family_id is not None:
            from .conservation_families import binding
            criterion["family_id"] = family_id
            criterion["available"] = criterion["axis"] in _available(study, criterion["kind"], family_id)
            criterion["source"] = binding(study, family_id, criterion["axis"])
        if criterion["id"] not in case["scenario_run_ids"]:
            continue
        run_id = case["scenario_run_ids"][criterion["id"]]
        criterion["scenario_run_id"] = run_id
        criterion["available"] = criterion["axis"] in _available(study, criterion["kind"], run_id)
        criterion["source"]["alternative_run_id"] = run_id
        criterion["source"]["alternative"] = deepcopy(study["selection"]["bindings"]["runs"][run_id])
    selected["available_axes"] = [item["id"] for item in selected["objective"]["criteria"] if item["available"]]
    return selected


def _decision_rows(study, request, engine):
    rows, normalization = _rows(study, request, engine)
    if request["objective"]["kind"] != "multi-criteria":
        return rows, normalization, []
    variants = []
    if request["scenario_stability"]["enabled"]:
        seen = {tuple((item["scenario_run_id"], item.get("family_id")) for item in request["objective"]["criteria"])}
        for case in request["scenario_stability"]["cases"]:
            selected = _multi_case_request(request, case, study)
            signature = tuple((item["scenario_run_id"], item.get("family_id")) for item in selected["objective"]["criteria"])
            if signature in seen:
                continue
            seen.add(signature)
            selected["_criterion_source_prefix"] = "/scenario_stability/cases/" + str(len(variants) + 1) + "/criteria"
            values, _ = _rows(study, selected, engine, retain_original=False)
            variants.append({"case": case, "request": selected, "rows": values})
    cohorts = [rows] + [item["rows"] for item in variants]
    scales = {axis: max((abs(row["objective_values"][axis]) for cohort in cohorts for row in cohort
                         if row["source_eligible"] and row["axis_support"][axis]["eligible_support"]),
                        default=0.) for axis in request["axes"]}
    directions = {item["id"]: item["direction"] for item in request["objective"]["criteria"]}
    for cohort in cohorts:
        for row in cohort:
            row["normalized_metrics"] = {
                axis: ((-1 if directions[axis] == "minimize" else 1) * row["objective_values"][axis] / scales[axis]
                       if row["axis_support"][axis]["eligible_support"] and scales[axis] else 0.)
                for axis in request["axes"]}
    normalization.update(
        scales=scales, fixed_across_scenario_cases=True,
        method="Maximum absolute source-qualified quantity per criterion across the selected case and every explicit comparison case",
        directions=directions,
        minimize="Minimized criteria negate their signed source-normalized value; an all-negative objective can legitimately select no land",
        case_count=len(cohorts))
    return rows, normalization, variants


def _scenario_comparison(rows, request, variants, scored, chosen, optimization, engine, solver_request):
    """Compare explicit alternative cases without inventing probabilities."""
    if request["objective"]["kind"] != "multi-criteria":
        return None
    cases = [{"name": "Selected case", "request": request, "rows": rows,
              "scored": scored, "chosen": chosen, "optimization": optimization}]
    for item in variants:
        ranked, exclusions = _score(item["rows"], request["weights"])
        selected, outcome = engine._optimize(ranked, solver_request)
        cases.append({"name": item["case"]["name"], "request": item["request"], "rows": item["rows"],
                      "scored": ranked, "chosen": selected, "optimization": outcome, "exclusions": exclusions})
    counts = {row["feature_id"]: {"eligible_cases": 0, "selected_cases": 0, "ranks": []} for row in rows}
    results = []
    for case in cases:
        ranking = {row["feature_id"]: (index + 1, row["score"]) for index, row in enumerate(case["scored"])}
        selected_ids = {row["feature_id"] for row in case["chosen"]}
        candidates = []
        for row in case["rows"]:
            rank, score = ranking.get(row["feature_id"], (None, None))
            item = counts[row["feature_id"]]
            if rank is not None:
                item["eligible_cases"] += 1
                item["ranks"].append(rank)
            item["selected_cases"] += int(row["feature_id"] in selected_ids)
            candidates.append({
                "feature_id": row["feature_id"], "rank": rank, "score": score,
                "selected": row["feature_id"] in selected_ids,
                "exclusions": (case.get("exclusions") or {}).get(row["feature_id"], row.get("exclusions", [])),
                "objective_values": deepcopy(row["objective_values"]),
                "objective_units": deepcopy(row["objective_units"]),
                "axis_support": deepcopy(row["axis_support"]),
                "score_contributions": {axis: request["weights"][axis] * row["normalized_metrics"][axis]
                                        if row["axis_support"][axis]["eligible_support"] else None
                                        for axis in request["axes"]},
            })
        results.append({
            "name": case["name"], "scenario_run_ids": {
                criterion["id"]: criterion["scenario_run_id"] for criterion in case["request"]["objective"]["criteria"]
                if criterion["kind"] in ("restoration", "avoided-conversion")},
            **({"family_ids": {criterion["id"]: criterion["family_id"]
                              for criterion in case["request"]["objective"]["criteria"] if "family_id" in criterion}}
               if any("family_id" in criterion for criterion in case["request"]["objective"]["criteria"]) else {}),
            "criteria": deepcopy(case["request"]["objective"]["criteria"]),
            "selected_ids": sorted(selected_ids), "eligible_count": len(case["scored"]),
            "optimization": case["optimization"], "candidates": candidates,
        })
    for row in rows:
        value = counts[row["feature_id"]]
        ranks = value.pop("ranks")
        row["scenario_stability"] = {
            **value, "case_count": len(results),
            "minimum_rank": min(ranks, default=None), "maximum_rank": max(ranks, default=None),
            "selection_fraction": value["selected_cases"] / len(results),
        }
        row["score_contributions"] = {
            axis: request["weights"][axis] * row["normalized_metrics"][axis]
            if row["axis_support"][axis]["eligible_support"] else None for axis in request["axes"]}
    return {
        "enabled": request["scenario_stability"]["enabled"], "cases": results,
        "interpretation": "Sensitivity to explicitly selected retained native cases under the selected decision weights; not a probability, confidence interval or calibrated scientific uncertainty",
        "normalization": "One fixed source-qualified scale per criterion across all compared cases",
        "preference_relation": "Named preference comparisons vary weights in the selected case separately; no joint case probability is assumed",
    }


def _request(value, study, engine):
    if not isinstance(value, dict):
        raise ValueError("Supply a conservation optimization selection")
    if identifier(value.get("study_id")) != study["id"]:
        raise ValueError("The selected conservation study differs")
    source_spec = study["selection"]["spec"]
    original = value.get("objective") or {}
    if not isinstance(original, dict):
        raise ValueError("Objective must identify its kind and quantity basis")
    if original.get("kind") == "multi-criteria":
        return _multi_request(value, study, engine)
    if value.get("scenario_stability") is not None:
        raise ValueError("Explicit scenario comparisons require the multi-criteria objective")
    default_kind = {
        "context": "source-context", "current_export": "current-export",
        "scenario_reduction": "restoration", "disturbance_increase": "avoided-conversion",
        "published_method": "published-method",
    }.get(source_spec["score"]["basis"])
    kind = original.get("kind", default_kind)
    if kind not in ("source-context", "current-export", "restoration", "avoided-conversion", "published-method",
                    "matched-restoration", "matched-disturbance"):
        raise ValueError("Choose an original context, physical, matched-family or published-method objective")
    basis = original.get("basis", "total")
    if basis not in ("total", "per-reporting-hectare"):
        raise ValueError("Objective basis must be total or per-reporting-hectare")
    if kind == "source-context" and basis != "total":
        raise ValueError("Source-context axes already declare their geographic measurement units")
    alternative = original.get("scenario_run_id")
    if kind in ("restoration", "avoided-conversion"):
        alternative = identifier(alternative or source_spec["score"].get("alternative_run_id"))
    elif alternative is not None:
        raise ValueError("This objective does not select an alternative case")
    axes = (CONTEXT_AXES if kind == "source-context" else
            PUBLISHED_AXES if kind == "published-method" else PHYSICAL_AXES)
    family_id = None
    if kind in ("matched-restoration", "matched-disturbance"):
        family_id = _text(original.get("family_id"), "Matched family ID")
    elif original.get("family_id") is not None:
        raise ValueError("Only a matched-family objective selects family_id")
    available = _available(study, kind, family_id if family_id is not None else alternative)
    if not available:
        raise ValueError("The selected scoring cases have no shared modeled pollutant")
    raw_weights = value.get("weights")
    if raw_weights is None and kind == "source-context":
        raw_weights = {"reporting_area_ha": 1}
    weights = _weights(raw_weights, axes, available)
    raw_filters = value.get("filters") or {}
    if not isinstance(raw_filters, dict):
        raise ValueError("Filters must be an object")
    allowed_filters = {
        "min_coverage_fraction", "max_protected_fraction",
        "source_water", "high_quality_water", "include_ids", "exclude_ids",
    }
    if set(raw_filters) - allowed_filters:
        raise ValueError("Unknown conservation optimization filter")
    filters = {
        "min_coverage_fraction": _number(
            raw_filters.get("min_coverage_fraction", source_spec["rules"]["minimum_coverage_fraction"]),
            "Minimum objective coverage", minimum=0, maximum=1),
        "max_protected_fraction": _number(
            raw_filters.get("max_protected_fraction", 1), "Maximum protected fraction", minimum=0, maximum=1),
        "source_water": raw_filters.get("source_water", "any"),
        "high_quality_water": raw_filters.get("high_quality_water", "any"),
        "include_ids": _ids(raw_filters.get("include_ids"), "Included units"),
        "exclude_ids": _ids(raw_filters.get("exclude_ids"), "Excluded units"),
    }
    for field in ("source_water", "high_quality_water"):
        if filters[field] not in ("any", "yes", "no"):
            raise ValueError(field + " must be any, yes or no")
    if set(filters["include_ids"]) & set(filters["exclude_ids"]):
        raise ValueError("A unit cannot be both included and excluded")
    allow_ineligible = value.get("include_ineligible", False)
    if not isinstance(allow_ineligible, bool):
        raise ValueError("include_ineligible must be true or false")
    raw_limits = value.get("constraints") or {}
    if (not isinstance(raw_limits, dict)
            or set(raw_limits) - {"budget_usd", "area_ha", "max_count", "area_basis"}):
        raise ValueError("Constraints must name budget_usd, area_ha, max_count and area_basis")
    count = raw_limits.get("max_count")
    if count is not None and (isinstance(count, bool) or not isinstance(count, int) or count < 0):
        raise ValueError("Unit count limit must be a nonnegative whole number")
    area_basis = raw_limits.get("area_basis", "whole_units")
    if area_basis not in ("whole_units", "reporting"):
        raise ValueError("Area constraint basis must be whole_units or reporting")
    budget = engine._money(raw_limits.get("budget_usd"), "Portfolio budget")
    costs = source_spec.get("costs")
    if budget is not None and (not costs or costs["currency"] != "USD"):
        raise ValueError("A USD budget requires this study's retained original USD cost table")
    constraints = {
        "budget_usd": engine._usd(budget),
        "area_ha": _number(raw_limits.get("area_ha"), "Area limit", minimum=0, optional=True),
        "max_count": count, "area_basis": area_basis,
    }
    solver = value.get("solver", "deterministic")
    if solver not in ("deterministic", "scipy-milp"):
        raise ValueError("Choose deterministic or scipy-milp")
    stability = value.get("stability", True)
    if isinstance(stability, bool):
        stability = {"enabled": stability}
    if not isinstance(stability, dict) or set(stability) - {"enabled", "profiles"}:
        raise ValueError("Stability must name enabled and optional preference profiles")
    enabled = stability.get("enabled", True)
    if not isinstance(enabled, bool):
        raise ValueError("Stability enabled must be true or false")
    supplied = stability.get("profiles") or []
    if not isinstance(supplied, list):
        raise ValueError("Preference profiles must be a list")
    profiles, names = [], {"Selected weights"}
    for item in supplied:
        if not isinstance(item, dict):
            raise ValueError("Each preference profile must name its weights")
        name = _text(item.get("name"), "Preference profile name")
        if name in names:
            raise ValueError("Preference profile names must be distinct")
        names.add(name)
        profiles.append({"name": name, "weights": _weights(item.get("weights"), axes, available)})
    if enabled and not profiles:
        profiles = [
            {"name": axis.replace("_", " ") + " only",
             "weights": _weights({axis: 1}, axes, available)}
            for axis in available
        ]
    result = {
        "study_id": study["id"],
        "title": _text(value.get("title"), "Optimization title", study["title"] + " — selection"),
        "purpose": _text(value.get("purpose"), "Decision purpose",
                         "Compare retained land priorities under explicit resource constraints."),
        "objective": {"kind": kind, "basis": basis, "scenario_run_id": alternative,
                      **({"family_id": family_id} if family_id is not None else {})},
        "axes": list(axes), "available_axes": list(available), "weights": weights,
        "filters": filters, "include_ineligible": allow_ineligible, "constraints": constraints,
        "solver": solver,
        "solver_time_limit_seconds": _number(
            value.get("solver_time_limit_seconds", 20), "Solver time limit", minimum=.001),
        "stability": {"enabled": enabled, "profiles": profiles},
    }
    if kind == "published-method":
        retained = study["selection"]["bindings"]["published_method"]
        result["published_method"] = {
            "method_id": retained["method_id"], "category_id": retained["category_id"],
            "definition_sha256": retained["definition_sha256"],
            "implementation_sha256": retained["implementation_sha256"],
            "source_uri": retained["source_uri"], "reference": retained["reference"],
            "category": deepcopy(retained["category"]),
            "interpretation": retained["interpretation"],
            "headwater_orders": deepcopy(retained["headwater_orders"]),
            "criteria_source": deepcopy(retained.get("criteria_source")),
            "native_required_pollutants": list(source_spec["score"]["native_required_pollutants"]),
            "scoring_normalization": deepcopy(study["normalization"]),
            "quantity_basis": basis,
        }
    return result


def _published_values(candidate, request, reporting):
    """Use completed original criterion points and their retained prerequisites."""
    method = request["published_method"]
    point = candidate.get("point_score")
    if not isinstance(point, dict):
        raise ValueError("The published-method candidate has no retained point record")
    if (point.get("method_id") != method["method_id"]
            or point.get("category_id") != method["category_id"]
            or point.get("definition_sha256") != method["definition_sha256"]
            or point.get("unit") != "points"
            or candidate.get("score_unit") != "points"):
        raise ValueError("The candidate's published method, category, definition or point units differ")
    maximum = _number(point.get("maximum"), "Published attainable maximum", minimum=0)
    if maximum != _number(method["category"]["maximum"], "Bound published maximum", minimum=0):
        raise ValueError("The candidate's published maximum differs from its bound category")
    lower = _number(point.get("known_points"), "Known published criterion points", minimum=0, maximum=maximum)
    upper = _number(point.get("possible_points"), "Possible published criterion points", minimum=lower, maximum=maximum)
    prerequisite = point.get("prerequisite")
    if prerequisite is not None and not isinstance(prerequisite, bool):
        raise ValueError("The published practice prerequisite must retain its original boolean or unknown state")
    complete = prerequisite is True and lower == upper
    value = point.get("points")
    if value is not None:
        value = _number(value, "Original published practice points", minimum=0, maximum=maximum)
    if complete:
        if value is None or value != lower or candidate.get("score") != value:
            raise ValueError("The retained complete practice points disagree with their candidate score")
        availability, reason = "scored_published_method", None
    else:
        if value is not None:
            raise ValueError("An incomplete or inapplicable practice must preserve its unknown point total")
        if prerequisite is False:
            availability, reason = "inapplicable_practice", "The published practice prerequisite is absent"
        elif prerequisite is None:
            availability, reason = "unknown_prerequisite", "The selected source does not yet determine the published practice prerequisite"
        else:
            availability, reason = "partial_criteria", "Some selected published criteria still have an unresolved point range"
    unit = "points"
    if request["objective"]["basis"] == "per-reporting-hectare":
        value = value / reporting if value is not None and reporting > 0 else None
        unit = "points/reporting_ha"
    native_support, native_reasons = {}, []
    for pollutant in method["native_required_pollutants"]:
        if pollutant not in conservation.POLLUTANTS:
            raise ValueError("The published method identifies an unknown native pollutant")
        metric = candidate["pollutants"][pollutant]
        if metric["unit"] != conservation.POLLUTANTS[pollutant][2]:
            raise ValueError("Preserve the original units supporting the published export criterion")
        coverage = metric.get("coverage_fraction")
        if coverage is not None:
            coverage = _number(coverage, pollutant + " criterion coverage", minimum=0, maximum=1)
        quantity = metric.get("baseline")
        if quantity is not None:
            quantity = _number(quantity, pollutant + " original criterion quantity", minimum=0)
        adequate = (metric.get("availability") == "modeled" and quantity is not None
                    and coverage is not None
                    and coverage >= request["filters"]["min_coverage_fraction"])
        native_support[pollutant] = {
            "availability": metric.get("availability"),
            "availability_reason": metric.get("availability_reason"),
            "coverage_fraction": coverage, "valid_area_ha": metric.get("valid_area_ha"),
            "unit": metric["unit"], "baseline": quantity, "eligible_support": adequate,
        }
        if not adequate:
            native_reasons.append(pollutant + ": " + (
                metric.get("availability_reason")
                or "The published export criterion requires the selected baseline coverage"))
    if native_reasons:
        reason = "; ".join(([reason] if reason else []) + native_reasons)
    eligible = complete and value is not None and not native_reasons
    native_coverages = [row["coverage_fraction"] for row in native_support.values()]
    minimum_native_coverage = (min(native_coverages)
                               if native_coverages and all(x is not None for x in native_coverages) else None)
    support = {
        "availability": availability, "availability_reason": reason,
        "coverage_fraction": minimum_native_coverage,
        "support_basis": "Complete original published criterion points, required practice prerequisite and each selected native criterion output",
        "native_support": native_support,
        "native_coverage_basis": "Minimum own-case coverage among required baseline pollutant criteria" if native_support else None,
        "eligible_support": eligible, "method_id": point["method_id"],
        "category_id": point["category_id"], "definition_sha256": point["definition_sha256"],
        "known_points": lower, "possible_points": upper, "maximum_points": maximum,
        "prerequisite": prerequisite, "priority": point.get("priority"),
        "native_required_pollutants": list(method["native_required_pollutants"]),
    }
    return {"published_points": value}, {"published_points": support}, {"published_points": unit}


def _axis_values(candidate, request):
    if request["objective"]["kind"] == "multi-criteria":
        return _multi_axis_values(candidate, request)
    kind = request["objective"]["kind"]
    reporting = _number(candidate["reporting_area_ha"], "Retained reporting area", minimum=0)
    values, supports, units = {}, {}, {}
    if kind == "published-method":
        return _published_values(candidate, request, reporting)
    if kind == "source-context":
        protected = candidate.get("protected_area_ha")
        known_quality = candidate.get("high_quality_context")
        values = {
            "reporting_area_ha": reporting,
            "source_water_area_ha": candidate.get("source_water_area_ha"),
            "unprotected_area_ha": None if protected is None else max(0., reporting - protected),
            "high_quality_context": None if known_quality is None else int(known_quality),
        }
        for axis, value in values.items():
            if value is not None:
                values[axis] = _number(value, axis, minimum=0)
            supports[axis] = {
                "availability": "observed_source_context" if value is not None else "unbound",
                "availability_reason": None if value is not None else "The corresponding retained context source is not bound",
                "coverage_fraction": None,
                "support_basis": "Original source geometry intersection or declared designation relation",
                "eligible_support": value is not None,
            }
        return values, supports, dict(CONTEXT_UNITS)
    alternative = request["objective"]["scenario_run_id"]
    for axis in PHYSICAL_AXES:
        quantity = candidate["pollutants"][axis]
        unit = quantity["unit"]
        if unit != conservation.POLLUTANTS[axis][2]:
            raise ValueError("Retain the original separate annual mass units: " + axis)
        family_pair = None
        if kind in ("matched-restoration", "matched-disturbance"):
            family_pair = quantity.get("matched_families", {}).get(request["objective"]["family_id"])
            if not isinstance(family_pair, dict):
                raise ValueError("The candidate is missing its retained matched-family quantities")
            value = family_pair["reduction"] if kind == "matched-restoration" else family_pair["delta"]
            coverage = family_pair["common_coverage_fraction"]
            availability = family_pair["comparison_availability"]
            reason = family_pair["comparison_availability_reason"]
            support_basis = "All declared matched-family baseline and treatment runs on this pollutant's retained common footprint"
            valid_area = family_pair["common_valid_area_ha"]
            profile_changed = False
        elif kind == "current-export":
            value = quantity["baseline"]
            coverage = quantity["coverage_fraction"]
            availability = quantity.get("availability", "modeled")
            reason = quantity.get("availability_reason")
            support_basis = "Baseline original native cell support"
            valid_area = quantity.get("valid_area_ha")
            profile_changed = False
        else:
            pair = quantity["alternatives"].get(alternative)
            if not isinstance(pair, dict):
                raise ValueError("The candidate is missing its retained alternative " + alternative)
            value = pair["reduction"] if kind == "restoration" else pair["delta"]
            coverage = pair["common_coverage_fraction"]
            availability = pair.get("comparison_availability", "modeled")
            reason = pair.get("comparison_availability_reason")
            support_basis = "Common valid native support of baseline and selected alternative"
            valid_area = pair.get("common_valid_area_ha")
            profile_changed = pair.get("profile_changed", False)
        if value is not None:
            value = _number(value, axis + " original quantity")
        if coverage is not None:
            coverage = _number(coverage, axis + " coverage", minimum=0, maximum=1)
        if request["objective"]["basis"] == "per-reporting-hectare":
            value = value / reporting if value is not None and reporting > 0 else None
            unit += "/reporting_ha"
        values[axis], units[axis] = value, unit
        adequate = (
            availability == "modeled" and value is not None
            and coverage is not None
            and coverage >= request["filters"]["min_coverage_fraction"]
        )
        supports[axis] = {
            "availability": availability, "availability_reason": reason,
            "coverage_fraction": coverage, "valid_area_ha": valid_area,
            "support_basis": support_basis, "eligible_support": adequate,
            "profile_changed": profile_changed,
            **({key: deepcopy(family_pair.get(key)) for key in (
                "family_id", "baseline_run_id", "alternative_run_id", "support_id", "support_sha256",
                "common_baseline", "common_alternative", "delta", "reduction",
                "common_covered_area_ha", "common_structural_stream_area_ha", "selected_area_ha", "missing_area_ha")}
               if family_pair is not None else {}),
            **({"support_ref": "/input/matched_family_support/metrics/" + axis}
               if family_pair is not None else {}),
        }
    return values, supports, units


def _rows(study, request, engine, *, retain_original=True):
    original = study["candidates"]
    actual = {item["id"] for item in original}
    if len(actual) != len(original):
        raise ValueError("The retained candidate table contains duplicate native unit identities")
    included, excluded = set(request["filters"]["include_ids"]), set(request["filters"]["exclude_ids"])
    unknown = (included | excluded) - actual
    if unknown:
        raise ValueError("Selected IDs are absent from this retained study: " + ", ".join(sorted(unknown)))
    rows = []
    for candidate in original:
        values, support, units = _axis_values(candidate, request)
        reasons = []
        if not candidate["eligible"] and not request["include_ineligible"]:
            reasons.extend("Original study: " + x for x in candidate["exclusion_reasons"])
            if not candidate["exclusion_reasons"]:
                reasons.append("Original study marks this unit ineligible")
        if included and candidate["id"] not in included:
            reasons.append("Outside the selected candidate universe")
        if candidate["id"] in excluded:
            reasons.append("Explicitly excluded")
        if candidate["reporting_area_ha"] <= 0:
            reasons.append("No footprint in the selected reporting area")
        maximum = request["filters"]["max_protected_fraction"]
        fraction = candidate.get("protected_fraction")
        if maximum < 1 and fraction is None:
            reasons.append("The protected-area filter requires its retained source")
        elif fraction is not None and fraction > maximum:
            reasons.append("Above the selected protected-area fraction")
        water_fraction = candidate.get("source_water_fraction")
        source_water = None if water_fraction is None else water_fraction > 0
        flags = {"source_water": source_water, "high_quality_water": candidate.get("high_quality_context")}
        for field, observed in flags.items():
            desired = request["filters"][field]
            if desired != "any" and observed is None:
                reasons.append("The " + field.replace("_", " ") + " filter requires its retained source")
            elif desired != "any" and observed != (desired == "yes"):
                reasons.append("Outside the selected " + field.replace("_", " ") + " relation")
        cost = candidate.get("cost")
        currency = candidate.get("currency")
        cents = engine._money(cost, "Original supplied USD cost") if cost is not None and currency == "USD" else None
        budget_reasons = []
        if request["constraints"]["budget_usd"] is not None and cents is None:
            budget_reasons.append("No original supplied USD cost for the budget calculation")
        area = candidate["area_ha"] if request["constraints"]["area_basis"] == "whole_units" else candidate["reporting_area_ha"]
        rows.append({
            "feature_id": candidate["id"], "label": candidate["label"],
            "source_identity": deepcopy(candidate["source_identity"]),
            "unit_type": candidate["unit_type"],
            "whole_unit_area_ha": candidate["area_ha"],
            "reporting_area_ha": candidate["reporting_area_ha"],
            "area_ha": _number(area, "Selected area resource", minimum=0),
            "supplied_cost": cost, "currency": currency,
            "cost_usd": engine._usd(cents), "cost_cents": cents,
            "objective_values": values, "objective_units": units, "axis_support": support,
            "source_exclusions": reasons, "resource_exclusions": budget_reasons,
            "source_eligible": not reasons,
            **({"original_candidate": deepcopy(candidate)} if retain_original else {}),
        })
    scales = {
        axis: max((abs(row["objective_values"][axis])
                   for row in rows if row["source_eligible"]
                   and row["axis_support"][axis]["eligible_support"]), default=0.)
        for axis in request["axes"]
    }
    for row in rows:
        row["normalized_metrics"] = {
            axis: (row["objective_values"][axis] / scales[axis]
                   if row["axis_support"][axis]["eligible_support"] and scales[axis] else 0.)
            for axis in request["axes"]
        }
    normalization = {
        "method": "Maximum absolute observed objective for each adequately covered axis across source-qualified units, before cost exclusions",
        "scales": scales, "fixed_across_preference_profiles": True,
        "signed_values": "Adverse case changes remain negative and reduce the objective",
        "missing_axes": "Unavailable or inadequate support stays visible and cannot satisfy a positive weight",
    }
    return rows, normalization


def _score(rows, weights):
    scored, exclusions = [], {}
    for row in rows:
        reasons = list(row["source_exclusions"]) + list(row["resource_exclusions"])
        for axis, weight in weights.items():
            if weight <= 0 or row["axis_support"][axis]["eligible_support"]:
                continue
            observed = row["axis_support"][axis]
            reason = observed["availability_reason"]
            reasons.append(axis + ": " + (reason or "The selected quantity or its required native coverage is unavailable"))
        exclusions[row["feature_id"]] = reasons
        if not reasons:
            score = math.fsum(weights[axis] * row["normalized_metrics"][axis] for axis in weights)
            if not math.isfinite(score):
                raise ValueError("The weighted decision objective is outside finite numeric range")
            scored.append({"feature_id": row["feature_id"], "score": score,
                           "cost_cents": row["cost_cents"], "area_ha": row["area_ha"]})
    return sorted(scored, key=lambda x: (-x["score"], x["feature_id"])), exclusions


def _solver_request(request, engine):
    limits = deepcopy(request["constraints"])
    limits.pop("area_basis")
    requested_area = limits["area_ha"]
    if requested_area is not None and requested_area > 0:
        # The original solver uses an outward relative area tolerance. Make its
        # effective additive cap no larger than the user's actual land budget.
        tolerance = _number(engine.TOLERANCE, "Solver area tolerance", minimum=0)
        if requested_area >= 1:
            guarded = math.nextafter(requested_area / (1 + tolerance), 0.)
        else:
            guarded = max(0., math.nextafter(requested_area - tolerance, 0.))
        limits["area_ha"] = guarded
        if engine._area_capacity({"area_ha": guarded}) > requested_area:
            limits["area_ha"] = max(0., guarded - 2 * math.ulp(requested_area))
        if engine._area_capacity({"area_ha": limits["area_ha"]}) > requested_area:
            raise ValueError("The original solver's area tolerance cannot honor this area limit")
    return {"constraints": limits, "solver": request["solver"],
            "solver_time_limit_seconds": request["solver_time_limit_seconds"]}


def _spatial_summary(workspace, study, ids, request):
    from shapely import wkb
    from shapely.geometry import GeometryCollection
    from shapely.ops import unary_union
    payload = read_json(verify_file(workspace.root, study["files"]["geometries"]))
    units = payload["units"]
    originals, reporting = [], []
    for key in ids:
        row = units[key]
        originals.append(wkb.loads(bytes.fromhex(row["original"])))
        reporting.append(wkb.loads(bytes.fromhex(row["reporting"])))
    whole = unary_union(originals) if originals else GeometryCollection()
    report = unary_union(reporting) if reporting else GeometryCollection()
    summed_whole = math.fsum(x.area / 10000 for x in originals)
    summed_report = math.fsum(x.area / 10000 for x in reporting)
    result = {
        "analysis_crs": study["analysis_crs"],
        "whole_unit_union_area_ha": whole.area / 10000,
        "reporting_union_area_ha": report.area / 10000,
        "summed_whole_unit_area_ha": summed_whole,
        "summed_reporting_area_ha": summed_report,
        "whole_unit_overlap_area_ha": max(0., summed_whole - whole.area / 10000),
        "reporting_overlap_area_ha": max(0., summed_report - report.area / 10000),
        "area_resource_basis": request["constraints"]["area_basis"],
        "area_constraint_method": "Additive source-unit area, conservative relative to the corresponding geometry union",
    }
    area = result["whole_unit_union_area_ha"] if request["constraints"]["area_basis"] == "whole_units" else result["reporting_union_area_ha"]
    maximum = request["constraints"]["area_ha"]
    if maximum is not None and area > maximum + 1e-9:
        raise ValueError("The selected original geometry union exceeds the requested area limit")
    return result


def _independent_quantities(rows, ids, request):
    chosen = [row for row in rows if row["feature_id"] in ids]
    result = {}
    for axis in request["axes"]:
        values = [row["objective_values"][axis] for row in chosen]
        known = math.fsum(x for x in values if x is not None)
        result[axis] = {
            "sum": None if axis not in request["available_axes"] or any(x is None for x in values) else known,
            "known_sum": known if axis in request["available_axes"] else None,
            "known_units": sum(x is not None for x in values),
            "unknown_units": sum(x is None for x in values),
            "unit": (chosen[0]["objective_units"][axis] if chosen else
                     next(item["unit"] for item in request["objective"]["criteria"] if item["id"] == axis)
                     if request["objective"]["kind"] == "multi-criteria" else
                     CONTEXT_UNITS[axis] if request["objective"]["kind"] == "source-context" else
                     ("points" if request["objective"]["kind"] == "published-method" else conservation.POLLUTANTS[axis][2]) +
                     ("/reporting_ha" if request["objective"]["basis"] == "per-reporting-hectare" else "")),
            "availability": "selected_input" if axis in request["available_axes"] else "unavailable_input",
        }
    return result


def preview(workspace, selection):
    """Read actual candidates and return one complete decision analysis."""
    if not isinstance(selection, dict):
        raise ValueError("Supply a conservation optimization selection")
    engine = _engine()
    study = conservation.inspect(workspace, identifier(selection.get("study_id")), include_candidates=True)
    if study["state"] != "complete":
        raise ValueError("Complete the original conservation study before optimizing its retained units")
    request = _request(selection, study, engine)
    rows, normalization, case_variants = _decision_rows(study, request, engine)
    solver_request = _solver_request(request, engine)
    scored, exclusions = _score(rows, request["weights"])
    chosen, optimization = engine._optimize(scored, solver_request)
    ids = {row["feature_id"] for row in chosen}
    ranks = {row["feature_id"]: (index + 1, row["score"]) for index, row in enumerate(scored)}
    for row in rows:
        row["rank"], row["score"] = ranks.get(row["feature_id"], (None, None))
        row["eligible"] = not exclusions[row["feature_id"]]
        row["exclusions"] = exclusions[row["feature_id"]]
        row["selected"] = row["feature_id"] in ids
    profiles = [{"name": "Selected weights", "weights": request["weights"]}]
    if request["stability"]["enabled"]:
        profiles += request["stability"]["profiles"]
    profile_results, seen = [], set()
    stability_counts = {row["feature_id"]: {"selected_profiles": 0, "eligible_profiles": 0, "ranks": []} for row in rows}
    for index, profile in enumerate(profiles):
        identity = tuple(profile["weights"][axis] for axis in request["axes"])
        if identity in seen:
            continue
        seen.add(identity)
        if index == 0:
            ranked, selected, outcome = scored, chosen, optimization
        else:
            ranked, _ = _score(rows, profile["weights"])
            selected, outcome = engine._optimize(ranked, solver_request)
        selected_ids = {row["feature_id"] for row in selected}
        for rank, row in enumerate(ranked, 1):
            counts = stability_counts[row["feature_id"]]
            counts["eligible_profiles"] += 1
            counts["ranks"].append(rank)
            counts["selected_profiles"] += int(row["feature_id"] in selected_ids)
        profile_results.append({
            **profile, "selected_ids": sorted(selected_ids), "eligible_count": len(ranked),
            "optimization": outcome,
        })
    for row in rows:
        counts = stability_counts[row["feature_id"]]
        ranks_for_row = counts.pop("ranks")
        row["preference_stability"] = {
            **counts, "profile_count": len(profile_results),
            "minimum_rank": min(ranks_for_row, default=None),
            "maximum_rank": max(ranks_for_row, default=None),
            "selection_fraction": counts["selected_profiles"] / len(profile_results),
        }
    scenario_comparison = _scenario_comparison(
        rows, request, case_variants, scored, chosen, optimization, engine, solver_request)
    joint_comparison = conservation_joint_choices.compare(
        rows, request, case_variants, profile_results, scenario_comparison,
        _score, engine._optimize, solver_request)
    geometry = _spatial_summary(workspace, study, sorted(ids), request)
    selected_rows = [row for row in rows if row["selected"]]
    currency_values = {row["currency"] for row in selected_rows if row["currency"] is not None}
    known_cost = math.fsum(row["supplied_cost"] for row in selected_rows if row["supplied_cost"] is not None)
    unknown_costs = sum(row["supplied_cost"] is None for row in selected_rows)
    if len(currency_values) > 1:
        raise ValueError("The retained cost table must identify one original currency")
    reasons = Counter(reason for row in rows for reason in row["exclusions"])
    source_selection = study["selection"]
    module = Path(engine.__file__).resolve()
    analysis = {
        "schema": SCHEMA, "version": VERSION,
        "input": {
            "study_id": study["id"], "title": study["title"], "mode": study["mode"],
            "purpose": study["purpose"], "unit_type": study["unit_type"],
            "planning_unit_label": study["planning_unit_label"],
            "selection": deepcopy(source_selection),
            "candidate_inventory": deepcopy(study["files"]["candidates"]),
            "geometry_inventory": deepcopy(study["files"]["geometries"]),
            **({"matched_family_support": deepcopy(study["matched_family_support"])}
               if study.get("matched_family_support") else {}),
        },
        "engine": {"module": "model.portfolios", "bytes": module.stat().st_size,
                   "sha256": file_digest(module), "numeric_solver_callable": "_optimize"},
        "request": request, "solver_request": solver_request,
        "normalization": normalization,
        "counts": {"inventory": len(rows), "eligible": len(scored), "selected": len(chosen),
                   "excluded": len(rows) - len(scored), "exclusion_reasons": dict(sorted(reasons.items()))},
        "candidates": sorted(rows, key=lambda row: (
            row["rank"] is None, row["rank"] or 0, row["feature_id"])),
        "selected_ids": sorted(ids),
        "selection": {
            "count": len(ids), "objective_score": optimization["objective_score"],
            "known_supplied_cost_subtotal": known_cost,
            "supplied_cost_total": None if unknown_costs else known_cost,
            "units_without_supplied_cost": unknown_costs,
            "currency": next(iter(currency_values)) if currency_values else None,
            "independent_objective_sums": _independent_quantities(rows, ids, request),
            "geometry": geometry,
        },
        "optimization": optimization,
        "stability": {
            "enabled": request["stability"]["enabled"], "profiles": profile_results,
            "interpretation": "Frequency across explicitly named decision preferences; not scientific uncertainty or a probability",
            "normalization": "Fixed source-qualified scales; each profile independently requires adequate support on its positive axes",
        },
        "methods": {
            "objective_scope": {
                "multi-criteria": "Explicit weighted source-bound criteria combining retained native quantities, source context, published points and original source attributes; each criterion retains its own units and case support",
                "source-context": "Declared geographic context preference",
                "published-method": "Complete published practice priority points for the independent original parcel units, with the explicitly selected portfolio quantity basis",
                "current-export": "Baseline modeled export within each original planning-unit reporting footprint",
                "restoration": "Baseline minus selected alternative on common native support within each original reporting footprint",
                "avoided-conversion": "Selected disturbance alternative minus baseline on common native support within each original reporting footprint",
                "matched-restoration": "Selected family's same-profile baseline minus treatment on each pollutant's all-declared-family common footprint",
                "matched-disturbance": "Selected family's same-profile treatment minus baseline on each pollutant's all-declared-family common footprint",
            }[request["objective"]["kind"]],
            "annual_units": {axis: conservation.POLLUTANTS[axis][2] for axis in PHYSICAL_AXES},
            "coverage": "Separate active-axis case or common-pair coverage; fractional hectares remain fractional",
            "missingness": "Unselected models, unknown context, incomplete published criteria and absent costs retain their distinct unavailable state",
            "published_points": "Original method/category/criterion bounds and prerequisites remain separate from native mass; unknown or inapplicable totals cannot satisfy a positive point weight",
            "optimization": "The maintained portfolio engine optimizes signed normalized independent-unit objectives",
            "area": geometry["area_constraint_method"],
            "optimality_scope": "Reported solver optimality and bounds concern the declared additive resource/objective problem",
            "selected_result": "The authoritative saved plan recomputes native quantities on the selected reporting union",
            "native_action": "A selected-footprint case contribution becomes a modeled treatment result only through the original selected-mask scenario and completed native run",
            "costs": "Original supplied full-unit amounts; USD solver arithmetic uses exact integer cents and never converts other currencies",
            "normalization": "No arbitrary candidate-count cap; all original selected-source candidates are retained",
        },
    }
    if scenario_comparison is not None:
        analysis["scenario_stability"] = scenario_comparison
        analysis["methods"]["scenario_comparison"] = scenario_comparison["interpretation"]
        analysis["methods"]["criterion_direction"] = "Maximize retains each signed source value; minimize negates its normalized contribution. Missing values never become credited zeros."
        analysis["methods"]["attribute_units"] = "Attribute units and references are explicit analyst declarations attached to the unchanged source field; no implicit conversion or connectivity model is applied."
    if joint_comparison is not None:
        joint_module = Path(conservation_joint_choices.__file__).resolve()
        joint_comparison["implementation"] = {
            "module": "model.conservation_joint_choices",
            "bytes": joint_module.stat().st_size, "sha256": file_digest(joint_module),
        }
        analysis["joint_comparison"] = joint_comparison
        analysis["methods"]["joint_comparison"] = joint_comparison["interpretation"]
        analysis["methods"]["portfolio_regret"] = joint_comparison["regret"]
    analysis["id"] = digest(analysis)
    return analysis


def _csv(analysis):
    axes = analysis["request"]["axes"]
    fields = [
        "feature_id", "label", "unit_type", "selected", "eligible", "rank", "score",
        "whole_unit_area_ha", "reporting_area_ha", "supplied_cost", "currency",
        "source_identity", "exclusions", "preference_stability",
    ]
    for axis in axes:
        fields += [axis + suffix for suffix in ("_objective", "_unit", "_coverage", "_availability", "_reason")]
    if analysis["request"]["objective"]["kind"] == "multi-criteria":
        fields += ["score_contributions", "scenario_stability", "axis_support"]
    fields += ["original_candidate"]
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=fields)
    writer.writeheader()
    for row in analysis["candidates"]:
        record = {name: row[name] for name in fields if name in row}
        for key in ("source_identity", "exclusions", "preference_stability", "original_candidate",
                    "score_contributions", "scenario_stability", "axis_support"):
            if key in record:
                record[key] = canonical(row[key]).decode("utf-8")
        for axis in axes:
            support = row["axis_support"][axis]
            record.update({
                axis + "_objective": row["objective_values"][axis],
                axis + "_unit": row["objective_units"][axis],
                axis + "_coverage": support["coverage_fraction"],
                axis + "_availability": support["availability"],
                axis + "_reason": support["availability_reason"],
            })
        writer.writerow(record)
    return output.getvalue().encode("utf-8")


def _html(analysis):
    """Render the retained decision as a readable, self-contained scientific report."""
    esc = lambda value: html.escape(str(value), quote=True)

    def text(value):
        return "Unavailable" if value is None else esc(value)

    def number(value, digits=8):
        if value is None:
            return "Unavailable"
        if isinstance(value, bool):
            return "Yes" if value else "No"
        if isinstance(value, (int, float)):
            return esc(format(value, "." + str(digits) + "g"))
        return esc(value)

    def percent(value):
        return "Unavailable" if value is None else number(value * 100, 6) + "%"

    def table(title, headers, rows, *, wide=False):
        rendered = ['<section><h3>' + esc(title) + '</h3><div class="table-scroll" tabindex="0" role="region" aria-label="'
                    + esc(title) + '"><table' + (' class="wide"' if wide else '') + '><thead><tr>']
        rendered += ['<th scope="col">' + esc(value) + '</th>' for value in headers]
        rendered.append('</tr></thead><tbody>')
        for row in rows:
            rendered.append('<tr>' + ''.join('<td>' + value + '</td>' for value in row) + '</tr>')
        if not rows:
            rendered.append('<tr><td colspan="' + str(len(headers)) + '">No retained records in this selection.</td></tr>')
        rendered.append('</tbody></table></div></section>')
        return ''.join(rendered)

    request = analysis["request"]
    selection = analysis["selection"]
    geometry = selection["geometry"]
    counts = analysis["counts"]
    constraints = request["constraints"]
    objective = request["objective"]
    candidates = analysis["candidates"]
    by_id = {row["feature_id"]: row for row in candidates}
    criterion_definitions = {row["id"]: row for row in objective.get("criteria", [])}
    family_definitions = {row["id"]: row for row in analysis["input"]["selection"]["spec"].get("matched_families", [])}
    labels = {axis: criterion_definitions.get(axis, {}).get("label", axis.replace("_", " "))
              for axis in request["axes"]}

    def unit_names(ids):
        return '<ul class="compact">' + ''.join(
            '<li>' + esc(by_id.get(key, {}).get("label") or key) + '</li>' for key in ids
        ) + '</ul>' if ids else "None"

    parts = ['''<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Conservation decision analysis</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#fff;color:#202124;font:15px/1.5 system-ui,sans-serif}
main{max-width:1280px;margin:auto;padding:28px}h1{font-size:1.8rem;line-height:1.2}h2{font-size:1.3rem;margin-top:2rem;padding-top:.5rem;border-top:1px solid #bbb}h3{font-size:1rem;margin:1.2rem 0 .5rem}
p{max-width:95ch}a{color:#202124;text-underline-offset:2px}code{overflow-wrap:anywhere;font-size:.88em}
.table-scroll{max-width:100%;overflow:auto;border:1px solid #bfc3c7;border-radius:3px;margin:.5rem 0 1rem}
.table-scroll:focus{outline:3px solid #444;outline-offset:2px}table{border-collapse:collapse;width:100%;min-width:36rem;font-variant-numeric:tabular-nums}table.wide{min-width:70rem}
th,td{min-width:7.5rem;padding:.55rem .65rem;border-bottom:1px solid #d7d9dc;text-align:left;vertical-align:top;overflow-wrap:break-word;word-break:normal}th{background:#f1f2f3;font-weight:600}tr:last-child td{border-bottom:0}td a{overflow-wrap:anywhere}
.numeric{white-space:nowrap}.muted{color:#555}.notice{border-left:3px solid #737b83;padding:.5rem 1rem;background:#f6f7f8}
.compact{margin:0;padding-left:1.2rem}.compact li{margin:.15rem 0}details{margin:1rem 0}summary{cursor:pointer;font-weight:600}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.4 ui-monospace,monospace;background:#f5f6f7;padding:1rem}
nav{display:flex;flex-wrap:wrap;gap:.6rem 1.1rem;margin:1rem 0}section{margin-bottom:1.1rem}
@media(max-width:600px){main{padding:16px}h1{font-size:1.5rem}th,td{padding:.45rem}.table-scroll{margin-right:0}}
@media print{main{max-width:none;padding:0}body{font-size:9pt}nav{display:none}.table-scroll{overflow:visible;border:0}table,table.wide{min-width:0}th,td{min-width:0;padding:4px;overflow-wrap:anywhere}tr{break-inside:avoid}a{color:inherit}details{break-inside:avoid}}
</style></head><body><main>''',
        '<h1>' + esc(request["title"]) + '</h1>',
        '<p>' + esc(request["purpose"]) + '</p>',
        '<p><strong>Study:</strong> ' + esc(analysis["input"].get("title") or analysis["input"]["study_id"])
        + ' · ' + esc(analysis["input"]["planning_unit_label"]) + '</p>',
        '<p>' + esc(analysis["methods"]["objective_scope"]) + '.</p>',
        '<nav aria-label="Report files"><a href="analysis.json">Download original analysis JSON</a>'
        '<a href="candidates.csv">Download all candidates CSV</a></nav>',
        '<h2>Selected portfolio</h2>']
    parts.append(table("Decision summary", ["Measure", "Retained result"], [
        ["Selected original units", number(counts["selected"]) + " of " + number(counts["inventory"])],
        ["Eligible / excluded", number(counts["eligible"]) + " / " + number(counts["excluded"])],
        ["Weighted objective", number(selection["objective_score"]) + " (dimensionless)"],
        ["Whole-unit union", number(geometry["whole_unit_union_area_ha"]) + " ha"],
        ["Reporting-area union", number(geometry["reporting_union_area_ha"]) + " ha"],
        ["Supplied full-unit cost", number(selection["supplied_cost_total"]) + " " + esc(selection.get("currency") or "")],
        ["Known supplied cost subtotal", number(selection["known_supplied_cost_subtotal"]) + " " + esc(selection.get("currency") or "")],
        ["Units without supplied cost", number(selection["units_without_supplied_cost"])],
    ]))
    parts.append('<p><strong>Chosen units:</strong></p>' + unit_names(analysis["selected_ids"]))
    parts.append(table("Resource constraints", ["Constraint", "Entered limit", "Accounting"], [
        ["Budget", "Not set" if constraints["budget_usd"] is None else number(constraints["budget_usd"]) + " USD",
         "Original supplied full-unit costs; no currency conversion"],
        ["Area", "Not set" if constraints["area_ha"] is None else number(constraints["area_ha"]) + " ha",
         "Whole source units" if constraints["area_basis"] == "whole_units" else "Reporting footprints"],
        ["Unit count", "Not set" if constraints["max_count"] is None else number(constraints["max_count"]),
         "Original planning units"],
    ]))
    parts.append('<p class="notice">The optimizer uses additive values for the original units. Overlapping footprints and sums of per-hectare values are not independent basin totals. Saving the portfolio uses the original conservation plan workflow, which recomputes quantities on its selected reporting union.</p>')
    parts.append(table("Selected geometry accounting", ["Measure", "Hectares"], [
        ["Summed whole-unit area", number(geometry["summed_whole_unit_area_ha"])],
        ["Summed reporting area", number(geometry["summed_reporting_area_ha"])],
        ["Whole-unit overlap", number(geometry["whole_unit_overlap_area_ha"])],
        ["Reporting overlap", number(geometry["reporting_overlap_area_ha"])],
    ]))

    parts.append('<h2>Criteria, source quantities and weights</h2>')
    criteria_rows = []
    for axis in request["axes"]:
        criterion = criterion_definitions.get(axis, {})
        first = next((row for row in candidates if axis in row["objective_units"]), None)
        unit = first["objective_units"][axis] if first else criterion.get("unit", "")
        basis = criterion.get("basis", objective.get("basis", "total"))
        case = criterion.get("scenario_run_id", objective.get("scenario_run_id"))
        kind = criterion.get("kind", objective["kind"])
        source_description = criterion.get("reference") or kind.replace("-", " ")
        if criterion.get("field"):
            source_description += " · field: " + criterion["field"]
        if case:
            source_description += " · alternative: " + case
        family_id = criterion.get("family_id", objective.get("family_id"))
        if family_id is not None:
            family = family_definitions[family_id]
            source_description += " · family: " + family["label"] + " [" + family_id + "]"
            source_description += " · baseline: " + family["baseline_run_id"]
            source_description += " · treatment: " + family["alternative_run_id"]
        criteria_rows.append([
            esc(labels[axis]), esc(source_description), esc(unit),
            "Per reporting hectare" if basis == "per-reporting-hectare" else "Original total / source value",
            esc(criterion.get("direction", "maximize")),
            percent(request["weights"].get(axis, 0)),
            number(analysis["normalization"]["scales"].get(axis)),
        ])
    parts.append(table("Criterion definitions", [
        "Criterion", "Original quantity / source", "Unit", "Basis", "Direction", "Weight", "Fixed scale"
    ], criteria_rows, wide=True))
    parts.append('<p>Each supported quantity is divided by its criterion’s maximum absolute scale. A minimize criterion negates that normalized value. The score is the sum of weighted contributions; weights total one. Adverse changes remain signed. A positive weight requires valid source support; unavailable values are not treated as beneficial zeroes.</p>')
    if analysis["normalization"].get("fixed_across_scenario_cases"):
        parts.append('<p>The scales are fixed across the selected case and all explicitly compared native cases, and reused across preference profiles. Adding a case can change these scales and therefore defines a new decision analysis.</p>')
    else:
        parts.append('<p>The scales are fixed across the selected candidate universe and reused for the preference comparisons.</p>')
    if family_definitions:
        native_bindings = analysis["input"]["selection"]["bindings"]["runs"]
        parts.append('<h2>Matched native families and common footprints</h2>')
        parts.append('<p>Within each declared family the original baseline and treatment have the same profile and grid. Across families the model hypotheses may differ. Each pollutant has its own footprint shared by every declared pair; N, P and sediment footprints are not interchangeable. These cases have no assumed probabilities. Code 1 contributes mass; code 2 is a verified structural stream omission and contributes only coverage. A structural-only unit has unavailable mass, not measured zero.</p>')
        family_rows = []
        for family_id, family in family_definitions.items():
            profile_id = native_bindings[family["baseline_run_id"]]["selection"]["profile_id"]
            family_rows.append([esc(family["label"]) + '<br><code>' + esc(family_id) + '</code>',
                                '<code>' + esc(profile_id) + '</code>',
                                '<code>' + esc(family["baseline_run_id"]) + '</code>',
                                '<code>' + esc(family["alternative_run_id"]) + '</code>',
                                esc(family["reason"]), text(family.get("reference"))])
        parts.append(table("Original matched pairs", ["Family", "Shared profile", "Baseline run", "Treatment run", "Reason", "Reference"],
                           family_rows, wide=True))
        support_rows = []
        for pollutant, support in analysis["input"]["matched_family_support"]["metrics"].items():
            support_rows.append([esc(pollutant), esc(support["unit"]), esc(support["state"]),
                                 number(support.get("grid_valid_area_ha")), number(support.get("grid_structural_area_ha")),
                                 number(support.get("grid_covered_area_ha")),
                                 '<code>' + esc(support["mask"]["sha256"]) + '</code>' if support.get("mask") else text(support.get("reason"))])
        parts.append(table("Per-pollutant masks — complete original grid", [
            "Pollutant", "Annual mass unit", "Availability", "Finite-rate ha", "Structural-stream ha", "Covered ha", "Original mask SHA-256 / reason"
        ], support_rows, wide=True))
        parts.append('<p>These mask areas describe the complete original model grid. Candidate and saved-union coverage use exact intersections with their reporting polygons; they are not these grid totals.</p>')
    quantity_rows = []
    for axis, item in selection["independent_objective_sums"].items():
        quantity_rows.append([
            esc(labels.get(axis, axis)), number(item.get("sum")), esc(item.get("unit", "")),
            number(item.get("known_sum")), number(item.get("known_units")), number(item.get("unknown_units")),
        ])
    parts.append(table("Independent selected-unit quantities", [
        "Criterion", "Sum of known complete unit values", "Unit", "Known subtotal", "Known units", "Unknown units"
    ], quantity_rows, wide=True))
    parts.append('<p class="muted">These are arithmetic sums over selected original units. They preserve each criterion’s units; different pollutants, points, hectares and source attributes are never added as a physical total. Density sums and overlapping-unit sums should be interpreted with the original quantities and selected-union plan.</p>')
    outcome = analysis["optimization"]
    parts.append('<h2>Solver result</h2>')
    parts.append(table("Optimization accounting", ["Measure", "Result"], [
        ["Status", esc(outcome.get("status", "Unavailable"))],
        ["Algorithm", text(outcome.get("algorithm"))],
        ["Requested solver", text(outcome.get("requested_solver", request.get("solver")))],
        ["Objective value", number(outcome.get("objective_score"))],
        ["Upper bound", number(outcome.get("upper_bound"))],
        ["Absolute gap", number(outcome.get("absolute_gap"))],
        ["Relative gap", percent(outcome.get("relative_gap"))],
        ["Optimality basis", text(outcome.get("optimality_basis"))],
    ]))
    optional = outcome.get("optional_solver")
    if optional:
        parts.append('<p class="notice"><strong>Optional solver:</strong> '
                     + esc("; ".join(str(key).replace("_", " ") + ": " + str(value)
                                     for key, value in optional.items())) + '</p>')
    if not analysis["selected_ids"]:
        parts.append('<p class="notice">No positive feasible portfolio was selected under these objectives and constraints. Review the signed criterion contributions, missing support and resource limits before changing the analyst’s selection.</p>')
    parts.append('<h2>Preference comparisons</h2>')
    stability = analysis["stability"]
    parts.append('<p>' + esc(stability["interpretation"]) + '.</p>')
    preference_rows = []
    for profile in stability["profiles"]:
        weights = "; ".join(labels.get(key, key) + ": " + format(value * 100, ".6g") + "%"
                            for key, value in profile["weights"].items() if value > 0)
        result = profile["optimization"]
        preference_rows.append([
            esc(profile["name"]), esc(weights), number(profile["eligible_count"]),
            unit_names(profile["selected_ids"]), number(result["objective_score"]),
            text(result.get("status")), percent(result.get("relative_gap")),
        ])
    parts.append(table("Explicit decision preferences", [
        "Preference", "Positive weights", "Eligible units", "Selected units", "Objective", "Solver status", "Gap"
    ], preference_rows, wide=True))
    scenario = analysis.get("scenario_stability")
    if scenario is not None and not scenario.get("enabled"):
        scenario = None
    if scenario is not None:
        parts.append('<h2>Native case comparisons</h2><p>' + esc(scenario["interpretation"]) + '.</p>')
        parts.append('<p>' + esc(scenario["preference_relation"]) + '.</p>')
        parts.append('<p class="notice">Legacy paired criteria retain their selected baseline/alternative support. Matched-family criteria use a fixed all-declared-family footprint separately for each pollutant, with same-profile baseline/treatment within each family. Rank changes across families describe sensitivity to the declared native hypotheses under the same decision weights; they are not calibrated uncertainty.</p>')
        case_rows = []
        for case in scenario["cases"]:
            mapping_parts = [labels.get(key, key) + ": alternative " + value
                             for key, value in case["scenario_run_ids"].items()]
            mapping_parts += [labels.get(key, key) + ": family " +
                              family_definitions[value]["label"] + " [" + value + "]"
                              for key, value in case.get("family_ids", {}).items()]
            mappings = "; ".join(mapping_parts) or "No paired criterion"
            result = case["optimization"]
            case_rows.append([
                esc(case["name"]), esc(mappings), number(case["eligible_count"]),
                unit_names(case["selected_ids"]), number(result["objective_score"]),
                text(result.get("status")), percent(result.get("relative_gap")),
            ])
        parts.append(table("Selected weights across retained cases", [
            "Case", "Original alternatives / matched families", "Eligible units", "Selected units", "Objective", "Solver status", "Gap"
        ], case_rows, wide=True))
    stability_rows = []
    for row in candidates:
        pref = row["preference_stability"]
        case = row.get("scenario_stability") if scenario is not None else None
        pref_range = ("Unavailable" if pref["minimum_rank"] is None else
                      number(pref["minimum_rank"]) + "–" + number(pref["maximum_rank"]))
        case_range = ("Not compared" if case is None else "Unavailable" if case["minimum_rank"] is None else
                      number(case["minimum_rank"]) + "–" + number(case["maximum_rank"]))
        stability_rows.append([
            esc(row["label"]), number(pref["selected_profiles"]) + " / " + number(pref["profile_count"]),
            number(pref["eligible_profiles"]) + " / " + number(pref["profile_count"]), pref_range,
            "Not compared" if case is None else number(case["selected_cases"]) + " / " + number(case["case_count"]),
            "Not compared" if case is None else number(case["eligible_cases"]) + " / " + number(case["case_count"]),
            case_range,
        ])
    parts.append(table("Priority stability by original unit", [
        "Original unit", "Selected preferences", "Eligible preferences", "Preference rank range",
        "Selected cases", "Eligible cases", "Case rank range"
    ], stability_rows, wide=True))
    parts.append('<p class="muted">Counts describe only the explicitly included preferences and cases. Eligibility can change when a positive-weight criterion lacks support. These fractions are neither selection probabilities nor calibrated confidence levels.</p>')
    if analysis.get("joint_comparison") is not None:
        parts.append(conservation_joint_choices.html_section(
            analysis["joint_comparison"], {row["feature_id"]: row["label"] for row in candidates}))
    parts.append('<h2>Original candidate values and support</h2>')
    candidate_rows = []
    for row in candidates:
        support_items = []
        for axis in request["axes"]:
            support = row["axis_support"][axis]
            line = '<strong>' + esc(labels[axis]) + ':</strong> ' + number(row["objective_values"][axis])
            line += " " + esc(row["objective_units"][axis]) + "; " + esc(support["availability"].replace("_", " "))
            if support["coverage_fraction"] is not None:
                line += "; coverage " + percent(support["coverage_fraction"])
            if support.get("valid_area_ha") is not None:
                line += "; valid area " + number(support["valid_area_ha"]) + " ha"
            if support.get("availability_reason"):
                line += "; " + esc(support["availability_reason"])
            if support.get("profile_changed"):
                line += "; native parameter profile changed"
            if axis in row.get("score_contributions", {}):
                line += "; score contribution " + number(row["score_contributions"][axis])
            support_items.append('<li>' + line + '</li>')
        if row["exclusions"]:
            support_items.append('<li><strong>Exclusions:</strong> ' + esc("; ".join(row["exclusions"])) + '</li>')
        candidate_rows.append([
            number(row["rank"]), esc(row["label"]) + '<br><code>' + esc(row["feature_id"]) + '</code>',
            "Selected" if row["selected"] else "Eligible" if row["eligible"] else "Excluded",
            number(row["score"]), number(row["whole_unit_area_ha"]), number(row["reporting_area_ha"]),
            number(row["supplied_cost"]) + " " + esc(row["currency"] or ""),
            '<ul class="compact">' + ''.join(support_items) + '</ul>',
        ])
    parts.append(table("All original candidates", [
        "Rank", "Original unit", "Selection", "Score", "Full ha", "Reporting ha", "Supplied full-unit cost",
        "Criterion quantities, support and contributions"
    ], candidate_rows, wide=True))
    if scenario is not None:
        for case in scenario["cases"][1:]:
            comparison_rows = []
            for row in case["candidates"]:
                values = []
                for axis in request["axes"]:
                    support = row["axis_support"][axis]
                    line = esc(labels[axis]) + ": " + number(row["objective_values"][axis])
                    line += " " + esc(row["objective_units"][axis])
                    line += "; " + esc(support["availability"].replace("_", " "))
                    if support["coverage_fraction"] is not None:
                        line += "; coverage " + percent(support["coverage_fraction"])
                    if support.get("availability_reason"):
                        line += "; " + esc(support["availability_reason"])
                    values.append('<li>' + line + '</li>')
                comparison_rows.append([
                    esc(by_id[row["feature_id"]]["label"]), number(row["rank"]),
                    "Selected" if row["selected"] else "Eligible" if row["rank"] is not None else "Excluded",
                    number(row["score"]), '<ul class="compact">' + ''.join(values) + '</ul>',
                    esc("; ".join(row["exclusions"])) or "None",
                ])
            parts.append('<details><summary>Candidate quantities — ' + esc(case["name"]) + '</summary>')
            parts.append(table(case["name"], ["Unit", "Rank", "Selection", "Score", "Original quantities and support", "Exclusions"],
                               comparison_rows, wide=True))
            parts.append('</details>')
    parts.append('<h2>Methods and interpretation</h2>')
    method_rows = []
    for key, value in analysis["methods"].items():
        rendered = "; ".join(str(k) + ": " + str(v) for k, v in value.items()) if isinstance(value, dict) else str(value)
        method_rows.append([esc(key.replace("_", " ").capitalize()), esc(rendered)])
    parts.append(table("Retained method record", ["Topic", "Method / interpretation"], method_rows))
    parts.append('<details><summary>Original selection, source and calculation records</summary><p>The original JSON is also available as a separate download.</p><pre>'
                 + esc(json.dumps({"analysis_id": analysis["id"], "input": analysis["input"],
                                   "request": request, "normalization": analysis["normalization"],
                                   "solver": outcome}, ensure_ascii=False, indent=2))
                 + '</pre></details></main></body></html>')
    return "".join(parts).encode("utf-8")


def _retain(workspace, analysis):
    directory = workspace.root / "conservation" / analysis["input"]["study_id"] / "optimization" / analysis["id"]
    state_path = directory / "analysis-state.json"
    with held(workspace.root / ".workspace.lock", blocking=False):
        if state_path.exists():
            state = read_json(state_path)
            for item in state["files"].values():
                verify_file(workspace.root, item)
            if read_json(verify_file(workspace.root, state["files"]["analysis"])) != analysis:
                raise ValueError("The saved decision analysis identity differs")
            return state
        directory.mkdir(parents=True, exist_ok=True)
        atomic_json(directory / "analysis.json", analysis, immutable=True)
        atomic_bytes(directory / "candidates.csv", _csv(analysis))
        atomic_bytes(directory / "index.html", _html(analysis))
        joint_files = {}
        if analysis.get("joint_comparison") is not None:
            for filename, body in conservation_joint_choices.csv_files(analysis["joint_comparison"]).items():
                atomic_bytes(directory / filename, body)
                joint_files[filename] = describe_file(workspace.root, directory / filename)
        state = {
            "schema": REFERENCE_SCHEMA, "id": analysis["id"], "study_id": analysis["input"]["study_id"],
            "state": "complete", "created_at": now(),
            "files": {name: describe_file(workspace.root, directory / filename) for name, filename in (
                ("analysis", "analysis.json"), ("candidates", "candidates.csv"), ("report", "index.html"))},
        }
        state["files"].update(joint_files)
        atomic_json(state_path, state, immutable=True)
        return state


def get_analysis(workspace, study_id, analysis_id):
    """Reopen the same complete analysis without recomputing a preference decision."""
    path = workspace.root / "conservation" / identifier(study_id) / "optimization" / identifier(analysis_id) / "analysis-state.json"
    state = read_json(path)
    if state["schema"] != REFERENCE_SCHEMA or state["id"] != analysis_id or state["study_id"] != study_id:
        raise ValueError("The requested original decision analysis differs")
    for item in state["files"].values():
        verify_file(workspace.root, item)
    analysis = read_json(verify_file(workspace.root, state["files"]["analysis"]))
    original = dict(analysis)
    key = original.pop("id")
    if key != analysis_id or digest(original) != analysis_id:
        raise ValueError("The retained decision analysis content differs from its original identity")
    return {"state": state, "analysis": analysis}


def _retained_preview(workspace, selection, original):
    """Validate one completed original task result before persisting its choice."""
    if not isinstance(original, dict):
        raise ValueError("Choose a completed original portfolio preview")
    analysis = deepcopy(original)
    key = analysis.pop("id", None)
    if (analysis.get("schema") != SCHEMA or analysis.get("version") != VERSION
            or not isinstance(key, str) or digest(analysis) != key):
        raise ValueError("The original portfolio preview content differs")
    analysis["id"] = key
    study = conservation.inspect(
        workspace, identifier(selection.get("study_id")), include_candidates=False)
    if study["state"] != "complete":
        raise ValueError("The original conservation inventory must be complete")
    original_input = analysis.get("input", {})
    if (original_input.get("study_id") != study["id"]
            or original_input.get("selection") != study["selection"]
            or original_input.get("candidate_inventory") != study["files"]["candidates"]
            or original_input.get("geometry_inventory") != study["files"]["geometries"]
            or original_input.get("matched_family_support") != study.get("matched_family_support")):
        raise ValueError("Reopen the portfolio preview with its original study and inventories")
    verify_file(workspace.root, study["files"]["candidates"])
    verify_file(workspace.root, study["files"]["geometries"])
    # The completed task already owns the normalized request. Re-normalizing
    # its floating-point weights can change their final bits and the saved choice.
    if selection != analysis.get("request"):
        raise ValueError("The saved decision must use the original preview's objectives and constraints")
    original_candidates = read_json(
        verify_file(workspace.root, study["files"]["candidates"]))["candidates"]
    original_ids = {row["id"] for row in original_candidates}
    selected = analysis.get("selected_ids")
    if (not isinstance(selected, list)
            or any(not isinstance(key, str) for key in selected)
            or len(selected) != len(set(selected))
            or not set(selected) <= original_ids):
        raise ValueError("The preview selection must retain original inventory unit IDs")
    return analysis


def save(workspace, selection, *, retained_analysis=None):
    """Save a new optimization or the exact selection from an original preview."""
    analysis = (preview(workspace, selection) if retained_analysis is None
                else _retained_preview(workspace, selection, retained_analysis))
    if not analysis["selected_ids"]:
        raise ValueError("No positive feasible selection remains under the explicit objectives and constraints")
    record = _retain(workspace, analysis)
    request, constraints = analysis["request"], analysis["request"]["constraints"]
    limits = {"area_basis": constraints["area_basis"]}
    if constraints["area_ha"] is not None:
        limits["maximum_area_ha"] = constraints["area_ha"]
    if constraints["budget_usd"] is not None:
        limits["maximum_cost"] = constraints["budget_usd"]
    if constraints["max_count"] is not None:
        limits["maximum_parcels"] = constraints["max_count"]
    reference = {
        "schema": REFERENCE_SCHEMA, "analysis_id": analysis["id"],
        "study_id": request["study_id"], "files": record["files"],
        "engine": analysis["engine"], "request": request,
        "normalization": analysis["normalization"], "solver_result": analysis["optimization"],
        "selected_ids": analysis["selected_ids"],
        "objective_scope": analysis["methods"]["objective_scope"],
        "geometry": analysis["selection"]["geometry"],
    }
    plan = conservation.save_plan(workspace, {
        "study_id": request["study_id"], "title": request["title"], "mode": "manual",
        "selected_ids": analysis["selected_ids"], "include_ineligible": request["include_ineligible"],
        "limits": limits, "optimization": reference,
    })
    if set(plan["selected_ids"]) != set(analysis["selected_ids"]):
        raise ValueError("The authoritative plan changed the optimizer's selected native units")
    return {"plan": plan, "analysis": record,
            "selected_ids": plan["selected_ids"], "union_summary": plan["summary"]}


def _report_presentation(analysis, reference):
    """Render the retained decision without changing its original saved report."""
    body = _html(deepcopy(analysis))
    marker = b'<nav aria-label="Report files">'
    if body.count(marker) != 1:
        raise ValueError("The maintained decision report navigation differs")
    links = (marker + b'<a href="../index.html">Conservation portfolio and maps</a>'
             b'<a href="index.html">Original saved decision report</a>')
    body = body.replace(marker, links, 1)
    presentation = {
        "schema": "upstate.conservation-decision-presentation/v1",
        "analysis_id": analysis["id"], "study_id": analysis["input"]["study_id"],
        "implementation_sha256": file_digest(Path(__file__).resolve()),
        "original_report": deepcopy(reference["files"]["report"]),
        "report": {"path": "optimization/index-readable.html",
                   "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()},
        "original_entrypoint": "optimization/index.html",
        "entrypoint": "optimization/index-readable.html",
        "interpretation": "Current presentation of the same retained analysis; original decision, scientific quantities and original report remain unchanged.",
    }
    return body, presentation


def export(workspace, plan_id):
    """Export the original plan packet plus decision analysis and editable geography."""
    from . import conservation_decision_geography
    plan = conservation.get_plan(workspace, identifier(plan_id))
    reference = plan["selection"].get("optimization")
    if not isinstance(reference, dict) or reference.get("schema") != REFERENCE_SCHEMA:
        raise ValueError("Select a conservation plan saved from this retained decision analysis")
    result = get_analysis(workspace, plan["study_id"], reference["analysis_id"])
    if result["state"]["files"] != reference["files"]:
        raise ValueError("The analysis file identities differ from the saved plan")
    original = conservation.export_packet(workspace, plan["study_id"], plan["id"])
    path = verify_file(workspace.root, original)
    report_body, presentation = _report_presentation(result["analysis"], reference)
    selection = {
        "version": VERSION, "plan_id": plan["id"], "study_id": plan["study_id"],
        "analysis_id": reference["analysis_id"], "analysis_files": reference["files"],
        "original_packet": {key: original[key] for key in ("path", "bytes", "sha256")},
        "decision_geography": conservation_decision_geography.implementation(),
        "report_presentation": presentation,
    }
    key = digest(selection)
    directory = workspace.root / "conservation-exports" / key
    destination, state_path = directory / "conservation-decision.zip", directory / "export.json"
    with held(directory / ".optimization-export.lock", blocking=False):
        directory.mkdir(parents=True, exist_ok=True)
        if state_path.exists():
            saved = read_json(state_path)
            if saved["id"] != key or saved["selection"] != selection:
                raise ValueError("The retained decision export selection differs")
            verify_file(workspace.root, saved)
            return {**saved, "reused": True}
        study = conservation.inspect(workspace, plan["study_id"], include_candidates=False)
        geography_directory = directory / "decision-geography"
        geography = conservation_decision_geography.prepare(
            workspace, study, plan, result["analysis"], geography_directory)
        pending = directory / ".decision.pending.zip"
        pending.unlink(missing_ok=True)
        try:
            with zipfile.ZipFile(pending, "w", zipfile.ZIP_DEFLATED, compresslevel=5, allowZip64=True) as output:
                with zipfile.ZipFile(path, "r") as source:
                    for member in source.infolist():
                        with source.open(member, "r") as incoming, output.open(member, "w", force_zip64=True) as outgoing:
                            shutil.copyfileobj(incoming, outgoing, length=1024 * 1024)
                for name, item in reference["files"].items():
                    member = {"analysis": "analysis.json", "candidates": "candidates.csv", "report": "index.html",
                              "joint-cells.csv": "joint-cells.csv", "joint-portfolios.csv": "joint-portfolios.csv",
                              "joint-candidates.csv": "joint-candidates.csv"}[name]
                    output.write(verify_file(workspace.root, item), "optimization/" + member)
                output.writestr(presentation["entrypoint"], report_body)
                output.writestr("optimization/PRESENTATION.json", canonical(presentation) + b"\n")
                output.writestr("optimization/README.md", (
                    "# Conservation decision\n\n"
                    "Open [the readable decision report](index-readable.html). "
                    "It presents this saved analysis with the current report layout.\n\n"
                    "The [original report](index.html), [analysis JSON](analysis.json) "
                    "and [complete candidate table](candidates.csv) retain the saved decision. "
                    "The [portfolio and maps](../index.html) and "
                    "[editable decision geography](geography/README.md) are included.\n\n"
                    "Presentation identity and both report references are in PRESENTATION.json.\n"
                ).encode("utf-8"))
                for item in geography["files"]:
                    member_path = verify_file(geography_directory, item)
                    output.write(member_path, "optimization/geography/" + item["path"])
                    verify_file(geography_directory, item)
                output.writestr("optimization/REFERENCE.json", canonical({
                    "plan_id": plan["id"], "study_id": plan["study_id"],
                    "analysis": reference, "original_packet": original,
                    "report_presentation": presentation,
                    "decision_geography": {
                        "entrypoint": "geography/README.md", "directory": "geography/",
                        "identity": geography["identity"], "files": geography["files"],
                    },
                }) + b"\n")
            pending.replace(destination)
        finally:
            pending.unlink(missing_ok=True)
        saved = {
            **describe_file(workspace.root, destination),
            "schema": "upstate.conservation-decision-export/v1", "id": key,
            "kind": "conservation_decision_packet", "selection": selection,
            "plan_id": plan["id"], "study_id": plan["study_id"],
            "analysis_id": reference["analysis_id"], "created_at": now(),
            "entrypoint": "index.html", "decision_entrypoint": presentation["entrypoint"],
            "original_decision_entrypoint": presentation["original_entrypoint"],
            "report_presentation": presentation,
            "decision_geography": "optimization/geography/decision-geography.gpkg",
            "decision_geography_files": geography["files"],
        }
        atomic_json(state_path, saved, immutable=True)
        return saved


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    subparsers = parser.add_subparsers(dest="command", required=True)
    for name in ("preview", "save"):
        command = subparsers.add_parser(name)
        command.add_argument("selection", type=Path)
    reopen = subparsers.add_parser("inspect")
    reopen.add_argument("study_id")
    reopen.add_argument("analysis_id")
    packet = subparsers.add_parser("export")
    packet.add_argument("plan_id")
    arguments = parser.parse_args(argv)
    from .workspace import Workspace
    workspace = Workspace(arguments.workspace)
    if arguments.command == "preview":
        result = preview(workspace, read_json(arguments.selection))
    elif arguments.command == "save":
        result = save(workspace, read_json(arguments.selection))
    elif arguments.command == "inspect":
        result = get_analysis(workspace, arguments.study_id, arguments.analysis_id)
    else:
        result = export(workspace, arguments.plan_id)
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
