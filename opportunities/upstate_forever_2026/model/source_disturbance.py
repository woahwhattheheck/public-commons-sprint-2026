"""Retained polygon selections, explicit protection and original native scenarios.

This module prepares categorical inputs using the maintained scenario kernel.
It does not alter biophysical coefficients, model algorithms or native workers.
"""
from __future__ import annotations
from copy import deepcopy
import csv
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import shutil
import tempfile
import zipfile

from .common import (INVEST_VERSION, atomic_bytes, atomic_json, canonical, describe_file, digest,
                     held, identifier, now, read_json, verify_file)
from .model_selection import run_models, normalize_selection
from .verified_files import verified_operation

SCHEMA = "upstate.source-disturbance-study/v1"
SELECTION_SCHEMA = "upstate.source-disturbance-selection/v1"
VERSION = "original-polygon-protection-1"
MAX_CASES, MAX_PATCHES, MAX_FEATURES = 16, 32, 5000
POLICIES = {"convert_selected": "Convert selected source polygons",
            "retain_protection": "Retain selected protection polygons"}
MEANING = {
    "geometry": "Original source features are retained unchanged; derived coordinates use the original model grid CRS.",
    "mask": "Original pixel-centre rule, all_touched=False. Protection subtracts selected protected cell centres from selected conversion cell centres.",
    "order": "Patches are ordered. Each from_codes predicate sees the current value after preceding patches.",
    "area": "Grid-cell area is the original affine determinant divided by 10000. Polygon geometry area is a separate quantity.",
    "support": "Masks cover the original model grid; original land-cover nodata remains nodata. No implicit reporting-boundary clipping.",
    "effect": "Changed input hectares are not modeled benefits. Native annual export differences are alternative minus baseline on pairwise valid support.",
    "purpose": "Explicit conditional scenario, not a land-development forecast or observed causal effect.",
}


class SourceDisturbanceError(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def _need(condition, code, message):
    if not condition:
        raise SourceDisturbanceError(code, message)


def _clone(value):
    return json.loads(canonical(value))


def _text(value, label, limit=10000):
    _need(isinstance(value, str) and value.strip() and len(value) <= limit,
          "SOURCE_DISTURBANCE_INPUT", "Supply " + label)
    return value


def _named_id(value):
    _need(isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,64}", value),
          "SOURCE_DISTURBANCE_INPUT", "Use a stable case or patch ID of letters, numbers, hyphens or underscores")
    return value


def _selector(value):
    _need(isinstance(value, dict) and set(value) <= {
        "source_collection_id", "source_id", "layer", "feature_ids"},
        "SOURCE_DISTURBANCE_SOURCE", "Use an original retained vector source and explicit feature IDs")
    value = _clone(value)
    identifier(value.get("source_collection_id"))
    _text(value.get("source_id"), "an original source ID", 1000)
    if value.get("layer") is not None:
        _text(value["layer"], "the original native layer", 1000)
    ids = value.get("feature_ids")
    _need(isinstance(ids, list) and 1 <= len(ids) <= MAX_FEATURES
          and all(isinstance(x, str) and x and len(x) <= 1000 for x in ids)
          and len(set(ids)) == len(ids),
          "SOURCE_DISTURBANCE_SOURCE", "Select distinct original feature-ID strings, at most 5000 per source")
    value["feature_ids"] = list(ids)
    value["layer"] = value.get("layer")
    return value


def selection(value):
    _need(isinstance(value, dict) and set(value) <= {
        "schema", "title", "purpose", "references", "baseline_run_ids", "cases"},
        "SOURCE_DISTURBANCE_INPUT", "Use the complete source-disturbance selection")
    value = _clone(value)
    _need(value.get("schema", SELECTION_SCHEMA) == SELECTION_SCHEMA,
          "SOURCE_DISTURBANCE_INPUT", "Use the source-disturbance selection schema")
    value["schema"] = SELECTION_SCHEMA
    _text(value.get("title"), "a study title", 500)
    _text(value.get("purpose"), "the scenario question and its assumptions")
    refs = value.get("references", [])
    _need(isinstance(refs, list) and len(refs) <= 100, "SOURCE_DISTURBANCE_INPUT", "Retain a list of source citations")
    value["references"] = [_text(x, "each source citation", 4000) for x in refs]
    ids = value.get("baseline_run_ids")
    _need(isinstance(ids, list) and 1 <= len(ids) <= 8 and len(set(ids)) == len(ids),
          "SOURCE_DISTURBANCE_INPUT", "Select one to eight distinct completed original baseline runs")
    for key in ids:
        identifier(key)
    cases = value.get("cases")
    _need(isinstance(cases, list) and 1 <= len(cases) <= MAX_CASES,
          "SOURCE_DISTURBANCE_INPUT", "Select one to sixteen explicit cases")
    case_ids = set()
    for case in cases:
        _need(isinstance(case, dict) and set(case) <= {"id", "label", "reason", "patches"},
              "SOURCE_DISTURBANCE_INPUT", "Use the documented case fields")
        key = _named_id(case.get("id"))
        _need(key not in case_ids, "SOURCE_DISTURBANCE_INPUT", "Case IDs must be distinct")
        case_ids.add(key)
        _text(case.get("label"), "a case label", 500)
        _text(case.get("reason"), "the case's scientific assumptions")
        patches = case.get("patches")
        _need(isinstance(patches, list) and 1 <= len(patches) <= MAX_PATCHES,
              "SOURCE_DISTURBANCE_INPUT", "Select one to 32 ordered patches per case")
        patch_ids = set()
        for patch in patches:
            _need(isinstance(patch, dict) and set(patch) <= {
                "id", "label", "reason", "source", "from_codes", "to_code", "policy", "protections"},
                "SOURCE_DISTURBANCE_INPUT", "Use the documented ordered patch fields")
            key = _named_id(patch.get("id"))
            _need(key not in patch_ids, "SOURCE_DISTURBANCE_INPUT", "Patch IDs must be distinct within a case")
            patch_ids.add(key)
            _text(patch.get("label"), "a patch label", 500)
            _text(patch.get("reason"), "the mapped land-cover assumption")
            patch["source"] = _selector(patch.get("source"))
            codes = patch.get("from_codes")
            _need(isinstance(codes, list) and codes and len(codes) <= 1000
                  and all(type(x) is int and -(2**31) < x < 2**31 for x in codes)
                  and len(set(codes)) == len(codes),
                  "SOURCE_DISTURBANCE_INPUT", "Select distinct native integer source land-cover codes")
            patch["from_codes"] = list(codes)
            _need(type(patch.get("to_code")) is int and -(2**31) < patch["to_code"] < 2**31,
                  "SOURCE_DISTURBANCE_INPUT", "Select an integer native destination land-cover code")
            _need(patch.get("policy") in POLICIES, "SOURCE_DISTURBANCE_POLICY", "Select the explicit conversion/protection policy")
            protections = patch.get("protections", [])
            _need(isinstance(protections, list) and len(protections) <= 32,
                  "SOURCE_DISTURBANCE_POLICY", "Retain the original protection selections")
            patch["protections"] = [_selector(x) for x in protections]
            _need((patch["policy"] == "retain_protection") == bool(protections),
                  "SOURCE_DISTURBANCE_POLICY", "Protection policy requires selected polygons; conversion-only policy has none")
    return value


