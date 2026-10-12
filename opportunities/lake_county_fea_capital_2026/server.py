"""Authenticated loopback HTTP interface for one already-open native workspace."""
from __future__ import annotations
import argparse
import base64
import csv
import io
import json
import os
from pathlib import Path
import secrets
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
from domain import ProgrammeError, require, stable, pointer
from workspace import Workspace, atomic, MAX_FILE

ASSETS = {"/": ("web/index.html", "text/html; charset=utf-8"),
          "/app.js": ("web/app.js", "text/javascript; charset=utf-8"),
          "/style.css": ("web/style.css", "text/css; charset=utf-8")}

class Handler(BaseHTTPRequestHandler):
    server_version = "FEACapital/1"
    def log_message(self, *_args):
        pass
    def _respond(self, code, value, mime="application/json; charset=utf-8", filename=None):
        raw = value if isinstance(value, bytes) else (stable(value) + "\n").encode()
        self.send_response(code)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        if filename:
            self.send_header("Content-Disposition", 'attachment; filename="' + filename.replace('"', "").replace("\r", "").replace("\n", "") + '"')
        self.end_headers()
        self.wfile.write(raw)
    def _authorized(self):
        token = self.headers.get("Authorization", "")
        require(secrets.compare_digest(token, "Bearer " + self.server.token), "authorization", "Open the original private workspace link.", status=401)
        origin = self.headers.get("Origin")
        require(origin in (None, self.server.origin), "origin", "This request is from a different browser origin.", status=403)
        host = self.headers.get("Host")
        require(host == self.server.origin.removeprefix("http://"), "host", "Use the selected loopback workspace host.", status=403)
    def _query(self):
        parsed = urlparse(self.path)
        raw = parse_qs(parsed.query, keep_blank_values=True, strict_parsing=True)
        require(all(len(v) == 1 for v in raw.values()), "query", "Do not repeat query parameters.")
        return parsed.path, {k: v[0] for k, v in raw.items()}
    def _body(self):
        length = int(self.headers.get("Content-Length", "0"))
        require(0 < length <= MAX_FILE * 4 // 3 + 1024 * 1024, "body_limit", "Request is empty or exceeds the input bound.")
        require(self.headers.get_content_type() == "application/json", "content_type", "Use a JSON request.")
        return json.loads(self.rfile.read(length).decode("utf-8"))
    def _error(self, error):
        if isinstance(error, ProgrammeError):
            self._respond(error.status, {"error": error.code, "message": str(error), "details": error.details})
        elif isinstance(error, (ValueError, TypeError, KeyError, UnicodeError)):
            self._respond(400, {"error": "input", "message": str(error)})
        else:
            self._respond(500, {"error": "native_operation", "message": str(error),
                                "recovery": "Inspect and replay the original prepared request. Its operation ID is unchanged."})
    def do_GET(self):
        try:
            path, query = self._query()
            if path in ASSETS:
                require(not query, "query", "Static pages take no query parameters.")
                relative, mime = ASSETS[path]
                return self._respond(200, (self.server.application_root / relative).read_bytes(), mime)
            self._authorized()
            w = self.server.workspace
            if path == "/api/status":
                return self._respond(200, w.status())
            if path == "/api/rows":
                return self._respond(200, w.rows(query["edition"], query.get("table"),
                    int(query.get("offset", 0)), int(query.get("limit", 100)), query.get("issues") == "true"))
            if path == "/api/operation":
                return self._respond(200, w.operation(query["id"]))
            if path == "/api/object":
                return self._respond(200, w.object(query["kind"], query["id"], int(query["revision"]) if "revision" in query else None))
            if path == "/api/file":
                f = w.file(query["id"])
                return self._respond(200, w._blob(f["sha256"]).read_bytes(), f["mime"], f["name"])
            if path == "/api/inspect-file":
                f = w.file(query["id"])
                fmt = query.get("format", "csv")
                raw = w._blob(f["sha256"])
                if fmt == "csv":
                    delimiter = query.get("delimiter", ",")
                    require(len(delimiter) == 1, "delimiter", "Select one delimiter character.")
                    with raw.open("r", encoding="utf-8-sig", errors="strict", newline="") as handle:
                        reader = csv.reader(handle, delimiter=delimiter, strict=True)
                        fields = next(reader, [])
                        sample = []
                        for _, row in zip(range(5), reader):
                            sample.append(row)
                    return self._respond(200, {"fields": fields, "sample": sample, "file": f})
                require(fmt == "json", "format", "Inspect CSV or JSON.")
                value = json.loads(raw.read_text(encoding="utf-8-sig"))
                rows = pointer(value, query.get("pointer", ""))
                require(isinstance(rows, list), "json_rows", "Select a JSON array.")
                fields = sorted({k for row in rows[:20] if isinstance(row, dict) for k in row})
                return self._respond(200, {"fields": fields, "sample": rows[:5], "total": len(rows), "file": f})
            if path == "/api/report":
                return self._respond(200, w.report(query["id"]).encode(), "text/html; charset=utf-8", "capital-programme-report.html")
            if path == "/api/export":
                with tempfile.TemporaryDirectory(prefix="fea-download-", dir=w.root.parent) as work:
                    out = Path(work) / "FEA_Capital_Programme_Complete.zip"
                    w.export_workspace(out, publication_id=query.get("publication"), application_root=self.server.application_root)
                    return self._respond(200, out.read_bytes(), "application/zip", out.name)
            self._respond(404, {"error": "route", "message": "Unknown local workspace route."})
        except Exception as exc:
            self._error(exc)
    def do_POST(self):
        try:
            self._authorized()
            path, query = self._query()
            require(path == "/api/action" and not query, "route", "Use the existing action endpoint.")
            self._respond(200, self.server.workspace.apply(self._body()))
        except Exception as exc:
            self._error(exc)

def start(workspace, *, port=0, application_root=None, token=None):
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.workspace = workspace
    server.application_root = Path(application_root or Path(__file__).parent).resolve()
    server.token = token or secrets.token_urlsafe(32)
    server.origin = "http://127.0.0.1:" + str(server.server_address[1])
    return server

def serve(root, port, startup_file=None):
    workspace = Workspace(root)
    server = start(workspace, port=port)
    startup = {"schema": "lake-county.private-workspace-startup/v1", "url": server.origin + "/#token=" + server.token,
               "origin": server.origin, "workspace_id": workspace.context["workspace_id"]}
    if startup_file:
        atomic(Path(startup_file), (stable(startup) + "\n").encode(), mode=0o600)
    print(stable(startup), flush=True)
    try:
        server.serve_forever(poll_interval=0.25)
    finally:
        server.server_close()
        workspace.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Open one private FEA capital workspace on loopback.")
    parser.add_argument("--root", required=True)
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--startup-file")
    args = parser.parse_args()
    serve(args.root, args.port, args.startup_file)
