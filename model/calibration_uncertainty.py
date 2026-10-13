"""Published-source standard-error sensitivity for an existing calibration.

Uses original completed native predictions, immutable reference rows, and the
saved normalized group-MSE objective. No native model run, estimator, random
sampling, alternative selection, or validation ranking is performed here.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
import json
import math

from .common import digest, finite, identifier, verify_file

VERSION = 1
RESULT_KIND = "calibration-uncertainties"
NATIVE_UNITS = {"nitrogen": "kg/year", "phosphorus": "kg/year",
                "sediment": "metric_tonnes/year"}
TO_KG = {"kg/year": 1.0, "kg/yr": 1.0, "g/year": 0.001, "g/yr": 0.001,
         "metric_tonnes/year": 1000.0, "t/year": 1000.0, "t/yr": 1000.0}
RELATIVE_TOLERANCE = 1e-10

INTERPRETATION = (
    "The declared region changes each original annual-load estimate by at most "
    "the selected multiple of its published standard error, clipped to "
    "nonnegative loads. These are source-error sensitivity ranges, not "
    "confidence intervals or probabilities. A source record shared by units "
    "uses one common changed value, and every candidate sees the same changed "
    "observations. No independence among source estimates is assumed. Distinct "
    "record IDs define a simultaneous marginal box; unknown dependencies may "
    "make some box combinations unattainable. Strict preference throughout this "
    "box is conservative with respect to those dependencies; a possible reversal "
    "means a reversal within the declared box. Original normalization scales, "
    "temporal and spatial weights, delivered external loads, native predictions, "
    "and calibration/validation groups remain fixed. Validation is descriptive "
    "for the selected candidate only. This supplement preserves the original "
    "working profile and all original immutable report identities."
)


def _number(value, label, *, minimum=None, positive=False):
    try:
        return finite(value, label, minimum=minimum, positive=positive)
    except (TypeError, OverflowError) as error:
        raise ValueError(label + " must be a finite number") from error


def _sum(values, label):
    try:
        return _number(math.fsum(values), label)
    except (OverflowError, ValueError) as error:
        raise ValueError(label + " exceeds the finite numerical range") from error


def _tolerance(*values):
    return RELATIVE_TOLERANCE * max(1.0, *(abs(v) for v in values))


def _close(actual, expected, label):
    tolerance = _tolerance(actual, expected)
    if abs(actual - expected) > tolerance:
        raise ValueError(label + " differs from the original retained source")
    return tolerance


def _same(actual, expected, label):
    if digest(actual) != digest(expected):
        raise ValueError(label + " differs from the immutable original plan")


def _factor(source_unit, comparison_unit):
    if source_unit not in TO_KG or comparison_unit not in TO_KG:
        raise ValueError("Unrecognized annual mass-rate unit: " + str(source_unit))
    return TO_KG[source_unit] / TO_KG[comparison_unit]


def _retained(workspace, calibration_id):
    report = workspace._get("calibrations", identifier(calibration_id))
    if (report.get("version") != 1 or report.get("state") != "complete"
            or report.get("workspace_id") != workspace.project["id"]):
        raise ValueError("Select a completed calibration in this workspace")
    plan = workspace._get("calibration-plans", identifier(report["plan_id"]))
    if plan.get("version") != 1 or plan.get("workspace_id") != workspace.project["id"]:
        raise ValueError("The completed calibration needs its original version-1 plan")
    for report_key, plan_key in (
            ("reference_units", "units"), ("normalization", "normalization"),
            ("observations", "observations"), ("spatial_groups", "spatial_groups")):
        _same(report[report_key], plan[plan_key], report_key)
    _same(report["objective"], plan["selection"]["objective"], "Objective")
    observed = workspace._get("observations", plan["selection"]["observation_id"])
    _same({"id": observed["id"], "metadata": observed["metadata"],
           "original": observed["original"]}, plan["observations"], "Observation edition")
    original = observed["original"]
    verify_file(workspace.root, {"path": original["object"], "bytes": original["bytes"],
                                 "sha256": original["sha256"]})
    return report, plan, observed


def _source_row(row, units, multiplier):
    if not row.get("admitted"):
        raise ValueError("A reference unit contains an unadmitted observation")
    parameter = row["parameter"]
    if parameter not in NATIVE_UNITS or units != NATIVE_UNITS[parameter]:
        raise ValueError("Reference parameter and original native comparison units differ")
    value = _number(row["value"], "Original source load", minimum=0)
    factor = _factor(row["unit"], units)
    annual = _number(value * factor, "Converted original annual load", minimum=0)
    _close(annual, _number(row["annual_mass"], "Retained annual load", minimum=0),
           "Annual mass conversion")
    if row.get("comparison_units") != units:
        raise ValueError("Original observation comparison units differ")
    uncertainty = row.get("uncertainty")
    issues, se, original_se, source_se_unit = [], None, None, None
    if not isinstance(uncertainty, dict):
        issues.append("Original uncertainty is not a structured published standard error")
    elif uncertainty.get("kind") != "published standard error":
        issues.append("Original uncertainty kind is not a published standard error")
    else:
        original_se = uncertainty.get("value")
        source_se_unit = uncertainty.get("unit")
        if original_se is None:
            issues.append("The publisher did not supply a standard-error value")
        elif not uncertainty.get("original_field"):
            issues.append("Published standard error has no retained original source field")
        else:
            try:
                se = _number(original_se, "Published standard error", minimum=0)
                se = _number(se * _factor(source_se_unit, units),
                             "Converted standard error", minimum=0)
            except ValueError as error:
                issues.append(str(error))
                se = None
    lower = upper = None
    if multiplier == 0:
        lower = upper = annual
    elif se is not None:
        spread = _number(multiplier * se, "Standard-error sensitivity spread", minimum=0)
        lower = max(0.0, annual - spread)
        upper = _number(annual + spread, "Upper source sensitivity endpoint", minimum=0)
    return {
        "record_id": row["id"], "station_id": row.get("station_id"),
        "catchment_id": row["catchment_id"], "parameter": parameter,
        "unit": row["unit"], "original_value": row["value"],
        "period_start": row["period_start"], "period_end": row["period_end"],
        "source_standard_error": original_se, "source_standard_error_unit": source_se_unit,
        "comparison_units": units, "annual_mass": annual, "standard_error": se,
        "lower_reference": lower, "upper_reference": upper,
        "state": "published_standard_error" if se is not None else "missing_standard_error",
        "issues": issues, "method": row.get("method"),
        "source_records": row.get("source_records"), "uncertainty": uncertainty,
    }


def _references(plan, observed, multiplier):
    rows = {}
    for row in observed["rows"]:
        if row["id"] in rows:
            raise ValueError("Original observation edition repeats a record ID")
        rows[row["id"]] = row
    sources, references, links = {}, [], {}
    training = set(plan["selection"]["calibration_group_ids"])
    validation = set(plan["selection"]["validation_group_ids"])
    if not training or training & validation:
        raise ValueError("Saved calibration and validation groups are not disjoint")
    seen_units = set()
    for unit in plan["units"]:
        unit_id = unit["id"]
        if unit_id in seen_units:
            raise ValueError("The original plan repeats a calibration unit")
        seen_units.add(unit_id)
        partition = ("calibration" if unit["group_id"] in training else
                     "validation" if unit["group_id"] in validation else None)
        if partition is None or unit.get("partition") != partition:
            raise ValueError("The original unit partition differs from the saved group split")
        ids, periods = unit["observation_record_ids"], unit["periods"]
        if not ids or len(ids) != len(periods) or len(set(ids)) != len(ids):
            raise ValueError("A reference unit has inconsistent original source periods")
        denominator = _number(unit["aggregation_weight"], "Period aggregation weight", positive=True)
        weights = [_number(period["weight"], "Original temporal weight", positive=True)
                   for period in periods]
        _close(_sum(weights, "Temporal weight sum"), denominator, "Period aggregation weight")
        if (len(unit["reference_uncertainty"]) != len(ids)
                or len(unit["source_records"]) != len(ids)):
            raise ValueError("The saved source references do not match their period rows")
        unit_links = []
        for index, (record_id, period, weight) in enumerate(zip(ids, periods, weights)):
            if record_id not in rows:
                raise ValueError("A saved source record is absent from its original edition")
            row = rows[record_id]
            if (row["catchment_id"] != unit["catchment_id"] or row["parameter"] != unit["parameter"]
                    or row["period_start"] != period["start"] or row["period_end"] != period["end"]):
                raise ValueError("Original source identity/period differs from its saved unit")
            _same(row.get("uncertainty"), unit["reference_uncertainty"][index],
                  "Original uncertainty")
            _same(row.get("source_records"), unit["source_records"][index], "Original source row")
            if record_id not in sources:
                sources[record_id] = _source_row(row, unit["units"], multiplier)
            elif sources[record_id]["comparison_units"] != unit["units"]:
                raise ValueError("A shared source record has inconsistent comparison units")
            unit_links.append({"record_id": record_id, "weight": weight / denominator})
        y0 = _sum((sources[item["record_id"]]["annual_mass"] * item["weight"]
                   for item in unit_links), "Original temporal mean")
        original_y0 = _number(unit["observed_annual_mass"], "Saved annual reference", minimum=0)
        _close(y0, original_y0, "Original temporal mean")
        missing = [key for key in ids if sources[key]["standard_error"] is None]
        covered = not missing or multiplier == 0
        lower = (_sum((sources[item["record_id"]]["lower_reference"] * item["weight"]
                       for item in unit_links), "Lower temporal endpoint") if covered else None)
        upper = (_sum((sources[item["record_id"]]["upper_reference"] * item["weight"]
                       for item in unit_links), "Upper temporal endpoint") if covered else None)
        references.append({
            "unit_id": unit_id, "catchment_id": unit["catchment_id"], "group_id": unit["group_id"],
            "parameter": unit["parameter"], "partition": partition, "units": unit["units"],
            "station_ids": unit["station_ids"], "observed_annual_mass": original_y0,
            "lower_reference": lower, "upper_reference": upper,
            "state": "point_reference" if multiplier == 0 else
                     "covered" if not missing else "missing_standard_error",
            "source_record_ids": ids, "missing_record_ids": missing,
            "temporal_weights": unit_links, "aggregation_weight": denominator,
            "temporal_weighting": unit["temporal_weighting"], "periods": periods,
            "objective_weight": 0.0,
        })
        links[unit_id] = unit_links
    return sources, references, links


def _objective_weights(plan, references):
    objective = plan["selection"]["objective"]
    positive = {p: _number(item["weight"], "Original pollutant weight", positive=True)
                for p, item in objective.items()}
    total = _sum(positive.values(), "Pollutant weight sum")
    by_parameter = defaultdict(lambda: defaultdict(list))
    for row in references:
        if row["partition"] == "calibration":
            by_parameter[row["parameter"]][row["group_id"]].append(row)
    if set(by_parameter) != set(positive):
        raise ValueError("Original objective has incomplete training reference coverage")
    for parameter, groups in by_parameter.items():
        scale = _number(plan["normalization"][parameter]["value"],
                        "Retained normalization scale", positive=True)
        if objective[parameter]["units"] != NATIVE_UNITS.get(parameter):
            raise ValueError("Original objective has inconsistent native units")
        for members in groups.values():
            # Divide in sequence to avoid an unnecessary scale-squared overflow.
            coefficient = positive[parameter] / total / len(groups) / len(members) / scale / scale
            coefficient = _number(coefficient, "Squared-error objective coefficient", positive=True)
            for row in members:
                row["objective_weight"] = coefficient
    return [row for row in references if row["partition"] == "calibration"]


def _predictions(report, references):
    ranked = report["ranked_candidates"]
    if (not ranked or ranked[0]["run_id"] != report["selected_run_id"]
            or ranked[0]["profile_id"] != report["selected_profile_id"]):
        raise ValueError("The retained selected candidate differs from its original ranking")
    by_run = {}
    for candidate in ranked:
        if candidate["run_id"] in by_run or candidate.get("state") != "complete":
            raise ValueError("The original ranking contains duplicate or incomplete candidates")
        by_run[candidate["run_id"]] = {}
    units = {row["unit_id"]: row for row in references}
    for row in report["prediction_rows"]:
        if row["run_id"] not in by_run:
            continue
        if row["unit_id"] not in units:
            raise ValueError("A ranked candidate prediction refers to an unknown original unit")
        reference = units[row["unit_id"]]
        if (row["parameter"] != reference["parameter"] or row["units"] != reference["units"]
                or row["partition"] != reference["partition"]
                or row["catchment_id"] != reference["catchment_id"]
                or row["group_id"] != reference["group_id"]):
            raise ValueError("A native prediction differs from its original reference identity")
        _close(_number(row["observed_annual_mass"], "Prediction reference", minimum=0),
               reference["observed_annual_mass"], "Prediction reference")
        if row["unit_id"] in by_run[row["run_id"]]:
            raise ValueError("The report repeats a candidate/unit prediction")
        by_run[row["run_id"]][row["unit_id"]] = row
    scores = []
    training = [row for row in references if row["partition"] == "calibration"]
    for candidate in ranked:
        predictions = by_run[candidate["run_id"]]
        terms = []
        for reference in training:
            prediction = predictions.get(reference["unit_id"])
            if not prediction or not prediction.get("included"):
                raise ValueError("A ranked candidate lacks complete original calibration support")
            predicted = _number(prediction["predicted_annual_mass"], "Native compared annual load", minimum=0)
            residual = predicted - reference["observed_annual_mass"]
            terms.append(_number(reference["objective_weight"] * residual * residual,
                                 "Original normalized squared-error contribution", minimum=0))
        reproduced = _sum(terms, "Reproduced original objective")
        original = _number(candidate["objective_score"], "Retained objective score", minimum=0)
        tolerance = _close(reproduced, original, "Reproduced calibration objective")
        scores.append({
            "run_id": candidate["run_id"], "profile_id": candidate["profile_id"],
            "title": candidate.get("title"), "rank": candidate["rank"],
            "selected_models": candidate.get("selected_models"),
            "original_objective_score": original, "reproduced_objective_score": reproduced,
            "absolute_difference": abs(reproduced - original),
            "numerical_tolerance": tolerance, "state": "reproduced",
        })
    return by_run, scores


def _first_tie(nominal, coefficients, sources):
    """First zero of monotone lower gap; every source uses the same multiplier."""
    missing = [key for key, value in coefficients.items()
               if value != 0 and sources[key]["standard_error"] is None]
    if nominal <= 0:
        return 0.0, "nominal_tie"
    if missing:
        return None, "incomplete_uncertainty"
    # Positive coefficients lower their source load and eventually saturate at
    # zero. Negative coefficients increase it without a nonnegative-load cap.
    rates, events = {}, defaultdict(list)
    for key, coefficient in coefficients.items():
        se = sources[key]["standard_error"]
        if coefficient == 0 or not se:
            continue
        rate = _number(abs(coefficient) * se, "First-tie sensitivity slope", minimum=0)
        if coefficient > 0:
            breakpoint = sources[key]["annual_mass"] / se
            if math.isfinite(breakpoint):
                events[breakpoint].append(key)
            # A source already at zero contributes no initial lower-bound slope.
            if breakpoint == 0:
                continue
        rates[key] = rate
    previous, remaining = 0.0, nominal
    for breakpoint in sorted(events):
        if breakpoint == 0:
            continue
        slope = _sum(rates.values(), "First-tie sensitivity rate")
        width = breakpoint - previous
        if slope > 0 and remaining / slope <= width:
            result = previous + remaining / slope
            return (result, "available") if math.isfinite(result) else (None, "beyond_finite_multiplier")
        decrease = slope * width
        remaining = max(0.0, remaining - decrease)
        for key in events[breakpoint]:
            rates.pop(key, None)
        previous = breakpoint
    slope = _sum(rates.values(), "Remaining first-tie sensitivity rate")
    if slope > 0:
        result = previous + remaining / slope
        return (result, "available") if math.isfinite(result) else (None, "beyond_finite_multiplier")
    if remaining == 0:
        return previous, "available"
    return None, "never_within_nonnegative_source_box"


def _pair(candidate, selected, predictions, training, links, sources, scores, multiplier):
    a, b = predictions[selected["run_id"]], predictions[candidate["run_id"]]
    nominal_terms, coefficients = [], defaultdict(list)
    equal_predictions = True
    for reference in training:
        key = reference["unit_id"]
        y0, weight = reference["observed_annual_mass"], reference["objective_weight"]
        av = _number(a[key]["predicted_annual_mass"], "Selected native load", minimum=0)
        bv = _number(b[key]["predicted_annual_mass"], "Challenger native load", minimum=0)
        delta = bv - av
        equal_predictions = equal_predictions and delta == 0
        nominal_terms.append(_number(weight * delta * ((bv - y0) + (av - y0)),
                                     "Centered pairwise objective gap"))
        coefficient = _number(-2 * weight * delta, "Observation gap coefficient")
        for link in links[key]:
            coefficients[link["record_id"]].append(
                _number(coefficient * link["weight"], "Source-record gap coefficient"))
    nominal = _sum(nominal_terms, "Nominal challenger-minus-selected gap")
    combined = {key: _sum(values, "Shared source coefficient")
                for key, values in sorted(coefficients.items())}
    original_gap = scores[candidate["run_id"]]["original_objective_score"] - scores[selected["run_id"]]["original_objective_score"]
    tolerance = _tolerance(original_gap, nominal,
                           scores[candidate["run_id"]]["original_objective_score"],
                           scores[selected["run_id"]]["original_objective_score"])
    if abs(nominal - original_gap) > tolerance:
        raise ValueError("Centered pairwise gap does not reproduce the saved objective difference")
    if nominal < -tolerance:
        raise ValueError("The retained selected candidate does not minimize its original objective")
    missing = [key for key, coefficient in combined.items()
               if coefficient != 0 and sources[key]["standard_error"] is None]
    lower_changes, upper_changes, attribution = [], [], []
    for key, coefficient in combined.items():
        source = sources[key]
        lower, upper = source["lower_reference"], source["upper_reference"]
        low_change = high_change = None
        min_endpoint = max_endpoint = "unchanged"
        if coefficient == 0:
            low_change = high_change = 0.0
        elif lower is not None and upper is not None:
            min_value, max_value = (lower, upper) if coefficient > 0 else (upper, lower)
            min_endpoint, max_endpoint = ("lower", "upper") if coefficient > 0 else ("upper", "lower")
            low_change = _number(coefficient * (min_value - source["annual_mass"]), "Minimum gap change")
            high_change = _number(coefficient * (max_value - source["annual_mass"]), "Maximum gap change")
        if low_change is not None:
            lower_changes.append(low_change)
            upper_changes.append(high_change)
        attribution.append({
            "record_id": key, "station_id": source["station_id"],
            "parameter": source["parameter"], "comparison_units": source["comparison_units"],
            "gap_coefficient": coefficient, "standard_error": source["standard_error"],
            "minimum_gap_change": low_change, "maximum_gap_change": high_change,
            "minimum_endpoint": min_endpoint, "maximum_endpoint": max_endpoint,
        })
    complete = not missing or multiplier == 0
    minimum = _sum([nominal, *lower_changes], "Minimum pairwise gap") if complete else None
    maximum = _sum([nominal, *upper_changes], "Maximum pairwise gap") if complete else None
    if not complete:
        state = "incomplete_uncertainty"
    elif equal_predictions:
        state = "equivalent_predictions"
    elif minimum > tolerance:
        state = "selected_strictly_preferred"
    elif minimum < -tolerance:
        state = "rank_reversal_possible"
    elif multiplier == 0 and abs(nominal) <= tolerance:
        state = "nominal_tie"
    else:
        state = "tie_possible"
    first_tie, first_tie_state = _first_tie(nominal, combined, sources)
    return {
        "run_id": candidate["run_id"], "profile_id": candidate["profile_id"],
        "title": candidate.get("title"), "rank": candidate["rank"],
        "selected_models": candidate.get("selected_models"),
        "same_profile_as_selected": candidate["profile_id"] == selected["profile_id"],
        "nominal_gap": nominal, "original_score_gap": original_gap,
        "minimum_gap": minimum, "maximum_gap": maximum, "numerical_tolerance": tolerance,
        "state": state, "missing_record_ids": missing,
        "uncertainty_record_count": sum(value != 0 for value in combined.values()),
        "minimum_change_record_ids": [row["record_id"] for row in attribution
                                      if row["minimum_gap_change"] is not None and row["minimum_gap_change"] != 0],
        "maximum_change_record_ids": [row["record_id"] for row in attribution
                                      if row["maximum_gap_change"] is not None and row["maximum_gap_change"] != 0],
        "first_tie_standard_errors": first_tie, "first_tie_state": first_tie_state,
        "source_attribution": attribution,
    }


def _selected_validation(selected_predictions, references):
    result = []
    for reference in references:
        if reference["partition"] != "validation":
            continue
        row = selected_predictions.get(reference["unit_id"])
        item = {"unit_id": reference["unit_id"], "catchment_id": reference["catchment_id"],
                "group_id": reference["group_id"], "parameter": reference["parameter"],
                "units": reference["units"], "observed_annual_mass": reference["observed_annual_mass"],
                "lower_reference": reference["lower_reference"], "upper_reference": reference["upper_reference"],
                "missing_record_ids": reference["missing_record_ids"],
                "predicted_annual_mass": None, "minimum_residual": None, "maximum_residual": None,
                "state": "incomplete_native_support"}
        if row and row.get("included"):
            predicted = _number(row["predicted_annual_mass"], "Selected validation prediction", minimum=0)
            item.update(predicted_annual_mass=predicted, state=reference["state"])
            if reference["lower_reference"] is not None:
                item.update(minimum_residual=predicted - reference["upper_reference"],
                            maximum_residual=predicted - reference["lower_reference"])
        result.append(item)
    return result



def _source_stamp(report, plan, observed):
    return {
        "calibration_id": report["id"], "plan_id": plan["id"], "observation_id": observed["id"],
        "observation_original": observed["original"], "observation_metadata": observed["metadata"],
        "reference_units_sha256": digest(plan["units"]),
        "prediction_rows_sha256": digest(report["prediction_rows"]),
        "objective_sha256": digest(report["objective"]),
        "normalization_sha256": digest(report["normalization"]),
        "comparison_ids": report["comparison_ids"],
        "source_vintages": report.get("source_vintages"),
    }


def analyze(workspace, calibration_id, *, standard_errors=1.0):
    """Save exact source-SE sensitivity of an original completed calibration."""
    multiplier = _number(standard_errors, "Published standard-error multiplier", minimum=0)
    report, plan, observed = _retained(workspace, calibration_id)
    sources, references, links = _references(plan, observed, multiplier)
    training = _objective_weights(plan, references)
    predictions, candidate_scores = _predictions(report, references)
    ranked = report["ranked_candidates"]
    selected = ranked[0]
    scores = {row["run_id"]: row for row in candidate_scores}
    pairwise = [_pair(candidate, selected, predictions, training, links, sources, scores, multiplier)
                for candidate in ranked[1:]]
    robust = [row["run_id"] for row in pairwise if row["state"] == "selected_strictly_preferred"]
    reversals = [row["run_id"] for row in pairwise if row["state"] == "rank_reversal_possible"]
    incomplete = [row["run_id"] for row in pairwise if row["state"] == "incomplete_uncertainty"]
    if not pairwise:
        sensitivity = "single_candidate"
    elif reversals:
        sensitivity = "rank_reversal_possible"
    elif incomplete:
        sensitivity = "incomplete_uncertainty"
    elif len(robust) == len(pairwise):
        sensitivity = "strictly_stable"
    else:
        sensitivity = "tie_possible"
    missing = sorted(key for key, row in sources.items() if row["standard_error"] is None)
    validation = [row for row in references if row["partition"] == "validation"]
    coverage = {
        "source_record_count": len(sources),
        "records_with_standard_error": len(sources) - len(missing),
        "missing_record_ids": missing,
        "calibration_units": len(training),
        "covered_calibration_units": sum(not row["missing_record_ids"] for row in training),
        "validation_units": len(validation),
        "covered_validation_units": sum(not row["missing_record_ids"] for row in validation),
        "calibration_record_ids": sorted({key for row in training for key in row["source_record_ids"]}),
        "validation_record_ids": sorted({key for row in validation for key in row["source_record_ids"]}),
        "coefficient_cancellation": "Missing source errors affect a pair only when its summed source coefficient is nonzero.",
    }
    return workspace._save(RESULT_KIND, {
        "version": VERSION, "calibration_id": report["id"], "plan_id": plan["id"],
        "workspace_id": workspace.project["id"], "title": report.get("title"),
        "state": "partial_uncertainty" if missing else "complete", "standard_errors": multiplier,
        "selected_run_id": selected["run_id"], "selected_profile_id": selected["profile_id"],
        "original_objective_score": selected["objective_score"],
        "selected_models": report.get("selected_models"),
        "available_parameters": report.get("predicted_parameters", sorted(report["objective"])),
        "objective": report["objective"], "normalization": report["normalization"],
        "temporal_method": report["temporal_method"],
        "source_stamp": _source_stamp(report, plan, observed),
        "coverage": coverage,
        "nominal_reproduction": {
            "state": "reproduced", "candidate_count": len(candidate_scores),
            "relative_tolerance": RELATIVE_TOLERANCE,
            "maximum_absolute_difference": max(row["absolute_difference"] for row in candidate_scores),
            "method": "Fixed saved pollutant weights, equal spatial-group means, and within-group unit means of normalized squared residuals.",
        },
        "selection_sensitivity": {
            "state": sensitivity, "compared_candidate_count": len(pairwise),
            "distinct_profile_count": len({row["profile_id"] for row in ranked}),
            "robust_against_run_ids": robust, "possible_reversal_run_ids": reversals,
            "incomplete_run_ids": incomplete,
            "comparison_scope": report.get("candidate_comparison"),
            "gap_direction": "Challenger objective minus originally selected objective; positive favors the original selection.",
        },
        "pairwise": pairwise, "reference_units": references,
        "source_records": [sources[key] for key in sorted(sources)],
        "candidate_scores": candidate_scores,
        "selected_validation": _selected_validation(predictions[selected["run_id"]], references),
        "interpretation": INTERPRETATION,
        "references": {
            "original_calibration": report.get("references", {}),
            "source_estimator": observed["metadata"].get("source_uri"),
            "derivation": "model/CALIBRATION_UNCERTAINTY.md",
        },
    })


def inspect(workspace, analysis_id):
    """Read an immutable supplement without changing its original calibration."""
    result = workspace._get(RESULT_KIND, identifier(analysis_id))
    if result.get("version") != VERSION or result.get("workspace_id") != workspace.project["id"]:
        raise ValueError("Select a supported source-uncertainty analysis in this workspace")
    report, plan, observed = _retained(workspace, result["calibration_id"])
    _same(result["source_stamp"], _source_stamp(report, plan, observed),
          "Source-uncertainty dependency stamp")
    for key in ("plan_id", "selected_run_id", "selected_profile_id"):
        if result[key] != report[key]:
            raise ValueError("The supplement differs from its original calibration selection")
    _same(result["objective"], report["objective"], "Retained uncertainty objective")
    _same(result["normalization"], report["normalization"], "Retained uncertainty scales")
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workspace")
    commands = parser.add_subparsers(dest="action", required=True)
    run = commands.add_parser("analyze")
    run.add_argument("calibration_id")
    run.add_argument("--standard-errors", type=float, default=1.0)
    show = commands.add_parser("inspect")
    show.add_argument("analysis_id")
    args = parser.parse_args(argv)
    from .workspace import Workspace
    workspace = Workspace(args.workspace)
    result = (analyze(workspace, args.calibration_id, standard_errors=args.standard_errors)
              if args.action == "analyze" else inspect(workspace, args.analysis_id))
    print(json.dumps(result, indent=2, sort_keys=True, allow_nan=False))


if __name__ == "__main__":
    main()
