"""Water and Habitat Context desk for retained Upper Savannah workspaces.

Authored by TokenJunkieLabs. This additive module consumes existing source editions;
it does not alter source bytes, native model engines, or Workspace methods.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import math
from pathlib import Path
import shutil
import tempfile
import zipfile

from .common import (atomic_bytes, atomic_json, describe_file, digest, held,
                     identifier, now, read_json, relative_file, verify_file)

SCHEMA = "upstate.water-context/v1"
CATEGORIES = ("wetlands", "mapping_status", "flowlines", "waterbodies", "protected_lands", "stream_order")
LINE_CATEGORIES = ("flowlines", "stream_order")
LABELS = {
    "wetlands": "NWI mapped aquatic habitat inventory",
    "mapping_status": "NWI mapping-status coverage",
    "flowlines": "NHD mapped flowlines",
    "waterbodies": "NHD mapped waterbodies",
    "protected_lands": "PAD-US inventory overlap",
    "stream_order": "Authoritative NHDPlus stream order",
}
UNITS = {"area": "ha", "length": "km", "percentage": "%"}
METHOD = "water-context-2"
PREVIEW_LIMIT = 2500
PREVIEW_TOLERANCE_M = 30.0


def _workspace(value):
    if all(hasattr(value, name) for name in ("root", "sources", "source_file", "_save")):
        return value
    from .workspace import Workspace
    return Workspace(value)


def _json_value(value):
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {str(key): _json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_value(item) for item in value]
    return str(value)


def _metadata(entry, key, default=None):
    return entry.get(key, entry.get("metadata", {}).get(key, default))


def _lookup(properties, *names):
    keyed = {str(key).lower().rsplit(".", 1)[-1]: value for key, value in properties.items()}
    for name in names:
        value = keyed.get(name.lower())
        if value is not None and value != "":
            return value
    return None


def _label(properties, fallback):
    value = _lookup(properties, "name", "gnis_name", "utility", "utility_name",
                    "huc_name", "watershed", "unit_nm", "wetland_type", "status")
    return str(value) if value is not None else str(fallback)


def _reference(value):
    if not isinstance(value, dict):
        raise ValueError("Select a retained source collection and source ID")
    result = {"collection_id": identifier(value.get("collection_id")),
              "source_id": value.get("source_id")}
    if not isinstance(result["source_id"], str) or not result["source_id"].strip():
        raise ValueError("A retained source ID must be a nonempty string")
    for key in ("layer", "id_field"):
        if value.get(key) is not None:
            if not isinstance(value[key], str) or not value[key]:
                raise ValueError(key + " must be a nonempty field or layer name")
            result[key] = value[key]
    if value.get("where") is not None:
        where = value["where"]
        if not isinstance(where, dict) or any(not isinstance(k, str) or not k for k in where):
            raise ValueError("Boundary filters use a field-to-value object")
        if any(not (v is None or isinstance(v, (str, int, float, bool))) for v in where.values()):
            raise ValueError("Boundary filter values must be scalar native field values")
        if any(isinstance(v, float) and not math.isfinite(v) for v in where.values()):
            raise ValueError("Boundary filter values must be finite")
        result["where"] = dict(where)
    if "feature_ids" in value:
        ids = value["feature_ids"]
        if not isinstance(ids, list) or not ids or any(x is None for x in ids):
            raise ValueError("Explicit feature selection needs at least one native ID")
        result["feature_ids"] = sorted(set(str(x) for x in ids))
    if value.get("component") is not None:
        if value["component"] != "mapping_status":
            raise ValueError("Only the retained NWI mapping-status companion is selectable")
        result["component"] = "mapping_status"
    return result


def _normalise(spec):
    if not isinstance(spec, dict):
        raise ValueError("Supply a Water and Habitat Context selection object")
    overlays = spec.get("overlays", {})
    if not isinstance(overlays, dict) or set(overlays) - set(CATEGORIES):
        raise ValueError("Use the documented context overlay categories")
    result = {"title": str(spec.get("title") or "Water and Habitat Context"),
              "boundary": _reference(spec.get("boundary")),
              "overlays": {key: _reference(value) for key, value in overlays.items()
                           if value is not None},
              "measurement_crs": str(spec.get("measurement_crs") or "EPSG:5070"),
              "relations": []}
    status_ref = result["overlays"].get("mapping_status", {})
    if status_ref.get("where") or status_ref.get("feature_ids"):
        raise ValueError("NWI coverage uses all status records; select the geographic area with the reporting boundary")
    relations = spec.get("relations", [])
    if not isinstance(relations, list):
        raise ValueError("Spatial relationships must list retained HUC or utility sources")
    for value in relations:
        if not isinstance(value, dict) or value.get("kind") not in ("huc", "utility"):
            raise ValueError("Each relationship source needs kind huc or utility")
        result["relations"].append({"kind": value["kind"], **_reference(value)})
    return result


def _entry(workspace, ref):
    collection = workspace._get("sources", ref["collection_id"])
    entries = [e for e in collection["entries"] if e["id"] == ref["source_id"]]
    if len(entries) != 1:
        raise ValueError("The selected source ID is absent from its retained collection")
    return entries[0], collection


def _source_record(workspace, ref, category):
    entry, collection = _entry(workspace, ref)
    return {
        "context_role": category, "collection_id": ref["collection_id"],
        "source_id": entry["id"], "title": entry["title"], "kind": entry["kind"],
        "role": entry.get("role"), "layer": ref.get("layer", entry.get("layer")),
        "uri": entry["uri"], "vintage": entry["vintage"],
        "sha256": entry["body"]["sha256"], "bytes": entry["body"]["bytes"],
        "id_field": ref.get("id_field", entry.get("id_field")),
        "component": ref.get("component"), "where": ref.get("where", {}),
        "feature_ids": ref.get("feature_ids"), "metadata": entry.get("metadata", {}),
        "coverage": entry.get("coverage"), "scope": collection.get("scope", {}),
        "native_lineage": _metadata(entry, "native_lineage"),
        "grid": _metadata(entry, "grid"), "codes": _metadata(entry, "codes"),
        "mapping_status_codes": _metadata(entry, "mapping_status_codes"),
        "mapping_status_path": _metadata(entry, "mapping_status_path"),
        "units": entry.get("units"), "resampling": entry.get("resampling"),
        "reference": entry.get("reference"),
        "companions": [{"view_path": x.get("view_path", x["filename"]),
                        "sha256": x["sha256"], "bytes": x["bytes"]}
                       for x in entry.get("companions", [])],
    }


def _suggested(entry):
    role = str(entry.get("role", "")).upper()
    name = (entry.get("id", "") + " " + entry.get("title", "")).lower()
    if role == "NHD_STREAM_ORDER":
        return "stream_order"
    if role == "NWI_MAPPING_STATUS" or "mapping-status" in name:
        return "mapping_status"
    if role in ("NWI", "NWI_CONTEXT"):
        return "wetlands"
    if role == "PROTECTED_LANDS" or "padus" in name or "pad-us" in name:
        return "protected_lands"
    if "flowline" in name:
        return "flowlines"
    if "waterbody" in name or "waterbodies" in name:
        return "waterbodies"
    return None


def catalog(workspace):
    """Read retained metadata only; no source hashing, GIS imports or geometry scans."""
    workspace = _workspace(workspace)
    sources, collections = [], []
    for collection in workspace.sources():
        collections.append({"id": collection["id"], "title": collection.get("title"),
                            "captured_at": collection.get("captured_at"),
                            "scope": collection.get("scope", {})})
        for entry in collection["entries"]:
            sources.append({
                "collection_id": collection["id"], "source_id": entry["id"],
                "title": entry["title"], "kind": entry["kind"], "role": entry.get("role"),
                "layer": entry.get("layer"), "id_field": entry.get("id_field"),
                "vintage": entry["vintage"], "uri": entry["uri"],
                "sha256": entry["body"]["sha256"], "bytes": entry["body"]["bytes"],
                "suggested_category": _suggested(entry), "metadata": entry.get("metadata", {}),
                "has_mapping_status_companion": bool(_metadata(entry, "mapping_status_path")),
            })
    return {"schema": "upstate.water-context-catalog/v1",
            "collections": collections, "sources": sources,
            "boundaries": [row for row in sources if row["kind"] == "vector"],
            "categories": [{"id": key, "label": LABELS[key]} for key in CATEGORIES],
            "analyses": list_saved(workspace)}


def _xy_coordinates(value):
    if isinstance(value, (list, tuple)) and len(value) >= 2 and isinstance(value[0], (int, float)):
        return [value[0], value[1]]
    return [_xy_coordinates(item) for item in value]


def _xy_geometry(value):
    result = dict(value)
    if result.get("type") == "GeometryCollection":
        result["geometries"] = [_xy_geometry(item) for item in result["geometries"]]
    else:
        result["coordinates"] = _xy_coordinates(result["coordinates"])
    return result


def _repair(geometry, corrections, source_id, feature_id, stage):
    if geometry.is_valid:
        return geometry
    original_hash = hashlib.sha256(geometry.wkb).hexdigest()
    try:
        from shapely import make_valid
    except ImportError:
        from shapely.validation import make_valid
    result = make_valid(geometry)
    if not result.is_valid:
        raise ValueError("Geometry correction failed for " + source_id + " feature " + feature_id)
    corrections.append({"source_id": source_id, "feature_id": feature_id, "stage": stage,
                        "method": "shapely.make_valid", "input_wkb_sha256": original_hash,
                        "output_wkb_sha256": hashlib.sha256(result.wkb).hexdigest()})
    return result


def _parts(geometry, dimension):
    from shapely.geometry import GeometryCollection
    from shapely.ops import unary_union
    wanted = (("Polygon", "MultiPolygon") if dimension == 2
              else ("LineString", "MultiLineString", "LinearRing"))
    if geometry.is_empty:
        return GeometryCollection()
    if geometry.geom_type in wanted:
        return geometry
    if geometry.geom_type == "GeometryCollection":
        values = [_parts(item, dimension) for item in geometry.geoms]
        return unary_union([item for item in values if not item.is_empty])
    return GeometryCollection()


def _union(rows):
    from shapely.geometry import GeometryCollection
    from shapely.ops import unary_union
    return unary_union([row["geometry"] for row in rows]) if rows else GeometryCollection()


def _vector_rows(workspace, ref, target_crs, dimension, corrections, *, clip=None, required_fields=None):
    """Use the application's GDAL/Fiona reader for original linear provider bodies."""
    import fiona
    from pyproj import CRS, Transformer
    from shapely.geometry import shape
    from shapely.ops import transform
    from .rasters import native_vector_path, vector_environment

    path, entry = workspace.source_file(ref["collection_id"], ref["source_id"])
    if entry["kind"] != "vector":
        raise ValueError(entry["title"] + " must be a retained vector source")
    selected_layer = ref.get("layer") or entry.get("layer")
    options = {"layer": selected_layer} if selected_layer else {}
    selected_ids = set(ref["feature_ids"]) if ref.get("feature_ids") else None
    rows, seen, found_ids = [], set(), set()
    with vector_environment(), fiona.open(native_vector_path(path), **options) as source:
        native = CRS.from_user_input(source.crs_wkt or source.crs)
        target = CRS.from_user_input(target_crs)
        project = Transformer.from_crs(native, target, always_xy=True)
        declared = str(source.schema.get("geometry", "Unknown")).replace("3D ", "")
        allowed = (("Polygon", "MultiPolygon") if dimension == 2
                   else ("LineString", "MultiLineString", "LinearRing"))
        if declared not in ("Unknown", "GeometryCollection", "None") and declared not in allowed:
            raise ValueError(entry["title"] + " declares the wrong geometry type for this context role")
        fields = set(source.schema.get("properties", {}))
        if required_fields and not any(key.lower().rsplit(".", 1)[-1] in required_fields for key in fields):
            raise ValueError("The selected authoritative stream-order source lacks its native order field")
        where = ref.get("where", {})
        if set(where) - fields:
            raise ValueError("Native filter field is absent: " + ", ".join(sorted(set(where) - fields)))
        id_field = ref.get("id_field") or entry.get("id_field")
        if ref.get("id_field") and id_field not in fields and id_field != entry.get("id_field"):
            raise ValueError("The selected native ID field is absent: " + id_field)
        iterator = source
        if clip is not None:
            inverse = Transformer.from_crs(target, native, always_xy=True)
            bounds = inverse.transform_bounds(*clip.bounds, densify_pts=21)
            iterator = source.filter(bbox=bounds)
        for feature in iterator:
            properties = _json_value(dict(feature["properties"]))
            if any(properties.get(key) != value for key, value in where.items()):
                continue
            native_id = properties.get(id_field) if id_field else None
            feature_id = str(native_id if native_id is not None else feature.id)
            if selected_ids is not None and feature_id not in selected_ids:
                continue
            if feature_id in seen:
                raise ValueError("Retained source repeats native feature ID " + feature_id)
            seen.add(feature_id)
            found_ids.add(feature_id)
            if feature["geometry"] is None:
                corrections.append({"source_id": entry["id"], "feature_id": feature_id,
                                    "stage": "source", "status": "source_geometry_absent"})
                continue
            geometry = shape(_xy_geometry(feature["geometry"]))
            if geometry.is_empty:
                continue
            geometry = _repair(geometry, corrections, entry["id"], feature_id, "source")
            if native != target:
                geometry = transform(project.transform, geometry)
            if not all(math.isfinite(x) for x in geometry.bounds):
                raise ValueError("Projection produced a nonfinite source geometry")
            geometry = _repair(geometry, corrections, entry["id"], feature_id, "projection")
            dimensional = _parts(geometry, dimension)
            if dimensional.is_empty:
                raise ValueError(entry["title"] + " contains an incompatible geometry dimension")
            source_area_ha = float(dimensional.area) / 10000.0 if dimension == 2 else None
            if clip is not None:
                if not dimensional.intersects(clip):
                    continue
                dimensional = _parts(dimensional.intersection(clip), dimension)
            measure = dimensional.area if dimension == 2 else dimensional.length
            if dimensional.is_empty or measure <= 0:
                continue
            rows.append({"id": feature_id, "properties": properties,
                         "geometry": dimensional, "label": _label(properties, feature_id),
                         "collection_id": ref["collection_id"], "source_id": entry["id"],
                         "identity_kind": "native_feature", "source_area_ha": source_area_ha})
    if clip is None and selected_ids is not None and selected_ids - found_ids:
        raise ValueError("Selected native feature IDs are absent: " +
                         ", ".join(sorted(selected_ids - found_ids)))
    return rows


