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
import html
import io
import json
import math
from pathlib import Path
import shutil
import zipfile

from . import conservation
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
    runs = study["selection"]["bindings"]["runs"]
    baseline = study["selection"]["spec"]["baseline_run_id"]
    result = set(runs[baseline]["outputs"])
    if kind != "current-export":
        if alternative not in study["selection"]["spec"]["alternative_run_ids"]:
            raise ValueError("Select an original alternative already retained by this conservation study")
        result &= set(runs[alternative]["outputs"])
    return tuple(axis for axis in PHYSICAL_AXES if axis in result)


def _request(value, study, engine):
    if not isinstance(value, dict):
        raise ValueError("Supply a conservation optimization selection")
    if identifier(value.get("study_id")) != study["id"]:
        raise ValueError("The selected conservation study differs")
    source_spec = study["selection"]["spec"]
    original = value.get("objective") or {}
    if not isinstance(original, dict):
        raise ValueError("Objective must identify its kind and quantity basis")
    default_kind = {
        "context": "source-context", "current_export": "current-export",
        "scenario_reduction": "restoration", "disturbance_increase": "avoided-conversion",
        "published_method": "published-method",
    }.get(source_spec["score"]["basis"])
    kind = original.get("kind", default_kind)
    if kind not in ("source-context", "current-export", "restoration", "avoided-conversion", "published-method"):
        raise ValueError("Choose source-context, current-export, restoration, avoided-conversion or published-method")
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
    available = _available(study, kind, alternative)
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
        "objective": {"kind": kind, "basis": basis, "scenario_run_id": alternative},
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
        if kind == "current-export":
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
        }
    return values, supports, units


def _rows(study, request, engine):
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
            "source_eligible": not reasons, "original_candidate": deepcopy(candidate),
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
    rows, normalization = _rows(study, request, engine)
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
                "source-context": "Declared geographic context preference",
                "published-method": "Complete published practice priority points for the independent original parcel units, with the explicitly selected portfolio quantity basis",
                "current-export": "Baseline modeled export within each original planning-unit reporting footprint",
                "restoration": "Baseline minus selected alternative on common native support within each original reporting footprint",
                "avoided-conversion": "Selected disturbance alternative minus baseline on common native support within each original reporting footprint",
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
    fields += ["original_candidate"]
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=fields)
    writer.writeheader()
    for row in analysis["candidates"]:
        record = {name: row[name] for name in fields if name in row}
        for key in ("source_identity", "exclusions", "preference_stability", "original_candidate"):
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
    esc = lambda value: html.escape(str(value), quote=True)
    quantity = lambda value: "Unavailable" if value is None else esc(format(value, ".10g")) if isinstance(value, (int, float)) else esc(value)
    head = """<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Conservation decision analysis</title>
<style>body{font:15px system-ui,sans-serif;margin:2rem;color:#202124;background:#fff;max-width:100%}h1,h2{font-weight:600}p{max-width:90ch;line-height:1.5}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}th,td{border:1px solid #ccc;padding:.5rem;text-align:left;vertical-align:top}th{background:#f4f4f4}code,pre{font-family:ui-monospace,monospace;overflow-wrap:anywhere}pre{white-space:pre-wrap}details{margin:.5rem 0}.scroll{overflow:auto}a{color:inherit}caption{text-align:left;font-weight:600;margin:1rem 0}</style>
<body>"""
    parts = [head, "<h1>" + esc(analysis["request"]["title"]) + "</h1>",
             "<p>" + esc(analysis["request"]["purpose"]) + "</p>",
             "<p>Original study: <code>" + esc(analysis["input"]["study_id"]) + "</code>. "
             + esc(analysis["input"]["planning_unit_label"]) + ". "
             + esc(analysis["methods"]["objective_scope"]) + ".</p>",
             "<p><a href=\"analysis.json\">Complete editable decision data</a> · "
             "<a href=\"candidates.csv\">Complete candidate table</a></p>",
             "<h2>Selected land and constraints</h2><pre>"
             + esc(json.dumps(analysis["selection"], ensure_ascii=False, indent=2)) + "</pre>",
             "<h2>Objective and solver</h2><pre>"
             + esc(json.dumps({"request": analysis["request"], "normalization": analysis["normalization"],
                              "solver": analysis["optimization"]}, ensure_ascii=False, indent=2)) + "</pre>",
             "<h2>Original candidates</h2><div class=\"scroll\"><table>"
             "<thead><tr><th>Rank</th><th>Original unit</th><th>Selection</th><th>Score</th>"
             "<th>Full hectares</th><th>Reporting hectares</th><th>Supplied full-unit cost</th>"
             "<th>Objective quantities and support</th></tr></thead><tbody>"]
    for row in analysis["candidates"]:
        items = []
        for axis in analysis["request"]["axes"]:
            support = row["axis_support"][axis]
            items.append("<div><strong>" + esc(axis) + "</strong>: "
                         + quantity(row["objective_values"][axis]) + " " + esc(row["objective_units"][axis])
                         + "; " + esc(support["availability"])
                         + ("" if support["coverage_fraction"] is None else "; coverage " + quantity(support["coverage_fraction"]))
                         + ("" if support["availability_reason"] is None else "; " + esc(support["availability_reason"]))
                         + ("; native parameter profile changed" if support.get("profile_changed") else "") + "</div>")
        if row["exclusions"]:
            items.append("<div>" + esc("; ".join(row["exclusions"])) + "</div>")
        parts.append("<tr><td>" + quantity(row["rank"]) + "</td><td><code>" + esc(row["feature_id"])
                     + "</code><br>" + esc(row["label"]) + "</td><td>"
                     + ("Selected" if row["selected"] else "Eligible" if row["eligible"] else "Excluded")
                     + "</td><td>" + quantity(row["score"]) + "</td><td>"
                     + quantity(row["whole_unit_area_ha"]) + "</td><td>" + quantity(row["reporting_area_ha"])
                     + "</td><td>" + quantity(row["supplied_cost"]) + " "
                     + esc(row["currency"] or "") + "</td><td>" + "".join(items) + "</td></tr>")
    parts += ["</tbody></table></div><h2>Preference stability</h2><pre>",
              esc(json.dumps(analysis["stability"], ensure_ascii=False, indent=2)),
              "</pre><h2>Source and interpretation</h2>"]
    for key, value in analysis["methods"].items():
        parts.append("<p><strong>" + esc(key.replace("_", " ")) + ".</strong> " + esc(value) + "</p>")
    parts += ["<details><summary>Original source and native case bindings</summary><pre>",
              esc(json.dumps(analysis["input"], ensure_ascii=False, indent=2)), "</pre></details></body></html>"]
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
        state = {
            "schema": REFERENCE_SCHEMA, "id": analysis["id"], "study_id": analysis["input"]["study_id"],
            "state": "complete", "created_at": now(),
            "files": {name: describe_file(workspace.root, directory / filename) for name, filename in (
                ("analysis", "analysis.json"), ("candidates", "candidates.csv"), ("report", "index.html"))},
        }
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
            or original_input.get("geometry_inventory") != study["files"]["geometries"]):
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


