"""MIT. OECD operator UI on the maintained Macrobond server."""
from __future__ import annotations

import importlib.util
from pathlib import Path
import shutil
import tempfile
from urllib.parse import urlsplit

from bootstrap import HERE, MACROBOND, InputError, load_json
from workspace import OecdWorkspace, bundle_from_manifest, MAX_BUNDLE
from acquire import refresh_capture

spec = importlib.util.spec_from_file_location("_sf_oecd_original_catalog_server", MACROBOND / "server.py")
original = importlib.util.module_from_spec(spec)
spec.loader.exec_module(original)

ASSETS = {"/": ("index.html", "text/html; charset=utf-8"),
          "/app.mjs": ("app.mjs", "text/javascript; charset=utf-8"),
          "/style.css": ("style.css", "text/css; charset=utf-8")}


class Handler(original.Handler):
    def _get(self):
        path = urlsplit(self.path).path
        if path in ASSETS:
            self._gate(False)
            name, media = ASSETS[path]
            raw = (HERE / "public" / name).read_bytes()
            self._headers(200, media, len(raw))
            self.wfile.write(raw)
            return
        if not path.startswith("/api/oecd/"):
            return super()._get()
        target = self._gate()
        workspace = self.server.oecd
        if path == "/api/oecd/state":
            self._json({**workspace.state(), "connection": self.server.connection_info()})
            return
        parts = path.strip("/").split("/")
        if len(parts) >= 4 and parts[:3] == ["api", "oecd", "briefings"]:
            ident = parts[3]
            if len(parts) == 4:
                self._json(workspace.briefing(ident))
                return
            if len(parts) == 5 and parts[4] == "source-rows":
                self._json(workspace.source_rows(ident))
                return
            if len(parts) == 6 and parts[4] == "files":
                name = parts[5]
                location = workspace.report_file(ident, name)
                media = {"briefing.html": "text/html; charset=utf-8",
                         "briefing.json": "application/json; charset=utf-8",
                         "observations.csv": "text/csv; charset=utf-8"}[name]
                raw = location.read_bytes()
                self._headers(200, media, len(raw), name)
                self.wfile.write(raw)
                return
        self._json({"error": "Unknown OECD route"}, 404)

    def _post(self):
        path = urlsplit(self.path).path
        if not path.startswith("/api/oecd/"):
            return super()._post()
        self._gate()
        workspace = self.server.oecd
        if path == "/api/oecd/import":
            with tempfile.TemporaryDirectory(dir=workspace.root / "tmp") as directory:
                packet = Path(directory) / "project.zip"
                with packet.open("xb") as stream:
                    packet.chmod(0o600)
                    shutil.copyfileobj(self._body(1024 * 1024 * 1024), stream, 65536)
                result = workspace.import_project(packet)
            self._json(result, 201)
            return
        body = load_json(self._body(48 * 1024 * 1024 if path.endswith("/captures") else 131072).read())
        if not isinstance(body, dict):
            raise InputError("Expected a JSON object")
        if path == "/api/oecd/seed":
            bundle = bundle_from_manifest(HERE / "sources" / "bundle.json")
            if "operation_id" in body:
                bundle["operation_id"] = body["operation_id"]
            self._json(workspace.capture(bundle), 201)
        elif path == "/api/oecd/captures":
            self._json(workspace.capture(body), 201)
        elif path == "/api/oecd/refresh":
            self._json(refresh_capture(workspace, body), 201)
        elif path == "/api/oecd/preview":
            self._json(workspace.preview(body))
        elif path == "/api/oecd/briefings":
            self._json(workspace.save_briefing(body), 201)
        elif path == "/api/oecd/compare":
            self._json(workspace.compare(body["before"], body["after"]))
        elif path == "/api/oecd/activate":
            self._json(workspace.activate(body["briefing_id"], body["expected_revision"], body.get("expected_current")))
        elif path == "/api/oecd/export-dataset":
            self._json(workspace.export_dataset(body["briefing_id"]))
        elif path in {"/api/oecd/export-customer", "/api/oecd/export-project"}:
            result = (workspace.export_customer(body["briefing_id"]) if path.endswith("customer")
                      else workspace.export_project(body["briefing_id"]))
            self._download(Path(result["path"]), Path(result["path"]).name)
        else:
            self._json({"error": "Unknown OECD route"}, 404)


class OecdServer(original.OperatorServer):
    def __init__(self, workspace, port=0, provider_username=None, provider_password=None):
        self.oecd = workspace
        super().__init__(workspace.catalog, port, provider_username=provider_username,
                         provider_password=provider_password)
        self.RequestHandlerClass = Handler
