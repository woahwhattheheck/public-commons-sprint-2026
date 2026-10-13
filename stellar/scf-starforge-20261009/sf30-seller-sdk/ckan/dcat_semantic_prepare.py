#!/usr/bin/env python3
"""Prepare an explicit local JSON-LD view without altering its original catalogue.

No RDF is interpreted here. The unchanged semantic worker owns RDF parsing,
snapshot construction, SPARQL and SHACL validation.
"""
from __future__ import annotations
import argparse
from decimal import Decimal
import hashlib
import json
import math
import os
from pathlib import Path
import stat
import sys

MAX_FILE = 64 * 1024 * 1024
SCHEMA = "stellar-forge.dcat-semantic-prepared.v1"

class Number(str):
    pass

def read(path):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > MAX_FILE:
            raise ValueError("Choose a complete regular retained input of at most 64 MiB.")
        with os.fdopen(fd, "rb", closefd=False) as stream:
            raw = stream.read(MAX_FILE + 1)
        if len(raw) > MAX_FILE:
            raise ValueError("The retained input grew past its allowed size.")
        return raw
    finally:
        os.close(fd)

def write(path, raw):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())

def encode(value):
    if isinstance(value, Number):
        return str(value)
    if isinstance(value, dict):
        return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + encode(value[k])
                              for k in sorted(value)) + "}"
    if isinstance(value, list):
        return "[" + ",".join(encode(v) for v in value) + "]"
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))

def load(raw):
    def pairs(rows):
        result = {}
        for key, value in rows:
            if key in result:
                raise ValueError("Duplicate JSON field: " + key)
            result[key] = value
        return result
    def invalid(value):
        raise ValueError("Non-finite JSON constant: " + value)
    return json.loads(raw.decode("utf-8-sig"), object_pairs_hook=pairs,
                      parse_int=Number, parse_float=Number, parse_constant=invalid)

def numeric_guard(value, pointer="", counts=None):
    if counts is None:
        counts = {"integer_tokens": 0, "decimal_tokens": 0}
    if isinstance(value, Number):
        token = str(value)
        if "." in token or "e" in token.lower():
            counts["decimal_tokens"] += 1
            parsed = float(token)
            before = Decimal(token)
            if (not math.isfinite(parsed) or Decimal(repr(parsed)) != before
                    or (before.is_zero() and before.is_signed() != (math.copysign(1, parsed) < 0))):
                raise ValueError("The unchanged RDF engine's JSON parser cannot preserve numeric value at "
                                 + (pointer or "/") + ". Supply a reviewed explicit RDF representation.")
        else:
            counts["integer_tokens"] += 1
            if token.startswith("-") and int(token) == 0:
                raise ValueError("The unchanged RDF engine's JSON integer parser cannot preserve signed zero at "
                                 + (pointer or "/") + ". Supply a reviewed explicit RDF representation.")
            int(token)  # Preserve the original parser's actual integer-size boundary.
    elif isinstance(value, dict):
        for key, item in value.items():
            numeric_guard(item, pointer + "/" + key.replace("~", "~0").replace("/", "~1"), counts)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            numeric_guard(item, pointer + "/" + str(index), counts)
    return counts

def local_contexts(value):
    def context(node):
        if isinstance(node, str):
            raise ValueError("Only inline retained JSON-LD contexts are permitted.")
        if isinstance(node, list):
            for item in node:
                context(item)
        elif isinstance(node, dict):
            visit(node)
        elif node is not None:
            raise ValueError("An inline JSON-LD context must be an object, list or null.")
    def visit(node):
        if isinstance(node, dict):
            for key, item in node.items():
                if key == "@import":
                    raise ValueError("JSON-LD context imports are not permitted.")
                if key == "@context":
                    context(item)
                else:
                    visit(item)
        elif isinstance(node, list):
            for item in node:
                visit(item)
    visit(value)

