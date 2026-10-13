"""Bind calibration to original producing stages and current load comparisons.

The existing observations engine reduces annual export rasters per hectare.
This module records that physical contract and the actual retained inputs;
it performs no raster calculation and never creates a native model run.
"""
from __future__ import annotations

from copy import deepcopy
import re

from .common import digest, read_json, verify_file
from .model_selection import run_models, validate_completed_run
from .native_versions import comparison_versions, model_versions, version_label
from .observations import NATIVE

SCHEMA = "upstate.calibration-native-execution/v1"
COMPARISON_SCHEMA_VERSION = 6
UNIT_GUIDES = {
    "ndr": "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html",
    "sdr": "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html",
}


def _mass_basis(parameter, info):
    model, output, units = NATIVE[parameter]
    version = info.get("comparison_version")
    match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)(?:[.+-][0-9A-Za-z.+-]+)?", version or "")
    # Author guides document the 3.15 transition and the current 3.20 family.
    # Earlier per-pixel outputs cannot enter this per-hectare reducer.
    supported = bool(match and int(match[1]) == 3 and 15 <= int(match[2]) <= 20)
    return {
        "model": model, "output": output,
        "raster_units": "metric_tonnes/ha/year" if parameter == "sediment" else "kg/ha/year",
        "annual_units": units,
        "reduction": "sum_valid_native_cell_value_times_affine_cell_area_ha",
        "source_guide": UNIT_GUIDES[model],
        "unit_basis": "NatCap NDR/SDR guides: outputs changed to per-hectare values in InVEST 3.15.0; "
                      "current reviewed output convention covers InVEST 3.15 through 3.20.",
        "version_supported": supported,
        "version_basis": info.get("basis"),
        "legacy_requested_version": info.get("basis") == "requested_legacy",
    }


def _descriptor(item, label):
    if (not isinstance(item, dict) or not isinstance(item.get("path"), str)
            or not isinstance(item.get("bytes"), int) or isinstance(item.get("bytes"), bool)
            or item["bytes"] < 0 or not isinstance(item.get("sha256"), str)
            or not re.fullmatch(r"[0-9a-f]{64}", item["sha256"])):
        raise ValueError("Retain the original complete native " + label + " descriptor")
    return deepcopy(item)


def candidate(workspace, run, *, verify=False):
    """Resolve the actual selected-stage metadata without opening raster libraries."""
    scope = validate_completed_run(run)
    if not scope["selected_models_complete"]:
        raise ValueError("Complete every model selected for the original calibration candidate")
    versions = model_versions(run)
    directory = workspace.root / "runs" / run["id"]
    outputs, bases, issues, checked = {}, {}, [], set()
    arguments_by_model = {}
    for parameter, (model, output, units) in NATIVE.items():
        if model not in run_models(run):
            continue
        stage = run["stages"][model]
        argument_item = _descriptor(stage.get("arguments"), model + " arguments")
        if model not in arguments_by_model:
            arguments_by_model[model] = read_json(verify_file(directory, argument_item))
        arguments = arguments_by_model[model]
        stream = "stream_and_drainage" if model == "sdr" and arguments.get("drainage_path") else "stream"
        export_item = _descriptor(stage.get("files", {}).get(output), model + " " + output)
        stream_item = _descriptor(stage.get("files", {}).get(stream), model + " " + stream)
        if verify:
            for item in (export_item, stream_item):
                key = (item["path"], item["sha256"], item["bytes"])
                if key not in checked:
                    verify_file(directory, item)
                    checked.add(key)
        bases[parameter] = _mass_basis(parameter, versions[model])
        if not bases[parameter]["version_supported"]:
            issues.append(model.upper() + " " + str(versions[model].get("comparison_version")) +
                          " does not have a reviewed per-hectare output contract for this load reducer")
        outputs[parameter] = {
            "model": model, "export_registry_id": output, "stream_registry_id": stream,
            "export": export_item, "stream": stream_item, "arguments": argument_item,
            "native_module": deepcopy((stage.get("runtime", run.get("runtime", {})) or {})
                                      .get("modules", {}).get(model)),
        }
    value = {
        "native_versions": versions,
        "native_version_labels": {model: version_label(info) for model, info in versions.items()},
        "output_mass_basis": bases, "native_outputs": outputs,
        "execution_issues": sorted(set(issues)),
    }
    value["execution_fingerprint"] = digest({
        "selection": run["selection"], "versions": versions, "outputs": outputs, "mass_basis": bases,
    })
    return value


