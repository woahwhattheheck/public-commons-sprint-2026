"""MIT. Retained eLTSS sources, scoped graphs and complete original operator state."""
from __future__ import annotations
from contextlib import contextmanager
import hashlib
import os
from pathlib import Path
import shutil
import uuid

from eltss_runtime import (original_workspace, original_server, InputError, ConflictError, ProviderError,
    MAX_SOURCE, Credentials, atomic_json, safe_read, private_directory, now, fhir)
import eltss_source as source
from eltss_validation import catalogue as installed_catalogue
from eltss_graph import SourceIndex, Resolution, graph_document, public_row, values_at
from eltss_acquisition import Acquisition, connection_value, request_value
from eltss_review import ReviewMixin
from eltss_receiving import ReceivingMixin

HERE = Path(__file__).resolve().parent
FORMAT = original_workspace.SourceFormat("eltss", "eLTSS care-plan", source.inventory,
    source.validate_plan, source.extract, source.dataset_spec)
MAX_REGISTRY = 64 * 1024 * 1024
WORKSPACE_PACKET = "stellar-forge.eltss-workspace-packet.v1"
RECORD_KINDS = {"connections", "discoveries", "requests", "operations", "graphs", "editions",
    "reviewSets", "assessments", "decisions", "editionComparisons", "correctionPreviews",
    "corrections", "handoffs", "receivings", "artifacts", "receives"}
MUTABLE_KINDS = {"operations", "receives"}


def record_id(kind, ident):
    if kind not in RECORD_KINDS:
        raise InputError("Unknown eLTSS collection")
    return fhir.operation_id(ident) if kind == "operations" else source.identity(ident)


def record_digest(kind, body):
    return source.sha(source.jbytes({"kind": kind, "body":
        {key: value for key, value in body.items() if key not in {"id", "createdAt"}}}))


