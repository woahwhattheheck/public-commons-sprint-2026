"""Derive retained Lake Keowee parcel criteria from original workspace GIS sources.

The operator and CLI call prepare() for the complete source-geometry operation.
Original geometry, capture coverage, class values and parcel IDs remain bound to
the resulting JSON table, CSV, GeoPackage and published-practice study choices.
"""
from __future__ import annotations

from collections import Counter
from contextlib import ExitStack
import argparse
import csv
import gzip
import hashlib
import io
import json
import math
from pathlib import Path
import re

from model import conservation, keowee_priority
from model.common import (
    atomic_bytes, atomic_json, describe_file, digest, held, identifier, now,
    read_json, verify_file,
)

VERSION = 3
SCHEMA = "upstate.parcel-criteria-selection/v1"
PROFILE_FILE = Path(__file__).resolve().parents[1] / "source" / "parcel-criteria-sources-20261013.json"
ACRE_M2 = 4046.8564224
DEFAULTS = {
    "adjacency_m": 0.0, "waterway_buffer_m": 30.48,
    "spatial_criteria_basis": "whole_original_parcel",
    "land_cover_basis": "whole_parcel", "floodplain_development_basis": "whole_parcel",
    "stream_feature_types": [460], "waterway_feature_types": [460, 336],
    "agricultural_codes": [81, 82], "forest_codes": [41, 42, 43],
    "developed_codes": [21, 22, 23, 24],
    "headwater_orders": [1, 2], "checkpoint_parcels": 100,
    "protected_fraction_threshold": 1.0,
}
DIRECT_ROLES = {
    "historic_wetlands": "historic_wetland_present",
    "dams": "dam_present",
    "logging": "known_logging_operation",
    "private_boat_ramps": "private_boat_ramp_present",
    "private_docks": "private_dock_present",
    "pet_businesses": "pet_traffic_business_present",
    "public_access": "public_access_land",
    "agricultural_permitted": "agricultural_permitted_source",
    "agricultural_unpermitted": "agricultural_unpermitted_source",
    "stormwater_permitted": "stormwater_permitted_source",
    "stormwater_unpermitted": "stormwater_unpermitted_source",
}
NWI_THREE = {"Freshwater Forested/Shrub Wetland", "Freshwater Emergent Wetland", "Riverine"}
NWI_TWO = {"Freshwater Pond", "Lake"}
SPECIAL_MODIFIERS = set("bdfhmrsx")


def _copy(value):
    return json.loads(json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False))


def _text(value, name):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(name + " requires nonempty text")
    return value.strip()


def _number(value, name):
    if isinstance(value, bool):
        raise ValueError(name + " requires a number")
    try:
        result = float(value)
    except (TypeError, ValueError):
        raise ValueError(name + " requires a finite nonnegative number") from None
    if not math.isfinite(result) or result < 0:
        raise ValueError(name + " requires a finite nonnegative number")
    return result


def _json(path):
    raw = path.read_bytes()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    return json.loads(raw.decode("utf-8-sig"))


def _field(properties, name, default=None):
    if name in properties:
        return properties[name]
    suffix = name.rsplit(".", 1)[-1].lower().replace("_", "")
    matches = [key for key in properties
               if key.rsplit(".", 1)[-1].lower().replace("_", "") == suffix]
    if len(matches) > 1:
        raise ValueError("Original source fields are ambiguous for " + name)
    return properties[matches[0]] if matches else default


def _positive(geometry):
    if geometry.is_empty:
        return False
    if geometry.geom_type in ("Polygon", "MultiPolygon"):
        return geometry.area > 0
    if geometry.geom_type in ("LineString", "MultiLineString", "LinearRing"):
        return geometry.length > 0
    if geometry.geom_type in ("Point", "MultiPoint"):
        return True
    return any(_positive(part) for part in geometry.geoms)


def _union(geometries):
    from shapely.geometry import GeometryCollection
    from shapely.ops import unary_union
    values = [g for g in geometries if g is not None and not g.is_empty]
    return values[0] if len(values) == 1 else unary_union(values) if values else GeometryCollection()


def _all(values):
    return False if False in values else None if None in values else True


def _any(values):
    return True if True in values else None if None in values else False


def _not(value):
    return None if value is None else not value


def _source_binding(workspace, choice):
    choice = conservation._choice(choice, "criterion")
    path, entry = workspace.source_file(choice["source_collection_id"], choice["source_id"])
    hashed = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            hashed.update(block)
    if hashed.hexdigest() != entry["body"]["sha256"]:
        raise ValueError("Criterion source bytes differ from their retained edition")
    record = {
        "selection": choice, "id": entry["id"], "kind": entry["kind"],
        "title": entry["title"], "uri": entry["uri"], "vintage": entry["vintage"],
        "body": entry["body"], "role": entry.get("role"), "scope": entry.get("scope"),
        "metadata": entry.get("metadata", {}), "companions": entry.get("companions", []),
        "layer": choice.get("layer") or entry.get("layer"),
        "id_field": choice.get("id_field") or entry.get("id_field"),
    }
    coverage = choice.get("coverage")
    if coverage and coverage.get("source"):
        _, record["coverage_source"] = _source_binding(workspace, coverage["source"])
    return path, record


def _mask_coverage(workspace, choice, crs):
    from pyproj import CRS, Transformer
    from shapely.ops import transform
    from source.capture_upstream_network import esri_polygon

    coverage = choice.get("coverage")
    if not coverage:
        return None
    source = coverage.get("source")
    if source is None:
        raise ValueError("Criterion coverage requires its original retained mask source")
    path, entry = workspace.source_file(source["source_collection_id"], source["source_id"])
    if coverage.get("group"):
        document = _json(path)
        records = document.get(coverage["group"])
        if not isinstance(records, list):
            raise ValueError("The original overlay mask document lacks its selected group")
        geometries = []
        for record in records:
            reference = record["spatial_reference"]
            native = CRS.from_wkt(reference["wkt"]) if reference.get("wkt") else CRS.from_epsg(
                reference.get("latestWkid") or reference["wkid"])
            geometry = esri_polygon(record["geometry"], [], record["id"])
            if native != crs:
                geometry = transform(Transformer.from_crs(native, crs, always_xy=True).transform, geometry)
            geometries.append(geometry)
        return _union(geometries)
    if entry["kind"] != "vector":
        raise ValueError("A coverage source must be the original mask document or retained polygons")
    _, binding = _source_binding(workspace, source)
    rows = conservation._vector(workspace, source, binding, crs)
    if coverage.get("huc12_ids"):
        wanted = set(coverage["huc12_ids"])
        field = coverage.get("huc12_field", "huc12")
        rows = [row for row in rows if str(_field(row["properties"], field)) in wanted]
        if {str(_field(row["properties"], field)) for row in rows} != wanted:
            raise ValueError("The source capture HUC selection is absent from its retained coverage polygons")
    return _union(row["geometry"] for row in rows)


class Layer:
    def __init__(self, workspace, role, choice, binding, crs):
        from shapely.strtree import STRtree
        self.role, self.choice, self.binding = role, choice, binding
        if binding["kind"] != "vector":
            raise ValueError(role + " requires retained vector geometry")
        try:
            self.rows = conservation._vector(workspace, choice, binding, crs)
        except ValueError as error:
            if (not str(error).startswith("The selected native source filter has no features:")
                    and str(error) != "The selected vector source/filter contains no geometry"):
                raise
            path, _ = workspace.source_file(choice["source_collection_id"], choice["source_id"])
            original = _json(path) if path.name.endswith((".json", ".json.gz", ".geojson", ".geojson.gz")) else None
            if not isinstance(original, dict) or original.get("features") != []:
                raise
            self.rows = []
        native_id_field = binding.get("id_field")
        if native_id_field:
            for row in self.rows:
                value = _field(row["properties"], native_id_field)
                if value is None or isinstance(value, bool):
                    raise ValueError(role + " has a missing original native feature identity")
                row["id"] = str(value)
        if len({row["id"] for row in self.rows}) != len(self.rows):
            raise ValueError(role + " repeats the selected original native feature identity")
        self.geometries = [r["geometry"] for r in self.rows]
        self.tree = STRtree(self.geometries)
        self.by_object = {id(geometry): i for i, geometry in enumerate(self.geometries)}
        self.coverage = _mask_coverage(workspace, choice, crs)
        self.fields = sorted({key for row in self.rows for key in row["properties"]})

    def covered(self, zone):
        if zone.is_empty:
            return True
        if self.coverage is None:
            return False
        if self.coverage.covers(zone):
            return True
        if zone.area > 0:
            return zone.difference(self.coverage).area <= max(1e-6, zone.area * 1e-10)
        return False

    def select(self, zone, *, distance=0.0, predicate=None, touches=False):
        target = zone.buffer(distance) if distance > 0 else zone
        if target.is_empty:
            return [], False
        selected, unknown = [], False
        for value in self.tree.query(target):
            index = self.by_object[id(value)] if hasattr(value, "geom_type") else int(value)
            row = self.rows[index]
            geometry = row["geometry"]
            if not geometry.intersects(target):
                continue
            intersection = geometry.intersection(target)
            if not touches:
                if geometry.geom_type in ("Polygon", "MultiPolygon"):
                    positive = intersection.area > 0
                elif geometry.geom_type in ("LineString", "MultiLineString", "LinearRing"):
                    positive = intersection.length > 0
                else:
                    positive = _positive(intersection)
                if not positive:
                    continue
            match = True if predicate is None else predicate(row["properties"])
            if match is None:
                unknown = True
            elif match:
                selected.append(row)
        return selected, unknown

    def flag(self, zone, *, distance=0.0, predicate=None, touches=False):
        rows, unknown = self.select(zone, distance=distance, predicate=predicate, touches=touches)
        target = zone.buffer(distance) if distance > 0 else zone
        return True if rows else None if unknown or not self.covered(target) else False

    def local_union(self, zone, *, distance=0.0, predicate=None, touches=False):
        rows, unknown = self.select(zone, distance=distance, predicate=predicate, touches=touches)
        return _union(row["geometry"] for row in rows), rows, unknown


