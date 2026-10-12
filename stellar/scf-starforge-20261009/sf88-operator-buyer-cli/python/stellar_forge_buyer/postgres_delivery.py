"""Receive original SF100 datasets into an application's PostgreSQL warehouse.

Acquisition, financial records and file verification remain in the original
DatasetDelivery implementation. This module owns complete PostgreSQL imports
and explicit selection of retained editions for customer applications.
"""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import json
import math
import os
from pathlib import Path
import re
import uuid

from .datasets import DatasetDelivery
from .dataset_semantics import (
    identity as semantic_identity, read_delivery_semantics, same_json,
    sql_context, sql_descriptor,
)
from .errors import StateError
from .storage import digest, parse, private_directory, read, unique_object

SCHEMA = "stellar-forge.postgres-dataset-warehouse.v1"
MAPPING_SCHEMA = "stellar-forge.postgres-dataset-mapping.v1"
REVIEW_SCHEMA = "stellar-forge.postgres-dataset-review.v1"
_FORMAT = "_sf_receiving_format"
_VERSIONS = "_sf_dataset_versions"
_SEMANTICS = "_sf_dataset_semantics"
_VIEWS = "_sf_dataset_views"
_HISTORY = "_sf_dataset_activations"
_ORDINAL = "_sf_row_number"
_ORIGINAL = "_sf_source_row"
_HEX = re.compile(r"[a-f0-9]{64}")
_INTEGER = re.compile(r"-?(?:0|[1-9][0-9]*)")
_DECIMAL = re.compile(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?")
_TIMESTAMP = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|[+-][0-9]{2}:[0-9]{2})")
_TYPES = {"text", "boolean", "bigint", "numeric", "double precision", "date", "timestamp with time zone", "json"}


class WarehouseError(StateError):
    """A receiving error with safe structured location/provider information."""

    def __init__(self, code, *, row=None, field=None, sqlstate=None):
        super().__init__(code)
        self.code, self.row, self.field, self.sqlstate = code, row, field, sqlstate

    def report(self):
        return {key: value for key, value in {
            "error": self.code, "row": self.row, "field": self.field,
            "sqlstate": self.sqlstate,
        }.items() if value is not None}


def _json(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":"))


def _identifier(value):
    if (not isinstance(value, str) or not value or len(value.encode("utf-8")) > 63
            or any(ord(char) < 32 for char in value) or "\x7f" in value):
        raise WarehouseError("DATASET_PG_IDENTIFIER_INVALID")
    return '"' + value.replace('"', '""') + '"'


def _public_name(value):
    quoted = _identifier(value)
    if value.lower().startswith(("_sf_", "pg_")) or value == "information_schema":
        raise WarehouseError("DATASET_PG_RESERVED_IDENTIFIER")
    return quoted


def _version_id(value):
    if not isinstance(value, str) or not _HEX.fullmatch(value):
        raise WarehouseError("DATASET_PG_VERSION_ID_INVALID")
    return value


def _page(before, limit):
    if ((before is not None and (type(before) is not int or before < 1))
            or type(limit) is not int or not 1 <= limit <= 1000):
        raise WarehouseError("DATASET_PG_PAGE_INVALID")


def _driver():
    try:
        import psycopg
        from psycopg.pq import TransactionStatus
        from psycopg.rows import tuple_row
    except ImportError:
        raise WarehouseError("DATASET_PG_PSYCOPG3_REQUIRED") from None
    return psycopg, TransactionStatus, tuple_row


@dataclass(frozen=True)
class Column:
    source: str
    column: str
    type: str
    nullable: bool = True

    def __post_init__(self):
        if not isinstance(self.source, str) or not self.source:
            raise WarehouseError("DATASET_PG_SOURCE_FIELD_INVALID")
        _public_name(self.column)
        if self.type not in _TYPES or type(self.nullable) is not bool:
            raise WarehouseError("DATASET_PG_COLUMN_DECLARATION_INVALID", field=self.source)

    def record(self):
        return {"source": self.source, "column": self.column,
                "type": self.type, "nullable": self.nullable}


@dataclass(frozen=True)
class DatasetMapping:
    """An explicit mapping of every delivered field; keys use source names."""
    columns: tuple[Column, ...]
    keys: tuple[str, ...] = ()

    def __post_init__(self):
        object.__setattr__(self, "columns", tuple(self.columns))
        object.__setattr__(self, "keys", tuple(self.keys))
        if not self.columns or len(self.columns) > 1024 or not all(isinstance(c, Column) for c in self.columns):
            raise WarehouseError("DATASET_PG_COLUMNS_REQUIRED")
        sources, names = [c.source for c in self.columns], [c.column for c in self.columns]
        if len(set(sources)) != len(sources) or len(set(names)) != len(names):
            raise WarehouseError("DATASET_PG_COLUMN_MAPPING_COLLISION")
        if (not all(isinstance(key, str) for key in self.keys)
                or len(self.keys) > 32 or len(set(self.keys)) != len(self.keys) or set(self.keys) - set(sources)):
            raise WarehouseError("DATASET_PG_KEY_FIELDS_INVALID")
        for column in self.columns:
            if column.source in self.keys and (column.nullable or column.type == "json"):
                raise WarehouseError("DATASET_PG_KEYS_REQUIRE_NONNULL_COMPARABLE_COLUMNS", field=column.source)

    @classmethod
    def from_record(cls, record):
        if (not isinstance(record, dict) or record.get("schema") != MAPPING_SCHEMA
                or set(record) - {"schema", "columns", "keys"}
                or not isinstance(record.get("columns"), list)
                or not isinstance(record.get("keys", []), list)):
            raise WarehouseError("DATASET_PG_MAPPING_INVALID")
        try:
            return cls(tuple(Column(**column) for column in record["columns"]), tuple(record.get("keys", [])))
        except (TypeError, ValueError):
            raise WarehouseError("DATASET_PG_MAPPING_INVALID") from None

    def record(self):
        return {"schema": MAPPING_SCHEMA, "columns": [c.record() for c in self.columns], "keys": list(self.keys)}

    @property
    def signature(self):
        return [(c.column, c.type) for c in self.columns]


