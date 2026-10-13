"""Design, execute and reopen parameter studies using the retained InVEST runs.

Every case retains the original grid, land-cover scenario and biophysical source.
Native execution and interrupted-stage recovery remain in model.native.
"""
from __future__ import annotations

from copy import deepcopy
import csv
import html
import io
import itertools
import json
import math
from pathlib import Path

from .common import (INVEST_VERSION, atomic_bytes, atomic_json, canonical,
                     describe_file, digest, held, identifier, now, read_json,
                     verify_file)
from .profiles import NDR_KEYS, SDR_KEYS, checked_parameters
from .model_selection import (grid_models, models as normalize_models,
                              required_outputs, run_models, selected,
                              validate_completed_run)
from .native_versions import comparison_versions, guide_url, model_versions, version_label
from . import rasters
from .native_execution import storage_exhausted
from .parameter_exports import EDITION as EXPORT_EDITION, retain_differences, write_archive
from .reuse import copy_verified

SCHEMA = "upstate.parameter-experiment/v1"
NATIVE_VERSION_EDITION = "parameter-study-native-versions/1"
SELECTION_SCHEMA = "upstate.parameter-experiment-selection/v1"
DESIGNS = ("one-at-a-time", "factorial")
PARAMETERS = {
    "threshold_flow_accumulation": ("Flow accumulation threshold", "cells", "positive"),
    "k_param": ("Connectivity shape parameter", "dimensionless", "positive"),
    "flow_dir_algorithm": ("Flow direction", "algorithm", "mfd or d8"),
    "subsurface_critical_length_n": ("Nitrogen subsurface retention length", "m", "positive"),
    "subsurface_eff_n": ("Nitrogen subsurface retention efficiency", "fraction", "0 to 1"),
    "runoff_proxy_av": ("Reference runoff proxy average", "input proxy units", "positive"),
    "sdr_max": ("Maximum sediment delivery ratio", "fraction", "0 to 1"),
    "ic_0_param": ("Sediment connectivity midpoint", "dimensionless", "finite"),
    "l_max": ("Maximum RUSLE L-factor", "dimensionless", "positive"),
}
ALLOWED = {"ndr": NDR_KEYS, "sdr": SDR_KEYS}


def _baseline(workspace, run_id):
    run = workspace.inspect_run(identifier(run_id))
    profile = workspace._get("profiles", run["selection"]["profile_id"])
    grid = workspace.get_grid(run["selection"]["grid_id"])
    workspace._get("scenarios", run["selection"]["scenario_id"])
    active = run_models(run)
    if not set(active).issubset(selected(profile)):
        raise ValueError("The baseline profile must contain the selected native model parameters")
    if not set(active).issubset(grid_models(grid)):
        raise ValueError("The retained grid lacks inputs for a selected baseline model")
    validate_completed_run(run)
    return run, profile


def _baseline_versions(run):
    versions = model_versions(run)
    return {"baseline_native_versions": versions,
            "baseline_version_labels": {model: version_label(info) for model, info in versions.items()},
            "baseline_version_guides": {model: guide_url(model, info) for model, info in versions.items()},
            "preparation_invest_version": INVEST_VERSION}


def _check_preparation_versions(run):
    """Bind new cases to the maintained runner without replacing saved studies."""
    for model, info in model_versions(run).items():
        stage = (run.get("stages") or {}).get(model) or {}
        if run.get("state") != "complete" and not stage.get("completed_at"):
            # An unfinished stage can still execute under the current runner.
            # Its historical request is not a completed execution observation.
            continue
        if info["comparison_version"] != INVEST_VERSION:
            raise ValueError("New parameter cases use InVEST " + INVEST_VERSION +
                             "; the retained baseline " + model.upper() + " uses " +
                             version_label(info) + ". Reopen the existing saved study "
                             "to summarize its original completed cases.")


def _retained_study_id(workspace, selection):
    """Use the original Workspace experiment-spec identity without writing it."""
    value = {name: item for name, item in selection.items() if name not in ("id", "schema")}
    value["schema"] = "upstate.experiment-specs/v1"
    key = digest(value)
    return key if (workspace.root / "experiments" / key / "experiment.json").is_file() else None


def catalog(workspace, baseline_run_id):
    run, profile = _baseline(workspace, baseline_run_id)
    parameters = []
    active = run_models(run)
    for model in active:
        for key in sorted(ALLOWED[model]):
            label, units, constraint = PARAMETERS[key]
            parameters.append({"parameter": model + "." + key, "model": model,
                               "label": label, "units": units, "constraint": constraint,
                               "baseline_value": profile[model].get(key),
                               "explicit_in_baseline": key in profile[model]})
    return {"baseline_run_id": run["id"], "selection": run["selection"],
            "baseline_state": run["state"], "profile_title": profile["title"],
            "references": profile["references"], "parameters": parameters,
            "designs": list(DESIGNS), "invest_version": run["selection"].get("invest_version"),
            "invest_version_basis": "baseline_requested_declaration", **_baseline_versions(run),
            "models": list(active), "pollutants": list(required_outputs(active))}


def _references(value, label):
    if not isinstance(value, list) or not value or any(
            not isinstance(item, str) or not item.strip() for item in value):
        raise ValueError(label + " requires a nonempty list of source references")
    return list(dict.fromkeys(item.strip() for item in value))


def _unique(values):
    seen, result = set(), []
    for value in values:
        token = canonical(value)
        if token not in seen:
            seen.add(token)
            result.append(value)
    return result


def _profile_signature(profile, *, models=None):
    active = selected(profile) if models is None else normalize_models(models)
    if not set(active).issubset(selected(profile)):
        raise ValueError("The parameter profile does not cover the selected native models")
    return digest({"source_collection_id": profile["source_collection_id"],
                   "biophysical_source_id": profile["biophysical_source_id"],
                   "table_sha256": profile["table_summary"]["sha256"],
                   "models": list(active),
                   "parameters": {model: profile[model] for model in active},
                   "invest_version": INVEST_VERSION})


def _apply(profile, overrides, *, models=None):
    value = deepcopy(profile)
    active = selected(profile) if models is None else normalize_models(models)
    if not set(active).issubset(selected(profile)):
        raise ValueError("The parameter profile does not cover the selected native models")
    for path, parameter_value in overrides.items():
        model, key = path.split(".")
        if model not in active:
            raise ValueError("Parameter " + path + " is outside the profile's selected native models")
        value[model][key] = parameter_value
    value.update(checked_parameters(value))
    return value


