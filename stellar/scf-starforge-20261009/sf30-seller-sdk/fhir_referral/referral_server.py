"""MIT. Private Gravity operator over the original FHIR/eLTSS server."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import shutil
import sys
import uuid
from urllib.parse import unquote

from referral_runtime import InputError, ConflictError, original_server, original_workspace, source, atomic_json, safe_read
from referral_workspace import Workspace
from referral_receiving import MAX_PACKET
from eltss_server import Handler as BaseHandler

HERE = Path(__file__).resolve().parent
CONNECTION_SCHEMA = "stellar-forge.gravity-referral-operator-connection.v1"
STARTUP_SCHEMA = "stellar-forge.gravity-referral-startup.v1"

class OperatorServer(original_server.OperatorServer):
    def __init__(self, workspace, port=0, *, expected_workspace_id=None, **kwargs):
        if expected_workspace_id is not None and expected_workspace_id != workspace.workspace_id:
            raise ConflictError("The selected original Gravity workspace UUID differs")
        kwargs.setdefault("assets_directory", HERE / "public")
        kwargs.setdefault("handler_class", Handler)
        super().__init__(workspace, port, **kwargs)
        self.instance_id = str(uuid.uuid4())
        self.connection_path = workspace.root / "referral" / "operator-connection.json"
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
        with self.workspace.mutex:
            atomic_json(self.connection_path, {**self.operator_identity(), "accessToken": self.token})

    def startup(self):
        return {"schema": STARTUP_SCHEMA, "url": self.url, "workspace": str(self.workspace.root),
            "workspaceId": self.workspace.workspace_id, "instanceId": self.instance_id,
            "connectionFile": str(self.connection_path)}

    def server_close(self):
        super().server_close()
        path = getattr(self, "connection_path", None)
        if path is None:
            return
        with self.workspace.mutex:
            try:
                saved = source.json_value(safe_read(path, 65536))
            except FileNotFoundError:
                return
            if saved.get("instanceId") == self.instance_id:
                atomic_json(path, {**self.operator_identity(), "active": False})

class Handler(BaseHandler):
    server_version = "SF30-Gravity"

    def _get(self):
        # All original source, graph, native dataset and credential routes remain
        # on the same private authenticated operator and workspace lease.
        target = self._gate(api=False)
        if not target.path.startswith("/api/referrals"):
            return super()._get()
        self._gate()
        parts = self._parts(target.path)
        ws = self.server.workspace
        if parts == ["api", "referrals", "catalogue"]:
            self._query(target, ())
            self._json(ws.referral_catalogue())
        elif parts == ["api", "referrals", "profile"]:
            self._query(target, ())
            self._json(ws.referral_profile())
        elif parts == ["api", "referrals", "state"]:
            self._query(target, ())
            self._json(ws.referral_state())
        elif parts == ["api", "referrals", "guidance"]:
            self._query(target, ())
            packet = source.json_value((HERE / "gravity-source.json").read_bytes())
            self._json({**{k: v for k, v in packet.items() if k != "files"},
                "files": [{k: v for k, v in row.items() if k != "content"} for row in packet["files"]]})
        elif parts == ["api", "referrals", "guidance", "packet"]:
            self._query(target, ())
            self._download(HERE / "gravity-source.json", "Gravity_Complete_Original_Source.json", "application/json")
        elif parts == ["api", "referrals", "guidance", "file"]:
            q = self._query(target, ("name",))
            packet = source.json_value((HERE / "gravity-source.json").read_bytes())
            original = next((r for r in packet["files"] if r["path"] == q.get("name")), None)
            if original is None:
                raise InputError("Select an exact retained original guidance member")
            body = original["content"].encode("utf-8")
            if len(body) != original["bytes"] or source.sha(body) != original["sha256"]:
                raise InputError("Installed original guidance changed from its complete source identity")
            self._headers(200, "text/plain; charset=utf-8", len(body))
            self.wfile.write(body)
        elif len(parts) in {4, 5} and parts[:3] == ["api", "referrals", "records"]:
            if len(parts) == 5:
                self._query(target, ())
                self._json(ws.referral_record(parts[3], parts[4]))
            else:
                q = self._query(target, ("offset", "limit", "query"))
                self._json(ws.referral_records(parts[3],
                    offset=self._integer(q.get("offset", "0"), "offset"),
                    limit=self._integer(q.get("limit", "50"), "limit", 1, 250), query=q.get("query", "")))
        elif len(parts) == 5 and parts[:3] == ["api", "referrals", "assessments"]:
            if parts[4] == "file":
                self._query(target, ())
                record = ws.referral_record("assessments", parts[3])
                self._download(ws._file_path(record["reportFile"]), "Gravity_Complete_Assessment.json", "application/json")
            elif parts[4] in {"tasks", "findings", "cells", "decisions"}:
                q = self._query(target, ("offset", "limit", "query", "taskId"))
                self._json(ws.referral_assessment_page(parts[3], parts[4],
                    self._integer(q.get("offset", "0"), "offset"),
                    self._integer(q.get("limit", "50"), "limit", 1, 250),
                    q.get("query", ""), q.get("taskId") or None))
            else:
                self._json({"error": "Unknown retained assessment member"}, 404)
        elif len(parts) == 5 and parts[:3] == ["api", "referrals", "edition-comparisons"]:
            if parts[4] == "changes":
                q = self._query(target, ("offset", "limit"))
                self._json(ws.referral_changes(parts[3], self._integer(q.get("offset", "0"), "offset"),
                    self._integer(q.get("limit", "50"), "limit", 1, 250)))
            elif parts[4] == "file":
                self._query(target, ())
                record = ws.referral_record("comparisons", parts[3])
                self._download(ws._file_path(record["changesFile"]), "Gravity_Complete_Edition_Changes.json", "application/json")
            else:
                self._json({"error": "Unknown original edition comparison member"}, 404)
        elif len(parts) in {4, 5} and parts[:3] == ["api", "referrals", "exchange-operations"]:
            self._query(target, ())
            operation = ws.referral_exchange_operation(parts[3])
            if len(parts) == 4:
                self._json(operation)
            elif parts[4] == "file":
                self._download(ws._exchange_directory(parts[3]) / "operation.json",
                    "Gravity_Original_Exchange_Operation.json", "application/json")
            elif parts[4] == "packet":
                with ws.mutex, ws.scratch() as temp:
                    from referral_runtime import write_zip
                    directory = ws._exchange_directory(parts[3])
                    members = {}
                    for path in sorted(directory.rglob("*")):
                        if path.is_symlink():
                            raise InputError("Original exchange custody contains a link")
                        if path.is_file():
                            original_workspace.regular(path)
                            members[path.relative_to(directory).as_posix()] = path
                    archive = Path(temp) / "Gravity_Original_Exchange.zip"
                    write_zip(archive, members)
                    self._download(archive, archive.name, "application/zip")
            else:
                self._json({"error": "Unknown original exchange file"}, 404)
        elif len(parts) == 5 and parts[:3] == ["api", "referrals", "handoffs"] and parts[4] == "packet":
            self._query(target, ())
            with ws.mutex, ws.scratch() as temp:
                path = Path(temp) / "Gravity_Complete_Referral_Handoff.zip"
                ws.export_referral_handoff(parts[3], path)
                self._download(path, path.name, "application/zip")
        elif parts == ["api", "referrals", "workspace", "packet"]:
            self._query(target, ())
            with ws.mutex, ws.scratch() as temp:
                path = Path(temp) / "Gravity_Complete_Editable_Workspace.zip"
                ws.export_workspace(path)
                self._download(path, path.name, "application/zip")
        else:
            self._json({"error": "Unknown Gravity operator route"}, 404)

    def _post(self):
        target = self._gate()
        if not target.path.startswith("/api/referrals"):
            return super()._post()
        self._query(target, ())
        parts, ws = self._parts(target.path), self.server.workspace
        routes = {
            ("api", "referrals", "configurations"): ws.save_referral_configuration,
            ("api", "referrals", "editions"): ws.save_referral_edition,
            ("api", "referrals", "reviews"): ws.save_referral_review,
            ("api", "referrals", "reviews", "profile"): ws.initial_referral_review,
            ("api", "referrals", "assessments"): ws.assess_referrals,
            ("api", "referrals", "decisions"): ws.save_referral_decision,
            ("api", "referrals", "edition-comparisons"): ws.compare_referral_editions,
            ("api", "referrals", "corrections", "preview"): ws.preview_referral_correction,
            ("api", "referrals", "corrections", "apply"): ws.apply_referral_correction,
            ("api", "referrals", "exchange-requests"): ws.save_referral_exchange_request,
            ("api", "referrals", "monitoring"): ws.prepare_referral_monitoring,
            ("api", "referrals", "handoffs"): ws.prepare_referral_handoff,
            ("api", "referrals", "receivings"): ws.save_referral_receiving,
            ("api", "referrals", "exports"): ws.prepare_referral_export,
        }
        if tuple(parts) in routes:
            self._json(routes[tuple(parts)](self._json_body()), 201)
        elif len(parts) == 5 and parts[:3] == ["api", "referrals", "exchange-requests"] and parts[4] == "advance":
            body = self._json_body(("operationId",), ("operationId",))
            self._json(ws.advance_referral_exchange(parts[3], body["operationId"]))
        elif parts == ["api", "referrals", "published-examples"]:
            def header(name, fallback=""):
                return unquote(self.headers.get(name, fallback), encoding="utf-8", errors="strict")
            v = {"label": header("X-Source-Label", "Gravity original published examples"),
                 "actor": header("X-Actor"), "note": header("X-Source-Note"),
                 "publicationUrl": header("X-Publication-Url"),
                 "referenceBase": header("X-Reference-Base")}
            self._json(ws.import_published_examples(self._body(source.MAX_SOURCE), v), 201)
        elif parts in (["api", "referrals", "workspace", "packet"], ["api", "referrals", "handoffs", "receive"]):
            with ws.mutex, ws.scratch() as temp:
                path = Path(temp) / "complete-referral-receiving.zip"
                with path.open("xb") as out:
                    path.chmod(0o600)
                    shutil.copyfileobj(self._body(MAX_PACKET), out, 65536)
                try:
                    result = ws.import_workspace(path) if parts[2] == "workspace" else ws.import_referral_handoff(path)
                finally:
                    self.server.publish_connection()
                self._json(result, 201)
        else:
            self._json({"error": "Unknown Gravity operator route"}, 404)

def main(argv=None):
    p = argparse.ArgumentParser(description="Open the private Gravity referral operator")
    p.add_argument("--workspace", required=True)
    p.add_argument("--port", default=0, type=int)
    p.add_argument("--credentials-file")
    p.add_argument("--expected-workspace-id")
    args = p.parse_args(argv)
    root = Path(args.workspace).expanduser().absolute()
    if not 0 <= args.port <= 65535:
        p.error("Use a valid loopback port")
    with Workspace(root, create=not root.exists(), credentials_file=args.credentials_file) as ws:
        with OperatorServer(ws, args.port, expected_workspace_id=args.expected_workspace_id) as server:
            print(json.dumps(server.startup(), ensure_ascii=False), flush=True)
            try:
                server.serve_forever(poll_interval=0.2)
            except KeyboardInterrupt:
                pass
    return 0

if __name__ == "__main__":
    sys.exit(main())
