"""Retained semantic dictionaries on the original SF88/SF100 delivery files.

The original SF100 engine validates the semantic canonical identities. This
receiver verifies the exact original output bytes, native/manifest identity and
page continuity; it does not reserialize JSON to invent a second digest scheme.
"""
from __future__ import annotations

import re

from .errors import DeliveryError
from .storage import digest, parse

SCHEMA = "stellar-forge.ckan-semantics.v1"
ODATA_SCHEMA = "stellar-forge.odata-semantics.v1"
SCHEMAS = frozenset({SCHEMA, ODATA_SCHEMA})
SQL_SCHEMA = "stellar-forge.python-dataset-semantics.v1"
MAX_BYTES = 2 * 1024 * 1024
_HEX = re.compile(r"[a-f0-9]{64}")
_IDENTITY = ("schema", "sha256", "definitionSha256", "captureManifestSha256")


def _require(value, code):
    if not value:
        raise DeliveryError(code)


def same_json(first, second):
    """Compare JSON values without equating booleans and numeric values."""
    if type(first) is not type(second):
        return False
    if isinstance(first, dict):
        return first.keys() == second.keys() and all(same_json(first[key], second[key]) for key in first)
    if isinstance(first, list):
        return len(first) == len(second) and all(same_json(a, b) for a, b in zip(first, second))
    return first == second


def identity(document):
    source = document.get("source") if isinstance(document, dict) else None
    _require(isinstance(source, dict), "DATASET_SEMANTIC_SOURCE_INVALID")
    result = {"schema": document.get("schema"), "sha256": document.get("sha256"),
              "definitionSha256": document.get("definitionSha256"),
              "captureManifestSha256": source.get("captureManifestSha256")}
    _require(isinstance(result["schema"], str) and result["schema"] in SCHEMAS and all(isinstance(result[key], str) and
             _HEX.fullmatch(result[key]) for key in _IDENTITY if key != "schema"),
             "DATASET_SEMANTIC_IDENTITY_INVALID")
    if result["schema"] == ODATA_SCHEMA:
        _require(source.get("provider") == "odata4"
                 and source.get("protocolVersion") in ("4.0", "4.01")
                 and all(isinstance(source.get(key), str) and 0 < len(source[key]) <= 8192
                         for key in ("serviceUrl", "schemaUrl", "entityContainer", "entitySet", "entityType"))
                 and isinstance(source.get("schemaSha256"), str)
                 and _HEX.fullmatch(source["schemaSha256"])
                 and isinstance(document.get("csdl"), dict),
                 "DATASET_ODATA_SOURCE_FORMAT_INVALID")
    return result


