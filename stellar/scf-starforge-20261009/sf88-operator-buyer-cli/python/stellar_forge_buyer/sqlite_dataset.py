"""Use original acquired datasets in a durable, local SQLite application."""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import stat
import tempfile
import time

from .datasets import DatasetDelivery
from .errors import StateError
from .storage import digest, parse, private_directory, sync_directory

_APPLICATION = 0x53464442
_FORMAT = "stellar-forge.python-dataset-sqlite.v1"
_HEX = re.compile(r"[a-f0-9]{64}")
_ORDINAL = "_sf_row_number"
_META = "sf_dataset_versions"
_HEADS = "sf_dataset_views"
_HISTORY = "sf_dataset_activations"


def _json(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":"))


def _identifier(value):
    if not isinstance(value, str) or not value or len(value.encode("utf-8")) > 512 or any(ord(c) < 32 for c in value):
        raise StateError("DATASET_SQL_IDENTIFIER_INVALID")
    return '"' + value.replace('"', '""') + '"'


def _view_name(value):
    if not isinstance(value, str) or not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_]{0,63}", value) or value.lower().startswith(("sqlite_", "sf_dataset_")):
        raise StateError("DATASET_SQL_VIEW_NAME_INVALID")
    return value


def _scalar(value):
    if value is None:
        return value, "null"
    if type(value) is bool:
        return int(value), "boolean"
    if type(value) is int and -(2**63) <= value < 2**63:
        return value, "integer"
    if type(value) is float and math.isfinite(value):
        return value, "number"
    if isinstance(value, str):
        value.encode("utf-8")
        return value, "string"
    raise StateError("DATASET_SQL_VALUE_NOT_REPRESENTABLE")


@dataclass(frozen=True)
class QueryResult:
    columns: tuple[str, ...]
    rows: tuple[tuple, ...]
    truncated: bool

    def dictionaries(self):
        if len(set(self.columns)) != len(self.columns):
            raise StateError("DATASET_SQL_DUPLICATE_RESULT_NAMES_USE_ALIASES")
        return [dict(zip(self.columns, row)) for row in self.rows]


