"""Inspect complete Wherobots output editions while retaining every original byte."""
from __future__ import annotations

import base64
import csv
import hashlib
import io
import json
import math
import re
import sqlite3
import struct
import tempfile
import threading
from collections import OrderedDict
from datetime import date, datetime, time, timezone
from decimal import Decimal
from pathlib import Path, PurePosixPath
from urllib.parse import unquote

from .storage import OperationError, private_directory

EDITION_SCHEMA = "stellar-forge.wherobots-output-edition.v1"
COMPARISON_SCHEMA = "stellar-forge.wherobots-edition-comparison.v1"
MAX_RECORD_BYTES = 32 * 1024 * 1024
FORMATS = {"csv", "ndjson", "geojson-seq", "parquet", "geoparquet"}
AUXILIARY = {"_SUCCESS", "_metadata", "_common_metadata"}
MISSING = object()
_VERIFIED = OrderedDict()
_VERIFY_LOCK = threading.RLock()
GEOMETRIES = {1: "Point", 2: "LineString", 3: "Polygon", 4: "MultiPoint",
              5: "MultiLineString", 6: "MultiPolygon", 7: "GeometryCollection"}


class OutputError(OperationError):
    def __init__(self, code, message):
        super().__init__(code, message, status=422)


class ExactNumber(str):
    """Original JSON numeric token; never a binary floating-point conversion."""


def fail(code, message):
    raise OutputError(code, message)


def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _pairs(items):
    result = {}
    for name, value in items:
        if name in result:
            fail("OUTPUT_JSON_DUPLICATE", "A source object repeats property " + repr(name))
        result[name] = value
    return result


def _parse(text):
    return json.loads(text, parse_int=ExactNumber, parse_float=ExactNumber,
                      parse_constant=lambda value: fail("OUTPUT_JSON_NUMBER", "Non-JSON number " + value),
                      object_pairs_hook=_pairs)


def _view(value):
    if isinstance(value, ExactNumber):
        return {"$number": str(value)}
    if isinstance(value, Decimal):
        return {"$decimal": str(value)}
    if isinstance(value, int) and not isinstance(value, bool) and abs(value) > 9007199254740991:
        return {"$integer": str(value)}
    if isinstance(value, float) and not math.isfinite(value):
        return {"$float": repr(value)}
    if isinstance(value, bytes):
        return {"$binary": base64.b64encode(value).decode("ascii"), "encoding": "base64"}
    if isinstance(value, (datetime, date, time)):
        return {"$temporal": value.isoformat()}
    if isinstance(value, dict):
        return {str(key): _view(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_view(item) for item in value]
    return value


def _typed(value):
    if value is None:
        return ["null"]
    if isinstance(value, bool):
        return ["boolean", value]
    if isinstance(value, ExactNumber):
        return ["json-number", str(value)]
    if isinstance(value, Decimal):
        return ["decimal", str(value)]
    if isinstance(value, int):
        return ["integer", str(value)]
    if isinstance(value, float):
        return ["float", value.hex() if math.isfinite(value) else repr(value)]
    if isinstance(value, bytes):
        return ["bytes", base64.b64encode(value).decode("ascii")]
    if isinstance(value, str):
        return ["string", value]
    if isinstance(value, dict):
        return ["object", [[str(key), _typed(value[key])] for key in sorted(value)]]
    if isinstance(value, (list, tuple)):
        return ["array", [_typed(item) for item in value]]
    if isinstance(value, (datetime, date, time)):
        return [type(value).__name__, value.isoformat()]
    fail("OUTPUT_VALUE_TYPE", "Unsupported source value type " + type(value).__name__)


def _canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
                      allow_nan=False).encode("utf-8")


def _digest(value):
    return hashlib.sha256(_canonical(value)).hexdigest()


