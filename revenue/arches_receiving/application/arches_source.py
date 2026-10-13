"""Arches publisher JSON receiving; Python standard library, no data mutation.

Records use int/Decimal scalars. Store/export them with canonical_json and reopen
with loads_json. Complete raw source identity is available after stream exhaustion.
The caller owns SQLite transactions, release approval, and immutable source copies.
"""
from __future__ import annotations

import codecs
import hashlib
import json
import math
import os
import re
import stat
from collections import Counter
from decimal import Decimal, DecimalException
from pathlib import Path

SCHEMA = "commons.arches-source-contract.v1"
CANONICAL = "commons.exact-json.v1"
_UUID = re.compile(r"^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$")
_NUMBER = re.compile(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?\Z")
_STRING_RUN = re.compile(r'[^"\\\x00-\x1f]+')
_WS = " \t\r\n"
MAX_DEPTH = 128
MAX_CONTEXT_BYTES = 64 * 1024 * 1024


class SourceError(ValueError):
    def __init__(self, code, message, **details):
        self.code, self.details = code, details
        super().__init__(message)


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise SourceError("JSON_DUPLICATE_KEY", "An original JSON object repeats a key.", key=key)
        result[key] = value
    return result


def _constant(value):
    raise SourceError("JSON_NUMBER_INVALID", "JSON requires a finite number.", value=value)


def loads_json(text):
    """Decode exact JSON scalars; duplicate keys and nonfinite numbers fail."""
    try:
        if isinstance(text, (bytes, bytearray)):
            text = bytes(text).decode("utf-8")
        return json.loads(text, parse_float=Decimal, parse_int=int,
                          parse_constant=_constant, object_pairs_hook=_pairs)
    except (json.JSONDecodeError, UnicodeError, ValueError, DecimalException) as error:
        if isinstance(error, SourceError):
            raise
        raise SourceError("JSON_INVALID", "The original input is not valid UTF-8 JSON.") from error


def _decimal_text(value):
    if not value.is_finite():
        raise SourceError("JSON_NUMBER_INVALID", "Canonical JSON requires finite numbers.")
    if value.is_zero():
        return "0"
    sign, digits, exponent = value.as_tuple()
    digits = list(digits)
    while len(digits) > 1 and digits[-1] == 0:
        digits.pop()
        exponent += 1
    coefficient = "".join(str(x) for x in digits)
    power = exponent + len(coefficient) - 1
    # Scientific representation avoids expansion of a compact extreme exponent.
    mantissa = coefficient[0] + (("." + coefficient[1:]) if len(coefficient) > 1 else "")
    return ("-" if sign else "") + mantissa + ("e" + str(power) if power else "")


def canonical_json(value):
    """Stable exact JSON, sorted keys, no Unicode/locale normalization.

    Equivalent finite numeric values share an identity (1, 1.0, 1e0). Arrays,
    locale-key case, strings, nulls, and all publisher fields retain their meaning.
    """
    def encode(item, depth):
        if depth > MAX_DEPTH:
            raise SourceError("JSON_DEPTH", "JSON nesting exceeds the supported limit.")
        if item is None:
            return "null"
        if item is True:
            return "true"
        if item is False:
            return "false"
        if isinstance(item, (int, Decimal)) and not isinstance(item, bool):
            return _decimal_text(Decimal(item))
        if isinstance(item, float):
            if not math.isfinite(item):
                raise SourceError("JSON_NUMBER_INVALID", "Canonical JSON requires finite numbers.")
            return _decimal_text(Decimal(repr(item)))
        if isinstance(item, str):
            # Escaped unpaired surrogates remain representable without invalid UTF-8.
            return json.dumps(item, ensure_ascii=True, separators=(",", ":"))
        if isinstance(item, list):
            return "[" + ",".join(encode(x, depth + 1) for x in item) + "]"
        if isinstance(item, dict):
            if any(not isinstance(k, str) for k in item):
                raise SourceError("JSON_KEY_INVALID", "JSON object keys must be strings.")
            return "{" + ",".join(encode(k, depth + 1) + ":" + encode(item[k], depth + 1)
                                   for k in sorted(item)) + "}"
        raise SourceError("JSON_TYPE_INVALID", "Unsupported original JSON value type.",
                          type=type(item).__name__)
    return encode(value, 0)


def _sha(value):
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def _identity(st):
    return (st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns)


def _open_regular(path):
    path = Path(path)
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        observed = os.fstat(fd)
        if not stat.S_ISREG(observed.st_mode):
            raise SourceError("SOURCE_NOT_REGULAR", "Select a regular original source file.")
        if _identity(os.stat(path, follow_symlinks=False)) != _identity(observed):
            raise SourceError("SOURCE_CHANGED", "The selected source path changed during opening.")
        return os.fdopen(fd, "rb"), observed
    except BaseException:
        os.close(fd)
        raise


def _unchanged(stream, path, before):
    current = os.fstat(stream.fileno())
    try:
        selected = os.stat(path, follow_symlinks=False)
    except OSError as error:
        raise SourceError("SOURCE_CHANGED", "The selected source path disappeared.") from error
    if _identity(before) != _identity(current) or _identity(current) != _identity(selected):
        raise SourceError("SOURCE_CHANGED", "The original source changed while it was read.")


def hash_file(path):
    """Stream a stable regular file and return its exact raw bytes/SHA-256."""
    stream, before = _open_regular(path)
    with stream:
        digest, length = hashlib.sha256(), 0
        while True:
            block = stream.read(1024 * 1024)
            if not block:
                break
            digest.update(block)
            length += len(block)
        _unchanged(stream, path, before)
    return {"bytes": length, "sha256": digest.hexdigest()}


class _Reader:
    def __init__(self, path, max_value_bytes, chunk_size=65536):
        self.path = Path(path)
        self.stream, self.before = _open_regular(path)
        self.decoder = codecs.getincrementaldecoder("utf-8")("strict")
        self.chunk_size, self.max_value_bytes = chunk_size, max_value_bytes
        self.buffer, self.position, self.eof = "", 0, False
        self.digest, self.bytes = hashlib.sha256(), 0
        self.capture, self.capture_bytes, self.consumed = None, 0, 0

    def fill(self):
        if self.position < len(self.buffer):
            return True
        if self.eof:
            return False
        self.buffer, self.position = "", 0
        while not self.buffer and not self.eof:
            block = self.stream.read(self.chunk_size)
            self.digest.update(block)
            self.bytes += len(block)
            self.eof = not block
            try:
                self.buffer = self.decoder.decode(block, final=self.eof)
            except UnicodeError as error:
                raise SourceError("SOURCE_UTF8", "Original JSON must use valid UTF-8.") from error
        return bool(self.buffer)

    def peek(self):
        return self.buffer[self.position] if self.fill() else ""

    def take(self, count=1):
        if not self.fill() or count > len(self.buffer) - self.position:
            raise SourceError("JSON_TRUNCATED", "The JSON source ended inside a value.")
        value = self.buffer[self.position:self.position + count]
        self.position += count
        self.consumed += count
        if self.capture is not None:
            self.capture_bytes += len(value.encode("utf-8"))
            if self.capture_bytes > self.max_value_bytes:
                raise SourceError("RESOURCE_TOO_LARGE", "An original resource exceeds its declared limit.",
                                  max_resource_bytes=self.max_value_bytes)
            self.capture.append(value)
        return value

    def ws(self):
        while self.peek() and self.peek() in _WS:
            start = self.position
            while self.position < len(self.buffer) and self.buffer[self.position] in _WS:
                self.position += 1
            count = self.position - start
            self.position = start
            self.take(count)

    def expect(self, token):
        self.ws()
        if self.peek() != token:
            raise SourceError("JSON_STRUCTURE", "Unexpected JSON token.",
                              expected=token, character_offset=self.consumed)
        self.take()

    def string(self, decode=True):
        self.expect('"')
        parts, length = (['"'] if decode else None), 1
        while True:
            if not self.peek():
                raise SourceError("JSON_TRUNCATED", "The JSON source ended inside a string.")
            match = _STRING_RUN.match(self.buffer, self.position)
            if match:
                part = self.take(match.end() - self.position)
                length += len(part.encode("utf-8"))
                if decode:
                    parts.append(part)
                    if length > self.max_value_bytes:
                        raise SourceError("JSON_KEY_TOO_LARGE", "An object key exceeds the selected byte limit.")
                continue
            char = self.take()
            if decode:
                parts.append(char)
            if char == '"':
                return loads_json("".join(parts)) if decode else None
            if char == "\\":
                escaped = self.take()
                if decode:
                    parts.append(escaped)
                if escaped == "u":
                    digits = "".join(self.take() for _ in range(4))
                    if not re.fullmatch(r"[0-9a-fA-F]{4}", digits):
                        raise SourceError("JSON_ESCAPE", "The source has an invalid Unicode escape.")
                    if decode:
                        parts.append(digits)
                elif escaped not in '"\\/bfnrt':
                    raise SourceError("JSON_ESCAPE", "The source has an invalid JSON escape.")
            elif ord(char) < 32:
                raise SourceError("JSON_STRING", "Unescaped control character in JSON string.")

    def value(self, depth=0):
        if depth > MAX_DEPTH:
            raise SourceError("JSON_DEPTH", "JSON nesting exceeds the supported limit.")
        self.ws()
        char = self.peek()
        if char == "{":
            self.take()
            self.ws()
            seen = set()
            if self.peek() == "}":
                self.take()
                return
            while True:
                key = self.string()
                if key in seen:
                    raise SourceError("JSON_DUPLICATE_KEY", "An original object repeats a key.", key=key)
                seen.add(key)
                self.expect(":")
                self.value(depth + 1)
                self.ws()
                delimiter = self.take()
                if delimiter == "}":
                    return
                if delimiter != ",":
                    raise SourceError("JSON_STRUCTURE", "Expected a comma or object end.")
        elif char == "[":
            self.take()
            self.ws()
            if self.peek() == "]":
                self.take()
                return
            while True:
                self.value(depth + 1)
                self.ws()
                delimiter = self.take()
                if delimiter == "]":
                    return
                if delimiter != ",":
                    raise SourceError("JSON_STRUCTURE", "Expected a comma or array end.")
        elif char == '"':
            self.string(decode=False)
        elif char and char in "-0123456789":
            parts = []
            while self.peek() and self.peek() in "-+0123456789.eE":
                parts.append(self.take())
            if not _NUMBER.fullmatch("".join(parts)):
                raise SourceError("JSON_NUMBER_INVALID", "The source has an invalid JSON number.")
        else:
            token = {"t": "true", "f": "false", "n": "null"}.get(char)
            if not token or "".join(self.take() for _ in token) != token:
                raise SourceError("JSON_VALUE", "The source has an invalid JSON value.")

    def record(self):
        self.ws()
        self.capture, self.capture_bytes = [], 0
        try:
            self.value()
            return loads_json("".join(self.capture))
        finally:
            self.capture = None

    def members(self):
        self.expect("{")
        self.ws()
        seen = set()
        if self.peek() == "}":
            self.take()
            return
        while True:
            key = self.string()
            if key in seen:
                raise SourceError("JSON_DUPLICATE_KEY", "An original object repeats a key.", key=key)
            seen.add(key)
            self.expect(":")
            yield key  # caller must consume the associated complete value
            self.ws()
            delimiter = self.take()
            if delimiter == "}":
                return
            if delimiter != ",":
                raise SourceError("JSON_STRUCTURE", "Expected a comma or object end.")

    def array_records(self):
        self.expect("[")
        self.ws()
        if self.peek() == "]":
            self.take()
            return
        while True:
            yield self.record()
            self.ws()
            delimiter = self.take()
            if delimiter == "]":
                return
            if delimiter != ",":
                raise SourceError("JSON_STRUCTURE", "Expected a comma or resource array end.")

    def finish(self):
        self.ws()
        if self.peek():
            raise SourceError("JSON_TRAILING_DATA", "Unexpected content follows the original JSON document.")
        _unchanged(self.stream, self.path, self.before)
        return {"bytes": self.bytes, "sha256": self.digest.hexdigest()}


class ResourceStream:
    """One-record-at-a-time iterator. receipt exists only after complete EOF."""
    def __init__(self, path, max_resource_bytes, source_format):
        if source_format not in ("business_data", "resource"):
            raise SourceError("SOURCE_FORMAT_REQUIRED",
                              "Explicitly select source_format='business_data' or 'resource'.")
        if not isinstance(max_resource_bytes, int) or isinstance(max_resource_bytes, bool) or max_resource_bytes < 1:
            raise SourceError("RESOURCE_LIMIT_INVALID", "Use a positive integer resource byte limit.")
        self.reader = _Reader(path, max_resource_bytes)
        self.source_format, self.receipt, self.count = source_format, None, 0
        self._iterator = self._read()

    def _read(self):
        try:
            if self.source_format == "resource":
                value = self.reader.record()
                if not isinstance(value, dict) or "business_data" in value:
                    raise SourceError("RESOURCE_SHAPE", "Select one original resource object for this format.")
                self.count += 1
                yield value
            else:
                found = False
                for key in self.reader.members():
                    if key != "business_data":
                        self.reader.value()
                        continue
                    found = True
                    resources = False
                    for child in self.reader.members():
                        if child == "resources":
                            resources = True
                            for value in self.reader.array_records():
                                if not isinstance(value, dict):
                                    raise SourceError("RESOURCE_SHAPE", "Each publisher resource must be an object.")
                                self.count += 1
                                yield value
                        else:
                            self.reader.value()
                    if not resources:
                        raise SourceError("RESOURCES_MISSING", "business_data.resources is required.")
                if not found:
                    raise SourceError("BUSINESS_DATA_MISSING", "The selected business_data envelope is absent.")
            self.receipt = {"schema": SCHEMA, **self.reader.finish(),
                            "resources": self.count, "source_format": self.source_format}
        finally:
            self.reader.stream.close()

    def __iter__(self):
        return self

    def __next__(self):
        return next(self._iterator)

    def close(self):
        self._iterator.close()
        self.reader.stream.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


def iter_resources(path, max_resource_bytes=16 * 1024 * 1024, *, source_format):
    return ResourceStream(path, max_resource_bytes, source_format)


def _issue(rows, code, path, message, *, severity="error", **details):
    rows.append({"code": code, "severity": severity, "path": path,
                 "message": message, "details": details})


def _uuid(value):
    return isinstance(value, str) and bool(_UUID.fullmatch(value))


def _pointer(value):
    return str(value).replace("~", "~0").replace("/", "~1")


def _read_context(path):
    stream, before = _open_regular(path)
    with stream:
        if before.st_size > MAX_CONTEXT_BYTES:
            raise SourceError("CONTEXT_TOO_LARGE", "A graph or collection exceeds the context-file limit.",
                              max_bytes=MAX_CONTEXT_BYTES)
        raw = stream.read(MAX_CONTEXT_BYTES + 1)
        if len(raw) > MAX_CONTEXT_BYTES:
            raise SourceError("CONTEXT_TOO_LARGE", "The context file exceeds its limit.")
        _unchanged(stream, path, before)
    value = loads_json(raw)
    return value, {"path": str(Path(path)), "name": Path(path).name, "bytes": len(raw),
                   "sha256": hashlib.sha256(raw).hexdigest(), "canonical_sha256": _sha(value)}


def inspect_context(graph_paths, collection_paths):
    """Load original graph/collection definitions once, retaining all source bytes' identities."""
    context = {"schema": SCHEMA, "canonicalization": CANONICAL, "graphs": {},
               "collections": {}, "source_manifest": [], "documents": [], "issues": []}
    issues = context["issues"]
    for kind, paths in (("graph", graph_paths), ("collection", collection_paths)):
        for path in paths:
            doc, manifest = _read_context(path)
            manifest["kind"] = kind
            manifest["ids"] = []
            context["source_manifest"].append(manifest)
            context["documents"].append({"kind": kind, "sha256": manifest["sha256"], "record": doc})
            if kind == "graph":
                graphs = doc.get("graph") if isinstance(doc, dict) else None
                if not isinstance(graphs, list) or not graphs:
                    _issue(issues, "GRAPH_DOCUMENT_SHAPE", "/graph", "The original graph array is missing.",
                           source_sha256=manifest["sha256"])
                    continue
                for index, graph in enumerate(graphs):
                    base = "/graph/" + str(index)
                    if not isinstance(graph, dict) or not _uuid(graph.get("graphid")):
                        _issue(issues, "GRAPH_ID_INVALID", base, "A graph requires its original UUID.")
                        continue
                    gid = graph["graphid"]
                    manifest["ids"].append(gid)
                    pub = graph.get("publication")
                    pubid = pub.get("publicationid") if isinstance(pub, dict) else None
                    if pub is not None and (not _uuid(pubid) or pub.get("graph_id") != gid):
                        _issue(issues, "GRAPH_PUBLICATION_INVALID", base + "/publication",
                               "Graph publication does not bind this graph.", graph_id=gid)
                    entry = {"record": graph, "publication_id": pubid, "nodes": {}, "nodegroups": {}}
                    for key, id_key in (("nodes", "nodeid"), ("nodegroups", "nodegroupid")):
                        rows = graph.get(key)
                        if not isinstance(rows, list):
                            _issue(issues, "GRAPH_MEMBERS_INVALID", base + "/" + key,
                                   "The graph member list is missing.", graph_id=gid)
                            continue
                        for row_index, row in enumerate(rows):
                            p = base + "/" + key + "/" + str(row_index)
                            identifier = row.get(id_key) if isinstance(row, dict) else None
                            if not _uuid(identifier):
                                _issue(issues, "GRAPH_MEMBER_ID_INVALID", p, "A graph member requires its UUID.", graph_id=gid)
                            elif identifier in entry[key]:
                                _issue(issues, "GRAPH_MEMBER_DUPLICATE", p, "The graph repeats a member UUID.", member_id=identifier)
                            else:
                                entry[key][identifier] = row
                    for nid, node in entry["nodes"].items():
                        p = base + "/nodes/" + nid
                        if node.get("graph_id") != gid:
                            _issue(issues, "NODE_GRAPH_MISMATCH", p, "A node belongs to another graph.", node_id=nid, graph_id=gid)
                        ng = node.get("nodegroup_id")
                        if ng is not None and (not isinstance(ng, str) or ng not in entry["nodegroups"]):
                            _issue(issues, "NODE_GROUP_UNKNOWN", p, "A node references an absent nodegroup.", node_id=nid, nodegroup_id=ng)
                    for ngid, group in entry["nodegroups"].items():
                        parent = group.get("parentnodegroup_id")
                        if parent is not None and (not isinstance(parent, str) or parent not in entry["nodegroups"]):
                            _issue(issues, "NODEGROUP_PARENT_UNKNOWN", base + "/nodegroups/" + ngid,
                                   "A nodegroup references an absent parent.", nodegroup_id=ngid, parent_id=parent)
                        seen, at = set(), ngid
                        while isinstance(at, str) and at in entry["nodegroups"]:
                            if at in seen:
                                _issue(issues, "NODEGROUP_PARENT_CYCLE", base + "/nodegroups/" + ngid,
                                       "Nodegroup ancestry contains a cycle.", nodegroup_id=ngid)
                                break
                            seen.add(at)
                            at = entry["nodegroups"][at].get("parentnodegroup_id")
                    prior = context["graphs"].get(gid)
                    if prior and _sha(prior["record"]) != _sha(graph):
                        _issue(issues, "GRAPH_DEFINITION_CONFLICT", base, "Different definitions use the same graph UUID.",
                               graph_id=gid, source_sha256=manifest["sha256"])
                    elif not prior:
                        context["graphs"][gid] = entry
            else:
                if not isinstance(doc, dict) or not _uuid(doc.get("id")) or not isinstance(doc.get("concepts"), dict):
                    _issue(issues, "COLLECTION_DOCUMENT_SHAPE", "/", "The original collection id/concepts object is missing.",
                           source_sha256=manifest["sha256"])
                    continue
                cid = doc["id"]
                manifest["ids"].append(cid)
                entry = {"record": doc, "concepts": doc["concepts"], "labels": {}}
                for concept_id, concept in doc["concepts"].items():
                    p = "/concepts/" + _pointer(concept_id)
                    if not _uuid(concept_id) or not isinstance(concept, dict) or concept.get("id") != concept_id:
                        _issue(issues, "CONCEPT_ID_MISMATCH", p, "The original concept key and UUID disagree.", collection_id=cid)
                        continue
                    labels = concept.get("prefLabels")
                    if not isinstance(labels, dict):
                        _issue(issues, "CONCEPT_LABELS_MISSING", p, "Preferred labels are absent.",
                               severity="warning", concept_id=concept_id)
                        continue
                    for locale, label in labels.items():
                        lp = p + "/prefLabels/" + _pointer(locale)
                        lid = label.get("id") if isinstance(label, dict) else None
                        if not _uuid(lid) or not isinstance(label.get("value") if isinstance(label, dict) else None, str):
                            _issue(issues, "CONCEPT_LABEL_INVALID", lp, "A preferred label needs a label UUID and text.",
                                   collection_id=cid, concept_id=concept_id)
                            continue
                        binding = {"collection_id": cid, "concept_id": concept_id, "label_id": lid,
                                   "locale": locale, "label": label["value"]}
                        if lid in entry["labels"]:
                            _issue(issues, "CONCEPT_LABEL_ID_DUPLICATE", lp, "A label UUID has more than one binding.", label_id=lid)
                        else:
                            entry["labels"][lid] = binding
                prior = context["collections"].get(cid)
                if prior and _sha(prior["record"]) != _sha(doc):
                    _issue(issues, "COLLECTION_DEFINITION_CONFLICT", "/", "Different collections use the same UUID.", collection_id=cid)
                elif not prior:
                    context["collections"][cid] = entry
    # Exact source bytes are part of context identity; runtime paths are not.
    selected = sorted(({"kind": x["kind"], "sha256": x["sha256"], "bytes": x["bytes"],
                        "canonical_sha256": x["canonical_sha256"], "ids": sorted(x["ids"])}
                       for x in context["source_manifest"]), key=lambda x: (x["kind"], x["sha256"]))
    context["digest"] = context["context_sha256"] = _sha({"schema": SCHEMA, "sources": selected})
    context["blocking"] = any(x["severity"] == "error" for x in issues)
    return context


def _aliases(obj, keys, issues, path, code, required=False):
    supplied = {key: obj[key] for key in keys if key in obj and obj[key] is not None}
    values = list(supplied.values())
    if values and any(value != values[0] for value in values[1:]):
        _issue(issues, code, path, "Original identifier aliases disagree.", aliases=supplied)
    value = values[0] if values else None
    if (required or value is not None) and not _uuid(value):
        _issue(issues, code + "_INVALID", path, "The original identifier must be a UUID.", aliases=supplied)
    return value if _uuid(value) else None


def _labels(instance, issues):
    output = {}
    descriptors = instance.get("descriptors")
    if isinstance(descriptors, dict):
        for locale, descriptor in descriptors.items():
            if isinstance(descriptor, dict):
                output[locale] = descriptor
            else:
                _issue(issues, "DESCRIPTOR_SHAPE_UNKNOWN", "/resourceinstance/descriptors/" + _pointer(locale),
                       "This descriptor shape is preserved without a locale projection.", severity="warning")
    elif descriptors is not None:
        _issue(issues, "DESCRIPTOR_SHAPE_UNKNOWN", "/resourceinstance/descriptors",
               "This descriptor shape is preserved without a locale projection.", severity="warning")
    if not output and isinstance(instance.get("name"), str):
        output[""] = {"name": instance["name"]}
    if not output:
        _issue(issues, "RESOURCE_LABEL_MISSING", "/resourceinstance/descriptors",
               "No optional display label is present.", severity="warning")
    return output


def _geometry(value, issues, path):
    """Validate JSON geometry structure without projection, rounding or coordinate changes."""
    def positions(item, depth, p):
        if not isinstance(item, list):
            _issue(issues, "GEOMETRY_COORDINATES_INVALID", p, "Coordinates must be an array.")
            return
        if depth == 0:
            if len(item) < 2 or any(isinstance(x, bool) or not isinstance(x, (int, Decimal, float)) for x in item):
                _issue(issues, "GEOMETRY_POSITION_INVALID", p, "A position needs at least two numeric ordinates.")
        else:
            for i, child in enumerate(item):
                positions(child, depth - 1, p + "/" + str(i))
    if not isinstance(value, dict):
        _issue(issues, "GEOMETRY_OBJECT_INVALID", path, "Geometry must retain its original JSON object.")
        return
    kind = value.get("type")
    if kind == "FeatureCollection":
        children = value.get("features")
        if not isinstance(children, list):
            _issue(issues, "GEOMETRY_FEATURES_INVALID", path, "FeatureCollection.features must be an array.")
        else:
            for i, child in enumerate(children):
                if not isinstance(child, dict) or child.get("type") != "Feature":
                    _issue(issues, "GEOMETRY_FEATURE_INVALID", path + "/features/" + str(i), "Expected an original GeoJSON Feature.")
                else:
                    _geometry(child, issues, path + "/features/" + str(i))
    elif kind == "Feature":
        if "geometry" not in value:
            _issue(issues, "GEOMETRY_MISSING", path, "A Feature requires a geometry member (which may be null).")
        elif value["geometry"] is not None:
            _geometry(value["geometry"], issues, path + "/geometry")
    elif kind == "GeometryCollection":
        children = value.get("geometries")
        if not isinstance(children, list):
            _issue(issues, "GEOMETRY_COLLECTION_INVALID", path, "GeometryCollection.geometries must be an array.")
        else:
            for i, child in enumerate(children):
                _geometry(child, issues, path + "/geometries/" + str(i))
    else:
        depth = ({"Point": 0, "MultiPoint": 1, "LineString": 1, "MultiLineString": 2,
                  "Polygon": 2, "MultiPolygon": 3}.get(kind) if isinstance(kind, str) else None)
        if depth is None:
            _issue(issues, "GEOMETRY_TYPE_UNKNOWN", path, "The original geometry type is unsupported.", geometry_type=kind)
        else:
            positions(value.get("coordinates"), depth, path + "/coordinates")


def _inspect_value(value, node, context, issues, path):
    datatype, config = node.get("datatype"), node.get("config")
    config = config if isinstance(config, dict) else {}
    detail = {"datatype": datatype, "value": value}
    if value is None:
        detail["presence"] = "null"
        return detail
    detail["presence"] = "value"
    if datatype in ("concept", "concept-list"):
        selected = value if datatype == "concept-list" else [value]
        if not isinstance(selected, list):
            _issue(issues, "CONCEPT_VALUE_SHAPE", path, "A concept-list must contain original label UUIDs.")
            return detail
        cid = config.get("rdmCollection")
        collection = context["collections"].get(cid) if isinstance(cid, str) else None
        detail["collection_id"], detail["concept_bindings"] = cid, []
        if not collection:
            _issue(issues, "CONCEPT_COLLECTION_MISSING", path, "The selected vocabulary collection is absent.", collection_id=cid)
            return detail
        for index, label_id in enumerate(selected):
            p = path + ("/" + str(index) if datatype == "concept-list" else "")
            binding = collection["labels"].get(label_id) if isinstance(label_id, str) else None
            if binding:
                detail["concept_bindings"].append(dict(binding))
            elif isinstance(label_id, str) and label_id in collection["concepts"]:
                _issue(issues, "CONCEPT_ID_USED_AS_LABEL", p, "The tile selects a concept UUID where the publisher uses a label UUID.",
                       concept_id=label_id, collection_id=cid)
            else:
                _issue(issues, "CONCEPT_LABEL_UNKNOWN", p, "The original label UUID is not in its declared collection.",
                       selected_id=label_id, collection_id=cid)
    elif datatype == "string":
        if isinstance(value, dict):
            detail["languages"] = value
            for locale, item in value.items():
                if not isinstance(item, dict) or not isinstance(item.get("value"), str):
                    _issue(issues, "MULTILINGUAL_VALUE_INVALID", path + "/" + _pointer(locale),
                           "A language value must retain its text object.")
                elif item.get("direction") not in (None, "ltr", "rtl"):
                    _issue(issues, "MULTILINGUAL_DIRECTION_UNKNOWN", path + "/" + _pointer(locale),
                           "The original text direction is unknown.", severity="warning", direction=item["direction"])
        elif not isinstance(value, str):
            _issue(issues, "STRING_VALUE_INVALID", path, "A string node needs text or original language objects.")
    elif datatype == "number":
        if isinstance(value, bool) or not isinstance(value, (int, Decimal, float)):
            _issue(issues, "NUMBER_VALUE_INVALID", path, "A number node needs an exact JSON number.")
    elif datatype == "boolean":
        if not isinstance(value, bool):
            _issue(issues, "BOOLEAN_VALUE_INVALID", path, "A boolean node needs a JSON boolean.")
    elif datatype == "geojson-feature-collection":
        _geometry(value, issues, path)
        if not isinstance(value, dict) or value.get("type") != "FeatureCollection":
            _issue(issues, "GEOMETRY_NODE_TYPE", path, "This node declares a GeoJSON FeatureCollection.")
        detail["geometry"] = value
    elif datatype in ("domain-value", "domain-value-list"):
        selected = value if datatype.endswith("-list") else [value]
        options = config.get("options", [])
        if not isinstance(options, list):
            _issue(issues, "DOMAIN_OPTIONS_INVALID", path,
                   "The original domain options must be an array.", node_id=node.get("nodeid"))
            return detail
        mapping = {x["id"]: x for x in options if isinstance(x, dict) and isinstance(x.get("id"), str)}
        detail["domain_bindings"] = []
        if not isinstance(selected, list):
            _issue(issues, "DOMAIN_VALUE_SHAPE", path, "A domain list must be an array.")
        else:
            for selected_id in selected:
                if isinstance(selected_id, str) and selected_id in mapping:
                    detail["domain_bindings"].append(mapping[selected_id])
                else:
                    _issue(issues, "DOMAIN_VALUE_UNKNOWN", path, "The selected option is absent from the original node configuration.",
                           selected_id=selected_id)
    elif datatype in ("date", "edtf"):
        if not isinstance(value, (str, dict)):
            _issue(issues, "DATE_VALUE_INVALID", path, "The original date value must be text or its retained date object.")
    elif datatype == "file-list":
        if not isinstance(value, list):
            _issue(issues, "FILE_LIST_INVALID", path, "A file-list node needs an array.")
    elif datatype in ("resource-instance", "resource-instance-list"):
        # Do not resolve, rewrite, fetch or claim validity of another resource.
        detail["related_graphs"] = config.get("graphs", [])
        if not isinstance(value, (str, dict, list)):
            _issue(issues, "RESOURCE_REFERENCE_INVALID", path, "The original resource reference shape is invalid.")
    elif datatype == "semantic":
        _issue(issues, "SEMANTIC_NODE_HAS_VALUE", path, "A structural semantic node has a stored data value.",
               severity="warning")
    else:
        _issue(issues, "DATATYPE_UNCHECKED", path, "The original datatype is retained without a specialized value validator.",
               severity="warning", datatype=datatype)
    return detail


def inspect_resource(record, context):
    """Inspect one unchanged publisher resource; errors block approval, not retention."""
    issues = [dict(x) for x in context["issues"]]
    if not isinstance(record, dict):
        raise SourceError("RESOURCE_SHAPE", "Select one original resource object.")
    wrapper = "resourceinstance" in record
    instance = record.get("resourceinstance") if wrapper else record
    if not isinstance(instance, dict):
        instance = {}
        _issue(issues, "RESOURCE_INSTANCE_INVALID", "/resourceinstance", "The original resourceinstance must be an object.")
    ip = "/resourceinstance" if wrapper else ""
    rid = _aliases(instance, ("resourceinstanceid", "resourceid"), issues, ip, "RESOURCE_ID", required=True)
    gid = _aliases(instance, ("graph_id",), issues, ip, "RESOURCE_GRAPH", required=True)
    pubid = _aliases(instance, ("graph_publication_id", "publication_id"), issues, ip, "RESOURCE_PUBLICATION")
    if wrapper:
        for key, expected in (("resourceid", rid), ("graph_id", gid)):
            if key in record and record[key] != expected:
                _issue(issues, "RESOURCE_WRAPPER_ALIAS_MISMATCH", "/" + key,
                       "Wrapper identity disagrees with resourceinstance.", expected=expected, actual=record[key])
    graph = context["graphs"].get(gid) if isinstance(gid, str) else None
    if not graph:
        _issue(issues, "RESOURCE_GRAPH_UNKNOWN", ip + "/graph_id", "The original resource graph is not in the selected context.", graph_id=gid)
    elif pubid is not None and graph["publication_id"] is not None and pubid != graph["publication_id"]:
        _issue(issues, "RESOURCE_PUBLICATION_MISMATCH", ip, "The resource selects a different graph publication.",
               expected=graph["publication_id"], actual=pubid)
    elif pubid is None:
        _issue(issues, "RESOURCE_PUBLICATION_MISSING", ip, "No optional graph publication UUID is present.", severity="warning")
    tiles = record.get("tiles")
    if not isinstance(tiles, list):
        _issue(issues, "RESOURCE_TILES_INVALID", "/tiles", "The original tiles array is missing.")
        tiles = []
    indexed, entries, bindings, geometries = {}, [], [], []
    for index, tile in enumerate(tiles):
        p = "/tiles/" + str(index)
        if not isinstance(tile, dict):
            _issue(issues, "TILE_SHAPE", p, "An original tile must be an object.")
            continue
        tid = _aliases(tile, ("tileid",), issues, p, "TILE_ID", required=True)
        ng = _aliases(tile, ("nodegroup_id",), issues, p, "TILE_NODEGROUP", required=True)
        owner = _aliases(tile, ("resourceinstance_id", "resourceid"), issues, p, "TILE_RESOURCE", required=True)
        if owner != rid:
            _issue(issues, "TILE_RESOURCE_MISMATCH", p + "/resourceinstance_id",
                   "The tile belongs to a different resource; original ownership is retained.",
                   resource_id=rid, tile_resource_id=owner, tile_id=tid)
        if tid in indexed:
            _issue(issues, "TILE_ID_DUPLICATE", p, "The resource repeats a tile UUID.", tile_id=tid)
        elif tid is not None:
            indexed[tid] = (tile, p)
        entries.append((tile, p))
        if graph and ng not in graph["nodegroups"]:
            _issue(issues, "TILE_NODEGROUP_UNKNOWN", p, "The tile references an absent graph nodegroup.", nodegroup_id=ng)
        data = tile.get("data")
        if not isinstance(data, dict):
            _issue(issues, "TILE_DATA_INVALID", p + "/data", "Original tile data must be an object.")
            continue
        if graph:
            for required_id, required_node in graph["nodes"].items():
                if (required_node.get("nodegroup_id") == ng and required_node.get("isrequired") is True
                        and required_node.get("datatype") != "semantic"
                        and (required_id not in data or data[required_id] is None)):
                    _issue(issues, "REQUIRED_NODE_MISSING", p + "/data/" + required_id,
                           "A required original data node is absent or null.", node_id=required_id)
        if tile.get("provisionaledits") not in (None, [], {}):
            _issue(issues, "TILE_PROVISIONAL_EDITS", p + "/provisionaledits",
                   "Original provisional edits require review; stored data has not been overlaid.", severity="warning")
        for nid, value in data.items():
            vp = p + "/data/" + _pointer(nid)
            node = graph["nodes"].get(nid) if graph else None
            if not node:
                _issue(issues, "TILE_NODE_UNKNOWN", vp, "The tile data key is not a node in the selected graph.", node_id=nid)
                bindings.append({"tile_id": tid, "node_id": nid, "nodegroup_id": ng, "value": value, "path": vp})
                continue
            if node.get("nodegroup_id") != ng:
                _issue(issues, "TILE_NODEGROUP_MISMATCH", vp, "The data node belongs to another nodegroup.",
                       node_id=nid, expected=node.get("nodegroup_id"), actual=ng)
            inspected = _inspect_value(value, node, context, issues, vp)
            binding = {"tile_id": tid, "node_id": nid, "nodegroup_id": ng,
                       "alias": node.get("alias"), "node_name": node.get("name"), "path": vp, **inspected}
            bindings.append(binding)
            if "geometry" in inspected:
                geometries.append({"tile_id": tid, "node_id": nid, "path": vp, "value": value})
    counts = Counter()
    for tile, p in entries:
        parent, tid, ng = tile.get("parenttile_id"), tile.get("tileid"), tile.get("nodegroup_id")
        tid = tid if isinstance(tid, str) else None
        ng = ng if isinstance(ng, str) else None
        if parent is not None and (not _uuid(parent) or parent not in indexed):
            _issue(issues, "TILE_PARENT_UNKNOWN", p + "/parenttile_id", "The original parent tile is absent.", parent_id=parent)
        elif parent is not None and graph and ng in graph["nodegroups"]:
            actual_group = indexed[parent][0].get("nodegroup_id")
            expected_group = graph["nodegroups"][ng].get("parentnodegroup_id")
            if actual_group != expected_group:
                _issue(issues, "TILE_PARENT_GROUP_MISMATCH", p, "The parent tile does not match graph nodegroup ancestry.",
                       expected=expected_group, actual=actual_group)
        elif parent is None and graph and ng in graph["nodegroups"] and graph["nodegroups"][ng].get("parentnodegroup_id") is not None:
            _issue(issues, "TILE_PARENT_MISSING", p, "This nodegroup requires its original parent tile.")
        seen, at = set(), tid
        while isinstance(at, str) and at in indexed:
            if at in seen:
                _issue(issues, "TILE_PARENT_CYCLE", p, "Original tile ancestry contains a cycle.", tile_id=tid)
                break
            seen.add(at)
            at = indexed[at][0].get("parenttile_id")
        counts[(ng, parent if isinstance(parent, str) else None)] += 1
    if graph:
        for (ng, parent), count in counts.items():
            group = graph["nodegroups"].get(ng)
            if group and group.get("cardinality") == "1" and count > 1:
                _issue(issues, "NODEGROUP_CARDINALITY", "/tiles", "A single-cardinality group repeats under one parent.",
                       nodegroup_id=ng, parent_id=parent, count=count)
    labels = _labels(instance, issues)
    return {"schema": SCHEMA, "canonicalization": CANONICAL, "resource_id": rid,
            "graph_id": gid, "publication_id": pubid, "context_sha256": context["digest"],
            "resource_sha256": _sha(record), "record": record, "labels": labels,
            "tiles_count": len(tiles), "bindings": bindings, "geometries": geometries,
            "issues": issues, "blocking": any(x["severity"] == "error" for x in issues)}
