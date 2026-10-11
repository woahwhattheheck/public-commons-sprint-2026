"""Local operator HTTP surface for retained Mercury event operations."""
from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import re
import tempfile
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

STATIC = Path(__file__).with_name("static")
CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
LISTS = {
    "notifications": "list_notifications", "events": "list_events",
    "catchups": "list_jobs", "tasks": "list_tasks", "deliveries": "list_deliveries",
}
DETAILS = {
    "notifications": "get_notification", "events": "get_event",
    "catchups": "get_job", "tasks": "get_task", "deliveries": "get_delivery",
}


class RequestError(Exception):
    def __init__(self, code, message, http_status=400):
        super().__init__(message)
        self.code, self.message, self.http_status = code, message, http_status


def is_loopback(host):
    if host.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _authority(host, port):
    host = "[" + host + "]" if ":" in host and not host.startswith("[") else host
    return (host + ":" + str(port)).lower()


def _safe_message(error, config):
    message = str(getattr(error, "message", str(error)))
    for method in ("provider_token", "webhook_secret", "operator_token"):
        try:
            value = getattr(config, method)()
        except Exception:
            value = ""
        if value:
            message = message.replace(value, "[credential]")
    return message[:1000]


class OperatorServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, config, engine, *, operator_token=None,
                 allowed_host=None, behind_https_proxy=False):
        if not is_loopback(address[0]) and not (behind_https_proxy and allowed_host):
            raise ValueError("A non-loopback listener requires --behind-https-proxy and --allowed-host.")
        if allowed_host and (len(allowed_host) > 255 or re.search(r"[\s/@\\?#]", allowed_host)):
            raise ValueError("Allowed host must be the exact public hostname, with an optional port.")
        self.config = config
        self.engine = engine
        self.operator_token = config.operator_token() if operator_token is None else operator_token
        self.behind_https_proxy = bool(behind_https_proxy)
        if ":" in address[0]:
            import socket
            self.address_family = socket.AF_INET6
        super().__init__(address, Handler)
        port = self.server_address[1]
        if allowed_host:
            self.allowed_hosts = {allowed_host.lower()}
        else:
            self.allowed_hosts = {_authority(address[0], port)}
            if is_loopback(address[0]):
                self.allowed_hosts.update({_authority("127.0.0.1", port), _authority("localhost", port), _authority("::1", port)})

    def handle_error(self, request, client_address):
        # Unexpected connection errors do not dump private request context.
        return


