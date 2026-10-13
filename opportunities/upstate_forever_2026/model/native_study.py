"""Retain a complete native study independently of the regional RFP contract."""
from __future__ import annotations

import math
from copy import deepcopy
from pathlib import Path

from .common import (INVEST_SOURCE, INVEST_VERSION, atomic_json, describe_file, identifier,
                     verify_file)
from .reuse import copy_verified
from . import native_versions

SCHEMA = "commons.native-study-delivery/v1"
CONTEXT_SCHEMA = "commons.native-study-context/v1"
EDITION = "native-study-release/3"
MAP_FAMILIES = (
    "future_sediment_loss", "future_nutrient_runoff",
    "current_nutrient_export", "current_sediment_export",
    "combined_pollutant_export",
)


def mode(selection):
    value = selection.get("delivery_mode", "regional_rfp")
    if value not in ("regional_rfp", "native_study"):
        raise ValueError("Choose regional_rfp or native_study delivery mode")
    return value


def prepare(selection):
    """Normalize only the explicitly selected study edition before its digest."""
    active = mode(selection) == "native_study"
    if not active:
        return False
    selection["delivery_mode"] = "native_study"
    selection["native_study_edition"] = EDITION
    value = selection.get("native_study")
    if not isinstance(value, dict):
        raise ValueError("Native study release requires its original title and purpose")
    result = {}
    for key in ("title", "purpose"):
        text = value.get(key)
        if not isinstance(text, str) or not text.strip():
            raise ValueError("Native study " + key + " must describe the actual selected study")
        result[key] = text.strip()
    if value.get("reference") is not None:
        if not isinstance(value["reference"], str):
            raise ValueError("Native study reference must be text")
        if value["reference"].strip():
            result["reference"] = value["reference"].strip()
    if set(value) - {"title", "purpose", "reference"}:
        raise ValueError("Native study metadata accepts title, purpose and optional reference")
    selection["native_study"] = result
    supplied = selection.get("contact", {})
    if not isinstance(supplied, dict):
        raise ValueError("Metadata contact must be an object when supplied")
    contact = {}
    for key in ("name", "organization", "email"):
        text = supplied.get(key, "")
        if not isinstance(text, str):
            raise ValueError("Metadata contact fields must be text")
        contact[key] = text.strip()
    selection["contact"] = contact
    selection.setdefault("source_roles", {})
    selection.setdefault("overlays", {})
    return True


def source_records(workspace, grid, profile, records):
    """Append the actual domain, reporting polygon and native biophysical table."""
    from .fgdc_metadata import retained_source_metadata
    records = {item["id"]: dict(item) for item in records}
    collection = grid["spec"]["source_collection_id"]
    selections = {
        "REPORTING_AREA": (collection, grid["spec"]["reporting_area"]["source_id"]),
        "MODEL_DOMAIN": (collection, grid["spec"]["model_domain"]["source_id"]),
        "BIOPHYSICAL_TABLE": (profile["source_collection_id"], profile["biophysical_source_id"]),
    }
    for role, (collection_id, source_id) in selections.items():
        _, entry = workspace.source_file(collection_id, source_id)
        item = {
            "id": role, "source_collection_id": collection_id, "source_id": entry["id"],
            "title": entry["title"], "vintage": entry["vintage"], "uri": entry["uri"],
            "sha256": entry["body"]["sha256"],
            "source_metadata": retained_source_metadata(entry),
        }
        if role in records and records[role]["sha256"] != item["sha256"]:
            raise ValueError("Native study source role differs from the original " + role)
        records[role] = item
    return [records[key] for key in sorted(records)]


def retained_runtimes(run, *, versions=None):
    """Keep the original runtime selected by the shared completed-stage policy."""
    stages = run.get("stages", {})
    if not isinstance(stages, dict):
        raise ValueError("Retain the original native model stages")
    versions = native_versions.model_versions(run) if versions is None else versions
    if set(versions) != {"ndr", "sdr"}:
        raise ValueError("A full native study retains both original NDR and SDR models")
    result = {}
    for model in ("ndr", "sdr"):
        stage = stages.get(model, {})
        if not isinstance(stage, dict):
            raise ValueError("Retain the original " + model.upper() + " stage")
        info = versions[model]
        original = (stage.get("runtime") if info["basis"] == "completed_stage_runtime"
                    else run.get("runtime"))
        modules = original.get("modules") if isinstance(original, dict) else None
        module = modules.get(model) if isinstance(modules, dict) else None
        if (info["comparison_version"] != INVEST_VERSION
                or not isinstance(original, dict)
                or original.get("version") != INVEST_VERSION
                or original.get("declared_source") != INVEST_SOURCE
                or not isinstance(module, dict)
                or module.get("git_blob") != INVEST_SOURCE[model + "_blob"]):
            raise ValueError("Retain the original InVEST " + INVEST_VERSION
                             + " runtime for the completed " + model.upper() + " stage")
        result[model] = deepcopy(original)
    return result