class OriginalRaster:
    def __init__(self, stack, workspace, binding, analysis_crs):
        import rasterio
        from pyproj import CRS, Transformer
        path, entry = workspace.source_file(binding["selection"]["source_collection_id"],
                                             binding["selection"]["source_id"])
        if entry["kind"] != "raster":
            raise ValueError("Criterion raster input must be an original retained raster")
        self.dataset = stack.enter_context(rasterio.open(path))
        if self.dataset.crs is None:
            raise ValueError("The original criterion raster has no coordinate reference")
        self.crs = CRS.from_user_input(self.dataset.crs)
        if not self.crs.is_projected or self.crs.to_epsg() == 3857 or any(
                abs(axis.unit_conversion_factor - 1) > 1e-8 for axis in self.crs.axis_info[:2]):
            raise ValueError("Criterion cell areas require the retained raster in a projected metre-based CRS")
        self.forward = Transformer.from_crs(analysis_crs, self.crs, always_xy=True).transform
        self.reverse = Transformer.from_crs(self.crs, analysis_crs, always_xy=True).transform
        transform_value = self.dataset.transform
        if (transform_value.b != 0 or transform_value.d != 0
                or transform_value.a <= 0 or transform_value.e >= 0):
            raise ValueError("Criterion cell intersections require the original north-up raster grid")
        self.binding = binding
        self.metadata = {"crs_wkt": self.crs.to_wkt(), "transform": list(self.dataset.transform),
                         "width": self.dataset.width, "height": self.dataset.height,
                         "nodata": self.dataset.nodata if self.dataset.nodata is None
                         or math.isfinite(float(self.dataset.nodata)) else str(self.dataset.nodata),
                         "resampling": "none"}

    def zonal(self, geometry, *, classes=None, geometry_codes=None):
        import numpy as np
        from rasterio.features import shapes
        from shapely.geometry import shape
        from shapely.ops import transform
        zone = transform(self.forward, geometry)
        area = zone.area
        areas, valid_area, weighted_sum, polygons = Counter(), 0.0, 0.0, []
        for window, weights in conservation._area_windows(self.dataset, zone):
            data = self.dataset.read(1, window=window, masked=True)
            raw = np.ma.getdata(data)
            valid = (weights > 0) & ~np.ma.getmaskarray(data) & np.isfinite(raw)
            valid_area += float(np.sum(weights[valid], dtype="float64"))
            weighted_sum += float(np.sum(raw[valid] * weights[valid], dtype="float64"))
            if classes is not None:
                for code in classes:
                    areas[code] += float(np.sum(weights[valid & (raw == code)], dtype="float64"))
            if geometry_codes:
                mask = valid & np.isin(raw, geometry_codes)
                if np.any(mask):
                    for item, _ in shapes(mask.astype("uint8"), mask=mask,
                                          transform=self.dataset.window_transform(window)):
                        clipped = shape(item).intersection(zone)
                        if not clipped.is_empty:
                            polygons.append(transform(self.reverse, clipped))
        missing = max(0.0, area - valid_area)
        return {"area_m2": area, "valid_area_m2": valid_area, "missing_area_m2": missing,
                "coverage_fraction": min(1.0, valid_area / area) if area > 0 else None,
                "class_area_m2": dict(areas),
                "mean": weighted_sum / valid_area if valid_area > 0 else None,
                "geometry": _union(polygons)}

    @staticmethod
    def presence(stat, codes):
        total = sum(stat["class_area_m2"].get(code, 0.0) for code in codes)
        if total > 0:
            return True
        return False if stat["missing_area_m2"] <= max(1e-6, stat["area_m2"] * 1e-10) else None

    @staticmethod
    def fraction_at_least(stat, codes, threshold):
        area = stat["area_m2"]
        if area <= 0:
            return None
        total = sum(stat["class_area_m2"].get(code, 0.0) for code in codes)
        if total / area >= threshold:
            return True
        if (total + stat["missing_area_m2"]) / area < threshold:
            return False
        return None


def _native_ids(rows):
    return sorted({str(row["id"]) for row in rows})


def _matches(properties, field, values):
    value = _field(properties, field)
    if value is None:
        return None
    # Match published numeric fields without coercing boolean records to integers.
    if isinstance(value, bool):
        return value in values and any(isinstance(v, bool) for v in values)
    if isinstance(value, (int, float)):
        return any(not isinstance(v, bool) and value == v for v in values)
    return str(value).strip() in {str(v) for v in values}


def _feature_type(layer, values):
    field = layer.choice.get("fields", {}).get("feature_type", "ftype")
    return lambda properties: _matches(properties, field, values)


def _capture(layer, zone, evidence, *, predicate=None, distance=0.0, touches=False):
    geometry, rows, unknown = layer.local_union(
        zone, predicate=predicate, distance=distance, touches=touches)
    target = zone.buffer(distance) if distance > 0 else zone
    detail = evidence.setdefault(layer.role, {"feature_ids": [], "field_values": {}})
    detail["feature_ids"] = sorted(set(detail["feature_ids"]) | set(_native_ids(rows)))
    detail["coverage_contains_analysis_geometry"] = layer.covered(target)
    detail["matching_field_unknown"] = unknown
    detail["source_collection_id"] = layer.choice["source_collection_id"]
    detail["source_id"] = layer.choice["source_id"]
    complete = not unknown and layer.covered(target)
    return geometry, rows, complete


def _area(layer, zone, evidence, predicate=None):
    geometry, rows, complete = _capture(layer, zone, evidence, predicate=predicate)
    measured = geometry.intersection(zone).area
    return measured, measured if complete else None, rows, complete


def _area_interval(zone, observed, *, coverage=None, complete=False,
                   area_basis="reporting_parcel", source_roles=(), reference):
    """Bound an in-parcel footprint with original positive and certainty geometry."""
    positive = observed.intersection(zone)
    lower_m2 = min(zone.area, max(0.0, positive.area))
    if complete:
        unresolved_m2 = 0.0
    else:
        known = _union([positive, coverage.intersection(zone) if coverage is not None else None])
        unresolved_m2 = min(zone.area - lower_m2, max(0.0, zone.difference(known).area))
    upper_m2 = max(lower_m2, min(zone.area, lower_m2 + unresolved_m2))
    return {
        "lower": lower_m2 / ACRE_M2, "upper": upper_m2 / ACRE_M2,
        "unit": "acres", "closed": True,
        "method": ("original_positive_footprint_plus_unresolved_coverage" if source_roles
                   else "parcel_geometry_area_limit"),
        "reference": reference, "area_basis": area_basis,
        "analysis_area_acres": zone.area / ACRE_M2,
        "observed_positive_acres": lower_m2 / ACRE_M2 if source_roles else None,
        "structural_only": not bool(source_roles),
        "unresolved_acres": (upper_m2 - lower_m2) / ACRE_M2,
        "confirmed_absence_acres": max(0.0, zone.area - upper_m2) / ACRE_M2,
        "source_roles": sorted(set(source_roles)),
        "coverage_complete": complete, "exact": lower_m2 == upper_m2,
        "meaning": "Closed geometric acreage limits from the retained parcel, positively selected footprint, and actual certainty coverage.",
    }


