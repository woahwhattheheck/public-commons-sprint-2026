"""Build original-stage NDR/SDR process reports and import them into Sources.

No model is launched here. All rasters, geometries, units and versions come from
selected completed native stages. Run with python -m model.native_process_report.
"""
from __future__ import annotations
import argparse
from contextlib import ExitStack
import csv
from hashlib import sha256
import io
import json
import math
from pathlib import Path

from .common import (atomic_bytes, atomic_json, describe_file, digest, held, identifier,
                     now, read_json, verify_file)
from . import native_versions
from .process_quantities import (EDITION, VERSION, SOURCE_BLOBS, GUIDES, FIELDS,
                                 UNITS, RATE_UNITS, NOTES, quantities, changes, interpretation)
from .reuse import copy_verified
from .rasters import vector_environment

SELECTION_SCHEMA = "upstate.native-process-selection/v1"
SCHEMA = "upstate.native-process-report/v1"
ROOT = "native-process-reports"


def _code_sources(include_figures=False):
    names = ("native_process_report.py", "process_quantities.py", "native_versions.py")
    if include_figures:
        names += ("native_process_figures.py", "scientific_figures.py")
    return {name: describe_file(Path(__file__).parent, Path(__file__).with_name(name))
            for name in names}


def _selected(ws, supplied):
    if not isinstance(supplied, dict) or supplied.get("schema", SELECTION_SCHEMA) != SELECTION_SCHEMA:
        raise ValueError("Select a native process report")
    unknown = set(supplied) - {"schema", "title", "run_ids", "models", "include_figures"}
    if unknown:
        raise ValueError("Unknown process selection fields: " + ", ".join(sorted(unknown)))
    include_figures = supplied.get("include_figures", False)
    if not isinstance(include_figures, bool):
        raise ValueError("include_figures must be true or false")
    title = supplied.get("title")
    if not isinstance(title, str) or not title.strip():
        raise ValueError("Give the actual model comparison a title")
    ids = supplied.get("run_ids")
    if not isinstance(ids, list) or not ids or len(set(ids)) != len(ids):
        raise ValueError("Select a baseline followed by unique alternative native run IDs")
    runs = [ws.inspect_run(identifier(key)) for key in ids]
    available = set.intersection(*[
        {m for m in FIELDS if run.get("stages", {}).get(m, {}).get("completed_at")}
        for run in runs])
    selected = supplied.get("models", [m for m in FIELDS if m in available])
    if (not isinstance(selected, list) or not selected or
            any(m not in FIELDS for m in selected) or len(set(selected)) != len(selected)):
        raise ValueError("Choose completed native models from ndr and sdr")
    models = [m for m in FIELDS if m in selected]
    if not set(models).issubset(available):
        raise ValueError("Every selected run must retain every selected completed model")
    if len({run["selection"]["grid_id"] for run in runs}) != 1:
        raise ValueError("Compare original native processes on the same retained model grid")
    versions = native_versions.comparison_versions(runs, models)
    proofs = []
    for run in runs:
        stages = {}
        for model in models:
            stage = run["stages"][model]
            info = versions["runs"][run["id"]][model]
            runtime = stage.get("runtime") if info["basis"] == "completed_stage_runtime" else run.get("runtime")
            module = (runtime or {}).get("modules", {}).get(model, {})
            if (info["comparison_version"] != VERSION or
                    info["basis"] == "requested_legacy" or
                    module.get("git_blob") != SOURCE_BLOBS[model]):
                raise ValueError("Process unit contract requires observed original InVEST " +
                                 VERSION + " " + model.upper() + " execution source")
            files = stage.get("files", {})
            vector_id = "watershed_results_" + model
            if vector_id not in files:
                raise ValueError("Original registry lacks " + vector_id)
            raster_ids = [raster for _, raster, _ in FIELDS[model] if raster in files]
            if not raster_ids:
                raise ValueError("Retain original process rasters for " + model.upper())
            selected_files = {key: files[key] for key in [vector_id, *raster_ids]}
            vector = Path(files[vector_id]["path"])
            sidecars = [item for item in stage.get("companions", [])
                        if Path(item["path"]).parent == vector.parent
                        and Path(item["path"]).stem == vector.stem]
            stages[model] = {"completed_at": stage["completed_at"], "files": selected_files,
                             "companions": sidecars, "arguments": stage["arguments"],
                             "runtime": runtime, "version": info,
                             "input_signature": stage.get("input_signature"),
                             "reused_from": stage.get("reused_from")}
        proofs.append({"id": run["id"], "selection": run["selection"], "stages": stages})
    selection = {"schema": SELECTION_SCHEMA, "title": title.strip(), "run_ids": ids, "models": models}
    if include_figures:
        selection["include_figures"] = True
    grid = ws.get_grid(runs[0]["selection"]["grid_id"])
    identity = {"schema": SCHEMA, "edition": EDITION, "selection": selection,
                "project_id": ws.project.get("id"), "runs": proofs, "grid": grid,
                "versions": versions, "implementation": _code_sources(include_figures)}
    return selection, proofs, grid, identity


