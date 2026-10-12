"""Native GeoPackage/Shapefile export and full feature-level receiving."""
from __future__ import annotations
import contextlib
import datetime
import hashlib
import json
import math
import os
import re
import shutil
import sqlite3
from pathlib import Path
from decimal import Decimal
from .common import (CAPTURE, EXPORT, PROFILE, VectorError, need, require_id, canonical,
    json_bytes, digest, read_json, member, private_directory, atomic_json, atomic_bytes,
    claim, verify_manifest, verify_file, file_record, all_files, clone_capture,
    read_catalog, geometry_equal, safe_name, fsync_directory, parse_json, number_decimal)
from .driver import (FORMATS, capabilities, vector_environment, crs, same_crs,
                    transform_geometry, writer, reopen)
from .capture import open_capture

RESERVED = {"sf_key", "sf_part", "fid", "geom", "geometry", "rowid", "_rowid_", "oid"}
PHYSICAL = re.compile(r"^(?:str(?::[1-9][0-9]*)?|int(?:32|64)?(?::[1-9][0-9]*)?|float(?::[1-9][0-9]*(?:\.[0-9]+)?)?|date|datetime)$")

def profile_contract(profile, layer_ids):
    if profile is None:
        profile = {"schema": PROFILE, "formats": list(FORMATS)}
    need(isinstance(profile, dict) and profile.get("schema") == PROFILE, "VECTOR_PROFILE_REQUIRED")
    result = parse_json(canonical(profile))
    formats = result.setdefault("formats", list(FORMATS))
    need(isinstance(formats, list) and formats and len(set(formats)) == len(formats) and
         set(formats).issubset(FORMATS), "VECTOR_EXPORT_FORMAT_INVALID")
    layers = result.setdefault("layers", {})
    need(isinstance(layers, dict) and set(layers).issubset(set(layer_ids)), "VECTOR_PROFILE_LAYER_UNKNOWN")
    shape = result.setdefault("shapefile", {})
    need(isinstance(shape, dict), "VECTOR_SHAPEFILE_PROFILE_INVALID")
    shape.setdefault("longValues", "reference")
    shape.setdefault("collections", "split")
    need(shape["longValues"] in ("reference", "error"), "VECTOR_SHAPEFILE_OVERFLOW_INVALID")
    need(shape["collections"] in ("split", "error"), "VECTOR_COLLECTION_MAPPING_INVALID")
    for name in ("targetCrs",):
        if result.get(name) is not None:
            need(isinstance(result[name], str), "VECTOR_CRS_INVALID")
    for layer in layers.values():
        need(isinstance(layer, dict), "VECTOR_LAYER_PROFILE_INVALID")
        for name in ("sourceCrs", "assignSourceCrs", "targetCrs", "name", "label"):
            if layer.get(name) is not None:
                need(isinstance(layer[name], str) and layer[name], "VECTOR_LAYER_PROFILE_INVALID", name)
        rules = layer.setdefault("fields", {})
        need(isinstance(rules, dict), "VECTOR_FIELD_MAPPING_INVALID")
        for rule in rules.values():
            need(isinstance(rule, dict), "VECTOR_FIELD_MAPPING_INVALID")
            need(rule.get("mode", "auto") in ("auto", "native", "json", "reference"),
                 "VECTOR_FIELD_CODEC_INVALID")
            if "physicalType" in rule:
                need(isinstance(rule["physicalType"], str) and PHYSICAL.fullmatch(rule["physicalType"]),
                     "VECTOR_FIELD_PHYSICAL_TYPE_INVALID")
    return result

