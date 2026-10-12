"""MIT. Streaming original directory records, exact references and immutable edition indices."""
from __future__ import annotations
from collections import Counter
from contextlib import contextmanager
import csv
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import sqlite3
from urllib.parse import quote, urljoin, urlsplit
import zipfile
import stat
from directory_runtime import InputError, original_workspace, fhir
from directory_source_schema import (
    INDEX_SCHEMA, MAX_BYTES, MAX_RECORD, MAX_INTERACTIVE, MAX_ROWS, MAX_EDITION_ROWS,
    MAX_EDGES, MAX_MEMBERS, standards, sha, jbytes, json_value, lexical_json,
    scalar_id, json_types, descriptor_ref, integer)
from eltss_source import JSONReader, member_name, pointer
from eltss_graph import references, rest_base

_COLUMNS = "source_id,record_id,protocol,table_name,native_id,identity_key,resource_sha,body,metadata,search"
SCHEMA = """
 PRAGMA journal_mode=OFF;
 PRAGMA synchronous=OFF;
 PRAGMA temp_store=FILE;
 PRAGMA cache_size=-2048;
 PRAGMA max_page_count=65536;
 CREATE TABLE records(source_id TEXT NOT NULL,record_id TEXT NOT NULL,protocol TEXT NOT NULL,
   table_name TEXT NOT NULL,native_id TEXT,identity_key TEXT,resource_sha TEXT NOT NULL,
   body TEXT NOT NULL,metadata TEXT NOT NULL,search TEXT NOT NULL,PRIMARY KEY(source_id,record_id));
 CREATE INDEX native_identity ON records(identity_key);
 CREATE INDEX record_tables ON records(table_name);
 CREATE TABLE aliases(alias TEXT NOT NULL,source_id TEXT NOT NULL,record_id TEXT NOT NULL,
   PRIMARY KEY(alias,source_id,record_id));
 CREATE INDEX alias_target ON aliases(source_id,record_id);
 CREATE TABLE links(link_id TEXT NOT NULL,source_id TEXT NOT NULL,record_id TEXT NOT NULL,
   target_alias TEXT,target_record TEXT,body TEXT NOT NULL,PRIMARY KEY(source_id,link_id));
 CREATE INDEX links_from ON links(source_id,record_id);
 CREATE TABLE resolved_targets(source_id TEXT NOT NULL,link_id TEXT NOT NULL,
   target_source TEXT NOT NULL,target_record TEXT NOT NULL,
   PRIMARY KEY(source_id,link_id,target_source,target_record));
 CREATE TABLE resolutions(source_id TEXT NOT NULL,link_id TEXT NOT NULL,state TEXT NOT NULL,
   candidates INTEGER NOT NULL,PRIMARY KEY(source_id,link_id));
 CREATE INDEX resolution_state ON resolutions(state);
 CREATE TABLE documents(name TEXT PRIMARY KEY,body TEXT NOT NULL);
 CREATE TABLE summary(key TEXT PRIMARY KEY,body TEXT NOT NULL);
"""