def validate_document(document, fields):
    binding = identity(document)
    columns = document.get("columns")
    _require(isinstance(fields, list) and all(isinstance(name, str) for name in fields)
             and len(fields) == len(set(fields)), "DATASET_SEMANTIC_FIELDS_INVALID")
    _require(isinstance(columns, list) and 1 <= len(columns) <= 64,
             "DATASET_SEMANTIC_COLUMNS_INVALID")
    names = []
    for column in columns:
        _require(isinstance(column, dict) and isinstance(column.get("name"), str)
                 and column["name"] and isinstance(column.get("sourceField"), str)
                 and column["sourceField"] and column.get("type") in
                 {"string", "integer", "number", "boolean"}
                 and type(column.get("nullable")) is bool
                 and column.get("encoding") in {"native", "text", "json"}
                 and isinstance(column.get("projectedDefinition"), dict)
                 and column["projectedDefinition"].get("name") == column["name"]
                 and isinstance(column.get("issues"), list),
                 "DATASET_SEMANTIC_COLUMN_INVALID")
        names.append(column["name"])
    _require(len(names) == len(set(names)) and set(fields) <= set(names),
             "DATASET_SEMANTIC_SELECTED_FIELDS_CHANGED")
    primary = document.get("primaryKey")
    csvw = document.get("csvw")
    virtual = document.get("virtualColumns")
    _require(isinstance(primary, dict) and isinstance(primary.get("source"), list)
             and isinstance(primary.get("projected"), list)
             and type(primary.get("complete")) is bool
             and isinstance(document.get("aboutUrl"), dict)
             and isinstance(document.get("issues"), list)
             and isinstance(virtual, list) and isinstance(csvw, dict)
             and isinstance(csvw.get("tableSchema"), dict)
             and isinstance(csvw["tableSchema"].get("columns"), list),
             "DATASET_SEMANTIC_DEFINITIONS_INVALID")
    if binding["schema"] == ODATA_SCHEMA:
        _require(len(columns) % 2 == 0, "DATASET_ODATA_STATE_COLUMNS_CHANGED")
        value_names = set()
        for index in range(0, len(columns), 2):
            value, state = columns[index:index + 2]
            _require(value.get("role") == "value" and state.get("role") == "state"
                     and state["sourceField"] == value["sourceField"]
                     and state["name"] == value["name"] + "_state"
                     and value.get("stateColumn") == state["name"]
                     and state.get("valueColumn") == value["name"]
                     and state["type"] == "string" and state["nullable"] is False
                     and isinstance(value.get("sourceDefinition"), dict)
                     and isinstance(state.get("sourceDefinition"), dict)
                     and state["sourceDefinition"].get("role") == "source-presence"
                     and state["sourceDefinition"].get("sourcePath") == value["sourceField"]
                     and same_json(state["sourceDefinition"].get("values"), ["value", "null", "missing"]),
                     "DATASET_ODATA_STATE_COLUMNS_CHANGED")
            value_names.add(value["name"])
        _require(all(isinstance(key, str) and key for key in primary["source"])
                 and len(primary["source"]) == len(set(primary["source"]))
                 and all(isinstance(key, str) and key in value_names for key in primary["projected"])
                 and len(primary["projected"]) == len(set(primary["projected"]))
                 and (not primary["complete"] or len(primary["source"]) == len(primary["projected"])),
                 "DATASET_ODATA_PRIMARY_KEY_CHANGED")
    definitions = [column["projectedDefinition"] for column in columns]
    for column in virtual:
        _require(isinstance(column, dict) and (column.get("projectedDefinition") is None
                 or isinstance(column["projectedDefinition"], dict)),
                 "DATASET_SEMANTIC_VIRTUAL_COLUMN_INVALID")
        if column.get("projectedDefinition") is not None:
            definitions.append(column["projectedDefinition"])
    _require(same_json(definitions, csvw["tableSchema"]["columns"]),
             "DATASET_SEMANTIC_CSVW_CHANGED")
    return binding


def read_delivery_semantics(delivery, *, manifest=None):
    """Return verified original bytes/document, or None for a legacy delivery."""
    if manifest is None:
        manifest = parse(delivery.file("manifest.json").read_bytes(limit=4 * 1024 * 1024))
    native = delivery.native
    _require(isinstance(manifest, dict) and
             manifest.get("schema") == "stellar-forge.buyer-delivery-manifest.v1",
             "DATASET_SEMANTIC_MANIFEST_INVALID")
    descriptor = manifest.get("semantics")
    output = manifest.get("outputs", {}).get("semantics.json")
    native_output = native.get("outputs", {}).get("semantics.json")
    status = native.get("nativeStatus") or {}
    if descriptor is None:
        _require(output is None and native_output is None and native.get("semantics") is None
                 and status.get("semantics") is None, "DATASET_UNEXPECTED_SEMANTICS")
        return None
    _require(isinstance(descriptor, dict) and isinstance(output, dict)
             and isinstance(native_output, dict), "DATASET_SEMANTIC_OUTPUT_REQUIRED")
    fields = manifest.get("dataset", {}).get("projectedFields")
    _require(descriptor.get("file") == "semantics.json"
             and descriptor.get("typedRowsFile") == "dataset.jsonl"
             and descriptor.get("scope") == "PUBLISHED_DATASET"
             and same_json(descriptor.get("selectedFields"), fields),
             "DATASET_SEMANTIC_SELECTION_CHANGED")
    raw = delivery.file("semantics.json").read_bytes(limit=MAX_BYTES)
    exact = {"bytes": len(raw), "sha256": digest(raw)}
    _require(same_json(output, exact) and all(native_output.get(key) == value
             for key, value in exact.items()), "DATASET_SEMANTIC_FILE_CHANGED")
    document = parse(raw)
    binding = validate_document(document, fields)
    _require(all(descriptor.get(key) == value for key, value in binding.items()),
             "DATASET_SEMANTIC_IDENTITY_CHANGED")
    _require(same_json(status.get("semantics"), binding)
             and same_json(native.get("semantics"), descriptor),
             "DATASET_NATIVE_SEMANTIC_BINDING_CHANGED")
    return {"bytes": raw, "document": document, "identity": binding,
            "file": {"name": "semantics.json", **exact}, "selected_fields": list(fields)}


