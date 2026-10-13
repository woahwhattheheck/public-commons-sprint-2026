"""Source-bound parcel export inventories and conservation context."""
from __future__ import annotations
import csv
import json
import math
from pathlib import Path
from contextlib import ExitStack
from .common import describe_file, finite
from . import rasters
from .source_lineage import LINEAGE_VERSION, source_snapshot, write_lineage

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
    from .parcel_aggregate import aggregate_layers
    source, entry = workspace.source_file(selection["source_collection_id"], selection["source_id"])
    crs = CRS.from_user_input(grid["grid"]["crs"])
    rows, _ = rasters.vector_geometry(source, layer=selection.get("layer") or entry.get("layer"),
                                      where=selection.get("where"), target_crs=crs)
    boundary_path = verify_file(workspace.root / "grids" / grid["id"], grid["files"]["reporting_area"])
    boundary_rows, _ = rasters.vector_geometry(boundary_path, target_crs=crs)
    reporting = rasters.polygon_union(boundary_rows)
    id_field = selection.get("id_field") or entry.get("id_field")
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
        clipped = row["geometry"].intersection(reporting)
        if clipped.is_empty or clipped.area <= 0:
            continue
        selected_rows.append((feature_id, row, clipped))
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
    scenario_csv_path = directory / "parcel-scenarios.csv"
    gpkg.unlink(missing_ok=True)
    schema = {"geometry": "MultiPolygon", "properties": {
        "feature_id": "str", "original_attributes": "str", "area_ha": "float",
        "reporting_area_ha": "float", "protected_fraction": "float", "source_water": "int",
        "high_quality_context": "int", "nitrogen_kg_year": "float", "phosphorus_kg_year": "float",
        "sediment_t_year": "float", "priority_mean": "float", "valid_pixels": "int",
        "coverage_fraction": "float", "scenario_changes": "str", "selected_pixels": "int",
        "nitrogen_valid_pixels": "int", "nitrogen_coverage_fraction": "float", "nitrogen_valid_area_ha": "float",
        "phosphorus_valid_pixels": "int", "phosphorus_coverage_fraction": "float", "phosphorus_valid_area_ha": "float",
        "sediment_valid_pixels": "int", "sediment_coverage_fraction": "float", "sediment_valid_area_ha": "float",
        "scenario_coverage": "str",
    }}
    quantity_units = {"nitrogen_export": "kg/year", "phosphorus_export": "kg/year", "sediment_export": "t/year"}
    outputs, no_pixels = [], 0
    coverage_parts, coverage_batch = [], []
    compare_root = workspace.root / "comparisons" / comparison["id"]
    with ExitStack() as stack:
        originals = {key: stack.enter_context(rasterio.open(path)) for key, path in mass_paths.items()}
        priority = stack.enter_context(rasterio.open(priority_path))
        transform = priority.transform
        pixel_area_ha = abs(transform.a * transform.e - transform.b * transform.d) / 10000
        scenarios, alternatives = {}, {}
        for alternative in comparison["alternatives"]:
            run_id = alternative["run_id"]
            scenarios[run_id] = {
                key: stack.enter_context(rasterio.open(verify_file(compare_root, artifact)))
                for key, artifact in alternative["artifacts"].items()}
            retained_run = workspace.inspect_run(run_id)
            run_root = workspace.root / "runs" / run_id
            alternatives[run_id] = {
                key: stack.enter_context(rasterio.open(verify_file(run_root, retained_run["artifacts"][key])))
                for key in scenarios[run_id]}
        layer_sources = {**originals, "priority": priority}
        for run_id, layer_set in scenarios.items():
            layer_sources.update({"scenario/" + run_id + "/" + key: src for key, src in layer_set.items()})
            layer_sources.update({"alternative/" + run_id + "/" + key: src for key, src in alternatives[run_id].items()})
        aggregates, processing = aggregate_layers(layer_sources, [clipped for _, _, clipped in selected_rows])
        stack.enter_context(rasters.vector_environment())
        writer = stack.enter_context(fiona.open(gpkg, "w", driver="GPKG", layer="parcel_priorities",
                                                 crs_wkt=crs.to_wkt(), schema=schema))
        csv_file = stack.enter_context(csv_path.open("w", encoding="utf-8", newline=""))
        csv_writer = csv.DictWriter(csv_file, fieldnames=list(schema["properties"]))
        csv_writer.writeheader()
        scenario_file = stack.enter_context(scenario_csv_path.open("w", encoding="utf-8", newline=""))
        scenario_writer = csv.DictWriter(scenario_file, fieldnames=[
            "feature_id", "scenario_run_id", "pollutant", "baseline_total", "scenario_total", "change", "units",
            "polygon_area_ha", "selected_pixels", "valid_pixels", "coverage_fraction",
            "baseline_valid_pixels", "scenario_valid_pixels", "paired_valid_pixels",
            "baseline_valid_area_ha", "scenario_valid_area_ha", "paired_valid_area_ha",
            "baseline_only_area_ha", "scenario_only_area_ha", "paired_fraction_of_union_valid_area"])
        scenario_writer.writeheader()
        for index, (feature_id, row, clipped) in enumerate(selected_rows):
            original_geometry = row["geometry"]
            coverage_batch.append(clipped)
            if len(coverage_batch) >= 512:
                coverage_parts.append(unary_union(coverage_batch))
                coverage_batch.clear()
            # Every native parcel has its own statistics, including overlaps.
            quantities = {key: aggregates[key][index] for key in originals}
            score = aggregates["priority"][index]
            no_pixels += int(score["valid_cells"] == 0)
            changes, scenario_coverage = {}, {}
            for run_id, layer_set in scenarios.items():
                changes[run_id], scenario_coverage[run_id] = {}, {}
                for key in layer_set:
                    value = aggregates["scenario/" + run_id + "/" + key][index]
                    baseline_value = quantities[key]
                    alternative_value = aggregates["alternative/" + run_id + "/" + key][index]
                    changes[run_id][key] = value["sum"]
                    baseline_valid = baseline_value["valid_cells"]
                    scenario_valid = alternative_value["valid_cells"]
                    paired_valid = value["valid_cells"]
                    if paired_valid > min(baseline_valid, scenario_valid):
                        raise ValueError("Scenario difference coverage exceeds its retained baseline or alternative")
                    union_valid = baseline_valid + scenario_valid - paired_valid
                    support = {"selected_pixels": value["selected_cells"],
                               "valid_pixels": paired_valid, "coverage_fraction": value["coverage_fraction"],
                               "baseline_valid_pixels": baseline_valid, "scenario_valid_pixels": scenario_valid,
                               "paired_valid_pixels": paired_valid,
                               "baseline_valid_area_ha": baseline_valid * pixel_area_ha,
                               "scenario_valid_area_ha": scenario_valid * pixel_area_ha,
                               "paired_valid_area_ha": paired_valid * pixel_area_ha,
                               "baseline_only_area_ha": (baseline_valid - paired_valid) * pixel_area_ha,
                               "scenario_only_area_ha": (scenario_valid - paired_valid) * pixel_area_ha,
                               "paired_fraction_of_union_valid_area": paired_valid / union_valid if union_valid else None}
                    scenario_coverage[run_id][key] = support
                    scenario_writer.writerow({
                        "feature_id": feature_id, "scenario_run_id": run_id, "pollutant": key,
                        "baseline_total": baseline_value["sum"], "scenario_total": alternative_value["sum"],
                        "change": value["sum"], "units": quantity_units[key],
                        "polygon_area_ha": clipped.area / 10000, **support})
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
                "coverage_fraction": score["coverage_fraction"],
                "selected_pixels": score["selected_cells"],
                "scenario_changes": json.dumps(changes, sort_keys=True),
                "scenario_coverage": json.dumps(scenario_coverage, sort_keys=True),
            }
            for pollutant in ("nitrogen", "phosphorus", "sediment"):
                value = quantities[pollutant + "_export"]
                properties[pollutant + "_valid_pixels"] = value["valid_cells"]
                properties[pollutant + "_coverage_fraction"] = value["coverage_fraction"]
                properties[pollutant + "_valid_area_ha"] = value["valid_cells"] * pixel_area_ha
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
    source = source_snapshot(entry, selection)
    lineage_files = write_lineage(directory, {"parcels": source}, relative_to=directory)
    return {"schema": "upstate.parcel-priorities/v1", "source_lineage_version": LINEAGE_VERSION, "source": {
                "uri": entry["uri"], "vintage": entry["vintage"], "sha256": entry["body"]["sha256"],
                "selection": ({**selection, "id_field": id_field} if id_field else dict(selection)),
                "scope": entry.get("scope"), "metadata": source["metadata"],
                "source_collection_id": selection["source_collection_id"], "source_id": entry["id"]},
            "features": len(outputs), "features_without_valid_pixels": no_pixels,
            "parcel_coverage": coverage, "processing": processing,
            "selection": "Original feature identity; per-parcel reporting-area intersection; pixel-centre aggregation",
            "high_quality_buffer_m": buffer_m,
            "overlap_handling": "Native overlapping parcels are retained independently; parcel sums are not a basin mass balance",
            "scenario_direction": "alternative minus baseline", "units": rasters.MASS_UNITS,
            "quantity_units": quantity_units, "pixel_area_ha": pixel_area_ha,
            "comparison": {"id": comparison["id"], "baseline_run_id": comparison["baseline_run_id"],
                           "scenario_run_ids": [alternative["run_id"] for alternative in comparison["alternatives"]]},
            "coverage_fields": {
                "selected_pixels": "Raster cell centres selected by the parcel's reporting-area intersection",
                "valid_pixels": "Finite unmasked priority cells; legacy priority coverage fields are retained",
                "pollutant_coverage": "Each pollutant's own finite unmasked cells divided by selected_pixels",
                "scenario_coverage": "Each native difference layer's finite paired cells, with the original baseline and alternative support",
                "scenario_totals": "Baseline and alternative totals use their own valid support; change is summed on paired difference support",
            },
            "files": {"geopackage": describe_file(directory, gpkg), "csv": describe_file(directory, csv_path),
                      "scenario_csv": describe_file(directory, scenario_csv_path), **lineage_files},
            "top_by_current_priority": sorted((r for r in outputs if r["priority_mean"] is not None),
                                              key=lambda r: (-r["priority_mean"], r["feature_id"]))[:50]}
