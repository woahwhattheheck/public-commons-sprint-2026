"""Complete, portable query results from the original customer DatasetDatabase.

Run ``python -m stellar_forge_buyer.query_export --help`` for the offline CLI.
"""
from __future__ import annotations

import argparse
import base64
from contextlib import ExitStack, contextmanager
from copy import deepcopy
from datetime import datetime, timezone
import csv
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import stat
import sys
import time

from .errors import BuyerError, StateError
from .storage import digest, dump, parse, private_directory, read, sync_directory, write as atomic_write

_SCHEMA = "stellar-forge.python-query-export.v1"
_REQUEST = "stellar-forge.python-query-request.v1"
_FILES = {"jsonl": "rows.jsonl", "csv": "rows.csv", "sqlite": "rows.sqlite3"}
_HEX = re.compile(r"[a-f0-9]{64}")
_ROW_LIMIT = 128 * 1024 * 1024
_MANIFEST_LIMIT = 16 * 1024 * 1024
_ORDINAL = "_sf_export_row"


def _json(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"), sort_keys=True)


def _encode(value):
    if isinstance(value, bytes):
        return {"$sqliteBlob": base64.b64encode(value).decode("ascii")}
    if type(value) is float and not math.isfinite(value):
        return {"$sqliteFloat": "Infinity" if value > 0 else "-Infinity" if value < 0 else "NaN"}
    if value is None or type(value) in (str, int, float, bool):
        return value
    raise StateError("QUERY_EXPORT_VALUE_INVALID")


def _decode(value):
    if isinstance(value, dict):
        if set(value) == {"$sqliteBlob"} and isinstance(value["$sqliteBlob"], str):
            try:
                return base64.b64decode(value["$sqliteBlob"], validate=True)
            except ValueError:
                pass
        if set(value) == {"$sqliteFloat"} and value["$sqliteFloat"] in ("Infinity", "-Infinity", "NaN"):
            return float(value["$sqliteFloat"])
        raise StateError("QUERY_EXPORT_TYPED_VALUE_INVALID")
    return _encode(value)


def _bindings(parameters, *, decode=False):
    convert = _decode if decode else _encode
    if isinstance(parameters, dict) and all(isinstance(key, str) for key in parameters):
        return {key: convert(value) for key, value in parameters.items()}
    if isinstance(parameters, (list, tuple)):
        return [convert(value) for value in parameters]
    raise StateError("QUERY_EXPORT_PARAMETERS_INVALID")


def _path(value):
    return Path(os.path.abspath(Path(value).expanduser()))


def _new_directory(destination):
    target = _path(destination)
    if private_directory(target.parent, create=False) != target.parent:
        raise StateError("QUERY_EXPORT_CANONICAL_PARENT_REQUIRED")
    try:
        target.mkdir(mode=0o700)
    except FileExistsError:
        raise StateError("QUERY_EXPORT_DESTINATION_EXISTS_USE_OPEN") from None
    sync_directory(target.parent)
    return target


def _cleanup(directory):
    # A completed record, including a lost final reply, is retained for reopen.
    if (directory / "manifest.json").exists():
        return
    for name in (*_FILES.values(), *("." + name + ".part" for name in _FILES.values()),
                 ".rows.sqlite3.part-journal"):
        try:
            (directory / name).unlink(missing_ok=True)
        except OSError:
            pass
    try:
        directory.rmdir()
        sync_directory(directory.parent)
    except OSError:
        pass  # Preserve any other files; never recursively remove this directory.


@contextmanager
def _private_file(path):
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, "rb") as stream:
            info = os.fstat(stream.fileno())
            if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                    or info.st_mode & 0o077 or info.st_uid != os.getuid()):
                raise StateError("QUERY_EXPORT_PRIVATE_FILE_REQUIRED")
            yield stream
    except OSError as exc:
        raise StateError("QUERY_EXPORT_FILE_UNAVAILABLE") from exc


def _file_record(path):
    checksum, total = hashlib.sha256(), 0
    with _private_file(path) as source:
        while chunk := source.read(1024 * 1024):
            checksum.update(chunk)
            total += len(chunk)
    return {"bytes": total, "sha256": checksum.hexdigest()}


