"""Receive the original approved ODK Central CSV projection into PostgreSQL."""
from __future__ import annotations

from contextlib import contextmanager
import csv
import hashlib
import io
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import stat
import tempfile

from .dataset_semantics import validate_document, identity, sql_context, same_json
from .postgres_delivery import (
    SCHEMA as WAREHOUSE_SCHEMA, Column, DatasetMapping, WarehouseError, _Input,
    _json, _semantic_descriptor, _bound_semantics, _ORDINAL, _ORIGINAL,
)
from .storage import digest, dump, parse, private_directory, read, sync_directory, write

APPROVAL_SCHEMA = "stellar-forge.odk-central-postgres-approval.v1"
SCHEMA = "stellar-forge.postgres-central-delivery.v1"
SOURCE_KIND = "ODK_CENTRAL_ACCEPTED"
_HEX = re.compile(r"[a-f0-9]{64}")
_NUMBER = re.compile(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?")
_INTEGER = re.compile(r"-?(?:0|[1-9][0-9]*)")
_MAX_META = 8 * 1024 * 1024


def need(value, code):
    if not value:
        raise WarehouseError(code)


def _path(value):
    need(isinstance(value, str) and value and len(value) < 8192,
         "DATASET_PG_CENTRAL_PATH_INVALID")
    path = PurePosixPath(value)
    need(not path.is_absolute() and "\\" not in value
         and all(part not in {"", ".", ".."} for part in value.split("/"))
         and str(path) == value, "DATASET_PG_CENTRAL_PATH_INVALID")
    return path


def _file_path(root, relative):
    relative = _path(relative)
    current = root
    for part in relative.parts[:-1]:
        current /= part
        info = current.lstat()
        need(stat.S_ISDIR(info.st_mode), "DATASET_PG_CENTRAL_SOURCE_PATH_CHANGED")
    return root / relative


@contextmanager
def _verified(root, relative, expected):
    path = _file_path(root, relative)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and before.st_size == expected["bytes"],
             "DATASET_PG_CENTRAL_SOURCE_FILE_CHANGED")
        with os.fdopen(fd, "rb", closefd=False) as stream:
            checksum, size = hashlib.sha256(), 0
            while chunk := stream.read(1024 * 1024):
                checksum.update(chunk)
                size += len(chunk)
            need(size == expected["bytes"] and checksum.hexdigest() == expected["sha256"],
                 "DATASET_PG_CENTRAL_SOURCE_FILE_CHANGED")
            stream.seek(0)
            yield stream
            after = os.fstat(fd)
            need((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
                 == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns),
                 "DATASET_PG_CENTRAL_SOURCE_FILE_CHANGED")
    finally:
        os.close(fd)


def _metadata(root, path, files):
    need(path in files and files[path]["bytes"] <= _MAX_META,
         "DATASET_PG_CENTRAL_METADATA_REQUIRED")
    with _verified(root, path, files[path]) as stream:
        raw = stream.read()
    return raw, parse(raw)


def _put(path, raw):
    if path.exists():
        need(read(path, max(len(raw), 1)) == raw, "DATASET_PG_CENTRAL_PREPARED_SOURCE_CHANGED")
    else:
        write(path, raw, exclusive=True)


def _columns(config):
    declared = config.get("columns")
    need(isinstance(declared, dict) and 1 <= len(declared) <= 64,
         "DATASET_PG_CENTRAL_COLUMNS_INVALID")
    result = []
    for name, raw in declared.items():
        spec = {"type": raw} if isinstance(raw, str) else raw
        need(isinstance(name, str) and isinstance(spec, dict)
             and set(spec) <= {"type", "nullable"}
             and spec.get("type") in {"string", "integer", "number", "boolean"}
             and type(spec.get("nullable", False)) is bool,
             "DATASET_PG_CENTRAL_COLUMNS_INVALID")
        result.append({"name": name, "type": spec["type"], "nullable": spec.get("nullable", False)})
    return result


def _coerce(value, spec, row):
    # Matches original dataset-handler.mjs coerce(), including exact numeric text
    # remaining string for native Decimal/Int64 value columns.
    if value == "" and spec["nullable"]:
        return None
    kind = spec["type"]
    if kind == "string":
        return value
    if kind == "boolean" and value in {"true", "false"}:
        return value == "true"
    if kind == "integer" and _INTEGER.fullmatch(value):
        number = int(value)
        if abs(number) <= 9007199254740991:
            return number
    if kind == "number" and _NUMBER.fullmatch(value):
        number = float(value)
        if math.isfinite(number):
            return 0 if number == 0 else number
    raise WarehouseError("DATASET_PG_CENTRAL_CSV_VALUE_INVALID", row=row, field=spec["name"])


