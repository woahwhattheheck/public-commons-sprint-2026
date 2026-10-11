#!/usr/bin/env python3
"""MIT. Compare complete projections made by the retained original XLSX reader.
The parent holds descriptors 3/4 (originals), 5 (difference JSONL), 6 (reader).
SQLite and projection files are private temporary join material, never a source store.
"""
import csv
import gc
import hashlib
import io
import json
import os
import sqlite3
import sys
import tempfile

NATIVE = {}
LIMIT = 256 * 1024 * 1024

def encoded(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False,
                      separators=(",", ":"), sort_keys=True).encode("utf-8")

def fail(code, message, details=None):
    NATIVE["fail"](code, message, details)

def scalar_token(value, spec):
    if value == "" and spec["nullable"]:
        return ["null", ""]
    kind = spec["type"]
    if kind == "number":
        number = float(value)
        return [kind, "0" if number == 0 else number.hex()]
    if kind == "integer":
        return [kind, str(int(value))]
    return [kind, value]

def headers(fd, descriptor):
    with os.fdopen(os.dup(fd), "rb") as source:
        source.seek(0)
        workbook = NATIVE["Workbook"](source, descriptor["source"])
        try:
            plan = descriptor["plan"]
            bounds = NATIVE["selection_range"](plan["range"])
            left, top, right, bottom = bounds
            header_row = plan.get("headerRow")
            if header_row is not None:
                NATIVE["integer"](header_row, "Header row", top, bottom)
            sheet = workbook.sheet(plan["sheet"])
            values = []
            for col in range(left, right + 1):
                cell = sheet["cells"].get((col, header_row)) if header_row is not None else None
                values.append({"source": NATIVE["column_label"](col),
                               "header": cell.get("value") if cell else None,
                               "cell": cell})
            return {"sheet": plan["sheet"], "range": NATIVE["range_name"](bounds),
                    "headerRow": header_row, "headers": values,
                    "metadata": sheet["metadata"], "epoch": workbook.epoch}
        finally:
            workbook.zip.close()
            workbook.cache.clear()

def project(db, table, fd, descriptor, keys, directory):
    schema = NATIVE["schema_columns"](descriptor["config"])
    specs = {item["name"]: item for item in schema}
    with os.fdopen(os.dup(fd), "rb") as source:
        source.seek(0)
        workbook = NATIVE["Workbook"](source, descriptor["source"])
        try:
            csv_path = os.path.join(directory, table + ".csv")
            map_path = os.path.join(directory, table + ".jsonl")
            with open(csv_path, "x+b") as csv_file, open(map_path, "x+b") as row_file:
                os.chmod(csv_path, 0o600)
                os.chmod(map_path, 0o600)
                config = descriptor["config"]
                projection = NATIVE["prepare"](workbook, {
                    "plan": descriptor["plan"], "config": config,
                    "maxCsvBytes": config.get("maxBytes", 64 * 1024 * 1024),
                    "maxPreparedBytes": min(LIMIT, config.get("maxBytes", 64 * 1024 * 1024) + 64 * 1024 * 1024)
                }, csv_file, row_file)
                csv_file.flush()
                row_file.flush()
                csv_file.seek(0)
                row_file.seek(0)
                sheet = workbook.sheet(descriptor["plan"]["sheet"])
                cols = [(item["name"], NATIVE["column_number"](item["sourceColumn"]))
                        for item in projection["columns"]]
                csv_text = io.TextIOWrapper(csv_file, encoding="utf-8", newline="")
                rows_text = io.TextIOWrapper(row_file, encoding="utf-8", newline="")
                try:
                    records = csv.reader(csv_text)
                    header = next(records)
                    if header != [item["name"] for item in schema]:
                        fail("WORKBOOK_PROJECTION_CHANGED", "The original projection headers changed.")
                    observation = hashlib.sha256()
                    count = 0
                    for values, row_line in zip(records, rows_text, strict=True):
                        row_map = json.loads(row_line)
                        if row_map["record"] != count or len(values) != len(header):
                            fail("WORKBOOK_PROJECTION_CHANGED", "The original source-row map is inconsistent.")
                        row_number = row_map["row"]
                        projected = dict(zip(header, values))
                        tokens = {name: scalar_token(projected[name], specs[name]) for name in header}
                        key_values = [tokens[name] for name in keys]
                        if any(item[0] == "null" for item in key_values):
                            fail("WORKBOOK_NULL_ROW_KEY",
                                 "Choose row keys populated in every selected record.",
                                 {"side": table, "sheet": projection["sheet"], "row": row_number, "keys": keys})
                        key = encoded(key_values).decode("utf-8")
                        cells = {name: sheet["cells"].get((col, row_number),
                                 NATIVE["blank_cell"](col, row_number, row_number in sheet["hidden"]))
                                 for name, col in cols}
                        record = {"row": row_number,
                                  "values": {name: None if tokens[name][0] == "null" else projected[name]
                                             for name in header},
                                  "cells": cells}
                        record_json = encoded(record).decode("utf-8")
                        try:
                            db.execute("INSERT INTO " + table + " VALUES (?,?,?,?)",
                                       (key, row_number, record_json, encoded(tokens).decode("utf-8")))
                        except sqlite3.IntegrityError:
                            previous = db.execute("SELECT row_number FROM " + table + " WHERE key=?", (key,)).fetchone()
                            fail("WORKBOOK_DUPLICATE_ROW_KEY",
                                 "Choose a unique key or composite key before comparing these editions.",
                                 {"side": table, "sheet": projection["sheet"], "firstRow": previous[0],
                                  "row": row_number, "keys": keys,
                                  "key": [{"type": specs[name]["type"], "text": projected[name]} for name in keys]})
                        observation.update(encoded(record))
                        observation.update(b"\n")
                        count += 1
                    if count != projection["rowCount"]:
                        fail("WORKBOOK_PROJECTION_CHANGED", "The complete projection row count changed.")
                    projection["observationSha256"] = observation.hexdigest()
                    projection["valueBasis"] = "original-reader CSV tokens and original-loader scalar coercion"
                    return projection
                finally:
                    csv_text.detach()
                    rows_text.detach()
        finally:
            workbook.zip.close()
            workbook.cache.clear()

