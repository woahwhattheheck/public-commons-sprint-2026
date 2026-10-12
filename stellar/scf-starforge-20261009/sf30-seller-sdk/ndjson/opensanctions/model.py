"""MIT. OpenSanctions domain over the original NDJSON Workspace and native SF30 engine.

The provider owns entity resolution and screening. This module retains original
editions and source changes, then records the customer's separate identity and
relevance decisions. It never turns a missing record into a legal conclusion.
"""
from __future__ import annotations

from collections import Counter, defaultdict
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import time
import zipfile

NDJSON = Path(__file__).resolve().parent.parent
if str(NDJSON) not in sys.path:
    sys.path.insert(0, str(NDJSON))
import application as ndjson_application
import ndjson_source
from application import InputError, json_bytes, load_json, private_write, file_digest, sync_dir

SCHEMA = "starforge.opensanctions-workspace.v1"
PACKET = "starforge.opensanctions-receiving.v1"
MAX_SOURCE = 256 * 1024 * 1024
SHA = re.compile(r"[0-9a-f]{64}\Z")
DATASET = re.compile(r"[a-z0-9][a-z0-9_-]{0,127}\Z")
VERSION = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")
RESOLUTION = {"same_entity", "different_entity", "undecided"}
RELEVANCE = {"in_scope", "out_of_scope", "undecided"}
MONITORING_DEFAULT = {
    "resolutionProperties": ["name", "alias", "birthDate", "nationality", "passportNumber", "idNumber",
                             "registrationNumber", "taxNumber", "imoNumber", "isin", "gender"],
    "programIds": [], "topics": [], "datasets": [], "reviewConfirmedIdentityChanges": True,
}
DECISIONS = {"review_required", "retain_decision", "source_change_reviewed", "authority_change_confirmed"}
STATEMENT_REQUIRED = {"entity_id", "canonical_id", "dataset", "prop", "value"}
STATEMENT_IDENTITY = ("dataset", "entity_id", "prop", "value", "lang", "origin")
DESIGNATION_FIELDS = {"authority", "authorityId", "unscId", "program", "programId",
                      "provisions", "status", "startDate", "endDate", "listingDate"}
TABLES = {
    "objects": ("id", "body"),
    "editions": ("id", "body"),
    "indexes": ("scope", "entity_id", "line", "ordinal", "raw", "semantic_sha"),
    "aliases": ("scope", "alias", "canonical", "kind"),
    "updates": ("id", "body"),
    "comparisons": ("id", "body"),
    "changes": ("comparison", "id", "entity_id", "kind", "body"),
    "statement_sets": ("id", "body"),
    "statements": ("set_id", "ordinal", "line_start", "line_end", "assertion_key", "raw"),
    "portfolios": ("id", "body"),
    "profiles": ("id", "body"),
    "requests": ("id", "body"),
    "cases": ("id", "body"),
    "case_events": ("id", "case_id", "body"),
    "reviews": ("id", "change_id", "body"),
}

def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def stable(value) -> bytes:
    """Canonical structural comparison; original numeric lexemes remain intact."""
    if isinstance(value, dict):
        value = {k: value[k] for k in sorted(value)}
        return ("{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" +
                               stable(v).decode() for k, v in value.items()) + "}").encode()
    if isinstance(value, list):
        return ("[" + ",".join(stable(v).decode() for v in value) + "]").encode()
    return ndjson_source.exact_json(value).encode()

def text(value, label, limit=1000, blank=False):
    if not isinstance(value, str) or len(value) > limit or "\0" in value or (not blank and not value.strip()):
        raise InputError(f"{label} must be {'0' if blank else '1'}–{limit} characters")
    return value

def exact_id(value):
    if not isinstance(value, str) or not SHA.fullmatch(value):
        raise InputError("Select a complete retained identifier")
    return value

def bounded_int(value, low, high, label):
    if type(value) is not int or not low <= value <= high:
        raise InputError(f"{label} must be an integer from {low} to {high}")
    return value

def ftm_entity(entity, line=None, full=True):
    where = f"Line {line}: " if line is not None else ""
    if not isinstance(entity, dict):
        raise InputError(where + "An FtM entity must be an object")
    text(entity.get("id"), where + "id", 512)
    text(entity.get("schema"), where + "schema", 128)
    props = entity.get("properties")
    if not isinstance(props, dict):
        raise InputError(where + "FtM properties must be an object")
    for prop, values in props.items():
        text(prop, where + "property", 128)
        if not isinstance(values, list) or any(type(v) is not str for v in values):
            raise InputError(where + f"{prop}: use the flat FtM export with string arrays")
    if "caption" in entity and type(entity["caption"]) is not str:
        raise InputError(where + "caption must be text")
    for field in ("datasets", "referents"):
        if field in entity and (not isinstance(entity[field], list) or any(type(v) is not str for v in entity[field])):
            raise InputError(where + f"{field} must be a string array")
    if "target" in entity and type(entity["target"]) is not bool:
        raise InputError(where + "target must be a boolean")
    return entity

def ftm_plan():
    # One stable declaration allows original native comparisons across all editions.
    columns = [{"name": "id", "path": ["id"]},
               {"name": "schema", "path": ["schema"]},
               {"name": "properties", "path": ["properties"], "mode": "json"},
               {"name": "original", "path": [], "mode": "json"}]
    for field in ("caption", "datasets", "referents", "target", "first_seen", "last_seen", "last_change"):
        columns += [{"name": field, "path": [field], "mode": "json", "missing": "null"},
                    {"name": field + "_state", "path": [field], "mode": "state"}]
    return {"schema": "stellar-forge.ndjson-mapping.v1", "name": "OpenSanctions FtM edition",
            "columns": columns, "keys": ["id"], "filters": ["id", "schema"],
            "sorts": ["id", "schema"], "maxRows": 1000000, "maxBytes": MAX_SOURCE,
            "maxCellChars": 1048576, "defaultLimit": 25, "maxLimit": 250, "allowEmpty": True}

