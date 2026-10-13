"""Source-bound restoration placement/width studies on the existing native grid.

The only model execution is the original Workspace/queue run operation. This
module prepares original land-cover scenarios and reduces completed native
mass exports through the existing common-support scenario analysis.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import math
from pathlib import Path

from . import rasters
from .common import (atomic_bytes, atomic_json, canonical, describe_file, digest,
                     file_digest, held, identifier, now, read_json, verify_file)
from .model_selection import run_models
from .scenario_footprint import get_footprint, preview_run

VERSION = "1.0.0"
RECORD_KIND = "restoration-extent-studies"
REPORT_KIND = "restoration-extent-reports"
OUTPUT_ROOT = "restoration-extent-output"
INPUT_SCHEMA = "upstate.restoration-extent-study-input/v1"


def _text(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(label + " must be a nonempty string")
    return value


def _where(value):
    if not isinstance(value, dict):
        raise ValueError("A feature filter must be an object of exact property values")
    for key, item in value.items():
        _text(key, "Filter property")
        if not (item is None or type(item) in (str, int, float, bool)):
            raise ValueError("Feature filters use scalar property values")
        if type(item) is float and not math.isfinite(item):
            raise ValueError("Feature filters must be finite")
    return value


def _spec(value):
    spec = json.loads(canonical(value))
    if not isinstance(spec, dict) or set(spec) - {
            "schema", "title", "reason", "baseline_run_id", "stream_source",
            "placements", "widths_m", "from_codes", "to_code", "scope"}:
        raise ValueError("Use only the declared restoration extent inputs")
    if spec.get("schema") != INPUT_SCHEMA:
        raise ValueError("Use " + INPUT_SCHEMA)
    _text(spec.get("title"), "Study title")
    _text(spec.get("reason"), "Restoration assumptions")
    identifier(spec.get("baseline_run_id"))
    source = spec.get("stream_source", {})
    if not isinstance(source, dict) or set(source) - {"source_collection_id", "source_id", "layer", "where"}:
        raise ValueError("Use a retained stream source and explicit property filter")
    identifier(source.get("source_collection_id"))
    _text(source.get("source_id"), "Retained stream source ID")
    if source.get("layer") is not None:
        _text(source["layer"], "Stream layer")
    source["where"] = _where(source.get("where", {}))
    placements = spec.get("placements")
    if not isinstance(placements, list) or not placements:
        raise ValueError("Choose at least one actual stream placement")
    seen = set()
    for placement in placements:
        if not isinstance(placement, dict) or set(placement) - {"id", "title", "where"}:
            raise ValueError("Each placement needs id, title and an optional exact property filter")
        key = _text(placement.get("id"), "Placement ID")
        if key in seen:
            raise ValueError("Placement IDs must be distinct")
        seen.add(key)
        _text(placement.get("title"), "Placement title")
        placement["where"] = _where(placement.get("where", {}))
        if any(k in source["where"] and source["where"][k] != v
               for k, v in placement["where"].items()):
            raise ValueError("Placement and source filters conflict")
    widths = spec.get("widths_m")
    if not isinstance(widths, list) or not widths:
        raise ValueError("Choose explicit positive buffer distances in metres")
    if any(type(w) not in (int, float) or not math.isfinite(w) or w <= 0
           for w in widths):
        raise ValueError("Every buffer distance must be finite and positive")
    if len(set(widths)) != len(widths):
        raise ValueError("Buffer distances must be distinct")
    spec["widths_m"] = sorted(float(w) for w in widths)
    codes = spec.get("from_codes")
    if not isinstance(codes, list) or not codes or any(type(c) is not int for c in codes):
        raise ValueError("Choose explicit original integer land-cover classes")
    if len(set(codes)) != len(codes):
        raise ValueError("Original land-cover classes must be distinct")
    if type(spec.get("to_code")) is not int or spec["to_code"] in codes:
        raise ValueError("Choose an integer destination class outside from_codes")
    spec["from_codes"] = sorted(codes)
    if spec.get("scope") not in ("reporting", "model_domain"):
        raise ValueError("Choose reporting or model_domain corridor clipping")
    spec["stream_source"] = source
    return spec


def _polygonal(geometry):
    from shapely.geometry import GeometryCollection
    from shapely.ops import unary_union
    if geometry.geom_type in ("Polygon", "MultiPolygon"):
        return geometry
    members = []
    for child in getattr(geometry, "geoms", []):
        item = _polygonal(child)
        if not item.is_empty:
            members.append(item)
    return unary_union(members) if members else GeometryCollection()


def _grid_geometry(workspace, grid, role):
    path = verify_file(workspace.root / "grids" / grid["id"], grid["files"][role])
    rows, crs = rasters.vector_geometry(path, target_crs=grid["grid"]["crs"])
    return rasters.polygon_union(rows), crs


def _cell_identity(path):
    """Compare categorical cell values independently of TIFF metadata/layout."""
    import rasterio
    from rasterio.windows import Window
    checksum = hashlib.sha256()
    with rasterio.open(path) as src:
        checksum.update(canonical({"width": src.width, "height": src.height,
                                   "crs": src.crs.to_wkt(),
                                   "transform": list(src.transform)[:6]}))
        for y in range(0, src.height, 256):
            window = Window(0, y, src.width, min(256, src.height - y))
            data = src.read(1, window=window)
            valid = src.read_masks(1, window=window) > 0
            values = data.astype("<i8", copy=True)
            values[~valid] = 0
            checksum.update(valid.astype("uint8").tobytes(order="C"))
            checksum.update(values.tobytes(order="C"))
    return checksum.hexdigest()


def _nested(workspace, previous, current):
    """Count lost changed cells on the exact original lattice."""
    if previous is None or previous["changed_cells"] == 0:
        return {"nested": True, "lost_changed_cells": 0}
    import numpy as np
    import rasterio
    from rasterio.windows import Window
    left = get_footprint(workspace, previous["footprint_id"])
    right = get_footprint(workspace, current["footprint_id"])
    a = verify_file(workspace.root, left["files"]["net_change_mask"])
    b = verify_file(workspace.root, right["files"]["net_change_mask"])
    lost = 0
    with rasterio.open(a) as old, rasterio.open(b) as new:
        if (old.width, old.height, old.transform, old.crs) != (
                new.width, new.height, new.transform, new.crs):
            raise ValueError("Restoration footprint grids differ")
        for y in range(0, old.height, 256):
            window = Window(0, y, old.width, min(256, old.height - y))
            before = old.read(1, window=window) == 1
            after = new.read(1, window=window) == 1
            lost += int(np.count_nonzero(before & ~after))
    return {"nested": lost == 0, "lost_changed_cells": lost}


def _verify_record(workspace, record):
    for item in record["files"].values():
        verify_file(workspace.root, item)
    source = record["spec"]["stream_source"]
    _, entry = workspace.source_file(source["source_collection_id"], source["source_id"])
    if entry != record["binding"]["stream_entry"]:
        raise ValueError("Original stream source edition changed")
    baseline = workspace.inspect_run(record["spec"]["baseline_run_id"])
    if baseline["selection"] != record["binding"]["baseline_selection"]:
        raise ValueError("Original baseline selection changed")
    for case in record["cases"]:
        if case["footprint_id"]:
            footprint = get_footprint(workspace, case["footprint_id"])
            if footprint["run_id"] != case["run_id"]:
                raise ValueError("Case footprint refers to another original run")
        run = workspace.inspect_run(case["execute_run_id"])
        if (run["selection"]["grid_id"] != baseline["selection"]["grid_id"]
                or run["selection"]["profile_id"] != baseline["selection"]["profile_id"]
                or run_models(run) != run_models(baseline)):
            raise ValueError("Case native grid, profile or model selection changed")
    return record


def prepare_study(workspace, value):
    """Prepare full original scenarios/footprints; enqueue runs separately."""
    from pyproj import CRS
    from shapely.geometry import mapping
    from shapely.ops import unary_union
    import fiona
    import numpy
    import rasterio
    import shapely
    import pyproj
    from . import scenario_footprint

    spec = _spec(value)
    baseline = workspace.inspect_run(spec["baseline_run_id"])
    selection = baseline["selection"]
    original_scenario = workspace._get("scenarios", selection["scenario_id"])
    if original_scenario["kind"] != "baseline":
        raise ValueError("Select a baseline using the original retained land-cover edition")
    grid = workspace.get_grid(selection["grid_id"])
    profile = workspace._get("profiles", selection["profile_id"])
    codes = set(profile["table_summary"]["lucodes"])
    if not set(spec["from_codes"] + [spec["to_code"]]).issubset(codes):
        raise ValueError("Every selected land-cover class needs its original profile row")
    crs = CRS.from_user_input(grid["grid"]["crs"])
    if (not crs.is_projected or len(crs.axis_info) < 2
            or any(abs(axis.unit_conversion_factor - 1) > 1e-12
                   for axis in crs.axis_info[:2])):
        raise ValueError("Restoration buffers require the original projected metre grid")
    role = "reporting_area" if spec["scope"] == "reporting" else "model_domain"
    clip, _ = _grid_geometry(workspace, grid, role)
    stream = spec["stream_source"]
    source_path, entry = workspace.source_file(
        stream["source_collection_id"], stream["source_id"])
    if entry["kind"] != "vector":
        raise ValueError("Choose an actual retained stream vector source")
    selected_layer = stream.get("layer") or entry.get("layer")
    rows, _ = rasters.vector_geometry(source_path, layer=selected_layer,
                                      where=stream["where"], target_crs=crs)
    if any(row["geometry"].geom_type not in ("LineString", "MultiLineString")
           for row in rows):
        raise ValueError("The selected stream layer must contain line geometries")
    selected = {}
    for placement in spec["placements"]:
        chosen = [row for row in rows if all(
            row["properties"].get(k) == v for k, v in placement["where"].items())]
        if not chosen:
            raise ValueError("Placement has no selected stream features: " + placement["id"])
        selected[placement["id"]] = chosen
    binding = {
        "version": VERSION, "implementation_sha256": file_digest(Path(__file__)),
        "baseline_selection": selection, "grid_definition": grid["grid"],
        "original_algorithms": {
            "scenario_footprint_sha256": file_digest(Path(scenario_footprint.__file__)),
            "rasters_sha256": file_digest(Path(rasters.__file__))},
        "clip_role": role, "clip_file": grid["files"][role],
        "stream_entry": entry, "selected_stream_layer": selected_layer,
        "geometry_versions": {"shapely": shapely.__version__, "fiona": fiona.__version__,
                              "rasterio": rasterio.__version__, "numpy": numpy.__version__,
                              "pyproj": pyproj.__version__, "proj": pyproj.proj_version_str,
                              "gdal": rasterio.__gdal_version__},
        "buffer_method": {"distance": "metres each side", "resolution": 16,
                          "cap_style": "round", "join_style": "round"},
        "footprint_rule": "original compiler; pixel-centre inclusion and eligible baseline classes"}
    request = {"spec": spec, "binding": binding}
    key = digest(request)
    directory = workspace.root / OUTPUT_ROOT / key
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".study.lock", blocking=False):
        complete = directory / "complete.json"
        if complete.exists():
            receipt = read_json(complete)
            retained = workspace._get(RECORD_KIND, receipt["study_id"])
            if receipt.get("request_id") != key or retained.get("request_id") != key:
                raise ValueError("Completed restoration receipt belongs to another original request")
            return _verify_record(workspace, retained)
        request_path = directory / "request.json"
        if request_path.exists():
            envelope = read_json(request_path)
            if envelope["request"] != request:
                raise ValueError("Retained restoration request differs")
        else:
            envelope = {"request": request, "created_at": now()}
            atomic_json(request_path, envelope, immutable=True)
        cases, files, same_cells = [], {}, {}
        files["request"] = describe_file(workspace.root, request_path)
        base_path = verify_file(workspace.root / "grids" / grid["id"], grid["files"]["NLCD"])
        same_cells[_cell_identity(base_path)] = {
            "execute_run_id": baseline["id"], "case_id": None}
        for placement in spec["placements"]:
            chosen = selected[placement["id"]]
            joined = unary_union([row["geometry"] for row in chosen])
            prior = None
            for width in spec["widths_m"]:
                case_id = digest({"study_request": key, "placement": placement["id"], "width_m": width})
                case_dir = directory / case_id
                case_dir.mkdir(parents=True, exist_ok=True)
                case_path = case_dir / "case.json"
                if case_path.exists():
                    case = read_json(case_path)
                    if case["case_id"] != case_id:
                        raise ValueError("Retained restoration case differs")
                    if case.get("landcover_cell_sha256"):
                        same_cells.setdefault(case["landcover_cell_sha256"], case)
                    for label, item in case["files"].items():
                        verify_file(workspace.root, item)
                        files[case_id + ":" + label] = item
                    files[case_id + ":case"] = describe_file(workspace.root, case_path)
                    cases.append(case)
                    prior = case
                    continue
                corridor = _polygonal(joined.buffer(
                    width, resolution=16, cap_style=1, join_style=1).intersection(clip))
                if not corridor.is_empty and not corridor.is_valid:
                    raise ValueError("Buffered restoration corridor requires an explicit geometry correction")
                feature_selection = {
                    "schema": "upstate.restoration-stream-selection/v1",
                    "source": stream, "placement": placement,
                    "features": [{"id": row["id"], "properties": row["properties"]}
                                 for row in chosen], "width_m_each_side": width}
                selection_path = case_dir / "stream-selection.json"
                atomic_json(selection_path, feature_selection, immutable=True)
                case = {
                    "case_id": case_id, "placement_id": placement["id"],
                    "placement_title": placement["title"], "width_m": width,
                    "run_id": baseline["id"], "execute_run_id": baseline["id"],
                    "scenario_id": selection["scenario_id"], "footprint_id": None,
                    "changed_cells": 0, "changed_area_ha": 0.0,
                    "corridor_area_ha": float(corridor.area / 10000),
                    "geometry_empty": corridor.is_empty, "mask_source_id": None,
                    "source_collection_id": None, "equivalent_case_id": None,
                    "files": {"stream_selection": describe_file(workspace.root, selection_path)}}
                if not corridor.is_empty:
                    mask_path = case_dir / "corridor.geojson"
                    atomic_json(mask_path, {
                        "type": "FeatureCollection", "name": "restoration_corridor",
                        "crs": {"type": "name", "properties": {"name": crs.to_string()}},
                        "features": [{"type": "Feature", "id": case_id,
                                      "geometry": mapping(corridor),
                                      "properties": {"case_id": case_id, "width_m": width,
                                                     "placement_id": placement["id"]}}]}, immutable=True)
                    manifest_path = case_dir / "sources.json"
                    atomic_json(manifest_path, {
                        "schema": "upstate.sources/v1",
                        "title": spec["title"] + " / " + placement["title"] + " / " + str(width) + " m",
                        "captured_at": envelope["created_at"],
                        "scope": {"restoration_extent_request": key, "case_id": case_id,
                                  "original_stream_source": stream, "clip_role": role},
                        "notes": [spec["reason"]],
                        "entries": [{"id": "corridor", "kind": "vector",
                                     "title": placement["title"] + " restoration corridor",
                                     "path": "corridor.geojson", "sha256": file_digest(mask_path),
                                     "uri": "urn:upstate:restoration-corridor:" + case_id,
                                     "vintage": envelope["created_at"]}]}, immutable=True)
                    collection = workspace.import_sources(manifest_path)
                    scenario = workspace.save_scenario({
                        "title": spec["title"] + " / " + placement["title"] + " / " + str(width) + " m",
                        "reason": spec["reason"], "kind": "landcover",
                        "source_collection_id": collection["id"],
                        "patches": [{"mask_source_id": "corridor", "from_codes": spec["from_codes"],
                                     "to_code": spec["to_code"], "reason": spec["reason"]}]})
                    run = workspace.prepare_run({
                        "grid_id": selection["grid_id"], "profile_id": selection["profile_id"],
                        "scenario_id": scenario["id"], "models": list(run_models(baseline))})
                    footprint = preview_run(workspace, run["id"])
                    landcover = verify_file(workspace.root, footprint["files"]["scenario_lulc"])
                    cell_sha = _cell_identity(landcover)
                    donor = same_cells.get(cell_sha)
                    case.update(
                        run_id=run["id"], execute_run_id=donor["execute_run_id"] if donor else run["id"],
                        scenario_id=scenario["id"], footprint_id=footprint["id"],
                        changed_cells=footprint["summary"]["net_changed_cells"],
                        changed_area_ha=footprint["summary"]["net_changed_hectares"],
                        source_collection_id=collection["id"], mask_source_id="corridor",
                        equivalent_case_id=donor["case_id"] if donor else None,
                        landcover_cell_sha256=cell_sha)
                    case["files"].update(
                        corridor=describe_file(workspace.root, mask_path),
                        source_manifest=describe_file(workspace.root, manifest_path))
                    same_cells.setdefault(cell_sha, case)
                case["nesting"] = _nested(workspace, prior, case)
                if not case["nesting"]["nested"]:
                    raise ValueError("Increasing this buffer lost prior changed cells; inspect its original geometry")
                atomic_json(case_path, case, immutable=True)
                for label, item in case["files"].items():
                    files[case_id + ":" + label] = item
                files[case_id + ":case"] = describe_file(workspace.root, case_path)
                cases.append(case)
                prior = case
        record = workspace._save(RECORD_KIND, {
            "title": spec["title"], "created_at": envelope["created_at"],
            "spec": spec, "binding": binding, "request_id": key,
            "cases": cases, "files": files,
            "execution_run_ids": list(dict.fromkeys(
                [baseline["id"]] + [case["execute_run_id"] for case in cases]))})
        atomic_json(complete, {"study_id": record["id"], "request_id": key}, immutable=True)
        return _verify_record(workspace, record)


def list_studies(workspace):
    return workspace._list(RECORD_KIND)


def read_report(workspace, study_id):
    """Return the immutable saved report without computing any new result."""
    study = workspace._get(RECORD_KIND, identifier(study_id))
    path = workspace.root / OUTPUT_ROOT / study["request_id"] / "report.json"
    if not path.exists():
        return None
    receipt = read_json(path)
    report = workspace._get(REPORT_KIND, receipt["report_id"])
    if report["study_id"] != study_id:
        raise ValueError("Restoration report belongs to another study")
    for item in report["files"].values():
        verify_file(workspace.root, item)
    return report


def inspect_study(workspace, study_id):
    record = _verify_record(workspace, workspace._get(RECORD_KIND, identifier(study_id)))
    current = [{**case, "state": workspace.inspect_run(case["execute_run_id"])["state"]}
               for case in record["cases"]]
    return {"record": record, "current_cases": current,
            "report": read_report(workspace, study_id)}


def _csv(path, rows, fields):
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=fields, extrasaction="ignore", lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    atomic_bytes(path, output.getvalue().encode("utf-8"), immutable=True)


def build_report(workspace, study_id):
    """Compare all completed cases on the existing cohort-common native support."""
    study = _verify_record(workspace, workspace._get(RECORD_KIND, identifier(study_id)))
    directory = workspace.root / OUTPUT_ROOT / study["request_id"]
    with held(directory / ".report.lock", blocking=False):
        original = read_report(workspace, study_id)
        if original is not None:
            return original
        ids = study["execution_run_ids"]
        for key in ids:
            if workspace.inspect_run(key)["state"] != "complete":
                raise ValueError("Complete original native run " + key + " before building the response")
        baseline_id = study["spec"]["baseline_run_id"]
        analysis = workspace.analyze_scenarios({
            "title": study["title"] + " / restoration extent response",
            "baseline_run_id": baseline_id,
            "scenario_run_ids": [key for key in ids if key != baseline_id]})
        physical = {(row["run_id"], row["pollutant"]): row for row in analysis["physical"]
                    if row["region_id"] == "reporting_area"}
        pollutants = sorted({name for run_id, name in physical if run_id == baseline_id})
        if not pollutants:
            raise ValueError("Original native analysis returned no reporting-area mass outputs")
        curves, marginals = [], []
        for placement in study["spec"]["placements"]:
            cases = sorted([case for case in study["cases"]
                            if case["placement_id"] == placement["id"]], key=lambda case: case["width_m"])
            for pollutant in pollutants:
                reference = physical[(baseline_id, pollutant)]
                supported = reference["common_valid_cells"] > 0
                previous = {
                    "case_id": None, "width_m": 0.0, "changed_area_ha": 0.0,
                    "export": reference["common_sum"], "reduction": 0.0 if supported else None}
                curves.append({
                    "placement_id": placement["id"], "placement_title": placement["title"],
                    "case_id": None, "width_m": 0.0, "changed_cells": 0,
                    "changed_area_ha": 0.0, "corridor_area_ha": 0.0,
                    "run_id": baseline_id, "execute_run_id": baseline_id,
                    "pollutant": pollutant, "units": reference["units"],
                    "native_export": reference["common_sum"],
                    "baseline_native_export": reference["common_sum"],
                    "export_reduction": 0.0 if supported else None, "percent_reduction": 0.0
                    if reference["common_sum"] else None,
                    "reduction_per_changed_ha": None,
                    "common_valid_cells": reference["common_valid_cells"],
                    "common_coverage_fraction": reference["common_coverage_fraction"],
                    "common_area_ha": reference["common_area_ha"],
                    "is_baseline": True,
                    "status": "computed" if supported else "no_common_valid_support"})
                for case in cases:
                    row = physical[(case["execute_run_id"], pollutant)]
                    reduction = (reference["common_sum"] - row["common_sum"]
                                 if supported else None)
                    area = case["changed_area_ha"]
                    curves.append({
                        "placement_id": placement["id"], "placement_title": placement["title"],
                        "case_id": case["case_id"], "width_m": case["width_m"],
                        "changed_cells": case["changed_cells"], "changed_area_ha": area,
                        "corridor_area_ha": case["corridor_area_ha"],
                        "run_id": case["run_id"], "execute_run_id": case["execute_run_id"],
                        "pollutant": pollutant, "units": row["units"],
                        "native_export": row["common_sum"],
                        "baseline_native_export": reference["common_sum"],
                        "export_reduction": reduction,
                        "percent_reduction": 100 * reduction / reference["common_sum"]
                        if reference["common_sum"] else None,
                        "reduction_per_changed_ha": reduction / area if supported and area > 0 else None,
                        "common_valid_cells": row["common_valid_cells"],
                        "common_coverage_fraction": row["common_coverage_fraction"],
                        "common_area_ha": row["common_area_ha"], "is_baseline": False,
                        "status": "computed" if supported else "no_common_valid_support"})
                    delta_area = area - previous["changed_area_ha"]
                    delta_reduction = reduction - previous["reduction"] if supported else None
                    if delta_area < 0:
                        raise ValueError("Retained restoration extents are not nested")
                    if delta_area == 0 and case["execute_run_id"] != (
                            baseline_id if previous["case_id"] is None else previous["execute_run_id"]):
                        raise ValueError("Equal nested extents must resolve to identical original categorical cells")
                    marginals.append({
                        "placement_id": placement["id"], "pollutant": pollutant,
                        "from_case_id": previous["case_id"], "to_case_id": case["case_id"],
                        "from_width_m": previous["width_m"], "to_width_m": case["width_m"],
                        "additional_changed_area_ha": delta_area,
                        "additional_export_reduction": delta_reduction, "units": row["units"],
                        "marginal_reduction_per_ha": delta_reduction / delta_area
                        if supported and delta_area > 0 else None,
                        "status": ("no_common_valid_support" if not supported else
                                   "computed" if delta_area > 0 else "no_additional_changed_cells"),
                        "nested": case["nesting"]["nested"]})
                    previous = {
                        "case_id": case["case_id"], "width_m": case["width_m"],
                        "changed_area_ha": area, "export": row["common_sum"],
                        "reduction": reduction, "execute_run_id": case["execute_run_id"]}
        out = directory / "response"
        out.mkdir(parents=True, exist_ok=True)
        interpretation = {
            "width": "Buffer distance in metres on each side of selected original stream lines; round caps and joins.",
            "extent": "Actual eligible original land-cover cells changed on the retained grid; corridor polygon area is separate.",
            "response": "Baseline minus case annual native reporting-area mass export on the common valid support of every distinct selected run.",
            "marginal": "Difference in export reduction divided by additional changed hectares between adjacent nested widths within one placement.",
            "scope": study["spec"]["scope"],
            "denominator": "All changed hectares in the selected clipping scope; upstream changes can affect the reporting area.",
            "zero_area": "No additional changed cells gives a null marginal, never an invented benefit per hectare.",
            "equivalence": "Identical full categorical cells and validity reuse an original run with the same grid, profile and model selection.",
            "causality": "These are conditional native-model scenario responses under the selected coefficients and inputs.",
            "negative_values": "Negative export reduction means the native case increased export; values remain signed.",
            "placement": "Placement curves are independent alternatives. Overlapping placements are not additive.",
            "support": "Common valid cell count, area and coverage accompany every value. Zero common valid support gives null exports, reductions and marginals."}
        payload = {
            "schema": "upstate.restoration-extent-response/v1", "study_id": study_id,
            "analysis_id": analysis["id"], "baseline_run_id": baseline_id,
            "curves": curves, "marginals": marginals, "interpretation": interpretation}
        atomic_json(out / "response.json", payload, immutable=True)
        _csv(out / "response-curves.csv", curves, list(curves[0]))
        _csv(out / "marginal-response.csv", marginals, list(marginals[0]))
        analysis_path = workspace.root / "analyses" / analysis["id"] / "analysis.json"
        report = workspace._save(REPORT_KIND, {
            **payload, "title": study["title"], "native_analysis": {
                "input_binding": analysis.get("input_binding"),
                "source_artifacts": analysis.get("source_artifacts"),
                "native_versions": analysis.get("native_versions")},
            "files": {
                "response": describe_file(workspace.root, out / "response.json"),
                "curves_csv": describe_file(workspace.root, out / "response-curves.csv"),
                "marginals_csv": describe_file(workspace.root, out / "marginal-response.csv"),
                "native_analysis": describe_file(workspace.root, analysis_path)}})
        atomic_json(directory / "report.json", {"report_id": report["id"]}, immutable=True)
        return report
