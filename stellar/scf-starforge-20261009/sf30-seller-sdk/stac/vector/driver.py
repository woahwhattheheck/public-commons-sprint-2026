"""Fiona/GDAL native file I/O. Original provider acquisition stays with its owner."""
from __future__ import annotations
import contextlib
import importlib
import io
import json
import math
import os
import sys
import zipfile
from pathlib import Path
from decimal import Decimal
from .common import VectorError, need, canonical, strict_object, member, encoded_value, number_decimal

DRIVERS = {
    ".geojson": "GeoJSON", ".json": "GeoJSON",
    ".geojsonl": "GeoJSONSeq", ".jsonl": "GeoJSONSeq", ".ndjson": "GeoJSONSeq",
    ".gpkg": "GPKG", ".shp": "ESRI Shapefile", ".fgb": "FlatGeobuf",
}
FORMATS = ("GPKG", "ESRI Shapefile")

def fiona_module():
    try:
        return importlib.import_module("fiona")
    except ImportError as exc:
        raise VectorError("VECTOR_FIONA_RUNTIME_REQUIRED",
                          {"python": sys.executable, "detail": str(exc)}) from exc

def vector_environment():
    """Use the actual vector wheel's GDAL/PROJ resources for its entire lifetime."""
    fiona = fiona_module()
    package = Path(fiona.__file__).resolve().parent
    options = {"GDAL_HTTP_MAX_RETRY": 0, "PROJ_NETWORK": "OFF",
               "OGR_ENABLE_PARTIAL_REPROJECTION": False}
    if (package / "gdal_data").is_dir():
        options["GDAL_DATA"] = str(package / "gdal_data")
    if (package / "proj_data" / "proj.db").is_file():
        options["PROJ_LIB"] = str(package / "proj_data")
    return fiona.Env(**options)

def capabilities():
    fiona = fiona_module()
    with vector_environment() as env:
        drivers = env.drivers()
        return {
            "schema": "starforge.vector-engine.v1", "python": sys.version.split()[0],
            "pythonExecutable": sys.executable, "fiona": fiona.__version__,
            "gdal": fiona.__gdal_version__, "module": fiona.__file__,
            "drivers": {name: {"installed": name in drivers,
                               "fionaModes": fiona.supported_drivers.get(name, ""),
                               "write": "w" in fiona.supported_drivers.get(name, "")}
                        for name in FORMATS},
            "coordinateOrder": "x,y", "projectionNetwork": False,
        }

def source_driver(source):
    suffix = Path(source.get("archiveMember") or source["path"]).suffix.lower()
    inferred = DRIVERS.get(suffix)
    selected = source.get("driver", inferred)
    need(selected in set(DRIVERS.values()), "VECTOR_SOURCE_DRIVER_UNSUPPORTED", selected)
    need(inferred is None or inferred == selected, "VECTOR_SOURCE_DRIVER_EXTENSION_CONFLICT")
    if Path(source["path"]).suffix.lower() == ".zip":
        need(isinstance(source.get("archiveMember"), str),
             "VECTOR_ARCHIVE_MEMBER_REQUIRED")
    else:
        need(not source.get("archiveMember"), "VECTOR_ARCHIVE_MEMBER_WITHOUT_ARCHIVE")
    return selected

def checked_archive(path, source):
    selected = source.get("archiveMember")
    if not selected:
        return
    member(Path("/"), selected)
    with zipfile.ZipFile(path) as archive:
        names = set()
        for info in archive.infolist():
            need(info.filename not in names, "VECTOR_DUPLICATE_ARCHIVE_MEMBER", info.filename)
            names.add(info.filename)
            member(Path("/"), info.filename.rstrip("/") or "empty")
            need(((info.external_attr >> 16) & 0o170000) != 0o120000,
                 "VECTOR_ARCHIVE_SYMLINK_UNSUPPORTED", info.filename)
        need(selected in names, "VECTOR_ARCHIVE_MEMBER_MISSING", selected)
        if source_driver(source) == "ESRI Shapefile":
            stem = str(Path(selected).with_suffix("")).lower()
            lowered = {name.lower() for name in names}
            need(all(stem + extension in lowered for extension in (".shp", ".shx", ".dbf")),
                 "VECTOR_SHAPEFILE_COMPONENT_MISSING", selected)

def native_path(path, source):
    checked_archive(path, source)
    if source.get("archiveMember"):
        need("!" not in str(path) and "!" not in source["archiveMember"],
             "VECTOR_ARCHIVE_PATH_INVALID")
        return "zip://" + str(Path(path).resolve()) + "!" + source["archiveMember"]
    return str(Path(path).resolve())