def _file_hash(path):
    digest = hashlib.sha256()
    size = 0
    with open(path, "rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
            size += len(chunk)
    return {"sha256": digest.hexdigest(), "bytes": size}


def _object(ws, descriptor):
    if (not isinstance(descriptor, dict) or
        not isinstance(descriptor.get("sha256"), str) or
        len(descriptor["sha256"]) != 64 or
        any(char not in "0123456789abcdef" for char in descriptor["sha256"]) or
        type(descriptor.get("bytes")) is not int or descriptor["bytes"] < 0):
        fail("OUTPUT_OBJECT", "Use an original retained object descriptor.")
    path = Path(ws.object_path(descriptor["sha256"])).resolve()
    expected = {key: descriptor[key] for key in ("sha256", "bytes")}
    before = path.stat()
    stamp = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
    key = (str(path), descriptor["sha256"], descriptor["bytes"])
    with _VERIFY_LOCK:
        if _VERIFIED.get(key) == stamp:
            _VERIFIED.move_to_end(key)
            return path
    if _file_hash(path) != expected:
        fail("OUTPUT_OBJECT_CHANGED", "Retained source bytes changed: " + descriptor["sha256"])
    after = path.stat()
    if stamp != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
        fail("OUTPUT_OBJECT_CHANGED", "A retained source changed while its digest was read.")
    with _VERIFY_LOCK:
        _VERIFIED[key] = stamp
        _VERIFIED.move_to_end(key)
        while len(_VERIFIED) > 256:
            _VERIFIED.popitem(last=False)
    return path


def _relative(value):
    if (not isinstance(value, str) or not value or "\\" in value or "\x00" in value or
        any(ord(char) < 32 for char in value) or value.startswith("/") or
        any(part in {"", ".", ".."} for part in value.split("/"))):
        fail("OUTPUT_PATH", "Output parts require distinct relative POSIX paths.")
    return value


def _format(definition):
    value = definition.get("format", "")
    value = {"json": "ndjson", "jsonl": "ndjson", "geojson": "geojson-seq",
             "geojsonseq": "geojson-seq"}.get(value, value)
    if value not in FORMATS:
        fail("OUTPUT_FORMAT", "Select csv, ndjson, geojson-seq, parquet or geoparquet.")
    return value


def _auxiliary(path, item):
    name = PurePosixPath(path).name
    return (item.get("role") in {"auxiliary", "metadata", "marker"} or name in AUXILIARY or
            name.startswith(("_started_", "_committed_")) or name.endswith(".crc"))


def _column_names(raw):
    if isinstance(raw, dict):
        raw = list(raw)
    if not isinstance(raw, list) or not raw:
        fail("OUTPUT_CSV_COLUMNS", "Declare the source column names for headerless CSV parts.")
    names = [item["name"] if isinstance(item, dict) else item for item in raw]
    if any(not isinstance(name, str) or not name for name in names) or len(set(names)) != len(names):
        fail("OUTPUT_CSV_COLUMNS", "CSV column names must be nonempty and unique.")
    return names


def _csv_options(definition):
    options = definition.get("csv", {})
    if not isinstance(options, dict):
        fail("OUTPUT_CSV_OPTIONS", "CSV reader options must be an object.")
    header = options.get("header")
    if type(header) is not bool:
        fail("OUTPUT_CSV_HEADER", "Declare csv.header as true or false for the original part files.")
    delimiter = options.get("delimiter", ",")
    quotechar = options.get("quotechar", '"')
    if (not isinstance(delimiter, str) or not isinstance(quotechar, str) or
        len(delimiter) != 1 or len(quotechar) != 1 or delimiter in "\r\n" or quotechar in "\r\n" or
        type(options.get("doublequote", True)) is not bool):
        fail("OUTPUT_CSV_OPTIONS", "CSV delimiter and quotechar must each be one non-newline character.")
    encoding = options.get("encoding", "utf-8")
    if encoding not in {"utf-8", "utf-8-sig"}:
        fail("OUTPUT_CSV_ENCODING", "Select the original UTF-8 CSV encoding.")
    names = None if header else _column_names(options.get("columns", definition.get("columns")))
    return options, {"delimiter": delimiter, "quotechar": quotechar,
                     "doublequote": options.get("doublequote", True), "strict": True}, encoding, names


def _json_row(raw, feature):
    if len(raw) > MAX_RECORD_BYTES:
        fail("OUTPUT_RECORD_SIZE", "A source record exceeds the 32 MiB streaming record budget.")
    value = _parse(raw.decode("utf-8-sig"))
    if not isinstance(value, dict):
        fail("OUTPUT_ROW", "Each source record must be a JSON object.")
    if feature and value.get("type") != "Feature":
        fail("OUTPUT_GEOJSON_SEQUENCE", "The reviewed GeoJSON sequence requires complete Feature records.")
    return value


def _iter_json(path, feature=False):
    with open(path, "rb") as stream:
        prefix = stream.read(65536)
        sequence = prefix.lstrip(b"\xef\xbb\xbf \r\n\t").startswith(b"\x1e")
        stream.seek(0)
        if not sequence:
            index = 0
            while True:
                start = stream.tell()
                raw = stream.readline(MAX_RECORD_BYTES + 1)
                if not raw:
                    return
                if len(raw) > MAX_RECORD_BYTES:
                    fail("OUTPUT_RECORD_SIZE", "A JSON source record exceeds the streaming record budget.")
                if raw.strip():
                    yield index, _json_row(raw, feature), start, stream.tell()
                    index += 1
            return
        buffer = b""
        absolute = 0
        started = False
        index = 0
        while True:
            chunk = stream.read(65536)
            buffer += chunk
            if not started:
                boundary = buffer.find(b"\x1e")
                if boundary < 0:
                    if not chunk:
                        return
                    continue
                if buffer[:boundary].strip(b"\xef\xbb\xbf \r\n\t"):
                    fail("OUTPUT_SEQUENCE", "GeoJSON record separators follow only leading whitespace.")
                absolute += boundary + 1
                buffer = buffer[boundary + 1:]
                started = True
            while (boundary := buffer.find(b"\x1e")) >= 0:
                raw = buffer[:boundary]
                if not raw.endswith(b"\n"):
                    fail("OUTPUT_SEQUENCE", "An RFC 8142 record must end with a line feed.")
                yield index, _json_row(raw, feature), absolute, absolute + boundary
                index += 1
                buffer = buffer[boundary + 1:]
                absolute += boundary + 1
            if len(buffer) > MAX_RECORD_BYTES:
                fail("OUTPUT_RECORD_SIZE", "A GeoJSON source record exceeds the streaming record budget.")
            if not chunk:
                if buffer:
                    if not buffer.endswith(b"\n"):
                        fail("OUTPUT_SEQUENCE", "The final RFC 8142 record must end with a line feed.")
                    yield index, _json_row(buffer, feature), absolute, absolute + len(buffer)
                return


def _csv_part(path, definition):
    options, dialect, encoding, declared = _csv_options(definition)
    info = {"format": "csv", "columns": declared or [], "csv": dict(options)}
    def rows():
        csv.field_size_limit(MAX_RECORD_BYTES)
        with open(path, "rb") as stream:
            first_line = True
            def lines():
                nonlocal first_line
                while raw := stream.readline(MAX_RECORD_BYTES + 1):
                    if len(raw) > MAX_RECORD_BYTES:
                        fail("OUTPUT_RECORD_SIZE", "A CSV source line exceeds the streaming record budget.")
                    value = raw.decode("utf-8-sig" if first_line else encoding)
                    first_line = False
                    yield value
            reader = csv.reader(lines(), **dialect)
            if options["header"]:
                try:
                    names = _column_names(next(reader))
                except StopIteration:
                    names = _column_names(options.get("columns", definition.get("columns"))) if options.get("columns", definition.get("columns")) else []
            else:
                names = declared
            info["columns"] = names
            index = 0
            while True:
                start = stream.tell()
                try:
                    values = next(reader)
                except StopIteration:
                    return
                end = stream.tell()
                if end - start > MAX_RECORD_BYTES:
                    fail("OUTPUT_RECORD_SIZE", "A CSV source record exceeds the streaming record budget.")
                if len(values) != len(names):
                    fail("OUTPUT_CSV_WIDTH", "A CSV record differs from its original header or declared column count.")
                yield index, dict(zip(names, values)), start, end
                index += 1
    return info, rows()


def _arrow():
    try:
        import pyarrow as pa
        import pyarrow.parquet as pq
    except ImportError as error:
        raise OutputError("OUTPUT_PARQUET_DEPENDENCY", "Install the declared PyArrow dependency to inspect Parquet output.") from error
    return pa, pq


def _arrow_value(scalar, pa):
    if not scalar.is_valid:
        return None
    dtype = scalar.type
    if pa.types.is_timestamp(dtype):
        return {"$timestamp": str(scalar.cast(pa.int64()).as_py()), "unit": dtype.unit, "timezone": dtype.tz}
    if pa.types.is_duration(dtype) or pa.types.is_time32(dtype) or pa.types.is_time64(dtype):
        integer = pa.int32() if pa.types.is_time32(dtype) else pa.int64()
        return {"$temporal_ticks": str(scalar.cast(integer).as_py()), "type": str(dtype)}
    if pa.types.is_struct(dtype):
        return {field.name: _arrow_value(scalar[field.name], pa) for field in dtype}
    if pa.types.is_list(dtype) or pa.types.is_large_list(dtype) or pa.types.is_fixed_size_list(dtype):
        return [_arrow_value(item, pa) for item in scalar.values]
    if pa.types.is_map(dtype):
        return {"$map": [[_arrow_value(pair[dtype.key_field.name], pa), _arrow_value(pair[dtype.item_field.name], pa)] for pair in scalar.values]}
    return scalar.as_py()


def _parquet_part(path, definition, start=0):
    pa, pq = _arrow()
    native = pq.ParquetFile(path, memory_map=False, pre_buffer=False)
    schema = native.schema_arrow
    if len(schema.names) != len(set(schema.names)):
        native.close()
        fail("OUTPUT_PARQUET_COLUMNS", "The original Parquet schema repeats a root column name.")
    metadata = native.metadata.metadata or {}
    geo_bytes = metadata.get(b"geo")
    geo = _parse(geo_bytes.decode("utf-8")) if geo_bytes else None
    if _format(definition) == "geoparquet" and geo is None:
        native.close()
        fail("OUTPUT_GEOPARQUET_METADATA", "The reviewed GeoParquet output has no original geo metadata.")
    if geo is not None:
        if (not isinstance(geo, dict) or not isinstance(geo.get("version"), str) or
            not geo["version"].startswith("1.") or not isinstance(geo.get("columns"), dict) or
            geo.get("primary_column") not in geo["columns"] or
            any(name not in schema.names for name in geo["columns"])):
            native.close()
            fail("OUTPUT_GEOPARQUET_METADATA", "The original GeoParquet metadata is incomplete or uses an unsupported major version.")
    info = {"format": _format(definition), "metadata_rows": native.metadata.num_rows,
            "row_groups": native.num_row_groups,
            "columns": [{"name": field.name, "type": str(field.type), "nullable": field.nullable,
                         "metadata_base64": {base64.b64encode(key).decode(): base64.b64encode(value).decode()
                                             for key, value in (field.metadata or {}).items()}}
                        for field in schema],
            "file_metadata_base64": {base64.b64encode(key).decode(): base64.b64encode(value).decode()
                                    for key, value in metadata.items()},
            "geometry": _geometry_metadata(geo, definition)}
    def rows():
        position = 0
        row_base = None
        groups = []
        for group in range(native.num_row_groups):
            amount = native.metadata.row_group(group).num_rows
            if position + amount > start:
                if row_base is None:
                    row_base = position
                groups.append(group)
            position += amount
        index = row_base if row_base is not None else position
        try:
            if not groups:
                return
            for batch in native.iter_batches(batch_size=4096, row_groups=groups, use_threads=False):
                for offset in range(batch.num_rows):
                    if index >= start:
                        row = {name: _arrow_value(batch.column(column)[offset], pa)
                               for column, name in enumerate(batch.schema.names)}
                        yield index, row, None, None
                    index += 1
        finally:
            native.close()
    return info, rows()


def _geometry_metadata(geo, definition):
    if geo is None:
        if _format(definition) == "geojson-seq":
            return {"geometry": {"encoding": "GeoJSON", "crs": {"state": "format-default", "value": "OGC:CRS84"},
                                 "axis_order": "longitude,latitude"}}
        column = definition.get("geometry_column")
        if column:
            return {column: {"encoding": definition.get("geometry_encoding", "undeclared"),
                             "crs": {"state": "reviewed" if definition.get("crs") is not None else "unknown",
                                     "json": _lossless_json(definition.get("crs"))},
                             "axis_order": definition.get("axis_order", "undeclared")}}
        return {}
    result = {}
    for column, value in geo["columns"].items():
        if not isinstance(value, dict) or value.get("encoding") not in {
            "WKB", "point", "linestring", "polygon", "multipoint", "multilinestring", "multipolygon"}:
            fail("OUTPUT_GEOPARQUET_ENCODING", "Unsupported original GeoParquet geometry encoding.")
        if "crs" not in value:
            crs = {"state": "format-default", "value": "OGC:CRS84"}
        elif value["crs"] is None:
            crs = {"state": "unknown", "value": None}
        elif isinstance(value["crs"], dict):
            crs = {"state": "declared", "projjson": _lossless_json(value["crs"])}
        else:
            fail("OUTPUT_GEOPARQUET_CRS", "GeoParquet CRS must be a PROJJSON object, null, or absent.")
        result[column] = {"encoding": value["encoding"], "crs": crs, "axis_order": "x,y",
                          "geoparquet_version": geo["version"], "primary": column == geo["primary_column"],
                          "source_metadata_json": _lossless_json(value)}
    return result


def _lossless_json(value):
    if isinstance(value, ExactNumber):
        return str(value)
    if isinstance(value, Decimal):
        return str(value)
    if value is None or isinstance(value, (bool, int, float, str)):
        return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    if isinstance(value, dict):
        return "{" + ",".join(json.dumps(str(key), ensure_ascii=False) + ":" + _lossless_json(item)
                               for key, item in value.items()) + "}"
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(_lossless_json(item) for item in value) + "]"
    return json.dumps(_view(value), ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def _part(path, definition, start=0):
    fmt = _format(definition)
    if fmt == "csv":
        return _csv_part(path, definition)
    if fmt in {"ndjson", "geojson-seq"}:
        return {"format": fmt, "geometry": _geometry_metadata(None, definition)}, _iter_json(path, fmt == "geojson-seq")
    return _parquet_part(path, definition, start)


def _coordinate(value):
    if isinstance(value, bool) or not isinstance(value, (ExactNumber, Decimal, int, float)):
        fail("OUTPUT_GEOMETRY", "Geometry coordinates must be source numbers.")
    number = Decimal(str(value))
    if not number.is_finite():
        fail("OUTPUT_GEOMETRY", "Geometry coordinates must be finite.")
    return number


def _point(stats, values):
    if len(values) < 2:
        fail("OUTPUT_GEOMETRY", "A geometry position needs at least two coordinates.")
    point = [_coordinate(value) for value in values]
    dimensions = len(point)
    stats["dimensions"].add(dimensions)
    stats["positions"] += 1
    if stats["minimum"] is None:
        stats["minimum"], stats["maximum"] = list(point), list(point)
    elif dimensions == len(stats["minimum"]):
        stats["minimum"] = [min(old, value) for old, value in zip(stats["minimum"], point)]
        stats["maximum"] = [max(old, value) for old, value in zip(stats["maximum"], point)]
    else:
        stats["mixed_dimensions"] = True


def _geojson(stats, value, depth=0):
    if depth > 128 or not isinstance(value, dict):
        fail("OUTPUT_GEOMETRY", "Invalid or excessively nested GeoJSON geometry.")
    kind = value.get("type")
    if kind not in GEOMETRIES.values():
        fail("OUTPUT_GEOMETRY", "Unsupported GeoJSON geometry type.")
    if depth == 0:
        stats["types"].add(kind)
    if kind == "GeometryCollection":
        members = value.get("geometries")
        if not isinstance(members, list):
            fail("OUTPUT_GEOMETRY", "GeometryCollection requires geometries.")
        for member in members:
            _geojson(stats, member, depth + 1)
        return
    levels = {"Point": 0, "MultiPoint": 1, "LineString": 1, "MultiLineString": 2,
              "Polygon": 2, "MultiPolygon": 3}[kind]
    def walk(values, level):
        if not isinstance(values, list):
            fail("OUTPUT_GEOMETRY", "GeoJSON coordinates require arrays.")
        if level == 0:
            if values:
                _point(stats, values)
        else:
            for item in values:
                walk(item, level - 1)
    walk(value.get("coordinates"), levels)


def _wkb(stats, value):
    data = memoryview(value)
    def read(index, depth=0):
        if depth > 128 or index + 5 > len(data) or data[index] not in (0, 1):
            fail("OUTPUT_WKB", "Invalid WKB geometry header.")
        endian = "<" if data[index] else ">"
        raw = struct.unpack_from(endian + "I", data, index + 1)[0]
        index += 5
        has_z, has_m = bool(raw & 0x80000000), bool(raw & 0x40000000)
        code = raw & 0x0FFFFFFF
        if raw & 0x20000000:
            if index + 4 > len(data):
                fail("OUTPUT_WKB", "Truncated WKB SRID.")
            stats["embedded_srids"].add(struct.unpack_from(endian + "I", data, index)[0])
            index += 4
        if code >= 1000:
            has_z = code // 1000 in (1, 3)
            has_m = code // 1000 in (2, 3)
            code %= 1000
        if code not in GEOMETRIES:
            fail("OUTPUT_WKB", "Unsupported WKB geometry type " + str(code))
        if depth == 0:
            stats["types"].add(GEOMETRIES[code] + (" Z" if has_z else "") + (" M" if has_m else ""))
        dimensions = 2 + int(has_z) + int(has_m)
        def integer(at):
            if at + 4 > len(data):
                fail("OUTPUT_WKB", "Truncated WKB member count.")
            return struct.unpack_from(endian + "I", data, at)[0], at + 4
        def position(at):
            end = at + dimensions * 8
            if end > len(data):
                fail("OUTPUT_WKB", "Truncated WKB coordinate.")
            point = struct.unpack_from(endian + "d" * dimensions, data, at)
            if math.isnan(point[0]) and math.isnan(point[1]):
                stats["empty_points"] += 1
            else:
                _point(stats, point)
            return end
        if code == 1:
            return position(index)
        amount, index = integer(index)
        if code == 2:
            for _ in range(amount):
                index = position(index)
        elif code == 3:
            for _ in range(amount):
                length, index = integer(index)
                for _ in range(length):
                    index = position(index)
        else:
            for _ in range(amount):
                index = read(index, depth + 1)
        return index
    if read(0) != len(data):
        fail("OUTPUT_WKB", "WKB has trailing bytes outside its complete geometry.")


def _wkt(stats, value):
    """Stream the standard simple-feature WKT geometry families and EWKT SRIDs."""
    if not isinstance(value, str):
        fail("OUTPUT_WKT", "A WKT geometry must retain its original source text.")
    value = value.rstrip()
    pattern = re.compile(r"\s*([A-Za-z_]+|[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?|[(),;=])")
    offset, token = 0, None
    def advance():
        nonlocal offset, token
        if offset >= len(value):
            token = None
            offset = len(value)
            return
        match = pattern.match(value, offset)
        if match is None:
            fail("OUTPUT_WKT", "Invalid token in the original WKT geometry.")
        token, offset = match.group(1), match.end()
    def take(expected=None):
        result = token
        if result is None or expected is not None and result.upper() != expected:
            fail("OUTPUT_WKT", "Unexpected structure in the original WKT geometry.")
        advance()
        return result
    advance()
    if token and token.upper() == "SRID":
        take("SRID"); take("=")
        raw = take()
        if not re.fullmatch(r"[0-9]+", raw):
            fail("OUTPUT_WKT", "An EWKT SRID must be a nonnegative integer.")
        stats["embedded_srids"].add(int(raw))
        take(";")
    def position(dimensions):
        coordinates = []
        while token is not None and token not in {",", ")", "("}:
            raw = take()
            if not re.fullmatch(r"[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?", raw):
                fail("OUTPUT_WKT", "A WKT position requires finite original numbers.")
            coordinates.append(ExactNumber(raw))
            if len(coordinates) > 4:
                fail("OUTPUT_WKT", "A simple-feature position has more than four dimensions.")
        if dimensions is not None and len(coordinates) != dimensions:
            fail("OUTPUT_WKT", "A WKT position differs from its declared Z/M dimensions.")
        _point(stats, coordinates)
    def sequence(callback):
        take("(")
        callback()
        while token == ",":
            take(","); callback()
        take(")")
    def empty():
        if token and token.upper() == "EMPTY":
            take("EMPTY")
            return True
        return False
    def geometry(depth=0, inherited=None):
        if depth > 128:
            fail("OUTPUT_WKT", "The original geometry nesting exceeds its reader budget.")
        name = take().upper()
        names = {item.upper(): item for item in GEOMETRIES.values()}
        declared = inherited
        if token and token.upper() in {"Z", "M", "ZM"}:
            declared = take().upper()
        if name not in names:
            fail("OUTPUT_WKT", "Unsupported original WKT geometry family.")
        kind = names[name]
        dimensions = {"Z": 3, "M": 3, "ZM": 4}.get(declared)
        if depth == 0:
            stats["types"].add(kind + (" Z" if declared in {"Z", "ZM"} else "") +
                               (" M" if declared in {"M", "ZM"} else ""))
        if empty():
            if kind == "Point":
                stats["empty_points"] += 1
            return
        def point():
            if empty():
                stats["empty_points"] += 1
            elif token == "(":
                take("("); position(dimensions); take(")")
            else:
                position(dimensions)
        def line():
            if not empty():
                sequence(lambda: position(dimensions))
        def polygon():
            if not empty():
                sequence(line)
        if kind == "Point":
            take("("); position(dimensions); take(")")
        elif kind == "LineString":
            sequence(lambda: position(dimensions))
        elif kind == "Polygon":
            sequence(line)
        elif kind == "MultiPoint":
            sequence(point)
        elif kind == "MultiLineString":
            sequence(line)
        elif kind == "MultiPolygon":
            sequence(polygon)
        else:
            sequence(lambda: geometry(depth + 1, declared))
    geometry()
    if token is not None:
        fail("OUTPUT_WKT", "WKT has trailing text outside its complete geometry.")


def _geoarrow(value, encoding):
    def point(item):
        if not isinstance(item, dict) or "x" not in item or "y" not in item:
            fail("OUTPUT_GEOARROW", "A native GeoArrow point needs x and y children.")
        return [item["x"], item["y"]] + ([item["z"]] if "z" in item else [])
    levels = {"point": 0, "linestring": 1, "polygon": 2, "multipoint": 1,
              "multilinestring": 2, "multipolygon": 3}
    def convert(item, depth):
        return point(item) if depth == 0 else [convert(child, depth - 1) for child in item]
    names = {"point": "Point", "linestring": "LineString", "polygon": "Polygon",
             "multipoint": "MultiPoint", "multilinestring": "MultiLineString", "multipolygon": "MultiPolygon"}
    return {"type": names[encoding], "coordinates": convert(value, levels[encoding])}


def _geometry_stats():
    return {"rows": 0, "null": 0, "missing": 0, "positions": 0, "empty_points": 0,
            "types": set(), "dimensions": set(), "minimum": None, "maximum": None,
            "mixed_dimensions": False, "embedded_srids": set(), "uninterpreted": 0}


def _geometry_observe(stats, value, metadata):
    stats["rows"] += 1
    if value is MISSING:
        stats["missing"] += 1
        return
    if value is None:
        stats["null"] += 1
        return
    encoding = metadata["encoding"]
    if encoding == "WKB":
        if not isinstance(value, bytes):
            fail("OUTPUT_WKB", "GeoParquet WKB must be retained binary geometry.")
        _wkb(stats, value)
    elif encoding == "GeoJSON" or encoding == "geojson":
        _geojson(stats, _parse(value) if isinstance(value, str) else value)
    elif encoding in {"point", "linestring", "polygon", "multipoint", "multilinestring", "multipolygon"}:
        _geojson(stats, _geoarrow(value, encoding))
    elif encoding in {"WKT", "wkt", "EWKT", "ewkt"}:
        _wkt(stats, value)
    elif encoding == "wkb-hex":
        _wkb(stats, bytes.fromhex(value))
    else:
        stats["uninterpreted"] += 1


def _geometry_result(stats):
    result = {key: value for key, value in stats.items() if key not in {"types", "dimensions", "minimum", "maximum", "embedded_srids"}}
    result.update(types=sorted(stats["types"]), dimensions=sorted(stats["dimensions"]),
                  embedded_srids=sorted(stats["embedded_srids"]))
    result["coordinate_envelope"] = ([str(value) for value in stats["minimum"] + stats["maximum"]]
                                    if stats["minimum"] is not None and not stats["mixed_dimensions"] else None)
    result["envelope_method"] = "coordinate min/max in the original CRS; no axis change or antimeridian wrapping"
    return result


def _path(row, name):
    if name in row:
        return row[name]
    parts = [part.replace("~1", "/").replace("~0", "~") for part in name[1:].split("/")] if name.startswith("/") else name.split(".")
    value = row
    for part in parts:
        if not isinstance(value, dict) or part not in value:
            return MISSING
        value = value[part]
    return value


def _partitions(relative, definition):
    if definition.get("partitioning") != "hive":
        return {}
    result = {}
    for part in PurePosixPath(relative).parts[:-1]:
        if "=" in part:
            name, value = part.split("=", 1)
            name = unquote(name)
            if name in result:
                fail("OUTPUT_PARTITION", "A Hive path repeats partition field " + repr(name))
            result[name] = unquote(value)
    return result


def _with_partitions(row, partitions):
    return {**partitions, **row}


def _kind(value):
    if value is None:
        return "null"
    if isinstance(value, ExactNumber):
        return "json-number"
    if isinstance(value, Decimal):
        return "decimal"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "float"
    if isinstance(value, bytes):
        return "binary"
    if isinstance(value, dict):
        return "object"
    if isinstance(value, (list, tuple)):
        return "array"
    if isinstance(value, (datetime, date, time)):
        return type(value).__name__
    return "string"


def _inspect_dataset(ws, supplied, temporary):
    dataset_id = supplied.get("dataset_id")
    if not isinstance(dataset_id, str) or not dataset_id:
        fail("OUTPUT_DATASET_ID", "Each complete dataset requires its original configured ID.")
    if supplied.get("complete") is not True:
        fail("OUTPUT_LISTING_INCOMPLETE", "Finish the original complete listing and object capture before creating an edition.")
    definition = supplied.get("definition")
    if not isinstance(definition, dict):
        fail("OUTPUT_DEFINITION", "Retain the reviewed output definition.")
    _format(definition)
    listing = supplied.get("listing_object")
    _object(ws, listing)
    source_objects = supplied.get("source_objects", [])
    if not isinstance(source_objects, list):
        fail("OUTPUT_SOURCE_OBJECTS", "Original listing pages require an ordered reference collection.")
    for reference in source_objects:
        _object(ws, reference)
    files = supplied.get("files")
    if not isinstance(files, list):
        fail("OUTPUT_FILES", "Retain the original complete output file collection.")
    keys = definition.get("primary_key") or []
    if isinstance(keys, str):
        keys = [keys]
    if (not isinstance(keys, list) or any(not isinstance(key, str) or not key for key in keys) or
        len(set(keys)) != len(keys)):
        fail("OUTPUT_KEYS", "Reviewed primary keys must be distinct source field paths.")
    index_path = Path(temporary) / (hashlib.sha256(dataset_id.encode()).hexdigest() + ".sqlite")
    connection = sqlite3.connect(index_path)
    connection.execute("PRAGMA journal_mode=OFF")
    connection.execute("PRAGMA cache_size=-2048")
    connection.execute("PRAGMA temp_store=FILE")
    connection.execute("CREATE TABLE rows(seq INTEGER PRIMARY KEY, key_sha TEXT UNIQUE, key_json TEXT, row_sha TEXT NOT NULL, part INTEGER NOT NULL, part_row INTEGER NOT NULL, byte_start INTEGER, byte_end INTEGER)")
    connection.execute("CREATE INDEX rows_value ON rows(row_sha)")
    seen = set()
    parts = []
    schema = {}
    geometry = {}
    content = hashlib.sha256()
    total = 0
    try:
        for supplied_file in files:
            item = dict(supplied_file)
            relative = _relative(item.get("relative_path"))
            if relative in seen:
                fail("OUTPUT_DUPLICATE_PART", "The original listing repeats " + relative)
            seen.add(relative)
            path = _object(ws, item.get("object"))
            part = {**item, "relative_path": relative, "role": "auxiliary" if _auxiliary(relative, item) else "data",
                    "row_count": 0}
            parts.append(part)
            if part["role"] == "auxiliary":
                continue
            info, stream = _part(path, definition)
            partitions = _partitions(relative, definition)
            part["partitions"] = partitions
            part["inspection"] = info
            geometries = info.setdefault("geometry", _geometry_metadata(None, definition))
            local_geometry = {name: _geometry_stats() for name in geometries}
            for part_row, source_row, start, end in stream:
                row = _with_partitions(source_row, partitions)
                row_hash = _digest(_typed(row))
                values = [_path(row, key) for key in keys]
                if any(value is MISSING or value is None for value in values):
                    fail("OUTPUT_PRIMARY_KEY", "A retained row lacks a complete non-null reviewed key.")
                key_sha = _digest(_typed(values)) if keys else None
                key_json = json.dumps(_view(values), ensure_ascii=False, separators=(",", ":")) if keys else None
                try:
                    connection.execute("INSERT INTO rows VALUES(?,?,?,?,?,?,?,?)",
                                       (total, key_sha, key_json, row_hash, len(parts) - 1, part_row, start, end))
                except sqlite3.IntegrityError as error:
                    raise OutputError("OUTPUT_DUPLICATE_KEY", "The reviewed source key identifies more than one retained row.") from error
                content.update(bytes.fromhex(row_hash))
                for name, value in row.items():
                    stat = schema.setdefault(name, {"name": name, "present": 0, "null": 0, "types": set()})
                    stat["present"] += 1
                    stat["null"] += value is None
                    stat["types"].add(_kind(value))
                for name, metadata in geometries.items():
                    _geometry_observe(local_geometry[name], _path(row, name), metadata)
                total += 1
                part["row_count"] += 1
                if total % 4096 == 0:
                    connection.commit()
            for field in info.get("columns", []):
                name = field if isinstance(field, str) else field["name"]
                stat = schema.setdefault(name, {"name": name, "present": 0, "null": 0, "types": set()})
                stat.setdefault("source_types", set()).add("string" if isinstance(field, str) else field["type"])
                stat.setdefault("source_nullable", set()).add(False if isinstance(field, str) else field["nullable"])
            if "metadata_rows" in info and info["metadata_rows"] != part["row_count"]:
                fail("OUTPUT_PARQUET_COUNT", "The full native Parquet decode differs from the retained footer row count.")
            for name, stats in local_geometry.items():
                result = {"metadata": geometries[name], **_geometry_result(stats), "part": relative}
                geometry.setdefault(name, []).append(result)
            part["geometry"] = {name: _geometry_result(stats) for name, stats in local_geometry.items()}
        connection.commit()
    finally:
        connection.close()
    index_object = ws.put_object(index_path)
    columns = [{**{key: value for key, value in stat.items() if key not in {"types", "source_types", "source_nullable"}},
                "types": sorted(stat["types"]), "missing": total - stat["present"],
                "source_types": sorted(stat.get("source_types", [])),
                "source_nullable": sorted(stat.get("source_nullable", []))}
               for stat in schema.values()]
    return {"id": dataset_id, "dataset_id": dataset_id, "definition": definition,
            "listing_object": listing, "source_objects": source_objects, "complete": True, "files": parts,
            "row_count": total, "columns": columns, "geometry": geometry,
            "primary_key": keys, "content_sha256": content.hexdigest(),
            "row_index_object": index_object, "row_index_schema": "wherobots-row-index.v1",
            "preview_encoding": "tagged exact JSON numbers, decimals, large integers, binary and temporal ticks"}


def _record_body(record):
    return {key: value for key, value in record.items() if key != "revision_sha256"}


def create_edition(workspace, operation_id, datasets):
    operation = workspace.get_record("operation", operation_id)
    if operation.get("id") != operation_id or not operation.get("workflow_id"):
        fail("OUTPUT_OPERATION", "Use the original retained operation and workflow identity.")
    if not isinstance(datasets, list) or not datasets:
        fail("OUTPUT_DATASETS", "Capture the complete reviewed dataset collection.")
    if any(not isinstance(item, dict) for item in datasets):
        fail("OUTPUT_DATASETS", "Each output must retain its reviewed dataset descriptor.")
    ids = [item.get("dataset_id") for item in datasets]
    if any(not isinstance(value, str) or not value for value in ids) or len(ids) != len(set(ids)):
        fail("OUTPUT_DATASET_ID", "The output collection repeats a dataset ID.")
    reviewed = operation.get("reviewed_definition", {}).get("outputs", [])
    expected = {item["id"]: item for item in reviewed}
    if set(ids) != set(expected) or any(_canonical(item["definition"]) != _canonical(expected[item["dataset_id"]]) for item in datasets):
        fail("OUTPUT_DEFINITION_CHANGED", "Capture every output using its exact reviewed definition.")
    binding = {"schema": EDITION_SCHEMA, "operation_id": operation_id,
               "workflow_id": operation["workflow_id"], "native_run_id": operation.get("native_run_id"),
               "review_sha256": operation.get("review_sha256"),
               "reviewed_definition": operation.get("reviewed_definition"), "datasets": datasets}
    identity = _digest(binding)
    edition_id = "edition-" + identity
    for existing in workspace.records("edition"):
        if existing.get("id") == edition_id:
            if existing.get("source_binding_sha256") != identity:
                fail("OUTPUT_EDITION_CHANGED", "The retained original edition binding differs.")
            return existing
    with tempfile.TemporaryDirectory(prefix="edition-", dir=private_directory(workspace.directory / "temporary", create=True)) as temporary:
        inspected = [_inspect_dataset(workspace, item, temporary) for item in datasets]
    body = {"schema": EDITION_SCHEMA, "id": edition_id, "workflow_id": operation["workflow_id"],
            "operation_id": operation_id, "native_run_id": operation.get("native_run_id"),
            "native_status": operation.get("native_status"), "review_sha256": operation.get("review_sha256"),
            "operation_revision_sha256": operation["revision_sha256"],
            "source_binding_sha256": identity, "created_at": now(), "datasets": inspected,
            "comparisons": []}
    return workspace.save_record("edition", edition_id, body)


def _dataset(ws, edition_id, dataset_id):
    edition = ws.get_record("edition", edition_id)
    if edition.get("schema") != EDITION_SCHEMA:
        fail("OUTPUT_EDITION", "Use an original Wherobots output edition.")
    dataset = next((item for item in edition["datasets"] if item["id"] == dataset_id), None)
    if dataset is None:
        fail("OUTPUT_DATASET", "That dataset is not part of this retained edition.")
    return edition, dataset


def _index(ws, dataset):
    path = _object(ws, dataset["row_index_object"])
    connection = sqlite3.connect(path.as_uri() + "?mode=ro&immutable=1", uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def _read_locations(ws, dataset, locations):
    result = {}
    grouped = {}
    for location in locations:
        grouped.setdefault(location["part"], []).append(location)
    for part_number, group in grouped.items():
        part = dataset["files"][part_number]
        path = _object(ws, part["object"])
        fmt = _format(dataset["definition"])
        if fmt in {"csv", "ndjson", "geojson-seq"}:
            with open(path, "rb") as stream:
                for location in group:
                    stream.seek(location["byte_start"])
                    raw = stream.read(location["byte_end"] - location["byte_start"])
                    if fmt == "csv":
                        _, dialect, encoding, _ = _csv_options(dataset["definition"])
                        values = next(csv.reader(io.StringIO(raw.decode("utf-8-sig" if location["byte_start"] == 0 else encoding), newline=""), **dialect))
                        row = dict(zip(part["inspection"]["columns"], values))
                    else:
                        row = _json_row(raw, fmt == "geojson-seq")
                    result[location["seq"]] = _with_partitions(row, part.get("partitions", {}))
        else:
            wanted = {location["part_row"]: location["seq"] for location in group}
            _, stream = _part(path, dataset["definition"], min(wanted))
            try:
                for part_row, row, _, _ in stream:
                    if part_row in wanted:
                        result[wanted[part_row]] = _with_partitions(row, part.get("partitions", {}))
                    if part_row >= max(wanted):
                        break
            finally:
                stream.close()
    return result


def edition_rows(workspace, edition_id, dataset_id, offset=0, limit=100):
    if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 10000:
        fail("OUTPUT_PAGE", "Use a nonnegative offset and a limit from 1 to 10000.")
    edition, dataset = _dataset(workspace, edition_id, dataset_id)
    connection = _index(workspace, dataset)
    try:
        locations = list(connection.execute("SELECT * FROM rows WHERE seq>=? ORDER BY seq LIMIT ?", (offset, limit)))
    finally:
        connection.close()
    original = _read_locations(workspace, dataset, locations)
    rows = []
    for location in locations:
        row = original.get(location["seq"])
        if row is None or _digest(_typed(row)) != location["row_sha"]:
            fail("OUTPUT_ROW_CHANGED", "A retained indexed row differs from its original edition.")
        rows.append(_view(row))
    next_offset = offset + len(rows)
    return {"edition_id": edition_id, "dataset_id": dataset_id, "native_run_id": edition.get("native_run_id"),
            "source_binding_sha256": edition["source_binding_sha256"],
            "offset": offset, "limit": limit, "total": dataset["row_count"], "rows": rows,
            "next_offset": next_offset if next_offset < dataset["row_count"] else None,
            "columns": dataset["columns"], "preview_encoding": dataset["preview_encoding"]}


def iter_edition_rows(workspace, dataset):
    for part in dataset["files"]:
        if part["role"] != "data":
            continue
        path = _object(workspace, part["object"])
        _, stream = _part(path, dataset["definition"])
        try:
            for _, row, _, _ in stream:
                yield _with_partitions(row, part.get("partitions", {}))
        finally:
            stream.close()


def _schema_definition(dataset):
    return [{**{key: column.get(key) for key in ("name", "source_types", "source_nullable")},
             **({"types": column.get("types")} if not column.get("source_types") else {})}
            for column in dataset["columns"]]


def compare_editions(workspace, left_id, right_id):
    left = workspace.get_record("edition", left_id)
    right = workspace.get_record("edition", right_id)
    if left.get("schema") != EDITION_SCHEMA or right.get("schema") != EDITION_SCHEMA or left["workflow_id"] != right["workflow_id"]:
        fail("OUTPUT_COMPARISON", "Compare original output editions belonging to the same workflow.")
    identity = _digest({"schema": COMPARISON_SCHEMA, "left": left["source_binding_sha256"],
                        "right": right["source_binding_sha256"]})
    for original in right.get("comparisons", []):
        if original["id"] == identity:
            return original
    before = {item["id"]: item for item in left["datasets"]}
    after = {item["id"]: item for item in right["datasets"]}
    totals = []
    preview = []
    with tempfile.TemporaryDirectory(prefix="compare-", dir=private_directory(workspace.directory / "temporary", create=True)) as temporary:
        changes_path = Path(temporary) / "changes.ndjson"
        with open(changes_path, "wb") as output:
            def emit(change):
                output.write(_canonical(change) + b"\n")
                if len(preview) < 100:
                    preview.append(change)
            for name in sorted(set(before) | set(after)):
                a, b = before.get(name), after.get(name)
                summary = {"dataset_id": name, "before_rows": a["row_count"] if a else 0,
                           "after_rows": b["row_count"] if b else 0, "added": 0, "removed": 0,
                           "changed": 0, "unchanged": 0, "schema_changed": a is None or b is None or
                           _digest(_schema_definition(a)) != _digest(_schema_definition(b)),
                           "geometry_changed": a is None or b is None or _digest(a["geometry"]) != _digest(b["geometry"])}
                if a is None or b is None:
                    kind = "added" if a is None else "removed"
                    summary[kind] = (b or a)["row_count"]
                    summary["identity"] = "dataset"
                    emit({"dataset_id": name, "kind": kind + "-dataset", "rows": summary[kind]})
                    totals.append(summary)
                    continue
                keyed = bool(a["primary_key"]) and a["primary_key"] == b["primary_key"]
                summary["identity"] = "reviewed-primary-key" if keyed else "exact-row-multiset"
                connection = _index(workspace, a)
                connection.execute("ATTACH DATABASE ? AS corrected", (_object(workspace, b["row_index_object"]).as_uri() + "?mode=ro&immutable=1",))
                try:
                    if keyed:
                        query = """SELECT 'removed' kind,l.key_json key_json,l.seq before_row,NULL after_row FROM rows l LEFT JOIN corrected.rows r ON l.key_sha=r.key_sha WHERE r.seq IS NULL
                                   UNION ALL SELECT 'added',r.key_json,NULL,r.seq FROM corrected.rows r LEFT JOIN rows l ON r.key_sha=l.key_sha WHERE l.seq IS NULL
                                   UNION ALL SELECT 'changed',r.key_json,l.seq,r.seq FROM rows l JOIN corrected.rows r ON l.key_sha=r.key_sha WHERE l.row_sha<>r.row_sha"""
                        for row in connection.execute(query):
                            summary[row["kind"]] += 1
                            emit({"dataset_id": name, "kind": row["kind"], "key": json.loads(row["key_json"]),
                                  "before_row": row["before_row"], "after_row": row["after_row"]})
                        summary["unchanged"] = summary["before_rows"] - summary["removed"] - summary["changed"]
                    else:
                        query = """WITH counts AS (SELECT row_sha,COUNT(*) a,0 b FROM rows GROUP BY row_sha
                                   UNION ALL SELECT row_sha,0,COUNT(*) FROM corrected.rows GROUP BY row_sha)
                                   SELECT row_sha,SUM(a) a,SUM(b) b FROM counts GROUP BY row_sha"""
                        for row in connection.execute(query):
                            common = min(row["a"], row["b"])
                            summary["unchanged"] += common
                            for kind, amount in (("removed", row["a"] - common), ("added", row["b"] - common)):
                                if amount:
                                    summary[kind] += amount
                                    emit({"dataset_id": name, "kind": kind, "row_sha256": row["row_sha"], "count": amount})
                finally:
                    connection.close()
                totals.append(summary)
        changes_object = workspace.put_object(changes_path)
    report = {"schema": COMPARISON_SCHEMA, "id": identity, "workflow_id": right["workflow_id"],
              "left_edition_id": left_id, "right_edition_id": right_id,
              "left_source_binding_sha256": left["source_binding_sha256"],
              "right_source_binding_sha256": right["source_binding_sha256"],
              "datasets": totals, "changes_object": changes_object, "preview": preview}
    report_object = workspace.put_object(_canonical(report) + b"\n")
    receipt = {**report, "report_object": report_object}
    current = workspace.get_record("edition", right_id)
    existing = next((item for item in current.get("comparisons", []) if item["id"] == identity), None)
    if existing:
        return existing
    body = _record_body(current)
    body["comparisons"] = [*body.get("comparisons", []), receipt]
    workspace.save_record("edition", right_id, body, expected_revision=current["revision_sha256"])
    return receipt
