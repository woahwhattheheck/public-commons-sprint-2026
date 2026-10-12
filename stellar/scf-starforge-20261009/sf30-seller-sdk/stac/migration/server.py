#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Local industrial operator for the original migration workspace."""
from __future__ import annotations
import argparse
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hmac
import json
import mimetypes
import os
from pathlib import Path
import secrets
import signal
import subprocess
import sys
import threading
import urllib.parse

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from migration import engine
from migration.native import files, need
from migration.workspace import Workspace

HERE = Path(__file__).resolve().parent
COOKIE = "migration_operator_access"

class Application:
    def __init__(self, args):
        self.workspace = Path(args.workspace).expanduser().resolve()
        self.exports = Path(args.exports or str(self.workspace) + "-exports").expanduser().resolve()
        need(not self.exports.is_relative_to(self.workspace), "MIGRATION_EXPORT_DIRECTORY")
        self.python = str(Path(args.python).expanduser().resolve())
        self.vector_python = str(Path(args.vector_python or args.python).expanduser().resolve())
        self.qgis_python = str(Path(args.qgis_python or args.python).expanduser().resolve())
        for executable in (self.python, self.vector_python, self.qgis_python):
            need(Path(executable).is_file() and os.access(executable, os.X_OK),
                 "MIGRATION_PYTHON_REQUIRED", executable)
        Workspace(self.workspace, create=args.create, title=args.title)
        self.access = secrets.token_urlsafe(32)
        self.lock, self.mutation = threading.RLock(), threading.Lock()
        self.slots = threading.BoundedSemaphore(12)
        self.processes, self.closing = set(), False

    def selected_python(self, command):
        if command in ("capture", "build-edition", "native-info"):
            return self.vector_python
        if command in ("build-projects", "native-reopen", "receive", "qgis-info") or command.startswith("cartography."):
            return self.qgis_python
        return self.python

    def run(self, command, payload):
        need(command in engine.READ_COMMANDS | engine.WRITE_COMMANDS | {"verify", "native-reopen"},
             "MIGRATION_COMMAND_UNKNOWN", command)
        if not self.slots.acquire(blocking=False):
            return 503, {"ok": False, "error": {"code": "LOCAL_REQUEST_CAPACITY",
                         "message": "The local operator is completing its current reads. Retry this request.",
                         "retryable": True}}
        mutating = not engine.is_read(command)
        locked = False
        process = None
        try:
            if mutating:
                locked = self.mutation.acquire(blocking=False)
                if not locked:
                    return 409, {"ok": False, "error": {"code": "LOCAL_WORKSPACE_BUSY",
                                 "message": "Another native operation is still using this workspace. Resume this retained request after it completes.",
                                 "retryable": True}}
            request = files.json_bytes({"command": command, "payload": payload})
            with self.lock:
                if self.closing:
                    return 503, {"ok": False, "error": {"code": "LOCAL_OPERATOR_CLOSING",
                                 "message": "Reopen the operator to continue the same retained request.", "retryable": True}}
                process = subprocess.Popen(
                    [self.selected_python(command), "-B", str(HERE / "engine.py"),
                     "--workspace", str(self.workspace), "--exports-root", str(self.exports)],
                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                    start_new_session=True,
                    env={**os.environ, "QT_QPA_PLATFORM": os.environ.get("QT_QPA_PLATFORM", "offscreen"),
                         "PYTHONDONTWRITEBYTECODE": "1"},
                )
                self.processes.add(process)
            stdout, stderr = process.communicate(request)
            lines = stdout.decode("utf-8", errors="replace").splitlines()
            results = [line[len(engine.RESULT_MARKER):] for line in lines if line.startswith(engine.RESULT_MARKER)]
            if not results:
                return 502, {"ok": False, "error": {"code": "NATIVE_RESULT_NOT_RETURNED",
                    "message": "The native process returned no complete result. Resume the original request; committed workspace changes retain their original identity.",
                    "nativeExitCode": process.returncode, "nativeOutput": stderr.decode("utf-8", errors="replace")[-65536:],
                    "retryable": True}}
            result = files.parse_json(results[-1])
            need(isinstance(result, dict) and type(result.get("ok")) is bool, "MIGRATION_NATIVE_ENVELOPE_INVALID")
            if result["ok"]:
                need(process.returncode == 0, "MIGRATION_NATIVE_EXIT_CHANGED", process.returncode)
                return 200, result
            error = result.get("error", {})
            code = error.get("code")
            if code == "REVISION_CHANGED":
                return 409, result
            return 422, result
        finally:
            try:
                # A transport/read exception must not orphan an admitted native writer.
                if process is not None and process.poll() is None:
                    self._stop(process)
            finally:
                with self.lock:
                    if process is not None and process.poll() is not None:
                        self.processes.discard(process)
                if locked:
                    self.mutation.release()
                self.slots.release()

    @staticmethod
    def _stop(process):
        if process.poll() is not None:
            return
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()

    def close(self):
        with self.lock:
            self.closing = True
            active = list(self.processes)
        # Stop only this operator's process groups; original native checkpoints remain.
        for process in active:
            if process.poll() is None:
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
        for process in active:
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait()