def _kind(value):
    if value is None:
        return "null"
    if type(value) is bool:
        return "boolean"
    if type(value) is int:
        return "integer"
    if isinstance(value, Decimal):
        return "number"
    if isinstance(value, str):
        return "string"
    raise WarehouseError("DATASET_PG_NATIVE_SCALAR_REQUIRED")


def _value(column, value):
    if value is None:
        if not column.nullable:
            raise WarehouseError("DATASET_PG_NULL_NOT_ALLOWED", field=column.source)
        return None
    kind = _kind(value)
    if column.type == "text":
        if kind != "string" or "\x00" in value:
            raise WarehouseError("DATASET_PG_TEXT_REQUIRED", field=column.source)
        return value
    if column.type == "boolean":
        if kind != "boolean":
            raise WarehouseError("DATASET_PG_BOOLEAN_REQUIRED", field=column.source)
        return value
    if column.type == "bigint":
        if kind == "integer":
            number = value
        elif kind == "string" and _INTEGER.fullmatch(value):
            number = int(value)
        else:
            raise WarehouseError("DATASET_PG_EXACT_INTEGER_REQUIRED", field=column.source)
        if not -(2**63) <= number < 2**63:
            raise WarehouseError("DATASET_PG_BIGINT_RANGE", field=column.source)
        return number
    if column.type == "numeric":
        if kind not in {"integer", "number", "string"} or not _DECIMAL.fullmatch(str(value)):
            raise WarehouseError("DATASET_PG_EXACT_DECIMAL_REQUIRED", field=column.source)
        try:
            number = Decimal(value)
        except (InvalidOperation, ValueError):
            raise WarehouseError("DATASET_PG_EXACT_DECIMAL_REQUIRED", field=column.source) from None
        if not number.is_finite() or number.adjusted() > 131071 or number.as_tuple().exponent < -16383:
            raise WarehouseError("DATASET_PG_NUMERIC_RANGE", field=column.source)
        return number
    if column.type == "double precision":
        if kind not in {"integer", "number"} or kind == "integer" and abs(value) > 2**53:
            raise WarehouseError("DATASET_PG_FINITE_NUMBER_REQUIRED_USE_NUMERIC_FOR_EXACT_VALUES", field=column.source)
        number = float(value)
        if not math.isfinite(number) or number == 0 and value != 0:
            raise WarehouseError("DATASET_PG_DOUBLE_RANGE", field=column.source)
        return number
    if column.type == "date":
        if kind != "string" or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
            raise WarehouseError("DATASET_PG_ISO_DATE_REQUIRED", field=column.source)
        try:
            return date.fromisoformat(value)
        except ValueError:
            raise WarehouseError("DATASET_PG_ISO_DATE_REQUIRED", field=column.source) from None
    if column.type == "timestamp with time zone":
        if kind != "string" or not _TIMESTAMP.fullmatch(value):
            raise WarehouseError("DATASET_PG_ISO_TIMESTAMP_WITH_OFFSET_REQUIRED", field=column.source)
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
        except (ValueError, OverflowError):
            raise WarehouseError("DATASET_PG_ISO_TIMESTAMP_WITH_OFFSET_REQUIRED", field=column.source) from None
    # Explicit PostgreSQL JSON column retains the native scalar's JSON type.
    if kind == "number":
        return str(value)
    return _json(value)


@dataclass(frozen=True)
class _Input:
    delivery: DatasetDelivery
    manifest_bytes: bytes
    manifest: dict
    mapping: DatasetMapping
    identity: dict
    version_id: str
    row_source: dict
    semantic_source: dict | None
    semantic_descriptor: dict | None

    @property
    def row_count(self):
        return self.manifest["dataset"]["rows"]

    def record(self):
        return {**self.identity, "version_id": self.version_id,
                "dataset": self.manifest["dataset"], "row_count": self.row_count,
                "source_pages": len(self.manifest["sourcePages"]),
                "originalPaymentStatus": self.manifest["paymentStatus"],
                "jsonl": {k: self.row_source[k] for k in ("bytes", "sha256")},
                "row_order_column": _ORDINAL, "original_row_column": _ORIGINAL,
                "semantics": self.semantic_descriptor,
                "semantics_status": "AVAILABLE" if self.semantic_source is not None else "NONE"}