def preview(ws, supplied):
    selection, runs, grid, identity = _selected(ws, supplied)
    originals = {}
    for run in runs:
        for model, stage in run["stages"].items():
            for item in [*stage["files"].values(), *stage["companions"], stage["arguments"]]:
                originals[(run["id"], item["path"])] = item["bytes"]
    return {"id": digest(identity), "selection": selection, "runs": runs,
            "versions": identity["versions"], "grid_id": grid["id"],
            "retained_original_files": len(originals), "retained_original_bytes": sum(originals.values()),
            "support": "original native model-domain watersheds; per-quantity paired finite raster cells",
            "methods": NOTES, "native_execution_required": False}


def catalog(ws):
    rows = []
    for path in sorted((ws.root / "runs").glob("*/run.json")):
        run = read_json(path)
        models = [m for m in FIELDS if run.get("stages", {}).get(m, {}).get("completed_at")]
        if models:
            rows.append({"run_id": run["id"], "state": run.get("state"),
                         "selection": run["selection"], "completed_models": models,
                         "versions": native_versions.model_versions(run, models),
                         "watershed_outputs": {m: "watershed_results_" + m in
                                               run["stages"][m].get("files", {}) for m in models}})
    reports = []
    for path in sorted((ws.root / ROOT).glob("*/operation.json")):
        item = read_json(path)
        reports.append({k: item.get(k) for k in
                        ("id", "state", "title", "selection", "source_choice", "updated_at", "error")})
    return {"native_runs": rows, "reports": reports}


def _crs(value):
    from pyproj import CRS
    result = CRS.from_user_input(value)
    if (not result.is_projected or len(result.axis_info) < 2 or
            any(not math.isclose(float(a.unit_conversion_factor), 1.0, rel_tol=0,
                                 abs_tol=1e-10) for a in result.axis_info[:2])):
        raise ValueError("Process quantities require the original projected metre CRS")
    return result


def _geometry_key(geometry):
    from shapely import normalize
    return sha256(normalize(geometry).wkb).hexdigest()


def _vectors(path, crs):
    import fiona
    from shapely.geometry import shape, mapping
    result = {}
    with vector_environment(), fiona.open(path) as source:
        if _crs(source.crs_wkt or source.crs) != crs:
            raise ValueError("Original watershed result and prepared grid CRS differ")
        for feature in source:
            if feature["geometry"] is None:
                raise ValueError("Native watershed output has an empty geometry")
            geometry = shape(feature["geometry"])
            if (geometry.is_empty or not geometry.is_valid or not math.isfinite(geometry.area) or geometry.area <= 0 or
                    geometry.geom_type not in ("Polygon", "MultiPolygon")):
                raise ValueError("Native watershed needs its original valid polygon")
            key = _geometry_key(geometry)
            if key in result:
                raise ValueError("Native output contains duplicate watershed geometry")
            result[key] = {"key": key, "native_feature_id": str(feature.id),
                           "area_ha": geometry.area / 10000,
                           "geometry": mapping(geometry), "properties": dict(feature["properties"])}
    if not result:
        raise ValueError("The native watershed output is empty")
    return result


def _lattice(dataset, grid):
    from rasterio.transform import Affine
    reference = Affine(*grid["transform"][:6])
    actual = dataset.transform
    _crs(dataset.crs)
    if _crs(dataset.crs) != _crs(grid["crs"]):
        raise ValueError("Original process raster CRS differs from the retained grid")
    if (actual.b != 0 or actual.d != 0 or actual.a <= 0 or actual.e >= 0 or
            not all(math.isfinite(v) for v in tuple(actual)[:6]) or
            not all(math.isclose(a, b, rel_tol=1e-10, abs_tol=1e-9)
                    for a, b in ((actual.a, reference.a), (actual.e, reference.e)))):
        raise ValueError("Original process raster differs from the retained pixel lattice")
    col, row = ~reference * (actual.c, actual.f)
    if abs(col - round(col)) > 1e-6 or abs(row - round(row)) > 1e-6:
        raise ValueError("Original process raster is not aligned to the prepared grid")
    if dataset.count != 1:
        raise ValueError("Original native process raster must have one band")
    col, row = int(round(col)), int(round(row))
    if col < 0 or row < 0 or col + dataset.width > grid["width"] or row + dataset.height > grid["height"]:
        raise ValueError("Original process raster extends outside the prepared model grid")
    return col, row, abs(actual.a * actual.e) / 10000


