"""MIT. Private eLTSS care-plan operator over the original native workspace server."""
from __future__ import annotations

import argparse
import json
import os
import uuid
from pathlib import Path
import shutil
import sys
from urllib.parse import parse_qs, unquote
import zipfile

from eltss_workspace import (Workspace, InputError, original_workspace, original_server,
    atomic_json, safe_read, MAX_SOURCE)


HERE = Path(__file__).resolve().parent
MAX_UPLOAD = 2 * MAX_SOURCE
MAX_JSON = 4 * 1024 * 1024
CONNECTION_SCHEMA = "stellar-forge.eltss-operator-connection.v1"
STARTUP_SCHEMA = "stellar-forge.eltss-startup.v1"


class OperatorServer(original_server.OperatorServer):
    def __init__(self, workspace: Workspace, port: int = 0, **kwargs):
        kwargs.setdefault("assets_directory", HERE / "public")
        kwargs.setdefault("handler_class", Handler)
        super().__init__(workspace, port, **kwargs)
        self.instance_id = str(uuid.uuid4())
        self.connection_path = workspace.root / "eltss" / "operator-connection.json"
        try:
            self.publish_connection()
        except Exception:
            super().server_close()
            raise

    def operator_identity(self):
        return {"schema": CONNECTION_SCHEMA, "active": True, "workspace": str(self.workspace.root),
                "workspaceId": self.workspace.workspace_id, "instanceId": self.instance_id,
                "processId": os.getpid(), "url": self.url.split("#", 1)[0]}

    def publish_connection(self):
        # The original workspace lease owns this private descriptor. Whole
        # workspace exports enumerate only declared custody and omit the live descriptor.
        with self.workspace.mutex:
            atomic_json(self.connection_path, {**self.operator_identity(), "accessToken": self.token})

    def startup(self):
        return {"schema": STARTUP_SCHEMA, "url": self.url, "workspace": str(self.workspace.root),
                "workspaceId": self.workspace.workspace_id, "instanceId": self.instance_id,
                "connectionFile": str(self.connection_path)}

    def server_close(self):
        # Drain the original server's request threads before ending its lease.
        super().server_close()
        path = getattr(self, "connection_path", None)
        if path is None:
            return
        with self.workspace.mutex:
            try:
                saved = original_workspace.load_json(safe_read(path, 65536))
            except FileNotFoundError:
                return
            if saved.get("instanceId") == self.instance_id:
                atomic_json(path, {**self.operator_identity(), "active": False})