def _input(delivery, mapping):
    if not isinstance(delivery, DatasetDelivery) or not isinstance(mapping, DatasetMapping):
        raise WarehouseError("DATASET_PG_ORIGINAL_DELIVERY_AND_MAPPING_REQUIRED")
    native = delivery.native
    if not isinstance(native, dict) or not isinstance(native.get("nativeStatus"), dict) or not isinstance(native.get("outputs"), dict):
        raise WarehouseError("DATASET_PG_ORIGINAL_DELIVERY_REPORT_REQUIRED")
    status, binding = native["nativeStatus"], native.get("sourceBindingSha256")
    if (native.get("schema") not in {"stellar-forge.sf88.dataset-delivery.v1", "stellar-forge.sf100.dataset-delivery.v1"}
            or native.get("schema") == "stellar-forge.sf100.dataset-delivery.v1" and native.get("sourceFormat") != "SF100_SCAN"
            or not isinstance(binding, str) or not _HEX.fullmatch(binding)
            or status.get("complete") is not True or status.get("finalized") is not True):
        raise WarehouseError("DATASET_PG_COMPLETE_NATIVE_DELIVERY_REQUIRED")
    manifest_bytes = delivery.file("manifest.json").read_bytes(limit=4 * 1024 * 1024)
    manifest_sha = digest(manifest_bytes)
    manifest = parse(manifest_bytes)
    if not isinstance(manifest, dict) or not isinstance(manifest.get("dataset"), dict):
        raise WarehouseError("DATASET_PG_MANIFEST_BINDING_INVALID")
    dataset = manifest["dataset"]
    fields, rows, pages = dataset.get("projectedFields"), dataset.get("rows"), manifest.get("sourcePages")
    if (manifest.get("schema") != "stellar-forge.buyer-delivery-manifest.v1"
            or not isinstance(fields, list) or not fields or len(fields) > 1024
            or not all(isinstance(field, str) for field in fields) or len(set(fields)) != len(fields)
            or type(rows) is not int or not 0 <= rows <= 1_000_000
            or status.get("rows") != rows or status.get("snapshot") != dataset.get("snapshot")
            or not isinstance(pages, list) or status.get("pages") != len(pages)
            or manifest.get("paymentStatus") != native.get("paymentStatus")
            or manifest_sha != native["outputs"]["manifest.json"]["sha256"]):
        raise WarehouseError("DATASET_PG_MANIFEST_BINDING_INVALID")
    if set(fields) != {c.source for c in mapping.columns}:
        raise WarehouseError("DATASET_PG_MAP_EVERY_DELIVERED_FIELD")
    source = native["outputs"]["dataset.jsonl"]
    if manifest.get("outputs", {}).get("dataset.jsonl") != {k: source[k] for k in ("bytes", "sha256")}:
        raise WarehouseError("DATASET_PG_ROW_BINDING_INVALID")
    identity = {"schema": SCHEMA, "manifestSha256": manifest_sha,
                "sourceBindingSha256": binding, "mapping": mapping.record()}
    meanings = read_delivery_semantics(delivery, manifest=manifest)
    descriptor = _semantic_descriptor(meanings, mapping) if meanings is not None else None
    if meanings is not None:
        sql_context(meanings["bytes"], descriptor, digest(_json(identity).encode()))
    return _Input(delivery, manifest_bytes, manifest, mapping, identity,
                  digest(_json(identity).encode()), source, meanings, descriptor)


def _semantic_descriptor(receiving, mapping, *, enforced=False):
    descriptor = sql_descriptor(receiving, [c.source for c in mapping.columns],
                                [c.column for c in mapping.columns])
    primary = descriptor["primary_key"]
    # An independently selected receiving key is not evidence that the
    # dictionary's source primary key was enforced by PostgreSQL.
    primary["enforced"] = bool(enforced and primary["complete"] and primary["source"]
                               and set(primary["source"]) == set(mapping.keys))
    return descriptor


def _bound_semantics(raw, descriptor, manifest, mapping, version_id):
    context = sql_context(raw, descriptor, version_id)
    document = context["document"]
    binding = semantic_identity(document)
    declared = manifest.get("semantics")
    selected = manifest.get("dataset", {}).get("projectedFields")
    exact = {"bytes": len(raw), "sha256": digest(raw)}
    if (not isinstance(declared, dict) or declared.get("file") != "semantics.json"
            or declared.get("typedRowsFile") != "dataset.jsonl"
            or declared.get("scope") != "PUBLISHED_DATASET"
            or not same_json(declared.get("selectedFields"), selected)
            or not isinstance(selected, list)
            or set(selected) != {c.source for c in mapping.columns}
            or not all(declared.get(key) == value for key, value in binding.items())
            or not same_json(manifest.get("outputs", {}).get("semantics.json"), exact)):
        raise WarehouseError("DATASET_PG_SEMANTIC_MANIFEST_CHANGED")
    expected = _semantic_descriptor({"identity": binding, "document": document,
        "file": {"name": "semantics.json", **exact}}, mapping, enforced=True)
    if not same_json(descriptor, expected):
        raise WarehouseError("DATASET_PG_SEMANTIC_MAPPING_CHANGED")
    return context


def _rows(source, stream):
    checksum, count, size = hashlib.sha256(), 0, 0
    fields = {column.source for column in source.mapping.columns}
    while raw := stream.readline(2_097_153):
        count += 1
        size += len(raw)
        if len(raw) > 2_097_152 or not raw.endswith(b"\n") or count > source.row_count or size > source.row_source["bytes"]:
            raise WarehouseError("DATASET_PG_ROW_FORMAT_OR_COUNT_INVALID", row=count)
        checksum.update(raw)
        # Preserve the delivered JSON number lexeme through Decimal. The original
        # reader verifies the file before this same descriptor is consumed.
        try:
            row = json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object,
                             parse_float=Decimal,
                             parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
        except (ValueError, UnicodeError, StateError):
            raise WarehouseError("DATASET_PG_INVALID_JSON_ROW", row=count) from None
        if not isinstance(row, dict) or set(row) != fields:
            raise WarehouseError("DATASET_PG_ROW_FIELDS_MISMATCH", row=count)
        try:
            values = tuple(_value(column, row[column.source]) for column in source.mapping.columns)
            kinds = tuple(_kind(row[column.source]) for column in source.mapping.columns)
        except WarehouseError as error:
            raise WarehouseError(error.code, row=count, field=error.field) from None
        yield count, raw[:-1].decode("utf-8"), values, kinds
    if count != source.row_count or size != source.row_source["bytes"] or checksum.hexdigest() != source.row_source["sha256"]:
        raise WarehouseError("DATASET_PG_ROWS_CHANGED")


def review_delivery(delivery: DatasetDelivery, mapping: DatasetMapping):
    """Review complete original rows offline; PostgreSQL later enforces keys."""
    source = _input(delivery, mapping)
    observed = [set() for _ in mapping.columns]
    nulls = [0 for _ in mapping.columns]
    with delivery.file("dataset.jsonl").open() as stream:
        for _, _, _, kinds in _rows(source, stream):
            for index, kind in enumerate(kinds):
                observed[index].add(kind)
                nulls[index] += kind == "null"
    return {**source.record(), "schema": REVIEW_SCHEMA, "status": "READY",
            "columns": [{**column.record(), "json_types": sorted(observed[index]), "nulls": nulls[index]}
                        for index, column in enumerate(mapping.columns)],
            "key_validation": "POSTGRESQL_TRANSACTION" if mapping.keys else "ROW_ORDINAL_ONLY",
            "semantic_dictionary": source.semantic_source["document"] if source.semantic_source else None}