def _feature(feature):
    from shapely.geometry import shape, mapping
    _need(feature.get("geometry") is not None, "SOURCE_DISTURBANCE_GEOMETRY", "Selected source feature has no geometry")
    geometry = shape(feature["geometry"])
    _need(not geometry.is_empty and geometry.is_valid
          and geometry.geom_type in ("Polygon", "MultiPolygon"),
          "SOURCE_DISTURBANCE_GEOMETRY", "Selected features must contain valid polygons; retain any correction as a new source")
    result = {"type": "Feature", "id": str(feature.id), "properties": dict(feature["properties"]),
              "geometry": mapping(geometry)}
    canonical(result)  # Reject nonfinite/unrepresentable source properties rather than changing them.
    return result, geometry


def _source(workspace, selected, target_crs=None):
    import fiona
    from pyproj import CRS, Transformer
    from shapely.geometry import mapping
    from shapely.ops import transform
    from . import rasters
    path, entry = workspace.source_file(selected["source_collection_id"], selected["source_id"])
    _need(entry["kind"] == "vector", "SOURCE_DISTURBANCE_SOURCE", "Select a retained polygon vector source")
    with rasters.vector_environment():
        layers = list(fiona.listlayers(rasters.native_vector_path(path)))
    layer = selected.get("layer") or entry.get("layer")
    if layer is None:
        _need(len(layers) == 1, "SOURCE_DISTURBANCE_LAYER", "Choose the original native layer explicitly")
        layer = layers[0]
    _need(layer in layers, "SOURCE_DISTURBANCE_LAYER", "The selected native layer is absent")
    wanted = set(selected["feature_ids"])
    originals, projected, found = [], [], set()
    with rasters.vector_environment(), fiona.open(rasters.native_vector_path(path), layer=layer) as src:
        crs = CRS.from_user_input(src.crs_wkt or src.crs)
        target = CRS.from_user_input(target_crs) if target_crs is not None else crs
        project = Transformer.from_crs(crs, target, always_xy=True)
        for item in src:
            key = str(item.id)
            if key not in wanted:
                continue
            _need(key not in found, "SOURCE_DISTURBANCE_FEATURE", "Original native feature IDs are not unique")
            original, geometry = _feature(item)
            found.add(key)
            originals.append(original)
            if crs != target:
                geometry = transform(project.transform, geometry)
            _need(not geometry.is_empty and geometry.is_valid
                  and all(math.isfinite(x) for x in geometry.bounds),
                  "SOURCE_DISTURBANCE_GEOMETRY", "The explicit CRS transformation produced invalid geometry")
            projected.append({"id": key, "geometry": mapping(geometry)})
    _need(found == wanted, "SOURCE_DISTURBANCE_FEATURE", "The retained layer does not contain every selected feature")
    originals.sort(key=lambda x: x["id"])
    projected.sort(key=lambda x: x["id"])
    collection = workspace._get("sources", selected["source_collection_id"])
    return {"selection": {**_clone(selected), "layer": layer}, "entry": _clone(entry),
            "collection_manifest": _clone(collection["original_manifest"]),
            "source_crs": crs.to_wkt(), "grid_crs": target.to_wkt(),
            "original_features": originals, "original_features_sha256": digest(originals),
            "projected_features": projected, "projected_features_sha256": digest(projected),
            "coordinate_operation": "Identity" if crs == target else project.description}


def _implementation():
    from .portable import application_digest
    paths = [Path(__file__), Path(__file__).with_name("scenario_footprint.py"),
             Path(__file__).with_name("source_disturbance_report.py")]
    files = {p.name: {"bytes": p.stat().st_size, "sha256": hashlib.sha256(p.read_bytes()).hexdigest()} for p in paths}
    result = {"version": VERSION, "files": files, "application_sha256": application_digest()}
    for path in paths:
        raw = path.read_bytes()
        _need(len(raw) == files[path.name]["bytes"] and hashlib.sha256(raw).hexdigest() == files[path.name]["sha256"],
              "SOURCE_DISTURBANCE_CODE", "Installed implementation changed during preparation")
    return result


