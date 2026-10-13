"""One original-grid pass over saved B/R/C outcomes; no native execution."""
from __future__ import annotations

from contextlib import ExitStack
from copy import deepcopy
import hashlib
import json
import math
from pathlib import Path

from .common import describe_file, verify_file
from . import rasters, receiving_waters as waters
from . import geographic_scenario_allocation as allocation
from . import geographic_siting_contrasts as siting

ROLES = ("baseline", "restoration", "control")
SUPPORTS = ("per_design", "group_common")
DEFINITIONS = {"per_design": "finite intersection of baseline, restoration and this control",
               "group_common": "finite intersection of baseline, restoration and every explicitly selected control"}
DIFFERENCES = ("baseline_minus_restoration", "baseline_minus_control", "control_minus_restoration")
PLACEMENT_METHOD = "window-addressed-final-categorical-change/v1"


def _read(source, window):
    import numpy as np
    data = source.read(1, window=window, masked=True)
    raw = np.ma.getdata(data)
    valid = ~np.ma.getmaskarray(data) & np.isfinite(raw)
    if np.any(valid & ((raw != np.floor(raw)) | (raw <= -2147483648) | (raw > 2147483647))):
        raise ValueError("The executed land-cover classes are not exact signed-int32 values")
    return raw, valid


def _same(left, right):
    import numpy as np
    return np.array_equal(left[1], right[1]) and np.array_equal(left[0][left[1]], right[0][right[1]])


def _mask_hash(hash_value, mask, window):
    import numpy as np
    address = [int(window.row_off), int(window.col_off), int(window.height), int(window.width)]
    hash_value.update(json.dumps(address, separators=(",", ":")).encode("ascii") + b"\n")
    hash_value.update(np.packbits(mask, bitorder="little").tobytes())


def _placement_hash(hash_value, baseline, alternative, changed, window):
    import numpy as np
    _mask_hash(hash_value, changed, window)
    hash_value.update(np.asarray(baseline[changed], dtype="<i4").tobytes())
    hash_value.update(np.asarray(alternative[changed], dtype="<i4").tobytes())


def _writer(stack, path, grid, *, units, quantity, mode, design, mask=False):
    import rasterio
    profile = rasters.output_profile(grid)
    profile.update(dtype="uint8" if mask else "float64", nodata=0 if mask else float("nan"),
                   predictor=1 if mask else 3, SPARSE_OK="YES")
    path.parent.mkdir(parents=True, exist_ok=True)
    writer = stack.enter_context(rasterio.open(path, "w", **profile))
    writer.update_tags(units=units, quantity=quantity, support_mode=mode,
        design_id=design, support_definition=DEFINITIONS[mode], method="original-native-float64-direct-difference/v1",
        outside_support="NoData; not zero", attribution="TokenJunkieLabs",
        interpretation="annual source-pixel export to streams; not concentration or intake load")
    return writer