class Handler(BaseHTTPRequestHandler):
    server_version = "MigrationOperator/1"

    def log_message(self, format, *args):
        # Request bodies and access values do not enter the process log.
        return

    @property
    def app(self):
        return self.server.app

    def _origin(self):
        expected = self.server.authority
        if self.headers.get("Host") != expected:
            return False
        origin = self.headers.get("Origin")
        return origin is None or origin == "http://" + expected

    def _authenticated(self):
        supplied = self.headers.get("X-Migration-Access", "")
        if supplied and hmac.compare_digest(supplied, self.app.access):
            return True
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except Exception:
            return False
        supplied = cookie[COOKIE].value if COOKIE in cookie else ""
        return hmac.compare_digest(supplied, self.app.access)

    def _reply(self, status, value, *, content_type="application/json; charset=utf-8", cookie=False):
        raw = value if isinstance(value, bytes) else files.json_bytes(value)
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
        if cookie:
            self.send_header("Set-Cookie", COOKIE + "=" + self.app.access + "; Path=/; HttpOnly; SameSite=Strict")
        self.end_headers()
        try:
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_POST(self):
        if not self._origin():
            return self._reply(403, {"ok": False, "error": {"code": "LOCAL_ORIGIN_REQUIRED"}})
        if not self._authenticated():
            return self._reply(401, {"ok": False, "error": {"code": "LOCAL_ACCESS_REQUIRED",
                                "message": "Open the current operator address printed by its local process."}})
        parsed = urllib.parse.urlsplit(self.path)
        if parsed.path == "/session":
            return self._reply(200, {"ok": True}, cookie=True)
        if parsed.path != "/api":
            return self._reply(404, {"ok": False, "error": {"code": "NOT_FOUND"}})
        try:
            need(self.headers.get("Content-Type", "").split(";", 1)[0].strip() == "application/json",
                 "MIGRATION_JSON_REQUIRED")
            raw_size = self.headers.get("Content-Length", "")
            need(raw_size.isdecimal(), "MIGRATION_CONTENT_LENGTH_REQUIRED")
            size = int(raw_size)
            need(0 < size <= engine.MAX_REQUEST, "MIGRATION_REQUEST_TOO_LARGE")
            raw = self.rfile.read(size)
            need(len(raw) == size, "MIGRATION_REQUEST_INCOMPLETE")
            request = files.parse_json(raw)
            need(isinstance(request, dict) and isinstance(request.get("command"), str)
                 and isinstance(request.get("payload", {}), dict), "MIGRATION_REQUEST_REQUIRED")
            status, result = self.app.run(request["command"], request.get("payload", {}))
            self._reply(status, result)
        except (OSError, ValueError, KeyError, TypeError) as exc:
            self._reply(422, {"ok": False, "error": {"code": getattr(exc, "code", type(exc).__name__),
                                                  "message": str(exc)}})

    def do_GET(self):
        if not self._origin():
            return self._reply(403, {"ok": False, "error": {"code": "LOCAL_ORIGIN_REQUIRED"}})
        parsed = urllib.parse.urlsplit(self.path)
        public = {"/": HERE / "public/index.html", "/app.mjs": HERE / "public/app.mjs",
                  "/cartography.mjs": HERE / "public/cartography.mjs", "/cartography.css": HERE / "public/cartography.css",
                  "/styles.css": HERE / "public/styles.css",
                  "/vector/json.mjs": HERE.parent / "vector/json.mjs"}
        if parsed.path in public:
            path = public[parsed.path]
            content_type = "text/javascript; charset=utf-8" if path.suffix == ".mjs" else {
                ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8"}[path.suffix]
            return self._reply(200, path.read_bytes(), content_type=content_type)
        if parsed.path != "/download":
            return self._reply(404, {"ok": False, "error": {"code": "NOT_FOUND"}})
        if not self._authenticated():
            return self._reply(401, {"ok": False, "error": {"code": "LOCAL_ACCESS_REQUIRED"}})
        try:
            query = urllib.parse.parse_qs(parsed.query, strict_parsing=True)
            relative = query.get("path", [""])[0]
            kind = query.get("kind", ["workspace"])[0]
            if kind == "archive":
                need(Path(relative).name == relative and relative.startswith("migration-") and relative.endswith(".zip"),
                     "MIGRATION_ARCHIVE_NAME_INVALID")
                path = self.app.exports / relative
                record = files.file_record(path, relative)
            else:
                need(kind == "workspace", "MIGRATION_DOWNLOAD_KIND_INVALID")
                status, envelope = self.app.run("files", {"path": relative})
                need(status == 200 and envelope.get("ok"), "MIGRATION_FILE_NOT_DECLARED", relative)
                record = envelope["result"]
                path = files.member(self.app.workspace, record["path"])
            need(path.is_file() and not path.is_symlink(), "MIGRATION_FILE_REQUIRED")
            stream = path.open("rb")
            try:
                need(os.fstat(stream.fileno()).st_size == record["bytes"], "MIGRATION_FILE_CHANGED")
                self.send_response(200)
                self.send_header("Content-Type", mimetypes.guess_type(path.name)[0] or "application/octet-stream")
                self.send_header("Content-Length", str(record["bytes"]))
                self.send_header("Content-Disposition", "attachment; filename*=UTF-8''" + urllib.parse.quote(path.name))
                self.send_header("X-Content-SHA256", record["sha256"])
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.end_headers()
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    self.wfile.write(block)
            finally:
                stream.close()
        except (BrokenPipeError, ConnectionResetError):
            pass
        except (OSError, ValueError, KeyError, TypeError) as exc:
            self._reply(422, {"ok": False, "error": {"code": getattr(exc, "code", type(exc).__name__),
                                                  "message": str(exc)}})

class Server(ThreadingHTTPServer):
    daemon_threads = False
    block_on_close = True

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--create", action="store_true")
    parser.add_argument("--title", default="GIS migration")
    parser.add_argument("--port", type=int, default=8917)
    parser.add_argument("--python", default=sys.executable)
    parser.add_argument("--vector-python")
    parser.add_argument("--qgis-python")
    parser.add_argument("--exports")
    args = parser.parse_args(argv)
    app = Application(args)
    server = Server(("127.0.0.1", args.port), Handler)
    server.app = app
    server.authority = "127.0.0.1:" + str(server.server_port)
    print("Migration operator: http://" + server.authority + "/#access=" + app.access, flush=True)
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        app.close()
        server.server_close()
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
