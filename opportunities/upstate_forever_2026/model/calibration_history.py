"""Compare selected native predictions across an original calibration lineage.

The ranking engine remains authoritative within each saved evaluation. This
read-only view pairs physical annual-load errors only on identical retained
reference support; it never re-ranks candidates or treats a changed objective
as a performance change.
"""
from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
import math

from .common import digest, identifier
from . import calibration_followup

SCHEMA = "upstate.calibration-history-comparison/v1"
VERSION = 1
MATCH_FIELDS = (
    "reference_csv_sha256", "catchment_source", "catchment_id", "parameter",
    "units", "observation_record_ids", "periods", "temporal_weighting",
    "observed_annual_mass", "reference_methods",
)
NOTES = [
    "Physical changes pair the same original observation CSV, catchment source bodies and companions, "
    "selected feature/layer definition, records, periods, weighting, methods and annual-load units.",
    "Signed residual is modeled minus observed annual load. A negative change in absolute error or "
    "RMSE means a smaller error over the displayed common reference support.",
    "Each saved objective belongs to its own training design and normalization. Objective scores "
    "are retained individually; they are not subtracted across evaluations.",
    "Changed partitions are displayed explicitly. Repeatedly viewed validation records retain "
    "their earlier use; a follow-up comparison does not establish a new independent evaluation.",
    "Common-support summaries describe the matched catchment rows. They do not replace the "
    "original equal-spatial-group selection objective or establish statistical significance.",
    "Changed native inputs, physics, parameter profiles and external-load assumptions may all "
    "contribute to an observed change. Their original selected-run and source records remain available.",
]


def lineage(workspace, report_id):
    """Return original report/plan/spec records, earliest evaluation first."""
    report = workspace._get("calibrations", identifier(report_id))
    plan = workspace._get("calibration-plans", identifier(report["plan_id"]))
    records, visited = [], set()
    spec = None
    while True:
        if (report["id"] in visited or report.get("plan_id") != plan["id"]
                or report.get("workspace_id") != workspace.project["id"]
                or plan.get("workspace_id") != workspace.project["id"]):
            raise ValueError("The calibration history differs from its original workspace and plan")
        visited.add(report["id"])
        records.append((report, plan, spec))
        binding = plan["selection"].get("prior_evaluation")
        if binding is None:
            return list(reversed(records))
        report, plan, spec = calibration_followup.resolve(workspace, binding)


def _catchment_source(workspace, plan):
    choice = plan["selection"]["catchments"]
    unused_path, entry = workspace.source_file(choice["source_collection_id"], choice["source_id"])
    if entry["body"]["sha256"] != plan["spatial_groups"]["source"]["sha256"]:
        raise ValueError("The retained catchment body differs from the original calibration plan")
    # DBF/PRJ and other companions can change feature identities or coordinates
    # while a geometry file remains byte-identical. Include their complete set.
    companions = sorted(
        ({"path": item.get("view_path", item["filename"]), "sha256": item["sha256"], "bytes": item["bytes"]}
         for item in entry.get("companions", [])),
        key=lambda item: (item["path"], item["sha256"]),
    )
    return {
        "body_sha256": entry["body"]["sha256"],
        "body_path": entry["body"].get("view_path", entry["body"]["filename"]), "companions": companions,
        "layer": choice.get("layer") or entry.get("layer"),
        "where": choice.get("where"), "id_field": choice["id_field"],
    }


def _finite(value):
    return type(value) in (float, int) and math.isfinite(value)


