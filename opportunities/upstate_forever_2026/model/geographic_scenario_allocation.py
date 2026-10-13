"""Measure actual local land-cover allocation beside retained native utility results.

Reads the three completed original scenario footprints and Receiving masks in
one bounded-window pass. It does not prepare scenarios or run NDR/SDR.
"""
from __future__ import annotations
from contextlib import ExitStack
from copy import deepcopy
import csv
import math
import os
from pathlib import Path
import tempfile

from .common import (atomic_json, describe_file, digest, file_digest, held,
                     identifier, now, read_json, verify_file)
from . import rasters, receiving_waters as waters, scenario_footprint
from . import geographic_scenario_allocation_report as rendering

SCHEMA = "upstate.geographic-scenario-allocation/v1"
FOLDER = "geographic-scenario-allocations"
ROLES = ("baseline", "restoration", "control")
ALTERNATIVES = ROLES[1:]
NOTES = [
    "Allocation uses the actual final categorical raster for each retained native scenario, not a reconstruction of its planting mask.",
    "The primary allocation support is the intersection of finite categorical cells in all three original scenarios inside the selected original mask.",
    "Control matching applies to the whole reporting selection. Equal global class counts do not imply equal treatment or class mix within a HUC or utility footprint.",
    "HUC polygons, upstream HUC contribution areas, published protection areas and their family unions are separately named. Overlapping rows must not be summed.",
    "Each RFP utility upstream union uses the Boolean OR of its original anchor contribution masks. Overlapping selected pixels count once; its display geometry is the union of the original contribution shapes clipped to the quantity scope.",
    "Native support diagnostics intersect the primary categorical support with finite original annual-output cells in all three runs, separately for each quantity and scope.",
    "The accompanying native quantities are the original Receiving baseline-versus-each-alternative pairwise results. Their supports can differ; subtracting their totals does not establish a three-way matched-control effect.",
    "Land-cover hectares are not pollutant reductions. Annual native nitrogen and phosphorus retain kg/year and sediment retains metric tonnes/year delivered to streams.",
]

def _csv(path, fields, rows):
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)

def _empty():
    return {"selected_cells": 0, "common_valid_cells": 0,
            "valid_cells": dict.fromkeys(ROLES, 0),
            "counts": {role: {} for role in ALTERNATIVES},
            "native_support": {}}

def _accumulate(value, arrays, valid, inside, native_masks):
    import numpy as np
    value["selected_cells"] += int(np.count_nonzero(inside))
    for role in ROLES:
        value["valid_cells"][role] += int(np.count_nonzero(inside & valid[role]))
    common = inside & np.logical_and.reduce([valid[role] for role in ROLES])
    value["common_valid_cells"] += int(np.count_nonzero(common))
    for role in ALTERNATIVES:
        scenario_footprint._transition_counts(
            arrays["baseline"], arrays[role], common, value["counts"][role])
    for pollutant, masks in native_masks.items():
        item = value["native_support"].setdefault(pollutant, {
            "native_common_cells": 0, "landcover_and_native_common_cells": 0,
            "valid_cells": dict.fromkeys(ROLES, 0),
            "restoration_changed_cells": 0, "control_changed_cells": 0})
        native = inside & np.logical_and.reduce([masks[role] for role in ROLES])
        matched = native & common
        item["native_common_cells"] += int(np.count_nonzero(native))
        item["landcover_and_native_common_cells"] += int(np.count_nonzero(matched))
        for role in ROLES:
            item["valid_cells"][role] += int(np.count_nonzero(inside & masks[role]))
        for role in ALTERNATIVES:
            item[role + "_changed_cells"] += int(np.count_nonzero(
                matched & (arrays[role] != arrays["baseline"])))

