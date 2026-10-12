"""MIT. Private local feed console over the retained original workspace."""
from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import secrets
import shutil
import threading
import time
from urllib.parse import urlsplit, parse_qs
import uuid
import zipfile

from feed_workspace import FeedWorkspace, InputError, MAX_FEED_BYTES, json_bytes, load_json, digest, checked_id, file_digest
from operations import execute

HERE = Path(__file__).resolve().parent

class BusyError(Exception):
    pass

class LimitedReader:
    def __init__(self, source, remaining):
        self.source, self.remaining = source, remaining
    def read(self, count=-1):
        if not self.remaining:
            return b""
        data = self.source.read(min(self.remaining, count if count >= 0 else self.remaining))
        if not data:
            raise InputError("Upload ended before its declared content length")
        self.remaining -= len(data)
        return data

class OperatorServer(ThreadingHTTPServer):
    daemon_threads = False
    block_on_close = True
    def __init__(self, workspace, port=0):
        self.workspace, self.token = workspace, secrets.token_urlsafe(32)
        self.slots = threading.BoundedSemaphore(8)
        self.jobs = threading.RLock()
        self.job, self.worker = None, None
        self.launch = None
        super().__init__(("127.0.0.1", port), Handler)
        self.origin = "http://127.0.0.1" + ("" if self.server_port == 80 else ":" + str(self.server_port))
        self.hosts = {urlsplit(self.origin).netloc, f"127.0.0.1:{self.server_port}"}
        self.origins = {self.origin, f"http://127.0.0.1:{self.server_port}"}
        self.url = self.origin + "/#" + self.token

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request); return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.slots.release(); raise
    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()

    def idle(self):
        with self.jobs:
            if self.job and self.job["state"] == "RUNNING":
                raise BusyError("A workspace action is running; follow its activity before another action")

    def activity(self):
        with self.jobs:
            current = dict(self.job) if self.job else {"state": "IDLE"}
            if current.get("action") in ("capture", "resume") and current["state"] == "RUNNING":
                current["capture"] = getattr(self.workspace, "capture_progress", None)
            if current.get("action") in ("collection-capture", "collection-resume") and current["state"] == "RUNNING":
                current["collection"] = self.workspace.subscriptions.progress
                current["capture"] = getattr(self.workspace, "capture_progress", None)
            return current

    def start(self, body, callback=None, cleanup=None):
        encoded = json_bytes(body)
        ident = digest(encoded)
        with self.jobs:
            if self.job and self.job["id"] == ident and self.job["state"] in ("RUNNING", "DONE"):
                if cleanup: cleanup()
                return self.activity()
            self.idle()
            self.job = {"id": ident, "action": body["action"], "operationId": body.get("operationId"),
                        "state": "RUNNING", "startedAt": time.time()}
            def run():
                try:
                    result = callback() if callback else execute(self.workspace, body)
                    with self.jobs:
                        self.job.update(state="DONE", result=result, completedAt=time.time())
                except Exception as error:
                    with self.jobs:
                        self.job.update(state="FAILED", error=str(error), completedAt=time.time())
                finally:
                    if cleanup: cleanup()
            self.worker = threading.Thread(target=run, name="feed-operation", daemon=False)
            self.worker.start()
            return self.activity()

    def join_worker(self):
        if self.worker:
            self.worker.join()

