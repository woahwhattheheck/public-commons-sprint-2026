"""MIT. Streaming XML inventory and explicit projection into the original SF30 CSV ABI.

Selectors are arrays of exact expanded names, not XPath expressions. Input bytes
are fed to Expat unchanged; no DTD, external entity, XInclude or network loader is
installed. Only one selected record tree is retained while projecting a source.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import json
import math
from pathlib import Path
import re
from typing import BinaryIO, Callable, Any
from xml.parsers import expat

MAX_SOURCE = 256 * 1024 * 1024
MAX_RECORD = 16 * 1024 * 1024
MAX_DEPTH = 128
MAX_PATHS = 4096
NAME = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,47}\Z")
INT = re.compile(r"-?(0|[1-9][0-9]*)\Z")
NUMBER = re.compile(r"-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?\Z")
NIL = "{http://www.w3.org/2001/XMLSchema-instance}nil"
SCHEMA = "stellar-forge.xml-mapping.v1"


class InputError(ValueError):
    """An actionable source or mapping error, suitable for the private operator."""


def utf16_length(value: str) -> int:
    return len(value.encode("utf-16-le")) // 2


def expanded(name: str) -> str:
    if "\x1f" not in name:
        return name
    uri, local = name.split("\x1f", 1)
    return "{" + uri + "}" + local


def parser():
    if expat.version_info < (2, 6, 0):
        raise InputError("Expat 2.6+ is required for XML large-token protections; use an updated Python runtime")
    p = expat.ParserCreate(namespace_separator="\x1f")
    p.buffer_text = True
    p.SetParamEntityParsing(expat.XML_PARAM_ENTITY_PARSING_NEVER)

    def reject(*_):
        raise InputError("DTD and entity declarations are not accepted; export a self-contained XML document")

    p.StartDoctypeDeclHandler = reject
    p.EntityDeclHandler = reject
    p.ExternalEntityRefHandler = reject
    p.SkippedEntityHandler = reject
    return p


def parse_stream(p, stream: BinaryIO, cancel: Callable[[], bool] | None = None) -> int:
    size = 0
    try:
        while chunk := stream.read(65536):
            if cancel and cancel():
                raise InputError("Operation cancelled")
            size += len(chunk)
            if size > MAX_SOURCE:
                raise InputError("XML source exceeds 256 MiB")
            p.Parse(chunk, False)
        p.Parse(b"", True)
    except expat.ExpatError as e:
        raise InputError(f"XML at line {e.lineno}, column {e.offset}: {expat.ErrorString(e.code)}") from e
    return size


def inventory(stream: BinaryIO, cancel: Callable[[], bool] | None = None) -> dict:
    """Full-document shape inventory; samples are short, private parsed-text hints."""
    p = parser()
    stack: list[dict] = []
    paths: dict[tuple, dict] = {}
    namespaces: set[tuple[str, str]] = set()
    declaration = {}
    metadata_bytes = 0

    def charge(value):
        nonlocal metadata_bytes
        metadata_bytes += len(json.dumps(value, ensure_ascii=False).encode()) + 96
        if metadata_bytes > 8 * 1024 * 1024:
            raise InputError("XML shape inventory exceeds 8 MiB; select a smaller source document")

    def start(raw, attrs):
        name = expanded(raw)
        if len(stack) >= MAX_DEPTH or len(name) > 2048 or len(attrs) > 256:
            raise InputError("XML exceeds the supported depth, name or attribute limits")
        if stack:
            stack[-1]["child"] = True
        path = tuple([s["name"] for s in stack] + [name])
        if path not in paths:
            if len(paths) >= MAX_PATHS:
                raise InputError("XML has more than 4096 distinct element paths")
            charge(list(path))
            paths[path] = {"path": list(path), "count": 0, "leafCount": 0,
                           "mixedCount": 0, "attributes": {}, "samples": []}
        row = paths[path]
        row["count"] += 1
        for key, value in attrs.items():
            key = expanded(key)
            if len(key) > 2048 or utf16_length(value) > 1048576:
                raise InputError("XML attribute exceeds supported length")
            if key not in row["attributes"]:
                charge(key)
            a = row["attributes"].setdefault(key, {"count": 0, "samples": []})
            a["count"] += 1
            sample = value[:160]
            if len(a["samples"]) < 3 and sample not in a["samples"]:
                charge(sample)
                a["samples"].append(sample)
        stack.append({"name": name, "row": row, "child": False, "nonspace": False, "sample": ""})

    def text(value):
        if stack:
            frame = stack[-1]
            frame["nonspace"] = frame["nonspace"] or bool(value.strip())
            frame["sample"] += value[:max(0, 160 - len(frame["sample"]))]

    def end(_):
        frame = stack.pop()
        row = frame["row"]
        if not frame["child"]:
            row["leafCount"] += 1
            if len(row["samples"]) < 3 and frame["sample"] not in row["samples"]:
                charge(frame["sample"])
                row["samples"].append(frame["sample"])
        elif frame["nonspace"]:
            row["mixedCount"] += 1

    def ns(prefix, uri):
        if len(namespaces) >= MAX_PATHS:
            raise InputError("XML has too many distinct namespace bindings")
        binding = (prefix or "", uri or "")
        if binding not in namespaces:
            charge(binding)
        namespaces.add(binding)

    p.StartElementHandler, p.EndElementHandler, p.CharacterDataHandler = start, end, text
    p.StartNamespaceDeclHandler = ns
    p.XmlDeclHandler = lambda version, encoding, standalone: declaration.update(
        version=version, encoding=encoding, standalone=standalone)
    size = parse_stream(p, stream, cancel)
    return {"schema": "stellar-forge.xml-inventory.v1", "bytes": size,
            "declaration": declaration,
            "namespaces": [{"prefix": a, "uri": b} for a, b in sorted(namespaces)],
            "paths": list(paths.values())}


def exact_keys(value: Any, allowed: set[str], label: str) -> dict:
    if not isinstance(value, dict) or set(value) - allowed:
        raise InputError(f"Invalid {label} fields")
    return value


def path_array(value: Any, label: str, empty: bool = True) -> list[str]:
    if not isinstance(value, list) or (not value and not empty) or len(value) > MAX_DEPTH:
        raise InputError(f"{label} must be an array of exact expanded XML names")
    if any(not isinstance(v, str) or not v or len(v) > 2048 or "\x00" in v for v in value):
        raise InputError(f"{label} contains an invalid XML name")
    return list(value)


def integer(value: Any, low: int, high: int, label: str) -> int:
    if type(value) is not int or not low <= value <= high:
        raise InputError(f"{label} must be an integer from {low} to {high}")
    return value


def validate_plan(raw: dict) -> dict:
    exact_keys(raw, {"schema", "name", "recordPath", "columns", "filters", "ranges", "sorts", "keys",
                     "defaultLimit", "maxLimit", "maxBytes", "maxRows", "maxCellChars", "allowEmpty"}, "mapping")
    if raw.get("schema") != SCHEMA:
        raise InputError(f"Mapping schema must be {SCHEMA}")
    name = raw.get("name")
    if not isinstance(name, str) or not name.strip() or utf16_length(name) > 128 or re.search(r"[\x00-\x1f\x7f]", name):
        raise InputError("Dataset name must be printable text, 1–128 UTF-16 code units")
    columns = raw.get("columns")
    if not isinstance(columns, list) or not 1 <= len(columns) <= 64:
        raise InputError("Choose 1–64 columns")
    result = {"schema": SCHEMA, "name": name,
              "recordPath": path_array(raw.get("recordPath"), "recordPath", False), "columns": []}
    result["allowEmpty"] = raw.get("allowEmpty", False)
    if type(result["allowEmpty"]) is not bool:
        raise InputError("allowEmpty must be an explicit boolean")
    names: set[str] = set()
    for original in columns:
        exact_keys(original, {"name", "path", "attribute", "type", "nullable", "mode", "separator",
                              "missing", "default", "trim", "text", "nil"}, "column")
        key = original.get("name")
        if not isinstance(key, str) or not NAME.fullmatch(key) or key in names or key in {"constructor", "prototype", "__proto__"}:
            raise InputError("Column names must be unique SF30 identifiers")
        names.add(key)
        c = {"name": key, "path": path_array(original.get("path", []), f"{key}.path"),
             "type": original.get("type", "string"), "nullable": original.get("nullable", False),
             "mode": original.get("mode", "single"), "missing": original.get("missing", "error"),
             "trim": original.get("trim", False), "text": original.get("text", "leaf"),
             "nil": original.get("nil", "literal")}
        if c["type"] not in ("string", "integer", "number", "boolean") or type(c["nullable"]) is not bool or type(c["trim"]) is not bool:
            raise InputError(f"{key}: choose an explicit SF30 type, nullable and trim policy")
        if c["mode"] not in ("single", "first", "last", "join", "json") or c["missing"] not in ("error", "empty", "default"):
            raise InputError(f"{key}: invalid multiplicity or missing-value policy")
        if c["text"] not in ("leaf", "direct", "descendant") or c["nil"] not in ("literal", "xsi"):
            raise InputError(f"{key}: invalid text or xsi:nil policy")
        if c["mode"] in {"join", "json"} and c["type"] != "string":
            raise InputError(f"{key}: join and JSON-array columns must have string type")
        if "attribute" in original and original["attribute"] is not None:
            a = original["attribute"]
            path_array([a], f"{key}.attribute")
            c["attribute"] = a
        if c["mode"] == "join":
            separator = original.get("separator")
            if not isinstance(separator, str) or len(separator) > 128:
                raise InputError(f"{key}: join requires an explicit separator of at most 128 characters")
            c["separator"] = separator
        if c["missing"] == "default":
            default = original.get("default")
            if not isinstance(default, str) or utf16_length(default) > 1048576:
                raise InputError(f"{key}: default must be an explicit cell string")
            c["default"] = default
        result["columns"].append(c)
    for label in ["filters", "ranges", "sorts", "keys"]:
        values = raw.get(label, [])
        if not isinstance(values, list) or any(not isinstance(x, str) for x in values) or len(values) > 8 or len(set(values)) != len(values) or any(x not in names for x in values):
            raise InputError(f"{label}: choose up to eight unique exposed columns")
        result[label] = sorted(values)  # Capabilities and the named key set are order-independent.
    by_name = {c["name"]: c for c in result["columns"]}
    if any(by_name[n]["type"] == "boolean" for n in result["ranges"]):
        raise InputError("Boolean columns cannot use range filters")
    if any(by_name[n]["type"] == "number" or by_name[n]["nullable"] for n in result["keys"]):
        raise InputError("Edition keys must be nonnullable string, integer or boolean columns; keep exact IDs as strings")
    if 3 + len(result["filters"]) + 4 * len(result["ranges"]) + bool(result["sorts"]) > 32:
        raise InputError("Selected capabilities exceed SF30's 32-query-parameter budget")
    result["maxLimit"] = integer(raw.get("maxLimit", 250), 1, 1000, "maxLimit")
    result["defaultLimit"] = integer(raw.get("defaultLimit", 50), 1, result["maxLimit"], "defaultLimit")
    result["maxBytes"] = integer(raw.get("maxBytes", 64 * 1024 * 1024), 1, MAX_SOURCE, "maxBytes")
    result["maxRows"] = integer(raw.get("maxRows", 250000), 1, 1000000, "maxRows")
    result["maxCellChars"] = integer(raw.get("maxCellChars", 65536), 1, 1048576, "maxCellChars")
    return result


def typed(value: str, column: dict, label: str):
    if value == "" and column["nullable"]:
        return None
    t = column["type"]
    if t == "string":
        return value
    if t == "boolean" and value in {"true", "false"}:
        return value == "true"
    if t == "integer" and INT.fullmatch(value) and len(value) <= 17:
        number = int(value)
        if abs(number) <= 9007199254740991:
            return number
    if t == "number" and NUMBER.fullmatch(value):
        number = float(value)
        if math.isfinite(number):
            return number
    raise InputError(f"{label}: requires {t}" + (" or an empty nullable cell" if column["nullable"] else ""))


@dataclass(slots=True)
class Node:
    name: str
    attrs: dict
    content: list = field(default_factory=list)
    children: list = field(default_factory=list)

    def text(self, policy: str) -> str:
        if policy == "leaf" and self.children:
            raise InputError("Selected element has child elements; choose direct or descendant text explicitly")
        return "".join(item if isinstance(item, str) else item.text("descendant")
                       for item in self.content if isinstance(item, str) or policy == "descendant")


def project(root: Node, column: dict, row: int, cell_limit: int) -> tuple[str, Any]:
    selected = [root]
    for name in column["path"]:
        selected = [child for node in selected for child in node.children if child.name == name]
    values = []
    for node in selected:
        if "attribute" in column:
            if column["attribute"] in node.attrs:
                values.append(node.attrs[column["attribute"]])
        elif column["nil"] == "xsi" and node.attrs.get(NIL) in {"true", "1"}:
            if node.children or node.text("direct").strip():
                raise InputError(f"Record {row}, {column['name']}: xsi:nil element contains content")
            values.append(None)
        else:
            values.append(node.text(column["text"]))
    if column["trim"]:
        values = [v.strip() if v is not None else None for v in values]
    label = f"Record {row}, {column['name']}"
    if not values:
        if column["missing"] == "error":
            raise InputError(f"{label}: selector is missing; choose an explicit missing-value policy")
        cell = column.get("default", "") if column["missing"] == "default" else ""
    elif column["mode"] == "json":
        cell = json.dumps(values, ensure_ascii=False, separators=(",", ":"))
    elif column["mode"] == "join":
        if any(v is None for v in values):
            raise InputError(f"{label}: join cannot preserve xsi:nil; choose JSON array")
        cell = column["separator"].join(values)
    else:
        if column["mode"] == "single" and len(values) != 1:
            raise InputError(f"{label}: selector matched {len(values)} values; choose a repeated-field policy")
        value = values[-1] if column["mode"] == "last" else values[0]
        if value is None and not column["nullable"]:
            raise InputError(f"{label}: xsi:nil requires nullable output")
        cell = "" if value is None else value
    if utf16_length(cell) > cell_limit:
        raise InputError(f"{label}: projected cell exceeds maxCellChars")
    return cell, typed(cell, column, label)


def extract(stream: BinaryIO, plan: dict, on_record: Callable[[int, list, list], None],
            cancel: Callable[[], bool] | None = None) -> int:
    """Project the complete document. Callback receives ordinal, CSV cells, typed values."""
    p = parser()
    stack: list[str] = []
    active: list[Node] = []
    count = size = nodes = 0

    def start(raw, attrs):
        nonlocal size, nodes
        name = expanded(raw)
        if len(stack) >= MAX_DEPTH or len(name) > 2048 or len(attrs) > 256:
            raise InputError("XML exceeds supported depth, name or attribute limits")
        stack.append(name)
        if active or stack == plan["recordPath"]:
            node = Node(name, {expanded(k): v for k, v in attrs.items()})
            size += len(name.encode()) + sum(len(k.encode()) + len(v.encode()) for k, v in node.attrs.items()) + 128
            nodes += 1
            if size > MAX_RECORD or nodes > 100000:
                raise InputError("Selected XML record exceeds 16 MiB working text or 100,000 nodes")
            if active:
                active[-1].children.append(node)
                active[-1].content.append(node)
            active.append(node)

    def text(value):
        nonlocal size
        if active:
            size += len(value.encode())
            if size > MAX_RECORD:
                raise InputError("Selected XML record exceeds 16 MiB working text")
            active[-1].content.append(value)

    def end(_):
        nonlocal count, size, nodes
        if active:
            node = active.pop()
            if not active:
                count += 1
                if count > plan["maxRows"]:
                    raise InputError("Selected records exceed maxRows")
                pairs = [project(node, c, count, plan["maxCellChars"]) for c in plan["columns"]]
                on_record(count, [v[0] for v in pairs], [v[1] for v in pairs])
                size = nodes = 0
        stack.pop()

    p.StartElementHandler, p.EndElementHandler, p.CharacterDataHandler = start, end, text
    parse_stream(p, stream, cancel)
    return count


def dataset_spec(plan: dict) -> dict:
    return {"schema": "stellar-forge.csv-dataset.v1", "file": "data.csv", "name": plan["name"],
            "columns": {c["name"]: {"type": c["type"], "nullable": c["nullable"]} for c in plan["columns"]},
            **{k: plan[k] for k in ["filters", "ranges", "sorts", "defaultLimit", "maxLimit", "maxBytes", "maxRows", "maxCellChars"]}}
