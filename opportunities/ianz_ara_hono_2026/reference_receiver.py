"""Actual local SQLite receiving product for complete IANZ native packages.

This module is a named local target. It does not connect to or impersonate an
IANZ customer platform. Original imports, native revisions and returned bytes
are retained in the target database. All external file arguments are local.
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import sys
import tempfile
import uuid
import zipfile

from schema import (
    ENTITIES, FIELDS, RELATIONS, MAX_FILE_BYTES, MAX_PACKAGE_BYTES, MAX_RECORDS,
    WorkspaceError, copy, digest, dumps, fraction, identity, loads, now,
    package_bytes, record_key, unpack, validate_record,
)
from mapping import decimal_text, export_dataset, local_schema, validate_native_schema, validate_profile

DATABASE = "reference-receiver.sqlite3"
DATABASE_VERSION = 1
APPLICATION_ID = 0x49414E5A
RECEIVER_SCHEMA = "ianz.reference-receiver/v1"
IMPORT_SCHEMA = "ianz.native-import-package/v1"
RETURN_SCHEMA = "ianz.native-return-package/v1"
SHA = re.compile(r"^[a-f0-9]{64}$")
ASSET = re.compile(r"^assets/([a-f0-9]{64})$")
DOCUMENT_ASSOCIATIONS = {
    "programme_key": "programme", "accreditation_key": "accreditation",
    "assessment_key": "assessment", "participant_key": "participant",
}
ACCESS_CLASSES = {"public", "client_private", "assessor_private", "internal"}
IDENTITY_FIELDS = ("target_product", "target_environment_id", "target_schema_version")

DDL = (
    """CREATE TABLE receiver (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1),
        schema_version INTEGER NOT NULL,
        environment_id TEXT NOT NULL UNIQUE,
        descriptor_json TEXT NOT NULL,
        descriptor_sha256 TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK(revision>=0),
        created_at TEXT NOT NULL
    )""",
    """CREATE TABLE requests (
        native_request_id TEXT PRIMARY KEY,
        package_sha256 TEXT NOT NULL,
        package_bytes INTEGER NOT NULL,
        original_package BLOB NOT NULL,
        import_manifest_sha256 TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        import_json TEXT NOT NULL,
        operator TEXT NOT NULL,
        reason TEXT NOT NULL,
        native_operation_id TEXT NOT NULL UNIQUE,
        applied_revision INTEGER NOT NULL,
        received_at TEXT NOT NULL,
        result_json BLOB NOT NULL,
        result_sha256 TEXT NOT NULL
    )""",
    """CREATE TABLE assets (
        sha256 TEXT PRIMARY KEY, bytes INTEGER NOT NULL, body BLOB NOT NULL
    )""",
    """CREATE TABLE request_members (
        native_request_id TEXT NOT NULL REFERENCES requests(native_request_id),
        path TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        body BLOB,
        asset_sha256 TEXT REFERENCES assets(sha256),
        PRIMARY KEY(native_request_id,path),
        CHECK((body IS NOT NULL AND asset_sha256 IS NULL) OR
              (body IS NULL AND asset_sha256 IS NOT NULL))
    )""",
    """CREATE TABLE native_records (
        native_id TEXT PRIMARY KEY,
        target_entity TEXT NOT NULL,
        external_key_json TEXT NOT NULL,
        values_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        content_sha256 TEXT NOT NULL,
        revision INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(target_entity,external_key_json)
    )""",
    """CREATE TABLE record_history (
        native_id TEXT NOT NULL REFERENCES native_records(native_id),
        revision INTEGER NOT NULL,
        native_operation_id TEXT NOT NULL,
        action TEXT NOT NULL,
        values_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        content_sha256 TEXT NOT NULL,
        operator TEXT NOT NULL,
        reason TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        PRIMARY KEY(native_id,revision)
    )""",
    """CREATE TABLE request_records (
        native_request_id TEXT NOT NULL REFERENCES requests(native_request_id),
        ordinal INTEGER NOT NULL,
        entity TEXT NOT NULL,
        original_key TEXT NOT NULL,
        native_id TEXT NOT NULL REFERENCES native_records(native_id),
        target_entity TEXT NOT NULL,
        external_key_json TEXT NOT NULL,
        imported_revision INTEGER NOT NULL,
        PRIMARY KEY(native_request_id,entity,original_key),
        UNIQUE(native_request_id,ordinal),
        UNIQUE(native_request_id,native_id)
    )""",
    """CREATE TABLE native_relations (
        source_native_id TEXT NOT NULL REFERENCES native_records(native_id),
        native_field TEXT NOT NULL,
        target_native_id TEXT NOT NULL REFERENCES native_records(native_id),
        original_json TEXT NOT NULL,
        native_request_id TEXT NOT NULL REFERENCES requests(native_request_id),
        revision INTEGER NOT NULL,
        PRIMARY KEY(source_native_id,native_field,target_native_id)
    )""",
    """CREATE TABLE relation_history (
        source_native_id TEXT NOT NULL REFERENCES native_records(native_id),
        native_field TEXT NOT NULL,
        revision INTEGER NOT NULL,
        native_operation_id TEXT NOT NULL,
        relations_json TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        PRIMARY KEY(source_native_id,native_field,revision)
    )""",
    """CREATE TABLE request_relations (
        native_request_id TEXT NOT NULL REFERENCES requests(native_request_id),
        ordinal INTEGER NOT NULL,
        original_json TEXT NOT NULL,
        source_native_id TEXT NOT NULL REFERENCES native_records(native_id),
        target_native_id TEXT NOT NULL REFERENCES native_records(native_id),
        native_field TEXT NOT NULL,
        PRIMARY KEY(native_request_id,ordinal)
    )""",
    """CREATE TABLE native_documents (
        native_id TEXT PRIMARY KEY REFERENCES native_records(native_id),
        document_key TEXT NOT NULL,
        document_edition_id TEXT NOT NULL,
        asset_sha256 TEXT NOT NULL REFERENCES assets(sha256),
        metadata_json TEXT NOT NULL,
        associations_json TEXT NOT NULL,
        content_sha256 TEXT NOT NULL,
        revision INTEGER NOT NULL,
        UNIQUE(document_key,document_edition_id)
    )""",
    """CREATE TABLE document_history (
        native_id TEXT NOT NULL REFERENCES native_documents(native_id),
        revision INTEGER NOT NULL,
        native_operation_id TEXT NOT NULL,
        asset_sha256 TEXT NOT NULL REFERENCES assets(sha256),
        metadata_json TEXT NOT NULL,
        associations_json TEXT NOT NULL,
        content_sha256 TEXT NOT NULL,
        operator TEXT NOT NULL,
        reason TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        PRIMARY KEY(native_id,revision)
    )""",
    """CREATE TABLE request_documents (
        native_request_id TEXT NOT NULL REFERENCES requests(native_request_id),
        ordinal INTEGER NOT NULL,
        native_id TEXT NOT NULL REFERENCES native_documents(native_id),
        PRIMARY KEY(native_request_id,native_id),
        UNIQUE(native_request_id,ordinal)
    )""",
    """CREATE TABLE commands (
        command_id TEXT PRIMARY KEY,
        native_request_id TEXT NOT NULL REFERENCES requests(native_request_id),
        native_id TEXT NOT NULL REFERENCES native_records(native_id),
        request_json TEXT NOT NULL,
        request_sha256 TEXT NOT NULL,
        native_operation_id TEXT NOT NULL UNIQUE,
        revision INTEGER NOT NULL,
        result_json BLOB NOT NULL,
        result_sha256 TEXT NOT NULL
    )""",
    """CREATE TABLE exports (
        native_request_id TEXT NOT NULL REFERENCES requests(native_request_id),
        selection_sha256 TEXT NOT NULL,
        native_export_id TEXT NOT NULL UNIQUE,
        exported_at TEXT NOT NULL,
        receiver_revision INTEGER NOT NULL,
        package_sha256 TEXT NOT NULL,
        package_bytes INTEGER NOT NULL,
        body BLOB NOT NULL,
        PRIMARY KEY(native_request_id,selection_sha256)
    )""",
    "CREATE INDEX request_records_by_native ON request_records(native_id,native_request_id)",
    "CREATE INDEX record_history_by_operation ON record_history(native_operation_id)",
)
TABLES = {
    "receiver", "requests", "assets", "request_members", "native_records",
    "record_history", "request_records", "native_relations", "relation_history",
    "request_relations", "native_documents", "document_history",
    "request_documents", "commands", "exports",
}


def need(value, message, *, code="invalid_request", status=400, details=None):
    if not value:
        raise WorkspaceError(message, code=code, status=status, details=details)


def text(value, label, limit=2048):
    need(isinstance(value, str) and bool(value.strip()) and len(value) <= limit and "\x00" not in value,
         "Retain a nonempty " + label + " within its declared length.")
    return value


def key_text(value):
    need(value is not None and value != "", "A native external key cannot be null or blank.")
    try:
        result = dumps(value)
    except (TypeError, ValueError, OverflowError) as error:
        raise WorkspaceError("Retain a complete typed JSON external key.") from error
    need(len(result.encode("utf-8")) <= 8192, "The native external key exceeds 8 KiB.")
    return result


def encoded(value):
    return (dumps(value) + "\n").encode("utf-8")


def checked_json(body, expected_sha256, label):
    body = bytes(body)
    need(digest(body)["sha256"] == expected_sha256, "The retained " + label + " bytes changed.",
         code="retained_bytes_changed", status=409)
    return loads(body)


def record_content(values, metadata):
    return identity({"values": values, "metadata": metadata})


def document_content(metadata, associations):
    return identity({"metadata": metadata, "associations": associations})


def _read_file(path, maximum=MAX_PACKAGE_BYTES):
    path = Path(path)
    with path.open("rb") as source:
        body = source.read(maximum + 1)
    need(len(body) <= maximum, "The selected complete file exceeds its receiving limit.", status=413)
    return body


def _write_file(path, body):
    """Publish a complete new file; an existing exact output is an ordinary replay."""
    destination = Path(path).expanduser().absolute()
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if destination.exists() or destination.is_symlink():
        need(not destination.is_symlink() and destination.is_file() and
             digest(_read_file(destination)) == digest(body),
             "The selected output already contains different bytes. Choose a new output path.",
             code="output_conflict", status=409)
        return {"path": str(destination), **digest(body), "replayed": True}
    descriptor, staged_name = tempfile.mkstemp(prefix=".ianz-native-output-", dir=str(destination.parent))
    staged = Path(staged_name)
    published = False
    try:
        with os.fdopen(descriptor, "wb") as target:
            target.write(body)
            target.flush()
            os.fsync(target.fileno())
        try:
            os.link(staged, destination)
            published = True
        except FileExistsError:
            need(not destination.is_symlink() and destination.is_file() and
                 digest(_read_file(destination)) == digest(body),
                 "Another output occupies the selected path. The complete staged file is retained.",
                 code="output_conflict", status=409, details={"staged_path": str(staged)})
            published = True
        if hasattr(os, "O_DIRECTORY"):
            directory = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        if published:
            staged.unlink()
    return {"path": str(destination), **digest(body), "replayed": False}


class ReferenceReceiver:
    """Open or initialize this actual local receiving environment."""

    def __init__(self, root):
        selected = Path(root).expanduser().absolute()
        need(not selected.is_symlink(), "Select the actual local receiving directory, not a directory symlink.")
        selected.mkdir(parents=True, exist_ok=True, mode=0o700)
        need(selected.is_dir(), "The selected receiver root is not a directory.")
        self.root = selected.resolve()
        self.path = self.root / DATABASE
        if not self.path.exists():
            try:
                descriptor = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                os.close(descriptor)
            except FileExistsError:
                pass
        self._regular_database()
        self._initialize()

    def _regular_database(self):
        info = self.path.lstat()
        need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1,
             "Open the receiver's one original regular SQLite file.",
             code="receiver_path_conflict", status=409)

    @contextlib.contextmanager
    def _connection(self, *, write=False, initializing=False):
        self._regular_database()
        db = sqlite3.connect(str(self.path), timeout=30, isolation_level=None)
        db.row_factory = sqlite3.Row
        try:
            db.execute("PRAGMA foreign_keys=ON")
            db.execute("PRAGMA synchronous=FULL")
            db.execute("PRAGMA busy_timeout=30000")
            if not initializing:
                need(db.execute("PRAGMA application_id").fetchone()[0] == APPLICATION_ID,
                     "This database is not the original local IANZ receiving product.",
                     code="receiver_identity", status=409)
            db.execute("BEGIN IMMEDIATE" if write else "BEGIN")
            yield db
            db.commit()
        except sqlite3.OperationalError as error:
            db.rollback()
            raise WorkspaceError("The local receiving transaction did not complete: " + str(error),
                                 code="receiver_storage", status=503) from error
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def _initialize(self):
        with self._connection(write=True, initializing=True) as db:
            tables = {row[0] for row in db.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
            if not tables:
                need(db.execute("PRAGMA application_id").fetchone()[0] in (0, APPLICATION_ID),
                     "The selected database belongs to another application.", code="receiver_identity", status=409)
                for statement in DDL:
                    db.execute(statement)
                environment_id = "ianz-local-" + str(uuid.uuid4())
                descriptor = copy(local_schema())
                descriptor["environment_id"] = environment_id
                validate_native_schema(descriptor)
                db.execute("INSERT INTO receiver VALUES(1,?,?,?,?,?,?)",
                           (DATABASE_VERSION, environment_id, dumps(descriptor), identity(descriptor), 0, now()))
                db.execute("PRAGMA application_id=" + str(APPLICATION_ID))
                db.execute("PRAGMA user_version=" + str(DATABASE_VERSION))
            else:
                need(tables == TABLES and db.execute("PRAGMA application_id").fetchone()[0] == APPLICATION_ID,
                     "Keep the complete original receiver database; this is not a schema repair operation.",
                     code="receiver_schema", status=409)
                self._state(db)

    def _state(self, db):
        row = db.execute("SELECT * FROM receiver WHERE singleton=1").fetchone()
        need(row is not None and row["schema_version"] == DATABASE_VERSION,
             "The persisted receiver schema version is unavailable or incompatible.",
             code="receiver_schema", status=409)
        descriptor = loads(row["descriptor_json"])
        need(identity(descriptor) == row["descriptor_sha256"] and
             descriptor["environment_id"] == row["environment_id"],
             "The original native schema descriptor changed.", code="retained_bytes_changed", status=409)
        validate_native_schema(descriptor)
        return row, descriptor

    def describe(self):
        with self._connection() as db:
            return copy(self._state(db)[1])

    def status(self):
        with self._connection() as db:
            state, descriptor = self._state(db)
            return {
                "schema": RECEIVER_SCHEMA, "root": str(self.root), "database": str(self.path),
                "target_product": descriptor["product"],
                "target_environment_id": descriptor["environment_id"],
                "target_schema_version": descriptor["version"],
                "receiver_revision": state["revision"],
                "requests": db.execute("SELECT COUNT(*) FROM requests").fetchone()[0],
                "records": db.execute("SELECT COUNT(*) FROM native_records").fetchone()[0],
                "documents": db.execute("SELECT COUNT(*) FROM native_documents").fetchone()[0],
                "assets": db.execute("SELECT COUNT(*) FROM assets").fetchone()[0],
                "corrections": db.execute("SELECT COUNT(*) FROM commands").fetchone()[0],
                "exports": db.execute("SELECT COUNT(*) FROM exports").fetchone()[0],
            }

    def _request(self, db, native_request_id):
        row = db.execute("SELECT * FROM requests WHERE native_request_id=?",
                         (text(native_request_id, "native request ID"),)).fetchone()
        need(row is not None, "The original native request is absent from this receiver.",
             code="native_request_missing", status=404)
        need(digest(bytes(row["original_package"])) ==
             {"bytes": row["package_bytes"], "sha256": row["package_sha256"]},
             "The complete original import package changed.", code="retained_bytes_changed", status=409)
        result = checked_json(row["result_json"], row["result_sha256"], "native result")
        need(result["native_request_id"] == native_request_id and
             result["native_operation_id"] == row["native_operation_id"] and
             result["revision"] == row["applied_revision"],
             "The retained request and original result identity differ.", code="receiver_identity", status=409)
        return row, result

    @staticmethod
    def _decode(data):
        manifest, files = unpack(data, schema=IMPORT_SCHEMA)
        for name in ("import.json", "dataset.json", "mapping.json", "documents.json"):
            need(name in files, "Receive the complete original " + name + ".")
        imported = loads(files["import.json"])
        need(isinstance(imported, dict) and imported.get("schema") == "ianz.native-import/v1",
             "Select the original ianz.native-import/v1 request.")
        for name in ("operation_id", "project_id", "run_id", "native_request_id", "source_revision",
                     "target_product", "target_environment_id", "target_schema_version"):
            text(imported.get(name), name)
        for name, member in (("mapping_sha256", "mapping.json"), ("dataset_sha256", "dataset.json"),
                             ("documents_sha256", "documents.json")):
            need(isinstance(imported.get(name), str) and SHA.fullmatch(imported[name]) and
                 digest(files[member])["sha256"] == imported[name],
                 "The request's exact " + member + " pin differs.", code="source_binding", status=409)
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            manifest_sha = digest(archive.read("MANIFEST.json"))["sha256"]
        for name in ("native_request_id", "run_id", "target_product", "target_environment_id",
                     "target_schema_version"):
            if name in manifest:
                need(manifest[name] == imported[name], "The complete manifest and import identity differ: " + name,
                     code="source_binding", status=409)
        return manifest, files, imported, manifest_sha

    @staticmethod
    def _native_values(table, values):
        need(isinstance(values, dict), "Native values must be one complete typed object.")
        specification = FIELDS[table]
        need(not (set(values) - set(specification)), "The selected native table has unrecognised fields.",
             details={"target_entity": table, "fields": sorted(set(values) - set(specification))})
        validate_record(table, values, complete=True)

    def _prepare(self, files, imported, descriptor):
        target = {
            "target_product": descriptor["product"],
            "target_environment_id": descriptor["environment_id"],
            "target_schema_version": descriptor["version"],
        }
        need(all(imported[name] == value for name, value in target.items()),
             "Import into the exact selected actual local target environment.",
             code="target_identity", status=409)
        profile = loads(files["mapping.json"])
        validate_profile(profile)
        native = profile.get("native_import_profile") or {}
        need(native.get("kind") == "received_native_schema" and
             all(profile.get(name) == value for name, value in target.items()) and
             identity(native.get("schema")) == identity(descriptor),
             "Bind the original mapping to this receiver's complete persisted schema descriptor.",
             code="target_schema_binding", status=409)
        dataset = loads(files["dataset.json"])
        need(isinstance(dataset, dict) and dataset.get("schema") == "ianz.native-dataset/v1",
             "Receive the complete typed native dataset.")
        for name in ("records", "relationships", "omissions", "issues"):
            need(isinstance(dataset.get(name), list), "Retain the dataset's complete " + name + " list.")
        need(len(dataset["records"]) <= MAX_RECORDS and
             len(dataset["relationships"]) <= MAX_RECORDS * 20,
             "The complete selected dataset exceeds the receiver's declared capacity.", status=413)
        need(not dataset["issues"], "Resolve the issued dataset's native binding issues before importing.",
             code="dataset_unresolved", status=409, details={"issues": dataset["issues"][:100]})
        canonical = dataset.get("canonical_records")
        need(isinstance(canonical, dict) and not (set(canonical) - set(ENTITIES)),
             "Retain the original canonical record cohort and metadata.")
        canonical_index = {}
        for entity, rows in canonical.items():
            need(isinstance(rows, list), "Canonical entity rows must be complete lists.")
            for row in rows:
                need(isinstance(row, dict) and isinstance(row.get("values"), dict),
                     "Retain each complete canonical source row.")
                key = record_key(entity, row["values"])
                need(row.get("entity", entity) == entity and row.get("key", key) == key,
                     "The canonical row and its original identity differ.", code="source_binding", status=409)
                need((entity, key) not in canonical_index, "Canonical source keys must be unique in one import.")
                text(row.get("edition_id"), "original record edition ID")
                need(isinstance(row.get("annotations", {}), dict) and
                     isinstance(row.get("provenance", {}), dict),
                     "Retain complete source annotations and provenance objects.")
                canonical_index[(entity, key)] = copy(row)
        # Use the actual maintained mapping, including omissions and explicit
        # reference transforms, to verify the issued dataset against its source.
        expected = export_dataset(canonical, profile)
        for name in ("records", "relationships", "omissions", "issues", "canonical_records"):
            need(identity(dataset[name]) == identity(expected[name]),
                 "The issued native " + name + " differs from its complete original mapping/source.",
                 code="source_binding", status=409)
        records, original_ids, native_keys = [], {}, set()
        target_tables = {row["name"] for row in descriptor["entities"]}
        field_maps = {
            (row["entity"], row["source_field"]): row for row in profile["field_maps"]
            if row.get("mode") == "copy"
        }
        for ordinal, row in enumerate(dataset["records"]):
            need(isinstance(row, dict), "Each selected native record must be a full object.")
            pair = (row.get("entity"), row.get("key"))
            need(pair in canonical_index and pair not in original_ids,
                 "Each selected native record needs one distinct original canonical identity.")
            table = row.get("target_entity")
            need(table in target_tables and table in FIELDS, "Select an actual local target table.")
            native_key = key_text(row.get("external_key"))
            need((table, native_key) not in native_keys, "The selected native external keys are ambiguous.")
            native_keys.add((table, native_key))
            need(isinstance(row.get("values"), dict), "Retain the full typed native row values.")
            metadata = {
                "entity": pair[0], "key": pair[1], "record_edition_id": row["record_edition_id"],
                "source_edition_id": row.get("source_edition_id"),
                "annotations": copy(canonical_index[pair].get("annotations", {})),
                "provenance": copy(canonical_index[pair].get("provenance", {})),
                "canonical_record": copy(canonical_index[pair]),
            }
            prepared = {"ordinal": ordinal, "row": copy(row), "key_json": native_key, "metadata": metadata}
            records.append(prepared)
            original_ids[pair] = prepared
        relation_keys = set()
        for relation in dataset["relationships"]:
            need(isinstance(relation, dict) and set(relation) == {"entity", "key", "field", "target_entity", "target_key"},
                 "Each native relation must retain its five original canonical fields.")
            source = (relation["entity"], relation["key"])
            target_pair = (relation["target_entity"], relation["target_key"])
            need(source in original_ids and target_pair in original_ids,
                 "Resolve every original relation against this complete imported cohort.",
                 code="native_relation_unresolved", status=409, details=relation)
            field = field_maps.get((relation["entity"], relation["field"]))
            need(field is not None and field["target_field"] in original_ids[source]["row"]["values"] and
                 RELATIONS.get(relation["entity"], {}).get(relation["field"]) == relation["target_entity"],
                 "Resolve only the actual mapped original native relation.", details=relation)
            relation_key = identity(relation)
            need(relation_key not in relation_keys, "The original relationship list contains a duplicate.")
            relation_keys.add(relation_key)
        assets = {}
        for path, body in files.items():
            if path.startswith("assets/"):
                match = ASSET.fullmatch(path)
                need(match is not None and len(body) <= MAX_FILE_BYTES and digest(body)["sha256"] == match.group(1),
                     "Retain each actual complete asset at its exact SHA-256 member path.",
                     code="asset_binding", status=409, details={"path": path})
                assets[match.group(1)] = body
        source_references = loads(files["source-references.json"]) if "source-references.json" in files else []
        need(isinstance(source_references, list), "Source references must be the complete original list.")
        for row in source_references:
            need(isinstance(row, dict), "Retain each full source reference.")
            sha = row.get("sha256")
            need(isinstance(sha, str) and sha in assets and row.get("file_id") == "sha256:" + sha and
                 row.get("asset_path") == "assets/" + sha and type(row.get("bytes")) is int and
                 row["bytes"] == len(assets[sha]),
                 "A source reference differs from its complete selected asset.", code="asset_binding", status=409)
            text(row.get("filename"), "original source filename", 4096)
            if row.get("media_type") is not None:
                text(row["media_type"], "observed source media type", 512)
        documents = loads(files["documents.json"])
        need(isinstance(documents, list) and len(documents) <= MAX_RECORDS,
             "Receive the complete document edition list.")
        document_keys = set()
        for row in documents:
            need(isinstance(row, dict), "Retain each full original document edition.")
            pair = (text(row.get("document_key"), "document key"),
                    text(row.get("document_edition_id"), "document edition"))
            need(pair not in document_keys, "The document edition list contains duplicate native identities.")
            document_keys.add(pair)
            sha = row.get("sha256")
            need(isinstance(sha, str) and sha in assets and row.get("file_id") == "sha256:" + sha and
                 type(row.get("bytes")) is int and row["bytes"] == len(assets[sha]) and
                 row.get("access_class") in ACCESS_CLASSES and row.get("native_id") is None,
                 "Retain the document's actual bytes, original file identity and visibility.",
                 code="document_binding", status=409)
            associations = row.get("associations")
            need(isinstance(associations, dict) and not (set(associations) - set(DOCUMENT_ASSOCIATIONS)),
                 "Retain the original typed document association object.")
            document_key = record_key("document", {"document_key": pair[0], "document_edition_id": pair[1]})
            source = original_ids.get(("document", document_key))
            need(source is not None, "The complete document edition needs its actual imported document record.")
            canonical_values = source["metadata"]["canonical_record"]["values"]
            need(canonical_values.get("content_sha256") == sha and
                 canonical_values.get("visibility") == row["access_class"],
                 "The document catalogue differs from its original canonical record.", code="document_binding", status=409)
            for field, target_entity in DOCUMENT_ASSOCIATIONS.items():
                value = associations.get(field)
                need(value == canonical_values.get(field),
                     "The original document association and canonical record differ.", code="document_binding", status=409)
                if value is not None and value != "":
                    need(isinstance(value, str) and (target_entity, value) in original_ids,
                         "Resolve each selected document association in the imported cohort.",
                         code="native_relation_unresolved", status=409,
                         details={"document_key": pair[0], "field": field})
        expected_documents = {
            (item["metadata"]["canonical_record"]["values"]["document_key"],
             item["metadata"]["canonical_record"]["values"]["document_edition_id"])
            for item in records if item["row"]["entity"] == "document"
        }
        need(document_keys == expected_documents,
             "Receive every actual document edition in the selected canonical cohort.",
             code="document_coverage", status=409)
        return {
            "dataset": dataset, "profile": profile, "records": records, "original_ids": original_ids,
            "field_maps": field_maps, "assets": assets, "documents": documents,
            "source_references": source_references,
        }

    def import_package(self, data, *, operator, reason):
        """Apply one complete original native request in one SQLite transaction."""
        need(isinstance(data, bytes), "Import the original complete package bytes.")
        operator, reason = text(operator, "native operator", 512), text(reason, "import reason", 8192)
        manifest, files, imported, manifest_sha = self._decode(data)
        package_pin = digest(data)
        request_id = imported["native_request_id"]
        with self._connection(write=True) as db:
            previous = db.execute("SELECT package_sha256,package_bytes FROM requests WHERE native_request_id=?",
                                  (request_id,)).fetchone()
            if previous is not None:
                need(package_pin == {"bytes": previous["package_bytes"], "sha256": previous["package_sha256"]},
                     "This original native request ID already belongs to a different complete package.",
                     code="native_request_conflict", status=409)
                return copy(self._request(db, request_id)[1])
            state, descriptor = self._state(db)
            prepared = self._prepare(files, imported, descriptor)
            revision = state["revision"] + 1
            received_at, operation_id = now(), "ianz-native-import-" + str(uuid.uuid4())
            # The placeholder and every target write are unobservable until the
            # same transaction commits the complete original native result.
            db.execute("""INSERT INTO requests
                (native_request_id,package_sha256,package_bytes,original_package,
                 import_manifest_sha256,manifest_json,import_json,operator,reason,
                 native_operation_id,applied_revision,received_at,result_json,result_sha256)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (request_id, package_pin["sha256"], package_pin["bytes"], data, manifest_sha,
                 dumps(manifest), dumps(imported), operator, reason, operation_id, revision,
                 received_at, b"{}", digest(b"{}")["sha256"]))
            for sha, body in prepared["assets"].items():
                prior = db.execute("SELECT bytes,body FROM assets WHERE sha256=?", (sha,)).fetchone()
                if prior is None:
                    db.execute("INSERT INTO assets VALUES(?,?,?)", (sha, len(body), body))
                else:
                    need(prior["bytes"] == len(body) and bytes(prior["body"]) == body,
                         "The retained native asset differs from its exact content identity.",
                         code="asset_binding", status=409)
            for name, body in files.items():
                match = ASSET.fullmatch(name)
                pin = digest(body)
                db.execute("INSERT INTO request_members VALUES(?,?,?,?,?,?)",
                           (request_id, name, pin["bytes"], pin["sha256"],
                            None if match else body, match.group(1) if match else None))
            counts = {"records": len(prepared["records"]), "inserted": 0, "updated": 0,
                      "unchanged": 0, "relationships": len(prepared["dataset"]["relationships"]),
                      "documents": len(prepared["documents"]), "assets": len(prepared["assets"]),
                      "files": len(files), "by_target_entity": {}}
            native_ids = {}
            for item in prepared["records"]:
                row, metadata = item["row"], item["metadata"]
                table, key_json = row["target_entity"], item["key_json"]
                current = db.execute("SELECT * FROM native_records WHERE target_entity=? AND external_key_json=?",
                                     (table, key_json)).fetchone()
                values = copy(row["values"])
                if current is not None:
                    current_values, _ = self._record(current)
                    values = {**current_values, **values}
                self._native_values(table, values)
                content_sha = record_content(values, metadata)
                if current is None:
                    native_id = "ianz-row-" + str(uuid.uuid4())
                    action = "insert"
                    db.execute("INSERT INTO native_records VALUES(?,?,?,?,?,?,?,?,?)",
                               (native_id, table, key_json, dumps(values), dumps(metadata),
                                content_sha, revision, received_at, received_at))
                    counts["inserted"] += 1
                else:
                    native_id = current["native_id"]
                    action = "observe" if content_sha == current["content_sha256"] else "upsert"
                    counts["unchanged" if action == "observe" else "updated"] += 1
                    db.execute("""UPDATE native_records
                        SET values_json=?,metadata_json=?,content_sha256=?,revision=?,updated_at=?
                        WHERE native_id=?""",
                        (dumps(values), dumps(metadata), content_sha, revision, received_at, native_id))
                db.execute("INSERT INTO record_history VALUES(?,?,?,?,?,?,?,?,?,?)",
                           (native_id, revision, operation_id, action, dumps(values), dumps(metadata),
                            content_sha, operator, reason, received_at))
                db.execute("INSERT INTO request_records VALUES(?,?,?,?,?,?,?,?)",
                           (request_id, item["ordinal"], row["entity"], row["key"], native_id,
                            table, key_json, revision))
                native_ids[(row["entity"], row["key"])] = native_id
                counts["by_target_entity"][table] = counts["by_target_entity"].get(table, 0) + 1
            # Replace only reference fields actually supplied in this import.
            # Omitted fields retain their original target values and joins.
            relation_fields = {}
            for item in prepared["records"]:
                row = item["row"]
                for canonical_field in RELATIONS.get(row["entity"], {}):
                    mapping = prepared["field_maps"].get((row["entity"], canonical_field))
                    if mapping and mapping["target_field"] in row["values"]:
                        source_id = native_ids[(row["entity"], row["key"])]
                        relation_fields[(source_id, mapping["target_field"])] = []
            for ordinal, relation in enumerate(prepared["dataset"]["relationships"]):
                source_id = native_ids[(relation["entity"], relation["key"])]
                target_id = native_ids[(relation["target_entity"], relation["target_key"])]
                field = prepared["field_maps"][(relation["entity"], relation["field"])]["target_field"]
                relation_fields[(source_id, field)].append({
                    **copy(relation), "source_native_id": source_id, "target_native_id": target_id,
                })
                db.execute("INSERT INTO request_relations VALUES(?,?,?,?,?,?)",
                           (request_id, ordinal, dumps(relation), source_id, target_id, field))
            for (source_id, field), rows in relation_fields.items():
                db.execute("DELETE FROM native_relations WHERE source_native_id=? AND native_field=?",
                           (source_id, field))
                for relation in rows:
                    original = {name: relation[name] for name in
                                ("entity", "key", "field", "target_entity", "target_key")}
                    db.execute("INSERT INTO native_relations VALUES(?,?,?,?,?,?)",
                               (source_id, field, relation["target_native_id"], dumps(original), request_id, revision))
                db.execute("INSERT INTO relation_history VALUES(?,?,?,?,?,?)",
                           (source_id, field, revision, operation_id, dumps(rows), received_at))
            for ordinal, document in enumerate(prepared["documents"]):
                original_key = record_key("document", {
                    "document_key": document["document_key"],
                    "document_edition_id": document["document_edition_id"],
                })
                native_id = native_ids[("document", original_key)]
                metadata = copy(document)
                metadata["native_id"] = native_id
                associations = {
                    field: native_ids[(entity, document["associations"][field])]
                    for field, entity in DOCUMENT_ASSOCIATIONS.items()
                    if document["associations"].get(field) is not None and document["associations"].get(field) != ""
                }
                current = db.execute("""SELECT * FROM native_documents
                    WHERE document_key=? AND document_edition_id=?""",
                    (document["document_key"], document["document_edition_id"])).fetchone()
                content_sha = document_content(metadata, associations)
                if current is None:
                    db.execute("INSERT INTO native_documents VALUES(?,?,?,?,?,?,?,?)",
                               (native_id, document["document_key"], document["document_edition_id"],
                                document["sha256"], dumps(metadata), dumps(associations), content_sha, revision))
                else:
                    self._document(current)
                    need(current["native_id"] == native_id and current["asset_sha256"] == document["sha256"],
                         "An existing document edition cannot acquire another native identity or different content. "
                         "Receive a distinct actual document edition.",
                         code="document_edition_conflict", status=409)
                    db.execute("""UPDATE native_documents
                        SET metadata_json=?,associations_json=?,content_sha256=?,revision=? WHERE native_id=?""",
                        (dumps(metadata), dumps(associations), content_sha, revision, native_id))
                db.execute("INSERT INTO document_history VALUES(?,?,?,?,?,?,?,?,?,?)",
                           (native_id, revision, operation_id, document["sha256"], dumps(metadata),
                            dumps(associations), content_sha, operator, reason, received_at))
                db.execute("INSERT INTO request_documents VALUES(?,?,?)", (request_id, ordinal, native_id))
            result = {
                "schema": "ianz.native-result/v1",
                "native_request_id": request_id, "run_id": imported["run_id"],
                "import_manifest_sha256": manifest_sha,
                **{name: imported[name] for name in IDENTITY_FIELDS},
                "status": "applied", "native_operation_id": operation_id,
                "received_at": received_at, "revision": revision, "counts": counts,
                "operator": operator, "reason": reason,
                "package": package_pin,
                "atomic": True,
            }
            result_bytes = encoded(result)
            db.execute("UPDATE requests SET result_json=?,result_sha256=? WHERE native_request_id=?",
                       (result_bytes, digest(result_bytes)["sha256"], request_id))
            db.execute("UPDATE receiver SET revision=? WHERE singleton=1", (revision,))
            return copy(result)

    @staticmethod
    def _record(row):
        values, metadata = loads(row["values_json"]), loads(row["metadata_json"])
        need(record_content(values, metadata) == row["content_sha256"],
             "The current native row no longer matches its retained content pin.",
             code="retained_bytes_changed", status=409)
        return values, metadata

    @staticmethod
    def _document(row):
        metadata, associations = loads(row["metadata_json"]), loads(row["associations_json"])
        need(document_content(metadata, associations) == row["content_sha256"] and
             metadata["native_id"] == row["native_id"] and metadata["sha256"] == row["asset_sha256"],
             "The current document no longer matches its actual native edition.",
             code="retained_bytes_changed", status=409)
        return metadata, associations

    def _member(self, db, request_id, path):
        row = db.execute("""SELECT m.*,a.body AS asset_body,a.bytes AS asset_bytes
            FROM request_members m LEFT JOIN assets a ON a.sha256=m.asset_sha256
            WHERE m.native_request_id=? AND m.path=?""", (request_id, path)).fetchone()
        need(row is not None, "The complete original request member is absent: " + path,
             code="native_member_missing", status=409)
        body = bytes(row["asset_body"] if row["asset_sha256"] is not None else row["body"])
        need(digest(body) == {"bytes": row["bytes"], "sha256": row["sha256"]},
             "The selected native member changed: " + path, code="retained_bytes_changed", status=409)
        return body

    def inspect_request(self, native_request_id):
        with self._connection() as db:
            row, result = self._request(db, native_request_id)
            state, _ = self._state(db)
            members = [
                {"entity": item["entity"], "key": item["original_key"],
                 "target_entity": item["target_entity"], "external_key": loads(item["external_key_json"]),
                 "native_id": item["native_id"], "imported_revision": item["imported_revision"],
                 "current_revision": item["current_revision"]}
                for item in db.execute("""SELECT m.*,n.revision AS current_revision
                    FROM request_records m JOIN native_records n ON n.native_id=m.native_id
                    WHERE m.native_request_id=? ORDER BY m.ordinal""", (native_request_id,))
            ]
            return {
                "schema": "ianz.reference-request/v1", "native_request_id": native_request_id,
                "result": copy(result), "receiver_revision": state["revision"],
                "package": {"bytes": row["package_bytes"], "sha256": row["package_sha256"]},
                "import_manifest_sha256": row["import_manifest_sha256"], "records": members,
                "files": [dict(item) for item in db.execute(
                    "SELECT path,bytes,sha256 FROM request_members WHERE native_request_id=? ORDER BY path",
                    (native_request_id,))],
                "exports": [dict(item) for item in db.execute("""SELECT
                    selection_sha256,native_export_id,exported_at,receiver_revision,package_bytes,package_sha256
                    FROM exports WHERE native_request_id=? ORDER BY exported_at""", (native_request_id,))],
            }

    def original_package(self, native_request_id):
        with self._connection() as db:
            return bytes(self._request(db, native_request_id)[0]["original_package"])

    def correct_record(self, native_request_id, target_entity, external_key, values, *,
                       operator, reason, command_id, expected_revision):
        """Record an explicit local value correction with original-command replay."""
        native_request_id = text(native_request_id, "original native request ID")
        target_entity = text(target_entity, "native target entity", 256)
        key_json = key_text(external_key)
        operator, reason = text(operator, "native operator", 512), text(reason, "correction reason", 8192)
        command_id = text(command_id, "native correction command ID", 200)
        need(type(expected_revision) is int and expected_revision >= 0,
             "Use the actual nonnegative committed receiver revision.")
        need(isinstance(values, dict) and bool(values), "Supply the explicit typed fields to correct.")
        request = {
            "schema": "ianz.native-correction-command/v1", "command_id": command_id,
            "native_request_id": native_request_id, "target_entity": target_entity,
            "external_key": copy(external_key), "values": copy(values),
            "expected_revision": expected_revision, "operator": operator, "reason": reason,
        }
        request_sha = identity(request)
        with self._connection(write=True) as db:
            previous = db.execute("SELECT * FROM commands WHERE command_id=?", (command_id,)).fetchone()
            if previous is not None:
                need(previous["request_sha256"] == request_sha and
                     identity(loads(previous["request_json"])) == request_sha,
                     "This original correction command ID belongs to a different complete request.",
                     code="native_command_conflict", status=409)
                return copy(checked_json(previous["result_json"], previous["result_sha256"], "correction result"))
            original, _ = self._request(db, native_request_id)
            state, descriptor = self._state(db)
            need(state["revision"] == expected_revision, "The target changed after the selected native revision.",
                 code="native_revision_conflict", status=409,
                 details={"expected_revision": expected_revision, "current_revision": state["revision"]})
            selected = db.execute("""SELECT m.*,n.values_json,n.metadata_json,n.content_sha256,n.revision
                FROM request_records m JOIN native_records n ON n.native_id=m.native_id
                WHERE m.native_request_id=? AND m.target_entity=? AND m.external_key_json=?""",
                (native_request_id, target_entity, key_json)).fetchone()
            need(selected is not None, "Correct a native row in this exact original request cohort.",
                 code="native_record_missing", status=404)
            current_values, metadata = self._record(selected)
            next_values = {**current_values, **copy(values)}
            self._native_values(target_entity, next_values)
            profile = loads(self._member(db, native_request_id, "mapping.json"))
            field_maps = {
                row["source_field"]: row["target_field"] for row in profile["field_maps"]
                if row.get("mode") == "copy" and row["entity"] == selected["entity"]
            }
            table = next(row for row in descriptor["entities"] if row["name"] == target_entity)
            protected = set(table["external_key"]) | set(RELATIONS.get(target_entity, {}))
            protected.update(field_maps[field] for field in RELATIONS.get(selected["entity"], {})
                             if field in field_maps)
            if selected["entity"] == "document" or target_entity == "document":
                protected.update(field_maps[field] for field in
                                 ("document_key", "document_edition_id", "content_sha256", "asset_path", "visibility",
                                  *DOCUMENT_ASSOCIATIONS) if field in field_maps)
            changed_protected = sorted(name for name in values if name in protected and
                                       dumps(values[name]) != dumps(current_values.get(name)))
            need(not changed_protected,
                 "Identity, resolved references and document edition/access changes need a complete reviewed import. "
                 "This correction command edits ordinary native values.",
                 code="correction_requires_import", status=409, details={"fields": changed_protected})
            revision, operation_id, recorded_at = state["revision"] + 1, "ianz-native-correction-" + str(uuid.uuid4()), now()
            content_sha = record_content(next_values, metadata)
            result = {
                "schema": "ianz.native-correction-result/v1", "command_id": command_id,
                "native_request_id": native_request_id, "native_operation_id": operation_id,
                "native_id": selected["native_id"], "target_entity": target_entity,
                "external_key": copy(external_key), "status": "applied", "revision": revision,
                "previous_revision": selected["revision"], "received_at": recorded_at,
                "operator": operator, "reason": reason, "values": copy(next_values),
                "changed_fields": sorted(name for name in values if name not in current_values or
                                         dumps(values[name]) != dumps(current_values[name])),
                "request_sha256": request_sha,
            }
            result_bytes = encoded(result)
            # Command intent, value update, full previous/current history and
            # original result become durable together under the SQLite journal.
            db.execute("INSERT INTO commands VALUES(?,?,?,?,?,?,?,?,?)",
                       (command_id, native_request_id, selected["native_id"], dumps(request), request_sha,
                        operation_id, revision, result_bytes, digest(result_bytes)["sha256"]))
            db.execute("""UPDATE native_records
                SET values_json=?,content_sha256=?,revision=?,updated_at=? WHERE native_id=?""",
                (dumps(next_values), content_sha, revision, recorded_at, selected["native_id"]))
            db.execute("INSERT INTO record_history VALUES(?,?,?,?,?,?,?,?,?,?)",
                       (selected["native_id"], revision, operation_id, "correction", dumps(next_values),
                        dumps(metadata), content_sha, operator, reason, recorded_at))
            db.execute("UPDATE receiver SET revision=? WHERE singleton=1", (revision,))
            return copy(result)

    @staticmethod
    def _canonical_values(entity, native_values, profile):
        """Reverse the selected field/quantity bindings without guessing ambiguity."""
        output, issues = {}, []
        units = {(row["entity"], row["field"]): row for row in profile.get("unit_maps", [])}
        enums = {(row["entity"], row["field"]): row for row in profile.get("enum_maps", [])}
        identities = {}
        for row in profile.get("identity_maps", []):
            identities.setdefault((row["entity"], dumps(row["target_key"])), []).append(row["source_key"])
        for mapping in profile["field_maps"]:
            if mapping["entity"] != entity or mapping.get("mode") != "copy":
                continue
            source_field, native_field = mapping["source_field"], mapping["target_field"]
            if native_field not in native_values:
                continue
            value = copy(native_values[native_field])
            try:
                if value is not None:
                    if (entity, source_field) in units:
                        rule = units[(entity, source_field)]
                        factor = fraction(str(rule.get("numerator", "1"))) / fraction(str(rule.get("denominator", "1")))
                        need(factor != 0, "The selected original unit mapping cannot be reversed.")
                        value = decimal_text(fraction(value) / factor)
                    if (entity, source_field) in enums:
                        matches = [
                            pair["source"] for pair in enums[(entity, source_field)].get("values", [])
                            if dumps(pair["target"]) == dumps(value)
                        ]
                        need(len(matches) == 1, "The current native enumeration has no unique original value.")
                        value = matches[0]
                    target_entity = RELATIONS.get(entity, {}).get(source_field)
                    if target_entity:
                        references = value if isinstance(value, list) else [value]
                        mapped = []
                        for reference in references:
                            candidates = identities.get((target_entity, dumps(reference)), [])
                            need(len(candidates) <= 1, "The current native reference has an ambiguous original identity.")
                            mapped.append(candidates[0] if candidates else reference)
                        value = mapped if isinstance(value, list) else mapped[0]
                output[source_field] = value
            except (WorkspaceError, ValueError, ZeroDivisionError, TypeError) as error:
                issues.append({"entity": entity, "field": source_field, "native_field": native_field,
                               "kind": "native_reverse_mapping_unresolved", "message": str(error)})
        return output, issues

    def _snapshot(self, db, request_id):
        request, result = self._request(db, request_id)
        profile = loads(self._member(db, request_id, "mapping.json"))
        records, billing_lines, billing_issues, selected_versions = [], [], [], []
        by_entity, members = {}, {}
        for row in db.execute("""SELECT m.*,n.values_json,n.metadata_json,n.content_sha256,
                    n.revision AS current_revision
                FROM request_records m JOIN native_records n ON n.native_id=m.native_id
                WHERE m.native_request_id=? ORDER BY m.ordinal""", (request_id,)):
            values, metadata = self._record(row)
            members[row["native_id"]] = row
            records.append({
                "target_entity": row["target_entity"], "external_key": loads(row["external_key_json"]),
                "native_id": row["native_id"], "values": copy(values),
                "revision": row["current_revision"],
                "annotations": copy(metadata["annotations"]),
                "provenance": copy(metadata["provenance"]),
            })
            selected_versions.append({"native_id": row["native_id"], "revision": row["current_revision"],
                                      "content_sha256": row["content_sha256"]})
            by_entity[row["target_entity"]] = by_entity.get(row["target_entity"], 0) + 1
            if row["entity"] == "charge_line":
                canonical, issues = self._canonical_values("charge_line", values, profile)
                financial = metadata["annotations"].get("financial_receiving") or {}
                original = financial.get("original", {}) if isinstance(financial, dict) else {}
                need(isinstance(original, dict), "The native financial receiving scope is not an object.",
                     code="retained_metadata", status=409)
                line = {**copy(original), **canonical}
                # An unresolved reverse mapping must not silently inherit the
                # old original monetary value and appear to reconcile.
                for issue in issues:
                    line.pop(issue["field"], None)
                    billing_issues.append({**issue, "native_id": row["native_id"], "original_key": row["original_key"]})
                billing_lines.append(line)
        reverse_fields = {
            (mapping["entity"], mapping["target_field"]): mapping["source_field"]
            for mapping in profile["field_maps"] if mapping.get("mode") == "copy" and
            mapping["source_field"] in RELATIONS.get(mapping["entity"], {})
        }
        relationships, outside_relations, seen = [], 0, set()
        for row in db.execute("""SELECT r.* FROM native_relations r
                JOIN request_records m ON m.native_id=r.source_native_id
                WHERE m.native_request_id=? ORDER BY m.ordinal,r.native_field,r.target_native_id""", (request_id,)):
            source = members[row["source_native_id"]]
            target = members.get(row["target_native_id"])
            field = reverse_fields.get((source["entity"], row["native_field"]))
            if target is None or field is None:
                outside_relations += 1
                continue
            relation = {
                "entity": source["entity"], "key": source["original_key"], "field": field,
                "target_entity": target["entity"], "target_key": target["original_key"],
                "source_native_id": row["source_native_id"], "target_native_id": row["target_native_id"],
            }
            signature = identity(relation)
            need(signature not in seen, "The current native relation extract contains an ambiguous duplicate.",
                 code="native_relation_ambiguous", status=409)
            seen.add(signature)
            relationships.append(relation)
        documents, document_versions, visibility_counts = [], [], {}
        for row in db.execute("""SELECT d.* FROM request_documents m
                JOIN native_documents d ON d.native_id=m.native_id
                WHERE m.native_request_id=? ORDER BY m.ordinal""", (request_id,)):
            metadata, associations = self._document(row)
            documents.append(copy(metadata))
            document_versions.append({"native_id": row["native_id"], "revision": row["revision"],
                                      "content_sha256": row["content_sha256"]})
            visibility_counts[metadata["access_class"]] = visibility_counts.get(metadata["access_class"], 0) + 1
        asset_members = {}
        for row in db.execute("""SELECT path FROM request_members
                WHERE native_request_id=? AND asset_sha256 IS NOT NULL ORDER BY path""", (request_id,)):
            asset_members[row["path"]] = self._member(db, request_id, row["path"])
        source_row = db.execute("SELECT 1 FROM request_members WHERE native_request_id=? AND path=?",
                                (request_id, "source-references.json")).fetchone()
        source_references = self._member(db, request_id, "source-references.json") if source_row else None
        control_totals = {
            "records": len(records), "by_target_entity": by_entity,
            "relationships": len(relationships), "documents": len(documents),
            "documents_by_access_class": visibility_counts,
            "assets": len(asset_members), "asset_bytes": sum(len(body) for body in asset_members.values()),
            "billing_lines": len(billing_lines), "billing_issues": len(billing_issues),
            "relationships_not_in_original_cohort": outside_relations,
            "source_references": len(loads(source_references)) if source_references is not None else 0,
        }
        imported = loads(request["import_json"])
        returned = {
            "schema": "ianz.native-return/v1", "native_request_id": request_id,
            "run_id": imported["run_id"], "import_manifest_sha256": request["import_manifest_sha256"],
            **{name: imported[name] for name in IDENTITY_FIELDS},
            "complete": True, "records": records, "relationships": relationships, "documents": documents,
            "billing_lines": billing_lines, "billing_issues": billing_issues, "control_totals": control_totals,
        }
        # The selection depends on the actual original cohort, not unrelated
        # target rows or the wall clock. Current metadata and joins are included.
        selection = {
            "native_request_id": request_id, "package_sha256": request["package_sha256"],
            "records": selected_versions, "documents": document_versions,
            "returned": returned,
            "assets": [{"path": name, **digest(body)} for name, body in sorted(asset_members.items())],
            "source_references": digest(source_references) if source_references is not None else None,
            "original_result_sha256": request["result_sha256"],
        }
        return request, result, returned, asset_members, source_references, identity(selection)

    def export_return(self, native_request_id):
        """Freeze or replay the complete current native extract for one original request."""
        native_request_id = text(native_request_id, "original native request ID")
        with self._connection(write=True) as db:
            request, result, returned, assets, source_references, selection_sha = self._snapshot(db, native_request_id)
            previous = db.execute("SELECT * FROM exports WHERE native_request_id=? AND selection_sha256=?",
                                  (native_request_id, selection_sha)).fetchone()
            if previous is not None:
                body = bytes(previous["body"])
                need(digest(body) == {"bytes": previous["package_bytes"], "sha256": previous["package_sha256"]},
                     "The completed original native return package changed.", code="retained_bytes_changed", status=409)
                unpack(body, schema=RETURN_SCHEMA)
                return body
            state, _ = self._state(db)
            export_id, exported_at = "ianz-native-export-" + str(uuid.uuid4()), now()
            returned.update(native_export_id=export_id, exported_at=exported_at,
                            receiver_revision=state["revision"], selection_sha256=selection_sha)
            files = {
                "return.json": encoded(returned),
                "native-result.json": bytes(request["result_json"]),
                **assets,
            }
            if source_references is not None:
                files["source-references.json"] = source_references
            body, manifest = package_bytes(files, {
                "schema": RETURN_SCHEMA, "native_request_id": native_request_id,
                "run_id": result["run_id"], "import_manifest_sha256": request["import_manifest_sha256"],
                **{name: result[name] for name in IDENTITY_FIELDS},
                "native_export_id": export_id, "selection_sha256": selection_sha,
                "receiver_revision": state["revision"], "exported_at": exported_at,
                "complete": True,
            })
            # Verify the complete produced inventory before retaining its receipt.
            unpack(body, schema=RETURN_SCHEMA)
            pin = digest(body)
            db.execute("INSERT INTO exports VALUES(?,?,?,?,?,?,?,?)",
                       (native_request_id, selection_sha, export_id, exported_at, state["revision"],
                        pin["sha256"], pin["bytes"], body))
            return body

    def history(self, native_request_id):
        """Return the actual histories of this request's selected native IDs only."""
        with self._connection() as db:
            request, result = self._request(db, native_request_id)
            rows = []
            for row in db.execute("""SELECT h.* FROM record_history h
                    JOIN request_records m ON m.native_id=h.native_id
                    WHERE m.native_request_id=? ORDER BY h.revision,m.ordinal""", (native_request_id,)):
                values, metadata = self._record(row)
                rows.append({
                    "native_id": row["native_id"], "revision": row["revision"],
                    "native_operation_id": row["native_operation_id"], "action": row["action"],
                    "values": values, "metadata": metadata, "content_sha256": row["content_sha256"],
                    "operator": row["operator"], "reason": row["reason"], "recorded_at": row["recorded_at"],
                })
            relations = [
                {**dict(row), "relations": loads(row["relations_json"])}
                for row in db.execute("""SELECT h.* FROM relation_history h
                    JOIN request_records m ON m.native_id=h.source_native_id
                    WHERE m.native_request_id=? ORDER BY h.revision,m.ordinal,h.native_field""", (native_request_id,))
            ]
            for row in relations:
                row.pop("relations_json")
            documents = []
            for row in db.execute("""SELECT h.* FROM document_history h
                    JOIN request_documents m ON m.native_id=h.native_id
                    WHERE m.native_request_id=? ORDER BY h.revision,m.ordinal""", (native_request_id,)):
                metadata, associations = self._document(row)
                documents.append({
                    "native_id": row["native_id"], "revision": row["revision"],
                    "native_operation_id": row["native_operation_id"], "metadata": metadata,
                    "associations": associations, "content_sha256": row["content_sha256"],
                    "operator": row["operator"], "reason": row["reason"], "recorded_at": row["recorded_at"],
                })
            commands = []
            for row in db.execute("""SELECT DISTINCT c.* FROM commands c
                    JOIN request_records m ON m.native_id=c.native_id
                    WHERE m.native_request_id=? ORDER BY c.revision""", (native_request_id,)):
                need(identity(loads(row["request_json"])) == row["request_sha256"],
                     "The original correction request changed.", code="retained_bytes_changed", status=409)
                commands.append({
                    "request": loads(row["request_json"]),
                    "result": checked_json(row["result_json"], row["result_sha256"], "correction result"),
                })
            return {
                "schema": "ianz.reference-history/v1", "native_request_id": native_request_id,
                "original_result": copy(result), "records": rows, "relationships": relations,
                "documents": documents, "corrections": commands,
            }


