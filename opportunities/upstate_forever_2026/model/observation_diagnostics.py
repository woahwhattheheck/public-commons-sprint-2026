"""Descriptive cohorts for retained annual catchment-load comparisons.

This reader preserves original comparison rows and their native eligibility.
It does not estimate loads, fit parameters, resolve overlapping catchments or
treat repeated periods as independent spatial replication.
"""
from __future__ import annotations

from collections import Counter
import json
import math

from . import observation_support

VERSION = "upstate.observation-diagnostics/v2-reference-basis"
BASIS = (
    "Residuals are modeled minus observed annual mass. The original pooled scores "
    "give each retained comparison row equal weight. The complementary catchment "
    "summary first averages residuals, absolute residuals and squared residuals "
    "within each original catchment, then gives each catchment equal weight. "
    "Its RMSE is the square root of the mean of those catchment mean squared errors, "
    "not the RMSE of catchment mean residuals. Neither weighting estimates independent "
    "replication: original catchments can overlap and repeated periods can overlap."
)
COHORT_BASIS = (
    "Cohorts retain exact parameter, source species, original constituent basis, mass unit and source method. "
    "Period rows additionally retain the exact original start/end pair. No periods "
    "are annualized, merged or duration-weighted here. Model period and source "
    "vintages remain descriptive source context, without inferred temporal alignment."
)