def _projection(root, files, config, source, dictionary, destination):
    columns = _columns(config)
    names = [column["name"] for column in columns]
    need(names == [column["name"] for column in dictionary["columns"]],
         "DATASET_PG_CENTRAL_DICTIONARY_COLUMNS_CHANGED")
    mapping = source["mapping"]
    key_names = dictionary["primaryKey"]["projected"]
    expected_rows = source["rowCount"]
    need(type(expected_rows) is int and 0 <= expected_rows <= 1000000,
         "DATASET_PG_CENTRAL_ROW_COUNT_INVALID")
    fd, temporary = tempfile.mkstemp(prefix=".projection-", dir=destination.parent)
    count, size, checksum = 0, 0, hashlib.sha256()
    previous_limit = csv.field_size_limit()
    try:
        csv.field_size_limit(65536)
        with os.fdopen(fd, "wb") as output, _verified(root, "dataset.csv", files["dataset.csv"]) as stream:
            text = io.TextIOWrapper(stream, encoding="utf-8-sig", errors="strict", newline="")
            try:
                reader = csv.reader(text, strict=True)
                headers = next(reader, None)
                need(headers == names, "DATASET_PG_CENTRAL_CSV_COLUMNS_CHANGED")
                for cells in reader:
                    count += 1
                    need(count <= expected_rows and len(cells) == len(names),
                         "DATASET_PG_CENTRAL_CSV_ROW_COUNT_CHANGED")
                    values = {spec["name"]: _coerce(value, spec, count)
                              for spec, value in zip(columns, cells)}
                    for field in mapping:
                        state = values[field["name"] + "_state"]
                        need(state in {"value", "null", "missing"},
                             "DATASET_PG_CENTRAL_VALUE_STATE_INVALID")
                        if state == "value":
                            need(values[field["name"]] is not None,
                                 "DATASET_PG_CENTRAL_VALUE_STATE_INVALID")
                        else:
                            position = names.index(field["name"])
                            need(cells[position] == "", "DATASET_PG_CENTRAL_VALUE_STATE_INVALID")
                    need(all(values[key + "_state"] == "value" and values[key] is not None
                             for key in key_names), "DATASET_PG_CENTRAL_NATIVE_KEY_REQUIRED")
                    line = (json.dumps(values, ensure_ascii=False, allow_nan=False,
                                       separators=(",", ":")) + "\n").encode()
                    need(len(line) <= 2097152, "DATASET_PG_CENTRAL_PROJECTED_ROW_TOO_LARGE")
                    output.write(line)
                    size += len(line)
                    checksum.update(line)
                need(count == expected_rows, "DATASET_PG_CENTRAL_CSV_ROW_COUNT_CHANGED")
                output.flush()
                os.fsync(output.fileno())
            finally:
                text.detach()
        record = {"bytes": size, "sha256": checksum.hexdigest()}
        if destination.exists():
            with _verified(destination.parent, destination.name, record):
                pass
        else:
            os.link(temporary, destination)
            sync_directory(destination.parent)
        return record, columns
    except (csv.Error, UnicodeError):
        raise WarehouseError("DATASET_PG_CENTRAL_CSV_FORMAT_INVALID") from None
    finally:
        csv.field_size_limit(previous_limit)
        Path(temporary).unlink(missing_ok=True)


class _PreparedFile:
    def __init__(self, root, path, expected):
        self.root, self.path, self.expected = root, path, expected

    def open(self):
        return _verified(self.root, self.path, self.expected)

    def read_bytes(self, *, limit):
        need(self.expected["bytes"] <= limit, "DATASET_PG_CENTRAL_FILE_LIMIT")
        with self.open() as stream:
            return stream.read()


class _CentralInput(_Input):
    def record(self):
        return {**self.identity, "version_id": self.version_id,
                "dataset": self.manifest["dataset"], "row_count": self.row_count,
                "source_pages": len(self.manifest["sourcePages"]),
                "source_kind": SOURCE_KIND, "native_source": self.manifest["nativeSource"],
                "jsonl": {key: self.row_source[key] for key in ("bytes", "sha256")},
                "row_order_column": _ORDINAL, "original_row_column": _ORIGINAL,
                "semantics": self.semantic_descriptor, "semantics_status": "AVAILABLE"}