def _finish(value, run_ids, area):
    alternatives, origins = {}, {}
    for role in ALTERNATIVES:
        transitions = scenario_footprint._transitions(value["counts"][role], area)
        changed = sum(row["cells"] for row in transitions if row["from_code"] != row["to_code"])
        alternatives[role] = {
            "run_id": run_ids[role], "changed_cells": changed,
            "changed_hectares": changed * area,
            "unchanged_cells": value["common_valid_cells"] - changed,
            "transitions": transitions,
        }
        for row in transitions:
            if row["from_code"] != row["to_code"]:
                origins.setdefault(row["from_code"], dict.fromkeys(ALTERNATIVES, 0))[role] += row["cells"]
    # Keep the two explicitly matched agricultural classes visible even where absent.
    for code in (81, 82):
        origins.setdefault(code, dict.fromkeys(ALTERNATIVES, 0))
    by_origin = []
    for code, counts in sorted(origins.items()):
        difference = counts["restoration"] - counts["control"]
        by_origin.append({
            "from_code": code, "restoration_cells": counts["restoration"],
            "control_cells": counts["control"], "difference_cells": difference,
            "restoration_hectares": counts["restoration"] * area,
            "control_hectares": counts["control"] * area,
            "difference_hectares": difference * area})
    difference = alternatives["restoration"]["changed_cells"] - alternatives["control"]["changed_cells"]
    support = deepcopy(value["native_support"])
    for item in support.values():
        item["native_common_hectares"] = item["native_common_cells"] * area
        item["landcover_and_native_common_hectares"] = item["landcover_and_native_common_cells"] * area
        for role in ALTERNATIVES:
            item[role + "_changed_hectares"] = item[role + "_changed_cells"] * area
    return {
        "selected_cells": value["selected_cells"],
        "selected_pixel_area_ha": value["selected_cells"] * area,
        "common_valid_cells": value["common_valid_cells"],
        "common_valid_hectares": value["common_valid_cells"] * area,
        "common_valid_fraction": (value["common_valid_cells"] / value["selected_cells"]
                                  if value["selected_cells"] else None),
        "valid_cells": value["valid_cells"],
        "alternatives": alternatives,
        "balance": {"changed_cells_difference": difference,
                    "changed_hectares_difference": difference * area,
                    "has_common_categorical_support": value["common_valid_cells"] > 0,
                    "equal_local_changed_counts": (difference == 0 if value["common_valid_cells"] else None),
                    "equal_local_original_class_counts": (
                        all(row["difference_cells"] == 0 for row in by_origin)
                        if value["common_valid_cells"] else None),
                    "by_origin": by_origin},
        "native_support": support,
    }

def _prepared(workspace, prepared, context):
    root = workspace.root / "geographic-headwaters" / identifier(prepared["id"])
    original = read_json(root / "prepared.json")
    if (original != prepared or original.get("schema") != "upstate.geographic-headwaters-prepared/v1"
            or original["project_id"] != workspace.project["id"] or original["state"] != "prepared"):
        raise ValueError("Use the exact retained geographic preparation in this project")
    ids = [prepared["baseline_run_id"], *prepared["alternative_run_ids"]]
    scenario_ids = [prepared["baseline_scenario_id"], *prepared["alternative_scenario_ids"]]
    if len(ids) != 3 or len(set(ids)) != 3 or len(scenario_ids) != 3:
        raise ValueError("Retain the original ordered baseline, restoration and control")
    if (context.get("schema") != "upstate.geographic-receiving-context/v1"
            or context["project_id"] != workspace.project["id"]
            or context["prepared_id"] != prepared["id"]
            or context["baseline_run_id"] != ids[0]
            or context["alternative_run_ids"] != ids[1:]):
        raise ValueError("Select the original geographic Receiving context")
    footprint_ids = prepared["scenario_footprint_ids"]
    if len(footprint_ids) != 3:
        raise ValueError("Retain all three compiled native footprints")
    footprints, runs = {}, {}
    for role, run_id, scenario_id, footprint_id in zip(ROLES, ids, scenario_ids, footprint_ids):
        run = workspace.inspect_run(run_id)
        footprint = scenario_footprint.get_footprint(workspace, identifier(footprint_id))
        selection = run["selection"]
        if (run["state"] != "complete" or footprint["run_id"] != run_id
                or footprint["selection"] != selection
                or selection["grid_id"] != prepared["grid_id"]
                or selection["profile_id"] != prepared["profile_id"]
                or selection["scenario_id"] != scenario_id):
            raise ValueError("The original completed run and compiled land-cover selection differ")
        footprints[role], runs[role] = footprint, run
    return root, dict(zip(ROLES, ids)), footprints, runs

