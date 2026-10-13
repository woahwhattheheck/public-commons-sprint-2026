#!/usr/bin/env python3
"""Outbound HTTPS relay for one existing Ecosystem native operator.

Private credentials stay on this host. Original HTTP requests, scientific task
identities and binary files pass through the existing operator exactly once.
This program never launches an operator, model, command, or arbitrary URL.
"""
from __future__ import annotations
import argparse
import ast
import contextlib
import hashlib
import http.client
import ipaddress
import json
import os
from pathlib import Path
import re
import signal
import socket
import sqlite3
import ssl
import stat
import threading
import time
import urllib.parse
import uuid

SCHEMA = "upstate.eco-native-connector/v1"
CHUNK = 1024 * 1024
ID = re.compile(r"[A-Za-z0-9_-]{8,128}\Z")
OPERATION_ID = re.compile(r"[A-Za-z0-9_-]{16,100}\Z")
HEX = re.compile(r"[0-9a-f]{64}\Z")
PREFIX = "/_eco/v1/connector"
DENIED = {"/api/team", "/api/logout"}
REQUEST_HEADERS = {"accept", "content-type", "content-length", "range", "if-range",
                   "if-none-match", "if-match", "if-modified-since", "x-workspace",
                   "x-upload-filename", "x-file-sha256", "x-source-sha256",
                   "idempotency-key", "x-idempotency-key"}
RESPONSE_HEADERS = {"content-type", "content-length", "content-disposition", "content-range",
                    "content-encoding", "accept-ranges", "etag", "last-modified", "cache-control",
                    "content-security-policy", "referrer-policy", "x-content-type-options",
                    "retry-after", "location", "vary"}
STOP = threading.Event()


class ConnectorError(Exception):
    def __init__(self, code, status=None):
        super().__init__(code)
        self.code, self.status = code, status


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def digest(value):
    return hashlib.sha256(value).hexdigest()


def fsync_directory(path):
    if os.name == "posix":
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def event(name, request_id=None, **fields):
    # Do not log credentials, URLs, request bodies, upstream errors, or filenames.
    print(json.dumps({"event": name, **({"request_id": request_id} if request_id else {}),
                      **fields}, sort_keys=True), flush=True)


def private_json(path):
    path = Path(path)
    if path.is_symlink():
        raise ConnectorError("PRIVATE_FILE_SYMLINK")
    mode = path.stat()
    if not stat.S_ISREG(mode.st_mode):
        raise ConnectorError("PRIVATE_FILE_REQUIRED")
    if os.name == "posix" and (mode.st_uid != os.getuid() or mode.st_mode & 0o077):
        raise ConnectorError("PRIVATE_FILE_REQUIRES_OWNER_ONLY_PERMISSIONS")
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ConnectorError("PRIVATE_OBJECT_REQUIRED")
    return value


def https_origin(value):
    url = urllib.parse.urlsplit(value)
    if (url.scheme != "https" or not url.hostname or url.port not in (None, 443)
            or url.username or url.password or url.path not in ("", "/")
            or url.query or url.fragment):
        raise ConnectorError("EXACT_HTTPS_443_ORIGIN_REQUIRED")
    return "https://" + url.netloc, url


def clean_target(value):
    if not isinstance(value, str) or len(value) > 16384 or not value.startswith("/") or value.startswith("//"):
        raise ConnectorError("ORIGINAL_RELATIVE_PATH_REQUIRED")
    url = urllib.parse.urlsplit(value)
    if url.scheme or url.netloc or url.fragment or any(ord(c) < 32 for c in value) or "\\" in value:
        raise ConnectorError("INVALID_REQUEST_TARGET")
    decoded = urllib.parse.unquote(url.path)
    if any(p in (".", "..") for p in decoded.split("/")) or "\\" in decoded or "\x00" in decoded:
        raise ConnectorError("INVALID_REQUEST_PATH")
    if decoded != url.path and any(c in decoded for c in "\r\n"):
        raise ConnectorError("INVALID_REQUEST_PATH")
    return url


def integer(value, name):
    if type(value) is not int or value < 0:
        raise ConnectorError("INVALID_" + name.upper())
    return value


def clean_headers(value, allowed):
    if not isinstance(value, dict):
        raise ConnectorError("HEADER_OBJECT_REQUIRED")
    result = {}
    for key, item in value.items():
        if not isinstance(key, str) or not isinstance(item, str):
            raise ConnectorError("INVALID_HEADER")
        name = key.lower()
        if name in allowed:
            if name in result or len(item) > 8192 or "\r" in item or "\n" in item or "\x00" in item:
                raise ConnectorError("INVALID_HEADER")
            result[name] = item
    return result