class CentralAcceptedDelivery:
    source_kind = SOURCE_KIND

    def __init__(self, manifest_path):
        self.manifest_path = Path(manifest_path).absolute()
        self.directory = private_directory(self.manifest_path.parent, create=False)
        need(self.manifest_path.name == "manifest.json" and self.manifest_path.parent == self.directory,
             "DATASET_PG_CENTRAL_PREPARED_PATH_INVALID")
        self.manifest_bytes = read(self.manifest_path, _MAX_META)
        self.manifest = parse(self.manifest_bytes)
        need(self.manifest.get("schema") == SCHEMA
             and self.manifest.get("sourceKind") == SOURCE_KIND,
             "DATASET_PG_CENTRAL_PREPARED_MANIFEST_INVALID")
        self.approval_bytes = self.file("approval.json").read_bytes(limit=_MAX_META)
        self.approval = parse(self.approval_bytes)
        need(digest(self.approval_bytes) == self.manifest["sourceBindingSha256"]
             and self.approval.get("schema") == APPROVAL_SCHEMA,
             "DATASET_PG_CENTRAL_APPROVAL_CHANGED")
        original_files = {item["path"]: {"bytes": item["bytes"], "sha256": item["sha256"]}
                          for item in self.approval["files"]}
        retained = {"original-dataset.csv": "dataset.csv", "source.json": "source.json",
                    "dataset.json": "dataset.json", "semantics.json": "semantics.json",
                    "table-schema.json": "table-schema.json",
                    "capture-manifest.json": "capture/manifest.json"}
        need(self.manifest.get("nativeSource") == _original_source(self.approval)
             and self.manifest["dataset"].get("rows") == self.approval["export"].get("rowCount")
             and self.manifest.get("originalExportFiles") == self.approval["files"]
             and self.manifest.get("originalExportRoot") == self.approval["exportRoot"]
             and all(self.manifest["outputs"].get(name) == original_files.get(original)
                     for name, original in retained.items()),
             "DATASET_PG_CENTRAL_PREPARED_SOURCE_CHANGED")
        documents = {}
        for name in retained:
            if name == "original-dataset.csv":
                with self.file(name).open():
                    pass
            else:
                documents[name] = parse(self.file(name).read_bytes(limit=_MAX_META))
        self.dictionary = documents["semantics.json"]
        binding, fields, physical = _validate_original(
            self.approval, original_files, documents["dataset.json"], documents["source.json"],
            self.dictionary, documents["table-schema.json"], documents["capture-manifest.json"])
        need(fields == self.manifest["dataset"]["projectedFields"]
             and self.manifest["dataset"].get("name") == documents["dataset.json"].get("name")
             and self.manifest["dataset"].get("snapshot") == self.approval["export"].get("fingerprint")
             and self.manifest["sourcePages"] == documents["source.json"].get("pages")
             and self.manifest["projection"].get("columns") == physical
             and self.manifest["projection"].get("mapping") == self.approval["projection"].get("mapping")
             and all(self.manifest["semantics"].get(key) == value for key, value in binding.items()),
             "DATASET_PG_CENTRAL_PREPARED_DICTIONARY_CHANGED")

    def file(self, name):
        if name == "manifest.json":
            return _PreparedFile(self.directory, name,
                                 {"bytes": len(self.manifest_bytes), "sha256": digest(self.manifest_bytes)})
        mapping = {"dataset.jsonl": "approved-projection.jsonl"}
        need(name in self.manifest.get("outputs", {}), "DATASET_PG_CENTRAL_PREPARED_FILE_REQUIRED")
        return _PreparedFile(self.directory, mapping.get(name, name), self.manifest["outputs"][name])

    def suggested_mapping(self, nulls):
        types = {"string": "text", "integer": "bigint",
                 "number": "double precision", "boolean": "boolean"}
        keys = self.dictionary["primaryKey"]["projected"]
        return DatasetMapping(tuple(Column(column["name"], column["name"], types[column["type"]],
                    nullable=nulls[column["name"]] > 0) for column in self.dictionary["columns"]),
                              tuple(keys))

    def receiving_input(self, mapping):
        need(isinstance(mapping, DatasetMapping)
             and set(self.manifest["dataset"]["projectedFields"]) == {c.source for c in mapping.columns},
             "DATASET_PG_MAP_EVERY_DELIVERED_FIELD")
        need(list(mapping.keys) == self.dictionary["primaryKey"]["projected"],
             "DATASET_PG_CENTRAL_KEEP_NATIVE_SOURCE_KEYS")
        raw = self.file("semantics.json").read_bytes(limit=2 * 1024 * 1024)
        receiving = {"bytes": raw, "document": self.dictionary, "identity": identity(self.dictionary),
                     "file": {"name": "semantics.json", "bytes": len(raw), "sha256": digest(raw)},
                     "selected_fields": self.manifest["dataset"]["projectedFields"]}
        ident = {"schema": WAREHOUSE_SCHEMA, "manifestSha256": digest(self.manifest_bytes),
                 "sourceBindingSha256": self.manifest["sourceBindingSha256"], "mapping": mapping.record()}
        version_id = digest(_json(ident).encode())
        descriptor = _semantic_descriptor(receiving, mapping)
        sql_context(raw, descriptor, version_id, case_sensitive_targets=True)
        _bound_semantics(raw, _semantic_descriptor(receiving, mapping, enforced=True),
                         self.manifest, mapping, version_id)
        return _CentralInput(self, self.manifest_bytes, self.manifest, mapping, ident,
                             version_id, self.manifest["outputs"]["dataset.jsonl"],
                             receiving, descriptor)


