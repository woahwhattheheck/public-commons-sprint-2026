"""Source-bound parcel export inventories and conservation context."""
from __future__ import annotations
import csv
import json
import math
from pathlib import Path
from contextlib import ExitStack
from .common import describe_file, finite
from . import rasters

def _sum(src, geometry, *, statistic="sum"):
    import numpy as np
    from rasterio.features import geometry_mask, geometry_window
    from rasterio.errors import WindowError
    from rasterio.windows import Window
    try:
        selected = geometry_window(src, [geometry.__geo_interface__])
    except WindowError:
        return {"sum": None, "mean": None, "valid_cells": 0, "selected_cells": 0}
    bh, bw = src.block_shapes[0]
    total, count, selected_count = 0.0, 0, 0
    for row in range(int(selected.row_off) // bh * bh, math.ceil(selected.row_off + selected.height), bh):
        for col in range(int(selected.col_off) // bw * bw, math.ceil(selected.col_off + selected.width), bw):
            window = Window(col, row, min(bw, src.width-col), min(bh, src.height-row))
            data = src.read(1, window=window, masked=True)
            inside = geometry_mask([geometry.__geo_interface__], out_shape=data.shape,
                                   transform=src.window_transform(window), invert=True, all_touched=False)
            good = inside & ~np.ma.getmaskarray(data) & np.isfinite(data.data)
            selected_count += int(np.count_nonzero(inside))
            count += int(np.count_nonzero(good))
            total += float(np.sum(data.data[good], dtype="float64"))
    return {"sum": total if count else None, "mean": total / count if count else None,
            "valid_cells": count, "selected_cells": selected_count}

def parcel_inventory(workspace, selection, grid, mass_paths, priority_path, comparison,
                     directory, *, protected, drinking_water, high_quality_water):
    import fiona
    import rasterio
    from pyproj import CRS
    from shapely.geometry import mapping, MultiPolygon
    from shapely.ops import unary_union
    from .common import verify_file
    source, entry = workspace.source_file(selection["source_collection_id"], selection["source_id"])
    crs = CRS.from_user_input(grid["grid"]["crs"])
    rows, _ = rasters.vector_geometry(source, layer=selection.get("layer") or entry.get("layer"),
                                      where=selection.get("where"), target_crs=crs)
    boundary_path = verify_file(workspace.root / "grids" / grid["id"], grid["files"]["reporting_area"])
    boundary_rows, _ = rasters.vector_geometry(boundary_path, target_crs=crs)
    reporting = rasters.polygon_union(boundary_rows)
    id_field = selection.get("id_field")
    selected_rows, identities = [], set()
    for row in rows:
        if row["geometry"].geom_type not in ("Polygon", "MultiPolygon"):
            raise ValueError("Parcel priorities require original polygon geometry")
        if not row["geometry"].intersects(reporting):
            continue
        feature_id = str(row["properties"].get(id_field)) if id_field else row["id"]
        if id_field and row["properties"].get(id_field) is None:
            raise ValueError("Selected parcel identity field has a null value")
        if feature_id in identities:
            raise ValueError("Parcel feature identities must be unique; select the native feature ID when parcel numbers repeat")
        identities.add(feature_id)
        selected_rows.append((feature_id, row))
    if not selected_rows:
        raise ValueError("The selected parcel source has no polygons in the reporting area")
    protected_geometry = unary_union([r["geometry"] for r in protected["features"]])
    drinking_geometry = unary_union([r["geometry"] for r in drinking_water["features"]])
    high_quality_geometry = unary_union([r["geometry"] for r in high_quality_water["features"]])
    buffer_m = finite(selection.get("high_quality_buffer_m", 0), "High-quality-water context buffer", minimum=0)
    if buffer_m:
        high_quality_geometry = high_quality_geometry.buffer(buffer_m)
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    gpkg, csv_path = directory / "parcel-priorities.gpkg", directory / "parcel-priorities.csv"
    gpkg.unlink(missing_ok=True)
    schema = {"geometry": "MultiPolygon", "properties": {
        "feature_id": "str", "original_attributes": "str", "area_ha": "float",
        "reporting_area_ha": "float", "protected_fraction": "float", "source_water": "int",
        "high_quality_context": "int", "nitrogen_kg_year": "float", "phosphorus_kg_year": "float",
        "sediment_t_year": "float", "priority_mean": "float", "valid_pixels": "int",
        "coverage_fraction": "float", "scenario_changes": "str",
    }}
    outputs, no_pixels = [], 0
    coverage_parts, coverage_batch = [], []
    compare_root = workspace.root / "comparisons" / comparison["id"]
    with ExitStack() as stack:
        originals = {key: stack.enter_context(rasterio.open(path)) for key, path in mass_paths.items()}
        priority = stack.enter_context(rasterio.open(priority_path))
        scenarios = {}
        for alternative in comparison["alternatives"]:
            scenarios[alternative["run_id"]] = {
                key: stack.enter_context(rasterio.open(verify_file(compare_root, artifact)))
                for key, artifact in alternative["artifacts"].items()}
        stack.enter_context(rasters.vector_environment())
        writer = stack.enter_context(fiona.open(gpkg, "w", driver="GPKG", layer="parcel_priorities",
                                                 crs_wkt=crs.to_wkt(), schema=schema))
        csv_file = stack.enter_context(csv_path.open("w", encoding="utf-8", newline=""))
        csv_writer = csv.DictWriter(csv_file, fieldnames=list(schema["properties"]))
        csv_writer.writeheader()
        for feature_id, row in selected_rows:
            original_geometry = row["geometry"]
            clipped = original_geometry.intersection(reporting)
            if clipped.is_empty or clipped.area <= 0:
                continue
            coverage_batch.append(clipped)
            if len(coverage_batch) >= 512:
                coverage_parts.append(unary_union(coverage_batch))
                coverage_batch.clear()
            # Each original parcel is evaluated independently, so overlapping native
            # records remain visible rather than silently replacing one another.
            quantities = {key: _sum(src, clipped) for key, src in originals.items()}
            score = _sum(priority, clipped)
            no_pixels += int(score["valid_cells"] == 0)
            changes = {run_id: {key: _sum(src, clipped)["sum"] for key, src in layer_set.items()}
                       for run_id, layer_set in scenarios.items()}
            protected_area = clipped.intersection(protected_geometry).area if clipped.intersects(protected_geometry) else 0.0
            properties = {
                "feature_id": feature_id, "original_attributes": json.dumps(row["properties"], ensure_ascii=False, sort_keys=True),
                "area_ha": original_geometry.area / 10000, "reporting_area_ha": clipped.area / 10000,
                "protected_fraction": min(1, max(0, protected_area / clipped.area)),
                "source_water": int(clipped.intersects(drinking_geometry)),
                "high_quality_context": int(clipped.intersects(high_quality_geometry)),
                "nitrogen_kg_year": quantities["nitrogen_export"]["sum"],
                "phosphorus_kg_year": quantities["phosphorus_export"]["sum"],
                "sediment_t_year": quantities["sediment_export"]["sum"],
                "priority_mean": score["mean"], "valid_pixels": score["valid_cells"],
                "coverage_fraction": score["valid_cells"] / score["selected_cells"] if score["selected_cells"] else 0.0,
                "scenario_changes": json.dumps(changes, sort_keys=True),
            }
            geometry = original_geometry if original_geometry.geom_type == "MultiPolygon" else MultiPolygon([original_geometry])
            writer.write({"geometry": mapping(geometry), "properties": properties})
            csv_writer.writerow(properties)
            outputs.append({"feature_id": feature_id, "priority_mean": score["mean"],
                            "source_water": properties["source_water"],
                            "protected_fraction": properties["protected_fraction"]})
    if coverage_batch:
        coverage_parts.append(unary_union(coverage_batch))
    covered_area = unary_union(coverage_parts).area
    reporting_area = reporting.area
    coverage = {"method": "Geometric union of selected native parcel polygons clipped to the reporting mask",
                "reporting_area_ha": reporting_area / 10000,
                "parcel_footprint_area_ha": covered_area / 10000,
                "reporting_fraction": min(1.0, max(0.0, covered_area / reporting_area)),
                "uncovered_reporting_area_ha": max(0.0, reporting_area - covered_area) / 10000,
                "overlap_handling": "Each covered area is counted once in this footprint"}
    return {"schema": "upstate.parcel-priorities/v1", "source": {
                "uri": entry["uri"], "vintage": entry["vintage"], "sha256": entry["body"]["sha256"],
                "selection": selection, "scope": entry.get("scope")},
            "features": len(outputs), "features_without_valid_pixels": no_pixels,
            "parcel_coverage": coverage,
            "selection": "Original feature identity; per-parcel reporting-area intersection; pixel-centre aggregation",
            "high_quality_buffer_m": buffer_m,
            "overlap_handling": "Native overlapping parcels are retained independently; parcel sums are not a basin mass balance",
            "scenario_direction": "alternative minus baseline", "units": rasters.MASS_UNITS,
            "files": {"geopackage": describe_file(directory, gpkg), "csv": describe_file(directory, csv_path)},
            "top_by_current_priority": sorted((r for r in outputs if r["priority_mean"] is not None),
                                              key=lambda r: (-r["priority_mean"], r["feature_id"]))[:50]}
