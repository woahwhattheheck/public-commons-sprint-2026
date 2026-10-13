"""Apply original ordered scenario patches and retain their actual native footprint.

The categorical kernel is shared by the original make_scenario entrypoint and
the operator preview. It does not estimate hydrological model benefits.
"""
from __future__ import annotations
import argparse
import contextlib
import copy
import csv
import io
import json
import math
import os
from pathlib import Path
import shutil
import tempfile

from .common import (atomic_json, canonical, describe_file, digest, file_digest,
                     held, identifier, now, read_json, verify_file)

VERSION = "1.1.0"
RECORD_KIND = "scenario-footprints"
OUTPUT_ROOT = "scenario-footprint-output"
INT32_MIN = -2147483648
INT32_MAX = 2147483647
GUIDES = {
    "ndr": "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html",
    "sdr": "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html",
}


def validate_destination_codes(profile, scenario):
    """Check every declared target row before a native run can be prepared."""
    available = set(profile["table_summary"]["lucodes"])
    targets = set()
    for number, patch in enumerate(scenario.get("patches", []), 1):
        code = patch.get("to_code")
        if type(code) is not int or not INT32_MIN < code <= INT32_MAX:
            raise ValueError("Scenario patch " + str(number) +
                             " needs an integer target code representable in the native categorical raster")
        targets.add(code)
    missing = targets - available
    if missing:
        raise ValueError("The selected biophysical table lacks scenario destination codes " +
                         ", ".join(map(str, sorted(missing))) +
                         ". Retain their coefficient rows in the selected profile before preparing this run.")
    return sorted(targets)


def _transition_counts(before, after, selected, counts):
    """Count exact signed-int32 pairs without NumPy's two-column record sort."""
    import numpy as np
    if not np.any(selected):
        return
    # The kernel checks every valid original/assigned class fits signed int32.
    # Pack the original bit patterns; no lossy arithmetic or dense class matrix.
    origins = before[selected].astype("uint32").astype("uint64")
    destinations = after[selected].astype("uint32").astype("uint64")
    pairs, numbers = np.unique((origins << np.uint64(32)) | destinations,
                               return_counts=True)
    for packed, count in zip(pairs, numbers):
        value = int(packed)
        origin, destination = value >> 32, value & 0xffffffff
        if origin >= 0x80000000:
            origin -= 0x100000000
        if destination >= 0x80000000:
            destination -= 0x100000000
        key = (origin, destination)
        counts[key] = counts.get(key, 0) + int(count)


def _constant_transition_counts(before, destination, selected, counts):
    """A declared patch has one target code; retain its exact original counts."""
    import numpy as np
    codes, numbers = np.unique(before[selected], return_counts=True)
    for origin, count in zip(codes, numbers):
        key = (int(origin), int(destination))
        counts[key] = counts.get(key, 0) + int(count)


def _transitions(counts, area):
    return [{"from_code": a, "to_code": b, "cells": n, "hectares": n * area}
            for (a, b), n in sorted(counts.items())]


def _histogram(values, valid, counts):
    import numpy as np
    codes, numbers = np.unique(values[valid], return_counts=True)
    for code, number in zip(codes, numbers):
        key = int(code)
        counts[key] = counts.get(key, 0) + int(number)


def _native_masks(patches, source_loader, crs):
    """Retain polygon selection or an original aligned binary-raster mask."""
    from . import rasters
    from shapely.geometry import mapping
    sources, geometries, result = {}, {}, []
    for patch in patches:
        sid = patch["mask_source_id"]
        if sid not in sources:
            sources[sid] = source_loader(sid)
        path, entry = sources[sid]
        kind = entry.get("kind")
        lineage = {k: copy.deepcopy(entry[k]) for k in
                   ("id", "title", "uri", "vintage", "source_time", "kind",
                    "source_collection_id", "body", "companions") if k in entry}
        item = {"patch": copy.deepcopy(patch), "source": lineage, "kind": kind,
                "layer": None, "features": None, "polygon_area_m2": None}
        if kind == "vector":
            layer = patch.get("layer") or entry.get("layer")
            key = digest({"source_id": sid, "layer": layer, "where": patch.get("where")})
            if key not in geometries:
                rows, _ = rasters.vector_geometry(path, layer=layer, where=patch.get("where"),
                                                  target_crs=crs)
                polygon = rasters.polygon_union(rows)
                geometries[key] = (mapping(polygon), len(rows), float(polygon.area), polygon.bounds)
            geometry, count, area, bounds = geometries[key]
            item.update(geometry=geometry, layer=layer, features=count,
                        polygon_area_m2=area, bounds=tuple(bounds))
        elif kind == "raster":
            if patch.get("layer") or patch.get("where"):
                raise ValueError("Raster scenario masks select band 1; layer and where apply to vectors")
            item["raster_path"] = str(path)
        else:
            raise ValueError("Scenario masks require retained vector or binary raster sources")
        result.append(item)
    return result


