#!/usr/bin/env python3
"""Purchased API gateway over original SF101 orders and access controls."""
from __future__ import annotations
from dataclasses import dataclass
import hashlib
import hmac
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import secrets
import socket
import sqlite3
import ssl
import stat
import threading
import time
from urllib.parse import parse_qsl, unquote, urlencode, urlsplit
import pass_store

CONFIG_SCHEMA = "stellar-forge.sf101.api-gateway.v1"
MAX_BODY = 1024 * 1024
MAX_RESPONSE = 4 * 1024 * 1024
MAX_CONFIG = 256 * 1024
METHODS = {"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"}
ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}\Z")
ENV_RE = re.compile(r"[A-Z][A-Z0-9_]{1,64}\Z")
HEADER_RE = re.compile(r"[A-Za-z][A-Za-z0-9-]{0,79}\Z")
BLOCKED_HEADERS = {"host", "connection", "content-length", "transfer-encoding", "upgrade",
                   "te", "trailer", "proxy-authorization", "proxy-connection",
                   "idempotency-key", "accept-encoding", "accept", "content-type"}
STATIC = {"/": ("index.html", "text/html; charset=utf-8"),
          "/console.js": ("console.js", "text/javascript; charset=utf-8"),
          "/style.css": ("style.css", "text/css; charset=utf-8")}
SECURITY = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer", "Cross-Origin-Resource-Policy": "same-origin"}
CSP = ("default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; "
       "img-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'")

class GatewayError(Exception):
    def __init__(self, code, status=422):
        super().__init__(code)
        self.code, self.status = code, status

def need(condition, code, status=422):
    if not condition:
        raise GatewayError(code, status)

def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False, allow_nan=False).encode("utf-8")

def fields(value, required, optional=()):
    need(isinstance(value, dict) and set(required) <= value.keys()
         and not value.keys() - set(required) - set(optional), "INVALID_FIELDS")

def integer(value, minimum, maximum, code):
    need(type(value) is int and minimum <= value <= maximum, code)
    return value

def clean_text(value, maximum, code, *, empty=False):
    need(isinstance(value, str) and (empty or bool(value)) and len(value) <= maximum
         and all(32 <= ord(c) <= 126 for c in value), code)
    return value

def private_json(path, maximum=MAX_CONFIG):
    target = Path(path)
    need(target.is_absolute() and str(target) == os.path.normpath(str(target)), "PRIVATE_CONFIG_PATH_REQUIRED")
    fd = os.open(target, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        info = os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and not info.st_mode & 0o077
             and 0 < info.st_size <= maximum, "PRIVATE_CONFIG_FILE_REQUIRED")
        with os.fdopen(fd, "rb", closefd=False) as source:
            raw = source.read(maximum + 1)
        need(len(raw) <= maximum, "CONFIG_TOO_LARGE")
        return json.loads(raw)
    except (ValueError, UnicodeError):
        raise GatewayError("INVALID_CONFIG_JSON") from None
    finally:
        os.close(fd)

def upstream_origin(value):
    clean_text(value, 2048, "INVALID_UPSTREAM_ORIGIN")
    parsed = urlsplit(value)
    try:
        port = parsed.port
    except ValueError:
        raise GatewayError("INVALID_UPSTREAM_ORIGIN") from None
    need(parsed.scheme in {"http", "https"} and parsed.hostname and not parsed.username
         and not parsed.password and parsed.path in {"", "/"} and not parsed.query
         and not parsed.fragment and (port is None or 1 <= port <= 65535), "INVALID_UPSTREAM_ORIGIN")
    need(parsed.scheme == "https" or parsed.hostname in {"127.0.0.1", "::1", "localhost"},
         "HTTPS_OR_LOOPBACK_UPSTREAM_REQUIRED")
    return parsed

@dataclass(frozen=True)
class Route:
    id: str
    method: str
    path: str
    origin: str
    query: tuple
    headers: dict
    request_bytes: int
    response_bytes: int
    timeout: int