def main(argv=None):
    parser = argparse.ArgumentParser(description="Actual local SQLite IANZ native receiving product; no network or service.")
    parser.add_argument("--root", required=True, help="The actual existing or new local receiving directory.")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("init", help="Initialize once and describe the actual persisted environment.")
    commands.add_parser("describe", help="Read the original native schema descriptor.")
    status = commands.add_parser("status", help="Read current local state or one original request.")
    status.add_argument("--request")
    incoming = commands.add_parser("import", help="Atomically import a complete original native package.")
    incoming.add_argument("--package", required=True)
    incoming.add_argument("--operator", required=True)
    incoming.add_argument("--reason", required=True)
    outgoing = commands.add_parser("export", help="Freeze the complete original-cohort native return package.")
    outgoing.add_argument("--request", required=True)
    outgoing.add_argument("--out", required=True)
    original = commands.add_parser("original", help="Recover the exact accepted original import ZIP.")
    original.add_argument("--request", required=True)
    original.add_argument("--out", required=True)
    history = commands.add_parser("history", help="Read full selected native row/document/correction history.")
    history.add_argument("--request", required=True)
    correction = commands.add_parser("correct", help="Apply an explicit ordinary native value correction.")
    correction.add_argument("--request", required=True)
    correction.add_argument("--entity", required=True)
    correction.add_argument("--external-key-json", required=True, help="The exact typed external key encoded as JSON.")
    correction.add_argument("--values", required=True, help="A local JSON object containing only explicit changed fields.")
    correction.add_argument("--operator", required=True)
    correction.add_argument("--reason", required=True)
    correction.add_argument("--command-id", required=True)
    correction.add_argument("--expected-revision", type=int, required=True)
    args = parser.parse_args(argv)
    try:
        receiver = ReferenceReceiver(args.root)
        if args.command in {"init", "describe"}:
            result = receiver.describe()
        elif args.command == "status":
            result = receiver.inspect_request(args.request) if args.request else receiver.status()
        elif args.command == "import":
            result = receiver.import_package(_read_file(args.package), operator=args.operator, reason=args.reason)
        elif args.command in {"export", "original"}:
            body = receiver.export_return(args.request) if args.command == "export" else receiver.original_package(args.request)
            result = {"schema": "ianz.native-file-result/v1", "native_request_id": args.request,
                      "kind": args.command, **_write_file(args.out, body)}
        elif args.command == "history":
            result = receiver.history(args.request)
        else:
            result = receiver.correct_record(
                args.request, args.entity, loads(args.external_key_json), loads(_read_file(args.values, MAX_FILE_BYTES)),
                operator=args.operator, reason=args.reason, command_id=args.command_id,
                expected_revision=args.expected_revision,
            )
        print(dumps(result), flush=True)
        return 0
    except WorkspaceError as error:
        print(dumps({"ok": False, **error.as_dict(), "status": error.status}), file=sys.stderr, flush=True)
        return 2
    except (OSError, sqlite3.Error, ValueError, TypeError, KeyError) as error:
        print(dumps({"ok": False, "error": "receiver_failed", "message": str(error)}), file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