@contextmanager
def open_index(path):
    path = Path(path)
    original_workspace.regular(path, MAX_BYTES)
    db = sqlite3.connect("file:" + quote(str(path), safe="/") + "?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    try:
        db.execute("PRAGMA query_only=ON")
        db.execute("PRAGMA cache_size=-2048")
        yield db
    finally:
        db.close()


def _create(path):
    path = Path(path)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    os.close(fd)
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    db.executescript(SCHEMA)
    return db


def _finish(db, path, summary):
    db.execute("INSERT INTO summary VALUES('summary',?)", (jbytes(summary).decode(),))
    db.commit()
    db.close()
    if Path(path).stat().st_size > MAX_BYTES:
        raise InputError("The complete derived directory index exceeds its 256 MiB supported budget")
    with Path(path).open("rb") as stream:
        os.fsync(stream.fileno())
    return summary


def _record(row, source_id=None, include_content=True):
    value = json_value(row["metadata"])
    value["sourceId"] = source_id if source_id is not None else row["source_id"]
    value["ref"] = descriptor_ref(value)
    if include_content:
        data = json_value(row["body"], lexical=True)
        value["data"] = data
        value["json"] = row["body"]
        value["numericTokens"] = [{"pointer": p, "token": t} for p, t in json_types(data)]
    return value


def page(db, *, offset=0, limit=50, table=None, query="", source_id=None):
    offset = integer(offset, 0, 10000000, "Directory row offset")
    limit = integer(limit, 1, 250, "Directory row limit")
    where, args = [], []
    if table is not None:
        fhir.text(table, "Exact directory table", 128, False)
        where.append("table_name=?")
        args.append(table)
    if query:
        fhir.text(query, "Literal directory row search", 512)
        where.append("instr(search,?)>0")
        args.append(query.casefold())
    suffix = " WHERE " + " AND ".join(where) if where else ""
    total = db.execute("SELECT count(*) FROM records" + suffix, args).fetchone()[0]
    items, size = [], 0
    sql = "SELECT * FROM records" + suffix + " ORDER BY table_name,source_id,rowid LIMIT ? OFFSET ?"
    for row in db.execute(sql, [*args, limit, offset]):
        value = _record(row, source_id)
        count = len(jbytes(value))
        if count > MAX_INTERACTIVE:
            value = _record(row, source_id, False)
            value.pop("cells", None)
            value.pop("headers", None)
            value["contentOmitted"] = "Use the exact complete original member or record document"
            count = len(jbytes(value))
        if items and size + count > MAX_INTERACTIVE:
            break
        if count > MAX_INTERACTIVE:
            raise InputError("A directory row descriptor exceeds the interactive limit; open the complete source")
        items.append(value)
        size += count
    return {"rows": items, "total": total, "offset": offset, "limit": limit,
        "nextOffset": offset + len(items) if offset + len(items) < total else None,
        "bytes": size, "byteBudget": MAX_INTERACTIVE}


def one(db, record_id, source_id=None, output_source_id=None):
    args = [fhir.identity(record_id)]
    where = "record_id=?"
    if source_id is not None:
        where += " AND source_id=?"
        args.append(fhir.identity(source_id))
    rows = db.execute("SELECT * FROM records WHERE " + where + " LIMIT 2", args).fetchall()
    if not rows:
        raise InputError("Unknown exact directory source record")
    if len(rows) != 1:
        raise InputError("Select the original source ID as well as the retained row identity")
    return _record(rows[0], output_source_id)


def _alias(protocol, table, value, namespace=""):
    return protocol + "\0" + namespace + "\0" + table + "\0" + value


def _json_issue(value, table, csv_input=False):
    schema = standards()["tables"][table]["schema"]
    props = schema["properties"]
    issues = []
    if not isinstance(value, dict):
        return [{"kind": "type", "pointer": "", "expected": "object"}]
    required = list(schema.get("required", []))
    if csv_input:
        required += schema.get("tabular_required", [])
    for key in dict.fromkeys(required):
        if key not in value or csv_input and value[key] == "":
            issues.append({"kind": "required", "pointer": pointer([key]), "field": key})
    for key, v in value.items():
        spec = props.get(key)
        if not spec:
            continue  # Original extension values are retained without inventing a rejection.
        if csv_input and v == "":
            continue
        expected = spec.get("type")
        good = True
        if not csv_input:
            good = {"string": type(v) is str, "number": isinstance(v, (fhir.Number, int, float)) and type(v) is not bool,
                "array": isinstance(v, list), "object": isinstance(v, dict),
                "boolean": type(v) is bool}.get(expected, True)
        elif expected == "number":
            good = bool(re.fullmatch(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?", v))
        if not good:
            issues.append({"kind": "type", "pointer": pointer([key]), "expected": expected})
        if "enum" in spec and v not in spec["enum"]:
            issues.append({"kind": "enum", "pointer": pointer([key]), "allowed": spec["enum"]})
        if spec.get("format") == "uuid" and (type(v) is not str or not re.fullmatch(
                r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", v)):
            issues.append({"kind": "uuid", "pointer": pointer([key])})
    return issues


class IndexBuilder:
    def __init__(self, path, reference_base=None, max_records=MAX_ROWS):
        self.path, self.db = Path(path), _create(path)
        self.reference_base, self.max_records = reference_base, max_records
        self.count, self.edge_count = 0, 0
        self.counts, self.issue_counts = Counter(), Counter()
        self.documents, self.member = [], None

    def close(self):
        self.db.close()

    def document(self, member, selection, stream):
        self.member = member
        before = self.count
        fmt = selection["format"]
        if fmt == "hsds-json":
            header = self.hsds_document(stream, selection["table"] if selection.get("layout") != "tables" else None,
                                        selection.get("layout", "entity"))
        elif fmt == "hsds-csv":
            header = self.csv_document(stream, selection["table"], selection.get("encoding", "utf-8-sig"),
                                       selection.get("delimiter", ","))
        elif fmt == "fhir-json":
            header = self.fhir_document(stream)
        else:
            raise InputError("Unsupported selected original document format")
        description = {**member, "selection": selection, "indexedRecords": self.count - before, "header": header}
        if len(jbytes(description)) > MAX_RECORD:
            raise InputError("Original document header exceeds the supported metadata budget")
        self.db.execute("INSERT INTO documents VALUES(?,?)", (member["name"], jbytes(description).decode()))
        self.documents.append({k: v for k, v in description.items() if k != "header"})
        return description

    def add(self, value, table, protocol, locator, *, raw=None, raw_range=None, parent=None,
            headers=None, cells=None, extra=None):
        self.count += 1
        if self.count > self.max_records:
            raise InputError("Complete selected directory source exceeds the reviewed record limit")
        body = lexical_json(value)
        if len(body.encode()) > MAX_RECORD:
            raise InputError("One complete directory record exceeds 16 MiB")
        digest = sha(body.encode())
        row_sha = sha(raw) if raw is not None else digest
        native_id = scalar_id(value.get("id")) if isinstance(value, dict) else None
        record_id = sha(jbytes({"memberSha256": self.member["sha256"], "memberName": self.member["name"],
            "pointer": locator, "rowSha256": row_sha, "ordinal": self.count}))
        name = value.get("name", value.get("title", "")) if isinstance(value, dict) else ""
        if not isinstance(name, str):
            name = lexical_json(name)
        extra = extra or {}
        namespace = extra.get("referenceBase", "") if protocol == "fhir-hsd" else ""
        if extra.get("containedIn"):
            namespace += "#" + extra["containedIn"]
        key = _alias(protocol, table, native_id, namespace or "") if native_id is not None else None
        issues = _json_issue(value, table, headers is not None) if protocol == "hsds" else []
        if protocol == "fhir-hsd":
            if not isinstance(value, dict) or value.get("resourceType") != table:
                issues.append({"kind": "resourceType", "pointer": "/resourceType"})
            if native_id is not None and not re.fullmatch(r"[A-Za-z0-9.-]{1,64}", native_id):
                issues.append({"kind": "logical-id", "pointer": "/id"})
        if native_id is None:
            issues.append({"kind": "missing-native-id", "pointer": "/id"})
        metadata = {"recordId": record_id, "table": table, "protocol": protocol,
            "rowOrdinal": self.count, "recordOrdinal": self.count, "nativeId": native_id, "identityKey": key,
            "pointer": locator, "memberName": self.member["name"], "memberSha256": self.member["sha256"],
            "rowSha256": row_sha, "resourceSha256": digest, "parentRecordId": parent,
            "label": name[:4096], "observations": issues, "rawRange": raw_range,
            "representation": "original-range" if raw is not None else "derived-exact-values", **extra}
        if headers is not None:
            metadata.update({"headers": headers, "cells": cells})
        metadata["comparisonSha256"] = sha(jbytes({"resourceSha256": digest, "headers": headers, "cells": cells,
            "fullUrl": extra.get("fullUrl")}))
        self.db.execute("INSERT INTO records VALUES(?,?,?,?,?,?,?,?,?,?)", ("", record_id, protocol, table,
            native_id, key, digest, body, jbytes(metadata).decode(), body.casefold()))
        if key is not None:
            self.alias(key, record_id)
        self.counts[table] += 1
        self.issue_counts.update(i["kind"] for i in issues)
        if self.count % 100 == 0:
            self.budget()
        return metadata

    def alias(self, value, record_id):
        self.db.execute("INSERT OR IGNORE INTO aliases VALUES(?,?,?)", (value, "", record_id))

    def link(self, record, path, kind, *, target_alias=None, target_record=None, **details):
        self.edge_count += 1
        if self.edge_count > MAX_EDGES:
            raise InputError("Complete directory reference index exceeds 500,000 edges")
        value = {"recordId": record["recordId"], "pointer": path, "kind": kind, **details}
        lid = sha(jbytes({**value, "targetAlias": target_alias, "targetRecordId": target_record}))
        self.db.execute("INSERT INTO links VALUES(?,?,?,?,?,?)",
            (lid, "", record["recordId"], target_alias, target_record, jbytes({**value, "id": lid}).decode()))

    def hsds(self, value, table, locator, raw=None, span=None, parent=None):
        row = self.add(value, table, "hsds", locator, raw=raw, raw_range=span, parent=parent)
        if not isinstance(value, dict):
            return row
        rules = standards()["tables"][table]
        seen_fk = set()
        for foreign in rules["tabular"]["schema"].get("foreignKeys", []):
            fields, target = foreign.get("fields"), foreign.get("reference", {})
            names = fields if isinstance(fields, list) else [fields]
            values = [value.get(n) for n in names]
            signature = lexical_json(foreign)
            if signature in seen_fk:
                continue
            seen_fk.add(signature)
            if all(type(v) is str and v != "" for v in values) and len(names) == 1:
                self.link(row, pointer(names), "hsds-foreign-key",
                    target_alias=_alias("hsds", target["resource"], values[0]),
                    targetTable=target["resource"], nativeValue=values[0], sourceFields=names,
                    schemaLocator="datapackage.json#/resources/" + table + "/schema/foreignKeys")
        for key, spec in rules["schema"]["properties"].items():
            if key not in value:
                continue
            related = spec.get("$ref") or spec.get("items", {}).get("$ref")
            if not related:
                continue
            target = related.rsplit("/", 1)[-1].removesuffix(".json")
            if target not in standards()["tables"]:
                continue
            children = list(enumerate(value[key])) if isinstance(value[key], list) else [(None, value[key])]
            for n, child in children:
                if not isinstance(child, dict):
                    continue
                suffix = "/" + key.replace("~", "~0").replace("/", "~1") + ("/" + str(n) if n is not None else "")
                derived = self.hsds(child, target, locator + suffix, parent=row["recordId"])
                self.link(row, suffix, "hsds-nested", target_record=derived["recordId"], targetTable=target)
        return row

    def _array(self, reader, consume):
        reader.take(91)
        reader.space()
        count = 0
        if reader.peek() != 93:
            while True:
                raw, value, start, end = reader.raw(MAX_RECORD)
                consume(value, count, raw, [start, end])
                count += 1
                reader.space()
                if reader.peek() == 93:
                    break
                reader.take(44)
        reader.take(93)
        return count

    def hsds_document(self, stream, table, layout):
        reader = JSONReader(stream, MAX_BYTES)
        header = {}
        if layout == "entity":
            raw, value, start, end = reader.raw(MAX_RECORD)
            self.hsds(value, table, "", raw, [start, end])
        elif layout == "array":
            header["records"] = self._array(reader, lambda v, n, raw, span: self.hsds(v, table, "/" + str(n), raw, span))
        elif layout in {"page", "tables"}:
            reader.take(123)
            keys = set()
            reader.space()
            if reader.peek() != 125:
                while True:
                    _, key, _, _ = reader.raw(65536)
                    if type(key) is not str or key in keys:
                        raise InputError("Original directory JSON has a duplicate or non-text object key")
                    keys.add(key)
                    reader.take(58)
                    if layout == "page" and key == "contents":
                        header["records"] = self._array(reader, lambda v, n, raw, span: self.hsds(
                            v, table, "/contents/" + str(n), raw, span))
                    elif layout == "tables":
                        known = {n: n for n in standards()["tables"]}
                        known.update({t["schema"]["path"]: n for n, t in standards()["tables"].items()})
                        if key in known:
                            self._array(reader, lambda v, n, raw, span, k=key: self.hsds(
                                v, known[k], "/" + k.replace("~", "~0").replace("/", "~1") + "/" + str(n), raw, span))
                        else:
                            _, value, _, _ = reader.raw(MAX_RECORD)
                            header[key] = value
                    else:
                        _, value, _, _ = reader.raw(MAX_RECORD)
                        header[key] = value
                    if len(lexical_json(header).encode()) > MAX_RECORD:
                        raise InputError("Original directory header exceeds its supported complete metadata budget")
                    reader.space()
                    if reader.peek() == 125:
                        break
                    reader.take(44)
            reader.take(125)
            if layout == "page" and "contents" not in keys:
                raise InputError("Selected HSDS page has no original contents array")
        else:
            raise InputError("Unknown explicitly selected HSDS JSON layout")
        reader.space()
        if reader.peek() is not None:
            raise InputError("Additional bytes follow the complete original directory JSON")
        return header

    def csv_document(self, stream, table, encoding, delimiter):
        if encoding not in {"utf-8", "utf-8-sig", "cp1252"} or len(delimiter) != 1 or delimiter in "\r\n\0":
            raise InputError("Choose a supported original CSV encoding and delimiter")
        csv.field_size_limit(MAX_RECORD)
        class Lines:
            def __init__(self):
                self.line, self.offset, self.parts = 0, 0, []
                self.pending, self.eof = b"", False
            def __iter__(self):
                return self
            def __next__(self):
                while True:
                    match = re.search(rb"\r\n|\r|\n", self.pending)
                    if match and not (match.group() == b"\r" and match.end() == len(self.pending) and not self.eof):
                        raw, self.pending = self.pending[:match.end()], self.pending[match.end():]
                        break
                    if self.eof:
                        raw, self.pending = self.pending, b""
                        break
                    block = stream.read(65536)
                    if not block:
                        self.eof = True
                    self.pending += block
                    if len(self.pending) > MAX_RECORD + 65536:
                        raise InputError("One original physical CSV line exceeds 16 MiB")
                if not raw:
                    raise StopIteration
                if len(raw) > MAX_RECORD or sum(map(len, self.parts)) + len(raw) > MAX_RECORD:
                    raise InputError("One original logical CSV record exceeds 16 MiB")
                self.parts.append(raw)
                self.line += 1
                self.offset += len(raw)
                if self.offset > MAX_BYTES:
                    raise InputError("Original CSV exceeds 256 MiB")
                selected = encoding if self.line == 1 or encoding != "utf-8-sig" else "utf-8"
                try:
                    return raw.decode(selected)
                except UnicodeError as error:
                    raise InputError("Original CSV does not match the reviewed encoding") from error
        lines = Lines()
        reader = csv.reader(lines, delimiter=delimiter, strict=True)
        try:
            headers = next(reader)
        except StopIteration as error:
            raise InputError("Original CSV needs its complete header row") from error
        except csv.Error as error:
            raise InputError("Original CSV header has incomplete or invalid quoting") from error
        duplicate = [key for key, count in Counter(headers).items() if count > 1]
        header_info = {"headers": headers, "headerBytes": lines.offset, "headerSha256": sha(b"".join(lines.parts)),
            "duplicateHeaders": duplicate, "blankHeaderPositions": [n for n, key in enumerate(headers) if key == ""],
            "encoding": encoding, "delimiter": delimiter}
        ordinal = 0
        try:
            while True:
                lines.parts = []
                start_line, start_byte = lines.line + 1, lines.offset
                try:
                    cells = next(reader)
                except StopIteration:
                    break
                ordinal += 1
                raw = b"".join(lines.parts)
                # Duplicate and blank headers remain in the exact ordered cells.
                # Only unambiguous named columns enter the convenience object.
                data = {h: cells[n] for n, h in enumerate(headers)
                    if h and h not in duplicate and n < len(cells)}
                row = self.add(data, table, "hsds", "/rows/" + str(ordinal), raw=raw,
                    raw_range=[start_byte, lines.offset], headers=headers, cells=cells,
                    extra={"rowOrdinal": ordinal, "logicalRowOrdinal": ordinal, "lineStart": start_line, "lineEnd": lines.line,
                        "duplicateHeaders": duplicate, "ragged": len(cells) != len(headers)})
                # The field descriptors are source-native; do not infer unnamed/ambiguous IDs.
                seen = set()
                for foreign in standards()["tables"][table]["tabular"]["schema"].get("foreignKeys", []):
                    key = foreign.get("fields")
                    if not isinstance(key, str) or key in seen:
                        continue
                    target, val = foreign.get("reference", {}), data.get(key)
                    signature = (key, target.get("resource"), target.get("fields"))
                    if signature in seen:
                        continue
                    seen.add(signature)
                    if type(val) is str and val != "":
                        self.link(row, pointer([key]), "hsds-foreign-key",
                            target_alias=_alias("hsds", target["resource"], val),
                            targetTable=target["resource"], nativeValue=val, sourceFields=[key])
        except csv.Error as error:
            raise InputError("Original CSV has an incomplete or invalid quoted logical record") from error
        header_info["logicalRecords"] = ordinal
        return header_info

    def fhir_resource(self, value, locator, raw=None, span=None, full_url=None, parent=None,
                      contained_in=None, root=None, inherited_base=None):
        if not isinstance(value, dict) or type(value.get("resourceType")) is not str:
            raise InputError("Selected FHIR resource must retain its original resourceType")
        table, native = value["resourceType"], scalar_id(value.get("id"))
        if not re.fullmatch(r"[A-Z][A-Za-z0-9]{0,63}", table):
            raise InputError("Original FHIR resourceType has invalid syntax")
        if full_url is not None and type(full_url) is not str:
            raise InputError("Original FHIR entry.fullUrl must be a string when present")
        base = rest_base(full_url, table, native) if full_url and native else None
        base = base or inherited_base or self.reference_base
        extra = {"fullUrl": full_url, "referenceBase": base, "containedIn": contained_in,
            "versionId": value.get("meta", {}).get("versionId") if isinstance(value.get("meta"), dict) else None,
            "lastUpdated": value.get("meta", {}).get("lastUpdated") if isinstance(value.get("meta"), dict) else None}
        row = self.add(value, table, "fhir-hsd", locator, raw=raw, raw_range=span, parent=parent, extra=extra)
        root = root or row["recordId"]
        if native:
            if contained_in:
                self.alias("contained\0" + contained_in + "\0" + native, row["recordId"])
            else:
                local = "local\0" + self.member["sha256"] + "\0" + table + "/" + native
                self.alias(local, row["recordId"])
                if base:
                    self.alias("uri\0" + base.rstrip("/") + "/" + table + "/" + native, row["recordId"])
                if full_url:
                    self.alias("uri\0" + full_url, row["recordId"])
                if base and type(extra.get("versionId")) is str:
                    self.alias("uri\0" + base.rstrip("/") + "/" + table + "/" + native + "/_history/" + extra["versionId"], row["recordId"])
        elif full_url:
            self.alias("uri\0" + full_url, row["recordId"])
        for ref in references(value):
            literal = ref.get("reference")
            target = None
            if ref["kind"] == "literal" and literal:
                if literal.startswith("#"):
                    target = "contained\0" + root + "\0" + literal[1:]
                elif urlsplit(literal).scheme:
                    target = "uri\0" + literal
                elif re.fullmatch(r"[A-Z][A-Za-z0-9]+/[A-Za-z0-9.-]+(?:/_history/[A-Za-z0-9.-]+)?", literal):
                    target = "uri\0" + base.rstrip("/") + "/" + literal if base else \
                        "local\0" + self.member["sha256"] + "\0" + literal
            self.link(row, pointer(ref["path"]), "fhir-reference", target_alias=target,
                reference=literal, referenceKind=ref["kind"], referenceType=ref.get("referenceType"),
                identifierJson=ref.get("identifierJson"), display=ref.get("display"))
        for n, child in enumerate(value.get("contained", [])):
            if isinstance(child, dict):
                self.fhir_resource(child, locator + "/contained/" + str(n), parent=row["recordId"],
                    contained_in=root, root=root, inherited_base=base)
        if table == "Bundle":
            for n, entry in enumerate(value.get("entry", [])):
                if isinstance(entry, dict) and isinstance(entry.get("resource"), dict):
                    self.fhir_resource(entry["resource"], locator + "/entry/" + str(n) + "/resource",
                        full_url=entry.get("fullUrl"), parent=row["recordId"], inherited_base=base)
        return row

    def fhir_document(self, stream):
        reader = JSONReader(stream, MAX_BYTES)
        header, keys, entries = {}, set(), 0
        reader.take(123)
        reader.space()
        while reader.peek() != 125:
            _, key, _, _ = reader.raw(65536)
            if type(key) is not str or key in keys:
                raise InputError("Original FHIR object has a duplicate or invalid key")
            keys.add(key)
            reader.take(58)
            if key == "entry":
                def receive(entry, n, raw, span):
                    if not isinstance(entry, dict):
                        raise InputError("Original Bundle entry must be an object")
                    if isinstance(entry.get("resource"), dict):
                        self.fhir_resource(entry["resource"], "/entry/" + str(n) + "/resource",
                            full_url=entry.get("fullUrl"))
                    else:
                        self.issue_counts["entry-without-resource"] += 1
                entries = self._array(reader, receive)
            else:
                _, value, _, _ = reader.raw(MAX_RECORD)
                header[key] = value
                if len(lexical_json(header).encode()) > MAX_RECORD:
                    raise InputError("Complete original FHIR metadata exceeds 16 MiB")
            reader.space()
            if reader.peek() != 125:
                reader.take(44)
        reader.take(125)
        reader.space()
        if reader.peek() is not None:
            raise InputError("Additional bytes follow the complete original FHIR document")
        if header.get("resourceType") == "Bundle":
            if type(header.get("type")) is not str:
                raise InputError("Original FHIR Bundle must retain its type")
        else:
            if "entry" in keys:
                raise InputError("Original entry array requires a FHIR Bundle")
            stream.seek(0)
            raw = stream.read(MAX_RECORD + 1)
            if len(raw) > MAX_RECORD:
                raise InputError("One original non-Bundle FHIR resource exceeds 16 MiB")
            self.fhir_resource(header, "", raw=raw, span=[0, len(raw)])
        return {**header, "indexedEntries": entries}

    def budget(self):
        pages = self.db.execute("PRAGMA page_count").fetchone()[0]
        size = self.db.execute("PRAGMA page_size").fetchone()[0]
        if pages * size > MAX_BYTES:
            raise InputError("Complete derived directory index exceeds 256 MiB")

    def finish(self):
        resolve_links(self.db)
        summary = summary_index(self.db)
        summary.update({"schema": INDEX_SCHEMA, "documents": self.documents,
            "structuralObservations": dict(self.issue_counts),
            "conformance": "structural-observations-only"})
        return _finish(self.db, self.path, summary)


def resolve_links(db):
    db.execute("DELETE FROM resolved_targets")
    db.execute("DELETE FROM resolutions")
    for row in db.execute("SELECT * FROM links ORDER BY source_id,link_id"):
        if row["target_record"]:
            db.execute("""INSERT OR IGNORE INTO resolved_targets
                SELECT ?,?,source_id,record_id FROM records WHERE source_id=? AND record_id=?""",
                (row["source_id"], row["link_id"], row["source_id"], row["target_record"]))
        elif row["target_alias"]:
            db.execute("""INSERT OR IGNORE INTO resolved_targets
                SELECT ?,?,source_id,record_id FROM aliases WHERE alias=?""",
                (row["source_id"], row["link_id"], row["target_alias"]))
        count = db.execute("SELECT count(*) FROM resolved_targets WHERE source_id=? AND link_id=?",
            (row["source_id"], row["link_id"])).fetchone()[0]
        state = "resolved" if count == 1 else "ambiguous" if count > 1 else "unresolved"
        if not row["target_alias"] and not row["target_record"]:
            state = "not-resolvable"
        db.execute("INSERT INTO resolutions VALUES(?,?,?,?)", (row["source_id"], row["link_id"], state, count))


def summary_index(db):
    counts = dict(db.execute("SELECT table_name,count(*) FROM records GROUP BY table_name"))
    duplicates = db.execute("""SELECT count(*) FROM
        (SELECT identity_key FROM records WHERE identity_key IS NOT NULL GROUP BY identity_key HAVING count(*)>1)""").fetchone()[0]
    return {"records": sum(counts.values()), "tables": counts,
        "missingNativeIds": db.execute("SELECT count(*) FROM records WHERE native_id IS NULL").fetchone()[0],
        "duplicateNativeIdentities": duplicates,
        "references": dict(db.execute("SELECT state,count(*) FROM resolutions GROUP BY state"))}


def links_page(db, *, offset=0, limit=50, record_id=None):
    offset = integer(offset, 0, 10000000, "Reference offset")
    limit = integer(limit, 1, 250, "Reference limit")
    args, where = [], ""
    if record_id is not None:
        args, where = [fhir.identity(record_id)], " WHERE l.record_id=?"
    total = db.execute("SELECT count(*) FROM links l" + where, args).fetchone()[0]
    output, size = [], 0
    for row in db.execute("""SELECT l.*,r.state,r.candidates FROM links l JOIN resolutions r
        ON r.source_id=l.source_id AND r.link_id=l.link_id""" + where +
        " ORDER BY l.source_id,l.link_id LIMIT ? OFFSET ?", [*args, limit, offset]):
        value = json_value(row["body"])
        value.update({"sourceId": row["source_id"], "state": row["state"], "candidateCount": row["candidates"]})
        value["candidates"] = [{"sourceId": r[0], "recordId": r[1]} for r in db.execute(
            "SELECT target_source,target_record FROM resolved_targets WHERE source_id=? AND link_id=? ORDER BY target_source,target_record LIMIT 25",
            (row["source_id"], row["link_id"]))]
        value["candidatesTruncated"] = row["candidates"] > 25
        count = len(jbytes(value))
        if output and size + count > MAX_INTERACTIVE:
            break
        if count > MAX_INTERACTIVE:
            raise InputError("One complete reference descriptor exceeds the interactive budget")
        output.append(value)
        size += count
    return {"rows": output, "total": total, "offset": offset, "limit": limit,
        "nextOffset": offset + len(output) if offset + len(output) < total else None,
        "bytes": size, "byteBudget": MAX_INTERACTIVE}


def compose_index(path, selected):
    """Copy complete selected records on disk; never accumulate all source rows in RAM."""
    db = _create(path)
    total = 0
    source_summary = []
    try:
        for source_id, index_path, tables in selected:
            with open_index(index_path) as before:
                args, where = [], ""
                if tables:
                    where = " WHERE table_name IN (" + ",".join("?" for _ in tables) + ")"
                    args = list(tables)
                count = before.execute("SELECT count(*) FROM records" + where, args).fetchone()[0]
                total += count
                if total > MAX_EDITION_ROWS:
                    raise InputError("Selected directory edition exceeds 250,000 complete records")
                for row in before.execute("SELECT * FROM records" + where, args):
                    db.execute("INSERT INTO records VALUES(?,?,?,?,?,?,?,?,?,?)",
                        (source_id, *tuple(row)[1:]))
                for alias in before.execute("SELECT * FROM aliases"):
                    if db.execute("SELECT 1 FROM records WHERE source_id=? AND record_id=?",
                            (source_id, alias["record_id"])).fetchone():
                        db.execute("INSERT OR IGNORE INTO aliases VALUES(?,?,?)",
                            (alias["alias"], source_id, alias["record_id"]))
                for link in before.execute("SELECT * FROM links"):
                    if db.execute("SELECT 1 FROM records WHERE source_id=? AND record_id=?",
                            (source_id, link["record_id"])).fetchone():
                        db.execute("INSERT INTO links VALUES(?,?,?,?,?,?)",
                            (link["link_id"], source_id, link["record_id"], link["target_alias"],
                             link["target_record"], link["body"]))
                source_summary.append({"sourceId": source_id, "selectedRecords": count, "tables": list(tables)})
            if db.execute("PRAGMA page_count").fetchone()[0] * 4096 > MAX_BYTES:
                raise InputError("Selected complete edition exceeds its retained index-byte budget")
        resolve_links(db)
        result = summary_index(db)
        result.update({"schema": INDEX_SCHEMA, "sources": source_summary,
            "selectionOrder": [s["sourceId"] for s in source_summary],
            "conformance": "structural-observations-only"})
        return _finish(db, path, result)
    except Exception as error:
        db.close()
        if isinstance(error, sqlite3.DatabaseError):
            raise InputError("Complete directory edition could not fit its supported retained index budget") from error
        raise


def _changed(a, b, path="", maximum=10000):
    output = []
    def walk(before, after, loc):
        if len(output) >= maximum:
            return
        if type(before) is not type(after):
            output.append(loc)
        elif isinstance(before, dict):
            for key in sorted(set(before) | set(after)):
                child = loc + "/" + key.replace("~", "~0").replace("/", "~1")
                if key not in before or key not in after:
                    output.append(child)
                else:
                    walk(before[key], after[key], child)
                if len(output) >= maximum:
                    return
        elif isinstance(before, list):
            for n in range(max(len(before), len(after))):
                child = loc + "/" + str(n)
                if n >= len(before) or n >= len(after):
                    output.append(child)
                else:
                    walk(before[n], after[n], child)
                if len(output) >= maximum:
                    return
        elif before != after:
            output.append(loc)
    walk(a, b, path)
    return output


def _comparison_sha(row):
    return json_value(row["metadata"]).get("comparisonSha256", row["resource_sha"])


def compare_indices(path, before_path, after_path, reviewed_links):
    out = Path(path)
    fd = os.open(out, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    db = sqlite3.connect(out)
    db.row_factory = sqlite3.Row
    db.executescript("""PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA temp_store=FILE;
        PRAGMA cache_size=-2048; PRAGMA max_page_count=65536;
        CREATE TABLE changes(ordinal INTEGER PRIMARY KEY,state TEXT NOT NULL,identity_key TEXT,body TEXT NOT NULL);
        CREATE INDEX change_state ON changes(state);
        CREATE TABLE used(side TEXT NOT NULL,source_id TEXT NOT NULL,record_id TEXT NOT NULL,
            PRIMARY KEY(side,source_id,record_id));
        CREATE TABLE summary(key TEXT PRIMARY KEY,body TEXT NOT NULL);""")
    counts, ordinal = Counter(), 0
    def used(side, row):
        return db.execute("SELECT 1 FROM used WHERE side=? AND source_id=? AND record_id=?",
            (side, row["source_id"], row["record_id"])).fetchone()
    def emit(state, left=None, right=None, reason=None, key=None, candidates=None):
        nonlocal ordinal
        ordinal += 1
        value = {"ordinal": ordinal, "state": state, "identityKey": key,
            "before": _record(left, include_content=False) if left is not None else None,
            "after": _record(right, include_content=False) if right is not None else None,
            "reviewReason": reason}
        if left is not None and right is not None and state == "changed":
            value["changedPointers"] = _changed(json_value(left["body"], lexical=True), json_value(right["body"], lexical=True))
            value["changedPointersTruncated"] = len(value["changedPointers"]) >= 10000
            lm, rm = json_value(left["metadata"]), json_value(right["metadata"])
            value["changedMetadata"] = [k for k in ("headers", "cells", "fullUrl")
                if lm.get(k) != rm.get(k)]
        if candidates is not None:
            value["identityOccurrences"] = candidates
        # Raw ordered cells remain in their source rows, not duplicated in large comparison registers.
        for k in ("before", "after"):
            if value[k]:
                value[k].pop("headers", None)
                value[k].pop("cells", None)
        db.execute("INSERT INTO changes VALUES(?,?,?,?)", (ordinal, state, key, jbytes(value).decode()))
        counts[state] += 1
        for side, row in (("before", left), ("after", right)):
            if row is not None:
                db.execute("INSERT INTO used VALUES(?,?,?)", (side, row["source_id"], row["record_id"]))
    try:
        with open_index(before_path) as before, open_index(after_path) as after:
            for link in reviewed_links:
                l, r = link["before"], link["after"]
                left = before.execute("SELECT * FROM records WHERE source_id=? AND record_id=?",
                    (l["sourceId"], l["recordId"])).fetchone()
                right = after.execute("SELECT * FROM records WHERE source_id=? AND record_id=?",
                    (r["sourceId"], r["recordId"])).fetchone()
                if left is None or right is None:
                    raise InputError("Reviewed comparison link must select an original record in each selected edition")
                if used("before", left) or used("after", right):
                    raise InputError("A reviewed comparison record may participate in only one explicit identity pair")
                emit("unchanged" if _comparison_sha(left) == _comparison_sha(right) else "changed",
                     left, right, link["reason"], left["identity_key"])
            for left in before.execute("SELECT * FROM records ORDER BY table_name,source_id,rowid"):
                if used("before", left):
                    continue
                key = left["identity_key"]
                if key is None:
                    emit("unidentified", left=left)
                    continue
                lc = before.execute("SELECT count(*) FROM records WHERE identity_key=?", (key,)).fetchone()[0]
                rc = after.execute("SELECT count(*) FROM records WHERE identity_key=?", (key,)).fetchone()[0]
                if lc > 1 or rc > 1:
                    emit("ambiguous", left=left, key=key, candidates={"before": lc, "after": rc})
                elif rc == 1:
                    right = after.execute("SELECT * FROM records WHERE identity_key=?", (key,)).fetchone()
                    if used("after", right):
                        emit("only-before", left=left, key=key)
                    else:
                        emit("unchanged" if _comparison_sha(left) == _comparison_sha(right) else "changed",
                             left, right, key=key)
                else:
                    emit("only-before", left=left, key=key)
            for right in after.execute("SELECT * FROM records ORDER BY table_name,source_id,rowid"):
                if used("after", right):
                    continue
                key = right["identity_key"]
                lc = before.execute("SELECT count(*) FROM records WHERE identity_key=?", (key,)).fetchone()[0] if key else 0
                rc = after.execute("SELECT count(*) FROM records WHERE identity_key=?", (key,)).fetchone()[0] if key else 0
                state = "unidentified" if key is None else "ambiguous" if lc > 1 or rc > 1 else "only-after"
                emit(state, right=right, key=key, candidates={"before": lc, "after": rc} if state == "ambiguous" else None)
        result = {"changes": ordinal, "counts": dict(counts), "reviewedPairs": len(reviewed_links),
            "identityRule": "exact protocol, native namespace, table/resource type and native ID; explicit reviewed pairs",
            "absenceMeaning": "Only absent from the other selected edition; not a remote deletion claim"}
        return _finish(db, out, result)
    except Exception as error:
        db.close()
        if isinstance(error, sqlite3.DatabaseError):
            raise InputError("Complete selected directory comparison exceeded its retained index budget") from error
        raise


def changes_page(db, offset=0, limit=50, state=None):
    offset = integer(offset, 0, 10000000, "Change offset")
    limit = integer(limit, 1, 250, "Change limit")
    where, args = (" WHERE state=?", [state]) if state else ("", [])
    if state and state not in {"unchanged", "changed", "only-before", "only-after", "ambiguous", "unidentified"}:
        raise InputError("Unknown directory comparison state")
    total = db.execute("SELECT count(*) FROM changes" + where, args).fetchone()[0]
    output, size = [], 0
    for row in db.execute("SELECT body FROM changes" + where + " ORDER BY ordinal LIMIT ? OFFSET ?", [*args, limit, offset]):
        value = json_value(row[0])
        count = len(jbytes(value))
        if output and size + count > MAX_INTERACTIVE:
            break
        if count > MAX_INTERACTIVE:
            raise InputError("One full change descriptor exceeds the interactive budget; use its complete index file")
        output.append(value)
        size += count
    return {"rows": output, "total": total, "offset": offset, "limit": limit,
        "nextOffset": offset + len(output) if offset + len(output) < total else None,
        "bytes": size, "byteBudget": MAX_INTERACTIVE}
