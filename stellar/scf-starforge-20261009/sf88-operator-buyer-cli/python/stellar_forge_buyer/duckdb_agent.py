"""Native DuckDB operator identity, catalog and sparse receiving helpers.

These helpers use the original workspace connection/lock and retained records.
They do not provide another query engine or a second operation controller.
"""
from __future__ import annotations

import errno
import os
from pathlib import Path
import re
import secrets

from .errors import StateError
from .storage import digest, parse, read

_ID = re.compile(r"[0-9a-f]{32}")


def initialize_identity(db):
    db.execute("INSERT INTO sf_workspace VALUES('workspace_id',?) ON CONFLICT DO NOTHING",
               [secrets.token_hex(16)])
    return read_identity(db)


def read_identity(db):
    row = db.execute("SELECT value FROM sf_workspace WHERE key='workspace_id'").fetchone()
    if not row or not isinstance(row[0], str) or not _ID.fullmatch(row[0]):
        raise StateError("DUCKDB_WORKSPACE_IDENTITY_INVALID")
    return row[0]


def identity(operator):
    with operator.mutex:
        return {
            **operator.workspace.identity(),
            "directory": str(operator.directory),
            "engine": "DuckDB",
            "export_root": str(operator.export_root.expanduser().resolve()),
            "handoff_root": str(operator.handoff_root.expanduser().resolve()),
        }


def catalog(operator, kind, *, offset=0, limit=25):
    if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 100:
        raise StateError("DUCKDB_OPERATOR_CATALOG_PAGE_INVALID")
    with operator.mutex:
        if kind in {"reviews", "queries", "exports"}:
            values = getattr(operator.workspace, kind)()
            rows = values.get(kind, []) if isinstance(values, dict) else values
        elif kind == "views":
            rows = operator.workspace.views()
        elif kind == "handoffs":
            rows = operator._handoff_rows()
        elif kind == "operations":
            rows = operator.operation_records()
        else:
            raise StateError("DUCKDB_OPERATOR_CATALOG_NOT_FOUND")
        if offset > len(rows):
            raise StateError("DUCKDB_OPERATOR_CATALOG_PAGE_INVALID")
        selected = rows[offset:offset + limit]
        return {kind: selected, "offset": offset, "total": len(rows),
                "next_offset": offset + len(selected) if offset + len(selected) < len(rows) else None}


def request_record(operator, request_id):
    request_id = operator._request_id(request_id)
    with operator.mutex:
        original = parse(read(operator.requests / (request_id + ".request.json"), 1024 * 1024))
        if original.get("request_id") != request_id:
            raise StateError("DUCKDB_OPERATOR_ORIGINAL_REQUEST_CHANGED")
        status_path = operator.requests / (request_id + ".status.json")
        status = parse(read(status_path, 16 * 1024 * 1024)) if status_path.exists() else {"state": "PREPARED"}
        return {**original, **status}


def check_report(body, expected):
    """Bind an agent's host-selected report to its exact original bytes."""
    if not isinstance(expected, str) or not re.fullmatch(r"[0-9a-f]{64}", expected):
        raise StateError("DUCKDB_OPERATOR_SOURCE_SHA256_REQUIRED")
    if not isinstance(body, dict) or not isinstance(body.get("report_path"), str):
        raise StateError("DUCKDB_OPERATOR_REPORT_PATH_REQUIRED")
    if digest(read(Path(body["report_path"]), 8 * 1024 * 1024)) != expected:
        raise StateError("DUCKDB_OPERATOR_REVIEWED_REPORT_CHANGED")


def copy_sparse(source, target, chunk_size=1024 * 1024):
    """Copy exact logical bytes while preserving native holes or zero blocks."""
    size = os.fstat(source.fileno()).st_size
    position = 0
    unsupported = {errno.EINVAL, errno.ENOSYS, errno.ENOTSUP, errno.EOPNOTSUPP}
    if hasattr(os, "SEEK_DATA") and hasattr(os, "SEEK_HOLE"):
        try:
            while position < size:
                try:
                    start = os.lseek(source.fileno(), position, os.SEEK_DATA)
                except OSError as exc:
                    if exc.errno == errno.ENXIO:
                        break
                    raise
                end = min(size, os.lseek(source.fileno(), start, os.SEEK_HOLE))
                if not position <= start < end <= size:
                    raise StateError("DUCKDB_SPARSE_SOURCE_EXTENT_INVALID")
                target.seek(start)
                remaining = end - start
                while remaining:
                    # Extent discovery moved the underlying fd. Read by exact
                    # offset so a buffered source cannot reuse stale positions.
                    chunk = os.pread(source.fileno(), min(chunk_size, remaining), end - remaining)
                    if not chunk:
                        raise StateError("DUCKDB_SPARSE_SOURCE_CHANGED")
                    # Data extents can also contain zeroed pages.
                    if chunk.count(0) == len(chunk):
                        target.seek(len(chunk), os.SEEK_CUR)
                    else:
                        target.write(chunk)
                    remaining -= len(chunk)
                position = end
            target.truncate(size)
            return
        except OSError as exc:
            if exc.errno not in unsupported:
                raise
            target.seek(0)
            target.truncate(0)
    source.seek(0)
    target.seek(0)
    remaining = size
    while remaining:
        chunk = source.read(min(chunk_size, remaining))
        if not chunk:
            raise StateError("DUCKDB_SPARSE_SOURCE_CHANGED")
        if chunk.count(0) == len(chunk):
            target.seek(len(chunk), os.SEEK_CUR)
        else:
            target.write(chunk)
        remaining -= len(chunk)
    target.truncate(size)