def _selection(workspace, value):
    if not isinstance(value, dict):
        raise ValueError("Supply a parameter experiment selection object")
    allowed = {"schema", "title", "purpose", "baseline_run_id", "design",
               "axes", "reporting_areas", "difference_maps"}
    if set(value) - allowed:
        raise ValueError("Unknown experiment fields: " + ", ".join(sorted(set(value) - allowed)))
    if value.get("schema", SELECTION_SCHEMA) != SELECTION_SCHEMA:
        raise ValueError("Select an upstate.parameter-experiment-selection/v1 document")
    title, purpose = value.get("title"), value.get("purpose")
    if not isinstance(title, str) or not title.strip() or not isinstance(purpose, str) or not purpose.strip():
        raise ValueError("Name the experiment and its scientific question")
    design = value.get("design")
    if design not in DESIGNS:
        raise ValueError("Design must be one-at-a-time or factorial")
    run, profile = _baseline(workspace, value.get("baseline_run_id"))
    active = run_models(run)
    raw_axes = value.get("axes")
    if not isinstance(raw_axes, list) or not raw_axes:
        raise ValueError("Select explicit parameters and values")
    axes, seen_parameters, seen_names = [], set(), set()
    for number, raw in enumerate(raw_axes, 1):
        if not isinstance(raw, dict) or set(raw) - {"name", "parameters", "values", "reason", "references"}:
            raise ValueError("Each axis needs name, parameters, values, reason and references")
        name, reason = raw.get("name"), raw.get("reason")
        if not isinstance(name, str) or not name.strip() or name.strip() in seen_names:
            raise ValueError("Give each experiment axis a distinct name")
        if not isinstance(reason, str) or not reason.strip():
            raise ValueError("Explain the scientific reason for axis " + name)
        paths = raw.get("parameters")
        if not isinstance(paths, list) or not paths or any(not isinstance(p, str) for p in paths):
            raise ValueError("List the native parameter paths for axis " + name)
        if len(set(paths)) != len(paths):
            raise ValueError("An axis repeats a native parameter")
        for path in paths:
            parts = path.split(".")
            if len(parts) != 2 or parts[0] not in ALLOWED or parts[1] not in ALLOWED[parts[0]]:
                raise ValueError("Unknown native parameter " + path)
            if parts[0] not in active:
                raise ValueError("Parameter " + path + " is outside the baseline's selected native models")
            if path in seen_parameters:
                raise ValueError("A parameter can belong to only one axis: " + path)
        raw_values = raw.get("values")
        if not isinstance(raw_values, list) or not raw_values:
            raise ValueError("Supply explicit values for axis " + name)
        references = _references(raw.get("references"), "Axis " + name)
        values, tokens = [], set()
        for item in raw_values:
            changed = _apply(profile, {path: item for path in paths}, models=active)
            normalized = [changed[m][k] for m, k in (path.split(".") for path in paths)]
            if any(canonical(v) != canonical(normalized[0]) for v in normalized[1:]):
                raise ValueError("Coupled native parameters must accept the same explicit value")
            selected = normalized[0]
            token = canonical(selected)
            if token not in tokens:
                tokens.add(token)
                values.append(selected)
        axes.append({"name": name.strip(), "parameters": paths, "values": values,
                     "reason": reason.strip(), "references": references})
        seen_names.add(name.strip())
        seen_parameters.update(paths)
    raw_areas = value.get("reporting_areas", [])
    if not isinstance(raw_areas, list):
        raise ValueError("Reporting areas must be source selections")
    areas, area_names = [], set()
    for raw in raw_areas:
        if not isinstance(raw, dict) or set(raw) - {
                "name", "source_collection_id", "source_id", "layer", "where"}:
            raise ValueError("Reporting areas need name and a retained polygon source selection")
        area = dict(raw)
        name = area.get("name")
        if not isinstance(name, str) or not name.strip() or name.strip() in area_names:
            raise ValueError("Give each reporting area a distinct name")
        area["name"] = name.strip()
        area["source_collection_id"] = identifier(area.get("source_collection_id"))
        _, entry = workspace.source_file(area["source_collection_id"], area.get("source_id"))
        if entry["kind"] != "vector":
            raise ValueError("Reporting areas require original vector polygons")
        if "where" in area and not isinstance(area["where"], dict):
            raise ValueError("Reporting area filters must be exact field/value selections")
        areas.append(area)
        area_names.add(area["name"])
    maps = value.get("difference_maps", False)
    if not isinstance(maps, bool):
        raise ValueError("difference_maps must be true or false")
    selection = {"schema": SELECTION_SCHEMA, "title": title.strip(),
                 "purpose": purpose.strip(), "baseline_run_id": run["id"],
                 "design": design, "axes": axes, "reporting_areas": areas,
                 "difference_maps": maps}
    return selection, run, profile


def _different(profile, overrides):
    return {path: value for path, value in overrides.items()
            if profile[path.split(".")[0]].get(path.split(".")[1]) != value}


def _cases(selection, profile):
    axes = selection["axes"]
    if selection["design"] == "one-at-a-time":
        combinations = (((index, item),) for index, axis in enumerate(axes)
                        for item in axis["values"])
    else:
        combinations = (tuple(enumerate(items)) for items in
                        itertools.product(*(axis["values"] for axis in axes)))
    for values in combinations:
        overrides = {path: item for index, item in values
                     for path in axes[index]["parameters"]}
        overrides = _different(profile, overrides)
        if not overrides:
            continue
        selected_axes = [{"name": axes[index]["name"], "value": item,
                          "parameters": axes[index]["parameters"]}
                         for index, item in values
                         if any(path in overrides for path in axes[index]["parameters"])]
        yield {"id": digest(overrides),
               "label": "; ".join(item["name"] + " = " + str(item["value"]) for item in selected_axes),
               "overrides": overrides, "axis_values": selected_axes}


def _count(selection, profile):
    counts, baseline_present = [], []
    for axis in selection["axes"]:
        matching = sum(not _different(profile, {p: v for p in axis["parameters"]})
                       for v in axis["values"])
        counts.append(len(axis["values"]))
        baseline_present.append(matching)
    if selection["design"] == "one-at-a-time":
        return sum(count - matching for count, matching in zip(counts, baseline_present))
    return math.prod(counts) - int(all(baseline_present))


