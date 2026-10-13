"""Scientific diagnostics for original Upper Savannah native model runs.

The input is an explicit cohort of Workspace run IDs.  No model is run, no
profile is changed, and no experiment design is silently generated.  Raster
totals retain the native adapter's rate_to_mass metadata; paired statistics
use an explicitly materialized common valid-cell mask.  Design summaries
are descriptive statistics over distinct profiles, with the complete expected
profile-by-scenario matrix retained even when native runs are unfinished.
Explicit native model selections distinguish inactive NDR/SDR outputs from
missing selected outputs and remain part of each scientific configuration.
"""
from __future__ import annotations

import copy
import csv
import hashlib
import html
import importlib
import importlib.metadata
import json
import math
import statistics
import time
from pathlib import Path

from .common import (
    INVEST_VERSION, atomic_json, canonical, describe_file, digest, held, identifier,
    now, read_json, verify_file,
)
from .native_versions import POLICY as NATIVE_VERSION_POLICY
from .native_versions import comparison_versions, model_versions, version_label

SCHEMA = "upstate.experiment-diagnostics/v1"
ENGINE_VERSION = "ES26-diagnostics-3"
OPERATION_ID = "UPSTATE-SCIENTIFIC-EXPERIMENTS-ES26-20261012"
METRICS = {
    "nitrogen_export": ("nitrogen", "kg/year"),
    "phosphorus_export": ("phosphorus", "kg/year"),
    "sediment_export": ("sediment", "t/year"),
}
METRIC_MODELS = {
    "nitrogen_export": "ndr", "phosphorus_export": "ndr", "sediment_export": "sdr",
}
# Original rasters.MASS_UNITS and observations.NATIVE spell sediment mass as
# metric_tonnes. The report uses the equivalent SI symbol t. These aliases have
# scale 1; a per-hectare rate or concentration never becomes an admitted mass.
_ANNUAL_MASS_ALIASES = {
    "nitrogen": ("kg/year",),
    "phosphorus": ("kg/year",),
    "sediment": ("t/year", "metric_tonnes/year"),
}


def _canonical_mass_units(parameter, units, *, pixel=False):
    if not isinstance(units, str):
        return None
    aliases = _ANNUAL_MASS_ALIASES.get(parameter, ())
    if pixel:
        aliases = tuple(value.replace("/year", "/pixel/year") for value in aliases)
    if units not in aliases:
        return None
    canonical_units = "t/year" if parameter == "sediment" else "kg/year"
    return canonical_units.replace("/year", "/pixel/year") if pixel else canonical_units


def _comparison_mass_row(row):
    """Copy a retained comparison row with explicit identity-scale unit spelling."""
    source_units = row.get("units")
    units = _canonical_mass_units(row.get("parameter"), source_units)
    if units is None:
        return dict(row)
    return {
        **row, "units": units, "source_comparison_units": source_units,
        "unit_scale_to_report": 1.0,
    }


