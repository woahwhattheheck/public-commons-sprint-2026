"""Explicit local data adapters for the original municipal migration workspace."""
from __future__ import annotations

import csv
import io
import json
import math
from collections import Counter

KINDS = {
    "source_assets": ("id", "label", "status", "parent_id", "location_id", "geometry", "updated_at", "attributes"),
    "target_assets": ("id", "label", "status", "parent_id", "location_id", "geometry", "updated_at", "attributes"),
    "locations": ("id", "label", "geometry"),
    "requests": ("id", "asset_id", "location_id", "summary", "status", "created_at"),
    "work_orders": ("id", "asset_id", "request_id", "summary", "status", "revision", "updated_at"),
    "returns": ("change_id", "work_order_id", "asset_id", "request_id", "status", "expected_revision", "result", "provider_reference"),
}
REQUIRED = {
    "source_assets": ("id",), "target_assets": ("id",), "locations": ("id",),
    "requests": ("id", "asset_id", "status"), "work_orders": ("id", "asset_id", "status", "revision"),
    "returns": ("change_id", "work_order_id", "asset_id", "status", "expected_revision", "result", "provider_reference"),
}
TRANSITIONS = {
    "open": ["in_progress", "cancelled"], "in_progress": ["completed", "open", "cancelled"],
    "completed": ["closed", "in_progress"], "closed": ["open"], "cancelled": ["open"],
}


class InvalidData(ValueError):
    pass


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def text(value):
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return canonical(value)
    return str(value)


def _json(body):
    try:
        return json.loads(body.decode("utf-8-sig"), parse_constant=lambda value: (_ for _ in ()).throw(InvalidData("Non-finite JSON number")))
    except (ValueError, UnicodeError) as error:
        raise InvalidData("Read a UTF-8 JSON object or row array") from error


def parse(body, file_format):
    if not 0 < len(body) <= 32 * 1024 * 1024:
        raise InvalidData("An input must contain between 1 byte and 32 MiB")
    if file_format == "belleville-capture":
        from .captures import capture_bytes, parse_capture
        return parse_capture(_json(capture_bytes(body)))
    if file_format == "maximo-target":
        from .maximo_target import parse_capture
        return parse_capture(_json(body))
    metadata = {"format": file_format}
    if file_format == "csv":
        try:
            reader = csv.DictReader(io.StringIO(body.decode("utf-8-sig"), newline=""), strict=True)
            columns = reader.fieldnames
            if not columns or any(not value for value in columns) or len(columns) != len(set(columns)):
                raise InvalidData("CSV headers must be named and unique")
            rows = list(reader)
            if any(None in row or any(value is None for value in row.values()) for row in rows):
                raise InvalidData("CSV rows must have the same number of fields as the header")
        except (UnicodeError, csv.Error) as error:
            raise InvalidData("Read a well-formed UTF-8 CSV export") from error
    elif file_format == "jsonl":
        rows = [_json(line) for line in body.splitlines() if line.strip()]
        columns = sorted(set().union(*(row.keys() for row in rows if isinstance(row, dict))))
    else:
        source = _json(body)
        if file_format == "geojson":
            if not isinstance(source, dict) or source.get("type") != "FeatureCollection" or source.get("crs"):
                raise InvalidData("Use an RFC 7946 WGS84 FeatureCollection without a legacy CRS declaration")
            features = source.get("features")
            if not isinstance(features, list):
                raise InvalidData("GeoJSON features must be an array")
            rows = []
            for feature in features:
                if not isinstance(feature, dict) or feature.get("type") != "Feature" or not isinstance(feature.get("properties"), dict):
                    raise InvalidData("Every GeoJSON feature needs an object of properties")
                row = dict(feature["properties"])
                if "__geometry" in row or "__feature_id" in row:
                    raise InvalidData("Reserved geometry/feature fields already exist")
                row["__geometry"] = feature.get("geometry")
                if "id" in feature:
                    row["__feature_id"] = feature["id"]
                rows.append(row)
            metadata["coordinate_system"] = "EPSG:4326; longitude, latitude"
        elif file_format == "esri-json":
            if not isinstance(source, dict) or not isinstance(source.get("features"), list):
                raise InvalidData("Use an Esri feature-set JSON export")
            spatial = source.get("spatialReference") or {}
            wkid = spatial.get("latestWkid", spatial.get("wkid"))
            if wkid not in (4326, 3857, 102100, 102113):
                raise InvalidData("Select a WGS84 or Web Mercator feature-set export; other source projections need an explicit upstream conversion")
            rows = []
            for feature in source["features"]:
                if not isinstance(feature, dict) or not isinstance(feature.get("attributes"), dict):
                    raise InvalidData("Every Esri feature needs an attributes object")
                row = dict(feature["attributes"])
                if "__geometry" in row:
                    raise InvalidData("Reserved geometry field already exists")
                row["__geometry"] = esri_geometry(feature.get("geometry"), wkid)
                rows.append(row)
            metadata.update(source_wkid=wkid, coordinate_system="EPSG:4326; longitude, latitude",
                            conversion="Web Mercator to WGS84" if wkid != 4326 else "Identity WGS84",
                            exceeded_transfer_limit=source.get("exceededTransferLimit") is True)
        elif file_format == "json":
            rows = source
        else:
            raise InvalidData("Choose csv, json, jsonl, geojson or esri-json")
        columns = sorted(set().union(*(row.keys() for row in rows if isinstance(row, dict)))) if isinstance(rows, list) else []
    if not isinstance(rows, list) or not rows or len(rows) > 100000 or any(not isinstance(row, dict) for row in rows):
        raise InvalidData("Use 1–100,000 object records")
    if len(columns) > 300 or any(not isinstance(key, str) or not key or len(key) > 200 for key in columns):
        raise InvalidData("Use at most 300 named columns")
    return {"columns": columns, "rows": rows, "metadata": metadata}


