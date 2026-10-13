"""Prepare an explicitly selected SSURGO component K variant on the native grid."""
from __future__ import annotations
import argparse
from contextlib import ExitStack
from decimal import Decimal
import json
import os
from pathlib import Path

from model import rasters
from model.common import (atomic_json, describe_file, digest, file_digest,
                          held, read_json, verify_file)
from source_tools import soil_components as components, soil_region
from source_tools.soil_sources import K_FACTOR, K_REFERENCE, K_UNITS, SERVICE


def prepare(component_capture, selection, reference, output, *,
            null_policy="preserve", tile_size=512, model_use="comparison", analyst_note=""):
    import numpy as np
    import rasterio
    from rasterio.features import rasterize
    from rasterio.transform import Affine
    from rasterio.vrt import WarpedVRT
    from rasterio.windows import Window, bounds as window_bounds
    from pyproj import CRS, Transformer
    import shapely
    from shapely.geometry import mapping
    from shapely.ops import transform, unary_union

    if null_policy not in ("preserve", "nlcd-water-zero"):
        raise ValueError("Choose preserve or explicit original-NLCD open-water zero")
    if type(tile_size) is not int or not 1 <= tile_size <= 1024:
        raise ValueError("Choose a raster tile size from 1 to 1024")
    if model_use not in ("comparison", "model") or not isinstance(analyst_note, str):
        raise ValueError("Choose comparison or model use and retain the analyst note")
    if model_use == "model" and not analyst_note.strip():
        raise ValueError("Record why this exact interpretation is selected as model K")
    chosen = components.selection(selection)
    source_root = Path(component_capture).resolve(strict=True)
    record, source_plan = components.verify_capture(source_root)
    if not record.get("regional_capture"):
        raise ValueError("This original interpretation reference has no polygon geometry. "
                         "Use its table comparison, or select a completed original regional capture for raster preparation.")
    regional_root = source_root / record["regional_capture"]
    regional_record = read_json(regional_root / "capture.json")
    regional_plan = read_json(regional_root / "plan.json")
    # components.verify_capture above already verified this entire native capture.
    root = Path(output).resolve()
    if root == source_root or source_root in root.parents or root in source_root.parents:
        raise ValueError("Use a separate immutable raster preparation directory")
    root.mkdir(parents=True, exist_ok=True)
    with held(root / "prepare.lock", blocking=False):
        with rasterio.open(reference) as ref:
            crs = CRS.from_user_input(ref.crs)
            if ref.count != 1 or not crs.is_projected or not all(
                    abs(axis.unit_conversion_factor - 1) < 1e-12 for axis in crs.axis_info):
                raise ValueError("Use the original single-band numeric NLCD in projected metres")
        core, _, domain_info, _, _ = soil_region._domain(
            regional_root / regional_record["domain_manifest"],
            regional_plan["domain"]["source_id"], crs)
        model_domain = core.buffer(regional_plan["buffer_m"])
        grid = rasters.grid_definition(reference, model_domain)
        affine = Affine(*grid["transform"])
        if affine.a != 30 or affine.e != -30 or affine.b or affine.d:
            raise ValueError("Use the exact original unrotated 30 metre soil model grid")
        geometry = read_json(regional_root / "geometry-capture.json")
        to_grid = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
        to_native = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
        support = unary_union([shapely.from_wkt(t["native_aoi_wkt"]) for t in geometry["tiles"]])
        support = transform(to_grid.transform, shapely.segmentize(support, 0.001))
        if not support.buffer(0.001).covers(model_domain):
            raise ValueError("Selected raster domain extends outside original captured soil geography")
        plan = {"schema": "upstate.soil-component-raster-plan/v1",
                "capture_sha256": file_digest(source_root / "capture.json"),
                "capture_plan_sha256": record["plan_sha256"],
                "selection": chosen, "reference_sha256": file_digest(reference),
                "grid": grid, "null_policy": null_policy, "tile_size": tile_size,
                "model_use": model_use, "analyst_note": analyst_note,
                "customary_to_si_factor": str(K_FACTOR), "target_units": K_UNITS}
        atomic_json(root / "plan.json", plan, immutable=True)
        if (root / "source-entry.json").exists():
            entry = read_json(root / "source-entry.json")
            if entry["preparation_sha256"] != digest(plan):
                raise ValueError("Retained soil raster belongs to a different selection")
            for member in [entry, *entry["companions"]]:
                verify_file(root, member)
            atomic_json(root / "source-manifest.json", {"schema": "upstate.sources/v1",
                        "title": entry["title"], "entries": [entry]}, immutable=True)
            return entry
        prepared = components._prepare_projection_verified(
            source_root, record, source_plan, chosen, root / "interpretation")
        report = prepared["projection"]
        values = {int(row["mukey"]): components._decimal(row["value_customary"])
                  for row in report["mapunits"]}
        native = soil_region._coefficients(read_json(regional_root / "ratings.json")["batches"])
        if set(values) != set(native):
            raise ValueError("Variant and original native mapunit sets differ")
        profile = rasters.output_profile(grid)
        nodata = profile["nodata"]
        counts = {k: 0 for k in (
            "model_domain_cells", "variant_rated_cells", "variant_unrated_cells",
            "native_rated_cells", "no_polygon_cells", "different_mapunit_cells",
            "variant_conflicting_overlap_cells", "native_conflicting_overlap_cells",
            "open_water_zero_cells", "unresolved_land_cells", "same_support_cells",
            "changed_same_support_cells", "variant_only_cells", "native_only_cells")}
        low = high = delta_low = delta_high = None
        files = {"variant": "soil-k.tif", "native": "native-baseline-k.tif",
                 "difference": "difference-k.tif"}
        db = soil_region._database(regional_root / regional_record["polygon_index"], readonly=True)
        try:
            with ExitStack() as stack:
                stack.enter_context(rasterio.Env(GDAL_CACHEMAX=64 * 1024 * 1024))
                nlcd = stack.enter_context(rasterio.open(reference))
                cover = stack.enter_context(WarpedVRT(nlcd, crs=crs, transform=affine,
                    width=grid["width"], height=grid["height"],
                    resampling=rasterio.enums.Resampling.nearest))
                outputs = {key: stack.enter_context(rasterio.open(root / (name + ".partial"),
                                                                "w", **profile))
                           for key, name in files.items()}
                for row in range(0, grid["height"], tile_size):
                    for col in range(0, grid["width"], tile_size):
                        width = min(tile_size, grid["width"] - col)
                        height = min(tile_size, grid["height"] - row)
                        window = Window(col, row, width, height)
                        target = affine * Affine.translation(col, row)
                        shape = (height, width)
                        selected = rasterize([(mapping(model_domain), 1)], out_shape=shape,
                            transform=target, fill=0, dtype="uint8",
                            all_touched=False).astype(bool)
                        if not selected.any():
                            for out in outputs.values():
                                out.write(np.full(shape, nodata, dtype="float32"), 1, window=window)
                            continue
                        bounds = window_bounds(window, affine)
                        bbox = to_native.transform_bounds(bounds[0] - 30, bounds[1] - 30,
                            bounds[2] + 30, bounds[3] + 30, densify_pts=101)
                        shapes = soil_region._captured_shapes(db, bbox, to_grid, values)
                        def burn(items):
                            return rasterize(items, out_shape=shape, transform=target,
                                fill=0, dtype="int32", all_touched=False) if items else np.zeros(shape, dtype="int32")
                        ordered = sorted(shapes, key=lambda item: item[1])
                        labels = burn(ordered)
                        different = (labels != burn(list(reversed(ordered)))) & selected
                        lc = cover.read(1, window=window, masked=True)
                        water = (np.ma.getdata(lc) == 11) & ~np.ma.getmaskarray(lc) & selected
                        def coefficients(coefficients):
                            mismatch = np.zeros(shape, dtype=bool)
                            if different.any():
                                unique = sorted({coefficients[k] for _, k in shapes},
                                    key=lambda v: (v is not None, v if v is not None else Decimal(0)))
                                ranks = {v: i + 1 for i, v in enumerate(unique)}
                                ranked = sorted([(g, ranks[coefficients[k]]) for g, k in shapes],
                                                key=lambda item: item[1])
                                mismatch = different & (burn(ranked) != burn(list(reversed(ranked))))
                            data = np.full(shape, nodata, dtype="float32")
                            rated = np.zeros(shape, dtype=bool)
                            for key in np.unique(labels[selected]):
                                key = int(key)
                                if key and coefficients[key] is not None:
                                    cells = (labels == key) & selected & ~mismatch
                                    data[cells] = float(coefficients[key] * K_FACTOR)
                                    rated[cells] = True
                            zeros = water & ~rated & ~mismatch if null_policy == "nlcd-water-zero" else np.zeros(shape, dtype=bool)
                            data[zeros] = 0
                            return data, rated, zeros, mismatch
                        current, rated, zeros, mismatch = coefficients(values)
                        baseline, native_rated, native_zeros, native_mismatch = coefficients(native)
                        valid = rated | zeros
                        native_valid = native_rated | native_zeros
                        common = valid & native_valid
                        delta = np.full(shape, nodata, dtype="float32")
                        delta[common] = current[common] - baseline[common]
                        outputs["variant"].write(current, 1, window=window)
                        outputs["native"].write(baseline, 1, window=window)
                        outputs["difference"].write(delta, 1, window=window)
                        increments = {
                            "model_domain_cells": selected, "variant_rated_cells": rated,
                            "variant_unrated_cells": (labels > 0) & selected & ~rated & ~mismatch,
                            "native_rated_cells": native_rated,
                            "no_polygon_cells": (labels == 0) & selected,
                            "different_mapunit_cells": different,
                            "variant_conflicting_overlap_cells": mismatch,
                            "native_conflicting_overlap_cells": native_mismatch,
                            "open_water_zero_cells": zeros,
                            "unresolved_land_cells": selected & ~valid & ~water,
                            "same_support_cells": common,
                            "changed_same_support_cells": common & (current != baseline),
                            "variant_only_cells": valid & ~native_valid,
                            "native_only_cells": native_valid & ~valid}
                        for key, mask in increments.items():
                            counts[key] += int(mask.sum())
                        if valid.any():
                            low = float(current[valid].min()) if low is None else min(low, float(current[valid].min()))
                            high = float(current[valid].max()) if high is None else max(high, float(current[valid].max()))
                        if common.any():
                            delta_low = float(delta[common].min()) if delta_low is None else min(delta_low, float(delta[common].min()))
                            delta_high = float(delta[common].max()) if delta_high is None else max(delta_high, float(delta[common].max()))
                for kind, out in outputs.items():
                    out.update_tags(units=K_UNITS, source=SERVICE, null_policy=null_policy,
                        preparation_sha256=digest(plan), source_capture_sha256=plan["capture_sha256"],
                        original_attribute="chorizon." + ("kwfact" if kind == "native" else chosen["attribute"]),
                        interpretation="Dominant Condition / Surface Layer" if kind == "native" else json.dumps(chosen, sort_keys=True),
                        comparison_kind=kind, customary_to_si_factor=str(K_FACTOR),
                        model_use=model_use, analyst_note=analyst_note)
        finally:
            db.close()
        for name in files.values():
            pending = root / (name + ".partial")
            with pending.open("rb") as stream:
                os.fsync(stream.fileno())
            os.replace(pending, root / name)
        counts.update(minimum_si=low, maximum_si=high,
                      minimum_same_support_difference_si=delta_low,
                      maximum_same_support_difference_si=delta_high,
                      unique_mapunits=len(values), native_geometry_tiles=len(geometry["tiles"]),
                      difference_definition="variant minus native baseline on jointly valid cells",
                      source_projection_sha256=report["projection_sha256"])
        atomic_json(root / "coverage.json", counts, immutable=True)
        for member in record["files"]:
            soil_region._copy(verify_file(source_root, member), root / "capture" / member["path"], member)
        soil_region._copy(source_root / "capture.json", root / "capture" / "capture.json")
        title = ("USDA " + ("whole-soil Kw" if chosen["attribute"] == "kwfact" else "rock-free Kf") +
                 " — " + chosen["component_method"] + " / " + chosen["horizon_method"] +
                 " — " + ("selected model input" if model_use == "model" else "comparison"))
        companions = soil_region._members(root, {"soil-k.tif", "source-entry.json", "source-manifest.json"})
        entry = {**describe_file(root, root / "soil-k.tif"),
            "id": "usda-component-k-" + digest(plan)[:16], "title": title, "kind": "raster",
            "role": "K_FACTOR" if model_use == "model" else "SOIL_K_SCENARIO",
            "uri": SERVICE, "vintage": source_plan["vintage"], "units": K_UNITS,
            "resampling": "nearest", "grid": grid, "preparation_sha256": digest(plan),
            "native_attribute": "chorizon." + chosen["attribute"], "selection": chosen,
            "native_baseline": {"attribute": "chorizon.kwfact",
                "interpretation": "Dominant Condition / Surface Layer", "path": files["native"]},
            "model_use": model_use, "analyst_note": analyst_note, "observed": counts,
            "report_path": "interpretation/report.html",
            "projection_path": "interpretation/projection.json",
            "unit_conversion": {"factor": str(K_FACTOR), "applied": True,
                                "target_units": K_UNITS, "reference": K_REFERENCE},
            "null_policy": null_policy, "companions": companions}
        atomic_json(root / "source-entry.json", entry, immutable=True)
        atomic_json(root / "source-manifest.json", {"schema": "upstate.sources/v1",
                    "title": title, "entries": [entry]}, immutable=True)
        return entry


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capture", required=True)
    parser.add_argument("--selection", required=True)
    parser.add_argument("--reference", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--null-policy", choices=("preserve", "nlcd-water-zero"), default="preserve")
    parser.add_argument("--tile-size", type=int, default=512)
    parser.add_argument("--model-use", choices=("comparison", "model"), default="comparison")
    parser.add_argument("--analyst-note", default="")
    args = parser.parse_args(argv)
    result = prepare(args.capture, read_json(args.selection), args.reference, args.output,
                     null_policy=args.null_policy, tile_size=args.tile_size,
                     model_use=args.model_use, analyst_note=args.analyst_note)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