def preview(workspace, selection):
    selection, run, profile = _selection(workspace, selection)
    count = _count(selection, profile)
    if count < 1:
        raise ValueError("Select at least one parameter value different from the baseline")
    if _retained_study_id(workspace, selection) is None:
        _check_preparation_versions(run)
    return {"schema": SCHEMA, "title": selection["title"], "design": selection["design"],
            "baseline_run_id": run["id"], "baseline_state": run["state"],
            "baseline_selection": run["selection"], "case_count": count + 1,
            "alternatives": count, "axes": selection["axes"],
            "examples": list(itertools.islice(_cases(selection, profile), 12)),
            "example_count": min(count, 12), "reporting_areas": selection["reporting_areas"],
            "difference_maps": selection["difference_maps"],
            "selection": selection, "invest_version": run["selection"].get("invest_version"),
            "invest_version_basis": "baseline_requested_declaration", **_baseline_versions(run),
            "models": list(run_models(run)),
            "pollutants": list(required_outputs(run_models(run)))}


def prepare(workspace, selection):
    selection, baseline, profile = _selection(workspace, selection)
    active = run_models(baseline)
    count = _count(selection, profile)
    if count < 1:
        raise ValueError("Select at least one parameter value different from the baseline")
    retained = _retained_study_id(workspace, selection)
    if retained is not None:
        return inspect(workspace, retained)
    _check_preparation_versions(baseline)
    spec = workspace._save("experiment-specs", selection)
    key = spec["id"]
    directory = workspace.root / "experiments" / key
    directory.mkdir(parents=True, exist_ok=True)
    state_path = directory / "experiment.json"
    with held(directory / ".experiment.lock", blocking=False):
        if state_path.exists():
            return inspect(workspace, key)
        atomic_json(directory / "selection.json", selection, immutable=True)
        cases = [{"id": "baseline", "label": "Baseline", "overrides": {}, "axis_values": [],
                  "profile_id": profile["id"], "run_id": baseline["id"], "state": baseline["state"],
                  "run_selection": deepcopy(baseline["selection"])}]
        base_references = profile["references"] if isinstance(profile["references"], list) else [profile["references"]]
        profiles_by_signature = {
            _profile_signature(item, models=active): item for item in workspace._list("profiles")
            if set(active).issubset(selected(item))
        }
        for case in _cases(selection, profile):
            changed = _apply(profile, case["overrides"], models=active)
            signature = _profile_signature(changed, models=active)
            for field in ("id", "schema", "table_summary"):
                changed.pop(field, None)
            changed["title"] = selection["title"] + ": " + case["label"]
            references = list(base_references)
            for axis in selection["axes"]:
                if any(path in case["overrides"] for path in axis["parameters"]):
                    references.extend(axis["references"])
            # Keep original references, methods, model period and coefficient source.
            changed["references"] = _unique(references)
            changed["parameter_experiment"] = {
                "experiment_id": key, "baseline_profile_id": profile["id"],
                "overrides": case["overrides"], "purpose": selection["purpose"]}
            reused_profile = signature in profiles_by_signature
            saved = profiles_by_signature.get(signature) or workspace.save_profile(changed)
            profiles_by_signature[signature] = saved
            run = workspace.prepare_run({**baseline["selection"], "profile_id": saved["id"]})
            cases.append({**case, "profile_id": saved["id"], "run_id": run["id"],
                          "profile_reused": reused_profile, "state": run["state"],
                          "run_selection": deepcopy(run["selection"])})
        state = {"schema": SCHEMA, "id": key, "workspace_id": workspace.project["id"],
                 "selection": selection, "state": "prepared", "created_at": now(),
                 "updated_at": now(), "invest_version": baseline["selection"].get("invest_version"),
                 "invest_version_basis": "baseline_requested_declaration", **_baseline_versions(baseline),
                 "baseline_selection": baseline["selection"], "cases": cases,
                 "models": list(run_models(baseline)),
                 "pollutants": list(required_outputs(run_models(baseline))),
                 "progress": {"total": len(cases), "completed": 0, "failed": 0},
                 "artifacts": {}}
        atomic_json(state_path, state)
    return inspect(workspace, key)


def _read(workspace, key):
    key = identifier(key)
    spec = workspace._get("experiment-specs", key)
    state = read_json(workspace.root / "experiments" / key / "experiment.json")
    return _bind_state(workspace, key, spec, state)


def _bind_state(workspace, key, spec, state):
    """Bind a checkpoint or its catalogue projection to its original selection."""
    expected = {k: v for k, v in spec.items() if k not in ("id", "schema")}
    actual = {k: v for k, v in state["selection"].items() if k != "schema"}
    if state.get("id") != key or expected != actual or state.get("workspace_id") != workspace.project["id"]:
        raise ValueError("The retained experiment differs from its original project selection")
    active = selected(state["baseline_selection"])
    state["models"] = list(active)
    state["pollutants"] = list(required_outputs(active))
    return state


def inspect(workspace, key):
    state = _read(workspace, key)
    active = selected(state["baseline_selection"])
    completed = failed = 0
    for case in state["cases"]:
        run = workspace.inspect_run(case["run_id"])
        if (run["selection"]["profile_id"] != case["profile_id"]
                or run_models(run) != active
                or any(run["selection"][field] != state["baseline_selection"][field]
                       for field in ("grid_id", "scenario_id"))):
            raise ValueError("An experiment case changed its retained model selection")
        frozen = case.get("run_selection")
        if "run_selection" in case:
            if not isinstance(frozen, dict) or run["selection"] != frozen:
                raise ValueError("An experiment case changed its original saved run selection")
        elif run["selection"].get("invest_version") != state["baseline_selection"].get("invest_version"):
            # Historical cases were prepared under this original shared declaration.
            raise ValueError("A legacy experiment case changed its retained requested version")
        if case["id"] == "baseline":
            if run["id"] != state["selection"]["baseline_run_id"] or run["selection"] != state["baseline_selection"]:
                raise ValueError("The experiment baseline differs from its original saved run")
            state.update(_baseline_versions(run))
        validate_completed_run(run)
        case["state"] = run["state"]
        if run["state"] == "complete":
            versions = model_versions(run, active)
            case["native_versions"] = versions
            case["native_version_labels"] = {model: version_label(info) for model, info in versions.items()}
        else:
            case.pop("native_versions", None)
            case.pop("native_version_labels", None)
        if run.get("error"):
            case["error"] = run["error"]
        else:
            case.pop("error", None)
        completed += int(case["state"] == "complete")
        failed += int(case["state"] == "failed")
    state["progress"] = {"total": len(state["cases"]), "completed": completed, "failed": failed}
    if state["state"] == "complete" and completed != len(state["cases"]):
        state["state"] = "partial"
    return state


