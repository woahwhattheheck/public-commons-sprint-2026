"""Shared file contracts for retained native vector receiving. MIT."""
from __future__ import annotations
import base64
import contextlib
from decimal import Decimal
import hashlib
import json
import math
import os
import re
import shutil
import sqlite3
import stat
import tempfile
import uuid
from pathlib import Path

HASH = re.compile(r"^[a-f0-9]{64}$")
ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$")
CAPTURE = "starforge.vector-capture.v1"
EXPORT = "starforge.vector-export.v1"
SELECTION = "starforge.vector-selection.v1"
PROFILE = "starforge.vector-export-profile.v1"
MAX_DOCUMENT = 256 * 1024 * 1024

class VectorError(ValueError):
    def __init__(self, code, detail=None):
        self.code, self.detail = code, detail
        super().__init__(code + (": " + str(detail) if detail is not None else ""))

def need(condition, code, detail=None):
    if not condition:
        raise VectorError(code, detail)

def _default(value):
    if isinstance(value, bytes):
        return {"$vector_binary": base64.b64encode(value).decode("ascii")}
    raise TypeError(type(value).__name__)

def number_decimal(value):
    """Exact numeric comparison against the decimal spelling a native float exposes."""
    need(type(value) in (int, float) or isinstance(value, Decimal),
         "VECTOR_NUMBER_REQUIRED")
    if isinstance(value, Decimal):
        need(value.is_finite(), "VECTOR_NONFINITE_JSON")
        return value
    if type(value) is float:
        need(math.isfinite(value), "VECTOR_NONFINITE_JSON")
        return Decimal(str(value))
    return Decimal(value)

def decimal_json(value):
    """Serialize a finite JSON number without applying the Decimal context."""
    need(value.is_finite(), "VECTOR_NONFINITE_JSON")
    # Preserve earlier native-float spellings only when this conversion is exact.
    try:
        native = float(value)
        if math.isfinite(native) and Decimal(str(native)) == value:
            return json.dumps(native, allow_nan=False)
    except (OverflowError, ValueError):
        pass
    sign, digits, exponent = value.as_tuple()
    digits = list(digits)
    while len(digits) > 1 and digits[-1] == 0:
        digits.pop()
        exponent += 1
    coefficient = "".join(str(digit) for digit in digits)
    prefix = "-" if sign else ""
    if not any(digits):
        return prefix + "0.0"
    adjusted = len(digits) + exponent - 1
    if -6 <= adjusted <= 20:
        point = len(digits) + exponent
        if point <= 0:
            text = "0." + "0" * -point + coefficient
        elif point >= len(digits):
            text = coefficient + "0" * (point - len(digits)) + ".0"
        else:
            text = coefficient[:point] + "." + coefficient[point:]
        return prefix + text
    mantissa = coefficient[0] + ("." + coefficient[1:] if len(coefficient) > 1 else "")
    return prefix + mantissa + "e" + ("+" if adjusted >= 0 else "") + str(adjusted)

def canonical(value):
    if value is None:
        return "null"
    if type(value) is bool:
        return "true" if value else "false"
    if type(value) is int:
        return str(value)
    if isinstance(value, Decimal):
        return decimal_json(value)
    if type(value) is float:
        need(math.isfinite(value), "VECTOR_NONFINITE_JSON")
        return json.dumps(value, allow_nan=False)
    if type(value) is str:
        return json.dumps(value, ensure_ascii=False)
    if type(value) is bytes:
        return canonical(_default(value))
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(canonical(item) for item in value) + "]"
    if isinstance(value, dict):
        need(all(isinstance(key, str) for key in value), "VECTOR_JSON_KEY_INVALID")
        return "{" + ",".join(canonical(key) + ":" + canonical(value[key])
                              for key in sorted(value)) + "}"
    raise TypeError(type(value).__name__)

def json_bytes(value):
    return (canonical(value) + "\n").encode("utf-8")

def digest(value):
    return hashlib.sha256(value if isinstance(value, bytes) else json_bytes(value)).hexdigest()

def strict_object(pairs):
    result = {}
    for key, value in pairs:
        need(key not in result, "VECTOR_DUPLICATE_JSON_KEY", key)
        result[key] = value
    return result

def parse_json(raw):
    return json.loads(raw, object_pairs_hook=strict_object, parse_float=Decimal,
                      parse_constant=lambda value: (_ for _ in ()).throw(
                          VectorError("VECTOR_NONFINITE_JSON", value)))

def read_json(path, limit=MAX_DOCUMENT):
    path = Path(path)
    need(path.stat().st_size <= limit, "VECTOR_DOCUMENT_TOO_LARGE", str(path))
    raw = path.read_bytes()
    need(len(raw) <= limit, "VECTOR_DOCUMENT_TOO_LARGE", str(path))
    return parse_json(raw)

