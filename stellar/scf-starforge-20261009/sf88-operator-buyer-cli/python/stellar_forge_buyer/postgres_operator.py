"""Reviewed PostgreSQL receiving over the original warehouse and delivery."""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
import fcntl
import json
import os
from pathlib import Path
import re
import secrets
import stat
import threading

from .errors import BuyerError
from .postgres_delivery import (
    Column, DatasetMapping, PostgresWarehouse, WarehouseError,
    load_delivery_report, review_delivery,
)
from .storage import digest, dump, parse, private_directory, read, unique_object, write

SCHEMA = "stellar-forge.postgres-operator.v1"
_ID = re.compile(r"[a-f0-9]{32}")
_MAX_REPORT = 8 * 1024 * 1024
_MAX_RECORD = 8 * 1024 * 1024  # Reviewed dictionaries plus original edition/request metadata.


def wire(value):
    """Keep exact database numbers and dates intact in browser JSON."""
    if isinstance(value, Decimal):
        return str(value)
    if type(value) is int and abs(value) > 9007199254740991:
        return str(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, (tuple, list)):
        return [wire(item) for item in value]
    if isinstance(value, dict):
        return {key: wire(item) for key, item in value.items()}
    return value


def fields(value, required=(), optional=()):
    if (not isinstance(value, dict) or set(value) - set(required) - set(optional)
            or any(key not in value for key in required)):
        raise WarehouseError("DATASET_PG_OPERATOR_FIELDS_INVALID")
    return value


def integer(value, *, minimum=0, maximum=1000):
    if type(value) is not int or not minimum <= value <= maximum:
        raise WarehouseError("DATASET_PG_OPERATOR_PAGE_INVALID")
    return value


def _id(value):
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise WarehouseError("DATASET_PG_OPERATOR_ID_REQUIRED")
    return value


def _text(value, maximum, *, required=False):
    if (not isinstance(value, str) or len(value.encode()) > maximum
            or "\x00" in value or required and not value.strip()):
        raise WarehouseError("DATASET_PG_OPERATOR_TEXT_INVALID")
    return value


def _now():
    return datetime.now(timezone.utc).isoformat()


def _source(path):
    path = Path(os.path.abspath(Path(_text(path, 8192, required=True)).expanduser()))
    raw = read(path, _MAX_REPORT)
    delivery = load_delivery_report(path)
    if read(path, _MAX_REPORT) != raw:
        raise WarehouseError("DATASET_PG_REVIEWED_INPUT_CHANGED")
    return path, raw, delivery