def _support(paths, geometry, grid):
    """Stream one or two original rates over the same polygon and grid, 512 cells/side."""
    import numpy as np
    import rasterio
    from rasterio.features import geometry_mask
    from rasterio.transform import Affine
    from rasterio.windows import Window, from_bounds, transform
    from shapely.geometry import shape
    reference = Affine(*grid["transform"][:6])
    extent = from_bounds(*shape(geometry).bounds, transform=reference)
    left, top = max(0, math.floor(extent.col_off)), max(0, math.floor(extent.row_off))
    right = min(grid["width"], math.ceil(extent.col_off + extent.width))
    bottom = min(grid["height"], math.ceil(extent.row_off + extent.height))
    totals = [{"valid_cells": 0, "nonfinite_cells": 0, "negative_cells": 0,
               "mass": 0.0, "common_mass": 0.0} for _ in paths]
    inside_count, common_count = 0, 0
    own_sums, shared_sums = [[] for _ in paths], [[] for _ in paths]
    with ExitStack() as stack:
        datasets = [stack.enter_context(rasterio.open(path)) for path in paths]
        lattices = [_lattice(ds, grid) for ds in datasets]
        area = lattices[0][2]
        for row in range(top, bottom, 512):
            for col in range(left, right, 512):
                window = Window(col, row, min(512, right-col), min(512, bottom-row))
                shape_rc = (int(window.height), int(window.width))
                inside = geometry_mask([geometry], out_shape=shape_rc,
                                       transform=transform(window, reference), invert=True,
                                       all_touched=False)
                inside_count += int(inside.sum())
                arrays, valid = [], []
                for i, (ds, (dc, dr, unused)) in enumerate(zip(datasets, lattices)):
                    source_window = Window(col-dc, row-dr, window.width, window.height)
                    array = ds.read(1, window=source_window, boundless=True, masked=True)
                    data = np.asarray(array.data, dtype=np.float64)
                    available = inside & ~np.ma.getmaskarray(array)
                    ok = available & np.isfinite(data)
                    arrays.append(data)
                    valid.append(ok)
                    totals[i]["valid_cells"] += int(ok.sum())
                    totals[i]["nonfinite_cells"] += int((available & ~np.isfinite(data)).sum())
                    totals[i]["negative_cells"] += int((ok & (data < 0)).sum())
                    own_sums[i].append(float(data[ok].sum(dtype=np.float64)) * area)
                common = np.logical_and.reduce(valid)
                common_count += int(common.sum())
                for i, array in enumerate(arrays):
                    shared_sums[i].append(float(array[common].sum(dtype=np.float64)) * area)
        for i, value in enumerate(totals):
            value["mass"] = math.fsum(own_sums[i]) if value["valid_cells"] else None
            value["common_mass"] = math.fsum(shared_sums[i]) if common_count else None
            if any(v is not None and not math.isfinite(v) for v in (value["mass"], value["common_mass"])):
                raise ValueError("Original raster accumulation is not a finite mass")
            value["valid_area_ha"] = value["valid_cells"] * area
            value["coverage_fraction"] = value["valid_cells"] / inside_count if inside_count else None
        result = {"polygon_cell_centres": inside_count, "pixel_area_ha": area,
                  "common_cells": common_count, "common_area_ha": common_count * area,
                  "sources": totals, "mask_rule": "polygon_cell_centre_and_finite_original_valid_value"}
        if len(totals) == 2:
            a, b = totals
            delta = b["common_mass"] - a["common_mass"] if common_count else None
            result.update(common_change=delta,
                          common_relative_change_pct=100*delta/a["common_mass"]
                          if delta is not None and a["common_mass"] > 0 else None,
                          baseline_only_cells=a["valid_cells"]-common_count,
                          alternative_only_cells=b["valid_cells"]-common_count,
                          identical_valid_support=a["valid_cells"] == b["valid_cells"] == common_count)
        return result


def _write_csv(path, rows, columns=()):
    fields = list(dict.fromkeys([*columns, *(key for row in rows for key in row)]))
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    for row in rows:
        writer.writerow({key: json.dumps(value, ensure_ascii=False, sort_keys=True)
                         if isinstance(value, (dict, list, tuple)) else value for key, value in row.items()})
    atomic_bytes(path, stream.getvalue().encode("utf-8"), immutable=True)


def _table(columns, rows, caption):
    return {"kind": "table", "columns": columns, "rows": rows, "caption": caption}


def _display(value):
    return "Unavailable" if value is None else format(value, ".9g") if isinstance(value, (int, float)) else str(value)


