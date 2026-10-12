"""MIT. FHIR Bulk Data operations and portable receiving on the original SF30 Workspace."""
from __future__ import annotations

from contextlib import contextmanager
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import stat
import time
import uuid
import zipfile

import fhir_source as source
from fhir_runtime import original_workspace, original_server, InputError, MAX_SOURCE
from fhir_acquisition import (Acquisition, Credentials, ConflictError, ProviderError, atomic_json,
    private_directory, safe_read, now, write_zip, OPERATION_SCHEMA)

HERE = Path(__file__).resolve().parent
WORKSPACE_PACKET = "stellar-forge.fhir-bulk-workspace-packet.v1"
MAX_WORKSPACE_PACKET = 2 * MAX_SOURCE
MAX_REGISTRY = 64 * 1024 * 1024
RECORD_KINDS = {"connections", "exports", "observations", "discoveries", "groupPages", "operations", "compositions", "receives"}
FORMAT = original_workspace.SourceFormat("fhir-bulk", "FHIR Bulk Data", source.inventory,
    source.validate_plan, source.extract, source.dataset_spec)


def record_id(kind, ident):
    if kind not in RECORD_KINDS:
        raise InputError("Unknown retained FHIR record collection")
    return source.operation_id(ident) if kind == "operations" else source.identity(ident)


def public_row(row):
    return {key: value for key, value in row.items() if key != "_resource" and not key.startswith("_")}


def archive_member(name):
    source.text(name, "Workspace member", 512, False)
    if name.startswith("/") or "\\" in name or any(part in {"", ".", ".."} for part in name.split("/")) or \
       not re.fullmatch(r"[A-Za-z0-9_./-]+", name):
        raise InputError("Unsafe original workspace member")
    return name


