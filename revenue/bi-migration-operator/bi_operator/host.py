"""A private loopback host with one owner per workspace and draining shutdown."""
from __future__ import annotations

import contextlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import signal
import socket
import threading
from urllib.parse import parse_qs, urlsplit
from .service import Service
from .store import Conflict, encoded, now

ASSETS = Path(__file__).resolve().parents[1] / "web"


class WorkspaceLease:
    def __init__(self, root):
        self.root = Path(root).expanduser().resolve()
        self.file = None

    def __enter__(self):
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.file = (self.root / "owner.lock").open("a+b")
        try:
            if os.name == "nt":
                import msvcrt
                if self.file.tell() == 0:
                    self.file.write(b" ")
                    self.file.flush()
                self.file.seek(0)
                msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.file, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.file.seek(0)
            self.file.write(encoded({"pid": os.getpid(), "started": now()}).encode())
            self.file.truncate()
            self.file.flush()
        except (OSError, BlockingIOError):
            self.file.close()
            raise ValueError("This workspace already has an operator process. Use its existing browser window.") from None
        return self

    def __exit__(self, *_):
        if self.file:
            self.file.close()


class Server(ThreadingHTTPServer):
    daemon_threads = False
    block_on_close = True
    allow_reuse_address = False
    request_queue_size = 24

    def __init__(self, service, port=0):
        self.service = service
        self.slots = threading.BoundedSemaphore(12)
        super().__init__(("127.0.0.1", int(port)), Handler)

    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(15)
        return connection, address

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "CommonsBI"
    sys_version = ""

    def log_message(self, *_):
        pass

    def send(self, status, data, content_type="application/json", filename=None):
        if not isinstance(data, bytes):
            data = encoded(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
            "connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        if filename:
            safe = re.sub(r"[^A-Za-z0-9_.-]", "_", Path(filename).name)[:200]
            self.send_header("Content-Disposition", 'attachment; filename="' + safe + '"')
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        if self.command != "HEAD":
            self.wfile.write(data)

    def allowed(self, authenticate=True):
        port = self.server.server_address[1]
        allowed = {f"127.0.0.1:{port}", f"localhost:{port}"}
        if self.headers.get("Host") not in allowed:
            self.send(403, {"error": "Open the local operator address."})
            return False
        origin = self.headers.get("Origin")
        if origin:
            parsed = urlsplit(origin)
            if parsed.scheme != "http" or parsed.netloc not in allowed:
                self.send(403, {"error": "Cross-origin requests are not accepted."})
                return False
        if self.headers.get("Sec-Fetch-Site") == "cross-site":
            self.send(403, {"error": "Open the operator in its own local window."})
            return False
        if authenticate:
            supplied = self.headers.get("Authorization", "")
            expected = "Bearer " + self.server.service.store.setting("access_token")
            if not hmac.compare_digest(supplied, expected):
                self.send(401, {"error": "Open the complete address printed by BI_OPERATOR.py, including its access fragment."})
                return False
        return True

    def do_GET(self):
        parsed = urlsplit(self.path)
        public = parsed.path in {"/", "/index.html", "/app.js", "/style.css", "/favicon.ico"}
        if not self.allowed(authenticate=not public):
            return
        try:
            if public:
                if parsed.path == "/favicon.ico":
                    self.send(204, b"", "image/x-icon")
                    return
                filename = "index.html" if parsed.path == "/" else parsed.path[1:]
                mime = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8"}[Path(filename).suffix]
                self.send(200, (ASSETS / filename).read_bytes(), mime)
                return
            service = self.server.service
            params = {key: values[0] for key, values in parse_qs(parsed.query).items()}
            if parsed.path == "/api/state":
                self.send(200, service.state())
            elif parsed.path == "/api/entity":
                self.send(200, service.store.get(params["kind"], params["id"], params.get("revision")))
            elif parsed.path == "/api/history":
                self.send(200, service.store.history(params["kind"], params["id"]))
            elif parsed.path == "/api/events":
                self.send(200, service.store.events())
            elif parsed.path == "/api/preview":
                self.send(200, service.preview(params["kind"], params["id"], params.get("revision"), params.get("offset", 0), params.get("limit", 100), params.get("search", "")))
            elif parsed.path.startswith("/api/object/"):
                sha = parsed.path.rsplit("/", 1)[-1]
                with service.store.lock:
                    row = service.store.db.execute("SELECT name,media_type FROM blobs WHERE digest=?", (sha,)).fetchone()
                if not row:
                    raise KeyError("The workspace object does not exist.")
                self.send(200, service.store.bytes(sha), row["media_type"], row["name"])
            elif parsed.path.startswith("/api/backup/"):
                data, filename = service.export_file(parsed.path.rsplit("/", 1)[-1])
                self.send(200, data, "application/octet-stream", filename)
            else:
                self.send(404, {"error": "Unknown workspace route."})
        except (KeyError, FileNotFoundError) as error:
            self.send(404, {"error": str(error)})
        except (ValueError, TypeError) as error:
            self.send(400, {"error": str(error)})
        except (BrokenPipeError, ConnectionResetError, socket.timeout):
            self.close_connection = True

    def do_POST(self):
        if not self.allowed():
            return
        try:
            if self.headers.get("Transfer-Encoding"):
                raise ValueError("Send a request with an explicit Content-Length.")
            if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                raise ValueError("Send an application/json request.")
            length = int(self.headers.get("Content-Length", "-1"))
            if length < 2 or length > 90 * 1024 * 1024:
                raise ValueError("The action request must contain between 2 bytes and 90 MiB.")
            data = self.rfile.read(length)
            if len(data) != length:
                raise ValueError("The request body is incomplete.")
            path = urlsplit(self.path).path
            if not path.startswith("/api/action/"):
                self.send(404, {"error": "Unknown workspace action."})
                return
            request = json.loads(data)
            result = self.server.service.dispatch(path.rsplit("/", 1)[-1], request)
            self.send(200, result)
        except Conflict as error:
            self.send(409, {"error": str(error)})
        except (KeyError, ValueError, TypeError) as error:
            self.send(400, {"error": str(error)})
        except (BrokenPipeError, ConnectionResetError, socket.timeout):
            self.close_connection = True
        except Exception as error:
            self.send(500, {"error": str(error)[:1200]})


def serve(workspace, port=0):
    with WorkspaceLease(workspace):
        service = Service(workspace)
        server = Server(service, port)
        previous = {}
        def stop(*_):
            threading.Thread(target=server.shutdown, daemon=True).start()
        for sig in (signal.SIGINT, signal.SIGTERM):
            with contextlib.suppress(ValueError):
                previous[sig] = signal.signal(sig, stop)
        url = f"http://127.0.0.1:{server.server_address[1]}/#token={service.store.setting('access_token')}"
        print(encoded({"service": "Commons BI Operator", "workspace_id": service.store.setting("workspace_id"), "url": url}), flush=True)
        try:
            server.serve_forever(poll_interval=0.2)
        finally:
            server.server_close()
            service.close()
            for sig, handler in previous.items():
                signal.signal(sig, handler)