def _class_values(layer, properties):
    field = layer.choice.get("fields", {}).get("classification", "H2OCLASS")
    original = _field(properties, field)
    if original is None or str(original).strip() == "":
        return None
    mapping = layer.choice.get("class_value_map", {})
    mapped = mapping.get(str(original), original)
    # Source-specific aliases belong in class_value_map, never in a fuzzy match.
    return str(mapped).strip().upper()


def _class_flag(layer, zone, classes, evidence):
    def predicate(properties):
        value = _class_values(layer, properties)
        return None if value is None else value in classes
    _, rows, complete = _capture(layer, zone, evidence, predicate=predicate)
    scoped = layer.choice.get("class_scope")
    contains_classes = scoped == "all" or (
        isinstance(scoped, list) and set(classes).issubset(set(scoped)))
    result = True if rows else False if complete and contains_classes else None
    detail = evidence[layer.role]
    detail["classification_scope"] = _copy(scoped)
    detail["source_where"] = _copy(layer.choice.get("where"))
    detail["source_reference"] = layer.choice.get("reference")
    detail["source_meaning"] = layer.choice.get("meaning")
    detail.setdefault("classification_queries", {})["|".join(sorted(classes))] = {
        "requested_classes": sorted(classes), "value": result,
        "source_contains_requested_classes": contains_classes,
        "negative_meaning": "No matching retained feature in the selected classification source inventory",
    }
    return result


def _wetland_type(layer, properties):
    value = _field(properties, layer.choice.get("fields", {}).get("wetland_type", "WETLAND_TYPE"))
    return None if value is None or not str(value).strip() else str(value).strip()


def _wetland_modified(layer, properties):
    value = _field(properties, layer.choice.get("fields", {}).get("wetland_code", "ATTRIBUTE"))
    if value is None or not isinstance(value, str) or not value.strip():
        return None
    match = re.search(r"([a-z]+)$", value.strip())
    return bool(match and SPECIAL_MODIFIERS.intersection(match.group(1)))


def _stream_order(properties, field):
    value = _field(properties, field)
    if value is None or value == "" or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return int(number) if math.isfinite(number) and number.is_integer() and number > 0 else None


def _presence_geometry(geometry, complete):
    return True if geometry.area > 0 else False if complete else None


def _stat_export(stat):
    return {key: value for key, value in stat.items() if key != "geometry"}


def _water_geometry(layers, zone, settings, evidence):
    pieces, completeness = [], []
    flow = layers.get("streams")
    bodies = layers.get("waterbodies")
    for layer, predicate in (
            (flow, _feature_type(flow, settings["waterway_feature_types"]) if flow else None),
            (bodies, None)):
        if layer is None:
            completeness.append(False)
            continue
        geometry, rows, complete = _capture(layer, zone, evidence, predicate=predicate, touches=True)
        pieces.append(geometry)
        completeness.append(complete)
    return _union(pieces), all(completeness)


def _drinking_water_geometry(layers, zone, settings, evidence):
    selected = layers.get("drinking_waterbodies")
    if selected:
        geometry, _, complete = _capture(selected, zone, evidence, touches=True)
        return geometry, complete
    bodies, intakes = layers.get("waterbodies"), layers.get("intakes")
    if bodies is None or intakes is None:
        return _union([]), False
    possible, _ = bodies.select(zone, touches=True)
    matched, inspected, covered = [], [], []
    cache = getattr(bodies, "_intake_links", None)
    if cache is None:
        cache = bodies._intake_links = {}
    for waterbody in possible:
        cache_key = (intakes.binding["body"]["sha256"], str(waterbody["id"]))
        if cache_key not in cache:
            intake_rows, _ = intakes.select(waterbody["geometry"], touches=True)
            cache[cache_key] = (intake_rows, intakes.covered(waterbody["geometry"]))
        intake_rows, complete_body = cache[cache_key]
        inspected.extend(intake_rows)
        covered.append(complete_body)
        if intake_rows:
            matched.append(waterbody)
    evidence["drinking_water_link"] = {
        "waterbody_source_id": bodies.choice["source_id"],
        "intake_source_id": intakes.choice["source_id"],
        "waterbody_feature_ids": _native_ids(matched), "intake_feature_ids": _native_ids(inspected),
        "relation": "Original retained intake point intersects the original waterbody polygon",
    }
    # Absence requires that all intersecting waterbodies and their entire intake
    # lookup polygons fall within the actual intake acquisition footprint.
    complete = bodies.covered(zone) and all(covered)
    return _union(row["geometry"] for row in matched), complete