def load_delivery_report(report_path):
    """Open an unchanged SF88 report or the original finalized SF100 scan."""
    path = Path(os.path.abspath(Path(report_path).expanduser()))
    record = parse(read(path, 8 * 1024 * 1024))
    if isinstance(record, dict) and isinstance(record.get("report"), dict):
        record = record["report"]
    if (isinstance(record, dict) and isinstance(record.get("session"), dict)
            and record["session"].get("schema") == "stellar-forge.buyer-delivery.v1"):
        return DatasetDelivery.from_finalized_scan(record)
    if isinstance(record, dict) and record.get("schema") == "stellar-forge.sf100.dataset-delivery.v1":
        delivery = DatasetDelivery.from_finalized_scan(record.get("originalNativeScan"))
        if delivery.native != record:
            raise WarehouseError("DATASET_PG_REVIEWED_INPUT_CHANGED")
        return delivery
    if (not isinstance(record, dict) or record.get("schema") != "stellar-forge.sf88.dataset-delivery.v1"
            or not isinstance(record.get("directory"), str)):
        raise WarehouseError("DATASET_PG_ORIGINAL_DELIVERY_REPORT_REQUIRED")
    directory = Path(record["directory"])
    if (not directory.is_absolute() or str(directory) != record["directory"]
            or private_directory(directory, create=False) != directory):
        raise WarehouseError("DATASET_PG_ORIGINAL_DELIVERY_DIRECTORY_INVALID")
    return DatasetDelivery(native=record, directory=directory)


