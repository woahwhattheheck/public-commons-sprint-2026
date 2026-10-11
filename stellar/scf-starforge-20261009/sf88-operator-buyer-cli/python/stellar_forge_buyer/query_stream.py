"""The DatasetDatabase SQL reader, shared by previews and complete exports."""
from __future__ import annotations

from contextlib import contextmanager
from copy import deepcopy
import math
import sqlite3
import time

from .errors import StateError

# These are the original DatasetDatabase authorizer and value-size policy.
_READ_ACTIONS = frozenset((sqlite3.SQLITE_SELECT, sqlite3.SQLITE_READ,
                          sqlite3.SQLITE_FUNCTION, sqlite3.SQLITE_RECURSIVE))
_FILE_FUNCTIONS = frozenset(("load_extension", "writefile", "readfile"))
_VALUE_LIMIT = 16 * 1024 * 1024


def row_bytes(values):
    return sum(len(value.encode("utf-8")) if isinstance(value, str)
               else len(value) if isinstance(value, bytes) else 8 for value in values)


class QueryStream:
    """A single-use iterator valid inside DatasetDatabase.stream_query().

    Rows are fetched individually from the original SQLite cursor. Exhaustion
    sets complete=True; an early break, cancellation or timeout never does.
    """

    def __init__(self, database, connection, *, views, timeout, cancel):
        self._database = database
        self._connection = connection
        self._views = deepcopy(views)
        self._deadline = time.monotonic() + timeout
        self._cancel = cancel
        self._reason = None
        self._tables = set()
        self._track_reads = True
        self._cursor = None
        self.columns = ()
        self.rows_read = 0
        self.bytes_read = 0
        self.largest_row_bytes = 0
        self.complete = False
        self.closed = False

    @property
    def views(self):
        return deepcopy(self._views)

    @property
    def read_tables(self):
        return tuple(sorted(self._tables))

    def _interrupted(self):
        if self._reason:
            return True
        try:
            if self._cancel is not None and self._cancel():
                self._reason = "DATASET_SQL_QUERY_CANCELLED"
            elif time.monotonic() >= self._deadline:
                self._reason = "DATASET_SQL_QUERY_TIMEOUT"
        except Exception:
            self._reason = "DATASET_SQL_CANCEL_CALLBACK_FAILED"
        return self._reason is not None

    def check(self):
        if self.closed:
            raise StateError("DATASET_SQL_STREAM_CLOSED")
        if self._interrupted():
            raise StateError(self._reason)

    def _authorize(self, action, first, second, database, trigger):
        if (action not in _READ_ACTIONS or action == sqlite3.SQLITE_FUNCTION
                and (second or first or "").lower() in _FILE_FUNCTIONS):
            return sqlite3.SQLITE_DENY
        if self._track_reads and action == sqlite3.SQLITE_READ and first:
            self._tables.add(first)
        return sqlite3.SQLITE_OK

    def __iter__(self):
        return self

    def __next__(self):
        if self.complete:
            raise StopIteration
        self.check()
        try:
            row = self._cursor.fetchone()
        except sqlite3.Error as exc:
            raise StateError(self._reason or "DATASET_SQL_QUERY_FAILED") from exc
        self.check()
        if row is None:
            self.complete = True
            raise StopIteration
        values = tuple(row)
        size = row_bytes(values)
        self.rows_read += 1
        self.bytes_read += size
        self.largest_row_bytes = max(self.largest_row_bytes, size)
        return values

    def dictionaries(self):
        if len(set(self.columns)) != len(self.columns):
            raise StateError("DATASET_SQL_DUPLICATE_RESULT_NAMES_USE_ALIASES")
        for row in self:
            yield dict(zip(self.columns, row))

    def source_versions(self):
        """Original imported records for physical tables actually read.

        Called inside the same read transaction. Metadata inspection does not
        add its own tables to query lineage. Other SQL tables remain visible
        in read_tables, without an invented acquisition record.
        """
        self.check()
        prefix = "sf_dataset_rows_"
        versions = sorted({name[len(prefix):] for name in self._tables
                           if name.startswith(prefix) and len(name) == len(prefix) + 64
                           and all(c in "0123456789abcdef" for c in name[len(prefix):])})
        self._track_reads = False
        try:
            return [self._database._version(self._connection, version) for version in versions]
        finally:
            self._track_reads = True


@contextmanager
def open_query(database, connection, sql, parameters=(), *, timeout=300,
               expected_views=None, cancel=None):
    """Authorize a cursor in an existing original database transaction."""
    if not connection.in_transaction:
        raise StateError("DATASET_SQL_TRANSACTION_REQUIRED")
    if (not isinstance(sql, str) or type(timeout) not in (int, float)
            or not math.isfinite(timeout) or not 0 < timeout <= 86400
            or cancel is not None and not callable(cancel)):
        raise StateError("DATASET_SQL_QUERY_OPTIONS_INVALID")
    views = database._views(connection)
    if expected_views is not None and (not isinstance(expected_views, list) or views != expected_views):
        raise StateError("DATASET_SQL_VIEWS_CHANGED")
    stream = QueryStream(database, connection, views=views, timeout=timeout, cancel=cancel)
    previous_length = connection.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, _VALUE_LIMIT)
    connection.set_authorizer(stream._authorize)
    connection.set_progress_handler(lambda: int(stream._interrupted()), 1000)
    try:
        stream.check()
        try:
            stream._cursor = connection.execute(sql, parameters)
        except sqlite3.Error as exc:
            raise StateError(stream._reason or "DATASET_SQL_QUERY_FAILED") from exc
        stream.columns = tuple(column[0] for column in stream._cursor.description or ())
        if not stream.columns:
            raise StateError("DATASET_SQL_READ_QUERY_REQUIRED")
        yield stream
    finally:
        stream.closed = True
        try:
            if stream._cursor is not None:
                stream._cursor.close()
        finally:
            connection.set_authorizer(None)
            connection.set_progress_handler(None, 0)
            connection.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, previous_length)