def _selected_rows(workspace, report, plan, order):
    source = _catchment_source(workspace, plan)
    observed = workspace._get("observations", plan["selection"]["observation_id"])
    source_sha = observed["original"]["sha256"]
    if source_sha != plan["observations"]["original"]["sha256"]:
        raise ValueError("The retained observation table differs from the original calibration plan")
    predictions = {}
    for prediction in report["prediction_rows"]:
        if prediction["run_id"] != report.get("selected_run_id"):
            continue
        key = prediction["unit_id"]
        if key in predictions:
            raise ValueError("The selected calibration repeats an original reference unit")
        predictions[key] = prediction
    rows = []
    for unit in report["reference_units"]:
        prediction = predictions.get(unit["id"])
        included = bool(prediction and prediction.get("included") is True)
        values = {name: prediction.get(name) if prediction else None for name in (
            "native_annual_mass", "predicted_annual_mass", "delivered_external_annual_mass", "residual")}
        if included and not all(_finite(value) for value in values.values()):
            raise ValueError("A complete selected prediction has a nonfinite annual-load value")
        if included and not math.isclose(
                values["residual"], values["predicted_annual_mass"] - unit["observed_annual_mass"],
                rel_tol=1e-12, abs_tol=1e-12):
            raise ValueError("The selected residual differs from its retained annual loads")
        support = {name: deepcopy(unit[name]) for name in MATCH_FIELDS
                   if name not in ("reference_csv_sha256", "catchment_source")}
        support.update(reference_csv_sha256=source_sha, catchment_source=source)
        external = plan["selection"].get("delivered_external_loads", {})
        rows.append({
            "evaluation_order": order, "calibration_id": report["id"], "plan_id": plan["id"],
            "title": report["title"], "run_id": report.get("selected_run_id"),
            "profile_id": report.get("selected_profile_id"), "unit_id": unit["id"],
            "reference_key": digest(support), "reference_support": support,
            "reference_csv_sha256": source_sha, "catchment_source_sha256": source["body_sha256"],
            "catchment_id": unit["catchment_id"], "group_id": unit["group_id"],
            "partition": unit["partition"], "parameter": unit["parameter"], "units": unit["units"],
            "station_ids": unit["station_ids"], "observation_record_ids": unit["observation_record_ids"],
            "periods": unit["periods"], "temporal_weighting": unit["temporal_weighting"],
            "reference_methods": unit["reference_methods"], "observed_annual_mass": unit["observed_annual_mass"],
            **values, "absolute_error": abs(values["residual"]) if included else None,
            "external_load_sources": {key: deepcopy(external[key]) for key in unit["observation_record_ids"]
                                     if key in external},
            "state": "complete" if included else "incomplete" if report.get("selected_run_id") else "no_selected_candidate",
            "issues": prediction.get("issues", []) if prediction else ["No selected prediction for this reference unit"],
        })
    if len({row["reference_key"] for row in rows}) != len(rows):
        raise ValueError("The selected calibration repeats an exact original reference support")
    return rows


def _evaluation(report, plan, spec, order, rows):
    selected = next((row for row in report["ranked_candidates"]
                     if row["run_id"] == report.get("selected_run_id")), None)
    return {
        "evaluation_order": order, "calibration_id": report["id"], "plan_id": plan["id"],
        "parameter_study_id": spec["id"] if spec else None, "title": report["title"],
        "created_at": report.get("created_at"), "state": report["state"],
        "selected_run_id": report.get("selected_run_id"), "selected_profile_id": report.get("selected_profile_id"),
        "selected_profile_title": selected["title"] if selected else None,
        "selected_models": report.get("selected_models", []),
        "objective_score": selected.get("objective_score") if selected else None,
        "objective": deepcopy(plan["selection"]["objective"]), "normalization": deepcopy(plan["normalization"]),
        "training_groups": len(plan["selection"]["calibration_group_ids"]),
        "validation_groups": len(plan["selection"]["validation_group_ids"]),
        "reference_units": len(rows), "complete_units": sum(row["state"] == "complete" for row in rows),
        "observation_id": plan["selection"]["observation_id"],
        "reference_csv_sha256": plan["observations"]["original"]["sha256"],
        "catchments": deepcopy(plan["selection"]["catchments"]),
        "source_vintages": deepcopy(plan["source_vintages"]),
        "selected_run_selection": deepcopy(selected.get("selection")) if selected else None,
        "selected_execution_fingerprint": selected.get("execution_fingerprint") if selected else None,
        "native_version_labels": selected.get("native_version_labels", []) if selected else [],
    }


