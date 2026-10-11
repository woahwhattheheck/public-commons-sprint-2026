#!/usr/bin/env python3
"""Run the retained ShiftLoom workspace on the local computer."""
from __future__ import annotations

import argparse
import json
import mimetypes
from pathlib import Path
import secrets
import sys
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, urlparse

from sources import WorkError, fail, json_text
from store import HERE, Workspace

MAX_REQUEST = 28 * 1024 * 1024
PUBLIC = HERE / "public"


class Handler(BaseHTTPRequestHandler):
    server_version = "ShiftLoom/1"
    protocol_version = "HTTP/1.0"

    def log_message(self, format, *args):
        # Imported filenames, volunteer data and tokens stay out of routine logs.
        return

    def _origin(self):
        host = self.headers.get("Host", "")
        allowed = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
        if host not in allowed:
            fail("LOCAL_HOST", "Open the exact local workspace URL printed by the server.", 403)
        origin = self.headers.get("Origin")
        if origin and origin != "http://" + host:
            fail("LOCAL_ORIGIN", "Use this workspace's own browser tab.", 403)
        return host

    def _send(self, status, raw, content_type="application/json; charset=utf-8", filename=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        if filename:
            self.send_header("Content-Disposition", "attachment; filename*=UTF-8''" + quote(filename, safe=""))
        self.end_headers()
        self.wfile.write(raw)

    def _json(self, value, status=200):
        self._send(status, json_text(value).encode("utf-8"))

    def _error(self, exc):
        if isinstance(exc, WorkError):
            return self._json(dict(error=exc.code, message=exc.message, **exc.extra), exc.status)
        traceback.print_exc(file=sys.stderr)
        return self._json(dict(error="WORKSPACE_ERROR", message="The operation could not be completed. Reload the retained workspace and inspect the server error."), 500)

    def do_GET(self):
        try:
            self._origin()
            parsed = urlparse(self.path)
            path = parsed.path.rstrip("/") or "/"
            query = parse_qs(parsed.query)
            offset, limit = query.get("offset", ["0"])[0], query.get("limit", ["50"])[0]
            parts = path.strip("/").split("/")
            workspace = self.server.workspace
            if path == "/api/state":
                return self._json(workspace.state())
            if path == "/api/backup":
                return self._send(200, workspace.backup(), "application/vnd.sqlite3", "shiftloom-workspace.sqlite")
            if len(parts) in (3, 4) and parts[:2] == ["api", "datasets"]:
                if len(parts) == 4 and parts[3] == "raw":
                    raw, name = workspace.source_raw(parts[2])
                    return self._send(200, raw, "application/octet-stream", name)
                if len(parts) == 3:
                    return self._json(workspace.dataset(parts[2], offset, limit))
            if len(parts) == 4 and parts[:2] == ["api", "native-sources"] and parts[3] == "raw":
                raw, name = workspace.source_raw(parts[2])
                return self._send(200, raw, "application/json", name)
            if len(parts) in (3, 4) and parts[:2] == ["api", "boards"]:
                if len(parts) == 3:
                    return self._json(workspace.board(parts[2]))
                if parts[3] == "roster":
                    return self._json(workspace.roster(parts[2], offset, limit, query.get("query", [""])[0]))
                if parts[3] == "handoff":
                    raw, name = workspace.handoff(parts[2])
                    return self._send(200, raw, "application/zip", name)
            if len(parts) == 3 and parts[:2] == ["api", "plans"]:
                return self._json(workspace.plan(parts[2]))
            filename = "index.html" if path == "/" else path[1:]
            if filename in ("index.html", "app.mjs", "style.css"):
                file = PUBLIC / filename
                if not file.exists():
                    fail("UI_PENDING", "The workspace interface is not installed beside this server.", 503)
                raw = file.read_bytes()
                if filename == "index.html":
                    raw = raw.replace(b"__SESSION_TOKEN__", self.server.token.encode("ascii"))
                content_type = "text/javascript" if filename.endswith(".mjs") else mimetypes.guess_type(filename)[0]
                return self._send(200, raw, (content_type or "application/octet-stream") + "; charset=utf-8")
            fail("NOT_FOUND", "That workspace route does not exist.", 404)
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception as exc:
            self._error(exc)

    def do_POST(self):
        try:
            self._origin()
            supplied = self.headers.get("X-Workspace-Token", "")
            if not secrets.compare_digest(supplied, self.server.token):
                fail("WORKSPACE_TOKEN", "Reload this workspace tab before changing its records.", 403)
            if self.headers.get("Content-Type", "").split(";")[0].strip().lower() != "application/json":
                fail("CONTENT_TYPE", "Send the workspace operation as JSON.", 415)
            try:
                size = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                fail("REQUEST_SIZE", "The request length is invalid.", 400)
            if not 0 < size <= MAX_REQUEST:
                fail("REQUEST_SIZE", "A workspace request may be at most 28 MiB.", 413)
            try:
                body = json.loads(self.rfile.read(size).decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                fail("REQUEST_JSON", "The workspace request is not complete JSON.", 400)
            if not isinstance(body, dict):
                fail("REQUEST_JSON", "Supply a JSON operation object.", 400)
            path = urlparse(self.path).path.rstrip("/")
            parts = path.strip("/").split("/")
            workspace = self.server.workspace
            methods = {
                "/api/settings": workspace.settings,
                "/api/datasets": workspace.upload,
                "/api/native-snapshot": workspace.native_snapshot,
                "/api/select-dataset": workspace.select_dataset,
                "/api/boards": workspace.create_board,
                "/api/select-board": workspace.select_board
            }
            if path in methods:
                return self._json(methods[path](body))
            if len(parts) == 4 and parts[:2] == ["api", "datasets"] and parts[3] in ("mapping", "overrides"):
                method = workspace.mapping if parts[3] == "mapping" else workspace.overrides
                return self._json(method(parts[2], body))
            if len(parts) == 4 and parts[:2] == ["api", "boards"] and parts[3] in ("plans", "undo"):
                method = workspace.create_plan if parts[3] == "plans" else workspace.undo
                return self._json(method(parts[2], body))
            if len(parts) == 4 and parts[:2] == ["api", "plans"] and parts[3] == "review":
                return self._json(workspace.review(parts[2], body))
            fail("NOT_FOUND", "That workspace operation does not exist.", 404)
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception as exc:
            self._error(exc)


def main():
    parser = argparse.ArgumentParser(description="Retained ShiftLoom volunteer coverage workspace")
    parser.add_argument("--db", required=True, help="Private retained SQLite workspace file or downloaded backup")
    parser.add_argument("--port", type=int, default=8802, help="Local port; use 0 for an available port")
    args = parser.parse_args()
    workspace = Workspace(args.db)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.daemon_threads = True
    server.workspace = workspace
    server.token = secrets.token_urlsafe(32)
    print(json_text(dict(url=f"http://127.0.0.1:{server.server_port}", db=str(workspace.path))), flush=True)
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        workspace.close()


if __name__ == "__main__":
    main()

