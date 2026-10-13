"""Select native parameter candidates against retained annual-load references.

All numerical inputs come from original completed Workspace runs and the
existing observations comparison. This module never dispatches a native run.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
import datetime as dt
import json
import math
from pathlib import Path
import sys

from .common import (atomic_json, digest, finite, held, identifier, now, read_json)
from . import calibration_execution, observation_support
from .observations import NATIVE
from .workspace import Workspace

SELECTION_SCHEMA = "upstate.calibration-selection/v1"
PLAN_KIND = "calibration-plans"
RESULT_KIND = "calibrations"
VERSION = 1
PARAMETERS = tuple(NATIVE)
_ALLOWED = {
    "schema", "title", "candidate_run_ids", "reference_run_id", "observation_id",
    "catchments", "observation_record_ids", "catchment_groups",
    "calibration_group_ids", "validation_group_ids", "objective",
    "delivered_external_loads", "notes", "leave_group_out", "temporal_weighting",
}
REFERENCES = [
    "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/calibration_freshwater.html",
    "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html",
    "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html",
]


def _mean(values):
    values = list(values)
    return math.fsum(values) / len(values) if values else None


def _strings(value, label, *, empty=False):
    if (not isinstance(value, list) or (not empty and not value)
            or any(not isinstance(v, str) or not v.strip() for v in value)
            or len(set(value)) != len(value)):
        raise ValueError(label + " must be a list of distinct nonempty strings")
    return list(value)


def _selection(value):
    if not isinstance(value, dict):
        raise ValueError("Calibration selection must be an object")
    value = json.loads(json.dumps(value, allow_nan=False))
    if value.get("schema") != SELECTION_SCHEMA:
        raise ValueError("Use " + SELECTION_SCHEMA)
    extra = set(value) - _ALLOWED
    if extra:
        raise ValueError("Unknown calibration selection fields: " + ", ".join(sorted(extra)))
    if not isinstance(value.get("title"), str) or not value["title"].strip():
        raise ValueError("Name the annual-load parameter evaluation")
    runs = _strings(value.get("candidate_run_ids"), "Candidate run IDs")
    for run_id in runs:
        identifier(run_id)
    identifier(value.get("observation_id"))
    catchments = value.get("catchments")
    if (not isinstance(catchments, dict)
            or set(catchments) - {"source_collection_id", "source_id", "id_field", "layer", "where"}
            or not isinstance(catchments.get("source_id"), str) or not catchments["source_id"]
            or not isinstance(catchments.get("id_field"), str) or not catchments["id_field"]):
        raise ValueError("Select the retained catchment source and its original identity field")
    identifier(catchments.get("source_collection_id"))
    if "observation_record_ids" in value:
        _strings(value["observation_record_ids"], "Observation record IDs")
    for name in ("calibration_group_ids", "validation_group_ids"):
        if name in value:
            _strings(value[name], name, empty=True)
    if "reference_run_id" in value and value["reference_run_id"] not in runs:
        raise ValueError("Reference run must be one of the selected original candidates")
    if "leave_group_out" in value and not isinstance(value["leave_group_out"], bool):
        raise ValueError("leave_group_out must be true or false")
    value.setdefault("leave_group_out", True)
    value.setdefault("temporal_weighting", "whole_years")
    if value["temporal_weighting"] not in ("whole_years", "elapsed_days"):
        raise ValueError("temporal_weighting must be whole_years or elapsed_days")
    value.setdefault("notes", [])
    if not isinstance(value["notes"], list) or any(not isinstance(x, str) for x in value["notes"]):
        raise ValueError("Calibration notes must be a list of strings")
    return value


def _run_models(run):
    """Read the maintained native model/output scope without changing run IDs."""
    from .common import output_models
    from .model_selection import validate_completed_run
    if run.get("state") != "complete":
        raise ValueError("Complete the original selected native models before evaluating run " + run["id"])
    scope = validate_completed_run(run)
    present = set(scope["available_artifacts"])
    registry = {tuple(pair) for name, pair in output_models(run["selection"]).items()
                if name in present}
    available = [parameter for parameter, (model, output, _) in NATIVE.items()
                 if (model, output) in registry]
    return {
        "selected_models": scope["selected_models"],
        "available_parameters": available,
        "model_scope": scope,
    }


def _candidate_group(key, runs):
    parameters = [set(run["available_parameters"]) for run in runs]
    common = set.intersection(*parameters) if parameters else set()
    union = set.union(*parameters) if parameters else set()
    counts = defaultdict(int)
    for run in runs:
        counts[run["profile_id"]] += 1
    return {
        "grid_id": key[0], "scenario_id": key[1], "runs": [
            {**run, "profile_variant_count": counts[run["profile_id"]]} for run in runs],
        "common_parameters": [parameter for parameter in PARAMETERS if parameter in common],
        "available_parameters": [parameter for parameter in PARAMETERS if parameter in union],
        "candidate_count": len(runs), "distinct_profile_count": len(counts),
    }


def _candidates(workspace, selection):
    candidates = []
    for run_id in selection["candidate_run_ids"]:
        run = workspace.inspect_run(run_id)
        if run.get("state") != "complete":
            raise ValueError("Complete original candidate run " + run_id + " before evaluating parameters")
        chosen = run["selection"]
        scenario = workspace._get("scenarios", chosen["scenario_id"])
        if scenario.get("kind") != "baseline" or scenario.get("patches"):
            raise ValueError("Annual-load parameter evaluation requires original baseline land cover")
        profile = workspace._get("profiles", chosen["profile_id"])
        scope = _run_models(run)
        candidates.append({
            "run_id": run_id, "profile_id": profile["id"], "title": profile["title"],
            "grid_id": chosen["grid_id"], "scenario_id": chosen["scenario_id"],
            "selection": chosen, "runtime": run.get("runtime"),
            "model_period": profile.get("model_period"),
            "profile_references": profile.get("references"),
            "table_summary": profile.get("table_summary"),
            "parameters": {model: profile.get(model) for model in scope["selected_models"]},
            **scope, **calibration_execution.candidate(workspace, run),
        })
    if len({(c["grid_id"], c["scenario_id"]) for c in candidates}) != 1:
        raise ValueError("Every candidate must use the same original grid and baseline scenario")
    return candidates


def catalog(workspace):
    """Return actual saved baseline candidates and source observation editions."""
    groups = defaultdict(list)
    for path in sorted((workspace.root / "runs").glob("*/run.json")):
        run = workspace.inspect_run(path.parent.name)
        if run.get("state") != "complete":
            continue
        selection = run["selection"]
        scenario = workspace._get("scenarios", selection["scenario_id"])
        if scenario.get("kind") != "baseline" or scenario.get("patches"):
            continue
        profile = workspace._get("profiles", selection["profile_id"])
        try:
            execution = calibration_execution.candidate(workspace, run)
        except (ValueError, KeyError, OSError) as error:
            execution = {"execution_issues": [str(error)]}
        groups[(selection["grid_id"], selection["scenario_id"])].append({
            "id": run["id"], "run_id": run["id"], "profile_id": profile["id"], "title": profile["title"],
            "model_period": profile.get("model_period"), **_run_models(run), **execution,
            "calibration_eligible": not execution.get("execution_issues"),
        })
    return {
        "schema": "upstate.calibration-catalog/v1", "workspace_id": workspace.project["id"],
        "candidate_groups": [_candidate_group(key, values) for key, values in sorted(groups.items())],
        "observations": [
            {"id": item["id"], "observation_id": item["id"], "title": item["metadata"]["title"],
             "admitted_count": item["admitted_count"], "context_count": item["context_count"],
             "parameters": sorted({r["parameter"] for r in item["rows"] if r["admitted"]}),
             "catchment_ids": sorted({r["catchment_id"] for r in item["rows"] if r["admitted"]}),
             "source_uri": item["metadata"]["source_uri"], "metadata": item["metadata"]}
            for item in workspace._list("observations")],
        "plans": [{"id": item["id"], "title": item["selection"]["title"],
                   "observation_id": item["selection"]["observation_id"],
                   "candidate_run_ids": item["selection"]["candidate_run_ids"]}
                  for item in workspace._list(PLAN_KIND)],
    }


def _source_groups(workspace, selection, rows, grid):
    """Merge shared upstream land and repeated stations into one spatial group."""
    from . import rasters
    from shapely.strtree import STRtree
    source, entry = workspace.source_file(
        selection["catchments"]["source_collection_id"], selection["catchments"]["source_id"])
    features, _ = rasters.vector_geometry(
        source, layer=selection["catchments"].get("layer") or entry.get("layer"),
        where=selection["catchments"].get("where"), target_crs=grid["grid"]["crs"])
    field = selection["catchments"]["id_field"]
    needed = {r["catchment_id"] for r in rows}
    indexed = {}
    for feature in features:
        key = feature["properties"].get(field)
        if key is None:
            raise ValueError("The original catchment identity field has a null value")
        key = str(key)
        if key in indexed:
            raise ValueError("The original catchment identity field is not unique: " + key)
        indexed[key] = feature["geometry"]
    missing = sorted(needed - set(indexed))
    if missing:
        raise ValueError("Selected annual-load catchments are absent from the source: " + ", ".join(missing))
    names = sorted(needed)
    geometries = [indexed[name] for name in names]
    for name, geom in zip(names, geometries):
        if (geom.is_empty or not geom.is_valid or geom.geom_type not in ("Polygon", "MultiPolygon")
                or not math.isfinite(geom.area) or geom.area <= 0):
            raise ValueError("Selected catchment is not a valid nonempty polygon: " + name)
    parent = list(range(len(names)))
    def find(index):
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index
    def union(left, right):
        a, b = find(left), find(right)
        parent[max(a, b)] = min(a, b)
    tree = STRtree(geometries)
    by_wkb = defaultdict(list)
    for i, geom in enumerate(geometries):
        by_wkb[geom.wkb].append(i)
    connections = []
    for i, geom in enumerate(geometries):
        for found in tree.query(geom):
            # Shapely 2 returns integer indices; Shapely 1 returns geometries.
            indices = by_wkb[found.wkb] if hasattr(found, "wkb") else [int(found)]
            for j in indices:
                if j <= i:
                    continue
                other = geometries[j]
                area = geom.intersection(other).area
                if area > 0:
                    union(i, j)
                    connections.append({"catchment_ids": [names[i], names[j]],
                                        "basis": "shared upstream polygon area", "overlap_ha": area / 10000})
    station_names = defaultdict(set)
    for row in rows:
        if row.get("station_id"):
            station_names[row["station_id"]].add(row["catchment_id"])
    lookup = {name: i for i, name in enumerate(names)}
    for station_id, catchment_ids in sorted(station_names.items()):
        ordered = sorted(catchment_ids)
        for name in ordered[1:]:
            union(lookup[ordered[0]], lookup[name])
            connections.append({"catchment_ids": [ordered[0], name],
                                "basis": "shared original station ID", "station_id": station_id})
    connected = defaultdict(list)
    for i, name in enumerate(names):
        connected[find(i)].append(name)
    assignments = selection.get("catchment_groups")
    if assignments is not None:
        if (not isinstance(assignments, dict) or set(assignments) != needed
                or any(not isinstance(v, str) or not v.strip() for v in assignments.values())):
            raise ValueError("catchment_groups must assign every selected catchment exactly once")
        for members in connected.values():
            if len({assignments[name] for name in members}) != 1:
                raise ValueError("A spatial holdout cannot split overlapping catchments or one original station")
    else:
        assignments = {}
        for members in connected.values():
            group_id = "catchments-" + digest(sorted(members))[:16]
            assignments.update({name: group_id for name in members})
    groups = defaultdict(list)
    for name in names:
        groups[assignments[name]].append(name)
    return {
        "assignments": assignments,
        "groups": [{"id": key, "catchment_ids": members,
                    "station_ids": sorted({r["station_id"] for r in rows
                                           if r["catchment_id"] in members and r.get("station_id")}),
                    "observation_records": sum(r["catchment_id"] in members for r in rows),
                    "parameters": sorted({r["parameter"] for r in rows if r["catchment_id"] in members})}
                   for key, members in sorted(groups.items())],
        "connections": connections,
        "method": "Connected components of positive-area overlap of the original upstream catchments, "
                  "plus shared original station IDs. Explicit groups can merge these components.",
        "source": {"selection": selection["catchments"], "uri": entry["uri"],
                   "vintage": entry["vintage"], "sha256": entry["body"]["sha256"]},
    }


def _objective(selection, rows, common_parameters=None):
    supplied = selection.get("objective")
    available = {r["parameter"] for r in rows}
    if supplied is None:
        default_parameters = available if common_parameters is None else available & set(common_parameters)
        if not default_parameters:
            raise ValueError("Choose completed candidate runs with a common native output matching the original annual references")
        supplied = {p: {"weight": 1.0} for p in PARAMETERS if p in default_parameters}
    if not isinstance(supplied, dict) or not supplied or set(supplied) - set(PARAMETERS):
        raise ValueError("Select nitrogen, phosphorus or sediment objective definitions")
    result = {}
    for parameter, spec in supplied.items():
        if not isinstance(spec, dict) or set(spec) - {"weight", "normalization_scale", "scale_reference", "units"}:
            raise ValueError("Objective fields are weight, optional normalization_scale and scale_reference")
        if "units" in spec and spec["units"] != NATIVE[parameter][2]:
            raise ValueError("Objective units differ from the original " + parameter + " comparison units")
        weight = finite(spec.get("weight", 1), parameter + " weight", minimum=0)
        if weight == 0:
            continue
        if parameter not in available:
            raise ValueError("There are no admitted annual-load rows for " + parameter)
        value = {"weight": weight, "units": NATIVE[parameter][2]}
        if "normalization_scale" in spec:
            value["normalization_scale"] = finite(spec["normalization_scale"], parameter + " scale", positive=True)
            if not isinstance(spec.get("scale_reference"), str) or not spec["scale_reference"].strip():
                raise ValueError("An explicit normalization scale needs its scientific source or rationale")
            value["scale_reference"] = spec["scale_reference"]
        result[parameter] = value
    if not result:
        raise ValueError("At least one pollutant objective must have positive weight")
    return result


def _period_means(rows, assignments, selection, objective):
    grouped = defaultdict(list)
    for row in rows:
        grouped[(row["catchment_id"], row["parameter"])].append(row)
    external = selection.get("delivered_external_loads", {})
    if not isinstance(external, dict) or set(external) - {r["id"] for r in rows}:
        raise ValueError("External annual loads must refer to selected original observation record IDs")
    units = []
    for (catchment_id, parameter), values in sorted(grouped.items()):
        values.sort(key=lambda r: (r["period_start"], r["period_end"], r["id"]))
        latest_end = None
        for row in values:
            start, end = dt.date.fromisoformat(row["period_start"]), dt.date.fromisoformat(row["period_end"])
            if end <= start:
                raise ValueError("An original annual-load period has no positive duration")
            if latest_end is not None and start < latest_end:
                raise ValueError("Overlapping annual-load reference periods for catchment " + catchment_id
                                 + " / " + parameter + "; select one original estimator/period series")
            latest_end = end
        days = [(dt.date.fromisoformat(r["period_end"]) - dt.date.fromisoformat(r["period_start"])).days
                for r in values]
        total_days = sum(days)
        weights = []
        for row, duration in zip(values, days):
            start, end = dt.date.fromisoformat(row["period_start"]), dt.date.fromisoformat(row["period_end"])
            if selection["temporal_weighting"] == "whole_years":
                if (start.month, start.day) != (end.month, end.day) or end.year <= start.year:
                    raise ValueError("Whole-year weighting requires complete source annual periods for " + row["id"]
                                     + "; elapsed_days is available for explicitly selected annualized-rate periods")
                weights.append(end.year - start.year)
            else:
                weights.append(duration)
        total_weight = sum(weights)
        adjustments = []
        for row in values:
            item = external.get(row["id"])
            if item is None:
                adjustments.append(0.0)
                continue
            if (not isinstance(item, dict) or set(item) != {"annual_mass", "units", "source_reference"}
                    or item["units"] != NATIVE[parameter][2]
                    or not isinstance(item["source_reference"], str) or not item["source_reference"].strip()):
                raise ValueError("External load needs annual_mass, matching units and its original source_reference")
            adjustments.append(finite(item["annual_mass"], "Delivered external annual load", minimum=0))
        units.append({
            "id": digest({"catchment_id": catchment_id, "parameter": parameter,
                          "observation_record_ids": [r["id"] for r in values]}),
            "catchment_id": catchment_id, "group_id": assignments[catchment_id], "parameter": parameter,
            "station_ids": sorted({r["station_id"] for r in values if r.get("station_id")}),
            "observation_record_ids": [r["id"] for r in values],
            "periods": [{"start": r["period_start"], "end": r["period_end"], "days": d, "weight": w}
                        for r, d, w in zip(values, days, weights)],
            "covered_days": total_days, "aggregation_weight": total_weight,
            "temporal_weighting": selection["temporal_weighting"],
            "covered_years": total_weight if selection["temporal_weighting"] == "whole_years" else None,
            "observed_annual_mass": math.fsum(finite(r["annual_mass"], "Original annual mass", minimum=0) * d
                                             for r, d in zip(values, weights)) / total_weight,
            "delivered_external_annual_mass": math.fsum(v * d for v, d in zip(adjustments, weights)) / total_weight,
            "units": objective[parameter]["units"],
            "reference_methods": [r.get("method") for r in values],
            "reference_uncertainty": [r.get("uncertainty") for r in values],
            "source_records": [r.get("source_records") for r in values],
        })
    return units


def _scales(units, group_ids, objective):
    selected = set(group_ids)
    result = {}
    for parameter, definition in objective.items():
        by_group = defaultdict(list)
        for unit in units:
            if unit["group_id"] in selected and unit["parameter"] == parameter:
                by_group[unit["group_id"]].append(unit["observed_annual_mass"])
        if not by_group:
            raise ValueError("Calibration groups have no annual-load reference for " + parameter)
        if "normalization_scale" in definition:
            scale, basis = definition["normalization_scale"], definition["scale_reference"]
        else:
            scale = _mean(_mean(v) for v in by_group.values())
            basis = "Mean of calibration-group mean annual references; validation groups excluded"
            if scale <= 0:
                raise ValueError("All calibration references for " + parameter
                                 + " are zero; select an explicit positive normalization_scale and scale_reference")
        result[parameter] = {"value": scale, "units": definition["units"], "basis": basis,
                             "calibration_groups": sorted(by_group)}
    return result


def _basis(workspace, selection):
    selection = _selection(selection)
    candidates = _candidates(workspace, selection)
    observed = workspace._get("observations", selection["observation_id"])
    by_id = {row["id"]: row for row in observed["rows"]}
    selected_ids = selection.get("observation_record_ids", list(by_id))
    if set(selected_ids) - set(by_id):
        raise ValueError("Observation selection contains an absent original record ID")
    eligible, exclusions = [], []
    for key in selected_ids:
        row = by_id[key]
        support_issues = observation_support.comparison_issues(row, observed["metadata"])
        if row.get("admitted") and row.get("parameter") in NATIVE and not support_issues:
            eligible.append(row)
        else:
            exclusions.append({"observation_record_id": key,
                               "issues": list(row.get("issues", [])) + support_issues,
                               "measurement_support": observation_support.measurement_support(row, observed["metadata"]),
                               "species": observation_support.source_species(row, observed["metadata"])})
    if not eligible:
        raise ValueError("The selected source has no admitted annual N/P/sediment reference loads")
    common_parameters = set.intersection(*(set(candidate["available_parameters"]) for candidate in candidates))
    objective = _objective(selection, eligible, common_parameters)
    missing = [
        {"run_id": candidate["run_id"],
         "parameters": sorted(set(objective) - set(candidate["available_parameters"])),
         "selected_models": candidate["selected_models"]}
        for candidate in candidates
        if set(objective) - set(candidate["available_parameters"])
    ]
    if missing:
        descriptions = [item["run_id"] + " lacks " + ", ".join(item["parameters"])
                        + " in its selected " + "/".join(item["selected_models"]).upper() + " outputs"
                        for item in missing]
        raise ValueError("Positive-weight objectives require an actual native output for every candidate: "
                         + "; ".join(descriptions))
    rows = []
    for row in eligible:
        if row["parameter"] in objective:
            rows.append(row)
        else:
            exclusions.append({"observation_record_id": row["id"], "parameter": row["parameter"],
                               "available_for_all_candidates": row["parameter"] in common_parameters,
                               "issues": ["Pollutant is outside the selected positive-weight objectives"]})
    execution = calibration_execution.cohort(workspace, candidates, objective)
    grid = workspace.get_grid(candidates[0]["grid_id"])
    spatial = _source_groups(workspace, selection, rows, grid)
    all_groups = {group["id"] for group in spatial["groups"]}
    validation = set(selection.get("validation_group_ids", []))
    calibration = set(selection.get("calibration_group_ids", sorted(all_groups - validation)))
    if calibration & validation or calibration | validation != all_groups or not calibration:
        raise ValueError("Assign every selected spatial group once; retain at least one calibration group")
    selection["calibration_group_ids"] = sorted(calibration)
    selection["validation_group_ids"] = sorted(validation)
    selection["objective"] = objective
    selection["catchment_groups"] = spatial["assignments"]
    selection["observation_record_ids"] = list(selected_ids)
    units = _period_means(rows, spatial["assignments"], selection, objective)
    scales = _scales(units, calibration, objective)
    for unit in units:
        unit["partition"] = "calibration" if unit["group_id"] in calibration else "validation"
    for group in spatial["groups"]:
        group["partition"] = "calibration" if group["id"] in calibration else "validation"
    return {
        "selection": selection, "candidates": candidates, "units": units,
        "native_execution": execution,
        "candidate_count": len(candidates),
        "distinct_profile_count": len({candidate["profile_id"] for candidate in candidates}),
        "common_parameters": [parameter for parameter in PARAMETERS if parameter in common_parameters],
        "predicted_parameters": [parameter for parameter in PARAMETERS if parameter in objective],
        "spatial_groups": spatial, "normalization": scales,
        "observations": {"id": observed["id"], "metadata": observed["metadata"], "original": observed["original"]},
        "source_vintages": grid["inputs"], "exclusions": exclusions,
        "temporal_method": "Mean of disjoint original annual-rate periods per catchment/pollutant, weighted by "
                           + selection["temporal_weighting"] + ". Whole-year weighting gives each complete year "
                           "equal weight, including leap years; elapsed-day weighting is an explicit alternative. "
                           "Period ends follow original Workspace exclusive-end conventions. "
                           "Multiple years do not increase the number of spatial calibration units.",
    }


def preview(workspace, selection):
    """Resolve the actual source basis and holdout groups without creating runs."""
    basis = _basis(workspace, selection)
    return {"schema": "upstate.calibration-preview/v1", "workspace_id": workspace.project["id"],
            **basis, "groups": [{**group, "observation_count": group["observation_records"]}
                                for group in basis["spatial_groups"]["groups"]]}


def prepare(workspace, selection):
    basis = _basis(workspace, selection)
    return workspace._save(PLAN_KIND, {
        "version": VERSION, "workspace_id": workspace.project["id"], **basis,
        "score_method": "Equal spatial-group mean normalized squared error, then explicit pollutant weights",
        "references": REFERENCES,
    })


def _matching_comparison(item, plan, run_id, *, checkpoint_matches=False):
    candidate = next((value for value in plan["candidates"] if value["run_id"] == run_id), None)
    selected = candidate.get("selected_models") if candidate else None
    if selected:
        if item.get("model_scope", {}).get("selected_models") != selected:
            return False
    return (item.get("run_id") == run_id
            and item.get("observation_id") == plan["selection"]["observation_id"]
            and calibration_execution.matching_outputs(
                item, candidate or {}, plan["selection"]["objective"],
                checkpoint_matches=checkpoint_matches)
            and digest(item.get("catchment_selection")) == digest(plan["selection"]["catchments"])
            and item.get("catchment_source", {}).get("sha256")
                == plan["spatial_groups"]["source"]["sha256"])


def _predictions(plan, comparison):
    rows = {}
    for row in comparison["comparisons"]:
        key = row["observation_id"]
        if key in rows:
            raise ValueError("Original comparison repeats observation record " + key)
        rows[key] = row
    exclusions = {item["observation_id"]: item["issues"] for item in comparison.get("exclusions", [])}
    predictions = {}
    for unit in plan["units"]:
        selected, issues = [], []
        for key in unit["observation_record_ids"]:
            row = rows.get(key)
            if row is None:
                issues.append({"observation_record_id": key,
                               "issues": exclusions.get(key, ["Original comparison has no selected observation row"])})
                continue
            if (row["catchment_id"] != unit["catchment_id"] or row["parameter"] != unit["parameter"]
                    or row["units"] != unit["units"]):
                raise ValueError("Original comparison identity or units differ for record " + key)
            if row.get("included_in_metrics") is not True:
                issues.append({"observation_record_id": key,
                               "issues": row.get("spatial_coverage", {}).get("coverage_issues",
                                                                           ["Incomplete original catchment support"])})
                continue
            selected.append(row)
        if issues:
            predictions[unit["id"]] = {"included": False, "issues": issues}
            continue
        native_values = [finite(r["modeled_annual_mass"], "Native annual mass", minimum=0) for r in selected]
        if any(not math.isclose(value, native_values[0], rel_tol=1e-12, abs_tol=0)
               for value in native_values[1:]):
            raise ValueError("A steady-state native catchment has differing predictions across source periods")
        observed = math.fsum(finite(row["observed_annual_mass"], "Original annual reference", minimum=0)
                             * period["weight"] for row, period in zip(selected, unit["periods"])) / unit["aggregation_weight"]
        if not math.isclose(observed, unit["observed_annual_mass"], rel_tol=1e-12, abs_tol=1e-12):
            raise ValueError("Retained annual reference differs from the frozen calibration basis")
        native = native_values[0]
        predicted = native + unit["delivered_external_annual_mass"]
        predictions[unit["id"]] = {
            "included": True, "native_annual_mass": native, "predicted_annual_mass": predicted,
            "delivered_external_annual_mass": unit["delivered_external_annual_mass"],
            "residual": predicted - unit["observed_annual_mass"],
            "comparison_id": comparison["id"],
            "native_support": {
                "complete_catchment": True,
                "valid_cells": selected[0]["spatial_coverage"].get("valid_cells"),
                "structural_stream_omission_cells":
                    selected[0]["spatial_coverage"].get("structural_stream_omission_cells"),
                "unexpected_missing_cells": selected[0]["spatial_coverage"].get("unexpected_missing_cells"),
                "native_stream_source": selected[0]["spatial_coverage"].get("native_stream_source"),
            },
        }
    return predictions


def _score(plan, predictions, group_ids, scales):
    wanted = set(group_ids)
    units = [u for u in plan["units"] if u["group_id"] in wanted]
    missing = [{"unit_id": u["id"], "catchment_id": u["catchment_id"], "parameter": u["parameter"],
                "group_id": u["group_id"], "issues": predictions[u["id"]].get("issues", [])}
               for u in units if not predictions[u["id"]]["included"]]
    metrics = {}
    objective = plan["selection"]["objective"]
    for parameter, definition in objective.items():
        selected = [u for u in units if u["parameter"] == parameter and predictions[u["id"]]["included"]]
        if not selected:
            continue
        residuals = [predictions[u["id"]]["residual"] for u in selected]
        observed = [u["observed_annual_mass"] for u in selected]
        values_by_group = defaultdict(list)
        biases_by_group = defaultdict(list)
        for unit, residual in zip(selected, residuals):
            values_by_group[unit["group_id"]].append(residual * residual)
            biases_by_group[unit["group_id"]].append(residual)
        mean_observed = _mean(observed)
        sse = math.fsum(r * r for r in residuals)
        variance = math.fsum((value - mean_observed) ** 2 for value in observed)
        grouped_mse = _mean(_mean(values) for values in values_by_group.values())
        scale = scales[parameter]["value"]
        metrics[parameter] = {
            "units": definition["units"], "catchments": len(selected), "spatial_groups": len(values_by_group),
            "source_period_records": sum(len(u["observation_record_ids"]) for u in selected),
            "mean_observed": mean_observed,
            "mean_predicted": _mean(predictions[u["id"]]["predicted_annual_mass"] for u in selected),
            "mean_bias": _mean(residuals), "rmse": math.sqrt(sse / len(selected)),
            "percent_bias": 100 * math.fsum(residuals) / math.fsum(observed) if math.fsum(observed) > 0 else None,
            "nash_sutcliffe_efficiency": 1 - sse / variance if len(selected) > 1 and variance > 0 else None,
            "group_weighted_rmse": math.sqrt(grouped_mse),
            "group_weighted_mean_bias": _mean(_mean(v) for v in biases_by_group.values()),
            "normalized_mse": grouped_mse / (scale * scale),
            "normalization_scale": scale,
            "expected_catchments": sum(u["parameter"] == parameter for u in units),
        }
    absent = sorted(set(objective) - set(metrics))
    complete = bool(units) and not missing and not absent
    loss = (math.fsum(objective[p]["weight"] * metrics[p]["normalized_mse"] for p in objective)
            / math.fsum(v["weight"] for v in objective.values())) if complete else None
    return {
        "state": "complete" if complete else "incomplete",
        "objective_score": loss, "pollutant_metrics": metrics,
        "group_ids": sorted(wanted), "expected_units": len(units),
        "complete_units": len(units) - len(missing), "missing_units": missing,
        "parameters_without_reference": absent,
        "physical_metrics_basis": "One source-period-weighted mean annual reference per original catchment/pollutant. "
                                  "RMSE, bias and NSE treat those catchments as descriptive rows; "
                                  "the selection objective gives each spatial group equal weight.",
    }


def _ranking(candidates, scores, reference_run_id=None):
    eligible = [candidate for candidate in candidates
                if scores[candidate["run_id"]]["state"] == "complete"]
    eligible.sort(key=lambda candidate: (
        scores[candidate["run_id"]]["objective_score"],
        0 if candidate["run_id"] == reference_run_id else 1,
        candidate["profile_id"], candidate["run_id"]))
    return [{**candidate, "rank": rank, **scores[candidate["run_id"]]}
            for rank, candidate in enumerate(eligible, 1)]


def _pareto(ranked, parameters):
    result = []
    for candidate in ranked:
        current = candidate["pollutant_metrics"]
        dominated = False
        for other in ranked:
            if other["run_id"] == candidate["run_id"]:
                continue
            values = other["pollutant_metrics"]
            no_worse = all(values[p]["normalized_mse"] <= current[p]["normalized_mse"] for p in parameters)
            better = any(values[p]["normalized_mse"] < current[p]["normalized_mse"] for p in parameters)
            if no_worse and better:
                dominated = True
                break
        if not dominated:
            result.append(candidate["run_id"])
    return result


def _envelope(plan, predictions, run_ids):
    result = []
    profiles = {candidate["run_id"]: candidate["profile_id"] for candidate in plan["candidates"]}
    for unit in plan["units"]:
        included = [run_id for run_id in run_ids if predictions[run_id][unit["id"]]["included"]]
        values = sorted(predictions[run_id][unit["id"]]["predicted_annual_mass"] for run_id in included)
        n = len(values)
        median = (values[n // 2] if n % 2 else (values[n // 2 - 1] + values[n // 2]) / 2) if n else None
        result.append({
            "unit_id": unit["id"], "catchment_id": unit["catchment_id"], "group_id": unit["group_id"],
            "parameter": unit["parameter"], "partition": unit["partition"], "units": unit["units"],
            "observed_annual_mass": unit["observed_annual_mass"],
            "minimum": values[0] if n else None, "median": median, "maximum": values[-1] if n else None,
            "candidate_count": n, "expected_candidates": len(run_ids),
            "distinct_profile_count": len({profiles[run_id] for run_id in included}),
            "expected_profiles": len({profiles[run_id] for run_id in run_ids}),
            "summary_unit": "completed native candidate run",
        })
    return result


def _stability(plan, predictions, ranked):
    groups = plan["selection"]["calibration_group_ids"]
    if not plan["selection"]["leave_group_out"]:
        return {"state": "not_selected", "folds": [], "winner_frequencies": []}
    if len(groups) < 2:
        return {"state": "one_calibration_group", "folds": [], "winner_frequencies": []}
    folds, wins, profile_wins = [], defaultdict(int), defaultdict(int)
    for held_group in groups:
        training = [group_id for group_id in groups if group_id != held_group]
        try:
            scales = _scales(plan["units"], training, plan["selection"]["objective"])
        except ValueError as error:
            folds.append({"held_group_id": held_group, "state": "reference_unavailable", "reason": str(error)})
            continue
        scores = {candidate["run_id"]: _score(plan, predictions[candidate["run_id"]], training, scales)
                  for candidate in ranked}
        choices = _ranking(ranked, scores, plan["selection"].get("reference_run_id"))
        if not choices:
            folds.append({"held_group_id": held_group, "state": "no_complete_candidate"})
            continue
        winner = choices[0]
        wins[winner["run_id"]] += 1
        profile_wins[winner["profile_id"]] += 1
        folds.append({
            "held_group_id": held_group, "training_group_ids": training, "state": "complete",
            "selected_run_id": winner["run_id"], "selected_profile_id": winner["profile_id"],
            "training_objective_score": winner["objective_score"], "normalization": scales,
            "held_group_evaluation": _score(plan, predictions[winner["run_id"]], [held_group], scales),
        })
    return {
        "state": "complete", "folds": folds,
        "winner_frequencies": [{"run_id": key, "folds_selected": count} for key, count in sorted(wins.items())],
        "profile_winner_frequencies": [{"profile_id": key, "folds_selected": count}
                                       for key, count in sorted(profile_wins.items())],
        "completed_folds": sum(fold["state"] == "complete" for fold in folds),
        "method": "Leave one calibration spatial group out, recompute normalization using the remaining "
                  "calibration groups, and reselect from the same eligible original candidates. "
                  "The separately declared validation groups never enter these folds.",
    }


def inspect(workspace, plan_id):
    plan = workspace._get(PLAN_KIND, identifier(plan_id))
    path = workspace.root / "calibration-analysis" / plan_id / "progress.json"
    state = read_json(path) if path.exists() else {"state": "prepared", "phase": "prepared"}
    if path.exists() and (state.get("id") != plan_id or state.get("workspace_id") != workspace.project["id"]):
        raise ValueError("Calibration progress belongs to another original workspace")
    if state.get("result_id"):
        workspace._get(RESULT_KIND, state["result_id"])
    return {**state, "id": plan_id, "selection": plan["selection"],
            "native_execution": plan.get("native_execution"),
            "workspace_id": workspace.project["id"]}


def _progress(path, record, **updates):
    if "error" not in updates:
        record.pop("error", None)
    record.update(updates, updated_at=now())
    atomic_json(path, record)


def analyze(workspace, plan_id):
    """Evaluate the frozen annual-load plan and preserve completed comparisons."""
    plan_id = identifier(plan_id)
    plan = workspace._get(PLAN_KIND, plan_id)
    if plan.get("version") != VERSION or plan.get("workspace_id") != workspace.project["id"]:
        raise ValueError("Select this workspace's supported original calibration plan")
    directory = workspace.root / "calibration-analysis" / plan_id
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".analysis.lock", blocking=False):
        progress_path = directory / "progress.json"
        state = inspect(workspace, plan_id)
        try:
            if state.get("result_id"):
                previous = workspace._get(RESULT_KIND, state["result_id"])
                if previous.get("state") == "complete":
                    return previous
                state.pop("result_id", None)
            # Enrich an in-memory copy from retained native runs. Saved version-1
            # plans and their content-addressed identities remain unchanged.
            plan = {**plan, "candidates": [dict(candidate) for candidate in plan["candidates"]]}
            execution = calibration_execution.cohort(
                workspace, plan["candidates"], plan["selection"]["objective"], verify=True)
            if (plan.get("native_execution") and
                    plan["native_execution"]["fingerprint"] != execution["fingerprint"]):
                raise ValueError("The producing execution differs from the saved calibration plan")
            if (state.get("execution_fingerprint") and
                    state["execution_fingerprint"] != execution["fingerprint"]):
                raise ValueError("The producing execution differs from this retained analysis checkpoint")
            plan["native_execution"] = execution
            state["execution_fingerprint"] = execution["fingerprint"]
            state.setdefault("created_at", now())
            state.setdefault("comparison_ids", {})
            state.setdefault("comparison_execution_fingerprints", {})
            _progress(progress_path, state, state="running", phase="original_comparisons")
            existing = workspace._list("observation-comparisons")
            predictions, scores, failures, comparison_ids = {}, {}, [], {}
            for candidate in plan["candidates"]:
                run_id = candidate["run_id"]
                try:
                    _progress(progress_path, state, phase="original_comparisons", current_run_id=run_id)
                    run = workspace.inspect_run(run_id)
                    if digest(run["selection"]) != digest(candidate["selection"]):
                        raise ValueError("The original candidate selection differs from its saved calibration plan")
                    candidate.update(_run_models(run))
                    missing = set(plan["selection"]["objective"]) - set(candidate["available_parameters"])
                    if missing:
                        raise ValueError("The saved objective requires absent selected-model outputs: "
                                         + ", ".join(sorted(missing)))
                    comparison = None
                    if state["comparison_ids"].get(run_id):
                        retained = workspace._get("observation-comparisons", state["comparison_ids"][run_id])
                        checkpoint_matches = (state["comparison_execution_fingerprints"].get(run_id)
                                              == candidate["execution_fingerprint"])
                        if _matching_comparison(retained, plan, run_id, checkpoint_matches=checkpoint_matches):
                            comparison = retained
                        else:
                            # Preserve the original comparison record; replace only its stale
                            # checkpoint link with a current source-compatible comparison.
                            state["comparison_ids"].pop(run_id, None)
                            state["comparison_execution_fingerprints"].pop(run_id, None)
                    if comparison is None:
                        matches = [item for item in existing if _matching_comparison(item, plan, run_id)]
                        comparison = (sorted(matches, key=lambda item: item["id"])[0] if matches
                                      else workspace.compare_observations(
                                          run_id, plan["selection"]["observation_id"], plan["selection"]["catchments"]))
                        if not _matching_comparison(comparison, plan, run_id, checkpoint_matches=True):
                            raise ValueError("Current annual comparison changed its source, native files or supported semantics")
                        state["comparison_ids"][run_id] = comparison["id"]
                        state["comparison_execution_fingerprints"][run_id] = candidate["execution_fingerprint"]
                        _progress(progress_path, state)
                    prediction = _predictions(plan, comparison)
                    score = _score(plan, prediction, plan["selection"]["calibration_group_ids"], plan["normalization"])
                    predictions[run_id] = prediction
                    scores[run_id] = score
                    comparison_ids[run_id] = comparison["id"]
                    if score["state"] != "complete":
                        failures.append({"run_id": run_id, "profile_id": candidate["profile_id"],
                                         "phase": "calibration_support", **score})
                except Exception as error:
                    failures.append({"run_id": run_id, "profile_id": candidate["profile_id"],
                                     "phase": "original_comparison", "error_type": type(error).__name__,
                                     "error": str(error)})
                    scores[run_id] = {"state": "failed", "objective_score": None}
                _progress(progress_path, state, completed_candidates=sorted(scores),
                          candidate_failures=failures)
            _progress(progress_path, state, phase="parameter_selection", current_run_id=None)
            ranked = _ranking(plan["candidates"], scores, plan["selection"].get("reference_run_id"))
            for candidate in ranked:
                candidate["comparison_id"] = comparison_ids[candidate["run_id"]]
            winner = ranked[0] if ranked else None
            pareto = _pareto(ranked, plan["selection"]["objective"])
            validation_groups = plan["selection"]["validation_group_ids"]
            validation = (_score(plan, predictions[winner["run_id"]], validation_groups, plan["normalization"])
                          if winner and validation_groups else {
                              "state": "no_selected_candidate" if not winner else "no_validation_groups",
                              "group_ids": validation_groups, "pollutant_metrics": {}, "objective_score": None})
            prediction_rows = []
            for candidate in plan["candidates"]:
                run_id = candidate["run_id"]
                for unit in plan["units"]:
                    prediction = predictions.get(run_id, {}).get(unit["id"])
                    if prediction is not None:
                        prediction_rows.append({
                            "run_id": run_id, "profile_id": candidate["profile_id"], "unit_id": unit["id"],
                            "catchment_id": unit["catchment_id"], "group_id": unit["group_id"],
                            "parameter": unit["parameter"], "partition": unit["partition"], "units": unit["units"],
                            "observed_annual_mass": unit["observed_annual_mass"], **prediction})
            profile_count = len({candidate["profile_id"] for candidate in plan["candidates"]})
            known_outputs = [set(candidate["available_parameters"]) for candidate in plan["candidates"]
                             if "available_parameters" in candidate]
            common_outputs = (set.intersection(*known_outputs)
                              if len(known_outputs) == len(plan["candidates"]) else None)
            result = workspace._save(RESULT_KIND, {
                "version": VERSION, "plan_id": plan_id, "workspace_id": workspace.project["id"],
                "candidate_count": len(plan["candidates"]), "distinct_profile_count": profile_count,
                "predicted_parameters": [parameter for parameter in PARAMETERS if parameter in plan["selection"]["objective"]],
                "common_parameters": ([parameter for parameter in PARAMETERS if parameter in common_outputs]
                                      if common_outputs is not None else plan.get("common_parameters")),
                "native_execution": execution,
                "selected_models": winner.get("selected_models") if winner else None,
                "selected_model_scope": winner.get("model_scope") if winner else None,
                "title": plan["selection"]["title"], "state": "complete" if winner else "no_eligible_candidates",
                "selected_run_id": winner["run_id"] if winner else None,
                "selected_profile_id": winner["profile_id"] if winner else None,
                "ranked_candidates": ranked, "candidate_failures": failures,
                "selected_validation": validation, "pareto_run_ids": pareto,
                "candidate_envelope": _envelope(plan, predictions, pareto),
                "group_stability": _stability(plan, predictions, ranked) if ranked else {"state": "no_selected_candidate"},
                "prediction_rows": prediction_rows, "reference_units": plan["units"],
                "normalization": plan["normalization"], "spatial_groups": plan["spatial_groups"],
                "observations": plan["observations"], "source_vintages": plan["source_vintages"],
                "excluded_reference_records": plan["exclusions"], "comparison_ids": comparison_ids,
                "objective": plan["selection"]["objective"], "temporal_method": plan["temporal_method"],
                "selection_method": plan["score_method"],
                "evaluation_design": "spatial_holdout" if validation_groups else "calibration_only",
                "candidate_comparison": ("parameter_selection" if profile_count > 1 else
                                         "execution_scope_reference_evaluation" if len(plan["candidates"]) > 1
                                         else "single_candidate_reference_evaluation"),
                "working_profile_status": "Selected by the declared annual-reference objective" if winner else "No candidate has the complete declared calibration support",
                "envelope_meaning": "Range and median across completed calibration-Pareto candidate runs. "
                                    "Distinct profile counts identify repeated execution scopes of one profile; "
                                    "the summaries describe the actual selected native candidates.",
                "reference_interpretation": "Original annual-load methods, estimator identity, qualifiers, periods "
                                            "and uncertainty retain their source meanings. Held-out evaluation "
                                            "uses only the selected working candidate; it never changes its rank. "
                                            "Spatial grouping keeps shared upstream land and station aliases together. "
                                            "Source and model period differences, reservoirs, point sources, stream-bank "
                                            "erosion and other omitted processes remain scientific interpretation inputs.",
                "notes": plan["selection"]["notes"], "references": REFERENCES,
            })
            _progress(progress_path, state, state=result["state"], phase="complete", result_id=result["id"])
            return result
        except BaseException as error:
            phase = state.get("phase", "analysis")
            try:
                _progress(progress_path, state,
                          state="interrupted" if isinstance(error, (KeyboardInterrupt, SystemExit)) else "failed",
                          phase=phase, error={"type": type(error).__name__, "message": str(error)})
            except OSError:
                pass
            raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--output", help="Optional destination for the exact returned JSON")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("catalog")
    for name in ("preview", "prepare"):
        command = commands.add_parser(name)
        command.add_argument("selection", help="Original calibration-selection JSON")
    for name in ("inspect", "analyze"):
        command = commands.add_parser(name)
        command.add_argument("plan_id")
    arguments = parser.parse_args(argv)
    try:
        workspace = Workspace(arguments.workspace)
        if arguments.command == "catalog":
            result = catalog(workspace)
        elif arguments.command in ("preview", "prepare"):
            result = globals()[arguments.command](workspace, read_json(arguments.selection))
        else:
            result = globals()[arguments.command](workspace, arguments.plan_id)
        if arguments.output:
            atomic_json(Path(arguments.output), result, immutable=True)
        print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))
        return 0 if result.get("state") not in ("no_eligible_candidates", "failed") else 2
    except (ValueError, OSError, RuntimeError, KeyError, TypeError, ArithmeticError) as error:
        print("Calibration error: " + str(error), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