def _companion(workspace, ref, path, entry):
    requested = _metadata(entry, "mapping_status_path")
    if not isinstance(requested, str) or not requested:
        raise ValueError("The NWI occurrence source lacks its declared mapping-status companion")
    body_name = entry["body"].get("view_path", entry["body"]["filename"])
    view = Path(path)
    for _ in Path(body_name).parts:
        view = view.parent
    candidates = []
    for member in entry.get("companions", []):
        name = member.get("view_path", member["filename"])
        if name == requested or member.get("source_path") == requested:
            candidates.append(name)
        elif (Path(body_name).parent / requested).as_posix() == name:
            candidates.append(name)
    if len(set(candidates)) != 1:
        raise ValueError("The declared NWI mapping-status companion is not uniquely retained")
    return relative_file(view, candidates[0])


def _raster_rows(workspace, ref, target_crs, category, corrections, *, clip):
    """Polygonize selected native class-cell footprints without resampling."""
    import numpy as np
    import rasterio
    from rasterio.features import geometry_mask, shapes
    from rasterio.windows import bounds as window_bounds
    from pyproj import CRS, Transformer
    from shapely.geometry import shape, mapping, box
    from shapely.ops import transform

    path, entry = workspace.source_file(ref["collection_id"], ref["source_id"])
    if entry["kind"] != "raster" or str(entry.get("role", "")).upper() != "NWI_CONTEXT":
        raise ValueError("Raster context requires the retained NWI_CONTEXT class source")
    if ref.get("where") or ref.get("feature_ids") or ref.get("id_field") or ref.get("layer"):
        raise ValueError("Native feature filters apply to vector sources; select the raster through its boundary")
    mapping_status = category == "mapping_status"
    if mapping_status:
        path = _companion(workspace, ref, path, entry)
    elif category != "wetlands":
        raise ValueError("The other context roles require retained vector source layers")
    codes = _metadata(entry, "mapping_status_codes" if mapping_status else "codes", {})
    if not isinstance(codes, dict) or not codes:
        raise ValueError("Retain the NWI categorical code dictionary with its raster")
    rows = []
    with rasterio.open(path) as source:
        if source.crs is None:
            raise ValueError("The retained NWI raster must declare its source CRS")
        native, target = CRS.from_user_input(source.crs), CRS.from_user_input(target_crs)
        project = Transformer.from_crs(native, target, always_xy=True)
        inverse = Transformer.from_crs(target, native, always_xy=True)
        native_clip = transform(inverse.transform, clip)
        if (not all(math.isfinite(x) for x in tuple(source.transform)[:6]) or
                source.transform.b or source.transform.d or
                source.transform.a <= 0 or source.transform.e >= 0):
            raise ValueError("Select the retained finite north-up NWI working grid")
        for block, window in source.block_windows(1):
            if not box(*window_bounds(window, source.transform)).intersects(native_clip):
                continue
            values = source.read(1, window=window, masked=True)
            raw = np.ma.getdata(values)
            selected = geometry_mask([mapping(native_clip)], out_shape=raw.shape,
                                     transform=source.window_transform(window),
                                     invert=True, all_touched=True)
            valid = selected & ~np.ma.getmaskarray(values) & np.isfinite(raw)
            if np.any(raw[valid] != np.floor(raw[valid])):
                raise ValueError("NWI class source contains a noninteger cell value")
            observed = set(int(value) for value in np.unique(raw[valid]))
            if any(str(value) not in codes for value in observed):
                raise ValueError("A native NWI cell code is absent from its retained dictionary")
            if mapping_status:
                valid &= raw != 255
            else:
                valid &= (raw > 0) & (raw < 255)
            data = np.where(valid, raw, 0).astype("int32")
            for number, (value, code) in enumerate(shapes(
                    data, mask=valid, transform=source.window_transform(window))):
                code = int(code)
                geometry = shape(value)
                if native != target:
                    geometry = transform(project.transform, geometry)
                geometry = _parts(geometry.intersection(clip), 2)
                if geometry.is_empty or geometry.area <= 0:
                    continue
                properties = {"class_code": code, "class_label": codes[str(code)]}
                if mapping_status:
                    properties["STATUS"] = {0: "Unknown", 1: "Digital", 2: "No_Data",
                                            3: "Conflict"}.get(code, "Unknown")
                else:
                    properties["WETLAND_TYPE"] = codes[str(code)]
                rows.append({
                    "id": "block-" + str(block[0]) + "-" + str(block[1]) + "-" + str(number) +
                          "-class-" + str(code),
                    "properties": properties, "geometry": geometry,
                    "label": str(codes[str(code)]), "collection_id": ref["collection_id"],
                    "source_id": entry["id"], "identity_kind": "native_grid_class_footprint",
                })
    return rows