def list_experiments(workspace):
    # The workspace catalogue uses saved execution checkpoints. Inspecting the
    # selected study refreshes its cases without rereading every native run on
    # each global workbench refresh.
    return [_read(workspace, path.parent.name)
            for path in sorted((workspace.root / "experiments").glob("*/experiment.json"))]


def _areas(workspace, selections, target_crs, grid_id):
    grid = workspace.get_grid(grid_id)
    source = verify_file(workspace.root / "grids" / grid_id, grid["files"]["reporting_area"])
    rows, _ = rasters.vector_geometry(source, target_crs=target_crs)
    reporting = rasters.polygon_union(rows)
    result = [{"id": "reporting-area", "name": "Full reporting area", "geometry": None,
               "source_area_ha": reporting.area / 10000,
               "reporting_intersection_ha": reporting.area / 10000,
               "reporting_fraction": 1.0}]
    for selection in selections:
        source, entry = workspace.source_file(selection["source_collection_id"], selection["source_id"])
        rows, _ = rasters.vector_geometry(
            source, layer=selection.get("layer") or entry.get("layer"),
            where=selection.get("where"), target_crs=target_crs)
        geometry = rasters.polygon_union(rows)
        clipped = geometry.intersection(reporting)
        result.append({"id": digest(selection), "name": selection["name"], "geometry": geometry,
                       "source_area_ha": geometry.area / 10000,
                       "reporting_intersection_ha": clipped.area / 10000,
                       "reporting_fraction": min(1.0, max(0.0, clipped.area / geometry.area)),
                       "source": {"selection": selection, "uri": entry["uri"],
                                  "vintage": entry["vintage"], "sha256": entry["body"]["sha256"]}})
    return result


def _paired(baseline_path, case_path, areas, *, pollutant, checkpoint=None):
    import numpy as np
    import rasterio
    from rasterio.features import geometry_mask
    totals = {area["id"]: {"baseline_mass": 0.0, "case_mass": 0.0,
                          "baseline_full_mass": 0.0, "case_full_mass": 0.0,
                          "baseline_valid_cells": 0, "case_valid_cells": 0,
                          "paired_valid_cells": 0} for area in areas}
    with rasterio.open(baseline_path) as baseline, rasterio.open(case_path) as alternative:
        rasters.check_same_grid(baseline, alternative)
        expected_units = rasters.MASS_UNITS[pollutant]
        if any(raster.tags().get("units") != expected_units for raster in (baseline, alternative)):
            raise ValueError("Parameter comparisons require retained " + expected_units + " mass rasters")
        transform = baseline.transform
        pixel_area_ha = abs(transform.a * transform.e - transform.b * transform.d) / 10000.0
        if not math.isfinite(pixel_area_ha) or pixel_area_ha <= 0:
            raise ValueError("The retained comparison grid has invalid pixel area")
        # Native capture already converted the original per-hectare rates to
        # annual mass per pixel. Aggregate those stored masses exactly once.
        block_height, block_width = baseline.block_shapes[0]
        total_windows = (math.ceil(baseline.height / block_height)
                         * math.ceil(baseline.width / block_width))
        next_window = 0
        if checkpoint is not None:
            totals, next_window = checkpoint.begin(totals, total_windows)
        for window_index, (_, window) in enumerate(baseline.block_windows(1)):
            if window_index < next_window:
                continue
            a = baseline.read(1, window=window, masked=True)
            b = alternative.read(1, window=window, masked=True)
            av, bv = np.ma.getdata(a), np.ma.getdata(b)
            valid_a = ~np.ma.getmaskarray(a) & np.isfinite(av)
            valid_b = ~np.ma.getmaskarray(b) & np.isfinite(bv)
            for area in areas:
                inside = (np.ones(a.shape, dtype=bool) if area["geometry"] is None else
                          geometry_mask([area["geometry"].__geo_interface__], out_shape=a.shape,
                                        transform=baseline.window_transform(window),
                                        invert=True, all_touched=False))
                ga, gb = valid_a & inside, valid_b & inside
                paired = ga & gb
                total = totals[area["id"]]
                total["baseline_mass"] += float(av[paired].sum(dtype="float64"))
                total["case_mass"] += float(bv[paired].sum(dtype="float64"))
                total["baseline_full_mass"] += float(av[ga].sum(dtype="float64"))
                total["case_full_mass"] += float(bv[gb].sum(dtype="float64"))
                total["baseline_valid_cells"] += int(ga.sum())
                total["case_valid_cells"] += int(gb.sum())
                total["paired_valid_cells"] += int(paired.sum())
            if checkpoint is not None:
                # Publish only after every area has consumed this complete window.
                checkpoint.advance(totals, window_index + 1,
                                   force=window_index + 1 == total_windows)
    for area in areas:
        total = totals[area["id"]]
        for name in ("baseline", "case"):
            if not total[name + "_valid_cells"]:
                total[name + "_full_mass"] = None
        if total["paired_valid_cells"]:
            total["change"] = total["case_mass"] - total["baseline_mass"]
            total["percent_change"] = (100.0 * total["change"] / total["baseline_mass"]
                                        if total["baseline_mass"] != 0 else None)
        else:
            total.update(baseline_mass=None, case_mass=None, change=None, percent_change=None)
        total["pixel_area_ha"] = pixel_area_ha
        total["baseline_valid_area_ha"] = total["baseline_valid_cells"] * pixel_area_ha
        total["case_valid_area_ha"] = total["case_valid_cells"] * pixel_area_ha
        total["paired_area_ha"] = total["paired_valid_cells"] * pixel_area_ha
        total["support_changed"] = (total["paired_valid_cells"] != total["baseline_valid_cells"]
                                   or total["paired_valid_cells"] != total["case_valid_cells"])
    return totals