@dataclass(frozen=True)
class Config:
    state: Path
    routes: dict
    actor: str

def load_config(path, environ=None):
    env = os.environ if environ is None else environ
    raw = private_json(path)
    fields(raw, {"schema", "state", "routes"}, {"actor"})
    need(raw["schema"] == CONFIG_SCHEMA, "CONFIG_SCHEMA_MISMATCH")
    state = pass_store.receiver.require_private_dir(raw["state"])
    db = pass_store.receiver.connect(state)
    try:
        db.execute("SELECT order_ref FROM orders LIMIT 1").fetchone()
    finally:
        db.close()
    actor = raw.get("actor", "merchant-operator")
    need(isinstance(actor, str) and 0 < len(actor) <= 120
         and not any(ord(c) < 32 or ord(c) == 127 for c in actor), "INVALID_ACTOR")
    need(isinstance(raw["routes"], list) and 1 <= len(raw["routes"]) <= 128, "ROUTES_REQUIRED")
    result = {}
    for item in raw["routes"]:
        fields(item, {"id", "method", "path", "upstream"},
               {"query", "headerEnv", "maxRequestBytes", "maxResponseBytes", "timeoutSeconds"})
        rid = item["id"]
        need(pass_store.receiver.is_match(pass_store.receiver.ROUTE_RE, rid) and rid not in result,
             "INVALID_OR_DUPLICATE_ROUTE")
        method, route_path = item["method"], pass_store.validate_path(item["path"])
        need(method in METHODS, "INVALID_ROUTE_METHOD")
        upstream_origin(item["upstream"])
        query = item.get("query", [])
        need(isinstance(query, list) and len(query) <= 64
             and all(isinstance(q, str) and re.fullmatch(r"[A-Za-z0-9_.-]{1,80}", q) for q in query)
             and len(set(query)) == len(query), "INVALID_QUERY_ALLOWLIST")
        header_env = item.get("headerEnv", {})
        need(isinstance(header_env, dict) and len(header_env) <= 16, "INVALID_UPSTREAM_HEADERS")
        headers = {}
        for name, variable in header_env.items():
            need(isinstance(name, str) and HEADER_RE.fullmatch(name)
                 and name.lower() not in BLOCKED_HEADERS
                 and name.lower() not in {k.lower() for k in headers}, "INVALID_UPSTREAM_HEADER_NAME")
            need(isinstance(variable, str) and ENV_RE.fullmatch(variable), "INVALID_HEADER_ENV")
            headers[name] = clean_text(env.get(variable, ""), 8192, "UPSTREAM_HEADER_ENV_UNAVAILABLE")
        result[rid] = Route(rid, method, route_path, item["upstream"].rstrip("/"), tuple(query), headers,
            integer(item.get("maxRequestBytes", MAX_BODY), 0, MAX_BODY, "INVALID_REQUEST_LIMIT"),
            integer(item.get("maxResponseBytes", MAX_RESPONSE), 1, MAX_RESPONSE, "INVALID_RESPONSE_LIMIT"),
            integer(item.get("timeoutSeconds", 30), 1, 120, "INVALID_ROUTE_TIMEOUT"))
    return Config(state, result, actor)

def error_fields(error):
    if isinstance(error, (GatewayError, pass_store.PassError)):
        return error.code, error.status
    if isinstance(error, pass_store.access.AccessError):
        code = str(error)
        if not re.fullmatch(r"[A-Z][A-Z0-9_]{1,100}", code):
            return "ACCESS_OPERATION_UNAVAILABLE", 503
        if code == "ORDER_NOT_FOUND":
            return code, 404
        if "CONFLICT" in code or "ALREADY" in code or "UNCHANGED" in code or "REUSED" in code:
            return code, 409
        return code, 422
    if isinstance(error, sqlite3.Error):
        return "MERCHANT_STORE_BUSY", 503
    if isinstance(error, OSError):
        return "MERCHANT_STORAGE_UNAVAILABLE", 503
    return "API_ACCESS_UNAVAILABLE", 503