def _rows(workspace, ref, target_crs, category, corrections, *, clip=None):
    entry, _ = _entry(workspace, ref)
    if entry["kind"] == "raster":
        if clip is None:
            raise ValueError("Select a vector boundary for native raster context")
        return _raster_rows(workspace, ref, target_crs, category, corrections, clip=clip)
    dimension = 1 if category in LINE_CATEGORIES else 2
    required = ("streamorde", "streamorder") if category == "stream_order" else None
    return _vector_rows(workspace, ref, target_crs, dimension, corrections, clip=clip,
                        required_fields=required)


def _geodesic_length(geometry, crs):
    from pyproj import CRS, Transformer, Geod
    from shapely.ops import transform
    if geometry.is_empty:
        return 0.0
    project = Transformer.from_crs(CRS.from_user_input(crs), "EPSG:4326", always_xy=True)
    return float(Geod(ellps="WGS84").geometry_length(transform(project.transform, geometry))) / 1000.0


def _measurement(geometry, category, crs):
    if category in LINE_CATEGORIES:
        return {"area_ha": None, "length_km": _geodesic_length(geometry, crs)}
    return {"area_ha": max(0.0, float(geometry.area)) / 10000.0, "length_km": None}


def _count(rows):
    if any(row["identity_kind"] != "native_feature" for row in rows):
        return None
    return len({(row["collection_id"], row["source_id"], row["id"]) for row in rows})