def _response(case, profile, change, baseline_mass):
    if len(case["overrides"]) != 1 or change is None:
        return {}
    path, value = next(iter(case["overrides"].items()))
    model, key = path.split(".")
    base_value = profile[model].get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not isinstance(base_value, (int, float)):
        return {}
    step = value - base_value
    if not step:
        return {}
    result = {"parameter": path, "baseline_parameter": base_value, "case_parameter": value,
              "response_per_parameter_unit": change / step}
    result["elasticity"] = ((change / baseline_mass) / (step / base_value)
                            if baseline_mass not in (None, 0) and base_value != 0 else None)
    return result


def _compatible_aggregation_implementations():
    """Retain exact reviewed predecessor sums across this metadata-only edition."""
    import ast
    import hashlib
    from . import parameter_pair_cache
    # The cache successor is an exact authored body, not a future-code wildcard.
    # Its restore/adoption path only copies authenticated values; it performs no
    # scientific arithmetic. Both numerical engine functions must be unchanged.
    if hashlib.sha256(Path(parameter_pair_cache.__file__).read_bytes()).hexdigest() != "fb7846b4e66b2d20fe34e2e291176e0862d101041ab01a9652c0c6a339b284b2":
        return ()
    source = Path(__file__).read_text(encoding="utf-8")
    expected = {"_areas": "358bb1a794bc17936921875a278d4f1cc4fa9c92a0dd5002b759f7e71e8044c3","_paired": "b365337efc4d2f9d73b07271cf0301d1673670d031d51cc7da01279c218fa6a9"}
    nodes = {node.name: node for node in ast.parse(source).body if isinstance(node, ast.FunctionDef)}
    for name, checksum in expected.items():
        node = nodes.get(name)
        segment = ast.get_source_segment(source, node) if node is not None else None
        if segment is None or hashlib.sha256(segment.encode("utf-8")).hexdigest() != checksum:
            return ()
    return ({"engine_sha256": "467abced7106c569b80576e16a7e465cafc8921a2402ca13f9c488b4bfd49a0d","cache_sha256": "9fc1f05a28b306ad8c411e5cafd5a622659e773b31d062233e2028580b0bec98"},
            {"engine_sha256": "2294aa27eae35c1d60f3526cbf1e3dcc58e97ec3006a8d89e2839e063ad95687","cache_sha256": "9fc1f05a28b306ad8c411e5cafd5a622659e773b31d062233e2028580b0bec98"},
            {"engine_sha256": "7bd58c5e1a3e6334b127fd584df34f6cbe478481147586806198ce16e4059a20","cache_sha256": "9fc1f05a28b306ad8c411e5cafd5a622659e773b31d062233e2028580b0bec98"})


def _version_exports(directory, result):
    """Keep every case/model source binding beside the unchanged quantitative CSV."""
    cohort = result["native_versions"]
    document = {"schema": "upstate.parameter-native-versions/v1",
                "experiment_id": result["experiment_id"],
                "workspace_id": result["workspace_id"],
                "native_versions": cohort, "native_run_selections": result["native_run_selections"],
                "native_version_labels": result["native_version_labels"],
                "native_version_guides": result["native_version_guides"]}
    atomic_json(directory / "native-versions.json", document)
    fields = ["case_id", "case", "run_id", "model", "comparison_version", "basis",
              "observed_stage_version", "observed_run_version", "requested_version",
              "differs_from_requested", "stage_completed_at", "version_label", "guide_url", "reused_from"]
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    for case in result["cases"]:
        run_id = case["run_id"]
        versions = cohort["runs"].get(run_id)
        if versions is None:
            continue
        for model in cohort["models"]:
            info = versions[model]
            writer.writerow({**info, "case_id": case["id"], "case": case["label"],
                             "run_id": run_id, "model": model,
                             "version_label": result["native_version_labels"][run_id][model],
                             "guide_url": result["native_version_guides"][run_id][model],
                             "reused_from": json.dumps(info.get("reused_from"), sort_keys=True)})
    atomic_bytes(directory / "native-versions.csv", output.getvalue().encode("utf-8"))