def entity_changes(before, after):
    left, right = (before or {}).get("properties", {}), (after or {}).get("properties", {})
    properties = []
    for key in sorted(set(left) | set(right)):
        if left.get(key) != right.get(key):
            previous, current = left.get(key, []), right.get(key, [])
            properties.append({"property": key, "before": previous, "after": current,
                               "added": [v for v in current if v not in previous],
                               "removed": [v for v in previous if v not in current],
                               "orderOnly": sorted(previous) == sorted(current)})
    top = [k for k in sorted(set(before or {}) | set(after or {}))
           if k != "properties" and stable((before or {}).get(k)) != stable((after or {}).get(k))]
    return properties, top

class Domain:
    """Attach to the original NDJSON database, mutex, source objects and lease."""
    def __init__(self, workspace):
        if workspace.kind != "ndjson":
            raise InputError("OpenSanctions attaches to the original NDJSON workspace")
        self.ws, self.db, self.mutex = workspace, workspace.db, workspace.mutex
        self.directory = self.ws.root / "opensanctions"
        self.directory.mkdir(mode=0o700, exist_ok=True)
        if self.directory.is_symlink():
            raise InputError("Use the original private workspace directory")
        self.objects = self.directory / "objects"
        self.objects.mkdir(mode=0o700, exist_ok=True)
        if self.objects.is_symlink():
            raise InputError("Use the original private object directory")
        with self.mutex:
            self.db.executescript("""
                CREATE TABLE IF NOT EXISTS os_objects(id TEXT PRIMARY KEY,body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS os_editions(id TEXT PRIMARY KEY,body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS os_indexes(scope TEXT NOT NULL,entity_id TEXT NOT NULL,
                    line INTEGER NOT NULL,ordinal INTEGER NOT NULL,raw TEXT NOT NULL,semantic_sha TEXT NOT NULL,
                    PRIMARY KEY(scope,entity_id));
                CREATE TABLE IF NOT EXISTS os_aliases(scope TEXT NOT NULL,alias TEXT NOT NULL,
                    canonical TEXT NOT NULL,kind TEXT NOT NULL,PRIMARY KEY(scope,alias,canonical));
                CREATE TABLE IF NOT EXISTS os_updates(id TEXT PRIMARY KEY,body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS os_comparisons(id TEXT PRIMARY KEY,body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS os_changes(comparison TEXT NOT NULL,id TEXT PRIMARY KEY,
                    entity_id TEXT NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS os_statement_sets(id TEXT PRIMARY KEY,body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS os_statements(set_id TEXT NOT NULL,ordinal INTEGER NOT NULL,
                    line_start INTEGER NOT NULL,line_end INTEGER NOT NULL,assertion_key TEXT NOT NULL,
                    raw TEXT NOT NULL,PRIMARY KEY(set_id,ordinal));
                CREATE TABLE IF NOT EXISTS os_portfolios(id TEXT PRIMARY KEY,body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS os_profiles(id TEXT PRIMARY KEY,body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS os_requests(id TEXT PRIMARY KEY,body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS os_cases(id TEXT PRIMARY KEY,body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS os_case_events(id TEXT PRIMARY KEY,case_id TEXT NOT NULL,body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS os_reviews(id TEXT PRIMARY KEY,change_id TEXT NOT NULL,body TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS os_alias_lookup ON os_aliases(scope,alias);
                CREATE INDEX IF NOT EXISTS os_case_events_case ON os_case_events(case_id);
                CREATE INDEX IF NOT EXISTS os_change_comparison ON os_changes(comparison,entity_id);
                CREATE INDEX IF NOT EXISTS os_statement_assertion ON os_statements(set_id,assertion_key);
            """)

    def _one(self, table, ident):
        if table not in TABLES or "body" not in TABLES[table]:
            raise InputError("Unknown domain object")
        with self.mutex:
            row = self.db.execute(f"SELECT body FROM os_{table} WHERE id=?", (exact_id(ident),)).fetchone()
            if row is None:
                raise InputError(f"Unknown retained {table} object")
            return load_json(row[0])

    def _put(self, table, body, mutable=False):
        if table not in TABLES or TABLES[table] != ("id", "body"):
            raise InputError("Unknown domain collection")
        raw = json_bytes(body).decode()
        previous = self.db.execute(f"SELECT body FROM os_{table} WHERE id=?", (body["id"],)).fetchone()
        if previous and previous[0] != raw and not mutable:
            raise InputError("An immutable domain object already exists with different content")
        self.db.execute(f"INSERT INTO os_{table}(id,body) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
                        (body["id"], raw))
        return body

    def put_object(self, stream, name, media="application/octet-stream", provenance=None):
        text(name, "Artifact name", 240)
        with self.mutex, self.ws.scratch() as temp:
            path, digest, count = temp / "original", hashlib.sha256(), 0
            with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as out:
                while chunk := stream.read(65536):
                    count += len(chunk)
                    if count > MAX_SOURCE:
                        raise InputError("Original object exceeds 256 MiB")
                    out.write(chunk); digest.update(chunk)
                out.flush(); os.fsync(out.fileno())
            ident = digest.hexdigest()
            destination = self.objects / ident
            if destination.exists():
                if file_digest(destination) != ident:
                    raise InputError("Retained original object changed")
            else:
                os.replace(path, destination); sync_dir(self.objects)
            existing = self.db.execute("SELECT body FROM os_objects WHERE id=?", (ident,)).fetchone()
            if existing:
                return load_json(existing[0])
            body = {"id": ident, "bytes": count, "name": Path(name).name, "media": media,
                    "provenance": provenance or {}, "receivedAt": time.time()}
            with self.db:
                self._put("objects", body)
            return body

    def object_path(self, ident):
        self._one("objects", ident)
        path = self.objects / exact_id(ident)
        if file_digest(path) != ident:
            raise InputError("Retained original bytes changed")
        return path

    def original_json(self, ident):
        return load_json(self.object_path(ident).read_bytes())

    def _source_path(self, ident):
        self.ws.source(ident)
        path = self.ws.root / "sources" / (ident + ".ndjson")
        if file_digest(path) != ident:
            raise InputError("Original NDJSON source changed")
        return path

    def _index_entities(self, scope, source):
        count, schemas, digest = 0, Counter(), hashlib.sha256()
        with self._source_path(source).open("rb") as stream:
            for line, entity in ndjson_source.records(stream):
                ftm_entity(entity, line)
                count += 1
                raw, semantic = ndjson_source.exact_json(entity), sha(stable(entity))
                digest.update(json_bytes([entity["id"], line, count, semantic]))
                try:
                    self.db.execute("INSERT INTO os_indexes VALUES(?,?,?,?,?,?)",
                                    (scope, entity["id"], line, count, raw, semantic))
                except sqlite3.IntegrityError as error:
                    raise InputError(f"Line {line}: repeated canonical entity id") from error
                aliases = [(entity["id"], "id")] + [(a, "referent") for a in entity.get("referents", []) if a != entity["id"]]
                for alias, kind in aliases:
                    self.db.execute("INSERT OR IGNORE INTO os_aliases VALUES(?,?,?,?)",
                                    (scope, alias, entity["id"], kind))
                schemas[entity["schema"]] += 1
        conflicts = self.db.execute("""SELECT COUNT(*) FROM
            (SELECT alias FROM os_aliases WHERE scope=? GROUP BY alias HAVING COUNT(*)>1)""", (scope,)).fetchone()[0]
        return {"records": count, "schemas": dict(schemas), "indexSha256": digest.hexdigest(),
                "ambiguousAliases": conflicts}

    def accept_edition(self, metadata_stream, entity_stream, *, metadata_url, label=None, entitlement=None):
        """Receive exact metadata and flat FtM bytes, checking the published SHA-1."""
        text(metadata_url, "Original metadata URL", 4000)
        ent = entitlement or {"kind": "evaluation", "note": "Original source evaluation"}
        if not isinstance(ent, dict) or ent.get("kind") not in {"evaluation", "customer_licensed", "public_research"}:
            raise InputError("Record the selected evaluation or customer license scope")
        text(ent.get("note", ""), "Entitlement note", 2000, blank=True)
        metadata_object = self.put_object(metadata_stream, "index.json", "application/json", {"url": metadata_url})
        metadata = self.original_json(metadata_object["id"])
        if not isinstance(metadata, dict) or not DATASET.fullmatch(metadata.get("name", "")) or not VERSION.fullmatch(metadata.get("version", "")):
            raise InputError("Use the original dataset index with name and version")
        candidates = [r for r in metadata.get("resources", []) if r.get("name") == "entities.ftm.json"]
        if len(candidates) != 1:
            raise InputError("The original index must select one flat entities.ftm.json resource")
        resource = candidates[0]
        checksum = resource.get("checksum")
        if isinstance(checksum, dict):
            if checksum.get("algorithm", "sha1").lower().replace("-", "") != "sha1":
                raise InputError("Unsupported published resource checksum")
            checksum = checksum.get("value")
        if not isinstance(checksum, str) or not re.fullmatch(r"[0-9a-fA-F]{40}", checksum) or type(resource.get("size")) is not int:
            raise InputError("The original flat resource must publish its SHA-1 checksum and size")
        source = self.ws.add_source(entity_stream, label or f'{metadata["name"]} · {metadata["version"]}', "entities.ftm.json")
        digest = hashlib.sha1()
        with self._source_path(source["id"]).open("rb") as stream:
            while chunk := stream.read(1048576):
                digest.update(chunk)
        if source["bytes"] != resource["size"] or digest.hexdigest() != checksum.lower():
            raise InputError("The full original FtM bytes do not match the selected metadata resource")
        ident = sha(json_bytes({"schema": SCHEMA, "metadata": metadata_object["id"], "source": source["id"]}))
        with self.mutex:
            previous = self.db.execute("SELECT body FROM os_editions WHERE id=?", (ident,)).fetchone()
            if previous:
                return load_json(previous[0])
            for row in self.db.execute("SELECT body FROM os_editions"):
                old = load_json(row[0])
                if old["dataset"] == metadata["name"] and old["version"] == metadata["version"] and old["source"] != source["id"]:
                    raise InputError("This published dataset version already has different retained bytes")
            plan = self.ws.save_plan(ftm_plan())
            build = self.ws.build(source["id"], plan["id"])
            with self.db:
                stats = self._index_entities(ident, source["id"])
                if stats["records"] != build["rowCount"]:
                    raise InputError("Native dataset and original FtM population differ")
                body = {"id": ident, "schema": "starforge.opensanctions-edition.v1",
                        "dataset": metadata["name"], "version": metadata["version"],
                        "label": label or metadata.get("title", metadata["name"]),
                        "source": source["id"], "build": build["id"], "metadata": metadata_object["id"],
                        "metadataUrl": metadata_url, "resource": resource, "entitlement": ent,
                        "lastChange": metadata.get("last_change"), "lastExport": metadata.get("last_export"),
                        "metadataEntityCount": metadata.get("entity_count"),
                        "statistics": stats, "receivedAt": time.time()}
                self._put("editions", body)
            return body

    def accept_portfolio(self, stream, *, key, label):
        """Customer-owned FtM objects; IDs stay in the customer's chosen namespace."""
        text(key, "Portfolio key", 128); text(label, "Portfolio label", 160)
        source = self.ws.add_source(stream, label, "counterparties.ftm.json")
        ident = sha(json_bytes({"kind": "portfolio", "key": key, "source": source["id"]}))
        with self.mutex:
            previous = self.db.execute("SELECT body FROM os_portfolios WHERE id=?", (ident,)).fetchone()
            if previous:
                return load_json(previous[0])
            plan = self.ws.save_plan(ftm_plan()); build = self.ws.build(source["id"], plan["id"])
            with self.db:
                statistics = self._index_entities(ident, source["id"])
                body = {"id": ident, "key": key, "label": label, "source": source["id"],
                        "build": build["id"], "statistics": statistics, "receivedAt": time.time()}
                self._put("portfolios", body)
            return body

    def entity(self, scope, entity_id):
        text(entity_id, "Entity id", 512)
        with self.mutex:
            row = self.db.execute("SELECT * FROM os_indexes WHERE scope=? AND entity_id=?",
                                  (exact_id(scope), entity_id)).fetchone()
            if row is None:
                raise InputError("Entity is absent from this selected edition or portfolio")
            raw = next(ndjson_source.records(io.BytesIO(row["raw"].encode())))[1]
            return {"id": entity_id, "scope": scope, "line": row["line"], "record": row["ordinal"],
                    "semanticSha256": row["semantic_sha"], "entity": raw}

    def aliases(self, scope, entity_id):
        with self.mutex:
            return [dict(r) for r in self.db.execute(
                "SELECT alias,canonical,kind FROM os_aliases WHERE scope=? AND alias=? ORDER BY canonical",
                (exact_id(scope), text(entity_id, "Entity id", 512)))]

    def entity_page(self, scope, offset=0, limit=50):
        bounded_int(offset, 0, 1000000, "Offset"); bounded_int(limit, 1, 250, "Limit")
        with self.mutex:
            total = self.db.execute("SELECT COUNT(*) FROM os_indexes WHERE scope=?", (exact_id(scope),)).fetchone()[0]
            rows = []
            for row in self.db.execute("SELECT * FROM os_indexes WHERE scope=? ORDER BY ordinal LIMIT ? OFFSET ?",
                                       (scope, limit, offset)):
                entity = load_json(row["raw"])
                rows.append({"id": row["entity_id"], "caption": entity.get("caption", entity["id"]),
                             "schema": entity["schema"], "line": row["line"], "record": row["ordinal"],
                             "target": entity.get("target"), "semanticSha256": row["semantic_sha"]})
            return {"rows": rows, "total": total, "offset": offset, "nextOffset": offset + len(rows) if offset + len(rows) < total else None}

    def accept_statements(self, edition_id, stream, *, source_url, name="statements.csv", complete=False, scope=None):
        edition = self._one("editions", edition_id)
        if type(complete) is not bool:
            raise InputError("Declare whether this statement export contains the complete selected population")
        scope = scope or {"dataset": edition["dataset"]}
        if not isinstance(scope, dict):
            raise InputError("Statement population scope must be a JSON object")
        original = self.put_object(stream, name, "text/csv", {"url": text(source_url, "Statement source", 4000)})
        ident = sha(json_bytes({"edition": edition_id, "original": original["id"], "scope": scope, "complete": complete}))
        with self.mutex:
            old = self.db.execute("SELECT body FROM os_statement_sets WHERE id=?", (ident,)).fetchone()
            if old:
                return load_json(old[0])
            count, previous_line, datasets = 0, 1, Counter()
            with self.object_path(original["id"]).open("r", encoding="utf-8-sig", newline="") as stream, self.db:
                reader = csv.reader(stream, strict=True)
                try:
                    headers = next(reader)
                except StopIteration as error:
                    raise InputError("Statement CSV requires original headers") from error
                if len(set(headers)) != len(headers) or not STATEMENT_REQUIRED.issubset(headers):
                    raise InputError("Use native statement headers including entity_id, canonical_id, dataset, prop and value")
                previous_line = reader.line_num
                for cells in reader:
                    start = previous_line + 1; previous_line = reader.line_num; count += 1
                    if len(cells) != len(headers):
                        raise InputError(f"Statement record {count}: different column count")
                    row = dict(zip(headers, cells))
                    if any(not row[field] for field in STATEMENT_REQUIRED):
                        raise InputError(f"Statement record {count}: required native field is empty")
                    key = sha(json_bytes([row.get(field, "") for field in STATEMENT_IDENTITY]))
                    self.db.execute("INSERT INTO os_statements VALUES(?,?,?,?,?,?)",
                                    (ident, count, start, reader.line_num, key, json_bytes(row).decode()))
                    datasets[row["dataset"]] += 1
                body = {"id": ident, "edition": edition_id, "dataset": edition["dataset"], "original": original["id"],
                        "sourceUrl": source_url, "headers": headers, "records": count, "datasets": dict(datasets),
                        "identityFields": list(STATEMENT_IDENTITY), "complete": complete, "scope": scope, "receivedAt": time.time()}
                self._put("statement_sets", body)
            return body

    def statement_page(self, set_id, entity_id=None, offset=0, limit=50):
        self._one("statement_sets", set_id)
        bounded_int(offset, 0, 10000000, "Offset"); bounded_int(limit, 1, 250, "Limit")
        rows, skipped, more = [], 0, False
        with self.mutex:
            for r in self.db.execute("SELECT * FROM os_statements WHERE set_id=? ORDER BY ordinal", (set_id,)):
                value = load_json(r["raw"])
                if entity_id and entity_id not in {value["entity_id"], value["canonical_id"]}:
                    continue
                if skipped < offset:
                    skipped += 1; continue
                if len(rows) == limit:
                    more = True; break
                rows.append({"record": r["ordinal"], "lineStart": r["line_start"], "lineEnd": r["line_end"], "statement": value})
        return {"rows": rows, "offset": offset, "nextOffset": offset + len(rows) if more else None}

    def _scope_entities(self, scope):
        return {r["entity_id"]: {"entity": next(ndjson_source.records(io.BytesIO(r["raw"].encode())))[1],
                               "line": r["line"], "record": r["ordinal"], "semantic": r["semantic_sha"]}
                for r in self.db.execute("SELECT * FROM os_indexes WHERE scope=?", (scope,))}

    def compare(self, before_id, after_id, statement_before=None, statement_after=None):
        before, after = self._one("editions", before_id), self._one("editions", after_id)
        if before["dataset"] != after["dataset"]:
            raise InputError("Compare two editions of the same selected dataset")
        if before["version"] >= after["version"]:
            raise InputError("Select an earlier and a later published version")
        if bool(statement_before) != bool(statement_after):
            raise InputError("Choose both original statement sets or neither")
        ident = sha(json_bytes({"schema": "starforge.opensanctions-comparison.v2", "before": before_id,
                                "after": after_id, "statements": [statement_before, statement_after]}))
        with self.mutex:
            old = self.db.execute("SELECT body FROM os_comparisons WHERE id=?", (ident,)).fetchone()
            if old:
                return load_json(old[0])
            native = self.ws.compare(before["build"], after["build"])
            left, right = self._scope_entities(before_id), self._scope_entities(after_id)
            alias = defaultdict(set)
            for entity_id, entry in right.items():
                for ref in [entity_id, *entry["entity"].get("referents", [])]:
                    alias[ref].add(entity_id)
            findings = []
            for entity_id in sorted(set(left) | set(right)):
                l, r = left.get(entity_id), right.get(entity_id)
                if l and r and l["semantic"] == r["semantic"]:
                    continue
                targets = sorted(alias.get(entity_id, set()))
                if l and not r:
                    kind = "ID_REPLACED_OR_MERGED" if len(targets) == 1 else "IDENTIFIER_AMBIGUOUS" if targets else "ENTITY_ABSENT_IN_SELECTED_EDITION"
                elif not l:
                    kind = "ENTITY_ADDED"
                else:
                    kind = "ENTITY_CHANGED"
                previous, current = l["entity"] if l else None, r["entity"] if r else None
                properties, metadata = entity_changes(previous, current)
                # Referents and source membership are sets for monitoring, while
                # the original array order remains visible in both raw editions.
                semantic_metadata, reference_changes = [], {}
                for field in metadata:
                    if field in {"referents", "datasets"}:
                        old_values = (previous or {}).get(field, [])
                        new_values = (current or {}).get(field, [])
                        added, removed = sorted(set(new_values) - set(old_values)), sorted(set(old_values) - set(new_values))
                        reference_changes[field] = {"added": added, "removed": removed,
                            "orderOnly": not added and not removed,
                            "before": old_values, "after": new_values}
                        if added or removed:
                            semantic_metadata.append(field)
                    else:
                        semantic_metadata.append(field)
                designation = (previous or current)["schema"] == "Sanction"
                meaningful = [p for p in properties if not p["orderOnly"]]
                category = "designation" if designation and meaningful else "property" if meaningful else "metadata"
                if kind == "ENTITY_CHANGED" and not meaningful and not set(semantic_metadata).intersection({"referents", "datasets", "target", "schema"}):
                    kind = "OBSERVATION_METADATA_UPDATED"
                finding = {"entityId": entity_id, "kind": kind, "category": category,
                           "schema": (current or previous)["schema"], "caption": (current or previous).get("caption", entity_id),
                           "before": {"line": l["line"], "record": l["record"], "semanticSha256": l["semantic"]} if l else None,
                           "after": {"line": r["line"], "record": r["record"], "semanticSha256": r["semantic"]} if r else None,
                           "resolvedCurrentIds": targets, "properties": properties, "metadataFields": metadata,
                           "semanticMetadataFields": semantic_metadata, "referenceChanges": reference_changes,
                           "designationFields": [p["property"] for p in properties if p["property"] in DESIGNATION_FIELDS],
                           "sourceUrl": sorted(set((previous or {}).get("properties", {}).get("sourceUrl", []) +
                                                   (current or {}).get("properties", {}).get("sourceUrl", []))),
                           "authorityConclusion": None}
                findings.append(finding)
            if statement_before:
                sb, sa = self._one("statement_sets", statement_before), self._one("statement_sets", statement_after)
                if sb["edition"] != before_id or sa["edition"] != after_id:
                    raise InputError("Statement sets must belong to the selected editions")
                if not sb.get("complete") or not sa.get("complete") or sb.get("scope") != sa.get("scope"):
                    raise InputError("Statement-removal review requires two complete exports of the same declared population")
                earlier, later = defaultdict(list), defaultdict(list)
                for table, set_id in [(earlier, statement_before), (later, statement_after)]:
                    for row in self.db.execute("SELECT * FROM os_statements WHERE set_id=?", (set_id,)):
                        table[row["assertion_key"]].append(dict(row))
                for key in sorted(set(earlier) | set(later)):
                    l, r = earlier.get(key, []), later.get(key, [])
                    if len(l) <= len(r):
                        continue
                    for row in l[len(r):]:
                        value = load_json(row["raw"])
                        findings.append({"entityId": value["canonical_id"], "kind": "SOURCE_ASSERTION_REMOVED",
                            "category": "statement", "schema": value.get("schema"), "caption": value["canonical_id"],
                            "assertion": value, "statementSet": statement_before,
                            "before": {"record": row["ordinal"], "line": row["line_start"], "lineEnd": row["line_end"]},
                            "after": None, "resolvedCurrentIds": sorted(alias.get(value["canonical_id"], set())),
                            "authorityConclusion": None})
            counts = Counter(f["kind"] for f in findings)
            with self.db:
                for finding in findings:
                    finding["comparison"] = ident
                    finding["id"] = sha(json_bytes(finding))
                    self.db.execute("INSERT INTO os_changes VALUES(?,?,?,?,?)",
                                    (ident, finding["id"], finding["entityId"], finding["kind"], json_bytes(finding).decode()))
                body = {"id": ident, "schema": "starforge.opensanctions-comparison.v2", "before": before_id, "after": after_id, "dataset": before["dataset"],
                        "nativeComparison": native["id"], "nativeCounts": native["counts"],
                        "counts": dict(counts), "findingCount": len(findings),
                        "statements": [statement_before, statement_after], "createdAt": time.time(),
                        "interpretation": "Original FtM/source differences; recorded customer review decides identity and relevance"}
                self._put("comparisons", body)
            return body

    def changes(self, comparison, offset=0, limit=50, kind=None, material=False):
        self._one("comparisons", comparison)
        bounded_int(offset, 0, 10000000, "Offset"); bounded_int(limit, 1, 250, "Limit")
        clause, args = "comparison=?", [comparison]
        if kind:
            clause += " AND kind=?"; args.append(text(kind, "Change kind", 80))
        elif material:
            clause += " AND kind!='OBSERVATION_METADATA_UPDATED'"
        with self.mutex:
            total = self.db.execute(f"SELECT COUNT(*) FROM os_changes WHERE {clause}", args).fetchone()[0]
            rows = []
            for row in self.db.execute(f"SELECT body FROM os_changes WHERE {clause} ORDER BY entity_id,id LIMIT ? OFFSET ?",
                                       [*args, limit, offset]):
                finding = load_json(row[0])
                history = [load_json(r[0]) for r in self.db.execute("SELECT body FROM os_reviews WHERE change_id=? ORDER BY rowid", (finding["id"],))]
                finding["reviews"] = history
                rows.append(finding)
            return {"rows": rows, "total": total, "offset": offset,
                    "nextOffset": offset + len(rows) if offset + len(rows) < total else None}

    def review_change(self, change_id, *, decision, reason, reviewer, authority_url=None, expected=None):
        if decision not in DECISIONS:
            raise InputError("Choose a supported source-change decision")
        text(reason, "Review reason", 8000); text(reviewer, "Reviewer", 160)
        if decision == "authority_change_confirmed":
            text(authority_url, "Original authority source URL", 4000)
        with self.mutex:
            row = self.db.execute("SELECT body FROM os_changes WHERE id=?", (exact_id(change_id),)).fetchone()
            if row is None:
                raise InputError("Choose a retained source change")
            previous = self.db.execute("SELECT id FROM os_reviews WHERE change_id=? ORDER BY rowid DESC LIMIT 1", (change_id,)).fetchone()
            current = previous[0] if previous else None
            if expected != current:
                raise InputError("This source review changed; refresh its original history")
            event = {"change": change_id, "decision": decision, "reason": reason,
                     "reviewer": reviewer, "authorityUrl": authority_url, "previous": current, "at": time.time()}
            event["id"] = sha(json_bytes(event))
            with self.db:
                self.db.execute("INSERT INTO os_reviews VALUES(?,?,?)", (event["id"], change_id, json_bytes(event).decode()))
            return event

    def save_case(self, *, portfolio_id, counterparty_id, candidate_id, edition_id,
                  resolution, relevance, reason, reviewer, match_request=None, case_id=None, expected=None, monitoring=None):
        portfolio = self._one("portfolios", portfolio_id)
        self.entity(portfolio_id, counterparty_id)
        edition = self._one("editions", edition_id)
        if resolution not in RESOLUTION or relevance not in RELEVANCE:
            raise InputError("Choose separate identity and relevance decisions")
        text(reason, "Case reason", 8000); text(reviewer, "Reviewer", 160); text(candidate_id, "Candidate id", 512)
        policy = dict(MONITORING_DEFAULT)
        if monitoring is not None:
            if not isinstance(monitoring, dict) or set(monitoring) - set(policy):
                raise InputError("Use the supported customer monitoring policy fields")
            policy.update(monitoring)
        for field in ("resolutionProperties", "programIds", "topics", "datasets"):
            if not isinstance(policy[field], list) or any(type(v) is not str for v in policy[field]) or len(policy[field]) > 128:
                raise InputError("Monitoring scope and property choices must be string arrays")
        if type(policy["reviewConfirmedIdentityChanges"]) is not bool:
            raise InputError("Confirmed-identity review must be an explicit boolean")
        if match_request:
            request = self._one("requests", match_request)
            if request.get("state") != "RECEIVED" or request.get("portfolio") != portfolio_id:
                raise InputError("Choose a received native match request for this portfolio")
            candidates = (request.get("response") or {}).get("summary", {}).get("candidates", {}).get(counterparty_id, [])
            if candidate_id not in candidates:
                raise InputError("Choose a candidate actually returned for this original counterparty")
        with self.mutex:
            if case_id:
                old = self._one("cases", case_id)
                if old["portfolioKey"] != portfolio["key"] or old["counterpartyId"] != counterparty_id:
                    raise InputError("The case belongs to another customer counterparty")
                ident = case_id
            else:
                ident = sha(json_bytes({"portfolioKey": portfolio["key"], "counterparty": counterparty_id,
                                        "firstCandidate": candidate_id}))
                previous = self.db.execute("SELECT body FROM os_cases WHERE id=?", (ident,)).fetchone()
                old = load_json(previous[0]) if previous else None
            if (old or {}).get("revision") != expected:
                raise InputError("This case changed; refresh the original case before saving")
            resolved = self.aliases(edition_id, candidate_id)
            body = {"id": ident, "portfolioKey": portfolio["key"], "portfolio": portfolio_id,
                    "counterpartyId": counterparty_id, "candidateId": candidate_id, "edition": edition_id,
                    "dataset": edition["dataset"], "resolvedCurrentIds": sorted({r["canonical"] for r in resolved}),
                    "resolution": resolution, "relevance": relevance, "reason": reason,
                    "reviewer": reviewer, "matchRequest": match_request, "monitoring": policy, "previousRevision": expected,
                    "updatedAt": time.time()}
            body["revision"] = sha(json_bytes(body))
            event = {"id": body["revision"], "case": ident, "previous": expected, "value": body}
            with self.db:
                self._put("cases", body, mutable=True)
                self.db.execute("INSERT INTO os_case_events VALUES(?,?,?)", (event["id"], ident, json_bytes(event).decode()))
            return body

    def case_history(self, case_id):
        current = self._one("cases", case_id)
        with self.mutex:
            return {"case": current, "history": [load_json(r[0]) for r in self.db.execute(
                "SELECT body FROM os_case_events WHERE case_id=? ORDER BY rowid", (case_id,))]}

    def impacted_cases(self, comparison):
        """Route changed properties to the customer's two decisions, preserving prior reviews."""
        view = self._one("comparisons", comparison)
        after, result = view["after"], []
        with self.mutex:
            all_changes = [load_json(r[0]) for r in self.db.execute("SELECT body FROM os_changes WHERE comparison=?", (comparison,))]
            cases = [load_json(r[0]) for r in self.db.execute("SELECT body FROM os_cases")]
            for case in cases:
                if case["dataset"] != view["dataset"] or case.get("mergedInto"):
                    continue
                policy = case.get("monitoring", MONITORING_DEFAULT)
                old_id = case["candidateId"]
                pointers = sorted({r["canonical"] for r in self.aliases(after, old_id)})
                relevant_ids = {old_id, *case.get("resolvedCurrentIds", []), *pointers}
                findings, identity, relevance, reasons = [], False, False, []
                for finding in all_changes:
                    linked, designation_entities = False, []
                    for scope in (view["before"], after):
                        try:
                            entity = self.entity(scope, finding["entityId"])["entity"]
                        except InputError:
                            continue
                        if entity["schema"] == "Sanction" and relevant_ids.intersection(entity["properties"].get("entity", [])):
                            linked = True; designation_entities.append(entity)
                    if finding["entityId"] not in relevant_ids and not linked:
                        continue
                    findings.append(finding["id"])
                    changed = {p["property"] for p in finding.get("properties", []) if not p["orderOnly"]}
                    identity_change = bool(changed.intersection(policy["resolutionProperties"])) or finding["kind"] in {
                        "ID_REPLACED_OR_MERGED", "IDENTIFIER_AMBIGUOUS"}
                    identity_change |= "referents" in finding.get("semanticMetadataFields", finding.get("metadataFields", []))
                    if identity_change:
                        identity = True
                    relevant_change = bool(changed.intersection({"topics", "programId"})) or linked or finding["kind"] in {
                        "ENTITY_ABSENT_IN_SELECTED_EDITION", "SOURCE_ASSERTION_REMOVED"}
                    relevant_change |= "datasets" in finding.get("semanticMetadataFields", finding.get("metadataFields", []))
                    if relevant_change:
                        candidate_entities = list(designation_entities)
                        for eid in relevant_ids:
                            for scope in (view["before"], after):
                                try:
                                    candidate_entities.append(self.entity(scope, eid)["entity"])
                                except InputError:
                                    pass
                        in_scope = True
                        for configured, accessor in [
                            (policy["programIds"], lambda e: e["properties"].get("programId", [])),
                            (policy["topics"], lambda e: e["properties"].get("topics", [])),
                            (policy["datasets"], lambda e: e.get("datasets", []))]:
                            if configured and not any(set(configured).intersection(accessor(e)) for e in candidate_entities):
                                in_scope = False
                        relevance |= in_scope
                # The native source identity is reconciled even when there is only metadata drift.
                identity |= len(pointers) != 1 or pointers != case.get("resolvedCurrentIds", [])
                resolution_review = identity and (case["resolution"] == "undecided" or
                    case["resolution"] == "same_entity" and policy["reviewConfirmedIdentityChanges"])
                relevance_review = relevance and case["resolution"] != "different_entity"
                if resolution_review:
                    reasons.append("Current identity/identifier data affects the selected resolution policy")
                if relevance_review:
                    reasons.append("Source risk/designation data intersects the selected monitoring scope")
                if findings or pointers != case.get("resolvedCurrentIds", []):
                    result.append({"case": case, "currentIds": pointers, "changes": findings,
                                   "reviewRequired": resolution_review or relevance_review,
                                   "identityReview": resolution_review, "relevanceReview": relevance_review,
                                   "reasons": reasons,
                                   "priorResolutionPreserved": not resolution_review,
                                   "priorRelevancePreserved": not relevance_review})
        return {"comparison": comparison, "rows": result,
                "reviewRequired": sum(r["reviewRequired"] for r in result)}

    def state(self):
        with self.mutex:
            out = {"schema": SCHEMA, "native": self.ws.state()}
            for table in ("editions", "updates", "comparisons", "statement_sets", "portfolios",
                          "profiles", "requests", "cases"):
                out[table] = [load_json(r[0]) for r in self.db.execute(f"SELECT body FROM os_{table} ORDER BY rowid DESC")]
            return out

    def export_packet(self, output):
        """A complete original Workspace packet per build plus domain/source history."""
        output = Path(output)
        with self.mutex, self.ws.scratch() as temp:
            state = {"schema": SCHEMA, "tables": {}}
            for table, columns in TABLES.items():
                if table in ("indexes", "aliases", "statements"):
                    continue  # Derived again from the complete originals when receiving.
                state["tables"][table] = [dict(r) for r in self.db.execute(f"SELECT * FROM os_{table}")]
            selected_builds = set()
            for table in ("editions", "portfolios"):
                for row in state["tables"][table]:
                    selected_builds.add(load_json(row["body"])["build"])
            entries = {}
            state_path = temp / "state.json"; private_write(state_path, json_bytes(state))
            entries["state.json"] = state_path
            packets = temp / "packets"; packets.mkdir(mode=0o700)
            for build_id in sorted(selected_builds):
                path = packets / (build_id + ".zip")
                self.ws.export_packet(build_id, path); entries["packets/" + path.name] = path
            for row in state["tables"]["objects"]:
                entries["objects/" + row["id"]] = self.object_path(row["id"])
            manifest = {"schema": PACKET, "builds": sorted(selected_builds),
                        "files": {name: {"bytes": path.stat().st_size, "sha256": file_digest(path, 2 * MAX_SOURCE)}
                                  for name, path in entries.items()}}
            with os.fdopen(os.open(output, os.O_RDWR | os.O_CREAT | os.O_EXCL, 0o600), "w+b") as out:
                try:
                    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                        archive.writestr("manifest.json", json_bytes(manifest))
                        for name, path in entries.items():
                            archive.write(path, name)
                    out.flush(); os.fsync(out.fileno())
                except BaseException:
                    output.unlink(missing_ok=True); raise
            return {"file": str(output), "bytes": output.stat().st_size, "sha256": file_digest(output, 4 * MAX_SOURCE),
                    "builds": len(selected_builds), "objects": len(state["tables"]["objects"]),
                    "cases": len(state["tables"]["cases"]), "editions": len(state["tables"]["editions"])}

    def import_packet(self, path):
        """Rebuild the same native projections and source indexes, retaining all decisions."""
        with self.mutex, self.ws.scratch() as temp, zipfile.ZipFile(path) as archive:
            names = archive.namelist()
            if len(names) != len(set(names)) or len(names) > 8192 or "manifest.json" not in names:
                raise InputError("Receiving archive has repeated or excessive members")
            info = archive.getinfo("manifest.json")
            if info.file_size > 2 * 1024 * 1024:
                raise InputError("Receiving manifest is too large")
            manifest = load_json(archive.read("manifest.json"))
            if manifest.get("schema") != PACKET or set(names) != {"manifest.json", *manifest.get("files", {})}:
                raise InputError("Select the complete original OpenSanctions receiving archive")
            if sum(x.file_size for x in archive.infolist()) > 4 * MAX_SOURCE:
                raise InputError("Receiving archive exceeds the original supported closure size")
            paths = {}
            for name, entry in manifest["files"].items():
                if not (name == "state.json" or re.fullmatch(r"objects/[0-9a-f]{64}", name) or
                        re.fullmatch(r"packets/[0-9a-f]{64}\.zip", name)):
                    raise InputError("Unexpected receiving archive member")
                member = archive.getinfo(name)
                if member.file_size != entry["bytes"] or member.file_size > 2 * MAX_SOURCE:
                    raise InputError("Receiving member exceeds its declared size")
                dest = temp / sha(name.encode())
                with archive.open(name) as stream, os.fdopen(os.open(dest, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as out:
                    while chunk := stream.read(65536):
                        out.write(chunk)
                    out.flush(); os.fsync(out.fileno())
                if file_digest(dest, 2 * MAX_SOURCE) != entry["sha256"]:
                    raise InputError("Receiving member hash differs from the original manifest")
                paths[name] = dest
            state = load_json(paths["state.json"].read_bytes())
            expected_tables = set(TABLES) - {"indexes", "aliases", "statements"}
            if state.get("schema") != SCHEMA or set(state.get("tables", {})) != expected_tables:
                raise InputError("Receiving domain state is incomplete")
            for table, rows in state["tables"].items():
                if not isinstance(rows, list) or any(set(r) != set(TABLES[table]) for r in rows):
                    raise InputError("Receiving table shape differs from the native contract")
            builds = []
            for build_id in manifest.get("builds", []):
                packet = paths.get("packets/" + exact_id(build_id) + ".zip")
                if packet is None:
                    raise InputError("A selected native build packet is missing")
                built = self.ws.import_packet(packet)
                if built["build"]["id"] != build_id:
                    raise InputError("Received native build identity changed")
                builds.append(build_id)
            # Validate original object closures before the domain transaction.
            for row in state["tables"]["objects"]:
                body = load_json(row["body"]); original = paths.get("objects/" + exact_id(row["id"]))
                if original is None or sha(original.read_bytes()) != row["id"] or body.get("id") != row["id"]:
                    raise InputError("A domain original is missing or changed")
                destination = self.objects / row["id"]
                if destination.exists():
                    if file_digest(destination) != row["id"]:
                        raise InputError("Receiving destination object changed")
                else:
                    os.replace(original, destination)
            with self.db:
                for table, rows in state["tables"].items():
                    columns = TABLES[table]
                    for row in rows:
                        body = load_json(row["body"])
                        if body.get("id") != row["id"]:
                            raise InputError("Receiving domain identity differs from its row")
                        previous = self.db.execute(f"SELECT * FROM os_{table} WHERE id=?", (row["id"],)).fetchone()
                        if previous:
                            if dict(previous) != row:
                                raise InputError("Receiving case history conflicts with current local state")
                        else:
                            self.db.execute(f"INSERT INTO os_{table}({','.join(columns)}) VALUES({','.join('?' for _ in columns)})",
                                            [row[k] for k in columns])
                for table in ("editions", "portfolios"):
                    for row in state["tables"][table]:
                        body = load_json(row["body"])
                        if body["build"] not in builds:
                            raise InputError("A domain edition has no selected native build")
                        if not self.db.execute("SELECT 1 FROM os_indexes WHERE scope=?", (body["id"],)).fetchone():
                            stats = self._index_entities(body["id"], body["source"])
                            if stats != body["statistics"]:
                                raise InputError("Original entity index differs after receiving")
                for row in state["tables"]["statement_sets"]:
                    body = load_json(row["body"])
                    if self.db.execute("SELECT 1 FROM os_statements WHERE set_id=?", (body["id"],)).fetchone():
                        continue
                    count = 0
                    with self.object_path(body["original"]).open("r", encoding="utf-8-sig", newline="") as stream:
                        reader = csv.reader(stream, strict=True); headers = next(reader)
                        if headers != body["headers"]:
                            raise InputError("Original statement headers changed")
                        last = reader.line_num
                        for cells in reader:
                            count += 1; first = last + 1; last = reader.line_num
                            if len(cells) != len(headers):
                                raise InputError("Original statement row width changed")
                            value = dict(zip(headers, cells))
                            key = sha(json_bytes([value.get(f, "") for f in STATEMENT_IDENTITY]))
                            self.db.execute("INSERT INTO os_statements VALUES(?,?,?,?,?,?)",
                                (body["id"], count, first, last, key, json_bytes(value).decode()))
                    if count != body["records"]:
                        raise InputError("Original statement population changed")
            # The original comparison implementation reconstructs its own closure.
            for row in state["tables"]["comparisons"]:
                body = load_json(row["body"]); before = self._one("editions", body["before"]); after = self._one("editions", body["after"])
                native = self.ws.compare(before["build"], after["build"])
                if native["id"] != body["nativeComparison"] or native["counts"] != body["nativeCounts"]:
                    raise InputError("Native source comparison differs after receiving")
            return {"schema": PACKET, "builds": builds, "editions": len(state["tables"]["editions"]),
                    "cases": len(state["tables"]["cases"]), "objects": len(state["tables"]["objects"]),
                    "stateSha256": manifest["files"]["state.json"]["sha256"]}

class Workspace(ndjson_application.Workspace):
    """CLI convenience; managed hosts can attach Domain(existing_workspace)."""
    def __init__(self, root, create=False):
        super().__init__(root, create=create)
        self.opensanctions = Domain(self)