def _require_grid(dataset, profile, target_crs, label):
    from pyproj import CRS
    if (dataset.count != 1 or dataset.width != profile["width"]
            or dataset.height != profile["height"]
            or dataset.transform != profile["transform"] or dataset.crs is None
            or CRS.from_user_input(dataset.crs) != target_crs):
        raise ValueError(label + " must use the exact retained single-band model grid")


def apply_scenario(baseline, destination, grid, patches, *, source_loader,
                   allowed_codes, change_mask=None):
    """Materialize exact ordered edits, returning patch and final net accounting.

    Each from_codes predicate sees the current raster after preceding patches.
    Polygon masks use the original pixel-centre rule (all_touched=False).
    Raster masks select valid band-1 cells equal to one on the exact model grid.
    A patch's changed_cells counts actual immediate value changes; final_owned_cells
    counts final differences whose last value-changing patch is that patch.
    """
    import numpy as np
    import rasterio
    from rasterio.features import rasterize
    from pyproj import CRS
    from . import rasters

    baseline, destination = Path(baseline).resolve(strict=True), Path(destination)
    if baseline == destination.resolve():
        raise ValueError("The scenario output must have its own path")
    patches = list(patches)
    allowed = set(allowed_codes)
    validate_destination_codes({"table_summary": {"lucodes": list(allowed)}},
                               {"patches": patches})
    destination.parent.mkdir(parents=True, exist_ok=True)
    profile = rasters.output_profile(grid, categorical=True)
    target_crs = CRS.from_user_input(profile["crs"])
    if not target_crs.is_projected or len(target_crs.axis_info) < 2 or any(
            not math.isclose(axis.unit_conversion_factor, 1.0, rel_tol=0, abs_tol=1e-12)
            for axis in target_crs.axis_info[:2]):
        raise ValueError("Scenario areas require the actual projected grid in metres")
    transform = profile["transform"]
    area = abs(transform.a * transform.e - transform.b * transform.d) / 10000.0
    if not math.isfinite(area) or area <= 0 or not math.isclose(
            area, float(grid["pixel_area_ha"]), rel_tol=1e-10, abs_tol=1e-12):
        raise ValueError("The declared grid area differs from its actual pixel geometry")
    prepared = _native_masks(patches, source_loader, target_crs)
    fields = ("mask_cells", "valid_mask_cells", "nodata_mask_cells",
              "eligible_cells", "already_destination_cells", "changed_cells",
              "overlap_with_earlier_masks_cells", "changed_earlier_cells",
              "cascaded_change_cells", "reverted_to_baseline_cells", "final_owned_cells")
    stats = [{key: 0 for key in fields} for _ in patches]
    local_transitions = [{} for _ in patches]
    final_hist, original_hist, final_transitions = {}, {}, {}
    total = {"total_cells": 0, "valid_cells": 0, "nodata_cells": 0,
             "unique_mask_cells": 0, "unique_eligible_cells": 0,
             "ever_changed_cells": 0, "changed_more_than_once_cells": 0,
             "reverted_to_baseline_cells": 0, "net_changed_cells": 0}
    pending = []
    mask_destination = Path(change_mask) if change_mask else None
    if mask_destination:
        mask_destination.parent.mkdir(parents=True, exist_ok=True)
        if mask_destination.resolve() in (baseline, destination.resolve()):
            raise ValueError("The final change mask needs a separate path")
    try:
        handle, name = tempfile.mkstemp(prefix=".scenario-", suffix=".tif", dir=destination.parent)
        os.close(handle)
        pending_lulc = Path(name)
        pending.append(pending_lulc)
        with contextlib.ExitStack() as stack:
            src = stack.enter_context(rasterio.open(baseline))
            _require_grid(src, profile, target_crs, "Baseline land cover")
            if not np.issubdtype(np.dtype(src.dtypes[0]), np.integer):
                raise ValueError("Scenario baseline must be the retained single-band integer model grid")
            opened_masks = {}
            for item in prepared:
                if item["kind"] != "raster":
                    continue
                key = item["raster_path"]
                if key not in opened_masks:
                    mask_source = stack.enter_context(rasterio.open(key))
                    _require_grid(mask_source, profile, target_crs, "Raster scenario mask")
                    if np.dtype(mask_source.dtypes[0]).kind not in ("b", "u", "i", "f"):
                        raise ValueError("Raster scenario masks require numeric zero and one values")
                    opened_masks[key] = mask_source
            out = stack.enter_context(rasterio.open(pending_lulc, "w", **profile))
            mask_out = None
            if mask_destination:
                handle, name = tempfile.mkstemp(prefix=".footprint-", suffix=".tif",
                                                dir=mask_destination.parent)
                os.close(handle)
                pending_mask = Path(name)
                pending.append(pending_mask)
                mask_profile = dict(profile)
                mask_profile.update(dtype="uint8", nodata=255)
                mask_out = stack.enter_context(rasterio.open(pending_mask, "w", **mask_profile))
            for _, window in out.block_windows(1):
                data = src.read(1, window=window, masked=True)
                valid = ~np.ma.getmaskarray(data)
                original = np.ma.getdata(data).astype("int64")
                values = original.copy()
                local_codes = set(int(x) for x in np.unique(original[valid]))
                # Preserve native make_scenario's destination-only table contract.
                # Workspace.prepare_run checks baseline coverage; preview_run checks
                # the final observed classes against the retained coefficient table.
                if any(not INT32_MIN < code <= INT32_MAX for code in local_codes):
                    raise ValueError("An actual baseline class cannot be retained in the native categorical output")
                seen_masks = np.zeros(values.shape, dtype=bool)
                eligible_union = np.zeros(values.shape, dtype=bool)
                changes = np.zeros(values.shape, dtype="uint32")
                last_owner = np.full(values.shape, -1, dtype="int32")
                window_transform = src.window_transform(window)
                corners = [window_transform * point for point in
                           ((0, 0), (window.width, 0), (0, window.height),
                            (window.width, window.height))]
                window_bounds = (min(p[0] for p in corners), min(p[1] for p in corners),
                                 max(p[0] for p in corners), max(p[1] for p in corners))
                window_masks = {}
                for i, item in enumerate(prepared):
                    patch = item["patch"]
                    if item["kind"] == "vector":
                        bounds = item["bounds"]
                        if (bounds[2] < window_bounds[0] or bounds[0] > window_bounds[2]
                                or bounds[3] < window_bounds[1] or bounds[1] > window_bounds[3]):
                            continue
                        mask = rasterize([(item["geometry"], 1)], out_shape=values.shape,
                                         transform=window_transform, fill=0,
                                         all_touched=False, dtype="uint8").astype(bool)
                    else:
                        key = item["raster_path"]
                        if key not in window_masks:
                            selected_mask = opened_masks[key].read(1, window=window, masked=True)
                            mask_values = np.ma.getdata(selected_mask)
                            mask_valid = ~np.ma.getmaskarray(selected_mask)
                            if np.any(mask_valid & ~np.isin(mask_values, (0, 1))):
                                raise ValueError("Raster scenario mask contains valid values other than zero and one")
                            window_masks[key] = mask_valid & (mask_values == 1)
                        mask = window_masks[key]
                    eligible = mask & valid & np.isin(values, patch["from_codes"])
                    changed = eligible & (values != patch["to_code"])
                    row = stats[i]
                    row["mask_cells"] += int(mask.sum())
                    row["valid_mask_cells"] += int((mask & valid).sum())
                    row["nodata_mask_cells"] += int((mask & ~valid).sum())
                    row["eligible_cells"] += int(eligible.sum())
                    row["already_destination_cells"] += int((eligible & ~changed).sum())
                    row["changed_cells"] += int(changed.sum())
                    row["overlap_with_earlier_masks_cells"] += int((mask & seen_masks & valid).sum())
                    row["changed_earlier_cells"] += int((eligible & (changes > 0)).sum())
                    row["cascaded_change_cells"] += int((changed & (values != original)).sum())
                    row["reverted_to_baseline_cells"] += int(
                        (changed & (original == patch["to_code"])).sum())
                    if np.any(eligible):
                        _constant_transition_counts(
                            values, patch["to_code"], eligible, local_transitions[i])
                    values[eligible] = patch["to_code"]
                    changes[changed] += 1
                    last_owner[changed] = i
                    seen_masks |= mask
                    eligible_union |= eligible
                net = valid & (values != original)
                for i, row in enumerate(stats):
                    row["final_owned_cells"] += int((net & (last_owner == i)).sum())
                total["total_cells"] += int(values.size)
                total["valid_cells"] += int(valid.sum())
                total["nodata_cells"] += int((~valid).sum())
                total["unique_mask_cells"] += int((seen_masks & valid).sum())
                total["unique_eligible_cells"] += int(eligible_union.sum())
                total["ever_changed_cells"] += int((changes > 0).sum())
                total["changed_more_than_once_cells"] += int((changes > 1).sum())
                total["reverted_to_baseline_cells"] += int((valid & (changes > 0) & ~net).sum())
                total["net_changed_cells"] += int(net.sum())
                _histogram(original, valid, original_hist)
                _histogram(values, valid, final_hist)
                _transition_counts(original, values, valid, final_transitions)
                values[~valid] = profile["nodata"]
                out.write(values.astype("int32"), 1, window=window)
                if mask_out:
                    mask_values = net.astype("uint8")
                    mask_values[~valid] = 255
                    mask_out.write(mask_values, 1, window=window)
            out.update_tags(scenario_edit_order="declared patch order",
                            nodata_policy="original nodata retained",
                            scenario_footprint_version=VERSION,
                            area_semantics="net difference from original baseline")
            if mask_out:
                mask_out.update_tags(meaning="1 final value differs from baseline; 0 same value; 255 original nodata",
                                     scenario_footprint_version=VERSION)
        os.replace(pending_lulc, destination)
        pending.remove(pending_lulc)
        if mask_destination:
            os.replace(pending_mask, mask_destination)
            pending.remove(pending_mask)
    finally:
        for path in pending:
            path.unlink(missing_ok=True)

    patch_rows = []
    for i, (item, row) in enumerate(zip(prepared, stats)):
        patch_rows.append({**row, "index": i, "patch": item["patch"],
                           "source": item["source"], "mask_kind": item["kind"],
                           "mask_band": 1 if item["kind"] == "raster" else None,
                           "selected_layer": item["layer"],
                           "selected_features": item["features"],
                           "source_polygon_hectares": (item["polygon_area_m2"] / 10000.0
                                                       if item["kind"] == "vector" else None),
                           "changed_hectares": row["changed_cells"] * area,
                           "eligible_hectares": row["eligible_cells"] * area,
                           "final_owned_hectares": row["final_owned_cells"] * area,
                           "transitions": _transitions(local_transitions[i], area)})
    total.update(pixel_area_ha=area,
                 net_changed_hectares=total["net_changed_cells"] * area,
                 ever_changed_hectares=total["ever_changed_cells"] * area,
                 eligible_hectares=total["unique_eligible_cells"] * area,
                 unchanged_cells=total["valid_cells"] - total["net_changed_cells"],
                 patch_changed_assignments=sum(row["changed_cells"] for row in stats))
    notes = []
    for i, row in enumerate(stats, 1):
        if row["valid_mask_cells"] == 0:
            notes.append("Patch " + str(i) + " contains no valid model-grid pixel centres.")
        elif row["eligible_cells"] == 0:
            notes.append("Patch " + str(i) + " matches none of its from_codes at its declared position.")
        elif row["changed_cells"] == 0:
            notes.append("Patch " + str(i) + " assigns only its existing destination value.")
    if patches and total["net_changed_cells"] == 0:
        notes.append("The complete ordered scenario has the same final categorical values as its baseline.")
    return {"schema": "upstate.scenario-footprint/v1", "compiler_version": VERSION,
            "grid": {"crs": target_crs.to_wkt(), "transform": list(transform)[:6],
                     "width": profile["width"], "height": profile["height"],
                     "pixel_area_ha": area},
            "summary": total, "patches": patch_rows,
            "baseline_classes": [{"code": code, "cells": count, "hectares": count * area}
                                 for code, count in sorted(original_hist.items())],
            "final_classes": [{"code": code, "cells": count, "hectares": count * area}
                              for code, count in sorted(final_hist.items())],
            "transitions": _transitions(final_transitions, area),
            "notes": notes,
            "semantics": {
                "patch_order": "from_codes reads the current raster after all preceding patches",
                "eligibility": "valid cell selected by its retained mask whose current value matches from_codes",
                "polygon_mask": "pixel-centre selection with all_touched=False",
                "raster_mask": "valid band-1 value equal to one on the exact model grid; zero and mask NoData excluded",
                "patch_changed": "eligible cell whose current value differs from to_code",
                "final_net": "final categorical value differs from the original baseline",
                "final_owner": "last value-changing patch, restricted to final net-changed cells",
                "nodata": "original invalid cells remain invalid throughout",
                "area": "actual affine pixel area in projected metres divided by 10000",
                "benefit": "this footprint describes model input changes; the original NDR/SDR engines compute exports",
            }}