def export(workspace, plan_id):
    """Export the original plan packet plus every complete decision-analysis file."""
    plan = conservation.get_plan(workspace, identifier(plan_id))
    reference = plan["selection"].get("optimization")
    if not isinstance(reference, dict) or reference.get("schema") != REFERENCE_SCHEMA:
        raise ValueError("Select a conservation plan saved from this retained decision analysis")
    result = get_analysis(workspace, plan["study_id"], reference["analysis_id"])
    if result["state"]["files"] != reference["files"]:
        raise ValueError("The analysis file identities differ from the saved plan")
    original = conservation.export_packet(workspace, plan["study_id"], plan["id"])
    path = verify_file(workspace.root, original)
    selection = {
        "version": VERSION, "plan_id": plan["id"], "study_id": plan["study_id"],
        "analysis_id": reference["analysis_id"], "analysis_files": reference["files"],
        "original_packet": {key: original[key] for key in ("path", "bytes", "sha256")},
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
        pending = directory / ".decision.pending.zip"
        pending.unlink(missing_ok=True)
        try:
            with zipfile.ZipFile(pending, "w", zipfile.ZIP_DEFLATED, compresslevel=5, allowZip64=True) as output:
                with zipfile.ZipFile(path, "r") as source:
                    for member in source.infolist():
                        with source.open(member, "r") as incoming, output.open(member, "w", force_zip64=True) as outgoing:
                            shutil.copyfileobj(incoming, outgoing, length=1024 * 1024)
                for name, item in reference["files"].items():
                    member = {"analysis": "analysis.json", "candidates": "candidates.csv", "report": "index.html"}[name]
                    output.write(verify_file(workspace.root, item), "optimization/" + member)
                output.writestr("optimization/REFERENCE.json", canonical({
                    "plan_id": plan["id"], "study_id": plan["study_id"],
                    "analysis": reference, "original_packet": original,
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
            "entrypoint": "index.html", "decision_entrypoint": "optimization/index.html",
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