def _summarize(workspace, key, *, progress=None):
    state = inspect(workspace, key)
    directory = workspace.root / "experiments" / key
    completed = [case for case in state["cases"] if case["state"] == "complete"]
    baseline_case = state["cases"][0]
    if baseline_case["state"] != "complete":
        raise ValueError("Complete the retained baseline before comparing parameter cases")
    baseline = workspace.inspect_run(baseline_case["run_id"])
    profile = workspace._get("profiles", baseline_case["profile_id"])
    active = run_models(baseline)
    pollutants = required_outputs(active)
    # Reject an incompatible execution cohort before opening raster inputs or a cache.
    completed_runs = {case["run_id"]: workspace.inspect_run(case["run_id"]) for case in completed}
    native_versions = comparison_versions(
        [completed_runs[case["run_id"]] for case in completed], active)
    import rasterio
    from .parameter_pair_cache import PairResults
    baseline_files = {name: verify_file(workspace.root / "runs" / baseline["id"],
                                        baseline["artifacts"][name]) for name in pollutants}
    with rasterio.open(baseline_files[pollutants[0]]) as raster:
        areas = _areas(workspace, state["selection"]["reporting_areas"], raster.crs,
                       baseline["selection"]["grid_id"])
    cache = PairResults(
        directory, workspace_id=workspace.project["id"], experiment_id=key,
        engine_path=Path(__file__), areas=areas,
        total_pairs=len(completed) * len(pollutants), progress=progress,
        compatible_implementations=_compatible_aggregation_implementations())
    rows = []
    for case in completed:
        run = completed_runs[case["run_id"]]
        for pollutant in pollutants:
            path = (baseline_files[pollutant] if case["id"] == "baseline" else
                    verify_file(workspace.root / "runs" / run["id"], run["artifacts"][pollutant]))
            values = cache.evaluate(
                case_id=case["id"], run_id=run["id"], pollutant=pollutant,
                baseline=baseline["artifacts"][pollutant],
                alternative=run["artifacts"][pollutant],
                calculate=lambda checkpoint: _paired(
                    baseline_files[pollutant], path, areas,
                    pollutant=pollutant, checkpoint=checkpoint))
            for area in areas:
                value = values[area["id"]]
                rows.append({"case_id": case["id"], "case": case["label"], "run_id": run["id"],
                             "profile_id": case["profile_id"], "area_id": area["id"], "area": area["name"],
                             "pollutant": pollutant, "units": rasters.MASS_UNITS[pollutant].replace("/pixel", ""),
                             "overrides": case["overrides"], **value,
                             **_response(case, profile, value["change"], value["baseline_mass"])})
    ranges = []
    for area in areas:
        for pollutant in pollutants:
            selected = [r for r in rows if r["area_id"] == area["id"] and r["pollutant"] == pollutant
                        and r["case_id"] != "baseline" and r["case_mass"] is not None]
            # Equal-support cases can be compared directly with one another.
            matched = [r for r in selected if not r["support_changed"]]
            if matched:
                low = min(matched, key=lambda row: row["case_mass"])
                high = max(matched, key=lambda row: row["case_mass"])
                ranges.append({"area_id": area["id"], "area": area["name"], "pollutant": pollutant,
                               "units": low["units"], "cases": len(matched),
                               "minimum_mass": low["case_mass"], "maximum_mass": high["case_mass"],
                               "minimum_case_id": low["case_id"], "maximum_case_id": high["case_id"],
                               "support_changed_cases": len(selected) - len(matched)})
    aggregation = cache.finish()
    result = {"schema": "upstate.parameter-experiment-results/v1", "experiment_id": key,
              "aggregation": aggregation,
              "workspace_id": workspace.project["id"], "title": state["selection"]["title"],
              "purpose": state["selection"]["purpose"], "design": state["selection"]["design"],
              "selection": state["selection"], "baseline_selection": baseline["selection"],
              "invest_version": baseline["selection"].get("invest_version"),
              "invest_version_basis": "baseline_requested_declaration",
              "native_versions": native_versions,
              "native_run_selections": {run_id: deepcopy(run["selection"]) for run_id, run in completed_runs.items()},
              "native_version_labels": {run_id: {model: version_label(info) for model, info in versions.items()}
                                       for run_id, versions in native_versions["runs"].items()},
              "native_version_guides": {run_id: {model: guide_url(model, info) for model, info in versions.items()}
                                       for run_id, versions in native_versions["runs"].items()},
              "completed_cases": len(completed),
              "total_cases": len(state["cases"]), "cases": state["cases"],
              "areas": [{k: v for k, v in area.items() if k != "geometry"} for area in areas],
              "rows": rows, "ranges": ranges,
              "models": list(active), "pollutants": list(pollutants),
              "mass_basis": "Sum of retained annual mass per pixel. Native capture converted source "
                            "rates using each original affine pixel area; study aggregation sums "
                            "those retained mass values.",
              "aggregation_extent": "Original reporting mask; each selected polygon is intersected with that extent.",
              "comparison_basis": "Alternative minus baseline on the same valid pixel centres. "
                                  "Independent full totals and support counts remain in every row.",
              "range_basis": "Minimum and maximum over the selected completed parameter cases with "
                             "unchanged spatial support; the selection is an explicit parameter study.",
              "coefficient_source": {"profile_id": profile["id"], "references": profile["references"],
                                     "biophysical_source_id": profile["biophysical_source_id"],
                                     "source_collection_id": profile["source_collection_id"],
                                     "table_summary": profile["table_summary"]}}
    _version_exports(directory, result)
    atomic_json(directory / "results.json", result)
    fields = ["case_id", "case", "run_id", "profile_id", "area_id", "area", "pollutant", "units",
              "baseline_mass", "case_mass", "change", "percent_change", "baseline_full_mass",
              "case_full_mass", "baseline_valid_cells", "case_valid_cells", "paired_valid_cells",
              "pixel_area_ha", "baseline_valid_area_ha", "case_valid_area_ha", "paired_area_ha",
              "support_changed", "parameter", "baseline_parameter", "case_parameter",
              "response_per_parameter_unit", "elasticity", "overrides"]
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({**row, "overrides": json.dumps(row["overrides"], sort_keys=True)})
    atomic_bytes(directory / "results.csv", output.getvalue().encode("utf-8"))
    atomic_bytes(directory / "report.html", _report(result).encode("utf-8"))
    return result


