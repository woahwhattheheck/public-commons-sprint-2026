"""Authenticated loopback operator UI over the same study workspace operations."""
from __future__ import annotations

import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import tempfile
import threading
from urllib.parse import parse_qs, urlsplit
import webbrowser

from application import call
from delivery import extract_package, import_package
from model import ROOT, StudyError, dump, fail, member, parse, private_directory, read
from workspace import Workspace, close_active_intakes, file_identity

ASSETS = {"/": ("index.html", "text/html; charset=utf-8"),
          "/app.js": ("app.js", "text/javascript; charset=utf-8"),
          "/style.css": ("style.css", "text/css; charset=utf-8"),
          "/properties.js": ("properties.js", "text/javascript; charset=utf-8"),
          "/properties.css": ("properties.css", "text/css; charset=utf-8")}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def send_headers(self, status, size, content_type, extra=None):
        self.send_response(status)
        self.send_header("Content-Length", str(size))
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()

    def result(self, value, status=200):
        raw = json.dumps(value, ensure_ascii=False, allow_nan=False, default=str).encode()
        self.send_headers(status, len(raw), "application/json; charset=utf-8")
        self.wfile.write(raw)

    def local(self):
        allowed = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
        if self.client_address[0] != "127.0.0.1" or self.headers.get("Host") not in allowed:
            fail("LOCAL_OPERATOR_ORIGIN_REQUIRED")
        origin = self.headers.get("Origin")
        if origin is not None and origin not in {"http://" + value for value in allowed}:
            fail("LOCAL_OPERATOR_ORIGIN_REQUIRED")

    def authenticated(self):
        self.local()
        values = self.headers.get_all("Authorization") or []
        if len(values) != 1 or not hmac.compare_digest(values[0], "Bearer " + self.server.token):
            fail("OPERATOR_AUTHENTICATION_REQUIRED")

    def body_length(self, maximum):
        if self.headers.get("Transfer-Encoding") or len(self.headers.get_all("Content-Length") or []) != 1:
            fail("CONTENT_LENGTH_REQUIRED")
        try:
            size = int(self.headers["Content-Length"])
        except ValueError:
            fail("CONTENT_LENGTH_REQUIRED")
        if not 0 <= size <= maximum:
            fail("REQUEST_SIZE_LIMIT")
        return size

    def error_result(self, error):
        code = getattr(error, "code", type(error).__name__)
        status = 403 if code in {"OPERATOR_AUTHENTICATION_REQUIRED", "LOCAL_OPERATOR_ORIGIN_REQUIRED"} else 409 if code in {"REVIEW_CHANGED", "OPERATION_BUSY", "RECEIVED_RECORD_CONFLICT"} else 400
        self.close_connection = True
        self.result({"ok": False, "code": code, "message": str(error), "details": getattr(error, "details", {})}, status)

    def do_GET(self):
        try:
            self.local()
            path = urlsplit(self.path).path
            if path in ASSETS:
                name, mime = ASSETS[path]
                raw = (ROOT / "web" / name).read_bytes()
                self.send_headers(200, len(raw), mime)
                self.wfile.write(raw)
                return
            self.authenticated()
            if path != "/download":
                fail("ROUTE_NOT_FOUND")
            self.download(parse_qs(urlsplit(self.path).query, keep_blank_values=True))
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as error:
            self.error_result(error)

    def download(self, parameters):
        if any(len(value) != 1 for value in parameters.values()):
            fail("DOWNLOAD_ARGUMENT_INVALID")
        params = {key: value[0] for key, value in parameters.items()}
        workspace = Workspace(self.server.directory)
        try:
            kind = params.get("kind")
            if kind == "property_document" and set(params) == {"kind", "id", "path"}:
                from property_research.service import PropertyResearch
                source = PropertyResearch(workspace).document(params["id"])
                name = member(params["path"])
                expected = next((item for item in source["files"] if item["path"] == name), None)
                path = workspace.directory / "property-documents" / params["id"] / name
            elif kind == "source" and set(params) == {"kind", "id", "path"}:
                source = workspace.record("sources", params["id"])
                name = member(params["path"])
                expected = next((item for item in source["descriptor"]["files"] if item["path"] == name), None)
                path = workspace.directory / "sources" / params["id"] / name
            elif kind == "export" and set(params) == {"kind", "id", "path"}:
                record = workspace.record("exports", params["id"])
                name = member(params["path"])
                expected = next((item for item in record["files"] if item["path"] == name), None)
                path = Path(record["directory"]) / name
            elif kind == "archive" and set(params) == {"kind", "id"}:
                workspace.record("exports", params["id"])
                name = params["id"] + ".zip"
                path = workspace.directory / "downloads" / name
                receipt = parse(read(path.with_suffix(".json"), 16384))
                expected = receipt
            else:
                fail("DOWNLOAD_ARGUMENT_INVALID")
            if expected is None:
                fail("DOWNLOAD_MEMBER_NOT_FOUND")
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(fd, "rb") as stream:
                info = os.fstat(stream.fileno())
                if info.st_size != expected["bytes"] or info.st_mode & 0o077 or info.st_nlink != 1:
                    fail("DOWNLOAD_MEMBER_CHANGED")
                digest = hashlib.sha256()
                while raw := stream.read(65536):
                    digest.update(raw)
                if digest.hexdigest() != expected["sha256"]:
                    fail("DOWNLOAD_MEMBER_CHANGED")
                stream.seek(0)
                filename = "".join(char if char.isalnum() or char in "._-" else "_" for char in Path(name).name)[:120]
                self.send_headers(200, info.st_size, "application/octet-stream",
                             {"Content-Disposition": 'attachment; filename="' + filename + '"',
                              "X-Content-SHA256": expected["sha256"]})
                shutil.copyfileobj(stream, self.wfile, 65536)
        finally:
            workspace.close()

    def do_POST(self):
        try:
            self.authenticated()
            if self.server.stopping:
                fail("WORKSPACE_CLOSING")
            path = urlsplit(self.path).path
            if path == "/property-source":
                from property_research.http import upload_document
                return upload_document(self)
            if path == "/upload":
                return self.upload()
            if path != "/api" or self.headers.get_content_type() != "application/json":
                fail("JSON_OPERATION_REQUIRED")
            size = self.body_length(4 * 1024 * 1024)
            raw = self.rfile.read(size)
            if len(raw) != size:
                fail("REQUEST_INCOMPLETE")
            body = parse(raw)
            if not isinstance(body, dict) or set(body) != {"operation", "arguments"}:
                fail("OPERATION_ARGUMENTS_REQUIRED")
            workspace = Workspace(self.server.directory)
            try:
                result = call(workspace, body["operation"], body["arguments"])
                self.result({"ok": True, "result": result})
            finally:
                workspace.close()
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as error:
            self.error_result(error)

    def upload(self):
        if self.headers.get_content_type() != "application/zip":
            fail("ZIP_PACKAGE_REQUIRED")
        size = self.body_length(512 * 1024 * 1024)
        directory = Path(tempfile.mkdtemp(prefix=".upload-", dir=self.server.directory))
        try:
            path = directory / "packet.zip"
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            remaining = size
            with os.fdopen(fd, "wb") as output:
                while remaining:
                    raw = self.rfile.read(min(65536, remaining))
                    if not raw:
                        fail("REQUEST_INCOMPLETE")
                    output.write(raw)
                    remaining -= len(raw)
            unpacked = directory / "packet"
            extract_package(path, unpacked)
            workspace = Workspace(self.server.directory)
            try:
                result = import_package(workspace, unpacked)
                self.result({"ok": True, "result": result})
            finally:
                workspace.close()
        finally:
            shutil.rmtree(directory)