def alias(original, driver, used, requested=None):
    limit = 10 if driver == "ESRI Shapefile" else 128
    valid = lambda value: (isinstance(value, str) and value and "\0" not in value and
        len(value) <= limit and value.casefold() not in used and
        (driver != "ESRI Shapefile" or re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,9}", value)))
    if requested is not None:
        need(valid(requested), "VECTOR_FIELD_NAME_CONFLICT", requested)
        used.add(requested.casefold())
        return requested
    if valid(original):
        used.add(original.casefold())
        return original
    base = safe_name(original, limit)
    for number in range(10000):
        suffix = hashlib.sha256((original + ":" + str(number)).encode()).hexdigest()[:6]
        name = base[:max(1, limit - 7)] + "_" + suffix
        if valid(name):
            used.add(name.casefold())
            return name
    raise VectorError("VECTOR_FIELD_ALIAS_EXHAUSTED", original)

def choose_codec(stat, driver, rule, profile):
    kinds = set(stat["kinds"]) - {"null"}
    mode = rule.get("mode", "auto")
    if mode == "reference":
        return "reference", "str:64", "Original typed value is retained by its hash in source-features.ndjson."
    if mode == "native":
        physical = rule.get("physicalType")
        need(physical, "VECTOR_EXPLICIT_NATIVE_TYPE_REQUIRED")
        need(kinds.issubset({"string", "integer", "number", "boolean"}),
             "VECTOR_VALUE_NEEDS_STRUCTURED_CODEC")
        return "boolean" if kinds == {"boolean"} else "native", physical, "Explicit operator field mapping."
    if mode == "json":
        codec, physical, reason = "json", "str", "Exact JSON text preserves the original value type."
    elif not kinds:
        codec, physical, reason = "native", "str:1", "Null and absent values retain their distinct original records."
    elif kinds == {"boolean"}:
        codec, physical, reason = "boolean", "int:1", "Boolean values use native 0/1 and retain their original boolean type."
    elif kinds == {"integer"}:
        minimum, maximum = int(stat["minInteger"]), int(stat["maxInteger"])
        exact_native = -(2**63) <= minimum <= maximum < 2**63
        if driver == "ESRI Shapefile":
            exact_native = exact_native and max(abs(minimum), abs(maximum)) <= 2**53 - 1
        if exact_native:
            codec, physical, reason = "native", "int64" if driver == "GPKG" else "int:18", "Native integral storage."
        else:
            codec, physical, reason = "json", "str", "Exact JSON text preserves integers beyond the target native range."
    elif kinds.issubset({"integer", "number"}) and stat.get("requiresExactNumber"):
        codec, physical, reason = "json", "str", "Exact JSON text preserves fractional values beyond native double precision."
    elif kinds.issubset({"integer", "number"}) and driver == "GPKG":
        max_integer = max(abs(int(stat["minInteger"] or 0)), abs(int(stat["maxInteger"] or 0)))
        if max_integer <= 2**53:
            codec, physical, reason = "native", "float", "Native IEEE-754 storage, verified against every original value."
        else:
            codec, physical, reason = "json", "str", "Exact JSON text preserves mixed large integers and fractional values."
    elif kinds == {"string"} and not stat["requiresQuotedString"]:
        declared = (stat.get("declaredNativeType") or "").split(":")[0]
        if declared == "date" or declared == "datetime" and driver == "GPKG":
            codec, physical, reason = declared, declared, "Preserves the original native date/time field."
        else:
            width = max(1, stat["maxTextCharacters"] if driver == "GPKG" else stat["maxTextBytes"])
            codec, physical, reason = "native", "str:" + str(width), "Native text, with explicit UTF-8 capacity."
    else:
        codec, physical, reason = "json", "str", "Exact JSON text preserves structured, fractional, binary or whitespace-sensitive values."
    if driver == "ESRI Shapefile" and codec != "reference":
        size = stat["maxJsonBytes"] if codec == "json" else stat["maxTextBytes"]
        if physical.startswith("str") and size > 254:
            need(profile["shapefile"]["longValues"] == "reference",
                 "VECTOR_SHAPEFILE_FIELD_OVERFLOW", {"bytes": size})
            codec, physical, reason = "reference", "str:64", (
                "A SHA-256 reference keeps the complete original typed value in source-features.ndjson.")
        elif physical.startswith("str"):
            physical = "str:" + str(max(1, size))
    elif driver == "GPKG" and codec == "json":
        physical = "str:" + str(max(1, stat["maxJsonBytes"]))
    return codec, physical, reason

def field_mapping(meta, driver, layer_profile, profile):
    rules = layer_profile.get("fields", {})
    need(set(rules).issubset(set(meta["fields"])), "VECTOR_PROFILE_FIELD_UNKNOWN")
    order = layer_profile.get("fieldOrder", meta.get("fieldOrder", list(meta["fields"])))
    need(isinstance(order, list) and len(order) == len(set(order)) and
         set(order) == set(meta["fields"]), "VECTOR_FIELD_ORDER_MUST_RETAIN_ALL_FIELDS")
    used, result = set(RESERVED), []
    for index, name in enumerate(order):
        stat, rule = meta["fields"][name], rules.get(name, {})
        names = rule.get("names", {})
        need(isinstance(names, dict), "VECTOR_FIELD_NAME_MAPPING_INVALID")
        target = alias(name, driver, used, names.get(driver, rule.get("name")))
        codec, physical, reason = choose_codec(stat, driver, rule, profile)
        if driver == "ESRI Shapefile" and index >= 253:
            codec, physical, target = "sidecar", None, None
            reason = "The complete value remains in source-features.ndjson beyond the portable DBF field capacity."
        result.append({"sourceName": name, "targetName": target, "codec": codec,
                       "physicalType": physical, "reason": reason,
                       "declaredNativeType": stat.get("declaredNativeType"),
                       "kinds": stat["kinds"], "present": stat["present"], "absent": stat["absent"],
                       "nulls": stat["nulls"]})
    return result

def attribute_value(field, feature):
    props = feature.get("properties") or {}
    if field["sourceName"] not in props or props[field["sourceName"]] is None:
        return None
    value = props[field["sourceName"]]
    if field["codec"] in ("native", "date", "datetime"):
        if isinstance(value, Decimal):
            try:
                converted = float(value)
            except (ValueError, OverflowError) as exc:
                raise VectorError("VECTOR_NATIVE_NUMBER_REQUIRES_EXACT_CODEC", canonical(value)) from exc
            need(math.isfinite(converted) and number_decimal(converted) == value,
                 "VECTOR_NATIVE_NUMBER_REQUIRES_EXACT_CODEC", canonical(value))
            return converted
        return value
    if field["codec"] == "boolean":
        need(type(value) is bool, "VECTOR_BOOLEAN_VALUE_CHANGED")
        return int(value)
    if field["codec"] == "json":
        return canonical(value)
    if field["codec"] == "reference":
        return digest({"present": True, "value": value})
    raise VectorError("VECTOR_FIELD_CODEC_INVALID", field["codec"])

def ordinate_dimensions(geometry):
    if geometry is None:
        return set()
    if geometry["type"] == "GeometryCollection":
        result = set()
        for child in geometry.get("geometries", []):
            result.update(ordinate_dimensions(child))
        return result
    found = set()
    def walk(value):
        if isinstance(value, (list, tuple)):
            if value and not isinstance(value[0], (list, tuple)):
                need(len(value) in (2, 3), "VECTOR_ORDINATE_DIMENSION_UNSUPPORTED", len(value))
                need(all(type(item) in (int, float, Decimal) for item in value),
                     "VECTOR_COORDINATE_INVALID")
                for item in value:
                    number_decimal(item)
                found.add(len(value))
            else:
                for child in value:
                    walk(child)
    walk(geometry.get("coordinates"))
    return found

def shape_parts(geometry, allow_collections, path=()):
    if geometry is not None and geometry["type"] == "GeometryCollection":
        need(allow_collections, "VECTOR_COLLECTION_REQUIRES_EXPLICIT_SPLIT")
        children = geometry.get("geometries", [])
        if not children:
            yield path, None
        for index, child in enumerate(children):
            yield from shape_parts(child, allow_collections, path + (index,))
    else:
        yield path, geometry

def shape_group(geometry):
    if geometry is None:
        return "null_2d", "Point"
    kind = geometry["type"]
    dims = ordinate_dimensions(geometry)
    need(len(dims) <= 1, "VECTOR_MIXED_ORDINATES_WITHIN_SHAPE")
    dimension = next(iter(dims), 2)
    families = {"Point": ("point", "Point"), "MultiPoint": ("multipoint", "MultiPoint"),
                "LineString": ("line", "LineString"), "MultiLineString": ("line", "LineString"),
                "Polygon": ("polygon", "Polygon"), "MultiPolygon": ("polygon", "Polygon")}
    need(kind in families, "VECTOR_SHAPEFILE_GEOMETRY_UNSUPPORTED", kind)
    group, schema = families[kind]
    return group + "_" + str(dimension) + "d", ("3D " if dimension == 3 else "") + schema

def layer_crs(meta, layer_profile, profile):
    original = meta.get("crsWkt")
    supplied = layer_profile.get("sourceCrs")
    if supplied and original:
        need(same_crs(supplied, original), "VECTOR_SOURCE_CRS_CONFLICT")
    assigned = layer_profile.get("assignSourceCrs")
    source = assigned or original or supplied
    target = layer_profile.get("targetCrs", profile.get("targetCrs")) or source
    if source:
        source = crs(source).to_wkt()
    if target:
        target = crs(target).to_wkt()
    need(source or not target, "VECTOR_SOURCE_CRS_REQUIRED_FOR_TRANSFORM")
    return {"original": original, "assigned": assigned, "source": source, "target": target,
            "action": "transform" if source and target and not same_crs(source, target)
                      else "assign" if assigned or supplied and not original else "preserve",
            "coordinateOrder": "x,y"}

def rows(connection, layer_id=None):
    statement = "SELECT * FROM features"
    args = ()
    if layer_id is not None:
        statement += " WHERE layer_id=?"
        args = (layer_id,)
    statement += " ORDER BY layer_id,position"
    yield from connection.execute(statement, args)

def write_json_line(stream, value):
    stream.write(json_bytes(value))

def flush_stream(stream):
    stream.flush()
    os.fsync(stream.fileno())

def native_type_family(value):
    value = value.split(":")[0].lower()
    if value.startswith("int"): return "integer"
    if value in ("float", "float32", "float64", "real"): return "number"
    if value in ("str", "string"): return "text"
    return value

def value_equal(left, right, codec):
    if left is None or right is None:
        return left is None and right is None
    if codec == "date":
        return datetime.date.fromisoformat(str(left)) == datetime.date.fromisoformat(str(right))
    if codec == "datetime":
        parse = lambda value: datetime.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parse(left) == parse(right)
    if type(left) in (int, float, Decimal) and type(right) in (int, float, Decimal):
        return number_decimal(left) == number_decimal(right)
    return left == right and (not isinstance(left, str) or isinstance(right, str))

def native_reopen(root, native_manifest, profile, source_catalog=None, native_ids_path=None):
    """Reopen native files and bind every row to the retained original source."""
    with vector_environment():
        return _native_reopen(root, native_manifest, profile, source_catalog, native_ids_path)

def _native_reopen(root, native_manifest, profile, source_catalog=None, native_ids_path=None):
    import tempfile
    root = Path(root)
    catalog_path = Path(source_catalog) if source_catalog else root / "source" / "catalog.sqlite"
    source = read_catalog(catalog_path)
    temporary = tempfile.TemporaryDirectory(prefix="starforge-vector-reopen-")
    conn = sqlite3.connect(str(Path(temporary.name) / "receiving.sqlite"))
    conn.executescript("""
      PRAGMA journal_mode=OFF;
      PRAGMA synchronous=OFF;
      CREATE TABLE expected(layer_id TEXT,row_key TEXT,part_key TEXT,body TEXT,seen INTEGER DEFAULT 0,
        PRIMARY KEY(layer_id,row_key,part_key));
      CREATE TABLE source_seen(row_key TEXT PRIMARY KEY);
      CREATE TABLE coverage(row_key TEXT,driver TEXT,PRIMARY KEY(row_key,driver));
    """)
    ids = None
    if native_ids_path is not None:
        ids = Path(native_ids_path).open("wb")
        os.chmod(native_ids_path, 0o600)
    try:
        metadata = {row["id"]: parse_json(row["metadata_json"])
                    for row in source.execute("SELECT * FROM layers")}
        by_layer = {layer["id"]: layer for layer in native_manifest["layers"]}
        need(len(by_layer) == len(native_manifest["layers"]), "VECTOR_NATIVE_LAYER_DUPLICATE")
        need(set(metadata) == {layer["sourceLayerId"] for layer in by_layer.values()},
             "VECTOR_ORIGINAL_LAYERS_CHANGED")
        need(native_manifest["formats"] == profile["formats"], "VECTOR_NATIVE_FORMATS_CHANGED")
        for layer in by_layer.values():
            meta = metadata[layer["sourceLayerId"]]
            projection = layer_crs(meta, profile["layers"].get(meta["id"], {}), profile)
            retained_projection = layer.get("crsMapping", {})
            for key in ("original", "assigned", "action", "coordinateOrder"):
                need(retained_projection.get(key) == projection.get(key),
                     "VECTOR_NATIVE_CRS_MAPPING_CHANGED", {"layer": layer["id"], "field": key})
            for key in ("source", "target"):
                need(same_crs(retained_projection.get(key), projection.get(key)),
                     "VECTOR_NATIVE_CRS_MAPPING_CHANGED", {"layer": layer["id"], "field": key})
            need(same_crs(layer.get("crsWkt"), projection["target"]),
                 "VECTOR_NATIVE_TARGET_CRS_CHANGED", layer["id"])
            original_mapping = field_mapping(meta, layer["driver"],
                                              profile["layers"].get(meta["id"], {}), profile)
            need(len(original_mapping) == len(layer["fields"]), "VECTOR_FIELD_MAPPING_CHANGED")
            for expected, retained in zip(original_mapping, layer["fields"]):
                need(all(retained.get(key) == value for key, value in expected.items()),
                     "VECTOR_FIELD_MAPPING_CHANGED", expected["sourceName"])
            need(layer["sourceFeatureCount"] == meta["counts"]["features"] and
                 layer["sourceId"] == meta["sourceId"], "VECTOR_NATIVE_SOURCE_COUNT_CHANGED")
        with member(root, native_manifest["sourceFeatures"]["path"]).open("rb") as stream:
            for line in stream:
                item = parse_json(line)
                row = source.execute("SELECT * FROM features WHERE row_key=?", (item.get("rowKey"),)).fetchone()
                need(row is not None, "VECTOR_ORIGINAL_FEATURE_UNKNOWN")
                expected = {"rowKey": row["row_key"], "layerId": row["layer_id"],
                            "sourcePosition": row["position"], "identity": parse_json(row["identity_json"]),
                            "occurrence": row["occurrence"], **parse_json(row["record_json"])}
                need(canonical(expected) == canonical(item), "VECTOR_ORIGINAL_FEATURE_CHANGED", row["row_key"])
                conn.execute("INSERT INTO source_seen VALUES(?)", (row["row_key"],))
        need(conn.execute("SELECT count(*) FROM source_seen").fetchone()[0] ==
             source.execute("SELECT count(*) FROM features").fetchone()[0],
             "VECTOR_ORIGINAL_FEATURES_MISSING")
        with member(root, native_manifest["bindings"]["path"]).open("rb") as stream:
            for line in stream:
                item = parse_json(line)
                layer = by_layer.get(item.get("layerId"))
                need(layer is not None, "VECTOR_NATIVE_LAYER_UNKNOWN")
                row = source.execute("SELECT * FROM features WHERE row_key=?", (item.get("rowKey"),)).fetchone()
                need(row is not None and row["layer_id"] == item.get("sourceLayerId") == layer["sourceLayerId"],
                     "VECTOR_NATIVE_SOURCE_BINDING_CHANGED")
                feature = parse_json(row["record_json"])["feature"]
                path = item.get("partPath")
                need(isinstance(path, list) and all(type(index) is int and index >= 0 for index in path),
                     "VECTOR_NATIVE_PART_PATH_INVALID")
                need(item.get("partKey") == (digest({"path": path}) if path else "whole"),
                     "VECTOR_NATIVE_PART_KEY_CHANGED")
                properties = {"sf_key": row["row_key"], "sf_part": item["partKey"]}
                properties.update({field["targetName"]: attribute_value(field, feature)
                                   for field in layer["fields"] if field["targetName"]})
                need(canonical(properties) == canonical(item["properties"]),
                     "VECTOR_NATIVE_ATTRIBUTES_NOT_FROM_SOURCE", row["row_key"])
                geometry = transform_geometry(feature.get("geometry"),
                    layer["crsMapping"]["source"], layer["crsMapping"]["target"])
                for index in path:
                    need(geometry is not None and geometry["type"] == "GeometryCollection" and
                         index < len(geometry.get("geometries", [])), "VECTOR_NATIVE_PART_NOT_IN_SOURCE")
                    geometry = geometry["geometries"][index]
                if layer["driver"] == "ESRI Shapefile" and geometry is not None and \
                        geometry["type"] == "GeometryCollection" and not geometry.get("geometries"):
                    geometry = None
                need(geometry_equal(geometry, item["geometry"]),
                     "VECTOR_NATIVE_GEOMETRY_NOT_FROM_SOURCE", row["row_key"])
                conn.execute("INSERT INTO expected(layer_id,row_key,part_key,body) VALUES(?,?,?,?)",
                             (item["layerId"], item["rowKey"], item["partKey"], canonical(item)))
                conn.execute("INSERT OR IGNORE INTO coverage VALUES(?,?)", (item["rowKey"], layer["driver"]))
        conn.commit()
        for row in source.execute("SELECT row_key FROM features"):
            coverage = {record[0] for record in conn.execute(
                "SELECT driver FROM coverage WHERE row_key=?", (row["row_key"],))}
            need(coverage == set(profile["formats"]), "VECTOR_ORIGINAL_FEATURE_FORMAT_MISSING", row["row_key"])
        checked = []
        with vector_environment():
            for layer in native_manifest["layers"]:
                path = member(root, layer["path"])
                count, fields = 0, {field["targetName"]: field for field in layer["fields"] if field["targetName"]}
                expected_names = {"sf_key", "sf_part", *fields}
                with reopen(path, layer["driver"], layer["layer"]) as dataset:
                    actual_schema = dict(dataset.schema["properties"])
                    need(set(actual_schema) == expected_names, "VECTOR_NATIVE_FIELDS_CHANGED",
                         {"layer": layer["id"], "actual": actual_schema})
                    need(same_crs(dataset.crs_wkt or None, layer["crsWkt"]),
                         "VECTOR_NATIVE_CRS_CHANGED", layer["id"])
                    for name, field in fields.items():
                        need(native_type_family(actual_schema[name]) == native_type_family(field["physicalType"]),
                             "VECTOR_NATIVE_FIELD_TYPE_CHANGED",
                             {"layer": layer["id"], "field": name, "expected": field["physicalType"],
                              "actual": actual_schema[name]})
                    from fiona.model import to_dict
                    for feature in dataset:
                        raw = to_dict(feature)
                        values = raw["properties"]
                        row_key, part_key = values.get("sf_key"), values.get("sf_part")
                        original = conn.execute(
                            "SELECT body,seen FROM expected WHERE layer_id=? AND row_key=? AND part_key=?",
                            (layer["id"], row_key, part_key)).fetchone()
                        need(original is not None and not original[1], "VECTOR_NATIVE_IDENTITY_CHANGED",
                             {"layer": layer["id"], "rowKey": row_key, "partKey": part_key})
                        expected = parse_json(original[0])
                        for name, value in expected["properties"].items():
                            codec = fields[name]["codec"] if name in fields else "native"
                            need(value_equal(value, values.get(name), codec), "VECTOR_NATIVE_PROPERTY_CHANGED",
                                 {"layer": layer["id"], "rowKey": row_key, "field": name,
                                  "expectedJson": canonical(value), "actualJson": canonical(values.get(name))})
                        need(geometry_equal(expected["geometry"], raw.get("geometry")),
                             "VECTOR_NATIVE_GEOMETRY_CHANGED",
                             {"layer": layer["id"], "rowKey": row_key, "partKey": part_key})
                        conn.execute("UPDATE expected SET seen=1 WHERE layer_id=? AND row_key=? AND part_key=?",
                                     (layer["id"], row_key, part_key))
                        if ids:
                            write_json_line(ids, {"layerId": layer["id"], "rowKey": row_key,
                                                  "partKey": part_key, "nativeFid": str(feature.id)})
                        count += 1
                    need(count == layer["featureCount"], "VECTOR_NATIVE_FEATURE_COUNT_CHANGED", layer["id"])
                    checked.append({"layerId": layer["id"], "features": count,
                                    "driver": dataset.driver, "layer": dataset.name,
                                    "geometry": dataset.schema["geometry"], "schema": actual_schema,
                                    "crsWkt": dataset.crs_wkt or None, "coordinateOrder": "x,y"})
                conn.commit()
            missing = conn.execute("SELECT count(*) FROM expected WHERE seen=0").fetchone()[0]
            need(missing == 0, "VECTOR_NATIVE_FEATURES_MISSING", missing)
        for path in {layer["path"] for layer in native_manifest["layers"] if layer["driver"] == "GPKG"}:
            with contextlib.closing(sqlite3.connect(member(root, path).as_uri() + "?mode=ro", uri=True)) as database:
                need(database.execute("PRAGMA quick_check").fetchone()[0] == "ok", "VECTOR_GPKG_DATABASE_INVALID")
                need(not database.execute("PRAGMA foreign_key_check").fetchall(), "VECTOR_GPKG_FOREIGN_KEYS_INVALID")
        if ids:
            flush_stream(ids)
        return {"schema": "starforge.vector-native-verification.v1", "engine": capabilities(),
                "layers": checked, "nativeFeatures": sum(layer["features"] for layer in checked),
                "allOriginalBindingsMatched": True}
    finally:
        if ids:
            ids.close()
        conn.close()
        source.close()
        temporary.cleanup()

def build_native(root, source_capture, capture_file, profile, request_sha):
    inspection = read_json(root / "source" / "inspection.json")
    temporary = root / "native.receiving"
    if temporary.exists():
        shutil.rmtree(temporary)
    temporary.mkdir(mode=0o700)
    schema_layers, mappings, used_layer_names = [], {}, set()
    layer_metadata = {layer["id"]: layer for layer in inspection["layers"]}
    source_ref = lambda meta: {
        "captureSha256": capture_file["sha256"], "selectionId": source_capture["selection"]["id"],
        "selectionSha256": source_capture["selectionSha256"],
        "sourceEdition": source_capture["selection"]["sourceEdition"],
        "sourceSha256": meta["sourceSha256"], "nativeSourceLayer": meta["name"],
    }
    connection = read_catalog(root / "source" / "catalog.sqlite")
    try:
        with vector_environment(), (temporary / "source-features.ndjson").open("wb") as originals, \
                (temporary / "native-bindings.ndjson").open("wb") as bindings:
            os.chmod(temporary / "source-features.ndjson", 0o600)
            os.chmod(temporary / "native-bindings.ndjson", 0o600)
            for row in rows(connection):
                write_json_line(originals, {"rowKey": row["row_key"], "layerId": row["layer_id"],
                    "sourcePosition": row["position"], "identity": parse_json(row["identity_json"]),
                    "occurrence": row["occurrence"], **parse_json(row["record_json"])})
            for layer_id, meta in layer_metadata.items():
                layer_profile = profile["layers"].get(layer_id, {})
                projection = layer_crs(meta, layer_profile, profile)
                selected_name = safe_name(layer_profile.get("name", layer_id))
                if selected_name.casefold() in used_layer_names:
                    selected_name += "_" + hashlib.sha256(layer_id.encode()).hexdigest()[:8]
                used_layer_names.add(selected_name.casefold())
                label = layer_profile.get("label", meta["name"])
                for format_name in profile["formats"]:
                    fields = field_mapping(meta, format_name, layer_profile, profile)
                    physical = {"sf_key": "str:64", "sf_part": "str:64",
                                **{field["targetName"]: field["physicalType"]
                                   for field in fields if field["targetName"]}}
                    groups = {}
                    dimensions, kinds = set(), set()
                    for row in rows(connection, layer_id):
                        feature = parse_json(row["record_json"])["feature"]
                        geometry = transform_geometry(feature.get("geometry"), projection["source"], projection["target"])
                        dimensions.update(ordinate_dimensions(geometry))
                        if geometry is not None:
                            kinds.add(geometry["type"])
                        if format_name == "ESRI Shapefile":
                            for part_path, part_geometry in shape_parts(geometry, profile["shapefile"]["collections"] == "split"):
                                group, schema = shape_group(part_geometry)
                                groups[group] = schema
                    if format_name == "GPKG":
                        geometry_schema = next(iter(kinds)) if len(kinds) == 1 else "Unknown"
                        if dimensions == {3} and geometry_schema != "Unknown":
                            geometry_schema = "3D " + geometry_schema
                        groups = {"whole": geometry_schema}
                    if not groups:
                        groups = {"empty": "Point"}
                    with contextlib.ExitStack() as stack:
                        writers, output_layers = {}, {}
                        for group, geometry_schema in groups.items():
                            if format_name == "GPKG":
                                relative = "native/data.gpkg"
                                native_name = selected_name
                                actual_path = temporary / "data.gpkg"
                            else:
                                native_name = safe_name(selected_name + "_" + group, 64)
                                relative = "native/shapefiles/" + native_name + "/" + native_name + ".shp"
                                actual_path = temporary / "shapefiles" / native_name / (native_name + ".shp")
                                private_directory(actual_path.parent)
                            identifier = layer_id + ":" + ("gpkg" if format_name == "GPKG" else "shp:" + group)
                            item = {"id": identifier, "sourceLayerId": layer_id, "sourceId": meta["sourceId"],
                                    "driver": format_name, "path": relative, "layer": native_name,
                                    "geometry": geometry_schema, "crsWkt": projection["target"],
                                    "coordinateOrder": "x,y", "crsMapping": projection,
                                    "featureCount": 0, "sourceFeatureCount": meta["counts"]["features"],
                                    "fields": fields, "sourceReference": source_ref(meta)}
                            writers[group] = stack.enter_context(writer(actual_path, format_name, native_name,
                                                         geometry_schema, physical, projection["target"], label))
                            output_layers[group] = item
                            schema_layers.append(item)
                        for row in rows(connection, layer_id):
                            record = parse_json(row["record_json"])
                            feature = record["feature"]
                            geometry = transform_geometry(feature.get("geometry"), projection["source"], projection["target"])
                            pieces = [((), geometry)] if format_name == "GPKG" else list(
                                shape_parts(geometry, profile["shapefile"]["collections"] == "split"))
                            for part_path, part_geometry in pieces:
                                group = "whole" if format_name == "GPKG" else shape_group(part_geometry)[0]
                                if group not in writers and not kinds:
                                    group = next(iter(writers))
                                part_key = digest({"path": list(part_path)}) if part_path else "whole"
                                properties = {"sf_key": row["row_key"], "sf_part": part_key}
                                properties.update({field["targetName"]: attribute_value(field, feature)
                                                   for field in fields if field["targetName"]})
                                writers[group].write({"type": "Feature", "geometry": part_geometry,
                                                      "properties": properties})
                                item = output_layers[group]
                                item["featureCount"] += 1
                                write_json_line(bindings, {"layerId": item["id"], "rowKey": row["row_key"],
                                    "partKey": part_key, "partPath": list(part_path),
                                    "sourceLayerId": layer_id, "properties": properties, "geometry": part_geometry})
                    mappings[layer_id + ":" + format_name] = fields
            flush_stream(originals)
            flush_stream(bindings)
    finally:
        connection.close()
    atomic_json(temporary / "field-map.json", {"schema": "starforge.vector-field-map.v1", "layers": mappings})
    native = {"schema": "starforge.vector-native.v1", "engine": capabilities(),
              "requestSha256": request_sha, "formats": profile["formats"], "layers": schema_layers,
              "bindings": {"path": "native/native-bindings.ndjson"},
              "sourceFeatures": {"path": "native/source-features.ndjson"}}
    staged = parse_json(canonical(native))
    for item in staged["layers"]:
        item["path"] = item["path"].removeprefix("native/")
    staged["bindings"]["path"] = "native-bindings.ndjson"
    staged["sourceFeatures"]["path"] = "source-features.ndjson"
    verification = native_reopen(temporary, staged, profile,
        source_catalog=root / "source" / "catalog.sqlite",
        native_ids_path=temporary / "native-row-ids.ndjson")
    for item, observed in zip(native["layers"], verification["layers"]):
        item["geometry"] = observed["geometry"]
        item["crsWkt"] = observed["crsWkt"]
        item["featureCount"] = observed["features"]
        for field in item["fields"]:
            if field["targetName"]:
                field["observedPhysicalType"] = observed["schema"][field["targetName"]]
        if item["driver"] == "ESRI Shapefile":
            base = temporary / item["path"].removeprefix("native/")
            needed = (".shp", ".shx", ".dbf", ".cpg") + ((".prj",) if item["crsWkt"] else ())
            need(all(base.with_suffix(extension).is_file() for extension in needed),
                 "VECTOR_SHAPEFILE_COMPONENT_MISSING", item["id"])
    native["verification"] = verification
    atomic_json(temporary / "native.json", native)
    atomic_json(temporary / "complete.json", {
        "requestSha256": request_sha,
        "files": all_files(temporary, excluded=("complete.json",)),
    })
    need(not (root / "native").exists(), "VECTOR_NATIVE_DESTINATION_ALREADY_USED")
    os.replace(temporary, root / "native")
    fsync_directory(root)
    return native

def export_capture(capture_directory, directory, profile, operation_id):
    require_id(operation_id, "operationId")
    original = open_capture(capture_directory)
    captured, capture_file, inspection = original["manifest"], original["manifestFile"], original["inspection"]
    profile = profile_contract(profile, [layer["id"] for layer in inspection["layers"]])
    request = {"schema": "starforge.vector-export-request.v1", "operationId": operation_id,
               "captureSha256": capture_file["sha256"], "profile": profile}
    with claim(directory, request) as root:
        if (root / "vector-export.json").exists():
            manifest, record = verify_manifest(root, "vector-export.json", EXPORT)
            need(manifest["requestSha256"] == digest(request), "VECTOR_ORIGINAL_REQUEST_CONFLICT")
            return {"directory": str(root), "manifest": manifest, "manifestFile": record, "replayed": True}
        clone_capture(capture_directory, root / "source", capture_file["sha256"])
        checkpoint = root / "native" / "complete.json"
        if checkpoint.exists():
            saved = read_json(checkpoint)
            need(saved["requestSha256"] == digest(request), "VECTOR_NATIVE_REQUEST_CHANGED")
            for record in saved["files"]:
                verify_file(root / "native", record)
            native = read_json(root / "native" / "native.json")
        else:
            native = build_native(root, captured, capture_file, profile, digest(request))
        files = all_files(root, excluded=("request.json", "vector-export.json"))
        source_record = {**capture_file, "path": "source/capture.json"}
        manifest = {"schema": EXPORT, "requestSha256": digest(request), "operationId": operation_id,
                    "sourceEdition": captured["selection"]["sourceEdition"],
                    "selectionSha256": captured["selectionSha256"],
                    "sourceCapture": source_record, "profile": profile, "native": native,
                    "counts": {"sourceFeatures": captured["counts"]["features"],
                               "nativeFeatures": sum(layer["featureCount"] for layer in native["layers"]),
                               "nativeLayers": len(native["layers"]), "files": len(files)},
                    "files": files}
        atomic_json(root / "vector-export.json", manifest)
        return {"directory": str(root), "manifest": manifest,
                "manifestFile": file_record(root / "vector-export.json", "vector-export.json"), "replayed": False}

def open_vector_export(directory, expected_manifest_sha256=None, native=True):
    manifest, record = verify_manifest(directory, "vector-export.json", EXPORT, expected_manifest_sha256)
    original = open_capture(Path(directory) / "source", manifest["sourceCapture"]["sha256"])
    captured, capture_file = original["manifest"], original["manifestFile"]
    declared = {item["path"]: item for item in manifest["files"]}
    source_record = {**capture_file, "path": "source/capture.json"}
    need(manifest["sourceCapture"] == source_record and declared.get(source_record["path"]) == source_record,
         "VECTOR_SOURCE_CAPTURE_DESCRIPTOR_CHANGED")
    for item in captured["files"]:
        expected = {**item, "path": "source/" + item["path"]}
        need(declared.get(expected["path"]) == expected, "VECTOR_SOURCE_CAPTURE_MEMBER_NOT_DECLARED", expected["path"])
    need(manifest["native"] == read_json(Path(directory) / "native" / "native.json"),
         "VECTOR_NATIVE_MANIFEST_CHANGED")
    paths = {"native/native.json", "native/field-map.json", "native/native-row-ids.ndjson",
             manifest["native"]["bindings"]["path"], manifest["native"]["sourceFeatures"]["path"]}
    for layer in manifest["native"]["layers"]:
        paths.add(layer["path"])
        if layer["driver"] == "ESRI Shapefile":
            base = Path(layer["path"])
            extensions = (".shp", ".shx", ".dbf", ".cpg") + ((".prj",) if layer.get("crsWkt") else ())
            paths.update(base.with_suffix(extension).as_posix() for extension in extensions)
    need(paths.issubset(declared), "VECTOR_NATIVE_MEMBER_NOT_DECLARED", sorted(paths - set(declared)))
    need(captured["selectionSha256"] == manifest["selectionSha256"] and
         captured["selection"]["sourceEdition"] == manifest["sourceEdition"],
         "VECTOR_ORIGINAL_EDITION_CHANGED")
    result = {"directory": str(Path(directory).resolve()), "manifest": manifest, "manifestFile": record}
    if native:
        result["receiving"] = native_reopen(Path(directory), manifest["native"], manifest["profile"])
    return result

def receive_vector_export(source, destination, expected_manifest_sha256=None):
    original = open_vector_export(source, expected_manifest_sha256, native=False)
    request = {"schema": "starforge.vector-receive-request.v1",
               "manifestSha256": original["manifestFile"]["sha256"]}
    from .common import copy_verified
    with claim(destination, request) as root:
        for record in original["manifest"]["files"] + [original["manifestFile"]]:
            copy_verified(member(source, record["path"]), member(root, record["path"]), record)
        return open_vector_export(root, request["manifestSha256"], native=True)
