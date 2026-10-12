"""MIT. Private local ERDDAP operator console over the retained Workspace and SF30 engine.

The process gate, bounded streaming reader, request slots and static policy follow
the original SF30 XML operator at fe011df4. The Workspace owns all data semantics.
"""
from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import secrets
import hashlib
import shutil
import threading
import uuid
from datetime import datetime, timezone
from urllib.parse import parse_qs, unquote, urlsplit
import zipfile

from erddap_workspace import Workspace, InputError, MAX_SOURCE, MAX_PACKET, json_bytes, load_json
from provider_handoff_workspace import HandoffStore
from provider_handoff import MAX_HANDOFF, MAX_PROFILE

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
        self.handoffs = HandoffStore(workspace)
        self.workspace_id = hashlib.sha256(str(workspace.root).encode("utf-8")).hexdigest()
        self.instance_id = str(uuid.uuid4())
        self.started_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        self.slots = threading.BoundedSemaphore(8)
        super().__init__(("127.0.0.1", port), Handler)
        self.origin = f"http://127.0.0.1:{self.server_port}"
        self.url = self.origin + "/#" + self.token

    def startup(self):
        return {"schema": "stellar-forge.erddap-workspace-startup.v1",
                "state": "LISTENING", "instanceId": self.instance_id,
                "workspace": str(self.workspace.root), "url": self.url,
                "startedAt": self.started_at}

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
    server_version = "SF30-ERDDAP"
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
            if len(self.headers.get_all("Authorization", [])) != 1:
                raise PermissionError("One private console authorization is required")
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
        values = parse_qs(target.query, keep_blank_values=True, max_num_fields=128)
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
            body = {"error": str(error)}
            for attribute, name in (("provider_status", "providerStatus"), ("retry_after", "retryAfter"), ("current_revision", "currentRevision")):
                value = getattr(error, attribute, None)
                if value is not None or (attribute == "current_revision" and hasattr(error, attribute)):
                    body[name] = value
            self._json(body, status if status in {400, 404, 409, 413, 422, 429, 502, 503, 504} else 400)
        except FileNotFoundError:
            self._json({"error": "The selected retained source, query or edition was not found"}, 404)
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            pass
        except Exception:
            self._json({"error": "The local operation failed. Reopen its retained operation and workspace."}, 500)

    def _object(self, maximum=131072):
        if self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
            raise InputError("Send the reviewed request as application/json")
        body = load_json(self._body(maximum).read())
        if not isinstance(body, dict):
            raise InputError("Expected a JSON object")
        return body

    def _zip_body(self, maximum):
        if self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/zip":
            raise InputError("Upload the complete original application/zip file")
        return self._body(maximum)

    @staticmethod
    def _field(body, name):
        if name not in body:
            raise InputError("Required request field: " + name)
        return body[name]

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
        query, ws = self._query(target), self.server.workspace
        if target.path == "/api/launch":
            value = self.server.startup()
            value.pop("url")
            self._json(value)
            return
        if target.path == "/api/state":
            value = ws.state()
            value["workspace"] = {"id": self.server.workspace_id, "name": ws.root.name}
            self._json(value)
            return
        parts = target.path.strip("/").split("/")
        if target.path == "/api/handoffs":
            self._json(self.server.handoffs.state())
            return
        if target.path == "/api/handoffs/draft":
            self._json(self.server.handoffs.draft(self._field(query, "source")))
            return
        if target.path == "/api/handoffs/history":
            self._json(self.server.handoffs.history(self._field(query, "source"),
                                                    self._integer(query, "offset", 0),
                                                    self._integer(query, "limit", 100, 1, 250)))
            return
        if len(parts) == 4 and parts[:3] == ["api", "handoffs", "received"]:
            self._json(self.server.handoffs.received(parts[3]))
            return
        if len(parts) == 5 and parts[:3] == ["api", "handoffs", "received"] and parts[4] == "bundle":
            self._download(self.server.handoffs.received_path(parts[3]),
                           "received-provider-handoff-" + parts[3][:16] + ".zip",
                           "application/zip")
            return
        if len(parts) == 4 and parts[:3] == ["api", "handoffs", "reviews"]:
            self._json(self.server.handoffs.get(parts[3]))
            return
        if len(parts) == 5 and parts[:3] == ["api", "handoffs", "exports"]:
            if parts[4] not in {"review", "ready"}:
                raise InputError("Select review or ready provider export")
            value = self.server.handoffs.export(parts[3], mode=parts[4])
            self._download(Path(value["path"]),
                           "provider-handoff-" + parts[3][:16] + "-" + parts[4] + ".zip",
                           "application/zip")
            return
        if len(parts) == 3 and parts[:2] == ["api", "metadata"]:
            self._json(ws.metadata_item(parts[2]))
            return
        if len(parts) == 3 and parts[:2] == ["api", "queries"]:
            self._json(ws.query_plan(parts[2]))
            return
        if len(parts) == 3 and parts[:2] == ["api", "operations"]:
            self._json(ws.operation(parts[2]))
            return
        if parts[:2] == ["api", "sources"] and len(parts) in {3, 4, 5}:
            sid = parts[2]
            if len(parts) == 3:
                self._json(ws.source(sid))
            elif len(parts) == 4 and parts[3] == "rows":
                self._json(ws.source_rows(sid, self._integer(query, "offset", 0),
                                          self._integer(query, "limit", 100, 1, 250)))
            elif len(parts) == 5 and parts[3] == "files":
                name = parts[4]
                media = {"metadata.json": "application/json; charset=utf-8",
                         "manifest.json": "application/json; charset=utf-8",
                         "data.json": "application/json; charset=utf-8",
                         "data.csv": "text/csv; charset=iso-8859-1",
                         "dataset.dds": "text/plain; charset=ascii",
                         "dataset.das": "text/plain; charset=utf-8"}
                if name not in media:
                    raise InputError("Unknown original ERDDAP response file")
                with ws.mutex:
                    data = ws.source_member(sid, name)
                    self._headers(200, media[name], len(data), name)
                    self.wfile.write(data)
            else:
                self._json({"error": "Unknown local route"}, 404)
            return
        if len(parts) == 3 and parts[:2] == ["api", "plans"]:
            self._json(ws.plan(parts[2]))
            return
        if parts[:2] == ["api", "builds"] and len(parts) in {3, 4}:
            build_id = parts[2]
            if len(parts) == 3:
                self._json(ws.build_view(build_id))
            elif parts[3] == "query":
                self._json(ws.query(build_id, query))
            elif parts[3] in {"packet", "dataset"}:
                with ws.mutex, ws.scratch() as temporary:
                    if parts[3] == "packet":
                        archive = temporary / "erddap-project.zip"
                        ws.export_packet(build_id, archive)
                    else:
                        folder = temporary / "dataset"
                        ws.export_dataset(build_id, folder)
                        archive = temporary / "erddap-dataset.zip"
                        with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as output:
                            for name in sorted(["data.csv", "dataset.json", "erddap-lineage.json"]):
                                info = zipfile.ZipInfo(name, (2000, 1, 1, 0, 0, 0))
                                info.create_system = 3
                                info.external_attr = 0o100600 << 16
                                info.compress_type = zipfile.ZIP_DEFLATED
                                info._compresslevel = 6
                                with (folder / name).open("rb") as source, output.open(info, "w") as member:
                                    shutil.copyfileobj(source, member, 65536)
                        archive.chmod(0o600)
                    self._download(archive, archive.name, "application/zip")
            else:
                self._json({"error": "Unknown local route"}, 404)
            return
        if len(parts) == 4 and parts[:2] == ["api", "comparisons"] and parts[3] == "changes":
            self._json(ws.changes(parts[2], self._integer(query, "offset", 0),
                                  self._integer(query, "limit", 100, 1, 250)))
            return
        self._json({"error": "Unknown local route"}, 404)

    def do_POST(self):
        self._run(self._post)

    def _post(self):
        target, ws = self._gate(), self.server.workspace
        if target.path == "/api/sources":
            name = unquote(self.headers.get("X-Source-Name", "source.erddap.zip"), errors="strict")
            label = unquote(self.headers.get("X-Source-Label", name), errors="strict")
            self._json(ws.add_source(self._zip_body(MAX_SOURCE), label, name), 201)
            return
        if target.path == "/api/packets":
            with ws.mutex, ws.scratch() as temporary:
                packet = temporary / "incoming-erddap-project.zip"
                with packet.open("xb") as output:
                    packet.chmod(0o600)
                    shutil.copyfileobj(self._zip_body(MAX_PACKET), output, 65536)
                result = ws.import_packet(packet)
            self._json(result, 201)
            return
        if target.path == "/api/handoffs/receive":
            self._json(self.server.handoffs.receive(self._zip_body(MAX_HANDOFF)), 201)
            return
        if target.path in {"/api/handoffs/previews", "/api/handoffs/reviews", "/api/handoffs/exports"}:
            body = self._object(MAX_PROFILE + 4096)
            store = self.server.handoffs
            if target.path == "/api/handoffs/previews":
                self._json(store.preview(self._field(body, "source"), self._field(body, "profile")))
            elif target.path == "/api/handoffs/reviews":
                self._json(store.save(self._field(body, "source"), self._field(body, "profile"),
                                      expected_head=body.get("expectedHead")), 201)
            else:
                value = store.export(self._field(body, "revision"), mode=body.get("mode", "review"))
                self._json({key: item for key, item in value.items() if key != "path"})
            return
        body = self._object()
        parts = target.path.strip("/").split("/")
        if target.path == "/api/search":
            self._json(ws.search(self._field(body, "server"), body.get("text", ""),
                                 body.get("page", 1), body.get("limit", 50)))
        elif target.path == "/api/metadata":
            self._json(ws.load_metadata(self._field(body, "server"),
                                        self._field(body, "datasetId"),
                                        self._field(body, "protocol")), 201)
        elif target.path == "/api/queries":
            self._json(ws.save_query(body), 201)
        elif len(parts) == 4 and parts[:2] == ["api", "queries"] and parts[3] == "acquire":
            self._json(ws.acquire(parts[2], self._field(body, "operationId"), body.get("label")), 201)
        elif len(parts) == 4 and parts[:2] == ["api", "sources"] and parts[3] == "mapping":
            self._json(ws.default_mapping(parts[2], body.get("name")))
        elif target.path == "/api/plans":
            self._json(ws.save_plan(body), 201)
        elif target.path == "/api/builds":
            self._json(ws.build(self._field(body, "sourceId"), self._field(body, "planId")), 201)
        elif target.path == "/api/comparisons":
            self._json(ws.compare(self._field(body, "beforeId"), self._field(body, "afterId")), 201)
        else:
            self._json({"error": "Unknown local route"}, 404)