def _derive_parcel(unit, layers, rasters, settings, metric_types):
    full, reporting = unit["geometry"], unit["clipped"]
    basis = settings["spatial_criteria_basis"]
    zone = full if basis == "whole_original_parcel" else reporting
    values = {key: None for key in metric_types}
    evidence, metric_bounds = {}, {}
    raw = {
        "whole_parcel_acres": full.area / ACRE_M2,
        "reporting_parcel_acres": reporting.area / ACRE_M2,
        "reporting_share": reporting.area / full.area,
        "spatial_criteria_acres": zone.area / ACRE_M2,
        "spatial_criteria_basis": basis,
        "stream_orders": None, "stream_length_m": None,
    }
    values["parcel_acres"] = raw["whole_parcel_acres"]
    metric_bounds["parcel_acres"] = _area_interval(
        full, full, complete=True, area_basis="whole_original_parcel", source_roles=["parcels"],
        reference="Original full parcel geometry retained by this study; Lake Keowee Appendix D, printed page 142.")
    adjacency = settings["adjacency_m"]

    protected = layers.get("protected_lands")
    if protected:
        observed, complete_area, _, complete = _area(protected, full, evidence)
        fraction = min(1.0, observed / full.area)
        raw["protected_area_acres_observed"] = observed / ACRE_M2
        raw["protected_fraction_observed"] = fraction
        limit = settings["protected_fraction_threshold"]
        values["already_protected"] = (
            True if fraction + 1e-10 >= limit else False if complete else None)
        _, near_rows, near_complete = _capture(protected, full, evidence,
                                              distance=adjacency, touches=True)
        values["adjacent_to_protected_land"] = True if near_rows else False if near_complete else None

    streams = layers.get("streams")
    if streams:
        geometry, rows, complete = _capture(
            streams, zone, evidence, predicate=_feature_type(streams, settings["stream_feature_types"]))
        measured = geometry.intersection(zone).length
        raw["stream_length_m_observed"] = measured
        raw["stream_length_m"] = measured if complete else None
        evidence["streams"]["length_definition"] = (
            "Union of selected original stream/river lines intersected with " + basis)
        evidence["streams"]["area_basis"] = basis
    orders = layers.get("stream_orders")
    if orders:
        _, rows, complete = _capture(orders, zone, evidence)
        field = orders.choice.get("fields", {}).get("stream_order", "streamorde")
        observed = sorted({value for row in rows
                           if (value := _stream_order(row["properties"], field)) is not None})
        unknown_ids = [str(row["id"]) for row in rows if _stream_order(row["properties"], field) is None]
        raw["stream_orders_observed"] = observed
        raw["stream_orders"] = observed if complete and not unknown_ids else None
        values["headwater_stream"] = (
            True if set(observed).intersection(settings["headwater_orders"])
            else False if complete and not unknown_ids else None)
        evidence["stream_orders"].update(field=field, missing_order_feature_ids=unknown_ids,
                                         headwater_orders=settings["headwater_orders"])

    classifications = layers.get("classifications")
    quality = layers.get("high_quality_classes") or classifications
    if quality:
        values["stream_orw_or_tn"] = _class_flag(quality, zone, {"ORW", "TN"}, evidence)
        values["stream_tpgt"] = _class_flag(quality, zone, {"TPGT"}, evidence)
    fw = _class_flag(classifications, zone, {"FW"}, evidence) if classifications else None
    raw["water_classifications"] = []
    for classified in (classifications, quality):
        if classified is None:
            continue
        _, selected, _ = _capture(classified, zone, evidence)
        raw["water_classifications"] = sorted(set(raw["water_classifications"]) | {
            value for row in selected if (value := _class_values(classified, row["properties"])) is not None})
        field = classified.choice.get("fields", {}).get("classification", "H2OCLASS")
        evidence[classified.role]["field_values"][field] = sorted({
            str(value) for row in selected if (value := _field(row["properties"], field)) is not None})
    impairment = layers.get("impairments")
    if impairment:
        _, selected, complete = _capture(impairment, zone, evidence, touches=False)
        values["associated_with_selected_impairment"] = True if selected else False if complete else None
        evidence["impairments"]["relation"] = impairment.choice["relation"]
    impairment_flag = values["associated_with_selected_impairment"]
    values["stream_fw_with_listed_impairment"] = _all([fw, impairment_flag])
    values["stream_fw_without_listed_impairment"] = _all([fw, _not(impairment_flag)])

    # Every observed component is a positive subset of the published union.
    # Missing components enlarge the acreage interval; they never remove a
    # positively mapped surface-water buffer or variable riparian footprint.
    sensitive = layers.get("sensitive_riparian")
    sensitive_geometry, sensitive_complete, sensitive_coverage = _union([]), False, None
    sensitive_roles = []
    if sensitive:
        geometry, _, sensitive_complete = _capture(sensitive, zone, evidence)
        sensitive_geometry = geometry.intersection(zone)
        sensitive_coverage = sensitive.coverage
        sensitive_roles.append("sensitive_riparian")
    else:
        lookup = zone.buffer(settings["waterway_buffer_m"])
        waterways, water_complete = _water_geometry(layers, lookup, settings, evidence)
        constant = waterways.buffer(settings["waterway_buffer_m"]).intersection(zone)
        sensitive_geometry = constant
        raw["waterway_buffer_acres_observed"] = constant.area / ACRE_M2
        sensitive_roles.extend(role for role in ("streams", "waterbodies") if layers.get(role))
        variable = layers.get("variable_riparian")
        if variable:
            geometry, _, variable_complete = _capture(variable, zone, evidence)
            sensitive_geometry = _union([constant, geometry.intersection(zone)])
            sensitive_complete = water_complete and variable_complete
            sensitive_roles.append("variable_riparian")
    raw["sensitive_riparian_acres_observed"] = (
        sensitive_geometry.area / ACRE_M2 if sensitive_roles else None)
    interval = _area_interval(
        zone, sensitive_geometry, coverage=sensitive_coverage, complete=sensitive_complete,
        source_roles=sensitive_roles, area_basis=basis,
        reference="Lake Keowee Appendix D, printed page 139: original variable riparian footprint unioned with the selected surface-water buffer; observed components remain positive subsets of that union.")
    metric_bounds["sensitive_riparian_acres"] = interval
    values["sensitive_riparian_acres"] = (
        interval["lower"] if interval["lower"] == interval["upper"] else None)
    values["sensitive_riparian_present"] = _presence_geometry(
        sensitive_geometry, sensitive_complete or interval["lower"] == interval["upper"])

    wetlands = layers.get("wetlands")
    if wetlands:
        for metric, types in (
                ("wetland_forested_shrub_emergent_or_riverine", NWI_THREE),
                ("wetland_pond_or_lake", NWI_TWO)):
            predicate = lambda properties, selected=types: (
                None if _wetland_type(wetlands, properties) is None
                else _wetland_type(wetlands, properties) in selected)
            _, rows, complete = _capture(wetlands, zone, evidence, predicate=predicate)
            values[metric] = True if rows else False if complete else None
        _, rows, complete = _capture(
            wetlands, zone, evidence, predicate=lambda props: _wetland_modified(wetlands, props))
        values["modified_wetland_present"] = True if rows else False if complete else None
        _, all_rows, _ = _capture(wetlands, zone, evidence)
        raw["wetland_types"] = sorted({
            kind for row in all_rows if (kind := _wetland_type(wetlands, row["properties"])) is not None})
        code_field = wetlands.choice.get("fields", {}).get("wetland_code", "ATTRIBUTE")
        raw["wetland_codes"] = sorted({
            str(code) for row in all_rows if (code := _field(row["properties"], code_field)) is not None})
        evidence["wetlands"]["field_values"] = {
            "types": raw["wetland_types"], "codes": raw["wetland_codes"],
            "modifier_codes": sorted(SPECIAL_MODIFIERS)}

    hydric = layers.get("hydric_soils")
    hydric_geometry, hydric_complete = _union([]), False
    if hydric:
        hydric_geometry, _, hydric_complete = _capture(hydric, zone, evidence)
        raw["hydric_soil_acres_observed"] = hydric_geometry.intersection(zone).area / ACRE_M2
    else:
        raw["hydric_soil_acres_observed"] = None
    interval = _area_interval(
        zone, hydric_geometry, coverage=hydric.coverage if hydric else None,
        complete=hydric_complete, source_roles=["hydric_soils"] if hydric else [],
        area_basis=basis,
        reference="Lake Keowee Appendix D, printed page 140: acres of the selected original hydric-soil footprint in the declared parcel scoring geometry. Mixed or unmapped soil areas remain inside the upper limit until the retained source resolves them.")
    metric_bounds["hydric_soil_acres"] = interval
    values["hydric_soil_acres"] = (
        interval["lower"] if interval["lower"] == interval["upper"] else None)

    floodplain = layers.get("floodplains")
    flood_geometry, flood_complete = _union([]), False
    if floodplain:
        geometry, _, flood_complete = _capture(floodplain, zone, evidence)
        flood_geometry = geometry.intersection(zone)
        values["floodplain_present"] = _presence_geometry(flood_geometry, flood_complete)
        raw["floodplain_acres_observed"] = flood_geometry.area / ACRE_M2

    swpa = layers.get("source_water_protection")
    if swpa:
        _, rows, complete = _capture(swpa, zone, evidence)
        values["source_water_protection_area_present"] = True if rows else False if complete else None

    land_cover = rasters.get("land_cover")
    if land_cover:
        cover_zone = full if settings["land_cover_basis"] == "whole_parcel" else reporting
        classes = sorted(set(settings["agricultural_codes"] + settings["forest_codes"] +
                             settings["developed_codes"]))
        stat = land_cover.zonal(cover_zone, classes=classes,
                               geometry_codes=settings["agricultural_codes"])
        raw["land_cover"] = _stat_export(stat)
        values["developed_land_present"] = land_cover.presence(stat, settings["developed_codes"])
        values["agricultural_cover_at_least_half"] = land_cover.fraction_at_least(
            stat, settings["agricultural_codes"], 0.5)
        agriculture = stat["geometry"]
        water, water_complete = _water_geometry(layers, cover_zone.buffer(adjacency), settings, evidence)
        adjacent = agriculture.intersects(water) if adjacency == 0 else (
            not agriculture.is_empty and not water.is_empty and agriculture.distance(water) <= adjacency)
        agriculture_complete = stat["missing_area_m2"] <= max(1e-6, stat["area_m2"] * 1e-10)
        values["agriculture_adjacent_to_water"] = (
            True if adjacent else False if agriculture_complete and water_complete else None)
        if not sensitive_geometry.is_empty:
            riparian_cover = land_cover.zonal(sensitive_geometry, classes=settings["forest_codes"])
            raw["sensitive_riparian_land_cover"] = _stat_export(riparian_cover)
            forest = land_cover.presence(riparian_cover, settings["forest_codes"])
            values["forested_sensitive_riparian_present"] = (
                True if forest is True else False if sensitive_complete and forest is False else None)
        elif sensitive_complete:
            values["forested_sensitive_riparian_present"] = False
        if values["floodplain_present"] is False:
            values["floodplain_with_development"] = False
            values["floodplain_without_development"] = False
        elif values["floodplain_present"] is True:
            if settings["floodplain_development_basis"] == "whole_parcel":
                if cover_zone.equals(full):
                    development = values["developed_land_present"]
                else:
                    flood_stat = land_cover.zonal(full, classes=settings["developed_codes"])
                    development = land_cover.presence(flood_stat, settings["developed_codes"])
            else:
                flood_stat = land_cover.zonal(flood_geometry, classes=settings["developed_codes"])
                raw["floodplain_land_cover"] = _stat_export(flood_stat)
                development = land_cover.presence(flood_stat, settings["developed_codes"])
                if development is False and not flood_complete:
                    development = None
            values["floodplain_with_development"] = development
            values["floodplain_without_development"] = _not(development)
        evidence["land_cover"] = {
            "source_collection_id": land_cover.binding["selection"]["source_collection_id"],
            "source_id": land_cover.binding["selection"]["source_id"],
            "area_basis": settings["land_cover_basis"],
            "floodplain_development_basis": settings["floodplain_development_basis"],
            "valid_area_m2": stat["valid_area_m2"], "missing_area_m2": stat["missing_area_m2"],
            "class_area_m2": stat["class_area_m2"], "resampling": "none",
        }
    elif values["floodplain_present"] is False:
        values["floodplain_with_development"] = False
        values["floodplain_without_development"] = False

    water_lookup = zone.buffer(adjacency) if adjacency else zone
    drinking, drinking_complete = _drinking_water_geometry(layers, water_lookup, settings, evidence)
    water, water_complete = _water_geometry(layers, water_lookup, settings, evidence)
    drinking_contact = (not drinking.is_empty and
                        (zone.intersects(drinking) if adjacency == 0 else zone.distance(drinking) <= adjacency))
    other = water.difference(drinking)
    other_contact = (not other.is_empty and
                     (zone.intersects(other) if adjacency == 0 else zone.distance(other) <= adjacency))
    values["adjacent_to_drinking_water"] = (
        True if drinking_contact else False if drinking_complete else None)
    # Other water is defined after removing the positively matched drinking
    # waterbody geometry; full absence also needs the source-water inventory.
    values["adjacent_to_other_water"] = (
        True if other_contact and drinking_complete
        else False if water_complete and drinking_complete else None)

    for role, metric in DIRECT_ROLES.items():
        layer = layers.get(role)
        if layer:
            _, rows, complete = _capture(layer, zone, evidence, touches=False)
            values[metric] = True if rows else False if complete else None

    critical = rasters.get("critical_watershed_area")
    if critical:
        stat = critical.zonal(zone)
        raw["critical_watershed_area"] = _stat_export(stat)
        levels = critical.binding["selection"].get("classification")
        if levels and stat["mean"] is not None and stat["missing_area_m2"] <= max(1e-6, stat["area_m2"] * 1e-10):
            value = stat["mean"]
            values["cwa_priority"] = (
                "high" if value >= levels["high_min"] else "medium" if value >= levels["medium_min"] else "low")
        evidence["critical_watershed_area"] = {
            "source_id": critical.binding["id"], "parcel_mean": stat["mean"],
            "classification": levels, "area_basis": basis,
            "units": critical.binding["selection"].get("units"),
        }
    values.update(raw)
    return {
        "id": unit["id"], "label": unit["label"], "metrics": values, "metric_bounds": metric_bounds,
        "evidence": evidence, "spatial_criteria_basis": basis,
        "geometry_corrections": unit["geometry_corrections"],
        "original_source_array_index": unit["source_array_index"],
    }