def private_directory(path):
    path = Path(path).absolute()
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    need(path.is_dir() and not path.is_symlink(), "VECTOR_DIRECTORY_REQUIRED", str(path))
    return path

def member(root, relative):
    need(isinstance(relative, str) and relative and "\\" not in relative and "\0" not in relative,
         "VECTOR_MEMBER_PATH_INVALID", relative)
    value = Path(relative)
    need(not value.is_absolute() and all(part not in ("", ".", "..") for part in value.parts),
         "VECTOR_MEMBER_PATH_INVALID", relative)
    root = Path(root).resolve()
    target = root.joinpath(*value.parts)
    need(target.resolve().is_relative_to(root), "VECTOR_MEMBER_ESCAPES_ROOT", relative)
    return target

def file_record(path, relative=None):
    path = Path(path)
    need(path.is_file() and not path.is_symlink(), "VECTOR_REGULAR_FILE_REQUIRED", str(path))
    h, count = hashlib.sha256(), 0
    with path.open("rb") as stream:
        for part in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(part)
            count += len(part)
    return {"path": relative if relative is not None else path.name,
            "bytes": count, "sha256": h.hexdigest()}

def descriptor(value):
    need(isinstance(value, dict), "VECTOR_FILE_DESCRIPTOR_REQUIRED")
    need(isinstance(value.get("path"), str) and value["path"], "VECTOR_FILE_PATH_REQUIRED")
    need(type(value.get("bytes")) is int and value["bytes"] >= 0, "VECTOR_FILE_SIZE_INVALID")
    need(isinstance(value.get("sha256"), str) and HASH.fullmatch(value["sha256"]),
         "VECTOR_FILE_HASH_INVALID")
    return {name: value[name] for name in ("path", "bytes", "sha256")}

def verify_file(root, expected):
    expected = descriptor(expected)
    actual = file_record(member(root, expected["path"]), expected["path"])
    need(actual == expected, "VECTOR_FILE_CHANGED", {"expected": expected, "actual": actual})
    return actual

def fsync_directory(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def atomic_bytes(path, raw):
    path = Path(path)
    private_directory(path.parent)
    temporary = path.with_name("." + path.name + "." + uuid.uuid4().hex + ".receiving")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(raw)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        fsync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)

def atomic_json(path, value):
    atomic_bytes(path, json_bytes(value))

def copy_verified(source, target, expected):
    source, target = Path(source), Path(target)
    expected = descriptor(expected)
    if target.exists():
        actual = file_record(target, expected["path"])
        need(actual == expected, "VECTOR_RECEIVING_FILE_CHANGED", actual)
        return actual
    need(source.is_file() and not source.is_symlink(), "VECTOR_SOURCE_FILE_REQUIRED", str(source))
    private_directory(target.parent)
    temporary = target.with_name("." + target.name + "." + uuid.uuid4().hex + ".receiving")
    h, size = hashlib.sha256(), 0
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with source.open("rb") as inp, os.fdopen(fd, "wb") as out:
            for part in iter(lambda: inp.read(1024 * 1024), b""):
                out.write(part)
                h.update(part)
                size += len(part)
            out.flush()
            os.fsync(out.fileno())
        actual = {"path": expected["path"], "bytes": size, "sha256": h.hexdigest()}
        need(actual == expected, "VECTOR_SOURCE_CHANGED_WHILE_READING",
             {"expected": expected, "actual": actual})
        os.replace(temporary, target)
        fsync_directory(target.parent)
        return actual
    finally:
        temporary.unlink(missing_ok=True)

@contextlib.contextmanager
def claim(directory, request):
    """One original request owns a destination; flock releases after process exit."""
    import fcntl
    root = private_directory(directory)
    request_path = root / "request.json"
    if not request_path.exists():
        need(not any(p.name != ".vector.lock" for p in root.iterdir()),
             "VECTOR_DESTINATION_ALREADY_USED", str(root))
    with (root / ".vector.lock").open("a+b") as lock:
        os.chmod(root / ".vector.lock", 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX)
        if request_path.exists():
            original = read_json(request_path)
            need(canonical(original) == canonical(request), "VECTOR_ORIGINAL_REQUEST_CONFLICT",
                 {"directory": str(root), "originalRequestSha256": digest(original),
                  "requestedSha256": digest(request)})
        else:
            atomic_json(request_path, request)
        os.chmod(root, 0o700)
        yield root

def connect_catalog(path):
    connection = sqlite3.connect(str(path))
    connection.row_factory = sqlite3.Row
    return connection

