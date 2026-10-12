"""Retained DuckDB customer editions over the original SF88/SF100 delivery.

DuckDB is an optional native dependency. Acquisition, payment and delivery
verification remain with DatasetDelivery. This workspace owns only the local
analytical editions, selected views, saved SQL and complete receiving exports.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation, localcontext
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import stat
import tempfile
import threading

from .datasets import DatasetDelivery
from .errors import StateError
from .storage import digest, dump, lock, parse, private_directory, read, sync_directory, unique_object, write

SCHEMA = "stellar-forge.sf100.duckdb-workspace.v1"
_HEX = re.compile(r"^[0-9a-f]{64}$")
_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,119}$")
_DECIMAL = re.compile(r"^DECIMAL\(([1-9][0-9]?),([0-9]{1,2})\)$")
_TYPES = {"VARCHAR", "BOOLEAN", "BIGINT", "HUGEINT", "DOUBLE", "DATE", "TIMESTAMP", "TIMESTAMPTZ", "JSON"}
_FILES = ("manifest.json", "dataset.jsonl", "dataset.csv", "review.html")
_LINE = 2_097_152
_CHUNK = 1_048_576
_FORMAT = "stellar-forge.sf88.dataset-delivery.v1"


def _now():
    return datetime.now(timezone.utc).isoformat()


def _json(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":"))


def _wire(value):
    if isinstance(value, Decimal):
        return str(value)
    if type(value) is int and abs(value) > 9_007_199_254_740_991:
        return str(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, bytes):
        return {"encoding": "hex", "value": value.hex()}
    if isinstance(value, (tuple, list)):
        return [_wire(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _wire(item) for key, item in value.items()}
    if isinstance(value, float) and not math.isfinite(value):
        return {"number": str(value)}
    return value


def _qid(value):
    if not isinstance(value, str) or not value or len(value.encode()) > 240 or "\x00" in value:
        raise StateError("DUCKDB_COLUMN_NAME_INVALID")
    return '"' + value.replace('"', '""') + '"'


def _name(value):
    if not isinstance(value, str) or not _NAME.fullmatch(value) or value.lower().startswith(("sf_", "duckdb_", "sqlite_")):
        raise StateError("DUCKDB_NAME_INVALID")
    return value


def _hex(value):
    if not isinstance(value, str) or not _HEX.fullmatch(value):
        raise StateError("DUCKDB_ID_INVALID")
    return value


def _type(value):
    if not isinstance(value, str):
        raise StateError("DUCKDB_TYPE_INVALID")
    value = value.upper().replace(" ", "")
    match = _DECIMAL.fullmatch(value)
    if value not in _TYPES and not match:
        raise StateError("DUCKDB_TYPE_INVALID")
    if match and not 0 <= int(match[2]) <= int(match[1]) <= 38:
        raise StateError("DUCKDB_DECIMAL_RANGE_INVALID")
    return value


def _kind(value):
    if value is None:
        return "null"
    if type(value) is bool:
        return "boolean"
    if type(value) is int:
        return "integer"
    if isinstance(value, (float, Decimal)):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    raise StateError("DUCKDB_JSON_TYPE_INVALID")


def _exact_json(value):
    """Serialize Decimal JSON numbers without converting their value to float."""
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise StateError("DUCKDB_NONFINITE_JSON_NUMBER")
        return str(value)
    if isinstance(value, dict):
        return "{" + ",".join(json.dumps(key, ensure_ascii=False) + ":" + _exact_json(item) for key, item in value.items()) + "}"
    if isinstance(value, list):
        return "[" + ",".join(_exact_json(item) for item in value) + "]"
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


def _row(raw):
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object,
                           parse_float=Decimal,
                           parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except (ValueError, UnicodeError):
        raise StateError("DUCKDB_ORIGINAL_ROW_INVALID") from None
    if not isinstance(value, dict):
        raise StateError("DUCKDB_ORIGINAL_ROW_INVALID")
    return value


def _convert(value, column):
    kind = column["type"]
    if value is None:
        if not column["nullable"]:
            raise StateError("DUCKDB_NULL_IN_REQUIRED_COLUMN")
        return None
    if kind == "JSON":
        return _exact_json(value)
    if kind == "VARCHAR":
        if not isinstance(value, str):
            raise StateError("DUCKDB_STRING_MAPPING_REQUIRES_STRING")
        return value
    if kind == "BOOLEAN":
        if type(value) is not bool:
            raise StateError("DUCKDB_BOOLEAN_MAPPING_REQUIRES_BOOLEAN")
        return value
    if kind in {"BIGINT", "HUGEINT"}:
        if type(value) is bool or not (type(value) is int or isinstance(value, str) and re.fullmatch(r"-?(0|[1-9][0-9]*)", value)):
            raise StateError("DUCKDB_INTEGER_MAPPING_INVALID")
        number = int(value)
        bits = 64 if kind == "BIGINT" else 128
        if not -(2 ** (bits - 1)) <= number < 2 ** (bits - 1):
            raise StateError("DUCKDB_INTEGER_OVERFLOW")
        return number
    match = _DECIMAL.fullmatch(kind)
    if match:
        if type(value) is bool or not isinstance(value, (str, int, Decimal)):
            raise StateError("DUCKDB_DECIMAL_REQUIRES_EXACT_VALUE")
        try:
            number = Decimal(value)
            width, scale = int(match[1]), int(match[2])
            if not number.is_finite():
                raise ValueError()
            with localcontext() as context:
                context.prec = 80  # Enough for every supported DECIMAL(1..38,s).
                quantum = Decimal(1).scaleb(-scale)
                quantized = number.quantize(quantum)
                if quantized != number or abs(number) >= Decimal(10) ** (width - scale):
                    raise ValueError()
            return quantized
        except (InvalidOperation, ValueError, OverflowError):
            raise StateError("DUCKDB_DECIMAL_SCALE_OR_WIDTH_LOSS") from None
    if kind == "DOUBLE":
        if type(value) is bool or not isinstance(value, (int, float, Decimal, str)):
            raise StateError("DUCKDB_DOUBLE_MAPPING_INVALID")
        try:
            number = float(value)
            if not math.isfinite(number):
                raise ValueError()
            return number
        except (ValueError, OverflowError):
            raise StateError("DUCKDB_DOUBLE_MAPPING_INVALID") from None
    if not isinstance(value, str):
        raise StateError("DUCKDB_TEMPORAL_MAPPING_REQUIRES_ISO_STRING")
    try:
        if kind == "DATE":
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
                raise ValueError()
            return date.fromisoformat(value)
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if kind == "TIMESTAMP" and parsed.tzinfo is not None:
            raise ValueError()
        if kind == "TIMESTAMPTZ" and (parsed.tzinfo is None or parsed.utcoffset() is None):
            raise ValueError()
        return parsed
    except ValueError:
        raise StateError("DUCKDB_TEMPORAL_MAPPING_INVALID") from None


def _descriptor(path, name=None):
    checksum = hashlib.sha256()
    size = 0
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode):
            raise StateError("DUCKDB_EXPORT_FILE_INVALID")
        while chunk := stream.read(_CHUNK):
            size += len(chunk)
            checksum.update(chunk)
    suffix = Path(path).suffix
    return {"name": name or Path(path).name, "path": str(path), "bytes": size,
            "sha256": checksum.hexdigest(), "mime": {".csv": "text/csv", ".json": "application/json",
            ".parquet": "application/vnd.apache.parquet", ".duckdb": "application/octet-stream"}.get(suffix, "application/octet-stream")}


def _new_destination(value, root):
    path = Path(os.path.abspath(Path(value).expanduser()))
    if path == root or root in path.parents:
        raise StateError("DUCKDB_DESTINATION_MUST_BE_OUTSIDE_WORKSPACE")
    private_directory(path.parent)
    if path.exists():
        private_directory(path, create=False)
    else:
        path.mkdir(mode=0o700)
        sync_directory(path.parent)
    return path


class DuckDBWorkspace:
    """One private native database, reopened per operation under the existing lock."""

    def __init__(self, directory, *, memory_limit="128MB", threads=1):
        try:
            import duckdb
        except ImportError:
            raise StateError("DUCKDB_OPTIONAL_DEPENDENCY_REQUIRED") from None
        self.duckdb = duckdb
        self.directory = private_directory(Path(directory))
        self.path = self.directory / "warehouse.duckdb"
        self.memory_limit = memory_limit
        if type(threads) is not int or not 1 <= threads <= 16:
            raise StateError("DUCKDB_THREADS_INVALID")
        self.threads = threads
        self._mutex = threading.RLock()
        with self._guard(), self._connection(writeable=True) as db:
            db.execute("BEGIN")
            try:
                db.execute("CREATE TABLE IF NOT EXISTS sf_workspace(key VARCHAR PRIMARY KEY,value VARCHAR NOT NULL)")
                existing = db.execute("SELECT value FROM sf_workspace WHERE key='schema'").fetchone()
                if existing and existing[0] != SCHEMA:
                    raise StateError("DUCKDB_WORKSPACE_SCHEMA_MISMATCH")
                db.execute("INSERT INTO sf_workspace VALUES('schema',?) ON CONFLICT DO NOTHING", [SCHEMA])
                db.execute("CREATE TABLE IF NOT EXISTS sf_reviews(id VARCHAR PRIMARY KEY,created_at VARCHAR NOT NULL,record VARCHAR NOT NULL)")
                db.execute("CREATE TABLE IF NOT EXISTS sf_editions(id VARCHAR PRIMARY KEY,sequence BIGINT UNIQUE NOT NULL,record VARCHAR NOT NULL)")
                db.execute("CREATE TABLE IF NOT EXISTS sf_files(edition_id VARCHAR,name VARCHAR,bytes BIGINT,sha256 VARCHAR,PRIMARY KEY(edition_id,name))")
                db.execute("CREATE TABLE IF NOT EXISTS sf_file_chunks(edition_id VARCHAR,name VARCHAR,part BIGINT,content BLOB,PRIMARY KEY(edition_id,name,part))")
                db.execute("CREATE TABLE IF NOT EXISTS sf_views(name VARCHAR PRIMARY KEY,edition_id VARCHAR,revision BIGINT)")
                db.execute("CREATE TABLE IF NOT EXISTS sf_view_history(name VARCHAR,revision BIGINT,record VARCHAR,PRIMARY KEY(name,revision))")
                db.execute("CREATE TABLE IF NOT EXISTS sf_queries(id VARCHAR PRIMARY KEY,name VARCHAR UNIQUE,revision BIGINT,record VARCHAR)")
                db.execute("CREATE TABLE IF NOT EXISTS sf_query_history(id VARCHAR,revision BIGINT,record VARCHAR,PRIMARY KEY(id,revision))")
                db.execute("CREATE TABLE IF NOT EXISTS sf_exports(id VARCHAR PRIMARY KEY,record VARCHAR)")
                db.commit()
            except BaseException:
                db.rollback()
                raise
        os.chmod(self.path, 0o600)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

    def close(self):
        """Every method has already closed its own native connection."""

    @contextmanager
    def _guard(self):
        with self._mutex, lock(self.directory):
            yield

    @contextmanager
    def _connection(self, *, writeable=False, allowed_paths=()):
        if self.path.exists():
            info = self.path.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_nlink != 1:
                raise StateError("DUCKDB_PRIVATE_DATABASE_REQUIRED")
        config = {"enable_external_access": "false", "autoinstall_known_extensions": "false",
                  "autoload_known_extensions": "false", "allow_unsigned_extensions": "false",
                  "threads": str(self.threads), "memory_limit": self.memory_limit}
        db = self.duckdb.connect(str(self.path), read_only=not writeable, config=config)
        try:
            if allowed_paths:
                literal = "[" + ",".join("'" + str(path).replace("'", "''") + "'" for path in allowed_paths) + "]"
                db.execute("SET allowed_paths=" + literal)
            db.execute("SET lock_configuration=true")
            yield db
        finally:
            db.close()

    @staticmethod
    def _record(db, table, identity):
        row = db.execute("SELECT record FROM " + table + " WHERE id=?", [identity]).fetchone()
        if row is None:
            raise StateError("DUCKDB_RECORD_NOT_FOUND")
        return parse(row[0].encode())

    @staticmethod
    def _views(db):
        return [{"name": name, "edition_id": edition, "revision": revision}
                for name, edition, revision in db.execute("SELECT name,edition_id,revision FROM sf_views ORDER BY name").fetchall()]

    def _delivery(self, report_path):
        report_path = Path(os.path.abspath(Path(report_path).expanduser()))
        raw = read(report_path, 8 * 1024 * 1024)
        report = parse(raw)
        # Accept the original bridge's whole output or its unchanged report.
        if isinstance(report, dict) and report.get("mode") == "ORIGINAL_PYTHON_DATASET":
            report = report.get("report")
        if isinstance(report, dict) and isinstance(report.get("session"), dict) and report["session"].get("schema") == "stellar-forge.buyer-delivery.v1":
            report = DatasetDelivery.from_finalized_scan(report).native
        if not isinstance(report, dict) or report.get("schema") not in {_FORMAT, "stellar-forge.sf100.dataset-delivery.v1"}:
            raise StateError("DUCKDB_ORIGINAL_DELIVERY_REPORT_REQUIRED")
        status = report.get("nativeStatus")
        if not isinstance(status, dict) or status.get("complete") is not True or status.get("finalized") is not True:
            raise StateError("DUCKDB_COMPLETE_FINALIZED_DELIVERY_REQUIRED")
        binding = _hex(report.get("sourceBindingSha256"))
        directory = private_directory(Path(report["directory"]), create=False)
        delivery = DatasetDelivery(report, directory)
        manifest_bytes = delivery.file("manifest.json").read_bytes(limit=4 * 1024 * 1024)
        manifest = parse(manifest_bytes)
        dataset = manifest.get("dataset") or {}
        fields, total = dataset.get("projectedFields"), dataset.get("rows")
        pages = manifest.get("sourcePages")
        if (manifest.get("schema") != "stellar-forge.buyer-delivery-manifest.v1"
            or not isinstance(fields, list) or not 1 <= len(fields) <= 1024
            or not all(isinstance(item, str) and item for item in fields)
            or len(set(fields)) != len(fields) or type(total) is not int or not 0 <= total <= 1_000_000
            or not isinstance(pages, list) or status.get("pages") != len(pages)
            or status.get("rows") != total or status.get("snapshot") != dataset.get("snapshot")
            or manifest.get("paymentStatus") != report.get("paymentStatus")):
            raise StateError("DUCKDB_ORIGINAL_MANIFEST_BINDING_INVALID")
        output = report["outputs"].get("dataset.jsonl") or {}
        if manifest.get("outputs", {}).get("dataset.jsonl") != {key: output.get(key) for key in ("bytes", "sha256")}:
            raise StateError("DUCKDB_ORIGINAL_ROWS_BINDING_INVALID")
        return delivery, manifest_bytes, {"report_path": str(report_path), "native": report,
            "manifest": manifest, "fields": fields, "row_count": total,
            "manifest_sha256": digest(manifest_bytes), "source_binding_sha256": binding,
            "input_report_sha256": digest(raw)}

    @staticmethod
    def _rows(delivery, fields, total):
        with delivery.file("dataset.jsonl").open() as stream:
            count = 0
            while raw := stream.readline(_LINE + 1):
                if len(raw) > _LINE or not raw.endswith(b"\n"):
                    raise StateError("DUCKDB_ORIGINAL_ROW_FORMAT_INVALID")
                row = _row(raw)
                if set(row) != set(fields):
                    raise StateError("DUCKDB_ORIGINAL_ROW_FIELDS_CHANGED")
                count += 1
                if count > total:
                    raise StateError("DUCKDB_ORIGINAL_ROW_COUNT_CHANGED")
                yield row
            if count != total:
                raise StateError("DUCKDB_ORIGINAL_ROW_COUNT_CHANGED")

    def inspect_delivery(self, report_path):
        delivery, _, result = self._delivery(report_path)
        types = {field: set() for field in result["fields"]}
        preview = []
        integer_overflow = set()
        for row in self._rows(delivery, result["fields"], result["row_count"]):
            if len(preview) < 20:
                preview.append(_wire(row))
            for field, value in row.items():
                types[field].add(_kind(value))
                if type(value) is int and not -(2**127) <= value < 2**127:
                    integer_overflow.add(field)
        columns = []
        used = {"sf_row"}
        for index, field in enumerate(result["fields"]):
            observed = types[field] - {"null"}
            kind = ({"string": "VARCHAR", "boolean": "BOOLEAN", "integer": "HUGEINT", "number": "JSON"}.get(next(iter(observed)))
                    if len(observed) == 1 else "JSON")
            if field in integer_overflow or not kind:
                kind = "JSON"
            name = field if field.casefold() not in used and "\x00" not in field and len(field.encode()) <= 240 else "column_" + str(index + 1)
            while name.casefold() in used:
                name += "_"
            used.add(name.casefold())
            columns.append({"source": field, "name": name, "type": kind, "nullable": "null" in types[field] or not observed})
        return {**result, "preview": preview, "observed_types": {field: sorted(value) for field, value in types.items()},
                "default_columns": columns}

    def review_import(self, report_path, columns=None, keys=None):
        inspected = self.inspect_delivery(report_path)
        columns = inspected["default_columns"] if columns is None else columns
        if not isinstance(columns, list) or len(columns) != len(inspected["fields"]):
            raise StateError("DUCKDB_COMPLETE_COLUMN_MAPPING_REQUIRED")
        mapped = []
        for item in columns:
            if not isinstance(item, dict) or set(item) - {"source", "name", "type", "nullable"}:
                raise StateError("DUCKDB_COLUMN_MAPPING_INVALID")
            nullable = item.get("nullable", True)
            if type(nullable) is not bool:
                raise StateError("DUCKDB_NULLABLE_FLAG_INVALID")
            _qid(item.get("name"))
            mapped.append({"source": item.get("source"), "name": item["name"], "type": _type(item.get("type")), "nullable": nullable})
        if set(item["source"] for item in mapped) != set(inspected["fields"]) or len(set(item["source"] for item in mapped)) != len(mapped):
            raise StateError("DUCKDB_SOURCE_COLUMN_MAPPING_INVALID")
        names = [item["name"].casefold() for item in mapped]
        if len(set(names)) != len(names) or "sf_row" in names:
            raise StateError("DUCKDB_COLUMN_NAME_COLLISION")
        keys = [] if keys is None else keys
        if not isinstance(keys, list) or len(set(keys)) != len(keys) or any(key not in [c["name"] for c in mapped] for key in keys):
            raise StateError("DUCKDB_KEY_MAPPING_INVALID")
        delivery, _, source = self._delivery(report_path)
        if source["manifest_sha256"] != inspected["manifest_sha256"] or source["source_binding_sha256"] != inspected["source_binding_sha256"]:
            raise StateError("DUCKDB_DELIVERY_CHANGED_DURING_REVIEW")
        for row in self._rows(delivery, inspected["fields"], inspected["row_count"]):
            for column in mapped:
                _convert(row[column["source"]], column)
        identity = {"schema": SCHEMA, "manifest_sha256": inspected["manifest_sha256"],
                    "source_binding_sha256": inspected["source_binding_sha256"], "columns": mapped, "keys": keys}
        review = {**identity, "review_id": digest(_json(identity).encode()), "report_path": inspected["report_path"],
                  "row_count": inspected["row_count"], "created_at": _now(), "preview": inspected["preview"],
                  "observed_types": inspected["observed_types"]}
        with self._guard(), self._connection(writeable=True) as db:
            existing = db.execute("SELECT record FROM sf_reviews WHERE id=?", [review["review_id"]]).fetchone()
            if existing:
                return parse(existing[0].encode())
            db.execute("INSERT INTO sf_reviews VALUES(?,?,?)", [review["review_id"], review["created_at"], _json(review)])
        return review

    def reviews(self):
        with self._guard(), self._connection() as db:
            return {"reviews": [parse(row[0].encode()) for row in db.execute("SELECT record FROM sf_reviews ORDER BY created_at DESC").fetchall()]}

    def import_review(self, review_id):
        review_id = _hex(review_id)
        with self._guard(), self._connection(writeable=True) as db:
            review = self._record(db, "sf_reviews", review_id)
            existing = db.execute("SELECT record FROM sf_editions WHERE id=?", [review_id]).fetchone()
            if existing:
                return {**parse(existing[0].encode()), "import_status": "UNCHANGED"}
            delivery, manifest_raw, source = self._delivery(review["report_path"])
            if source["manifest_sha256"] != review["manifest_sha256"] or source["source_binding_sha256"] != review["source_binding_sha256"]:
                raise StateError("DUCKDB_REVIEWED_DELIVERY_CHANGED")
            table = "sf_edition_" + review_id
            columns = review["columns"]
            definitions = ["sf_row BIGINT PRIMARY KEY"] + [_qid(c["name"]) + " " + c["type"] + ("" if c["nullable"] else " NOT NULL") for c in columns]
            db.execute("BEGIN")
            try:
                db.execute("CREATE TABLE " + _qid(table) + "(" + ",".join(definitions) + ")")
                sql = "INSERT INTO " + _qid(table) + " VALUES(" + ",".join("?" for _ in range(len(columns) + 1)) + ")"
                count = 0
                batch = []
                for row in self._rows(delivery, source["fields"], source["row_count"]):
                    count += 1
                    batch.append([count] + [_convert(row[c["source"]], c) for c in columns])
                    if len(batch) == 256:
                        db.executemany(sql, batch)
                        batch.clear()
                if batch:
                    db.executemany(sql, batch)
                if review["keys"]:
                    keys_sql = ",".join(_qid(key) for key in review["keys"])
                    null_sql = " OR ".join(_qid(key) + " IS NULL" for key in review["keys"])
                    if db.execute("SELECT count(*) FROM " + _qid(table) + " WHERE " + null_sql).fetchone()[0]:
                        raise StateError("DUCKDB_NULL_KEY")
                    if db.execute("SELECT 1 FROM " + _qid(table) + " GROUP BY " + keys_sql + " HAVING count(*)>1 LIMIT 1").fetchone():
                        raise StateError("DUCKDB_DUPLICATE_KEY")
                files = []
                for name in delivery.file_names():
                    metadata = delivery.native["outputs"].get(name) or delivery.native["archives"][name]
                    checksum, length, part = hashlib.sha256(), 0, 0
                    with delivery.file(name).open() as stream:
                        while chunk := stream.read(_CHUNK):
                            checksum.update(chunk)
                            length += len(chunk)
                            db.execute("INSERT INTO sf_file_chunks VALUES(?,?,?,?)", [review_id, name, part, chunk])
                            part += 1
                    if length != metadata["bytes"] or checksum.hexdigest() != metadata["sha256"]:
                        raise StateError("DUCKDB_ORIGINAL_SOURCE_CHANGED")
                    db.execute("INSERT INTO sf_files VALUES(?,?,?,?)", [review_id, name, length, checksum.hexdigest()])
                    files.append({"name": name, "bytes": length, "sha256": checksum.hexdigest()})
                input_raw = read(Path(review["report_path"]), 8 * 1024 * 1024)
                if digest(input_raw) != source["input_report_sha256"]:
                    raise StateError("DUCKDB_ORIGINAL_REPORT_CHANGED")
                db.execute("INSERT INTO sf_files VALUES(?,?,?,?)", [review_id, "input-report.json", len(input_raw), digest(input_raw)])
                db.execute("INSERT INTO sf_file_chunks VALUES(?,?,0,?)", [review_id, "input-report.json", input_raw])
                report_raw = _json(delivery.native).encode()
                db.execute("INSERT INTO sf_files VALUES(?,?,?,?)", [review_id, "delivery-report.json", len(report_raw), digest(report_raw)])
                db.execute("INSERT INTO sf_file_chunks VALUES(?,?,0,?)", [review_id, "delivery-report.json", report_raw])
                sequence = db.execute("SELECT coalesce(max(sequence),0)+1 FROM sf_editions").fetchone()[0]
                record = {"schema": SCHEMA, "edition_id": review_id, "sequence": sequence, "table": table,
                          "created_at": _now(), "row_count": count, "columns": columns, "keys": review["keys"],
                          "row_order_column": "sf_row", "source": {**source, "files": files},
                          "review_id": review_id, "manifest_sha256": digest(manifest_raw)}
                db.execute("INSERT INTO sf_editions VALUES(?,?,?)", [review_id, sequence, _json(record)])
                db.commit()
                return {**record, "import_status": "IMPORTED"}
            except BaseException:
                db.rollback()
                raise

    def edition(self, edition_id):
        with self._guard(), self._connection() as db:
            return self._record(db, "sf_editions", _hex(edition_id))

    def editions(self, limit=100, before=None):
        if type(limit) is not int or not 1 <= limit <= 1000 or before is not None and (type(before) is not int or before < 1):
            raise StateError("DUCKDB_HISTORY_PAGE_INVALID")
        with self._guard(), self._connection() as db:
            rows = db.execute("SELECT sequence,record FROM sf_editions WHERE (? IS NULL OR sequence<?) ORDER BY sequence DESC LIMIT ?", [before, before, limit + 1]).fetchall()
            return {"editions": [parse(row[1].encode()) for row in rows[:limit]],
                    "next_before": rows[limit - 1][0] if len(rows) > limit else None}

    def views(self):
        with self._guard(), self._connection() as db:
            return self._views(db)

    def activate(self, name, edition_id, expected_revision):
        name, edition_id = _name(name), _hex(edition_id)
        if type(expected_revision) is not int or expected_revision < 0:
            raise StateError("DUCKDB_VIEW_REVISION_REQUIRED")
        with self._guard(), self._connection(writeable=True) as db:
            db.execute("BEGIN")
            try:
                edition = self._record(db, "sf_editions", edition_id)
                current = db.execute("SELECT name,edition_id,revision FROM sf_views WHERE lower(name)=lower(?)", [name]).fetchone()
                revision = current[2] if current else 0
                if revision != expected_revision:
                    raise StateError("DUCKDB_VIEW_CHANGED")
                if current and current[1] == edition_id:
                    db.commit()
                    return {"name": current[0], "revision": revision, "edition": edition, "activation_status": "UNCHANGED"}
                if current:
                    name = current[0]
                    db.execute("DROP VIEW " + _qid(name))
                db.execute("CREATE VIEW " + _qid(name) + " AS SELECT * FROM " + _qid(edition["table"]))
                db.execute("INSERT INTO sf_views VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET edition_id=excluded.edition_id,revision=excluded.revision", [name, edition_id, revision + 1])
                result = {"name": name, "revision": revision + 1, "edition": edition, "activated_at": _now(), "previous_edition": current[1] if current else None}
                db.execute("INSERT INTO sf_view_history VALUES(?,?,?)", [name, revision + 1, _json(result)])
                db.commit()
                return result
            except BaseException:
                db.rollback()
                raise

    def _sql(self, sql, parameters):
        if not isinstance(sql, str) or not sql.strip() or len(sql.encode()) > 262144 or not isinstance(parameters, (list, tuple, dict)):
            raise StateError("DUCKDB_QUERY_INVALID")
        # Parse on an isolated native connection: parser preprocessing cannot
        # affect retained sequences or data in the customer's database.
        parser = self.duckdb.connect(":memory:", config={"enable_external_access": "false",
            "autoinstall_known_extensions": "false", "autoload_known_extensions": "false", "threads": "1", "memory_limit": "32MB"})
        try:
            parser.execute("SET lock_configuration=true")
            statements = parser.extract_statements(sql)
            if len(statements) != 1 or statements[0].type != self.duckdb.StatementType.SELECT:
                raise StateError("DUCKDB_SELECT_QUERY_REQUIRED")
        finally:
            parser.close()
        # The native engine accepts the reviewed SQL; strip a single terminal
        # delimiter only for its controlled subquery wrappers.
        return sql.strip().removesuffix(";").rstrip()

    def query(self, sql, parameters=None, max_rows=200, expected_views=None):
        parameters = [] if parameters is None else parameters
        sql = self._sql(sql, parameters)
        if type(max_rows) is not int or not 1 <= max_rows <= 100000:
            raise StateError("DUCKDB_QUERY_PREVIEW_LIMIT_INVALID")
        with self._guard(), self._connection() as db:
            db.execute("BEGIN")
            try:
                views = self._views(db)
                if expected_views is not None and expected_views != views:
                    raise StateError("DUCKDB_VIEW_CHANGED")
                result = db.execute(sql, parameters)
                columns = [{"name": c[0], "type": str(c[1])} for c in result.description]
                rows = result.fetchmany(max_rows + 1)
                db.commit()
                return {"columns": columns, "rows": _wire(rows[:max_rows]), "truncated": len(rows) > max_rows, "views": views}
            except BaseException:
                db.rollback()
                raise

    def save_query(self, name, sql, parameters=None, expected_revision=0):
        name = _name(name)
        parameters = [] if parameters is None else parameters
        sql = self._sql(sql, parameters)
        # Stored parameters use the original JSON caller representation.
        _json(parameters)
        if type(expected_revision) is not int or expected_revision < 0:
            raise StateError("DUCKDB_QUERY_REVISION_REQUIRED")
        query_id = digest(name.casefold().encode())
        with self._guard(), self._connection(writeable=True) as db:
            db.execute("BEGIN")
            try:
                current = db.execute("SELECT revision,record FROM sf_queries WHERE id=?", [query_id]).fetchone()
                revision = current[0] if current else 0
                if revision != expected_revision:
                    raise StateError("DUCKDB_SAVED_QUERY_CHANGED")
                if current:
                    prior = parse(current[1].encode())
                    if prior["sql"] == sql and prior["parameters"] == parameters:
                        db.commit()
                        return prior
                    name = prior["name"]
                record = {"query_id": query_id, "name": name, "revision": revision + 1, "sql": sql,
                          "parameters": parameters, "saved_at": _now()}
                db.execute("INSERT INTO sf_queries VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,record=excluded.record", [query_id, name, revision + 1, _json(record)])
                db.execute("INSERT INTO sf_query_history VALUES(?,?,?)", [query_id, revision + 1, _json(record)])
                db.commit()
                return record
            except BaseException:
                db.rollback()
                raise

    def queries(self):
        with self._guard(), self._connection() as db:
            return {"queries": [parse(row[0].encode()) for row in db.execute("SELECT record FROM sf_queries ORDER BY name").fetchall()]}

    def exports(self):
        with self._guard(), self._connection() as db:
            return {"exports": [parse(row[0].encode()) for row in db.execute("SELECT record FROM sf_exports ORDER BY id").fetchall()]}

    def export_query(self, query_id, destination, expected_revision, expected_views=None):
        query_id = _hex(query_id)
        if type(expected_revision) is not int or expected_revision < 1:
            raise StateError("DUCKDB_QUERY_REVISION_REQUIRED")
        with self._guard():
            target = _new_destination(destination, self.directory)
            request_file = target / "request.json"
            if request_file.exists():
                request = parse(read(request_file, 8 * 1024 * 1024))
                query = request.get("query", {})
                if (request.get("schema") != SCHEMA + ".query-export"
                    or request.get("workspace") != str(self.directory)
                    or query.get("query_id") != query_id or query.get("revision") != expected_revision
                    or request.get("directory") != str(target)):
                    raise StateError("DUCKDB_EXPORT_DESTINATION_CONFLICT")
                if expected_views is not None and expected_views != request["views"]:
                    raise StateError("DUCKDB_EXPORT_VIEW_CONFLICT")
                # The retained original revision owns this export even when
                # the operator has since saved a newer version of the recipe.
                views = request["views"]
            else:
                if any(target.iterdir()):
                    raise StateError("DUCKDB_EXPORT_DESTINATION_NOT_EMPTY")
                with self._connection() as db:
                    query = self._record(db, "sf_queries", query_id)
                    views = self._views(db)
                if query["revision"] != expected_revision:
                    raise StateError("DUCKDB_SAVED_QUERY_CHANGED")
                if expected_views is not None and expected_views != views:
                    raise StateError("DUCKDB_VIEW_CHANGED")
                identity = {"schema": SCHEMA + ".query-export", "workspace": str(self.directory),
                            "query": query, "views": views, "directory": str(target)}
                request = {**identity, "export_id": digest(_json(identity).encode()), "created_at": _now()}
                dump(request_file, request, exclusive=True)
            complete = target / "manifest.json"
            if complete.exists():
                record = parse(read(complete, 16 * 1024 * 1024))
                if record.get("export_id") != request["export_id"]:
                    raise StateError("DUCKDB_EXPORT_DESTINATION_CONFLICT")
                for item in record["files"]:
                    actual = _descriptor(target / item["name"], item["name"])
                    if actual["bytes"] != item["bytes"] or actual["sha256"] != item["sha256"]:
                        raise StateError("DUCKDB_EXPORT_CHANGED")
                record["files"].append(_descriptor(complete))
                with self._connection(writeable=True) as db:
                    db.execute("INSERT INTO sf_exports VALUES(?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record",
                               [record["export_id"], _json(record)])
                return record
            parquet, csv = target / "result.parquet", target / "result.csv"
            partial = target / "result.parquet.partial"
            execution_file = target / "execution.json"
            execution = parse(read(execution_file, 8 * 1024 * 1024)) if execution_file.exists() else None
            if execution is not None and execution.get("export_id") != request["export_id"]:
                raise StateError("DUCKDB_EXPORT_EXECUTION_CHANGED")

            def verify(path, expected, code):
                if not isinstance(expected, dict):
                    raise StateError(code)
                actual = _descriptor(path)
                if actual["bytes"] != expected.get("bytes") or actual["sha256"] != expected.get("sha256"):
                    raise StateError(code)

            def publish(part, final, expected):
                verify(part, expected, "DUCKDB_RETAINED_QUERY_RESULT_CHANGED")
                os.rename(part, final)
                sync_directory(target)

            if not parquet.exists():
                if execution is not None and execution.get("parquet"):
                    if not partial.exists():
                        raise StateError("DUCKDB_RETAINED_PARQUET_MISSING")
                    publish(partial, parquet, execution["parquet"])
                else:
                    if partial.exists():
                        partial.rename(target / ("interrupted-" + _descriptor(partial)["sha256"] + ".parquet"))
                    with self._connection(allowed_paths=[partial, parquet]) as db:
                        db.execute("BEGIN")
                        try:
                            if self._views(db) != views:
                                raise StateError("DUCKDB_VIEW_CHANGED")
                            sql = self._sql(query["sql"], query["parameters"])
                            # Do not wrap the SELECT: trailing comments and
                            # valid WITH/ORDER/LIMIT clauses retain their meaning.
                            db.execute("CREATE TEMP TABLE sf_export_result AS " + sql, query["parameters"])
                            rows = db.execute("SELECT count(*) FROM sf_export_result").fetchone()[0]
                            cursor = db.execute("SELECT * FROM sf_export_result LIMIT 0")
                            columns = [{"name": c[0], "type": str(c[1])} for c in cursor.description]
                            if len({c["name"].casefold() for c in columns}) != len(columns):
                                raise StateError("DUCKDB_EXPORT_UNIQUE_COLUMN_NAMES_REQUIRED")
                            db.execute("COPY sf_export_result TO ? (FORMAT PARQUET, COMPRESSION ZSTD)", [str(partial)])
                            with open(partial, "rb") as stream:
                                os.fsync(stream.fileno())
                            os.chmod(partial, 0o600)
                            execution = {"export_id": request["export_id"], "rows": rows, "columns": columns,
                                         "views": views, "parquet": _descriptor(partial, "result.parquet")}
                            execution["parquet"]["path"] = str(parquet)
                            # Identity is durable before publication, so a
                            # reopened export accepts only these exact bytes.
                            dump(execution_file, execution)
                            publish(partial, parquet, execution["parquet"])
                            db.commit()
                        except BaseException:
                            db.rollback()
                            raise
            if execution is None:
                raise StateError("DUCKDB_EXPORT_EXECUTION_MISSING")
            verify(parquet, execution.get("parquet"), "DUCKDB_RETAINED_QUERY_RESULT_CHANGED")
            csv_partial = target / "result.csv.partial"
            with self._connection(allowed_paths=[parquet, csv_partial]) as db:
                result = db.execute("SELECT * FROM read_parquet(?) LIMIT 0", [str(parquet)])
                columns = [{"name": c[0], "type": str(c[1])} for c in result.description]
                rows = db.execute("SELECT count(*) FROM read_parquet(?)", [str(parquet)]).fetchone()[0]
                if rows != execution["rows"] or columns != execution["columns"]:
                    raise StateError("DUCKDB_RETAINED_QUERY_RESULT_CHANGED")
                if not csv.exists():
                    if execution.get("csv"):
                        if not csv_partial.exists():
                            raise StateError("DUCKDB_RETAINED_CSV_MISSING")
                        publish(csv_partial, csv, execution["csv"])
                    else:
                        if csv_partial.exists():
                            csv_partial.rename(target / ("interrupted-" + _descriptor(csv_partial)["sha256"] + ".csv"))
                        db.execute("COPY (SELECT * FROM read_parquet(?)) TO ? (FORMAT CSV, HEADER TRUE, NULL '\\N', FORCE_QUOTE *)",
                                   [str(parquet), str(csv_partial)])
                        with open(csv_partial, "rb") as stream:
                            os.fsync(stream.fileno())
                        os.chmod(csv_partial, 0o600)
                        execution["csv"] = _descriptor(csv_partial, "result.csv")
                        execution["csv"]["path"] = str(csv)
                        dump(execution_file, execution)
                        publish(csv_partial, csv, execution["csv"])
            verify(csv, execution.get("csv"), "DUCKDB_RETAINED_QUERY_RESULT_CHANGED")
            files = [_descriptor(path) for path in (parquet, csv, request_file, execution_file)]
            record = {**request, "state": "COMPLETE", "completed_at": _now(), "rows": rows,
                      "columns": columns, "files": files, "csv_null_marker": "\\N",
                      "source_editions": sorted({view["edition_id"] for view in views})}
            dump(complete, record, exclusive=True)
            # The manifest describes members; its download record also includes
            # the manifest without creating a self-referential digest.
            record["files"].append(_descriptor(complete))
            with self._connection(writeable=True) as db:
                db.execute("INSERT INTO sf_exports VALUES(?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record",
                           [record["export_id"], _json(record)])
            return record

    def compare(self, before_id, after_id, keys=None, max_rows=200):
        before_id, after_id = _hex(before_id), _hex(after_id)
        if type(max_rows) is not int or not 1 <= max_rows <= 100000:
            raise StateError("DUCKDB_COMPARISON_PREVIEW_LIMIT_INVALID")
        with self._guard(), self._connection() as db:
            before, after = self._record(db, "sf_editions", before_id), self._record(db, "sf_editions", after_id)
            keys = before["keys"] if keys is None else keys
            a, b = {c["name"]: c for c in before["columns"]}, {c["name"]: c for c in after["columns"]}
            if not isinstance(keys, list) or not keys or len(set(keys)) != len(keys) or any(k not in a or k not in b or a[k]["type"] != b[k]["type"] for k in keys):
                raise StateError("DUCKDB_COMPARISON_COMPATIBLE_KEYS_REQUIRED")
            for edition in (before, after):
                table = _qid(edition["table"])
                nulls = " OR ".join(_qid(k) + " IS NULL" for k in keys)
                if db.execute("SELECT 1 FROM " + table + " WHERE " + nulls + " LIMIT 1").fetchone():
                    raise StateError("DUCKDB_COMPARISON_NULL_KEY")
                if db.execute("SELECT 1 FROM " + table + " GROUP BY " + ",".join(_qid(k) for k in keys) + " HAVING count(*)>1 LIMIT 1").fetchone():
                    raise StateError("DUCKDB_COMPARISON_NONUNIQUE_KEY")
            comparable = [name for name in a if name in b and a[name]["type"] == b[name]["type"]]
            schema = {"added": [name for name in b if name not in a], "removed": [name for name in a if name not in b],
                      "changed": [{"name": name, "before": a[name], "after": b[name]} for name in a if name in b and a[name] != b[name]]}
            join = " AND ".join("a." + _qid(k) + "=b." + _qid(k) for k in keys)
            diff = " OR ".join("a." + _qid(k) + " IS DISTINCT FROM b." + _qid(k) for k in comparable) or "FALSE"
            category = "CASE WHEN a.sf_row IS NULL THEN 'added' WHEN b.sf_row IS NULL THEN 'removed' WHEN " + diff + " THEN 'changed' ELSE 'unchanged' END"
            relation = " FROM " + _qid(before["table"]) + " a FULL OUTER JOIN " + _qid(after["table"]) + " b ON " + join
            totals = dict(db.execute("SELECT " + category + " AS kind,count(*)" + relation + " GROUP BY kind").fetchall())
            projected = ["coalesce(a." + _qid(k) + ",b." + _qid(k) + ") AS " + _qid("key_" + str(i)) for i, k in enumerate(keys)]
            projected += ["a." + _qid(k) for k in a] + ["b." + _qid(k) for k in b]
            sql = "SELECT " + category + " AS kind," + ",".join(projected) + relation + " WHERE a.sf_row IS NULL OR b.sf_row IS NULL OR " + diff + " ORDER BY " + ",".join(_qid("key_" + str(i)) for i in range(len(keys))) + " LIMIT ?"
            rows = db.execute(sql, [max_rows + 1]).fetchall()
            changes = []
            for row in rows[:max_rows]:
                offset = 1 + len(keys)
                changes.append({"kind": row[0], "key": _wire(dict(zip(keys, row[1:offset]))),
                                "before": None if row[0] == "added" else _wire(dict(zip(a, row[offset:offset + len(a)]))),
                                "after": None if row[0] == "removed" else _wire(dict(zip(b, row[offset + len(a):])))})
            return {"before": before_id, "after": after_id, "keys": keys, "columns": schema,
                    "summary": {kind: totals.get(kind, 0) for kind in ("added", "removed", "changed", "unchanged")},
                    "changes": changes, "truncated": len(rows) > max_rows,
                    "comparison_columns": comparable,
                    "comparison_basis": "Common columns with identical SQL types; structural changes are listed separately.",
                    "source_scope": {"before": before["source"]["manifest"]["dataset"],
                                     "after": after["source"]["manifest"]["dataset"]}}

    def export_source(self, edition_id, destination):
        edition_id = _hex(edition_id)
        with self._guard(), self._connection() as db:
            edition = self._record(db, "sf_editions", edition_id)
            target = _new_destination(destination, self.directory)
            files = []
            for name, expected_bytes, expected_sha in db.execute("SELECT name,bytes,sha256 FROM sf_files WHERE edition_id=? ORDER BY name", [edition_id]).fetchall():
                output = target / name
                private_directory(output.parent)
                if output.exists():
                    descriptor = _descriptor(output, name)
                else:
                    fd, tmp = tempfile.mkstemp(prefix=".source-", dir=target)
                    try:
                        with os.fdopen(fd, "wb") as stream:
                            cursor = db.execute("SELECT content FROM sf_file_chunks WHERE edition_id=? AND name=? ORDER BY part", [edition_id, name])
                            while row := cursor.fetchone():
                                stream.write(row[0])
                            stream.flush()
                            os.fsync(stream.fileno())
                        descriptor = _descriptor(Path(tmp), name)
                        if descriptor["bytes"] != expected_bytes or descriptor["sha256"] != expected_sha:
                            raise StateError("DUCKDB_RETAINED_SOURCE_CHANGED")
                        os.link(tmp, output)
                        sync_directory(output.parent)
                        if output.parent != target:
                            sync_directory(target)
                    finally:
                        os.unlink(tmp)
                    descriptor["path"] = str(output)
                if descriptor["bytes"] != expected_bytes or descriptor["sha256"] != expected_sha:
                    raise StateError("DUCKDB_SOURCE_DESTINATION_CONFLICT")
                files.append(descriptor)
            return {"schema": SCHEMA + ".source", "directory": str(target), "edition_id": edition_id,
                    "files": files, "original_source": edition["source"]}

    def backup(self, destination):
        with self._guard():
            target = _new_destination(destination, self.directory)
            output = target / "warehouse.duckdb"
            partial = target / "warehouse.duckdb.partial"
            request_file = target / "handoff-request.json"
            manifest = target / "handoff.json"

            def verified_record(path):
                record = parse(read(path, 16 * 1024 * 1024))
                if (record.get("schema") != SCHEMA + ".handoff"
                    or record.get("source_directory") != str(self.directory)
                    or record.get("directory") != str(target)):
                    raise StateError("DUCKDB_HANDOFF_DESTINATION_CONFLICT")
                return record

            def verify(path, expected):
                actual = _descriptor(path)
                if actual["bytes"] != expected["bytes"] or actual["sha256"] != expected["sha256"]:
                    raise StateError("DUCKDB_HANDOFF_CHANGED")

            if manifest.exists():
                record = verified_record(manifest)
                for item in record["files"]:
                    verify(target / item["name"], item)
                record["files"].append(_descriptor(manifest))
                return record
            if request_file.exists():
                record = verified_record(request_file)
                expected = record["files"][0]
                if output.exists():
                    verify(output, expected)
                elif partial.exists():
                    verify(partial, expected)
                    os.rename(partial, output)
                    sync_directory(target)
                else:
                    raise StateError("DUCKDB_RETAINED_HANDOFF_MISSING")
            else:
                if output.exists() or any(path.name != partial.name and not path.name.startswith("interrupted-")
                                          for path in target.iterdir()):
                    raise StateError("DUCKDB_HANDOFF_DESTINATION_NOT_EMPTY")
                if partial.exists():
                    partial.rename(target / ("interrupted-" + _descriptor(partial)["sha256"] + ".duckdb"))
                with self._connection(writeable=True) as db:
                    db.execute("CHECKPOINT")
                    editions = [parse(row[0].encode()) for row in db.execute("SELECT record FROM sf_editions ORDER BY sequence").fetchall()]
                    views = self._views(db)
                    original_files = [row[0] for row in db.execute("SELECT DISTINCT name FROM sf_files ORDER BY name").fetchall()]
                # All native connections close before copying under the
                # workspace lock. A complete copy is retained before publishing.
                source_fd = os.open(self.path, os.O_RDONLY | os.O_NOFOLLOW)
                target_fd = os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                with os.fdopen(source_fd, "rb") as source, os.fdopen(target_fd, "wb") as dest:
                    shutil.copyfileobj(source, dest, _CHUNK)
                    dest.flush()
                    os.fsync(dest.fileno())
                descriptor = _descriptor(partial, "warehouse.duckdb")
                descriptor["path"] = str(output)
                record = {"schema": SCHEMA + ".handoff", "directory": str(target),
                          "source_directory": str(self.directory), "created_at": _now(),
                          "files": [descriptor], "editions": editions, "views": views,
                          "reopen": "DuckDBWorkspace(directory)",
                          "embedded_original_files": original_files}
                dump(request_file, record, exclusive=True)
                os.rename(partial, output)
                sync_directory(target)
            record["files"].append(_descriptor(request_file))
            dump(manifest, record, exclusive=True)
            record["files"].append(_descriptor(manifest))
            return record
