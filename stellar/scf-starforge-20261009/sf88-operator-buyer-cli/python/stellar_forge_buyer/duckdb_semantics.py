"""Source meaning over the original retained DuckDB edition files.

All source verification and SQL mapping use the common dataset semantic reader.
The warehouse's existing file/chunk tables remain the retained byte store.
"""
from __future__ import annotations

import hashlib
import re

from .dataset_semantics import (
    MAX_BYTES, read_delivery_semantics, same_json, sql_context, sql_descriptor,
)
from .errors import StateError
from .storage import digest, parse, private_directory, read, write

CONTEXT_SCHEMA = "stellar-forge.duckdb-source-meanings.v1"
_HEX = re.compile(r"[a-f0-9]{64}")


def _require(value, code):
    if not value:
        raise StateError(code)


def _file_bytes(db, edition_id, name, limit):
    row = db.execute(
        "SELECT bytes,sha256 FROM sf_files WHERE edition_id=? AND name=?",
        [edition_id, name],
    ).fetchone()
    _require(row is not None, "DUCKDB_RETAINED_SEMANTIC_FILE_MISSING")
    size, sha = row
    _require(type(size) is int and 0 <= size <= limit and isinstance(sha, str)
             and _HEX.fullmatch(sha), "DUCKDB_RETAINED_SEMANTIC_FILE_INVALID")
    cursor = db.execute(
        "SELECT part,content FROM sf_file_chunks WHERE edition_id=? AND name=? ORDER BY part",
        [edition_id, name],
    )
    chunks, length, checksum = [], 0, hashlib.sha256()
    while item := cursor.fetchone():
        part, content = item
        _require(part == len(chunks) and isinstance(content, (bytes, bytearray, memoryview)),
                 "DUCKDB_RETAINED_SEMANTIC_CHUNKS_CHANGED")
        content = bytes(content)
        length += len(content)
        _require(length <= size, "DUCKDB_RETAINED_SEMANTIC_FILE_CHANGED")
        checksum.update(content)
        chunks.append(content)
    _require(length == size and checksum.hexdigest() == sha,
             "DUCKDB_RETAINED_SEMANTIC_FILE_CHANGED")
    return b"".join(chunks)


class _EditionFile:
    def __init__(self, db, edition_id, name):
        self.db, self.edition_id, self.name = db, edition_id, name

    def read_bytes(self, *, limit):
        return _file_bytes(self.db, self.edition_id, self.name, limit)


class _EditionFiles:
    """Supply the common reader with original bytes already in this warehouse."""

    def __init__(self, db, edition):
        self.db, self.edition_id = db, edition["edition_id"]
        self.native = edition["source"]["native"]

    def file(self, name):
        return _EditionFile(self.db, self.edition_id, name)


def _mapped(receiving, columns):
    if receiving is None:
        return None
    return sql_descriptor(receiving, [column["source"] for column in columns],
                          [column["name"] for column in columns])


def delivery_fields(delivery, manifest, columns, *, document=False):
    receiving = read_delivery_semantics(delivery, manifest=manifest)
    if receiving is None:
        return {}
    result = {"semantics": _mapped(receiving, columns)}
    if document:
        result["semantic_dictionary"] = receiving["document"]
    return result


def edition_context(db, edition):
    """Read the original checked document without reopening a source directory."""
    original = _file_bytes(db, edition["edition_id"], "manifest.json", 4 * 1024 * 1024)
    manifest = parse(original)
    _require(digest(original) == edition["manifest_sha256"]
             and same_json(manifest, edition["source"]["manifest"]),
             "DUCKDB_RETAINED_SEMANTIC_MANIFEST_CHANGED")
    receiving = read_delivery_semantics(_EditionFiles(db, edition), manifest=manifest)
    if receiving is None:
        _require(edition.get("semantics") is None, "DUCKDB_RETAINED_SEMANTICS_MISSING")
        return None
    descriptor = _mapped(receiving, edition["columns"])
    if edition.get("semantics") is not None:
        _require(same_json(edition["semantics"], descriptor),
                 "DUCKDB_RETAINED_SEMANTIC_MAPPING_CHANGED")
    return {**sql_context(receiving["bytes"], descriptor, edition["edition_id"]),
            "edition_id": edition["edition_id"]}


def edition_fields(db, edition):
    context = edition_context(db, edition)
    if context is None:
        return edition
    return {**edition,
            "semantics": {key: value for key, value in context.items()
                          if key not in {"document", "version_id", "edition_id"}},
            "semantic_dictionary": context["document"]}


def dictionary_bytes(db, edition):
    context = edition_context(db, edition)
    if context is None:
        return None
    return _file_bytes(db, edition["edition_id"], "semantics.json", MAX_BYTES)


def _record(db, edition_id):
    _require(isinstance(edition_id, str) and _HEX.fullmatch(edition_id),
             "DUCKDB_ID_INVALID")
    row = db.execute("SELECT record FROM sf_editions WHERE id=?", [edition_id]).fetchone()
    _require(row is not None, "DUCKDB_RECORD_NOT_FOUND")
    result = parse(row[0].encode())
    _require(result.get("edition_id") == edition_id, "DUCKDB_RETAINED_EDITION_CHANGED")
    return result


