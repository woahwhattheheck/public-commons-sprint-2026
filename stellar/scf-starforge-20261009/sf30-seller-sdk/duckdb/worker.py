#!/usr/bin/env python3
"""Fixed native DuckDB reader for an immutable SF30 operator declaration.

Derived from the released Commons DuckDB worker blob
25642b663cdb47f9afd3e2acca3be8d6ae70ad3d; MIT. The parent owns typed admission,
the wall-clock deadline and process slots. This worker has no HTTP or payments.
"""
from __future__ import annotations
import argparse
import base64
import datetime
import decimal
import json
import math
import os
import re
import sys
from pathlib import Path

SCHEMA = "stellar-forge.duckdb-source.v1"
NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,47}$")
SAFE_ERRORS = {"CONFIG_INVALID", "DUCKDB_NOT_INSTALLED", "DATASET_CHANGED",
               "QUERY_NOT_DECLARED", "INVALID_INPUT", "INVALID_RESULT", "RESULT_TOO_LARGE"}


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def fail(code):
    print(encoded({"ok": False, "error": code}))
    return 1


def read_config(path):
    with path.open("rb") as handle:
        data = handle.read(1048577)
    if len(data) > 1048576:
        raise ValueError("CONFIG_INVALID")
    config = json.loads(data.decode("utf-8"))
    if not isinstance(config, dict) or config.get("schema") != SCHEMA:
        raise ValueError("CONFIG_INVALID")
    base = Path(config["baseDirectory"])
    if not base.is_absolute() or str(base.resolve()) != str(base) or not base.is_dir():
        raise ValueError("CONFIG_INVALID")
    files = config["files"]
    if not isinstance(files, list) or len(files) > 33:
        raise ValueError("CONFIG_INVALID")
    for item in files:
        local = Path(item["path"])
        if not local.is_absolute() or not local.is_relative_to(base) or str(local.resolve()) != str(local):
            raise ValueError("CONFIG_INVALID")
    approved = config["parquetFiles"]
    database = config["database"]
    if not isinstance(approved, list) or len(approved) > 32 or any(not file.lower().endswith(".parquet") for file in approved):
        raise ValueError("CONFIG_INVALID")
    required = set(approved) | ({database} if database != ":memory:" else set())
    if required != {item["path"] for item in files}:
        raise ValueError("CONFIG_INVALID")
    queries = config["queries"]
    if not isinstance(queries, dict) or not 1 <= len(queries) <= 32:
        raise ValueError("CONFIG_INVALID")
    for name, query in queries.items():
        if not NAME.fullmatch(name) or not isinstance(query, dict) or not isinstance(query.get("sql"), str):
            raise ValueError("CONFIG_INVALID")
        columns = query["columns"]
        if not isinstance(columns, list) or not 1 <= len(columns) <= 64 or len(set(columns)) != len(columns) or any(not NAME.fullmatch(col) for col in columns):
            raise ValueError("CONFIG_INVALID")
        if not isinstance(query["parameters"], dict) or len(query["parameters"]) > 32 or any(not NAME.fullmatch(key) for key in query["parameters"]):
            raise ValueError("CONFIG_INVALID")
        if type(query["maxRows"]) is not int or not 1 <= query["maxRows"] <= 1000 or type(query["maxBytes"]) is not int or not 1024 <= query["maxBytes"] <= 917504:
            raise ValueError("CONFIG_INVALID")
    options = config["options"]
    if type(options["memoryLimitMb"]) is not int or not 32 <= options["memoryLimitMb"] <= 1024 or type(options["threads"]) is not int or not 1 <= options["threads"] <= 4:
        raise ValueError("CONFIG_INVALID")
    return config


def unchanged(config):
    for item in config["files"]:
        path = Path(item["path"])
        try:
            info = path.lstat()
            same = path.is_file() and not path.is_symlink() and str(path.resolve()) == str(path) and (
                str(info.st_size), str(info.st_mtime_ns), str(info.st_ino)) == (
                item["size"], item["modifiedNs"], item["inode"])
        except OSError:
            same = False
        if not same:
            raise ValueError("DATASET_CHANGED")


def connect(config):
    try:
        import duckdb
    except ImportError:
        raise RuntimeError("DUCKDB_NOT_INSTALLED")
    options = config["options"]
    connection = duckdb.connect(config["database"], read_only=config["database"] != ":memory:", config={
        "allow_unsigned_extensions": "false", "autoinstall_known_extensions": "false",
        "autoload_known_extensions": "false", "allow_community_extensions": "false",
        "allow_persistent_secrets": "false", "memory_limit": str(options["memoryLimitMb"]) + "MB",
        "threads": str(options["threads"]),
    })
    # Only local, individually declared Parquet files remain available after this.
    literals = ",".join("'" + value.replace("'", "''") + "'" for value in config["parquetFiles"])
    connection.execute("SET allowed_paths = [" + literals + "]")
    connection.execute("SET enable_external_access = false")
    connection.execute("SET lock_configuration = true")
    return connection, duckdb.__version__