class SourceDisturbanceStudies:
    def __init__(self, workspace):
        self.workspace, self.root = workspace, workspace.root
        self.directory = self.root / "source-disturbance-studies"
        self.operations = self.root / "source-disturbance-operations"

    def _base(self, **value):
        return {"schema": SCHEMA, "project_id": self.workspace.project["id"], **value}

    def _summary(self, study_id, plan):
        chosen = plan["selection"]
        patches = [patch for case in chosen["cases"] for patch in case["patches"]]
        return {"schema": "upstate.source-disturbance-summary/v1", "id": study_id,
                "project_id": plan["project_id"], "title": chosen["title"],
                "case_count": len(chosen["cases"]), "patch_count": len(patches),
                "baseline_count": len(chosen["baseline_run_ids"]),
                "selected_feature_count": sum(len(patch["source"]["feature_ids"]) for patch in patches),
                "protection_feature_count": sum(len(source["feature_ids"]) for patch in patches
                                                for source in patch["protections"])}

    def _publish_plan(self, study_id, plan):
        # Publish the small immutable index first. A study is visible only once its
        # full original plan exists; interruption cannot expose a half-published row.
        with held(self.root / ".workspace.lock"):
            atomic_json(self.directory / study_id / "summary.json", self._summary(study_id, plan), immutable=True)
            atomic_json(self.directory / study_id / "plan.json", plan, immutable=True)

    def summaries(self):
        rows = []
        for path in sorted(self.directory.glob("*/summary.json")):
            base = path.parent
            if not (base / "plan.json").is_file():
                continue
            _need(path.stat().st_size <= 16384, "SOURCE_DISTURBANCE_SUMMARY", "Study summary is unexpectedly large")
            summary = read_json(path)
            study_id = identifier(base.name)
            _need(summary.get("schema") == "upstate.source-disturbance-summary/v1"
                  and summary.get("id") == study_id and summary.get("project_id") == self.workspace.project["id"]
                  and isinstance(summary.get("title"), str) and len(summary["title"]) <= 1000
                  and all(type(summary.get(key)) is int and summary[key] >= 0 for key in
                          ("case_count", "patch_count", "baseline_count", "selected_feature_count", "protection_feature_count")),
                  "SOURCE_DISTURBANCE_SUMMARY", "Retained study summary identity changed")
            rows.append({**summary, "state": "complete" if (base / "report/report.json").is_file() else
                         "prepared" if (base / "preparation-receipt.json").is_file() else "preparing"})
        return self._base(studies=rows)

    def catalog(self):
        sources = []
        for collection in self.workspace.sources():
            for entry in collection["entries"]:
                if entry["kind"] == "vector":
                    sources.append({"source_collection_id": collection["id"], "source_id": entry["id"],
                                    **{k: _clone(entry.get(k)) for k in
                                       ("title", "uri", "vintage", "body", "companions", "layer")}})
        runs = []
        for path in sorted((self.root / "runs").glob("*/run.json")):
            run = self.workspace.inspect_run(path.parent.name)
            scenario = self.workspace._get("scenarios", run["selection"]["scenario_id"])
            runs.append({"id": run["id"], "state": run["state"], "selection": run["selection"],
                         "models": list(run_models(run)), "baseline": scenario["kind"] == "baseline"})
        return self._base(sources=sources, runs=runs, studies=self.summaries()["studies"],
                          profiles=self.workspace._list("profiles"),
                          policies=[{"id": key, "label": label} for key, label in POLICIES.items()],
                          maximum_cases=MAX_CASES, maximum_patches=MAX_PATCHES,
                          maximum_features=MAX_FEATURES, semantics=MEANING)

    @verified_operation
    def features(self, value):
        import fiona
        from pyproj import CRS
        from . import rasters
        _need(isinstance(value, dict), "SOURCE_DISTURBANCE_SOURCE", "Select a retained source layer")
        offset, limit = value.get("offset", 0), value.get("limit", 100)
        _need(type(offset) is int and offset >= 0 and type(limit) is int and 1 <= limit <= 500,
              "SOURCE_DISTURBANCE_PAGE", "Choose a nonnegative offset and one to 500 features")
        path, entry = self.workspace.source_file(identifier(value.get("source_collection_id")), value.get("source_id"))
        _need(entry["kind"] == "vector", "SOURCE_DISTURBANCE_SOURCE", "Select a vector source")
        with rasters.vector_environment():
            layers = list(fiona.listlayers(rasters.native_vector_path(path)))
        layer = value.get("layer") or entry.get("layer")
        if layer is None and len(layers) == 1:
            layer = layers[0]
        if layer is None:
            return self._base(source=entry, layers=layers, layer=None, items=[], total=None,
                              offset=offset, limit=limit, next_offset=None, requires_layer=True)
        _need(layer in layers, "SOURCE_DISTURBANCE_LAYER", "Select an actual original layer")
        items = []
        with rasters.vector_environment(), fiona.open(rasters.native_vector_path(path), layer=layer) as src:
            crs = CRS.from_user_input(src.crs_wkt or src.crs).to_wkt()
            fields = dict(src.schema["properties"])
            total = len(src)
            for number, item in enumerate(src):
                if number < offset:
                    continue
                if number >= offset + limit:
                    break
                try:
                    original, geometry = _feature(item)
                    row = {"id": str(item.id), "properties": original["properties"], "bounds": list(geometry.bounds),
                           "geometry_type": geometry.geom_type, "feature_sha256": digest(original), "selectable": True}
                except (ValueError, TypeError) as error:
                    properties = dict(item["properties"])
                    try:
                        canonical(properties)
                    except (ValueError, TypeError):
                        properties = {"source_properties": "Not representable as finite JSON; inspect the unchanged original vector"}
                    row = {"id": str(item.id), "properties": properties,
                           "selectable": False, "issue": str(error)}
                items.append(row)
        return self._base(source={"source_collection_id": value["source_collection_id"], **entry},
                          layer=layer, layers=layers, crs=crs, fields=fields, total=total,
                          offset=offset, limit=limit, items=items,
                          next_offset=offset + limit if offset + limit < total else None)

    @verified_operation
    def _plan(self, supplied):
        from pyproj import CRS
        chosen = selection(supplied)
        baselines = []
        grid = None
        seen_profiles = set()
        for key in chosen["baseline_run_ids"]:
            run = self.workspace.inspect_run(key)
            _need(run["state"] == "complete", "SOURCE_DISTURBANCE_BASELINE", "Finish the selected original baseline run")
            _need(run["selection"]["invest_version"] == INVEST_VERSION, "SOURCE_DISTURBANCE_VERSION",
                  "Select an original baseline from the maintained native InVEST version")
            scenario = self.workspace._get("scenarios", run["selection"]["scenario_id"])
            _need(scenario["kind"] == "baseline", "SOURCE_DISTURBANCE_BASELINE", "Select original baseline land cover")
            current_grid = self.workspace.get_grid(run["selection"]["grid_id"])
            if grid is None:
                grid = current_grid
            _need(current_grid["id"] == grid["id"], "SOURCE_DISTURBANCE_GRID", "Select baseline profiles on the same original grid")
            profile = self.workspace._get("profiles", run["selection"]["profile_id"])
            scope = tuple(run_models(run))
            identity = (profile["id"], scope)
            _need(identity not in seen_profiles, "SOURCE_DISTURBANCE_BASELINE", "Select each original baseline profile/model scope once")
            seen_profiles.add(identity)
            for case in chosen["cases"]:
                for patch in case["patches"]:
                    _need(patch["to_code"] in profile["table_summary"]["lucodes"],
                          "SOURCE_DISTURBANCE_COEFFICIENT", "Retain a destination coefficient row in every selected original profile")
            baselines.append({"run": _clone(run), "profile": profile, "scenario": scenario,
                              "run_file": describe_file(self.root, self.root / "runs" / key / "run.json")})
        crs = CRS.from_user_input(grid["grid"]["crs"])
        t = grid["grid"]["transform"]
        area = abs(t[0] * t[4] - t[1] * t[3]) / 10000.0
        _need(crs.is_projected and len(crs.axis_info) >= 2
              and all(abs(x.unit_conversion_factor - 1) <= 1e-12 for x in crs.axis_info[:2])
              and math.isfinite(area) and area > 0
              and math.isclose(area, grid["grid"]["pixel_area_ha"], rel_tol=1e-10, abs_tol=1e-12),
              "SOURCE_DISTURBANCE_GRID", "Use the exact projected-metre native grid and its original pixel area")
        for descriptor in grid["files"].values():
            verify_file(self.root / "grids" / grid["id"], descriptor)
        sources = {}
        for case in chosen["cases"]:
            for patch in case["patches"]:
                for ref in [patch["source"], *patch["protections"]]:
                    key = digest(ref)
                    if key not in sources:
                        sources[key] = _source(self.workspace, ref, crs)
        return self._base(selection=chosen, grid=_clone(grid), baselines=baselines, sources=sources,
                          pixel_area_ha=area, semantics=_clone(MEANING), implementation=_implementation())

    def _read_plan(self, study_id):
        plan = read_json(self.directory / identifier(study_id) / "plan.json")
        _need(digest(plan) == study_id and plan.get("project_id") == self.workspace.project["id"]
              and plan.get("schema") == SCHEMA, "SOURCE_DISTURBANCE_PLAN", "Retained study plan changed")
        selection(plan["selection"])
        summary = read_json(self.directory / study_id / "summary.json")
        _need(canonical(summary) == canonical(self._summary(study_id, plan)),
              "SOURCE_DISTURBANCE_SUMMARY", "Study summary differs from its full original plan")
        return plan

    @verified_operation
    def _validate_original(self, plan):
        grid = self.workspace.get_grid(plan["grid"]["id"])
        _need(canonical(grid) == canonical(plan["grid"]), "SOURCE_DISTURBANCE_GRID", "Original model grid changed")
        for descriptor in grid["files"].values():
            verify_file(self.root / "grids" / grid["id"], descriptor)
        for baseline in plan["baselines"]:
            verify_file(self.root, baseline["run_file"])
            _need(canonical(self.workspace.inspect_run(baseline["run"]["id"])) == canonical(baseline["run"]),
                  "SOURCE_DISTURBANCE_BASELINE", "Original completed baseline changed")
            _need(canonical(self.workspace._get("profiles", baseline["profile"]["id"])) == canonical(baseline["profile"]),
                  "SOURCE_DISTURBANCE_COEFFICIENT", "Original native coefficient profile changed")
        for source in plan["sources"].values():
            _, entry = self.workspace.source_file(source["selection"]["source_collection_id"], source["selection"]["source_id"])
            _need(canonical(entry) == canonical(source["entry"]),
                  "SOURCE_DISTURBANCE_SOURCE", "Original selected source edition changed")

    def _masks(self, study_id, plan):
        """Retain exact binary native masks and original/derived geometry separately."""
        import numpy as np
        import rasterio
        from rasterio.features import rasterize
        from rasterio.windows import Window
        from shapely.geometry import shape, mapping
        from shapely.ops import unary_union
        from pyproj import CRS
        from . import rasters
        from .scenario_footprint import _preview_png
        base = self.directory / study_id
        directory = base / "masks"
        complete = directory / "masks.json"
        if complete.exists():
            result = read_json(complete)
            _need(result["study_id"] == study_id, "SOURCE_DISTURBANCE_MASK", "Retained masks belong to another study")
            for descriptor in result["files"].values():
                verify_file(directory, descriptor)
            return result
        _need(not directory.exists(), "SOURCE_DISTURBANCE_MASK", "An incomplete mask publication requires its original retained staging")
        staging = self.root / "source-views" / "source-disturbance-staging"
        staging.mkdir(parents=True, exist_ok=True)
        staged = Path(tempfile.mkdtemp(prefix=study_id + "-", dir=staging))
        try:
            files, cases, entries = {}, [], []
            grid = plan["grid"]
            baseline = verify_file(self.root / "grids" / grid["id"], grid["files"]["NLCD"])
            profile = rasters.output_profile(grid["grid"], categorical=True)
            profile.update(dtype="uint8", nodata=255)
            with rasterio.open(baseline) as src:
                for case in plan["selection"]["cases"]:
                    patch_rows, native_patches = [], []
                    for patch in case["patches"]:
                        stem = digest({"case_id": case["id"], "patch_id": patch["id"]})
                        selected = plan["sources"][digest(patch["source"])]
                        conversion = unary_union([shape(x["geometry"]) for x in selected["projected_features"]])
                        exclusions = [shape(x["geometry"]) for ref in patch["protections"]
                                      for x in plan["sources"][digest(ref)]["projected_features"]]
                        protection = unary_union(exclusions) if exclusions else None
                        _need(conversion.is_valid and not conversion.is_empty,
                              "SOURCE_DISTURBANCE_GEOMETRY", "Selected polygon union is invalid")
                        if protection is not None:
                            _need(protection.is_valid, "SOURCE_DISTURBANCE_GEOMETRY", "Protection polygon union is invalid")
                        selected_name = stem + "-selected.gpkg"
                        rasters.write_geometry(staged / selected_name, conversion, CRS.from_user_input(selected["grid_crs"]),
                                               layer="selected_polygons", title=patch["label"])
                        files[selected_name] = describe_file(staged, staged / selected_name)
                        if protection is not None:
                            name = stem + "-protection.gpkg"
                            rasters.write_geometry(staged / name, protection, CRS.from_user_input(selected["grid_crs"]),
                                                   layer="protection_polygons", title=patch["label"] + " protection")
                            files[name] = describe_file(staged, staged / name)
                        counts = {key: 0 for key in ("selected_mask_cells", "selected_valid_cells", "selected_nodata_cells",
                                  "excluded_mask_cells", "excluded_valid_cells", "excluded_baseline_eligible_cells",
                                  "effective_mask_cells", "effective_valid_cells")}
                        effective_name, excluded_name = stem + "-effective.tif", stem + "-excluded.tif"
                        with rasterio.open(staged / effective_name, "w", **profile) as effective_out, \
                                rasterio.open(staged / excluded_name, "w", **profile) as excluded_out:
                            for row in range(0, src.height, 512):
                                for col in range(0, src.width, 512):
                                    window = Window(col, row, min(512, src.width-col), min(512, src.height-row))
                                    transform = src.window_transform(window)
                                    size = (int(window.height), int(window.width))
                                    selected_cells = rasterize([(mapping(conversion), 1)], out_shape=size,
                                        transform=transform, fill=0, dtype="uint8", all_touched=False).astype(bool)
                                    protected_cells = (rasterize([(mapping(protection), 1)], out_shape=size,
                                        transform=transform, fill=0, dtype="uint8", all_touched=False).astype(bool)
                                        if protection is not None and not protection.is_empty else np.zeros(size, dtype=bool))
                                    excluded = selected_cells & protected_cells
                                    effective = selected_cells & ~protected_cells
                                    original = src.read(1, window=window, masked=True)
                                    valid = ~np.ma.getmaskarray(original)
                                    values = np.ma.getdata(original)
                                    counts["selected_mask_cells"] += int(selected_cells.sum())
                                    counts["selected_valid_cells"] += int((selected_cells & valid).sum())
                                    counts["selected_nodata_cells"] += int((selected_cells & ~valid).sum())
                                    counts["excluded_mask_cells"] += int(excluded.sum())
                                    counts["excluded_valid_cells"] += int((excluded & valid).sum())
                                    counts["excluded_baseline_eligible_cells"] += int((excluded & valid & np.isin(values, patch["from_codes"])).sum())
                                    counts["effective_mask_cells"] += int(effective.sum())
                                    counts["effective_valid_cells"] += int((effective & valid).sum())
                                    effective_out.write(effective.astype("uint8"), 1, window=window)
                                    excluded_out.write(excluded.astype("uint8"), 1, window=window)
                            for out in (effective_out, excluded_out):
                                out.update_tags(rule=MEANING["mask"], study_id=study_id, case_id=case["id"], patch_id=patch["id"])
                        for name in (effective_name, excluded_name):
                            files[name] = describe_file(staged, staged / name)
                        png = stem + "-effective.png"
                        preview = _preview_png(staged / effective_name, staged / png)
                        files[png] = describe_file(staged, staged / png)
                        source_id = "source-disturbance-" + stem
                        entries.append({"id": source_id, "path": effective_name, "sha256": files[effective_name]["sha256"],
                            "kind": "raster", "title": patch["label"] + " explicit native mask",
                            "uri": "urn:upstate:source-disturbance:" + study_id + ":" + stem,
                            "vintage": selected["entry"]["vintage"],
                            "lineage": {"study_id": study_id, "case_id": case["id"], "patch_id": patch["id"],
                                        "original_selection": patch["source"], "protections": patch["protections"],
                                        "grid_id": grid["id"], "pixel_rule": MEANING["mask"],
                                        "original_features_sha256": selected["original_features_sha256"]}})
                        native_patches.append({"mask_source_id": source_id, "from_codes": patch["from_codes"],
                                               "to_code": patch["to_code"], "reason": patch["reason"]})
                        patch_rows.append({"patch_id": patch["id"], "label": patch["label"], "policy": patch["policy"], "mask_stem": stem,
                            "selected_polygon_hectares": float(conversion.area / 10000),
                            "protection_polygon_hectares": float(protection.area / 10000) if protection is not None else 0.0,
                            "selected_protection_overlap_polygon_hectares":
                                float(conversion.intersection(protection).area / 10000) if protection is not None else 0.0,
                            **counts, "grid_cell_hectares": plan["pixel_area_ha"], "preview": preview,
                            "effective_file": effective_name, "excluded_file": excluded_name,
                            "count_meaning": "Excluded baseline-eligible cells use ORIGINAL baseline classes; ordered actual eligibility is in the native footprint."})
                    cases.append({"case_id": case["id"], "label": case["label"],
                                  "patches": patch_rows, "native_patches": native_patches})
            atomic_json(staged / "original-selected-features.json", plan["sources"], immutable=True)
            files["original-selected-features.json"] = describe_file(staged, staged / "original-selected-features.json")
            atomic_json(staged / "sources.json", {"schema": "upstate.sources/v1",
                "title": plan["selection"]["title"] + " explicit source masks", "entries": entries,
                "scope": {"study_id": study_id, "grid_id": grid["id"], "semantics": MEANING}}, immutable=True)
            files["sources.json"] = describe_file(staged, staged / "sources.json")
            result = {"schema": "upstate.source-disturbance-masks/v1", "study_id": study_id,
                      "cases": cases, "files": files}
            atomic_json(staged / "masks.json", result, immutable=True)
            with held(self.root / ".workspace.lock"):
                os.replace(staged, directory)
            return result
        finally:
            if staged.exists():
                shutil.rmtree(staged)

    def _operation_path(self, operation_id):
        _text(operation_id, "the original operation ID", 200)
        return self.operations / digest(operation_id) / "intent.json"

    def _origin(self, context, operation_id, action, request):
        if context is None:
            return None
        value = _clone(context)
        required = {"task_id", "operation_id", "workspace", "action", "payload", "request_sha256"}
        _need(isinstance(value, dict) and required <= set(value),
              "SOURCE_DISTURBANCE_CONTEXT", "Retain the complete original operator task context")
        _need(value["task_id"] == operation_id and value["action"] == action
              and digest(value["payload"]) == digest(request),
              "SOURCE_DISTURBANCE_CONTEXT", "Original task differs from the complete saved request")
        _text(value["operation_id"], "the original operator UUID", 100)
        _text(value["workspace"], "the original workspace key", 10000)
        _need(digest({key: value[key] for key in ("workspace", "action", "payload")}) == value["request_sha256"]
              and value.get("project_id", self.workspace.project["id"]) == self.workspace.project["id"],
              "SOURCE_DISTURBANCE_CONTEXT", "Original request or project identity differs")
        value["project_id"] = self.workspace.project["id"]
        return value

    def _read_operation(self, operation_id):
        path = self._operation_path(operation_id)
        if not path.exists():
            return None
        record = read_json(path)
        _need(record.get("schema") == "upstate.source-disturbance-operation/v1"
              and record.get("project_id") == self.workspace.project["id"]
              and record.get("operation_id") == operation_id
              and record.get("request_sha256") == digest(record["request"])
              and record.get("action") in ("source-disturbance.prepare", "source-disturbance.report"),
              "SOURCE_DISTURBANCE_OPERATION", "Original operation identity changed")
        self._origin(record.get("origin"), operation_id, record["action"], record["request"])
        plan = self._read_plan(record["study_id"])
        expected = selection(record["request"]) if record["action"] == "source-disturbance.prepare" else {"study_id": record["study_id"]}
        _need(canonical(expected) == canonical(plan["selection"] if record["action"] == "source-disturbance.prepare" else record["request"]),
              "SOURCE_DISTURBANCE_OPERATION", "Original operation no longer selects its frozen study")
        return record

    def _match_operation(self, record, action, request, context):
        origin = self._origin(context, record["operation_id"], action, request)
        _need(record["action"] == action and record["request_sha256"] == digest(request)
              and (context is None or canonical(origin) == canonical(record.get("origin"))),
              "SOURCE_DISTURBANCE_OPERATION_CONFLICT", "Resume the exact original request, action and context")

    def _ensure_operation(self, action, request, operation_id, context, study_id):
        if operation_id is None:
            _need(context is None, "SOURCE_DISTURBANCE_CONTEXT", "An original context requires its operation ID")
            return None
        path = self._operation_path(operation_id)
        with held(self.root / ".workspace.lock"):
            record = self._read_operation(operation_id)
            if record:
                self._match_operation(record, action, request, context)
                return record
            record = {"schema": "upstate.source-disturbance-operation/v1",
                      "project_id": self.workspace.project["id"], "operation_id": operation_id,
                      "action": action, "request": _clone(request), "request_sha256": digest(request),
                      "origin": self._origin(context, operation_id, action, request),
                      "study_id": study_id, "created_at": now()}
            atomic_json(path, record, immutable=True)
            return record

    def _receipt_path(self, record):
        name = "preparation-receipt.json" if record["action"] == "source-disturbance.prepare" else "report/report.json"
        return self.directory / record["study_id"] / name

    def _verify_receipt(self, record, result):
        plan = self._read_plan(record["study_id"])
        self._validate_original(plan)
        _need(result.get("project_id") == self.workspace.project["id"]
              and result.get("study_id", result.get("id")) == record["study_id"]
              and canonical(result) == canonical(read_json(self._receipt_path(record))),
              "SOURCE_DISTURBANCE_RECEIPT", "Original operation result lost its exact first generation")
        if record["action"] == "source-disturbance.prepare":
            self._verify_prepared(record["study_id"], result)
        else:
            self._verify_report(record["study_id"], result)
        return result

    def _complete_operation(self, record, result):
        if record is None:
            return result
        self._verify_receipt(record, result)
        with held(self.root / ".workspace.lock"):
            atomic_json(self._operation_path(record["operation_id"]).parent / "result.json", result, immutable=True)
        return result

    def operation(self, operation_id):
        record = self._read_operation(operation_id)
        if record is None:
            return self._base(operation_id=operation_id, status="NOT_FOUND", action=None, request=None, origin=None, result=None)
        output = self._operation_path(operation_id).parent / "result.json"
        receipt = output if output.exists() else self._receipt_path(record)
        result = self._verify_receipt(record, read_json(receipt)) if receipt.exists() else None
        return self._base(operation_id=operation_id, status="COMPLETE" if result is not None else "PENDING",
                          action=record["action"], request=record["request"], origin=record.get("origin"),
                          study_id=record["study_id"], result=result)

    @verified_operation
    def preview(self, supplied):
        """Prepare exact retained input footprints; never invoke a native model."""
        plan = self._plan(supplied)
        study_id = digest(plan)
        self._publish_plan(study_id, plan)
        result = self._prepare_retained(study_id)
        return {**result, "side_effects": "Retains source masks, original scenarios, prepared runs and exact categorical footprints. No native solver runs."}

    @verified_operation
    def prepare(self, supplied, *, operation_id=None, context=None):
        original = _clone(supplied)
        previous = self._read_operation(operation_id) if operation_id is not None else None
        if previous:
            self._match_operation(previous, "source-disturbance.prepare", original, context)
            retained = self.operation(operation_id)
            if retained["result"] is not None:
                return retained["result"]
            return self._complete_operation(previous, self._prepare_retained(previous["study_id"]))
        plan = self._plan(original)
        study_id = digest(plan)
        self._publish_plan(study_id, plan)
        record = self._ensure_operation("source-disturbance.prepare", original, operation_id, context, study_id)
        return self._complete_operation(record, self._prepare_retained(record["study_id"] if record else study_id))

    def _verify_prepared(self, study_id, result):
        from .scenario_footprint import get_footprint
        plan = self._read_plan(study_id)
        _need(canonical(result["plan"]) == canonical(plan), "SOURCE_DISTURBANCE_RECEIPT", "Preparation plan changed")
        base = self.directory / study_id
        verify_file(base, result["mask_manifest"])
        masks = read_json(base / "masks/masks.json")
        for descriptor in masks["files"].values():
            verify_file(base / "masks", descriptor)
        _need(canonical(result["files"]) == canonical({name: {**d, "path": "masks/" + d["path"]}
              for name, d in masks["files"].items()}), "SOURCE_DISTURBANCE_RECEIPT", "Original mask inventory changed")
        expected = [(case["id"], baseline["run"]["id"]) for case in plan["selection"]["cases"] for baseline in plan["baselines"]]
        _need([(case["case_id"], case["baseline_run_id"]) for case in result["cases"]] == expected,
              "SOURCE_DISTURBANCE_RECEIPT", "Original prepared case roster changed")
        collection = self.workspace._get("sources", result["source_collection_id"])
        sources_manifest = masks["files"]["sources.json"]
        _need(collection["original_manifest"]["sha256"] == sources_manifest["sha256"]
              and collection["original_manifest"]["bytes"] == sources_manifest["bytes"],
              "SOURCE_DISTURBANCE_RECEIPT", "Original derived source manifest changed")
        case_definitions = {case["id"]: case for case in plan["selection"]["cases"]}
        baselines = {row["run"]["id"]: row for row in plan["baselines"]}
        mask_cases = {row["case_id"]: row for row in masks["cases"]}
        source_entries = {entry["id"]: entry for entry in collection["entries"]}
        expected_footprints = []
        for original_case in plan["selection"]["cases"]:
            retained_masks = mask_cases[original_case["id"]]
            expected_patches = []
            for patch, masked in zip(original_case["patches"], retained_masks["patches"]):
                stem = digest({"case_id": original_case["id"], "patch_id": patch["id"]})
                _need(masked["patch_id"] == patch["id"] and masked["mask_stem"] == stem,
                      "SOURCE_DISTURBANCE_RECEIPT", "Original source mask patch order changed")
                source_id = "source-disturbance-" + stem
                entry = source_entries[source_id]
                descriptor = masks["files"][stem + "-effective.tif"]
                _need(entry["body"]["sha256"] == descriptor["sha256"] and entry["body"]["bytes"] == descriptor["bytes"],
                      "SOURCE_DISTURBANCE_RECEIPT", "Original binary source mask changed")
                expected_patches.append({"mask_source_id": source_id, "from_codes": patch["from_codes"],
                                         "to_code": patch["to_code"], "reason": patch["reason"]})
            _need(len(retained_masks["patches"]) == len(original_case["patches"])
                  and canonical(retained_masks["native_patches"]) == canonical(expected_patches),
                  "SOURCE_DISTURBANCE_RECEIPT", "Original native ordered patches changed")
            scenario_value = {"schema": "upstate.scenarios/v1",
                "title": plan["selection"]["title"] + " / " + original_case["label"], "reason": original_case["reason"],
                "kind": "landcover", "source_collection_id": collection["id"],
                "source_disturbance_study_id": study_id, "source_disturbance_case_id": original_case["id"],
                "patches": expected_patches, "source_policy": plan["semantics"]}
            scenario_id = digest(scenario_value)
            _need(canonical(self.workspace._get("scenarios", scenario_id)) == canonical({**scenario_value, "id": scenario_id}),
                  "SOURCE_DISTURBANCE_RECEIPT", "Original derived scenario changed")
            native = []
            for case in [row for row in result["cases"] if row["case_id"] == original_case["id"]]:
                baseline = baselines[case["baseline_run_id"]]["run"]
                expected_selection, _ = normalize_selection({"schema": "upstate.run-selection/v1",
                    "grid_id": plan["grid"]["id"], "profile_id": baseline["selection"]["profile_id"],
                    "scenario_id": scenario_id, "invest_version": baseline["selection"]["invest_version"]},
                    default=list(run_models(baseline)))
                run = self.workspace.inspect_run(case["run_id"])
                _need(canonical(run["selection"]) == canonical(expected_selection)
                      and canonical(case["run_selection"]) == canonical(expected_selection)
                      and case["grid_id"] == plan["grid"]["id"] and case["scenario_id"] == scenario_id
                      and case["profile_id"] == expected_selection["profile_id"] and case["label"] == original_case["label"],
                      "SOURCE_DISTURBANCE_RECEIPT", "Original prepared native run selection changed")
                footprint = get_footprint(self.workspace, case["footprint_id"])
                _need(footprint["run_id"] == run["id"], "SOURCE_DISTURBANCE_RECEIPT", "Native input footprint selects another run")
                native.append({"baseline_run_id": baseline["id"], "profile_id": case["profile_id"], "run_id": run["id"],
                    "footprint_id": footprint["id"], "report": read_json(verify_file(self.root, footprint["files"]["report"]))})
            expected_footprints.append({"case_id": original_case["id"], "label": original_case["label"],
                                        "patches": retained_masks["patches"], "native": native})
        _need(canonical(result["footprints"]) == canonical(expected_footprints),
              "SOURCE_DISTURBANCE_RECEIPT", "Original preview no longer matches its full native footprint")
        return result

    def _prepare_retained(self, study_id):
        from .scenario_footprint import preview_run
        base = self.directory / study_id
        with held(self.directory / (study_id + ".lock")):
            plan = self._read_plan(study_id)
            self._validate_original(plan)
            receipt = base / "preparation-receipt.json"
            if receipt.exists():
                return self._verify_prepared(study_id, read_json(receipt))
            for name, expected in plan["implementation"]["files"].items():
                raw = Path(__file__).with_name(name).read_bytes()
                _need(len(raw) == expected["bytes"] and hashlib.sha256(raw).hexdigest() == expected["sha256"],
                      "SOURCE_DISTURBANCE_CODE", "Resume unfinished preparation with its original retained implementation: " + name)
            masks = self._masks(study_id, plan)
            collection = self.workspace.import_sources(base / "masks/sources.json")
            rows, footprints = [], []
            masks_by_id = {row["case_id"]: row for row in masks["cases"]}
            for case in plan["selection"]["cases"]:
                prepared_masks = masks_by_id[case["id"]]
                scenario = self.workspace.save_scenario({
                    "title": plan["selection"]["title"] + " / " + case["label"], "reason": case["reason"],
                    "kind": "landcover", "source_collection_id": collection["id"],
                    "source_disturbance_study_id": study_id, "source_disturbance_case_id": case["id"],
                    "patches": prepared_masks["native_patches"], "source_policy": MEANING})
                case_footprints = []
                for baseline in plan["baselines"]:
                    original = baseline["run"]
                    run = self.workspace.prepare_run({"grid_id": plan["grid"]["id"],
                        "profile_id": original["selection"]["profile_id"], "scenario_id": scenario["id"],
                        "models": list(run_models(original))})
                    footprint = preview_run(self.workspace, run["id"])
                    report = read_json(verify_file(self.root, footprint["files"]["report"]))
                    row = {"id": case["id"] + "-" + original["id"], "case_id": case["id"], "label": case["label"],
                        "baseline_run_id": original["id"], "profile_id": original["selection"]["profile_id"],
                        "grid_id": plan["grid"]["id"], "scenario_id": scenario["id"], "run_id": run["id"],
                        "run_selection": _clone(run["selection"]), "state": run["state"],
                        "footprint_id": footprint["id"]}
                    rows.append(row)
                    case_footprints.append({"baseline_run_id": original["id"], "profile_id": row["profile_id"],
                                           "run_id": run["id"], "footprint_id": footprint["id"], "report": report})
                footprints.append({"case_id": case["id"], "label": case["label"],
                                   "patches": prepared_masks["patches"], "native": case_footprints})
            result = self._base(id=study_id, study_id=study_id, title=plan["selection"]["title"],
                state="prepared", plan=plan, source_collection_id=collection["id"],
                cases=rows, footprints=footprints, prepared_at=now(),
                mask_manifest=describe_file(base, base / "masks/masks.json"),
                files={name: {**descriptor, "path": "masks/" + descriptor["path"]}
                       for name, descriptor in masks["files"].items()})
            with held(self.root / ".workspace.lock"):
                atomic_json(receipt, result, immutable=True)
            return self._verify_prepared(study_id, result)

    @verified_operation
    def inspect(self, study_id):
        plan = self._read_plan(study_id)
        self._validate_original(plan)
        path = self.directory / study_id / "preparation-receipt.json"
        if not path.exists():
            return self._base(id=study_id, study_id=study_id, title=plan["selection"]["title"],
                              state="preparing", plan=plan, cases=[], footprints=[])
        saved = self._verify_prepared(study_id, read_json(path))
        cases = [{**case, "state": self.workspace.inspect_run(case["run_id"])["state"]} for case in saved["cases"]]
        report_path = self.directory / study_id / "report/report.json"
        report = read_json(report_path) if report_path.exists() else None
        if report is not None:
            self._verify_report(study_id, report)
        return {**saved, "cases": cases, "report": report,
                "state": "complete" if report is not None else "native_complete" if all(x["state"] == "complete" for x in cases) else "prepared"}

    def _verify_report(self, study_id, report):
        plan = self._read_plan(study_id)
        directory = self.directory / study_id / "report"
        _need(report.get("schema") == "upstate.source-disturbance-report/v1"
              and report.get("project_id") == self.workspace.project["id"] and report.get("study_id") == study_id
              and canonical(report.get("selection")) == canonical(plan["selection"])
              and canonical(report.get("grid")) == canonical(plan["grid"]),
              "SOURCE_DISTURBANCE_REPORT", "Original report context changed")
        for descriptor in report["files"].values():
            verify_file(directory, descriptor)
        body = read_json(verify_file(directory, report["files"]["result.json"]))
        expected = {key: value for key, value in report.items() if key not in ("files", "result_sha256")}
        expected["schema"] = SCHEMA
        _need(report["result_sha256"] == report["files"]["result.json"]["sha256"]
              and canonical(body) == canonical(expected),
              "SOURCE_DISTURBANCE_REPORT", "Readable report result differs from its original complete generation")
        for run_id, original in report["native_records"].items():
            current = self.workspace.inspect_run(run_id)
            _need(canonical(current) == canonical(original), "SOURCE_DISTURBANCE_NATIVE_CHANGED",
                  "Original completed native record changed")
        return report

    def result(self, study_id):
        value = self.inspect(study_id)
        return value["report"] if value.get("report") else self._base(
            study_id=study_id, state="awaiting_native", cases=value["cases"])

    @verified_operation
    def report(self, study_id, *, operation_id=None, context=None):
        study_id = identifier(study_id)
        request = {"study_id": study_id}
        previous = self._read_operation(operation_id) if operation_id is not None else None
        if previous:
            self._match_operation(previous, "source-disturbance.report", request, context)
            retained = self.operation(operation_id)
            if retained["result"] is not None:
                return retained["result"]
        record = self._ensure_operation("source-disturbance.report", request, operation_id, context, study_id)
        with held(self.directory / (study_id + ".lock")):
            study = self.inspect(study_id)
            path = self.directory / study_id / "report/report.json"
            if path.exists():
                result = read_json(path)
            else:
                _need(study["cases"] and all(row["state"] == "complete" for row in study["cases"]),
                      "SOURCE_DISTURBANCE_NATIVE_PENDING", "Finish the original prepared runs through the existing native queue")
                result = self._build_report(study)
        return self._complete_operation(record, result)

    def _build_report(self, study):
        from .scenario_footprint import get_footprint
        base = self.directory / study["id"]
        directory = base / "report"
        _need(not directory.exists(), "SOURCE_DISTURBANCE_REPORT", "Report publication contains an incomplete foreign directory")
        staging = self.root / "source-views" / "source-disturbance-staging"
        staging.mkdir(parents=True, exist_ok=True)
        staged = Path(tempfile.mkdtemp(prefix=study["id"] + "-report-", dir=staging))
        try:
            files, comparisons, measurements, run_records = {}, [], [], {}
            def retain(source_root, descriptor, name):
                source = verify_file(source_root, descriptor)
                if name in files:
                    prior = files[name]
                    _need(prior["sha256"] == descriptor["sha256"] and prior["bytes"] == descriptor["bytes"],
                          "SOURCE_DISTURBANCE_FILE", "Distinct original members collide in the report")
                    verify_file(staged, prior)
                    return prior
                target = staged / name
                target.parent.mkdir(parents=True, exist_ok=True)
                with source.open("rb") as incoming, target.open("xb") as outgoing:
                    shutil.copyfileobj(incoming, outgoing, 1024 * 1024)
                    outgoing.flush()
                    os.fsync(outgoing.fileno())
                received = describe_file(staged, target)
                _need(received["sha256"] == descriptor["sha256"] and received["bytes"] == descriptor["bytes"],
                      "SOURCE_DISTURBANCE_FILE", "Original member changed during report receiving")
                verify_file(source_root, descriptor)
                files[name] = received
                return received
            def document(name, value):
                atomic_json(staged / name, value, immutable=True)
                files[name] = describe_file(staged, staged / name)
            for baseline in study["plan"]["baselines"]:
                original = baseline["run"]
                cases = [row for row in study["cases"] if row["baseline_run_id"] == original["id"]]
                comparison = self.workspace.compare_runs([original["id"], *[row["run_id"] for row in cases]])
                comparisons.append({"baseline_run_id": original["id"], "comparison_id": comparison["id"], "comparison": comparison})
                by_run = {row["run_id"]: row for row in cases}
                for alternative in comparison["alternatives"]:
                    row = by_run[alternative["run_id"]]
                    _need(not alternative["profile_changed"], "SOURCE_DISTURBANCE_PROFILE", "Source-selected scenario unexpectedly changed coefficients")
                    for name, descriptor in alternative["artifacts"].items():
                        retain(self.root / "comparisons" / comparison["id"], descriptor,
                               "differences/" + row["run_id"] + "/" + name + ".tif")
                        measurements.append({"case_id": row["case_id"], "label": row["label"],
                            "baseline_run_id": original["id"], "run_id": row["run_id"],
                            "profile_id": row["profile_id"], "profile_changed": False,
                            "artifact": name, "units": descriptor["units"], "direction": comparison["direction"],
                            "sum_change": descriptor["sum_change"], "valid_cells": descriptor["valid_cells"],
                            "valid_hectares": descriptor["valid_cells"] * study["plan"]["pixel_area_ha"]})
                for run_id in [original["id"], *[row["run_id"] for row in cases]]:
                    run = self.workspace.inspect_run(run_id)
                    if run_id in run_records:
                        continue
                    run_records[run_id] = run
                    document("native/" + run_id + "/run.json", run)
                    for name in comparison["common_artifacts"]:
                        retain(self.root / "runs" / run_id, run["artifacts"][name],
                               "native/" + run_id + "/" + name + ".tif")
                profile = baseline["profile"]
                table, entry = self.workspace.source_file(profile["source_collection_id"], profile["biophysical_source_id"])
                retain(self.root, entry["body"], "coefficients/" + profile["id"] + "/original/" + entry["body"]["filename"])
                document("coefficients/" + profile["id"] + "/profile.json", profile)
            masks = read_json(base / "masks/masks.json")
            for name, descriptor in masks["files"].items():
                retain(base / "masks", descriptor, "masks/" + name)
            # Preserve full original source files and their native relative relationships.
            source_inventory = {}
            for source in study["plan"]["sources"].values():
                ref, entry = source["selection"], source["entry"]
                source_key = digest({"collection": ref["source_collection_id"], "source_id": ref["source_id"]})
                if source_key in source_inventory:
                    continue
                originals = []
                for part in [entry["body"], *entry.get("companions", [])]:
                    member = part.get("view_path", part["filename"])
                    _need(not Path(member).is_absolute() and ".." not in Path(member).parts and "\\" not in member,
                          "SOURCE_DISTURBANCE_FILE", "Retained native source member has an unsafe name")
                    originals.append(retain(self.root, part, "original-sources/" + source_key + "/" + member))
                source_inventory[source_key] = {"selection": ref, "entry": entry, "files": originals}
            footprint_records = {}
            for case in study["cases"]:
                footprint = get_footprint(self.workspace, case["footprint_id"])
                footprint_records[case["run_id"]] = footprint
                for name, descriptor in footprint["files"].items():
                    retain(self.root, descriptor, "footprints/" + case["run_id"] + "/" + Path(descriptor["path"]).name)
            result = self._base(study_id=study["id"], state="complete", title=study["title"],
                selection=study["plan"]["selection"], grid=study["plan"]["grid"],
                cases=study["cases"], footprints=study["footprints"], comparisons=comparisons,
                measurement_rows=measurements, original_sources=source_inventory,
                native_records=run_records, footprint_records=footprint_records,
                semantics=MEANING, completed_at=now())
            document("result.json", result)
            document("plan.json", study["plan"])
            document("preparation-receipt.json", read_json(base / "preparation-receipt.json"))
            fields = ("case_id", "label", "baseline_run_id", "run_id", "profile_id", "artifact", "units",
                      "direction", "sum_change", "valid_cells", "valid_hectares")
            data = io.StringIO(newline="")
            writer = csv.DictWriter(data, fieldnames=fields, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(measurements)
            atomic_bytes(staged / "annual-export-differences.csv", data.getvalue().encode("utf-8"), immutable=True)
            files["annual-export-differences.csv"] = describe_file(staged, staged / "annual-export-differences.csv")
            patch_rows = [{"case_id": case["case_id"], "case_label": case["label"], **patch}
                          for case in study["footprints"] for patch in case["patches"]]
            fields = ("case_id", "case_label", "patch_id", "label", "policy", "selected_polygon_hectares",
                      "protection_polygon_hectares", "selected_protection_overlap_polygon_hectares",
                      "selected_mask_cells", "selected_valid_cells", "selected_nodata_cells", "excluded_mask_cells",
                      "excluded_valid_cells", "excluded_baseline_eligible_cells", "effective_mask_cells",
                      "effective_valid_cells", "grid_cell_hectares")
            data = io.StringIO(newline="")
            writer = csv.DictWriter(data, fieldnames=fields, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(patch_rows)
            atomic_bytes(staged / "source-mask-areas.csv", data.getvalue().encode("utf-8"), immutable=True)
            files["source-mask-areas.csv"] = describe_file(staged, staged / "source-mask-areas.csv")
            from .source_disturbance_report import render_html
            atomic_bytes(staged / "report.html", render_html(result).encode("utf-8"), immutable=True)
            files["report.html"] = describe_file(staged, staged / "report.html")
            inventory = {"schema": "upstate.source-disturbance-report-members/v1",
                         "project_id": self.workspace.project["id"], "study_id": study["id"],
                         "files": _clone(files), "meaning": MEANING}
            document("manifest.json", inventory)
            archive = staged / "source-disturbance-report.zip"
            with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as output:
                for name in sorted(files):
                    output.write(verify_file(staged, files[name]), arcname=name)
            files["source-disturbance-report.zip"] = describe_file(staged, archive)
            receipt = {**result, "schema": "upstate.source-disturbance-report/v1",
                       "result_sha256": files["result.json"]["sha256"], "files": files}
            atomic_json(staged / "report.json", receipt, immutable=True)
            self._validate_original(study["plan"])
            for run_id, original in run_records.items():
                _need(canonical(self.workspace.inspect_run(run_id)) == canonical(original),
                      "SOURCE_DISTURBANCE_NATIVE_CHANGED", "Completed original native result changed during reporting")
            with held(self.root / ".workspace.lock"):
                os.replace(staged, directory)
            return receipt
        finally:
            if staged.exists():
                shutil.rmtree(staged)


def verify_all(workspace):
    service = SourceDisturbanceStudies(workspace)
    studies = []
    for path in sorted(service.directory.glob("*/plan.json")):
        studies.append(service.inspect(path.parent.name))
    count = 0
    for path in sorted(service.operations.glob("*/intent.json")):
        record = read_json(path)
        _need(path.parent.name == digest(record["operation_id"]), "SOURCE_DISTURBANCE_OPERATION", "Original operation directory changed")
        service.operation(record["operation_id"])
        count += 1
    return {"schema": SCHEMA, "project_id": workspace.project["id"],
            "studies": len(studies), "operations": count,
            "completed": sum(row["state"] == "complete" for row in studies)}


verify_workspace = verify_all