def _columns(columns, *, sqlite=False):
    if (not columns or any(not isinstance(name, str) or not name
            or len(name.encode("utf-8")) > 512 or any(ord(c) < 32 for c in name) for name in columns)
            or len(set(columns)) != len(columns)):
        raise StateError("QUERY_EXPORT_COLUMN_NAMES_REQUIRE_UNIQUE_ALIASES")
    if sqlite and (len({name.lower() for name in columns}) != len(columns)
                   or _ORDINAL in {name.lower() for name in columns} or len(columns) > 1999):
        raise StateError("QUERY_EXPORT_SQLITE_COLUMNS_REQUIRE_ALIASES")


def _quoted(name):
    return '"' + name.replace('"', '""') + '"'


def _csv_value(value, safe):
    if isinstance(value, bytes):
        return "base64:" + base64.b64encode(value).decode("ascii")
    if isinstance(value, str) and safe and (value.startswith(("\t", "\r", "\n"))
            or value.lstrip(" \t\r\n").startswith(("=", "+", "-", "@"))):
        return "'" + value
    return value


def export_query(database, sql, parameters=(), *, destination, formats=("jsonl", "csv", "sqlite"),
                 expected_views=None, timeout=300, cancel=None, max_rows=None,
                 max_output_bytes=None, spreadsheet_safe=True, progress=None):
    """Export every result row once; errors never publish a complete manifest.

    The query is read-only and uses the existing DatasetDatabase reader. A
    caller may set whole-output limits; reaching one raises instead of silently
    truncating the result. Limits apply to the complete selected output set.
    """
    if (not isinstance(formats, (list, tuple)) or not formats
            or any(not isinstance(value, str) or value not in _FILES for value in formats) or len(set(formats)) != len(formats)
            or any(value is not None and (type(value) is not int or value < 1)
                   for value in (max_rows, max_output_bytes))
            or type(spreadsheet_safe) is not bool or progress is not None and not callable(progress)):
        raise StateError("QUERY_EXPORT_OPTIONS_INVALID")
    formats = tuple(formats)
    parameters = _bindings(_bindings(parameters), decode=True)  # Copy and validate before entering SQL.
    encoded_parameters = _bindings(parameters)
    target = _new_directory(destination)
    started = time.monotonic()
    output_db = None
    try:
        with ExitStack() as stack, database.stream_query(sql, parameters, timeout=timeout,
                expected_views=expected_views, cancel=cancel) as rows:
            _columns(rows.columns, sqlite="sqlite" in formats)
            handles = {}
            hashes = {}
            lengths = {}
            sqlite_bytes = 0
            for kind in formats:
                name = _FILES[kind]
                fd = os.open(target / ("." + name + ".part"), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                if kind == "sqlite":
                    os.close(fd)
                    output_db = sqlite3.connect((target / ("." + name + ".part")).as_uri() + "?mode=rw", uri=True)
                    output_db.execute("PRAGMA synchronous=FULL")
                    output_db.execute("PRAGMA cache_size=-2048")
                    output_db.execute("PRAGMA application_id=1397117272")
                    output_db.execute("PRAGMA user_version=1")
                    output_db.execute("BEGIN IMMEDIATE")
                    output_db.execute(f"CREATE TABLE result({_quoted(_ORDINAL)} INTEGER PRIMARY KEY,"
                                      + ",".join(_quoted(column) for column in rows.columns) + ")")
                    insert = "INSERT INTO result VALUES(" + ",".join("?" for _ in range(len(rows.columns) + 1)) + ")"
                else:
                    handles[kind] = stack.enter_context(os.fdopen(fd, "wb"))
                    hashes[kind] = hashlib.sha256()
                    lengths[kind] = 0
            csv_buffer = io.StringIO(newline="")
            csv_writer = csv.writer(csv_buffer, lineterminator="\n")

            def check_size():
                if max_output_bytes is not None and sum(lengths.values()) + sqlite_bytes > max_output_bytes:
                    raise StateError("QUERY_EXPORT_OUTPUT_LIMIT_EXCEEDED")

            def write(kind, raw):
                lengths[kind] += len(raw)
                check_size()
                handles[kind].write(raw)
                hashes[kind].update(raw)

            def write_csv(values):
                csv_buffer.seek(0)
                csv_buffer.truncate()
                csv_writer.writerow(values)
                write("csv", csv_buffer.getvalue().encode("utf-8"))

            if "csv" in formats:
                write_csv([_csv_value(column, spreadsheet_safe) for column in rows.columns])
            count = 0
            for values in rows:
                if max_rows is not None and count == max_rows:
                    raise StateError("QUERY_EXPORT_ROW_LIMIT_EXCEEDED")
                if "jsonl" in formats:
                    write("jsonl", (_json(dict(zip(rows.columns, map(_encode, values)))) + "\n").encode("utf-8"))
                if "csv" in formats:
                    write_csv([_csv_value(value, spreadsheet_safe) for value in values])
                if output_db is not None:
                    output_db.execute(insert, (count + 1, *values))
                count += 1
                if count % 4096 == 0:
                    if output_db is not None:
                        sqlite_bytes = output_db.execute("PRAGMA page_count").fetchone()[0] * output_db.execute("PRAGMA page_size").fetchone()[0]
                    check_size()
                    if progress:
                        progress({"rows": count, "outputBytes": sum(lengths.values()) + sqlite_bytes, "complete": False})
            binding = {"database": str(database.path), "sql": sql, "parameters": encoded_parameters,
                       "views": rows.views, "readTables": list(rows.read_tables), "sourceVersions": rows.source_versions()}
            binding_sha = digest(_json(binding).encode("utf-8"))
            if output_db is not None:
                output_db.execute("CREATE TABLE export_metadata(record TEXT NOT NULL)")
                output_db.execute("INSERT INTO export_metadata VALUES(?)", (_json({"schema": _SCHEMA,
                    "bindingSha256": binding_sha, "columns": list(rows.columns), "rowCount": count,
                    "orderColumn": _ORDINAL}),))
                output_db.commit()
                output_db.close()
                output_db = None
            for handle in handles.values():
                handle.flush()
                os.fsync(handle.fileno())
            manifest = {"schema": _SCHEMA, "queryComplete": rows.complete,
                        "rowCount": count, "columns": list(rows.columns), "binding": binding,
                        "bindingSha256": binding_sha, "createdAt": datetime.now(timezone.utc).isoformat(),
                        "elapsedMs": round((time.monotonic() - started) * 1000),
                        "largestRowBytes": rows.largest_row_bytes,
                        "jsonlEncoding": "sqlite-scalars-v1", "sqliteOrderColumn": _ORDINAL,
                        "csv": {"spreadsheetSafe": spreadsheet_safe, "null": "empty field", "blob": "base64: prefix"},
                        "outputs": {}}
            rows.check()
        # The original snapshot is released before file hashing/publication.
        for kind in formats:
            name = _FILES[kind]
            temporary = target / ("." + name + ".part")
            if kind == "sqlite":
                with _private_file(temporary) as source:
                    os.fsync(source.fileno())
                record = _file_record(temporary)
            else:
                record = {"bytes": lengths[kind], "sha256": hashes[kind].hexdigest()}
            manifest["outputs"][name] = record
        total = sum(record["bytes"] for record in manifest["outputs"].values())
        if max_output_bytes is not None and total > max_output_bytes:
            raise StateError("QUERY_EXPORT_OUTPUT_LIMIT_EXCEEDED")
        if cancel is not None and cancel():
            raise StateError("DATASET_SQL_QUERY_CANCELLED")
        for name in manifest["outputs"]:
            os.rename(target / ("." + name + ".part"), target / name)
        sync_directory(target)
        manifest_raw = (_json(manifest) + "\n").encode("utf-8")
        if len(manifest_raw) > _MANIFEST_LIMIT:
            raise StateError("QUERY_EXPORT_MANIFEST_TOO_LARGE")
        atomic_write(target / "manifest.json", manifest_raw, exclusive=True)
        result = QueryExport(target)
        if progress:
            progress({"rows": count, "outputBytes": total, "complete": True})
        return result
    except BaseException:
        if output_db is not None:
            output_db.close()
        _cleanup(target)
        raise


class QueryExport:
    """Reopen/copy a completed result without its source database or runtime."""

    def __init__(self, directory):
        self.directory = _path(directory)
        if private_directory(self.directory, create=False) != self.directory:
            raise StateError("QUERY_EXPORT_CANONICAL_DIRECTORY_REQUIRED")
        try:
            with _private_file(self.directory / "manifest.json") as source:
                raw = source.read(_MANIFEST_LIMIT + 1)
        except StateError as exc:
            raise StateError("QUERY_EXPORT_MANIFEST_UNAVAILABLE_OR_INCOMPLETE") from exc
        if len(raw) > _MANIFEST_LIMIT:
            raise StateError("QUERY_EXPORT_MANIFEST_TOO_LARGE")
        value = parse(raw)
        if (not isinstance(value, dict) or value.get("schema") != _SCHEMA or value.get("queryComplete") is not True
                or type(value.get("rowCount")) is not int or value["rowCount"] < 0
                or not isinstance(value.get("columns"), list) or not isinstance(value.get("binding"), dict)
                or value.get("bindingSha256") != digest(_json(value["binding"]).encode("utf-8"))
                or not isinstance(value.get("outputs"), dict) or not value["outputs"]
                or set(value["outputs"]) - set(_FILES.values())):
            raise StateError("QUERY_EXPORT_MANIFEST_INVALID")
        _columns(value["columns"], sqlite="rows.sqlite3" in value["outputs"])
        for record in value["outputs"].values():
            if (not isinstance(record, dict) or type(record.get("bytes")) is not int or record["bytes"] < 0
                    or not isinstance(record.get("sha256"), str) or not _HEX.fullmatch(record["sha256"])):
                raise StateError("QUERY_EXPORT_OUTPUT_METADATA_INVALID")
        self._manifest = value
        self._raw = raw

    @property
    def manifest(self):
        return deepcopy(self._manifest)

    @contextmanager
    def open(self, name):
        record = self._manifest["outputs"].get(name)
        if record is None:
            raise StateError("QUERY_EXPORT_OUTPUT_NOT_SELECTED")
        if private_directory(self.directory, create=False) != self.directory:
            raise StateError("QUERY_EXPORT_DIRECTORY_CHANGED")
        with _private_file(self.directory / name) as source:
            if os.fstat(source.fileno()).st_size != record["bytes"]:
                raise StateError("QUERY_EXPORT_FILE_CHANGED")
            checksum, total = hashlib.sha256(), 0
            while chunk := source.read(1024 * 1024):
                total += len(chunk)
                if total > record["bytes"]:
                    raise StateError("QUERY_EXPORT_FILE_CHANGED")
                checksum.update(chunk)
            if total != record["bytes"] or checksum.hexdigest() != record["sha256"]:
                raise StateError("QUERY_EXPORT_FILE_CHANGED")
            source.seek(0)
            yield source

    def inspect(self):
        for name in self._manifest["outputs"]:
            with self.open(name):
                pass
        return self.manifest

    def rows(self):
        columns = self._manifest["columns"]
        count = 0
        with self.open("rows.jsonl") as source:
            while raw := source.readline(_ROW_LIMIT + 1):
                if len(raw) > _ROW_LIMIT or not raw.endswith(b"\n"):
                    raise StateError("QUERY_EXPORT_ROW_FORMAT_INVALID")
                row = parse(raw)
                if not isinstance(row, dict) or set(row) != set(columns):
                    raise StateError("QUERY_EXPORT_ROW_COLUMNS_INVALID")
                count += 1
                if count > self._manifest["rowCount"]:
                    raise StateError("QUERY_EXPORT_ROW_COUNT_CHANGED")
                yield {name: _decode(row[name]) for name in columns}
        if count != self._manifest["rowCount"]:
            raise StateError("QUERY_EXPORT_ROW_COUNT_CHANGED")

    def copy_to(self, destination):
        """Create a verified portable private copy; the original SQL is not run."""
        target = _new_directory(destination)
        try:
            for name in self._manifest["outputs"]:
                with self.open(name) as source:
                    fd = os.open(target / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                    with os.fdopen(fd, "wb") as output:
                        checksum, total = hashlib.sha256(), 0
                        while chunk := source.read(1024 * 1024):
                            total += len(chunk)
                            checksum.update(chunk)
                            output.write(chunk)
                        record = self._manifest["outputs"][name]
                        if total != record["bytes"] or checksum.hexdigest() != record["sha256"]:
                            raise StateError("QUERY_EXPORT_FILE_CHANGED")
                        output.flush()
                        os.fsync(output.fileno())
            # Publish the exact manifest bytes so transfer retains its identity.
            atomic_write(target / "manifest.json", self._raw, exclusive=True)
            return QueryExport(target)
        except BaseException:
            _cleanup(target)
            raise


def prepare_query(database, sql, parameters=(), *, destination, preview_rows=20, timeout=10):
    """Retain query text, bindings, reviewed views and a native preview."""
    bindings = _bindings(parameters)
    preview = database.query(sql, _bindings(bindings, decode=True), max_rows=preview_rows,
                             max_result_bytes=1024 * 1024, timeout=timeout)
    request = {"schema": _REQUEST, "database": str(database.directory), "sql": sql,
               "parameters": bindings, "expectedViews": list(preview.views),
               "preview": {"columns": list(preview.columns), "rows": [[_encode(v) for v in row] for row in preview.rows],
                           "truncated": preview.truncated}}
    path = _path(destination)
    if private_directory(path.parent, create=False) != path.parent:
        raise StateError("QUERY_EXPORT_CANONICAL_PARENT_REQUIRED")
    dump(path, request, exclusive=True)
    return request


def main(argv=None):
    parser = argparse.ArgumentParser(description="Review, export and reopen complete local customer SQL results.")
    commands = parser.add_subparsers(dest="command", required=True)
    prepare = commands.add_parser("prepare", help="Save SQL, typed bindings, native preview and exact selected views")
    prepare.add_argument("--database", required=True)
    prepare.add_argument("--sql-file", required=True)
    prepare.add_argument("--parameters-file")
    prepare.add_argument("--out", required=True)
    run = commands.add_parser("run", help="Export a saved reviewed query into a new private directory")
    run.add_argument("--request", required=True)
    run.add_argument("--out", required=True)
    run.add_argument("--formats", default="jsonl,csv,sqlite")
    run.add_argument("--timeout", type=float, default=300)
    run.add_argument("--max-rows", type=int)
    run.add_argument("--max-output-bytes", type=int)
    run.add_argument("--literal-csv", action="store_true")
    inspect = commands.add_parser("inspect", help="Verify and inspect an existing export, independently of its source")
    inspect.add_argument("--directory", required=True)
    copy = commands.add_parser("copy", help="Copy a verified export without querying or purchasing again")
    copy.add_argument("--directory", required=True)
    copy.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "prepare":
            from .sqlite_dataset import DatasetDatabase
            database = DatasetDatabase(args.database, create=False)
            sql = read(_path(args.sql_file), 1024 * 1024).decode("utf-8")
            parameters = parse(read(_path(args.parameters_file), 1024 * 1024)) if args.parameters_file else []
            result = prepare_query(database, sql, _bindings(parameters, decode=True), destination=args.out)
        elif args.command == "run":
            from .sqlite_dataset import DatasetDatabase
            with _private_file(_path(args.request)) as source:
                raw = source.read(_MANIFEST_LIMIT + 1)
            if len(raw) > _MANIFEST_LIMIT:
                raise StateError("QUERY_EXPORT_REQUEST_TOO_LARGE")
            request = parse(raw)
            if (not isinstance(request, dict) or request.get("schema") != _REQUEST
                    or not isinstance(request.get("expectedViews"), list)):
                raise StateError("QUERY_EXPORT_REQUEST_INVALID")
            database = DatasetDatabase(request["database"], create=False)
            result = export_query(database, request["sql"], _bindings(request["parameters"], decode=True),
                destination=args.out, expected_views=request["expectedViews"], formats=args.formats.split(","),
                timeout=args.timeout, max_rows=args.max_rows, max_output_bytes=args.max_output_bytes,
                spreadsheet_safe=not args.literal_csv).manifest
        elif args.command == "copy":
            result = QueryExport(args.directory).copy_to(args.out).inspect()
        else:
            result = QueryExport(args.directory).inspect()
        print(_json(result))
        return 0
    except BuyerError as exc:
        print(_json({"error": exc.code}), file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print(_json({"error": "QUERY_EXPORT_INTERRUPTED"}), file=sys.stderr)
        return 130
    except (OSError, sqlite3.Error, ValueError, KeyError, TypeError) as exc:
        print(_json({"error": "QUERY_EXPORT_FAILED", "kind": type(exc).__name__}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