def cell_value(cell):
    if cell is None:
        return None
    # Coordinates are represented independently as row/column movement. Style
    # table IDs can change between packages without changing the number format.
    return {key: cell.get(key) for key in ("type", "value", "raw", "present",
            "formula", "cachedPresent", "numberFormat", "dateStyle", "hiddenRow")}

def compare(request):
    baseline_schema = NATIVE["schema_columns"](request["baseline"]["config"])
    target_schema = NATIVE["schema_columns"](request["target"]["config"])
    before_specs = {x["name"]: x for x in baseline_schema}
    after_specs = {x["name"]: x for x in target_schema}
    keys = request.get("keys")
    if not isinstance(keys, list) or not 1 <= len(keys) <= 16 or any(not isinstance(x, str) for x in keys) or len(set(keys)) != len(keys):
        fail("WORKBOOK_ROW_KEYS_REQUIRED", "Choose 1–16 distinct declared public fields as row keys.")
    for name in keys:
        if name not in before_specs or name not in after_specs or before_specs[name]["type"] != after_specs[name]["type"]:
            fail("WORKBOOK_ROW_KEY_SCHEMA_CHANGED",
                 "Each row key must exist with the same original public type in both editions.", {"field": name})
    maximum = request.get("maxReportBytes", 128 * 1024 * 1024)
    if type(maximum) is not int or not 1 <= maximum <= LIMIT:
        fail("WORKBOOK_COMPARISON_CAPACITY", "Choose a comparison report limit within 256 MiB.")
    fields = list(before_specs) + [x for x in after_specs if x not in before_specs]
    counts = {kind: 0 for kind in ("added", "removed", "changed", "source", "moved", "unchanged", "ambiguous")}
    field_counts = {name: {"valueChanged": 0, "sourceChanged": 0} for name in fields}
    report_hash = hashlib.sha256()
    byte_count = emitted = positions = 0
    offsets = []
    with tempfile.TemporaryDirectory(prefix="sf30-workbook-comparison-") as directory:
        os.chmod(directory, 0o700)
        db_path = os.path.join(directory, "join.sqlite")
        with sqlite3.connect(db_path) as db:
            os.chmod(db_path, 0o600)
            db.execute("PRAGMA temp_store=FILE")
            db.execute("PRAGMA cache_size=-16384")
            for table in ("baseline", "target"):
                db.execute("CREATE TABLE " + table + " (key TEXT PRIMARY KEY COLLATE BINARY, row_number INTEGER NOT NULL, record TEXT NOT NULL, tokens TEXT NOT NULL) WITHOUT ROWID")
            baseline = project(db, "baseline", 3, request["baseline"], keys, directory)
            db.commit()
            gc.collect()
            target = project(db, "target", 4, request["target"], keys, directory)
            db.commit()
            gc.collect()
            query = """SELECT b.key,b.record,b.tokens,t.record,t.tokens
                       FROM baseline b LEFT JOIN target t ON b.key=t.key
                       UNION ALL
                       SELECT t.key,NULL,NULL,t.record,t.tokens
                       FROM target t LEFT JOIN baseline b ON t.key=b.key WHERE b.key IS NULL
                       ORDER BY 1"""
            with os.fdopen(os.dup(5), "wb") as output:
                for key, old_raw, old_tokens, new_raw, new_tokens in db.execute(query):
                    old = json.loads(old_raw) if old_raw is not None else None
                    new = json.loads(new_raw) if new_raw is not None else None
                    old_values = json.loads(old_tokens) if old_tokens is not None else {}
                    new_values = json.loads(new_tokens) if new_tokens is not None else {}
                    moved = bool(old and new and old["row"] != new["row"])
                    if moved:
                        positions += 1
                    changes = []
                    for field in fields:
                        left_cell = old["cells"].get(field) if old else None
                        right_cell = new["cells"].get(field) if new else None
                        value_changed = old_values.get(field, ["missing", ""]) != new_values.get(field, ["missing", ""])
                        source_changed = cell_value(left_cell) != cell_value(right_cell)
                        if value_changed or source_changed:
                            field_counts[field]["valueChanged"] += int(value_changed)
                            field_counts[field]["sourceChanged"] += int(source_changed)
                            changes.append({
                                "field": field,
                                "before": old["values"].get(field) if old else None,
                                "after": new["values"].get(field) if new else None,
                                "beforeCell": left_cell.get("cell") if left_cell else None,
                                "afterCell": right_cell.get("cell") if right_cell else None,
                                "valueChanged": value_changed, "sourceChanged": source_changed})
                    if old is None:
                        kind = "added"
                    elif new is None:
                        kind = "removed"
                    elif any(x["valueChanged"] for x in changes):
                        kind = "changed"
                    elif changes:
                        kind = "source"
                    elif moved:
                        kind = "moved"
                    else:
                        kind = "unchanged"
                    counts[kind] += 1
                    visible = new if new is not None else old
                    specs = after_specs if new is not None else before_specs
                    row = {"ordinal": emitted, "kind": kind,
                           "key": [{"type": specs[name]["type"], "text": visible["values"][name]} for name in keys],
                           "before": old, "after": new, "changes": changes, "moved": moved}
                    raw = encoded(row) + b"\n"
                    if byte_count + len(raw) > maximum:
                        fail("WORKBOOK_COMPARISON_CAPACITY",
                             "The complete cell-change report exceeds its retained limit. Narrow the original range or increase the configured comparison limit.",
                             {"maxReportBytes": maximum, "rowsCompared": sum(counts.values())})
                    if emitted % 256 == 0:
                        offsets.append({"ordinal": emitted, "offset": byte_count})
                    output.write(raw)
                    report_hash.update(raw)
                    byte_count += len(raw)
                    emitted += 1
                output.flush()
                os.fsync(output.fileno())
    return {"schema": "stellar-forge.workbook-edition-values.v1",
            "complete": True, "keys": keys, "columns": fields, "counts": counts,
            "positionsChanged": positions, "fieldCounts": field_counts,
            "rows": emitted, "rowBytes": byte_count, "rowsSha256": report_hash.hexdigest(),
            "rowOffsets": offsets, "baselineProjection": baseline, "targetProjection": target}