def cohort(workspace, candidates, parameters, *, verify=False):
    """Bind the frozen objective to one compatible producing-version cohort.

    Candidate dictionaries are enriched in the caller's in-memory copy; immutable
    original plan records are never rewritten. Every selected model's physical
    output convention is checked because the original observations engine opens
    all models selected in the run. Version equality is required only for the
    model outputs used by the positive-weight objective.
    """
    parameters = tuple(parameter for parameter in NATIVE if parameter in parameters)
    if not parameters:
        raise ValueError("Choose at least one original annual-load objective")
    models = tuple(model for model in ("ndr", "sdr")
                   if any(NATIVE[parameter][0] == model for parameter in parameters))
    runs, rows = [], []
    for item in candidates:
        run = workspace.inspect_run(item["run_id"])
        if digest(run["selection"]) != digest(item["selection"]):
            raise ValueError("The original candidate selection differs from its saved calibration plan")
        snapshot = candidate(workspace, run, verify=verify)
        if item.get("execution_fingerprint") and item["execution_fingerprint"] != snapshot["execution_fingerprint"]:
            raise ValueError("The retained candidate's producing stages or native files changed; "
                             "prepare an explicit new calibration plan from the current run")
        if snapshot["execution_issues"]:
            raise ValueError("; ".join(snapshot["execution_issues"]))
        missing = set(parameters) - set(snapshot["native_outputs"])
        if missing:
            raise ValueError("The positive-weight objective lacks original outputs: " + ", ".join(sorted(missing)))
        item.update(snapshot)
        runs.append(run)
        for parameter in parameters:
            basis, output = snapshot["output_mass_basis"][parameter], snapshot["native_outputs"][parameter]
            info = snapshot["native_versions"][basis["model"]]
            rows.append({
                "run_id": run["id"], "profile_id": item["profile_id"], "model": basis["model"],
                "parameter": parameter, "output": basis["output"],
                **deepcopy(info), "version_label": version_label(info),
                "raster_units": basis["raster_units"], "annual_units": basis["annual_units"],
                "reduction": basis["reduction"], "source_guide": basis["source_guide"],
                "unit_basis": basis["unit_basis"],
                "export_sha256": output["export"]["sha256"],
                "stream_sha256": output["stream"]["sha256"],
                "arguments_sha256": output["arguments"]["sha256"],
            })
    versions = comparison_versions(runs, models)
    value = {
        "schema": SCHEMA, **versions, "comparison_schema_version": COMPARISON_SCHEMA_VERSION,
        "output_mass_basis": {parameter: {key: deepcopy(value) for key, value in
                                          candidates[0]["output_mass_basis"][parameter].items()
                                          if key not in ("version_basis", "legacy_requested_version")}
                             for parameter in parameters},
        "rows": rows,
        "candidate_fingerprints": {item["run_id"]: item["execution_fingerprint"] for item in candidates},
        "physical_comparison": "Original annual export values per hectare multiplied by each original "
                               "affine cell's area in hectares; whole-catchment and same-stage stream "
                               "support remain the maintained observation engine's responsibility.",
        "legacy_provenance": "A requested_legacy version retains the original requested declaration; "
                             "it does not establish which software executed that model.",
    }
    value["fingerprint"] = digest(value)
    return value


def matching_outputs(comparison, candidate, parameters, *, checkpoint_matches=False):
    """Require the current original comparison and exact retained native files."""
    if comparison.get("comparison_version") != COMPARISON_SCHEMA_VERSION:
        return False
    expected = candidate.get("native_outputs")
    if not expected:
        return False
    found = set()
    for row in comparison.get("comparisons", []):
        parameter = row.get("parameter")
        if parameter not in parameters:
            continue
        found.add(parameter)
        output = expected.get(parameter)
        if not output:
            return False
        source = row.get("spatial_coverage", {}).get("native_stream_source") or {}
        if (source.get("run_id") != candidate["run_id"]
                or source.get("model") != output["model"]
                or source.get("registry_id") != output["stream_registry_id"]
                or source.get("export_registry_id") != output["export_registry_id"]
                or digest(source.get("file")) != digest(output["stream"])
                or digest(source.get("export_file")) != digest(output["export"])
                or digest(source.get("arguments")) != digest(output["arguments"])
                or digest(source.get("native_module")) != digest(output["native_module"])):
            return False
        if row.get("measurement_support") != "catchment_export":
            return False
    # A fresh all-excluded comparison contains no raster-source row to verify.
    # Its own persisted execution checkpoint supplies that missing source link.
    return set(parameters).issubset(found) or checkpoint_matches