def prepare(request_path, source_root, output):
    request = json.loads(read(request_path))
    if request.get("schema") != "stellar-forge.dcat-semantic-native-request.v1":
        raise ValueError("Unsupported retained DCAT semantic request.")
    selected = {item["key"]: item for item in request["inputs"]}
    values = {}
    for key in ("catalog", "context"):
        item = selected[key]
        sha = item["sha256"]
        if len(sha) != 64 or any(c not in "0123456789abcdef" for c in sha):
            raise ValueError("Invalid retained input identity.")
        raw = read(source_root / (sha + ".bin"))
        if len(raw) != item["bytes"] or hashlib.sha256(raw).hexdigest() != sha:
            raise ValueError("The retained input changed: " + key)
        values[key] = load(raw)
    catalog, context_document = values["catalog"], values["context"]
    if not isinstance(catalog, dict):
        raise ValueError("The selected catalogue must be a JSON object.")
    if not isinstance(context_document, dict) or set(context_document) != {"@context"}:
        raise ValueError("The selected local context file must contain exactly its @context field.")
    local_contexts(context_document)
    mode = request["contextMode"]
    if mode == "require-absent":
        if "@context" in catalog:
            raise ValueError("This profile requires a catalogue without a root @context.")
        catalog["@context"] = context_document["@context"]
    elif mode == "replace-root":
        catalog["@context"] = context_document["@context"]
    elif mode == "preserve":
        if "@context" not in catalog or encode(catalog["@context"]) != encode(context_document["@context"]):
            raise ValueError("The preserved root context differs from the explicitly selected local context.")
    else:
        raise ValueError("Choose an explicit root context policy.")
    local_contexts(catalog)
    numbers = numeric_guard(catalog)
    raw = (encode(catalog) + "\n").encode("utf-8")
    if len(raw) > MAX_FILE:
        raise ValueError("The complete derived JSON-LD exceeds the original worker's 64 MiB input limit.")
    output.mkdir(mode=0o700, parents=True, exist_ok=True)
    write(output / "catalog.jsonld", raw)
    result = {"schema": SCHEMA, "context_mode": mode,
              "catalog_sha256": selected["catalog"]["sha256"],
              "context_sha256": selected["context"]["sha256"],
              "derived": {"path": "catalog.jsonld", "bytes": len(raw),
                          "sha256": hashlib.sha256(raw).hexdigest()},
              "base_iri": request["baseIRI"], "network": False,
              "numeric_policy": {"name": "original-engine-json-value-guard.v1",
                  **numbers, "source_tokens_preserved": True,
                  "rdf_numeric_lexical_forms": "original RDFLib JSON-LD semantics",
                  "unrepresentable_decimal_values": "rejected",
                  "negative_integer_zero": "rejected"},
              "runtime": {"executable": sys.executable, "python": sys.version}}
    write(output / "result.json", (json.dumps(result, sort_keys=True, indent=2) + "\n").encode())
    return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", required=True, type=Path)
    parser.add_argument("--sources", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    try:
        # Reuse the original worker's parent-death binding even during JSON preparation.
        vendor = Path(__file__).resolve().parent / "vendor" / "semantic-operator"
        sys.path.insert(0, str(vendor))
        from semantic_operator.worker import _parent_lifecycle
        _parent_lifecycle()
        result = prepare(args.request, args.sources, args.output)
        print(json.dumps({"schema": SCHEMA, "ok": True, "derived": result["derived"]}), flush=True)
        return 0
    except Exception as exc:
        args.output.mkdir(mode=0o700, parents=True, exist_ok=True)
        failure = {"schema": SCHEMA, "ok": False,
                   "error": {"type": type(exc).__name__, "message": str(exc)[:4000]}}
        try:
            write(args.output / "error.json", (json.dumps(failure, indent=2) + "\n").encode())
        except FileExistsError:
            pass
        print(json.dumps(failure), flush=True)
        return 2

if __name__ == "__main__":
    raise SystemExit(main())