def _workspace(directory, expected):
    """Read the original current Central SQLite identity without creating a database."""
    import sqlite3
    from urllib.parse import quote
    path = _file_path(directory, "central.sqlite")
    need(stat.S_ISREG(path.lstat().st_mode), "DATASET_PG_CENTRAL_WORKSPACE_REQUIRED")
    connection = sqlite3.connect("file:" + quote(str(path), safe="/") + "?mode=ro", uri=True)
    try:
        connection.execute("PRAGMA query_only=ON")
        values = dict(connection.execute("SELECT key,value FROM metadata WHERE key IN ('schema','workspaceId')"))
        need(values == {"schema": "stellar-forge.odk-central-workspace.v1",
                        "workspaceId": expected["id"]}
             and expected.get("schema") == values["schema"],
             "DATASET_PG_CENTRAL_WORKSPACE_CHANGED")
    finally:
        connection.close()


def _original_source(approval):
    return {key: approval[key] for key in
            ("workspace", "commissioning", "delivery", "period", "capture", "table", "export")}


def _retain_file(root, relative, expected, destination):
    if destination.exists():
        with _verified(destination.parent, destination.name, expected):
            pass
        return
    fd, temporary = tempfile.mkstemp(prefix=".original-", dir=destination.parent)
    try:
        with os.fdopen(fd, "wb") as output, _verified(root, relative, expected) as stream:
            while chunk := stream.read(1024 * 1024):
                output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
        os.link(temporary, destination)
        sync_directory(destination.parent)
    finally:
        Path(temporary).unlink(missing_ok=True)