def validate_page_semantics(payload, receiving):
    expected = receiving["document"] if receiving is not None else None
    _require(isinstance(payload, dict) and same_json(payload.get("semantics"), expected),
             "DATASET_NATIVE_SEMANTIC_PAGE_CHANGED")
    if receiving is None:
        return
    columns = payload.get("dataset", {}).get("columns")
    definitions = expected["columns"]
    _require(isinstance(columns, list) and len(columns) == len(definitions),
             "DATASET_NATIVE_SEMANTIC_COLUMNS_CHANGED")
    for physical, definition in zip(columns, definitions):
        _require(isinstance(physical, dict) and all(same_json(physical.get(key), definition[key])
                 for key in ("name", "type", "nullable")),
                 "DATASET_NATIVE_SEMANTIC_COLUMNS_CHANGED")

    if expected["schema"] == ODATA_SCHEMA:
        selected = payload.get("fields")
        rows = payload.get("rows")
        _require(isinstance(selected, list) and isinstance(rows, list)
                 and all(isinstance(row, dict) for row in rows),
                 "DATASET_NATIVE_SEMANTIC_PAGE_CHANGED")
        states = [column["name"] for column in definitions
                  if column["role"] == "state" and column["name"] in selected]
        _require(all(row.get(name) in ("value", "null", "missing")
                     for row in rows for name in states),
                 "DATASET_ODATA_STATE_VALUE_CHANGED")


def sql_descriptor(receiving, fields, mapped):
    """Bind source definitions to reviewed SQL aliases without changing meaning."""
    binding = receiving["identity"]
    aliases = dict(zip(fields, mapped))
    primary = receiving["document"]["primaryKey"]
    key = primary["projected"]
    return {"schema": SQL_SCHEMA, "scope": "IMPORTED_SOURCE",
            "primary_key": {"source": key, "columns": [aliases[name] for name in key if name in aliases],
                            "complete": bool(primary["complete"] and all(name in aliases for name in key)),
                            "enforced": False},
            "semantic_sha256": binding["sha256"],
            "definition_sha256": binding["definitionSha256"],
            "capture_manifest_sha256": binding["captureManifestSha256"],
            "file": receiving["file"],
            "columns": [{"source": field, "column": column} for field, column in zip(fields, mapped)]}


def sql_context(raw, descriptor, version_id, *, case_sensitive_targets=False):
    """Reopen original meanings under the receiving engine's identifier rules.

    SQLite and DuckDB use case-insensitive target names. PostgreSQL receives
    explicitly quoted names and therefore requests case-sensitive equality.
    """
    _require(isinstance(descriptor, dict) and descriptor.get("schema") == SQL_SCHEMA
             and isinstance(descriptor.get("file"), dict)
             and len(raw) <= MAX_BYTES
             and descriptor["file"].get("name") == "semantics.json"
             and descriptor["file"].get("bytes") == len(raw)
             and descriptor["file"].get("sha256") == digest(raw),
             "DATASET_SQL_SEMANTIC_FILE_CHANGED")
    mappings = descriptor.get("columns")
    _require(isinstance(mappings, list) and mappings
             and all(isinstance(column, dict) and isinstance(column.get("source"), str)
                     and isinstance(column.get("column"), str) for column in mappings),
             "DATASET_SQL_SEMANTIC_MAPPING_INVALID")
    fields = [column["source"] for column in mappings]
    targets = [column["column"] if case_sensitive_targets else column["column"].casefold()
               for column in mappings]
    _require(len(fields) == len(set(fields)) and len(set(targets)) == len(mappings),
             "DATASET_SQL_SEMANTIC_MAPPING_INVALID")
    document = parse(raw)
    binding = validate_document(document, fields)
    _require(descriptor.get("semantic_sha256") == binding["sha256"]
             and descriptor.get("definition_sha256") == binding["definitionSha256"]
             and descriptor.get("capture_manifest_sha256") == binding["captureManifestSha256"],
             "DATASET_SQL_SEMANTIC_IDENTITY_CHANGED")
    return {**descriptor, "version_id": version_id, "document": document}
