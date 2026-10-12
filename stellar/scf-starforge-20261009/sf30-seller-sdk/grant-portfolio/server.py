"""MIT. Private industrial console over the original saved portfolio workspace."""
from __future__ import annotations

import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import mimetypes
import os
from pathlib import Path
import queue
import secrets
import stat
import threading
from urllib.parse import parse_qs, urlsplit

from domain import *
from native_sources import file_info
from workspace import ACTIONS

HERE = Path(__file__).resolve().parent


class Console:
    def __init__(self, workspace, port=0):
        self.workspace, self.token = workspace, secrets.token_urlsafe(32)
        self.queue, self.pending, self.queue_lock = queue.Queue(), set(), threading.Lock()
        self.closing, self.launch, self.connection = False, None, None
        console = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.0"

            def log_message(self, *_):
                pass

            def end_headers(self):
                for key, value in (
                    ("Cache-Control", "no-store"), ("X-Content-Type-Options", "nosniff"),
                    ("Referrer-Policy", "no-referrer"), ("X-Frame-Options", "DENY"),
                    ("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; "
                     "connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")):
                    self.send_header(key, value)
                super().end_headers()

            def send_json(self, value, status=200):
                data = canonical(value)
                self.send_response(status)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def select(self):
                require(self.headers.get("Host") == console.authority, "Open this original loopback console",
                        "INVALID_HOST", 403)
                require(self.headers.get("Origin") in (None, console.base), "Use the original console origin",
                        "INVALID_ORIGIN", 403)
                require(not console.closing, "This console is closing; reopen the saved workspace",
                        "CONSOLE_CLOSING", 503)
                selected = urlsplit(self.path)
                require(not selected.scheme and not selected.netloc and not selected.fragment,
                        "Use an original console path")
                query = parse_qs(selected.query, keep_blank_values=True)
                require(all(len(value) == 1 for value in query.values()), "Query parameters cannot be repeated")
                return selected.path, {key: value[0] for key, value in query.items()}

            def authorized(self):
                header = self.headers.get("Authorization", "")
                require(hmac.compare_digest(header, "Bearer " + console.token),
                        "Open the saved console connection", "UNAUTHORIZED", 401)

            def integer(self, query, name, default=None):
                value = query.get(name)
                if value is None:
                    return default
                require(bool(re.fullmatch(r"0|[1-9][0-9]{0,9}", value)), "Invalid " + name)
                return int(value)

            def read_body(self, maximum, content_type):
                require(self.headers.get("Transfer-Encoding") is None, "Use the complete original content length")
                lengths = self.headers.get_all("Content-Length", [])
                require(len(lengths) == 1 and bool(re.fullmatch(r"[1-9][0-9]{0,12}", lengths[0])),
                        "Supply one complete content length")
                length = int(lengths[0])
                require(length <= maximum, "The complete request exceeds its size limit", "INPUT_TOO_LARGE", 413)
                require(self.headers.get("Content-Type", "").split(";")[0].strip().lower() == content_type,
                        "Use " + content_type)
                self.connection.settimeout(120)
                return length

            def file(self, path, descriptor, content_type="application/zip"):
                before = path.lstat()
                require(stat.S_ISREG(before.st_mode), "The original download must remain a regular file")
                fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
                with os.fdopen(fd, "rb") as stream:
                    actual = os.fstat(stream.fileno())
                    require((actual.st_dev, actual.st_ino, actual.st_size) ==
                            (before.st_dev, before.st_ino, descriptor["bytes"]), "The original download changed")
                    self.send_response(200)
                    self.send_header("Content-Type", content_type)
                    self.send_header("Content-Length", str(descriptor["bytes"]))
                    self.send_header("X-Content-SHA256", descriptor["sha256"])
                    self.send_header("ETag", '"' + descriptor["sha256"] + '"')
                    self.send_header("Content-Disposition", 'attachment; filename="' + descriptor["filename"] + '"')
                    self.end_headers()
                    while block := stream.read(1024 * 1024):
                        self.wfile.write(block)

            def do_GET(self):
                try:
                    path, query = self.select()
                    static = {"/": ("index.html", "text/html; charset=utf-8"),
                              "/app.js": ("app.js", "text/javascript; charset=utf-8"),
                              "/style.css": ("style.css", "text/css; charset=utf-8")}
                    if path in static:
                        filename, content_type = static[path]
                        data = (HERE / "web" / filename).read_bytes()
                        self.send_response(200)
                        self.send_header("Content-Type", content_type)
                        self.send_header("Content-Length", str(len(data)))
                        self.end_headers()
                        self.wfile.write(data)
                        return
                    self.authorized()
                    ws = console.workspace
                    if path == "/api/schema":
                        self.send_json({"schema": SCHEMA, "workspaceId": ws.marker["workspaceId"],
                            "actions": list(ACTIONS), "tables": list(TABLES), "maxPacketBytes": MAX_PACKET,
                            "maxActionBytes": MAX_JSON, "maxSources": MAX_SOURCES, "maxPageRows": 250,
                            "financialValues": "original decimal strings; independent source, currency and meaning",
                            "references": ["sourceId", "entityKey", "sha256"]})
                    elif path == "/api/state":
                        self.send_json(ws.state())
                    elif path == "/api/launch":
                        self.send_json(console.launch)
                    elif path == "/api/request":
                        self.send_json(ws.request(query.get("id")))
                    elif path == "/api/source":
                        self.send_json(ws.source(query.get("id")))
                    elif path == "/api/portfolio":
                        self.send_json(ws.portfolio(query.get("id"), self.integer(query, "revision")))
                    elif path == "/api/rows":
                        self.send_json(ws.rows(query.get("portfolioId"), self.integer(query, "revision"),
                            query.get("table"), self.integer(query, "offset", 0), self.integer(query, "limit", 50),
                            **{key: query.get(key, "") for key in ("search", "status", "standard", "entityKey")}))
                    elif path == "/api/detail":
                        self.send_json(ws.detail(query.get("portfolioId"), self.integer(query, "revision"),
                                                 query.get("sourceId"), query.get("entityKey")))
                    elif path == "/api/object":
                        original = ws.object(query.get("sha256"))
                        self.file(original, {**file_info(original), "filename": "source-packet.zip"})
                    elif path == "/api/export":
                        original, descriptor = ws.export_file(query.get("id"))
                        self.file(original, descriptor)
                    else:
                        raise InputError("Console resource was not found", "NOT_FOUND", 404)
                except (BrokenPipeError, ConnectionResetError):
                    return
                except Exception as error:
                    self.send_json({"schema": SCHEMA + ".error", "code": getattr(error, "code", type(error).__name__),
                                    "message": str(error)}, getattr(error, "status", 400))

            def do_POST(self):
                try:
                    path, query = self.select()
                    self.authorized()
                    require(not query, "Actions use their complete body")
                    if path == "/api/upload":
                        length = self.read_body(MAX_PACKET, "application/zip")
                        result = console.workspace.upload(self.rfile, length)
                        expected = self.headers.get("X-Content-SHA256")
                        if expected is not None:
                            require(sha(expected) == result["sha256"], "Complete upload hash differs")
                        self.send_json(result, 201)
                        return
                    length = self.read_body(MAX_JSON, "application/json")
                    data = self.rfile.read(length)
                    require(len(data) == length, "The complete action body was interrupted")
                    body = parse(data)
                    if path == "/api/action":
                        request = console.workspace.admit(body)
                    elif path == "/api/resume":
                        shape(body, ("operationId",), ("operationId",))
                        request = console.workspace.request(body["operationId"])
                    else:
                        raise InputError("Console action was not found", "NOT_FOUND", 404)
                    if request["state"] != "COMPLETED":
                        console.enqueue(request["id"])
                        request = {**request, "state": "RUNNING"}
                    self.send_json(request, 202 if request["state"] == "RUNNING" else 200)
                except (BrokenPipeError, ConnectionResetError):
                    return
                except Exception as error:
                    self.send_json({"schema": SCHEMA + ".error", "code": getattr(error, "code", type(error).__name__),
                                    "message": str(error)}, getattr(error, "status", 400))

        class Server(ThreadingHTTPServer):
            daemon_threads = False
            block_on_close = True

        self.http = Server(("127.0.0.1", port), Handler)
        self.authority = "127.0.0.1:" + str(self.http.server_address[1])
        self.base = "http://" + self.authority
        self.url = self.base + "/#" + self.token
        self.worker = threading.Thread(target=self._work, name="grant-portfolio-original-writer", daemon=False)
        self.http_thread = threading.Thread(target=self.http.serve_forever, name="grant-portfolio-console", daemon=False)

    def enqueue(self, ident):
        with self.queue_lock:
            require(not self.closing, "The original console is closing")
            if ident not in self.pending:
                self.pending.add(ident)
                self.queue.put(ident)

    def _work(self):
        while True:
            ident = self.queue.get()
            if ident is None:
                self.queue.task_done()
                return
            try:
                self.workspace.execute(ident)
            finally:
                with self.queue_lock:
                    self.pending.discard(ident)
                self.queue.task_done()

    def start(self, binding, connection_file=None):
        from managed import startup
        if connection_file is not None:
            selected = Path(connection_file).expanduser().absolute()
            require(selected.parent.resolve(strict=True) == selected.parent, "Use an original connection directory")
            info = selected.parent.stat()
            require(info.st_uid == os.getuid() and not info.st_mode & 0o077, "Keep the console connection in a private directory")
            fd = os.open(selected, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
            value = startup(self, binding, selected)
            try:
                with os.fdopen(fd, "wb") as output:
                    output.write(canonical(value))
                    output.flush()
                    os.fsync(output.fileno())
                self.connection = (selected, selected.stat().st_ino, file_info(selected)["sha256"])
            except BaseException:
                selected.unlink(missing_ok=True)
                raise
        else:
            value = startup(self, binding)
        self.launch = value
        self.worker.start()
        self.http_thread.start()
        return value

    def close(self):
        if self.closing:
            return
        self.closing = True
        self.http.shutdown()
        self.http.server_close()
        self.http_thread.join()
        self.queue.put(None)
        self.worker.join()
        if self.connection:
            path, inode, expected = self.connection
            if path.exists() and not path.is_symlink() and path.stat().st_ino == inode and file_info(path)["sha256"] == expected:
                path.unlink()