def decode(value, spec):
    if value is None:
        if spec.get("nullable") is True:
            return None
        raise ValueError("INVALID_INPUT")
    kind = spec["type"]
    if kind == "string" and isinstance(value, str) and len(value) <= 65536:
        return value
    if kind == "integer" and isinstance(value, str) and re.fullmatch(r"(?:0|-[1-9]\d*|[1-9]\d*)", value):
        number = int(value)
        if -(2**63) <= number <= 2**63 - 1:
            return number
    if kind == "number" and isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
        return value
    if kind == "boolean" and isinstance(value, bool):
        return value
    raise ValueError("INVALID_INPUT")


def sample(spec):
    value = spec.get("default", spec.get("enum", [{"string": "", "integer": "0", "number": 0, "boolean": False}[spec["type"]]])[0])
    if value is None:
        return None
    if spec["type"] == "integer":
        return int(value)
    if spec["type"] == "number":
        return float(value)
    if spec["type"] == "boolean":
        return value is True or value == "true"
    return value


def encode(value):
    if value is None or isinstance(value, (bool, str)):
        return value
    if isinstance(value, (int, decimal.Decimal)):
        return str(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("INVALID_RESULT")
        return value
    if isinstance(value, (bytes, bytearray, memoryview)):
        return {"$base64": base64.b64encode(bytes(value)).decode("ascii")}
    if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
        return value.isoformat()
    if isinstance(value, (list, tuple)):
        return [encode(item) for item in value]
    if isinstance(value, dict):
        return {str(key): encode(item) for key, item in value.items()}
    return str(value)


def projection(query, limit):
    columns = ",".join('"' + col + '"' for col in query["columns"])
    return "SELECT " + columns + " FROM (\n" + query["sql"] + "\n) AS sf30_approved LIMIT " + str(limit)


def bounded_statement(query):
    projected = projection(query, query["maxRows"] + 1)
    # Suppress oversized rows inside DuckDB before Python receives their values.
    # The complete public JSON is separately budgeted after exact value encoding.
    checked = "SELECT p.*, octet_length(encode(CAST(to_json(p) AS VARCHAR))) AS __sf30_bytes FROM (" + projected + ") AS p"
    columns = ",".join('CASE WHEN __sf30_bytes <= ' + str(query["maxBytes"]) + ' THEN "' + col + '" ELSE NULL END AS "' + col + '"' for col in query["columns"])
    return "SELECT " + columns + ",__sf30_bytes > " + str(query["maxBytes"]) + " AS __sf30_large FROM (" + checked + ") AS guarded"


def run(source, name, checking):
    config = read_config(source)
    unchanged(config)
    os.chdir(config["baseDirectory"])
    connection, version = connect(config)
    try:
        if checking:
            types = {}
            for query_name, query in config["queries"].items():
                values = {key: sample(spec) for key, spec in query["parameters"].items()}
                result = connection.execute(projection(query, 0), values)
                types[query_name] = {str(item[0]): str(item[1]) for item in result.description}
            unchanged(config)
            print(encoded({"ok": True, "schema": SCHEMA, "engineVersion": version, "columnTypes": types}))
            return 0
        if name not in config["queries"]:
            return fail("QUERY_NOT_DECLARED")
        raw = sys.stdin.buffer.read(262145)
        if len(raw) > 262144:
            return fail("INVALID_INPUT")
        request = json.loads(raw.decode("utf-8"))
        query = config["queries"][name]
        if not isinstance(request, dict) or set(request) != {"values"} or not isinstance(request["values"], dict) or set(request["values"]) != set(query["parameters"]):
            return fail("INVALID_INPUT")
        values = {key: decode(request["values"][key], spec) for key, spec in query["parameters"].items()}
        cursor = connection.execute(bounded_statement(query), values)
        rows, row_bytes, truncated = [], 0, False
        while True:
            record = cursor.fetchone()
            if record is None:
                break
            if len(rows) == query["maxRows"]:
                truncated = True
                break
            if record[-1]:
                return fail("RESULT_TOO_LARGE")
            row = {column: encode(cell) for column, cell in zip(query["columns"], record[:-1])}
            row_bytes += len(encoded(row).encode("utf-8"))
            if row_bytes > query["maxBytes"]:
                return fail("RESULT_TOO_LARGE")
            rows.append(row)
        unchanged(config)
        payload = {"schema": "stellar-forge.duckdb-result.v1", "query": name,
                   "columns": query["columns"], "rows": rows, "rowCount": len(rows), "truncated": truncated,
                   "encodings": {"integer": "decimal-string", "decimal": "decimal-string", "blob": "$base64", "date": "iso8601"}}
        output = encoded({"ok": True, "payload": payload})
        if len(output.encode("utf-8")) > query["maxBytes"]:
            return fail("RESULT_TOO_LARGE")
        print(output)
        return 0
    finally:
        connection.close()


def main():
    parser = argparse.ArgumentParser(description="Packaged SF30 DuckDB worker; use the Node source CLI")
    parser.add_argument("--source", required=True)
    choice = parser.add_mutually_exclusive_group(required=True)
    choice.add_argument("--query")
    choice.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        return run(Path(args.source).resolve(), args.query, args.check)
    except Exception as issue:
        return fail(str(issue) if str(issue) in SAFE_ERRORS else "DUCKDB_QUERY_UNAVAILABLE")


if __name__ == "__main__":
    raise SystemExit(main())