def make_scenario(baseline, destination, grid, patches, *, source_loader, allowed_codes):
    """Compatible original rasters.make_scenario result with corrected accounting."""
    return apply_scenario(baseline, destination, grid, patches,
                          source_loader=source_loader, allowed_codes=allowed_codes)["patches"]


def _coefficient_rows(workspace, profile, codes):
    path, entry = workspace.source_file(profile["source_collection_id"],
                                       profile["biophysical_source_id"])
    if entry["body"]["sha256"] != profile["table_summary"]["sha256"]:
        raise ValueError("The selected coefficient table differs from its retained profile")
    wanted = set(codes)
    with open(path, encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        fields = reader.fieldnames or []
        rows = [dict(row) for row in reader if int(row["lucode"]) in wanted]
    actual = {int(row["lucode"]) for row in rows}
    if actual != wanted:
        raise ValueError("Actual scenario class rows are absent from the retained coefficient table: " +
                         ", ".join(map(str, sorted(wanted - actual))))
    rows.sort(key=lambda row: int(row["lucode"]))
    return fields, rows, entry


def _write_csv(path, fields, rows):
    with open(path, "w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def _preview_png(mask_path, destination, maximum_side=640):
    """A grayscale display of the exact mask, aggregated only for its preview."""
    import struct
    import zlib
    import numpy as np
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.warp import reproject
    with rasterio.open(mask_path) as src:
        scale = min(1.0, maximum_side / max(src.width, src.height))
        width, height = max(1, round(src.width * scale)), max(1, round(src.height * scale))
        if (height, width) == (src.height, src.width):
            data = src.read(1, masked=True)
        else:
            # Maximum is a GDAL warp resampler, not a RasterIO read resampler.
            # Keep the original grid extent and ignore its original nodata so
            # every display cell still shows whether any valid cell changed.
            values = np.full((height, width), 255, dtype=src.dtypes[0])
            reproject(
                source=rasterio.band(src, 1), destination=values,
                src_transform=src.transform, src_crs=src.crs,
                src_nodata=src.nodata,
                dst_transform=src.transform * rasterio.Affine.scale(
                    src.width / width, src.height / height),
                dst_crs=src.crs, dst_nodata=255,
                resampling=Resampling.max,
            )
            data = np.ma.array(values, mask=values == 255)
        invalid = np.ma.getmaskarray(data)
        pixels = np.full((height, width), 246, dtype="uint8")
        pixels[np.ma.getdata(data) == 1] = 48
        pixels[invalid] = 202
        raw = b"".join(b"\x00" + row.tobytes() for row in pixels)
        def chunk(kind, value):
            return (struct.pack(">I", len(value)) + kind + value +
                    struct.pack(">I", zlib.crc32(kind + value) & 0xffffffff))
        body = (b"\x89PNG\r\n\x1a\n" +
                chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)) +
                chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))
        Path(destination).write_bytes(body)
        return {"width": width, "height": height, "bounds": list(src.bounds),
                "crs": src.crs.to_wkt(),
                "display_aggregation": "maximum of valid net-change-mask values within a display cell",
                "legend": {"48": "contains net changed native cell", "246": "unchanged", "202": "original nodata"}}