def _complete_population(rows, settings):
    positive = [row["metrics"]["stream_length_m"] for row in rows
                if row["metrics"]["stream_length_m"] is not None and row["metrics"]["stream_length_m"] > 0]
    incomplete = [row["id"] for row in rows if row["metrics"]["stream_length_m"] is None]
    mean = math.fsum(positive) / len(positive) if positive else None
    # The whole selected study must be covered for the published study mean.
    for row in rows:
        length = row["metrics"]["stream_length_m"]
        row["metrics"]["stream_length_above_study_mean"] = (
            length > mean if length is not None and mean is not None and not incomplete
            else False if length == 0 and not incomplete else None)
    return {
        "metric": "stream_length_m", "statistic": "arithmetic_mean",
        "population": "All selected parcels with a positive complete original stream length under the saved spatial_criteria_basis",
        "spatial_criteria_basis": settings["spatial_criteria_basis"],
        "complete_parcels": len(rows) - len(incomplete),
        "positive_parcels": len(positive), "incomplete_parcel_count": len(incomplete),
        "threshold_m": mean if not incomplete else None,
        "available_complete_rows_mean_m": mean, "comparison": "strictly_greater",
        "reference": "Lake Keowee Watershed Plan (2020), Appendix D, printed page 141; recomputed for this actual study.",
    }


def _definition():
    raw = PROFILE_FILE.read_bytes()
    profile = json.loads(raw)
    if profile.get("schema") != "upstate.parcel-criteria-source-profile/v1":
        raise ValueError("The installed criterion source profile has another schema")
    return profile, hashlib.sha256(raw).hexdigest()


def _settings(value):
    supplied = _copy(value or {})
    if set(supplied) - set(DEFAULTS):
        raise ValueError("Unknown parcel criterion settings: " + ", ".join(sorted(set(supplied) - set(DEFAULTS))))
    result = {**_copy(DEFAULTS), **supplied}
    for key in ("adjacency_m", "waterway_buffer_m", "protected_fraction_threshold"):
        result[key] = _number(result[key], key)
    if not 0 < result["protected_fraction_threshold"] <= 1:
        raise ValueError("The original protected fraction threshold must be greater than zero and at most one")
    for key in ("stream_feature_types", "waterway_feature_types", "agricultural_codes",
                "forest_codes", "developed_codes", "headwater_orders"):
        if not isinstance(result[key], list) or not result[key]:
            raise ValueError(key + " requires actual source-code values")
        if any(isinstance(x, bool) or not isinstance(x, int) or x < 0 for x in result[key]):
            raise ValueError(key + " must contain nonnegative integer source codes")
        result[key] = sorted(set(result[key]))
    if result["headwater_orders"] != [1, 2]:
        raise ValueError("The canonical table uses orders [1, 2]; select the protection first-order variant through its raw stream_orders binding")
    if result["spatial_criteria_basis"] not in ("whole_original_parcel", "reporting_parcel"):
        raise ValueError("Source criterion geometry must be whole_original_parcel or reporting_parcel")
    if result["land_cover_basis"] not in ("whole_parcel", "reporting_parcel"):
        raise ValueError("Land-cover basis must be whole_parcel or reporting_parcel")
    if result["floodplain_development_basis"] not in ("whole_parcel", "floodplain_intersection"):
        raise ValueError("Choose whole_parcel or floodplain_intersection development explicitly")
    count = result["checkpoint_parcels"]
    if isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= 10000:
        raise ValueError("checkpoint_parcels must be an integer from 1 to 10000")
    return result


def _coverage_from_entry(edition, entry):
    for holder in (entry.get("metadata"), entry.get("scope")):
        if isinstance(holder, dict) and isinstance(holder.get("criteria_coverage"), dict):
            coverage = _copy(holder["criteria_coverage"])
            source = coverage.get("source")
            if not isinstance(source, dict) or not source.get("source_id"):
                raise ValueError("Retained criterion coverage requires its exact original source ID")
            if source.get("source_collection_id") is None:
                source["source_collection_id"] = edition["id"]
            return coverage
    scope = entry.get("metadata", {}).get("scope")
    masks = [item for item in edition["entries"] if item["id"] == "overlay-native-selection-context"]
    if scope in ("reporting", "focus") and len(masks) == 1:
        return {"source": {"source_collection_id": edition["id"], "source_id": masks[0]["id"]},
                "group": scope,
                "reference": "Original complete object-ID capture against the retained overlay masks"}
    return None


def _matches_source(entry, variant):
    if entry["kind"] != variant.get("kind", "vector"):
        return False
    uri = str(entry.get("uri", "")).rstrip("/").lower().split("?")[0]
    role = str(entry.get("role", "")).upper()
    if role in {str(value).upper() for value in variant.get("excluded_roles", [])}:
        return False
    metadata = entry.get("metadata") or {}
    if any(metadata.get(key) != value for key, value in variant.get("required_metadata", {}).items()):
        return False
    if any(key not in metadata or metadata[key] is None
           for key in variant.get("required_metadata_keys", [])):
        return False
    if any(key in metadata and metadata[key] == value
           for key, value in variant.get("excluded_metadata", {}).items()):
        return False
    token = " ".join(str(entry.get(key, "")) for key in ("id", "title", "uri")).lower()
    identity = bool(
        entry["id"] in variant.get("ids", [])
        or uri in [str(value).rstrip("/").lower() for value in variant.get("uris", [])]
        or role in variant.get("roles", []))
    return identity and all(str(term).lower() in token for term in variant.get("required_text", []))


