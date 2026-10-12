"""MIT. Lossless JSON Lines inventory and projection into the original SF30 dataset ABI."""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
import json
import math
import re
from typing import BinaryIO, Callable, Any

from xml_source import InputError, MAX_SOURCE

SCHEMA = "stellar-forge.ndjson-mapping.v1"
MAX_RECORD = 16 * 1024 * 1024
MAX_DEPTH = 64
MAX_PATHS = 4096
NAME = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,47}\Z")
INT = re.compile(r"-?(0|[1-9][0-9]*)\Z")
NUMBER = re.compile(r"-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?\Z")
MISSING = object()


class JsonNumber(str):
    """Keep the source JSON numeric token, including exponent and trailing zeros."""


def utf16_length(value: str) -> int:
    try:
        return len(value.encode("utf-16-le")) // 2
    except UnicodeError as error:
        raise InputError("JSON strings must contain valid Unicode scalar values") from error


def exact_json(value: Any) -> str:
    """Serialize parsed JSON while retaining every original numeric lexeme."""
    if isinstance(value, JsonNumber):
        return str(value)
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ",".join(exact_json(item) for item in value) + "]"
    if isinstance(value, dict):
        return "{" + ",".join(json.dumps(key, ensure_ascii=False) + ":" + exact_json(item)
                              for key, item in value.items()) + "}"
    raise InputError("Expected an original JSON value")


def _pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            raise InputError(f"Duplicate JSON member: {key[:80]}")
        result[key] = value
    return result


def _constant(_):
    raise InputError("Non-finite JSON numbers are not accepted")


def _validate_tree(value, depth=0):
    if depth > MAX_DEPTH:
        raise InputError("JSON exceeds 64 levels of nesting")
    if isinstance(value, str):
        utf16_length(value)
    elif isinstance(value, dict):
        for key, item in value.items():
            utf16_length(key)
            _validate_tree(item, depth + 1)
    elif isinstance(value, list):
        for item in value:
            _validate_tree(item, depth + 1)


def records(stream: BinaryIO, stats: dict | None = None):
    """Read one physical record at a time; blank lines are counted and retained."""
    stats = stats if stats is not None else {}
    stats.update(bytes=0, physicalLines=0, records=0, blankLines=0, utf8Bom=False, maxRecordBytes=0)
    while raw := stream.readline(MAX_RECORD + 1):
        stats["bytes"] += len(raw)
        stats["physicalLines"] += 1
        line = stats["physicalLines"]
        if stats["bytes"] > MAX_SOURCE:
            raise InputError("NDJSON source exceeds 256 MiB")
        if len(raw) > MAX_RECORD:
            raise InputError(f"Line {line}: record exceeds 16 MiB")
        stats["maxRecordBytes"] = max(stats["maxRecordBytes"], len(raw))
        if line == 1 and raw.startswith(b"\xef\xbb\xbf"):
            stats["utf8Bom"] = True
            raw = raw[3:]
        try:
            text = raw.decode("utf-8", errors="strict")
            if not text.strip():
                stats["blankLines"] += 1
                continue
            value = json.loads(text, parse_int=JsonNumber, parse_float=JsonNumber,
                               parse_constant=_constant, object_pairs_hook=_pairs)
            if not isinstance(value, dict):
                raise InputError("Each nonblank line must contain one JSON object")
            _validate_tree(value)
        except (UnicodeError, json.JSONDecodeError, RecursionError) as error:
            detail = f"column {error.colno}: {error.msg}" if isinstance(error, json.JSONDecodeError) else str(error)
            raise InputError(f"Line {line}: invalid UTF-8 JSON object ({detail})") from error
        except InputError as error:
            raise InputError(f"Line {line}: {error}") from error
        stats["records"] += 1
        yield line, value


def kind(value):
    if isinstance(value, JsonNumber):
        return "integer" if INT.fullmatch(value) else "number"
    if value is None:
        return "null"
    if type(value) is bool:
        return "boolean"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    return "object"


def inventory(stream: BinaryIO) -> dict:
    stats, paths = {}, {}
    metadata_bytes = 0

    def visit(value, path, seen):
        nonlocal metadata_bytes
        if path not in paths:
            if len(paths) >= MAX_PATHS:
                raise InputError("Source has more than 4096 distinct field paths; use a narrower export")
            metadata_bytes += len(json.dumps(path, ensure_ascii=False).encode("utf-8")) + 256
            paths[path] = {"path": list(path), "occurrences": 0, "records": 0, "types": {}, "samples": []}
        item = paths[path]
        item["occurrences"] += 1
        if path not in seen:
            item["records"] += 1
            seen.add(path)
        value_kind = kind(value)
        item["types"][value_kind] = item["types"].get(value_kind, 0) + 1
        if isinstance(value, dict):
            for key, child in value.items():
                visit(child, path + (key,), seen)
        elif isinstance(value, list):
            for child in value:
                visit(child, path + (None,), seen)
        elif len(item["samples"]) < 3:
            sample = {"type": value_kind, "json": exact_json(value)[:180]}
            if sample not in item["samples"]:
                item["samples"].append(sample)
                metadata_bytes += len(json.dumps(sample, ensure_ascii=False).encode("utf-8"))
        if metadata_bytes > 8 * 1024 * 1024:
            raise InputError("Source field inventory exceeds 8 MiB; use a narrower export")

    for _, value in records(stream, stats):
        visit(value, (), set())
    return {"schema": "stellar-forge.ndjson-inventory.v1", **stats,
            "arrayPathMarker": "A null path segment describes all array elements; mappings use a concrete integer index.",
            "paths": list(paths.values())}