def _retain_record(workspace, directory, manifest):
    for item in manifest["files"].values():
        verify_file(directory, item)
    report = read_json(directory / "footprint.json")
    if report["request"] != manifest["request"]:
        raise ValueError("The retained scenario footprint request differs")
    files = {name: {**item, "path": str((directory / item["path"]).relative_to(workspace.root))}
             for name, item in manifest["files"].items()}
    return workspace._save(RECORD_KIND, {
        "title": report["title"], "created_at": report["created_at"],
        "run_id": report["run_id"], "selection": report["selection"],
        "request": report["request"], "summary": report["summary"],
        "patches": report["patches"], "baseline_classes": report["baseline_classes"],
        "final_classes": report["final_classes"], "transitions": report["transitions"],
        "coefficient_columns": report["coefficient_columns"],
        "coefficient_rows": report["coefficient_rows"],
        "coefficient_source": report["coefficient_source"],
        "coefficient_source_collection_id": report["coefficient_source_collection_id"],
        "declared_target_codes": report["declared_target_codes"],
        "notes": report["notes"], "semantics": report["semantics"],
        "files": files, "preview": report["preview"], "guides": GUIDES})


def _preview_inputs(workspace, run_id):
    """Resolve the same current retained source graph for preview and execution."""
    run = workspace.inspect_run(identifier(run_id))
    selection = copy.deepcopy(run["selection"])
    grid = workspace.get_grid(selection["grid_id"])
    profile = workspace._get("profiles", selection["profile_id"])
    scenario = workspace._get("scenarios", selection["scenario_id"])
    target_codes = validate_destination_codes(profile, scenario)
    baseline = verify_file(workspace.root / "grids" / grid["id"], grid["files"]["NLCD"])
    sources = {}
    for patch in scenario.get("patches", []):
        sid = patch["mask_source_id"]
        if sid not in sources:
            path, entry = workspace.source_file(scenario["source_collection_id"], sid)
            entry = copy.deepcopy(entry)
            entry["source_collection_id"] = scenario["source_collection_id"]
            sources[sid] = (path, entry)
    _, _, coefficient_source = _coefficient_rows(
        workspace, profile, set(profile["table_summary"]["lucodes"]))
    request = {"schema": "upstate.scenario-footprint-request/v1",
               "compiler_version": VERSION, "compiler_sha256": file_digest(Path(__file__)),
               "run_id": run_id, "selection": selection,
               "baseline": grid["files"]["NLCD"],
               "coefficient_body": coefficient_source["body"],
               "masks": {sid: {"body": entry["body"], "companions": entry.get("companions", [])}
                         for sid, (_, entry) in sorted(sources.items())}}
    return (run, selection, grid, profile, scenario, target_codes,
            baseline, sources, request)