def compute(ws, binding, directory, progress=None):
    import numpy as np
    import rasterio
    from rasterio.windows import Window

    root = Path(directory)
    grid, members = binding["grid"], binding["members"]
    waters._validate_analysis_grid(grid)
    domain_rows, _ = rasters.vector_geometry(verify_file(ws.root, binding["grid_files"]["model_domain"]),
        layer="model_domain", target_crs=grid["crs"])
    model_domain = rasters.polygon_union(domain_rows)
    area = float(grid["pixel_area_ha"])
    baseline_id, restoration_id = binding["baseline_run_id"], binding["restoration_run_id"]
    run_ids = list(binding["runs"])
    quantity_names = binding["pollutants"]
    states = {(member["design_id"], mode): allocation._empty()
              for member in members for mode in SUPPORTS}
    for state in states.values():
        state["native_support"] = {p: {"native_common_cells": 0,
            "landcover_and_native_common_cells": 0, "valid_cells": dict.fromkeys(ROLES, 0),
            "restoration_changed_cells": 0, "control_changed_cells": 0} for p in quantity_names}
    placement_hashes = {run_id: hashlib.sha256((PLACEMENT_METHOD + "\n").encode("ascii"))
                        for run_id in run_ids if run_id != baseline_id}
    changed_counts = dict.fromkeys(placement_hashes, 0)
    reporting_changed_counts = dict.fromkeys(placement_hashes, 0)
    origin_counts = {run_id: {} for run_id in placement_hashes}
    overlaps = {(i, j): 0 for i in range(len(members)) for j in range(i + 1, len(members))}
    native_counts = {p: dict.fromkeys(run_ids, 0) for p in quantity_names}
    group_hashes = {p: hashlib.sha256(b"window-addressed-three-run-finite-native-mask/v1\n")
                    for p in quantity_names}
    group_counts = dict.fromkeys(quantity_names, 0)
    maps, mask_files, writers = [], [], {}
    total = math.ceil(grid["height"] / 256) * math.ceil(grid["width"] / 256)

    with ExitStack() as stack:
        categorical, originals, native_baseline = {}, {}, None
        for run_id, sources in binding["landcover"].items():
            source = stack.enter_context(rasterio.open(verify_file(ws.root, sources["native"])))
            allocation._raster_grid(source, grid)
            if source.count != 1:
                raise ValueError("Original categorical case must retain one band")
            categorical[run_id] = source
            if sources.get("footprint"):
                original = stack.enter_context(rasterio.open(verify_file(ws.root, sources["footprint"])))
                allocation._raster_grid(original, grid)
                if original.count != 1:
                    raise ValueError("Retained control footprint must have one band")
                originals[run_id] = original
            if sources.get("baseline_native"):
                native_baseline = stack.enter_context(rasterio.open(verify_file(ws.root, sources["baseline_native"])))
                allocation._raster_grid(native_baseline, grid)
        mask = stack.enter_context(rasterio.open(verify_file(ws.root, binding["grid_files"]["reporting_mask"])))
        allocation._raster_grid(mask, grid)
        if mask.count != 1:
            raise ValueError("Original reporting mask must retain one band")
        bands = {}
        for run_id, quantities in binding["quantity_sources"].items():
            bands[run_id] = {}
            for pollutant, provenance in quantities.items():
                path = verify_file(ws.root / "runs" / run_id, provenance["artifact"])
                band = waters._aligned_source(stack, path, grid, factor=provenance["multiplier"],
                                              provenance=provenance)
                if band["source"].count != 1:
                    raise ValueError("Original native outcome must have one band")
                bands[run_id][pollutant] = band
        for index, member in enumerate(members, 1):
            key = member["design_id"]
            for mode in SUPPORTS:
                for pollutant in quantity_names:
                    prefix = "maps/design-" + str(index) + "/" + mode + "/" + pollutant
                    mask_name = prefix + "-support.tif"
                    writers[(key, mode, pollutant, "mask")] = _writer(stack, root / mask_name, grid,
                        units="mask", quantity=pollutant, mode=mode, design=key, mask=True)
                    mask_files.append({"design_id": key, "support_mode": mode, "support_definition": DEFINITIONS[mode], "pollutant": pollutant,
                                       "run_ids": run_ids if mode == "group_common" else [baseline_id, restoration_id, member["control_run_id"]],
                                       "path": mask_name})
                    for difference in DIFFERENCES:
                        name = prefix + "-" + difference + ".tif"
                        writers[(key, mode, pollutant, difference)] = _writer(stack, root / name, grid,
                            units=rasters.MASS_UNITS[pollutant], quantity=difference, mode=mode, design=key)
                        maps.append({"design_id": key, "design_index": index, "title": member["title"],
                            "support_mode": mode, "support_definition": DEFINITIONS[mode], "pollutant": pollutant, "difference": difference,
                            "run_ids": run_ids if mode == "group_common" else [baseline_id, restoration_id, member["control_run_id"]],
                            "units": rasters.MASS_UNITS[pollutant], "path": name})
        count = 0
        for top in range(0, grid["height"], 256):
            for left in range(0, grid["width"], 256):
                window = Window(left, top, min(256, grid["width"] - left), min(256, grid["height"] - top))
                blocks = {key: _read(source, window) for key, source in categorical.items()}
                for run_id, original in originals.items():
                    if not _same(blocks[run_id], _read(original, window)):
                        raise ValueError("Executed land cover differs from retained design footprint: " + run_id)
                if native_baseline is not None and not _same(blocks[baseline_id], _read(native_baseline, window)):
                    raise ValueError("Executed baseline differs from the original prepared categorical grid")
                report_data = mask.read(1, window=window, masked=True)
                report_valid = ~np.ma.getmaskarray(report_data)
                report_values = np.ma.getdata(report_data)
                if np.any(report_valid & ~np.isin(report_values, [0, 1])):
                    raise ValueError("Original reporting mask must contain only0/1")
                reporting = report_valid & (report_values == 1)
                inside = reporting if binding["quantity_scope"] == "reporting" else waters._inside(grid, model_domain, window)
                changed = {}
                for run_id in placement_hashes:
                    valid = blocks[baseline_id][1] & blocks[run_id][1]
                    change = valid & (blocks[baseline_id][0] != blocks[run_id][0])
                    changed[run_id] = change
                    changed_counts[run_id] += int(np.count_nonzero(change))
                    reporting_changed_counts[run_id] += int(np.count_nonzero(change & reporting))
                    _placement_hash(placement_hashes[run_id], blocks[baseline_id][0], blocks[run_id][0], change, window)
                    for code, n in zip(*np.unique(blocks[baseline_id][0][change].astype("int64"), return_counts=True)):
                        origin_counts[run_id][int(code)] = origin_counts[run_id].get(int(code), 0) + int(n)
                for (i, j) in overlaps:
                    overlaps[(i, j)] += int(np.count_nonzero(
                        changed[members[i]["control_run_id"]] & changed[members[j]["control_run_id"]]))
                values = {run_id: {p: waters._read_quantity(band, window) for p, band in selected.items()}
                          for run_id, selected in bands.items()}
                group_masks = {}
                for pollutant in quantity_names:
                    group = inside & np.logical_and.reduce([values[run_id][pollutant][1] for run_id in run_ids])
                    group_masks[pollutant] = group
                    group_counts[pollutant] += int(np.count_nonzero(group))
                    _mask_hash(group_hashes[pollutant], group, window)
                    for run_id in run_ids:
                        native_counts[pollutant][run_id] += int(np.count_nonzero(inside & values[run_id][pollutant][1]))
                for member in members:
                    key, control_id = member["design_id"], member["control_run_id"]
                    role_ids = {"baseline": baseline_id, "restoration": restoration_id, "control": control_id}
                    arrays = {role: blocks[run_id][0] for role, run_id in role_ids.items()}
                    valid = {role: blocks[run_id][1] for role, run_id in role_ids.items()}
                    for mode in SUPPORTS:
                        quantities = {p: {role: (values[run_id][p][0],
                            values[run_id][p][1] if mode == "per_design" else group_masks[p])
                            for role, run_id in role_ids.items()} for p in quantity_names}
                        masks = {p: {role: value[1] for role, value in original.items()}
                                 for p, original in quantities.items()}
                        allocation._accumulate(states[(key, mode)], arrays, valid, inside, masks, quantities, window)
                        for pollutant, original in quantities.items():
                            support = inside & np.logical_and.reduce([original[role][1] for role in ROLES])
                            writers[(key, mode, pollutant, "mask")].write(support.astype("uint8"), 1, window=window)
                            differences = {
                                "baseline_minus_restoration": original["baseline"][0] - original["restoration"][0],
                                "baseline_minus_control": original["baseline"][0] - original["control"][0],
                                "control_minus_restoration": original["control"][0] - original["restoration"][0]}
                            for difference, data in differences.items():
                                if np.any(~np.isfinite(data[support])):
                                    raise ValueError("The direct native mass difference exceeds finite Float64 range")
                                result = np.full(data.shape, np.nan, dtype="float64")
                                result[support] = data[support]
                                writers[(key, mode, pollutant, difference)].write(result, 1, window=window)
                count += 1
                if progress and (count % 16 == 0 or count == total):
                    progress({"stage": "native_outcome_comparison", "completed_windows": count,
                              "total_windows": total, "design_count": len(members)})
    # Check actual executed placement against the accepted complete design budgets.
    restoration_count = changed_counts[restoration_id]
    for member in members:
        control_id = member["control_run_id"]
        expected = member["summary"]["original_changed_cells"]
        if (changed_counts[control_id] != expected or restoration_count != expected
                or reporting_changed_counts[control_id] != expected
                or reporting_changed_counts[restoration_id] != expected
                or origin_counts[control_id] != origin_counts[restoration_id]):
            raise ValueError("Executed control changed its accepted complete area/original-class budget")
    regions = []
    for member in members:
        key = member["design_id"]
        ids = {"baseline": baseline_id, "restoration": restoration_id, "control": member["control_run_id"]}
        whole = {}
        for role in ("restoration", "control"):
            footprint = binding["landcover"][ids[role]]
            summary = footprint["summary"]
            if (summary["net_changed_cells"] != changed_counts[ids[role]]
                    or not math.isclose(summary["net_changed_hectares"], changed_counts[ids[role]] * area,
                                        rel_tol=0, abs_tol=1e-6)):
                raise ValueError("Actual executed placement differs from the retained footprint denominator")
            whole[role] = {"footprint_id": footprint["footprint_id"], "run_id": ids[role],
                          "cells": summary["net_changed_cells"], "hectares": summary["net_changed_hectares"],
                          "pixel_area_ha": area, "summary": deepcopy(summary),
                          "basis": "verified executed final categorical change from unchanged baseline"}
        siting_binding = {"whole_scenario_intervention": whole}
        for mode in SUPPORTS:
            state = states[(key, mode)]
            region = {"id": key + "-" + mode, "design_id": key, "title": member["title"],
                "kind": "whole_selection", "relationship": "original_" + binding["quantity_scope"],
                "quantity_scope": binding["quantity_scope"], "support_mode": mode,
                "support_definition": DEFINITIONS[mode], "run_ids": run_ids if mode == "group_common" else list(ids.values()),
                **allocation._finish(state, ids, area)}
            region["siting_contrasts"] = siting.finish(state["siting_contrasts"], region, area, siting_binding)
            for pollutant, outcome in region["siting_contrasts"].items():
                outcome["support_mode"] = mode
                outcome["support_definition"] = DEFINITIONS[mode]
                outcome["explicit_support_run_ids"] = run_ids if mode == "group_common" else list(ids.values())
                outcome["original_run_valid_cells"] = {role: native_counts[pollutant][run_id]
                                                       for role, run_id in ids.items()}
                if mode == "group_common":
                    if (outcome["native_common_cells"] != group_counts[pollutant]
                            or outcome["mask_sha256"] != group_hashes[pollutant].hexdigest()):
                        raise ValueError("One control lost the exact selected-roster common support")
                    outcome["explicit_common_run_ids"] = run_ids
            regions.append(region)
    # Common-group arithmetic must agree independently of the selected control.
    for pollutant in quantity_names:
        common_rows = [r["siting_contrasts"][pollutant] for r in regions if r["support_mode"] == "group_common"]
        first = common_rows[0]
        for member, item in zip(members, common_rows):
            own = next(r["siting_contrasts"][pollutant] for r in regions
                       if r["design_id"] == member["design_id"] and r["support_mode"] == "per_design")
            if (item["native_common_cells"] > own["native_common_cells"]
                    or item["mass"]["baseline"] != first["mass"]["baseline"]
                    or item["mass"]["restoration"] != first["mass"]["restoration"]
                    or item["alternatives"]["restoration"]["avoided_export_mass"] != first["alternatives"]["restoration"]["avoided_export_mass"]):
                raise ValueError("Selected-roster common-support arithmetic diverged across controls")
    placements = []
    seen = {}
    for index, member in enumerate(members, 1):
        control_id = member["control_run_id"]
        sha = placement_hashes[control_id].hexdigest()
        duplicate = seen.get(sha)
        seen.setdefault(sha, member["design_id"])
        placements.append({"design_id": member["design_id"], "index": index, "title": member["title"],
            "control_run_id": control_id, "control_footprint_id": member["control_footprint_id"],
            "placement_sha256": sha, "placement_method": PLACEMENT_METHOD,
            "same_placement_as": duplicate, "changed_cells": changed_counts[control_id],
            "changed_hectares": changed_counts[control_id] * area,
            "original_class_counts": origin_counts[control_id],
            "authored_selection": member["selection"], "balance": member["balance"]})
    overlap_rows = []
    for (i, j), count in overlaps.items():
        left, right = members[i], members[j]
        union = changed_counts[left["control_run_id"]] + changed_counts[right["control_run_id"]] - count
        overlap_rows.append({"left_design_id": left["design_id"], "right_design_id": right["design_id"],
            "intersection_cells": count, "intersection_hectares": count * area, "union_cells": union,
            "jaccard": count / union if union else None,
            "same_placement": placements[i]["placement_sha256"] == placements[j]["placement_sha256"]})
    for item in maps + mask_files:
        item["file"] = describe_file(root, root / item["path"])
    support = {p: {"native_common_cells": group_counts[p], "native_common_hectares": group_counts[p] * area,
                  "mask_sha256": group_hashes[p].hexdigest(), "run_ids": run_ids,
                  "individual_valid_cells": native_counts[p],
                  "unavailable_reason": "no_common_native_support" if not group_counts[p] else None}
               for p in quantity_names}
    return {"summary": {"design_count": len(members), "distinct_placements": len(seen),
            "duplicate_placements": len(members) - len(seen), "quantity_count": len(quantity_names),
            "quantity_scope": binding["quantity_scope"], "support_modes": list(SUPPORTS),
            "baseline_run_id": baseline_id, "restoration_run_id": restoration_id,
            "restoration_changed_cells": restoration_count, "restoration_changed_hectares": restoration_count * area,
            "group_common_support": support, "independent_replicates": None},
        "placements": placements, "placement_overlaps": overlap_rows, "regions": regions,
        "maps": maps, "support_maps": mask_files,
        "restoration_placement": {"sha256": placement_hashes[restoration_id].hexdigest(),
                                 "method": PLACEMENT_METHOD}}