def send_upstream(route, *, query, body, content_type, accept, operation):
    parsed = upstream_origin(route.origin)
    cls = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
    options = {"timeout": route.timeout}
    if parsed.scheme == "https":
        options["context"] = ssl.create_default_context()
    conn = cls(parsed.hostname, parsed.port, **options)
    headers = {"Accept": accept or "application/json", "Accept-Encoding": "identity",
               "Content-Type": content_type or "application/octet-stream",
               "Idempotency-Key": operation, "Connection": "close", **route.headers}
    deadline = time.monotonic() + route.timeout
    try:
        conn.request(route.method, route.path + ("?" + query if query else ""),
                     body=body if body else None, headers=headers)
        response = conn.getresponse()
        need(200 <= response.status <= 599, "UPSTREAM_PROTOCOL_UNCERTAIN", 502)
        need(response.getheader("Content-Encoding", "identity").strip().lower() in {"", "identity"},
             "UPSTREAM_ENCODING_UNSUPPORTED", 502)
        lengths = response.headers.get_all("Content-Length", [])
        need(len(lengths) <= 1, "UPSTREAM_RESPONSE_LENGTH_INVALID", 502)
        declared = lengths[0] if lengths else None
        if declared is not None:
            need(declared.isdigit() and int(declared) <= route.response_bytes,
                 "UPSTREAM_RESPONSE_TOO_LARGE", 502)
        response_type = response.getheader("Content-Type", "application/octet-stream")
        try:
            response_type = pass_store.validate_content_type(response_type)
        except pass_store.PassError:
            response_type = "application/octet-stream"
        chunks, size = [], 0
        while True:
            remaining = deadline - time.monotonic()
            need(remaining > 0, "UPSTREAM_DEADLINE_EXCEEDED", 504)
            active = conn.sock or getattr(getattr(response.fp, "raw", None), "_sock", None)
            if active:
                active.settimeout(remaining)
            chunk = response.read1(min(65536, route.response_bytes + 1 - size))
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
            need(size <= route.response_bytes, "UPSTREAM_RESPONSE_TOO_LARGE", 502)
        if declared is not None and route.method != "HEAD" and response.status not in {204, 304}:
            need(size == int(declared), "UPSTREAM_RESPONSE_INCOMPLETE", 502)
        return response.status, b"".join(chunks), response_type
    except (socket.timeout, TimeoutError):
        raise GatewayError("UPSTREAM_DEADLINE_EXCEEDED", 504) from None
    except (http.client.HTTPException, OSError, ValueError):
        raise GatewayError("UPSTREAM_OUTCOME_UNKNOWN", 502) from None
    finally:
        conn.close()