def _landcover_binding(request, profile, scenario):
    """Inputs to categorical editing, excluding native model parameters."""
    return {
        "schema": "upstate.prepared-landcover-inputs/v1",
        "compiler_version": request["compiler_version"],
        "compiler_sha256": request["compiler_sha256"],
        "selection": {key: value for key, value in request["selection"].items()
                      if key != "profile_id"},
        "baseline": copy.deepcopy(request["baseline"]),
        "scenario_kind": scenario["kind"],
        "ordered_patches": copy.deepcopy(scenario.get("patches", [])),
        "masks": copy.deepcopy(request["masks"]),
        "coefficient_body": copy.deepcopy(request["coefficient_body"]),
        "coefficient_selection": {
            "source_collection_id": profile["source_collection_id"],
            "source_id": profile["biophysical_source_id"],
        },
        "allowed_classes": sorted(set(profile["table_summary"]["lucodes"])),
    }


def _equivalent_previews(workspace, base, request, profile, scenario):
    """Discover completed original donors from metadata, never their raster arrays.

    The current target sources have already been checked by _preview_inputs.
    Every eligible donor is checked against its saved run/profile/scenario;
    changing any categorical input keeps the normal compiler path.
    """
    target_selection = {key: value for key, value in request["selection"].items()
                        if key != "profile_id"}
    binding = _landcover_binding(request, profile, scenario)
    exact_key = digest(request)
    for original in sorted(base.iterdir()):
        if (original.name == exact_key or len(original.name) != 64
                or any(char not in "0123456789abcdef" for char in original.name)
                or not original.is_dir() or original.is_symlink()):
            continue
        manifest_path = original / "complete.json"
        if not manifest_path.is_file():
            continue
        try:
            manifest = read_json(manifest_path)
        except (OSError, ValueError):
            # Incomplete unrelated derived metadata is not a donor.
            continue
        if not isinstance(manifest, dict):
            continue
        candidate = manifest.get("request")
        if (manifest.get("schema") != "upstate.scenario-footprint-files/v1"
                or not isinstance(candidate, dict)
                or not isinstance(candidate.get("selection"), dict)
                or candidate.get("run_id") == request["run_id"]
                or candidate.get("compiler_version") != request["compiler_version"]
                or candidate.get("compiler_sha256") != request["compiler_sha256"]):
            continue
        selection = candidate["selection"]
        if {key: value for key, value in selection.items() if key != "profile_id"} != target_selection:
            continue
        # Retain the whole original request, including any future added source
        # fields. Only these two original native identities may differ.
        expected = {**request, "run_id": candidate.get("run_id"),
                    "selection": selection}
        if candidate != expected or digest(candidate) != original.name:
            continue
        try:
            donor = workspace.inspect_run(identifier(candidate["run_id"]))
            donor_profile = workspace._get("profiles", selection["profile_id"])
            donor_scenario = workspace._get("scenarios", selection["scenario_id"])
        except FileNotFoundError:
            # A selected Study may retain a footprint without its donor run.
            # Its absence is unavailable reuse, not a new source requirement.
            continue
        if donor["selection"] != selection:
            raise ValueError("The prepared footprint donor's native selection changed")
        if (donor_profile["table_summary"]["sha256"] != candidate["coefficient_body"]["sha256"]
                or _landcover_binding(candidate, donor_profile, donor_scenario) != binding):
            continue
        yield original, manifest, candidate, donor_profile, donor_scenario