def _report(result):
    esc = lambda value: html.escape(str(value), quote=True)
    def number(value):
        return "—" if value is None else format(value, ",.6g")
    row_html = []
    for row in result["rows"]:
        row_html.append("<tr>" + "".join("<td>" + esc(value) + "</td>" for value in (
            row["area"], row["case"], row["pollutant"].replace("_export", ""), row["units"],
            number(row["baseline_mass"]), number(row["case_mass"]), number(row["change"]),
            number(row["percent_change"]), str(row["paired_valid_cells"]),
            "Changed" if row["support_changed"] else "Same")) + "</tr>")
    axes = []
    for axis in result["selection"]["axes"]:
        axes.append("<tr><td>" + esc(axis["name"]) + "</td><td>" +
                    esc(", ".join(axis["parameters"])) + "</td><td>" +
                    esc(", ".join(map(str, axis["values"]))) + "</td><td>" +
                    esc(axis["reason"]) + "</td><td>" +
                    "<br>".join(esc(ref) for ref in axis["references"]) + "</td></tr>")
    maps = result.get("difference_maps", {})
    map_section = ""
    if maps.get("requested"):
        map_rows = []
        for alternative in maps.get("alternatives", []):
            for pollutant, descriptor in alternative["artifacts"].items():
                map_rows.append("<tr><td>" + esc(alternative["case"]) + "</td><td>" +
                                esc(pollutant.replace("_export", "")) + "</td><td>" +
                                esc(descriptor["units"]) + '</td><td><a href="' +
                                esc(descriptor["path"]) + '">Download GeoTIFF</a></td></tr>')
        if map_rows:
            map_section = ('<h2>Spatial parameter responses</h2><p>' +
                           esc(maps["basis"]) + '</p><p><a href="' +
                           esc(maps["comparison"]["path"]) + '">Original comparison</a> · ' +
                           '<a href="' + esc(maps["grid"]["path"]) +
                           '">Original grid</a></p><div class="scroll"><table><thead><tr>' +
                           '<th>Case</th><th>Pollutant</th><th>Units</th><th>GIS file</th>' +
                           '</tr></thead><tbody>' + "".join(map_rows) + '</tbody></table></div>')
        else:
            map_section = ("<h2>Spatial parameter responses</h2><p>Maps will be included "
                           "as the selected native alternatives complete.</p>")
    cohort = result.get("native_versions") or {}
    execution = "<h2>Executed model versions</h2>"
    if isinstance(cohort, dict) and cohort.get("runs"):
        labels = result.get("native_version_labels") or {}
        guides = result.get("native_version_guides") or {}
        version_rows = []
        case_labels = {}
        for case in result.get("cases", []):
            case_labels.setdefault(case.get("run_id"), []).append(case.get("label") or case.get("id"))
        for run_id, models in cohort["runs"].items():
            for model, info in models.items():
                reused = info.get("reused_from") or {}
                origin = (str(reused["run_id"]) + " / " + str(reused.get("model") or model)
                          if isinstance(reused, dict) and reused.get("run_id") else "—")
                version = esc(info.get("comparison_version") or "Unavailable")
                version += "<br>" + esc(labels.get(run_id, {}).get(model) or info.get("basis") or "Not recorded")
                guide = guides.get(run_id, {}).get(model)
                if isinstance(guide, str) and guide.startswith(("https://", "http://")):
                    version += '<br><a href="' + esc(guide) + '">Model guide</a>'
                values = (
                    esc(", ".join(str(value) for value in case_labels.get(run_id, []) if value)) +
                    "<br><code>" + esc(run_id) + "</code>",
                    esc(str(model).upper()), version,
                    esc(info.get("requested_version") or "Not recorded"),
                    esc(info.get("stage_completed_at") or "Not recorded"), esc(origin))
                version_rows.append("<tr>" + "".join("<td>" + value + "</td>" for value in values) + "</tr>")
        execution += (
            "<p>Each selected model has a consistent comparison version across the compared cases. "
            "The source labels distinguish completed-stage execution, observed-run metadata and requested legacy versions.</p>"
            '<p><a href="native-versions.csv">Download every run/model version record (CSV)</a> · '
            '<a href="native-versions.json">Open complete version and reuse provenance (JSON)</a></p>'
            '<div class="scroll"><table><thead><tr><th>Case and original run</th><th>Model</th>'
            '<th>Recorded version and source</th><th>Requested version</th><th>Stage completed</th>'
            '<th>Reused stage origin</th></tr></thead><tbody>' + "".join(version_rows) +
            "</tbody></table></div>")
    else:
        execution += (
            "<p>No per-model execution provenance was recorded in this saved result. "
            "Its original native run selections remain in the full results JSON.</p>")
    requested_version = result.get("baseline_selection", {}).get("invest_version")
    requested_text = str(requested_version) if requested_version is not None else "not recorded"
    return """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>""" + esc(result["title"]) + """</title>
<style>body{font:14px/1.5 system-ui,sans-serif;color:#202020;background:#fff;margin:0}
main{max-width:1320px;margin:32px auto;padding:0 24px}h1{font-size:26px;margin-bottom:8px}
h2{font-size:19px;margin-top:30px}.meta{color:#555}table{border-collapse:collapse;width:100%;font-size:12px}
th,td{padding:9px;text-align:left;border:1px solid #d5d5d5;vertical-align:top;overflow-wrap:anywhere}
th{background:#efefef}tbody tr:nth-child(even){background:#fafafa}.scroll{overflow:auto}
code{overflow-wrap:anywhere}a{color:#242424}@media print{main{margin:0;padding:0}thead{display:table-header-group}}</style>
</head><body><main><h1>""" + esc(result["title"]) + "</h1><p>" + esc(result["purpose"]) + """</p><p class="meta">Baseline requested InVEST """ + esc(requested_text) + " · " + esc(result["design"]) + " · " + str(result["completed_cases"]) + " / " + str(result["total_cases"]) + """ cases complete</p>
<p class="meta">Native models: """ + esc(", ".join(result["models"]).upper()) + """</p>
<p><a href="results.csv">Download quantitative results (CSV)</a> · <a href="results.json">Open full results (JSON)</a> · <a href="selection.json">Open saved design</a></p>
""" + execution + """
<h2>Parameter selection</h2><div class="scroll"><table><thead><tr><th>Axis</th><th>Native parameters</th><th>Values</th><th>Reason</th><th>Sources</th></tr></thead><tbody>""" + "".join(axes) + """</tbody></table></div>
<h2>Quantitative comparisons</h2><p>""" + esc(result["comparison_basis"]) + """</p><p>""" + esc(result["mass_basis"]) + """</p><div class="scroll"><table><thead><tr><th>Area</th><th>Case</th><th>Pollutant</th><th>Units</th><th>Baseline on shared cells</th><th>Case on shared cells</th><th>Change</th><th>Change %</th><th>Shared cells</th><th>Support</th></tr></thead><tbody>""" + "".join(row_html) + """</tbody></table></div>
""" + map_section + """<h2>Interpretation and source</h2><p>""" + esc(result["range_basis"]) + """</p><p>Numeric single-parameter responses include the change per parameter unit and normalized elasticity in the downloadable data. Coupled parameter changes retain their complete joint selection.</p>
<p>Study <code>""" + esc(result["experiment_id"]) + "</code><br>Baseline <code>" + esc(result["selection"]["baseline_run_id"]) + "</code></p></main></body></html>"


