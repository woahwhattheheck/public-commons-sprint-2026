"""Private Macrobond operator and authenticated provider over the retained SDMX catalog.

Transport controls follow the maintained SDMX/XML operator. Catalog owns source
identity, compatibility, editions, publication history and provider semantics.
"""
from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import base64
import binascii
import secrets
import shutil
import threading
from urllib.parse import parse_qs, urlsplit
import zipfile

from catalog import Catalog, InputError, MAX_PACKET, json_bytes, load_json, wire_json, PROVIDER_METHODS
from connection import definition_xml

HERE = Path(__file__).resolve().parent
PROVIDER_COMMANDS = frozenset(PROVIDER_METHODS)


class LimitedReader:
    def __init__(self, source, length):
        self.source, self.remaining = source, length

    def read(self, size=-1):
        if not self.remaining:
            return b""
        block = self.source.read(min(self.remaining, size if size >= 0 else self.remaining))
        if not block:
            raise InputError("Upload ended before its declared content length")
        self.remaining -= len(block)
        return block


class OperatorServer(ThreadingHTTPServer):
    daemon_threads = False
    block_on_close = True

    def __init__(self, catalog: Catalog, port=0, *, provider_username=None, provider_password=None):
        self.catalog, self.token = catalog, secrets.token_urlsafe(32)
        self.provider_username = provider_username
        self._provider_credentials = None
        if provider_username is not None or provider_password is not None:
            if (not isinstance(provider_username, str) or not provider_username or ":" in provider_username
                    or not isinstance(provider_password, str) or not provider_password):
                raise InputError("Provide a nonempty provider username without a colon and a nonempty password")
            self._provider_credentials = (provider_username + ":" + provider_password).encode("utf-8")
        self.slots = threading.BoundedSemaphore(8)
        super().__init__(("127.0.0.1", port), Handler)
        self.origin = f"http://127.0.0.1:{self.server_port}"
        self.url = self.origin + "/#" + self.token
        self.provider_url = self.origin + "/"

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

    def connection_info(self):
        return {"provider_url": self.provider_url, "authentication": "Basic",
                "enabled": self._provider_credentials is not None,
                "username": self.provider_username}