def exact_keys(value, allowed, label):
    if not isinstance(value, dict) or set(value) - allowed:
        raise InputError(f"Invalid {label} fields")
    return value


def integer(value, low, high, label):
    if type(value) is not int or not low <= value <= high:
        raise InputError(f"{label} must be an integer from {low} to {high}")
    return value


def path_array(value, label):
    if not isinstance(value, list) or len(value) > MAX_DEPTH:
        raise InputError(f"{label} must be an array of exact object keys and array indexes")
    for segment in value:
        if isinstance(segment, str):
            if utf16_length(segment) > 2048:
                raise InputError(f"{label} contains a key longer than 2048 characters")
        elif type(segment) is not int or not 0 <= segment <= 1000000:
            raise InputError(f"{label} contains an invalid array index")
    return list(value)


def validate_plan(raw: dict) -> dict:
    exact_keys(raw, {"schema", "name", "recordPath", "columns", "filters", "ranges", "sorts",
                     "keys", "defaultLimit", "maxLimit", "maxBytes", "maxRows", "maxCellChars",
                     "allowEmpty"}, "NDJSON mapping")
    if raw.get("schema") != SCHEMA:
        raise InputError(f"Mapping schema must be {SCHEMA}")
    name = raw.get("name")
    if not isinstance(name, str) or not name.strip() or utf16_length(name) > 128 or re.search(r"[\x00-\x1f\x7f]", name):
        raise InputError("Dataset name must be printable text, 1–128 UTF-16 code units")
    columns = raw.get("columns")
    if not isinstance(columns, list) or not 1 <= len(columns) <= 64:
        raise InputError("Choose 1–64 exposed columns")
    result = {"schema": SCHEMA, "name": name, "recordPath": path_array(raw.get("recordPath", []), "recordPath"),
              "columns": [], "allowEmpty": raw.get("allowEmpty", False)}
    if type(result["allowEmpty"]) is not bool:
        raise InputError("allowEmpty must be an explicit boolean")
    names = set()
    for original in columns:
        exact_keys(original, {"name", "path", "type", "nullable", "mode", "missing"}, "column")
        key = original.get("name")
        if not isinstance(key, str) or not NAME.fullmatch(key) or key in names or key in {"constructor", "prototype", "__proto__"}:
            raise InputError("Column names must be unique SF30 identifiers")
        names.add(key)
        c = {"name": key, "path": path_array(original.get("path", []), f"{key}.path"),
             "type": original.get("type", "string"), "nullable": original.get("nullable", False),
             "mode": original.get("mode", "scalar"), "missing": original.get("missing", "error")}
        if c["type"] not in {"string", "integer", "number", "boolean"} or type(c["nullable"]) is not bool:
            raise InputError(f"{key}: select an original SF30 type and an explicit nullable flag")
        if c["mode"] not in {"scalar", "json", "state"} or c["missing"] not in {"error", "null"}:
            raise InputError(f"{key}: invalid projection mode or missing-value policy")
        if c["mode"] in {"json", "state"} and (c["type"] != "string" or c["nullable"]):
            raise InputError(f"{key}: JSON and state projections require a nonnullable string column")
        if c["mode"] == "scalar" and c["missing"] == "null" and not c["nullable"]:
            raise InputError(f"{key}: missing=null requires a nullable scalar column")
        result["columns"].append(c)
    state_paths = {tuple(c["path"]) for c in result["columns"] if c["mode"] == "state"}
    for c in result["columns"]:
        if c["mode"] != "state" and c["missing"] == "null" and tuple(c["path"]) not in state_paths:
            raise InputError(f"{c['name']}: add a state column for this path before mapping missing values to null")
    for label in ["filters", "ranges", "sorts", "keys"]:
        values = raw.get(label, [])
        if not isinstance(values, list) or any(not isinstance(x, str) for x in values) or len(values) > 8 or len(set(values)) != len(values) or any(x not in names for x in values):
            raise InputError(f"{label}: choose up to eight unique exposed columns")
        result[label] = sorted(values)
    by_name = {c["name"]: c for c in result["columns"]}
    if any(by_name[n]["type"] == "boolean" for n in result["ranges"]):
        raise InputError("Boolean columns cannot use range filters")
    if any(by_name[n]["type"] == "number" or by_name[n]["nullable"] for n in result["keys"]):
        raise InputError("Edition keys must be nonnullable string, integer or boolean columns; keep exact IDs as strings")
    if 3 + len(result["filters"]) + 4 * len(result["ranges"]) + bool(result["sorts"]) > 32:
        raise InputError("Dataset capabilities exceed the original 32-query-parameter budget")
    result["maxBytes"] = integer(raw.get("maxBytes", MAX_SOURCE), 1, MAX_SOURCE, "maxBytes")
    result["maxRows"] = integer(raw.get("maxRows", 250000), 1, 1000000, "maxRows")
    result["maxCellChars"] = integer(raw.get("maxCellChars", 65536), 1, 1048576, "maxCellChars")
    result["maxLimit"] = integer(raw.get("maxLimit", 250), 1, 1000, "maxLimit")
    result["defaultLimit"] = integer(raw.get("defaultLimit", 50), 1, result["maxLimit"], "defaultLimit")
    return result


