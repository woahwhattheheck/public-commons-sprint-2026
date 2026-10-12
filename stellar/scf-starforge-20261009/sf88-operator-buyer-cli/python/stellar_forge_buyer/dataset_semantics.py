"""Retained semantic dictionaries on the original SF88/SF100 delivery files.

The original SF100 engine validates the semantic canonical identities. This
receiver verifies the exact original output bytes, native/manifest identity and
page continuity; it does not reserialize JSON to invent a second digest scheme.
"""
from __future__ import annotations

import re
from urllib.parse import urlsplit, urlunsplit

from .errors import DeliveryError
from .storage import digest, parse

SCHEMA = "stellar-forge.ckan-semantics.v1"
ODATA_SCHEMA = "stellar-forge.odata-semantics.v1"
SUPERSET_SCHEMA = "stellar-forge.superset-semantics.v1"
DIRECTUS_SCHEMA = "stellar-forge.directus-semantics.v1"
SCHEMAS = frozenset({SCHEMA, ODATA_SCHEMA, SUPERSET_SCHEMA, DIRECTUS_SCHEMA})
_PAIRED_SCHEMAS = frozenset({ODATA_SCHEMA, SUPERSET_SCHEMA, DIRECTUS_SCHEMA})
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


def _text(value):
    return isinstance(value, str) and bool(value)


def _sha256(value):
    return isinstance(value, str) and _HEX.fullmatch(value) is not None


def _safe_integer(value, minimum=0):
    return type(value) is int and minimum <= value <= 9007199254740991


def _member(value, key):
    return value.get(key) if isinstance(value, dict) else None


def _canonical_base_url(value):
    if not _text(value) or any(character in value for character in "\r\n\t"):
        return False
    try:
        parsed = urlsplit(value)
        port = parsed.port
        return (parsed.scheme in ("http", "https") and bool(parsed.hostname)
                and parsed.username is None and parsed.password is None
                and (port is None or 1 <= port <= 65535)
                and not parsed.query and not parsed.fragment and parsed.path.endswith("/")
                and urlunsplit(parsed) == value)
    except ValueError:
        return False


def _presence_pairs(columns, code):
    """Use the source's reciprocal names; Directus has independent value/state aliases."""
    _require(len(columns) % 2 == 0, code)
    pairs = []
    for index in range(0, len(columns), 2):
        value, state = columns[index:index + 2]
        _require(value.get("role") == "value" and state.get("role") == "state"
                 and value.get("stateColumn") == state["name"]
                 and state.get("valueColumn") == value["name"]
                 and state["sourceField"] == value["sourceField"]
                 and state["type"] == "string" and state["nullable"] is False
                 and state["encoding"] == "native"
                 and isinstance(value.get("sourceDefinition"), dict)
                 and isinstance(state.get("sourceDefinition"), dict)
                 and state["sourceDefinition"].get("role") == "source-presence"
                 and same_json(state["sourceDefinition"].get("values"), ["value", "null", "missing"]),
                 code)
        pairs.append((value, state))
    return pairs


def _paired_primary(primary, values, code):
    source, projected = primary["source"], primary["projected"]
    _require(all(_text(name) for name in source) and len(source) == len(set(source))
             and all(_text(name) and name in values for name in projected)
             and len(projected) == len(set(projected))
             and (not primary["complete"] or bool(source) and len(source) == len(projected)
                  and all(values[name]["sourceField"] == original
                          for name, original in zip(projected, source))),
             code)


def _superset_columns(document, columns, primary):
    pairs = _presence_pairs(columns, "DATASET_SUPERSET_STATE_COLUMNS_CHANGED")
    native_names, native_ordinals, values = set(), set(), {}
    for value, state in pairs:
        definition, presence = value["sourceDefinition"], state["sourceDefinition"]
        name, ordinal = definition.get("sourceName"), definition.get("sourceOrdinal")
        native_type = definition.get("nativeType")
        _require(name == value["sourceField"] and name not in native_names
                 and _safe_integer(ordinal) and ordinal not in native_ordinals
                 and _safe_integer(native_type, -9007199254740991)
                 and presence.get("sourceName") == name
                 and same_json(presence.get("sourceOrdinal"), ordinal)
                 and same_json(presence.get("nativeType"), native_type),
                 "DATASET_SUPERSET_NATIVE_COLUMN_CHANGED")
        native_names.add(name)
        native_ordinals.add(ordinal)
        values[value["name"]] = value
    _paired_primary(primary, values, "DATASET_SUPERSET_PRIMARY_KEY_CHANGED")