def _classes(rows, category, crs, *, fields=None):
    field_names = {"wetlands": ("WETLAND_TYPE",),
                   "flowlines": ("ftype",), "waterbodies": ("ftype",),
                   "protected_lands": ("GAP_Sts",),
                   "stream_order": ("streamorde", "streamorder")}
    names = fields or field_names.get(category)
    if not names:
        return []
    source_fields = sorted({key for row in rows for key in row["properties"]
                            if key.lower().rsplit(".", 1)[-1] in [name.lower() for name in names]})
    if not source_fields:
        return []
    grouped = {}
    for row in rows:
        value = _lookup(row["properties"], *names)
        key = json.dumps(_json_value(value), ensure_ascii=False, sort_keys=True)
        grouped.setdefault(key, {"value": _json_value(value), "rows": []})["rows"].append(row)
    result = []
    for key in sorted(grouped):
        item = grouped[key]
        result.append({"field": names[0], "source_fields": source_fields, "value": item["value"],
                       "feature_count": _count(item["rows"]),
                       "footprint_count": len(item["rows"]),
                       **_measurement(_union(item["rows"]), category, crs)})
    return result


def _empty_summary(category):
    value = {"status": "unavailable", "label": LABELS[category],
             "feature_count": None, "footprint_count": None, "area_ha": None,
             "length_km": None, "area_pct": None, "coverage_pct": None, "classes": []}
    if category == "mapping_status":
        value.update({key: None for key in
                      ("covered_area_ha", "unmapped_area_ha", "digital_area_ha",
                       "provider_no_data_area_ha", "conflicting_area_ha", "unknown_area_ha")})
    return value


def _mapping_partition(rows, boundary):
    """Partition native STATUS coverage; unrecognized status takes precedence."""
    from shapely.ops import unary_union
    digital, no_data, unknown, unknown_values = [], [], [], set()
    for row in rows:
        value = _lookup(row["properties"], "STATUS")
        code = row["properties"].get("class_code") if row["identity_kind"] != "native_feature" else None
        if value == "Digital":
            digital.append(row)
        elif value == "No_Data":
            no_data.append(row)
        elif code == 3:
            digital.append(row)
            no_data.append(row)
        else:
            unknown.append(row)
            if row["identity_kind"] == "native_feature":
                unknown_values.add(json.dumps(_json_value(value), ensure_ascii=False))
    d, n, u = _union(digital), _union(no_data), _union(unknown)
    mapped = d.difference(unary_union([n, u]))
    unavailable = n.difference(unary_union([d, u]))
    conflict = d.intersection(n).difference(u)
    unclassified = boundary.difference(unary_union([mapped, unavailable, conflict]))
    return {"digital": mapped, "no_data": unavailable, "conflict": conflict,
            "unknown": unclassified, "unknown_values": [json.loads(value) for value in sorted(unknown_values)]}


def _summaries(boundary, layers, supplied, crs):
    area_ha = float(boundary.area) / 10000.0
    result = {"boundary_area_ha": area_ha}
    for category in CATEGORIES:
        value = _empty_summary(category)
        if category in supplied:
            rows = layers.get(category, [])
            geometry = _union(rows)
            value.update(status="available", feature_count=_count(rows),
                         footprint_count=len(rows),
                         **_measurement(geometry, category, crs))
            if value["area_ha"] is not None:
                value["area_pct"] = 100.0 * value["area_ha"] / area_ha
            value["classes"] = _classes(rows, category, crs)
            if supplied[category].get("kind") == "raster":
                value["feature_count"] = None
            if category == "protected_lands":
                value["manager_classes"] = _classes(rows, category, crs, fields=("Mang_Type", "Man_Type"))
            if category == "stream_order":
                value["interpretation"] = "Native authoritative stream-order attributes; no order inferred from geometry"
            value["inventory_completeness"] = "Retained inventory; consult source acquisition scope"
        result[category] = value
    mapping = result["mapping_status"]
    if "mapping_status" in supplied:
        partition = _mapping_partition(layers.get("mapping_status", []), boundary)
        areas = {key: float(partition[key].area) / 10000.0
                 for key in ("digital", "no_data", "conflict", "unknown")}
        mapping.update(covered_area_ha=areas["digital"],
                       unmapped_area_ha=max(0.0, area_ha - areas["digital"]),
                       coverage_pct=100.0 * areas["digital"] / area_ha,
                       digital_area_ha=areas["digital"],
                       provider_no_data_area_ha=areas["no_data"],
                       conflicting_area_ha=areas["conflict"],
                       unknown_area_ha=areas["unknown"],
                       unknown_native_status_values=partition["unknown_values"],
                       partition_total_area_ha=sum(areas.values()))
    else:
        partition = None
    wetlands = result["wetlands"]
    wetlands.update(mapped_occurrence_area_ha=None,
                    mapped_no_selected_occurrence_area_ha=None,
                    mapped_no_published_occurrence_area_ha=None,
                    published_occurrence_outside_mapped_area_ha=None)
    if partition is not None and "wetlands" in supplied:
        occurrence = _union(layers.get("wetlands", []))
        wetlands.update(
            mapped_occurrence_area_ha=float(occurrence.intersection(partition["digital"]).area) / 10000.0,
            mapped_no_selected_occurrence_area_ha=float(partition["digital"].difference(occurrence).area) / 10000.0,
            published_occurrence_outside_mapped_area_ha=float(occurrence.difference(partition["digital"]).area) / 10000.0)
        selected_source = supplied["wetlands"]
        wetlands["no_occurrence_basis"] = "Digital mapping coverage without occurrence in the selected retained NWI inventory"
        if not selected_source.get("where") and not selected_source.get("feature_ids"):
            wetlands["mapped_no_published_occurrence_area_ha"] = wetlands["mapped_no_selected_occurrence_area_ha"]
            wetlands["compatibility_alias_scope"] = "Selected retained source edition; source acquisition scope applies"
    return result