def select(value, path):
    for segment in path:
        if isinstance(value, dict) and isinstance(segment, str) and segment in value:
            value = value[segment]
        elif isinstance(value, list) and type(segment) is int and segment < len(value):
            value = value[segment]
        else:
            return MISSING
    return value


def _cell(value, c, line, has_state):
    label = f"Line {line}, {c['name']}"
    if c["mode"] == "state":
        return "missing" if value is MISSING else "null" if value is None else "value"
    if value is MISSING:
        if c["missing"] == "error":
            raise InputError(f"{label}: mapped path is missing")
        value = None
    if c["mode"] == "json":
        return exact_json(value)
    if value is None:
        if c["nullable"]:
            return ""
        raise InputError(f"{label}: null requires nullable=true or JSON projection")
    if isinstance(value, (list, dict)):
        raise InputError(f"{label}: nested objects and arrays require JSON projection")
    if type(value) is bool:
        cell = "true" if value else "false"
    else:
        cell = str(value)
    if c["type"] == "string":
        if not cell and c["nullable"] and not has_state:
            raise InputError(f"{label}: an empty string would become null; add a state column for this path or use JSON projection")
        return cell
    if c["type"] == "boolean":
        if type(value) is bool or isinstance(value, str) and not isinstance(value, JsonNumber) and value in {"true", "false"}:
            return cell
        raise InputError(f"{label}: expected true or false")
    if type(value) is bool:
        raise InputError(f"{label}: booleans cannot be coerced to numbers")
    if c["type"] == "integer":
        if len(cell) <= 17 and INT.fullmatch(cell) and abs(int(cell)) <= 9007199254740991:
            return cell
        raise InputError(f"{label}: integer exceeds the original exact JavaScript integer range; expose it as string")
    try:
        number = float(cell)
        if not NUMBER.fullmatch(cell) or not math.isfinite(number) or Decimal(str(number)) != Decimal(cell):
            raise ValueError()
    except (ValueError, InvalidOperation, OverflowError) as error:
        raise InputError(f"{label}: number would lose decimal value in the original engine; expose it as string") from error
    return cell


def extract(stream: BinaryIO, plan: dict, on_record: Callable) -> int:
    plan = validate_plan(plan)
    states = {tuple(c["path"]) for c in plan["columns"] if c["mode"] == "state"}
    count = 0
    for line, root in records(stream):
        selected = select(root, plan["recordPath"])
        if selected is MISSING or not isinstance(selected, dict):
            raise InputError(f"Line {line}: recordPath must select an existing object")
        count += 1
        if count > plan["maxRows"]:
            raise InputError("NDJSON projection exceeds maxRows")
        cells, values = [], []
        for c in plan["columns"]:
            cell = _cell(select(selected, c["path"]), c, line, tuple(c["path"]) in states)
            if utf16_length(cell) > plan["maxCellChars"]:
                raise InputError(f"Line {line}, {c['name']}: projected cell exceeds maxCellChars")
            cells.append(cell)
            if cell == "" and c["nullable"]:
                value = None
            elif c["type"] == "integer":
                value = int(cell)
            elif c["type"] == "number":
                value = float(cell)
            elif c["type"] == "boolean":
                value = cell == "true"
            else:
                value = cell
            values.append(value)
        on_record(count, cells, values)
    return count


def dataset_spec(plan: dict) -> dict:
    plan = validate_plan(plan)
    return {"schema": "stellar-forge.csv-dataset.v1", "file": "data.csv", "name": plan["name"],
            "columns": {c["name"]: {"type": c["type"], "nullable": c["nullable"]} for c in plan["columns"]},
            **{key: plan[key] for key in ["filters", "ranges", "sorts", "maxBytes", "maxRows",
                                         "maxCellChars", "defaultLimit", "maxLimit"]}}