def _directus_columns(document, columns, primary):
    source, native = document["source"], document["directus"]
    fields = {}
    for field in native["fields"]:
        _require(isinstance(field, dict) and field.get("collection") == source["collection"]
                 and _text(field.get("field")) and field["field"] not in fields,
                 "DATASET_DIRECTUS_NATIVE_FIELDS_CHANGED")
        fields[field["field"]] = field
    keys = [field for field in fields.values() if _member(field.get("schema"), "is_primary_key") is True]
    _require(len(keys) == 1 and keys[0]["field"] == source["primaryField"],
             "DATASET_DIRECTUS_NATIVE_KEY_CHANGED")
    values, selected = {}, set()
    for value, state in _presence_pairs(columns, "DATASET_DIRECTUS_STATE_COLUMNS_CHANGED"):
        name = value["sourceField"]
        field = fields.get(name)
        _require(field is not None and name not in selected and value["type"] == "string"
                 and value["nullable"] is False and value["encoding"] == "json",
                 "DATASET_DIRECTUS_VALUE_PROJECTION_CHANGED")
        nullable = _member(field.get("schema"), "is_nullable")
        definition = {
            "collection": source["collection"], "field": name, "sourcePath": name,
            "type": field.get("type") if field.get("type") is not None else "unknown",
            "nullable": nullable if type(nullable) is bool else None,
            "schema": field.get("schema"), "meta": field.get("meta"),
            "relations": [relation for relation in native["relations"]
                          if (relation.get("collection") == source["collection"] and relation.get("field") == name)
                          or (relation.get("related_collection") == source["collection"]
                              and _member(relation.get("meta"), "one_field") == name)],
        }
        presence = {"sourcePath": name, "role": "source-presence",
                    "sourceNullable": definition["nullable"], "values": ["value", "null", "missing"]}
        _require(same_json(value["sourceDefinition"], definition)
                 and same_json(state["sourceDefinition"], presence),
                 "DATASET_DIRECTUS_NATIVE_DEFINITION_CHANGED")
        selected.add(name)
        values[value["name"]] = value
    _paired_primary(primary, values, "DATASET_DIRECTUS_PRIMARY_KEY_CHANGED")
    _require(same_json(primary["source"], [source["primaryField"]])
             and all(values[name]["sourceField"] == source["primaryField"] for name in primary["projected"])
             and primary["complete"] == (len(primary["projected"]) == 1),
             "DATASET_DIRECTUS_PRIMARY_KEY_CHANGED")


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
    if result["schema"] == SUPERSET_SCHEMA:
        query = document.get("query")
        _require(source.get("provider") == "apache-superset"
                 and source.get("protocolVersion") == "6.1"
                 and _canonical_base_url(source.get("baseUrl"))
                 and _safe_integer(source.get("chartId"), 1)
                 and (source.get("chartUuid") is None or _text(source.get("chartUuid")))
                 and _safe_integer(source.get("queryOrdinal"))
                 and all(_sha256(source.get(key)) for key in
                         ("queryContextSha256", "principalSha256", "schemaSha256"))
                 and isinstance(query, dict)
                 and query.get("savedContextSha256") == source["queryContextSha256"]
                 and (query.get("rowLimit") is None or _safe_integer(query.get("rowLimit")))
                 and _safe_integer(query.get("rowOffset")),
                 "DATASET_SUPERSET_SOURCE_FORMAT_INVALID")
    if result["schema"] == DIRECTUS_SCHEMA:
        query, principal, native = source.get("query"), source.get("principal"), document.get("directus")
        _require(source.get("provider") == "directus" and source.get("protocolVersion") == "12.5"
                 and all(_text(source.get(key)) for key in ("baseUrl", "collection", "primaryField"))
                 and _sha256(source.get("schemaSha256"))
                 and source.get("definitionNumericEncoding") == "original-json-number-lexemes"
                 and isinstance(query, dict) and isinstance(query.get("fields"), list)
                 and isinstance(query.get("sort"), list)
                 and isinstance(principal, dict) and _text(principal.get("id"))
                 and isinstance(native, dict) and isinstance(native.get("collection"), dict)
                 and native["collection"].get("collection") == source["collection"]
                 and isinstance(native.get("fields"), list) and isinstance(native.get("relations"), list)
                 and all(isinstance(relation, dict) for relation in native["relations"]),
                 "DATASET_DIRECTUS_SOURCE_FORMAT_INVALID")
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
    if binding["schema"] == SUPERSET_SCHEMA:
        _superset_columns(document, columns, primary)
    if binding["schema"] == DIRECTUS_SCHEMA:
        _directus_columns(document, columns, primary)
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

    if expected["schema"] in _PAIRED_SCHEMAS:
        selected = payload.get("fields")
        rows = payload.get("rows")
        _require(isinstance(selected, list) and isinstance(rows, list)
                 and all(isinstance(row, dict) for row in rows),
                 "DATASET_NATIVE_SEMANTIC_PAGE_CHANGED")
        states = [column["name"] for column in definitions
                  if column["role"] == "state" and column["name"] in selected]
        _require(all(row.get(name) in ("value", "null", "missing")
                     for row in rows for name in states),
                 "DATASET_ODATA_STATE_VALUE_CHANGED" if expected["schema"] == ODATA_SCHEMA
                 else "DATASET_SOURCE_STATE_VALUE_CHANGED")


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