def _utility_unions(workspace, context, domains, crs, definitions):
    """Use exact profile identities and OR of retained anchor contribution masks."""
    from shapely.ops import unary_union
    application = Path(__file__).resolve().parents[1]
    profile_path = application / "source/receptor-profiles/utility-focus-20261012.json"
    profile = read_json(profile_path)
    if profile.get("schema") != "upstate.receptor-spec/v1":
        raise ValueError("Retain the original utility-focus receptor profile")
    plan = waters.inspect_plan(workspace, context["plan_ids"]["upstream_huc"], verify=True)
    anchors = {}
    for receptor in plan["receptors"]:
        code = receptor.get("classification", {}).get("original_huc12")
        if code is not None:
            if code in anchors or receptor["relation"]["method"] != "upstream_huc":
                raise ValueError("Retain distinct original upstream HUC anchors")
            anchors[code] = receptor
    indexed = {(row["quantity_scope"], row["subject_id"]): row for row in definitions
               if row["relationship"] == "upstream_huc" and row["kind"] == "receptor"}
    binding = {"file": describe_file(application, profile_path), "profile": deepcopy(profile),
               "plan_id": plan["id"], "plan_record_sha256": plan["record_sha256"], "utilities": []}
    used = set()
    for original in profile["receptors"]:
        utility = original["utility_id"]
        selected = original["anchor_huc12s"]
        if (not utility or utility in used or not selected
                or len(set(selected)) != len(selected)):
            raise ValueError("Retain distinct original utility identities and anchors")
        used.add(utility)
        missing = sorted(set(selected) - set(anchors))
        item = {"utility_id": utility, "receptor_id": original["id"],
                "title": original["title"], "anchor_huc12s": list(selected),
                "reference": deepcopy(original["reference"]),
                "available": not missing, "missing_original_anchor_huc12s": missing}
        binding["utilities"].append(item)
        if missing:
            # A different geographic selection can omit a profile's anchors.
            continue
        receptors = [anchors[code] for code in selected]
        members = sorted({code for receptor in receptors
                          for code in receptor["relation"]["upstream_huc_ids"]})
        if not set(selected).issubset(members):
            raise ValueError("Original upstream membership lost its utility anchors")
        item["upstream_huc12s"] = members
        item["contribution_geometries"] = [
            deepcopy(receptor["contribution_geometry"]) for receptor in receptors]
        geometry = unary_union([
            waters._load_contribution(workspace, plan, receptor, crs) for receptor in receptors])
        for scope, domain in domains.items():
            original_regions = [indexed[(scope, receptor["id"])] for receptor in receptors]
            masks = {row["mask"]["path"]: deepcopy(row["mask"])
                     for row in original_regions if row["mask"] is not None}
            clipped = geometry.intersection(domain)
            definitions.append({
                "id": "utility-" + digest({"utility_id": utility, "profile_receptor_id": original["id"]}) + "-" + scope,
                "title": original["title"], "kind": "utility_upstream_union",
                "relationship": "profile_upstream_huc_union", "quantity_scope": scope,
                "analysis_id": None, "subject_id": None,
                "utility_id": utility, "profile_receptor_id": original["id"],
                "anchor_huc12s": list(selected), "upstream_huc12s": members,
                "profile_reference": deepcopy(original["reference"]),
                "source_plan_id": plan["id"],
                "original_receiving_regions": [row["id"] for row in original_regions],
                "mask_basis": "Boolean OR of exact original anchor contribution masks; each selected pixel is counted once",
                "geometry": clipped, "mask": None, "mask_union": list(masks.values()),
                "vector_geometry_empty_with_selected_cells": bool(
                    clipped.is_empty and any(row["expected_selected_cells"] for row in original_regions)),
                "pairwise_native_quantities": []})
    return binding