def esri_geometry(value, wkid):
    if value is None:
        return None
    if not isinstance(value, dict):
        raise InvalidData("Invalid Esri geometry")
    def point(coordinate):
        if len(coordinate) < 2:
            raise InvalidData("Geometry coordinates need two ordinates")
        x, y = coordinate[:2]
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in (x, y)):
            raise InvalidData("Geometry coordinates must be finite numbers")
        if wkid == 4326:
            return list(coordinate)
        if abs(x) > 20037508.35 or abs(y) > 20037508.35:
            raise InvalidData("Web Mercator coordinates exceed the supported world extent")
        return [x / 6378137 * 180 / math.pi, math.degrees(2 * math.atan(math.exp(y / 6378137)) - math.pi / 2), *coordinate[2:]]
    if "x" in value and "y" in value:
        return {"type": "Point", "coordinates": point([value["x"], value["y"]])}
    if "paths" in value:
        paths = [[point(coordinate) for coordinate in line] for line in value["paths"]]
        return {"type": "MultiLineString", "coordinates": paths}
    if "points" in value:
        return {"type": "MultiPoint", "coordinates": [point(coordinate) for coordinate in value["points"]]}
    raise InvalidData("Esri adapter supports point, multipoint and polyline assets. Export polygon assets as RFC 7946 GeoJSON to preserve ring topology.")


