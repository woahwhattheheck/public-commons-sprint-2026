#!/usr/bin/env python3
"""Exact retained provider rows -> native metadata, edition comparison and DuckDB.

No network, extension installation, provider credentials or payment operations.
The original worker supplies the read connection policy. This module adds local
source compilation and comparison; the original query author and seller consume
the resulting immutable database.
"""
from __future__ import annotations
import csv
import datetime as dt
from decimal import Decimal, InvalidOperation, localcontext
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import sys
import uuid
import zipfile
from urllib.parse import urlsplit, parse_qs
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

MAX_ROWS = 1_000_000
MAX_JSON = 32 * 1024 * 1024
MAX_OUTPUT = 2 * 1024 * 1024 * 1024
MAX_COLUMNS = 256
MAX_FILES = 4096


class Fault(Exception):
    def __init__(self, code, message=None):
        super().__init__(message or code)
        self.code, self.message = code, message or code


class NumberText(str):
    """Keep an original JSON numeric lexeme without a binary float round trip."""


def pairs(values):
    result = {}
    for key, value in values:
        if key in result:
            raise Fault("CLOUD_DUPLICATE_JSON_KEY")
        result[key] = value
    return result


def decode(data):
    return json.loads(data, parse_int=NumberText, parse_float=NumberText,
                      parse_constant=lambda _value: (_ for _ in ()).throw(Fault("CLOUD_JSON_NONFINITE")),
                      object_pairs_hook=pairs)


