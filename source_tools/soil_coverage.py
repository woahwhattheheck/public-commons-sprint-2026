"""Measure prepared native soil coverage by the original Upper Savannah HUC12s.

Run after either maintained native soil preparation has completed. This reads the prepared
physical K raster and the same numeric land-cover source; it does not run InVEST.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import os
from pathlib import Path

from model.common import atomic_bytes, atomic_json, describe_file, digest, file_digest, held, read_json
from model import rasters

OPERATION_ID = "ECOSYSTEM-SCIENCES-SPRINT-20261012-KFACTOR-NATIVE"
FLAG_DOMAIN = 1
FLAG_K_VALID = 2
FLAG_K_NODATA = 4
FLAG_K_INVALID = 8
FLAG_NLCD_VALID = 16
FLAG_WATER = 32
FLAG_REPORTING = 64
FLAGS = {
    "1": "Inside the actual buffered model domain",
    "2": "K is finite and nonnegative",
    "4": "K is source NoData",
    "8": "K has data but is negative or nonfinite",
    "16": "Original land-cover source has a finite valid value",
    "32": "Original land-cover value is 11, open water",
    "64": "Inside the selected reporting geometry",
}
COUNT_FIELDS = (
    "cells", "model_cells", "outside_model_cells", "k_valid_cells",
    "k_nodata_cells", "k_invalid_cells", "nlcd_nodata_cells", "water_cells",
    "water_k_zero_cells", "water_k_unresolved_cells", "land_k_unresolved_cells",
    "joint_valid_cells",
)


def bound_file(path, expected_sha=None, expected_bytes=None):
    path = Path(path).resolve(strict=True)
    size = path.stat().st_size
    sha = file_digest(path)
    if expected_sha is not None and sha != expected_sha:
        raise ValueError("Selected source bytes differ: " + str(path))
    if expected_bytes is not None and size != expected_bytes:
        raise ValueError("Selected source length differs: " + str(path))
    return {"path": str(path), "bytes": size, "sha256": sha}


def source_context(root, plan, entry):
    """Resolve both maintained preparations and their retained original domain."""
    if plan.get("schema") == "upstate.sda-whole-soil-source/v1":
        return {**plan, "domain_reader": "native-vector"}, {}
    if plan.get("schema") != "upstate.regional-soil-preparation/v1":
        raise ValueError("Select a completed maintained native K preparation")
    capture_root = (root / "capture").resolve(strict=True)
    inputs = {}
    for key, name in (("regional_capture", "capture/capture.json"),
                      ("regional_plan", "capture/plan.json")):
        members = [item for item in entry["companions"] if item["path"] == name]
        if len(members) != 1:
            raise ValueError("Regional K entry lacks one retained companion: " + name)
        item = members[0]
        inputs[key] = bound_file(root / name, item["sha256"], item["bytes"])
    capture = read_json(capture_root / "capture.json")
    captured_plan = read_json(capture_root / "plan.json")
    if (capture.get("schema") != "upstate.regional-soil-capture/v1"
            or capture.get("state") != "complete"
            or inputs["regional_capture"]["sha256"] != plan["capture_sha256"]
            or capture["plan_sha256"] != digest(captured_plan)
            or capture["plan_sha256"] != plan["capture_plan_sha256"]):
        raise ValueError("Regional K preparation differs from its original capture")
    if (captured_plan.get("schema") != "upstate.regional-soil-plan/v1"
            or captured_plan["target_units"] != entry["units"]
            or captured_plan["vintage"] != entry["vintage"]):
        raise ValueError("Regional soil context has different physical units or vintage")

    def retained(name):
        members = [item for item in capture["files"] if item["path"] == name]
        if len(members) != 1:
            raise ValueError("Regional capture lacks one original binding: " + name)
        path = (capture_root / name).resolve(strict=True)
        if not path.is_relative_to(capture_root):
            raise ValueError("Regional companion is outside its captured source directory")
        item = members[0]
        return bound_file(path, item["sha256"], item["bytes"])

    inputs["regional_plan"] = retained("plan.json")
    manifest_name = capture["domain_manifest"]
    inputs["regional_domain_manifest"] = retained(manifest_name)
    manifest = read_json(inputs["regional_domain_manifest"]["path"])
    if manifest.get("schema") != "upstate.sources/v1":
        raise ValueError("Select the regional capture's retained domain manifest")
    source_id = captured_plan["domain"]["source_id"]
    matches = [item for item in manifest["entries"] if item["id"] == source_id]
    if (len(matches) != 1 or matches[0].get("kind") != "vector"
            or matches[0]["sha256"] != captured_plan["domain"]["source_sha256"]):
        raise ValueError("Regional soil domain differs from its original selected source")
    domain_entry = matches[0]
    binding_name = domain_entry["metadata"]["binding_file"]
    bindings = [item for item in domain_entry["companions"]
                if item["path"] == binding_name]
    if len(bindings) != 1:
        raise ValueError("Original regional domain lacks one feature-binding companion")
    binding_member = bindings[0]
    retained_name = (Path(manifest_name).parent / binding_name).as_posix()
    inputs["regional_domain_bindings"] = retained(retained_name)
    if (inputs["regional_domain_bindings"]["sha256"] != binding_member["sha256"]
            or inputs["regional_domain_bindings"]["bytes"] != binding_member["bytes"]):
        raise ValueError("Captured feature bindings differ from the selected original domain")
    return {
        "domain_sha256": domain_entry["sha256"],
        "domain_source_id": source_id,
        "domain_bindings_sha256": binding_member["sha256"],
        "domain_bindings_bytes": binding_member["bytes"],
        "domain_layer": None, "domain_filter": None,
        "buffer_m": captured_plan["buffer_m"],
        "vintage": captured_plan["vintage"], "source": captured_plan["source"],
        "domain_reader": "regional-original-esri",
    }, inputs

def regional_domain_rows(path, target_crs):
    """Use the same retained Esri-ring method as regional soil preparation."""
    import gzip
    from pyproj import CRS, Transformer
    from shapely.ops import transform, unary_union
    from source.capture_upstream_network import esri_polygon
    from .soil_sources import _polygons
    raw = Path(path).read_bytes()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    document = json.loads(raw)
    if document.get("geometryType") != "esriGeometryPolygon":
        raise ValueError("The regional preparation requires its original Esri polygon domain")
    sr = document["spatialReference"]
    native = CRS.from_user_input(sr.get("wkt") or (
        "EPSG:" + str(sr.get("latestWkid", sr.get("wkid")))))
    project = Transformer.from_crs(native, target_crs, always_xy=True)
    object_field = document["objectIdFieldName"]
    rows, corrections = [], []
    for feature in document["features"]:
        properties = dict(feature["attributes"])
        identity = str(properties[object_field])
        original = esri_polygon(feature.get("geometry"), corrections, identity)
        parts = [transform(project.transform, part) for part in _polygons(original)]
        if not parts:
            raise ValueError("Original regional HUC12 contains no polygon: " + identity)
        rows.append({"id": identity, "properties": properties,
                     "geometry": unary_union(parts)})
    return rows, corrections


def empty_stats():
    return {**{name: 0 for name in COUNT_FIELDS},
            "_sum_k": 0.0, "_minimum_k": None, "_maximum_k": None}


def accumulate(stats, flags, values, selected):
    import numpy as np
    selected = np.asarray(selected, dtype=bool)
    model = selected & ((flags & FLAG_DOMAIN) != 0)
    good = model & ((flags & FLAG_K_VALID) != 0)
    no_k = model & ((flags & FLAG_K_NODATA) != 0)
    bad_k = model & ((flags & FLAG_K_INVALID) != 0)
    cover = model & ((flags & FLAG_NLCD_VALID) != 0)
    water = cover & ((flags & FLAG_WATER) != 0)
    masks = {
        "cells": selected,
        "model_cells": model,
        "outside_model_cells": selected & ~model,
        "k_valid_cells": good,
        "k_nodata_cells": no_k,
        "k_invalid_cells": bad_k,
        "nlcd_nodata_cells": model & ~cover,
        "water_cells": water,
        "water_k_zero_cells": water & good & (values == 0),
        "water_k_unresolved_cells": water & ~good,
        "land_k_unresolved_cells": cover & ~water & ~good,
        "joint_valid_cells": cover & good,
    }
    for name, mask in masks.items():
        stats[name] += int(np.count_nonzero(mask))
    physical = values[good]
    if physical.size:
        stats["_sum_k"] += float(np.sum(physical, dtype=np.float64))
        low, high = float(physical.min()), float(physical.max())
        stats["_minimum_k"] = low if stats["_minimum_k"] is None else min(low, stats["_minimum_k"])
        stats["_maximum_k"] = high if stats["_maximum_k"] is None else max(high, stats["_maximum_k"])


def finish(stats, cell_area_ha):
    result = {key: stats[key] for key in COUNT_FIELDS}
    result.update(
        joint_valid_pct=100.0 * stats["joint_valid_cells"] / stats["cells"] if stats["cells"] else None,
        valid_area_ha=stats["joint_valid_cells"] * cell_area_ha,
        unresolved_land_area_ha=stats["land_k_unresolved_cells"] * cell_area_ha,
        minimum_k_si=stats["_minimum_k"],
        maximum_k_si=stats["_maximum_k"],
        mean_k_si=stats["_sum_k"] / stats["k_valid_cells"] if stats["k_valid_cells"] else None,
    )
    return result


def windows(width, height, block=512, col0=0, row0=0):
    from rasterio.windows import Window
    for row in range(row0, row0 + height, block):
        for col in range(col0, col0 + width, block):
            yield Window(col, row, min(block, col0 + width - col),
                         min(block, row0 + height - row))


def selected_mask(geometry, window, transform):
    import numpy as np
    from rasterio.features import geometry_mask
    from shapely.geometry import mapping
    if geometry is None or geometry.is_empty:
        return np.zeros((int(window.height), int(window.width)), dtype=bool)
    return geometry_mask(
        [mapping(geometry)], out_shape=(int(window.height), int(window.width)),
        transform=transform, all_touched=False, invert=True,
    )


def measure(geometry, soil, status, cell_area_ha, reporting=None):
    from rasterio.features import geometry_window
    from rasterio.errors import WindowError
    from shapely.geometry import box, mapping
    stats, reporting_stats = empty_stats(), empty_stats()
    grid_geometry = box(*soil.bounds)
    outside_area = float(geometry.difference(grid_geometry).area)
    try:
        window = geometry_window(soil, [mapping(geometry)], boundless=False)
    except WindowError:
        window = None
    if window is not None:
        for part in windows(int(window.width), int(window.height),
                            col0=int(window.col_off), row0=int(window.row_off)):
            transform = soil.window_transform(part)
            mask = selected_mask(geometry, part, transform)
            flags = status.read(1, window=part)
            values = soil.read(1, window=part)
            accumulate(stats, flags, values, mask)
            if reporting is not None:
                accumulate(reporting_stats, flags, values,
                           mask & ((flags & FLAG_REPORTING) != 0))
    return finish(stats, cell_area_ha), outside_area, finish(reporting_stats, cell_area_ha)


def build(soil_source, domain, bindings, reference, output, *,
          reporting=None, reporting_layer=None, reporting_where=None):
    import numpy as np
    import fiona
    import rasterio
    from rasterio.vrt import WarpedVRT
    from pyproj import CRS
    from shapely.geometry import MultiPolygon, mapping

    soil_source, output = Path(soil_source).resolve(), Path(output).resolve()
    plan = read_json(soil_source / "plan.json")
    entry = read_json(soil_source / "source-entry.json")
    if entry.get("kind") != "raster" or entry.get("role") != "K_FACTOR":
        raise ValueError("Select the completed native whole-soil source directory")
    if entry["preparation_sha256"] != digest(plan) or entry["units"] != plan["target_units"]:
        raise ValueError("K entry no longer matches its native preparation and physical units")
    context, context_inputs = source_context(soil_source, plan, entry)
    soil_path = (soil_source / entry["path"]).resolve(strict=True)
    if not soil_path.is_relative_to(soil_source):
        raise ValueError("K raster is outside its retained source directory")
    inputs = {**context_inputs,
        "soil": bound_file(soil_path, entry["sha256"], entry["bytes"]),
        "soil_plan": bound_file(soil_source / "plan.json"),
        "soil_entry": bound_file(soil_source / "source-entry.json"),
        "domain": bound_file(domain, context["domain_sha256"]),
        "domain_bindings": bound_file(bindings, context.get("domain_bindings_sha256"),
                                      context.get("domain_bindings_bytes")),
        "reference": bound_file(reference, plan["reference_sha256"]),
    }
    source_coverage = read_json(soil_source / "coverage.json")
    coverage_binding = next(item for item in entry["companions"] if item["path"] == "coverage.json")
    inputs["source_coverage"] = bound_file(
        soil_source / "coverage.json", coverage_binding["sha256"], coverage_binding["bytes"],
    )
    binding = read_json(bindings)
    if binding.get("schema") != "upstate.wbd-domain-bindings/v1":
        raise ValueError("Select the retained original WBD feature bindings")
    if context.get("domain_source_id") is not None and binding["source_id"] != context["domain_source_id"]:
        raise ValueError("Feature bindings select another original domain source")
    by_huc = {row["huc12"]: row for row in binding["features"]}
    if len(by_huc) != binding["feature_count"] or len(by_huc) != len(binding["features"]):
        raise ValueError("Original HUC12 feature bindings are not unique and complete")
    if any(len(huc) != 12 or not huc.isdigit() for huc in by_huc):
        raise ValueError("Original HUC12 identifiers must retain all twelve digits")

    with rasterio.open(soil_path) as soil:
        crs = CRS.from_user_input(soil.crs)
        if not crs.is_projected or any(abs(axis.unit_conversion_factor - 1) > 1e-12 for axis in crs.axis_info[:2]):
            raise ValueError("K source must retain its metric model CRS")
        if crs != CRS.from_user_input(plan["grid"]["crs"]):
            raise ValueError("K raster CRS differs from its declared native grid")
        if list(soil.transform)[:6] != plan["grid"]["transform"] or soil.width != plan["grid"]["width"] or soil.height != plan["grid"]["height"]:
            raise ValueError("K raster no longer matches its declared native grid")
        domain_corrections = []
        if context["domain_reader"] == "regional-original-esri":
            rows, domain_corrections = regional_domain_rows(domain, crs)
        else:
            rows, _ = rasters.vector_geometry(
                domain, layer=context.get("domain_layer"), where=context.get("domain_filter"),
                target_crs=crs,
            )
        huc_field = binding["native_huc12_field"]
        object_field = binding["native_object_id_field"]
        selected = {}
        for row in rows:
            huc = str(row["properties"].get(huc_field, ""))
            if huc not in by_huc or huc in selected:
                raise ValueError("Domain HUC12 does not match its original binding: " + huc)
            actual_id = str(row["properties"].get(object_field, row["id"]))
            if actual_id != str(by_huc[huc]["object_id"]):
                raise ValueError("Domain native object ID differs for HUC12 " + huc)
            selected[huc] = row
        if set(selected) != set(by_huc):
            raise ValueError("The full selected HUC12 domain is required for this report")
        raw_domain = rasters.polygon_union(rows)
        model_domain = raw_domain.buffer(float(context["buffer_m"]))
        reporting_geometry = None
        if reporting is not None:
            inputs["reporting"] = bound_file(reporting)
            reporting_rows, _ = rasters.vector_geometry(
                reporting, layer=reporting_layer, where=reporting_where, target_crs=crs,
            )
            reporting_geometry = rasters.polygon_union(reporting_rows)
        cell_area_ha = abs(soil.transform.a * soil.transform.e - soil.transform.b * soil.transform.d) / 10000
        selection = {
            "schema": "upstate.soil-huc12-coverage-plan/v1",
            "operation_id": OPERATION_ID, "source_id": entry["id"],
            "source_units": entry["units"], "inputs": inputs,
            "source_preparation_sha256": entry["preparation_sha256"],
            "source_preparation_schema": plan["schema"],
            "domain_reader": context["domain_reader"],
            "domain_geometry_corrections": domain_corrections,
            "bindings_source_id": binding["source_id"],
            "source_capture_sha256": binding["original_capture_sha256"],
            "reporting_layer": reporting_layer, "reporting_where": reporting_where,
            "grid": plan["grid"], "buffer_m": context["buffer_m"],
            "cell_area_ha": cell_area_ha, "pixel_rule": "GDAL polygon pixel centres",
            "status_flags": FLAGS, "code_sha256": file_digest(Path(__file__)),
        }
        identity = {**selection, "inputs": {name: {"bytes": item["bytes"], "sha256": item["sha256"]}
                    for name, item in inputs.items()}}
        coverage_id = "usda-soil-huc12-coverage-" + digest(identity)[:16]
        output.mkdir(parents=True, exist_ok=True)
        with held(output / "coverage.lock"):
            atomic_json(output / "plan.json", selection, immutable=True)
            completed_entry = output / "source-entry.json"
            if completed_entry.is_file():
                prior = read_json(completed_entry)
                if prior["id"] != coverage_id:
                    raise ValueError("Retained coverage belongs to another source selection")
                for item in [prior, *prior["companions"]]:
                    bound_file(output / item["path"], item["sha256"], item["bytes"])
                atomic_json(output / "source-manifest.json", {
                    "schema": "upstate.sources/v1", "title": prior["title"],
                    "entries": [prior]}, immutable=True)
                return read_json(output / "coverage-summary.json")
            status_path = output / "soil-coverage-status.tif"
            pending = output / "soil-coverage-status.partial.tif"
            profile = soil.profile.copy()
            profile.update(dtype="uint8", nodata=0, count=1, predictor=1)
            model_stats, domain_stats, reporting_stats = empty_stats(), empty_stats(), empty_stats()
            with rasterio.open(reference) as nlcd, WarpedVRT(
                nlcd, crs=soil.crs, transform=soil.transform,
                width=soil.width, height=soil.height,
                resampling=rasterio.enums.Resampling.nearest,
            ) as cover, rasterio.open(pending, "w", **profile) as result:
                for window in windows(soil.width, soil.height):
                    transform = soil.window_transform(window)
                    domain_mask = selected_mask(model_domain, window, transform)
                    source_values = soil.read(1, window=window, masked=True)
                    values = np.ma.getdata(source_values)
                    source_missing = np.ma.getmaskarray(source_values)
                    valid = ~source_missing & np.isfinite(values) & (values >= 0)
                    invalid = ~source_missing & ~valid
                    source_cover = cover.read(1, window=window, masked=True)
                    cover_values = np.ma.getdata(source_cover)
                    cover_valid = ~np.ma.getmaskarray(source_cover) & np.isfinite(cover_values)
                    flags = np.zeros(domain_mask.shape, dtype="uint8")
                    flags[domain_mask] |= FLAG_DOMAIN
                    flags[domain_mask & valid] |= FLAG_K_VALID
                    flags[domain_mask & source_missing] |= FLAG_K_NODATA
                    flags[domain_mask & invalid] |= FLAG_K_INVALID
                    flags[domain_mask & cover_valid] |= FLAG_NLCD_VALID
                    flags[domain_mask & cover_valid & (cover_values == 11)] |= FLAG_WATER
                    reporting_mask = selected_mask(reporting_geometry, window, transform)
                    flags[reporting_mask & domain_mask] |= FLAG_REPORTING
                    result.write(flags, 1, window=window)
                    accumulate(model_stats, flags, values, domain_mask)
                    accumulate(domain_stats, flags, values, selected_mask(raw_domain, window, transform))
                    if reporting_geometry is not None:
                        accumulate(reporting_stats, flags, values, reporting_mask)
                result.update_tags(
                    source_id=entry["id"], operation_id=OPERATION_ID,
                    flags=json.dumps(FLAGS, sort_keys=True), units="bitmask",
                    pixel_rule="GDAL polygon pixel centres",
                    physical_k_units=entry["units"],
                )
            os.replace(pending, status_path)
            records, geometries = [], []
            with rasterio.open(status_path) as status:
                for huc in sorted(selected):
                    feature, original = selected[huc], by_huc[huc]
                    stats, outside, reporting_result = measure(
                        feature["geometry"], soil, status, cell_area_ha, reporting_geometry,
                    )
                    name = next((str(value) for key, value in feature["properties"].items()
                                 if key.lower() == "name"), "")
                    record = {
                        "huc12": huc, "tohuc": original["tohuc"],
                        "native_objectid": str(original["object_id"]), "huc_name": name,
                        "reporting_intersection": int(original["intersects_reporting_area"]),
                        "upstream_ancestor": int(original["upstream_ancestor"]),
                        "huc_area_m2": float(feature["geometry"].area),
                        "outside_grid_area_m2": outside, **stats,
                    }
                    if reporting_geometry is not None:
                        record.update({"reporting_" + key: value for key, value in reporting_result.items()})
                    records.append(record)
                    geometry = feature["geometry"]
                    geometries.append(MultiPolygon([geometry]) if geometry.geom_type == "Polygon" else geometry)
            stream = io.StringIO(newline="")
            writer = csv.DictWriter(stream, fieldnames=list(records[0]))
            writer.writeheader()
            writer.writerows(records)
            atomic_bytes(output / "huc12-soil-coverage.csv", stream.getvalue().encode("utf-8"))
            property_types = {}
            for key in records[0]:
                if key in ("huc12", "tohuc", "native_objectid", "huc_name"):
                    property_types[key] = "str"
                elif key.endswith("_cells") or key in ("cells", "reporting_cells", "reporting_intersection", "upstream_ancestor"):
                    property_types[key] = "int64"
                else:
                    property_types[key] = "float"
            gpkg = output / "huc12-soil-coverage.gpkg"
            staged_gpkg = output / "huc12-soil-coverage.partial.gpkg"
            staged_gpkg.unlink(missing_ok=True)
            with rasters.vector_environment(), fiona.open(
                staged_gpkg, "w", driver="GPKG", crs_wkt=crs.to_wkt(),
                schema={"geometry": "MultiPolygon", "properties": property_types},
                layer="huc12_soil_coverage",
            ) as sink:
                for record, geometry in zip(records, geometries):
                    sink.write({"geometry": mapping(geometry), "properties": record})
            os.replace(staged_gpkg, gpkg)
            summary = {
                "schema": "upstate.soil-huc12-coverage/v1", "operation_id": OPERATION_ID,
                "source_id": entry["id"], "coverage_source_id": coverage_id,
                "source_manifest": "source-manifest.json", "source_vintage": context["vintage"],
                "source_units": entry["units"], "feature_count": len(records),
                "reporting_intersections": sum(row["reporting_intersection"] for row in records),
                "upstream_ancestors": sum(row["upstream_ancestor"] for row in records),
                "buffered_model_domain": finish(model_stats, cell_area_ha),
                "unbuffered_huc12_union": finish(domain_stats, cell_area_ha),
                "selected_reporting_area": finish(reporting_stats, cell_area_ha) if reporting_geometry is not None else None,
                "source_preparation_counts": source_coverage,
                "huc12_with_unresolved_land": [row["huc12"] for row in records if row["land_k_unresolved_cells"]],
                "huc12_with_grid_omission": [row["huc12"] for row in records if row["outside_grid_area_m2"] > 0.000001],
                "status_flags": FLAGS,
                "aggregation": "Regional totals use union masks; overlapping HUC12 rows are not added together.",
                "files": [describe_file(output, output / name) for name in (
                    "plan.json", "soil-coverage-status.tif", "huc12-soil-coverage.csv", "huc12-soil-coverage.gpkg",
                )],
            }
            from shapely.geometry import box
            grid_geometry = box(*soil.bounds)
            summary["outside_grid_area_m2"] = {
                "buffered_model_domain": float(model_domain.difference(grid_geometry).area),
                "unbuffered_huc12_union": float(raw_domain.difference(grid_geometry).area),
                "selected_reporting_area": float(reporting_geometry.difference(grid_geometry).area) if reporting_geometry is not None else None,
            }
            atomic_json(output / "coverage-summary.json", summary)
            primary = next(item for item in summary["files"] if item["path"] == gpkg.name)
            coverage_entry = {
                "id": coverage_id, "title": "Native soil and land-cover coverage by original HUC12",
                "kind": "vector", "role": "SOIL_SOURCE_COVERAGE",
                "uri": entry.get("uri", context["source"]), "vintage": context["vintage"],
                "source_crs": crs.to_string(), "layer": "huc12_soil_coverage",
                "soil_source_id": entry["id"], "coverage_selection_sha256": digest(identity),
                "metadata": {"feature_count": len(records), "original_domain_source_id": binding["source_id"],
                             "physical_k_units": entry["units"], "status_flags": FLAGS},
                **primary,
                "companions": [item for item in summary["files"] if item["path"] != gpkg.name]
                    + [describe_file(output, output / "coverage-summary.json")],
            }
            atomic_json(completed_entry, coverage_entry, immutable=True)
            atomic_json(output / "source-manifest.json", {
                "schema": "upstate.sources/v1", "title": coverage_entry["title"],
                "entries": [coverage_entry]}, immutable=True)
            return summary


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--soil-source", required=True)
    parser.add_argument("--domain", required=True)
    parser.add_argument("--bindings", required=True)
    parser.add_argument("--reference", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--reporting")
    parser.add_argument("--reporting-layer")
    parser.add_argument("--reporting-where-json")
    args = parser.parse_args(argv)
    summary = build(
        args.soil_source, args.domain, args.bindings, args.reference, args.output,
        reporting=args.reporting, reporting_layer=args.reporting_layer,
        reporting_where=json.loads(args.reporting_where_json) if args.reporting_where_json else None,
    )
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True, indent=2))


if __name__ == "__main__":
    main()
