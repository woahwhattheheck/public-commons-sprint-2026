#!/usr/bin/env python3
"""Open the retained SF47 planning workspace using Python's standard library."""
from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
import hmac
from html import escape
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import secrets
import signal
import tempfile
import threading
from urllib.parse import parse_qs, urlsplit

from model import Workspace, Problem, HERE, SOURCE_URL, canonical, csv_bytes, MAX_BUNDLE

STATIC = {"/": ("index.html", "text/html; charset=utf-8"),
          "/app.mjs": ("app.mjs", "text/javascript; charset=utf-8"),
          "/style.css": ("style.css", "text/css; charset=utf-8")}
VERSION = "1.0.0"


def atomic_private(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, name = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


class Server(ThreadingHTTPServer):
    daemon_threads = False
    block_on_close = True
    allow_reuse_address = True

    def __init__(self, port, workspace, token):
        self.workspace, self.token = workspace, token
        super().__init__(("127.0.0.1", port), Handler)
        self.origin = f"http://127.0.0.1:{self.server_port}"


class Handler(BaseHTTPRequestHandler):
    server_version = "SF47Planning/" + VERSION
    sys_version = ""
    timeout = 8

    def setup(self):
        super().setup()
        self.connection.settimeout(self.timeout)

    def log_message(self, *_args):
        pass

    def send(self, status, body, content_type="application/json; charset=utf-8", filename=None):
        if isinstance(body, (dict, list)):
            body = (canonical(body) + "\n").encode()
        if isinstance(body, str):
            body = body.encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
        if filename:
            self.send_header("Content-Disposition", 'attachment; filename="' + filename + '"')
        self.end_headers()
        if self.command != "HEAD":
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def guard(self, api=False):
        if self.headers.get("Host", "") != urlsplit(self.server.origin).netloc:
            raise Problem("Open the workspace through its local access link.", 421, "HOST_MISMATCH")
        origin = self.headers.get("Origin")
        if origin and origin != self.server.origin:
            raise Problem("This request came from another origin.", 403, "ORIGIN_MISMATCH")
        if self.headers.get("Sec-Fetch-Site") == "cross-site" and api:
            raise Problem("Open the workspace through its local access link.", 403, "CROSS_SITE")
        if api:
            supplied = self.headers.get("Authorization", "")
            if not hmac.compare_digest(supplied, "Bearer " + self.server.token):
                raise Problem("Use the private access link to open this workspace.", 401, "ACCESS_REQUIRED")

    def raw_body(self):
        if self.headers.get("Transfer-Encoding"):
            raise Problem("Send the request with a Content-Length.", 400, "BODY_LENGTH")
        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError as exc:
            raise Problem("Send the request with a Content-Length.", 411, "BODY_LENGTH") from exc
        if not 0 <= length <= MAX_BUNDLE:
            raise Problem("Request exceeds 32 MiB.", 413, "BODY_TOO_LARGE")
        body = self.rfile.read(length)
        if len(body) != length:
            raise Problem("The request body was incomplete.", 400, "INCOMPLETE_BODY")
        return body

    def json_body(self):
        if self.headers.get_content_type() != "application/json":
            raise Problem("Send JSON for this operation.", 415)
        try:
            value = json.loads(self.raw_body(), parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
        except (UnicodeError, ValueError) as exc:
            raise Problem("The request JSON is invalid.", 400, "INVALID_JSON") from exc
        if not isinstance(value, dict):
            raise Problem("The request must be a JSON object.")
        return value

    def execute(self, operation):
        try:
            operation()
        except Problem as exc:
            self.send(exc.status, {"error": {"code": exc.code, "message": str(exc)}})
        except (KeyError, TypeError, ValueError) as exc:
            self.send(422, {"error": {"code": "INVALID_INPUT", "message": str(exc)}})
        except (TimeoutError, ConnectionResetError, BrokenPipeError):
            self.close_connection = True
        except Exception:
            self.send(500, {"error": {"code": "WORKSPACE_ERROR", "message": "The operation did not complete. Retained work is available after reopening."}})

    def do_HEAD(self):
        self.execute(self.read)

    def do_GET(self):
        self.execute(self.read)

    def read(self):
        parsed = urlsplit(self.path)
        path = parsed.path
        self.guard(api=path.startswith("/api/"))
        if path in STATIC:
            filename, mime = STATIC[path]
            return self.send(200, (HERE / filename).read_bytes(), mime)
        workspace = self.server.workspace
        if path == "/api/access":
            return self.send(200, {"available": True, "version": VERSION, "sourceUrl": SOURCE_URL})
        if path == "/api/plans":
            return self.send(200, {"plans": workspace.list()})
        match = re.fullmatch(r"/api/plans/(plan-[a-f0-9]{32})(?:/(history|revision/[0-9]+|export.zip|scenario.json|daily.csv|costs.csv))?", path)
        if not match:
            raise Problem("Page or operation not found.", 404, "NOT_FOUND")
        pid, action = match.groups()
        if action == "history":
            return self.send(200, {"revisions": workspace.history(pid)})
        if action and action.startswith("revision/"):
            return self.send(200, workspace.read(pid, int(action.split("/")[1])))
        if action == "export.zip":
            return self.send(200, workspace.export(pid), "application/zip", "sf47-planning-workspace.zip")
        current = workspace.read(pid)
        if action == "scenario.json":
            return self.send(200, json.dumps(current["scenario"], ensure_ascii=False, indent=2) + "\n",
                             "application/json; charset=utf-8", "sf47-scenario.json")
        if action == "daily.csv":
            data = csv_bytes(["day", "date", "accruedUsd", "plannedOutflowUsd", "conditionalInflowUsd",
                              "cashGapUsd", "gapAfterCapitalInputUsd", "accruedUnpaidUsd"], current["report"]["cash"]["days"])
            return self.send(200, data, "text/csv; charset=utf-8", "sf47-daily-cash-flow.csv")
        if action == "costs.csv":
            data = csv_bytes(["id", "tranche", "start_day", "end_day", "estimated_hours", "assumed_hourly_rate_usd",
                              "amount_usd", "category", "remaining_work", "measurable_proof"], current["scenario"]["future_costs"])
            return self.send(200, data, "text/csv; charset=utf-8", "sf47-work-packages.csv")
        return self.send(200, current)

    def do_POST(self):
        self.execute(self.write)

    def write(self):
        path = urlsplit(self.path).path
        self.guard(api=True)
        workspace = self.server.workspace
        if path == "/api/import-bundle":
            raw = self.raw_body()
            name = parse_qs(urlsplit(self.path).query).get("name", [""])[0]
            result = workspace.import_bundle(raw, name, self.headers.get("X-Request-ID", ""))
            return self.send(201, result)
        body = self.json_body()
        if path == "/api/import-scenario":
            if ("sourceText" in body) == ("sourceBase64" in body):
                raise Problem("Supply exactly one sourceText or sourceBase64 field.")
            if "sourceBase64" in body:
                try:
                    raw_source = base64.b64decode(body["sourceBase64"], validate=True)
                except (binascii.Error, ValueError, TypeError) as exc:
                    raise Problem("The selected source byte encoding is invalid.") from exc
            else:
                if not isinstance(body["sourceText"], str):
                    raise Problem("The selected source must be JSON text.")
                raw_source = body["sourceText"].encode()
            scenario = json.loads(raw_source)
            result = workspace.create(body["name"], scenario, body.get("planning", {}),
                                      body.get("note", "Imported source scenario"), body["requestId"],
                                      source_name=Path(body.get("filename", "imported-scenario.json")).name,
                                      source_sha=hashlib.sha256(raw_source).hexdigest(), source_bytes=raw_source)
            return self.send(201, result)
        match = re.fullmatch(r"/api/plans/(plan-[a-f0-9]{32})/(estimate|save|restore|clone)", path)
        if not match:
            raise Problem("Operation not found.", 404, "NOT_FOUND")
        pid, action = match.groups()
        expected = body["expectedRevision"]
        if isinstance(expected, bool) or not isinstance(expected, int):
            raise Problem("Use the saved revision number.")
        if action == "estimate":
            result = workspace.estimate(pid, expected, body.get("scenarioPatch", {}), body.get("planning", {}))
        elif action == "save":
            result = workspace.save(pid, expected, body.get("scenarioPatch", {}), body.get("planning", {}),
                                    body["note"], body["requestId"])
        elif action == "restore":
            result = workspace.restore(pid, expected, body["selectedRevision"], body["note"], body["requestId"])
        else:
            result = workspace.clone(pid, expected, body["name"], body["requestId"])
        self.send(200, result)


def create_server(workspace_path, source_path=None, port=0, access_file=None):
    workspace = Workspace(workspace_path, source_path or HERE.parent / "sf10_current_candidate.json")
    server = None
    try:
        token_path = workspace.root / "access.key"
        if token_path.exists():
            token = token_path.read_text().strip()
            if not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", token):
                raise Problem("The retained access key is unreadable. Restore the private workspace key.")
        else:
            token = secrets.token_urlsafe(32)
            atomic_private(token_path, (token + "\n").encode())
        server = Server(port, workspace, token)
        link = server.origin + "/#access=" + token
        access_path = Path(access_file).expanduser().resolve() if access_file else workspace.root / "open-workspace.html"
        page = ('<!doctype html><html lang="en"><meta charset="utf-8"><title>Open SF47 planning</title>'
                '<h1>SCF delivery planning</h1><p><a href="' + escape(link, quote=True) +
                '">Open the retained local workspace</a></p><p>Keep this access file private.</p></html>\n').encode()
        atomic_private(access_path, page)
        server.access_file = access_path
        return server
    except BaseException:
        if server is not None:
            server.server_close()
        workspace.close()
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path, help="Private retained planning directory")
    parser.add_argument("--scenario", type=Path, help="Original scenario for an empty workspace")
    parser.add_argument("--port", type=int, default=0, help="Local port; default chooses an available port")
    parser.add_argument("--access-file", type=Path, help="Private HTML access link; defaults inside workspace")
    args = parser.parse_args(argv)
    if not 0 <= args.port <= 65535:
        parser.error("port must be from 0 to 65535")
    server = create_server(args.workspace, args.scenario, args.port, args.access_file)
    stopping = threading.Event()
    def stop(_signum, _frame):
        if not stopping.is_set():
            stopping.set()
            threading.Thread(target=server.shutdown, daemon=True).start()
    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    print(json.dumps({"url": server.origin, "access_file": str(server.access_file)}), flush=True)
    try:
        server.serve_forever(poll_interval=0.2)
    finally:
        try:
            server.server_close()
        finally:
            server.workspace.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