@contextlib.contextmanager
def text_source(path, source):
    if source.get("archiveMember"):
        with zipfile.ZipFile(path) as archive, archive.open(source["archiveMember"]) as raw:
            with io.TextIOWrapper(raw, encoding="utf-8-sig") as stream:
                yield stream
    else:
        with Path(path).open("r", encoding="utf-8-sig") as stream:
            yield stream

class JsonStream:
    """Incremental JSON values; FeatureCollection features need no whole-file buffer."""
    def __init__(self, stream, sequence=False):
        self.stream, self.sequence, self.buffer, self.position, self.eof = stream, sequence, "", 0, False
        self.decoder = json.JSONDecoder(object_pairs_hook=strict_object, parse_float=Decimal,
            parse_constant=lambda value: (_ for _ in ()).throw(
                VectorError("VECTOR_NONFINITE_JSON", value)))

    def more(self):
        if self.position:
            self.buffer = self.buffer[self.position:]
            self.position = 0
        part = self.stream.read(64 * 1024)
        self.buffer += part
        if not part:
            self.eof = True
        return bool(part)

    def peek(self):
        while True:
            while self.position < len(self.buffer) and (
                    self.buffer[self.position].isspace() or
                    self.sequence and self.buffer[self.position] == "\x1e"):
                self.position += 1
            if self.position < len(self.buffer):
                return self.buffer[self.position]
            if self.eof:
                return ""
            self.more()

    def punctuation(self, expected):
        need(self.peek() == expected, "VECTOR_GEOJSON_SYNTAX", expected)
        self.position += 1

    def value(self):
        self.peek()
        while True:
            try:
                value, end = self.decoder.raw_decode(self.buffer, self.position)
                # A number ending at a chunk boundary may continue in the next chunk.
                if not self.eof and (end == len(self.buffer) or self.buffer[end:end+1] in ("e", "E", ".", "+", "-")):
                    self.more()
                    continue
                self.position = end
                return value
            except json.JSONDecodeError as exc:
                if not self.eof:
                    self.more()
                else:
                    raise VectorError("VECTOR_GEOJSON_SYNTAX", str(exc)) from exc

def geojson_features(path, source):
    with text_source(path, source) as stream:
        values = JsonStream(stream, sequence=source_driver(source) == "GeoJSONSeq")
        if values.sequence:
            while values.peek():
                feature = values.value()
                need(isinstance(feature, dict) and feature.get("type") == "Feature",
                     "VECTOR_GEOJSON_FEATURE_REQUIRED")
                yield feature
            return
        values.punctuation("{")
        header, seen, has_features = {}, set(), False
        while values.peek() != "}":
            key = values.value()
            need(isinstance(key, str) and key not in seen, "VECTOR_DUPLICATE_JSON_KEY", key)
            seen.add(key)
            values.punctuation(":")
            if key == "features":
                has_features = True
                values.punctuation("[")
                while values.peek() != "]":
                    feature = values.value()
                    need(isinstance(feature, dict) and feature.get("type") == "Feature",
                         "VECTOR_GEOJSON_FEATURE_REQUIRED")
                    yield feature
                    if values.peek() == "]":
                        break
                    values.punctuation(",")
                    need(values.peek() != "]", "VECTOR_GEOJSON_TRAILING_COMMA")
                values.punctuation("]")
            else:
                header[key] = values.value()
            if values.peek() == "}":
                break
            values.punctuation(",")
            need(values.peek() != "}", "VECTOR_GEOJSON_TRAILING_COMMA")
        values.punctuation("}")
        need(not values.peek(), "VECTOR_GEOJSON_TRAILING_CONTENT")
        if has_features:
            need(header.get("type") == "FeatureCollection", "VECTOR_GEOJSON_COLLECTION_REQUIRED")
        else:
            need(header.get("type") == "Feature", "VECTOR_GEOJSON_FEATURE_REQUIRED")
            yield header

def layers(path, source):
    fiona = fiona_module()
    driver = source_driver(source)
    native = native_path(path, source)
    with vector_environment():
        available = list(fiona.listlayers(native, enabled_drivers=[driver]))
        requested = source.get("layers")
        if source.get("layer") is not None:
            need(requested is None, "VECTOR_LAYER_SELECTOR_CONFLICT")
            requested = [source["layer"]]
        if requested is None:
            requested = available
        need(isinstance(requested, list) and requested and len(set(requested)) == len(requested),
             "VECTOR_LAYERS_REQUIRED")
        need(set(requested).issubset(set(available)), "VECTOR_SOURCE_LAYER_MISSING",
             {"requested": requested, "available": available})
        result = []
        for name in requested:
            options = {"layer": name, "enabled_drivers": [driver]}
            if source.get("encoding"):
                options["encoding"] = source["encoding"]
            with fiona.open(native, "r", **options) as dataset:
                need(dataset.driver == driver, "VECTOR_SOURCE_DRIVER_CHANGED")
                try:
                    bounds = list(dataset.bounds) if len(dataset) else None
                    if bounds and not all(math.isfinite(value) for value in bounds):
                        bounds = None
                except Exception:
                    bounds = None
                result.append({"name": name, "driver": dataset.driver,
                    "schema": {"geometry": dataset.schema["geometry"],
                               "properties": dict(dataset.schema["properties"])},
                    "crsWkt": dataset.crs_wkt or None,
                    "crs": dataset.crs.to_string() if dataset.crs else None,
                    "encoding": source.get("encoding") or dataset.encoding,
                    "featureCount": len(dataset), "bounds": bounds,
                    "coordinateOrder": "x,y"})
        return result