def _hash_file(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def _source(ws):
    modules = {}
    for role, name in (
        ("diagnostics", __name__),
        ("workspace", type(ws).__module__),
        ("native", __package__ + ".native"),
        ("observations", __package__ + ".observations"),
        ("rasters", __package__ + ".rasters"),
        ("common", __package__ + ".common"),
        ("native_versions", __package__ + ".native_versions"),
        ("model_selection", __package__ + ".model_selection"),
    ):
        module = importlib.import_module(name)
        path = getattr(module, "__file__", None)
        modules[role] = {"module": name, "sha256": _hash_file(path) if path else None}
    # Distribution metadata is available without importing the large GIS stacks.
    # These versions and the original comparison/geometry modules invalidate a
    # retained result when its scientific computation dependencies change.
    runtime_dependencies = {}
    for name in ("numpy", "rasterio", "pyproj", "shapely", "fiona", "natcap.invest"):
        try:
            runtime_dependencies[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            runtime_dependencies[name] = None
    result = {
        "operation_id": OPERATION_ID, "engine_version": ENGINE_VERSION,
        "application_invest_version": INVEST_VERSION, "modules": modules,
        "native_version_policy": NATIVE_VERSION_POLICY,
        "runtime_dependencies": runtime_dependencies,
    }
    result["sha256"] = digest(result)
    return result


def _root(ws):
    return Path(ws.root) / "experiment-diagnostics"


def _folder(ws, diagnostic_id):
    identifier(diagnostic_id)
    return _root(ws) / diagnostic_id


def _finite(value):
    return (
        not isinstance(value, bool)
        and isinstance(value, (float, int))
        and math.isfinite(value)
    )


def _unique_ids(values, name):
    if not isinstance(values, list) or not values:
        raise ValueError(name + " must be a nonempty list")
    result = []
    for value in values:
        identifier(value)
        if value not in result:
            result.append(value)
    return result


def _model_names(value, location):
    """Normalize an explicit native declaration; never infer from output presence."""
    if not isinstance(value, list) or not value or any(not isinstance(name, str) for name in value):
        raise ValueError(location + " must select ndr, sdr, or both")
    names = [name.strip().lower() for name in value]
    if len(set(names)) != len(names) or set(names) - {"ndr", "sdr"}:
        raise ValueError(location + " has duplicate or unknown models")
    return [name for name in ("ndr", "sdr") if name in names]


def _run_model_scope(run):
    # Native prepare_run resolves grid inheritance and pins any selected subset
    # into run.selection.  The original run_models helper interprets omission as
    # both models; re-inheriting here would change an already retained selection.
    selection = run["selection"]
    if "models" in selection:
        return {
            "models": _model_names(selection["models"], "run.selection.models"),
            "source": "run.selection.models",
        }
    return {
        "models": ["ndr", "sdr"],
        "source": "run.selection canonical or historical both-model default",
    }


def _normalize(ws, selection):
    if not isinstance(selection, dict):
        raise ValueError("Diagnostic selection must be an object")
    for key in ("baseline_scenario_id", "reference_profile_id", "run_ids"):
        if key not in selection:
            raise ValueError("Missing diagnostic field: " + key)
    baseline = selection["baseline_scenario_id"]
    reference = selection["reference_profile_id"]
    identifier(baseline)
    identifier(reference)
    run_ids = _unique_ids(selection["run_ids"], "run_ids")
    runs = [ws.inspect_run(run_id) for run_id in run_ids]
    grids = {run["selection"]["grid_id"] for run in runs}
    if len(grids) != 1:
        raise ValueError("All diagnostic runs must use the same original grid")
    grid_id = next(iter(grids))
    # Requested-version text is part of the immutable original selection. Actual
    # compatibility is checked separately for each metric using producing stages.
    keys = [(run["selection"]["profile_id"], run["selection"]["scenario_id"]) for run in runs]
    if len(set(keys)) != len(keys):
        raise ValueError("Only one original run may occupy each profile/scenario cell")
    actual_profiles = sorted({key[0] for key in keys})
    actual_scenarios = sorted({key[1] for key in keys})
    profiles = _unique_ids(
        selection.get("expected_profile_ids", [reference] + actual_profiles),
        "expected_profile_ids",
    )
    scenarios = _unique_ids(
        selection.get("scenario_ids", [baseline] + actual_scenarios), "scenario_ids"
    )
    if reference not in profiles or baseline not in scenarios:
        raise ValueError("The declared matrix must include the reference profile and baseline")
    if not set(actual_profiles).issubset(profiles) or not set(actual_scenarios).issubset(scenarios):
        raise ValueError("Provided runs fall outside the declared expected matrix")
    profiles = [reference] + sorted(set(profiles) - {reference})
    scenarios = [baseline] + sorted(set(scenarios) - {baseline})
    profile_records, scenario_records = {}, {}
    for key in profiles:
        try:
            profile_records[key] = ws._get("profiles", key)
        except Exception as exc:
            if key in actual_profiles or key == reference:
                raise
            profile_records[key] = {
                "id": key, "unavailable": True, "ndr": {}, "sdr": {},
                "source_error": {"type": type(exc).__name__, "message": str(exc)},
            }
    for key in scenarios:
        try:
            scenario_records[key] = ws._get("scenarios", key)
        except Exception as exc:
            if key in actual_scenarios or key == baseline:
                raise
            scenario_records[key] = {
                "id": key, "kind": "unavailable", "unavailable": True,
                "source_error": {"type": type(exc).__name__, "message": str(exc)},
            }
    if scenario_records[baseline].get("kind") != "baseline":
        raise ValueError("The named baseline must be an original baseline scenario")
    design = selection.get("design", "explicit_run_set")
    if design not in ("full_factorial", "one_at_a_time", "explicit_run_set"):
        raise ValueError("design must be full_factorial, one_at_a_time, or explicit_run_set")
    tolerances = selection.get("tolerances", {})
    if not isinstance(tolerances, dict) or set(tolerances) - set(METRICS):
        raise ValueError("tolerances must map export metric names to absolute mass tolerances")
    for metric, tolerance in tolerances.items():
        if not _finite(tolerance) or tolerance < 0:
            raise ValueError(metric + " tolerance must be finite and nonnegative")
    top_k = selection.get("top_k", 1)
    if isinstance(top_k, bool) or not isinstance(top_k, int) or top_k < 1:
        raise ValueError("top_k must be a positive integer")
    observations = copy.deepcopy(selection.get("observations", []))
    if not isinstance(observations, list):
        raise ValueError("observations must be a list")
    seen = set()
    for item in observations:
        if not isinstance(item, dict) or set(item) != {"observation_id", "catchments"}:
            raise ValueError("Each observation request needs observation_id and catchments")
        identifier(item["observation_id"])
        catchments = item["catchments"]
        if not isinstance(catchments, dict):
            raise ValueError("catchments must be an object")
        for key in ("source_collection_id", "source_id", "id_field"):
            if not catchments.get(key):
                raise ValueError("catchments." + key + " is required")
        identifier(catchments["source_collection_id"])
        key = digest(item)
        if key in seen:
            raise ValueError("Duplicate observation request")
        seen.add(key)
    normalized = {
        "title": str(selection.get("title", "Scientific experiment diagnostics")),
        "purpose": str(selection.get("purpose", "")),
        "campaign_id": selection.get("campaign_id"),
        "design": design, "grid_id": grid_id,
        "baseline_scenario_id": baseline, "reference_profile_id": reference,
        "run_ids": sorted(run_ids), "expected_profile_ids": profiles,
        "scenario_ids": scenarios, "observations": observations,
        "tolerances": {key: float(tolerances.get(key, 0)) for key in METRICS},
        "top_k": top_k,
    }
    grid = ws.get_grid(grid_id)
    model_scopes = {}
    for run in runs:
        try:
            model_scopes[run["id"]] = _run_model_scope(run)
        except Exception as exc:
            model_scopes[run["id"]] = {
                "models": None, "source": "unresolved declaration",
                "error": {"type": type(exc).__name__, "message": str(exc)},
            }
    snapshots = {
        "grid": grid, "run_model_scopes": model_scopes,
        "profiles": profile_records, "scenarios": scenario_records,
        "runs": sorted(runs, key=lambda row: row["id"]),
    }
    return normalized, snapshots


def _profile_info(profile_id, profiles, reference, run_matrix):
    profile = profiles[profile_id]
    base = profiles[reference]
    model_plan = {
        row["scenario_id"]: row["models"]
        for row in run_matrix if row["profile_id"] == profile_id
    }
    if profile.get("unavailable"):
        return {
            "profile_id": profile_id, "title": "Unprepared profile " + profile_id[:12],
            "is_reference": False, "parameter_values": {}, "changed_parameters": {},
            "same_biophysical_table_as_reference": False,
            "biophysical_table_sha256": None, "structural_group_id": "unavailable",
            "structural_factors": None, "structural_membership_known": False,
            "source_error": profile.get("source_error"),
            "parameter_configuration_sha256": "unavailable-" + profile_id,
            "models": None, "run_models_by_scenario": model_plan,
        }
    profile_models = _model_names(profile.get("models", ["ndr", "sdr"]), "profile.models")
    values, changes = {}, {}
    for family in ("ndr", "sdr"):
        settings, base_settings = profile.get(family, {}), base.get(family, {})
        for key in sorted(set(settings) | set(base_settings)):
            name = family + "." + key
            value = settings.get(key)
            values[name] = value
            if value != base_settings.get(key):
                changes[name] = {"reference": base_settings.get(key), "variant": value}
    table_hash = profile.get("table_summary", {}).get("sha256")
    base_hash = base.get("table_summary", {}).get("sha256")
    structural = {
        "ndr_flow_dir_algorithm": profile.get("ndr", {}).get("flow_dir_algorithm"),
        "sdr_flow_dir_algorithm": profile.get("sdr", {}).get("flow_dir_algorithm"),
        "model_period": profile.get("model_period"),
        "models": profile_models, "run_models_by_scenario": model_plan,
    }
    return {
        "profile_id": profile_id,
        "title": profile.get("title", profile_id[:12]),
        "is_reference": profile_id == reference,
        "parameter_values": values, "changed_parameters": changes,
        "same_biophysical_table_as_reference": bool(table_hash and table_hash == base_hash),
        "biophysical_table_sha256": table_hash,
        "structural_group_id": digest(structural),
        "structural_factors": structural,
        "structural_membership_known": all(value is not None for value in model_plan.values()),
        "models": profile_models, "run_models_by_scenario": model_plan,
        "parameter_configuration_sha256": digest({
            "ndr": profile.get("ndr", {}), "sdr": profile.get("sdr", {}),
            "models": profile_models, "run_models_by_scenario": model_plan,
            "biophysical_table_sha256": table_hash,
            "model_period": profile.get("model_period"),
        }),
    }


def _state_write(folder, state, phase=None):
    if phase:
        state["phase"] = phase
    state["updated_at"] = now()
    if "_attempt_clock" in state:
        state["elapsed_seconds"] = state["_prior_elapsed"] + time.monotonic() - state["_attempt_clock"]
    atomic_json(folder / "state.json", {
        key: value for key, value in state.items() if not key.startswith("_")
    })


def _error(stage, exc, **context):
    return {"stage": stage, "type": type(exc).__name__, "message": str(exc), **context}


def _describe(ws, path, source_stamp, **metadata):
    return describe_file(ws.root, path, source_sha256=source_stamp["sha256"], **metadata)


def _stamp_rows(rows, diagnostic_id, source_stamp):
    return [
        {"diagnostic_id": diagnostic_id, "source_sha256": source_stamp["sha256"], **row}
        for row in rows
    ]


def _csv(path, rows, diagnostic_id, source_stamp, empty_fields=()):
    stamped = _stamp_rows(rows, diagnostic_id, source_stamp)
    if not stamped:
        stamped = _stamp_rows([{"record_type": "empty_export", "row_count": 0}], diagnostic_id, source_stamp)
    fields = ["diagnostic_id", "source_sha256"]
    for key in empty_fields:
        if key not in fields:
            fields.append(key)
    for row in stamped:
        for key in row:
            if key not in fields:
                fields.append(key)
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in stamped:
            writer.writerow({
                key: json.dumps(value, sort_keys=True, allow_nan=False)
                if isinstance(value, (dict, list)) else value
                for key, value in row.items()
            })
    temporary.replace(path)


def _producing_versions(run, models):
    """Retain the original policy, including explicitly labeled legacy fallback."""
    if not run or not models:
        return {}
    try:
        return model_versions(run, models)
    except Exception as exc:
        return {
            model: {"model": model, "comparison_version": None, "basis": "unavailable",
                    "error": {"type": type(exc).__name__, "message": str(exc)}}
            for model in models
        }


def _version_cohort(runs, model):
    """Compare every supplied complete applicable run; never pick a subset."""
    runs = sorted(runs, key=lambda row: row["id"])
    result = {
        "policy": NATIVE_VERSION_POLICY, "models": [model],
        "run_ids": [run["id"] for run in runs],
        "runs": {run["id"]: _producing_versions(run, [model]) for run in runs},
        "versions": {}, "state": "unavailable",
        "reason": "No completed applicable native runs are available",
    }
    if not runs:
        return result
    try:
        compared = comparison_versions(runs, [model])
    except Exception as exc:
        result.update(state="incompatible", reason=str(exc), error_type=type(exc).__name__)
        return result
    result.update(compared, state="compatible", reason=None)
    return result


def _run_matrix(selection, snapshots):
    by_cell = {
        (row["selection"]["profile_id"], row["selection"]["scenario_id"]): row
        for row in snapshots["runs"]
    }
    rows = []
    for profile_id in selection["expected_profile_ids"]:
        for scenario_id in selection["scenario_ids"]:
            run = by_cell.get((profile_id, scenario_id))
            scope = snapshots["run_model_scopes"][run["id"]] if run else {
                "models": None, "source": "missing run",
            }
            versions = _producing_versions(run, scope["models"])
            rows.append({
                "profile_id": profile_id, "scenario_id": scenario_id,
                "run_id": run["id"] if run else None,
                "selection": copy.deepcopy(run["selection"]) if run else None,
                "models": scope["models"], "models_source": scope["source"],
                "models_error": scope.get("error"),
                "model_versions": versions,
                "native_version_summary": "; ".join(
                    model.upper() + ": " + version_label(info)
                    for model, info in versions.items()
                ),
                "state": run.get("state", "unknown") if run else "missing",
                "is_reference": profile_id == selection["reference_profile_id"],
                "is_baseline": scenario_id == selection["baseline_scenario_id"],
                "error": (run.get("error") or run.get("errors")) if run else None,
                "runtime": run.get("runtime", {}) if run else {},
                "stages": run.get("stages", {}) if run else {},
            })
    return rows


def _shared_support(ws, folder, diagnostic_id, source_stamp, metric, snapshots):
    """Aggregate one metric on one exact common footprint, with at most two
    raster datasets open at once regardless of the number of design profiles.
    """
    records, errors, selected_run_ids, not_selected = [], [], [], []
    completed_selected_runs = []
    model = METRIC_MODELS[metric]
    for run in snapshots["runs"]:
        scope = snapshots["run_model_scopes"][run["id"]]
        if scope["models"] is None:
            errors.append({
                "stage": "metric-source", "run_id": run["id"], "metric": metric,
                "message": "Native model selection is unresolved", "detail": scope.get("error"),
            })
            continue
        if model not in scope["models"]:
            not_selected.append({
                "run_id": run["id"], "profile_id": run["selection"]["profile_id"],
                "scenario_id": run["selection"]["scenario_id"],
                "state": "model_not_selected", "models": scope["models"],
                "models_source": scope["source"],
                "artifact_present": bool(run.get("artifacts", {}).get(metric)),
            })
            continue
        selected_run_ids.append(run["id"])
        if run.get("state") != "complete":
            continue
        completed_selected_runs.append(run)
        if model not in (run.get("stages") or {}):
            errors.append({"stage": "metric-source", "run_id": run["id"],
                           "metric": metric, "model": model,
                           "message": "Complete run lacks its selected native model stage"})
            continue
        artifact = run.get("artifacts", {}).get(metric)
        if not artifact:
            errors.append({"stage": "metric-source", "run_id": run["id"],
                           "metric": metric, "model": model,
                           "message": "Complete run lacks an artifact for its selected model"})
            continue
        try:
            parameter, expected_sum_units = METRICS[metric]
            expected_pixel_units = expected_sum_units.replace("/year", "/pixel/year")
            if _canonical_mass_units(parameter, artifact.get("units"), pixel=True) != expected_pixel_units:
                raise ValueError("Expected normalized per-pixel mass units: " + expected_pixel_units)
            if _canonical_mass_units(parameter, artifact.get("sum_units")) != expected_sum_units:
                raise ValueError("Unexpected normalized mass sum units")
            if not _finite(artifact.get("sum")):
                raise ValueError("Normalized artifact has no finite mass total")
            path = verify_file(Path(ws.root) / "runs" / run["id"], artifact)
            records.append({"run": run, "artifact": artifact, "path": path})
        except Exception as exc:
            errors.append(_error("metric-source", exc, run_id=run["id"], metric=metric))
    versions = _version_cohort(completed_selected_runs, model)
    model_coverage = {
        "native_versions": versions,
        "native_version_state": versions["state"],
        "native_version_reason": versions["reason"],
        "available_artifact_run_ids": [record["run"]["id"] for record in records],
        "model": model, "selected_run_ids": selected_run_ids,
        "selected_run_count": len(selected_run_ids),
        "model_not_selected_run_ids": [row["run_id"] for row in not_selected],
        "model_not_selected": not_selected,
        "model_not_selected_run_count": len(not_selected),
    }
    if versions["state"] == "incompatible":
        errors.append({
            "stage": "native-version-cohort", "metric": metric, "model": model,
            "run_ids": versions["run_ids"], "message": versions["reason"],
        })
        return {
            "metric": metric, "values": [], "errors": errors,
            "common_support": {
                "metric": metric, "run_ids": [], "valid_cells": None,
                "state": "incompatible_native_versions", "units": METRICS[metric][1],
                **model_coverage,
            },
        }
    if not records:
        inactive = not selected_run_ids and not errors
        return {
            "metric": metric, "values": [], "errors": errors,
            "common_support": {
                "metric": metric, "run_ids": [], "valid_cells": None,
                "state": "model_not_selected" if inactive else "unavailable",
                "units": METRICS[metric][1], **model_coverage,
            },
        }
    import numpy as np
    import rasterio

    mask_path = folder / ("common_support_" + metric + ".tif")
    temporary = folder / ("common_support_" + metric + ".tmp.tif")
    signature, grid_cells = None, None
    for index, record in enumerate(records):
        with rasterio.open(record["path"]) as dataset:
            current = (
                dataset.width, dataset.height, str(dataset.crs),
                tuple(dataset.transform), dataset.count,
            )
            if dataset.count != 1:
                raise ValueError("Normalized export must contain exactly one raster band")
            if signature is None:
                signature = current
                grid_cells = dataset.width * dataset.height
                profile = dataset.profile.copy()
                profile.update(driver="GTiff", count=1, dtype="uint8", nodata=0,
                               compress="deflate", BIGTIFF="IF_SAFER")
            elif current != signature:
                raise ValueError("Normalized outputs have different grids or transforms: "
                                 + record["run"]["id"])
            native_count, native_parts = 0, []
            if index == 0:
                with rasterio.open(temporary, "w", **profile) as mask:
                    mask.update_tags(
                        diagnostic_id=diagnostic_id,
                        source_sha256=source_stamp["sha256"],
                        metric=metric,
                        interpretation="intersection of finite native valid pixels",
                    )
                    for _, window in dataset.block_windows(1):
                        array = dataset.read(1, window=window, masked=True)
                        data = np.ma.getdata(array)
                        valid = ~np.ma.getmaskarray(array) & np.isfinite(data)
                        mask.write(valid.astype("uint8"), 1, window=window)
                        native_count += int(valid.sum())
                        native_parts.append(float(np.sum(data[valid], dtype="float64")))
            else:
                with rasterio.open(temporary, "r+") as mask:
                    for _, window in dataset.block_windows(1):
                        array = dataset.read(1, window=window, masked=True)
                        data = np.ma.getdata(array)
                        valid = ~np.ma.getmaskarray(array) & np.isfinite(data)
                        common = mask.read(1, window=window).astype(bool) & valid
                        mask.write(common.astype("uint8"), 1, window=window)
                        native_count += int(valid.sum())
                        native_parts.append(float(np.sum(data[valid], dtype="float64")))
            record["native_valid_cells_recounted"] = native_count
            record["native_mass_recounted"] = math.fsum(native_parts)
    temporary.replace(mask_path)
    common_count = 0
    with rasterio.open(mask_path) as mask:
        for _, window in mask.block_windows(1):
            common_count += int(np.count_nonzero(mask.read(1, window=window)))
    mask_descriptor = _describe(
        ws, mask_path, source_stamp, role="comparison_support",
        units="valid-cell indicator", valid_cells=common_count,
        filename=mask_path.name,
    )
    values = []
    for record in records:
        parts = []
        with rasterio.open(record["path"]) as dataset, rasterio.open(mask_path) as mask:
            for _, window in dataset.block_windows(1):
                common = mask.read(1, window=window).astype(bool)
                if common.any():
                    data = dataset.read(1, window=window)
                    parts.append(float(np.sum(data[common], dtype="float64")))
        run = record["run"]
        artifact = record["artifact"]
        total = math.fsum(parts) if common_count else None
        values.append({
            "metric": metric, "parameter": METRICS[metric][0],
            "units": METRICS[metric][1], "model": model,
            "models": snapshots["run_model_scopes"][run["id"]]["models"],
            "models_source": snapshots["run_model_scopes"][run["id"]]["source"],
            "model_version": versions["runs"][run["id"]][model],
            "native_version_label": version_label(versions["runs"][run["id"]][model]),
            "run_id": run["id"], "profile_id": run["selection"]["profile_id"],
            "scenario_id": run["selection"]["scenario_id"],
            "grid_id": run["selection"]["grid_id"],
            "reporting_unit": "shared valid model pixels",
            "native_mass_total": artifact["sum"],
            "native_valid_cells": artifact.get("valid_cells"),
            "native_mass_recounted": record["native_mass_recounted"],
            "native_mass_metadata_difference": record["native_mass_recounted"] - artifact["sum"],
            "native_valid_cells_recounted": record["native_valid_cells_recounted"],
            "common_mass_total": total, "common_valid_cells": common_count,
            "excluded_native_cells": record["native_valid_cells_recounted"] - common_count,
            "common_fraction_of_native_cells": (
                common_count / record["native_valid_cells_recounted"]
                if record["native_valid_cells_recounted"] else None
            ),
            "artifact_sha256": artifact["sha256"],
            "artifact_path": str(Path("runs") / run["id"] / artifact["path"]),
            "native_artifact_path": artifact["path"],
            "native_units": artifact.get("native_units"),
            "normalized_pixel_units": artifact.get("units"),
            "source_sum_units": artifact.get("sum_units"),
            "canonical_pixel_units": METRICS[metric][1].replace("/year", "/pixel/year"),
            "unit_scale_to_report": 1.0,
            "pixel_area_ha": artifact.get("pixel_area_ha"),
            "support_sha256": mask_descriptor["sha256"],
        })
    support = {
        "metric": metric, "units": METRICS[metric][1], **model_coverage,
        "state": "complete" if common_count else "empty",
        "grid_id": snapshots["runs"][0]["selection"]["grid_id"],
        "run_ids": [record["run"]["id"] for record in records],
        "grid_cells": grid_cells, "valid_cells": common_count,
        "excluded_grid_cells": grid_cells - common_count,
        "raster_geometry": {
            "width": signature[0], "height": signature[1],
            "crs": signature[2], "transform": list(signature[3]),
        },
        "mask": mask_descriptor,
        "interpretation": (
            "Every common-mass total and paired contrast for this metric uses "
            "this same intersection of finite valid pixels across the listed runs. "
            "The footprint can change in a later completion snapshot. "
            "The producing version is compatible across every complete applicable run; "
            "recorded legacy fallbacks remain labeled as fallbacks."
        ),
    }
    return {"metric": metric, "values": values, "common_support": support, "errors": errors}


def _quantile(values, fraction):
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower, upper = math.floor(position), math.ceil(position)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def _spread(values, expected):
    values = [value for value in values if _finite(value)]
    return {
        "n_expected": expected, "n_complete": len(values),
        "complete": len(values) == expected,
        "minimum": min(values) if values else None,
        "q25": _quantile(values, .25),
        "median": statistics.median(values) if values else None,
        "q75": _quantile(values, .75),
        "maximum": max(values) if values else None,
    }


def _prefix(prefix, values):
    return {prefix + key: value for key, value in values.items()}


def _signs(values, tolerance):
    values = [value for value in values if _finite(value)]
    counts = {
        "negative": sum(value < -tolerance for value in values),
        "neutral": sum(abs(value) <= tolerance for value in values),
        "positive": sum(value > tolerance for value in values),
    }
    n = len(values)
    return {
        **{key + "_count": value for key, value in counts.items()},
        **{key + "_fraction": value / n if n else None for key, value in counts.items()},
        "sign_consistent": max(counts.values()) == n if n else None,
        "absolute_tolerance": tolerance,
        "fraction_interpretation": "fraction of distinct sampled design profiles",
    }


def _average_ranks(values):
    """Ascending ranks with arithmetic-average rank for exactly equal values."""
    ordered = sorted(values.items(), key=lambda item: (item[1], item[0]))
    result, index = {}, 0
    while index < len(ordered):
        end = index + 1
        while end < len(ordered) and ordered[end][1] == ordered[index][1]:
            end += 1
        average = ((index + 1) + end) / 2
        for key, _ in ordered[index:end]:
            result[key] = average
        index = end
    return result


def _correlation(xs, ys):
    if len(xs) < 2 or len(xs) != len(ys):
        return None
    mean_x, mean_y = statistics.mean(xs), statistics.mean(ys)
    dx, dy = [x - mean_x for x in xs], [y - mean_y for y in ys]
    denominator = math.sqrt(math.fsum(x*x for x in dx) * math.fsum(y*y for y in dy))
    return math.fsum(x*y for x, y in zip(dx, dy)) / denominator if denominator else None


def _summaries(selection, profile_info, metric_values, run_matrix):
    lookup = {
        (row["metric"], row["profile_id"], row["scenario_id"]): row["common_mass_total"]
        for row in metric_values if row["common_mass_total"] is not None
    }
    baseline, reference = selection["baseline_scenario_id"], selection["reference_profile_id"]
    info = {profile["profile_id"]: profile for profile in profile_info}
    model_choices = {
        (row["profile_id"], row["scenario_id"]): row["models"] for row in run_matrix
    }
    membership_known = all(profile["structural_membership_known"] for profile in profile_info)

    def applicability(model, *choices):
        if any(choice is not None and model not in choice for choice in choices):
            return "model_not_selected"
        return "model_selection_unknown" if any(choice is None for choice in choices) else "selected"

    comparisons, summaries, ranks = [], [], []
    for metric, (_, units) in METRICS.items():
        model = METRIC_MODELS[metric]
        groups, representatives, aliases = {}, {}, {}

        def preference(profile_id):
            available = sum((metric, profile_id, key) in lookup for key in selection["scenario_ids"])
            paired = available if (metric, profile_id, baseline) in lookup else 0
            return paired, available, profile_id == reference

        for profile in profile_info:
            configuration = profile["parameter_configuration_sha256"]
            profile_id = profile["profile_id"]
            aliases.setdefault(configuration, []).append(profile_id)
            previous = representatives.get(configuration)
            if previous is None or preference(profile_id) > preference(previous):
                representatives[configuration] = profile_id
        for profile in profile_info:
            if representatives[profile["parameter_configuration_sha256"]] == profile["profile_id"]:
                groups.setdefault(profile["structural_group_id"], []).append(profile["profile_id"])
        for profile_id in selection["expected_profile_ids"]:
            b = lookup.get((metric, profile_id, baseline))
            b0 = lookup.get((metric, reference, baseline))
            for scenario_id in selection["scenario_ids"]:
                value = lookup.get((metric, profile_id, scenario_id))
                reference_value = lookup.get((metric, reference, scenario_id))
                delta = value - b if value is not None and b is not None else None
                delta0 = (
                    reference_value - b0
                    if reference_value is not None and b0 is not None else None
                )
                scenario_scope = model_choices[(profile_id, scenario_id)]
                baseline_scope = model_choices[(profile_id, baseline)]
                reference_scope = model_choices[(reference, scenario_id)]
                reference_baseline_scope = model_choices[(reference, baseline)]
                comparisons.append({
                    "metric": metric, "units": units, "profile_id": profile_id,
                    "model": model,
                    "metric_applicability": applicability(model, scenario_scope),
                    "pair_applicability": applicability(model, scenario_scope, baseline_scope),
                    "interaction_applicability": applicability(
                        model, scenario_scope, baseline_scope, reference_scope, reference_baseline_scope
                    ),
                    "scenario_models": scenario_scope, "baseline_models": baseline_scope,
                    "scenario_id": scenario_id,
                    "structural_group_id": info[profile_id]["structural_group_id"],
                    "common_mass_total": value, "paired_baseline_mass": b,
                    "scenario_delta": delta,
                    "scenario_percent_change": 100 * delta / b
                    if delta is not None and b != 0 else None,
                    "reference_profile_mass": reference_value,
                    "profile_effect": value - reference_value
                    if value is not None and reference_value is not None else None,
                    "baseline_profile_effect": b - b0
                    if b is not None and b0 is not None else None,
                    "reference_scenario_delta": delta0,
                    "scenario_parameter_interaction": delta - delta0
                    if delta is not None and delta0 is not None else None,
                    "paired_complete": delta is not None,
                    "reference_comparison_complete": value is not None and reference_value is not None,
                    "same_biophysical_table_as_reference":
                        info[profile_id]["same_biophysical_table_as_reference"],
                    "changed_parameters": {
                        key: value for key, value in info[profile_id]["changed_parameters"].items()
                        if key.startswith(model + ".")
                    },
                    "all_changed_parameters": info[profile_id]["changed_parameters"],
                    "effect_interpretation": (
                        "native parameter/structural profile effect"
                        if info[profile_id]["same_biophysical_table_as_reference"]
                        else "combined profile and biophysical-table effect"
                    ),
                })
        for group_id, profiles in groups.items():
            candidates = [key for key in selection["scenario_ids"] if key != baseline]
            by_scenario = {}
            for scenario_id in selection["scenario_ids"]:
                members = [
                    row for row in comparisons
                    if row["metric"] == metric and row["scenario_id"] == scenario_id
                    and row["profile_id"] in profiles
                ]
                mass_members = [row for row in members if row["metric_applicability"] != "model_not_selected"]
                paired_members = [row for row in members if row["pair_applicability"] != "model_not_selected"]
                interaction_members = [
                    row for row in members if row["interaction_applicability"] != "model_not_selected"
                ]
                deltas = [row["scenario_delta"] for row in paired_members if row["paired_complete"]]
                by_scenario[scenario_id] = {
                    row["profile_id"]: row["scenario_delta"]
                    for row in paired_members if row["paired_complete"]
                }
                summaries.append({
                    "metric": metric, "units": units, "scenario_id": scenario_id,
                    "structural_group_id": group_id, "design": selection["design"],
                    "envelope_kind": "sampled nonprobabilistic design envelope",
                    "sampling_unit": "distinct scientific parameter configuration",
                    "representative_profile_ids": [row["profile_id"] for row in paired_members],
                    "declared_representative_profile_ids": profiles,
                    "model_not_selected_profile_ids": [
                        row["profile_id"] for row in members if row["pair_applicability"] == "model_not_selected"
                    ],
                    "coverage_state": "model_not_selected" if not paired_members else (
                        "complete" if len(deltas) == len(paired_members) else "incomplete"
                    ),
                    "equivalent_profile_aliases": {
                        profile_id: aliases[info[profile_id]["parameter_configuration_sha256"]]
                        for profile_id in profiles
                    },
                    **_prefix("mass_", _spread([row["common_mass_total"] for row in mass_members], len(mass_members))),
                    **_prefix("delta_", _spread(deltas, len(paired_members))),
                    **_prefix("interaction_", _spread(
                        [row["scenario_parameter_interaction"] for row in interaction_members], len(interaction_members)
                    )),
                    **_signs(deltas, selection["tolerances"][metric]),
                    "direction": "scenario minus baseline under the same profile",
                })
            expected_rank_profiles = [
                profile_id for profile_id in profiles
                if all(
                    applicability(
                        model, model_choices[(profile_id, scenario_id)],
                        model_choices[(profile_id, baseline)],
                    ) != "model_not_selected"
                    for scenario_id in candidates
                )
            ] if candidates else []
            eligible = [
                profile_id for profile_id in expected_rank_profiles
                if all(profile_id in by_scenario[scenario_id] for scenario_id in candidates)
            ] if candidates else []
            rank_sets, top_memberships = {}, {}
            for profile_id in eligible:
                values = {scenario_id: by_scenario[scenario_id][profile_id] for scenario_id in candidates}
                rank_sets[profile_id] = _average_ranks(values)
                top_memberships[profile_id] = {}
                k = min(selection["top_k"], len(candidates))
                for scenario_id, value in values.items():
                    better = sum(other < value for other in values.values())
                    tied = sum(other == value for other in values.values())
                    top_memberships[profile_id][scenario_id] = max(0, min(1, (k - better) / tied))
            reference_ranks = rank_sets.get(reference)
            correlations = []
            if reference_ranks is not None:
                for profile_id in eligible:
                    correlation = _correlation(
                        [reference_ranks[key] for key in candidates],
                        [rank_sets[profile_id][key] for key in candidates],
                    )
                    if correlation is not None:
                        correlations.append(correlation)
            for scenario_id in candidates:
                values = [rank_sets[profile_id][scenario_id] for profile_id in eligible]
                ranks.append({
                    "metric": metric, "units": units, "scenario_id": scenario_id,
                    "structural_group_id": group_id, "design": selection["design"],
                    **_prefix("rank_", _spread(values, len(expected_rank_profiles))),
                    "declared_profile_count": len(profiles),
                    "expected_profile_ids": expected_rank_profiles,
                    "model_not_selected_profile_ids": [key for key in profiles if key not in expected_rank_profiles],
                    "candidate_count": len(candidates), "candidate_scenario_ids": candidates,
                    "eligible_profile_ids": eligible,
                    "excluded_profile_ids": [key for key in expected_rank_profiles if key not in eligible],
                    "reference_rank": reference_ranks.get(scenario_id) if reference_ranks else None,
                    "top_k": min(selection["top_k"], len(candidates)),
                    "top_k_design_fraction": statistics.mean(
                        top_memberships[key][scenario_id] for key in eligible
                    ) if eligible else None,
                    "spearman_to_reference_median": statistics.median(correlations) if correlations else None,
                    "spearman_complete_profiles": len(correlations),
                    "rank_group_complete": bool(expected_rank_profiles) and len(eligible) == len(expected_rank_profiles),
                    "structural_membership_complete": membership_known,
                    "ranking_complete": bool(expected_rank_profiles) and len(eligible) == len(expected_rank_profiles) and membership_known,
                    "coverage_state": "model_not_selected" if not expected_rank_profiles else (
                        "complete" if len(eligible) == len(expected_rank_profiles) else "incomplete"
                    ),
                    "rank_direction": "lower paired export delta ranks first",
                    "tie_method": "average ranks; fractional top-k membership for tied scenarios",
                })
    for row in comparisons:
        changed = row["changed_parameters"]
        row["oat_parameter"] = None
        row["oat_parameter_increment"] = None
        row["oat_mass_slope"] = None
        row["oat_baseline_slope"] = None
        row["oat_scenario_response_slope"] = None
        row["oat_mass_elasticity"] = None
        if (
            len(changed) == 1 and row["same_biophysical_table_as_reference"]
            and info[row["profile_id"]]["structural_group_id"] == info[reference]["structural_group_id"]
        ):
            parameter, levels = next(iter(changed.items()))
            origin, variant = levels["reference"], levels["variant"]
            if _finite(origin) and _finite(variant) and variant != origin:
                increment = variant - origin
                row["oat_parameter"] = parameter
                row["oat_parameter_increment"] = increment
                for effect, output in (
                    ("profile_effect", "oat_mass_slope"),
                    ("baseline_profile_effect", "oat_baseline_slope"),
                    ("scenario_parameter_interaction", "oat_scenario_response_slope"),
                ):
                    if row[effect] is not None:
                        row[output] = row[effect] / increment
                if origin != 0 and row["reference_profile_mass"] not in (None, 0) and row["profile_effect"] is not None:
                    row["oat_mass_elasticity"] = (
                        row["profile_effect"] / row["reference_profile_mass"]
                    ) / (increment / origin)
    return comparisons, summaries, ranks


def _observation_key(row):
    return digest({key: row.get(key) for key in (
        "observation_id", "parameter", "units",
    )})


def _observation_score(rows):
    n = len(rows)
    if not n:
        return {
            "n": 0, "mean_bias": None, "mae": None, "rmse": None,
            "percent_bias": None, "nash_sutcliffe_efficiency": None,
            "pearson_r": None, "r_squared": None,
            "undefined_reasons": ["No common complete load observations"],
        }
    observed = [row["observed_annual_mass"] for row in rows]
    modeled = [row["modeled_annual_mass"] for row in rows]
    errors = [modeled_value - observed_value for modeled_value, observed_value in zip(modeled, observed)]
    squared = math.fsum(error * error for error in errors)
    observed_mean = statistics.mean(observed)
    variance_sum = math.fsum((value - observed_mean) ** 2 for value in observed)
    observed_sum = math.fsum(observed)
    correlation = _correlation(observed, modeled)
    reasons = []
    if observed_sum == 0:
        reasons.append("Percent bias undefined: observed mass sum is zero")
    if n < 2 or variance_sum == 0:
        reasons.append("NSE undefined: fewer than two observations or zero observed variance")
    if correlation is None:
        reasons.append("Correlation undefined: fewer than two pairs or zero variance")
    return {
        "n": n, "mean_bias": statistics.mean(errors),
        "mae": statistics.mean(abs(error) for error in errors),
        "rmse": math.sqrt(squared / n),
        "percent_bias": 100 * math.fsum(errors) / observed_sum if observed_sum else None,
        "percent_bias_direction": "positive means model overprediction",
        "nash_sutcliffe_efficiency": 1 - squared / variance_sum
        if n >= 2 and variance_sum else None,
        "pearson_r": correlation, "r_squared": correlation ** 2 if correlation is not None else None,
        "n_stations": len({row.get("station_id") for row in rows}),
        "n_catchments": len({row.get("catchment_id") for row in rows}),
        "period_count": len({(row.get("period_start"), row.get("period_end")) for row in rows}),
        "repeated_catchment_rows": n - len({row.get("catchment_id") for row in rows}),
        "undefined_reasons": reasons,
    }


def _observations(ws, folder, diagnostic_id, source_stamp, selection, snapshots, state):
    baseline = selection["baseline_scenario_id"]
    expected_profiles = selection["expected_profile_ids"]
    declared_baseline_runs = {
        row["selection"]["profile_id"]: row
        for row in snapshots["runs"] if row["selection"]["scenario_id"] == baseline
    }
    baseline_runs = {
        key: row for key, row in declared_baseline_runs.items() if row.get("state") == "complete"
    }
    baseline_models = {
        key: snapshots["run_model_scopes"][row["id"]]["models"]
        for key, row in declared_baseline_runs.items()
    }
    parameter_models = {METRICS[key][0]: model for key, model in METRIC_MODELS.items()}
    output = {"requests": [], "rows": [], "scores": [], "errors": [], "artifacts": {}}
    allowed_units = {parameter: units for parameter, units in METRICS.values()}
    for request in selection["observations"]:
        request_id = digest(request)
        try:
            source_observations = ws._get("observations", request["observation_id"])
            source_rows = source_observations["rows"]
            source_path = folder / ("observation_source_" + request_id + ".json")
            atomic_json(source_path, {
                "schema": "upstate.diagnostic-observation-roster/v1",
                "diagnostic_id": diagnostic_id, "source_stamp": source_stamp,
                "request": request, "source_observations": source_observations,
            })
            output["artifacts"]["observation_source_" + request_id] = _describe(
                ws, source_path, source_stamp, filename=source_path.name
            )
            expected_rows = {}
            source_exclusions = []
            for row in source_rows:
                if (
                    row.get("admitted") is True
                    and row.get("parameter") in allowed_units
                    and _canonical_mass_units(row["parameter"], row.get("comparison_units"))
                    == allowed_units[row["parameter"]]
                    and _finite(row.get("annual_mass"))
                    and row.get("id") is not None
                ):
                    normalized_row = {
                        **row, "observation_id": row["id"],
                        "observed_annual_mass": row["annual_mass"],
                        "units": allowed_units[row["parameter"]],
                        "source_comparison_units": row["comparison_units"],
                        "unit_scale_to_report": 1.0,
                    }
                    key = _observation_key(normalized_row)
                    if key in expected_rows:
                        raise ValueError("Duplicate admitted source observation ID: " + str(row["id"]))
                    expected_rows[key] = normalized_row
                else:
                    source_exclusions.append(row)
        except Exception as exc:
            issue = _error("observation-source-roster", exc,
                           observation_id=request["observation_id"])
            output["errors"].append(issue)
            output["requests"].append({
                "request_id": request_id, "observation_id": request["observation_id"],
                "expected_profile_ids": expected_profiles,
                "source_roster_state": "unavailable", "error": issue, "cohorts": [],
            })
            continue
        comparisons = {}
        failure_profiles = {}
        requested_models = {parameter_models[row["parameter"]] for row in expected_rows.values()}
        request_not_selected = [
            key for key in expected_profiles
            if requested_models and baseline_models.get(key) is not None
            and requested_models.isdisjoint(baseline_models[key])
        ]
        request_expected_profiles = [key for key in expected_profiles if key not in request_not_selected]
        for profile_id in request_expected_profiles if expected_rows else []:
            run = baseline_runs.get(profile_id)
            if run is None:
                failure_profiles[profile_id] = "Baseline run is missing or unfinished"
                continue
            key = digest({"request": request, "run_id": run["id"]})
            filename = "observation_" + key + ".json"
            cached = state.setdefault("observation_calls", {}).get(key)
            try:
                if cached:
                    wrapper = read_json(verify_file(ws.root, cached))
                    comparison = wrapper["comparison"]
                else:
                    comparison = ws.compare_observations(
                        run["id"], request["observation_id"], request["catchments"]
                    )
                    wrapper = {
                        "schema": "upstate.diagnostic-observation-source/v1",
                        "diagnostic_id": diagnostic_id, "source_stamp": source_stamp,
                        "request": request, "profile_id": profile_id,
                        "run_id": run["id"], "comparison": comparison,
                    }
                    atomic_json(folder / filename, wrapper)
                    cached = _describe(ws, folder / filename, source_stamp, filename=filename)
                    state["observation_calls"][key] = cached
                    _state_write(folder, state, "observations")
                if comparison.get("comparison_version") != 3:
                    raise ValueError("Full-catchment observation comparison version 3 is required")
                comparisons[profile_id] = comparison
                output["artifacts"]["observation_" + key] = cached
                for row in comparison.get("comparisons", []):
                    output["rows"].append({
                        "request_id": request_id, "profile_id": profile_id,
                        "run_id": run["id"], "comparison_id": comparison.get("id"),
                        **_comparison_mass_row(row),
                        "model_version": _producing_versions(
                            run, [parameter_models[row["parameter"]]]
                        ).get(parameter_models[row["parameter"]])
                        if row.get("parameter") in parameter_models else None,
                    })
            except Exception as exc:
                failure_profiles[profile_id] = str(exc)
                output["errors"].append(_error(
                    "observations", exc, profile_id=profile_id, run_id=run["id"],
                    observation_id=request["observation_id"],
                ))
        request_report = {
            "request_id": request_id, "observation_id": request["observation_id"],
            "catchments": request["catchments"],
            "source_roster_state": "complete",
            "source_observation_sha256": digest(source_observations),
            "source_admitted_observation_count": len(expected_rows),
            "source_admission_exclusions": source_exclusions,
            "declared_profile_ids": expected_profiles,
            "expected_profile_ids": request_expected_profiles,
            "model_not_selected_profile_ids": request_not_selected,
            "compared_profile_ids": sorted(comparisons),
            "missing_profile_ids": sorted(set(request_expected_profiles) - set(comparisons)) if expected_rows else [],
            "failures": failure_profiles,
            "comparison_exclusions": {
                key: {"exclusions": value.get("exclusions", []),
                      "metrics_exclusions": value.get("metrics_exclusions", [])}
                for key, value in comparisons.items()
            },
            "cohorts": [],
            "interpretation": (
                "Baseline scenarios are compared with observed annual loads. "
                "Common-cohort scores use exactly the same admitted observation "
                "rows in every available profile. Full expected-cohort scores "
                "also require every profile selected for that pollutant and every comparable observation. "
                "Explicitly inactive model profiles remain listed separately; the source observation roster is unchanged. "
                "The native metric_tonnes spelling and report symbol t have identity scale 1; "
                "original comparison units remain in source_comparison_units."
            ),
        }
        for parameter, units in allowed_units.items():
            model = parameter_models[parameter]
            not_selected_profiles = [
                key for key in expected_profiles
                if baseline_models.get(key) is not None and model not in baseline_models[key]
            ]
            parameter_expected_profiles = [
                key for key in expected_profiles if key not in not_selected_profiles
            ]
            expected_parameter_rows = {
                key: row for key, row in expected_rows.items()
                if row["parameter"] == parameter and row["units"] == units
            }
            # Observation fits compare only the applicable baseline runs. A
            # hypothetical scenario version must not invalidate a compatible
            # baseline-only observation cohort, and failed comparisons must not
            # silently remove an incompatible baseline from this check.
            native_versions = _version_cohort([
                run for key, run in baseline_runs.items()
                if key in parameter_expected_profiles and baseline_models.get(key) is not None
                and model in baseline_models[key]
            ], model)
            version_blocked = native_versions["state"] == "incompatible"
            maps, all_keys = {}, set(expected_parameter_rows)
            key_metadata = {
                key: {field: row.get(field) for field in (
                    "observation_id", "catchment_id", "station_id",
                    "period_start", "period_end", "units", "observed_annual_mass",
                    "source_comparison_units", "unit_scale_to_report",
                )}
                for key, row in expected_parameter_rows.items()
            }
            for profile_id, comparison in comparisons.items():
                if profile_id not in parameter_expected_profiles:
                    continue
                admitted, seen = {}, set()
                for original_row in comparison.get("comparisons", []):
                    row = _comparison_mass_row(original_row)
                    if row.get("parameter") != parameter or row.get("units") != units:
                        continue
                    key = _observation_key(row)
                    if key not in expected_parameter_rows:
                        output["errors"].append({
                            "stage": "observation-membership", "profile_id": profile_id,
                            "observation_id": row.get("observation_id"),
                            "message": "Comparison row is outside the admitted source roster",
                        })
                        continue
                    if key in seen:
                        admitted.pop(key, None)
                        output["errors"].append({
                            "stage": "observation-membership", "profile_id": profile_id,
                            "observation_id": row.get("observation_id"),
                            "message": "Duplicate observation/catchment/period row in comparison "
                                       + str(comparison.get("id")),
                        })
                        continue
                    seen.add(key)
                    if row.get("observed_annual_mass") != expected_parameter_rows[key]["observed_annual_mass"]:
                        output["errors"].append({
                            "stage": "observation-membership", "profile_id": profile_id,
                            "observation_id": row.get("observation_id"),
                            "message": "Comparison observed mass differs from the source roster",
                        })
                        continue
                    if (
                        row.get("included_in_metrics") is True
                        and row.get("coverage_status") == "complete"
                        and _finite(row.get("observed_annual_mass"))
                        and _finite(row.get("modeled_annual_mass"))
                    ):
                        admitted[key] = row
                maps[profile_id] = admitted
            if not all_keys:
                continue
            if version_blocked:
                output["errors"].append({
                    "stage": "observation-native-versions", "request_id": request_id,
                    "parameter": parameter, "model": model,
                    "run_ids": native_versions["run_ids"], "message": native_versions["reason"],
                })
            common = set.intersection(*(set(value) for value in maps.values())) if maps else set()
            inconsistent = {
                key for key in common
                if len({maps[profile_id][key]["observed_annual_mass"] for profile_id in maps}) != 1
            }
            common -= inconsistent
            common = sorted(common)
            expected_keys = sorted(all_keys)
            cohort_hash = digest({
                "request_id": request_id, "parameter": parameter, "units": units,
                "observation_keys": common,
                "observed_annual_masses": [
                    expected_parameter_rows[key]["observed_annual_mass"] for key in common
                ],
            })
            complete = (
                bool(parameter_expected_profiles) and len(maps) == len(parameter_expected_profiles)
                and set(common) == all_keys and not inconsistent and not version_blocked
            )
            cohort = {
                "parameter": parameter, "units": units,
                "observation_set_hash": cohort_hash,
                "n_expected_observations": len(all_keys),
                "n_common_observations": len(common),
                "full_expected_cohort_complete": complete,
                "expected_observation_keys": expected_keys,
                "common_observation_keys": common,
                "omitted_observation_keys": sorted(all_keys - set(common)),
                "inconsistent_observed_value_keys": sorted(inconsistent),
                "observation_members": key_metadata,
                "declared_profile_ids": expected_profiles,
                "expected_profile_ids": parameter_expected_profiles,
                "model_not_selected_profile_ids": not_selected_profiles,
                "compared_profile_ids": sorted(maps),
                "missing_profile_ids": sorted(set(parameter_expected_profiles) - set(maps)),
                "native_versions": native_versions,
                "native_version_state": native_versions["state"],
                "native_version_reason": native_versions["reason"],
                "coverage_state": "model_not_selected" if not parameter_expected_profiles else (
                    "incompatible_native_versions" if version_blocked else
                    "complete" if complete else "incomplete"
                ),
            }
            request_report["cohorts"].append(cohort)
            for profile_id in parameter_expected_profiles:
                rows = [maps[profile_id][key] for key in common] if profile_id in maps else []
                score = _observation_score(rows) if not version_blocked else None
                result = {
                    "request_id": request_id, "parameter": parameter, "units": units,
                    "profile_id": profile_id,
                    "run_id": baseline_runs.get(profile_id, {}).get("id"),
                    "comparison_role": "baseline annual-load diagnostic",
                    "model": model,
                    "expected_profile_ids": parameter_expected_profiles,
                    "model_not_selected_profile_ids": not_selected_profiles,
                    "observation_set_hash": cohort_hash,
                    "n_expected_observations": len(all_keys),
                    "n_common_observations": len(common),
                    "profile_available": profile_id in maps,
                    "native_versions": native_versions,
                    "native_version_state": native_versions["state"],
                    "native_version_reason": native_versions["reason"],
                    "score_state": "incompatible_native_versions" if version_blocked else (
                        "available" if profile_id in maps and common else "unavailable"
                    ),
                    "full_expected_cohort_complete": complete,
                    "common_cohort_score": score if profile_id in maps else None,
                    "full_expected_cohort_score": score if complete else None,
                    "interpretation": (
                        "Repeated periods or stations within a catchment are "
                        "retained as paired diagnostics and are not independent "
                        "temporal validation of a mean-annual model value."
                    ),
                }
                output["scores"].append(result)
        output["requests"].append(request_report)
    return output


def _html_table(rows, fields, *, id_labels=None, empty_text="No rows are available for this selection."):
    if not rows:
        return "<p>" + html.escape(empty_text) + "</p>"
    id_labels = id_labels or {}
    headings = {
        "profile_id": "Parameter profile", "scenario_id": "Scenario",
        "run_id": "Native run", "request_id": "Observation selection",
        "observation_source_id": "Observation source", "parameter": "Pollutant",
        "metric": "Output", "n": "Pairs scored", "n_expected_observations": "Observations expected",
        "n_common_observations": "Observations shared", "mean_bias": "Bias (model \u2212 observed)",
        "mae": "MAE", "rmse": "RMSE", "percent_bias": "Signed bias (%)",
        "nash_sutcliffe_efficiency": "NSE", "undefined_reasons": "Metric notes",
        "full_expected_cohort_complete": "Full cohort complete",
        "delta_n_complete": "Profiles compared", "delta_n_expected": "Profiles expected",
        "rank_n_complete": "Profiles ranked", "rank_n_expected": "Profiles expected",
        "top_k_design_fraction": "Top-k design fraction",
        "omitted_observation_ids": "Omitted observations", "missing_profile_ids": "Missing profiles",
        "model_not_selected_profile_ids": "Model not selected", "models": "Selected models",
        "coverage_state": "Coverage", "fit_state": "Fit status", "reason": "Reason",
    }

    def display_identity(value, key):
        raw = str(value)
        lookup = id_labels.get(key, {})
        if key.endswith("profile_ids"):
            lookup = id_labels.get("profile_id", {})
        elif key.endswith("scenario_ids"):
            lookup = id_labels.get("scenario_id", {})
        label = str(lookup.get(raw, raw))
        is_identity = key.endswith(("_id", "_ids", "_hash", "_sha256")) or key == "run_ids"
        if label == raw and is_identity and len(raw) > 24:
            label = raw[:12] + "\u2026"
        if label != raw or is_identity:
            return '<span title="' + html.escape(raw, quote=True) + '">' + html.escape(label) + "</span>"
        return html.escape(label)

    def cell(value, key):
        if value is None:
            return "Unavailable"
        if isinstance(value, bool):
            return "Yes" if value else "No"
        if isinstance(value, float):
            return format(value, ".6g") if math.isfinite(value) else "Unavailable"
        if isinstance(value, int):
            return format(value, ",")
        if isinstance(value, list):
            if not value:
                return "None"
            items = []
            for item in value:
                if isinstance(item, (dict, list)):
                    body = html.escape(json.dumps(item, sort_keys=True, allow_nan=False))
                else:
                    body = display_identity(item, key)
                items.append("<li>" + body + "</li>")
            return "<details><summary>" + str(len(value)) + " items</summary><ul>" + "".join(items) + "</ul></details>"
        if isinstance(value, dict):
            if not value:
                return "None"
            body = html.escape(json.dumps(value, indent=2, sort_keys=True, allow_nan=False))
            return "<details><summary>" + str(len(value)) + " settings</summary><pre>" + body + "</pre></details>"
        return display_identity(value, key)

    header = "".join("<th>" + html.escape(headings.get(key, key.replace("_", " "))) + "</th>" for key in fields)
    body = []
    for row in rows:
        cells = ["<td>" + cell(row.get(key), key) + "</td>" for key in fields]
        body.append("<tr>" + "".join(cells) + "</tr>")
    return '<div class="table"><table><thead><tr>' + header + "</tr></thead><tbody>" + "".join(body) + "</tbody></table></div>"


def _observation_coverage_rows(report):
    rows = []
    for request in report["observation_diagnostics"]["requests"]:
        header = {
            "observation_source_id": request["observation_id"],
            "request_id": request["request_id"],
            "source_roster_state": request.get("source_roster_state"),
            "source_excluded_observation_count":
                len(request.get("source_admission_exclusions", [])),
        }
        cohorts = request.get("cohorts", [])
        if not cohorts:
            rows.append({
                **header, "parameter": None, "units": None,
                "n_expected_observations": request.get("source_admitted_observation_count"),
                "n_common_observations": 0,
                "full_expected_cohort_complete": False,
                "omitted_observation_ids": None,
                "missing_profile_ids": request.get("missing_profile_ids"),
                "expected_profile_ids": request.get("expected_profile_ids"),
                "model_not_selected_profile_ids": request.get("model_not_selected_profile_ids"),
                "coverage_state": "source_unavailable"
                if request.get("source_roster_state") != "complete"
                else "no_admitted_observations",
                "error": request.get("error"),
            })
        for cohort in cohorts:
            members = cohort.get("observation_members", {})
            omitted_ids = [
                members.get(key, {}).get("observation_id", key)
                for key in cohort.get("omitted_observation_keys", [])
            ]
            rows.append({
                **header, "parameter": cohort["parameter"], "units": cohort["units"],
                "n_expected_observations": cohort["n_expected_observations"],
                "n_common_observations": cohort["n_common_observations"],
                "full_expected_cohort_complete": cohort["full_expected_cohort_complete"],
                "observation_set_hash": cohort["observation_set_hash"],
                "omitted_observation_ids": omitted_ids,
                "missing_profile_ids": cohort["missing_profile_ids"],
                "expected_profile_ids": cohort["expected_profile_ids"],
                "model_not_selected_profile_ids": cohort["model_not_selected_profile_ids"],
                "coverage_state": cohort["coverage_state"],
                "native_versions": cohort.get("native_versions"),
                "native_version_state": cohort.get("native_version_state"),
                "native_version_reason": cohort.get("native_version_reason"),
                "error": None,
            })
    return rows


def _html_fit_tables(report, render_table):
    observations = report.get("observation_diagnostics", {})
    scores = observations.get("scores", [])
    if not report["selection"].get("observations") and not observations.get("requests"):
        return "<p>No observation sources were selected for this analysis.</p>"
    full_rows, shared_rows, unavailable_rows = [], [], []
    failures = {
        request["request_id"]: request.get("failures", {})
        for request in observations.get("requests", [])
    }
    metric_fields = (
        "n", "mean_bias", "mae", "rmse", "percent_bias",
        "nash_sutcliffe_efficiency", "undefined_reasons",
    )
    for record in scores:
        base = {key: record.get(key) for key in (
            "request_id", "profile_id", "parameter", "units",
            "n_expected_observations", "n_common_observations",
        )}
        full = record.get("full_expected_cohort_score")
        shared = record.get("common_cohort_score")
        if isinstance(full, dict) and full.get("n", 0) > 0:
            full_rows.append({**base, **{key: full.get(key) for key in metric_fields}})
        elif isinstance(shared, dict) and shared.get("n", 0) > 0:
            shared_rows.append({**base, **{key: shared.get(key) for key in metric_fields}})
        else:
            available = record.get("profile_available") is True
            reason = record.get("native_version_reason") if record.get("score_state") == "incompatible_native_versions" else None
            reason = reason or failures.get(record.get("request_id"), {}).get(record.get("profile_id"))
            if not reason:
                notes = shared.get("undefined_reasons", []) if isinstance(shared, dict) else []
                reason = "; ".join(notes) if notes else (
                    "No common complete observation pairs are available" if available
                    else "The baseline comparison is unavailable for this profile"
                )
            unavailable_rows.append({
                **base,
                "fit_state": "Incompatible producing versions" if record.get("score_state") == "incompatible_native_versions" else (
                    "No shared observation pairs" if available else "Baseline comparison unavailable"
                ),
                "reason": reason,
            })
    fields = [
        "request_id", "profile_id", "parameter", "units", "n", "n_expected_observations",
        "mean_bias", "mae", "rmse", "percent_bias", "nash_sutcliffe_efficiency", "undefined_reasons",
    ]
    output = [
        "<h3>Fit on the full expected cohort</h3>",
        "<p>These scores include every expected observation and every baseline profile selected for that pollutant. "
        "Bias, MAE, and RMSE use the annual mass units shown in each row. "
        "Positive bias indicates overprediction.</p>",
        render_table(full_rows, fields, empty_text=(
            "Full expected-cohort fit is unavailable for this selection. "
            "The coverage table identifies missing observations and profiles."
        )),
        "<h3>Fit on shared observations</h3>",
        "<p>These rows use the same available observation pairs across the compared profiles. "
        "The expected cohort is incomplete because observations or baseline profiles are missing. "
        "Read the scored and expected counts with the coverage table before comparing profiles.</p>",
        render_table(shared_rows, fields, empty_text=(
            "All available scores use the full expected cohort." if full_rows
            else "No shared observation pairs are available for scoring."
        )),
    ]
    if unavailable_rows:
        output.extend([
            "<h3>Unavailable fit comparisons</h3>",
            render_table(unavailable_rows, [
                "request_id", "profile_id", "parameter", "units", "n_expected_observations",
                "n_common_observations", "fit_state", "reason",
            ]),
        ])
    return "".join(output)


def _html_report(report):
    selection, coverage = report["selection"], report["coverage"]
    profile_titles = {row["profile_id"]: str(row.get("title") or row["profile_id"][:12])
                      for row in report.get("profiles", [])}
    scenario_titles = {key: str(value or key[:12])
                       for key, value in report.get("scenario_titles", {}).items()}
    for labels in (profile_titles, scenario_titles):
        counts = {}
        for title in labels.values():
            counts[title] = counts.get(title, 0) + 1
        for key, title in list(labels.items()):
            if counts[title] > 1:
                labels[key] = title + " [" + key[:8] + "]"
    id_labels = {"profile_id": profile_titles, "scenario_id": scenario_titles}

    def table(rows, fields, **kwargs):
        return _html_table(rows, fields, id_labels=id_labels, **kwargs)

    def identity(kind, value):
        name = id_labels.get(kind, {}).get(value, value[:12] + "\u2026")
        return '<span title="' + html.escape(value, quote=True) + '">' + html.escape(name) + "</span>"
    content = [
        "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\">",
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        '<meta name="source-sha256" content="' + report["source_stamp"]["sha256"] + '">',
        "<title>" + html.escape(selection["title"]) + "</title>",
        "<style>body{font:14px/1.5 system-ui,sans-serif;color:#171717;background:#fff;"
        "margin:0;padding:32px;max-width:1500px}h1{font-size:26px}h2{font-size:19px;"
        "margin-top:32px}p{max-width:1050px}.table{overflow:auto;border:1px solid #ccc}"
        "table{border-collapse:collapse;width:100%;font-size:12px}th,td{padding:8px;"
        "border-bottom:1px solid #ddd;text-align:left;vertical-align:top}th{background:#eee;"
        "white-space:nowrap}code{overflow-wrap:anywhere}a{color:#222}section{margin:24px 0}"
        ".muted{color:#555}dt{font-weight:600}dd{margin:0 0 12px}h3{font-size:16px;margin-top:24px}td{max-width:320px;overflow-wrap:anywhere}"
        "details{max-width:440px}summary{cursor:pointer}pre{white-space:pre-wrap;font:12px/1.4 ui-monospace,monospace}"
        "details ul{padding-left:20px}</style><body>",
        "<h1>" + html.escape(selection["title"]) + "</h1>",
        "<p>" + html.escape(selection.get("purpose", "")) + "</p>",
        "<p><strong>" + str(coverage["complete_runs"]) + " / " + str(coverage["expected_runs"])
        + "</strong> original model runs complete; <strong>" + str(coverage["complete_profiles"])
        + " / " + str(coverage["expected_profiles"]) + "</strong> complete profile/scenario sets.</p>",
        "<p>Design: <strong>" + html.escape(selection["design"])
        + "</strong>. Every delta is scenario minus baseline under the same profile. "
        "Every metric uses its recorded common finite-valid pixel footprint. "
        "The reported envelope, quartiles, sign fractions, and ranking fractions "
        "describe the distinct sampled profiles. A later completion snapshot can "
        "use a different shared footprint. Explicitly inactive models are listed as "
        "model_not_selected; the completeness assessment covers selected model outputs. "
        "Producing versions are checked independently for each metric. Incompatible versions "
        "leave that full declared metric cohort unavailable; another compatible model remains usable. "
        "Requested legacy and observed-run fallbacks are explicitly labeled in the run matrix.</p>",
        "<dl><dt>Reference profile</dt><dd>" + identity("profile_id", selection["reference_profile_id"])
        + "</dd><dt>Baseline scenario</dt><dd>"
        + identity("scenario_id", selection["baseline_scenario_id"]) + "</dd><dt>Diagnostic snapshot</dt><dd><code>"
        + report["id"] + "</code></dd><dt>Source SHA-256</dt><dd><code>"
        + report["source_stamp"]["sha256"] + "</code></dd></dl>",
        "<h2>Shared spatial support</h2>",
        table(report["common_support"], [
            "metric", "state", "valid_cells", "grid_cells", "selected_run_count",
            "model_not_selected_run_count", "native_version_state", "native_version_reason",
            "run_ids", "model_not_selected_run_ids",
        ]),
        "<h2>Scenario response and sampled envelope</h2>",
        table(report["scenario_summaries"], [
            "metric", "units", "scenario_id", "structural_group_id",
            "delta_n_complete", "delta_n_expected", "delta_minimum",
            "delta_median", "delta_maximum", "negative_fraction",
            "neutral_fraction", "positive_fraction",
        ]),
        "<h2>Scenario ranking stability</h2>",
        "<p>Lower paired export change ranks first. Each ranked profile contains "
        "every declared candidate scenario. Exact ties use average rank and "
        "fractional top-k membership.</p>",
        table(report["rank_stability"], [
            "metric", "scenario_id", "rank_n_complete", "rank_n_expected",
            "rank_minimum", "rank_median", "rank_maximum", "reference_rank",
            "top_k", "top_k_design_fraction", "ranking_complete", "coverage_state",
            "model_not_selected_profile_ids",
        ]),
        "<h2>Baseline response, profile effects, and interactions</h2>",
        "<p>Profile effect compares a scenario at a given profile with the same "
        "scenario at the reference profile. Baseline profile effect compares the "
        "two baseline loads. Interaction is the change in the paired scenario "
        "response relative to the reference profile response.</p>",
        table(report["parameter_effects"], [
            "metric", "units", "profile_id", "scenario_id", "scenario_delta",
            "profile_effect", "baseline_profile_effect", "scenario_parameter_interaction",
            "paired_complete", "changed_parameters",
        ]),
        "<h2>Original normalized totals and common-footprint totals</h2>",
        table(report["metric_values"], [
            "metric", "units", "profile_id", "scenario_id", "native_mass_total",
            "native_valid_cells", "common_mass_total", "common_valid_cells",
            "excluded_native_cells",
        ]),
        "<h2>Observed annual-load diagnostics</h2>",
        "<p>Only baseline scenarios are compared with observations. Full expected-cohort "
        "scores require all baseline profiles selected for that pollutant, comparable observation rows, "
        "and compatible producing versions. Raw per-profile observation comparisons remain retained "
        "when cross-profile fit scores are unavailable. "
        "Common-cohort scores retain the fixed subset hash and omitted membership. "
        "Repeated periods within a catchment remain repeated diagnostics of the "
        "mean-annual modeled value.</p>",
        "<h3>Observation source and cohort coverage</h3>",
        table(report["observation_cohort_coverage"], [
            "observation_source_id", "request_id", "parameter", "units",
            "n_expected_observations", "n_common_observations",
            "full_expected_cohort_complete", "omitted_observation_ids",
            "missing_profile_ids", "model_not_selected_profile_ids", "coverage_state",
            "native_version_state", "native_version_reason",
        ]),
        _html_fit_tables(report, table),
        "<h2>Run matrix</h2>",
        table(report["run_matrix"], ["profile_id", "scenario_id", "run_id", "models", "models_source",
                                     "native_version_summary", "state", "error"]),
        "<h2>Files</h2><ul>",
    ]
    for name, artifact in sorted(report["artifacts"].items()):
        filename = artifact.get("filename")
        if filename:
            content.append('<li><a href="' + html.escape(filename, quote=True) + '">'
                           + html.escape(name.replace("_", " ")) + "</a></li>")
    content.append('<li><a href="report.json">Complete report JSON</a></li>')
    content.extend(["</ul><h2>Recorded processing issues</h2>",
                    table(report["errors"], ["stage", "metric", "run_id", "profile_id", "message"],
                          empty_text="No processing issues were recorded."),
                    '<p class="muted">Generated ' + html.escape(report["generated_at"])
                    + ". Model source selections, native runtime records, original artifact "
                    "hashes, and the complete expected matrix are retained in manifest.json.</p></body></html>"])
    return "".join(content)



def _archive(ws, folder, diagnostic_id, source_stamp, report, report_artifact):
    """Stream retained diagnostic artifacts into one portable analysis package.

    Source descriptors are verified against the workspace root.  The archive
    uses names relative to this diagnostic directory so report.html links work
    after extraction.  Its own descriptor is stored in state, outside report.json.
    """
    import zipfile

    paths = {}
    for descriptor in list(report["artifacts"].values()) + [report_artifact]:
        path = verify_file(ws.root, descriptor)
        relative = path.resolve().relative_to(folder.resolve())
        if (
            relative.name in ("state.json", "diagnostics_bundle.zip")
            or any(part.startswith(".") for part in relative.parts)
        ):
            continue
        paths[relative.as_posix()] = path
    target = folder / "diagnostics_bundle.zip"
    temporary = folder / ".diagnostics_bundle.tmp.zip"
    with zipfile.ZipFile(
        temporary, mode="w", compression=zipfile.ZIP_DEFLATED,
        compresslevel=6, allowZip64=True,
    ) as bundle:
        bundle.comment = json.dumps({
            "schema": "upstate.diagnostic-bundle/v1",
            "diagnostic_id": diagnostic_id, "source_sha256": source_stamp["sha256"],
        }, sort_keys=True, allow_nan=False).encode("utf-8")
        for relative, path in sorted(paths.items()):
            compression = zipfile.ZIP_STORED if path.suffix.lower() in (".tif", ".tiff") else zipfile.ZIP_DEFLATED
            bundle.write(path, arcname=relative, compress_type=compression)
    temporary.replace(target)
    return _describe(
        ws, target, source_stamp, filename=target.name,
        entries=sorted(paths), entry_count=len(paths),
        media_type="application/zip",
    )


def _load(ws, diagnostic_id):
    folder = _folder(ws, diagnostic_id)
    manifest = read_json(folder / "manifest.json")
    if manifest.get("id") != diagnostic_id or digest(manifest["identity"]) != diagnostic_id:
        raise ValueError("Diagnostic manifest identity does not match its content")
    state = read_json(folder / "state.json")
    if state.get("id") != diagnostic_id:
        raise ValueError("Diagnostic state belongs to another snapshot")
    return folder, manifest, state


def inspect(ws, diagnostic_id):
    """Read a persisted immutable report, or its resumable partial state."""
    folder, manifest, state = _load(ws, diagnostic_id)
    descriptor = state.get("report_artifact")
    if descriptor and state["state"] != "running":
        report = read_json(verify_file(ws.root, descriptor))
        report["state"] = state["state"]
        report["processing_phase"] = state.get("phase")
        report["processing_elapsed_seconds"] = state["elapsed_seconds"]
        report["processing_errors"] = state.get("errors", [])
        if state.get("archive_artifact"):
            report["artifacts"]["analysis_zip"] = state["archive_artifact"]
        report["artifacts"]["report_json"] = descriptor
        report["artifacts"]["state"] = _describe(
            ws, folder / "state.json", manifest["identity"]["source_stamp"], filename="state.json"
        )
        return report
    return {
        "id": diagnostic_id, "state": state["state"], "phase": state.get("phase"),
        "selection": manifest["identity"]["selection"],
        "source_stamp": manifest["identity"]["source_stamp"],
        "created_at": state["created_at"], "updated_at": state["updated_at"],
        "elapsed_seconds": state["elapsed_seconds"], "errors": state.get("errors", []),
        "artifacts": {
            "manifest": _describe(ws, folder / "manifest.json",
                                  manifest["identity"]["source_stamp"], filename="manifest.json"),
            "state": _describe(ws, folder / "state.json",
                               manifest["identity"]["source_stamp"], filename="state.json"),
        },
    }


def listing(ws):
    """Return persisted diagnostic snapshot summaries without running analysis."""
    result = []
    root = _root(ws)
    for manifest_path in root.glob("*/manifest.json") if root.exists() else []:
        try:
            _, manifest, state = _load(ws, manifest_path.parent.name)
            selection = manifest["identity"]["selection"]
            result.append({
                "id": manifest_path.parent.name, "title": selection["title"],
                "campaign_id": selection.get("campaign_id"),
                "state": state["state"], "phase": state.get("phase"),
                "updated_at": state["updated_at"],
                "elapsed_seconds": state["elapsed_seconds"],
                "coverage": state.get("coverage"), "errors": state.get("errors", []),
            })
        except Exception as exc:
            result.append({"id": manifest_path.parent.name, "state": "unreadable",
                           "error": _error("read", exc)})
    return sorted(result, key=lambda value: value.get("updated_at", ""), reverse=True)


def analyze(ws, selection):
    """Analyze exact original runs and persist a source-stamped snapshot.

    Required selection keys: run_ids, baseline_scenario_id, reference_profile_id.
    Optional: title, purpose, campaign_id, design, expected_profile_ids,
    scenario_ids, observations, tolerances, top_k.  Declared missing matrix cells
    stay missing.  New native completion or changed artifact metadata produces
    a new content ID; repeated analysis of the same complete snapshot reuses it.
    """
    normalized, snapshots = _normalize(ws, selection)
    source_stamp = _source(ws)
    identity = {
        "schema": SCHEMA, "selection": normalized,
        "source_stamp": source_stamp, "snapshots": snapshots,
    }
    diagnostic_id = digest(identity)
    folder = _folder(ws, diagnostic_id)
    folder.mkdir(parents=True, exist_ok=True)
    with held(folder / ".diagnostics.lock", blocking=False):
        if (folder / "state.json").exists():
            _, manifest, state = _load(ws, diagnostic_id)
            if state.get("state") == "complete" and state.get("report_artifact"):
                return inspect(ws, diagnostic_id)
        else:
            manifest = {"schema": SCHEMA, "id": diagnostic_id, "identity": identity}
            if not (folder / "manifest.json").exists():
                atomic_json(folder / "manifest.json", manifest, immutable=True)
            else:
                retained = read_json(folder / "manifest.json")
                if retained != manifest:
                    raise ValueError("Retained manifest differs from this diagnostic snapshot")
            state = {
                "schema": "upstate.diagnostic-state/v1", "id": diagnostic_id,
                "source_stamp": source_stamp, "state": "prepared", "phase": "prepared",
                "created_at": now(), "updated_at": now(), "elapsed_seconds": 0.0,
                "errors": [], "metric_stages": {}, "observation_calls": {},
                "report_artifact": None, "archive_artifact": None,
            }
            _state_write(folder, state)
        started = time.monotonic()
        state["_attempt_clock"] = started
        state["_prior_elapsed"] = state["elapsed_seconds"]
        state["state"] = "running"
        state["archive_artifact"] = None
        state["last_attempt_started_at"] = now()
        _state_write(folder, state, "common_spatial_support")
        try:
            run_matrix = _run_matrix(normalized, snapshots)
            profiles = [
                _profile_info(key, snapshots["profiles"], normalized["reference_profile_id"], run_matrix)
                for key in normalized["expected_profile_ids"]
            ]
            values, supports, errors, artifacts = [], [], [], {}
            for metric in METRICS:
                cached = state["metric_stages"].get(metric)
                try:
                    if cached:
                        metric_report = read_json(verify_file(ws.root, cached))
                        support_descriptor = metric_report["common_support"].get("mask")
                        if support_descriptor:
                            verify_file(ws.root, support_descriptor)
                    else:
                        metric_report = _shared_support(
                            ws, folder, diagnostic_id, source_stamp, metric, snapshots
                        )
                        metric_report["diagnostic_id"] = diagnostic_id
                        metric_report["source_stamp"] = source_stamp
                        path = folder / ("metric_" + metric + ".json")
                        atomic_json(path, metric_report)
                        cached = _describe(ws, path, source_stamp, filename=path.name)
                        if not metric_report["errors"]:
                            state["metric_stages"][metric] = cached
                        _state_write(folder, state)
                    values.extend(metric_report["values"])
                    supports.append(metric_report["common_support"])
                    errors.extend(metric_report["errors"])
                    artifacts["metric_" + metric] = cached
                    mask = metric_report["common_support"].get("mask")
                    if mask:
                        artifacts["support_" + metric] = mask
                except Exception as exc:
                    state["metric_stages"].pop(metric, None)
                    _state_write(folder, state)
                    issue = _error("shared-support", exc, metric=metric)
                    errors.append(issue)
                    supports.append({
                        "metric": metric, "state": "failed", "valid_cells": None,
                        "grid_cells": None, "run_ids": [], "error": issue,
                    })
            _state_write(folder, state, "paired_summaries")
            effects, summaries, ranks = _summaries(normalized, profiles, values, run_matrix)
            _state_write(folder, state, "observations")
            observations = _observations(
                ws, folder, diagnostic_id, source_stamp, normalized, snapshots, state
            )
            errors.extend(observations["errors"])
            artifacts.update(observations["artifacts"])
            complete_profiles = sum(
                all(row["state"] == "complete" for row in run_matrix if row["profile_id"] == key)
                for key in normalized["expected_profile_ids"]
            )
            coverage = {
                "expected_runs": len(run_matrix),
                "provided_run_ids": len(normalized["run_ids"]),
                "complete_runs": sum(row["state"] == "complete" for row in run_matrix),
                "failed_runs": sum(row["state"] == "failed" for row in run_matrix),
                "missing_runs": sum(row["state"] == "missing" for row in run_matrix),
                "unfinished_runs": sum(row["state"] not in ("complete", "failed", "missing") for row in run_matrix),
                "expected_profiles": len(normalized["expected_profile_ids"]),
                "complete_profiles": complete_profiles,
                "expected_scenarios": len(normalized["scenario_ids"]),
                "matrix_complete": all(row["state"] == "complete" for row in run_matrix),
                "metric_complete_pairs": {
                    key: sum(row["paired_complete"] for row in effects if row["metric"] == key)
                    for key in METRICS
                },
                "metric_applicable_pairs": {
                    key: sum(row["pair_applicability"] != "model_not_selected"
                             for row in effects if row["metric"] == key)
                    for key in METRICS
                },
                "metric_not_selected_pairs": {
                    key: sum(row["pair_applicability"] == "model_not_selected"
                             for row in effects if row["metric"] == key)
                    for key in METRICS
                },
                "selected_models": [
                    model for model in ("ndr", "sdr")
                    if any(row["models"] is not None and model in row["models"] for row in run_matrix)
                ],
                "model_selection_complete": all(row["models"] is not None for row in run_matrix),
                "metric_native_version_states": {
                    support["metric"]: support.get("native_version_state", "unavailable")
                    for support in supports
                },
                "selected_metric_support_complete": all(
                    support.get("state") in ("complete", "model_not_selected")
                    for support in supports
                ),
            }
            report = {
                "schema": SCHEMA, "id": diagnostic_id,
                "state": "complete", "generated_at": state["created_at"],
                "selection": normalized, "source_stamp": source_stamp,
                "coverage": coverage, "profiles": profiles,
                "scenario_titles": {
                    key: value.get("title") or value.get("name") or key
                    for key, value in snapshots["scenarios"].items()
                },
                "sampling_unit": "distinct scientific parameter configuration",
                "run_matrix": run_matrix, "common_support": supports,
                "metric_values": values, "scenario_summaries": summaries,
                "parameter_effects": effects, "rank_stability": ranks,
                "observation_diagnostics": observations,
                "errors": errors, "artifacts": artifacts,
                "interpretation": {
                    "envelope": "sampled nonprobabilistic design envelope",
                    "paired_delta": "scenario(p) minus baseline(p)",
                    "profile_effect": "scenario(p) minus scenario(reference)",
                    "interaction": "paired_delta(p) minus paired_delta(reference)",
                    "reporting_unit": "same recorded common-valid-cell footprint within each metric",
                    "structural_groups": "routing algorithms, model period, and declared model scopes; table changes remain parameter provenance",
                    "model_selection": "retained native run selection; prepared subsets are pinned and omitted models mean both",
                    "inactive_models": "model_not_selected is separate from missing selected outputs; unknown expected cells remain expected",
                    "native_versions": (
                        "each metric compares its producing model across every completed applicable original run; "
                        "completed-stage runtime precedes observed-run and labeled requested-legacy fallbacks; "
                        "an incompatible version cohort is unavailable without selecting a smaller subset"
                    ),
                    "scientific_status": "working diagnostic",
                },
            }
            report["observation_cohort_coverage"] = _observation_coverage_rows(report)
            report["state"] = "partial" if errors else "complete"
            report["results_state"] = (
                "complete" if coverage["matrix_complete"] and not errors
                and coverage["selected_metric_support_complete"]
                else "partial"
            )
            _state_write(folder, state, "exports")
            exports = {
                "run_matrix_csv": ("run_matrix.csv", run_matrix),
                "metric_values_csv": ("metric_values.csv", values),
                "scenario_summaries_csv": ("scenario_summaries.csv", summaries),
                "parameter_effects_csv": ("parameter_effects.csv", effects),
                "rank_stability_csv": ("rank_stability.csv", ranks),
                "observation_rows_csv": ("observation_rows.csv", observations["rows"]),
                "observation_scores_csv": ("observation_scores.csv", observations["scores"]),
                "observation_cohorts_csv": ("observation_cohorts.csv", report["observation_cohort_coverage"]),
            }
            for key, (filename, rows) in exports.items():
                path = folder / filename
                _csv(path, rows, diagnostic_id, source_stamp)
                report["artifacts"][key] = _describe(ws, path, source_stamp, filename=filename)
            report["artifacts"]["manifest"] = _describe(
                ws, folder / "manifest.json", source_stamp, filename="manifest.json"
            )
            html_path = folder / "report.html"
            html_path.write_text(_html_report(report), encoding="utf-8")
            report["artifacts"]["report_html"] = _describe(
                ws, html_path, source_stamp, filename="report.html"
            )
            report["elapsed_seconds"] = state["_prior_elapsed"] + time.monotonic() - started
            atomic_json(folder / "report.json", report)
            state["report_artifact"] = _describe(
                ws, folder / "report.json", source_stamp, filename="report.json"
            )
            _state_write(folder, state, "archive")
            state["archive_artifact"] = _archive(
                ws, folder, diagnostic_id, source_stamp, report, state["report_artifact"]
            )
            state["elapsed_seconds"] = state["_prior_elapsed"] + time.monotonic() - started
            state["coverage"], state["errors"], state["state"] = coverage, errors, report["state"]
            _state_write(folder, state, "complete")
        except Exception as exc:
            state["elapsed_seconds"] = state["_prior_elapsed"] + time.monotonic() - started
            state["state"] = "failed"
            state["errors"].append(_error(state.get("phase", "analysis"), exc))
            _state_write(folder, state)
            raise
    return inspect(ws, diagnostic_id)