def _validate_original(approval, files, config, source, dictionary, table_schema, capture):
    projected = approval["projection"]
    need(config.get("schema") == "stellar-forge.csv-dataset.v1"
         and config.get("file") == "dataset.csv"
         and source.get("schema") == "stellar-forge.odata-dataset-source.v1"
         and source.get("provider") == "odk-central",
         "DATASET_PG_CENTRAL_ORIGINAL_EXPORT_REQUIRED")
    need(source.get("captureId") == approval["capture"].get("id")
         and source.get("tableId") == approval["table"].get("id")
         and source.get("entitySet") == approval["table"].get("name")
         and source.get("editionId") == approval["export"].get("editionId")
         and source.get("completedAt") == approval["capture"].get("completedAt")
         and source.get("rowCount") == approval["export"].get("rowCount")
         and same_json(source.get("review"), approval["review"])
         and same_json(source.get("mapping"), projected.get("mapping"))
         and same_json(source.get("keyFields"), approval["table"].get("keyFields"))
         and same_json(source.get("relationship"), approval["table"].get("relationship")),
         "DATASET_PG_CENTRAL_ORIGINAL_SELECTION_CHANGED")
    need(same_json(config.get("columns"), projected.get("columns"))
         and same_json(config.get("semantics"), dictionary)
         and same_json(source.get("semantics"), projected.get("semantics"))
         and same_json(table_schema, dictionary.get("csvw")),
         "DATASET_PG_CENTRAL_ORIGINAL_DICTIONARY_CHANGED")
    mapping = source["mapping"]
    approved = projected.get("approvedFields")
    need(isinstance(mapping, list) and 1 <= len(mapping) <= 32
         and isinstance(approved, list) and all(isinstance(field, str) for field in approved)
         and len(set(approved)) == len(approved)
         and {field.get("path") for field in mapping} == set(approved)
         and len(mapping) == len(approved),
         "DATASET_PG_CENTRAL_APPROVED_PROJECTION_CHANGED")
    physical = _columns(config)
    fields = [column["name"] for column in physical]
    need(fields == [name for item in mapping for name in (item["name"], item["name"] + "_state")]
         and all(item.get("odataType") and type(item.get("collection")) is bool for item in mapping),
         "DATASET_PG_CENTRAL_PHYSICAL_PROJECTION_CHANGED")
    binding = validate_document(dictionary, fields)
    need(physical == [{key: column.get(key) for key in ("name", "type", "nullable")}
                      for column in dictionary["columns"]],
         "DATASET_PG_CENTRAL_PHYSICAL_DICTIONARY_CHANGED")
    need(binding["schema"] == "stellar-forge.odata-semantics.v1"
         and all(source["semantics"].get(key) == value for key, value in binding.items())
         and files["capture/manifest.json"]["sha256"] == binding["captureManifestSha256"]
         and files["capture/metadata.csdl"]["sha256"] == dictionary["source"]["schemaSha256"]
         and capture.get("contentHash") == source.get("contentHash")
         and capture.get("editionId") == source["editionId"]
         and capture.get("rowCount") == source["rowCount"]
         and same_json(capture.get("pages"), source.get("pages"))
         and dictionary["primaryKey"]["complete"],
         "DATASET_PG_CENTRAL_CAPTURE_DICTIONARY_CHANGED")
    aliases = {item["path"]: item["name"] for item in mapping}
    keys = source["keyFields"]
    need(isinstance(keys, list) and keys and all(key in aliases for key in keys)
         and dictionary["primaryKey"]["projected"] == [aliases[key] for key in keys],
         "DATASET_PG_CENTRAL_NATIVE_KEY_REQUIRED")
    relation = source.get("relationship")
    if relation:
        need(isinstance(relation, dict) and relation.get("parentField") in aliases,
             "DATASET_PG_CENTRAL_PARENT_KEY_REQUIRED")
    source_files = source.get("sourceFiles")
    need(isinstance(source_files, list), "DATASET_PG_CENTRAL_SOURCE_RECEIPTS_REQUIRED")
    for row in source_files:
        need(isinstance(row, dict) and row.get("path") in files
             and files[row["path"]] == {key: row.get(key) for key in ("bytes", "sha256")},
             "DATASET_PG_CENTRAL_SOURCE_RECEIPT_CHANGED")
    return binding, fields, physical