def main():
    if sys.version_info < (3, 10):
        raise RuntimeError("Python 3.10 or newer is required")
    request_raw = sys.stdin.buffer.read(2 * 1024 * 1024 + 1)
    if len(request_raw) > 2 * 1024 * 1024:
        raise ValueError("The comparison request exceeds 2 MiB")
    request = json.loads(request_raw)
    with os.fdopen(os.dup(6), "rb") as reader:
        reader.seek(0)
        reader_source = reader.read(256 * 1024 + 1)
    if len(reader_source) > 256 * 1024 or hashlib.sha256(reader_source).hexdigest() != request.get("parserSha256"):
        raise ValueError("The retained original reader does not match its identity")
    NATIVE["__name__"] = "stellar_forge_retained_workbook_reader"
    exec(compile(reader_source, "<retained-original-workbook-reader>", "exec"), NATIVE)
    csv.field_size_limit(NATIVE["LIMITS"]["cellChars"] * 2)
    if request.get("action") == "headers":
        return {"baseline": headers(3, request["baseline"]), "target": headers(4, request["target"])}
    if request.get("action") != "compare":
        fail("INVALID_WORKBOOK_ACTION", "Choose workbook headers or complete edition comparison.")
    return compare(request)

if __name__ == "__main__":
    try:
        result = main()
        sys.stdout.buffer.write(encoded({"ok": True, "result": result}) + b"\n")
    except Exception as error:
        known = hasattr(error, "code")
        sys.stdout.buffer.write(encoded({
            "ok": False, "error": error.code if known else "WORKBOOK_COMPARISON_FAILED",
            "message": str(error) if known else "The retained workbook comparison could not complete.",
            "details": getattr(error, "details", None)}) + b"\n")
        sys.exit(2)