def _argument_changes(baseline, alternative):
    """Preserve actual scalar native parameters, excluding runtime and filesystem locations."""
    excluded = {"workspace_dir", "results_suffix", "n_workers"}
    rows = []
    for key in sorted(set(baseline) | set(alternative)):
        if key in excluded or key.endswith(("_path", "_dir")):
            continue
        old, new = baseline.get(key), alternative.get(key)
        if old != new:
            rows.append({"parameter": key, "baseline": old, "alternative": new,
                         "baseline_present": key in baseline, "alternative_present": key in alternative})
    return rows


def _watershed_label(row):
    properties = row.get("properties", {})
    title = properties.get("title") or properties.get("name") or "Native watershed"
    return str(title) + " [feature " + str(row.get("native_feature_id", "")) + "; " + row["key"][:12] + "]"


def _sections(selection, packets, comparisons, grid):
    affine = grid["grid"]["transform"]
    pixel_area = abs(affine[0] * affine[4] - affine[1] * affine[3]) / 10000
    physical_rows = []
    for packet in packets:
        args = packet["arguments"]
        threshold = args.get("threshold_flow_accumulation")
        threshold_area = float(threshold) * pixel_area if threshold is not None else None
        runoff = args.get("runoff_proxy_av")
        physical_rows.append([packet["run_id"][:16], packet["model"].upper(), _display(pixel_area),
                              _display(threshold), _display(threshold_area),
                              _display(runoff) if runoff is not None else
                              "Native computed runoff reference" if packet["model"] == "ndr" else "Not applicable"])
    sections = [("Native process quantities and spatial scope", [
        "The first selected run is the baseline. Each result is a prediction for an original "
        "native model-domain watershed. Runs and units are identified in the tables.",
        *NOTES,
        _table(["Run", "Model", "Executed version", "Scenario", "Profile"],
               [[p["run_id"][:16], p["model"].upper(),
                 native_versions.version_label(p["version"]),
                 p["scenario"].get("title", p["selection"]["scenario_id"]),
                 p["profile"].get("title", p["selection"]["profile_id"])] for p in packets],
               "Original selected native stages; a failed parent may contain a completed model."),
        _table(["Run", "Model", "Pixel ha", "Stream threshold cells", "Equivalent threshold ha",
                "NDR runoff reference"], physical_rows,
               "Actual native argument values and original pixel geometry. The threshold-area value "
               "is grid cell area times the flow-accumulation threshold, not a newly delineated basin."),
    ])]
    for packet in packets:
        rows = []
        support = []
        for watershed in packet["watersheds"]:
            title = _watershed_label(watershed) + " (" + _display(watershed["area_ha"]) + " ha)"
            for quantity in watershed["quantities"]:
                rows.append([title, quantity["label"], _display(quantity["value"]), quantity["units"]])
            for field, value in watershed["support"].items():
                own = value["sources"][0]
                support.append([title, field, str(own["valid_cells"]),
                                _display(own["valid_area_ha"]), _display(own["coverage_fraction"]),
                                _display(own["mass"]), _display(value["native_minus_pixel_centre_mass"])])
        sections.append((packet["model"].upper() + " processes — " +
                         packet["scenario"].get("title", packet["run_id"][:16]), [
            _table(["Watershed", "Quantity", "Original / derived value", "Units"], rows,
                   "Native vector fields are annual watershed mass; NDR ratios and retention "
                   "are explicitly named watershed derivations."),
            _table(["Watershed", "Original field", "Valid cells", "Valid ha", "Coverage",
                    "Pixel-centre mass", "Native minus reconstructed"], support,
                   "Coverage denominator is polygon cell centres in the prepared grid. "
                   "Native and reconstructed totals preserve their original boundary rules."),
        ]))
    for comparison in comparisons:
        rows, support, narrative = [], [], []
        for watershed in comparison["watersheds"]:
            title = watershed["label"]
            narrative.extend(title + ": " + paragraph for paragraph in interpretation(
                comparison["model"], watershed["changes"],
                profile_changed=comparison["profile_changed"],
                scenario_changed=comparison["scenario_changed"]))
            for row in watershed["changes"]:
                rows.append([title, row["label"], _display(row["baseline"]),
                             _display(row["alternative"]), _display(row["change"]),
                             _display(row["relative_change_pct"]), row["units"]])
            for field, value in watershed["paired_support"].items():
                support.append([title, field, str(value["common_cells"]),
                                str(value["baseline_only_cells"]), str(value["alternative_only_cells"]),
                                _display(value["common_change"]), _display(value["common_relative_change_pct"])])
        sections.append((comparison["model"].upper() + " comparison — " +
                         comparison["alternative_run_id"][:16], [
            *narrative,
            "Original biophysical table changed: " + str(comparison["biophysical_table_changed"]) + ".",
            _table(["Native parameter", "Baseline", "Alternative"],
                   [[r["parameter"], _display(r["baseline"]), _display(r["alternative"])]
                    for r in comparison["argument_changes"]],
                   "Changed scalar native arguments; a missing optional value is shown as unavailable. "
                   "Workspace paths and worker counts do not define scientific parameter changes."),
            _table(["Watershed", "Quantity", "Baseline", "Alternative", "Change", "Change %", "Units"],
                   rows, "Alternative minus baseline; percentage is unavailable for a zero or nonpositive baseline."),
            _table(["Watershed", "Original field", "Common cells", "Baseline-only cells",
                    "Alternative-only cells", "Paired mass change", "Paired change %"],
                   support, "Paired changes use identical finite cells for each original process "
                   "quantity. A support change stays visible beside the native watershed change."),
        ]))
    return sections