class Workspace(ReviewMixin, ReceivingMixin, original_workspace.Workspace):
    def __init__(self, root, create=False, credentials_file=None):
        super().__init__(root, create=create, source_format=FORMAT)
        self._closed = False
        try:
            self.credentials = Credentials(credentials_file)
            for name in ["", "indexes", "files", "receives"]:
                private_directory(self.root / "eltss" / name)
            path = self.root / "eltss" / "identity.json"
            if not path.exists():
                original_workspace.private_write(path, source.jbytes({
                    "schema": self.version, "workspaceId": str(uuid.uuid4())}))
            identity = source.json_value(safe_read(path, 4096))
            if identity.get("schema") != self.version:
                raise InputError("Retained eLTSS identity has another workspace schema")
            self.workspace_id = str(uuid.UUID(identity["workspaceId"]))
            if self.workspace_id != identity["workspaceId"]:
                raise InputError("Retain the exact canonical workspace UUID")
            self.db.executescript("""
                CREATE TABLE IF NOT EXISTS eltss_records(
                    kind TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,created TEXT NOT NULL,
                    PRIMARY KEY(kind,id));
            """)
            self.acquisition = Acquisition(self, self.credentials)
        except Exception:
            super().close()
            self._closed = True
            raise

    def close(self):
        with self.mutex:
            if not self._closed:
                self._closed = True
                super().close()

    def catalogue(self):
        return installed_catalogue()

    def profile(self, ident):
        value = source.json_value((HERE / "field-profile.json").read_bytes())
        if value.get("id") != ident or ident not in {p["id"] for p in self.catalogue()["profiles"]}:
            raise InputError("Choose an installed complete source profile")
        if len(value.get("fields", [])) != 56:
            raise InputError("Installed eLTSS profile must retain all 56 source mapping rows")
        return value

    def _save(self, kind, ident, body, immutable=True):
        ident = record_id(kind, ident)
        data = source.jbytes(body)
        if len(data) > MAX_REGISTRY:
            raise InputError("A complete retained operator record exceeds 64 MiB")
        if kind not in MUTABLE_KINDS and (body.get("id") != ident or record_digest(kind, body) != ident):
            raise InputError("Retained content ID differs from its complete authored record")
        with self.mutex:
            old = self.db.execute("SELECT body FROM eltss_records WHERE kind=? AND id=?", (kind, ident)).fetchone()
            if old and old[0].encode() != data and immutable:
                raise ConflictError("An original saved content ID already has another complete body")
            if old and old[0].encode() == data:
                return source.json_value(old[0])
            with self.db:
                self.db.execute("""INSERT INTO eltss_records VALUES(?,?,?,?)
                    ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body""",
                    (kind, ident, data.decode(), body.get("createdAt") or now()))
            return body

    def _store(self, kind, body):
        if kind in MUTABLE_KINDS or "id" in body or "createdAt" in body:
            raise InputError("Immutable record input must leave its retained identity and creation time to the workspace")
        ident = record_digest(kind, body)
        existing = self._get(kind, ident, required=False)
        return existing or self._save(kind, ident, {"id": ident, **body, "createdAt": now()})

    def _get(self, kind, ident, required=True):
        ident = record_id(kind, ident)
        with self.mutex:
            row = self.db.execute("SELECT body FROM eltss_records WHERE kind=? AND id=?", (kind, ident)).fetchone()
            if row is None:
                if required:
                    raise InputError("Unknown retained " + kind + " record")
                return None
            value = source.json_value(row[0])
            if kind not in MUTABLE_KINDS and (value.get("id") != ident or record_digest(kind, value) != ident):
                raise InputError("Original retained record identity was changed")
            return value

    def _list(self, kind):
        if kind not in RECORD_KINDS:
            raise InputError("Unknown retained eLTSS collection")
        with self.mutex:
            return [self._get(kind, row[0]) for row in self.db.execute(
                "SELECT id FROM eltss_records WHERE kind=? ORDER BY created DESC,id", (kind,))]

    def state(self):
        with self.mutex:
            # Recover a completed file-first operation save after process death.
            for path in self.acquisition.operations.iterdir():
                if path.is_dir() and not path.is_symlink() and (path / "operation.json").exists():
                    self.acquisition.operation(path.name)
            result = super().state()
            result["workspaceId"] = self.workspace_id
            result["connections"] = self._list("connections")
            result["requests"] = self._list("requests")
            projections = {
                "discoveries": ["id", "connectionId", "fhirVersion", "kind", "createdAt"],
                "operations": ["operationId", "requestId", "connectionId", "state", "phase", "sourceId",
                    "createdAt", "updatedAt", "notBefore", "receivedBytes", "resourceCount", "pageCount", "queued", "error"],
                "reviewSets": ["id", "label", "profileId", "predecessorId", "fieldCount", "reviewedCount", "actor", "createdAt"],
                "assessments": ["id", "label", "editionId", "reviewSetId", "carePlanIds", "summary", "createdAt"],
                "editionComparisons": ["id", "label", "beforeId", "afterId", "counts", "createdAt"],
                "corrections": ["id", "sourceEditionId", "sourceId", "editionId", "previewId", "actor", "reason", "createdAt"],
                "handoffs": ["id", "label", "editionId", "reviewSetId", "assessmentId", "scope", "receiver",
                    "resourceCount", "requestSha256", "createdAt"],
                "artifacts": ["id", "label", "name", "bytes", "contentType", "createdAt"],
                "receives": ["id", "state", "archiveSha256", "workspaceId", "kind", "createdAt", "updatedAt"]
            }
            for kind, fields in projections.items():
                result[kind] = [{key: row.get(key) for key in fields} for row in self._list(kind)]
            for kind in ["editions", "decisions", "receivings"]:
                result[kind] = self._list(kind)
            return result

    def auth_profiles(self):
        return self.credentials.public()

    def save_connection(self, body):
        with self.mutex:
            return self._store("connections", {"connection": connection_value(body, self.credentials)})

    def connection(self, ident):
        return self._get("connections", ident)

    def discover(self, ident):
        return self.acquisition.discover(ident)

    def discovery(self, ident):
        return self._get("discoveries", ident)

    def save_request(self, body):
        with self.mutex:
            connection = self.connection(body.get("connectionId"))
            discovery = self.discovery(body["discoveryId"]) if body.get("discoveryId") else None
            value = request_value(body, connection["connection"], discovery)
            return self._store("requests", {"request": value})

    def request(self, ident):
        return self._get("requests", ident)

    def advance(self, request_id, operation_id):
        return self.acquisition.advance(request_id, operation_id)

    def operation(self, ident):
        return self.acquisition.operation(ident)

    def pause(self, ident):
        return self.acquisition.pause(ident)

    def resume(self, ident):
        return self.acquisition.resume(ident)

    def source_path(self, ident):
        self.source(ident)
        path = self.root / "sources" / (source.identity(ident) + ".eltss")
        if original_workspace.file_digest(path) != ident:
            raise InputError("Original eLTSS source bytes were changed")
        return path

    def source_members(self, ident):
        with self.mutex, self.source_path(ident).open("rb") as stream, source.Packet(stream) as packet:
            return list(packet.members)

    @contextmanager
    def open_source_member(self, ident, name):
        with self.mutex, self.source_path(ident).open("rb") as stream, source.Packet(stream) as packet:
            with packet.open(name) as member:
                yield member

    @contextmanager
    def _index(self, ident):
        path = self.source_path(ident)
        with SourceIndex(path, self.root / "eltss" / "indexes" / ident, ident) as index:
            yield index

    def source_rows(self, ident, resource_type=None, offset=0, limit=50, query=""):
        with self.mutex, self._index(ident) as index:
            return index.rows(resource_type, offset, limit, query)

    def source_row(self, ident, record_id):
        with self.mutex, self._index(ident) as index:
            return public_row(index.row(record_id))

    def _policy(self, body):
        source.exact(body, {"referencePolicy", "baseUrl", "decisionIds"}, "Original reference policy")
        mode = body.get("referencePolicy", "bundle")
        if mode not in {"bundle", "selected-base"}:
            raise InputError("Choose the original Bundle or explicit selected-base reference policy")
        base = body.get("baseUrl", "")
        if mode == "selected-base":
            base = fhir.http_url(base, "Reviewed reference base", True)
        elif base:
            raise InputError("Original Bundle reference policy does not replace its source base")
        ids = body.get("decisionIds", [])
        if not isinstance(ids, list) or len(ids) > 512 or len(set(ids)) != len(ids):
            raise InputError("Select distinct original decisions within the graph limit")
        return {"referencePolicy": mode, "baseUrl": base, "decisionIds": [source.identity(i) for i in ids]}

    def _graph_decisions(self, source_id, policy):
        decisions, displaced = {}, set()
        records = [self.decision(ident) for ident in policy.get("decisionIds", [])]
        for value in records:
            if value.get("supersedesId"):
                displaced.add(value["supersedesId"])
        for value in records:
            if value["kind"] != "reference" or value["id"] in displaced or value["outcome"] not in {"accepted", "resolved"}:
                continue
            if not any(ref["sourceId"] == source_id for ref in value.get("sourceRefs", [])):
                raise InputError("A reference decision must cite this original source")
            if not value.get("edgeId") or not value.get("selectedRecordId"):
                raise InputError("Applied reference decisions require the original edge and selected candidate")
            if value["edgeId"] in decisions:
                raise InputError("Choose one current reference decision per original edge")
            decisions[value["edgeId"]] = value
        return decisions

    def graph(self, source_id, body):
        with self.mutex:
            policy = self._policy(body)
            decisions = self._graph_decisions(source_id, policy)
            with self._index(source_id) as index, Resolution(index, policy, decisions) as resolved:
                value = graph_document(index, policy, decisions, resolved)
                value["resolutionId"] = resolved.id
                return self._store("graphs", value)

    def graph_view(self, ident):
        return self._get("graphs", ident)

    @contextmanager
    def _graph(self, graph_id):
        graph = self.graph_view(graph_id)
        with self._index(graph["sourceId"]) as index:
            decisions = self._graph_decisions(graph["sourceId"], graph["policy"])
            with Resolution(index, graph["policy"], decisions) as resolved:
                if resolved.id != graph["resolutionId"]:
                    raise InputError("Retained graph no longer matches its original source and decisions")
                yield graph, index, resolved, decisions

    def graph_nodes(self, ident, resource_type=None, offset=0, limit=50, query=""):
        with self.mutex, self._graph(ident) as (graph, index, _, __):
            return {"graphId": ident, **index.rows(resource_type, offset, limit, query)}

    def graph_edges(self, ident, status=None, offset=0, limit=50, query=""):
        with self.mutex, self._graph(ident) as (_, __, resolved, ___):
            return {"graphId": ident, **resolved.edges(status, offset, limit, query)}

    def graph_node(self, ident, record_id):
        with self.mutex, self._graph(ident) as (_, index, resolved, __):
            return {"resource": public_row(index.row(record_id)),
                    "outgoing": resolved.outgoing(record_id), "incoming": resolved.incoming(record_id)}

    def _source_ref(self, ref):
        from eltss_validation import source_ref
        ref = source_ref(ref)
        row = self.source_row(ref["sourceId"], ref["recordId"])
        if "pointer" in ref:
            base = source.pointer_tokens(row["entryPointer"])
            selected = source.pointer_tokens(ref["pointer"])
            if selected[:len(base)] != base:
                raise InputError("Source citation is outside its original resource")
            current = source.json_value(row["jsonText"], lexical=True)
            if not values_at(current, selected[len(base):]):
                raise InputError("Source citation does not select an existing original value")
        return ref

    def _retain_file(self, path, role):
        path = Path(path)
        size = original_workspace.regular(path).st_size
        ident = original_workspace.file_digest(path)
        destination = self.root / "eltss" / "files" / (ident + ".bin")
        if destination.exists():
            if original_workspace.file_digest(destination) != ident:
                raise InputError("Original retained file identity was changed")
        else:
            with path.open("rb") as inp, os.fdopen(os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as out:
                shutil.copyfileobj(inp, out, 65536)
                out.flush()
                os.fsync(out.fileno())
            original_workspace.sync_dir(destination.parent)
        return {"sha256": ident, "bytes": size, "role": role}

    def _file_path(self, descriptor):
        ident = source.identity(descriptor.get("sha256"))
        size = source.integer(descriptor.get("bytes"), 0, MAX_SOURCE, "Retained file size")
        path = self.root / "eltss" / "files" / (ident + ".bin")
        if original_workspace.regular(path).st_size != size or original_workspace.file_digest(path) != ident:
            raise InputError("Retained complete original file differs from its content identity")
        return path

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
            if len(rows) < limit and size + count <= source.MAX_INTERACTIVE:
                rows.append(row)
                size += count
        with self.mutex, self.source_path(source_id).open("rb") as stream:
            total = source.extract(stream, plan, receive)
        return {"columns": plan["columns"], "rows": rows, "totalRows": total, "previewRows": len(rows),
                "previewBytes": size, "previewByteBudget": source.MAX_INTERACTIVE}

    def _dataset_source_scope(self, original):
        """One exact source selection stays a family across its authored successors.

        Raw uploads bind their complete original source ID. Native acquisitions bind
        reviewed endpoint/seeds/resource traversal and limits, not a changing capture
        UUID, HTTP timestamp, credentials-file name or derived correction record.
        """
        seen = set()
        while True:
            if original["id"] in seen or len(seen) >= 1024:
                raise InputError("Original correction source lineage is cyclic or excessive")
            seen.add(original["id"])
            shape = original["inventory"]
            context = shape.get("sourceContext", {})
            if shape.get("origin") == "operator_transformation" and context.get("schema") == "stellar-forge.eltss-correction.v1":
                original = self.source(source.identity(context.get("sourceId")))
                continue
            request, connection = context.get("request"), context.get("connection")
            if isinstance(request, dict) and isinstance(connection, dict) and isinstance(request.get("initialGets"), list):
                return {"kind": "native-source-selection", "baseUrl": connection["baseUrl"],
                    "origin": shape.get("origin"), "route": request["route"],
                    "initialGets": request["initialGets"], "followReferences": request["followReferences"],
                    "resourceTypes": request["resourceTypes"], "limits": request["limits"]}
            return {"kind": "retained-original-source", "sourceId": original["id"],
                    "origin": shape.get("origin")}

    def export_dataset(self, build_id, destination):
        with self.mutex:
            view = self.build_view(build_id)
            plan = self.plan(view["plan"])
            original = self.source(view["source"])
            editions = [e for e in self._list("editions") if e["sourceId"] == original["id"]]
            definition = {"resourceType": plan["resourceType"], "planId": view["plan"],
                "sourceScope": self._dataset_source_scope(original)}
            family = {"id": source.sha(source.jbytes(definition)), "title": plan["name"], **definition}
            lineage = {"schema": "stellar-forge.eltss-lineage.v1", "family": family,
                "snapshot": view["native"]["snapshot"], "build": view,
                "files": {key: view["files"][key] for key in ["data.csv", "dataset.json"]},
                "selection": {"sourceId": original["id"], "planId": view["plan"], "resourceType": plan["resourceType"],
                              "editionIds": [e["id"] for e in editions]},
                "sources": [{"id": original["id"], "bytes": original["bytes"], "inventory": original["inventory"]}]}
            result = super().export_dataset(build_id, destination)
            try:
                atomic_json(Path(result["directory"]) / self.lineage_name, lineage)
            except Exception:
                shutil.rmtree(result["directory"])
                raise
            return {**result, "lineage": str(Path(result["directory"]) / self.lineage_name), "family": family}