def native_features(path, source, layer):
    driver = source_driver(source)
    if driver in ("GeoJSON", "GeoJSONSeq"):
        yield from geojson_features(path, source)
        return
    fiona = fiona_module()
    from fiona.model import to_dict
    options = {"layer": layer["name"], "enabled_drivers": [driver]}
    if source.get("encoding"):
        options["encoding"] = source["encoding"]
    with vector_environment(), fiona.open(native_path(path, source), "r", **options) as dataset:
        for feature in dataset:
            yield to_dict(feature)

def crs(value):
    from fiona.crs import CRS
    need(isinstance(value, str) and value.strip(), "VECTOR_CRS_REQUIRED")
    try:
        return CRS.from_user_input(value)
    except Exception as exc:
        raise VectorError("VECTOR_CRS_INVALID", str(exc)) from exc

def same_crs(left, right):
    if not left or not right:
        return not left and not right
    return crs(left) == crs(right)

def native_geometry(geometry):
    """Convert only exact, finite JSON ordinates to the native double boundary."""
    if geometry is None:
        return None
    need(isinstance(geometry, dict), "VECTOR_GEOMETRY_REQUIRED")
    kind = geometry.get("type")
    if kind == "GeometryCollection":
        children = geometry.get("geometries")
        need(isinstance(children, list), "VECTOR_GEOMETRY_COLLECTION_REQUIRED")
        return {"type": kind, "geometries": [native_geometry(child) for child in children]}
    need(kind in ("Point", "MultiPoint", "LineString", "MultiLineString",
                  "Polygon", "MultiPolygon"), "VECTOR_GEOMETRY_TYPE_UNSUPPORTED", kind)
    def ordinates(value):
        if isinstance(value, (list, tuple)):
            return [ordinates(child) for child in value]
        exact = number_decimal(value)
        try:
            native = float(value)
        except (ValueError, OverflowError) as exc:
            raise VectorError("VECTOR_COORDINATE_NATIVE_RANGE", canonical(value)) from exc
        need(math.isfinite(native) and number_decimal(native) == exact,
             "VECTOR_COORDINATE_PRECISION_REQUIRES_REVIEW", canonical(value))
        return native
    return {"type": kind, "coordinates": ordinates(geometry.get("coordinates"))}

def transform_geometry(geometry, source_crs, target_crs):
    geometry = native_geometry(geometry)
    if geometry is None or not target_crs or same_crs(source_crs, target_crs):
        return geometry
    need(source_crs, "VECTOR_SOURCE_CRS_REQUIRED_FOR_TRANSFORM")
    from fiona.transform import transform_geom
    from fiona.model import to_dict
    result = transform_geom(crs(source_crs), crs(target_crs), geometry,
                            antimeridian_cutting=False, precision=-1)
    need(result is not None, "VECTOR_NATIVE_TRANSFORM_FAILED")
    return native_geometry(to_dict(result))

def writer(path, driver, layer, geometry, fields, crs_wkt, label):
    fiona = fiona_module()
    need("w" in fiona.supported_drivers.get(driver, ""), "VECTOR_NATIVE_DRIVER_NOT_WRITABLE", driver)
    options = {"driver": driver, "schema": {"geometry": geometry, "properties": fields},
               "encoding": "UTF-8", "crs_wkt": crs_wkt}
    if driver == "GPKG":
        options.update(layer=layer, SPATIAL_INDEX="YES", FID="fid",
                       GEOMETRY_NAME="geom", IDENTIFIER=label)
    else:
        options.update({"2GB_LIMIT": "YES", "SPATIAL_INDEX": "YES"})
    return fiona.open(str(path), "w", **options)

def reopen(path, driver, layer=None):
    options = {"enabled_drivers": [driver]}
    if driver == "GPKG":
        options["layer"] = layer
    return fiona_module().open(str(path), "r", **options)