def _regions(workspace, prepared, context, grid_record, run_ids):
    from pyproj import CRS
    from shapely.geometry import Polygon
    from . import geographic_headwaters
    grid, domains, definitions = grid_record["grid"], {}, []
    crs = CRS.from_user_input(grid["crs"])
    analyses = {}
    bindings = []
    scopes = tuple(context["identity"]["quantity_scopes"])
    for scope in scopes:
        key = "reporting_area" if scope == "reporting" else "model_domain"
        descriptor = grid_record["files"][key]
        path = verify_file(workspace.root / "grids" / grid_record["id"], descriptor)
        rows, unused = rasters.vector_geometry(path, target_crs=crs)
        domains[scope] = rasters.polygon_union(rows)
        definitions.append({
            "id": "whole-" + scope, "title": "Complete " + scope.replace("_", " ") + " selection",
            "kind": "whole_selection", "relationship": "original_grid_boundary",
            "quantity_scope": scope, "analysis_id": None, "subject_id": None,
            "geometry": domains[scope], "mask": None, "pairwise_native_quantities": []})
        bindings.append({"scope": scope, "grid_geometry": descriptor})
    original_rows, huc_binding = geographic_headwaters._rows(workspace, prepared["selection"]["huc_polygons"])
    if huc_binding != prepared["geography"]["huc_source"]:
        raise ValueError("The original HUC feature selection changed")
    if crs != CRS.from_user_input(geographic_headwaters.CRS):
        raise ValueError("Retain the original geographic projected CRS")
    field = prepared["selection"]["huc_field"]
    expected = set(prepared["geography"]["model_domain_huc12s"])
    selected = {}
    for row in original_rows:
        code = row["properties"].get(field)
        if code in expected:
            if code in selected:
                raise ValueError("Original HUC identity is repeated")
            selected[code] = row
    if set(selected) != expected:
        raise ValueError("Original model-domain HUC polygons are incomplete")
    names = {row["huc12"]: row.get("name", row["huc12"])
             for row in prepared["geography"]["selected_topology_rows"]}
    for scope in scopes:
        for code, row in sorted(selected.items()):
            definitions.append({
                "id": "huc-" + code + "-" + scope,
                "title": names[code] + " — HUC12 " + code,
                "kind": "local_huc", "relationship": "original_huc_polygon",
                "quantity_scope": scope, "analysis_id": None, "subject_id": None,
                "huc12": code, "source_feature": deepcopy(row["properties"]),
                "geometry": row["geometry"].intersection(domains[scope]),
                "mask": None, "pairwise_native_quantities": []})
    for retained in context["analyses"]:
        analysis = waters.inspect(workspace, identifier(retained["analysis_id"]), verify=True)
        scope = retained["quantity_scope"]
        if (analysis["state"] != "complete" or analysis["quantity_scope"] != scope
                or analysis["baseline_run_id"] != run_ids["baseline"]
                or analysis["alternative_run_ids"] != [run_ids[role] for role in ALTERNATIVES]
                or analysis["grid"] != grid
                or analysis["plan_id"] != context["plan_ids"][retained["relationship"]]):
            raise ValueError("Allocation must use the original completed Receiving selection")
        analyses[analysis["id"]] = analysis
        directory = workspace.root / "receiving-water-analyses" / analysis["id"]
        vector = verify_file(directory, analysis["files"]["receiving_waters_gpkg"])
        rows, unused = rasters.vector_geometry(vector, layer="receiving_waters", target_crs=crs)
        geometries = {}
        for row in rows:
            key = row["properties"]["subject_id"]
            if key in geometries:
                raise ValueError("The original Receiving output repeats a subject")
            geometries[key] = row["geometry"]
        bindings.append({"analysis_id": analysis["id"], "record_sha256": analysis["record_sha256"],
                         "relationship": retained["relationship"], "quantity_scope": scope,
                         "geometries": analysis["files"]["receiving_waters_gpkg"],
                         "quantity_sources": analysis["quantity_sources"]})
        for subject in analysis["subjects"]:
            metrics = subject["metrics"]
            mask = metrics["files"].get("contribution_mask")
            if mask is None and metrics["selected_cells"] != 0:
                raise ValueError("A populated Receiving subject lost its actual contribution mask")
            if mask is not None:
                mask = {**mask, "path": str(verify_file(directory, mask).relative_to(workspace.root))}
            geometry = geometries.get(subject["id"], Polygon())
            # Boolean accounting partitions can retain boundary pixels even
            # when their exported vector difference has zero area.
            native_rows = []
            for role in ALTERNATIVES:
                for pollutant, values in metrics["alternatives"][run_ids[role]]["changes"].items():
                    native_rows.append({
                        "scenario": role, "run_id": run_ids[role], "pollutant": pollutant,
                        "units": waters.TOTAL_UNITS[pollutant], "common_cells": values["valid_cells"],
                        "baseline_mass": values["baseline_sum_on_common_cells"],
                        "alternative_mass": values["alternative_sum_on_common_cells"],
                        "signed_change": values["sum"], "direction": values["direction"],
                        "sum_basis": values["sum_basis"]})
            definitions.append({
                "id": retained["relationship"] + ":" + scope + ":" + subject["id"],
                "title": subject["title"], "kind": subject["kind"],
                "relationship": retained["relationship"], "quantity_scope": scope,
                "analysis_id": analysis["id"], "subject_id": subject["id"],
                "geometry": geometry, "mask": mask, "expected_selected_cells": metrics["selected_cells"],
                "vector_geometry_empty_with_selected_cells": bool(geometry.is_empty and metrics["selected_cells"]),
                "pairwise_native_quantities": native_rows})
    utility_profile = _utility_unions(workspace, context, domains, crs, definitions)
    if len({row["id"] for row in definitions}) != len(definitions):
        raise ValueError("Each original allocation region needs a distinct identity")
    return definitions, analyses, {"huc_source": huc_binding, "boundaries_and_analyses": bindings,
                                   "utility_profile": utility_profile}

