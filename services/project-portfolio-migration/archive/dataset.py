"""Streaming relational export and original-dataset SQL for portfolio archives."""
from __future__ import annotations

from contextlib import contextmanager
import csv
from decimal import Decimal
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import time
import uuid

from portfolio.storage import canonical, file_identity, require
from .measures import CONTRIBUTION_HEADERS, TOTAL_HEADERS, decimal_value, exact_sum
from .projection import table_headers
from .timephased_contract import PRIMARY as TIMEPHASED_PRIMARY

EXTRA_HEADERS = {
    "measure_totals": list(TOTAL_HEADERS),
    "measure_contributions": list(CONTRIBUTION_HEADERS),
}
PRIMARY = {
    "projects": ("entity_id",), "tasks": ("entity_id",), "resources": ("entity_id",),
    "assignments": ("entity_id",), "dependencies": ("entity_id",), "calendars": ("entity_id",),
    "relationships": ("relationship_id",), "fields": ("entity_id", "capture", "field"),
    "field_definitions": ("project_key", "edition_id", "family", "field"),
    "measure_totals": ("metric_id",),
    "companion_sources": ("capture_id",), "companion_columns": ("capture_id", "column_key"),
    "companion_rows": ("companion_row_id",), "companion_cells": ("companion_row_id", "column_key"),
    "companion_links": ("link_id",),
    "measure_contributions": ("project_key", "edition_id", "family", "source_key", "metric"),
}
PRIMARY.update(TIMEPHASED_PRIMARY)
FUNCTIONS = frozenset({
    "abs", "coalesce", "ifnull", "nullif", "lower", "upper", "length", "substr", "substring",
    "trim", "ltrim", "rtrim", "replace", "instr", "like", "glob", "count", "min", "max",
    "decimal_sum", "group_concat", "typeof", "json_extract", "json_type", "json_valid",
    "row_number", "rank", "dense_rank", "lag", "lead",
})


def quoted(value):
    return '"' + value.replace('"', '""') + '"'


def all_headers(profile):
    return {**table_headers(profile), **EXTRA_HEADERS}


def normalized_row(headers, table, row):
    require(table in headers and set(row) <= set(headers[table]),
            "archive_row_columns", "A projected row names undeclared report columns.", table)
    return {name: None if row.get(name) is None else str(row[name]) for name in headers[table]}


class RowSummary:
    def __init__(self, headers):
        self.headers = headers
        self.counts = {name: 0 for name in headers}
        self.hashes = {name: hashlib.sha256(canonical(columns) + b"\n") for name, columns in headers.items()}

    def emit(self, table, row):
        values = normalized_row(self.headers, table, row)
        self.hashes[table].update(canonical([values[name] for name in self.headers[table]]) + b"\n")
        self.counts[table] += 1
        return values

    def value(self):
        return {"tables": dict(self.counts), "table_sha256": {name: value.hexdigest() for name, value in self.hashes.items()},
                "columns": dict(self.headers)}


class RelationalWriter:
    """Write CSV and SQLite in one traversal of the complete original projection."""
    def __init__(self, directory, profile):
        self.root = Path(directory)
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.csv_root = self.root / "tables"
        self.csv_root.mkdir(exist_ok=True, mode=0o700)
        self.headers = all_headers(profile)
        self.paths, self.streams, self.writers = {}, {}, {}
        self.summary = RowSummary(self.headers)
        self.counts = self.summary.counts
        self.database_path = self.root / ("." + uuid.uuid4().hex + ".sqlite")
        self.connection = sqlite3.connect(self.database_path)
        os.chmod(self.database_path, 0o600)
        self.connection.execute("PRAGMA journal_mode=DELETE")
        self.connection.execute("PRAGMA synchronous=FULL")
        self.closed = False
        try:
            for table, headers in self.headers.items():
                require(len(headers) == len(set(headers)), "archive_columns", "Retain distinct original report column names.")
                fields = [quoted(name) + " TEXT" for name in headers]
                if table in PRIMARY:
                    fields.append("PRIMARY KEY (" + ", ".join(quoted(name) for name in PRIMARY[table]) + ")")
                self.connection.execute("CREATE TABLE " + quoted(table) + " (" + ", ".join(fields) + ")")
                path = self.csv_root / ("." + table + "." + uuid.uuid4().hex + ".csv")
                stream = open(path, "x", encoding="utf-8", newline="")
                os.chmod(path, 0o600)
                writer = csv.DictWriter(stream, fieldnames=headers, lineterminator="\r\n", extrasaction="raise")
                writer.writeheader()
                self.paths[table], self.streams[table], self.writers[table] = path, stream, writer
            self.connection.execute("BEGIN")
        except BaseException:
            self.close()
            raise

    def emit(self, table, row):
        require(not self.closed and table in self.headers, "archive_table", "Select an original relational report table.")
        headers = self.headers[table]
        require(set(row) <= set(headers), "archive_row_columns", "A projected row names undeclared report columns.",
                {"table": table, "columns": sorted(set(row) - set(headers))})
        values = self.summary.emit(table, row)
        self.writers[table].writerow(values)
        self.connection.execute("INSERT INTO " + quoted(table) + " VALUES (" + ",".join("?" for _ in headers) + ")",
                                [values[name] for name in headers])

    def finish(self, sink):
        require(not self.closed, "archive_writer_closed", "The original report writer has already closed.")
        try:
            for table, headers in self.headers.items():
                if "project_key" in headers:
                    self.connection.execute("CREATE INDEX " + quoted(table + "_project") + " ON " + quoted(table) + " (project_key)")
                if table == "relationships":
                    self.connection.execute("CREATE INDEX relationship_target ON relationships (target_entity_id)")
                if table == "fields":
                    self.connection.execute("CREATE INDEX field_lookup ON fields (family, field)")
                stream = self.streams[table]
                stream.flush()
                os.fsync(stream.fileno())
                stream.close()
            self.connection.commit()
            check = self.connection.execute("PRAGMA integrity_check").fetchall()
            require(check == [("ok",)], "archive_sqlite_integrity", "The original complete reporting database failed integrity verification.", check)
            self.connection.close()
            self.closed = True
            for table, source in self.paths.items():
                sink.add_file("tables/" + table + ".csv", source, file_identity(source),
                              role="table_csv", table=table, rows=self.counts[table], columns=self.headers[table])
            sink.add_file("portfolio.sqlite", self.database_path, file_identity(self.database_path),
                          role="relational_database", tables=self.counts, columns=self.headers)
            return self.summary.value()
        finally:
            self.close()

    def close(self):
        if not self.closed:
            for stream in self.streams.values():
                if not stream.closed:
                    stream.close()
            self.connection.close()
            self.closed = True