def encoded(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"), sort_keys=True)


def native_json(value):
    if isinstance(value, NumberText):
        return str(value)
    if isinstance(value, dict):
        return "{" + ",".join(json.dumps(key, ensure_ascii=False) + ":" + native_json(value[key]) for key in sorted(value)) + "}"
    if isinstance(value, list):
        return "[" + ",".join(native_json(item) for item in value) + "]"
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


def digest(value):
    return hashlib.sha256(encoded(value).encode()).hexdigest()


def file_hash(path):
    stat = path.lstat()
    if not path.is_file() or path.is_symlink():
        raise Fault("CLOUD_REGULAR_FILE_REQUIRED")
    result = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            result.update(chunk)
    after = path.lstat()
    if (stat.st_size, stat.st_mtime_ns, stat.st_ino) != (after.st_size, after.st_mtime_ns, after.st_ino):
        raise Fault("CLOUD_ORIGINAL_FILE_CHANGED")
    return {"sha256": result.hexdigest(), "bytes": str(stat.st_size)}


def atomic(path, value):
    path = Path(path)
    temporary = path.with_name("." + path.name + "." + uuid.uuid4().hex + ".tmp")
    data = (encoded(value) + "\n").encode()
    try:
        with temporary.open("xb") as handle:
            os.chmod(temporary, 0o600)
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        temporary.unlink(missing_ok=True)


def source_path(root, file):
    name = file["path"]
    if not isinstance(name, str) or not name or "\\" in name or name.startswith("/") or any(x in ("", ".", "..") for x in name.split("/")):
        raise Fault("CLOUD_RELATIVE_PATH_REQUIRED")
    path = root / name
    if path.resolve() != path or not path.is_relative_to(root) or path.is_symlink():
        raise Fault("CLOUD_SOURCE_PATH_INVALID")
    return path


def verify(edition):
    root = Path(edition["root"])
    if root.resolve() != root or not root.is_dir():
        raise Fault("CLOUD_SOURCE_ROOT_INVALID")
    files = edition["manifest"]["files"]
    if not isinstance(files, list) or not 1 <= len(files) <= MAX_FILES:
        raise Fault("CLOUD_FILES_REQUIRED")
    for file in files:
        current = file_hash(source_path(root, file))
        if current != {"sha256": file["sha256"], "bytes": file["bytes"]}:
            raise Fault("CLOUD_ORIGINAL_FILE_CHANGED", "A selected original file no longer matches its retained identity.")
    return root


def original_worker():
    spec = importlib.util.spec_from_file_location("sf30_cloud_original_worker", Path(__file__).resolve().parent.parent / "worker.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def connection(edition):
    root = Path(edition["root"])
    files = [str(source_path(root, file)) for file in edition["manifest"]["files"] if file["format"] == "parquet"]
    config = {"database": ":memory:", "parquetFiles": files, "options": {"memoryLimitMb": 256, "threads": 1}}
    try:
        conn, version = original_worker().connect(config)
    except (ImportError, RuntimeError) as error:
        raise Fault("CLOUD_DUCKDB_NOT_INSTALLED", "Use the maintained DuckDB 1.5.6 interpreter with this workspace.") from error
    return conn, version


def quote(name):
    return '"' + name.replace('"', '""') + '"'


def load_json(path):
    if path.stat().st_size > MAX_JSON:
        raise Fault("CLOUD_JSON_FILE_LIMIT", "Split the original export into its native response pages or NDJSON files.")
    try:
        return decode(path.read_text(encoding="utf-8-sig"))
    except (UnicodeError, json.JSONDecodeError) as error:
        raise Fault("CLOUD_JSON_INVALID") from error


def pointer(value, path):
    if not path:
        return value
    for component in path.split("/")[1:]:
        if re.search(r"~(?![01])", component):
            raise Fault("CLOUD_JSON_POINTER_INVALID")
        component = component.replace("~1", "/").replace("~0", "~")
        if isinstance(value, dict) and component in value:
            value = value[component]
        elif isinstance(value, list) and re.fullmatch(r"0|[1-9]\d*", component) and int(component) < len(value):
            value = value[int(component)]
        else:
            raise Fault("CLOUD_JSON_ROWS_PATH_MISSING")
    return value


def snow_columns(raw):
    cols = raw.get("resultSetMetaData", {}).get("rowType")
    if cols is None:
        return None
    result = []
    for item in cols:
        kind = str(item["type"]).upper()
        if kind == "FIXED":
            kind = f"DECIMAL({int(item.get('precision') or 38)},{int(item.get('scale') or 0)})"
        elif kind in ("TEXT", "STRING"):
            kind = "VARCHAR"
        result.append({"name": str(item["name"]), "type": kind, "nullable": item.get("nullable") is not False})
    return result


def original_cell(value, declared=None):
    if value is None:
        return {"type": declared or "NULL", "value": None}
    if isinstance(value, NumberText):
        return {"type": declared or ("JSON_INTEGER" if re.fullmatch(r"-?\d+", value) else "JSON_DECIMAL"), "value": str(value)}
    if isinstance(value, bool):
        return {"type": declared or "BOOLEAN", "value": value}
    if isinstance(value, str):
        return {"type": declared or "VARCHAR", "value": value}
    if isinstance(value, (dict, list)):
        return {"type": declared or "JSON", "value": native_json(value), "jsonEncoding": "exact-json"}
    if isinstance(value, int):
        return {"type": declared or "BIGINT", "value": str(value)}
    raise Fault("CLOUD_ROW_VALUE_INVALID")


def parquet_columns(conn, path):
    rows = conn.execute("DESCRIBE SELECT * FROM read_parquet(?, hive_partitioning=false)", [str(path)]).fetchall()
    if not 1 <= len(rows) <= MAX_COLUMNS:
        raise Fault("CLOUD_COLUMN_LIMIT")
    return [{"name": row[0], "type": row[1], "nullable": row[2] != "NO"} for row in rows]


def row_iterator(edition, file, conn, supplied_columns=None):
    root, fmt = Path(edition["root"]), file["format"]
    path = source_path(root, file)
    columns = supplied_columns or file.get("columns")
    if fmt == "parquet":
        columns = columns or parquet_columns(conn, path)
        expressions = []
        for column in columns:
            kind = column["type"].upper()
            ref = quote(column["name"])
            expressions.append(("CAST(to_json(" + ref + ") AS VARCHAR)" if any(x in kind for x in ("[]", "STRUCT(", "MAP(", "UNION("))
                                else "CAST(" + ref + " AS VARCHAR)"))
        cursor = conn.execute("SELECT " + ",".join(expressions) + " FROM read_parquet(?, hive_partitioning=false)", [str(path)])
        number = 0
        while True:
            batch = cursor.fetchmany(1024)
            if not batch:
                break
            for values in batch:
                number += 1
                cells = {}
                for column, value in zip(columns, values):
                    cell = {"type": column["type"], "value": value}
                    if value is not None and (column["type"].upper() == "JSON" or any(x in column["type"].upper() for x in ("[]", "STRUCT(", "MAP(", "UNION("))):
                        cell["jsonEncoding"] = "exact-json"
                    if value is not None and column["type"].upper() in ("FLOAT", "REAL", "DOUBLE"):
                        cell["hex"] = float(value).hex()
                    cells[column["name"]] = cell
                yield number, cells
        return
    if fmt == "ndjson":
        def lines():
            with path.open("r", encoding="utf-8-sig", newline="") as handle:
                for line in handle:
                    if len(line.encode()) > MAX_JSON:
                        raise Fault("CLOUD_JSON_ROW_LIMIT")
                    if not line.strip():
                        continue
                    yield decode(line)
        rows = lines()
    elif fmt == "csv":
        def csv_rows():
            with path.open("r", encoding="utf-8-sig", newline="") as handle:
                reader = csv.reader(handle)
                names = next(reader, None)
                if not names or len(names) > MAX_COLUMNS or len(set(names)) != len(names):
                    raise Fault("CLOUD_CSV_HEADER_INVALID")
                for values in reader:
                    if len(values) != len(names):
                        raise Fault("CLOUD_CSV_ROW_INVALID")
                    yield {name: (None if "nullToken" in file and value == file["nullToken"] else value) for name, value in zip(names, values)}
        rows = csv_rows()
    else:
        raw = load_json(path)
        if fmt == "snowflake-json":
            columns = columns or snow_columns(raw)
            if not columns or not isinstance(raw.get("data"), list):
                raise Fault("CLOUD_SNOWFLAKE_ROW_METADATA_REQUIRED")
            names = [column["name"] for column in columns]
            for index, values in enumerate(raw["data"], 1):
                if not isinstance(values, list) or len(values) != len(names):
                    raise Fault("CLOUD_SNOWFLAKE_ROW_INVALID")
                yield index, {name: original_cell(value, column["type"]) for name, value, column in zip(names, values, columns)}
            return
        rows = pointer(raw, file.get("rowsPath", ""))
        if not isinstance(rows, list):
            raise Fault("CLOUD_JSON_ROWS_ARRAY_REQUIRED")
    declared = {column["name"]: column["type"] for column in columns or []}
    for index, row in enumerate(rows, 1):
        if not isinstance(row, dict) or len(row) > MAX_COLUMNS:
            raise Fault("CLOUD_ROW_OBJECT_REQUIRED")
        yield index, {key: original_cell(value, declared.get(key)) for key, value in row.items()}


def api_window_ns(value, zone_name):
    """The native timezone parameter interprets the request's wall-clock fields."""
    value = str(value)
    if re.fullmatch(r"\d{8}", value):
        value = value[:4] + "-" + value[4:6] + "-" + value[6:]
    match = re.fullmatch(r"(\d{4}-\d\d-\d\d)(?:T(\d\d):(\d\d):(\d\d)(?:\.(\d{1,9}))?)?Z?", value)
    if not match:
        raise Fault("CLOUD_API_WINDOW_FORMAT_UNSUPPORTED")
    day = dt.date.fromisoformat(match[1])
    wall = dt.datetime(day.year, day.month, day.day, *(int(match[index] or 0) for index in (2, 3, 4)))
    zone = dt.timezone.utc if zone_name == "UTC" else ZoneInfo(zone_name)
    moments = set()
    for fold in (0, 1):
        aware = wall.replace(tzinfo=zone, fold=fold).astimezone(dt.timezone.utc)
        if aware.astimezone(zone).replace(tzinfo=None) == wall:
            elapsed = aware - dt.datetime(1970, 1, 1, tzinfo=dt.timezone.utc)
            moments.add((elapsed.days * 86400 + elapsed.seconds) * 1000000000 +
                        int((match[5] or "").ljust(9, "0") or "0"))
    if len(moments) != 1:
        raise Fault("CLOUD_API_WINDOW_ZONE_AMBIGUOUS_OR_INVALID")
    return str(next(iter(moments)))


def api_scope_issues(family, parsed, parameters, scope):
    routes = {"market_candles": "/v4/timeseries/market-candles",
              "reference_rates": "/v4/timeseries/asset-metrics"}
    if family not in routes:
        return []
    issues = []
    if parsed.path != routes[family]:
        issues.append("api-family-endpoint-mismatch")
    pairs = [("frequency", "frequency"), ("start", "start_time"), ("end", "end_time")]
    pairs += [("market", "markets")] if family == "market_candles" else [("asset", "assets"), ("metric", "metrics")]
    zones = parameters.get("timezone", ["UTC"])
    native_zone = zones[0] if len(zones) == 1 else None
    if native_zone is None or "timezone" in scope and native_zone != scope["timezone"]:
        issues.append("api-declared-scope-mismatch:timezone")
    for local, native in pairs:
        if local not in scope:
            continue
        values = parameters.get(native, [])
        if local in ("start", "end"):
            try:
                matches = native_zone is not None and len(values) == 1 and api_window_ns(values[0], native_zone) == timestamp_ns(scope[local])
            except (ValueError, OverflowError, Fault, ZoneInfoNotFoundError):
                matches = False
        else:
            # A single declared asset/market/metric cannot represent an extra requested population.
            matches = len(values) == 1 and values[0] == str(scope[local])
        if not matches:
            issues.append("api-declared-scope-mismatch:" + local)
    for boundary, default in (("start", True), ("end", False)):
        if boundary not in scope:
            continue
        values = parameters.get(boundary + "_inclusive", ["true"])
        desired = scope.get(boundary + "Inclusive", default)
        if len(values) != 1 or values[0] not in ("true", "false") or (values[0] == "true") is not desired:
            issues.append("api-declared-scope-mismatch:" + boundary + "Inclusive")
    return issues


def coverage(edition, inspections):
    manifest = edition["manifest"]
    config = manifest["coverage"]
    if config["kind"] == "selected-files":
        return {"kind": "selected-files", "complete": False, "state": "SELECTED_FILES", "groups": [],
                "notes": ["Exact selected files are retained. No complete remote-prefix or query population was supplied."]}
    files = {file["id"]: file for file in manifest["files"]}
    root = Path(edition["root"])
    groups, covered_ids = [], set()
    for group in config["groups"]:
        problems, observed = [], []
        pages = [(files[file_id], load_json(source_path(root, files[file_id]))) for file_id in group["pages"]]
        kind = config["kind"]
        if any(file["family"] != group["family"] for file, _raw in pages):
            problems.append("page-family-mismatch")
        if kind == "s3-listing":
            token, keys = None, {}
            for index, (file, raw) in enumerate(pages):
                if file["origin"].get("continuationToken") != token:
                    problems.append("continuation-token-mismatch")
                if raw.get("Prefix", group["prefix"]) != group["prefix"] or type(raw.get("IsTruncated")) is not bool:
                    problems.append("listing-prefix-or-truncation-missing")
                for item in raw.get("Contents", []):
                    key = item.get("Key")
                    if not isinstance(key, str) or not key.startswith(group["prefix"]) or key in keys:
                        problems.append("listing-key-overlap-or-mismatch")
                        continue
                    keys[key] = item
                token = raw.get("NextContinuationToken") if raw.get("IsTruncated") else None
                if raw.get("IsTruncated") and not token or index < len(pages) - 1 and not token:
                    problems.append("listing-page-chain-incomplete")
            if token is not None:
                problems.append("listing-terminal-page-missing")
            available = {}
            bucket = pages[0][1].get("Name") or pages[0][0]["origin"].get("bucket")
            if not bucket:
                problems.append("listing-bucket-binding-missing")
            for file in manifest["files"]:
                key = file["origin"].get("key")
                if key and file["origin"].get("bucket") == bucket:
                    if key in available:
                        problems.append("duplicate-retained-object-key")
                    available[key] = file
            if any((raw.get("Name") or file["origin"].get("bucket")) != bucket for file, raw in pages):
                problems.append("listing-bucket-mismatch")
            missing = []
            for key, item in keys.items():
                selected = available.get(key)
                if selected is None:
                    missing.append(key)
                else:
                    covered_ids.add(selected["id"])
                if selected is not None and (selected["family"] != group["family"] or str(item.get("Size")) != selected["bytes"] or not item.get("ETag") or item.get("ETag") != selected["origin"].get("etag")):
                    problems.append("listed-object-binding-mismatch:" + key)
            if missing:
                problems.append("listed-objects-not-retained")
            observed = {"objects": len(keys), "missingObjects": missing, "prefix": group["prefix"]}
        elif kind == "snowflake-query":
            first = pages[0][1]
            metadata = first.get("resultSetMetaData", {})
            partitions = metadata.get("partitionInfo")
            handle = first.get("statementHandle") or pages[0][0]["origin"].get("statementHandle")
            counts, total = {}, 0
            if not handle or not isinstance(partitions, list) or not partitions:
                problems.append("native-partition-metadata-missing")
                partitions = []
            for file, raw in pages:
                partition = file["origin"].get("partition", 0)
                try:
                    partition = int(partition)
                except (TypeError, ValueError):
                    partition = -1
                if partition in counts or not 0 <= partition < len(partitions):
                    problems.append("partition-identity-invalid")
                if (raw.get("statementHandle") or file["origin"].get("statementHandle")) != handle:
                    problems.append("statement-handle-mismatch")
                rows = raw.get("data")
                if not isinstance(rows, list):
                    problems.append("partition-data-missing")
                    rows = []
                counts[partition] = len(rows)
                total += len(rows)
            for index, item in enumerate(partitions):
                if counts.get(index) != int(item.get("rowCount", -1)):
                    problems.append("partition-row-count-mismatch")
            if total != int(metadata.get("numRows", -1)):
                problems.append("query-total-row-count-mismatch")
            covered_ids.update(file["id"] for file, _raw in pages)
            observed = {"statementHandle": handle, "partitions": len(partitions), "retainedPartitions": len(counts), "rows": str(total)}
        else:
            token, next_url, total = None, None, 0
            first_url = pages[0][0]["origin"].get("url")
            parsed = urlsplit(first_url or "")
            parameters = parse_qs(parsed.query, keep_blank_values=True)
            if parsed.scheme not in ("http", "https") or not parsed.netloc:
                problems.append("api-initial-request-url-missing")
            if parameters.get("next_page_token") or pages[0][0]["origin"].get("pageToken"):
                problems.append("api-initial-page-not-retained")
            scope = manifest.get("scope", {})
            problems.extend(api_scope_issues(group["family"], parsed, parameters, scope))
            for index, (file, raw) in enumerate(pages):
                if index and token is not None and file["origin"].get("pageToken") != token:
                    problems.append("api-token-chain-mismatch")
                if next_url is not None and file["origin"].get("url") != next_url:
                    problems.append("api-url-chain-mismatch")
                rows = pointer(raw, file.get("rowsPath", "/data"))
                if not isinstance(rows, list):
                    problems.append("api-page-rows-missing")
                    rows = []
                total += len(rows)
                token, next_url = raw.get("next_page_token"), raw.get("next_page_url")
                if index < len(pages) - 1 and not token and not next_url:
                    problems.append("api-unlinked-extra-page")
            if token or next_url:
                problems.append("api-terminal-page-missing")
            covered_ids.update(file["id"] for file, _raw in pages)
            observed = {"pages": len(pages), "rows": str(total)}
        groups.append({"family": group["family"], "complete": not problems, "issues": sorted(set(problems)),
                       "pages": group["pages"], "observed": observed})
    uncovered = [file["id"] for file in manifest["files"] if file["role"] != "receipt" and file["id"] not in covered_ids]
    if uncovered:
        groups.append({"family": None, "complete": False, "issues": ["retained-data-outside-native-page-groups"], "pages": [], "observed": {"fileIds": uncovered}})
    return {"kind": config["kind"], "complete": bool(groups) and all(group["complete"] for group in groups),
            "state": "COMPLETE" if groups and all(group["complete"] for group in groups) else "PARTIAL", "groups": groups,
            "notes": ["Completeness applies to these exact retained native pages and selected scope, not an atomic remote snapshot."]}


def sample_row(file_id, row, cells):
    result = {}
    for name, original in cells.items():
        cell = dict(original)
        data = encoded(cell["value"]).encode()
        if len(data) > 8192:
            cell["value"] = str(cell["value"])[:2048]
            cell["truncated"] = True
            cell["originalBytes"] = str(len(data))
            cell["originalSha256"] = hashlib.sha256(data).hexdigest()
        result[name] = cell
    return {"fileId": file_id, "row": row, "values": result}


def inspect(edition):
    verify(edition)
    conn, version = connection(edition)
    profiles, grouped, snow_metadata = [], {}, {}
    root = Path(edition["root"])
    try:
        for file in edition["manifest"]["files"]:
            if file["format"] == "snowflake-json":
                raw = load_json(source_path(root, file))
                cols = snow_columns(raw)
                if cols:
                    snow_metadata[(file["family"], raw.get("statementHandle") or file["origin"].get("statementHandle"))] = cols
        for file in edition["manifest"]["files"]:
            if file["role"] == "receipt":
                continue
            path, sample = source_path(root, file), []
            if file["format"] == "parquet":
                cols = parquet_columns(conn, path)
                count = int(conn.execute("SELECT count(*) FROM read_parquet(?, hive_partitioning=false)", [str(path)]).fetchone()[0])
                for row, cells in row_iterator(edition, file, conn, cols):
                    sample.append(sample_row(file["id"], row, cells))
                    if len(sample) >= 5:
                        break
            else:
                cols = file.get("columns")
                if file["format"] == "snowflake-json" and not cols:
                    raw = load_json(path)
                    cols = snow_columns(raw) or snow_metadata.get((file["family"], raw.get("statementHandle") or file["origin"].get("statementHandle")))
                types, present, count = {}, {}, 0
                for row, cells in row_iterator(edition, file, conn, cols):
                    count += 1
                    if count > MAX_ROWS:
                        raise Fault("CLOUD_ROW_LIMIT")
                    for name, cell in cells.items():
                        types.setdefault(name, set()).add(cell["type"])
                        present[name] = present.get(name, 0) + (cell["value"] is not None)
                    if len(sample) < 5:
                        sample.append(sample_row(file["id"], row, cells))
                cols = cols or [{"name": name, "type": next(iter(kinds)) if len(kinds) == 1 else "JSON_VARIANT",
                                 "nullable": present.get(name, 0) < count} for name, kinds in types.items()]
                if not cols and file["format"] == "csv":
                    with path.open("r", encoding="utf-8-sig", newline="") as header_source:
                        cols = [{"name": name, "type": "VARCHAR", "nullable": True} for name in next(csv.reader(header_source), [])]
                if not cols:
                    raise Fault("CLOUD_EMPTY_EXPORT_COLUMNS_REQUIRED", "An empty text export needs its original column metadata.")
            if count > MAX_ROWS or len(cols) > MAX_COLUMNS:
                raise Fault("CLOUD_NATIVE_INPUT_LIMIT")
            profile = {"fileId": file["id"], "family": file["family"], "format": file["format"], "rows": str(count),
                       "columns": cols, "sample": sample}
            profiles.append({key: profile[key] for key in ("fileId", "family", "format", "rows")})
            key = digest({"family": file["family"], "role": file["role"], "format": file["format"], "columns": cols})
            if key not in grouped and len(grouped) >= 128:
                raise Fault("CLOUD_RELATION_LIMIT", "Select at most 128 distinct family/schema relations in one edition.")
            group = grouped.setdefault(key, {"family": file["family"], "name": file["family"], "role": file["role"],
                                           "format": file["format"], "rows": "0", "files": [], "columns": cols, "sample": []})
            group["rows"] = str(int(group["rows"]) + count)
            if int(group["rows"]) > MAX_ROWS:
                raise Fault("CLOUD_ROW_LIMIT")
            group["files"].append(file["id"])
            group["sample"] = (group["sample"] + sample)[:5]
        relations = list(grouped.values())
        for relation in relations:
            relation["id"] = digest({"family": relation["family"], "files": [next(file["sha256"] for file in edition["manifest"]["files"] if file["id"] == key) for key in relation["files"]], "columns": relation["columns"]})
        verify(edition)
        return {"engineVersion": version, "relations": relations,
                "files": [{"fileId": item["fileId"], "family": item["family"], "format": item["format"], "rows": item["rows"]} for item in profiles],
                "coverage": coverage(edition, profiles)}
    finally:
        conn.close()


def decimal_value(value):
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError) as error:
        raise Fault("CLOUD_DECIMAL_INVALID") from error
    if not number.is_finite() or len(number.as_tuple().digits) > 256 or abs(number.as_tuple().exponent) > 256:
        raise Fault("CLOUD_DECIMAL_LIMIT")
    return number


def timestamp_ns(value, unit="iso", utc=False):
    if unit != "iso":
        number = decimal_value(value) * {"ns": 1, "us": 1000, "ms": 1000000, "s": 1000000000}[unit]
        if number != number.to_integral_value():
            raise Fault("CLOUD_SUBNANOSECOND_TIMESTAMP")
        return str(int(number))
    match = re.fullmatch(r"(\d{4}-\d\d-\d\d)[T ](\d\d):(\d\d):(\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d(?::?\d\d)?)?", str(value))
    if not match or not match[6] and not utc:
        raise Fault("CLOUD_TIMESTAMP_ZONE_REQUIRED")
    day = dt.date.fromisoformat(match[1])
    hour, minute, second = (int(match[index]) for index in (2, 3, 4))
    if hour > 23 or minute > 59 or second > 59:
        raise Fault("CLOUD_TIMESTAMP_INVALID")
    zone, offset = match[6], 0
    if zone and zone != "Z":
        digits = zone[1:].replace(":", "")
        zh, zm = int(digits[:2]), int(digits[2:] or "0")
        if zh > 23 or zm > 59:
            raise Fault("CLOUD_TIMESTAMP_ZONE_INVALID")
        offset = (zh * 60 + zm) * 60 * (1 if zone[0] == "+" else -1)
    seconds = (day - dt.date(1970, 1, 1)).days * 86400 + hour * 3600 + minute * 60 + second - offset
    return str(seconds * 1000000000 + int((match[5] or "").ljust(9, "0") or "0"))


ABSENT = {"type": "ABSENT", "value": None}


def normalized(cell, mapping, side, edition, file_id=None):
    if cell["type"] == "ABSENT":
        return ["absent", None]
    value = cell["value"]
    if value is None:
        return ["null", None]
    kind = mapping["kind"]
    if kind == "text":
        if not isinstance(value, (str, bool)):
            raise Fault("CLOUD_TEXT_COMPARISON_INVALID")
        return [kind, str(value)]
    if kind == "json":
        return [kind, native_json(decode(value)) if cell.get("jsonEncoding") == "exact-json" else native_json(value)]
    if kind == "boolean":
        if value not in (True, False, "true", "false", "TRUE", "FALSE"):
            raise Fault("CLOUD_BOOLEAN_INVALID")
        return [kind, value is True or value in ("true", "TRUE")]
    if kind == "timestamp-ns":
        utc = edition["manifest"]["transport"] in ("retained-s3", "retained-snowflake") or any(file["id"] == file_id and file.get("timezone") == "UTC" for file in edition["manifest"]["files"])
        return [kind, timestamp_ns(value, mapping.get(side + "TimeUnit", "iso"), utc)]
    number = Decimal.from_float(float.fromhex(cell["hex"])) if cell.get("hex") else decimal_value(value)
    if kind == "integer" and number != number.to_integral_value():
        raise Fault("CLOUD_INTEGER_INVALID")
    return [kind, format(number.normalize(), "f")]


def relation_rows(edition, relation_id, conn):
    relation = next((item for item in edition["inspection"]["relations"] if item["id"] == relation_id), None)
    if relation is None:
        raise Fault("CLOUD_RELATION_NOT_FOUND")
    files = {file["id"]: file for file in edition["manifest"]["files"]}
    for file_id in relation["files"]:
        for number, values in row_iterator(edition, files[file_id], conn, relation["columns"]):
            yield {"fileId": file_id, "row": number, "values": values}


def compare(input):
    left, right, request = input["left"], input["right"], input["request"]
    verify(left)
    verify(right)
    out = Path(input["outDir"])
    conn_left, version = connection(left)
    conn_right, _ = connection(right)
    temporary = out / ("compare-" + uuid.uuid4().hex + ".sqlite")
    db = sqlite3.connect(temporary)
    db.execute("PRAGMA cache_size=-16384")
    db.execute("PRAGMA temp_store=FILE")
    db.execute("CREATE TABLE rows(side TEXT,key TEXT,ordinal INTEGER,body TEXT,invalid TEXT)")
    db.execute("CREATE TABLE times(side TEXT,group_key TEXT,time_ns TEXT)")
    db.create_collation("EXACT_NS", lambda a, b: (int(a) > int(b)) - (int(a) < int(b)))
    result_path, index_path = out / "findings.jsonl", out / "findings.index.json"
    staging = out / ("findings-" + uuid.uuid4().hex + ".tmp")
    counts = {key: 0 for key in ("leftRows", "rightRows", "matched", "leftOnly", "rightOnly", "different", "duplicateLeft", "duplicateRight", "ambiguousLeft", "ambiguousRight", "invalidKeys")}
    offsets, finding_count, written = [], 0, 0
    scope_facts = {}
    try:
        with localcontext() as context:
            context.prec = 1024
            for side, edition, relation_id, conn in [("left", left, request["leftRelationId"], conn_left), ("right", right, request["rightRelationId"], conn_right)]:
                relation = next((item for item in edition["inspection"]["relations"] if item["id"] == relation_id), None)
                if relation is None or relation["family"] != request["family"]:
                    raise Fault("CLOUD_COMPARISON_FAMILY_MISMATCH")
                names = {column["name"] for column in relation["columns"]}
                if any(mapping[side] not in names for mapping in request["keys"] + request["fields"]):
                    raise Fault("CLOUD_MAPPED_COLUMN_NOT_FOUND")
                scope = edition["manifest"].get("scope", {})
                time_index = next((index for index, key in enumerate(request["keys"]) if key["kind"] == "timestamp-ns"), None)
                cadence = {"1m": 60, "5m": 300, "10m": 600, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14400, "1d": 86400}.get(scope.get("frequency"))
                facts = {"declared": scope, "timeKey": request["keys"][time_index][side] if time_index is not None else None,
                         "examinedRows": 0, "outsideWindow": 0, "observedMinNs": None, "observedMaxNs": None,
                         "expectedCadenceNs": str(cadence * 1000000000) if cadence else None, "intervalGaps": 0, "irregularIntervals": 0}
                scope_facts[side] = facts
                lower = int(timestamp_ns(scope["start"])) if scope.get("start") else None
                upper = int(timestamp_ns(scope["end"])) if scope.get("end") else None
                for ordinal, row in enumerate(relation_rows(edition, relation_id, conn), 1):
                    invalid, key = None, []
                    try:
                        for mapping in request["keys"]:
                            value = normalized(row["values"].get(mapping[side], ABSENT), mapping, side, edition, row["fileId"])
                            if value[0] in ("absent", "null"):
                                raise Fault("CLOUD_NULL_OR_ABSENT_KEY")
                            key.append(value)
                    except (Fault, ValueError, InvalidOperation) as error:
                        invalid = getattr(error, "code", "CLOUD_KEY_VALUE_INVALID")
                        key = ["invalid", side, ordinal]
                    if invalid is None and time_index is not None:
                        moment = int(key[time_index][1])
                        facts["examinedRows"] += 1
                        facts["observedMinNs"] = str(moment if facts["observedMinNs"] is None else min(moment, int(facts["observedMinNs"])))
                        facts["observedMaxNs"] = str(moment if facts["observedMaxNs"] is None else max(moment, int(facts["observedMaxNs"])))
                        if lower is not None and (moment < lower if scope.get("startInclusive", True) else moment <= lower) or upper is not None and (moment > upper if scope.get("endInclusive") else moment >= upper):
                            facts["outsideWindow"] += 1
                        db.execute("INSERT INTO times VALUES(?,?,?)", (side, encoded([value for index, value in enumerate(key) if index != time_index]), str(moment)))
                    db.execute("INSERT INTO rows VALUES(?,?,?,?,?)", (side, encoded(key), ordinal, encoded(row), invalid))
                    counts[side + "Rows"] += 1
                    if ordinal > MAX_ROWS:
                        raise Fault("CLOUD_ROW_LIMIT")
                    if ordinal % 4096 == 0:
                        db.commit()
            db.commit()
            db.execute("CREATE INDEX rows_key ON rows(key,side,ordinal)")
            db.commit()
            previous = {}
            for side, group_key, moment in db.execute("SELECT side,group_key,time_ns FROM times ORDER BY side,group_key,time_ns COLLATE EXACT_NS"):
                facts = scope_facts[side]
                cadence = int(facts["expectedCadenceNs"]) if facts["expectedCadenceNs"] else None
                group = (side, group_key)
                if cadence and group in previous:
                    delta = int(moment) - previous[group]
                    if delta > cadence:
                        facts["intervalGaps"] += (delta - 1) // cadence
                    if delta and delta % cadence:
                        facts["irregularIntervals"] += 1
                previous = {group: int(moment)}
            with staging.open("xb") as output:
                os.chmod(staging, 0o600)
                def emit(kind, key, lrows, rrows, differences=None, extra=None):
                    nonlocal finding_count, written
                    finding_count += 1
                    if (finding_count - 1) % 100 == 0:
                        offsets.append(written)
                    value = {"id": str(finding_count), "kind": kind, "key": key,
                             "left": lrows, "right": rrows, "differences": differences or [], **(extra or {})}
                    data = (encoded(value) + "\n").encode()
                    written += len(data)
                    if written > MAX_OUTPUT:
                        raise Fault("CLOUD_COMPARISON_OUTPUT_LIMIT")
                    output.write(data)
                for (key_text,) in db.execute("SELECT DISTINCT key FROM rows ORDER BY key"):
                    sizes = dict(db.execute("SELECT side,count(*) FROM rows WHERE key=? GROUP BY side", (key_text,)))
                    if any(size > 1 for size in sizes.values()):
                        key = json.loads(key_text)
                        for side, body in db.execute("SELECT side,body FROM rows WHERE key=? ORDER BY side,ordinal", (key_text,)):
                            duplicate = sizes[side] > 1
                            counts[("duplicate" if duplicate else "ambiguous") + side.title()] += 1
                            row = json.loads(body)
                            emit(("duplicate-" if duplicate else "ambiguous-") + side, key,
                                 [row] if side == "left" else [], [row] if side == "right" else [],
                                 extra={"leftGroupSize": sizes.get("left", 0), "rightGroupSize": sizes.get("right", 0)})
                        continue
                    entries = db.execute("SELECT side,body,invalid FROM rows WHERE key=? ORDER BY side,ordinal", (key_text,)).fetchall()
                    lrows = [json.loads(body) for side, body, _ in entries if side == "left"]
                    rrows = [json.loads(body) for side, body, _ in entries if side == "right"]
                    key = json.loads(key_text)
                    if any(item[2] for item in entries):
                        counts["invalidKeys"] += len(entries)
                        emit("invalid-key", key, lrows, rrows, extra={"error": entries[0][2]})
                        continue
                    if not lrows or not rrows:
                        kind = "rightOnly" if rrows else "leftOnly"
                        counts[kind] += 1
                        emit("right-only" if rrows else "left-only", key, lrows, rrows)
                        continue
                    differences = []
                    for mapping in request["fields"]:
                        lcell = lrows[0]["values"].get(mapping["left"], ABSENT)
                        rcell = rrows[0]["values"].get(mapping["right"], ABSENT)
                        problem = None
                        try:
                            lv, rv = normalized(lcell, mapping, "left", left, lrows[0]["fileId"]), normalized(rcell, mapping, "right", right, rrows[0]["fileId"])
                            same = lv == rv
                            if not same and mapping["kind"] == "decimal" and lv[0] == rv[0] == "decimal":
                                a, b = Decimal(lv[1]), Decimal(rv[1])
                                tolerance = decimal_value(mapping.get("absoluteTolerance", "0")) + decimal_value(mapping.get("relativeTolerance", "0")) * max(abs(a), abs(b))
                                same = abs(a - b) <= tolerance
                        except (Fault, ValueError, InvalidOperation) as error:
                            same = False
                            problem = getattr(error, "code", "CLOUD_COMPARISON_VALUE_INVALID")
                        if not same:
                            differences.append({"leftField": mapping["left"], "rightField": mapping["right"],
                                                "left": lcell, "right": rcell, "kind": mapping["kind"],
                                                "absoluteTolerance": mapping.get("absoluteTolerance"),
                                                "relativeTolerance": mapping.get("relativeTolerance"), "error": problem})
                    if differences:
                        counts["different"] += 1
                        emit("different", key, lrows, rrows, differences)
                    else:
                        counts["matched"] += 1
                output.flush()
                os.fsync(output.fileno())
            os.replace(staging, result_path)
            atomic(index_path, {"stride": 100, "offsets": offsets, "total": finding_count})
        lrelation = next(item for item in left["inspection"]["relations"] if item["id"] == request["leftRelationId"])
        rrelation = next(item for item in right["inspection"]["relations"] if item["id"] == request["rightRelationId"])
        lc, rc = {item["name"]: item for item in lrelation["columns"]}, {item["name"]: item for item in rrelation["columns"]}
        changes = {"leftOnly": [lc[key] for key in lc if key not in rc], "rightOnly": [rc[key] for key in rc if key not in lc],
                   "changed": [{"name": key, "left": lc[key], "right": rc[key]} for key in lc if key in rc and lc[key] != rc[key]]}
        verify(left)
        verify(right)
        return {"engineVersion": version, "counts": counts, "findingsCount": finding_count,
                "findings": file_hash(result_path), "schemaChanges": changes,
                "scope": scope_facts, "coverage": {"left": left["inspection"]["coverage"], "right": right["inspection"]["coverage"]}}
    finally:
        db.close()
        conn_left.close()
        conn_right.close()
        temporary.unlink(missing_ok=True)
        staging.unlink(missing_ok=True)


def sql_type(column):
    kind = column["type"].upper()
    if re.fullmatch(r"DECIMAL\(([1-9]|[12]\d|3[0-8]),\s*(\d|[12]\d|3[0-8])\)", kind):
        return kind
    if kind in ("BOOLEAN", "TINYINT", "SMALLINT", "INTEGER", "BIGINT", "HUGEINT", "UBIGINT", "FLOAT", "REAL", "DOUBLE", "DATE", "TIME", "TIMESTAMP", "TIMESTAMP_NS", "TIMESTAMP_MS", "TIMESTAMP_S", "TIMESTAMP WITH TIME ZONE", "UUID", "JSON"):
        return kind
    return "VARCHAR"


def materialize(input):
    edition = input["edition"]
    verify(edition)
    root = Path(edition["root"])
    directory = Path(input["destination"])
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    output = directory / "data.duckdb"
    final_manifest = directory / "materialization.json"
    pending_manifest = directory / "materialization.pending.json"
    if output.exists():
        for retained in (final_manifest, pending_manifest):
            if retained.exists():
                result = json.loads(retained.read_text())
                if result.get("relationIds") == input["relationIds"] and result.get("originalManifestSha256") == digest(edition["manifest"]) and file_hash(output) == result.get("database"):
                    if not final_manifest.exists():
                        atomic(final_manifest, result)
                    return result
        raise Fault("CLOUD_MATERIALIZATION_EXISTS", "The retained database is not bound to this exact completed source compilation.")
    temporary = directory / ("data-" + uuid.uuid4().hex + ".duckdb")
    import duckdb
    conn = duckdb.connect(str(temporary), config={"allow_unsigned_extensions": "false", "autoinstall_known_extensions": "false",
        "autoload_known_extensions": "false", "allow_community_extensions": "false", "allow_persistent_secrets": "false",
        "memory_limit": "256MB", "threads": "1", "preserve_insertion_order": "true"})
    approved = [str(source_path(root, file)) for file in edition["manifest"]["files"] if file["format"] == "parquet"]
    conn.execute("SET allowed_paths = [" + ",".join("'" + item.replace("'", "''") + "'" for item in approved) + "]")
    conn.execute("SET enable_external_access = false")
    conn.execute("SET TimeZone='UTC'")
    conn.execute("SET lock_configuration = true")
    source_conn, version = connection(edition)
    names, tables = set(), []
    conn.execute("BEGIN TRANSACTION")
    conn.execute("CREATE TABLE __cloud_row_lineage(table_name VARCHAR, materialized_row BIGINT, file_id VARCHAR, source_row BIGINT, present_columns JSON)")
    try:
        relations = {item["id"]: item for item in edition["inspection"]["relations"]}
        files = {item["id"]: item for item in edition["manifest"]["files"]}
        for relation_id in input["relationIds"]:
            relation = relations.get(relation_id)
            if relation is None:
                raise Fault("CLOUD_RELATION_NOT_FOUND")
            name = relation["family"]
            if name in names:
                name += "_" + relation_id[:8]
            names.add(name)
            if relation["format"] == "parquet":
                # Keep native Parquet types in DuckDB, not Python-converted values.
                # File order is explicit; the native reader preserves each file's row order.
                first_path = str(source_path(root, files[relation["files"][0]]))
                conn.execute("CREATE TABLE " + quote(name) + " AS SELECT * FROM read_parquet(?, hive_partitioning=false) LIMIT 0", [first_path])
                inspected = {item["fileId"]: item for item in edition["inspection"]["files"]}
                present = encoded(sorted(column["name"] for column in relation["columns"]))
                materialized_row = 0
                for file_id in relation["files"]:
                    path = str(source_path(root, files[file_id]))
                    count = int(conn.execute("SELECT count(*) FROM read_parquet(?, hive_partitioning=false)", [path]).fetchone()[0])
                    if str(count) != inspected[file_id]["rows"]:
                        raise Fault("CLOUD_MATERIALIZATION_ROW_MISMATCH")
                    conn.execute("INSERT INTO " + quote(name) + " SELECT * FROM read_parquet(?, hive_partitioning=false)", [path])
                    conn.execute("INSERT INTO __cloud_row_lineage SELECT ?, ? + row_index, ?, row_index + 1, ?::JSON FROM range(?) AS native_rows(row_index)",
                                 [name, materialized_row, file_id, present, count])
                    materialized_row += count
            else:
                columns = relation["columns"]
                conn.execute("CREATE TABLE " + quote(name) + " (" + ",".join(quote(column["name"]) + " " + sql_type(column) for column in columns) + ")")
                statement = "INSERT INTO " + quote(name) + " VALUES (" + ",".join("?" for _ in columns) + ")"
                batch, lineage, materialized_row = [], [], 0
                for row in relation_rows(edition, relation_id, source_conn):
                    values = []
                    for column in columns:
                        value = row["values"].get(column["name"], ABSENT)["value"]
                        values.append(encoded(value) if isinstance(value, (dict, list)) else value)
                    batch.append(values)
                    lineage.append([name, materialized_row, row["fileId"], row["row"], encoded(sorted(row["values"]))])
                    materialized_row += 1
                    if len(batch) >= 1024:
                        conn.executemany(statement, batch)
                        conn.executemany("INSERT INTO __cloud_row_lineage VALUES (?,?,?,?,?)", lineage)
                        batch, lineage = [], []
                if batch:
                    conn.executemany(statement, batch)
                    conn.executemany("INSERT INTO __cloud_row_lineage VALUES (?,?,?,?,?)", lineage)
            row_count = int(conn.execute("SELECT count(*) FROM " + quote(name)).fetchone()[0])
            if str(row_count) != relation["rows"]:
                raise Fault("CLOUD_MATERIALIZATION_ROW_MISMATCH")
            lineage_count = int(conn.execute("SELECT count(*) FROM __cloud_row_lineage WHERE table_name=?", [name]).fetchone()[0])
            if lineage_count != row_count:
                raise Fault("CLOUD_MATERIALIZATION_LINEAGE_MISMATCH")
            tables.append({"name": name, "relationId": relation_id, "family": relation["family"], "rows": str(row_count),
                           "sourceFiles": relation["files"], "lineageRows": str(lineage_count),
                           "lineageOrdinalExpression": "row_number() OVER () - 1"})
        conn.execute("COMMIT")
        conn.execute("CHECKPOINT")
        conn.close()
        conn = None
        verify(edition)
        os.chmod(temporary, 0o600)
        handle = os.open(temporary, os.O_RDONLY)
        try:
            os.fsync(handle)
        finally:
            os.close(handle)
        result = {"schema": "stellar-forge.coinmetrics-cloud-materialization.v1", "engineVersion": version,
                  "relationIds": input["relationIds"], "tables": tables, "database": file_hash(temporary),
                  "lineageTable": "__cloud_row_lineage", "lineageKey": "table_name + materialized_row (zero-based insertion ordinal)",
                  "lineageOrder": "manifest relation file order, then native row order within each original file",
                  "originalManifestSha256": digest(edition["manifest"])}
        atomic(pending_manifest, result)
        os.link(temporary, output)
        atomic(final_manifest, result)
        return result
    finally:
        if conn is not None:
            conn.close()
        source_conn.close()
        temporary.unlink(missing_ok=True)
        Path(str(temporary) + ".wal").unlink(missing_ok=True)


def archive(input):
    source, output = Path(input["source"]), Path(input["destination"])
    inventory = input["inventory"]
    if output.exists():
        with zipfile.ZipFile(output) as retained:
            if encoded(json.loads(retained.read("handover.json"))) != encoded(input["manifest"]):
                raise Fault("CLOUD_HANDOVER_SNAPSHOT_CONFLICT")
            if set(retained.namelist()) != {"handover.json"} | {"files/" + file["path"] for file in inventory}:
                raise Fault("CLOUD_HANDOVER_INVENTORY_MISMATCH")
            for file in inventory:
                checksum, size = hashlib.sha256(), 0
                with retained.open("files/" + file["path"]) as member:
                    for chunk in iter(lambda: member.read(1024 * 1024), b""):
                        checksum.update(chunk)
                        size += len(chunk)
                        if size > int(file["bytes"]):
                            raise Fault("CLOUD_HANDOVER_FILE_SIZE_MISMATCH")
                if str(size) != file["bytes"] or checksum.hexdigest() != file["sha256"]:
                    raise Fault("CLOUD_HANDOVER_FILE_DIGEST_MISMATCH")
        return {"archive": file_hash(output), "members": len(inventory) + 1, "reused": True}
    temporary = output.with_name("." + output.name + "." + uuid.uuid4().hex + ".tmp")
    total = 0
    try:
        with zipfile.ZipFile(temporary, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
            bundle.writestr("handover.json", encoded(input["manifest"]) + "\n")
            for file in inventory:
                path = source_path(source, file)
                before = file_hash(path)
                if before != {"bytes": file["bytes"], "sha256": file["sha256"]}:
                    raise Fault("CLOUD_HANDOVER_SOURCE_CHANGED")
                total += int(file["bytes"])
                if total > 8 * 1024 * 1024 * 1024:
                    raise Fault("CLOUD_HANDOVER_SIZE_LIMIT")
                checksum, size = hashlib.sha256(), 0
                with path.open("rb") as original, bundle.open("files/" + file["path"], "w", force_zip64=True) as target:
                    for chunk in iter(lambda: original.read(1024 * 1024), b""):
                        checksum.update(chunk)
                        size += len(chunk)
                        if size > int(file["bytes"]):
                            raise Fault("CLOUD_HANDOVER_SOURCE_CHANGED")
                        target.write(chunk)
                if str(size) != file["bytes"] or checksum.hexdigest() != file["sha256"] or file_hash(path) != before:
                    raise Fault("CLOUD_HANDOVER_SOURCE_CHANGED")
        os.chmod(temporary, 0o600)
        with temporary.open("rb") as handle:
            os.fsync(handle.fileno())
        os.link(temporary, output)
        return {"archive": file_hash(output), "members": len(inventory) + 1}
    finally:
        temporary.unlink(missing_ok=True)


def extract(input):
    source, destination = Path(input["archive"]), Path(input["destination"])
    source_hash = file_hash(source)
    with zipfile.ZipFile(source) as bundle:
        members = bundle.infolist()
        if len(members) > 20000 or sum(item.file_size for item in members) > 8 * 1024 * 1024 * 1024:
            raise Fault("CLOUD_HANDOVER_SIZE_LIMIT")
        names = [item.filename for item in members]
        if len(set(names)) != len(names) or "handover.json" not in names or bundle.getinfo("handover.json").file_size > MAX_JSON:
            raise Fault("CLOUD_HANDOVER_MANIFEST_INVALID")
        manifest = json.loads(bundle.read("handover.json").decode("utf-8"), object_pairs_hook=pairs)
        if manifest.get("schema") != "stellar-forge.coinmetrics-cloud-handover.v1":
            raise Fault("CLOUD_HANDOVER_SCHEMA_INVALID")
        inventory = manifest.get("files")
        if not isinstance(inventory, list) or set(names) != {"handover.json"} | {"files/" + file["path"] for file in inventory}:
            raise Fault("CLOUD_HANDOVER_INVENTORY_MISMATCH")
        destination.mkdir(mode=0o700, parents=True, exist_ok=True)
        for file in inventory:
            name = file["path"]
            if not name or name.startswith("/") or "\\" in name or any(x in ("", ".", "..") for x in name.split("/")):
                raise Fault("CLOUD_HANDOVER_PATH_INVALID")
            info = bundle.getinfo("files/" + name)
            if ((info.external_attr >> 16) & 0o170000) == 0o120000 or str(info.file_size) != file["bytes"]:
                raise Fault("CLOUD_HANDOVER_FILE_INVALID")
            path = destination / name
            if path.resolve() != path:
                raise Fault("CLOUD_HANDOVER_PATH_INVALID")
            path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            if path.resolve() != path:
                raise Fault("CLOUD_HANDOVER_PATH_INVALID")
            if path.exists():
                if file_hash(path) != {"bytes": file["bytes"], "sha256": file["sha256"]}:
                    raise Fault("CLOUD_RECEIVED_FILE_CONFLICT")
                continue
            temporary = path.with_name("." + path.name + "." + uuid.uuid4().hex + ".tmp")
            try:
                total, checksum = 0, hashlib.sha256()
                with bundle.open(info) as original, temporary.open("xb") as retained:
                    os.chmod(temporary, 0o600)
                    while True:
                        chunk = original.read(1024 * 1024)
                        if not chunk:
                            break
                        total += len(chunk)
                        if total > info.file_size:
                            raise Fault("CLOUD_HANDOVER_FILE_SIZE_MISMATCH")
                        checksum.update(chunk)
                        retained.write(chunk)
                    retained.flush()
                    os.fsync(retained.fileno())
                if str(total) != file["bytes"] or checksum.hexdigest() != file["sha256"]:
                    raise Fault("CLOUD_HANDOVER_FILE_DIGEST_MISMATCH")
                os.link(temporary, path)
            finally:
                temporary.unlink(missing_ok=True)
        atomic(destination / "received-handover.json", manifest)
    if source_hash != file_hash(source):
        raise Fault("CLOUD_HANDOVER_SOURCE_CHANGED")
    return {"manifest": manifest, "archive": source_hash}


def main():
    path = Path(sys.argv[1]).resolve()
    input = json.loads(path.read_text(encoding="utf-8"))
    request_sha = input["requestSha256"]
    output = Path(input["output"])
    owner = sqlite3.connect(path.parent / ("native-" + request_sha + ".lock.sqlite"), timeout=0)
    try:
        try:
            owner.execute("BEGIN EXCLUSIVE")
        except sqlite3.OperationalError as error:
            raise Fault("CLOUD_NATIVE_ALREADY_RUNNING", "The retained local operation still has its original native worker.") from error
        for candidate in path.parent.glob("native-" + request_sha + "-attempt-*.result.json"):
            if candidate == output:
                continue
            previous = json.loads(candidate.read_text())
            if previous.get("requestSha256") == request_sha and previous.get("ok") is True:
                atomic(output, {**previous, "reused": True})
                return 0
        if input.get("schema") != "stellar-forge.coinmetrics-native-operation.v1":
            raise Fault("CLOUD_NATIVE_INPUT_INVALID")
        action = input["action"]
        if action == "inspect":
            value = inspect(input["edition"])
        elif action == "compare":
            value = compare(input)
        elif action == "materialize":
            value = materialize(input)
        elif action == "archive":
            value = archive(input)
        elif action == "extract":
            value = extract(input)
        else:
            raise Fault("CLOUD_NATIVE_ACTION_INVALID")
        atomic(output, {"ok": True, "requestSha256": request_sha, "result": value})
        return 0
    except Exception as error:
        code = getattr(error, "code", "CLOUD_NATIVE_INPUT_OR_ENGINE_FAILURE")
        message = error.message if isinstance(error, Fault) else "The retained native input could not be processed. Original source files remain available."
        atomic(output, {"ok": False, "requestSha256": request_sha, "error": code, "message": message})
        return 1
    finally:
        owner.close()


if __name__ == "__main__":
    raise SystemExit(main())