def geometry(value):
    if value in ("", None):
        return None
    if isinstance(value, str):
        value = _json(value.encode())
    if not isinstance(value, dict) or value.get("type") not in ("Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon"):
        raise InvalidData("Use an explicit WGS84 GeoJSON geometry")
    coordinates = value.get("coordinates")
    def position(item):
        if not isinstance(item, list) or len(item) < 2 or not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in item):
            raise InvalidData("Geometry positions must contain finite numeric ordinates")
        if not -180 <= item[0] <= 180 or not -90 <= item[1] <= 90:
            raise InvalidData("Geometry must use longitude, latitude in WGS84")
    def line(items, minimum=2, ring=False):
        if not isinstance(items, list) or len(items) < minimum:
            raise InvalidData("Geometry has too few positions")
        for item in items:
            position(item)
        if ring and items[0] != items[-1]:
            raise InvalidData("Polygon rings must be closed")
    kind = value["type"]
    if kind == "Point":
        position(coordinates)
    elif kind in ("MultiPoint", "LineString"):
        line(coordinates, 1 if kind == "MultiPoint" else 2)
    elif kind in ("MultiLineString", "Polygon"):
        if not isinstance(coordinates, list) or not coordinates:
            raise InvalidData("Geometry has no parts")
        for part in coordinates:
            line(part, 4 if kind == "Polygon" else 2, kind == "Polygon")
    else:
        if not isinstance(coordinates, list) or not coordinates:
            raise InvalidData("Geometry has no polygons")
        for polygon in coordinates:
            if not isinstance(polygon, list) or not polygon:
                raise InvalidData("Polygon has no rings")
            for ring in polygon:
                line(ring, 4, True)
    return {"type": kind, "coordinates": coordinates}


def suggested_mapping(kind, columns):
    if kind not in KINDS:
        raise InvalidData("Unknown dataset kind")
    fields = {field: field for field in KINDS[kind] if field in columns}
    if kind in ("source_assets", "target_assets") and "__source_identity" in columns:
        fields["id"] = "__source_identity"
        fields["attributes"] = "__original_attributes"
        if "ParkName" in columns:
            fields["label"] = "ParkName"
    if "__geometry" in columns and "geometry" in KINDS[kind]:
        fields["geometry"] = "__geometry"
    return {"fields": fields, "status_aliases": {}, "trim_ids": False}


def validate_mapping(kind, mapping, columns):
    if kind not in KINDS or not isinstance(mapping, dict) or set(mapping) - {"fields", "status_aliases", "trim_ids"}:
        raise InvalidData("Use fields, status_aliases and trim_ids in the mapping")
    fields = mapping.get("fields")
    if not isinstance(fields, dict) or set(fields) - set(KINDS[kind]) or any(value not in columns for value in fields.values()):
        raise InvalidData("Every mapped field must select a current input column")
    if any(field not in fields for field in REQUIRED[kind]):
        raise InvalidData("Map the required fields: " + ", ".join(REQUIRED[kind]))
    aliases = mapping.get("status_aliases", {})
    if not isinstance(aliases, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in aliases.items()):
        raise InvalidData("Status aliases must map exact input strings to exact output strings")
    if type(mapping.get("trim_ids", False)) is not bool:
        raise InvalidData("trim_ids must be true or false")
    return {"fields": fields, "status_aliases": aliases, "trim_ids": mapping.get("trim_ids", False)}


def mapped_rows(kind, parsed, mapping):
    mapping = validate_mapping(kind, mapping, parsed["columns"])
    result, errors = [], []
    for index, raw in enumerate(parsed["rows"], 1):
        row = {field: text(raw.get(mapping["fields"].get(field))) for field in KINDS[kind]}
        if mapping["trim_ids"]:
            for field in row:
                if field == "id" or field.endswith("_id"):
                    row[field] = row[field].strip()
        if "status" in row:
            row["status"] = mapping["status_aliases"].get(row["status"], row["status"])
        if "geometry" in row:
            try:
                parsed_geometry = geometry(row["geometry"])
                row["geometry"] = canonical(parsed_geometry) if parsed_geometry else ""
            except InvalidData as error:
                errors.append({"row": index, "field": "geometry", "message": str(error)})
        if row.get("attributes"):
            try:
                attributes = _json(row["attributes"].encode("utf-8"))
                if not isinstance(attributes, dict):
                    raise InvalidData("Asset attributes must be an object retaining the original field names")
                row["attributes"] = canonical(attributes)
            except InvalidData as error:
                errors.append({"row": index, "field": "attributes", "message": str(error)})
        row["_row"] = index
        result.append(row)
    return result, errors


def csv_bytes(rows, fields):
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    writer.writerows({field: row.get(field, "") for field in fields} for row in rows)
    return output.getvalue().encode("utf-8")