def serve(directory, port=0, open_browser=False):
    if type(port) is not int or not 0 <= port <= 65535:
        fail("PORT_INVALID")
    directory = private_directory(directory)
    workspace = Workspace(directory)
    workspace.close()
    connection_file = directory / "connection.json"
    if connection_file.exists():
        token = parse(read(connection_file, 16384)).get("token")
        if not isinstance(token, str) or len(token) < 40:
            fail("OPERATOR_TOKEN_INVALID")
    else:
        token = secrets.token_urlsafe(40)
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.directory, server.token, server.stopping = directory, token, False
    base = "http://127.0.0.1:" + str(server.server_port)
    dump(connection_file, {"schema": "stellar-forge.study-operator-connection.v1",
                          "base_url": base, "token": token, "pid": os.getpid()})
    print(json.dumps({"base_url": base, "connection_file": str(connection_file)}), flush=True)
    if open_browser:
        webbrowser.open(base + "/#" + token)
    previous = None
    if threading.current_thread() is threading.main_thread():
        previous = signal.getsignal(signal.SIGTERM)
        signal.signal(signal.SIGTERM, lambda *_: threading.Thread(target=server.shutdown, daemon=True).start())
    try:
        server.serve_forever(poll_interval=0.2)
    finally:
        server.stopping = True
        close_active_intakes()
        server.server_close()
        if previous is not None:
            signal.signal(signal.SIGTERM, previous)
