"""MIT. Private local SDMX operator console over the retained Workspace and SF30 engine.

The process gate, bounded streaming reader, request slots and static policy follow
the original SF30 XML operator at fe011df4. The Workspace owns all data semantics.
"""
from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import secrets
import shutil
import threading
from urllib.parse import parse_qs, unquote, urlsplit
import zipfile

from sdmx_workspace import Workspace, InputError, MAX_SOURCE, MAX_PACKET, json_bytes, load_json

HERE = Path(__file__).resolve().parent


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
    server_version = "SF30-SDMX"
    protocol_version = "HTTP/1.0"

    def setup(self):
        super().setup()
        self.connection.settimeout(60)

    def log_message(self, *_):
        pass

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

    def _query(self, target):
        values = parse_qs(target.query, keep_blank_values=True)
        if any(len(items) != 1 for items in values.values()):
            raise InputError("Repeated query parameters are not accepted")
        return {key: items[0] for key, items in values.items()}

    def _integer(self, query, key, default, minimum=0, maximum=100000000):
        raw = query.get(key, str(default))
        if not raw.isdecimal():
            raise InputError(f"{key} must be a nonnegative integer")
        value = int(raw)
        if not minimum <= value <= maximum:
            raise InputError(f"{key} is outside its supported range")
        return value

    def _revision(self, values, key="revision"):
        value = values.get(key)
        if value is None or value == "":
            return None
        if isinstance(value, bool):
            raise InputError("Revision must be a positive integer")
        try:
            revision = int(value)
        except (TypeError, ValueError) as error:
            raise InputError("Revision must be a positive integer") from error
        if revision < 1 or str(revision) != str(value):
            raise InputError("Revision must be a positive integer")
        return revision

    def _download(self, path: Path, filename: str, media="application/octet-stream"):
        with path.open("rb") as stream:
            self._headers(200, media, path.stat().st_size, filename)
            shutil.copyfileobj(stream, self.wfile, 65536)

    def _run(self, callback):
        try:
            callback()
        except PermissionError as error:
            self._json({"error": str(error)}, 403)
        except (InputError, ValueError, KeyError, zipfile.BadZipFile) as error:
            status = getattr(error, "status", 400)
            self._json({"error": str(error)}, status if status in {400, 409, 413, 422} else 400)
        except FileNotFoundError:
            self._json({"error": "Retained source, project or comparison was not found"}, 404)
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            pass
        except Exception:
            self._json({"error": "The local operation failed; the retained workspace remains available"}, 500)

    def do_GET(self):
        self._run(self._get)

    def _get(self):
        target = self._gate(api=False)
        assets = {
            "/": ("index.html", "text/html; charset=utf-8"),
            "/app.js": ("app.js", "text/javascript; charset=utf-8"),
            "/style.css": ("style.css", "text/css; charset=utf-8"),
        }
        if target.path in assets:
            name, media = assets[target.path]
            data = (HERE / "public" / name).read_bytes()
            self._headers(200, media, len(data))
            self.wfile.write(data)
            return
        self._gate()
        query = self._query(target)
        ws = self.server.workspace
        if target.path == "/api/state":
            self._json(ws.state())
            return
        parts = target.path.strip("/").split("/")
        if len(parts) in {3, 4} and parts[:2] == ["api", "sources"]:
            source_id = parts[2]
            if len(parts) == 3:
                self._json(ws.source(source_id))
            elif parts[3] == "series":
                self._json(ws.series(source_id, self._integer(query, "offset", 0),
                                     self._integer(query, "limit", 50, 1, 200), query.get("query", "")))
            elif parts[3] == "observations":
                self._json(ws.observations(source_id, query.get("series_key") or None,
                    self._integer(query, "offset", 0), self._integer(query, "limit", 50, 1, 200)))
            else:
                self._json({"error": "Unknown local route"}, 404)
            return
        if len(parts) in {3, 4} and parts[:2] == ["api", "projects"]:
            project_id = parts[2]
            revision = self._revision(query)
            if len(parts) == 3:
                self._json(ws.project(project_id, revision))
            elif parts[3] in {"dataset", "packet"}:
                with ws.mutex, ws.scratch() as temporary:
                    if parts[3] == "packet":
                        archive = temporary / "sdmx-project.zip"
                        ws.export_packet(project_id, archive, revision)
                    else:
                        folder = temporary / "dataset"
                        ws.export_dataset(project_id, folder, revision)
                        archive = temporary / "sf30-sdmx-dataset.zip"
                        with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED) as output:
                            for name in ["data.csv", "dataset.json", "sdmx-lineage.json"]:
                                output.write(folder / name, name)
                        archive.chmod(0o600)
                    self._download(archive, archive.name, "application/zip")
            else:
                self._json({"error": "Unknown local route"}, 404)
            return
        if len(parts) == 3 and parts[:2] == ["api", "comparisons"]:
            self._json(ws.comparison_page(parts[2], self._integer(query, "offset", 0),
                                         self._integer(query, "limit", 50, 1, 200)))
            return
        self._json({"error": "Unknown local route"}, 404)

    def do_POST(self):
        self._run(self._post)

    def _post(self):
        target = self._gate()
        ws = self.server.workspace
        if target.path == "/api/sources/upload":
            name = unquote(self.headers.get("X-SDMX-Name", "source.xml"))
            metadata = {
                "name": name,
                "label": unquote(self.headers.get("X-SDMX-Label", name)),
                "origin": unquote(self.headers.get("X-SDMX-Origin", "")),
                "kind": unquote(self.headers.get("X-SDMX-Kind", "auto")),
            }
            media_type = self.headers.get("Content-Type")
            if media_type:
                metadata["media_type"] = media_type.split(";", 1)[0].strip()
            self._json(ws.add_source(self._body(MAX_SOURCE), metadata), 201)
            return
        if target.path == "/api/import":
            with ws.mutex, ws.scratch() as temporary:
                packet = temporary / "input.zip"
                with packet.open("xb") as output:
                    packet.chmod(0o600)
                    shutil.copyfileobj(self._body(MAX_PACKET), output, 65536)
                result = ws.import_packet(packet)
            self._json(result, 201)
            return
        body = load_json(self._body().read())
        if not isinstance(body, dict):
            raise InputError("Expected a JSON object")
        if target.path == "/api/projects":
            self._json(ws.save_project(body), 201)
        elif target.path == "/api/query":
            params = body.get("params", {})
            if not isinstance(params, dict):
                raise InputError("Native query parameters must be an object")
            self._json(ws.query(body["project_id"], params, self._revision(body)))
        elif target.path == "/api/comparisons":
            self._json(ws.compare(body["before_project"], body["after_project"],
                self._revision(body, "before_revision"), self._revision(body, "after_revision")), 201)
        else:
            self._json({"error": "Unknown local route"}, 404)