def _changes(current_rows, earlier_rows, previous):
    earlier = {row["reference_key"]: row for row in earlier_rows}
    current = {row["reference_key"]: row for row in current_rows}
    related = defaultdict(list)
    for row in earlier_rows:
        related[(row["catchment_id"], row["parameter"])].append(row)
    changes = []
    for row in current_rows:
        before = earlier.get(row["reference_key"])
        match = before is not None
        complete = match and row["state"] == "complete" and before["state"] == "complete"
        candidates = related[(row["catchment_id"], row["parameter"])]
        fields = sorted({name for candidate in candidates for name in MATCH_FIELDS
                         if candidate["reference_support"].get(name) != row["reference_support"].get(name)})
        state = ("paired" if complete else "incomplete_prediction" if match else
                 "changed_reference_support" if candidates else "new_reference_support")
        result = {
            "earlier_calibration_id": previous["calibration_id"], "earlier_title": previous["title"],
            "current_calibration_id": row["calibration_id"], "current_title": row["title"],
            "catchment_id": row["catchment_id"], "parameter": row["parameter"], "units": row["units"],
            "reference_key": row["reference_key"], "state": state,
            "changed_reference_fields": [] if match else fields,
            "observation_record_ids": row["observation_record_ids"],
            "earlier_run_id": before["run_id"] if before else previous["selected_run_id"],
            "current_run_id": row["run_id"],
            "earlier_partition": before["partition"] if before else None,
            "current_partition": row["partition"], "partition_changed": before["partition"] != row["partition"] if before else None,
            "earlier_group_id": before["group_id"] if before else None, "current_group_id": row["group_id"],
            "observed_annual_mass": row["observed_annual_mass"],
            "earlier_modeled": before["predicted_annual_mass"] if before else None,
            "current_modeled": row["predicted_annual_mass"],
            "earlier_residual": before["residual"] if before else None, "current_residual": row["residual"],
            "earlier_absolute_error": before["absolute_error"] if before else None,
            "current_absolute_error": row["absolute_error"],
            "modeled_change": row["predicted_annual_mass"] - before["predicted_annual_mass"] if complete else None,
            "absolute_error_change": row["absolute_error"] - before["absolute_error"] if complete else None,
            "native_load_change": row["native_annual_mass"] - before["native_annual_mass"] if complete else None,
            "external_load_change": row["delivered_external_annual_mass"] - before["delivered_external_annual_mass"] if complete else None,
            "external_load_assumptions_changed": before["external_load_sources"] != row["external_load_sources"] if before else None,
            "earlier_issues": before["issues"] if before else [],
            "current_issues": row["issues"],
        }
        changes.append(result)
    for row in earlier_rows:
        if row["reference_key"] in current:
            continue
        changes.append({
            "earlier_calibration_id": previous["calibration_id"], "earlier_title": previous["title"],
            "current_calibration_id": current_rows[0]["calibration_id"] if current_rows else None,
            "catchment_id": row["catchment_id"], "parameter": row["parameter"], "units": row["units"],
            "reference_key": row["reference_key"], "state": "earlier_reference_only",
            "observation_record_ids": row["observation_record_ids"], "earlier_partition": row["partition"],
            "earlier_run_id": row["run_id"], "earlier_modeled": row["predicted_annual_mass"],
            "earlier_residual": row["residual"], "earlier_absolute_error": row["absolute_error"],
            "observed_annual_mass": row["observed_annual_mass"], "earlier_issues": row["issues"],
        })
    return changes


def _summaries(changes):
    groups = defaultdict(list)
    for row in changes:
        if row["state"] == "paired":
            # A partition transition remains its own descriptive cohort.
            groups[(row["earlier_calibration_id"], row["parameter"], row["units"],
                    row["earlier_partition"], row["current_partition"])].append(row)
    summaries = []
    for key, rows in sorted(groups.items()):
        n = len(rows)
        prior_rmse = math.hypot(*(row["earlier_residual"] for row in rows)) / math.sqrt(n)
        current_rmse = math.hypot(*(row["current_residual"] for row in rows)) / math.sqrt(n)
        summaries.append({
            "earlier_calibration_id": key[0], "earlier_title": rows[0]["earlier_title"],
            "current_calibration_id": rows[0]["current_calibration_id"],
            "parameter": key[1], "units": key[2], "earlier_partition": key[3], "current_partition": key[4],
            "matched_catchments": n, "catchment_ids": sorted(row["catchment_id"] for row in rows),
            "earlier_rmse": prior_rmse, "current_rmse": current_rmse, "rmse_change": current_rmse - prior_rmse,
            "earlier_mean_bias": math.fsum(row["earlier_residual"] / n for row in rows),
            "current_mean_bias": math.fsum(row["current_residual"] / n for row in rows),
            "smaller_absolute_error": sum(row["absolute_error_change"] < 0 for row in rows),
            "equal_absolute_error": sum(row["absolute_error_change"] == 0 for row in rows),
            "larger_absolute_error": sum(row["absolute_error_change"] > 0 for row in rows),
            "external_assumption_changes": sum(row["external_load_assumptions_changed"] for row in rows),
        })
    return summaries


def inspect(workspace, report_id):
    records = lineage(workspace, report_id)
    evaluations, rows, by_report = [], [], {}
    for order, (report, plan, spec) in enumerate(records, 1):
        selected = _selected_rows(workspace, report, plan, order)
        evaluations.append(_evaluation(report, plan, spec, order, selected))
        rows.extend(selected)
        by_report[report["id"]] = selected
    current = evaluations[-1]
    changes = []
    for previous in evaluations[:-1]:
        changes.extend(_changes(by_report[current["calibration_id"]],
                                by_report[previous["calibration_id"]], previous))
    value = {
        "schema": SCHEMA, "version": VERSION, "workspace_id": workspace.project["id"],
        "current_calibration_id": current["calibration_id"], "current_plan_id": current["plan_id"],
        "title": current["title"] + " · selected-profile history",
        "evaluations": evaluations, "reference_rows": rows, "paired_changes": changes,
        "pair_summaries": _summaries(changes), "notes": NOTES,
    }
    value["id"] = digest(value)
    return value