class PostgresOperator:
    """One private operator directory bound to the actual PostgreSQL identity."""

    def __init__(self, warehouse: PostgresWarehouse, directory):
        self.warehouse = warehouse
        self.directory = private_directory(Path(directory))
        self.mutex = threading.RLock()
        self._owner = os.open(self.directory / "postgres-http.lock",
                              os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            info = os.fstat(self._owner)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_mode & 0o077:
                raise WarehouseError("DATASET_PG_OPERATOR_PRIVATE_LOCK_REQUIRED")
            fcntl.flock(self._owner, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.reviews = private_directory(self.directory / "reviews")
            self.requests = private_directory(self.directory / "requests")
            self.sources = private_directory(self.directory / "reviewed-sources")
            path = self.directory / "postgres-workspace.json"
            if path.exists():
                identity = parse(read(path, 65536))
                if (identity.get("schema") != SCHEMA
                        or identity.get("warehouse_id") != warehouse.warehouse_id
                        or identity.get("warehouse_schema") != warehouse.schema):
                    raise WarehouseError("DATASET_PG_OPERATOR_WAREHOUSE_CHANGED")
                _id(identity.get("operator_id"))
            else:
                identity = {"schema": SCHEMA, "operator_id": secrets.token_hex(16),
                            "warehouse_id": warehouse.warehouse_id,
                            "warehouse_schema": warehouse.schema, "created_at": _now()}
                dump(path, identity, exclusive=True)
            self.identity = identity
        except BlockingIOError:
            self.close()
            raise WarehouseError("DATASET_PG_OPERATOR_ALREADY_OPEN") from None
        except BaseException:
            self.close()
            raise

    def close(self):
        if self._owner is not None:
            os.close(self._owner)
            self._owner = None

    def _record(self, directory, record_id):
        record_id = _id(record_id)
        record = parse(read(directory / (record_id + ".json"), _MAX_RECORD))
        if (not isinstance(record, dict) or record.get("operator_id") != self.identity["operator_id"]
                or record.get("warehouse_id") != self.warehouse.warehouse_id
                or record.get("record_id") != record_id):
            raise WarehouseError("DATASET_PG_OPERATOR_RECORD_CHANGED")
        return record

    def records(self, kind, *, before=None, limit=50):
        if kind not in {"reviews", "requests"}:
            raise WarehouseError("DATASET_PG_OPERATOR_RECORD_KIND_INVALID")
        integer(limit, minimum=1, maximum=100)
        if before is not None:
            _text(before, 128, required=True)
        directory = self.reviews if kind == "reviews" else self.requests
        rows = []
        for path in directory.glob("*.json"):
            record = self._record(directory, path.stem)
            cursor = record["created_at"] + "/" + record["record_id"]
            if before is not None and cursor >= before:
                continue
            summary = {key: record[key] for key in (
                "record_id", "created_at", "state", "route", "source_path", "version_id",
                "reviewer", "note", "row_count", "updated_at", "error"
            ) if key in record}
            if kind == "requests":
                summary["body"] = record["body"]
            summary["cursor"] = cursor
            rows.append(summary)
        rows.sort(key=lambda row: row["cursor"], reverse=True)
        return {kind: rows[:limit],
                "next_before": rows[limit - 1]["cursor"] if len(rows) > limit else None}

    def state(self):
        with self.mutex:
            return {"identity": self.identity, "directory": str(self.directory),
                    "warehouse": self.warehouse.status(),
                    "versions": self.warehouse.versions(limit=50),
                    "reviews": self.records("reviews"),
                    "requests": self.records("requests")}

    def inspect_delivery(self, report_path):
        with self.mutex:
            path, raw, delivery = _source(report_path)
            manifest = parse(delivery.file("manifest.json").read_bytes(limit=4 * 1024 * 1024))
            dataset = manifest.get("dataset", {})
            names, count = dataset.get("projectedFields"), dataset.get("rows")
            if (not isinstance(names, list) or not names or len(names) > 1024
                    or any(not isinstance(name, str) or not name for name in names)
                    or len(set(names)) != len(names) or type(count) is not int or count < 0):
                raise WarehouseError("DATASET_PG_MANIFEST_BINDING_INVALID")
            observed = {name: set() for name in names}
            nulls = {name: 0 for name in names}
            overflow, preview, rows = set(), [], 0
            with delivery.file("dataset.jsonl").open() as stream:
                while line := stream.readline(2097153):
                    rows += 1
                    if len(line) > 2097152 or not line.endswith(b"\n") or rows > count:
                        raise WarehouseError("DATASET_PG_ROW_FORMAT_OR_COUNT_INVALID", row=rows)
                    try:
                        row = json.loads(line.decode(), object_pairs_hook=unique_object,
                                         parse_float=Decimal,
                                         parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
                    except (ValueError, UnicodeError):
                        raise WarehouseError("DATASET_PG_INVALID_JSON_ROW", row=rows) from None
                    if not isinstance(row, dict) or set(row) != set(names):
                        raise WarehouseError("DATASET_PG_ROW_FIELDS_MISMATCH", row=rows)
                    if len(preview) < 5:
                        preview.append(wire(row))
                    for name, value in row.items():
                        kind = ("null" if value is None else "boolean" if type(value) is bool
                                else "integer" if type(value) is int else "number" if isinstance(value, Decimal)
                                else "string" if isinstance(value, str) else None)
                        if kind is None:
                            raise WarehouseError("DATASET_PG_NATIVE_SCALAR_REQUIRED", row=rows, field=name)
                        observed[name].add(kind)
                        nulls[name] += value is None
                        if type(value) is int and not -(2**63) <= value < 2**63:
                            overflow.add(name)
            if rows != count:
                raise WarehouseError("DATASET_PG_ROW_FORMAT_OR_COUNT_INVALID")
            columns, used = [], set()
            for index, name in enumerate(names):
                kinds = observed[name] - {"null"}
                kind = ("text" if not kinds else "numeric" if kinds <= {"integer", "number"} and
                        ("number" in kinds or name in overflow) else
                        {"string": "text", "integer": "bigint", "boolean": "boolean"}.get(next(iter(kinds)), "json")
                        if len(kinds) == 1 else "json")
                sql_name = name
                try:
                    Column(name, sql_name, kind)
                except WarehouseError:
                    sql_name = "field_" + str(index + 1)
                while sql_name in used:
                    sql_name += "_"
                used.add(sql_name)
                columns.append(Column(name, sql_name, kind, nulls[name] > 0 or not kinds))
            mapping = DatasetMapping(tuple(columns))
            native = review_delivery(delivery, mapping)
            return {"source_path": str(path), "source_sha256": digest(raw),
                    "dataset": native["dataset"], "row_count": native["row_count"],
                    "source_pages": native["source_pages"],
                    "payment_status": native["originalPaymentStatus"],
                    "mapping": mapping.record(), "columns": native["columns"], "preview": preview,
                    "semantics": native["semantics"], "semantics_status": native["semantics_status"],
                    "semantic_dictionary": native["semantic_dictionary"]}

    def review(self, body):
        fields(body, ("report_path", "mapping", "reviewer", "note", "expected_report_sha256"))
        _text(body["reviewer"], 160, required=True)
        _text(body["note"], 4000)
        if not isinstance(body["expected_report_sha256"], str) or not re.fullmatch(
                r"[a-f0-9]{64}", body["expected_report_sha256"]):
            raise WarehouseError("DATASET_PG_OPERATOR_SOURCE_REVIEW_REQUIRED")
        path, raw, delivery = _source(body["report_path"])
        if digest(raw) != body["expected_report_sha256"]:
            raise WarehouseError("DATASET_PG_REVIEWED_INPUT_CHANGED")
        mapping = DatasetMapping.from_record(body["mapping"])
        native = review_delivery(delivery, mapping)
        record_id = secrets.token_hex(16)
        source = self.sources / (record_id + ".json")
        write(source, raw, exclusive=True)
        record = {**self.identity, "record_id": record_id, "created_at": _now(),
                  "state": "REVIEWED", "source_path": str(path),
                  "source_sha256": digest(raw), "reviewer": body["reviewer"].strip(),
                  "note": body["note"], "mapping": mapping.record(),
                  "version_id": native["version_id"], "row_count": native["row_count"], "review": native}
        dump(self.reviews / (record_id + ".json"), record, exclusive=True)
        return record

    def _review_delivery(self, review):
        path = self.sources / (review["record_id"] + ".json")
        raw = read(path, _MAX_REPORT)
        if digest(raw) != review["source_sha256"]:
            raise WarehouseError("DATASET_PG_OPERATOR_REVIEW_CHANGED")
        return load_delivery_report(path)

    def _import(self, request):
        review = self._record(self.reviews, request["body"]["review_id"])
        try:
            version = self.warehouse.version(review["version_id"])
        except WarehouseError as error:
            if error.code != "DATASET_PG_VERSION_NOT_FOUND":
                raise
        else:
            if version["semantics_status"] != "SOURCE_REQUIRED":
                return {**version, "import_status": "UNCHANGED", "recovered_existing_version": True}
            # A warehouse created before dictionary receiving may already have
            # this exact edition. Attach its original meaning file through the
            # same import transaction, without copying rows or moving a view.
        return self.warehouse.import_delivery(
            self._review_delivery(review), DatasetMapping.from_record(review["mapping"]),
            expected_version=review["version_id"])

    def _activate(self, request):
        body, baseline = request["body"], request["baseline"]
        expected = body["expected_revision"]
        current = self.warehouse.current(body["name"])
        if current["revision"] == expected:
            return self.warehouse.activate(body["name"], body["version_id"], expected_revision=expected)
        # A committed selection may precede later legitimate selections. Recover
        # its original history entry; never replay it against the later revision.
        before = None
        while current["revision"] > expected:
            page = self.warehouse.history(body["name"], before=before, limit=100)
            for row in page["history"]:
                if row["revision"] == expected + 1:
                    old_version = baseline["version"]["version_id"] if baseline.get("version") else None
                    if row["version_id"] != body["version_id"] or row["previous_version"] != old_version:
                        raise WarehouseError("DATASET_PG_VIEW_CHANGED")
                    return {"status": "RECOVERED", "name": body["name"],
                            "qualified_view": baseline["qualified_view"], "revision": row["revision"],
                            "version": self.warehouse.version(body["version_id"]),
                            "activation": row, "observed_current": current}
                if row["revision"] <= expected:
                    raise WarehouseError("DATASET_PG_VIEW_CHANGED")
            before = page["next_before"]
            if before is None:
                break
        raise WarehouseError("DATASET_PG_VIEW_CHANGED")

    def _action(self, route, body):
        if route == "/api/import":
            fields(body, ("review_id", "request_id"))
            _id(body["review_id"])
        elif route == "/api/activate":
            fields(body, ("name", "version_id", "expected_revision", "request_id"))
            _text(body["name"], 63, required=True)
            integer(body["expected_revision"], maximum=9007199254740991)
        else:
            raise WarehouseError("DATASET_PG_OPERATOR_ROUTE_NOT_FOUND")
        request_id = _id(body["request_id"])
        path = self.requests / (request_id + ".json")
        if path.exists():
            request = self._record(self.requests, request_id)
            if request.get("route") != route or request.get("body") != body:
                raise WarehouseError("DATASET_PG_OPERATOR_ORIGINAL_REQUEST_CHANGED")
        else:
            request = {**self.identity, "record_id": request_id, "created_at": _now(),
                       "state": "PREPARED", "route": route, "body": body}
            if route == "/api/import":
                self._record(self.reviews, body["review_id"])
            else:
                self.warehouse.version(body["version_id"])
                baseline = self.warehouse.current(body["name"])
                if baseline["revision"] != body["expected_revision"]:
                    raise WarehouseError("DATASET_PG_VIEW_CHANGED")
                request["baseline"] = baseline
            dump(path, request, exclusive=True)
        if request["state"] == "COMPLETE":
            return request
        request.update(state="RUNNING", updated_at=_now())
        request.pop("error", None)
        dump(path, request)
        try:
            result = self._import(request) if route == "/api/import" else self._activate(request)
            request.update(state="COMPLETE", result=wire(result), updated_at=_now())
            dump(path, request)
            return request
        except Exception as error:
            request.update(state="INTERRUPTED", updated_at=_now(),
                           error=error.report() if isinstance(error, WarehouseError)
                           else {"error": error.code if isinstance(error, BuyerError)
                                 else "DATASET_PG_OPERATOR_OPERATION_INTERRUPTED"})
            try:
                dump(path, request)
            except (OSError, BuyerError):
                pass
            raise

    def perform(self, route, body):
        with self.mutex:
            if route == "/api/inspect-delivery":
                fields(body, ("report_path",))
                return self.inspect_delivery(body["report_path"])
            if route == "/api/reviews":
                return self.review(body)
            return self._action(route, body)

    def resume(self, request_id):
        with self.mutex:
            original = self._record(self.requests, request_id)
            return self._action(original["route"], original["body"])

    def review_record(self, review_id):
        with self.mutex:
            return self._record(self.reviews, review_id)

    def request_record(self, request_id):
        with self.mutex:
            return self._record(self.requests, request_id)