def _adopt_prepared_landcover(workspace, directory, original, manifest, request,
                              target_request, profile, scenario, target_profile,
                              target_scenario, target_codes):
    from .reuse import copy_verified

    if (manifest.get("schema") != "upstate.scenario-footprint-files/v1"
            or manifest.get("request") != request
            or original.name != digest(request)):
        raise ValueError("The prepared land-cover footprint request differs")
    files = manifest["files"]
    verified = {name: verify_file(original, descriptor)
                for name, descriptor in files.items()}
    report = read_json(verified["report"])
    if (report.get("request") != request or report.get("run_id") != request["run_id"]
            or report.get("selection") != request["selection"]
            or report.get("compiler_version") != VERSION
            or report.get("declared_target_codes") != target_codes):
        raise ValueError("The prepared land-cover report differs from its native selection")
    binding = _landcover_binding(request, profile, scenario)
    if binding != _landcover_binding(target_request, target_profile, target_scenario):
        raise ValueError("The prepared land cover differs from the target's categorical inputs")
    transfer = {}
    artifact = copy_verified(
        original, files["scenario_lulc"], directory, path="scenario_lulc.tif",
        transfer=transfer, replace_mismatch=True)
    # Existing Study capture resolves every nested descriptor under runs/<id>.
    # Both original outputs and the complete source-binding record live there.
    retained_report = copy_verified(
        original, files["report"], directory, path="prepared-footprint.json",
        transfer=transfer, replace_mismatch=True)
    kind = ("same-run" if request["run_id"] == target_request["run_id"]
            else "parameter-variant")
    identity = {
        "schema": "upstate.prepared-landcover-reuse/v1", "kind": kind,
        "project_id": workspace.project["id"],
        "source_request_id": digest(request), "source_request": request,
        "target_request_id": digest(target_request), "target_request": target_request,
        "categorical_input_id": digest(binding), "categorical_inputs": binding,
        "source_profile": profile, "target_profile": target_profile,
        "source_scenario": scenario, "target_scenario": target_scenario,
        "native_parameters": "The target retains its own profile parameters; this adoption covers categorical inputs only.",
    }
    identity_path = directory / "prepared-landcover-reuse.json"
    atomic_json(identity_path, identity)
    artifact = {**artifact, "units": "class"}
    return {
        "completed_at": now(), "edits": report["patches"],
        "artifact": artifact,
        "prepared_footprint": {
            "request_id": digest(request), "run_id": request["run_id"],
            "target_run_id": target_request["run_id"], "reuse_kind": kind,
            "compiler_version": VERSION,
            "compiler_sha256": request["compiler_sha256"],
            "categorical_input_id": identity["categorical_input_id"],
            "identity": describe_file(directory, identity_path),
            "report": retained_report, "landcover": artifact,
            "original_workspace_directory": original.relative_to(workspace.root).as_posix(),
            "transfer": transfer,
        },
    }