def _bands(workspace, stack, grid, analyses, runs):
    """Reuse the actual admitted quantity provenance from the completed analyses."""
    result, identities = {}, {}
    for analysis in analyses.values():
        scope = analysis["quantity_scope"]
        binding = analysis["quantity_sources"]
        if scope in identities:
            if binding != identities[scope]:
                raise ValueError("Same-scope utility analyses selected different original quantity sources")
            continue
        identities[scope] = binding
        scoped = {}
        for role, run in runs.items():
            retained = binding[run["id"]]
            for pollutant, provenance in retained.items():
                artifact = run["artifacts"][pollutant]
                original = artifact if scope == "reporting" else artifact["native_output"]
                factor = 1.0 if scope == "reporting" else float(grid["pixel_area_ha"])
                if (provenance["artifact"] != original
                        or provenance["run_id"] != run["id"]
                        or provenance["quantity_scope"] != scope
                        or provenance["multiplier"] != factor
                        or provenance["output_units"] != rasters.MASS_UNITS[pollutant]):
                    raise ValueError("The completed quantity provenance changed its original support or units")
                path = verify_file(workspace.root / "runs" / run["id"], original)
                scoped.setdefault(pollutant, {})[role] = waters._aligned_source(
                    stack, path, grid, factor=factor, provenance=provenance)
        for pollutant, bands in scoped.items():
            if set(bands) != set(ROLES):
                raise ValueError("Native support requires the same quantity in all three runs")
        result[scope] = scoped
    return result

def _raster_grid(source, grid):
    from rasterio.crs import CRS
    from rasterio.transform import Affine
    if (source.width != grid["width"] or source.height != grid["height"]
            or source.transform != Affine(*grid["transform"])
            or source.crs != CRS.from_user_input(grid["crs"])):
        raise ValueError("Use exact original aligned land-cover and contribution-mask grids")