def prepare_central(approval_path, expected_sha256, source_workspace, directory):
    """Retain one complete typed projection of the original accepted Central CSV."""
    need(isinstance(expected_sha256, str) and _HEX.fullmatch(expected_sha256),
         "DATASET_PG_CENTRAL_APPROVAL_HASH_REQUIRED")
    raw = read(Path(approval_path), _MAX_META)
    need(digest(raw) == expected_sha256, "DATASET_PG_CENTRAL_APPROVAL_CHANGED")
    approval = parse(raw)
    required = {"workspace", "commissioning", "delivery", "period", "capture", "table",
                "review", "export", "projection", "files", "exportRoot"}
    need(isinstance(approval, dict) and approval.get("schema") == APPROVAL_SCHEMA
         and required <= approval.keys(), "DATASET_PG_CENTRAL_APPROVAL_INVALID")
    need(all(isinstance(approval[key], dict) for key in required - {"files", "exportRoot"}),
         "DATASET_PG_CENTRAL_APPROVAL_INVALID")
    need(approval["review"].get("decision") == "accept"
         and approval["review"].get("contentHash") == approval["capture"].get("contentHash"),
         "DATASET_PG_CENTRAL_ACCEPTED_REVIEW_REQUIRED")
    root = private_directory(Path(source_workspace), create=False)
    _workspace(root, approval["workspace"])
    export_id = approval["export"].get("id")
    need(isinstance(export_id, str) and approval["exportRoot"] == "exports/" + export_id,
         "DATASET_PG_CENTRAL_EXPORT_ROOT_CHANGED")
    export_root = root / _path(approval["exportRoot"])
    output = private_directory(private_directory(Path(directory)) / expected_sha256)
    manifest_path = output / "manifest.json"
    if manifest_path.exists():
        retained = CentralAcceptedDelivery(manifest_path)
        need(retained.approval_bytes == raw
             and retained.manifest["nativeSource"] == _original_source(approval),
             "DATASET_PG_CENTRAL_PREPARED_SOURCE_CHANGED")
        with retained.file("dataset.jsonl").open():
            pass
        return manifest_path

    need(_file_path(root, approval["exportRoot"] + "/dataset.json").parent == export_root,
         "DATASET_PG_CENTRAL_EXPORT_ROOT_CHANGED")
    need(isinstance(approval["files"], list) and approval["files"],
         "DATASET_PG_CENTRAL_SOURCE_FILES_REQUIRED")
    files = {}
    for row in approval["files"]:
        need(isinstance(row, dict) and set(row) == {"path", "bytes", "sha256"}
             and type(row.get("bytes")) is int and 0 <= row["bytes"] <= 1024**4
             and isinstance(row.get("sha256"), str) and _HEX.fullmatch(row["sha256"]),
             "DATASET_PG_CENTRAL_SOURCE_RECEIPT_INVALID")
        name = str(_path(row["path"]))
        need(name not in files, "DATASET_PG_CENTRAL_SOURCE_FILE_DUPLICATE")
        files[name] = {"bytes": row["bytes"], "sha256": row["sha256"]}
    required_files = {"dataset.csv", "dataset.json", "source.json", "semantics.json",
                      "table-schema.json", "capture/manifest.json", "capture/metadata.csdl",
                      "capture/service.json", "rows.jsonl"}
    need(required_files <= files.keys(), "DATASET_PG_CENTRAL_COMPLETE_EXPORT_REQUIRED")
    config_raw, config = _metadata(export_root, "dataset.json", files)
    source_raw, source = _metadata(export_root, "source.json", files)
    dictionary_raw, dictionary = _metadata(export_root, "semantics.json", files)
    table_raw, table_schema = _metadata(export_root, "table-schema.json", files)
    capture_raw, capture = _metadata(export_root, "capture/manifest.json", files)
    binding, fields, physical = _validate_original(
        approval, files, config, source, dictionary, table_schema, capture)
    # Verify the original full export receipts. Full capture rows remain separate;
    # only dataset.csv's approved physical value/state columns form the SQL input.
    for name, expected in files.items():
        with _verified(export_root, name, expected):
            pass
    projection, physical = _projection(export_root, files, config, source, dictionary,
                                       output / "approved-projection.jsonl")
    originals = {"approval.json": raw, "source.json": source_raw,
                 "dataset.json": config_raw, "semantics.json": dictionary_raw,
                 "table-schema.json": table_raw, "capture-manifest.json": capture_raw}
    outputs = {"dataset.jsonl": projection, "original-dataset.csv": files["dataset.csv"]}
    for name, content in originals.items():
        _put(output / name, content)
        outputs[name] = {"bytes": len(content), "sha256": digest(content)}
    _retain_file(export_root, "dataset.csv", files["dataset.csv"], output / "original-dataset.csv")
    manifest = {
        "schema": SCHEMA, "sourceKind": SOURCE_KIND, "sourceBindingSha256": expected_sha256,
        "nativeSource": _original_source(approval),
        "originalApproval": {"file": "approval.json", "bytes": len(raw), "sha256": expected_sha256},
        "originalExportFiles": approval["files"], "originalExportRoot": approval["exportRoot"],
        "dataset": {"name": config["name"], "snapshot": approval["export"]["fingerprint"],
                    "projectedFields": fields, "rows": source["rowCount"]},
        "sourcePages": source["pages"], "outputs": outputs,
        "semantics": {**binding, "file": "semantics.json", "typedRowsFile": "dataset.jsonl",
                      "scope": "PUBLISHED_DATASET", "selectedFields": fields},
        "projection": {"sourceFile": "original-dataset.csv", "typedFile": "approved-projection.jsonl",
                       "columns": physical, "mapping": source["mapping"],
                       "encoding": "original-native-csv-value-and-state-columns",
                       "portableSource": "complete-selected-capture",
                       "csvParserSource": "db1580e7d515ad694efcb09778d74cb87c91bd47"},
    }
    dump(manifest_path, manifest, exclusive=True)
    retained = CentralAcceptedDelivery(manifest_path)
    need(retained.approval_bytes == raw, "DATASET_PG_CENTRAL_APPROVAL_CHANGED")
    return manifest_path