def reuse_prepared_landcover(workspace, run_id, directory):
    """Adopt exact completed categorical inputs before original native execution.

    Prefer this run's complete footprint, then an equivalent parameter variant.
    Missing/superseded inputs fall back to the original compiler. A selected
    donor must verify its original report/raster and saved source identities.
    """
    base = workspace.root / OUTPUT_ROOT
    if not base.is_dir():
        return None
    run_id = identifier(run_id)
    directory = Path(directory).resolve()
    if directory != (workspace.root / "runs" / run_id).resolve():
        raise ValueError("Prepared land cover must belong to its current native run")
    (run, selection, grid, profile, scenario, target_codes,
     baseline, sources, request) = _preview_inputs(workspace, run_id)
    if scenario["kind"] != "landcover":
        return None
    original = base / digest(request)
    manifest_path = original / "complete.json"
    if manifest_path.exists():
        return _adopt_prepared_landcover(
            workspace, directory, original, read_json(manifest_path), request,
            request, profile, scenario, profile, scenario, target_codes)
    for original, manifest, candidate, donor_profile, donor_scenario in _equivalent_previews(
            workspace, base, request, profile, scenario):
        return _adopt_prepared_landcover(
            workspace, directory, original, manifest, candidate, request,
            donor_profile, donor_scenario, profile, scenario, target_codes)
    return None