def _compute(workspace, grid, footprints, runs, definitions, analyses, progress):
    import numpy as np
    import rasterio
    from rasterio.windows import Window, bounds
    from shapely.geometry import box
    values = {row["id"]: _empty() for row in definitions}
    with ExitStack() as stack:
        sources = {}
        for role, footprint in footprints.items():
            path = verify_file(workspace.root, footprint["files"]["scenario_lulc"])
            sources[role] = stack.enter_context(rasterio.open(path))
            _raster_grid(sources[role], grid)
        native = _bands(workspace, stack, grid, analyses, runs)
        for row in definitions:
            for pollutant in native[row["quantity_scope"]]:
                values[row["id"]]["native_support"][pollutant] = {
                    "native_common_cells": 0, "landcover_and_native_common_cells": 0,
                    "valid_cells": dict.fromkeys(ROLES, 0),
                    "restoration_changed_cells": 0, "control_changed_cells": 0}
        masks = {}
        for row in definitions:
            selected_masks = row.get("mask_union", [row["mask"]] if row["mask"] is not None else [])
            for descriptor in selected_masks:
                name = descriptor["path"]
                if name not in masks:
                    masks[name] = stack.enter_context(rasterio.open(verify_file(workspace.root, descriptor)))
                    _raster_grid(masks[name], grid)
        from rasterio.transform import Affine
        transform = Affine(*grid["transform"])
        windows = 0
        total = math.ceil(grid["height"] / 256) * math.ceil(grid["width"] / 256)
        for top in range(0, grid["height"], 256):
            for left in range(0, grid["width"], 256):
                window = Window(left, top, min(256, grid["width"] - left), min(256, grid["height"] - top))
                extent = box(*bounds(window, transform))
                # Retained Receiving masks are authoritative, including any
                # boundary pixels of Boolean accounting partitions.
                mask_values = {}
                for name, source in masks.items():
                    data = source.read(1, window=window, masked=True)
                    inside = ~np.ma.getmaskarray(data) & (np.ma.getdata(data) == 1)
                    if np.any(inside):
                        mask_values[name] = inside
                active = [row for row in definitions if (
                    "mask_union" in row and any(item["path"] in mask_values for item in row["mask_union"])) or (
                    row["mask"] is not None and row["mask"]["path"] in mask_values) or (
                    "mask_union" not in row and row["mask"] is None and not row["geometry"].is_empty
                    and row["geometry"].intersects(extent))]
                if not active:
                    continue
                arrays, valid = {}, {}
                for role, source in sources.items():
                    data = source.read(1, window=window, masked=True)
                    raw = np.ma.getdata(data)
                    good = ~np.ma.getmaskarray(data) & np.isfinite(raw)
                    if np.any(good & ((raw != np.floor(raw)) | (raw <= -2147483648) | (raw > 2147483647))):
                        raise ValueError("Original land-cover classes must be exact signed-int32 values")
                    arrays[role], valid[role] = raw, good
                by_scope = {}
                for scope in {row["quantity_scope"] for row in active}:
                    by_scope[scope] = {
                        pollutant: {role: waters._read_quantity(band, window)[1]
                                    for role, band in bands.items()}
                        for pollutant, bands in native[scope].items()}
                for row in active:
                    if "mask_union" in row:
                        inside = np.logical_or.reduce([
                            mask_values[item["path"]] for item in row["mask_union"]
                            if item["path"] in mask_values])
                    elif row["mask"] is not None:
                        inside = mask_values[row["mask"]["path"]]
                    else:
                        inside = waters._inside(grid, row["geometry"], window)
                    if np.any(inside):
                        _accumulate(values[row["id"]], arrays, valid, inside, by_scope[row["quantity_scope"]])
                windows += 1
                if progress and windows % 32 == 0:
                    progress({"stage": "local_scenario_allocation", "completed_active_windows": windows,
                              "rectangular_windows": total, "region_count": len(definitions)})
    result = []
    for row in definitions:
        value = values[row["id"]]
        if ("expected_selected_cells" in row
                and value["selected_cells"] != row["expected_selected_cells"]):
            raise ValueError("Allocation differs from the original Receiving selected cells: " + row["id"])
        item = {key: deepcopy(value) for key, value in row.items()
                if key not in ("geometry", "mask", "expected_selected_cells")}
        item["vector_area_ha"] = row["geometry"].area / 10000.0
        item["geometry_sha256"] = digest(row["geometry"].__geo_interface__)
        item.update(_finish(value, {role: runs[role]["id"] for role in ROLES}, grid["pixel_area_ha"]))
        result.append(item)
    return result