def _exports(workspace, state):
    directory = workspace.root / "experiments" / state["id"]
    profiles = {case["profile_id"]: workspace._get("profiles", case["profile_id"])
                for case in state["cases"]}
    atomic_json(directory / "profiles.json", profiles)
    maps, map_files = retain_differences(workspace, directory, state)
    result = read_json(directory / "results.json")
    if result.get("experiment_id") != state["id"] or result.get("workspace_id") != workspace.project["id"]:
        raise ValueError("Parameter results belong to a different retained study")
    result["difference_maps"] = maps
    result["export_edition"] = EXPORT_EDITION
    atomic_json(directory / "results.json", result)
    atomic_bytes(directory / "report.html", _report(result).encode("utf-8"))
    files = ["selection.json", "results.json", "results.csv", "report.html", "profiles.json"]
    version_files = ("native-versions.json", "native-versions.csv")
    files.extend(name for name in version_files if (directory / name).is_file())
    if (directory / "aggregation.json").is_file():
        files.append("aggregation.json")
        aggregation = read_json(directory / "aggregation.json")
        context = directory / aggregation["context"]
        # A context path is written only by the retained pair-result manager.
        if not context.resolve().is_relative_to((directory / "paired-results").resolve()):
            raise ValueError("The retained aggregation context leaves its study")
        files.append(context.relative_to(directory).as_posix())
        for pair_id in dict.fromkeys(row["pair_id"] for row in aggregation["pairs"]):
            files.append((context.parent / (identifier(pair_id) + ".json")).relative_to(directory).as_posix())
    descriptors = [describe_file(directory, directory / name) for name in files]
    descriptors.extend(map_files.values())
    for case in state["cases"]:
        run = workspace.inspect_run(case["run_id"])
        for model in run_models(run):
            stage = run.get("stages", {}).get(model)
            if stage and stage.get("arguments"):
                descriptors.append(copy_verified(
                    workspace.root / "runs" / case["run_id"], stage["arguments"], directory,
                    path="native-arguments/" + case["id"] + "/" + model + ".json"))
            if stage and stage.get("requested_arguments"):
                descriptors.append(copy_verified(
                    workspace.root / "runs" / case["run_id"], stage["requested_arguments"], directory,
                    path="native-arguments/" + case["id"] + "/" + model + "-requested.json"))
    write_archive(directory, directory / "experiment-results.zip", descriptors)
    artifacts = {name: describe_file(directory, directory / filename) for name, filename in (
        ("selection", "selection.json"), ("results", "results.json"), ("csv", "results.csv"),
        ("report", "report.html"), ("profiles", "profiles.json"), ("archive", "experiment-results.zip"))}
    artifacts.update(map_files)
    for name, filename in (("native_versions", "native-versions.json"),
                           ("native_versions_csv", "native-versions.csv")):
        if (directory / filename).is_file():
            artifacts[name] = describe_file(directory, directory / filename)
    if (directory / "aggregation.json").is_file():
        artifacts["aggregation"] = describe_file(directory, directory / "aggregation.json")
    state["export_edition"] = EXPORT_EDITION
    state["native_version_edition"] = NATIVE_VERSION_EDITION
    return artifacts


def execute(workspace, key, *, progress=None):
    state = _read(workspace, key)
    directory = workspace.root / "experiments" / key
    state_path = directory / "experiment.json"
    def save(**changes):
        state.update(changes, updated_at=now())
        state["progress"] = {"total": len(state["cases"]),
                             "completed": sum(c["state"] == "complete" for c in state["cases"]),
                             "failed": sum(c["state"] == "failed" for c in state["cases"])}
        atomic_json(state_path, state)
        if progress:
            progress(deepcopy(state))
    with held(directory / ".experiment.lock", blocking=False):
        state = inspect(workspace, key)
        if state["state"] == "complete":
            if (state.get("export_edition") == EXPORT_EDITION
                    and state.get("native_version_edition") == NATIVE_VERSION_EDITION):
                for item in state["artifacts"].values():
                    verify_file(directory, item)
                return {**state, "reused": True}
            # Upgrade completed report/GIS exports using the same retained runs.
            # A failed copy/archive attempt resumes here without native execution.
            _summarize(workspace, key)
            state["artifacts"] = _exports(workspace, state)
            state["updated_at"] = now()
            atomic_json(state_path, state)
            return {**state, "reused": True, "exports_refreshed": True}
        state.pop("error", None)
        save(state="running")
        try:
            for case in state["cases"]:
                save(active_case_id=case["id"], active_run_id=case["run_id"])
                try:
                    run = workspace.run(case["run_id"])
                    if run["state"] != "complete":
                        raise RuntimeError("Native parameter case has not completed")
                    case["state"] = "complete"
                    case.pop("error", None)
                except Exception as error:
                    case["state"] = "failed"
                    case["error"] = deepcopy(getattr(error, "native_failure", None)) or {
                        "type": type(error).__name__, "message": str(error)}
                    if storage_exhausted(error):
                        raise
                    save()
                    if case["id"] == "baseline":
                        raise
                save()
            # Preserve usable quantitative results while other parameter cases recover.
            summary = _summarize(workspace, key,
                                 progress=lambda value: save(active_case_id=None, active_run_id=None,
                                                             aggregation_progress=value))
            state["artifacts"] = _exports(workspace, state)
            state["result_counts"] = {"rows": len(summary["rows"]), "ranges": len(summary["ranges"])}
            failed = [case for case in state["cases"] if case["state"] != "complete"]
            if failed:
                save(state="partial", active_case_id=None, active_run_id=None,
                     error={"type": "IncompleteCases", "message": str(len(failed)) + " native cases need recovery"})
            else:
                save(state="complete", completed_at=now(), active_case_id=None, active_run_id=None)
            return state
        except BaseException as error:
            failure = deepcopy(getattr(error, "native_failure", None)) or {
                "type": type(error).__name__, "message": str(error)}
            try:
                save(state="failed", active_case_id=None, active_run_id=None, error=failure)
            except OSError:
                # The original run journal has reserved recovery capacity.
                # Preserve its primary failure if this larger study cannot save.
                if not storage_exhausted(error):
                    raise
            raise


def summarize(workspace, key):
    """Refresh retained results for completed cases without running an engine."""
    key = identifier(key)
    directory = workspace.root / "experiments" / key
    with held(directory / ".experiment.lock", blocking=False):
        state = inspect(workspace, key)
        def aggregation_progress(value):
            state.update(aggregation_progress=value, updated_at=now())
            atomic_json(directory / "experiment.json", state)
        result = _summarize(workspace, key, progress=aggregation_progress)
        state["artifacts"] = _exports(workspace, state)
        result = read_json(directory / "results.json")
        state["result_counts"] = {"rows": len(result["rows"]), "ranges": len(result["ranges"])}
        state["updated_at"] = now()
        state["active_case_id"] = state["active_run_id"] = None
        if state["progress"]["completed"] == state["progress"]["total"]:
            state["state"] = "complete"
            state.setdefault("completed_at", now())
            state.pop("error", None)
        else:
            state["state"] = "partial"
        atomic_json(directory / "experiment.json", state)
        return result