class Handler(BaseHTTPRequestHandler):
    server_version = "SF30-Macrobond"
    protocol_version = "HTTP/1.0"

    def setup(self):
        super().setup()
        self.connection.settimeout(60)

    def log_message(self, *_):
        pass

    def _gate(self, private=True):
        target = urlsplit(self.path)
        if len(self.headers.get_all("Host", [])) != 1 or len(self.headers.get_all("Origin", [])) > 1:
            raise PermissionError("Repeated local origin or host headers are not accepted")
        if target.scheme or target.netloc or self.headers.get("Host") != urlsplit(self.server.origin).netloc:
            raise PermissionError("Invalid local host")
        if self.headers.get("Origin") not in {None, self.server.origin}:
            raise PermissionError("Cross-origin requests are not accepted")
        if private:
            supplied = self.headers.get("Authorization", "")
            if (len(self.headers.get_all("Authorization", [])) != 1
                    or not secrets.compare_digest(supplied.encode(), ("Bearer " + self.server.token).encode())):
                raise PermissionError("Open this process's private console link")
        return target

    def _headers(self, status, media, length, filename=None, *, provider=False, authenticate=False):
        self.send_response(status)
        self.send_header("Content-Type", media)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-cache, private" if provider else "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
        if authenticate:
            self.send_header("WWW-Authenticate", 'Basic realm="Macrobond series provider", charset="UTF-8"')
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.end_headers()

    def _json(self, value, status=200, *, provider=False, authenticate=False):
        data = wire_json(value) if provider else json_bytes(value)
        self._headers(status, "application/json; charset=utf-8", len(data),
                      provider=provider, authenticate=authenticate)
        self.wfile.write(data)

    def _provider_gate(self):
        credentials = self.server._provider_credentials
        if credentials is None:
            self._json({"error": "Provider credentials are not configured"}, 503, provider=True)
            return False
        supplied = self.headers.get("Authorization", "")
        scheme, _, encoded = supplied.partition(" ")
        try:
            decoded = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error):
            decoded = b""
        if (len(self.headers.get_all("Authorization", [])) != 1 or scheme.lower() != "basic"
                or not secrets.compare_digest(decoded, credentials)):
            self._json({"error": "Provider authentication is required"}, 401, provider=True, authenticate=True)
            return False
        return True

    def _body(self, maximum=131072):
        raw = self.headers.get("Content-Length", "")
        if self.headers.get("Transfer-Encoding") or len(self.headers.get_all("Content-Length", [])) != 1 or not raw.isdecimal():
            raise InputError("A single Content-Length is required")
        length = int(raw)
        if length > maximum:
            raise InputError("Request exceeds its size limit")
        return LimitedReader(self.rfile, length)

    def _query(self, target, provider=False):
        values = parse_qs(target.query, keep_blank_values=True)
        if any(len(items) != 1 for key, items in values.items() if not (provider and key == "n")):
            raise InputError("Repeated query parameters are accepted only for provider series names")
        return {key: items if provider and key == "n" else items[0] for key, items in values.items()}

    def _integer(self, query, key, default, minimum=0, maximum=100000000):
        raw = query.get(key, str(default))
        if not raw.isdecimal():
            raise InputError(f"{key} must be a nonnegative integer")
        value = int(raw)
        if not minimum <= value <= maximum:
            raise InputError(f"{key} is outside its supported range")
        return value

    def _state(self):
        return {**self.server.catalog.state(), "connection": self.server.connection_info()}

    def _download(self, path, filename):
        with path.open("rb") as stream:
            self._headers(200, "application/zip", path.stat().st_size, filename)
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
            self._json({"error": "Retained project, edition or series was not found"}, 404)
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            pass
        except Exception:
            self._json({"error": "The local operation failed; the retained catalog remains available"}, 500)

    def do_GET(self):
        self._run(self._get)

    def _get(self):
        target = self._gate(private=False)
        assets = {"/": ("index.html", "text/html; charset=utf-8"),
                  "/app.js": ("app.js", "text/javascript; charset=utf-8"),
                  "/style.css": ("style.css", "text/css; charset=utf-8")}
        if target.path in assets:
            name, media = assets[target.path]
            data = (HERE / "public" / name).read_bytes()
            self._headers(200, media, len(data))
            self.wfile.write(data)
            return
        parts = target.path.strip("/").split("/")
        catalog = self.server.catalog
        command = parts[0] if len(parts) == 1 and parts[0] in PROVIDER_COMMANDS else (
            parts[1] if len(parts) == 2 and parts[0] == "provider" else None)
        if command is not None:
            if self._provider_gate():
                self._json(catalog.provider(command, self._query(target, provider=True)), provider=True)
            return
        self._gate()
        if target.path == "/api/state":
            self._json(self._state())
            return
        if len(parts) == 3 and parts[:2] == ["api", "provider"]:
            self._json(catalog.provider(parts[2], self._query(target, provider=True)), provider=True)
            return
        query = self._query(target)
        if target.path == "/api/connection.xml":
            data = definition_xml(query.get("host", self.server.provider_url))
            self._headers(200, "application/xml; charset=utf-8", len(data), "macrobond-provider.xml")
            self.wfile.write(data)
            return
        if len(parts) in {3, 4} and parts[:2] == ["api", "editions"]:
            ident = parts[2]
            if len(parts) == 3:
                self._json(catalog.edition(ident))
            elif parts[3] == "series":
                self._json(catalog.series(ident, self._integer(query, "offset", 0),
                    self._integer(query, "limit", 50, 1, 200), query.get("query", "")))
            elif parts[3] == "observations":
                self._json(catalog.observations(ident, query.get("series_id", ""),
                    self._integer(query, "offset", 0), self._integer(query, "limit", 50, 1, 200)))
            elif parts[3] == "packet":
                with catalog.mutex, catalog.scratch() as temporary:
                    path = temporary / "macrobond-catalog.zip"
                    catalog.export_packet(ident, path)
                    self._download(path, "macrobond-catalog.zip")
            else:
                self._json({"error": "Unknown local route"}, 404)
            return
        self._json({"error": "Unknown local route"}, 404)

    def do_POST(self):
        self._run(self._post)

    def _post(self):
        target = self._gate()
        catalog = self.server.catalog
        if target.path in {"/api/projects/import", "/api/catalog/import"}:
            with catalog.mutex, catalog.scratch() as temporary:
                path = temporary / "input.zip"
                with path.open("xb") as stream:
                    path.chmod(0o600)
                    shutil.copyfileobj(self._body(MAX_PACKET), stream, 65536)
                if target.path == "/api/projects/import":
                    result = catalog.import_packet(path)
                else:
                    catalog.import_catalog(path)
                    result = self._state()
            self._json(result, 201)
            return
        body = load_json(self._body().read())
        if not isinstance(body, dict):
            raise InputError("Expected a JSON object")
        if target.path == "/api/preview":
            self._json(catalog.preview(body))
        elif target.path == "/api/editions":
            self._json(catalog.save_edition(body), 201)
        elif target.path == "/api/editions/compare":
            self._json(catalog.compare(body["before"], body["after"]))
        else:
            parts = target.path.strip("/").split("/")
            if len(parts) == 4 and parts[:2] == ["api", "editions"] and parts[3] == "activate":
                catalog.activate(parts[2], body["expected_revision"], body.get("expected_current"))
                self._json(self._state())
            else:
                self._json({"error": "Unknown local route"}, 404)