class PostgresWarehouse:
    """One dedicated PostgreSQL schema, with fresh caller-owned connections.

    The connection factory returns a new idle Psycopg 3 connection for each
    operation. This class closes those connections and owns each complete
    transaction. Customer application relations outside this schema are never
    changed. Importing an edition leaves named application views unchanged.
    """

    def __init__(self, connection_factory, *, schema="sf_received", create=True,
                 expected_warehouse=None, statement_timeout_ms=300000, lock_timeout_ms=30000):
        if not callable(connection_factory):
            raise WarehouseError("DATASET_PG_CONNECTION_FACTORY_REQUIRED")
        _public_name(schema)
        if (type(create) is not bool or type(statement_timeout_ms) is not int
                or not 1 <= statement_timeout_ms <= 3600000 or type(lock_timeout_ms) is not int
                or not 1 <= lock_timeout_ms <= statement_timeout_ms):
            raise WarehouseError("DATASET_PG_OPTIONS_INVALID")
        self.connection_factory, self.schema = connection_factory, schema
        self.statement_timeout_ms, self.lock_timeout_ms = statement_timeout_ms, lock_timeout_ms
        self.warehouse_id = expected_warehouse
        self._initialize(create=create)

    @classmethod
    def from_environment(cls, connection_env="SF_BUYER_POSTGRES_DSN", *, environment=None, **options):
        if not isinstance(connection_env, str) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", connection_env):
            raise WarehouseError("DATASET_PG_CONNECTION_ENV_INVALID")
        environment = os.environ if environment is None else environment

        def connect():
            psycopg, _, _ = _driver()
            value = environment.get(connection_env)
            if not isinstance(value, str) or not value:
                raise WarehouseError("DATASET_PG_CONNECTION_ENV_MISSING")
            return psycopg.connect(value, autocommit=True, connect_timeout=10)

        return cls(connect, **options)

    def _table(self, name):
        return f"{_identifier(self.schema)}.{_identifier(name)}"

    @contextmanager
    def _transaction(self, *, readonly=False, check=True):
        psycopg, status, tuple_row = _driver()
        connection = None
        owned = False
        try:
            connection = self.connection_factory()
            if not isinstance(connection, psycopg.Connection) or connection.info.transaction_status != status.IDLE:
                raise WarehouseError("DATASET_PG_NEW_IDLE_CONNECTION_REQUIRED")
            owned = True
            connection.autocommit = True
            with connection.transaction():
                with connection.cursor(row_factory=tuple_row) as cursor:
                    cursor.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY" if readonly
                                   else "SET TRANSACTION ISOLATION LEVEL READ COMMITTED, READ WRITE")
                    cursor.execute("SET LOCAL search_path TO pg_catalog")
                    cursor.execute("SET LOCAL timezone TO 'UTC'")
                    cursor.execute("SET LOCAL datestyle TO 'ISO, YMD'")
                    cursor.execute("SELECT set_config('statement_timeout', %s, true), set_config('lock_timeout', %s, true)",
                                   (str(self.statement_timeout_ms), str(self.lock_timeout_ms)))
                    if check:
                        cursor.execute(f"SELECT format, warehouse_id FROM {self._table(_FORMAT)} WHERE singleton=true")
                        row = cursor.fetchone()
                        if not row or row[0] != SCHEMA or row[1] != self.warehouse_id:
                            raise WarehouseError("DATASET_PG_WAREHOUSE_IDENTITY_CHANGED")
                    yield cursor
        except psycopg.Error as error:
            codes = {"23505": "DATASET_PG_DUPLICATE_KEY", "23502": "DATASET_PG_NULL_NOT_ALLOWED",
                     "42501": "DATASET_PG_DATABASE_PERMISSION_DENIED", "57014": "DATASET_PG_OPERATION_CANCELLED",
                     "55P03": "DATASET_PG_DATABASE_BUSY", "22003": "DATASET_PG_NUMERIC_RANGE",
                     "22P02": "DATASET_PG_VALUE_NOT_REPRESENTABLE"}
            raise WarehouseError(codes.get(error.sqlstate, "DATASET_PG_DATABASE_OPERATION_FAILED"), sqlstate=error.sqlstate) from None
        finally:
            if owned:
                connection.close()

    def _lock(self, cursor, kind, value=""):
        key = int.from_bytes(hashlib.sha256(f"{SCHEMA}\0{self.schema}\0{kind}\0{value}".encode()).digest()[:8], "big", signed=True)
        cursor.execute("SELECT pg_advisory_xact_lock(%s)", (key,))

    def _initialize(self, *, create):
        with self._transaction(readonly=not create, check=False) as cursor:
            if create:
                self._lock(cursor, "initialize")
                cursor.execute(f"CREATE SCHEMA IF NOT EXISTS {_identifier(self.schema)}")
            cursor.execute("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=%s", (self.schema,))
            relations = {row[0] for row in cursor.fetchall()}
            if _FORMAT not in relations:
                if not create or relations:
                    raise WarehouseError("DATASET_PG_EMPTY_DEDICATED_SCHEMA_REQUIRED")
                identifier = str(uuid.uuid4())
                if self.warehouse_id is not None:
                    raise WarehouseError("DATASET_PG_EXPECTED_WAREHOUSE_NOT_FOUND")
                cursor.execute(f"CREATE TABLE {self._table(_FORMAT)}(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), format text NOT NULL, warehouse_id text NOT NULL)")
                cursor.execute(f"CREATE TABLE {self._table(_VERSIONS)}(sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, version_id text UNIQUE NOT NULL, created_at timestamptz NOT NULL DEFAULT transaction_timestamp(), record text NOT NULL, manifest bytea NOT NULL)")
                cursor.execute(f"CREATE TABLE {self._table(_VIEWS)}(name text PRIMARY KEY, version_id text NOT NULL REFERENCES {self._table(_VERSIONS)}(version_id), revision bigint NOT NULL CHECK(revision>0))")
                cursor.execute(f"CREATE TABLE {self._table(_HISTORY)}(sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name text NOT NULL, version_id text NOT NULL REFERENCES {self._table(_VERSIONS)}(version_id), previous_version text, revision bigint NOT NULL, activated_at timestamptz NOT NULL DEFAULT transaction_timestamp(), UNIQUE(name,revision))")
                cursor.execute(f"INSERT INTO {self._table(_FORMAT)}(format,warehouse_id) VALUES(%s,%s)", (SCHEMA, identifier))
            cursor.execute(f"SELECT format, warehouse_id FROM {self._table(_FORMAT)} WHERE singleton=true")
            row = cursor.fetchone()
            if not row or row[0] != SCHEMA or self.warehouse_id is not None and row[1] != self.warehouse_id:
                raise WarehouseError("DATASET_PG_WAREHOUSE_IDENTITY_CHANGED")
            self.warehouse_id = row[1]

    def _version(self, cursor, version_id, *, include_semantics=False):
        _version_id(version_id)
        cursor.execute(f"SELECT sequence, record FROM {self._table(_VERSIONS)} WHERE version_id=%s", (version_id,))
        row = cursor.fetchone()
        if row is None:
            raise WarehouseError("DATASET_PG_VERSION_NOT_FOUND")
        record = parse(row[1].encode())
        identity = {key: record.get(key) for key in ("schema", "manifestSha256", "sourceBindingSha256", "mapping")}
        if (record.get("version_id") != version_id or record.get("schema") != SCHEMA
                or record.get("warehouse_id") != self.warehouse_id or record.get("warehouse_schema") != self.schema
                or record.get("table") != "_sf_data_" + version_id[:48]
                or digest(_json(identity).encode()) != version_id):
            raise WarehouseError("DATASET_PG_EDITION_METADATA_CHANGED")
        version = {**record, "sequence": row[0]}
        return self._edition_semantics(cursor, version) if include_semantics else version

    def _retained_manifest(self, cursor, version):
        cursor.execute(f"SELECT manifest FROM {self._table(_VERSIONS)} WHERE version_id=%s",
                       (version["version_id"],))
        row = cursor.fetchone()
        if row is None:
            raise WarehouseError("DATASET_PG_VERSION_NOT_FOUND")
        raw = bytes(row[0])
        if digest(raw) != version["manifestSha256"]:
            raise WarehouseError("DATASET_PG_MANIFEST_CHANGED")
        return raw

    def _edition_semantics(self, cursor, version):
        manifest = parse(self._retained_manifest(cursor, version))
        declared = manifest.get("semantics")
        output = manifest.get("outputs", {}).get("semantics.json")
        if declared is None:
            if output is not None or version.get("semantics") is not None:
                raise WarehouseError("DATASET_PG_SEMANTIC_MANIFEST_CHANGED")
            return {**version, "semantics": None, "semantic_dictionary": None,
                    "semantics_status": "NONE"}
        if not isinstance(declared, dict) or not isinstance(output, dict):
            raise WarehouseError("DATASET_PG_SEMANTIC_MANIFEST_CHANGED")
        cursor.execute("SELECT to_regclass(%s)", (self._table(_SEMANTICS),))
        row = None
        if cursor.fetchone()[0] is not None:
            cursor.execute(f"SELECT record,document FROM {self._table(_SEMANTICS)} WHERE version_id=%s",
                           (version["version_id"],))
            row = cursor.fetchone()
        if row is None:
            # Earlier receivers retained the bound manifest without this optional
            # output. Reimporting its original reviewed delivery attaches it to
            # the SAME edition; existing rows/views remain available meanwhile.
            return {**version, "semantics": None, "semantic_dictionary": None,
                    "semantics_status": "SOURCE_REQUIRED",
                    "semantic_source": {"definition": declared, "file": output}}
        descriptor, raw = parse(row[0].encode()), bytes(row[1])
        context = _bound_semantics(raw, descriptor, manifest,
                                  DatasetMapping.from_record(version["mapping"]), version["version_id"])
        return {**version, "semantics": descriptor,
                "semantic_dictionary": context["document"], "semantics_status": "RETAINED"}

    def _retain_semantics(self, cursor, source):
        if source.semantic_source is None:
            return False
        self._lock(cursor, "semantics")
        cursor.execute(f"CREATE TABLE IF NOT EXISTS {self._table(_SEMANTICS)}"
                       f"(version_id text PRIMARY KEY REFERENCES {self._table(_VERSIONS)}(version_id), "
                       "record text NOT NULL, document bytea NOT NULL)")
        cursor.execute(f"SELECT record,document FROM {self._table(_SEMANTICS)} WHERE version_id=%s",
                       (source.version_id,))
        row = cursor.fetchone()
        raw = source.semantic_source["bytes"]
        descriptor = _semantic_descriptor(source.semantic_source, source.mapping, enforced=True)
        _bound_semantics(raw, descriptor, source.manifest, source.mapping, source.version_id)
        if row is not None:
            if bytes(row[1]) != raw or not same_json(parse(row[0].encode()), descriptor):
                raise WarehouseError("DATASET_PG_RETAINED_SEMANTICS_CHANGED")
            return False
        cursor.execute(f"INSERT INTO {self._table(_SEMANTICS)}(version_id,record,document) VALUES(%s,%s,%s)",
                       (source.version_id, _json(descriptor), raw))
        return True

    def import_delivery(self, delivery: DatasetDelivery, mapping: DatasetMapping, *, expected_version=None):
        """Load every verified row and all source metadata in one transaction."""
        source = _input(delivery, mapping)
        if expected_version is not None and source.version_id != expected_version:
            raise WarehouseError("DATASET_PG_REVIEWED_INPUT_CHANGED")
        table = "_sf_data_" + source.version_id[:48]
        observed = [set() for _ in mapping.columns]
        with delivery.file("dataset.jsonl").open() as stream, self._transaction() as cursor:
            self._lock(cursor, "edition", source.version_id)
            cursor.execute(f"SELECT version_id FROM {self._table(_VERSIONS)} WHERE version_id=%s", (source.version_id,))
            if cursor.fetchone():
                received = self._retain_semantics(cursor, source)
                return {**self._version(cursor, source.version_id, include_semantics=True),
                        "import_status": "UNCHANGED", "semantics_received": received}
            columns = [f"{_identifier(_ORDINAL)} bigint NOT NULL UNIQUE", f"{_identifier(_ORIGINAL)} json NOT NULL"]
            columns += [f"{_identifier(c.column)} {c.type}" + (' COLLATE pg_catalog."C"' if c.type == "text" else "") + (" NOT NULL" if not c.nullable else "") for c in mapping.columns]
            keys = [c.column for c in mapping.columns if c.source in mapping.keys] or [_ORDINAL]
            columns.append("PRIMARY KEY (" + ",".join(_identifier(key) for key in keys) + ")")
            cursor.execute(f"CREATE TABLE {self._table(table)}(" + ",".join(columns) + ")")
            copy_columns = [_ORDINAL, _ORIGINAL, *(c.column for c in mapping.columns)]
            with cursor.copy(f"COPY {self._table(table)}(" + ",".join(_identifier(c) for c in copy_columns) + ") FROM STDIN") as copy:
                for ordinal, raw, values, kinds in _rows(source, stream):
                    copy.write_row((ordinal, raw, *values))
                    for index, kind in enumerate(kinds):
                        observed[index].add(kind)
            cursor.execute("SELECT transaction_timestamp()")
            created = cursor.fetchone()[0].isoformat()
            record = {**source.record(),
                      "semantics": _semantic_descriptor(source.semantic_source, mapping, enforced=True)
                                   if source.semantic_source is not None else None,
                      "semantics_status": "RETAINED" if source.semantic_source is not None else "NONE",
                      "warehouse_id": self.warehouse_id, "warehouse_schema": self.schema,
                      "table": table, "qualified_table": self._table(table), "created_at": created,
                      "column_types": [{**c.record(), "json_types": sorted(observed[i])} for i, c in enumerate(mapping.columns)]}
            cursor.execute(f"INSERT INTO {self._table(_VERSIONS)}(version_id,record,manifest) VALUES(%s,%s,%s)",
                           (source.version_id, _json(record), source.manifest_bytes))
            self._retain_semantics(cursor, source)
            record = self._version(cursor, source.version_id, include_semantics=True)
        return {**record, "import_status": "IMPORTED",
                "semantics_received": source.semantic_source is not None}

    def status(self):
        with self._transaction(readonly=True) as cursor:
            cursor.execute(f"SELECT count(*) FROM {self._table(_VERSIONS)}")
            editions = cursor.fetchone()[0]
            cursor.execute(f"SELECT name,version_id,revision FROM {self._table(_VIEWS)} ORDER BY name")
            views = [{"name": row[0], "version_id": row[1], "revision": row[2]} for row in cursor.fetchall()]
            cursor.execute("SHOW server_version")
            return {"schema": SCHEMA, "warehouse_id": self.warehouse_id, "warehouse_schema": self.schema,
                    "editions": editions, "views": views, "postgresql_version": cursor.fetchone()[0]}

    def version(self, version_id):
        with self._transaction(readonly=True) as cursor:
            return self._version(cursor, version_id, include_semantics=True)

    def manifest_bytes(self, version_id):
        _version_id(version_id)
        with self._transaction(readonly=True) as cursor:
            version = self._version(cursor, version_id)
            return self._retained_manifest(cursor, version)

    def semantics(self, version_id):
        """Open original source meanings and their reviewed SQL aliases."""
        with self._transaction(readonly=True) as cursor:
            version = self._version(cursor, version_id, include_semantics=True)
            if version["semantics_status"] == "SOURCE_REQUIRED":
                raise WarehouseError("DATASET_PG_REIMPORT_ORIGINAL_DICTIONARY_REQUIRED")
            if version["semantics"] is None:
                return None
            return {**version["semantics"], "version_id": version_id,
                    "document": version["semantic_dictionary"]}

    def semantics_bytes(self, version_id):
        """Export the exact original dictionary; None denotes a legacy edition."""
        with self._transaction(readonly=True) as cursor:
            version = self._version(cursor, version_id, include_semantics=True)
            if version["semantics_status"] == "SOURCE_REQUIRED":
                raise WarehouseError("DATASET_PG_REIMPORT_ORIGINAL_DICTIONARY_REQUIRED")
            if version["semantics"] is None:
                return None
            cursor.execute(f"SELECT document FROM {self._table(_SEMANTICS)} WHERE version_id=%s",
                           (version_id,))
            return bytes(cursor.fetchone()[0])

    def compare_semantics(self, before_id, after_id):
        """Compare dictionary definitions, capture and aliases independently of rows."""
        with self._transaction(readonly=True) as cursor:
            before = self._version(cursor, before_id, include_semantics=True)
            after = self._version(cursor, after_id, include_semantics=True)
            if any(v["semantics_status"] == "SOURCE_REQUIRED" for v in (before, after)):
                raise WarehouseError("DATASET_PG_REIMPORT_ORIGINAL_DICTIONARY_REQUIRED")
        first, second = before.get("semantics"), after.get("semantics")

        def columns(version):
            document = version.get("semantic_dictionary") or {}
            meanings = {column["name"]: column for column in document.get("columns", [])}
            return {column["source"]: {"sql_column": column["column"],
                     "sql_type": column["type"], "nullable": column["nullable"],
                     "meaning": meanings.get(column["source"])}
                    for column in version["mapping"]["columns"]}

        left, right = columns(before), columns(after)
        changes = [{"source": name, "before": left.get(name), "after": right.get(name)}
                   for name in sorted(set(left) | set(right))
                   if not same_json(left.get(name), right.get(name))]
        return {"schema": "stellar-forge.python-semantic-comparison.v1",
                "before_version": before_id, "after_version": after_id,
                "before": first, "after": second,
                "definition_changed": (first or {}).get("definition_sha256") != (second or {}).get("definition_sha256"),
                "capture_changed": (first or {}).get("capture_manifest_sha256") != (second or {}).get("capture_manifest_sha256"),
                "mapping_changed": not same_json(before["mapping"], after["mapping"]),
                "columns": changes, "before_document": before.get("semantic_dictionary"),
                "after_document": after.get("semantic_dictionary")}

    def versions(self, *, before=None, limit=100):
        _page(before, limit)
        with self._transaction(readonly=True) as cursor:
            where = "WHERE sequence < %s" if before is not None else ""
            cursor.execute(f"SELECT sequence,record FROM {self._table(_VERSIONS)} {where} ORDER BY sequence DESC LIMIT %s",
                           ((before,) if before is not None else ()) + (limit + 1,))
            rows = cursor.fetchall()
            return {"versions": [{**parse(row[1].encode()), "sequence": row[0]} for row in rows[:limit]],
                    "next_before": rows[limit - 1][0] if len(rows) > limit else None}

    def current(self, name):
        _public_name(name)
        with self._transaction(readonly=True) as cursor:
            cursor.execute(f"SELECT version_id,revision FROM {self._table(_VIEWS)} WHERE name=%s", (name,))
            row = cursor.fetchone()
            return {"name": name, "qualified_view": self._table(name), "revision": row[1] if row else 0,
                    "version": self._version(cursor, row[0], include_semantics=True) if row else None}

    def activate(self, name, version_id, *, expected_revision):
        """Atomically select a version while retaining grants/dependent views."""
        _public_name(name)
        if type(expected_revision) is not int or expected_revision < 0:
            raise WarehouseError("DATASET_PG_VIEW_REVISION_INVALID")
        with self._transaction() as cursor:
            self._lock(cursor, "view", name)
            version = self._version(cursor, version_id, include_semantics=True)
            cursor.execute(f"SELECT version_id,revision FROM {self._table(_VIEWS)} WHERE name=%s FOR UPDATE", (name,))
            current = cursor.fetchone()
            revision = current[1] if current else 0
            if expected_revision != revision:
                raise WarehouseError("DATASET_PG_VIEW_CHANGED")
            if current and current[0] == version_id:
                return {"status": "UNCHANGED", "name": name, "qualified_view": self._table(name), "revision": revision, "version": version}
            mapping = DatasetMapping.from_record(version["mapping"])
            if current:
                previous = self._version(cursor, current[0])
                if DatasetMapping.from_record(previous["mapping"]).signature != mapping.signature:
                    raise WarehouseError("DATASET_PG_VIEW_SCHEMA_CHANGED_USE_NEW_VIEW")
            else:
                cursor.execute("SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=%s AND c.relname=%s", (self.schema, name))
                if cursor.fetchone():
                    raise WarehouseError("DATASET_PG_UNMANAGED_RELATION_EXISTS")
            projection = ",".join(_identifier(c.column) for c in mapping.columns) + "," + _identifier(_ORDINAL)
            command = "CREATE OR REPLACE VIEW" if current else "CREATE VIEW"
            cursor.execute(f"{command} {self._table(name)} AS SELECT {projection} FROM {self._table(version['table'])}")
            revision += 1
            cursor.execute(f"INSERT INTO {self._table(_VIEWS)}(name,version_id,revision) VALUES(%s,%s,%s) ON CONFLICT(name) DO UPDATE SET version_id=EXCLUDED.version_id,revision=EXCLUDED.revision", (name, version_id, revision))
            cursor.execute(f"INSERT INTO {self._table(_HISTORY)}(name,version_id,previous_version,revision) VALUES(%s,%s,%s,%s)", (name, version_id, current[0] if current else None, revision))
        return {"status": "ACTIVATED", "name": name, "qualified_view": self._table(name), "revision": revision, "version": version}

    def history(self, name, *, before=None, limit=100):
        _public_name(name)
        _page(before, limit)
        with self._transaction(readonly=True) as cursor:
            where = " AND sequence < %s" if before is not None else ""
            cursor.execute(f"SELECT sequence,version_id,previous_version,revision,activated_at FROM {self._table(_HISTORY)} WHERE name=%s {where} ORDER BY sequence DESC LIMIT %s",
                           (name,) + ((before,) if before is not None else ()) + (limit + 1,))
            rows = cursor.fetchall()
            return {"name": name, "history": [{"sequence": r[0], "version_id": r[1], "previous_version": r[2], "revision": r[3], "activated_at": r[4].isoformat()} for r in rows[:limit]],
                    "next_before": rows[limit - 1][0] if len(rows) > limit else None}

    def rows(self, version_id, *, after=0, limit=100, include_original=False):
        if type(after) is not int or after < 0 or type(include_original) is not bool:
            raise WarehouseError("DATASET_PG_ROW_PAGE_INVALID")
        _page(None, limit)
        with self._transaction(readonly=True) as cursor:
            version = self._version(cursor, version_id)
            mapping = DatasetMapping.from_record(version["mapping"])
            projection = [_identifier(_ORDINAL), *(_identifier(c.column) + ("::text" if c.type == "json" else "") for c in mapping.columns)]
            if include_original:
                projection.append(_identifier(_ORIGINAL) + "::text")
            cursor.execute(f"SELECT {','.join(projection)} FROM {self._table(version['table'])} WHERE {_identifier(_ORDINAL)}>%s ORDER BY {_identifier(_ORDINAL)} LIMIT %s", (after, limit + 1))
            rows = cursor.fetchall()
            output = []
            for row in rows[:limit]:
                item = {"row_number": row[0], "values": {c.column: _returned_value(c, row[i + 1]) for i, c in enumerate(mapping.columns)}}
                if include_original:
                    item["original_json"] = row[-1]
                output.append(item)
            return {"version_id": version_id, "rows": output, "next_after": rows[limit - 1][0] if len(rows) > limit else None}

    def compare(self, previous_id, current_id, *, offset=0, limit=100):
        """Compare all mapped values in PostgreSQL using declared source keys."""
        if type(offset) is not int or offset < 0:
            raise WarehouseError("DATASET_PG_COMPARE_OFFSET_INVALID")
        _page(None, limit)
        with self._transaction(readonly=True) as cursor:
            previous, current = self._version(cursor, previous_id), self._version(cursor, current_id)
            mapping, following = DatasetMapping.from_record(previous["mapping"]), DatasetMapping.from_record(current["mapping"])
            if mapping.record() != following.record() or not mapping.keys:
                raise WarehouseError("DATASET_PG_COMPARE_REQUIRES_SAME_MAPPING_AND_KEYS")
            keys = [c for c in mapping.columns if c.source in mapping.keys]
            join = " AND ".join(f"a.{_identifier(c.column)}=b.{_identifier(c.column)}" for c in keys)
            different = " OR ".join(f"a.{_identifier(c.column)}" + ("::text" if c.type == "json" else "") + f" IS DISTINCT FROM b.{_identifier(c.column)}" + ("::text" if c.type == "json" else "") for c in mapping.columns)
            old, new = f"a.{_identifier(_ORDINAL)}", f"b.{_identifier(_ORDINAL)}"
            change = f"CASE WHEN {old} IS NULL THEN 'ADDED' WHEN {new} IS NULL THEN 'REMOVED' WHEN ({different}) THEN 'CHANGED' ELSE 'UNCHANGED' END"
            joined = f"FROM {self._table(previous['table'])} a FULL OUTER JOIN {self._table(current['table'])} b ON {join}"
            cursor.execute(f"SELECT {change} AS kind,count(*) {joined} GROUP BY kind")
            totals = {"ADDED": 0, "REMOVED": 0, "CHANGED": 0, "UNCHANGED": 0}
            totals.update({r[0]: r[1] for r in cursor.fetchall()})
            # Composite-to-JSON text keeps an entire wide source below PostgreSQL's
            # target-list column limit. Python parses its numeric text as Decimal.
            projection = [change, old, new, "row_to_json(a)::text", "row_to_json(b)::text"]
            order = ",".join(f"COALESCE(a.{_identifier(c.column)},b.{_identifier(c.column)})" for c in keys)
            cursor.execute(f"SELECT {','.join(projection)} {joined} WHERE {old} IS NULL OR {new} IS NULL OR ({different}) ORDER BY {order} OFFSET %s LIMIT %s", (offset, limit + 1))
            rows = cursor.fetchall()
            changes = []
            for row in rows[:limit]:
                before = _database_row(row[3], mapping) if row[1] is not None else None
                after = _database_row(row[4], mapping) if row[2] is not None else None
                changes.append({"kind": row[0], "before_row": row[1], "after_row": row[2], "before": before, "after": after})
            return {"previous_version": previous_id, "current_version": current_id, "totals": totals,
                    "changes": changes, "next_offset": offset + limit if len(rows) > limit else None}


def _returned_value(column, value):
    if column.type == "json" and value is not None:
        return json.loads(value, parse_float=Decimal, object_pairs_hook=unique_object,
                          parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    return value


def _database_row(raw, mapping):
    values = json.loads(raw, parse_float=Decimal, object_pairs_hook=unique_object,
                        parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    result = {}
    for column in mapping.columns:
        value = values[column.column]
        if value is not None:
            if column.type == "numeric":
                value = Decimal(value)
            elif column.type == "double precision":
                value = float(value)
            elif column.type == "date":
                value = date.fromisoformat(value)
            elif column.type == "timestamp with time zone":
                value = datetime.fromisoformat(value)
        result[column.column] = value
    return result
