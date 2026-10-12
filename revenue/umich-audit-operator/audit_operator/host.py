"""Loopback operator host with private sessions and scoped receiving workspaces."""
from __future__ import annotations

import contextlib
import hashlib
import json
import ipaddress
import ssl
import os
from pathlib import Path
import signal
import threading
import time
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlencode, urlsplit

from . import exchange, identity_http
from .service import AuditService, SOURCE_ROOT, require_auditor
from .store import Conflict, Forbidden, MAX_SOURCE, encoded, fingerprint, private_bytes

class WorkspaceRegistry:
    def __init__(self, root):
        self.lock = threading.RLock()
        self.entries = {}
        self.default_key = self.open(root)

    def open(self, root):
        path = Path(root).expanduser().absolute()
        key = hashlib.sha256(str(path).encode()).hexdigest()[:16]
        with self.lock:
            if key in self.entries:
                return key
            service = AuditService(path)
            lease = None
            try:
                import fcntl
                lease = open(service.store.root / "host.lock", "a+b")
                os.chmod(lease.name, 0o600)
                fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except (ImportError, BlockingIOError, OSError):
                if lease:
                    lease.close()
                service.close()
                raise ValueError("This POSIX workspace is already open in another host, or its private lock is unavailable.") from None
            self.entries[key] = (service, lease)
            return key

    def get(self, key):
        with self.lock:
            if key not in self.entries:
                raise KeyError("This receiving workspace is not open in this host.")
            return self.entries[key][0]

    def close(self):
        with self.lock:
            for service, lease in self.entries.values():
                service.close()
                lease.close()
            self.entries.clear()

class AuditHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, root, port=0, *, listen="127.0.0.1", public_origin=None, tls_cert=None, tls_key=None):
        if listen == "localhost":
            listen = "127.0.0.1"
        try:
            address = ipaddress.ip_address(listen)
            if address.version != 4:
                raise ValueError()
        except ValueError:
            raise ValueError("Choose an explicit IPv4 listening address.") from None
        if bool(tls_cert) != bool(tls_key):
            raise ValueError("Direct HTTPS needs both its certificate and private key.")
        self.public_origin = identity_http.public_origin(public_origin) if public_origin else None
        self.direct_tls = bool(tls_cert)
        if not address.is_loopback and not (self.direct_tls and self.public_origin):
            raise ValueError("A network listener requires direct TLS and its registered HTTPS origin.")
        context = None
        if self.direct_tls:
            private_bytes(Path(tls_key), 65536)
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.minimum_version = ssl.TLSVersion.TLSv1_2
            context.load_cert_chain(str(tls_cert), str(tls_key))
        self.registry = WorkspaceRegistry(root)
        self.login_attempts = {}
        self.login_lock = threading.Lock()
        try:
            super().__init__((listen, int(port)), AuditHandler)
            if context:
                self.socket = context.wrap_socket(self.socket, server_side=True)
        except BaseException:
            self.registry.close()
            raise

    @property
    def origin(self):
        return self.public_origin or ("https" if self.direct_tls else "http") + "://127.0.0.1:" + str(self.server_port)

    @property
    def accepted_hosts(self):
        if self.public_origin:
            return {urlsplit(self.public_origin).netloc}
        return {"127.0.0.1:" + str(self.server_port), "localhost:" + str(self.server_port)}

    def server_close(self):
        super().server_close()
        self.registry.close()

