#!/usr/bin/env python3
"""Read catalog metadata through the original immutable DuckDB worker policy."""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import sys


PAGE_SIZE = 32
COLUMN_LIMIT = 256
RESULT_LIMIT = 2 * 1024 * 1024
RELATION_LIMIT = 128 * 1024
SAFE_ERRORS = {"CONFIG_INVALID", "DUCKDB_NOT_INSTALLED", "DATASET_CHANGED",
               "CATALOG_CURSOR_INVALID", "CATALOG_METADATA_UNAVAILABLE"}


def original_worker():
    source = Path(__file__).resolve().parent.parent / "worker.py"
    spec = importlib.util.spec_from_file_location("sf30_original_duckdb_worker", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def describe_parquet(connection, filename):
    # The filename is selected from the original normalized declaration. The
    # original connection grants only those individually approved local paths.
    rows = connection.execute("DESCRIBE SELECT * FROM read_parquet(?)", [filename]).fetchmany(COLUMN_LIMIT + 1)
    return [{"name": str(row[0]), "type": str(row[1]), "nullable": row[2] != "NO"}
            for row in rows[:COLUMN_LIMIT]], len(rows) > COLUMN_LIMIT


def run(source, offset):
    native = original_worker()
    config = native.read_config(source)
    native.unchanged(config)
    os.chdir(config["baseDirectory"])
    connection, version = native.connect(config)
    try:
        scope = "table_catalog = current_database() AND table_schema NOT IN ('information_schema', 'pg_catalog')"
        table_count = int(connection.execute("SELECT count(*) FROM information_schema.tables WHERE " + scope).fetchone()[0])
        total = table_count + len(config["parquetFiles"])
        if offset < 0 or offset > total:
            raise ValueError("CATALOG_CURSOR_INVALID")
        table_rows = []
        if offset < table_count:
            table_rows = connection.execute(
                "SELECT table_catalog, table_schema, table_name, table_type FROM information_schema.tables WHERE " + scope +
                " ORDER BY table_catalog, table_schema, table_name LIMIT ? OFFSET ?", [PAGE_SIZE, offset]).fetchall()
        candidates = []
        for catalog, namespace, name, kind in table_rows:
            candidates.append({"kind": "view" if kind == "VIEW" else "table", "catalog": catalog,
                               "namespace": namespace, "name": name})
        parquet_offset = max(0, offset - table_count)
        for filename in config["parquetFiles"][parquet_offset:parquet_offset + PAGE_SIZE - len(candidates)]:
            relative = str(Path(filename).relative_to(config["baseDirectory"]))
            candidates.append({"kind": "parquet", "catalog": None, "namespace": None,
                               "name": relative, "file": relative})

        relations, consumed = [], 0
        for candidate in candidates:
            if candidate["kind"] == "parquet":
                columns, truncated = describe_parquet(connection, str(Path(config["baseDirectory"]) / candidate["file"]))
            else:
                rows = connection.execute(
                    "SELECT column_name, data_type, is_nullable FROM information_schema.columns "
                    "WHERE table_catalog = ? AND table_schema = ? AND table_name = ? "
                    "ORDER BY ordinal_position LIMIT ?",
                    [candidate["catalog"], candidate["namespace"], candidate["name"], COLUMN_LIMIT + 1]).fetchall()
                columns = [{"name": str(row[0]), "type": str(row[1]), "nullable": row[2] != "NO"}
                           for row in rows[:COLUMN_LIMIT]]
                truncated = len(rows) > COLUMN_LIMIT
            relation = {**candidate, "columns": columns, "columnsTruncated": truncated}
            if len(encoded(relation).encode("utf-8")) > RELATION_LIMIT:
                relation = {**candidate, "columns": [], "columnsTruncated": True,
                            "unavailable": "CATALOG_RELATION_METADATA_LIMIT"}
            if relations and len(encoded(relations + [relation]).encode("utf-8")) > RESULT_LIMIT - 8192:
                break
            relations.append(relation)
            consumed += 1
        native.unchanged(config)
        next_offset = offset + consumed
        result = {"ok": True, "schema": "stellar-forge.duckdb-catalog-native.v1", "engineVersion": version,
                  "relations": relations, "totalRelations": total, "offset": offset,
                  "nextOffset": next_offset if next_offset < total else None,
                  "columnLimit": COLUMN_LIMIT}
        output = encoded(result)
        if len(output.encode("utf-8")) > RESULT_LIMIT:
            raise ValueError("CATALOG_METADATA_UNAVAILABLE")
        print(output)
        return 0
    finally:
        connection.close()


def main():
    parser = argparse.ArgumentParser(description="Original DuckDB source metadata for the local merchant workbench")
    parser.add_argument("--source", required=True)
    parser.add_argument("--offset", type=int, default=0)
    args = parser.parse_args()
    try:
        return run(Path(args.source).resolve(), args.offset)
    except Exception as issue:
        code = str(issue)
        print(encoded({"ok": False, "error": code if code in SAFE_ERRORS else "CATALOG_METADATA_UNAVAILABLE"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