def make_server(config, engine, *, host="127.0.0.1", port=8787,
                operator_token=None, allowed_host=None, behind_https_proxy=False):
    return OperatorServer((host, port), config, engine, operator_token=operator_token,
                          allowed_host=allowed_host, behind_https_proxy=behind_https_proxy)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "MercuryOperations/1.0"
    sys_version = ""

    def setup(self):
        super().setup()
        self.connection.settimeout(30)

    def log_message(self, format, *args):
        return

    def _headers(self, status, content_type, length=None, *, download=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        if length is not None:
            self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", CSP)
        if download:
            self.send_header("Content-Disposition", 'attachment; filename="' + download + '"')

    def _json(self, value, status=200, *, download=None):
        data = (json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n").encode()
        self._headers(status, "application/json; charset=utf-8", len(data), download=download)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def _host(self):
        values = self.headers.get_all("Host", [])
        if len(values) != 1 or values[0].lower() not in self.server.allowed_hosts:
            raise RequestError("HOST_NOT_ALLOWED", "Use the configured operator hostname.", 421)

    def _admin(self, mutation=False):
        if not self.server.operator_token:
            raise RequestError("OPERATOR_NOT_CONFIGURED", "Set the operator token in the private environment file and restart the service.", 503)
        headers = self.headers.get_all("Authorization", [])
        supplied = headers[0][7:] if len(headers) == 1 and headers[0].startswith("Bearer ") else ""
        if not supplied or not hmac.compare_digest(supplied.encode(), self.server.operator_token.encode()):
            raise RequestError("UNAUTHORIZED", "Enter the configured operator token.", 401)
        if mutation:
            origin = self.headers.get("Origin")
            if origin:
                parsed = urlsplit(origin)
                scheme = "https" if self.server.behind_https_proxy else "http"
                if parsed.scheme != scheme or parsed.netloc.lower() not in self.server.allowed_hosts or parsed.path not in ("", "/") or parsed.query or parsed.fragment:
                    raise RequestError("ORIGIN_NOT_ALLOWED", "Submit changes from this operator application.", 403)
            if self.headers.get("Sec-Fetch-Site", "none") not in ("same-origin", "none"):
                raise RequestError("ORIGIN_NOT_ALLOWED", "Submit changes from this operator application.", 403)

    def _raw(self):
        if self.headers.get("Transfer-Encoding"):
            raise RequestError("CONTENT_LENGTH_REQUIRED", "Send one explicit Content-Length.", 411)
        lengths = self.headers.get_all("Content-Length", [])
        if len(lengths) != 1 or not re.fullmatch(r"[0-9]+", lengths[0]):
            raise RequestError("CONTENT_LENGTH_REQUIRED", "Send one explicit Content-Length.", 411)
        length = int(lengths[0])
        if length > self.server.config.max_body_bytes:
            raise RequestError("BODY_TOO_LARGE", "The request exceeds the configured intake limit.", 413)
        raw = self.rfile.read(length)
        if len(raw) != length:
            raise RequestError("INCOMPLETE_BODY", "The request body ended before Content-Length.", 400)
        return raw

    def _body(self):
        if self.headers.get_content_type() != "application/json":
            raise RequestError("JSON_REQUIRED", "Send application/json.", 415)
        try:
            value = json.loads(self._raw())
        except (ValueError, UnicodeError):
            raise RequestError("INVALID_JSON", "The request body must contain valid JSON.")
        if not isinstance(value, dict):
            raise RequestError("OBJECT_REQUIRED", "The request body must be an object.")
        return value

    @staticmethod
    def _fields(value, allowed, required=()):
        unknown = set(value) - set(allowed)
        if unknown:
            raise RequestError("UNKNOWN_FIELD", "Unknown request field: " + sorted(unknown)[0])
        for name in required:
            if name not in value:
                raise RequestError("MISSING_FIELD", "Required request field: " + name)

    @staticmethod
    def _identity(segment):
        value = unquote(segment, errors="strict")
        if not value or len(value) > 1024 or re.search(r"[/\\\x00-\x1f]", value):
            raise RequestError("INVALID_ID", "Use the original retained record identifier.")
        return value

    @staticmethod
    def _query(query, *, state=False):
        values = parse_qs(query, keep_blank_values=True)
        allowed = {"limit", "after"} | ({"state"} if state else set())
        if set(values) - allowed or any(len(items) != 1 for items in values.values()):
            raise RequestError("INVALID_QUERY", "Use one limit, after cursor and supported state filter.")
        raw_limit = values.get("limit", ["100"])[0]
        if not re.fullmatch(r"[0-9]+", raw_limit) or not 1 <= int(raw_limit) <= 500:
            raise RequestError("INVALID_LIMIT", "Limit must be an integer from 1 to 500.")
        result = {"limit": int(raw_limit), "after": values.get("after", [None])[0] or None}
        if "state" in values and values["state"][0]:
            result["state"] = values["state"][0]
        return result

    def _status(self):
        return {"schema": "mercury-operations.status.v1", "captured_at": time.time(),
                "configuration": self.server.config.public_dict(),
                "operations": self.server.engine.status(),
                "operator": {"webhook_path": "/webhooks/mercury", "version": "1.0.0",
                             "worker": getattr(self.server, "worker_status", {"state": "externally_managed"})}}

    def _export(self, *, events_only=False):
        # Prepare a complete private spool before advertising a successful download.
        with tempfile.TemporaryFile(dir=self.server.config.workspace, prefix="mercury-operator-export-") as stream:
            count, digest = 0, hashlib.sha256()
            iterator = self.server.engine.iter_event_export() if events_only else self.server.engine.iter_operations_export()
            for chunk in iterator:
                if not isinstance(chunk, bytes):
                    raise RuntimeError("Export iterator must yield bytes.")
                stream.write(chunk)
                digest.update(chunk)
                count += len(chunk)
            stream.flush()
            stream.seek(0)
            filename = ("mercury-events-" if events_only else "mercury-operations-") + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + ".ndjson"
            self._headers(200, "application/x-ndjson; charset=utf-8", count, download=filename)
            self.send_header("X-Content-SHA256", digest.hexdigest())
            self.end_headers()
            if self.command == "HEAD":
                return
            while chunk := stream.read(1024 * 1024):
                self.wfile.write(chunk)

    def _get(self):
        self._host()
        parsed = urlsplit(self.path)
        path = parsed.path
        if path.startswith("/api/"):
            self._admin()
            if path == "/api/status":
                if parsed.query:
                    raise RequestError("INVALID_QUERY", "Status does not accept query parameters.")
                return self._json(self._status())
            if path in ("/api/export", "/api/export/events"):
                if parsed.query:
                    raise RequestError("INVALID_QUERY", "Export does not accept query parameters.")
                return self._export(events_only=path.endswith("/events"))
            if path == "/api/export/status":
                return self._json(self._status(), download="mercury-operations-status.json")
            parts = path.strip("/").split("/")
            if len(parts) == 2 and parts[1] in LISTS:
                name = parts[1]
                kwargs = self._query(parsed.query, state=name != "events")
                return self._json(getattr(self.server.engine, LISTS[name])(**kwargs))
            if len(parts) == 3 and parts[1] in DETAILS and not parsed.query:
                return self._json(getattr(self.server.engine, DETAILS[parts[1]])(self._identity(parts[2])))
            raise RequestError("NOT_FOUND", "Operator route not found.", 404)
        static = {"/": ("index.html", "text/html; charset=utf-8"),
                  "/app.js": ("app.js", "text/javascript; charset=utf-8"),
                  "/style.css": ("style.css", "text/css; charset=utf-8")}
        if path not in static:
            raise RequestError("NOT_FOUND", "Page not found.", 404)
        name, mime = static[path]
        data = (STATIC / name).read_bytes()
        self._headers(200, mime, len(data))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def _post(self):
        self._host()
        parsed = urlsplit(self.path)
        if parsed.query:
            raise RequestError("INVALID_QUERY", "Mutation routes do not accept query parameters.")
        if parsed.path == "/webhooks/mercury":
            raw = self._raw()
            signatures = self.headers.get_all("X-Mercury-Signature", [])
            timestamps = self.headers.get_all("X-Mercury-Timestamp", [])
            if len(signatures) != 1 or len(timestamps) > 1:
                raise RequestError("INVALID_SIGNATURE_HEADERS", "Send one Mercury signature header.", 401)
            result = self.server.engine.receive_webhook(raw, signatures[0], timestamps[0] if timestamps else "")
            return self._json(result, 202)
        if not parsed.path.startswith("/api/"):
            raise RequestError("NOT_FOUND", "Operator route not found.", 404)
        self._admin(mutation=True)
        body = self._body()
        if parsed.path == "/api/catchups":
            self._fields(body, {"job_id", "contracts", "ledger_from", "ledger_to", "page_size"},
                         {"job_id", "ledger_from", "ledger_to"})
            return self._json(self.server.engine.create_catchup(**body), 201)
        if parsed.path == "/api/reconcile":
            self._fields(body, {"tx_hash", "operation_id"}, {"tx_hash"})
            return self._json(self.server.engine.reconcile_tx(**body), 202)
        if parsed.path == "/api/recover":
            self._fields(body, set())
            return self._json(self.server.engine.recover())
        parts = parsed.path.strip("/").split("/")
        if len(parts) == 4:
            self._fields(body, set())
            domain, identity, action = parts[1], self._identity(parts[2]), parts[3]
            operations = {
                ("tasks", "retry"): "retry_task", ("catchups", "retry"): "retry_job",
                ("catchups", "cancel"): "cancel_job", ("deliveries", "retry"): "retry_delivery",
            }
            method = operations.get((domain, action))
            if method:
                return self._json(getattr(self.server.engine, method)(identity))
        raise RequestError("NOT_FOUND", "Operator route not found.", 404)

    def end_headers(self):
        super().end_headers()
        self._response_started = True

    def _dispatch(self, operation):
        self._response_started = False
        try:
            operation()
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            self.close_connection = True
        except Exception as error:
            if self._response_started:
                self.close_connection = True
                return
            status = getattr(error, "http_status", 500)
            code = getattr(error, "code", "OPERATION_FAILED")
            known = isinstance(status, int) and 400 <= status < 600 and isinstance(code, str) and hasattr(error, "http_status")
            message = _safe_message(error, self.server.config) if known else "The operation failed. Inspect retained task or delivery details and retry the same operation."
            self.close_connection = True
            try:
                self._json({"error": {"code": code if known else "OPERATION_FAILED", "message": message}}, status if known else 500)
            except (OSError, ValueError):
                pass

    def do_GET(self):
        self._dispatch(self._get)

    def do_POST(self):
        self._dispatch(self._post)

    def do_HEAD(self):
        self._dispatch(self._get)

    def do_OPTIONS(self):
        self._dispatch(lambda: self._json({"error": {"code": "METHOD_NOT_ALLOWED", "message": "Use the documented GET or POST route."}}, 405))