def _auto_sources(workspace, study, overrides, profile):
    editions = workspace.sources()
    catalog = profile["roles"]
    if not isinstance(overrides, dict) or set(overrides) - set(catalog):
        raise ValueError("Criterion source roles must use the installed source profile")
    result, resolution = {}, {}
    native_land_cover = None
    spec = study["selection"]["spec"]
    if spec["mode"] == "native_model":
        run = workspace.inspect_run(spec["baseline_run_id"])
        grid = workspace.get_grid(run["selection"]["grid_id"])
        native_land_cover = {
            "source_collection_id": grid["spec"]["source_collection_id"],
            "source_id": grid["spec"]["input_sources"]["NLCD"],
            "reference": "Original NLCD source selected by the retained native grid",
        }
    for role, descriptor in catalog.items():
        if role in overrides:
            if overrides[role] is None:
                resolution[role] = {"state": "explicitly_omitted"}
                continue
            result[role] = _copy(overrides[role])
            resolution[role] = {"state": "explicit_original_source"}
            continue
        if role == "land_cover" and native_land_cover:
            result[role] = native_land_cover
            resolution[role] = {"state": "selected_native_grid_original_source",
                                **native_land_cover}
            continue
        matches = []
        for edition in editions:
            for entry in edition["entries"]:
                for variant in descriptor.get("variants", []):
                    if _matches_source(entry, variant):
                        matches.append((int(variant.get("priority", 0)), str(edition.get("captured_at", "")),
                                        edition["id"], entry["id"], edition, entry, variant))
        preferred = study["selection"]["spec"].get("contexts", {}).get("protected_lands") if role == "protected_lands" else None
        if preferred:
            for item in matches:
                if item[2] == preferred["source_collection_id"] and item[3] == preferred["source_id"]:
                    item = (100000, *item[1:])
                    matches.append(item)
                    break
        if not matches:
            resolution[role] = {"state": "no_matching_retained_source"}
            continue
        selected = sorted(matches, key=lambda item: item[:4])[-1]
        _, _, _, _, edition, entry, variant = selected
        choice = {**_copy(descriptor.get("selection", {})), **_copy(variant.get("selection", {})),
                  "source_collection_id": edition["id"], "source_id": entry["id"]}
        if entry.get("layer"):
            choice["layer"] = entry["layer"]
        if entry.get("id_field"):
            choice["id_field"] = entry["id_field"]
        if preferred and (edition["id"], entry["id"]) == (
                preferred["source_collection_id"], preferred["source_id"]):
            choice.update(_copy(preferred))
        metadata = entry.get("metadata", {})
        declared = metadata.get("parcel_criteria")
        if isinstance(declared, dict):
            for key in ("fields", "class_scope", "class_value_map", "where", "relation",
                        "classification", "units", "reference", "meaning"):
                if key in declared:
                    choice[key] = _copy(declared[key])
        coverage = _coverage_from_entry(edition, entry)
        if coverage:
            choice["coverage"] = coverage
        result[role] = choice
        resolution[role] = {
            "state": "retained_source_selected", "source_collection_id": edition["id"],
            "source_id": entry["id"], "uri": entry["uri"],
            "selection_rule": "Declared original source identity/role, profile priority, latest capture, stable edition identity",
            "matching_editions": sorted({item[2] for item in matches}),
            "actual_coverage_source": choice.get("coverage"),
        }
    return result, resolution


def _normalize_sources(workspace, sources, profile):
    choices, bindings = {}, {}
    for role, raw in sources.items():
        choice = conservation._choice(raw, role)
        for key in ("fields", "class_value_map"):
            if key in choice and not isinstance(choice[key], dict):
                raise ValueError(role + " " + key + " must be an original field mapping")
        if "fields" in choice and not all(isinstance(v, str) and v for v in choice["fields"].values()):
            raise ValueError(role + " field names must be original nonempty strings")
        if role in ("classifications", "high_quality_classes"):
            scope = choice.get("class_scope")
            if scope is not None and scope != "all" and (
                    not isinstance(scope, list) or not all(isinstance(v, str) for v in scope)):
                raise ValueError("Classification source scope must be all or its original captured class values")
        if role == "impairments":
            choice["relation"] = _text(choice.get("relation"), "Selected impairment association")
            choice["reference"] = _text(choice.get("reference"), "Selected impairment edition and pollutant scope")
        if role == "critical_watershed_area" and choice.get("classification"):
            levels = choice["classification"]
            for key in ("medium_min", "high_min"):
                levels[key] = _number(levels.get(key), "Critical watershed " + key)
            if levels["medium_min"] >= levels["high_min"]:
                raise ValueError("Critical watershed class cutoffs must increase")
            levels["reference"] = _text(levels.get("reference"), "Critical watershed class reference")
        _, bound = _source_binding(workspace, choice)
        expected = profile["roles"][role].get("kind", "vector")
        if bound["kind"] != expected:
            raise ValueError(role + " needs its original " + expected + " source")
        choices[role], bindings[role] = choice, bound
    return choices, bindings


def _geometry_study(workspace, value):
    has_id, has_study = bool(value.get("study_id")), isinstance(value.get("study"), dict)
    if has_id == has_study:
        raise ValueError("Select exactly one original study_id or complete study geography")
    if has_id:
        state = conservation.inspect(workspace, identifier(value["study_id"]), include_candidates=False)
        if state["selection"]["spec"]["unit_type"] != "parcel":
            raise ValueError("The published criteria require original parcel planning units")
        return state
    study = _copy(value["study"])
    study["unit_type"] = study.get("unit_type", "parcel")
    if study["unit_type"] != "parcel":
        raise ValueError("The published criteria require original parcel planning units")
    study["score"] = {"basis": "context", "context_weights": {
        "source_water_fraction": 0, "unprotected_fraction": 0, "high_quality_context": 0}}
    study["purpose"] = "screening"
    study["title"] = _text(study.get("title"), "Original parcel geometry study title")
    # Costs and scoring alternatives do not affect criterion geometry. Retain the
    # actual baseline/grid and context selections while avoiding an unrelated
    # cost-table or native alternative dependency in this source operation.
    study.pop("costs", None)
    study["alternative_run_ids"] = []
    return conservation.prepare(workspace, study)


def _metric_types():
    document, _ = keowee_priority.definition()
    result = {}
    for method in document["categories"]:
        for metric, kind in keowee_priority.metric_types(method).items():
            if metric in result and result[metric] != kind:
                raise ValueError("Published criterion definitions disagree")
            result[metric] = kind
    return result


def _metric_geometry(settings, metric_types):
    """Retain the actual geometry choice for every source-derived criterion."""
    basis = settings["spatial_criteria_basis"]
    result = {name: {"area_basis": basis} for name in metric_types}
    for name in ("stream_orders", "stream_length_m", "spatial_criteria_acres"):
        result[name] = {"area_basis": basis}
    for name in ("parcel_acres", "already_protected", "adjacent_to_protected_land"):
        if name in result:
            result[name] = {"area_basis": "whole_original_parcel"}
    for name in ("developed_land_present", "agricultural_cover_at_least_half",
                 "agriculture_adjacent_to_water"):
        if name in result:
            result[name] = {
                "area_basis": "whole_original_parcel" if settings["land_cover_basis"] == "whole_parcel" else "reporting_parcel"}
    for name in ("floodplain_with_development", "floodplain_without_development"):
        if name in result:
            result[name] = {
                "area_basis": basis,
                "development_basis": settings["floodplain_development_basis"],
                "meaning": "Floodplain presence uses the spatial criterion geometry; development uses the independently selected basis."}
    for name in ("nitrogen_export_priority", "phosphorus_export_priority", "sediment_export_priority"):
        if name in result:
            result[name] = {
                "area_basis": None,
                "meaning": "The source-only builder leaves this model criterion unresolved. An explicit native export binding records its own reporting footprint and support."}
    return result


def _coverage(rows, metric_types, source_resolution):
    fields = {}
    for name, kind in metric_types.items():
        values = [row["metrics"].get(name) for row in rows]
        known = [value for value in values if value is not None]
        summary = {"kind": kind, "known": len(known), "unknown": len(values) - len(known)}
        if kind == "boolean":
            summary.update(true=sum(v is True for v in values), false=sum(v is False for v in values))
        elif kind == "level":
            summary["levels"] = dict(Counter(known))
        elif known:
            summary.update(minimum=min(known), maximum=max(known))
        intervals = [row.get("metric_bounds", {}).get(name) for row in rows]
        present = [interval for interval in intervals if interval is not None]
        if present:
            summary.update(
                intervals=len(present),
                bounded_unknown=sum(value is None and interval is not None
                                    for value, interval in zip(values, intervals)),
                minimum_lower=min(interval["lower"] for interval in present),
                maximum_upper=max(interval["upper"] for interval in present),
                interval_unit=present[0]["unit"])
        fields[name] = summary
    return {"parcels": len(rows), "fields": fields,
            "source_roles": {name: value["state"] for name, value in source_resolution.items()}}


def _csv(path, rows, fields):
    def printable(value):
        if isinstance(value, (dict, list)):
            return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)
        if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")):
            return "'" + value
        return value
    interval_fields = sorted({key for row in rows for key in row.get("metric_bounds", {})})
    bound_columns = [name + suffix for name in interval_fields for suffix in ("_lower", "_upper")]
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=["id", "label", *fields, *bound_columns, "metric_bounds"])
    writer.writeheader()
    for row in rows:
        intervals = row.get("metric_bounds", {})
        writer.writerow({key: printable(value) for key, value in {
            "id": row["id"], "label": row["label"],
            **{key: row["metrics"].get(key) for key in fields},
            **{name + "_" + end: intervals.get(name, {}).get(end)
               for name in interval_fields for end in ("lower", "upper")},
            "metric_bounds": intervals}.items()})
    atomic_bytes(path, stream.getvalue().encode("utf-8"))