class DatasetDatabase:
    """A private customer database; acquisition and payment remain in SF88.

    Imports retain independent immutable tables. Named SQL views select a
    version only through activate(), using its current revision. A standard
    SQLite client can read the resulting database without this Python package.
    """

    def __init__(self, directory, *, create=True, busy_timeout=30):
        if not isinstance(busy_timeout, (int, float)) or not math.isfinite(busy_timeout) or not 0 < busy_timeout <= 300:
            raise StateError("DATASET_SQL_BUSY_TIMEOUT_INVALID")
        self.directory = private_directory(Path(directory), create=create)
        self.path = self.directory / "datasets.sqlite3"
        self.busy_timeout = busy_timeout
        if create:
            try:
                fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_RDWR | os.O_NOFOLLOW, 0o600)
            except FileExistsError:
                pass
            else:
                os.close(fd)
                sync_directory(self.directory)
        self._check_file()
        with self._connection(readonly=not create) as db:
            db.execute("BEGIN IMMEDIATE" if create else "BEGIN")
            try:
                application = db.execute("PRAGMA application_id").fetchone()[0]
                version = db.execute("PRAGMA user_version").fetchone()[0]
                objects = db.execute("SELECT name FROM sqlite_master LIMIT 1").fetchone()
                if create and not application and not version and not objects:
                    db.execute(f"CREATE TABLE {_META}(sequence INTEGER PRIMARY KEY,version_id TEXT UNIQUE NOT NULL,created_at TEXT NOT NULL,record TEXT NOT NULL,manifest BLOB NOT NULL)")
                    db.execute(f"CREATE TABLE {_HEADS}(name TEXT PRIMARY KEY COLLATE NOCASE,version_id TEXT NOT NULL REFERENCES {_META}(version_id),revision INTEGER NOT NULL CHECK(revision>0))")
                    db.execute(f"CREATE TABLE {_HISTORY}(sequence INTEGER PRIMARY KEY,name TEXT NOT NULL,version_id TEXT NOT NULL REFERENCES {_META}(version_id),previous_version TEXT,revision INTEGER NOT NULL,activated_at TEXT NOT NULL)")
                    db.execute(f"PRAGMA application_id={_APPLICATION}")
                    db.execute("PRAGMA user_version=1")
                elif application != _APPLICATION or version != 1:
                    raise StateError("DATASET_SQL_DATABASE_FORMAT_MISMATCH")
                db.commit()
            except BaseException:
                db.rollback()
                raise

    def _check_file(self):
        if private_directory(self.directory, create=False) != self.directory:
            raise StateError("DATASET_SQL_DIRECTORY_CHANGED")
        try:
            fd = os.open(self.path, os.O_RDONLY | os.O_NOFOLLOW)
            try:
                info = os.fstat(fd)
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_mode & 0o077:
                    raise StateError("DATASET_SQL_PRIVATE_FILE_REQUIRED")
            finally:
                os.close(fd)
        except OSError:
            raise StateError("DATASET_SQL_FILE_UNAVAILABLE") from None

    @contextmanager
    def _connection(self, *, readonly=False):
        self._check_file()
        db = sqlite3.connect(self.path.as_uri() + ("?mode=ro" if readonly else "?mode=rw"), uri=True,
                             isolation_level=None, timeout=self.busy_timeout)
        try:
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA foreign_keys=ON")
            db.execute("PRAGMA trusted_schema=OFF")
            if readonly:
                db.execute("PRAGMA query_only=ON")
            else:
                db.execute("PRAGMA synchronous=FULL")
            yield db
        finally:
            db.close()

    @staticmethod
    def _version(db, version_id):
        row = db.execute(f"SELECT sequence,record FROM {_META} WHERE version_id=?", (version_id,)).fetchone()
        if row is None:
            raise StateError("DATASET_SQL_VERSION_NOT_FOUND")
        return {**parse(row["record"].encode()), "sequence": row["sequence"]}

    def import_delivery(self, delivery: DatasetDelivery, *, columns=None):
        """Commit the verified complete room once; do not change any named view.

        columns optionally maps original field names to SQLite column names.
        Values keep their native JSON scalar types; SQLite stores booleans as
        integers and this record retains each column's observed JSON types.
        """
        if not isinstance(delivery, DatasetDelivery):
            raise StateError("DATASET_SQL_ORIGINAL_DELIVERY_REQUIRED")
        native = delivery.native
        status = native.get("nativeStatus") or {}
        binding = native.get("sourceBindingSha256")
        if native.get("schema") != "stellar-forge.sf88.dataset-delivery.v1" or not isinstance(binding, str) or not _HEX.fullmatch(binding) or status.get("complete") is not True or status.get("finalized") is not True:
            raise StateError("DATASET_SQL_COMPLETE_NATIVE_DELIVERY_REQUIRED")
        manifest_bytes = delivery.file("manifest.json").read_bytes(limit=4 * 1024 * 1024)
        manifest_sha = digest(manifest_bytes)
        if manifest_sha != native["outputs"]["manifest.json"]["sha256"]:
            raise StateError("DATASET_SQL_MANIFEST_CHANGED")
        manifest = parse(manifest_bytes)
        dataset = manifest.get("dataset") or {}
        fields = dataset.get("projectedFields")
        total = dataset.get("rows")
        source_pages = manifest.get("sourcePages")
        if manifest.get("schema") != "stellar-forge.buyer-delivery-manifest.v1" or not isinstance(fields, list) or not fields or len(fields) > 1024 or not all(isinstance(field, str) for field in fields) or len(set(fields)) != len(fields) or type(total) is not int or not 0 <= total <= 1_000_000 or status.get("rows") != total or status.get("snapshot") != dataset.get("snapshot") or not isinstance(source_pages, list) or status.get("pages") != len(source_pages) or manifest.get("paymentStatus") != native.get("paymentStatus"):
            raise StateError("DATASET_SQL_MANIFEST_BINDING_INVALID")
        columns = {} if columns is None else columns
        if not isinstance(columns, dict) or set(columns) - set(fields):
            raise StateError("DATASET_SQL_COLUMN_MAPPING_INVALID")
        mapped = [columns.get(field, field) for field in fields]
        quoted = [_identifier(column) for column in mapped]
        folded = [column.lower() for column in mapped]
        if len(set(folded)) != len(folded) or _ORDINAL in folded:
            raise StateError("DATASET_SQL_COLUMN_COLLISION_USE_MAPPING")
        source = native["outputs"]["dataset.jsonl"]
        if manifest.get("outputs", {}).get("dataset.jsonl") != {key: source[key] for key in ("bytes", "sha256")}:
            raise StateError("DATASET_SQL_ROW_BINDING_INVALID")
        identity = {"schema": _FORMAT, "manifestSha256": manifest_sha, "sourceBindingSha256": binding,
                    "columns": list(zip(fields, mapped))}
        version_id = digest(_json(identity).encode())
        table = "sf_dataset_rows_" + version_id
        with self._connection() as db, delivery.file("dataset.jsonl").open() as stream:
            db.execute("BEGIN IMMEDIATE")
            try:
                existing = db.execute(f"SELECT version_id FROM {_META} WHERE version_id=?", (version_id,)).fetchone()
                if existing:
                    record = self._version(db, version_id)
                    db.commit()
                    return {**record, "import_status": "UNCHANGED"}
                # No declared type means no affinity conversion: numeric strings
                # and exact decimal text remain TEXT, while numbers remain numbers.
                db.execute(f"CREATE TABLE {_identifier(table)}({_identifier(_ORDINAL)} INTEGER PRIMARY KEY," + ",".join(quoted) + ")")
                insert = f"INSERT INTO {_identifier(table)} VALUES(" + ",".join("?" for _ in range(len(fields) + 1)) + ")"
                observed = [set() for _ in fields]
                checksum = hashlib.sha256()
                count = size = 0
                while raw := stream.readline(2_097_153):
                    if len(raw) > 2_097_152 or not raw.endswith(b"\n"):
                        raise StateError("DATASET_SQL_ROW_FORMAT_INVALID")
                    checksum.update(raw)
                    size += len(raw)
                    count += 1
                    if count > total or size > source["bytes"]:
                        raise StateError("DATASET_SQL_ROWS_CHANGED")
                    row = parse(raw)
                    if not isinstance(row, dict) or set(row) != set(fields):
                        raise StateError("DATASET_SQL_ROW_FIELDS_MISMATCH")
                    values = []
                    for index, field in enumerate(fields):
                        value, kind = _scalar(row[field])
                        values.append(value)
                        observed[index].add(kind)
                    db.execute(insert, (count, *values))
                if count != total or size != source["bytes"] or checksum.hexdigest() != source["sha256"]:
                    raise StateError("DATASET_SQL_ROWS_CHANGED")
                record = {**identity, "version_id": version_id, "table": table,
                          "created_at": datetime.now(timezone.utc).isoformat(), "row_count": count,
                          "dataset": dataset, "sourceDirectory": native.get("sourceDirectory"),
                          "source_pages": len(source_pages), "originalPaymentStatus": native.get("paymentStatus"),
                          "jsonl": {key: source[key] for key in ("bytes", "sha256")},
                          "column_types": [{"source": field, "column": mapped[index], "json_types": sorted(observed[index])}
                                           for index, field in enumerate(fields)], "row_order_column": _ORDINAL}
                db.execute(f"INSERT INTO {_META}(version_id,created_at,record,manifest) VALUES(?,?,?,?)",
                           (version_id, record["created_at"], _json(record), manifest_bytes))
                record = self._version(db, version_id)
                db.commit()
                return {**record, "import_status": "IMPORTED"}
            except BaseException:
                db.rollback()
                raise

    def version(self, version_id):
        with self._connection(readonly=True) as db:
            return self._version(db, version_id)

    def manifest(self, version_id):
        """Read the exact original manifest retained with the acquired rows."""
        with self._connection(readonly=True) as db:
            row = db.execute(f"SELECT manifest,record FROM {_META} WHERE version_id=?", (version_id,)).fetchone()
            if row is None:
                raise StateError("DATASET_SQL_VERSION_NOT_FOUND")
            if digest(row["manifest"]) != parse(row["record"].encode())["manifestSha256"]:
                raise StateError("DATASET_SQL_RETAINED_MANIFEST_CHANGED")
            return parse(row["manifest"])

    def versions(self, *, before=None, limit=100):
        if type(limit) is not int or not 1 <= limit <= 1000 or before is not None and (type(before) is not int or before < 1):
            raise StateError("DATASET_SQL_HISTORY_PAGE_INVALID")
        with self._connection(readonly=True) as db:
            rows = db.execute(f"SELECT sequence,record FROM {_META} WHERE (? IS NULL OR sequence<?) ORDER BY sequence DESC LIMIT ?", (before, before, limit + 1)).fetchall()
            return {"versions": [{**parse(row["record"].encode()), "sequence": row["sequence"]} for row in rows[:limit]],
                    "next_before": rows[limit - 1]["sequence"] if len(rows) > limit else None}

    def current(self, name):
        with self._connection(readonly=True) as db:
            db.execute("BEGIN")
            row = db.execute(f"SELECT * FROM {_HEADS} WHERE name=?", (_view_name(name),)).fetchone()
            return {"name": name, "revision": 0, "version": None} if row is None else {"name": row["name"], "revision": row["revision"], "version": self._version(db, row["version_id"])}

    def activate(self, name, version_id, *, expected_revision):
        """Atomically select an imported version for one ordinary SQL view."""
        name = _view_name(name)
        if type(expected_revision) is not int or expected_revision < 0:
            raise StateError("DATASET_SQL_REVISION_REQUIRED")
        with self._connection() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                version = self._version(db, version_id)
                current = db.execute(f"SELECT * FROM {_HEADS} WHERE name=?", (name,)).fetchone()
                revision = current["revision"] if current else 0
                if revision != expected_revision:
                    raise StateError("DATASET_SQL_VIEW_CHANGED")
                if current and current["version_id"] == version_id:
                    db.commit()
                    return {"name": current["name"], "revision": revision, "version": version, "activation_status": "UNCHANGED"}
                if current:
                    db.execute(f"DROP VIEW {_identifier(current['name'])}")
                elif db.execute("SELECT 1 FROM sqlite_master WHERE name=? COLLATE NOCASE", (name,)).fetchone():
                    raise StateError("DATASET_SQL_VIEW_NAME_IN_USE")
                db.execute(f"CREATE VIEW {_identifier(name)} AS SELECT * FROM {_identifier(version['table'])}")
                db.execute(f"INSERT INTO {_HEADS}(name,version_id,revision) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET version_id=excluded.version_id,revision=excluded.revision", (name, version_id, revision + 1))
                db.execute(f"INSERT INTO {_HISTORY}(name,version_id,previous_version,revision,activated_at) VALUES(?,?,?,?,?)",
                           (name, version_id, current["version_id"] if current else None, revision + 1, datetime.now(timezone.utc).isoformat()))
                db.commit()
                return {"name": name, "revision": revision + 1, "version": version, "activation_status": "ACTIVATED"}
            except BaseException:
                db.rollback()
                raise

    def query(self, sql, parameters=(), *, max_rows=1000, max_result_bytes=16 * 1024 * 1024, timeout=10):
        """Read-only, parameterized SQL, with an explicit result truncation flag."""
        if not isinstance(sql, str) or type(max_rows) is not int or not 1 <= max_rows <= 100_000 or type(max_result_bytes) is not int or not 1 <= max_result_bytes <= 256 * 1024 * 1024 or not isinstance(timeout, (int, float)) or not math.isfinite(timeout) or not 0 < timeout <= 300:
            raise StateError("DATASET_SQL_QUERY_OPTIONS_INVALID")
        permitted = {sqlite3.SQLITE_SELECT, sqlite3.SQLITE_READ, sqlite3.SQLITE_FUNCTION, sqlite3.SQLITE_RECURSIVE}
        def authorize(action, first, second, database, trigger):
            if action not in permitted or action == sqlite3.SQLITE_FUNCTION and (second or first or "").lower() in {"load_extension", "writefile", "readfile"}:
                return sqlite3.SQLITE_DENY
            return sqlite3.SQLITE_OK
        with self._connection(readonly=True) as db:
            deadline = time.monotonic() + timeout
            db.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, 16 * 1024 * 1024)
            db.set_authorizer(authorize)
            db.set_progress_handler(lambda: int(time.monotonic() >= deadline), 1000)
            try:
                cursor = db.execute(sql, parameters)
                columns = tuple(column[0] for column in cursor.description or ())
                rows, size, truncated = [], 0, False
                for row in cursor:
                    values = tuple(row)
                    row_bytes = sum(len(value.encode("utf-8")) if isinstance(value, str) else len(value) if isinstance(value, bytes) else 8 for value in values)
                    if len(rows) == max_rows or size + row_bytes > max_result_bytes:
                        truncated = True
                        break
                    rows.append(values)
                    size += row_bytes
                return QueryResult(columns, tuple(rows), truncated)
            except sqlite3.Error as exc:
                raise StateError("DATASET_SQL_QUERY_FAILED") from exc

    def backup(self, destination):
        """Publish a consistent, create-only database copy that reopens normally."""
        folder = private_directory(Path(destination), create=True)
        target = folder / "datasets.sqlite3"
        if target.exists():
            raise StateError("DATASET_SQL_BACKUP_DESTINATION_EXISTS")
        fd, temporary = tempfile.mkstemp(prefix=".database-", dir=folder)
        os.close(fd)
        try:
            with self._connection(readonly=True) as source:
                copy = sqlite3.connect(temporary)
                try:
                    source.backup(copy)
                finally:
                    copy.close()
            with open(temporary, "rb") as stream:
                os.fsync(stream.fileno())
            os.link(temporary, target)
            sync_directory(folder)
        finally:
            os.unlink(temporary)
            sync_directory(folder)
        return target