def query_context(db, sql, views):
    """Resolve imported relations with the native parser in the query transaction."""
    try:
        required = sorted(db.get_table_names(sql))
    except Exception as error:
        # Parameterized relation functions can require their actual execution.
        # They remain valid queries; do not substitute unrelated view definitions.
        if not type(error).__module__.startswith(("_duckdb", "duckdb")):
            raise
        return {"schema": CONTEXT_SCHEMA, "scope": "REFERENCED_SOURCE_EDITIONS",
                "resolved": False, "relations": [], "unmapped_relations": [], "editions": []}
    by_name = {view["name"].casefold(): view["edition_id"] for view in views}
    selected, unmapped = {}, []
    for name in required:
        folded = name.casefold()
        edition_id = by_name.get(folded)
        if edition_id is None and folded.startswith("sf_edition_"):
            suffix = folded[len("sf_edition_"):]
            if _HEX.fullmatch(suffix):
                edition_id = suffix
        if edition_id is None:
            unmapped.append(name)
        else:
            selected.setdefault(edition_id, []).append(name)
    editions = []
    for edition_id, names in sorted(selected.items()):
        edition = _record(db, edition_id)
        context = edition_context(db, edition)
        descriptor = ({key: value for key, value in context.items()
                       if key not in {"document", "version_id", "edition_id"}}
                      if context is not None else None)
        editions.append({"edition_id": edition_id, "relations": names,
                         "manifest_sha256": edition["manifest_sha256"],
                         "semantics": descriptor})
    return {"schema": CONTEXT_SCHEMA, "scope": "REFERENCED_SOURCE_EDITIONS",
            "resolved": True, "relations": required,
            "unmapped_relations": unmapped, "editions": editions}


def export_dictionaries(db, context, directory):
    """Receive exact dictionaries for the retained original query execution."""
    _require(isinstance(context, dict) and context.get("schema") == CONTEXT_SCHEMA
             and isinstance(context.get("editions"), list),
             "DUCKDB_QUERY_SEMANTIC_CONTEXT_INVALID")
    files, editions = [], []
    for source in context["editions"]:
        edition = _record(db, source.get("edition_id"))
        checked = edition_context(db, edition)
        descriptor = ({key: value for key, value in checked.items()
                       if key not in {"document", "version_id", "edition_id"}}
                      if checked is not None else None)
        _require(edition["manifest_sha256"] == source.get("manifest_sha256")
                 and same_json(descriptor, source.get("semantics")),
                 "DUCKDB_QUERY_SEMANTIC_SOURCE_CHANGED")
        if checked is None:
            editions.append(source)
            continue
        member = "source-meanings/" + edition["edition_id"] + ".json"
        target = directory / member
        private_directory(target.parent)
        raw = _file_bytes(db, edition["edition_id"], "semantics.json", MAX_BYTES)
        if target.exists():
            _require(read(target, MAX_BYTES) == raw, "DUCKDB_QUERY_DICTIONARY_CHANGED")
        else:
            write(target, raw, exclusive=True)
        file = {"name": member, "path": str(target), "bytes": len(raw),
                "sha256": digest(raw), "mime": "application/json"}
        files.append(file)
        editions.append({**source, "dictionary_file": member})
    return {**context, "editions": editions}, files


def compare_contexts(before, after, before_columns, after_columns):
    def fields(context, columns):
        if context is None:
            return {}
        definitions = {column["name"]: column for column in context["document"]["columns"]}
        return {column["source"]: {
                    "source": column["source"], "column": column["name"],
                    "type": column["type"], "nullable": column["nullable"],
                    "definition": definitions[column["source"]],
                } for column in columns}

    first, second = fields(before, before_columns), fields(after, after_columns)
    changed = [{"source": name, "before": first[name], "after": second[name]}
               for name in sorted(first.keys() & second.keys())
               if not same_json(first[name], second[name])]
    def compact(context):
        return ({key: value for key, value in context.items() if key != "document"}
                if context is not None else None)
    def value(context, key):
        return context["document"].get(key) if context is not None else None
    return {
        "schema": "stellar-forge.duckdb-meaning-comparison.v1",
        "before": compact(before), "after": compact(after),
        "definition_changed": (before or {}).get("definition_sha256") != (after or {}).get("definition_sha256"),
        "capture_changed": (before or {}).get("capture_manifest_sha256") != (after or {}).get("capture_manifest_sha256"),
        "mapping_changed": not same_json(before_columns, after_columns),
        "columns": {"added": [second[name] for name in sorted(second.keys() - first.keys())],
                    "removed": [first[name] for name in sorted(first.keys() - second.keys())],
                    "changed": changed},
        "primary_key_changed": not same_json(value(before, "primaryKey"), value(after, "primaryKey")),
        "observation_uri_changed": not same_json(value(before, "aboutUrl"), value(after, "aboutUrl")),
        "virtual_columns_changed": not same_json(value(before, "virtualColumns"), value(after, "virtualColumns")),
    }