def _geopackage(path, crs, units, rows, metric_types):
    import fiona
    from shapely.geometry import mapping
    temporary = path.with_name(path.stem + ".partial.gpkg")
    if temporary.exists():
        temporary.unlink()
    interval_fields = sorted({key for row in rows for key in row.get("metric_bounds", {})})
    properties = {
        "parcel_id": "str", "label": "str", "whole_acres": "float",
        "reporting_acres": "float", "criteria_acres": "float", "criteria_basis": "str",
        "stream_m": "float", "stream_orders": "str",
        **{key: "int" if kind == "boolean" else "float" if kind == "number" else "str"
           for key, kind in metric_types.items()},
        **{name + "_" + end: "float" for name in interval_fields for end in ("lower", "upper")},
        "metric_bounds": "str",
    }
    by_id = {row["id"]: row for row in rows}
    for name, geometry_key in (("original_parcels", "geometry"), ("reporting_parcels", "clipped")):
        with fiona.open(temporary, mode="w", driver="GPKG", layer=name, crs_wkt=crs.to_wkt(),
                        schema={"geometry": "MultiPolygon", "properties": properties}) as destination:
            for unit in units:
                row = by_id[unit["id"]]
                metrics = row["metrics"]
                record = {
                    "parcel_id": row["id"], "label": row["label"],
                    "whole_acres": metrics["whole_parcel_acres"],
                    "reporting_acres": metrics["reporting_parcel_acres"],
                    "criteria_acres": metrics["spatial_criteria_acres"],
                    "criteria_basis": metrics["spatial_criteria_basis"],
                    "stream_m": metrics["stream_length_m"],
                    "stream_orders": json.dumps(metrics["stream_orders"]),
                    **{key: int(metrics[key]) if kind == "boolean" and metrics[key] is not None
                       else metrics[key] for key, kind in metric_types.items()},
                    **{name + "_" + end: row.get("metric_bounds", {}).get(name, {}).get(end)
                       for name in interval_fields for end in ("lower", "upper")},
                    "metric_bounds": json.dumps(row.get("metric_bounds", {}), ensure_ascii=False,
                                                sort_keys=True, allow_nan=False),
                }
                destination.write({"geometry": mapping(conservation._multipolygon(unit[geometry_key])),
                                   "properties": record})
    temporary.replace(path)


def _source_manifest(state, directory, table, descriptors):
    identity = "parcel-criteria-" + state["id"][:24]
    scope = {
        "study_id": state["study_id"],
        "geometry_context": state["selection"]["geometry_context"],
        "geometry_context_sha256": state["selection"]["geometry_context_sha256"],
        "builder_id": state["id"], "parcel_count": len(table["rows"]),
        "metric_coverage": table["coverage"], "field_names": table["fields"],
        "numeric_intervals": table["numeric_intervals"],
        "spatial_criteria_basis": table["spatial_criteria_basis"],
        "metric_geometry": table["metric_geometry"],
        "definition_sha256": state["selection"]["method_definition_sha256"],
        "role": "PUBLISHED_PARCEL_CRITERIA",
    }
    files = {key: {"path": Path(value["path"]).name, "sha256": value["sha256"]}
             for key, value in descriptors.items()}
    return {
        "schema": "upstate.sources/v1",
        "title": state["title"], "captured_at": state["created_at"], "scope": scope,
        "notes": [
            "Original source-derived parcel criteria; JSON preserves true, false, null and exact original parcel IDs.",
            "CSV is an exported viewing table; its formula-like text is escaped for spreadsheet display.",
            "GeoPackage contains both original and reporting parcel geometries with source-derived criteria.",
            "Numeric acreage intervals retain lower/upper limits and original source/coverage meaning; canonical acreage stays null when unresolved.",
        ],
        "entries": [
            {"id": identity, "kind": "table", "role": "PUBLISHED_PARCEL_CRITERIA",
             "title": state["title"], "uri": "urn:upstate:parcel-criteria:" + state["id"],
             "vintage": state["created_at"], "path": "criteria.json",
             "sha256": descriptors["table"]["sha256"], "format": "json", "id_column": "id",
             "scope": scope, "units": "Field-specific original spatial quantities and published criterion flags",
             "companions": [files[key] for key in ("csv", "geopackage", "selection", "definitions")]},
            {"id": identity + "-geometry", "kind": "vector", "role": "PARCEL_CRITERIA_GEOMETRY",
             "title": state["title"] + " - original and reporting geometry",
             "uri": "urn:upstate:parcel-criteria:" + state["id"] + ":geometry",
             "vintage": state["created_at"], "path": "criteria.gpkg",
             "sha256": descriptors["geopackage"]["sha256"],
             "layer": "reporting_parcels", "id_field": "parcel_id", "scope": scope},
        ],
    }


def inspect(workspace, key):
    key = identifier(key)
    directory = workspace.root / "parcel-criteria" / key
    state = read_json(directory / "state.json")
    if state["id"] != key or digest(state["selection"]) != key:
        raise ValueError("Retained parcel criterion operation identity differs")
    if state["state"] == "complete":
        result = read_json(directory / "result.json")
        for descriptor in result["files"].values():
            verify_file(workspace.root, descriptor)
        return result
    return state


def overview(workspace):
    return {
        "schema": "upstate.parcel-criteria-overview/v1",
        "operations": [
            {key: value.get(key) for key in ("id", "title", "state", "study_id", "progress",
                                            "created_at", "updated_at", "source_collection_id", "source_id",
                                            "spatial_criteria_basis")}
            for path in sorted((workspace.root / "parcel-criteria").glob("*/state.json"))
            for value in [read_json(path)]
        ],
    }