class Handler(original_server.Handler):
    server_version = "SF30-ELTSS"

    def _run(self, callback):
        try:
            callback()
        except PermissionError as exc:
            self._json({"error": str(exc)}, 403)
        except FileNotFoundError:
            self._json({"error": "Retained file or operation was not found"}, 404)
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            pass
        except Exception as exc:
            provider_status = getattr(exc, "provider_status", None)
            if provider_status is not None or exc.__class__.__name__ == "ProviderError":
                body = {"error": str(exc), "providerStatus": provider_status}
                for attribute, name in (("retry_after", "retryAfter"),
                                        ("not_before", "notBefore"),
                                        ("receipt", "receipt")):
                    value = getattr(exc, attribute, None)
                    if value is not None:
                        body[name] = value
                self._json(body, 502)
            elif getattr(exc, "status", None) == 409 or getattr(exc, "http_status", None) == 409 or exc.__class__.__name__ in {"ConflictError", "OperationConflict"}:
                self._json({"error": str(exc), "kind": "operation-conflict"}, 409)
            elif isinstance(exc, (InputError, ValueError, KeyError, zipfile.BadZipFile)):
                self._json({"error": str(exc), "kind": "validation"}, 422)
            else:
                self._json({"error": "The local operation failed. Reopen the retained operation to continue."}, 500)

    @staticmethod
    def _parts(path):
        # Decode one URL path component at a time: encoded source member slashes
        # belong to the last component and never create another HTTP route.
        if not path.startswith("/") or path.endswith("/"):
            return []
        return [unquote(component, encoding="utf-8", errors="strict") for component in path[1:].split("/")]

    @staticmethod
    def _query(target, allowed=None):
        values = parse_qs(target.query, keep_blank_values=True, strict_parsing=True, max_num_fields=40)
        if any(len(value) != 1 for value in values.values()):
            raise InputError("Repeated query parameters are not accepted")
        result = {name: value[0] for name, value in values.items()}
        if allowed is not None and set(result) - set(allowed):
            raise InputError("Unknown query parameter: " + ", ".join(sorted(set(result) - set(allowed))))
        return result

    @staticmethod
    def _integer(raw, name, minimum=0, maximum=None):
        if isinstance(raw, bool):
            raise InputError(name + " must be an integer")
        try:
            value = int(raw)
        except (ValueError, TypeError):
            raise InputError(name + " must be an integer") from None
        if str(value) != str(raw) or value < minimum or (maximum is not None and value > maximum):
            raise InputError(name + " is outside its supported range")
        return value

    def _json_body(self, allowed=None, required=()):
        value = original_workspace.load_json(self._body(MAX_JSON).read())
        if not isinstance(value, dict):
            raise InputError("Expected a JSON object")
        if allowed is not None and set(value) - set(allowed):
            raise InputError("Unknown request field: " + ", ".join(sorted(set(value) - set(allowed))))
        missing = set(required) - set(value)
        if missing:
            raise InputError("Missing request field: " + ", ".join(sorted(missing)))
        return value

    def _download_member(self, source_id, name):
        ws = self.server.workspace
        members = ws.source_members(source_id)
        if isinstance(members, dict):
            members = members.get("files", members.get("members", []))
        member = next((item for item in members if item.get("name") == name), None)
        if member is None:
            raise FileNotFoundError(name)
        # Member lookup is performed by the workspace; untrusted source names
        # are never opened as filesystem paths or reflected into HTTP headers.
        with ws.open_source_member(source_id, name) as stream:
            length = member.get("bytes")
            if not isinstance(length, int) or length < 0:
                raise InputError("Retained source member has no verified byte length")
            filename = "eltss-original.json" if name.endswith(".json") else "eltss-original.zip" if name.endswith(".zip") else "eltss-original.bin"
            self._headers(200, "application/octet-stream", length, filename)
            remaining = length
            while remaining:
                block = stream.read(min(65536, remaining))
                if not block:
                    raise InputError("Retained source member ended before its verified length")
                self.wfile.write(block)
                remaining -= len(block)

    def _get(self):
        target = self._gate(api=False)
        assets = {"/": ("index.html", "text/html; charset=utf-8"),
                  "/app.js": ("app.js", "text/javascript; charset=utf-8"),
                  "/style.css": ("style.css", "text/css; charset=utf-8")}
        if target.path in assets:
            if target.query:
                raise InputError("The private operator entry point does not use query parameters")
            name, media = assets[target.path]
            body = (self.server.assets_directory / name).read_bytes()
            self._headers(200, media, len(body))
            self.wfile.write(body)
            return
        self._gate()
        parts, ws = self._parts(target.path), self.server.workspace
        if parts == ["api", "operator"]:
            self._query(target, ())
            self._json(self.server.operator_identity())
            return
        if len(parts) == 2 and parts[0] == "api" and parts[1] in {"state", "catalogue", "auth-profiles"}:
            self._query(target, ())
            method = {"state": ws.state, "catalogue": ws.catalogue, "auth-profiles": ws.auth_profiles}[parts[1]]
            self._json(method())
            return
        records = {"profiles": ws.profile, "connections": ws.connection, "requests": ws.request,
                   "discoveries": ws.discovery, "operations": ws.operation, "sources": ws.source,
                   "graphs": ws.graph_view, "editions": ws.edition, "review-sets": ws.review_set,
                   "assessments": ws.assessment, "decisions": ws.decision,
                   "edition-comparisons": ws.edition_comparison, "handoffs": ws.handoff,
                   "receivings": ws.receiving, "builds": ws.build_view}
        if len(parts) == 3 and parts[:1] == ["api"] and parts[1] in records:
            self._query(target, ())
            self._json(records[parts[1]](parts[2]))
        elif len(parts) == 3 and parts[:2] == ["api", "plans"]:
            self._query(target, ())
            self._json({"id": parts[2], "plan": ws.plan(parts[2])})
        elif len(parts) == 4 and parts[:2] == ["api", "sources"] and parts[3] == "members":
            self._query(target, ())
            self._json(ws.source_members(parts[2]))
        elif len(parts) == 5 and parts[:2] == ["api", "sources"] and parts[3] == "files":
            self._query(target, ())
            self._download_member(parts[2], parts[4])
        elif len(parts) == 4 and parts[:2] == ["api", "sources"] and parts[3] == "packet":
            self._query(target, ())
            path = ws.source_path(parts[2])
            archive = zipfile.is_zipfile(path)
            self._file(path, "eltss-original-source.zip" if archive else "eltss-original-source.json",
                       "application/zip" if archive else "application/fhir+json")
        elif len(parts) == 4 and parts[:2] == ["api", "sources"] and parts[3] == "rows":
            values = self._query(target, ("resourceType", "offset", "limit", "query"))
            self._json(ws.source_rows(parts[2], values.get("resourceType") or None,
                       self._integer(values.get("offset", "0"), "offset"),
                       self._integer(values.get("limit", "50"), "limit", 1, 250), values.get("query", "")))
        elif len(parts) == 5 and parts[:2] == ["api", "sources"] and parts[3] == "rows":
            self._query(target, ())
            self._json(ws.source_row(parts[2], parts[4]))
        elif len(parts) == 4 and parts[:2] == ["api", "graphs"] and parts[3] in {"nodes", "edges"}:
            field = "resourceType" if parts[3] == "nodes" else "status"
            values = self._query(target, (field, "offset", "limit", "query"))
            method = ws.graph_nodes if parts[3] == "nodes" else ws.graph_edges
            self._json(method(parts[2], values.get(field) or None,
                       self._integer(values.get("offset", "0"), "offset"),
                       self._integer(values.get("limit", "50"), "limit", 1, 250), values.get("query", "")))
        elif len(parts) == 5 and parts[:2] == ["api", "graphs"] and parts[3] == "nodes":
            self._query(target, ())
            self._json(ws.graph_node(parts[2], parts[4]))
        elif len(parts) == 4 and parts[:2] == ["api", "assessments"] and parts[3] == "file":
            self._query(target, ())
            self._file(ws.assessment_file(parts[2]), "eltss-complete-assessment.jsonl",
                       "application/x-ndjson")
        elif len(parts) == 4 and parts[:2] == ["api", "edition-comparisons"] and parts[3] == "file":
            self._query(target, ())
            self._file(ws.edition_changes_file(parts[2]), "eltss-complete-edition-changes.jsonl",
                       "application/x-ndjson")
        elif len(parts) == 4 and parts[:2] == ["api", "assessments"] and parts[3] == "cells":
            values = self._query(target, ("carePlanId", "fieldKey", "status", "offset", "limit"))
            self._json(ws.assessment_cells(parts[2], values.get("carePlanId") or None,
                       values.get("fieldKey") or None, values.get("status") or None,
                       self._integer(values.get("offset", "0"), "offset"),
                       self._integer(values.get("limit", "50"), "limit", 1, 250)))
        elif len(parts) == 4 and parts[:2] == ["api", "edition-comparisons"] and parts[3] == "changes":
            values = self._query(target, ("offset", "limit"))
            self._json(ws.edition_changes(parts[2], self._integer(values.get("offset", "0"), "offset"),
                       self._integer(values.get("limit", "50"), "limit", 1, 250)))
        elif len(parts) == 4 and parts[:2] == ["api", "handoffs"] and parts[3] == "packet":
            self._query(target, ())
            with ws.scratch() as temporary:
                path = temporary / "eltss-care-plan-handoff.zip"
                ws.export_handoff(parts[2], path)
                self._file(path, path.name, "application/zip")
        elif len(parts) == 4 and parts[:2] == ["api", "artifacts"] and parts[3] == "file":
            self._query(target, ())
            self._file(ws.artifact_path(parts[2]), "eltss-original-receiving-result.bin", "application/octet-stream")
        elif len(parts) == 4 and parts[:2] == ["api", "builds"] and parts[3] == "query":
            self._json(ws.query(parts[2], self._query(target)))
        elif len(parts) == 4 and parts[:2] == ["api", "builds"] and parts[3] in {"dataset", "packet"}:
            self._query(target, ())
            with ws.scratch() as temporary:
                path = temporary / ("eltss-native-dataset.zip" if parts[3] == "dataset" else "eltss-customer-packet.zip")
                if parts[3] == "packet":
                    ws.export_packet(parts[2], path)
                else:
                    directory = temporary / "dataset"
                    ws.export_dataset(parts[2], directory)
                    with zipfile.ZipFile(path, "x", compression=zipfile.ZIP_DEFLATED) as archive:
                        for member in sorted(directory.rglob("*")):
                            if member.is_file() and not member.is_symlink():
                                archive.write(member, member.relative_to(directory).as_posix())
                self._file(path, path.name, "application/zip")
        elif len(parts) == 4 and parts[:2] == ["api", "comparisons"] and parts[3] in {"changes", "file"}:
            if parts[3] == "changes":
                values = self._query(target, ("offset", "limit"))
                self._json(ws.comparison_page(parts[2], self._integer(values.get("offset", "0"), "offset"),
                           self._integer(values.get("limit", "50"), "limit", 1, 250)))
            else:
                self._query(target, ())
                self._file(ws.comparison_file(parts[2]), "eltss-dataset-changes.jsonl", "application/x-ndjson")
        elif parts == ["api", "workspace", "packet"]:
            self._query(target, ())
            with ws.scratch() as temporary:
                path = temporary / "eltss-editable-workspace.zip"
                ws.export_workspace(path)
                self._file(path, path.name, "application/zip")
        else:
            self._json({"error": "Unknown care-plan route"}, 404)

    def _receive_packet(self, route):
        ws = self.server.workspace
        with ws.mutex, ws.scratch() as temporary:
            path = temporary / "receiving.zip"
            with path.open("xb") as output:
                path.chmod(0o600)
                shutil.copyfileobj(self._body(MAX_UPLOAD), output, 65536)
            try:
                method = {"workspace": ws.import_workspace, "packet": ws.import_packet, "handoff": ws.import_handoff}[route]
                result = method(path)
            finally:
                if route == "workspace":
                    self.server.publish_connection()
            self._json(result, 201)

    def _post(self):
        target = self._gate()
        self._query(target, ())
        parts, ws = self._parts(target.path), self.server.workspace
        if parts in (["api", "sources"], ["api", "artifacts"]):
            artifact = parts[1] == "artifacts"
            prefix = "X-Artifact-" if artifact else "X-Source-"
            name = unquote(self.headers.get(prefix + "Name", "original-result.bin" if artifact else "eltss-source.json"),
                           encoding="utf-8", errors="strict")
            label = unquote(self.headers.get(prefix + "Label", name), encoding="utf-8", errors="strict")
            if artifact:
                content_type = self.headers.get("X-Artifact-Content-Type", "application/octet-stream")
                result = ws.add_artifact(self._body(MAX_SOURCE), label, name, content_type)
            else:
                result = ws.add_source(self._body(MAX_SOURCE), label, name)
            self._json(result, 201)
            return
        native = {("api", "connections"): ws.save_connection, ("api", "requests"): ws.save_request,
                  ("api", "editions"): ws.save_edition, ("api", "review-sets"): ws.save_review_set,
                  ("api", "review-sets", "profile"): ws.adopt_profile, ("api", "assessments"): ws.assess,
                  ("api", "decisions"): ws.save_decision, ("api", "edition-comparisons"): ws.compare_editions,
                  ("api", "corrections", "preview"): ws.preview_correction,
                  ("api", "corrections"): ws.apply_correction, ("api", "handoffs"): ws.prepare_handoff,
                  ("api", "receivings"): ws.save_receiving, ("api", "plans"): ws.save_plan}
        if tuple(parts) in native:
            self._json(native[tuple(parts)](self._json_body()), 201)
        elif len(parts) == 4 and parts[:2] == ["api", "connections"] and parts[3] == "discover":
            self._json_body(())
            self._json(ws.discover(parts[2]), 201)
        elif len(parts) == 4 and parts[:2] == ["api", "requests"] and parts[3] == "advance":
            body = self._json_body(("operationId",), ("operationId",))
            self._json(ws.advance(parts[2], body["operationId"]))
        elif len(parts) == 4 and parts[:2] == ["api", "operations"] and parts[3] in {"pause", "resume"}:
            self._json_body(())
            self._json((ws.pause if parts[3] == "pause" else ws.resume)(parts[2]))
        elif len(parts) == 4 and parts[:2] == ["api", "sources"] and parts[3] == "graph":
            self._json(self.server.workspace.graph(parts[2], self._json_body()), 201)
        elif len(parts) == 4 and parts[:2] == ["api", "sources"] and parts[3] in {"mapping", "preview"}:
            if parts[3] == "mapping":
                body = self._json_body(("resourceType", "name"), ("resourceType",))
                result = ws.default_mapping(parts[2], body["resourceType"], body.get("name"))
            else:
                body = self._json_body(("plan", "limit"), ("plan",))
                result = ws.projection_preview(parts[2], body["plan"],
                            self._integer(body.get("limit", 25), "limit", 1, 250))
            self._json(result)
        elif parts == ["api", "builds"]:
            body = self._json_body(("sourceId", "planId"), ("sourceId", "planId"))
            self._json(ws.build(body["sourceId"], body["planId"]), 201)
        elif parts == ["api", "comparisons"]:
            body = self._json_body(("beforeId", "afterId"), ("beforeId", "afterId"))
            self._json(ws.compare(body["beforeId"], body["afterId"]), 201)
        elif parts == ["api", "handoffs", "receive"]:
            self._receive_packet("handoff")
        elif parts == ["api", "packets"]:
            self._receive_packet("packet")
        elif parts == ["api", "workspace", "packet"]:
            self._receive_packet("workspace")
        else:
            self._json({"error": "Unknown care-plan route"}, 404)

def main(argv=None):
    parser = argparse.ArgumentParser(description="Open the private eLTSS care-plan operator")
    parser.add_argument("--workspace", required=True, help="Original private workspace directory")
    parser.add_argument("--port", default=0, type=int, help="Loopback port; default chooses a free port")
    parser.add_argument("--credentials-file", help="Local configured authentication profiles")
    args = parser.parse_args(argv)
    credentials = None
    if args.credentials_file:
        credentials = Path(args.credentials_file).expanduser().resolve(strict=True)
        if not credentials.is_file():
            parser.error("--credentials-file must be a regular file")
    workspace_path = Path(args.workspace).expanduser().absolute()
    with Workspace(workspace_path, create=not workspace_path.exists(), credentials_file=credentials) as ws:
        with OperatorServer(ws, args.port) as server:
            print(json.dumps(server.startup(), ensure_ascii=False), flush=True)
            try:
                server.serve_forever(poll_interval=0.2)
            except KeyboardInterrupt:
                pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