def read_catalog(path):
    connection = sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    return connection

def all_files(root, excluded=()):
    root = Path(root)
    records = []
    for path in sorted(root.rglob("*")):
        if path.is_file():
            relative = path.relative_to(root).as_posix()
            if relative not in excluded and not any(part.startswith(".") for part in path.relative_to(root).parts):
                records.append(file_record(path, relative))
    return records

def verify_manifest(directory, name, schema, expected_sha256=None):
    root = Path(directory).resolve()
    manifest_file = file_record(root / name, name)
    if expected_sha256 is not None:
        need(manifest_file["sha256"] == expected_sha256, "VECTOR_MANIFEST_CHANGED")
    value = read_json(root / name)
    need(value.get("schema") == schema and isinstance(value.get("files"), list),
         "VECTOR_MANIFEST_INVALID", name)
    seen = set()
    for record in value["files"]:
        need(record["path"] not in seen and record["path"] != name, "VECTOR_DUPLICATE_MEMBER")
        seen.add(record["path"])
        verify_file(root, record)
    return value, manifest_file

def clone_capture(source, target, expected_sha256=None):
    capture, manifest_file = verify_manifest(source, "capture.json", CAPTURE, expected_sha256)
    target = private_directory(target)
    for item in capture["files"] + [manifest_file]:
        copy_verified(member(source, item["path"]), member(target, item["path"]), item)
    return capture, manifest_file

def value_kind(value):
    if value is None: return "null"
    if type(value) is bool: return "boolean"
    if type(value) is int: return "integer"
    if type(value) is float or isinstance(value, Decimal):
        number_decimal(value)
        return "number"
    if type(value) is str: return "string"
    if type(value) is bytes: return "binary"
    if isinstance(value, (list, tuple)): return "array"
    if isinstance(value, dict): return "object"
    raise VectorError("VECTOR_PROPERTY_TYPE_UNSUPPORTED", type(value).__name__)

def encoded_value(value):
    if type(value) is bytes:
        return {"$vector_binary": base64.b64encode(value).decode("ascii")}
    if isinstance(value, dict):
        return {key: encoded_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [encoded_value(item) for item in value]
    return value

def canonical_geometry(geometry):
    """Preserve every ordinate; account only for native polygon ring orientation."""
    if geometry is None:
        return None
    kind = geometry.get("type")
    if kind == "GeometryCollection":
        return {"type": kind, "geometries": [canonical_geometry(g) for g in geometry.get("geometries", [])]}
    coordinates = geometry.get("coordinates")
    def normalized(value):
        if isinstance(value, (list, tuple)):
            return [normalized(v) for v in value]
        need(type(value) in (int, float) or isinstance(value, Decimal), "VECTOR_COORDINATE_INVALID")
        number = number_decimal(value)
        return 0 if number == 0 else number
    coordinates = normalized(coordinates)
    def ring(value):
        if not value: return value
        need(value[0] == value[-1], "VECTOR_RING_NOT_CLOSED")
        points = value[:-1]
        if not points: return value
        candidates = []
        for direction in (points, list(reversed(points))):
            smallest = min(direction)
            for i, point in enumerate(direction):
                if point == smallest:
                    rotated = direction[i:] + direction[:i]
                    candidates.append(rotated)
        chosen = min(candidates)
        return chosen + [chosen[0]]
    def polygon(value):
        if not value: return value
        return [ring(value[0])] + sorted([ring(item) for item in value[1:]])
    if kind == "Polygon":
        return {"type": "MultiPolygon", "coordinates": [polygon(coordinates)]}
    if kind == "MultiPolygon":
        return {"type": kind, "coordinates": sorted([polygon(value) for value in coordinates])}
    if kind == "LineString":
        return {"type": "MultiLineString", "coordinates": [coordinates]}
    need(kind in ("Point", "MultiPoint", "MultiLineString"), "VECTOR_GEOMETRY_TYPE_UNSUPPORTED", kind)
    return {"type": kind, "coordinates": coordinates}

def geometry_equal(left, right):
    # Python numeric equality preserves exact integral values; no tolerance is introduced.
    return canonical_geometry(left) == canonical_geometry(right)

def safe_name(value, limit=50):
    result = re.sub(r"[^A-Za-z0-9_]+", "_", str(value)).strip("_") or "layer"
    if not result[0].isalpha():
        result = "l_" + result
    if len(result) > limit:
        result = result[:limit - 9] + "_" + hashlib.sha256(str(value).encode()).hexdigest()[:8]
    return result

def require_id(value, label="id"):
    need(isinstance(value, str) and ID.fullmatch(value), "VECTOR_ID_INVALID", label)
    return value