class Workspace(original_workspace.Workspace):
    def __init__(self, root, create=False, credentials_file=None):
        super().__init__(root, create=create, source_format=FORMAT)
        try:
            self.credentials = Credentials(credentials_file)
            private_directory(self.root / "fhir")
            private_directory(self.root / "fhir" / "indexes")
            identity_path = self.root / "fhir" / "identity.json"
            if not identity_path.exists():
                original_workspace.private_write(identity_path, source.jbytes({
                    "schema": self.version, "workspaceId": str(uuid.uuid4())}))
            identity_value = source.json_value(safe_read(identity_path, 4096))
            if identity_value.get("schema") != self.version:
                raise InputError("Original FHIR workspace identity has a different schema")
            self.workspace_id = str(uuid.UUID(identity_value["workspaceId"]))
            if self.workspace_id != identity_value["workspaceId"]:
                raise InputError("Original workspace ID must retain its exact native UUID")
            self.db.executescript("""
                CREATE TABLE IF NOT EXISTS fhir_records(
                    kind TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,created TEXT NOT NULL,
                    PRIMARY KEY(kind,id));
            """)
            self.acquisition = Acquisition(self, self.credentials)
        except Exception:
            super().close()
            raise

    def catalogue(self):
        return source.json_value((HERE / "catalogue.json").read_bytes())

    def auth_profiles(self):
        return self.credentials.public()

    def _get(self, kind, ident, required=True):
        ident = record_id(kind, ident)
        with self.mutex:
            row = self.db.execute("SELECT body FROM fhir_records WHERE kind=? AND id=?", (kind, ident)).fetchone()
            if row is None:
                if required:
                    raise InputError("Unknown retained " + kind + " record")
                return None
            return source.json_value(row[0])

    def _list(self, kind):
        if kind not in RECORD_KINDS:
            raise InputError("Unknown retained FHIR collection")
        with self.mutex:
            return [source.json_value(row[0]) for row in self.db.execute(
                "SELECT body FROM fhir_records WHERE kind=? ORDER BY created DESC,id", (kind,))]

    def _put(self, kind, ident, body, immutable=True):
        ident = record_id(kind, ident)
        data = source.jbytes(body)
        if len(data) > MAX_REGISTRY:
            raise InputError("Retained operation record exceeds the supported 64 MiB budget")
        with self.mutex:
            existing = self.db.execute("SELECT body FROM fhir_records WHERE kind=? AND id=?", (kind, ident)).fetchone()
            if existing:
                if existing[0].encode() == data:
                    return body
                if immutable:
                    raise ConflictError("A retained original content identity already has another body")
            with self.db:
                self.db.execute("INSERT INTO fhir_records VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body",
                    (kind, ident, data.decode(), body.get("createdAt") or now()))
            return body

    def state(self):
        with self.mutex:
            # Complete a durable file-first operation save after a process restart.
            for path in self.acquisition.operations.iterdir():
                if path.is_dir() and not path.is_symlink() and (path / "operation.json").exists():
                    self.acquisition.operation(path.name)
            result = super().state()
            result["workspaceId"] = self.workspace_id
            result["connections"] = self._list("connections")
            result["exports"] = self._list("exports")
            result["discoveries"] = [{key: row.get(key) for key in
                ["id", "connectionId", "fhirVersion", "resourceTypes", "createdAt"]} for row in self._list("discoveries")]
            result["groupPages"] = [{key: row.get(key) for key in
                ["id", "connectionId", "count", "nextUrl", "createdAt"]} for row in self._list("groupPages")]
            result["operations"] = []
            for row in self._list("operations"):
                item = {key: row.get(key) for key in ["operationId", "exportId", "connectionId", "state", "phase",
                    "createdAt", "updatedAt", "notBefore", "progress", "sourceId", "error"]}
                item["fileCount"] = len(row["files"])
                item["completedFiles"] = sum(f["state"] == "complete" for f in row["files"])
                item["receivedBytes"] = sum(f["bytes"] for f in row["files"])
                result["operations"].append(item)
            result["compositions"] = self._list("compositions")
            result["receives"] = [{key: row.get(key) for key in
                ["id", "state", "archiveSha256", "createdAt", "updatedAt"]} for row in self._list("receives")]
            return result

    def save_connection(self, body):
        connection = source.validate_connection(body)
        ident = source.sha(source.jbytes(connection))
        existing = self._get("connections", ident, required=False)
        if existing:
            return existing
        result = {"id": ident, "connection": connection, "createdAt": now()}
        return self._put("connections", ident, result)

    def connection(self, ident):
        result = self._get("connections", ident)
        if source.sha(source.jbytes(source.validate_connection(result["connection"]))) != ident:
            raise InputError("Original connection content identity changed")
        return result

    def discover(self, connection_id):
        with self.mutex:
            return self.acquisition.discover(connection_id)

    def discovery(self, ident):
        return self._get("discoveries", ident)

    def groups(self, connection_id, url=None):
        with self.mutex:
            return self.acquisition.groups(connection_id, url)

    def group_page(self, ident):
        return self._get("groupPages", ident)

    def save_export(self, body):
        if not isinstance(body, dict):
            raise InputError("Expected an original export definition")
        connection = self.connection(body.get("connectionId"))["connection"]
        export = source.validate_export(body, connection)
        ident = source.sha(source.jbytes(export))
        existing = self._get("exports", ident, required=False)
        if existing:
            return existing
        return self._put("exports", ident, {"id": ident, "export": export, "createdAt": now()})

    def export_plan(self, ident):
        result = self._get("exports", ident)
        value = source.validate_export(result["export"], self.connection(result["export"]["connectionId"])["connection"])
        if source.sha(source.jbytes(value)) != ident:
            raise InputError("Original export definition identity changed")
        return result

    def advance(self, export_id, operation_id):
        return self.acquisition.advance(export_id, operation_id)

    def operation(self, operation_id):
        with self.mutex:
            return self.acquisition.operation(operation_id)

    def adopt_status(self, operation_id, body):
        return self.acquisition.adopt_status(operation_id, body)

    def cancel(self, operation_id, request_id):
        return self.acquisition.cancel(operation_id, request_id)

    def source_path(self, ident):
        self.source(ident)
        path = self.root / "sources" / (source.identity(ident) + "." + self.kind)
        if original_workspace.file_digest(path) != ident:
            raise InputError("Original retained FHIR source bytes changed")
        return path

    def source_members(self, ident):
        with self.mutex, self.source_path(ident).open("rb") as stream, source.Packet(stream) as packet:
            result = [{"name": "manifest.json", "bytes": packet.infos["manifest.json"].file_size,
                       "sha256": source.sha(packet.archive.read("manifest.json")), "role": "source-manifest"}]
            for name, descriptor in packet.members.items():
                packet.verify(name)
                result.append(dict(descriptor))
                if packet.mode == "materialized":
                    with packet.open(name) as nested_stream, source.Packet(nested_stream) as nested:
                        result.append({"name": name + "!/manifest.json", "bytes": nested.infos["manifest.json"].file_size,
                                       "sha256": source.sha(nested.archive.read("manifest.json")), "role": "source-manifest"})
                        for inner_name, inner in nested.members.items():
                            nested.verify(inner_name)
                            result.append({**inner, "name": name + "!/" + inner_name})
            return result

    @contextmanager
    def open_source_member(self, ident, name):
        with self.mutex, self.source_path(ident).open("rb") as stream, source.Packet(stream) as packet:
            with packet.open(name) as original:
                yield original

    def _index(self, ident):
        original = self.source_path(ident)
        target = self.root / "fhir" / "indexes" / (ident + ".sqlite")
        if target.exists():
            original_workspace.regular(target, 4 * MAX_SOURCE)
            db = sqlite3.connect("file:" + str(target) + "?mode=ro", uri=True)
            try:
                value = db.execute("SELECT source_id,format FROM meta").fetchone()
                if value != (ident, "stellar-forge.fhir-bulk-resource-index.v1"):
                    raise InputError("Rebuildable original resource index has another source identity")
            finally:
                db.close()
            return target
        with self.scratch() as temporary:
            staged = temporary / "resources.sqlite"
            original_workspace.private_write(staged, b"")
            db = sqlite3.connect(staged)
            try:
                db.executescript("""PRAGMA journal_mode=OFF;
                    CREATE TABLE meta(source_id TEXT,format TEXT);
                    CREATE TABLE resources(
                        n INTEGER PRIMARY KEY,file_id TEXT NOT NULL,line INTEGER NOT NULL,
                        resource_type TEXT NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL,json_text TEXT NOT NULL,
                        UNIQUE(file_id,line));
                    CREATE INDEX by_source_type ON resources(kind,resource_type,n);
                """)
                db.execute("INSERT INTO meta VALUES(?,?)", (ident, "stellar-forge.fhir-bulk-resource-index.v1"))
                with original.open("rb") as stream, source.Packet(stream) as packet:
                    count = 0
                    for row in packet.records():
                        if row.get("_blank"):
                            continue
                        count += 1
                        value = public_row(row)
                        body = source.jbytes(value).decode()
                        db.execute("INSERT INTO resources VALUES(?,?,?,?,?,?,?)",
                            (count, row["fileId"], row["line"], row["resourceType"], row["kind"], body, row["jsonText"]))
                        if count % 512 == 0 and staged.stat().st_size > 4 * MAX_SOURCE:
                            raise InputError("Rebuildable source row index exceeds its supported working-file budget")
                db.commit()
            finally:
                db.close()
            if staged.stat().st_size > 4 * MAX_SOURCE:
                raise InputError("Rebuildable source row index exceeds its supported working-file budget")
            with staged.open("rb") as stream:
                os.fsync(stream.fileno())
            os.replace(staged, target)
            original_workspace.sync_dir(target.parent)
        return target

    def source_rows(self, ident, resource_type=None, kind="output", offset=0, limit=50, query=""):
        ident = source.identity(ident)
        source.integer(offset, 0, source.MAX_ROWS, "Source row offset")
        source.integer(limit, 1, 250, "Source row page size")
        source.text(query, "Source text filter", 4096)
        if kind not in {"output", "error", "deleted", "all", None}:
            raise InputError("Choose original output, error, deleted or all rows")
        if resource_type is not None and (not isinstance(resource_type, str) or not source.RESOURCE_TYPE.fullmatch(resource_type)):
            raise InputError("Choose a literal original FHIR resource type")
        with self.mutex:
            path = self._index(ident)
            clauses, args = [], []
            if kind not in {None, "all"}:
                clauses.append("kind=?")
                args.append(kind)
            if resource_type:
                clauses.append("resource_type=?")
                args.append(resource_type)
            if query:
                clauses.append("instr(lower(json_text),lower(?))>0")
                args.append(query)
            condition = " WHERE " + " AND ".join(clauses) if clauses else ""
            db = sqlite3.connect("file:" + str(path) + "?mode=ro", uri=True)
            try:
                total = db.execute("SELECT COUNT(*) FROM resources" + condition, args).fetchone()[0]
                rows, size = [], 0
                for (body,) in db.execute("SELECT body FROM resources" + condition + " ORDER BY n LIMIT ? OFFSET ?",
                                          args + [limit, offset]):
                    count = len(body.encode())
                    if rows and size + count > 16 * 1024 * 1024:
                        break
                    rows.append(source.json_value(body))
                    size += count
            finally:
                db.close()
            return {"sourceId": ident, "resourceType": resource_type, "kind": kind, "rows": rows,
                    "total": total, "offset": offset,
                    "nextOffset": offset + len(rows) if offset + len(rows) < total else None,
                    "pageBytes": size, "pageByteBudget": 16 * 1024 * 1024}

    def source_row(self, ident, file_id, line):
        source.text(file_id, "Original file identity", 129, False)
        if not re.fullmatch(r"[0-9a-f]{64}(?::[0-9a-f]{64})?", file_id):
            raise InputError("Choose the original source file identity")
        source.integer(line, 1, source.MAX_ROWS, "Original physical NDJSON line")
        with self.mutex:
            db = sqlite3.connect("file:" + str(self._index(source.identity(ident))) + "?mode=ro", uri=True)
            try:
                row = db.execute("SELECT body FROM resources WHERE file_id=? AND line=?", (file_id, line)).fetchone()
                if not row:
                    raise InputError("Unknown original resource file/line")
                return source.json_value(row[0])
            finally:
                db.close()

    def default_mapping(self, source_id, resource_type, name=None):
        return source.default_mapping(self.source(source_id)["inventory"], resource_type, name)

    def projection_preview(self, source_id, plan, limit=25):
        plan = source.validate_plan(plan)
        source.integer(limit, 1, 250, "Preview row limit")
        rows, size = [], 0
        def receive(ordinal, cells, values):
            nonlocal size
            row = {"ordinal": ordinal, "cells": cells, "values": values}
            count = len(source.jbytes(row))
            if len(rows) < limit and (not rows or size + count <= 4 * 1024 * 1024):
                rows.append(row)
                size += count
        with self.mutex, self.source_path(source_id).open("rb") as stream:
            total = source.extract(stream, plan, receive)
        return {"columns": plan["columns"], "rows": rows, "totalRows": total, "previewRows": len(rows),
                "previewBytes": size, "previewByteBudget": 4 * 1024 * 1024}

    def compose(self, body):
        source.exact(body, {"baseSourceId", "deltaSourceIds", "label", "resolutions"}, "Original resource composition")
        base_id = source.identity(body.get("baseSourceId"))
        deltas = body.get("deltaSourceIds")
        if not isinstance(deltas, list) or not 1 <= len(deltas) <= 32:
            raise InputError("Choose 1–32 original modification exports in their reviewed order")
        ids = [base_id] + [source.identity(item) for item in deltas]
        if len(set(ids)) != len(ids):
            raise InputError("A composition cannot apply an original capture twice")
        label = source.text(body.get("label", "Retained FHIR resource state"), "Composition label", 160, False)
        selection = {"baseSourceId": base_id, "deltaSourceIds": list(deltas),
                     "label": label, "resolutions": body.get("resolutions", [])}
        with self.mutex, self.scratch() as temporary:
            members, captures = {}, []
            first, latest = None, None
            for ident in ids:
                path = self.source_path(ident)
                with path.open("rb") as stream, source.Packet(stream) as packet:
                    if packet.mode != "capture":
                        raise InputError("Select the complete original captures; a materialized source is not a new provider export")
                    retained = {"connection": packet.connection, "export": packet.export,
                                "transactionTime": packet.manifest["transactionTime"]}
                if first is None:
                    first = retained
                latest = retained
                name = "captures/" + ident + ".zip"
                captures.append({"sourceId": ident, "name": name, "sha256": ident, "bytes": path.stat().st_size})
                members[name] = path
            manifest = {"schema": source.SOURCE_SCHEMA, "mode": "materialized",
                "connection": first["connection"], "export": first["export"],
                "transactionTime": latest["transactionTime"], "captures": captures, "composition": selection}
            members["manifest.json"] = source.jbytes(manifest)
            if sum(len(item) if isinstance(item, bytes) else item.stat().st_size for item in members.values()) > MAX_SOURCE:
                raise InputError("All original captures in the retained composition must fit its 256 MiB source budget")
            path = temporary / "materialized-source.zip"
            write_zip(path, members)
            with path.open("rb") as stream:
                retained = self.add_source(stream, label, "fhir-retained-resource-state.zip")
            composition = {"id": retained["id"], "sourceId": retained["id"], **selection, "createdAt": now()}
            existing = self._get("compositions", retained["id"], required=False)
            if existing:
                composition = existing
            else:
                self._put("compositions", retained["id"], composition)
            return {"source": retained, "composition": composition}



    def export_dataset(self, build_id, destination):
        with self.mutex:
            view = self.build_view(build_id)
            plan = self.plan(view["plan"])
            shape = self.source(view["source"])["inventory"]
            with self.source_path(view["source"]).open("rb") as stream, source.Packet(stream) as packet:
                scope = source.scope_identity(packet.export)
            family_definition = {"sourceScope": scope, "planId": view["plan"], "resourceType": plan["resourceType"]}
            family = {"id": source.sha(source.jbytes(family_definition)), "title": plan["name"], **family_definition}
            lineage = {"schema": "stellar-forge.fhir-bulk-lineage.v1", "family": family,
                "snapshot": view["native"]["snapshot"], "build": view,
                "files": {name: view["files"][name] for name in ["data.csv", "dataset.json"]},
                "classification": shape["classification"], "sources": shape["captures"],
                "selection": {"sourceId": view["source"], "planId": view["plan"],
                    "resourceType": plan["resourceType"], "coverage": shape["coverage"],
                    "composition": shape["composition"]}}
            result = super().export_dataset(build_id, destination)
            try:
                atomic_json(Path(result["directory"]) / self.lineage_name, lineage)
            except Exception:
                shutil.rmtree(result["directory"])
                raise
            return {**result, "lineage": str(Path(result["directory"]) / self.lineage_name), "family": family}

    def _portable_registry(self):
        current = self.state()
        return {"schema": WORKSPACE_PACKET, "workspaceId": self.workspace_id,
            "sources": [self.source(item["id"]) for item in current["sources"]],
            "plans": [{"id": item["id"], "plan": self.plan(item["id"]), "created": item["created"]} for item in current["plans"]],
            "builds": current["builds"], "comparisons": current["comparisons"],
            "records": {kind: self._list(kind) for kind in sorted(RECORD_KINDS - {"receives"})},
            "implementation": {"kind": self.kind, "workspaceSchema": self.version,
                               "sourceSchema": source.SOURCE_SCHEMA, "mappingSchema": source.PLAN_SCHEMA}}

    def export_workspace(self, output_path):
        output_path = Path(output_path).expanduser().absolute()
        if output_path.exists():
            raise ConflictError("Choose a new output file for the complete original workspace")
        with self.mutex:
            registry = self._portable_registry()
            registry_bytes = source.jbytes(registry)
            if len(registry_bytes) > MAX_REGISTRY:
                raise InputError("The complete original workspace registry exceeds 64 MiB")
            members = {"registry.json": registry_bytes}
            for item in registry["sources"]:
                members["sources/" + item["id"] + ".zip"] = self.source_path(item["id"])
            for item in registry["builds"]:
                for name in ["data.csv", "dataset.json", "review.json"]:
                    members["builds/" + item["id"] + "/" + name] = self._build_path(item["id"], name)
            for item in registry["comparisons"]:
                members["comparisons/" + item["id"] + "/changes.jsonl"] = self.comparison_file(item["id"])
            for kind in ["operations", "observations"]:
                directory = self.root / "fhir" / kind
                for parent, folders, files in os.walk(directory, followlinks=False):
                    for folder in folders:
                        child = Path(parent) / folder
                        if child.is_symlink():
                            raise InputError("Retained source custody contains an unsupported symlink")
                    for filename in files:
                        path = Path(parent) / filename
                        original_workspace.regular(path, MAX_SOURCE)
                        relative = str(path.relative_to(self.root)).replace(os.sep, "/")
                        members["files/" + archive_member(relative)] = path
            if len(members) > 65535:
                raise InputError("Complete workspace exceeds its supported member-count budget")
            descriptors, total = {}, 0
            for name, value in members.items():
                archive_member(name)
                if isinstance(value, bytes):
                    item = {"bytes": len(value), "sha256": source.sha(value)}
                else:
                    item = {"bytes": value.stat().st_size,
                            "sha256": original_workspace.file_digest(value, MAX_WORKSPACE_PACKET)}
                total += item["bytes"]
                if total > MAX_WORKSPACE_PACKET:
                    raise InputError("The complete retained workspace exceeds the supported 512 MiB receiving archive")
                descriptors[name] = item
            manifest = {"schema": WORKSPACE_PACKET, "workspaceId": self.workspace_id, "files": descriptors,
                        "registrySha256": descriptors["registry.json"]["sha256"],
                        "totalBytes": total, "fileCount": len(descriptors)}
            members["manifest.json"] = source.jbytes(manifest)
            # The original source packet writer permits all safe relative names;
            # whole-workspace paths remain under the same 256-byte native member budget.
            write_zip(output_path, members)
            size = output_path.stat().st_size
            if size > MAX_WORKSPACE_PACKET:
                output_path.unlink()
                raise InputError("Complete workspace ZIP exceeds the supported 512 MiB transfer size")
            return {"schema": WORKSPACE_PACKET, "workspaceId": self.workspace_id, "file": str(output_path),
                    "bytes": size, "sha256": original_workspace.file_digest(output_path, MAX_WORKSPACE_PACKET)}

    def _validate_registry(self, registry):
        source.exact(registry, {"schema", "workspaceId", "sources", "plans", "builds", "comparisons", "records", "implementation"},
                     "Complete workspace registry")
        if registry.get("schema") != WORKSPACE_PACKET or str(uuid.UUID(registry.get("workspaceId"))) != registry["workspaceId"]:
            raise InputError("Unsupported original workspace receiving identity")
        implementation = registry.get("implementation", {})
        if implementation != {"kind": self.kind, "workspaceSchema": self.version,
                               "sourceSchema": source.SOURCE_SCHEMA, "mappingSchema": source.PLAN_SCHEMA}:
            raise InputError("Workspace receiving needs the matching original FHIR SourceFormat")
        for key in ["sources", "plans", "builds", "comparisons"]:
            rows = registry.get(key)
            if not isinstance(rows, list) or len(rows) > 32768 or any(not isinstance(row, dict) for row in rows):
                raise InputError("Invalid complete " + key + " receiving registry")
            ids = [source.identity(row.get("id")) for row in rows]
            if len(set(ids)) != len(ids):
                raise InputError("Workspace repeats an original " + key + " identity")
        records = registry.get("records")
        if not isinstance(records, dict) or set(records) != RECORD_KINDS - {"receives"}:
            raise InputError("Workspace receiving must include the complete retained operation collections")
        for kind, rows in records.items():
            if not isinstance(rows, list) or len(rows) > 32768 or any(not isinstance(row, dict) for row in rows):
                raise InputError("Invalid original " + kind + " collection")
            ids = [record_id(kind, row.get("operationId") if kind == "operations" else row.get("id")) for row in rows]
            if len(set(ids)) != len(ids):
                raise InputError("Workspace repeats a retained " + kind + " identity")
        connections = {}
        for row in records["connections"]:
            value = source.validate_connection(row.get("connection"))
            if source.sha(source.jbytes(value)) != row["id"]:
                raise InputError("Received connection content ID differs from its original definition")
            connections[row["id"]] = value
        exports = {}
        for row in records["exports"]:
            raw = row.get("export")
            if not isinstance(raw, dict) or raw.get("connectionId") not in connections:
                raise InputError("Received export lost its complete original connection")
            value = source.validate_export(raw, connections[raw["connectionId"]])
            if source.sha(source.jbytes(value)) != row["id"]:
                raise InputError("Received export content ID differs from its exact native request")
            exports[row["id"]] = value
        source_ids = {row["id"] for row in registry["sources"]}
        plan_ids = set()
        for row in registry["plans"]:
            body = source.validate_plan(row.get("plan"))
            if source.sha(source.jbytes(body)) != row["id"]:
                raise InputError("Received mapping changed its original native content ID")
            plan_ids.add(row["id"])
        builds = {}
        for row in registry["builds"]:
            if row.get("source") not in source_ids or row.get("plan") not in plan_ids or row.get("schema") != self.build_schema:
                raise InputError("Received dataset lost its original source or reviewed mapping")
            expected = source.sha(source.jbytes({"schema": self.build_schema, "source": row["source"], "plan": row["plan"]}))
            if expected != row["id"]:
                raise InputError("Received dataset content ID differs from its original source and mapping")
            builds[row["id"]] = row
        for row in registry["comparisons"]:
            if row.get("before") not in builds or row.get("after") not in builds:
                raise InputError("Received comparison lost one of its original native editions")
        for row in records["operations"]:
            if row.get("schema") != OPERATION_SCHEMA or row.get("exportId") not in exports:
                raise InputError("Received native operation lost its original request")
            export = exports[row["exportId"]]
            if row.get("connectionId") != export["connectionId"] or row.get("requestSha256") != export["request"]["requestSha256"]:
                raise InputError("Received native operation is bound to another request")
            if row.get("sourceId") and row["sourceId"] not in source_ids:
                raise InputError("Received completed operation omitted its original source packet")
            if row.get("state") not in set(self.catalogue()["operationStates"]):
                raise InputError("Unsupported retained native operation state")
            if not isinstance(row.get("files"), list) or len(row["files"]) > export["limits"]["maxFiles"]:
                raise InputError("Received native operation has an invalid original file manifest")
            for item in row["files"]:
                source.identity(item.get("id"))
                source.http_url(item.get("url"))
                if item.get("state") == "complete":
                    source.identity(item.get("sha256"))
                    source.integer(item.get("bytes"), 0, MAX_SOURCE, "Received original file bytes")
        for row in records["compositions"]:
            if row.get("sourceId") != row["id"] or row["id"] not in source_ids or row.get("baseSourceId") not in source_ids or \
               any(ident not in source_ids for ident in row.get("deltaSourceIds", [])):
                raise InputError("Received retained-resource state omitted an original capture")
        for kind in ["observations", "discoveries", "groupPages"]:
            for row in records[kind]:
                if row.get("connectionId") not in connections or source.sha(source.jbytes(
                    {key: value for key, value in row.items() if key != "id"})) != row["id"]:
                    raise InputError("Received " + kind + " changed its original observed content identity")
        return registry

    def import_workspace(self, packet_path):
        path = Path(packet_path).expanduser().absolute()
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or path.is_symlink() or info.st_size > MAX_WORKSPACE_PACKET:
            raise InputError("Select one complete regular FHIR workspace ZIP within 512 MiB")
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            while block := stream.read(65536):
                digest.update(block)
        archive_id = digest.hexdigest()
        with self.mutex:
            previous = self._get("receives", archive_id, required=False)
            active = [record for record in self._list("receives") if record["state"] != "complete"]
            if active and any(record["id"] != archive_id for record in active):
                raise ConflictError("Resume the identical retained workspace archive before receiving another")
            if previous is None:
                existing = self.state()
                if any(existing[key] for key in ["sources", "plans", "builds", "comparisons", "connections", "exports", "operations"]) or \
                   any(self._list(kind) for kind in ["discoveries", "groupPages", "observations", "compositions"]):
                    raise ConflictError("A complete workspace is received into a fresh empty workspace")
            elif previous["state"] == "complete":
                return {"workspaceId": self.workspace_id, "reconstructed": True, "state": self.state(),
                        "archiveSha256": archive_id, "recovered": True}
            with self.scratch() as temporary, zipfile.ZipFile(path) as archive:
                infos = archive.infolist()
                if not 2 <= len(infos) <= 65536 or len({item.filename for item in infos}) != len(infos):
                    raise InputError("Workspace ZIP has duplicate or too many original members")
                sizes, total = {}, 0
                for item in infos:
                    archive_member(item.filename)
                    mode = item.external_attr >> 16
                    if item.is_dir() or item.flag_bits & 1 or stat.S_ISLNK(mode) or item.compress_type not in \
                       {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}:
                        raise InputError("Unsupported original workspace ZIP entry")
                    total += item.file_size
                    if item.file_size > MAX_WORKSPACE_PACKET or total > MAX_WORKSPACE_PACKET + MAX_REGISTRY:
                        raise InputError("The complete receiving workspace exceeds its supported original-byte budget")
                    sizes[item.filename] = item.file_size
                if "manifest.json" not in sizes or sizes["manifest.json"] > MAX_REGISTRY or \
                   "registry.json" not in sizes or sizes["registry.json"] > MAX_REGISTRY:
                    raise InputError("Whole workspace ZIP requires its complete bounded manifest and registry")
                manifest = source.json_value(archive.read("manifest.json"))
                source.exact(manifest, {"schema", "workspaceId", "files", "registrySha256", "totalBytes", "fileCount"},
                             "Workspace transfer manifest")
                if manifest.get("schema") != WORKSPACE_PACKET or not isinstance(manifest.get("files"), dict) or \
                   set(manifest["files"]) != set(sizes) - {"manifest.json"}:
                    raise InputError("Whole workspace member set differs from its original manifest")
                if manifest.get("fileCount") != len(manifest["files"]) or \
                   manifest.get("totalBytes") != sum(sizes[name] for name in manifest["files"]):
                    raise InputError("Whole workspace original size/count differs from its manifest")
                staged = {}
                for name, expected in manifest["files"].items():
                    source.exact(expected, {"bytes", "sha256"}, "Original workspace member identity")
                    source.identity(expected.get("sha256"))
                    if expected.get("bytes") != sizes[name]:
                        raise InputError("Original workspace member length differs")
                    target = temporary / ("member-" + source.sha(name.encode()))
                    with archive.open(name) as inp, os.fdopen(os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as out:
                        received, checksum = 0, hashlib.sha256()
                        while block := inp.read(65536):
                            received += len(block)
                            if received > expected["bytes"]:
                                raise InputError("Original workspace member exceeded its declared bytes")
                            checksum.update(block)
                            out.write(block)
                        out.flush()
                        os.fsync(out.fileno())
                    if received != expected["bytes"] or checksum.hexdigest() != expected["sha256"]:
                        raise InputError("Original workspace member failed its complete byte identity")
                    staged[name] = target
                if manifest["registrySha256"] != manifest["files"]["registry.json"]["sha256"]:
                    raise InputError("Original workspace registry identity changed")
                registry = self._validate_registry(source.json_value(safe_read(staged["registry.json"], MAX_REGISTRY)))
                if registry["workspaceId"] != manifest["workspaceId"]:
                    raise InputError("Workspace receiving identity differs between manifest and registry")
                required = {"registry.json"}
                for item in registry["sources"]:
                    name = "sources/" + item["id"] + ".zip"
                    required.add(name)
                    if name not in manifest["files"] or manifest["files"][name]["sha256"] != item["id"]:
                        raise InputError("Workspace omitted or changed an exact original source packet")
                for item in registry["builds"]:
                    for leaf in ["data.csv", "dataset.json", "review.json"]:
                        name = "builds/" + item["id"] + "/" + leaf
                        required.add(name)
                        if name not in staged:
                            raise InputError("Workspace omitted an original completed dataset member")
                        if leaf != "review.json" and manifest["files"][name] != item["files"][leaf]:
                            raise InputError("Original dataset bytes differ from the complete native review")
                        if leaf == "review.json" and source.json_value(safe_read(staged[name])) != item:
                            raise InputError("Original build review differs from the receiving registry")
                for item in registry["comparisons"]:
                    name = "comparisons/" + item["id"] + "/changes.jsonl"
                    required.add(name)
                    if name not in staged or manifest["files"][name]["sha256"] != item["changesSha256"]:
                        raise InputError("Workspace omitted its complete original comparison")
                extras = set(staged) - required
                for name in extras:
                    if not name.startswith(("files/fhir/operations/", "files/fhir/observations/")):
                        raise InputError("Whole workspace contains an undeclared native/private member")
                    relative = name[len("files/"):]
                    components = relative.split("/")
                    if len(components) < 4:
                        raise InputError("Invalid original operation custody path")
                    if components[1] == "operations":
                        source.operation_id(components[2])
                    elif not re.fullmatch(r"[0-9a-f]{32}", components[2]):
                        raise InputError("Invalid original discovery custody path")
                if not required.issubset(staged):
                    raise InputError("Whole workspace omitted declared original members")
                if previous is None:
                    previous = {"id": archive_id, "archiveSha256": archive_id, "state": "receiving",
                        "workspaceId": registry["workspaceId"], "createdAt": now(), "updatedAt": now(),
                        "completed": [], "error": None}
                    self._put("receives", archive_id, previous)
                elif previous.get("workspaceId") != registry["workspaceId"]:
                    raise ConflictError("Retained receiving UUID is bound to another workspace")
                def checkpoint(step):
                    if step not in previous["completed"]:
                        previous["completed"].append(step)
                    previous["updatedAt"], previous["error"] = now(), None
                    self._put("receives", archive_id, previous, immutable=False)
                try:
                    atomic_json(self.root / "fhir" / "identity.json", {"schema": self.version, "workspaceId": registry["workspaceId"]})
                    self.workspace_id = registry["workspaceId"]
                    for name in sorted(extras):
                        destination = self.root / name[len("files/"):]
                        parent = self.root
                        for component in destination.relative_to(self.root).parts[:-1]:
                            parent = private_directory(parent / component)
                        if destination.exists():
                            if original_workspace.file_digest(destination, MAX_WORKSPACE_PACKET) != manifest["files"][name]["sha256"]:
                                raise ConflictError("Receiving native custody path already contains different original bytes")
                        else:
                            temporary_file = destination.with_name("." + destination.name + "." + uuid.uuid4().hex)
                            with staged[name].open("rb") as inp, os.fdopen(os.open(temporary_file,
                                 os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as out:
                                shutil.copyfileobj(inp, out, 65536)
                                out.flush()
                                os.fsync(out.fileno())
                            os.replace(temporary_file, destination)
                            original_workspace.sync_dir(destination.parent)
                        checkpoint("file:" + name)
                    for kind in ["connections", "exports", "observations", "discoveries", "groupPages"]:
                        for row in registry["records"][kind]:
                            self._put(kind, row["id"], row)
                            checkpoint(kind + ":" + row["id"])
                    for row in registry["sources"]:
                        with staged["sources/" + row["id"] + ".zip"].open("rb") as stream:
                            received = self.add_source(stream, row["label"], row["name"])
                        if received["id"] != row["id"] or received["bytes"] != row["bytes"] or received["inventory"] != row["inventory"]:
                            raise InputError("Original source inventory differs after complete reconstruction")
                        with self.db:
                            self.db.execute("UPDATE sources SET created=? WHERE id=?", (row["created"], row["id"]))
                        checkpoint("source:" + row["id"])
                    for row in registry["plans"]:
                        received = self.save_plan(row["plan"])
                        if received["id"] != row["id"]:
                            raise InputError("Original mapping changed during reconstruction")
                        with self.db:
                            self.db.execute("UPDATE plans SET created=? WHERE id=?", (row["created"], row["id"]))
                        checkpoint("plan:" + row["id"])
                    for row in registry["builds"]:
                        received = self.build(row["source"], row["plan"], expected=row)
                        if received["id"] != row["id"]:
                            raise InputError("Original native build changed during complete receiving")
                        checkpoint("build:" + row["id"])
                    for row in registry["comparisons"]:
                        received = self.compare(row["before"], row["after"])
                        if received != row:
                            raise InputError("Original edition comparison changed after native reconstruction")
                        checkpoint("comparison:" + row["id"])
                    for kind in ["compositions", "operations"]:
                        for row in registry["records"][kind]:
                            ident = row.get("operationId") if kind == "operations" else row["id"]
                            if kind == "operations":
                                native_file = self.acquisition.directory(ident) / "operation.json"
                                if not native_file.exists() or source.json_value(safe_read(native_file)) != row:
                                    raise InputError("Received operation registry differs from its original durable operation file")
                            self._put(kind, ident, row)
                            checkpoint(kind + ":" + ident)
                    previous["state"], previous["updatedAt"] = "complete", now()
                    self._put("receives", archive_id, previous, immutable=False)
                    return {"workspaceId": self.workspace_id, "reconstructed": True, "archiveSha256": archive_id,
                            "state": self.state()}
                except Exception as error:
                    previous["error"], previous["updatedAt"] = str(error), now()
                    self._put("receives", archive_id, previous, immutable=False)
                    raise