def _finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _key(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def _text(value):
    if value is None or value == "":
        return "Not specified"
    if isinstance(value, dict):
        return "; ".join(str(key) + ": " + _text(child) for key, child in value.items())
    if isinstance(value, (list, tuple)):
        return "; ".join(_text(child) for child in value) or "None"
    return str(value)


def _number(value):
    return format(value, ",.6g") if _finite(value) else "Unavailable"


def _mean(values):
    return math.fsum(value / len(values) for value in values)


def _scores(rows):
    residuals = [row["residual"] for row in rows]
    return {"rows": len(rows),
            "mean_bias": _mean(residuals),
            "mean_absolute_error": _mean([abs(value) for value in residuals]),
            "rmse": math.hypot(*(value / math.sqrt(len(rows)) for value in residuals)),
            "observed_mean": _mean([row["observed"] for row in rows]),
            "observed_min": min(row["observed"] for row in rows),
            "observed_max": max(row["observed"] for row in rows),
            "modeled_min": min(row["modeled"] for row in rows),
            "modeled_max": max(row["modeled"] for row in rows)}


def _table(columns, rows, caption):
    return {"kind": "table", "columns": columns, "rows": rows, "caption": caption}


def build(comparison):
    """Build source-indexed descriptive diagnostics from one immutable comparison."""
    groups, omitted = {}, []
    for index, row in enumerate(comparison.get("comparisons", [])):
        member = {"comparison_row_index": index, "observation_id": row.get("observation_id")}
        reason = None
        if row.get("included_in_metrics") is not True:
            reason = "Original comparison does not admit complete catchment support"
        elif not row.get("catchment_id") or not row.get("parameter") or not row.get("units"):
            reason = "Original catchment, parameter or mass unit is absent"
        elif row.get("measurement_support") not in (None, "", "catchment_export"):
            reason = "Original measurement support is not a receiving-water catchment export"
        elif not all(_finite(row.get(key)) for key in ("observed_annual_mass", "modeled_annual_mass")):
            reason = "Original annual masses are missing or nonfinite"
        elif row["observed_annual_mass"] < 0 or row["modeled_annual_mass"] < 0:
            reason = "Original annual masses are negative"
        if reason is not None:
            omitted.append({**member, "reason": reason})
            continue
        residual = row["modeled_annual_mass"] - row["observed_annual_mass"]
        if not _finite(residual):
            omitted.append({**member, "reason": "Annual mass difference is nonfinite"})
            continue
        identity = {key: row.get(key) for key in ("parameter", "species", "units", "method")}
        basis = observation_support.reference_basis(row, comparison.get("observation_method"))
        identity["reference_basis"] = {
            key: basis[key] for key in ("label", "parameter_codes", "status", "interpretation", "method_references")}
        key = _key(identity)
        if key not in groups:
            groups[key] = {"identity": identity, "rows": []}
        groups[key]["rows"].append({
            **member, "catchment_id": str(row["catchment_id"]), "station_id": row.get("station_id"),
            "period_start": row.get("period_start"), "period_end": row.get("period_end"),
            "period_days": row.get("period_days"), "observed": row["observed_annual_mass"],
            "modeled": row["modeled_annual_mass"], "residual": residual,
            "stored_residual": row.get("residual"), "reference_basis": basis,
        })
    cohorts = []
    for cohort_number, group in enumerate(groups.values(), 1):
        rows = group["rows"]
        catchments, periods = {}, {}
        for row in rows:
            catchments.setdefault(row["catchment_id"], []).append(row)
            periods.setdefault((row["period_start"], row["period_end"]), []).append(row)
        by_catchment = []
        for catchment_id, members in catchments.items():
            by_catchment.append({
                "catchment_id": catchment_id,
                "station_ids": list(dict.fromkeys(row["station_id"] for row in members)),
                "periods": [list(period) for period in dict.fromkeys(
                    (row["period_start"], row["period_end"]) for row in members)],
                "members": members, **_scores(members),
                "model_prediction_varies": len({row["modeled"] for row in members}) > 1,
            })
        count = len(by_catchment)
        balanced = {
            "catchments": count,
            "mean_bias": _mean([item["mean_bias"] for item in by_catchment]),
            "mean_absolute_error": _mean([item["mean_absolute_error"] for item in by_catchment]),
            "rmse": math.hypot(*(item["rmse"] / math.sqrt(count) for item in by_catchment)),
        }
        by_period = []
        for (start, end), members in periods.items():
            by_period.append({
                "period_start": start, "period_end": end,
                "catchments": len({row["catchment_id"] for row in members}),
                "members": members, **_scores(members),
            })
        identifiers = Counter(str(row["observation_id"]) for row in rows)
        cohorts.append({
            "cohort_number": cohort_number, **group["identity"], "members": rows,
            "row_weighted": _scores(rows), "catchment_weighted": balanced,
            "catchment_summaries": by_catchment, "period_summaries": by_period,
            "repeated_observation_ids": {key: value for key, value in identifiers.items() if value > 1},
        })
    review = {
        "version": VERSION,
        "source": {"run_id": comparison.get("run_id"), "observation_id": comparison.get("observation_id"),
                   "comparison_version": comparison.get("comparison_version"),
                   "catchment_source": comparison.get("catchment_source")},
        "model_period": comparison.get("model_period"),
        "model_source_vintages": comparison.get("model_source_vintages"),
        "basis": BASIS, "cohort_basis": COHORT_BASIS,
        "source_comparison_rows": len(comparison.get("comparisons", [])),
        "reviewed_rows": sum(len(cohort["members"]) for cohort in cohorts),
        "omitted_rows": omitted, "source_exclusion_count": len(comparison.get("exclusions", [])),
        "cohorts": cohorts,
    }
    review["blocks"] = report_blocks(review)
    return review


def report_blocks(review):
    """Typed blocks consumed unchanged by PDF, HTML, Markdown and operator views."""
    blocks = ["Annual-load comparison cohorts. " + BASIS, COHORT_BASIS,
              "Retained model period: " + _text(review.get("model_period")) + ".",
              "Reviewed complete comparison rows: " + str(review["reviewed_rows"]) + " of "
              + str(review["source_comparison_rows"]) + "; original pre-comparison exclusions: "
              + str(review["source_exclusion_count"]) + "."]
    for cohort in review["cohorts"]:
        unit = _text(cohort["units"])
        blocks.append("Cohort " + str(cohort["cohort_number"]) + ": " + _text(cohort["parameter"])
                      + "; species: " + _text(cohort["species"]) + "; mass unit: " + unit
                      + "; source method: " + _text(cohort["method"]) + ".")
        basis = cohort["reference_basis"]
        blocks.append("Original reference basis: " + basis["label"] + ". " + basis["interpretation"])
        if basis["method_references"]:
            blocks.append("Source-method reference: " + "; ".join(basis["method_references"]) + ".")
        row, catchment = cohort["row_weighted"], cohort["catchment_weighted"]
        blocks.append(_table(
            ["Weighting", "Comparison rows", "Catchments", "Mean bias", "Mean absolute error", "RMSE"],
            [["Each original row", row["rows"], catchment["catchments"],
              _number(row["mean_bias"]), _number(row["mean_absolute_error"]), _number(row["rmse"])],
             ["Each original catchment", row["rows"], catchment["catchments"],
              _number(catchment["mean_bias"]), _number(catchment["mean_absolute_error"]),
              _number(catchment["rmse"])]],
            "Errors use " + unit + ". Both rows describe exactly the same retained cohort; "
            "different weights answer different descriptive questions. No catchment independence is assumed."))
        blocks.append(_table(
            ["Original period", "Rows", "Catchments", "Observed mean", "Mean bias", "RMSE"],
            [[_text(item["period_start"]) + " to " + _text(item["period_end"]),
              item["rows"], item["catchments"], _number(item["observed_mean"]),
              _number(item["mean_bias"]), _number(item["rmse"])]
             for item in cohort["period_summaries"]],
            "Exact original period cohorts in " + unit + ". Different period rows can contain "
            "different catchments or methods and are not a temporal trend estimate."))
        blocks.append(_table(
            ["Catchment / stations", "Rows / periods", "Observed mean [range]",
             "Modeled range", "Mean bias", "RMSE"],
            [[item["catchment_id"] + "\n" + _text(item["station_ids"]),
              str(item["rows"]) + " / " + str(len(item["periods"])),
              _number(item["observed_mean"]) + " [" + _number(item["observed_min"])
              + ", " + _number(item["observed_max"]) + "]",
              _number(item["modeled_min"]) + " to " + _number(item["modeled_max"]),
              _number(item["mean_bias"]), _number(item["rmse"])]
             for item in cohort["catchment_summaries"]],
            "Original catchment summaries in " + unit + ". Ranges are the retained observed values "
            "and model predictions; they are not uncertainty intervals. Exact periods and original "
            "comparison-row indices accompany every summary in the retained diagnostics."))
        changing = [item["catchment_id"] for item in cohort["catchment_summaries"]
                    if item["model_prediction_varies"]]
        if changing:
            blocks.append("More than one retained model prediction occurs within these catchments: "
                          + ", ".join(changing) + ". Each original prediction is retained in the errors.")
        if cohort["repeated_observation_ids"]:
            blocks.append("Repeated original observation identifiers remain separate source rows: "
                          + _text(cohort["repeated_observation_ids"]) + ".")
    if review["omitted_rows"]:
        blocks.append(_table(
            ["Original row index", "Observation", "Diagnostic omission"],
            [[item["comparison_row_index"], _text(item["observation_id"]), item["reason"]]
             for item in review["omitted_rows"]],
            "Indices are zero-based positions in the immutable comparison's comparisons array. "
            "Original partial totals and source exclusions remain in the main comparison tables."))
    return blocks