class DecimalSum:
    def __init__(self):
        self.total = None

    def step(self, value):
        if value is None:
            return
        selected = decimal_value(value)
        self.total = selected if self.total is None else Decimal(exact_sum([self.total, selected]))

    def finalize(self):
        return None if self.total is None else format(self.total, "f")


@contextmanager
def query_connection(path, tables, *, deadline_seconds=30, stopped=None):
    """One read-only connection to an exact completed relational publication."""
    path = Path(path).resolve(strict=True)
    connection = sqlite3.connect(path.as_uri() + "?mode=ro&immutable=1", uri=True)
    connection.create_aggregate("decimal_sum", 1, DecimalSum)
    connection.execute("PRAGMA query_only=ON")
    if hasattr(connection, "setlimit"):
        connection.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, 64 * 1024 * 1024)
        connection.setlimit(sqlite3.SQLITE_LIMIT_SQL_LENGTH, 64 * 1024)
    deadline = time.monotonic() + deadline_seconds
    permitted_tables = set(tables)

    def authorize(action, first, second, database, trigger):
        if action in (sqlite3.SQLITE_SELECT, getattr(sqlite3, "SQLITE_RECURSIVE", -100)):
            return sqlite3.SQLITE_OK
        if action == sqlite3.SQLITE_READ:
            return sqlite3.SQLITE_OK if first in permitted_tables and database == "main" else sqlite3.SQLITE_DENY
        if action == sqlite3.SQLITE_FUNCTION:
            return sqlite3.SQLITE_OK if (second or first or "").lower() in FUNCTIONS else sqlite3.SQLITE_DENY
        return sqlite3.SQLITE_DENY

    connection.set_authorizer(authorize)
    connection.set_progress_handler(lambda: int(time.monotonic() >= deadline or stopped is not None and stopped()), 10000)
    try:
        yield connection
    finally:
        connection.close()


def checked_query(sql, parameters):
    require(isinstance(sql, str) and 0 < len(sql) <= 64000 and re.match(r"\s*(SELECT|WITH)\b", sql, re.I),
            "archive_query", "Use one read-only SELECT or WITH statement over the retained archive tables.")
    require(isinstance(parameters, list) and len(parameters) <= 256
            and all(value is None or isinstance(value, str) for value in parameters),
            "archive_query_parameters", "Pass explicit text or null parameters for the original TEXT columns.")
    return sql, parameters


def result_columns(cursor):
    columns = [item[0] for item in cursor.description or []]
    require(columns and len(columns) <= 512 and len(set(columns)) == len(columns),
            "archive_query_columns", "Give each returned column a distinct alias, with at most 512 columns.")
    return columns


def query_page(path, tables, sql, parameters=None, *, limit=100, stopped=None):
    require(type(limit) is int and 1 <= limit <= 250, "archive_query_limit", "Preview 1 to 250 exact query rows.")
    sql, parameters = checked_query(sql, [] if parameters is None else parameters)
    with query_connection(path, tables, stopped=stopped) as connection:
        cursor = connection.execute(sql, parameters)
        columns = result_columns(cursor)
        rows = cursor.fetchmany(limit + 1)
    return {"columns": columns, "rows": [list(row) for row in rows[:limit]],
            "has_more": len(rows) > limit, "preview_limit": limit, "sql": sql, "parameters": parameters}


def export_query(path, tables, sql, parameters, destination, *, stopped=None):
    sql, parameters = checked_query(sql, parameters)
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = destination.parent / ("." + destination.name + "." + uuid.uuid4().hex + ".incoming")
    count = 0
    try:
        with query_connection(path, tables, deadline_seconds=120, stopped=stopped) as connection:
            cursor = connection.execute(sql, parameters)
            columns = result_columns(cursor)
            with open(temporary, "x", encoding="utf-8", newline="") as output:
                os.chmod(temporary, 0o600)
                writer = csv.writer(output, lineterminator="\r\n")
                writer.writerow(columns)
                while True:
                    rows = cursor.fetchmany(1000)
                    if not rows:
                        break
                    writer.writerows(rows)
                    count += len(rows)
                output.flush()
                os.fsync(output.fileno())
        # The saved request owns this output. An interrupted temporary is never
        # exposed as a completed CSV; exact retained completion is reused above.
        os.replace(temporary, destination)
        return {"rows": count, "columns": columns, **file_identity(destination), "path": str(destination)}
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass
