"""MIT. Private loopback operator for the original Leap workspace."""
from __future__ import annotations
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import secrets
import signal
import threading
from urllib.parse import parse_qs, quote, unquote, urlsplit

from leap_contracts import LeapError, require, json_bytes, MAX_SOURCE_BYTES
from leap_delivery import MAX_PACKET_BYTES, export_path

HERE = Path(__file__).resolve().parent


class LimitedBody:
    def __init__(self, stream, remaining):
        self.stream, self.remaining = stream, remaining

    def read(self, size=-1):
        if not self.remaining:
            return b""
        requested = min(self.remaining, size if size >= 0 else self.remaining)
        block = self.stream.read(requested)
        if len(block) != requested:
            raise LeapError("LOCAL_BODY_INCOMPLETE", "The request ended before its declared byte length.")
        self.remaining -= len(block)
        return block


def serve(workspace, *, port=0, connection_file=None):
    token = secrets.token_urlsafe(48)

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *_args):
            pass

        def setup(self):
            super().setup()
            self.connection.settimeout(120)

        def send_bytes(self, status, data, content_type="application/json; charset=utf-8", filename=None):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.close_connection = True
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'")
            if filename:
                self.send_header("Content-Disposition", "attachment; filename*=UTF-8''" + quote(filename, safe=""))
            self.end_headers()
            self.wfile.write(data)

        def send_json(self, status, value):
            self.send_bytes(status, json_bytes(value))

        def fail(self, error):
            document = workspace.error_document(error)
            code = document.get("code", "")
            status = 401 if code == "LOCAL_AUTHENTICATION" else 409 if code in {"LOCAL_REVISION", "LOCAL_OPERATION_CONFLICT", "LOCAL_WORKSPACE_BUSY"} else 404 if code.endswith("NOT_FOUND") else 400
            self.close_connection = True
            try:
                self.send_json(status, {"error": document})
            except (BrokenPipeError, ConnectionResetError):
                pass

        def authenticate(self, mutation=False):
            require(self.headers.get("Host") == self.server.host_header, "LOCAL_AUTHENTICATION", "Use the original loopback connection.")
            supplied = self.headers.get("Authorization", "")
            require(supplied.startswith("Bearer ") and secrets.compare_digest(supplied[7:], token),
                    "LOCAL_AUTHENTICATION", "Open the original private workspace connection.")
            if mutation:
                require(self.headers.get("Origin") == self.server.origin, "LOCAL_AUTHENTICATION", "Send actions from the original workspace origin.")

        def query(self):
            parsed = urlsplit(self.path)
            query = parse_qs(parsed.query, keep_blank_values=True)
            require(all(len(values) == 1 for values in query.values()), "LOCAL_QUERY", "Use one value for each original query parameter.")
            return parsed.path, {key: values[0] for key, values in query.items()}

        def send_file(self, path, metadata, content_type="application/octet-stream"):
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(metadata["bytes"]))
            self.send_header("Content-Disposition", "attachment; filename*=UTF-8''" + quote(metadata["name"], safe=""))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.close_connection = True
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            with open(path, "rb") as source:
                for block in iter(lambda: source.read(1024 * 1024), b""):
                    self.wfile.write(block)

        def do_GET(self):
            try:
                path, query = self.query()
                if path in {"/", "/index.html", "/app.js", "/style.css"}:
                    require(self.headers.get("Host") == self.server.host_header, "LOCAL_AUTHENTICATION", "Use the original loopback connection.")
                    name = "index.html" if path in {"/", "/index.html"} else path[1:]
                    types = {"index.html": "text/html; charset=utf-8", "app.js": "text/javascript; charset=utf-8", "style.css": "text/css; charset=utf-8"}
                    self.send_bytes(200, (HERE / "public" / name).read_bytes(), types[name])
                    return
                self.authenticate()
                file_response = None
                with workspace.read_view() as view:
                    if path == "/api/launch":
                        result = {"schema": view.meta("schema"), "status": "READY", "workspace_id": view.meta("workspace_id"),
                                  "workspace": str(view.root), "origin": self.server.origin, "revision": view.meta("revision")}
                    elif path == "/api/state":
                        result = view.state()
                    elif path == "/api/list":
                        result = view.list_collection(query.get("collection"), query.get("offset", 0), query.get("limit", 100))
                    elif path == "/api/item":
                        result = view.get(query.get("collection"), query.get("id"))
                    elif path == "/api/rows":
                        result = view.rows(query.get("batch_id"), query.get("offset", 0), query.get("limit", 100))
                    elif path == "/api/issues":
                        result = view.issue_rows(query.get("batch_id"), query.get("offset", 0), query.get("limit", 100))
                    elif path == "/api/missing":
                        result = view.missing_rows_page(query.get("snapshot_id"), query.get("offset", 0), query.get("limit", 100))
                    elif path == "/api/operation":
                        result = view.operation(query.get("id"))
                    elif path == "/api/file":
                        meta = view.get("files", query.get("id"))
                        file_response = (view.blob_path(meta["id"]), meta)
                    elif path == "/api/export":
                        path, meta = export_path(view, query.get("id"))
                        file_response = (path, meta, "application/zip")
                    else:
                        raise LeapError("LOCAL_NOT_FOUND", "Choose an original workspace route.")
                # Finish the read transaction before a slow client receives any bytes.
                if file_response is not None:
                    self.send_file(*file_response)
                else:
                    self.send_json(200, result)
            except (BrokenPipeError, ConnectionResetError):
                self.close_connection = True
            except Exception as error:
                self.fail(error)

        def do_POST(self):
            try:
                path, query = self.query()
                self.authenticate(mutation=True)
                require(not query and self.headers.get("Transfer-Encoding") is None, "LOCAL_BODY", "Use a complete declared request body.")
                length = self.headers.get("Content-Length", "")
                require(length.isdigit(), "LOCAL_BODY", "Declare the complete request byte length.")
                length = int(length)
                with workspace.mutex:
                    if path == "/api/action":
                        require(length <= 2 * 1024 * 1024, "LOCAL_BODY", "The JSON action exceeds 2 MiB.")
                        body = LimitedBody(self.rfile, length).read()
                        value = json.loads(body.decode("utf-8"))
                        require(isinstance(value, dict) and value.get("request_id") is not None and value.get("expected_revision") is not None, "LOCAL_ACTION", "Use the complete original action object, request UUID and reviewed revision.")
                        result = workspace.perform(value.get("action"), value.get("payload"), value.get("request_id"), value.get("expected_revision"))
                    elif path in {"/api/upload", "/api/restore"}:
                        maximum = MAX_PACKET_BYTES if path == "/api/restore" else MAX_SOURCE_BYTES
                        require(length <= maximum, "LOCAL_BODY", "The complete file exceeds its receiving capacity.")
                        revision = self.headers.get("X-Leap-Revision", "")
                        require(revision.isdigit(), "LOCAL_REVISION", "Use the current original workspace revision.")
                        revision = int(revision)
                        request_id = self.headers.get("X-Leap-Request-Id")
                        require(request_id, "LOCAL_REQUEST", "Retain the original request UUID.")
                        # Permit exact replays after a response loss; perform() binds their original file hash.
                        old = workspace.db.execute("SELECT 1 FROM operations WHERE id=?", (request_id,)).fetchone()
                        require(old or revision == workspace.meta("revision"), "LOCAL_REVISION", "Refresh the original workspace revision.", revision=workspace.meta("revision"))
                        name = unquote(self.headers.get("X-Leap-Name", "Leap_Delivery.zip" if path == "/api/restore" else "intervals.csv"), errors="strict")
                        kind = "restore-packet" if path == "/api/restore" else self.headers.get("X-Leap-Format", "")
                        blob = workspace.store_stream(LimitedBody(self.rfile, length), name, kind, expected_bytes=length, maximum=maximum)
                        expected = self.headers.get("X-Leap-Sha256")
                        require(expected is None or blob["sha256"] == expected, "LOCAL_SOURCE_CHANGED", "The received file differs from the selected complete bytes.")
                        action = "workspace.restore" if path == "/api/restore" else "source.register"
                        payload = {"file_id": blob["id"]} if path == "/api/restore" else {"id": blob["id"], "format": kind, "name": name}
                        result = workspace.perform(action, payload, request_id, revision)
                    else:
                        raise LeapError("LOCAL_NOT_FOUND", "Choose an original workspace action route.")
                    self.send_json(200, result)
            except (BrokenPipeError, ConnectionResetError):
                self.close_connection = True
            except Exception as error:
                self.fail(error)

    require(isinstance(port, int) and 0 <= port <= 65535, "LOCAL_PORT", "Choose a local port or zero for an assigned port.")
    class OperatorServer(ThreadingHTTPServer):
        daemon_threads = False
        block_on_close = True
    server = OperatorServer(("127.0.0.1", port), Handler)
    server.host_header = "127.0.0.1:" + str(server.server_address[1])
    server.origin = "http://" + server.host_header
    connection = Path(connection_file).absolute() if connection_file else workspace.root / "leap.connection"
    data = (server.origin + "/#" + token + "\n").encode()
    identity = None
    try:
        fd = os.open(connection, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    except BaseException:
        server.server_close()
        raise
    try:
        with os.fdopen(fd, "wb") as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
            identity = os.fstat(out.fileno())
        def shutdown(_signum, _frame):
            threading.Thread(target=server.shutdown, daemon=True).start()
        old_handlers = {}
        if threading.current_thread() is threading.main_thread():
            for sig in (signal.SIGTERM, signal.SIGINT):
                old_handlers[sig] = signal.signal(sig, shutdown)
        print(json.dumps({"status": "READY", "schema": workspace.meta("schema"), "workspace_id": workspace.meta("workspace_id"),
                          "origin": server.origin, "connection_file": str(connection)}), flush=True)
        try:
            server.serve_forever(poll_interval=0.25)
        finally:
            for sig, handler in old_handlers.items():
                signal.signal(sig, handler)
    finally:
        server.server_close()
        try:
            current = connection.lstat()
            if identity is not None and (current.st_dev, current.st_ino) == (identity.st_dev, identity.st_ino) and connection.read_bytes() == data:
                connection.unlink()
        except FileNotFoundError:
            pass
