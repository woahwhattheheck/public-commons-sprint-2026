"""MIT. Local operator console over the same retained XML workspace and SF30 engine."""
from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
from pathlib import Path
import secrets
import shutil
import threading
from urllib.parse import urlsplit, parse_qs, unquote
import zipfile

from workspace import Workspace, InputError, MAX_SOURCE, HERE, json_bytes, load_json


class LimitedReader:
    def __init__(self, source, length: int):
        self.source, self.remaining = source, length

    def read(self, size: int = -1):
        if self.remaining == 0:
            return b""
        block = self.source.read(min(self.remaining, size if size >= 0 else self.remaining))
        if not block:
            raise InputError("Upload ended before its declared content length")
        self.remaining -= len(block)
        return block


class OperatorServer(ThreadingHTTPServer):
    daemon_threads = False
    block_on_close = True

    def __init__(self, workspace: Workspace, port: int = 0):
        self.workspace, self.token = workspace, secrets.token_urlsafe(32)
        self.slots = threading.BoundedSemaphore(8)
        super().__init__(("127.0.0.1", port), Handler)
        self.origin = f"http://127.0.0.1:{self.server_port}"
        self.url = self.origin + "/#" + self.token

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
    server_version = "SF30-XML"
    protocol_version = "HTTP/1.0"

    def setup(self):
        super().setup()
        self.connection.settimeout(60)

    def log_message(self, *_):
        pass  # No private capabilities, paths, query values or XML content in request logs.

    def _gate(self, api: bool = True):
        target = urlsplit(self.path)
        if len(self.headers.get_all("Host", [])) != 1 or len(self.headers.get_all("Origin", [])) > 1:
            raise PermissionError("Repeated local origin or host headers are not accepted")
        if target.scheme or target.netloc or self.headers.get("Host") != urlsplit(self.server.origin).netloc:
            raise PermissionError("Invalid local host")
        if self.headers.get("Origin") not in {None, self.server.origin}:
            raise PermissionError("Cross-origin requests are not accepted")
        if api:
            supplied = self.headers.get("Authorization", "")
            if not secrets.compare_digest(supplied.encode(), ("Bearer " + self.server.token).encode()):
                raise PermissionError("Open this process's private console link")
        return target

    def _headers(self, status, content_type, length, filename=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
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

    def _body(self, maximum=131072):
        raw = self.headers.get("Content-Length", "")
        if self.headers.get("Transfer-Encoding") or len(self.headers.get_all("Content-Length", [])) != 1 or not raw.isdecimal():
            raise InputError("A single Content-Length is required")
        length = int(raw)
        if length > maximum:
            raise InputError("Request exceeds its size limit")
        return LimitedReader(self.rfile, length)

    def _download(self, path: Path, filename: str, media="application/octet-stream"):
        with path.open("rb") as stream:
            self._headers(200, media, path.stat().st_size, filename)
            shutil.copyfileobj(stream, self.wfile, 65536)

    def _run(self, callback):
        try:
            callback()
        except PermissionError as e:
            self._json({"error": str(e)}, 403)
        except (InputError, ValueError, KeyError, zipfile.BadZipFile) as e:
            self._json({"error": str(e)}, 400)
        except FileNotFoundError:
            self._json({"error": "Retained file or operation was not found"}, 404)
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            pass
        except Exception:
            self._json({"error": "The local operation failed; the retained workspace remains available"}, 500)

    def do_GET(self):
        self._run(self._get)

    def _get(self):
        target = self._gate(api=False)
        assets = {"/": ("index.html", "text/html; charset=utf-8"),
                  "/app.js": ("app.js", "text/javascript; charset=utf-8"),
                  "/style.css": ("style.css", "text/css; charset=utf-8")}
        if target.path in assets:
            name, media = assets[target.path]
            body = (HERE / "public" / name).read_bytes()
            self._headers(200, media, len(body)); self.wfile.write(body)
            return
        self._gate()
        query = parse_qs(target.query, keep_blank_values=True)
        if any(len(values) != 1 for values in query.values()):
            raise InputError("Repeated query parameters are not accepted")
        q = {k: v[0] for k, v in query.items()}
        ws = self.server.workspace
        if target.path == "/api/state":
            self._json(ws.state())
        elif target.path == "/api/source":
            self._json(ws.source(q["id"]))
        elif target.path == "/api/plan":
            self._json({"id": q["id"], "plan": ws.plan(q["id"])})
        elif target.path == "/api/changes":
            self._json(ws.comparison_page(q["id"], int(q.get("offset", "0")), int(q.get("limit", "50"))))
        elif target.path == "/api/changes/download":
            self._download(ws.comparison_file(q["id"]), "xml-edition-changes.jsonl", "application/x-ndjson")
        elif target.path in {"/api/export", "/api/dataset-export"}:
            with ws.mutex, ws.scratch() as temp:
                if target.path == "/api/export":
                    archive = temp / "xml-project.zip"
                    ws.export_packet(q["build"], archive)
                else:
                    folder = temp / "dataset"
                    ws.export_dataset(q["build"], folder)
                    archive = temp / "sf30-dataset.zip"
                    with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED) as out:
                        for name in ["data.csv", "dataset.json", "xml-lineage.json"]:
                            out.write(folder / name, name)
                    archive.chmod(0o600)
                self._download(archive, archive.name, "application/zip")
        else:
            self._json({"error": "Unknown local route"}, 404)

    def do_POST(self):
        self._run(self._post)

    def _post(self):
        target = self._gate()
        ws = self.server.workspace
        if target.path == "/api/source":
            name = unquote(self.headers.get("X-XML-Name", "source.xml"))
            label = unquote(self.headers.get("X-XML-Label", name))
            self._json(ws.add_source(self._body(MAX_SOURCE), label, name), 201)
            return
        if target.path == "/api/import":
            with ws.mutex, ws.scratch() as temp:
                path = temp / "input.zip"
                with path.open("xb") as out:
                    path.chmod(0o600)
                    shutil.copyfileobj(self._body(2 * MAX_SOURCE), out, 65536)
                self._json(ws.import_packet(path), 201)
            return
        body = load_json(self._body().read())
        if not isinstance(body, dict):
            raise InputError("Expected a JSON object")
        if target.path == "/api/plan":
            self._json(ws.save_plan(body), 201)
        elif target.path == "/api/build":
            self._json(ws.build(body["source"], body["plan"]), 201)
        elif target.path == "/api/query":
            self._json(ws.query(body["build"], body.get("query", {})))
        elif target.path == "/api/compare":
            self._json(ws.compare(body["before"], body["after"]), 201)
        else:
            self._json({"error": "Unknown local route"}, 404)