class _SpatialIndex:
    def __init__(self, rows):
        from shapely.strtree import STRtree
        self.rows = rows
        geometries = [row["geometry"] for row in rows]
        self.tree = STRtree(geometries) if geometries else None
        self.by_object, self.by_wkb = {}, {}
        for index, geometry in enumerate(geometries):
            self.by_object.setdefault(id(geometry), []).append(index)
            self.by_wkb.setdefault(geometry.wkb, []).append(index)

    def query(self, geometry):
        import operator
        if self.tree is None:
            return []
        indices = set()
        for candidate in self.tree.query(geometry):
            try:
                indices.add(operator.index(candidate))
            except TypeError:
                indices.update(self.by_object.get(id(candidate),
                                                  self.by_wkb.get(candidate.wkb, [])))
        return [self.rows[index] for index in sorted(indices)
                if self.rows[index]["geometry"].intersects(geometry)]


def _clipped_rows(rows, boundary, category):
    result = []
    dimension = 1 if category in LINE_CATEGORIES else 2
    for row in rows:
        geometry = _parts(row["geometry"].intersection(boundary), dimension)
        measure = geometry.length if dimension == 1 else geometry.area
        if not geometry.is_empty and measure > 0:
            result.append({**row, "geometry": geometry})
    return result


def _feature(row, role, project, *, simplify=0.0):
    from shapely.geometry import mapping
    from shapely.ops import transform
    geometry = row["geometry"]
    if simplify:
        geometry = geometry.simplify(simplify, preserve_topology=True)
    geometry = transform(project.transform, geometry)
    return {"type": "Feature",
            "id": digest([role, row["collection_id"], row["source_id"], row["id"]]),
            "geometry": mapping(geometry),
            "properties": {
                "context_role": role, "collection_id": row["collection_id"],
                "source_id": row["source_id"], "feature_id": row["id"],
                "identity_kind": row["identity_kind"], "label": row["label"],
                "source_area_ha": row.get("source_area_ha"),
                "native_properties": row["properties"],
            }}