def _export(directory, report, definitions):
    from shapely.geometry import mapping
    regions = report["regions"]
    fields = ("region_id", "title", "kind", "relationship", "quantity_scope",
              "selected_cells", "common_valid_cells", "scenario", "run_id",
              "changed_cells", "changed_hectares", "unchanged_cells")
    summary, transitions, supports, quantities = [], [], [], []
    features = []
    for region, definition in zip(regions, definitions):
        common = {"region_id": region["id"], "title": region["title"], "kind": region["kind"],
                  "relationship": region["relationship"], "quantity_scope": region["quantity_scope"]}
        for role, alternative in region["alternatives"].items():
            summary.append({**common, "selected_cells": region["selected_cells"],
                            "common_valid_cells": region["common_valid_cells"], "scenario": role,
                            **{key: alternative[key] for key in fields if key in alternative}})
            transitions.extend({**common, "scenario": role, **row} for row in alternative["transitions"])
        for pollutant, value in region["native_support"].items():
            supports.append({**common, "pollutant": pollutant, **{key: value[key] for key in (
                "native_common_cells", "landcover_and_native_common_cells",
                "restoration_changed_cells", "control_changed_cells",
                "restoration_changed_hectares", "control_changed_hectares")}})
        quantities.extend({**common, **row} for row in region["pairwise_native_quantities"])
        features.append({"type": "Feature", "geometry": mapping(definition["geometry"]),
            "properties": {"id": region["id"], "title": region["title"], "kind": region["kind"],
                "relationship": region["relationship"], "quantity_scope": region["quantity_scope"],
                "restoration_ha": region["alternatives"]["restoration"]["changed_hectares"],
                "control_ha": region["alternatives"]["control"]["changed_hectares"],
                "difference_ha": region["balance"]["changed_hectares_difference"]}})
    prefix = fields[:5]
    _csv(directory / "allocations.csv", fields, summary)
    _csv(directory / "transitions.csv", (*prefix, "scenario", "from_code", "to_code", "cells", "hectares"), transitions)
    _csv(directory / "native-support.csv", (*prefix, "pollutant", "native_common_cells",
         "landcover_and_native_common_cells", "restoration_changed_cells", "control_changed_cells",
         "restoration_changed_hectares", "control_changed_hectares"), supports)
    _csv(directory / "pairwise-native-quantities.csv", (*prefix, "scenario", "run_id", "pollutant", "units",
         "common_cells", "baseline_mass", "alternative_mass", "signed_change", "direction", "sum_basis"), quantities)
    collection = {"type": "FeatureCollection", "crs": {"type": "name", "properties": {"name": report["grid"]["crs"]}},
                  "features": features}
    atomic_json(directory / "regions.geojson", collection)
    atomic_json(directory / "allocation.json", report)
    return collection

def _result(workspace, directory, record):
    if (record["schema"] != SCHEMA or record["project_id"] != workspace.project["id"]
            or digest(record["identity"]) != record["id"]):
        raise ValueError("The retained local allocation identity changed")
    for item in record["files"]:
        verify_file(directory, item)
    collection = workspace._get("sources", record["source"]["source_collection_id"])
    entries = [row for row in collection["entries"] if row["id"] == record["source"]["source_id"]]
    if len(entries) != 1 or entries[0]["metadata"]["allocation_id"] != record["id"]:
        raise ValueError("The original allocation report source changed")
    expected = read_json(directory / "sources.json")["entries"][0]
    members = [entries[0]["body"], *entries[0].get("companions", [])]
    actual_members = {}
    for member in members:
        name = member.get("view_path", member["filename"])
        if name in actual_members:
            raise ValueError("The allocation report source repeats a retained path")
        actual_members[name] = {key: member[key] for key in ("bytes", "sha256")}
        verify_file(workspace.root, {"path": member["object"], "bytes": member["bytes"], "sha256": member["sha256"]})
    expected_members = {
        item["path"]: {key: item[key] for key in ("bytes", "sha256")}
        for item in [describe_file(directory, directory / "report-source.json"), *expected["companions"]]}
    if actual_members != expected_members:
        raise ValueError("The allocation report source changed its complete original member inventory")
    return deepcopy(record)

def inspect(workspace, key):
    directory = workspace.root / FOLDER / identifier(key)
    return _result(workspace, directory, read_json(directory / "result.json"))