def build(ws, supplied, *, render=True):
    selection, runs, grid, identity = _selected(ws, supplied)
    key = digest(identity)
    directory = ws.root / ROOT / key
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".operation.lock", blocking=False):
        atomic_json(directory / "identity.json", identity, immutable=True)
        state_path = directory / "operation.json"
        state = read_json(state_path) if state_path.exists() else {
            "schema": SCHEMA, "id": key, "title": selection["title"], "selection": selection,
            "created_at": now(), "files": {}, "completed_stages": []}
        if state.get("id") != key:
            raise ValueError("Retained process report identity differs")
        if state.get("state") == "complete" and (not render or state.get("rendered")):
            for item in state["files"]:
                verify_file(ws.root, item)
            return {**state, "reused": True}
        state.setdefault("checkpoints", {})
        state["state"], state["updated_at"] = "running", now()
        state.pop("error", None)
        atomic_json(state_path, state)
        try:
            crs = _crs(grid["grid"]["crs"])
            grid_root = ws.root / "grids" / grid["id"]
            domain = verify_file(grid_root, grid["files"]["model_domain"])
            original_domain = _vectors(domain, crs)
            from shapely.geometry import shape
            from shapely.ops import unary_union
            expected_geometry = unary_union([shape(row["geometry"]) for row in original_domain.values()])
            for name in ("model_domain", "reporting_area", "reporting_mask"):
                descriptor = grid["files"].get(name)
                if descriptor:
                    original = verify_file(grid_root, descriptor)
                    copy_verified(grid_root, descriptor, directory,
                                  path="original/grid/" + name + "/" + original.name)
            atomic_json(directory / "original/grid/grid.json", grid, immutable=True)
            for name, descriptor in identity["implementation"].items():
                copy_verified(Path(__file__).parent, descriptor, directory,
                              path="implementation/" + name)
            packets, packet_paths = [], {}
            for run in runs:
                run_root = ws.root / "runs" / run["id"]
                for model, stage in run["stages"].items():
                    prefix = "original/" + run["id"] + "/" + model + "/"
                    originals = {}
                    for name, descriptor in stage["files"].items():
                        path = prefix + "registry/" + descriptor["path"]
                        originals[name] = copy_verified(run_root, descriptor, directory, path=path)
                    for descriptor in stage["companions"]:
                        copy_verified(run_root, descriptor, directory,
                                      path=prefix + "registry/" + descriptor["path"])
                    copy_verified(run_root, stage["arguments"], directory, path=prefix + "arguments.json")
                    atomic_json(directory / (prefix + "stage.json"), stage, immutable=True)
                    profile = ws._get("profiles", run["selection"]["profile_id"])
                    scenario = ws._get("scenarios", run["selection"]["scenario_id"])
                    atomic_json(directory / (prefix + "profile.json"), profile, immutable=True)
                    atomic_json(directory / (prefix + "scenario.json"), scenario, immutable=True)
                    biophysical_path, entry = ws.source_file(
                        profile["source_collection_id"], profile["biophysical_source_id"])
                    if entry["body"]["sha256"] != profile["table_summary"]["sha256"]:
                        raise ValueError("Original profile table changed")
                    copy_verified(biophysical_path.parent,
                                  describe_file(biophysical_path.parent, biophysical_path), directory,
                                  path=prefix + "biophysical.csv")
                    packet_path = directory / ("derived/" + run["id"] + "-" + model + ".json")
                    packet_paths[(run["id"], model)] = originals
                    checkpoint_key = packet_path.relative_to(directory).as_posix()
                    if checkpoint_key in state["checkpoints"]:
                        packet = read_json(verify_file(directory, state["checkpoints"][checkpoint_key]))
                        if (packet.get("source_identity") != digest(stage) or
                                packet.get("run_id") != run["id"] or packet.get("model") != model):
                            raise ValueError("Retained native process checkpoint differs")
                    else:
                        vector_path = verify_file(directory, originals["watershed_results_" + model])
                        watersheds = _vectors(vector_path, crs)
                        geometry = unary_union([shape(row["geometry"]) for row in watersheds.values()])
                        if not geometry.equals(expected_geometry):
                            raise ValueError("Native watershed output differs from the prepared model domain")
                        records = []
                        for watershed in watersheds.values():
                            support = {}
                            for field, raster, label in FIELDS[model]:
                                if raster not in originals:
                                    continue
                                raster_path = verify_file(directory, originals[raster])
                                value = _support([raster_path], watershed["geometry"], grid["grid"])
                                native = next(q["value"] for q in quantities(model, watershed["properties"])
                                              if q["quantity"] == field)
                                reconstructed = value["sources"][0]["mass"]
                                value.update(native_watershed_mass=native, units=UNITS[model],
                                             native_rate_units=RATE_UNITS[model],
                                             native_minus_pixel_centre_mass=native-reconstructed
                                             if native is not None and reconstructed is not None else None)
                                support[field] = value
                            records.append({**watershed, "quantities": quantities(model, watershed["properties"]),
                                            "support": support})
                        packet = {"schema": SCHEMA, "run_id": run["id"], "model": model,
                                  "selection": run["selection"], "source_identity": digest(stage),
                                  "version": stage["version"], "original_files": originals,
                                  "profile": profile, "scenario": scenario, "watersheds": records,
                                  "arguments": read_json(directory / (prefix + "arguments.json"))}
                        atomic_json(packet_path, packet, immutable=True)
                    state["checkpoints"][checkpoint_key] = describe_file(directory, packet_path)
                    packets.append(packet)
                    complete_key = run["id"] + "/" + model
                    if complete_key not in state["completed_stages"]:
                        state["completed_stages"].append(complete_key)
                    state.update(phase="process_quantities", updated_at=now())
                    atomic_json(state_path, state)
            by_case = {(p["run_id"], p["model"]): p for p in packets}
            comparisons = []
            for model in selection["models"]:
                baseline = by_case[(runs[0]["id"], model)]
                for run in runs[1:]:
                    alternative = by_case[(run["id"], model)]
                    comparison_path = directory / ("derived/compare-" + run["id"] + "-" + model + ".json")
                    compare_identity = digest([baseline["source_identity"], alternative["source_identity"]])
                    checkpoint_key = comparison_path.relative_to(directory).as_posix()
                    if checkpoint_key in state["checkpoints"]:
                        comparison = read_json(verify_file(directory, state["checkpoints"][checkpoint_key]))
                        if comparison.get("source_identity") != compare_identity:
                            raise ValueError("Retained native process comparison differs")
                    else:
                        first = {w["key"]: w for w in baseline["watersheds"]}
                        second = {w["key"]: w for w in alternative["watersheds"]}
                        if set(first) != set(second):
                            raise ValueError("Native comparison watersheds have different original geometries")
                        rows = []
                        for watershed_key in first:
                            a, b = first[watershed_key], second[watershed_key]
                            paired = {}
                            for field, raster, label in FIELDS[model]:
                                original_a = packet_paths[(baseline["run_id"], model)]
                                original_b = packet_paths[(alternative["run_id"], model)]
                                if raster in original_a and raster in original_b:
                                    pair = _support([verify_file(directory, original_a[raster]),
                                                     verify_file(directory, original_b[raster])],
                                                    a["geometry"], grid["grid"])
                                    pair["units"] = UNITS[model]
                                    paired[field] = pair
                            rows.append({"key": watershed_key, "label": _watershed_label(a), "area_ha": a["area_ha"],
                                         "changes": changes(a["quantities"], b["quantities"]),
                                         "paired_support": paired})
                        comparison = {"model": model, "baseline_run_id": baseline["run_id"],
                                      "alternative_run_id": alternative["run_id"],
                                      "source_identity": compare_identity,
                                      "profile_changed": baseline["selection"]["profile_id"] !=
                                                         alternative["selection"]["profile_id"],
                                      "scenario_changed": baseline["selection"]["scenario_id"] !=
                                                          alternative["selection"]["scenario_id"],
                                      "argument_changes": _argument_changes(baseline["arguments"], alternative["arguments"]),
                                      "biophysical_table_changed": baseline["profile"]["table_summary"]["sha256"] !=
                                                                   alternative["profile"]["table_summary"]["sha256"],
                                      "watersheds": rows}
                        atomic_json(comparison_path, comparison, immutable=True)
                    state["checkpoints"][checkpoint_key] = describe_file(directory, comparison_path)
                    state.update(phase="paired_support", updated_at=now())
                    atomic_json(state_path, state)
                    comparisons.append(comparison)
            quantity_rows, support_rows, change_rows, paired_rows = [], [], [], []
            for packet in packets:
                for watershed in packet["watersheds"]:
                    common = {"run_id": packet["run_id"], "model": packet["model"],
                              "watershed": watershed["key"], "watershed_area_ha": watershed["area_ha"]}
                    quantity_rows.extend({**common, **row} for row in watershed["quantities"])
                    for field, support in watershed["support"].items():
                        support_rows.append({**common, "field": field,
                                             **{k: v for k, v in support.items() if k != "sources"},
                                             **support["sources"][0]})
            for comparison in comparisons:
                for watershed in comparison["watersheds"]:
                    for field, value in watershed["paired_support"].items():
                        paired_rows.append({"model": comparison["model"],
                                            "baseline_run_id": comparison["baseline_run_id"],
                                            "alternative_run_id": comparison["alternative_run_id"],
                                            "watershed": watershed["key"], "field": field,
                                            **{k: v for k, v in value.items() if k != "sources"},
                                            **{"baseline_" + k: v for k, v in value["sources"][0].items()},
                                            **{"alternative_" + k: v for k, v in value["sources"][1].items()}})
                    change_rows.extend({"model": comparison["model"],
                                        "baseline_run_id": comparison["baseline_run_id"],
                                        "alternative_run_id": comparison["alternative_run_id"],
                                        "watershed": watershed["key"], **row}
                                       for row in watershed["changes"])
            _write_csv(directory / "quantities.csv", quantity_rows)
            _write_csv(directory / "support.csv", support_rows)
            _write_csv(directory / "changes.csv", change_rows, ("model", "baseline_run_id",
                       "alternative_run_id", "watershed", "quantity", "units", "baseline",
                       "alternative", "change", "relative_change_pct"))
            _write_csv(directory / "paired-support.csv", paired_rows, ("model", "baseline_run_id",
                       "alternative_run_id", "watershed", "field", "units", "common_cells",
                       "common_change", "common_relative_change_pct"))
            figure_product = None
            if selection.get("include_figures"):
                from .native_process_figures import produce
                figure_product = produce(
                    directory, selection, packets, comparisons,
                    {(p["run_id"], p["model"]): describe_file(
                        directory, directory / ("derived/" + p["run_id"] + "-" + p["model"] + ".json"))
                     for p in packets},
                    {(p["alternative_run_id"], p["model"]): describe_file(
                        directory, directory / ("derived/compare-" + p["alternative_run_id"] + "-" + p["model"] + ".json"))
                     for p in comparisons},
                )
                state.update(phase="figures_retained", updated_at=now(),
                             figure_count=figure_product["figure_count"],
                             panel_count=figure_product["panel_count"])
                atomic_json(state_path, state)
            summary = {"schema": SCHEMA, "id": key, "selection": selection,
                       "versions": identity["versions"], "grid": grid["grid"],
                       "packets": packets, "comparisons": comparisons, "methods": NOTES,
                       "documentation": GUIDES, "scope": "original_native_model_domain_watersheds"}
            if figure_product is not None:
                summary["figure_product"] = {k: v for k, v in figure_product.items() if k != "blocks"}
            atomic_json(directory / "processes.json", summary, immutable=True)
            source_files = [describe_file(directory, path) for path in sorted(directory.rglob("*"))
                            if path.is_file() and not path.is_symlink()
                            and not any(part.startswith(".") for part in path.relative_to(directory).parts)
                            and (path.relative_to(directory).parts[0] in
                            ("original", "implementation", "derived", "figures") or path.name in
                            ("identity.json", "processes.json", "quantities.csv", "support.csv", "changes.csv",
                             "paired-support.csv"))]
            recipe = {"schema": "upstate.observed-report/v1", "title": selection["title"],
                      "edition": EDITION, "inputs": source_files,
                      "sections": _sections(selection, packets, comparisons, grid),
                      "source_links": ["processes.json", "quantities.csv", "support.csv", "changes.csv", "paired-support.csv",
                                       "identity.json", *[item["path"] for item in source_files
                                       if item["path"].endswith(("watershed_results_ndr.gpkg",
                                                                 "watershed_results_sdr.shp"))]]}
            if figure_product is not None:
                recipe.update(figure_spec=figure_product["figure_spec"], figures=figure_product["figures"])
                recipe["source_links"] += [figure_product["figure_spec"], "figures/rendering.json",
                                           *[item["path"] for item in figure_product["figures"]]]
            atomic_json(directory / "report.json", recipe, immutable=True)
            body = describe_file(directory, directory / "report.json")
            source_id = "native-process-" + key
            manifest = {"schema": "upstate.sources/v1", "title": selection["title"],
                        "captured_at": state["created_at"],
                        "entries": [{"id": source_id, "kind": "document", **body,
                                     "uri": "urn:upstate:native-process-report:" + key,
                                     "vintage": "Retained model stages: " + ", ".join(
                                         sorted({stage["completed_at"] for run in runs
                                                 for stage in run["stages"].values()})),
                                     "title": selection["title"],
                                     "metadata": {"report_schema": "upstate.observed-report/v1",
                                                  "scientific_scope": "modeled_process_quantities",
                                                  "native_process_report_id": key,
                                                  "native_versions": identity["versions"]["versions"]},
                                     "companions": source_files}]}
            atomic_json(directory / "sources.json", manifest, immutable=True)
            collection = ws.import_sources(directory / "sources.json")
            choice = {"source_collection_id": collection["id"], "source_id": source_id}
            state.update(source_choice=choice, phase="source_imported",
                         recipe=describe_file(directory, directory / "report.json"),
                         source_manifest=describe_file(directory, directory / "sources.json"))
            atomic_json(state_path, state)
            if render:
                from . import scientific_report
                render_sections = list(recipe["sections"])
                if figure_product is not None and figure_product["blocks"]:
                    render_sections.append(["Native process figures", figure_product["blocks"]])
                source_records = [{"id": source_id, "source_id": source_id,
                                   "title": selection["title"], "vintage": manifest["entries"][0]["vintage"],
                                   "uri": manifest["entries"][0]["uri"], "sha256": body["sha256"]}]
                scientific_report.report_pdf(directory / "report.pdf", selection["title"],
                                             render_sections, contact={}, source_records=source_records)
                scientific_report.write_companions(directory, selection["title"], render_sections,
                                                   contact={}, source_records=source_records,
                                                   binding={"native_process_identity": key})
            # The formatter writes report-data.json; the immutable source recipe stays report.json.
            for item in source_files:
                verify_file(directory, item)
            verify_file(directory, state["recipe"])
            files = [describe_file(ws.root, path) for path in sorted(directory.rglob("*"))
                     if path.is_file() and not path.is_symlink() and path != state_path
                     and not any(part.startswith(".") for part in path.relative_to(directory).parts)]
            state.update(state="complete", phase="rendered" if render else "source_imported",
                         rendered=bool(render), completed_at=now(), updated_at=now(), files=files,
                         source_choice=choice, sections=len(recipe["sections"]) + bool(figure_product and figure_product["blocks"]),
                         figure_count=figure_product["figure_count"] if figure_product else 0,
                         panel_count=figure_product["panel_count"] if figure_product else 0,
                         report_selector={"source_roles": {"OBSERVED_CONTEXT": choice}})
            atomic_json(state_path, state)
            return state
        except BaseException as exc:
            state.update(state="failed", updated_at=now(),
                         error={"type": type(exc).__name__, "message": str(exc)})
            atomic_json(state_path, state)
            raise