def preview_run(workspace, run_id):
    """Compile an existing native selection without starting NDR/SDR.

    The original run ID retains selected-model semantics from the current core.
    A completed identical footprint reopens with its original timestamps and hashes.
    """
    (run, selection, grid, profile, scenario, target_codes,
     baseline, sources, request) = _preview_inputs(workspace, run_id)
    key = digest(request)
    base = workspace.root / OUTPUT_ROOT
    base.mkdir(parents=True, exist_ok=True)
    directory = base / key
    with held(workspace.root / ".workspace.lock"), held(base / (key + ".lock")):
        manifest_path = directory / "complete.json"
        if manifest_path.exists():
            manifest = read_json(manifest_path)
            if manifest["request"] != request:
                raise ValueError("The retained footprint belongs to another native selection")
            return _retain_record(workspace, directory, manifest)
        if directory.exists():
            raise ValueError("The footprint destination contains an incomplete foreign directory")
        # The original archive excludes source-views, including this transient
        # staging area. Only atomically completed outputs enter a backup.
        staging = base / "source-views"
        staging.mkdir(exist_ok=True)
        for abandoned in staging.glob(key + "-*"):
            if abandoned.is_dir() and not abandoned.is_symlink():
                shutil.rmtree(abandoned)
        staged = Path(tempfile.mkdtemp(prefix=key + "-", dir=staging))
        try:
            report = apply_scenario(
                baseline, staged / "scenario_lulc.tif", grid["grid"],
                scenario.get("patches", []),
                source_loader=lambda sid: sources[sid],
                allowed_codes=set(profile["table_summary"]["lucodes"]),
                change_mask=staged / "net-change-mask.tif")
            final_codes = [row["code"] for row in report["final_classes"]]
            fields, coefficients, table_entry = _coefficient_rows(workspace, profile, set(final_codes) | set(target_codes))
            report.update(title=scenario["title"] + " - native input footprint",
                          created_at=now(), run_id=run_id, selection=selection,
                          request=request, coefficient_columns=fields,
                          coefficient_rows=coefficients, declared_target_codes=target_codes,
                          coefficient_source_collection_id=profile["source_collection_id"],
                          coefficient_source={k: copy.deepcopy(table_entry[k]) for k in
                                              ("id", "title", "uri", "vintage", "body") if k in table_entry})
            report["preview"] = _preview_png(staged / "net-change-mask.tif", staged / "net-change-preview.png")
            atomic_json(staged / "footprint.json", report)
            _write_csv(staged / "final-transitions.csv",
                       ("from_code", "to_code", "cells", "hectares"), report["transitions"])
            _write_csv(staged / "final-classes.csv", ("code", "cells", "hectares"), report["final_classes"])
            _write_csv(staged / "actual-coefficient-rows.csv", fields, coefficients)
            patch_fields = ("patch_number", "from_code", "to_code", "cells", "hectares")
            patch_rows = [{**row, "patch_number": patch["index"] + 1}
                          for patch in report["patches"] for row in patch["transitions"]]
            _write_csv(staged / "patch-transitions.csv", patch_fields, patch_rows)
            files = {name: describe_file(staged, staged / filename) for name, filename in {
                "scenario_lulc": "scenario_lulc.tif", "net_change_mask": "net-change-mask.tif",
                "report": "footprint.json", "final_transitions": "final-transitions.csv",
                "final_classes": "final-classes.csv", "coefficient_rows": "actual-coefficient-rows.csv",
                "patch_transitions": "patch-transitions.csv", "preview": "net-change-preview.png"}.items()}
            manifest = {"schema": "upstate.scenario-footprint-files/v1",
                        "request": request, "files": files}
            atomic_json(staged / "complete.json", manifest)
            os.replace(staged, directory)
            return _retain_record(workspace, directory, manifest)
        finally:
            if staged.exists():
                shutil.rmtree(staged)


def get_footprint(workspace, key, *, verify=True):
    value = workspace._get(RECORD_KIND, key)
    if verify:
        for item in value["files"].values():
            verify_file(workspace.root, item)
    return value


def list_footprints(workspace):
    return workspace._list(RECORD_KIND)


def main(argv=None):
    from .workspace import Workspace
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args(argv)
    result = preview_run(Workspace(args.workspace), args.run_id)
    print(json.dumps(result, ensure_ascii=False, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
