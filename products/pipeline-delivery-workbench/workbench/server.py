"""Loopback staff UI for the original client pipeline Workspace.

The HTTP layer owns selection, local sessions and transport receipts. All project
and native operations are delegated to the one Workspace/Runtime writer.
"""
from __future__ import annotations
import argparse, base64, binascii, contextlib, hmac, io, json, mimetypes, os
import secrets, stat, threading, traceback, zipfile
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from urllib.parse import parse_qs, urlsplit
from common import (FileLease, MAX_ARCHIVE, MAX_FILE, MAX_PROJECT, Problem,
                    durable_write, identifier, packed, project_path, read_json, sha, utc)
from workspace import Workspace, MUTATIONS
import receiving

READS = {
    "workspace.get", "records.list", "project.get", "edition.get", "contract.get",
    "binding.get", "run.get", "comparison.get", "review.get", "release.get",
    "file.read", "edition.diff", "run.log", "run.artifact", "audit.list", "runtime.get", "request.get",
}
STATIC = {"/": "index.html", "/index.html": "index.html",
          "/app.js": "app.js", "/style.css": "style.css"}
MAX_JSON = (MAX_ARCHIVE * 4 // 3) + 2 * 1024 * 1024
COOKIE = "pipeline_staff_session"

def remove_durably(path):
    path = Path(path)
    try: path.unlink()
    except FileNotFoundError: return
    fd = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try: os.fsync(fd)
    finally: os.close(fd)

def within(path, parent):
    try:
        Path(path).resolve().relative_to(Path(parent).resolve())
        return True
    except ValueError: return False

def object_body(value):
    if not isinstance(value, dict):
        raise Problem("invalid_request", "A JSON object is required")
    return value

def source_import(payload):
    """Inspect one source ZIP in memory. No extraction, connection or execution."""
    allowed = {"content_base64", "root"}
    if set(payload) - allowed:
        raise Problem("invalid_import", "Use content_base64 and optional root")
    try: raw = base64.b64decode(payload.get("content_base64", ""), validate=True)
    except (ValueError, binascii.Error, TypeError) as exc:
        raise Problem("invalid_archive", "The source ZIP is not valid base64") from exc
    if len(raw) > MAX_ARCHIVE:
        raise Problem("archive_too_large", "The source ZIP exceeds 512 MiB", 413)
    try: archive = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile as exc:
        raise Problem("invalid_archive", "Select a ZIP containing the original dbt project") from exc
    with archive:
        entries, names, roots = [], set(), []
        for entry in archive.infolist():
            name = entry.filename
            if entry.is_dir(): continue
            if name.startswith("__MACOSX/"): continue
            if ("\x00" in name or "\\" in name or name.startswith("/") or
                    ".." in PurePosixPath(name).parts or str(PurePosixPath(name)) != name):
                raise Problem("unsafe_archive_path", "The source ZIP contains an unsafe relative path")
            if name in names:
                raise Problem("duplicate_archive_path", "The source ZIP repeats a file path", details={"path": name})
            names.add(name)
            mode = entry.external_attr >> 16
            if stat.S_ISLNK(mode) or entry.flag_bits & 1:
                raise Problem("unsupported_archive_entry", "Encrypted files and symlinks cannot be imported")
            if PurePosixPath(name).name == "dbt_project.yml":
                roots.append(str(PurePosixPath(name).parent))
            entries.append(entry)
        requested = payload.get("root")
        if requested is not None and not isinstance(requested, str):
            raise Problem("invalid_root", "The project root must be a relative directory")
        if requested:
            root = requested.rstrip("/")
            if root not in roots:
                raise Problem("project_root_missing", "That directory has no dbt_project.yml", details={"roots": roots})
        elif len(roots) == 1:
            root = roots[0]
        else:
            raise Problem("choose_project_root", "Select the directory containing the intended dbt project",
                          details={"roots": roots})
        prefix = "" if root == "." else root + "/"
        output, skipped, total = [], [], 0
        for entry in entries:
            if not entry.filename.startswith(prefix):
                skipped.append({"path": entry.filename, "reason": "outside_selected_project"})
                continue
            name = entry.filename[len(prefix):]
            try: project_path(name)
            except Problem as exc:
                skipped.append({"path": name, "reason": exc.code})
                continue
            if entry.file_size > MAX_FILE:
                raise Problem("file_too_large", "One source file exceeds 32 MiB", 413, {"path": name})
            total += entry.file_size
            if total > MAX_PROJECT:
                raise Problem("project_too_large", "The source edition exceeds 128 MiB", 413)
            with archive.open(entry) as stream:
                data = stream.read(MAX_FILE + 1)
            if len(data) != entry.file_size or len(data) > MAX_FILE:
                raise Problem("archive_size_changed", "A source ZIP entry differs from its declared size")
            output.append({"path": name, "bytes": len(data), "sha256": sha(data),
                           "content_base64": base64.b64encode(data).decode("ascii")})
        if not any(item["path"] == "dbt_project.yml" for item in output):
            raise Problem("dbt_project_missing", "The source edition must retain dbt_project.yml")
        return {"root": root, "files": sorted(output, key=lambda item: item["path"]),
                "skipped": skipped, "bytes": total, "archive_sha256": sha(raw)}

class Staff:
    def __init__(self, root, *, control=None, source_root=None):
        self.original_root = Path(root).resolve()
        self.source_root = Path(source_root or Path(__file__).parent).resolve()
        self.control = Path(control or self.original_root.parent /
                            ("." + self.original_root.name + "-staff")).resolve()
        self.control.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.lease = FileLease(self.control / "staff.lock")
        self.lock = threading.RLock()
        for name in ("requests", "inputs", "outputs", "received"):
            (self.control / name).mkdir(exist_ok=True, mode=0o700)
        self.selection_path = self.control / "selected.json"
        self.active_path = self.control / "active-request.json"
        self.capability_path = self.control / "capability"
        if not self.capability_path.exists():
            durable_write(self.capability_path, secrets.token_urlsafe(40))
        os.chmod(self.capability_path, 0o600)
        self.capability = self.capability_path.read_text("utf-8").strip()
        if len(self.capability) < 40:
            raise Problem("invalid_session_key", "The local session key is damaged", 409)
        # Cookie sessions deliberately expire when this server process restarts.
        self.session = secrets.token_urlsafe(48)
        self.ws = None
        if self.selection_path.exists():
            selection = read_json(self.selection_path)
            target = self._allowed_root(selection["root"])
            if target != self.original_root:
                receiving.inspect_received(target)
            self.ws = Workspace(target, source_root=self.source_root)
            if self.ws.meta()["workspace_id"] != selection["workspace_id"]:
                self.ws.close()
                raise Problem("selected_workspace_changed", "The selected writer has another identity", 409)
            self.selection = selection
        else:
            self.ws = Workspace(self.original_root, source_root=self.source_root)
            self.selection = {"root": str(self.ws.root), "receiving_id": "original",
                              "workspace_id": self.ws.meta()["workspace_id"]}
            durable_write(self.selection_path, packed(self.selection))
        if self.active_path.exists():
            active = read_json(self.active_path)
            saved = self._request_path(active["request_id"])
            if saved.exists() and read_json(saved).get("state") == "completed":
                remove_durably(self.active_path)

    def _allowed_root(self, root):
        root = Path(root).resolve()
        if root != self.original_root and not within(root, self.control / "received"):
            raise Problem("invalid_received_root", "The writer must belong to this receiving catalogue", 409)
        return root

    def close(self):
        with self.lock:
            if self.ws is not None:
                self.ws.close()
                self.ws = None
            self.lease.close()

    def snapshot(self):
        with self.lock:
            return {**self.ws.snapshot(), "selection": self.selection,
                    "pending_request": self.pending_summary()}

    def pending_summary(self):
        if not self.active_path.exists(): return None
        active = read_json(self.active_path)
        path = self._request_path(active["request_id"])
        if not path.exists():
            return {"request_id": active["request_id"], "state": "prepared", "endpoint": None,
                    "action": None, "workspace_id": self.ws.meta()["workspace_id"], "created_at": None}
        row = read_json(path)
        return {"request_id": row["request_id"], "endpoint": row["endpoint"],
                "action": row["body"].get("action"), "workspace_id": row["body"]["workspace_id"],
                "created_at": row["created_at"], "state": row["state"]}

    def pending_document(self):
        """Return the original active transport body to an authenticated operator."""
        with self.lock:
            if not self.active_path.exists(): return None
            active = read_json(self.active_path)
            path = self._request_path(active["request_id"])
            if not path.exists():
                raise Problem("original_body_required", "Resume the retained original request from its originating browser",
                              409, {"request_id": active["request_id"]})
            row = read_json(path)
            return {"request_id": row["request_id"], "endpoint": row["endpoint"],
                    "body": row["body"], "created_at": row["created_at"], "digest": row["digest"]}

    def read(self, action, payload):
        if action not in READS:
            raise Problem("read_action_required", "Select a documented read action")
        with self.lock:
            return {**self.ws.invoke(action, object_body(payload)), "selection": dict(self.selection)}

    def _request_path(self, request_id):
        identifier(request_id, "request_id")
        return self.control / "requests" / (sha(request_id) + ".json")

    def _check_selection(self, body):
        selected = body.get("selection")
        if not isinstance(selected, dict) or set(selected) != {"root", "receiving_id", "workspace_id"}:
            raise Problem("selection_required", "Use the current snapshot selection for a new request", 409)
        if selected != self.selection:
            raise Problem("writer_changed", "The selected writer changed; retain this draft and reload", 409,
                          {"selection": dict(self.selection), **self.ws.meta()})

    def _check_identity(self, body):
        if "selection" in body:
            self._check_selection(body)
        meta = self.ws.meta()
        if body["workspace_id"] != meta["workspace_id"]:
            raise Problem("workspace_changed", "The selected workspace changed; keep the draft and reload", 409, meta)
        if type(body["expected_revision"]) is not int or body["expected_revision"] != meta["revision"]:
            raise Problem("revision_changed", "The workspace changed; review the saved state before applying the draft",
                          409, meta)

    def _stage(self, row, **changes):
        row.update(changes)
        durable_write(self._request_path(row["request_id"]), packed(row), replace=True)

    def retained(self, endpoint, body):
        """Resolve the original transport result before any current-writer check."""
        object_body(body)
        fields = {
            "/api/invoke": {"action", "payload", "workspace_id", "expected_revision", "request_id"},
            "/api/receive": {"content_base64", "workspace_id", "expected_revision", "request_id"},
            "/api/open": {"receiving_id", "workspace_id", "expected_revision", "request_id"},
        }[endpoint]
        if set(body) not in (fields, fields | {"selection"}):
            raise Problem("invalid_envelope", "Use all documented request fields",
                          details={"fields": sorted(fields | {"selection"})})
        identifier(body["request_id"], "request_id")
        if not isinstance(body["workspace_id"], str) or type(body["expected_revision"]) is not int:
            raise Problem("invalid_identity", "workspace_id and integer expected_revision are required")
        if endpoint == "/api/invoke":
            if body["action"] not in MUTATIONS or not isinstance(body["payload"], dict):
                raise Problem("mutation_required", "Use a documented mutation and an object payload")
        digest = sha(packed({"endpoint": endpoint, "body": body}))
        path = self._request_path(body["request_id"])
        with self.lock:
            if path.exists():
                row = read_json(path)
                if row["digest"] != digest:
                    raise Problem("request_conflict", "This request ID already names different work", 409)
                if row["state"] == "completed":
                    return row["status"], row["response"]
            else:
                active = None
                if self.active_path.exists():
                    active = read_json(self.active_path)
                    if active["request_id"] != body["request_id"]:
                        raise Problem("original_request_pending", "Resolve the retained original request before another write",
                                      409, self.pending_summary())
                    if active["digest"] != digest:
                        raise Problem("request_conflict", "The pending request ID already names different work", 409)
                # A completed/retained body is resolved above unchanged. Only a
                # first admission must name the exact originating writer.
                if "selection" in body:
                    self._check_selection(body)
                elif active is None:
                    raise Problem("selection_required", "Refresh and retain snapshot.selection in a new request", 409)
                row = {"schema": "tjlabs.pipeline-staff-request/v1", "request_id": body["request_id"],
                       "endpoint": endpoint, "digest": digest, "body": body, "created_at": utc(),
                       "source_root": str(self.ws.root), "state": "prepared", "stage": {}}
                durable_write(self.active_path, packed({"request_id": row["request_id"], "digest": digest}))
                durable_write(path, packed(row))
            try:
                if endpoint == "/api/invoke":
                    if str(self.ws.root) != row["source_root"]:
                        raise Problem("original_writer_required", "Resolve this request against its original writer", 409)
                    response = self.ws.invoke(body["action"], body["payload"],
                                              workspace_id=body["workspace_id"],
                                              expected_revision=body["expected_revision"], request_id=body["request_id"])
                else:
                    response = self._receive_or_open(row)
                status = 200
            except Problem as exc:
                # Documented validation/revision conflicts are definite results.
                # Unexpected transport, disk or runtime exceptions leave this original request pending.
                status, response = exc.status, {"error": exc.as_dict(), "request_id": row["request_id"]}
            except BaseException:
                raise
            self._stage(row, state="completed", status=status, response=response, completed_at=utc())
            if self.active_path.exists() and read_json(self.active_path)["request_id"] == row["request_id"]:
                remove_durably(self.active_path)
            return status, response

    def _receive_or_open(self, row):
        body, stage = row["body"], row["stage"]
        if not stage.get("validated"):
            with self.ws.runtime().idle_guard():
                self._check_identity(body)
                stage["validated"] = True
                self._stage(row, stage=stage)
        if row["endpoint"] == "/api/receive":
            if not stage.get("archive"):
                try: raw = base64.b64decode(body["content_base64"], validate=True)
                except (ValueError, TypeError, binascii.Error) as exc:
                    raise Problem("invalid_archive", "The receiving archive is not valid base64") from exc
                if len(raw) > MAX_ARCHIVE:
                    raise Problem("archive_too_large", "The receiving archive exceeds 512 MiB", 413)
                archive = self.control / "inputs" / (sha(raw) + ".zip")
                durable_write(archive, raw)
                inspection = receiving.inspect_archive(archive)
                rid = identifier(inspection["receiving_id"], "receiving_id")
                stage.update(archive=str(archive), inspection=inspection,
                             receiving_id=rid, target_root=str(self.control / "received" / rid))
                self._stage(row, stage=stage)
            if not stage.get("received"):
                result = receiving.receive_workspace(stage["archive"], stage["target_root"],
                                                       source_root=self.source_root)
                stage["received"] = result
                self._stage(row, stage=stage)
        else:
            if not stage.get("target_root"):
                rid = identifier(body["receiving_id"], "receiving_id")
                target = self.original_root if rid == "original" else self.control / "received" / rid
                if target != self.original_root:
                    result = receiving.inspect_received(target)
                    if result.get("receiving_id") not in {None, rid}:
                        raise Problem("receiving_changed", "The selected receipt has another identity", 409)
                stage.update(receiving_id=rid, target_root=str(target))
                self._stage(row, stage=stage)
        target = self._allowed_root(stage["target_root"])
        if self.ws.root != target:
            # One existing Runtime transition lock guards admission, native lease and writer detachment.
            with self.ws.runtime().idle_guard():
                original = self.ws.root
                self.ws.close()
                try:
                    current = Workspace(target, source_root=self.source_root)
                    selection = {"root": str(current.root), "receiving_id": stage["receiving_id"],
                                 "workspace_id": current.meta()["workspace_id"]}
                    try: durable_write(self.selection_path, packed(selection), replace=True)
                    except BaseException:
                        current.close()
                        raise
                    self.ws, self.selection = current, selection
                except BaseException:
                    self.ws = Workspace(original, source_root=self.source_root)
                    raise
        result = {"selection": self.selection, "snapshot": self.ws.snapshot(),
                  "receiving": stage.get("received"), "inspection": stage.get("inspection")}
        return {"action": "workspace.receive" if row["endpoint"] == "/api/receive" else "workspace.open",
                "request_id": row["request_id"], **self.ws.meta(), "result": result}

    def catalog(self):
        with self.lock:
            return {"items": receiving.received_catalog(self.control / "received"),
                    "selected": self.selection, "original": {"receiving_id": "original",
                                                            "root": str(self.original_root)}}

    def archive(self, release_id=None, request_id=None):
        with self.lock:
            if request_id is not None: identifier(request_id, "request_id")
            if release_id is None:
                return receiving.create_backup(self.ws, self.control / "outputs", request_id=request_id)
            return receiving.create_release_archive(self.ws, identifier(release_id, "release_id"),
                                                      self.control / "outputs", request_id=request_id)

class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    def __init__(self, address, app):
        self.app = app
        super().__init__(address, Handler)
        host, port = self.server_address[:2]
        self.authorities = {"127.0.0.1:" + str(port), "localhost:" + str(port)}
        self.origin = "http://127.0.0.1:" + str(port)

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "PipelineStaff/1"
    sys_version = ""

    def log_message(self, fmt, *args):
        # Paths contain no session capability. Do not log query payloads, project files or credential references.
        print("staff", self.command, urlsplit(self.path).path, flush=True)

    def _headers(self, status, kind, size, *, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(size))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Content-Security-Policy",
                         "default-src 'none'; script-src 'self'; style-src 'self'; "
                         "connect-src 'self'; img-src 'self' blob:; object-src 'none'; "
                         "base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
        for key, value in (extra or {}).items(): self.send_header(key, str(value))
        self.end_headers()

    def _json(self, status, value, extra=None):
        raw = packed(value).encode("utf-8")
        self._headers(status, "application/json; charset=utf-8", len(raw), extra=extra)
        self.wfile.write(raw)

    def _host(self):
        if self.headers.get("Host", "").lower() not in self.server.authorities:
            raise Problem("host_denied", "Use the local URL printed by this server", 403)

    def _origin(self):
        self._host()
        origin = self.headers.get("Origin")
        if origin:
            if origin != "http://" + self.headers.get("Host", "").lower():
                raise Problem("origin_denied", "The request must come from this local workspace", 403)
        elif self.headers.get("Sec-Fetch-Site") not in {None, "same-origin", "none"}:
            raise Problem("origin_denied", "The request must come from this local workspace", 403)
        elif self.headers.get("Authorization", "").startswith("Bearer "):
            return
        else:
            raise Problem("origin_required", "Browser writes require this workspace's Origin", 403)

    def _authenticated(self):
        token = self.headers.get("Authorization", "")
        if token.startswith("Bearer ") and hmac.compare_digest(token[7:], self.server.app.capability):
            return
        cookies = SimpleCookie()
        try: cookies.load(self.headers.get("Cookie", ""))
        except Exception: pass
        value = cookies[COOKIE].value if COOKIE in cookies else ""
        if not hmac.compare_digest(value, self.server.app.session):
            raise Problem("session_required", "Open the local session link printed by the server", 401)

    def _body(self):
        if self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
            raise Problem("json_required", "Send application/json", 415)
        if self.headers.get("Transfer-Encoding"):
            raise Problem("length_required", "Use one complete JSON body with Content-Length", 411)
        try: length = int(self.headers.get("Content-Length", "-1"))
        except ValueError: length = -1
        if length < 0: raise Problem("length_required", "Content-Length is required", 411)
        if length > MAX_JSON: raise Problem("request_too_large", "The request exceeds the archive limit", 413)
        self.connection.settimeout(120)
        raw = self.rfile.read(length)
        if len(raw) != length: raise Problem("body_incomplete", "The original request body is incomplete")
        try:
            return object_body(json.loads(raw.decode("utf-8"),
                parse_constant=lambda value: (_ for _ in ()).throw(ValueError("Nonfinite JSON"))))
        except (ValueError, UnicodeError) as exc:
            raise Problem("invalid_json", "The request must contain valid finite JSON") from exc

    def _dispatch(self):
        self._host()
        parsed = urlsplit(self.path)
        path, query = parsed.path, parse_qs(parsed.query)
        app = self.server.app
        if self.command == "GET":
            if path in STATIC:
                file = app.source_root / STATIC[path]
                raw = file.read_bytes()
                kind = {"index.html": "text/html; charset=utf-8", "app.js": "text/javascript; charset=utf-8",
                        "style.css": "text/css; charset=utf-8"}[file.name]
                self._headers(200, kind, len(raw)); self.wfile.write(raw); return
            self._authenticated()
            if path == "/api/state": return self._json(200, app.snapshot())
            if path == "/api/pending": return self._json(200, app.pending_document())
            if path == "/api/read":
                try: payload = json.loads(query.get("payload", ["{}"])[0])
                except ValueError as exc: raise Problem("invalid_payload", "payload must be JSON") from exc
                return self._json(200, app.read(query.get("action", [""])[0], payload))
            if path == "/api/received": return self._json(200, app.catalog())
            if path == "/api/backup" or (path.startswith("/api/releases/") and path.endswith("/download")):
                release_id = path[len("/api/releases/"):-len("/download")] if path != "/api/backup" else None
                result = app.archive(release_id, query.get("request_id", [None])[0])
                archive = Path(result["path"])
                if not within(archive, app.control / "outputs"):
                    raise Problem("archive_path_changed", "The generated archive is outside its retained output directory", 409)
                # Check the closed archive before sending and stream from this same open descriptor.
                import hashlib
                with archive.open("rb") as stream:
                    digest, count = hashlib.sha256(), 0
                    while True:
                        chunk = stream.read(1024 * 1024)
                        if not chunk: break
                        digest.update(chunk); count += len(chunk)
                    if count != result["bytes"] or digest.hexdigest() != result["sha256"]:
                        raise Problem("archive_changed", "The retained archive identity changed", 409)
                    stream.seek(0)
                    self._headers(200, "application/zip", count, extra={
                        "Content-Disposition": 'attachment; filename="' + archive.name.replace('"', "") + '"',
                        "X-Archive-Sha256": result["sha256"], "X-Workspace-Id": result["workspace_id"],
                        "X-Workspace-Revision": result["revision"], "X-Receiving-Id": result["receiving_id"]})
                    while True:
                        chunk = stream.read(1024 * 1024)
                        if not chunk: break
                        self.wfile.write(chunk)
                return
            raise Problem("route_missing", "This endpoint does not exist", 404)
        if self.command == "POST":
            self._origin()
            if path != "/api/session": self._authenticated()
            body = self._body()
            if path == "/api/session":
                supplied = body.get("capability", "")
                if not isinstance(supplied, str) or not hmac.compare_digest(supplied, app.capability):
                    raise Problem("session_denied", "The local session link is invalid", 403)
                return self._json(200, {"authenticated": True},
                                  {"Set-Cookie": COOKIE + "=" + app.session + "; HttpOnly; SameSite=Strict; Path=/"})
            self._authenticated()
            if path in {"/api/invoke", "/api/receive", "/api/open"}:
                status, response = app.retained(path, body)
                return self._json(status, response)
            if path == "/api/import/source":
                return self._json(200, source_import(body))
            raise Problem("route_missing", "This endpoint does not exist", 404)
        raise Problem("method_not_allowed", "Use GET or POST", 405)

    def _handle(self):
        try: self._dispatch()
        except (BrokenPipeError, ConnectionResetError): pass
        except Problem as exc:
            try: self._json(exc.status, {"error": exc.as_dict()})
            except (BrokenPipeError, ConnectionResetError): pass
        except Exception:
            traceback.print_exc()
            try:
                self._json(500, {"error": {"code": "original_request_unresolved",
                           "message": "The original operation has no completed transport response. Resume that same request.",
                           "details": None}, "outcome_unknown": True})
            except (BrokenPipeError, ConnectionResetError): pass

    do_GET = _handle
    do_POST = _handle
    do_PUT = _handle
    do_DELETE = _handle
    do_PATCH = _handle

def serve(root, *, host="127.0.0.1", port=8794, control=None, source_root=None):
    if host not in {"127.0.0.1", "localhost"}:
        raise Problem("loopback_required", "Run this staff workspace on 127.0.0.1 or localhost")
    app = Staff(root, control=control, source_root=source_root)
    server = Server((host, int(port)), app)
    print("Staff workspace: " + server.origin + "/#capability=" + app.capability, flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally:
        server.server_close()
        app.close()

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", help="Original persistent client workspace directory")
    parser.add_argument("--control", help="Persistent staff sessions, receiving catalogue and transport requests")
    parser.add_argument("--host", choices=("127.0.0.1", "localhost"), default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8794)
    args = parser.parse_args(argv)
    serve(args.root, control=args.control, host=args.host, port=args.port)

if __name__ == "__main__":
    main()