def _write_geojson(path, rows, project, metadata):
    """Stream the complete derived feature export; calculation uses full geometry."""
    with Path(path).open("w", encoding="utf-8", newline="\n") as stream:
        stream.write('{"type":"FeatureCollection","metadata":')
        json.dump(metadata, stream, ensure_ascii=False, allow_nan=False, sort_keys=True)
        stream.write(',"features":[')
        first = True
        for role, row in rows:
            feature = _feature(row, role, project)
            if not first:
                stream.write(",")
            first = False
            json.dump(feature, stream, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
        stream.write("]}\n")


def _csv_text(value):
    """Keep spreadsheet applications from interpreting native labels as formulas."""
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@"):
        return "'" + value
    return value


def _write_csv(path, fields, rows):
    with Path(path).open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({key: _csv_text(value) for key, value in row.items()})


def _feature_table(rows, crs):
    for role, row in rows:
        category = role if role in CATEGORIES else "boundary"
        yield {"context_role": role, "collection_id": row["collection_id"],
               "source_id": row["source_id"], "feature_id": row["id"],
               "identity_kind": row["identity_kind"], "label": row["label"],
               "source_area_ha": row.get("source_area_ha"),
               **_measurement(row["geometry"], category, crs),
               "wetland_type": _lookup(row["properties"], "WETLAND_TYPE"),
               "ftype": _lookup(row["properties"], "ftype"),
               "gap_status": _lookup(row["properties"], "GAP_Sts"),
               "stream_order": _lookup(row["properties"], "streamorde", "streamorder"),
               "nhdplusid": _lookup(row["properties"], "nhdplusid"),
               "permanent_identifier": _lookup(row["properties"], "permanent_identifier"),
               "properties_json": json.dumps(row["properties"], ensure_ascii=False,
                                             sort_keys=True, allow_nan=False)}


def _relationships(rows, boundaries, crs):
    index = _SpatialIndex(boundaries)
    for role, row in rows:
        if role not in CATEGORIES:
            continue
        dimension = 1 if role in LINE_CATEGORIES else 2
        for boundary in index.query(row["geometry"]):
            overlap = _parts(row["geometry"].intersection(boundary["geometry"]), dimension)
            if overlap.is_empty or (overlap.length if dimension == 1 else overlap.area) <= 0:
                continue
            relation = "within" if boundary["geometry"].covers(row["geometry"]) else "overlaps"
            yield {
                "context_role": role, "collection_id": row["collection_id"],
                "source_id": row["source_id"], "feature_id": row["id"],
                "identity_kind": row["identity_kind"], "boundary_kind": boundary["relation_kind"],
                "boundary_collection_id": boundary["collection_id"],
                "boundary_source_id": boundary["source_id"], "boundary_feature_id": boundary["id"],
                "boundary_label": boundary["label"], "relationship": relation,
                **_measurement(overlap, role, crs),
            }


def _preview_value(key, all_rows, project):
    grouped = {}
    for role, row in all_rows:
        grouped.setdefault(role, []).append(row)
    selected, indices = [], {role: 0 for role in grouped}
    while len(selected) < PREVIEW_LIMIT:
        added = False
        for role, rows in grouped.items():
            index = indices[role]
            if index < len(rows) and len(selected) < PREVIEW_LIMIT:
                selected.append((role, rows[index]))
                indices[role] += 1
                added = True
        if not added:
            break
    features = [_feature(row, role, project, simplify=PREVIEW_TOLERANCE_M)
                for role, row in selected]
    return {"id": key, "status": "complete",
            "geojson": {"type": "FeatureCollection", "features": features},
            "feature_count": len(all_rows), "shown_features": len(selected),
            "truncated": len(selected) < len(all_rows),
            "display_simplification_m": PREVIEW_TOLERANCE_M,
            "selection": "Round-robin category preview; complete geometry is in features.geojson",
            "measurement_geometry": "Full selected geometry; preview simplification is never measured"}


def _readme(record):
    lines = [
        "# Water and Habitat Context",
        "",
        record["title"],
        "",
        "Prepared by TokenJunkieLabs.",
        "",
        "The analysis retains its exact selected source editions, native feature identities,",
        "selection rules, input hashes, geometry corrections and derived geographic exports.",
        "Full source bytes remain in the scientific Workspace and travel with its existing backup.",
        "",
        "## Files",
        "",
        "- selection.json: saved source, boundary, HUC and utility choices.",
        "- summary.json and summary.csv: selected-area inventory and coverage metrics.",
        "- features.geojson: complete selected XY geometries in WGS84 longitude/latitude.",
        "- features.csv: native identities, class fields, clipped metrics and original properties.",
        "- relationships.csv: feature-to-HUC, utility and selected-boundary geometric intersections.",
        "- boundary-summaries.json and boundary-summaries.csv: per-boundary context using the same rules.",
        "- sources.json: retained source editions, URIs, vintages, hashes and acquisition scope.",
        "- geometry-corrections.json: any analytical make_valid operations; original bytes stay intact.",
        "- preview.json: a display-only subset; quantitative summaries always use all selected geometry.",
        "",
        "## Interpretation",
        "",
        "NWI inventory includes wetlands and other mapped aquatic habitat, including ponds,",
        "riverine and deepwater classes. Native WETLAND_TYPE class breakdowns remain visible.",
        "Positive published occurrence remains present even where the separately dated",
        "mapping-status source is unknown, No_Data, or conflicting.",
        "Digital-only mapping area excludes No_Data overlap and all unrecognized status polygons.",
        "Digital mapping with no published polygon describes this inventory edition;",
        "it does not establish field-confirmed absence.",
        "",
        "NHD mapped flowline length includes the retained ftype classes, which can include",
        "ArtificialPath and Connector features. The total is a union of coincident linework.",
        "Mapped waterbody area is the union of the selected native polygon inventory.",
        "The optional stream_order overlay preserves authoritative native streamorde",
        "and joining identifiers from NHDPlus. Order is never inferred from ordinary flowline geometry.",
        "",
        "PAD-US overlap is the unique union of the selected inventory polygons.",
        "Manager categories and GAP statuses remain native attributes. Manager identity alone",
        "does not establish ownership, legal easement, or conservation protection status.",
        "Class totals and overlapping utility scopes are individually meaningful and may be",
        "nonadditive. Grand totals use a geometric union.",
        "",
        "Missing sources have unavailable metrics. An available empty source gives zero",
        "retained inventory; consult the acquisition scope for completeness.",
        "Intersection establishes a spatial relationship. It does not establish hydrologic",
        "connectivity, upstream flow routing, ecological condition or pollutant retention.",
        "",
        "## Measurement and reopening",
        "",
        "Area uses selected projected XY geometry in " + record["selection"]["measurement_crs"] + ".",
        "The default EPSG:5070 is NAD83 / Conus Albers with metre units.",
        "Lengths use WGS84 ellipsoidal geodesic length of the clipped horizontal linework.",
        "Native raster classes, when selected, use original cell footprints and code dictionaries",
        "without resampling. Raster footprint counts are distinct from native feature counts.",
        "Original Z/M and provider curve records remain in their retained source edition.",
        "",
        "Reopen with the existing Workspace and water_context.get_saved(workspace, analysis_id).",
        "The saved selection_id points to Workspace._save('water-context-selections', ...).",
        "Transfer the full scientific Workspace with its established backup/restore workflow",
        "to rebuild or change source selections on another machine.",
        "The ZIP contains the portable derived analysis, while the Workspace contains full inputs.",
        "CSV descriptive text beginning with a spreadsheet formula marker is prefixed with",
        "an apostrophe; native property JSON and GeoJSON preserve the underlying text.",
        "",
    ]
    return "\n".join(lines)


def _directory(workspace, key):
    return workspace.root / "water-context" / identifier(key)


def _read_record(workspace, key):
    path = _directory(workspace, key) / "analysis.json"
    record = read_json(path)
    if record.get("schema") != SCHEMA or record.get("id") != key:
        raise ValueError("Select an original Water and Habitat Context analysis")
    if digest(record["identity"]) != key:
        raise ValueError("The retained context source selection changed")
    return record


def get_saved(workspace, analysis_id):
    """Read one saved manifest without rescanning or rehashing original GIS sources."""
    workspace = _workspace(workspace)
    return _read_record(workspace, identifier(analysis_id))


def list_saved(workspace):
    """Read saved manifests only; expensive computations never run during refresh."""
    workspace = _workspace(workspace)
    directory = workspace.root / "water-context"
    result = []
    if not directory.exists():
        return result
    for path in sorted(directory.glob("*/analysis.json")):
        record = _read_record(workspace, path.parent.name)
        result.append({key: record.get(key) for key in
                       ("schema", "id", "title", "state", "created_at", "completed_at",
                        "selection", "selection_id", "summary", "units", "files", "error")})
    return sorted(result, key=lambda value: (value.get("created_at") or "", value["id"]),
                  reverse=True)


def preview(workspace, analysis_id):
    workspace = _workspace(workspace)
    record = _read_record(workspace, identifier(analysis_id))
    if record["state"] != "complete":
        return {"id": record["id"], "status": record["state"],
                "geojson": {"type": "FeatureCollection", "features": []},
                "feature_count": 0, "shown_features": 0, "truncated": False}
    path = verify_file(_directory(workspace, record["id"]), record["files"]["preview"])
    return read_json(path)


def verify_all(workspace):
    """Explicit full verification of saved exports and source selections."""
    workspace = _workspace(workspace)
    checked, errors = [], []
    directory = workspace.root / "water-context"
    for path in sorted(directory.glob("*/analysis.json")) if directory.exists() else []:
        try:
            record = _read_record(workspace, path.parent.name)
            selected = workspace._get("water-context-selections", record["selection_id"])
            actual = {key: value for key, value in selected.items() if key not in ("id", "schema")}
            if actual != record["selection"]:
                raise ValueError("Saved selection differs from the original Workspace record")
            if record["state"] != "complete":
                errors.append({"id": record["id"], "state": record["state"],
                               "error": "Analysis exports are not complete"})
                continue
            for item in record["files"].values():
                verify_file(path.parent, item)
            seen = set()
            for source in record["sources"]:
                key = (source["collection_id"], source["source_id"])
                if key in seen:
                    continue
                seen.add(key)
                _, entry = workspace.source_file(*key)
                if entry["body"]["sha256"] != source["sha256"]:
                    raise ValueError("Saved source identity differs from its retained edition")
            checked.append({"id": record["id"], "files": len(record["files"]),
                            "source_entries": len(seen), "status": "verified"})
        except Exception as error:
            errors.append({"id": path.parent.name, "error": type(error).__name__ + ": " + str(error)})
    return {"schema": "upstate.water-context-verification/v1", "checked_at": now(),
            "ok": not errors, "analyses_checked": len(checked), "analyses": checked,
            "errors": errors}


class _BuildSourceCache:
    """Reuse one verified native source view within one explicit analysis build."""
    def __init__(self, workspace):
        self.workspace, self.views = workspace, {}
        self.root = workspace.root

    def _get(self, kind, key):
        return self.workspace._get(kind, key)

    def source_file(self, collection_id, source_id):
        key = (collection_id, source_id)
        if key not in self.views:
            self.views[key] = self.workspace.source_file(collection_id, source_id)
        return self.views[key]


def build(workspace, spec):
    """Create or reopen a complete deterministic context analysis.

    GIS imports, source verification and geometry work occur only in this explicit
    operation. Source inputs and saved choices remain immutable; failed derivations
    can be resumed by calling build with the same selection.
    """
    from pyproj import CRS, Transformer
    workspace = _workspace(workspace)
    spec = _normalise(spec)
    crs = CRS.from_user_input(spec["measurement_crs"])
    if (not crs.is_projected or len(crs.axis_info) < 2 or
            any(not math.isclose(axis.unit_conversion_factor, 1.0, rel_tol=0, abs_tol=1e-12)
                for axis in crs.axis_info[:2])):
        raise ValueError("Choose a projected measurement CRS with horizontal metre units")
    spec["measurement_crs"] = crs.to_string()
    if "wetlands" in spec["overlays"] and "mapping_status" not in spec["overlays"]:
        entry, _ = _entry(workspace, spec["overlays"]["wetlands"])
        if entry.get("kind") == "raster" and _metadata(entry, "mapping_status_path"):
            spec["overlays"]["mapping_status"] = {
                **spec["overlays"]["wetlands"], "component": "mapping_status"}
    selected = workspace._save("water-context-selections", spec)
    sources = [_source_record(workspace, spec["boundary"], "selection")]
    sources.extend(_source_record(workspace, ref, category)
                   for category, ref in sorted(spec["overlays"].items()))
    sources.extend(_source_record(workspace, ref, ref["kind"]) for ref in spec["relations"])
    identity = {"schema": SCHEMA, "method": METHOD, "selection": spec,
                "selection_id": selected["id"], "sources": sources}
    key = digest(identity)
    directory = _directory(workspace, key)
    directory.mkdir(parents=True, exist_ok=True)
    state_path = directory / "analysis.json"
    with held(directory / ".build.lock", blocking=False):
        if state_path.exists():
            record = _read_record(workspace, key)
            if record["state"] == "complete":
                for item in record["files"].values():
                    verify_file(directory, item)
                return record
        else:
            record = {"schema": SCHEMA, "id": key, "title": spec["title"],
                      "created_at": now(), "state": "building", "selection": spec,
                      "selection_id": selected["id"], "identity": identity,
                      "sources": sources, "units": UNITS, "summary": {}, "files": {},
                      "author": "TokenJunkieLabs"}
        record.update(state="building", error=None, updated_at=now())
        atomic_json(state_path, record)
        pending = Path(tempfile.mkdtemp(prefix=".water-context-", dir=directory))
        try:
            access, corrections = _BuildSourceCache(workspace), []
            boundary_rows = _rows(access, spec["boundary"], crs, "boundary", corrections)
            boundary = _union(boundary_rows)
            if boundary.is_empty or not boundary.is_valid or boundary.area <= 0:
                raise ValueError("Select a nonempty valid polygon reporting boundary")
            if not all(math.isfinite(x) for x in boundary.bounds):
                raise ValueError("The selected boundary has nonfinite projected coordinates")
            layers, supplied = {}, {}
            for category, ref in spec["overlays"].items():
                layers[category] = _rows(access, ref, crs, category, corrections, clip=boundary)
                supplied[category] = _source_record(workspace, ref, category)
            relation_rows = [{**row, "relation_kind": "selection"} for row in boundary_rows]
            for ref in spec["relations"]:
                rows = _rows(access, ref, crs, "boundary", corrections, clip=boundary)
                relation_rows.extend({**row, "relation_kind": ref["kind"]} for row in rows)
            unique_relations = {}
            for row in relation_rows:
                native_key = (row["relation_kind"], row["collection_id"], row["source_id"], row["id"])
                if native_key in unique_relations:
                    if not row["geometry"].equals(unique_relations[native_key]["geometry"]):
                        raise ValueError("Repeated boundary identity carries different selected geometry")
                else:
                    unique_relations[native_key] = row
            relation_rows = list(unique_relations.values())
            summary = _summaries(boundary, layers, supplied, crs)
            summary["selection_feature_count"] = _count(boundary_rows)
            summary["relationship_boundary_count"] = len(relation_rows)
            indices = {category: _SpatialIndex(rows) for category, rows in layers.items()}
            boundary_summaries = []
            for row in relation_rows:
                local_layers = {
                    category: _clipped_rows(index.query(row["geometry"]), row["geometry"], category)
                    for category, index in indices.items()}
                boundary_summaries.append({
                    "kind": row["relation_kind"], "collection_id": row["collection_id"],
                    "source_id": row["source_id"], "feature_id": row["id"], "label": row["label"],
                    "source_boundary_area_ha": row["source_area_ha"],
                    "selected_overlap_area_ha": float(row["geometry"].area) / 10000.0,
                    "selection_share_pct": 100.0 * float(row["geometry"].area) / boundary.area,
                    "source_boundary_share_pct": 100.0 * float(row["geometry"].area) / (row["source_area_ha"] * 10000.0),
                    "inventory_denominator": "Selected overlap with this native boundary",
                    "summary": _summaries(row["geometry"], local_layers, supplied, crs)})
            all_rows = [("selection", row) for row in boundary_rows]
            all_rows.extend((row["relation_kind"], row) for row in relation_rows
                            if row["relation_kind"] != "selection")
            all_rows.extend((category, row) for category, rows in layers.items() for row in rows)
            project = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
            atomic_json(pending / "selection.json", {**spec, "selection_id": selected["id"]})
            atomic_json(pending / "summary.json", {"schema": SCHEMA, "id": key,
                                                   "summary": summary, "units": UNITS})
            atomic_json(pending / "sources.json", {"sources": sources})
            atomic_json(pending / "geometry-corrections.json", {"corrections": corrections})
            atomic_json(pending / "boundary-summaries.json", {"boundaries": boundary_summaries})
            atomic_json(pending / "preview.json", _preview_value(key, all_rows, project))
            _write_geojson(pending / "features.geojson", all_rows, project, {
                "schema": SCHEMA, "analysis_id": key, "measurement_crs": crs.to_string(),
                "coordinate_reference": "WGS84 longitude, latitude; horizontal XY",
                "original_sources": "sources.json",
                "area_method": "Projected polygon intersections and geometric unions",
                "length_method": "WGS84 ellipsoidal geodesic length of clipped line unions"})
            summary_fields = ["context_role", "label", "status", "feature_count", "footprint_count",
                              "area_ha", "length_km", "area_pct", "coverage_pct", "covered_area_ha",
                              "unmapped_area_ha", "digital_area_ha", "provider_no_data_area_ha",
                              "conflicting_area_ha", "unknown_area_ha", "mapped_occurrence_area_ha",
                              "mapped_no_selected_occurrence_area_ha",
                              "mapped_no_published_occurrence_area_ha",
                              "published_occurrence_outside_mapped_area_ha"]
            _write_csv(pending / "summary.csv", ["boundary_area_ha"] + summary_fields,
                       ({"boundary_area_ha": summary["boundary_area_ha"], "context_role": category,
                         **summary[category]} for category in CATEGORIES))
            feature_fields = ["context_role", "collection_id", "source_id", "feature_id",
                              "identity_kind", "label", "source_area_ha", "area_ha", "length_km", "wetland_type",
                              "ftype", "gap_status", "stream_order", "nhdplusid",
                              "permanent_identifier", "properties_json"]
            _write_csv(pending / "features.csv", feature_fields, _feature_table(all_rows, crs))
            relationship_fields = ["context_role", "collection_id", "source_id", "feature_id",
                                   "identity_kind", "boundary_kind", "boundary_collection_id",
                                   "boundary_source_id", "boundary_feature_id", "boundary_label",
                                   "relationship", "area_ha", "length_km"]
            _write_csv(pending / "relationships.csv", relationship_fields,
                       _relationships(all_rows, relation_rows, crs))
            _write_csv(pending / "boundary-summaries.csv",
                       ["boundary_kind", "collection_id", "source_id", "feature_id",
                        "boundary_label", "boundary_area_ha", "source_boundary_area_ha",
                        "selected_overlap_area_ha", "selection_share_pct",
                        "source_boundary_share_pct", "inventory_denominator"] + summary_fields,
                       ({"boundary_kind": row["kind"], "collection_id": row["collection_id"],
                         "source_id": row["source_id"], "feature_id": row["feature_id"],
                         "boundary_label": row["label"],
                         "boundary_area_ha": row["summary"]["boundary_area_ha"],
                         "source_boundary_area_ha": row["source_boundary_area_ha"],
                         "selected_overlap_area_ha": row["selected_overlap_area_ha"],
                         "selection_share_pct": row["selection_share_pct"],
                         "source_boundary_share_pct": row["source_boundary_share_pct"],
                         "inventory_denominator": row["inventory_denominator"],
                         "context_role": category, **row["summary"][category]}
                        for row in boundary_summaries for category in CATEGORIES))
            record.update(summary=summary, geometry_corrections=len(corrections), notes=[
                "Headline metrics use the union of all selected boundary features.",
                "Overlapping HUC, utility and inventory class summaries are not additive.",
                "Source acquisition scope and source geometry footprint have separate meanings.",
                "NWI occurrence remains visible under unknown, No_Data or conflicting mapping status.",
                "Intersection describes spatial context; it does not infer flow routing or ecological function.",
                "The original native GIS sources and their Z/M or curve lineage remain in the Workspace.",
            ])
            atomic_bytes(pending / "README.md", _readme(record).encode("utf-8"))
            archive_state = {**record, "state": "complete", "files": {
                path.name: describe_file(pending, path)
                for path in sorted(pending.iterdir()) if path.is_file()}}
            atomic_json(pending / "analysis-record.json", archive_state)
            with zipfile.ZipFile(pending / "context-analysis.zip", "w",
                                 compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                for path in sorted(pending.iterdir()):
                    if path.is_file() and path.name != "context-analysis.zip":
                        archive.write(path, arcname=path.name)
            files = {}
            file_keys = {
                "selection.json": "selection", "summary.json": "summary_json",
                "summary.csv": "summary_csv", "sources.json": "sources",
                "geometry-corrections.json": "geometry_corrections",
                "boundary-summaries.json": "boundary_summaries_json",
                "boundary-summaries.csv": "boundary_summaries_csv",
                "preview.json": "preview", "features.geojson": "geojson",
                "features.csv": "features_csv", "relationships.csv": "relationships_csv",
                "README.md": "readme", "analysis-record.json": "portable_record",
                "context-analysis.zip": "archive",
            }
            for name, file_key in file_keys.items():
                source_path = pending / name
                destination = directory / name
                source_path.replace(destination)
                files[file_key] = describe_file(directory, destination)
            record.update(state="complete", files=files, completed_at=now(), updated_at=now(),
                          error=None)
            atomic_json(state_path, record)
            return record
        except Exception as error:
            record.update(state="failed", updated_at=now(),
                          error={"type": type(error).__name__, "message": str(error)})
            atomic_json(state_path, record)
            raise
        finally:
            shutil.rmtree(pending, ignore_errors=True)