class AuditHandler(BaseHTTPRequestHandler):
    server_version = "CommonsAudit/1"
    protocol_version = "HTTP/1.1"

    def log_message(self, format, *args):
        # Access keys, original file names and record payloads never enter HTTP logs.
        return

    def _context(self):
        raw = urlsplit(self.path)
        if raw.scheme or raw.netloc:
            raise Forbidden("Use the configured workspace request path.")
        values = parse_qs(raw.query, keep_blank_values=True, max_num_fields=100, errors="strict")
        if any(len(value) != 1 for value in values.values()):
            raise ValueError("A workspace query field must occur exactly once.")
        self.query = {key: value[0] for key, value in values.items()}
        self.path_only = raw.path
        self.workspace_key = self.query.get("workspace") or self.server.registry.default_key
        self.service = self.server.registry.get(self.workspace_key)
        self.cookie_name = "audit_" + self.workspace_key
        if len(self.headers.get_all("Host", [])) != 1:
            raise Forbidden("Use one configured workspace host.")
        identity_http.request_context(self)

    def _session(self):
        value = cookies.SimpleCookie()
        with contextlib.suppress(cookies.CookieError):
            value.load(self.headers.get("Cookie", ""))
        token = value[self.cookie_name].value if self.cookie_name in value else ""
        actor = self.service.store.session(token) if token else None
        if actor is None:
            raise PermissionError("Open your workspace access link or enter its access key.")
        self.session_token = token
        return actor

    def _send(self, status, value, media_type="application/json; charset=utf-8", headers=None):
        if not isinstance(value, bytes):
            value = encoded(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", media_type)
        self.send_header("Content-Length", str(len(value)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        csp = ("default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; "
               "img-src 'self' data:; frame-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
        if "Content-Security-Policy" not in (headers or {}):
            self.send_header("Content-Security-Policy", csp)
        for key, item in (headers or {}).items():
            for header_value in item if isinstance(item, list) else [item]:
                self.send_header(key, header_value)
        self.end_headers()
        if self.command != "HEAD":
            with contextlib.suppress(BrokenPipeError, ConnectionResetError):
                self.wfile.write(value)

    def _error(self, exc):
        if isinstance(exc, exchange.ExchangeError):
            self._send(409 if "stale" in exc.code else 422,
                       {"error": str(exc), "code": exc.code, "diagnostics": exc.diagnostics})
        elif isinstance(exc, Forbidden):
            self._send(403, {"error": str(exc)})
        elif isinstance(exc, PermissionError):
            self._send(401, {"error": str(exc)})
        elif isinstance(exc, Conflict):
            self._send(409, {"error": str(exc), "code": "current_revision_changed"})
        elif isinstance(exc, KeyError):
            self._send(404, {"error": str(exc).strip("'")})
        elif isinstance(exc, (ValueError, TypeError)):
            self._send(422, {"error": str(exc)})
        elif isinstance(exc, OSError):
            self._send(503, {"error": "The private workspace storage is unavailable. Retain this operation and retry it."})
        else:
            self._send(500, {"error": "The operation did not complete. Retain its ID and inspect the operator log.",
                             "exception_type": type(exc).__name__})

    def _download(self, data, metadata):
        name = metadata["name"].replace('"', "").replace("\r", "").replace("\n", "")
        inline = self.query.get("inline") == "1" and str(metadata["media_type"]).startswith("text/html")
        headers = {"Content-Disposition": ('inline' if inline else 'attachment') + '; filename="' + name.encode("ascii", "replace").decode() + '"',
                   "X-Content-SHA256": metadata["sha256"]}
        if inline:
            # Report pages are escaped by their renderer and run with no script/form capability.
            headers["Content-Security-Policy"] = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'"
        self._send(200, data, metadata["media_type"], headers)

    def do_GET(self):
        try:
            self._context()
            assets = {"/": ("index.html", "text/html; charset=utf-8"),
                      "/app.js": ("app.js", "text/javascript; charset=utf-8"),
                      "/style.css": ("style.css", "text/css; charset=utf-8"),
                      "/identity.js": ("identity.js", "text/javascript; charset=utf-8"),
                      "/identity.css": ("identity.css", "text/css; charset=utf-8")}
            if self.path_only in assets:
                name, media = assets[self.path_only]
                return self._send(200, (SOURCE_ROOT / "ui" / name).read_bytes(), media)
            if self.path_only == "/health":
                return self._send(200, {"status": "ready", "service": "Commons Audit Operator"})
            if identity_http.get(self):
                return
            actor = self._session()
            q, service, path = self.query, self.service, self.path_only
            if path == "/api/state":
                result = service.state(actor)
                result.update({"host_workspace_key": self.workspace_key, "host_url": self.request_origin,
                               "workspace_directory": str(service.store.root) if actor.get("admin") else None})
            elif path == "/api/records":
                result = service.records(actor, q.get("kind") or None, q.get("q", ""), q.get("offset", 0), q.get("limit", 100))
            elif path == "/api/record":
                record = service.record(actor, q["kind"], q["id"], q.get("revision"))
                result = {"record": record, "input_hash": fingerprint(record)}
            elif path == "/api/history":
                result = service.history(actor, q["kind"], q["id"])
            elif path == "/api/sources":
                result = {"sources": service.sources(actor)}
            elif path == "/api/source/inspect":
                result = service.inspect_source(actor, q["id"], q.get("kind"), q.get("delimiter", ","), q.get("encoding", "utf-8-sig"))
            elif path == "/api/source/download":
                return self._download(*service.source_bytes(actor, q["id"]))
            elif path == "/api/evidence/download":
                record = service.record(actor, "evidence", q["id"])
                source = service.store.source_for_evidence(record["payload"]["source_id"], record["payload"]["sha256"])
                return self._download(service.store.bytes(source["sha256"]), source)
            elif path == "/api/catalog":
                result = service.catalog_view(actor)
            elif path == "/api/follow-up":
                result = {"items": service.follow_up(actor, q.get("as_of"))}
            elif path == "/api/artifacts":
                result = {"artifacts": service.artifacts(actor)}
            elif path == "/api/artifact/download":
                return self._download(*service.artifact_bytes(actor, q["id"]))
            elif path == "/api/grants":
                if not actor.get("admin"):
                    raise Forbidden("Access administration belongs to the workspace owner.")
                result = {"grants": service.store.grants()}
            elif path == "/api/operations":
                require_auditor(actor)
                result = service.identity.activity(
                    actor, q.get("before"), q.get("limit", 100),
                    q.get("before_sequence"), q.get("event_limit", 100))
            elif path == "/api/operation":
                row = service.store.db.execute("SELECT actor,action FROM operations WHERE id=?", (q["id"],)).fetchone()
                if row and row["action"].startswith("identity.") and not actor.get("admin") and row["actor"] != actor["id"]:
                    raise Forbidden("This institutional operation belongs to its account administrator.")
                if row and actor.get("role") != "auditor" and row["actor"] != actor["id"]:
                    raise Forbidden("This operation belongs to another operator.")
                result = service.store.operation(q["id"])
                if result is None:
                    raise KeyError("This operation has no retained completed result.")
            elif path == "/api/plans":
                kind = q.get("kind")
                if kind not in {"report_preview", "receiving_preview", "native_preview", "native_comparison", "import_preview"}:
                    raise ValueError("Choose a supported saved workflow.")
                if kind != "report_preview":
                    require_auditor(actor)
                result = {"items": []}
                for record in reversed(service.store.records(kind)):
                    if actor.get("role") != "auditor" and record["payload"].get("created_by") != actor["id"]:
                        continue
                    _, plan = service._owned_plan(kind, record["id"], actor)
                    if kind == "report_preview":
                        plan = {k: plan[k] for k in ("audience", "selected_engagement_ids", "review_reference", "reports")}
                    elif kind == "native_preview":
                        plan = {k: plan[k] for k in ("preview_id", "contract", "manifest")}
                    result["items"].append({"id": record["id"], "created_at": record["created_at"], "plan": plan})
            else:
                return self._send(404, {"error": "This workspace route does not exist."})
            self._send(200, result)
        except Exception as exc:
            self._error(exc)

    def do_POST(self):
        try:
            self._context()
            if self.headers.get("X-Audit-Request") != "1":
                raise Forbidden("Use the workspace application or the documented local API.")
            if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                raise ValueError("Send this operation as JSON.")
            length = int(self.headers.get("Content-Length", "-1"))
            if length < 0 or length > MAX_SOURCE * 4 // 3 + 2 * 1024 * 1024:
                raise ValueError("This request exceeds the complete upload limit.")
            data = self.rfile.read(length)
            if len(data) != length:
                raise ValueError("The original request was incomplete.")
            body = exchange._load_json(data, "workspace request")
            if not isinstance(body, dict):
                raise ValueError("A workspace request must be a JSON object.")
            if identity_http.post(self, body):
                return
            if self.path_only == "/api/login":
                clock = time.monotonic()
                with self.server.login_lock:
                    attempts = [v for v in self.server.login_attempts.get(self.workspace_key, []) if clock - v < 60]
                    if len(attempts) >= 15:
                        return self._send(429, {"error": "Wait one minute before trying this access key again."}, headers={"Retry-After": "60"})
                    attempts.append(clock)
                    self.server.login_attempts[self.workspace_key] = attempts
                opened = self.service.store.open_session(str(body.get("token", "")))
                if not opened:
                    raise PermissionError("This access key is expired, revoked or incorrect.")
                token, actor = opened
                with self.server.login_lock:
                    self.server.login_attempts.pop(self.workspace_key, None)
                return self._send(200, {"actor": actor, "workspace": self.workspace_key},
                    headers={"Set-Cookie": identity_http.session_cookie(self, token)})
            actor = self._session()
            if self.path_only == "/api/logout":
                self.service.store.end_session(self.session_token)
                return self._send(200, {"signed_out": True},
                    headers={"Set-Cookie": identity_http.session_cookie(self, "", maximum=0)})
            if self.path_only == "/api/shutdown":
                if not actor.get("admin"):
                    raise Forbidden("Only the owner can close this host.")
                self._send(200, {"closing": True})
                threading.Thread(target=self.server.shutdown, daemon=True).start()
                return
            if self.path_only != "/api/action":
                return self._send(404, {"error": "This workspace action route does not exist."})
            result = self.service.dispatch(
                actor, body["action"], body.get("inputs", {}), body["operation_id"],
                callback_for=lambda provider: identity_http.callback_url(self, provider))
            if body["action"] == "restore":
                key = self.server.registry.open(result["directory"])
                restored = self.server.registry.get(key)
                token = private_bytes(restored.store.root / "operator.key", 256).decode().strip()
                result = {**result, "access_link": self.request_origin + "/?" + urlencode({"workspace": key}) + "#access=" + token}
            if body["action"] == "create_grant" and result.get("token"):
                result["access_link"] = self.request_origin + "/?" + urlencode({"workspace": self.workspace_key}) + "#access=" + result["token"]
            self._send(200, result)
        except Exception as exc:
            self._error(exc)

    def do_OPTIONS(self):
        self._send(405, {"error": "Cross-origin workspace access is not enabled."})

def serve(root, port=0, ready_file=None, open_browser=False, *, listen="127.0.0.1", public_origin=None, tls_cert=None, tls_key=None):
    from .store import atomic_write
    server = AuditHTTPServer(root, port, listen=listen, public_origin=public_origin, tls_cert=tls_cert, tls_key=tls_key)
    root_service = server.registry.get(server.registry.default_key)
    url = server.origin + "/?" + urlencode({"workspace": server.registry.default_key})
    ready = {"url": url, "origin": server.origin, "pid": os.getpid(), "workspace": server.registry.default_key,
             "workspace_directory": str(root_service.store.root),
             "access_key_file": str(root_service.store.root / "operator.key")}
    if ready_file:
        atomic_write(Path(ready_file), encoded(ready).encode())
    print("Commons Audit Operator is ready at " + url, flush=True)
    print("Access key: " + ready["access_key_file"], flush=True)
    if open_browser:
        import webbrowser
        token = private_bytes(root_service.store.root / "operator.key", 256).decode().strip()
        webbrowser.open(url + "#access=" + token)
    def stop(signum, frame):
        threading.Thread(target=server.shutdown, daemon=True).start()
    for name in ("SIGTERM", "SIGINT"):
        signal.signal(getattr(signal, name), stop)
    try:
        server.serve_forever(poll_interval=0.2)
    finally:
        server.server_close()