class Handler(BaseHTTPRequestHandler):
    server_version = "SF30-Feeds"
    protocol_version = "HTTP/1.0"
    def setup(self):
        super().setup()
        self.connection.settimeout(60)
    def log_message(self, *_):
        pass
    def _gate(self, api=True):
        target = urlsplit(self.path)
        if len(self.headers.get_all("Host", [])) != 1 or len(self.headers.get_all("Origin", [])) > 1:
            raise PermissionError("Repeated local host or origin")
        if target.scheme or target.netloc or self.headers.get("Host") not in self.server.hosts:
            raise PermissionError("Invalid local host")
        if self.headers.get("Origin") not in self.server.origins | {None}:
            raise PermissionError("Cross-origin requests are not accepted")
        if api:
            supplied = self.headers.get("Authorization", "")
            if len(self.headers.get_all("Authorization", [])) != 1 or not secrets.compare_digest(
                    supplied.encode(), ("Bearer " + self.server.token).encode()):
                raise PermissionError("Open this process's private console link")
        return target

    def _headers(self, status, media, length, filename=None):
        self.send_response(status)
        self.send_header("Content-Type", media)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.end_headers()

    def _json(self, value, status=200):
        data = json_bytes(value)
        self._headers(status, "application/json; charset=utf-8", len(data))
        self.wfile.write(data)

    def _body(self, maximum=16 * 1024 * 1024):
        raw = self.headers.get("Content-Length", "")
        if self.headers.get("Transfer-Encoding") or len(self.headers.get_all("Content-Length", [])) != 1 or not raw.isdecimal():
            raise InputError("A single Content-Length is required")
        if int(raw) > maximum:
            raise InputError("Upload exceeds this action's size limit")
        return LimitedReader(self.rfile, int(raw))

    def _download(self, path, filename, media="application/octet-stream"):
        with path.open("rb") as stream:
            self._headers(200, media, path.stat().st_size, filename)
            shutil.copyfileobj(stream, self.wfile, 65536)

    def _run(self, callback):
        try:
            callback()
        except PermissionError as error:
            self._json({"error": str(error)}, 403)
        except BusyError as error:
            self._json({"error": str(error), "activity": self.server.activity()}, 409)
        except FileNotFoundError:
            self._json({"error": "The retained item was not found"}, 404)
        except (InputError, ValueError, KeyError, TypeError, zipfile.BadZipFile) as error:
            self._json({"error": str(error)}, 400)
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            pass
        except Exception as error:
            self._json({"error": "Workspace action failed: " + str(error)}, 500)

    def _query(self, target):
        values = parse_qs(target.query, keep_blank_values=True)
        if any(len(v) != 1 for v in values.values()):
            raise InputError("Repeated query parameters are not accepted")
        return {k: v[0] for k, v in values.items()}

    def do_GET(self):
        self._run(self._get)
    def _get(self):
        target = self._gate(False)
        assets = {"/": ("index.html", "text/html; charset=utf-8"),
                  "/app.js": ("app.js", "text/javascript; charset=utf-8"),
                  "/style.css": ("style.css", "text/css; charset=utf-8"),
                  "/subscriptions": ("subscriptions.html", "text/html; charset=utf-8"),
                  "/subscriptions.js": ("subscriptions.js", "text/javascript; charset=utf-8"),
                  "/subscriptions.css": ("subscriptions.css", "text/css; charset=utf-8")}
        if target.path in assets:
            name, media = assets[target.path]
            data = (HERE / "public" / name).read_bytes()
            self._headers(200, media, len(data)); self.wfile.write(data); return
        self._gate()
        q, ws = self._query(target), self.server.workspace
        if target.path == "/api/activity":
            self._json(self.server.activity()); return
        if target.path == "/api/launch":
            if self.server.launch is None:
                raise InputError("Open this console with its original structured startup")
            self._json(self.server.launch); return
        self.server.idle()
        if target.path == "/api/subscriptions":
            self._json(ws.subscriptions.state())
        elif target.path == "/api/subscriptions/plan":
            self._json(ws.subscriptions.plan(q["source"]))
        elif target.path == "/api/subscriptions/collection":
            self._json(ws.subscriptions.view(q["id"], int(q["revision"]) if q.get("revision") else None))
        elif target.path == "/api/subscriptions/run":
            self._json(ws.subscriptions.review(q["id"]))
        elif target.path == "/api/subscriptions/original":
            self._download(ws.subscriptions.source_path(q["source"]), q["source"] + ".opml", "text/x-opml")
        elif target.path == "/api/subscriptions/opml":
            data = ws.subscriptions.opml(q["collection"], int(q["revision"]) if q.get("revision") else None)
            self._headers(200, "text/x-opml", len(data), "subscriptions.opml"); self.wfile.write(data)
        elif target.path == "/api/subscriptions/project":
            with ws.mutex, ws.scratch() as temp:
                archive = temp / "feed-collection.zip"
                ws.subscriptions.export(q["binding"], archive)
                self._download(archive, archive.name, "application/zip")
        elif target.path == "/api/state":
            self._json(ws.feed_state())
        elif target.path == "/api/captures":
            self._json(ws.captures(q["feed"], int(q.get("offset", 0)), int(q.get("limit", 50))))
        elif target.path == "/api/review":
            self._json(ws.review(q["capture"], int(q.get("offset", 0)), int(q.get("limit", 50))))
        elif target.path == "/api/requests":
            self._json(ws.requests(q["capture"]))
        elif target.path == "/api/records":
            self._json(ws.records(q["feed"], query=q.get("query", ""), state=q.get("state", "active"),
                                   offset=int(q.get("offset", 0)), limit=int(q.get("limit", 50))))
        elif target.path == "/api/edition":
            self._json(ws.edition_summary(ws.edition_view(q["id"])))
        elif target.path == "/api/changes":
            self._json(ws.comparison_page(q["id"], int(q.get("offset", 0)), int(q.get("limit", 50))))
        elif target.path == "/api/changes/download":
            self._download(ws.comparison_file(q["id"]), "feed-edition-changes.jsonl", "application/x-ndjson")
        elif target.path == "/api/source":
            ident = checked_id(q["sha256"])
            path = ws.root / "sources" / (ident + ".xml")
            if file_digest(path) != ident:
                raise InputError("Retained source bytes changed")
            self._download(path, ident + ".xml", "application/xml")
        elif target.path == "/api/http-body":
            ident = checked_id(q["sha256"])
            path = ws.root / "feed-http" / (ident + ".body")
            if file_digest(path, MAX_FEED_BYTES) != ident:
                raise InputError("Retained HTTP response bytes changed")
            self._download(path, ident + ".body")
        elif target.path in ("/api/export", "/api/project"):
            with ws.mutex, ws.scratch() as temp:
                archive = temp / ("feed-project.zip" if target.path == "/api/project" else "feed-dataset.zip")
                if target.path == "/api/project":
                    ws.export_project(q["edition"], archive)
                else:
                    folder = temp / "dataset"
                    ws.export_edition(q["edition"], folder)
                    with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED) as out:
                        for source in folder.iterdir():
                            out.write(source, source.name)
                    archive.chmod(0o600)
                self._download(archive, archive.name, "application/zip")
        else:
            self._json({"error": "Unknown local route"}, 404)

    def do_POST(self):
        self._run(self._post)
    def _post(self):
        target = self._gate()
        ws, q = self.server.workspace, self._query(target)
        if target.path == "/api/cancel":
            self._body().read()
            self._json(ws.cancel_capture()); return
        if target.path == "/api/action":
            body = load_json(self._body().read())
            if not isinstance(body, dict) or not isinstance(body.get("action"), str):
                raise InputError("Choose a feed action")
            self._json(self.server.start(body), 202); return
        self.server.idle()
        if target.path == "/api/subscriptions/import":
            from opml_source import MAX_OPML_BYTES
            data = self._body(MAX_OPML_BYTES).read()
            body = {"action": "opml-import", "operationId": q["operation"], "sha256": digest(data)}
            self._json(self.server.start(body, lambda: ws.subscriptions.import_opml(data, q["operation"])), 202)
        elif target.path == "/api/subscriptions/receive":
            from subscriptions import MAX_PACKET
            path = ws.root / "tmp" / ("collection-receive-" + uuid.uuid4().hex + ".zip")
            try:
                with path.open("xb") as output:
                    path.chmod(0o600)
                    shutil.copyfileobj(self._body(MAX_PACKET), output, 65536)
                body = {"action": "collection-receive", "operationId": q["operation"], "sha256": file_digest(path, MAX_PACKET)}
                job = self.server.start(body, lambda: ws.subscriptions.receive(path, q["operation"]),
                                        lambda: path.unlink(missing_ok=True))
            except Exception:
                path.unlink(missing_ok=True); raise
            self._json(job, 202)
        elif target.path == "/api/import":
            data = self._body(MAX_FEED_BYTES).read()
            body = {"action": "import", "feedId": q["feed"], "operationId": q["operation"],
                    "sourceUrl": q.get("url"), "sha256": digest(data)}
            self._json(self.server.start(body, lambda: ws.import_source(q["feed"], data, q["operation"], q.get("url"))), 202)
        elif target.path == "/api/receive":
            path = ws.root / "tmp" / ("feed-receive-" + uuid.uuid4().hex + ".zip")
            try:
                with path.open("xb") as output:
                    path.chmod(0o600)
                    shutil.copyfileobj(self._body(1024 * 1024 * 1024), output, 65536)
                body = {"action": "receive", "operationId": q["operation"], "sha256": file_digest(path, 1024 * 1024 * 1024)}
                job = self.server.start(body, lambda: ws.receive_project(path, q["operation"]),
                                        lambda: path.unlink(missing_ok=True))
            except Exception:
                path.unlink(missing_ok=True); raise
            self._json(job, 202)
        else:
            self._json({"error": "Unknown local route"}, 404)