def retain(workspace, directory, state, selection, grid, profile, baseline, alternatives, records):
    """Capture source-bound context and original study geometry beside the report."""
    from pyproj import CRS
    from .rasters import MASS_UNITS

    definition = grid["grid"]
    crs = CRS.from_user_input(definition["crs"])
    if (not crs.is_projected or len(crs.axis_info) < 2 or any(
            not math.isclose(float(axis.unit_conversion_factor), 1.0, rel_tol=0, abs_tol=1e-10)
            for axis in crs.axis_info[:2])):
        raise ValueError("Native study requires its original projected metre grid")
    transform = [float(value) for value in definition["transform"]][:6]
    if len(transform) != 6 or any(not math.isfinite(value) for value in transform):
        raise ValueError("Native study grid has an invalid affine transform")
    a, b, _, d, e, _ = transform
    area = abs(a * e - b * d) / 10000
    if a <= 0 or e >= 0 or b != 0 or d != 0 or not math.isfinite(area) or area <= 0:
        raise ValueError("Native study retains the original north-up projected grid")
    if any(type(definition.get(key)) is not int or definition[key] <= 0 for key in ("width", "height")):
        raise ValueError("Native study raster width and height must be positive integers")
    buffer = grid["spec"]["upstream_buffer_m"]
    if isinstance(buffer, bool) or not math.isfinite(float(buffer)) or float(buffer) < 0:
        raise ValueError("Native study context buffer must be finite and nonnegative")
    runs = [baseline, *alternatives]
    executed = native_versions.comparison_versions(runs, ("ndr", "sdr"))
    runtimes = {run["id"]: retained_runtimes(run, versions=executed["runs"][run["id"]])
                for run in runs}
    for run in runs:
        for name, units in MASS_UNITS.items():
            if run["artifacts"].get(name, {}).get("units") != units:
                raise ValueError("Native study requires the original annual-mass units for " + name)
    files = {}
    root = workspace.root / "grids" / grid["id"]
    for name in ("reporting_area", "model_domain", "reporting_mask"):
        descriptor = grid["files"][name]
        original = verify_file(root, descriptor)
        suffix = "".join(original.suffixes) or ".data"
        files[name] = copy_verified(root, descriptor, directory,
                                   path="native-study/" + name + suffix)
    source_path, entry = workspace.source_file(
        profile["source_collection_id"], profile["biophysical_source_id"])
    files["biophysical_table"] = copy_verified(
        source_path.parent, describe_file(source_path.parent, source_path), directory,
        path="native-study/biophysical-table.csv")
    context = {
        "schema": CONTEXT_SCHEMA, "edition": EDITION,
        "delivery_mode": "native_study", "delivery_id": state["id"],
        "project": workspace.project, **selection["native_study"],
        "grid_id": grid["id"], "grid": {**definition, "transform": transform,
                                        "pixel_area_ha": area},
        "grid_spec": grid["spec"], "upstream_buffer_m": buffer,
        "profile": profile, "source_records": records,
        "expected_map_families": list(MAP_FAMILIES),
        "baseline_run_id": baseline["id"],
        "scenario_run_ids": [run["id"] for run in alternatives],
        "execution": {name: deepcopy(executed[name]) for name in ("policy", "models", "versions")},
        "runs": [{
            "id": run["id"], "selection": run["selection"], "runtime": run.get("runtime"),
            "stage_runtimes": runtimes[run["id"]],
            "model_versions": deepcopy(executed["runs"][run["id"]]),
            "stage_execution_sources": {
                model: {name: deepcopy(((run.get("stages") or {}).get(model) or {}).get(name))
                        for name in ("completed_at", "runtime", "reused_from")}
                for model in ("ndr", "sdr")},
            "artifacts": {name: run["artifacts"][name] for name in MASS_UNITS},
            "scenario": workspace._get("scenarios", run["selection"]["scenario_id"]),
        } for run in runs],
        "files": files,
        "methods": [
            "Original study affine, reporting mask and model-domain polygons are retained.",
            "Each completed model retains its original runtime, including independently adopted NDR and SDR stages.",
            "Execution versions follow the shared completed-stage policy; original stage completion, runtime and reuse records are retained for independent receiving.",
            "Annual native rates were converted once using the retained pixel area; delivered raster values are annual mass per pixel.",
            "Each scenario map is alternative minus baseline on paired native valid cells.",
            "The combined map uses the separately retained nonnegative weights and normalization.",
            "Source context and legal designation maps are included only when their original sources are explicitly selected.",
        ],
        "contact": selection["contact"],
    }
    target = Path(directory) / "native-study" / "study.json"
    atomic_json(target, context, immutable=True)
    files = {**files, "context": describe_file(directory, target)}
    for name, item in files.items():
        state["files"]["native_study_" + name] = item
    state["native_study"] = context
    return context