def read_secret(config, config_root, name):
    reference = config.get(name + "_file")
    if reference:
        value = private_json((config_root / reference).resolve())
        secret = value.get(name) or value.get("token")
    else:
        secret = config.get(name)
    if not isinstance(secret, str) or len(secret) < 24 or any(c.isspace() for c in secret):
        raise ConnectorError("PRIVATE_" + name.upper() + "_REQUIRED")
    return secret


def native_session(path, application):
    record = private_json(path)
    if (record.get("schema") != "upstate.workbench-local-session/v1"
            or record.get("hostname") != socket.gethostname()):
        raise ConnectorError("EXISTING_NATIVE_SESSION_REQUIRED")
    selection = record.get("selection") or {}
    if Path(selection.get("application", "")).resolve() != application:
        raise ConnectorError("NATIVE_SESSION_APPLICATION_CHANGED")
    binding = {"workspace_key": record.get("workspace_key"),
               "project_id": selection.get("project_id"), "application": str(application)}
    if (not isinstance(binding["workspace_key"], str) or not HEX.fullmatch(binding["workspace_key"])
            or not isinstance(binding["project_id"], str) or not binding["project_id"]):
        raise ConnectorError("NATIVE_SESSION_PROJECT_REQUIRED")
    url = urllib.parse.urlsplit(record.get("operator_url", ""))
    values = urllib.parse.parse_qs(url.fragment)
    native_token = values.get("token", [])
    if (url.scheme != "http" or url.hostname != "127.0.0.1" or not url.port
            or url.username or url.password or url.path != "/" or url.query
            or set(values) != {"token"} or len(native_token) != 1
            or not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", native_token[0])):
        raise ConnectorError("ORIGINAL_NATIVE_OPENING_REQUIRED")
    return urllib.parse.urlsplit("http://" + url.netloc), native_token[0], binding


class Config:
    def __init__(self, path):
        path = Path(path).resolve()
        data = private_json(path)
        if data.get("schema") != SCHEMA:
            raise ConnectorError("CONFIG_SCHEMA")
        self.origin, self.edge = https_origin(data["edge_origin"])
        self.operator_id = data["operator_id"]
        if not ID.fullmatch(self.operator_id):
            raise ConnectorError("OPERATOR_ID")
        self.connector_token = read_secret(data, path.parent, "connector_token")
        self.application = (path.parent / data["application"]).resolve(strict=True)
        self.native_session_file = ((path.parent / data["native_session_file"]).resolve()
                                    if data.get("native_session_file") else None)
        self.native_binding = None
        self.native_token_override_file = ((path.parent / data["native_token_file"]).resolve()
                                          if self.native_session_file and data.get("native_token_file") else None)
        if self.native_session_file:
            self.local, self.native_token, self.native_binding = native_session(self.native_session_file, self.application)
        else:
            self.native_token = read_secret(data, path.parent, "native_token")
            self.local = urllib.parse.urlsplit(data["operator_origin"])
        try:
            address = ipaddress.ip_address(self.local.hostname)
        except ValueError:
            raise ConnectorError("LITERAL_LOOPBACK_OPERATOR_REQUIRED")
        if (self.local.scheme != "http" or not address.is_loopback or not self.local.port
                or self.local.username or self.local.password or self.local.path not in ("", "/")
                or self.local.query or self.local.fragment):
            raise ConnectorError("EXISTING_LOOPBACK_OPERATOR_REQUIRED")
        self.application = (path.parent / data["application"]).resolve(strict=True)
        self.directory = (path.parent / data["state_directory"]).resolve()
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        if self.directory.is_symlink():
            raise ConnectorError("PRIVATE_STATE_REQUIRED")
        if os.name == "posix":
            mode = self.directory.stat()
            if mode.st_uid != os.getuid() or mode.st_mode & 0o077:
                raise ConnectorError("PRIVATE_STATE_REQUIRES_OWNER_ONLY_PERMISSIONS")
        self.workers = int(data.get("workers", 4))
        self.spool_limit = int(data.get("max_spool_bytes", 10 * 1024 ** 3))
        self.timeout = float(data.get("native_timeout_seconds", 600))
        if not 1 <= self.workers <= 16 or self.spool_limit < CHUNK or not 1 <= self.timeout <= 86400:
            raise ConnectorError("CONFIG_LIMITS")
        self.route_extras = data.get("additional_routes", [])
        self.instance_path = self.directory / "connector-instance.json"
        if self.instance_path.exists():
            self.instance = private_json(self.instance_path)["instance"]
        else:
            self.instance = uuid.uuid4().hex
            with self.instance_path.open("x", encoding="utf-8") as handle:
                os.chmod(self.instance_path, 0o600)
                json.dump({"instance": self.instance, "operator_id": self.operator_id,
                           "edge_origin": self.origin, "native_binding": self.native_binding}, handle)
                handle.flush()
                os.fsync(handle.fileno())
            fsync_directory(self.directory)
        saved = private_json(self.instance_path)
        if (saved.get("operator_id") != self.operator_id or saved.get("edge_origin") != self.origin
                or not ID.fullmatch(self.instance) or saved.get("native_binding") != self.native_binding):
            raise ConnectorError("STATE_BELONGS_TO_ANOTHER_OPERATOR")

    def native_target(self):
        if self.native_session_file:
            local, credential, binding = native_session(self.native_session_file, self.application)
            if binding != self.native_binding:
                raise ConnectorError("NATIVE_SESSION_PROJECT_CHANGED")
            if self.native_token_override_file:
                credential = read_secret({"native_token_file": str(self.native_token_override_file)},
                                         Path("/"), "native_token")
            return local, credential
        return self.local, self.native_token


class Edge:
    def __init__(self, config):
        self.config = config
        self.context = ssl.create_default_context()

    def call(self, method, path, *, value=None, body=None, headers=None, limit=2 * CHUNK, timeout=35):
        if value is not None:
            body = canonical(value)
        body = b"" if body is None and method in ("POST", "PUT") else body
        supplied = {"Authorization": "Bearer " + self.config.connector_token,
                    "X-Eco-Connector-Instance": self.config.instance,
                    "X-Eco-Operator-ID": self.config.operator_id,
                    "Accept-Encoding": "identity"}
        if value is not None:
            supplied["Content-Type"] = "application/json"
        if body is not None:
            supplied["Content-Length"] = str(len(body))
        supplied.update(headers or {})
        connection = http.client.HTTPSConnection(self.config.edge.hostname, 443,
                                                timeout=timeout, context=self.context)
        try:
            connection.request(method, PREFIX + path, body=body, headers=supplied)
            reply = connection.getresponse()
            data = reply.read(limit + 1)
            if len(data) > limit:
                raise ConnectorError("EDGE_REPLY_TOO_LARGE")
            if 300 <= reply.status < 400:
                raise ConnectorError("EDGE_REDIRECT_REFUSED", reply.status)
            if not 200 <= reply.status < 300:
                raise ConnectorError("EDGE_HTTP_" + str(reply.status), reply.status)
            return reply.status, {k.lower(): v for k, v in reply.getheaders()}, data
        finally:
            connection.close()

    def json(self, method, path, value=None, timeout=35):
        status, headers, data = self.call(method, path, value=value, timeout=timeout)
        if status == 204 or not data:
            return None
        try:
            parsed = json.loads(data)
        except (ValueError, UnicodeError):
            raise ConnectorError("EDGE_JSON_INVALID")
        if not isinstance(parsed, dict):
            raise ConnectorError("EDGE_OBJECT_REQUIRED")
        return parsed

    def status(self, request_id):
        return self.json("GET", "/requests/" + request_id + "/status")


class Journal:
    def __init__(self, directory):
        self.root = directory
        self.path = directory / "requests.sqlite3"
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("""CREATE TABLE IF NOT EXISTS requests (
                id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, request TEXT NOT NULL,
                state TEXT NOT NULL, input_offset INTEGER NOT NULL DEFAULT 0,
                response TEXT, error TEXT, updated REAL NOT NULL)""")
            db.execute("""CREATE TABLE IF NOT EXISTS chunks (
                id TEXT NOT NULL, offset INTEGER NOT NULL, bytes INTEGER NOT NULL,
                sha256 TEXT NOT NULL, PRIMARY KEY(id,offset))""")
        os.chmod(self.path, 0o600)

    @contextlib.contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        try:
            db.execute("PRAGMA synchronous=FULL")
            with db:
                yield db
        finally:
            db.close()

    def get(self, request_id):
        with self.connect() as db:
            row = db.execute("SELECT * FROM requests WHERE id=?", (request_id,)).fetchone()
            return dict(row) if row else None

    def accept(self, request):
        request_id = request["id"]
        fingerprint = digest(canonical(request))
        with self.connect() as db:
            db.execute("INSERT OR IGNORE INTO requests(id,fingerprint,request,state,updated) VALUES(?,?,?,?,?)",
                       (request_id, fingerprint, canonical(request).decode(), "receiving", time.time()))
            row = db.execute("SELECT * FROM requests WHERE id=?", (request_id,)).fetchone()
            if row["fingerprint"] != fingerprint:
                raise ConnectorError("REQUEST_ID_REUSED")
        return self.get(request_id)

    def state(self, request_id, state, response=None, error=None):
        with self.connect() as db:
            db.execute("UPDATE requests SET state=?,response=COALESCE(?,response),error=?,updated=? WHERE id=?",
                       (state, canonical(response).decode() if response is not None else None,
                        error, time.time(), request_id))

    def received(self, request_id, offset, data):
        sha = digest(data)
        with self.connect() as db:
            db.execute("INSERT OR REPLACE INTO chunks(id,offset,bytes,sha256) VALUES(?,?,?,?)",
                       (request_id, offset, len(data), sha))
            db.execute("UPDATE requests SET input_offset=?,updated=? WHERE id=?",
                       (offset + len(data), time.time(), request_id))
        return sha

    def chunk(self, request_id, offset):
        with self.connect() as db:
            row = db.execute("SELECT * FROM chunks WHERE id=? AND offset=?", (request_id, offset)).fetchone()
            return dict(row) if row else None

    def chunks(self, request_id):
        with self.connect() as db:
            return [dict(row) for row in db.execute(
                "SELECT offset,bytes,sha256 FROM chunks WHERE id=? ORDER BY offset", (request_id,))]

    def recover(self):
        with self.connect() as db:
            rows = db.execute("SELECT id,request FROM requests WHERE state='executing'").fetchall()
            for row in rows:
                # GET has no write effects; every POST retains its uncertain original ID.
                method = json.loads(row["request"])["method"]
                db.execute("UPDATE requests SET state=?,error=?,updated=? WHERE id=?",
                           ("ready" if method == "GET" else "uncertain",
                            None if method == "GET" else "NATIVE_CONNECTION_INTERRUPTED",
                            time.time(), row["id"]))

    def pending(self):
        with self.connect() as db:
            return [json.loads(r["request"]) for r in db.execute(
                "SELECT request FROM requests WHERE state NOT IN ('delivered') ORDER BY updated")]

    def body_path(self, request_id, kind):
        if not ID.fullmatch(request_id) or kind not in ("input", "response"):
            raise ConnectorError("STATE_PATH_INVALID")
        return self.root / (request_id + "." + kind)


class Connector:
    def __init__(self, config):
        self.config, self.edge = config, Edge(config)
        self.journal = Journal(config.directory)
        self.routes = set()
        self.locks, self.locks_guard = {}, threading.Lock()
        self.capacity_lock = threading.Lock()
        self.journal.recover()

    def local_call(self, method, target, headers=None, body=None):
        local, native_token = self.config.native_target()
        original = dict(headers or {})
        original.update({"Host": self.config.edge.netloc,
                         "Authorization": "Bearer " + native_token,
                         "Accept-Encoding": "identity", "Connection": "close"})
        # Exact advertised origin is configured on the original server by its owner.
        if method not in ("GET", "HEAD"):
            original["Origin"] = self.config.origin
        conn = http.client.HTTPConnection(local.hostname, local.port,
                                          timeout=self.config.timeout, blocksize=CHUNK)
        try:
            conn.request(method, target, body=body, headers=original)
            return conn, conn.getresponse()
        except BaseException:
            conn.close()
            raise

    def local_json(self, target):
        conn, reply = self.local_call("GET", target)
        try:
            raw = reply.read(8 * CHUNK + 1)
            if reply.status != 200 or len(raw) > 8 * CHUNK:
                raise ConnectorError("NATIVE_DISCOVERY_HTTP_" + str(reply.status))
            result = json.loads(raw)
            if not isinstance(result, dict):
                raise ConnectorError("NATIVE_DISCOVERY_OBJECT")
            return result
        finally:
            conn.close()

    def register(self):
        # Read trusted installed source as syntax, without importing any model or provider.
        server = self.config.application / "operator" / "server.py"
        tree = ast.parse(server.read_text(encoding="utf-8"), filename=str(server))
        routes = {("GET", "/"), ("GET", "/health")}
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in ("do_GET", "do_POST", "do_PUT", "do_PATCH", "do_DELETE"):
                method = node.name[3:]
                for item in ast.walk(node):
                    if isinstance(item, ast.Constant) and isinstance(item.value, str):
                        path = item.value
                        if path.startswith("/api/") and not path.endswith("/") and path not in DENIED:
                            routes.add((method, path))
        families = (("rehearsal.py", "/api/rehearsals/"),
                    ("customer_reviews.py", "/api/reviews/"),
                    ("experiment_operator.py", "/api/experiments/"),
                    ("parameter_study_api.py", "/api/parameter-studies/"),
                    ("programmes.py", "/api/programmes/"))
        for filename, prefix in families:
            source = self.config.application / "operator" / filename
            if not source.exists():
                continue
            module = ast.parse(source.read_text(encoding="utf-8"), filename=str(source))
            for node in module.body:
                targets = node.targets if isinstance(node, ast.Assign) else [node.target] if isinstance(node, ast.AnnAssign) else []
                if any(isinstance(t, ast.Name) and t.id == "READS" for t in targets):
                    try:
                        literal = node.value
                        if (isinstance(literal, ast.Call) and isinstance(literal.func, ast.Name)
                                and literal.func.id in ("frozenset", "set", "tuple", "list")
                                and len(literal.args) == 1 and not literal.keywords):
                            literal = literal.args[0]
                        choices = ast.literal_eval(literal)
                    except (ValueError, TypeError):
                        raise ConnectorError("NATIVE_ROUTE_DECLARATION_NEEDS_EXACT_REGISTRATION")
                    for name in choices:
                        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", name):
                            raise ConnectorError("NATIVE_ROUTE_DECLARATION_INVALID")
                        routes.add(("GET", prefix + name))
        manifest = self.local_json("/api/extensions")
        if manifest.get("schema") != "upstate.operator-extensions/v1":
            raise ConnectorError("NATIVE_EXTENSION_SCHEMA")
        for extension in manifest.get("extensions", []):
            for route in extension.get("reads", []):
                routes.add((route["method"], route["path"]))
        for asset in manifest.get("web_assets", []):
            if not isinstance(asset, str):
                raise ConnectorError("NATIVE_WEB_ASSET_INVALID")
            relative = asset.removeprefix("/web/")
            parts = relative.split("/")
            if (not relative or any(not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", part)
                                    or part in (".", "..") for part in parts)
                    or Path(relative).suffix not in (".mjs", ".css", ".html")):
                raise ConnectorError("NATIVE_WEB_ASSET_INVALID")
            routes.add(("GET", "/web/" + relative))
        for path in (self.config.application / "operator" / "web").iterdir():
            if path.is_file() and path.suffix in (".mjs", ".css", ".html") and path.name != "team.html":
                routes.add(("GET", "/web/" + path.name))
        for route in self.config.route_extras:
            routes.add((route["method"], route["path"]))
        routes = {(m, p) for m, p in routes if m in ("GET", "POST", "PUT", "PATCH", "DELETE") and clean_target(p).path not in DENIED}
        self.routes = routes
        native_workspace = (self.config.native_binding or {}).get("workspace_key")
        if native_workspace is None:
            native_workspace = self.local_json("/api/whoami").get("default_workspace")
        if not isinstance(native_workspace, str) or not HEX.fullmatch(native_workspace):
            raise ConnectorError("NATIVE_WORKSPACE_BINDING_REQUIRED")
        self.edge.json("POST", "/register", {"operator_id": self.config.operator_id,
                       "native_workspace_key": native_workspace,
                       "protocol": "upstate.eco-transport/v1",
                       "routes": [{"method": m, "path": p} for m, p in sorted(routes)]})
        event("connected", routes=len(routes), protocol="upstate.eco-transport/v1")

    def validate(self, record):
        request_id = record.get("id")
        if not isinstance(request_id, str) or not ID.fullmatch(request_id):
            raise ConnectorError("REQUEST_ID_INVALID")
        method = record.get("method")
        target = record.get("path")
        url = clean_target(target)
        file_route = (method == "GET" and url.path.startswith("/api/file/")
                      and all(part not in (".", "..", "") for part in urllib.parse.unquote(url.path).split("/")[1:]))
        if url.path in DENIED or (method, url.path) not in self.routes and not file_route:
            raise ConnectorError("REQUEST_ROUTE_NOT_REGISTERED")
        headers = clean_headers(record.get("headers", {}), REQUEST_HEADERS)
        size = integer(record.get("body_bytes", 0), "body_bytes")
        if method == "GET" and size:
            raise ConnectorError("GET_BODY_NOT_SUPPORTED")
        if "content-length" in headers and headers["content-length"] != str(size):
            raise ConnectorError("CONTENT_LENGTH_MISMATCH")
        body_sha = record.get("body_sha256")
        if body_sha is not None and (not isinstance(body_sha, str) or not HEX.fullmatch(body_sha)):
            raise ConnectorError("BODY_HASH_INVALID")
        return {"id": request_id, "method": method, "path": target,
                "headers": headers, "body_bytes": size, "body_sha256": body_sha}

    def capacity(self, extra):
        with self.capacity_lock:
            used = sum(p.stat().st_size for p in self.config.directory.glob("*.input"))
            used += sum(p.stat().st_size for p in self.config.directory.glob("*.response"))
            if used + extra > self.config.spool_limit:
                raise ConnectorError("PRIVATE_SPOOL_CAPACITY")
            free = os.statvfs(self.config.directory).f_bavail * os.statvfs(self.config.directory).f_frsize
            if extra + 32 * CHUNK > free:
                raise ConnectorError("PRIVATE_DISK_CAPACITY")

    def verify_input(self, source, request, committed, allow_suffix=False):
        """Verify all durable bytes, including prefixes the edge already ACKed."""
        size = request["body_bytes"]
        if type(committed) is not int or not 0 <= committed <= size:
            raise ConnectorError("DURABLE_INPUT_OFFSET")
        mode = os.fstat(source.fileno())
        if not stat.S_ISREG(mode.st_mode):
            raise ConnectorError("DURABLE_INPUT_REGULAR_FILE_REQUIRED")
        if mode.st_size < committed or (not allow_suffix and mode.st_size != committed):
            raise ConnectorError("DURABLE_INPUT_LENGTH")
        source.seek(0)
        full, offset = hashlib.sha256(), 0
        for chunk in self.journal.chunks(request["id"]):
            count = chunk["bytes"]
            if (chunk["offset"] != offset or type(count) is not int
                    or not 0 < count <= CHUNK or offset + count > committed):
                raise ConnectorError("DURABLE_INPUT_CHUNK_INVENTORY")
            raw = source.read(count)
            if len(raw) != count or digest(raw) != chunk["sha256"]:
                raise ConnectorError("DURABLE_INPUT_CHANGED")
            full.update(raw)
            offset += count
        if offset != committed:
            raise ConnectorError("DURABLE_INPUT_CHUNK_INVENTORY")
        result = full.hexdigest()
        if committed == size and request["body_sha256"] and request["body_sha256"] != result:
            raise ConnectorError("ORIGINAL_REQUEST_HASH_MISMATCH")
        source.seek(0)
        return result

    def receive(self, request):
        request_id, size = request["id"], request["body_bytes"]
        state = self.journal.get(request_id)
        path = self.journal.body_path(request_id, "input")
        if path.is_symlink():
            raise ConnectorError("DURABLE_INPUT_REGULAR_FILE_REQUIRED")
        try:
            output = path.open("r+b")
        except FileNotFoundError:
            if state["input_offset"]:
                raise ConnectorError("DURABLE_INPUT_MISSING")
            output = path.open("x+b")
            try:
                os.chmod(path, 0o600)
                output.flush()
                os.fsync(output.fileno())
                fsync_directory(path.parent)
            except BaseException:
                output.close()
                raise
        with output:
            self.verify_input(output, request, state["input_offset"], allow_suffix=True)
            # Only an uncommitted suffix may be discarded, never create missing bytes.
            output.truncate(state["input_offset"])
            status = self.edge.status(request_id)
            edge_offset = integer(status.get("input_offset", 0), "input_offset")
            if edge_offset > state["input_offset"]:
                raise ConnectorError("EDGE_ACK_EXCEEDS_DURABLE_INPUT")
            while edge_offset < size:
                if STOP.is_set():
                    return False
                previous = self.journal.chunk(request_id, edge_offset)
                if previous is not None:
                    output.seek(edge_offset)
                    chunk = output.read(previous["bytes"])
                    if len(chunk) != previous["bytes"] or digest(chunk) != previous["sha256"]:
                        raise ConnectorError("DURABLE_INPUT_CHANGED")
                    sha = previous["sha256"]
                else:
                    _, headers, chunk = self.edge.call("GET", "/requests/" + request_id + "/input?offset=" + str(edge_offset),
                                                      limit=CHUNK, timeout=35)
                    if not chunk or len(chunk) > size - edge_offset:
                        raise ConnectorError("INPUT_CHUNK_LENGTH")
                    sha = digest(chunk)
                    if headers.get("x-chunk-sha256") != sha:
                        raise ConnectorError("INPUT_CHUNK_HASH")
                    self.capacity(len(chunk))
                    output.seek(edge_offset)
                    output.write(chunk)
                    output.flush()
                    os.fsync(output.fileno())
                    self.journal.received(request_id, edge_offset, chunk)
                # Acknowledgement is safe to repeat after lost HTTP response.
                self.edge.json("POST", "/requests/" + request_id + "/input-ack",
                               {"offset": edge_offset, "bytes": len(chunk), "sha256": sha})
                edge_offset += len(chunk)
            output.flush()
            os.fsync(output.fileno())
            current = self.journal.get(request_id)
            if current["input_offset"] != size:
                raise ConnectorError("DURABLE_INPUT_INCOMPLETE")
            self.verify_input(output, request, size)
        self.journal.state(request_id, "ready")
        return True

    @staticmethod
    def file_hash(path):
        result = hashlib.sha256()
        with path.open("rb") as source:
            while data := source.read(CHUNK):
                result.update(data)
        return result.hexdigest()

    def execute(self, request):
        request_id = request["id"]
        source = self.journal.body_path(request_id, "input")
        if source.is_symlink():
            raise ConnectorError("DURABLE_INPUT_REGULAR_FILE_REQUIRED")
        # Verify the SAME open file that will be dispatched, before changing state.
        with source.open("rb") as body:
            current = self.journal.get(request_id)
            if current["input_offset"] != request["body_bytes"]:
                raise ConnectorError("DURABLE_INPUT_INCOMPLETE")
            input_sha = self.verify_input(body, request, request["body_bytes"])
            # Persist before either the execution marker or any upstream operation.
            self.journal.state(request_id, "executing")
            try:
                self.edge.json("POST", "/requests/" + request_id + "/executing",
                               {"body_bytes": request["body_bytes"], "body_sha256": input_sha})
            except BaseException:
                # No upstream call has happened; this same marker is safe to repeat.
                self.journal.state(request_id, "ready")
                raise
            response_path = self.journal.body_path(request_id, "response")
            headers = dict(request["headers"])
            headers["content-length"] = str(request["body_bytes"])
            try:
                conn, reply = self.local_call(request["method"], request["path"], headers,
                                              body if request["body_bytes"] else None)
                try:
                    response_headers = clean_headers(dict(reply.getheaders()), RESPONSE_HEADERS)
                    location = response_headers.get("location")
                    if location:
                        redirect = urllib.parse.urlsplit(location)
                        if redirect.netloc and (redirect.scheme + "://" + redirect.netloc) != self.config.origin:
                            raise ConnectorError("NATIVE_REDIRECT_ORIGIN")
                    expected = reply.getheader("Content-Length")
                    if expected is not None and (not expected.isdigit()):
                        raise ConnectorError("NATIVE_CONTENT_LENGTH")
                    sha, size = hashlib.sha256(), 0
                    with response_path.open("wb") as output:
                        os.chmod(response_path, 0o600)
                        while chunk := reply.read(CHUNK):
                            self.capacity(len(chunk))
                            output.write(chunk)
                            sha.update(chunk)
                            size += len(chunk)
                        output.flush()
                        os.fsync(output.fileno())
                    fsync_directory(response_path.parent)
                    if reply.status not in (204, 304) and expected is not None and size != int(expected):
                        raise ConnectorError("NATIVE_RESPONSE_TRUNCATED")
                    if reply.status not in (204, 304):
                        response_headers["content-length"] = str(size)
                    response = {"status": reply.status, "headers": response_headers,
                                "body_bytes": size, "body_sha256": sha.hexdigest()}
                    self.journal.state(request_id, "response", response=response)
                finally:
                    conn.close()
            except BaseException:
                self.journal.state(request_id, "ready" if request["method"] == "GET" else "uncertain",
                                   error=None if request["method"] == "GET" else "NATIVE_OUTCOME_UNCERTAIN")
                raise
        event("native_response_retained", request_id, status=response["status"], bytes=size)

    def uncertain(self, request):
        # Preserve the original operation identity so the original native task can be read.
        result = {"code": "NATIVE_OUTCOME_UNCERTAIN",
                  "message": "Reconnect and inspect this original operation before another write."}
        if request["path"].split("?", 1)[0] == "/api/actions" and request["body_bytes"] <= 2 * CHUNK:
            try:
                payload = json.loads(self.journal.body_path(request["id"], "input").read_bytes())
                if isinstance(payload.get("operation_id"), str):
                    result["operation_id"] = payload["operation_id"]
                if isinstance(payload.get("workspace"), str):
                    result["workspace"] = payload["workspace"]
            except (OSError, ValueError, AttributeError):
                pass
        if self.reconcile_action(request, result):
            return
        self.edge.json("POST", "/requests/" + request["id"] + "/uncertain", result)
        event("native_outcome_uncertain", request["id"])

    def reconcile_action(self, request, result):
        """Read the original task after an ambiguous submit; never resubmit it."""
        if request["method"] != "POST" or request["path"].split("?", 1)[0] != "/api/actions":
            return False
        try:
            if request["body_bytes"] > 2 * CHUNK:
                return False
            payload = json.loads(self.journal.body_path(request["id"], "input").read_bytes())
            operation = payload.get("operation_id")
            workspace = payload.get("workspace") or request["headers"].get("x-workspace")
            if not isinstance(operation, str) or not OPERATION_ID.fullmatch(operation) or not isinstance(workspace, str):
                return False
            task_id = digest(canonical({"workspace": workspace, "operation_id": operation}))
            result["task_id"] = task_id
            result["lookup_path"] = "/api/task?id=" + task_id
            task = self.local_json(result["lookup_path"])
            expected = digest(canonical({"workspace": workspace, "action": payload["action"],
                                         "payload": payload.get("payload", {})}))
            if (task.get("id") != task_id or task.get("workspace") != workspace
                    or task.get("operation_id") != operation or task.get("request_sha256") != expected):
                return False
            raw = canonical(task)
            self.capacity(len(raw))
            path = self.journal.body_path(request["id"], "response")
            with path.open("wb") as output:
                os.chmod(path, 0o600)
                output.write(raw)
                output.flush()
                os.fsync(output.fileno())
            fsync_directory(path.parent)
            self.journal.state(request["id"], "response", response={
                "status": 202, "headers": {"content-type": "application/json",
                "content-length": str(len(raw)), "x-eco-reconciled-operation": operation},
                "body_bytes": len(raw), "body_sha256": digest(raw)})
            event("original_native_task_reconciled", request["id"])
            self.publish(request)
            return True
        except (OSError, http.client.HTTPException, ValueError, KeyError, ConnectorError):
            return False

    def publish(self, request):
        request_id = request["id"]
        row = self.journal.get(request_id)
        response = json.loads(row["response"])
        path = self.journal.body_path(request_id, "response")
        if not path.exists() or path.stat().st_size != response["body_bytes"] or self.file_hash(path) != response["body_sha256"]:
            raise ConnectorError("RETAINED_RESPONSE_CHANGED")
        self.edge.json("POST", "/requests/" + request_id + "/response", response)
        with path.open("rb") as source:
            while not STOP.is_set():
                status = self.edge.status(request_id)
                offset = integer(status.get("response_offset", 0), "response_offset")
                if offset > response["body_bytes"]:
                    raise ConnectorError("EDGE_RESPONSE_OFFSET")
                if offset == response["body_bytes"]:
                    self.journal.state(request_id, "delivered")
                    event("response_delivered", request_id, bytes=offset)
                    return
                source.seek(offset)
                chunk = source.read(min(CHUNK, response["body_bytes"] - offset))
                self.edge.call("PUT", "/requests/" + request_id + "/response?offset=" + str(offset),
                               body=chunk, headers={"Content-Type": "application/octet-stream",
                                                   "X-Chunk-SHA256": digest(chunk)}, timeout=35)

    def handle(self, record):
        request = self.validate(record)
        request_id = request["id"]
        with self.locks_guard:
            lock = self.locks.setdefault(request_id, threading.Lock())
        if not lock.acquire(blocking=False):
            return False
        try:
            row = self.journal.accept(request)
            if row["state"] == "receiving":
                if not self.receive(request):
                    return
                row = self.journal.get(request_id)
            if row["state"] == "ready":
                self.execute(request)
                row = self.journal.get(request_id)
            if row["state"] == "executing":
                self.journal.state(request_id, "uncertain", error="NATIVE_OUTCOME_UNCERTAIN")
                row = self.journal.get(request_id)
            if row["state"] == "uncertain":
                self.uncertain(request)
            elif row["state"] in ("response", "delivered"):
                # Same retained HTTP result may be reattached after client/edge loss.
                self.publish(request)
        finally:
            lock.release()
        return True

    def worker(self):
        delay = 1
        while not STOP.is_set():
            try:
                with self.locks_guard:
                    active = sorted(key for key, lock in self.locks.items() if lock.locked())
                target = "/poll" + ("?exclude=" + urllib.parse.quote(",".join(active), safe="") if active else "")
                record = self.edge.json("GET", target, timeout=30)
                if record is not None and self.handle(record) is False:
                    STOP.wait(0.25)
                delay = 1
            except (OSError, http.client.HTTPException, ValueError, ConnectorError) as error:
                event("reconnecting", code=getattr(error, "code", type(error).__name__))
                STOP.wait(delay)
                delay = min(30, delay * 2)

    def run(self):
        self.register()
        # Resume retained response/input work even when a disconnect hid its edge lease.
        for request in self.journal.pending():
            try:
                self.handle(request)
            except (OSError, http.client.HTTPException, ValueError, ConnectorError) as error:
                event("resume_pending", request["id"], code=getattr(error, "code", type(error).__name__))
        threads = [threading.Thread(target=self.worker, name="eco-relay-" + str(i), daemon=True)
                   for i in range(self.config.workers)]
        for thread in threads:
            thread.start()
        while not STOP.wait(1):
            if not any(t.is_alive() for t in threads):
                raise ConnectorError("RELAY_WORKERS_STOPPED")
        for thread in threads:
            thread.join(timeout=2)


@contextlib.contextmanager
def instance_lock(directory):
    import fcntl
    path = directory / "connector.lock"
    with path.open("a+b") as handle:
        os.chmod(path, 0o600)
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ConnectorError("CONNECTOR_ALREADY_RUNNING")
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, help="Existing private owner-only JSON; credentials are never CLI arguments")
    parser.add_argument("--register-only", action="store_true", help="Discover and register original served routes without executing requests")
    args = parser.parse_args(argv)
    os.umask(0o077)
    signal.signal(signal.SIGINT, lambda *_: STOP.set())
    signal.signal(signal.SIGTERM, lambda *_: STOP.set())
    try:
        config = Config(args.config)
        with instance_lock(config.directory):
            connector = Connector(config)
            if args.register_only:
                connector.register()
            else:
                connector.run()
    except (OSError, ValueError, KeyError, ConnectorError) as error:
        event("connector_error", code=getattr(error, "code", type(error).__name__))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