def prepare(workspace, value):
    """Compute/resume the complete source-derived table and import it into Workspace."""
    profile, profile_sha = _definition()
    if isinstance(value, str):
        existing = inspect(workspace, value)
        if existing["state"] == "complete":
            return existing
        state = existing
        selection = state["selection"]
        study = conservation.inspect(workspace, state["study_id"], include_candidates=False)
        # Resume against the saved source selection, without selecting newer editions.
        choices, bindings = _normalize_sources(workspace, selection["sources"], profile)
        if bindings != selection["source_bindings"]:
            raise ValueError("A criterion source binding changed during resume")
        if selection["implementation_sha256"] != hashlib.sha256(Path(__file__).read_bytes()).hexdigest():
            raise ValueError("The source builder changed; prepare the saved request as a successor operation")
    else:
        if not isinstance(value, dict):
            raise ValueError("Supply an original parcel criterion selection or retained operation ID")
        if value.get("schema", SCHEMA) != SCHEMA:
            raise ValueError("The parcel criterion selection has another schema")
        request = _copy(value)
        study = _geometry_study(workspace, request)
        selected, resolution = _auto_sources(workspace, study, request.get("sources", {}), profile)
        choices, bindings = _normalize_sources(workspace, selected, profile)
        settings = _settings(request.get("settings"))
        geometry_context = keowee_priority.geometry_context(workspace, study["selection"]["spec"])
        _, method_sha = keowee_priority.definition()
        selection = {
            "version": VERSION, "study_id": study["id"],
            "geometry_context": geometry_context, "geometry_context_sha256": digest(geometry_context),
            "sources": choices, "source_bindings": bindings, "source_resolution": resolution,
            "settings": settings, "source_profile_sha256": profile_sha,
            "method_definition_sha256": method_sha,
            "implementation_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            "priority_implementation_sha256": hashlib.sha256(Path(keowee_priority.__file__).read_bytes()).hexdigest(),
        }
        key = digest(selection)
        directory = workspace.root / "parcel-criteria" / key
        directory.mkdir(parents=True, exist_ok=True)
        with held(directory / ".criteria.lock", blocking=False):
            if (directory / "state.json").exists():
                existing = inspect(workspace, key)
                if existing["state"] == "complete":
                    return existing
                state = existing
            else:
                state = {
                    "schema": "upstate.parcel-criteria-operation/v1", "id": key,
                    "title": request.get("title") or study["title"] + " - original parcel criteria",
                    "study_id": study["id"], "state": "prepared", "created_at": now(),
                    "spatial_criteria_basis": settings["spatial_criteria_basis"],
                    "updated_at": now(), "selection": selection, "request": request,
                    "progress": {"stage": "prepared", "completed": 0, "total": None},
                }
                atomic_json(directory / "state.json", state, immutable=True)
    key = state["id"]
    directory = workspace.root / "parcel-criteria" / key
    with held(directory / ".criteria.lock", blocking=False):
        try:
            current_state = read_json(directory / "state.json")
            if current_state["state"] == "complete":
                return inspect(workspace, key)
            if selection["source_profile_sha256"] != profile_sha:
                raise ValueError("The source profile changed; prepare the saved request as a successor operation")
            _, current_method_sha = keowee_priority.definition()
            if selection["method_definition_sha256"] != current_method_sha:
                raise ValueError("The published method changed; prepare the saved request as a successor operation")
            if selection["priority_implementation_sha256"] != hashlib.sha256(
                    Path(keowee_priority.__file__).read_bytes()).hexdigest():
                raise ValueError("The geometry-binding implementation changed; prepare a successor operation")
            if keowee_priority.geometry_context(workspace, study["selection"]["spec"]) != selection["geometry_context"]:
                raise ValueError("The current parcel/reporting geometry differs from the retained operation")
            if state["state"] == "complete":
                return inspect(workspace, key)
            state.update(state="running", updated_at=now())
            state.pop("error", None)
            atomic_json(directory / "state.json", state)
            crs, reporting, units, _, _ = conservation._geometry_inputs(workspace, study)
            metric_types = _metric_types()
            settings = selection["settings"]
            state["progress"] = {"stage": "original_source_geometry", "completed": 0, "total": len(units)}
            atomic_json(directory / "state.json", state)
            atomic_json(directory / "selection.json", selection)
            definitions = {
                "source_profile": profile,
                "published_methods": keowee_priority.definition()[0],
                "metric_types": metric_types, "settings": settings,
            }
            atomic_json(directory / "definitions.json", definitions)
            rows = []
            checkpoints = directory / "checkpoints"
            checkpoints.mkdir(exist_ok=True)
            with ExitStack() as stack:
                layers, rasters = {}, {}
                for role, choice in choices.items():
                    if bindings[role]["kind"] == "raster":
                        rasters[role] = OriginalRaster(stack, workspace, bindings[role], crs)
                    else:
                        layers[role] = Layer(workspace, role, choice, bindings[role], crs)
                batch = settings["checkpoint_parcels"]
                for start in range(0, len(units), batch):
                    selected_units = units[start:start + batch]
                    path = checkpoints / (str(start).zfill(10) + ".json")
                    wanted = [unit["id"] for unit in selected_units]
                    if path.exists():
                        saved = read_json(path)
                        if saved.get("operation_id") != key or saved.get("parcel_ids") != wanted:
                            raise ValueError("Parcel criterion checkpoint belongs to another source selection")
                        block = saved["rows"]
                        if [row["id"] for row in block] != wanted:
                            raise ValueError("Parcel criterion checkpoint IDs differ from original planning units")
                    else:
                        block = [_derive_parcel(unit, layers, rasters, settings, metric_types)
                                 for unit in selected_units]
                        atomic_json(path, {"operation_id": key, "parcel_ids": wanted, "rows": block}, immutable=True)
                    rows.extend(block)
                    state["progress"] = {
                        "stage": "parcel_criteria", "completed": len(rows), "total": len(units),
                        "last_parcel_id": wanted[-1]}
                    state["updated_at"] = now()
                    atomic_json(directory / "state.json", state)
                raster_metadata = {role: raster.metadata for role, raster in rasters.items()}
            population = _complete_population(rows, settings)
            coverage = _coverage(rows, metric_types, selection["source_resolution"])
            fields = sorted({name for row in rows for name in row["metrics"]})
            table = {
                "schema": "upstate.parcel-criteria/v1", "id": key, "title": state["title"],
                "builder": {"name": "source_tools.parcel_criteria", "version": VERSION,
                            "implementation_sha256": selection["implementation_sha256"]},
                "study_id": study["id"],
                "geometry_context": selection["geometry_context"],
                "geometry_context_sha256": selection["geometry_context_sha256"],
                "created_at": state["created_at"], "settings": settings,
                "spatial_criteria_basis": settings["spatial_criteria_basis"],
                "metric_geometry": _metric_geometry(settings, metric_types),
                "source_bindings": bindings, "source_resolution": selection["source_resolution"],
                "original_rasters": raster_metadata,
                "method_definition_sha256": selection["method_definition_sha256"],
                "source_profile_sha256": profile_sha, "fields": fields,
                "metric_types": metric_types, "population_statistics": {"stream_length": population},
                "numeric_intervals": {
                    "fields": sorted({name for row in rows for name in row.get("metric_bounds", {})}),
                    "unit": "acres", "endpoints": "closed",
                    "lower": "Area of the positively retained footprint inside the bound original parcel geometry.",
                    "upper": "Lower area plus the part of the parcel outside both positive geometry and actual certainty coverage.",
                    "exact_value": "Canonical metric equals the area only when determined; an unresolved exact area is null.",
                    "scoring": "Evaluate published threshold steps across the entire interval; retain exact points when all attainable values receive the same points.",
                },
                "coverage": coverage, "rows": rows,
            }
            atomic_json(directory / "criteria.json", table)
            _csv(directory / "criteria.csv", rows, fields)
            _geopackage(directory / "criteria.gpkg", crs, units, rows, metric_types)
            descriptors = {
                key: describe_file(workspace.root, directory / name)
                for key, name in (("table", "criteria.json"), ("csv", "criteria.csv"),
                                  ("geopackage", "criteria.gpkg"), ("selection", "selection.json"),
                                  ("definitions", "definitions.json"))}
            manifest = _source_manifest(state, directory, table, descriptors)
            atomic_json(directory / "sources.json", manifest)
            edition = workspace.import_sources(directory / "sources.json")
            source_id = manifest["entries"][0]["id"]
            result = {
                "schema": "upstate.parcel-criteria-result/v1", "id": key, "state": "complete",
                "title": state["title"], "study_id": study["id"],
                "source_collection_id": edition["id"], "source_id": source_id,
                "table": {"format": "json", "id_column": "id", **descriptors["table"]},
                "fields": fields, "coverage": coverage, "population_statistics": table["population_statistics"],
                "numeric_intervals": table["numeric_intervals"],
                "spatial_criteria_basis": table["spatial_criteria_basis"],
                "metric_geometry": table["metric_geometry"],
                "selected_sources": bindings, "source_resolution": selection["source_resolution"],
                "geometry_context": selection["geometry_context"],
                "geometry_context_sha256": selection["geometry_context_sha256"],
                "files": {**descriptors, "source_manifest": describe_file(workspace.root, directory / "sources.json")},
                "score_selection": {
                    "basis": "published_method", "scale": "total",
                    "method_id": "lake-keowee-2020-published-scorecards",
                    "headwater_orders": settings["headwater_orders"],
                    "metrics": {"source_collection_id": edition["id"], "source_id": source_id,
                                "format": "json", "id_column": "id"},
                    "bindings": {},
                },
                "available_bindings": {
                    "headwater_stream": {"kind": "stream_order", "input": "table", "field": "stream_orders",
                                         "reference": "Original NHDPlus HR streamorde values intersecting " + settings["spatial_criteria_basis"] + "."}
                },
            }
            atomic_json(directory / "result.json", result)
            state.update(state="complete", completed_at=now(), updated_at=now(),
                         source_collection_id=edition["id"], source_id=source_id,
                         progress={"stage": "complete", "completed": len(rows), "total": len(rows)},
                         files=result["files"])
            atomic_json(directory / "state.json", state)
            return result
        except Exception as error:
            state.update(state="failed", updated_at=now(),
                         error={"type": type(error).__name__, "message": str(error)})
            atomic_json(directory / "state.json", state)
            raise


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--workspace", required=True, type=Path)
    commands = result.add_subparsers(dest="command", required=True)
    operation = commands.add_parser("prepare", help="Compute/import actual criteria or resume a retained operation")
    operation.add_argument("selection_or_id")
    auto = commands.add_parser("auto", help="Derive criteria from a saved parcel study and current original sources")
    auto.add_argument("--study", required=True)
    auto.add_argument("--sources", type=Path, help="Optional explicit original role bindings")
    auto.add_argument("--settings", type=Path)
    read = commands.add_parser("inspect")
    read.add_argument("operation_id")
    commands.add_parser("overview")
    commands.add_parser("source-profile")
    return result


def main(argv=None):
    from model.workspace import Workspace
    args = parser().parse_args(argv)
    workspace = Workspace(args.workspace)
    if args.command == "prepare":
        value = args.selection_or_id
        if not re.fullmatch(r"[0-9a-f]{64}", value):
            value = read_json(Path(value))
        output = prepare(workspace, value)
    elif args.command == "auto":
        selection = {"study_id": args.study}
        if args.sources:
            selection["sources"] = read_json(args.sources)
        if args.settings:
            selection["settings"] = read_json(args.settings)
        output = prepare(workspace, selection)
    elif args.command == "inspect":
        output = inspect(workspace, args.operation_id)
    elif args.command == "overview":
        output = overview(workspace)
    else:
        output = _definition()[0]
    print(json.dumps(output, indent=2, sort_keys=True, ensure_ascii=False, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