def inspect(ws, key):
    return read_json(ws.root / ROOT / identifier(key) / "operation.json")


def attach(ws, key, delivery_selection):
    """Append this completed source to an existing ordered delivery selection."""
    from copy import deepcopy
    from .observed_context import source_choices
    state = inspect(ws, key)
    choice = state.get("source_choice")
    if not choice:
        raise ValueError("Finish the source-import phase of this process report")
    ws.source_file(choice["source_collection_id"], choice["source_id"])
    result = deepcopy(delivery_selection)
    choices = source_choices(result)
    if choice not in choices:
        choices.append(choice)
    result.setdefault("source_roles", {})["OBSERVED_CONTEXT"] = choices[0]
    if len(choices) > 1:
        result["observed_context_sources"] = choices
    else:
        result.pop("observed_context_sources", None)
    # A saved delivery binding describes its previous exact source set. Rebind
    # through the maintained producer when preparing the new delivery edition.
    result.pop("observed_context_binding", None)
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("catalog")
    for name in ("preview", "build"):
        command = commands.add_parser(name)
        command.add_argument("selection", help="JSON selection with actual run_ids")
        if name == "build":
            command.add_argument("--no-render", action="store_true")
    command = commands.add_parser("inspect")
    command.add_argument("report_id")
    command = commands.add_parser("attach", help="Append report to an existing delivery selection")
    command.add_argument("report_id")
    command.add_argument("delivery_selection")
    command.add_argument("output")
    args = parser.parse_args(argv)
    from .workspace import Workspace
    ws = Workspace(args.workspace)
    if args.command == "catalog":
        result = catalog(ws)
    elif args.command == "inspect":
        result = inspect(ws, args.report_id)
    elif args.command == "attach":
        result = attach(ws, args.report_id, read_json(args.delivery_selection))
        atomic_json(Path(args.output), result, immutable=True)
    elif args.command == "preview":
        result = preview(ws, read_json(args.selection))
    else:
        result = build(ws, read_json(args.selection), render=not args.no_render)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