class LimitedServer(ThreadingHTTPServer):
    daemon_threads = False
    block_on_close = True
    allow_reuse_address = True
    def __init__(self, address, handler, *, config, console=False, capability=None):
        self.config, self.console, self.capability = config, console, capability
        self.capacity = threading.BoundedSemaphore(64)
        super().__init__(address, handler)
    def process_request(self, request, client_address):
        if not self.capacity.acquire(blocking=False):
            try:
                request.sendall(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            finally:
                self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.capacity.release()
            raise
    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.capacity.release()

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "StarforgeAPIAccess"
    def log_message(self, *_):
        pass
    def setup(self):
        super().setup()
        self.connection.settimeout(15)
    def reply(self, status, body=b"", content_type="application/json; charset=utf-8", extra=None):
        self.close_connection = True
        self.send_response(status)
        for key, value in SECURITY.items():
            self.send_header(key, value)
        if self.server.console:
            self.send_header("Content-Security-Policy", CSP)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        for key, value in (extra or {}).items():
            self.send_header(key, str(value))
        self.end_headers()
        if self.command != "HEAD" and status not in {204, 304}:
            self.wfile.write(body)
    def json_reply(self, status, value, extra=None):
        self.reply(status, encoded(value), extra=extra)
    def unique_header(self, name, default=""):
        values = self.headers.get_all(name, [])
        need(len(values) <= 1, "DUPLICATE_REQUEST_HEADER", 400)
        return values[0] if values else default
    def authorization(self):
        raw = self.unique_header("Authorization")
        need(raw.startswith("Bearer ") and 32 <= len(raw[7:].encode("utf-8")) <= 1024,
             "ACCESS_DENIED", 404)
        return raw[7:]
    def body(self, maximum):
        need(not self.headers.get_all("Transfer-Encoding"), "TRANSFER_ENCODING_UNSUPPORTED", 400)
        length = self.unique_header("Content-Length", "0")
        need(re.fullmatch(r"0|[1-9][0-9]{0,9}", length), "INVALID_CONTENT_LENGTH", 400)
        size = int(length)
        need(size <= maximum, "REQUEST_TOO_LARGE", 413)
        data = self.rfile.read(size)
        need(len(data) == size, "INCOMPLETE_REQUEST_BODY", 400)
        return data
    def json_body(self):
        need(self.unique_header("Content-Type").split(";", 1)[0].strip() == "application/json",
             "JSON_CONTENT_TYPE_REQUIRED", 415)
        try:
            value = json.loads(self.body(16384))
        except (ValueError, UnicodeError):
            raise GatewayError("INVALID_JSON_BODY", 400) from None
        need(isinstance(value, dict), "JSON_OBJECT_REQUIRED", 400)
        return value
    def parsed(self):
        need(len(self.path) <= 8192 and self.path.startswith("/") and not self.path.startswith("//"),
             "INVALID_REQUEST_TARGET", 400)
        url = urlsplit(self.path)
        need(not url.scheme and not url.netloc and not url.fragment, "INVALID_REQUEST_TARGET", 400)
        try:
            parts = [unquote(p, errors="strict") for p in url.path.split("/")[1:]]
            pairs = parse_qsl(url.query, keep_blank_values=True, strict_parsing=True, max_num_fields=64)
        except (ValueError, UnicodeError):
            raise GatewayError("INVALID_REQUEST_TARGET", 400) from None
        return url, parts, pairs
    def page(self, pairs):
        values = dict(pairs)
        need(len(values) == len(pairs) and set(values) <= {"after", "limit"}, "INVALID_PAGE_QUERY", 400)
        value = values.get("limit", "100")
        need(re.fullmatch(r"[1-9][0-9]{0,2}", value), "INVALID_PAGE_LIMIT", 400)
        return values.get("after"), integer(int(value), 1, 500, "INVALID_PAGE_LIMIT")
    def execute_route(self, ref, route_id, pairs, token):
        cfg = self.server.config
        route = cfg.routes.get(route_id)
        need(route is not None and self.command == route.method, "ROUTE_NOT_AVAILABLE", 404)
        need(all(key in route.query and len(value) <= 2048 and
                 not any(ord(c) < 32 or ord(c) == 127 for c in value) for key, value in pairs),
             "QUERY_NOT_PERMITTED", 422)
        request_id = self.unique_header("Idempotency-Key")
        need(ID_RE.fullmatch(request_id), "IDEMPOTENCY_KEY_REQUIRED", 400)
        body = self.body(route.request_bytes)
        need(route.method not in {"GET", "HEAD"} or not body, "BODY_NOT_ALLOWED_FOR_METHOD", 422)
        content_type = clean_text(self.unique_header("Content-Type", "application/octet-stream"), 255, "INVALID_CONTENT_TYPE")
        accept = clean_text(self.unique_header("Accept", "application/json"), 256, "INVALID_ACCEPT")
        query = urlencode(pairs)
        identity = {"route": route.id, "method": route.method, "path": route.path, "origin": route.origin,
                    "query": pairs, "contentType": content_type, "accept": accept,
                    "bodySha256": hashlib.sha256(body).hexdigest(),
                    "upstreamHeadersSha256": hashlib.sha256(encoded(route.headers)).hexdigest()}
        started = pass_store.begin_call(cfg.state, ref=ref, token=token, request_id=request_id,
            route_id=route.id, method=route.method, path=route.path,
            request_sha256=hashlib.sha256(encoded(identity)).hexdigest(), timeout_seconds=route.timeout + 15)
        if not started["execute"]:
            return self.saved_result(ref, request_id, token, replayed=True, pending=started)
        lease = started["executionToken"]
        operation = "sf101-" + hashlib.sha256(encoded([ref, request_id])).hexdigest()
        try:
            status, data, content_type = send_upstream(route, query=query, body=body,
                content_type=content_type, accept=accept, operation=operation)
        except Exception as error:
            code, status = error_fields(error)
            if not isinstance(error, GatewayError):
                code, status = "UPSTREAM_OUTCOME_UNKNOWN", 502
            unknown = pass_store.mark_unknown(cfg.state, ref=ref, request_id=request_id,
                                              execution_token=lease, code=code)
            return self.json_reply(status, {"ok": False, "error": code, "operation": unknown},
                {"X-SF101-Request-ID": request_id, "X-SF101-Call-State": "RECOVERY_REQUIRED"})
        pass_store.finish_call(cfg.state, ref=ref, request_id=request_id, execution_token=lease,
                              status=status, body=data, content_type=content_type, consumed=True)
        return self.saved_result(ref, request_id, token, replayed=False)
    def saved_result(self, ref, request_id, token, *, replayed=True, pending=None):
        result = pass_store.read_result(self.server.config.state, ref=ref, token=token, request_id=request_id)
        if result is None:
            detail = pending or {"pass": pass_store.show_pass(self.server.config.state, ref, token=token)}
            return self.json_reply(409, {"ok": False, "error": "REQUEST_HAS_NO_COMPLETED_RESULT", **detail},
                                   {"X-SF101-Request-ID": request_id, "Retry-After": "2"})
        return self.reply(result["status"], result["body"], result["contentType"],
            {"X-SF101-Request-ID": request_id, "X-SF101-Replayed": str(replayed).lower(),
             "X-SF101-Call-State": result["call"]["status"], "X-SF101-Result-SHA256": result["sha256"],
             "X-SF101-Units": result["call"]["units"] if result["call"]["status"] in {"COMPLETED", "CONSUMED"} else 0})
    def public(self, url, parts, pairs):
        if url.path == "/health" and self.command == "GET" and not pairs:
            return self.json_reply(200, {"schema": CONFIG_SCHEMA, "status": "ready"})
        need(len(parts) >= 3 and parts[:2] == ["v1", "passes"], "NOT_FOUND", 404)
        ref = parts[2]
        need(pass_store.receiver.is_match(pass_store.receiver.REF_RE, ref), "NOT_FOUND", 404)
        token = self.authorization()
        if len(parts) == 3 and self.command == "GET" and not pairs:
            return self.json_reply(200, pass_store.show_pass(self.server.config.state, ref, token=token))
        if len(parts) == 4 and parts[3] == "calls" and self.command == "GET":
            after, limit = self.page(pairs)
            return self.json_reply(200, pass_store.list_calls(self.server.config.state, ref,
                                                             after=after, limit=limit, token=token))
        if len(parts) == 6 and parts[3] == "calls" and parts[5] == "result" and self.command == "GET" and not pairs:
            need(ID_RE.fullmatch(parts[4]), "NOT_FOUND", 404)
            return self.saved_result(ref, parts[4], token)
        if len(parts) == 5 and parts[3] == "routes":
            return self.execute_route(ref, parts[4], pairs, token)
        raise GatewayError("NOT_FOUND", 404)
    def operator(self, url, parts, pairs):
        origin = "http://127.0.0.1:" + str(self.server.server_port)
        need(self.unique_header("Host") == origin[7:], "INVALID_CONSOLE_HOST", 403)
        need(self.unique_header("Origin", origin) == origin, "INVALID_CONSOLE_ORIGIN", 403)
        if url.path in STATIC and self.command == "GET" and not pairs:
            filename, content_type = STATIC[url.path]
            return self.reply(200, (Path(__file__).parent / filename).read_bytes(), content_type)
        need(hmac.compare_digest(self.authorization(), self.server.capability), "ACCESS_DENIED", 404)
        cfg = self.server.config
        if parts == ["api", "passes"] and self.command == "GET":
            after, limit = self.page(pairs)
            return self.json_reply(200, pass_store.list_passes(cfg.state, after=after, limit=limit))
        if parts == ["api", "routes"] and self.command == "GET" and not pairs:
            return self.json_reply(200, {"routes": [{"id": r.id, "method": r.method, "path": r.path,
                "query": list(r.query), "timeoutSeconds": r.timeout} for r in cfg.routes.values()], "actor": cfg.actor})
        if len(parts) == 3 and parts[:2] == ["api", "passes"] and self.command == "GET" and not pairs:
            return self.json_reply(200, pass_store.show_pass(cfg.state, parts[2]))
        if len(parts) == 4 and parts[:2] == ["api", "passes"] and parts[3] == "calls" and self.command == "GET":
            after, limit = self.page(pairs)
            return self.json_reply(200, pass_store.list_calls(cfg.state, parts[2], after=after, limit=limit))
        need(self.command == "POST" and not pairs, "NOT_FOUND", 404)
        data = self.json_body()
        if parts == ["api", "attach"]:
            fields(data, {"orderRef"})
            return self.json_reply(200, pass_store.attach_pass(cfg.state, data["orderRef"]))
        if parts == ["api", "resolve"]:
            fields(data, {"orderRef", "requestId", "expectedRevision", "operationId", "reason", "decision"})
            return self.json_reply(200, pass_store.resolve_call(cfg.state, ref=data["orderRef"],
                request_id=data["requestId"], expected_revision=data["expectedRevision"],
                operation_id=data["operationId"], actor=cfg.actor, reason=data["reason"], decision=data["decision"]))
        if parts == ["api", "access"]:
            fields(data, {"orderRef", "expectedRevision", "operationId", "reason", "action"}, {"expiresAt"})
            need(data["action"] in {"suspend", "resume", "expire", "clear-expiry"}, "INVALID_ACCESS_ACTION")
            return self.json_reply(200, pass_store.access.change_access(cfg.state, ref=data["orderRef"],
                expected_revision=data["expectedRevision"], operation_id=data["operationId"], actor=cfg.actor,
                reason=data["reason"], action=data["action"], expires_at=data.get("expiresAt")))
        raise GatewayError("NOT_FOUND", 404)
    def dispatch(self):
        try:
            url, parts, pairs = self.parsed()
            if self.server.console:
                self.operator(url, parts, pairs)
            else:
                self.public(url, parts, pairs)
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception as error:
            code, status = error_fields(error)
            try:
                self.json_reply(status, {"ok": False, "error": code})
            except (BrokenPipeError, ConnectionResetError):
                pass
    do_GET = do_HEAD = do_POST = do_PUT = do_PATCH = do_DELETE = dispatch

def start(config, *, api_port=0, console_port=0):
    integer(api_port, 0, 65535, "INVALID_API_PORT")
    integer(console_port, 0, 65535, "INVALID_CONSOLE_PORT")
    capability = secrets.token_urlsafe(32)
    api = LimitedServer(("127.0.0.1", api_port), Handler, config=config)
    try:
        console = LimitedServer(("127.0.0.1", console_port), Handler, config=config,
                                console=True, capability=capability)
    except BaseException:
        api.server_close()
        raise
    for server in (api, console):
        threading.Thread(target=server.serve_forever, daemon=True).start()
    return {"api": api, "console": console, "apiUrl": "http://127.0.0.1:" + str(api.server_port),
            "consoleUrl": "http://127.0.0.1:" + str(console.server_port) + "/#" + capability}

def stop(session):
    for key in ("api", "console"):
        session[key].shutdown()
        session[key].server_close()