def prepare(workspace, prepared, context, *, progress=None):
    root, run_ids, footprints, runs = _prepared(workspace, prepared, context)
    grid_record = workspace.get_grid(prepared["grid_id"])
    grid = grid_record["grid"]
    waters._validate_analysis_grid(grid)
    definitions, analyses, geometry_binding = _regions(workspace, prepared, context, grid_record, run_ids)
    identity = {
        "schema": SCHEMA, "project_id": workspace.project["id"], "prepared_id": prepared["id"],
        "prepared_sha256": file_digest(root / "prepared.json"), "context_id": context["id"],
        "grid_id": grid_record["id"], "grid": grid, "run_ids": run_ids,
        "footprints": {role: {"id": item["id"], "selection": item["selection"],
                             "scenario_lulc": item["files"]["scenario_lulc"]} for role, item in footprints.items()},
        "geometry_binding": geometry_binding,
        "implementation_sha256": file_digest(__file__),
        "rendering_sha256": file_digest(rendering.__file__),
        "receiving_implementation_sha256": file_digest(waters.__file__),
        "footprint_reader_sha256": file_digest(scenario_footprint.__file__),
    }
    key = digest(identity)
    directory = workspace.root / FOLDER / key
    parent = directory.parent
    parent.mkdir(parents=True, exist_ok=True)
    with held(parent / (key + ".lock"), blocking=False):
        if (directory / "result.json").exists():
            return inspect(workspace, key)
        if not directory.exists():
            staging = parent / "source-views"
            staging.mkdir(exist_ok=True)
            with tempfile.TemporaryDirectory(prefix=key + "-", dir=staging) as temporary:
                pending = Path(temporary)
                regions = _compute(workspace, grid, footprints, runs, definitions, analyses, progress)
                report = {
                    "schema": SCHEMA, "id": key, "project_id": workspace.project["id"],
                    "prepared_id": prepared["id"], "context_id": context["id"],
                    "title": prepared["selection"]["title"] + " — local scenario allocation",
                    "created_at": now(), "grid": grid, "run_ids": run_ids,
                    "matching_scope": "whole_reporting_area",
                    "regions": regions, "notes": NOTES, "identity": identity,
                }
                features = _export(pending, report, definitions)
                rendered = rendering.write(pending, report, features)
                atomic_json(pending / "original-prepared.json", prepared)
                atomic_json(pending / "original-context-selection.json", context["identity"])
                profile_path = verify_file(Path(__file__).resolve().parents[1],
                                           geometry_binding["utility_profile"]["file"])
                (pending / "original-utility-profile.json").write_bytes(profile_path.read_bytes())
                files = [describe_file(pending, path) for path in sorted(pending.rglob("*")) if path.is_file()]
                recipe = {
                    "schema": "upstate.observed-report/v1", "edition": "geographic-allocation-v1",
                    "title": report["title"], "project_id": workspace.project["id"],
                    "inputs": files, "sections": rendered["sections"],
                    "source_links": ["allocation.json", "allocations.csv", "transitions.csv",
                        "native-support.csv", "pairwise-native-quantities.csv", "regions.geojson",
                        "original-prepared.json", "original-context-selection.json",
                        "original-utility-profile.json"],
                }
                if rendered.get("figures"):
                    recipe.update(figures=rendered["figures"], figure_spec=rendered["figure_spec"])
                atomic_json(pending / "report-source.json", recipe)
                source_id = "geographic-scenario-allocation-" + key
                atomic_json(pending / "sources.json", {
                    "schema": "upstate.sources/v1", "title": report["title"],
                    "entries": [{"id": source_id, "kind": "document", "role": "OBSERVED_CONTEXT",
                        "title": report["title"], "uri": "urn:upstate:geographic-scenario-allocation:" + key,
                        "vintage": report["created_at"], "path": "report-source.json",
                        "sha256": file_digest(pending / "report-source.json"), "companions": files,
                        "metadata": {"report_schema": "upstate.observed-report/v1",
                            "allocation_id": key, "project_id": workspace.project["id"],
                            "geographic_preparation_id": prepared["id"], "context_id": context["id"],
                            "classification": "SIMULATED native scenario land-cover allocation",
                            "new_native_calculation": False}}]})
                inventory = [describe_file(pending, path) for path in sorted(pending.rglob("*")) if path.is_file()]
                atomic_json(pending / "prepared-source.json", {"identity": identity, "files": inventory})
                os.rename(pending, directory)
        retained = read_json(directory / "prepared-source.json")
        if retained["identity"] != identity:
            raise ValueError("Retained local allocation source belongs to another original selection")
        for item in retained["files"]:
            verify_file(directory, item)
        # Existing source import retains complete recipe, GIS/CSV and report members.
        collection = workspace.import_sources(directory / "sources.json")
        record = {"schema": SCHEMA, "id": key, "state": "complete",
                  "project_id": workspace.project["id"], "prepared_id": prepared["id"],
                  "context_id": context["id"], "identity": identity,
                  "source": {"source_collection_id": collection["id"],
                             "source_id": "geographic-scenario-allocation-" + key},
                  "files": retained["files"] + [describe_file(directory, directory / "prepared-source.json")],
                  "directory": directory.relative_to(workspace.root).as_posix()}
        _result(workspace, directory, record)
        atomic_json(directory / "result.json", record, immutable=True)
        return record
