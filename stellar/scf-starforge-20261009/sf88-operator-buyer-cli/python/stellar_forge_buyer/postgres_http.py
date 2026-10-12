"""Private browser receiving for the original PostgreSQL warehouse."""
from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import re
import secrets
from urllib.parse import parse_qs, unquote, urlsplit

from . import _postgres_ui
from .errors import BuyerError
from .postgres_delivery import WarehouseError
from .postgres_operator import PostgresOperator, fields, integer, wire
from .storage import digest, dump, parse

_MAX_BODY = 2 * 1024 * 1024


def serve(warehouse, directory, *, port=0):
    """Open an owned IPv4 loopback listener and retain its private launch URL."""
    integer(port, maximum=65535)
    operator = PostgresOperator(warehouse, directory)
    token = secrets.token_urlsafe(32)

    class Handler(BaseHTTPRequestHandler):
        server_version = "StellarForgePostgres"
        sys_version = ""

        def setup(self):
            super().setup()
            self.connection.settimeout(30)

        def log_message(self, *args):
            pass

        def _reply(self, status, body, mime="application/json;charset=utf-8", filename=None):
            payload = body if isinstance(body, bytes) else json.dumps(
                wire(body), ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()
            self.send_response(status)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy",
                             "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; "
                             "base-uri 'none'; frame-ancestors 'none'; form-action 'none'")
            if filename:
                safe = re.sub(r"[^A-Za-z0-9_.-]", "_", filename)
                self.send_header("Content-Disposition", 'attachment; filename="' + safe + '"')
                self.send_header("X-Content-SHA256", digest(payload))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(payload)

        def _dispatch(self):
            origin = "http://127.0.0.1:" + str(self.server.server_port)
            if (self.headers.get_all("Host") != [origin[7:]]
                    or self.headers.get("Origin", origin) != origin
                    or self.headers.get("Sec-Fetch-Site", "none") not in {"none", "same-origin"}):
                return self._reply(403, {"error": "DATASET_PG_OPERATOR_LOCAL_ORIGIN_REQUIRED"})
            url = urlsplit(self.path)
            if url.scheme or url.netloc or url.fragment:
                return self._reply(400, {"error": "DATASET_PG_OPERATOR_ROUTE_INVALID"})
            assets = {"/": (_postgres_ui.HTML, "text/html;charset=utf-8"),
                      "/app.js": (_postgres_ui.JS, "text/javascript;charset=utf-8"),
                      "/style.css": (_postgres_ui.CSS, "text/css;charset=utf-8")}
            if self.command in {"GET", "HEAD"} and url.path in assets and not url.query:
                value, mime = assets[url.path]
                return self._reply(200, value.encode(), mime)
            capabilities = self.headers.get_all("X-Postgres-Capability", [])
            if len(capabilities) != 1 or not secrets.compare_digest(capabilities[0], token):
                return self._reply(403, {"error": "DATASET_PG_OPERATOR_CAPABILITY_REQUIRED"})
            parameters = parse_qs(url.query, strict_parsing=True)
            if any(len(values) != 1 for values in parameters.values()):
                raise WarehouseError("DATASET_PG_OPERATOR_PARAMETERS_INVALID")
            values = {key: items[0] for key, items in parameters.items()}
            parts = [unquote(part) for part in url.path.strip("/").split("/")]
            if self.command in {"GET", "HEAD"}:
                with operator.mutex:
                    if url.path == "/api/state" and not values:
                        return self._reply(200, operator.state())
                    if url.path == "/api/versions":
                        fields(values, optional=("before", "limit"))
                        return self._reply(200, warehouse.versions(
                            before=int(values["before"]) if "before" in values else None,
                            limit=integer(int(values.get("limit", "50")), minimum=1)))
                    if url.path in {"/api/reviews", "/api/requests"}:
                        fields(values, optional=("before", "limit"))
                        return self._reply(200, operator.records(parts[-1], before=values.get("before"),
                            limit=integer(int(values.get("limit", "50")), minimum=1, maximum=100)))
                    if len(parts) == 3 and parts[:2] == ["api", "versions"] and not values:
                        return self._reply(200, warehouse.version(parts[2]))
                    if len(parts) == 3 and parts[:2] == ["api", "reviews"] and not values:
                        return self._reply(200, operator.review_record(parts[2]))
                    if len(parts) == 3 and parts[:2] == ["api", "requests"] and not values:
                        return self._reply(200, operator.request_record(parts[2]))
                    if url.path == "/api/current":
                        fields(values, ("name",))
                        return self._reply(200, warehouse.current(values["name"]))
                    if url.path == "/api/history":
                        fields(values, ("name",), ("before", "limit"))
                        return self._reply(200, warehouse.history(values["name"],
                            before=int(values["before"]) if "before" in values else None,
                            limit=integer(int(values.get("limit", "50")), minimum=1)))
                    if url.path == "/api/rows":
                        fields(values, ("version_id",), ("after", "limit", "include_original"))
                        if values.get("include_original", "true") not in {"true", "false"}:
                            raise WarehouseError("DATASET_PG_OPERATOR_PARAMETERS_INVALID")
                        return self._reply(200, warehouse.rows(values["version_id"],
                            after=integer(int(values.get("after", "0")), maximum=1000000),
                            limit=integer(int(values.get("limit", "50")), minimum=1),
                            include_original=values.get("include_original", "true") == "true"))
                    if url.path == "/api/compare":
                        fields(values, ("previous", "current"), ("offset", "limit"))
                        return self._reply(200, warehouse.compare(values["previous"], values["current"],
                            offset=integer(int(values.get("offset", "0")), maximum=2000000),
                            limit=integer(int(values.get("limit", "50")), minimum=1)))
                    if url.path in {"/api/semantics", "/api/semantics-file"}:
                        fields(values, ("version_id",))
                        version_id = values["version_id"]
                        if url.path == "/api/semantics":
                            return self._reply(200, warehouse.semantics(version_id))
                        raw = warehouse.semantics_bytes(version_id)
                        if raw is None:
                            return self._reply(404, {"error": "DATASET_PG_LEGACY_EDITION_HAS_NO_DICTIONARY"})
                        return self._reply(200, raw, "application/json",
                                           "semantics-" + version_id + ".json")
                    if url.path == "/api/semantic-compare":
                        fields(values, ("previous", "current"))
                        comparison = warehouse.compare_semantics(values["previous"], values["current"])
                        return self._reply(200, comparison)
                    if url.path == "/api/manifest":
                        fields(values, ("version_id",))
                        return self._reply(200, warehouse.manifest_bytes(values["version_id"]),
                            "application/json", "manifest-" + values["version_id"] + ".json")
                    if url.path == "/api/mapping":
                        fields(values, ("version_id",))
                        mapping = warehouse.version(values["version_id"])["mapping"]
                        return self._reply(200, mapping, filename="postgres-mapping-" + values["version_id"] + ".json")
                    if url.path == "/api/edition":
                        fields(values, ("version_id",))
                        return self._reply(200, warehouse.version(values["version_id"]),
                            filename="postgres-edition-" + values["version_id"] + ".json")
            elif self.command == "POST" and not url.query:
                if self.headers.get("Transfer-Encoding") or self.headers.get_content_type() != "application/json":
                    return self._reply(415, {"error": "DATASET_PG_OPERATOR_JSON_REQUIRED"})
                sizes = self.headers.get_all("Content-Length", [])
                if len(sizes) != 1 or not sizes[0].isascii() or not sizes[0].isdigit():
                    return self._reply(411, {"error": "DATASET_PG_OPERATOR_LENGTH_REQUIRED"})
                size = int(sizes[0])
                if not 0 < size <= _MAX_BODY:
                    return self._reply(413, {"error": "DATASET_PG_OPERATOR_REQUEST_SIZE_INVALID"})
                raw = self.rfile.read(size)
                if len(raw) != size:
                    raise WarehouseError("DATASET_PG_OPERATOR_REQUEST_INCOMPLETE")
                body = parse(raw)
                if len(parts) == 4 and parts[:2] == ["api", "requests"] and parts[3] == "resume":
                    fields(body)
                    return self._reply(200, operator.resume(parts[2]))
                return self._reply(200, operator.perform(url.path, body))
            return self._reply(404, {"error": "DATASET_PG_OPERATOR_NOT_FOUND"})

        def _handle(self):
            try:
                self._dispatch()
            except (BrokenPipeError, ConnectionResetError, TimeoutError):
                self.close_connection = True
            except WarehouseError as error:
                status = 409 if any(part in error.code for part in
                    ("CHANGED", "BUSY", "EXISTS", "ALREADY", "INTERRUPTED")) else 400
                self._reply(status, error.report())
            except BuyerError as error:
                self._reply(400, {"error": error.code})
            except (ValueError, TypeError, KeyError, OverflowError):
                self._reply(400, {"error": "DATASET_PG_OPERATOR_REQUEST_INVALID"})
            except OSError:
                self._reply(409, {"error": "DATASET_PG_OPERATOR_LOCAL_FILE_UNAVAILABLE"})
            except Exception:
                self._reply(500, {"error": "DATASET_PG_OPERATOR_OPERATION_FAILED"})

        do_GET = do_POST = do_HEAD = _handle

    class Server(ThreadingHTTPServer):
        daemon_threads = False

        def server_close(self):
            try:
                super().server_close()
            finally:
                operator.close()

    try:
        server = Server(("127.0.0.1", port), Handler)
        server.operator = operator
        url = "http://127.0.0.1:" + str(server.server_port) + "/#" + token
        control = operator.directory / "postgres-launch.json"
        dump(control, {"schema": "stellar-forge.postgres-operator-launch.v1",
                       "directory": str(operator.directory), "pid": os.getpid(), "url": url,
                       "operator_id": operator.identity["operator_id"],
                       "warehouse_id": warehouse.warehouse_id, "warehouse_schema": warehouse.schema})
        return server, control, url
    except BaseException:
        if "server" in locals():
            server.server_close()
        else:
            operator.close()
        raise
