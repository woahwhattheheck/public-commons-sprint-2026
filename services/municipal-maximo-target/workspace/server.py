"""Authenticated loopback HTTP boundary for the persistent municipal workspace."""
from __future__ import annotations

import hashlib
import hmac
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import secrets
import sqlite3
import threading
import time
from urllib.parse import parse_qs, urlsplit

from .adapters import InvalidData
from .engine import Conflict, Workspace
from . import maximo_target, maximo_load
from .public_refresh import RefreshWorkers, prepare, list_jobs, job_root, read_job, summary, output_body, OUTPUT_NAMES

STATIC = Path(__file__).parent / "ui"
COOKIE = "mcpherson_workspace"


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, workspace: Workspace, password):
        if address[0] not in ("127.0.0.1", "localhost"):
            raise InvalidData("This distribution serves a private loopback operator session")
        if not isinstance(password, str) or len(password) < 16:
            raise InvalidData("Use the generated private operator password")
        self.workspace = workspace
        self.refresh_workers = RefreshWorkers(workspace)
        self.maximo_workers = maximo_target.Workers(workspace)
        self.password_hash = hashlib.sha256(password.encode()).digest()
        self.sessions = {}
        self.session_lock = threading.Lock()
        self.failed_logins = []
        super().__init__(address, Handler)

    def server_close(self):
        self.refresh_workers.close()
        self.maximo_workers.close()
        super().server_close()

    @property
    def origin(self):
        return "http://127.0.0.1:" + str(self.server_port)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format, *args):
        # No uploaded record, password, cookie, or request body is logged.
        pass

    def reply(self, status, value, media="application/json; charset=utf-8", filename=None, cookie=None):
        body = value if isinstance(value, bytes) else (json.dumps(value, ensure_ascii=False, allow_nan=False) + "\n").encode()
        self.send_response(status)
        self.send_header("Content-Type", media)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        if filename:
            self.send_header("Content-Disposition", 'attachment; filename="' + filename + '"')
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def read_body(self, maximum=1024 * 1024):
        length = self.headers.get("Content-Length", "")
        if not length.isdigit() or not 0 < int(length) <= maximum or self.headers.get("Transfer-Encoding"):
            self.close_connection = True
            raise InvalidData("Provide a complete bounded request body")
        self.connection.settimeout(30)
        body = self.rfile.read(int(length))
        if len(body) != int(length):
            raise InvalidData("The upload ended before its declared length")
        return body

    def json_body(self, maximum=1024 * 1024):
        if self.headers.get_content_type() != "application/json":
            raise InvalidData("Expected a JSON object")
        try:
            value = json.loads(self.read_body(maximum))
        except (UnicodeError, json.JSONDecodeError) as error:
            raise InvalidData("Request body is not valid UTF-8 JSON") from error
        if not isinstance(value, dict):
            raise InvalidData("Expected a JSON object")
        return value

    def session(self):
        jar = SimpleCookie()
        try:
            jar.load(self.headers.get("Cookie", ""))
        except Exception:
            return None
        key = jar.get(COOKIE)
        if not key:
            return None
        with self.server.session_lock:
            record = self.server.sessions.get(key.value)
            if record and record["expires_at"] > time.time():
                return {**record, "key": key.value}
            self.server.sessions.pop(key.value, None)
        return None

    def boundary(self, write=False):
        accepted = {"127.0.0.1:" + str(self.server.server_port), "localhost:" + str(self.server.server_port)}
        if self.headers.get("Host") not in accepted:
            raise PermissionError("Open the displayed local workspace address")
        origin = self.headers.get("Origin")
        if origin and origin not in {"http://" + value for value in accepted}:
            raise PermissionError("Open actions from the local workspace page")
        record = self.session()
        if not record:
            self.reply(401, {"error": "Sign in to the local workspace"})
            return None
        if write and not hmac.compare_digest(self.headers.get("X-Workspace-CSRF", ""), record["csrf"]):
            raise PermissionError("Refresh the signed-in workspace page before editing")
        return record

    def handle_route(self, write=False):
        try:
            self.route(write)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Conflict as error:
            self.reply(409, {"error": str(error), "refresh": True})
        except (InvalidData, ValueError, TypeError) as error:
            self.reply(400, {"error": str(error)})
        except KeyError:
            self.reply(404, {"error": "This project, record or action was not found"})
        except PermissionError as error:
            self.reply(403, {"error": str(error)})
        except sqlite3.OperationalError:
            self.reply(503, {"error": "The workspace is busy. Retry this same operation after a moment"})

    def do_GET(self):
        self.handle_route()

    def do_POST(self):
        self.handle_route(True)

    def route(self, write):
        url = urlsplit(self.path)
        parts = url.path.strip("/").split("/")
        query = {key: values[-1] for key, values in parse_qs(url.query, keep_blank_values=True).items()}
        if not write and url.path in ("/", "/app.js", "/app.css"):
            filename, media = {"/": ("index.html", "text/html; charset=utf-8"),
                "/app.js": ("app.js", "text/javascript; charset=utf-8"),
                "/app.css": ("app.css", "text/css; charset=utf-8")}[url.path]
            return self.reply(200, (STATIC / filename).read_bytes(), media)
        if not write and url.path == "/health":
            return self.reply(200, {"status": "ready", "service": "municipal-asset-workspace"})
        if write and url.path == "/api/login":
            allowed = {self.server.origin, "http://localhost:" + str(self.server.server_port)}
            if self.headers.get("Origin") not in allowed or "http://" + self.headers.get("Host", "") not in allowed:
                raise PermissionError("Sign in using the displayed local workspace page")
            value, now = self.json_body(), time.time()
            actor, password = value.get("actor"), value.get("password")
            if not isinstance(actor, str) or not 1 <= len(actor.strip()) <= 150 or not isinstance(password, str):
                raise InvalidData("Enter your operator name and local password")
            with self.server.session_lock:
                self.server.failed_logins = [stamp for stamp in self.server.failed_logins if now - stamp < 60]
                if len(self.server.failed_logins) >= 12:
                    return self.reply(429, {"error": "Wait one minute before another password attempt"})
                if not hmac.compare_digest(hashlib.sha256(password.encode()).digest(), self.server.password_hash):
                    self.server.failed_logins.append(now)
                    return self.reply(401, {"error": "The local password did not match"})
                key = secrets.token_urlsafe(32)
                record = {"actor": actor.strip(), "csrf": secrets.token_urlsafe(32), "expires_at": now + 8 * 3600}
                self.server.sessions = {key: value for key, value in self.server.sessions.items() if value["expires_at"] > now}
                self.server.sessions[key] = record
            return self.reply(200, {"actor": record["actor"], "csrf": record["csrf"]},
                cookie=f"{COOKIE}={key}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800")
        session = self.boundary(write)
        if not session:
            return
        workspace = self.server.workspace
        if not write and url.path == "/api/session":
            return self.reply(200, {"actor": session["actor"], "csrf": session["csrf"]})
        if write and url.path == "/api/logout":
            self.read_body()
            with self.server.session_lock:
                self.server.sessions.pop(session["key"], None)
            return self.reply(200, {"signed_out": True}, cookie=f"{COOKIE}=; Max-Age=0; HttpOnly; SameSite=Strict; Path=/")
        if url.path == "/api/projects":
            if not write:
                return self.reply(200, {"projects": workspace.projects()})
            value = self.json_body()
            return self.reply(201, workspace.create_project(value.get("title"), value.get("mode"), session["actor"], value.get("operation")))
        if not write and url.path == "/api/backup":
            return self.reply(200, workspace.backup(), "application/zip", "municipal-workspace-backup.zip")
        if len(parts) < 3 or parts[:2] != ["api", "projects"]:
            raise KeyError(url.path)
        project_id = parts[2]
        if len(parts) == 3 and not write:
            return self.reply(200, workspace.view(project_id))
        endpoint = parts[3] if len(parts) == 4 else ""
        if endpoint == "maximo":
            workspace.project(project_id)
            if not write:
                return self.reply(200, {"profiles": maximo_target.profiles(workspace),
                    "captures": maximo_target.jobs(workspace, project_id),
                    "loads": maximo_load.list_loads(workspace, project_id)})
            value = self.json_body(16 * 1024 * 1024)
            action = value.get("action")
            operation = value.get("operation")
            if action == "start":
                maximo_target.prepare(workspace, project_id, session["actor"], operation,
                                      value.get("revision"), value.get("profile_id"))
                self.server.maximo_workers.start(operation)
                return self.reply(202, maximo_target.summary(maximo_target.load_job(workspace, operation)))
            if action == "resume":
                job = maximo_target.load_job(workspace, operation)
                if job["project_id"] != project_id or job["binding"]["actor"] != session["actor"]:
                    raise InvalidData("Continue this target read as its original operator in its original project")
                self.server.maximo_workers.start(operation)
                return self.reply(202, maximo_target.summary(maximo_target.load_job(workspace, operation)))
            if action == "receive":
                result = maximo_target.receive(workspace, project_id, value.get("capture_operation"),
                    value.get("revision"), session["actor"], operation)
                return self.reply(200, result)
            if action == "prepare-load":
                result = maximo_load.prepare(workspace, project_id, value.get("revision"),
                    session["actor"], operation, value.get("capture_operation"), value.get("mapping"))
                return self.reply(200, {"id": result["id"], "rows": len(result["rows"]), "body_sha256": result["body_sha256"]})
            if action == "receive-load":
                result = maximo_load.receive(workspace, project_id, value.get("load_id"), operation,
                                            session["actor"], value.get("returned"))
                # Preserve exact original numeric payloads in the source download.
                return self.reply(200, {"load_id": result["load_id"], "receive_id": result["receive_id"],
                                       "rows": len(result["rows"]), "findings": result["findings"]})
            raise InvalidData("Choose a supported original Maximo operation")
        if endpoint == "maximo-file" and not write:
            kind = query.get("kind")
            if kind == "capture":
                job = maximo_target.load_job(workspace, query.get("operation"))
                if job["project_id"] != project_id or job["state"] not in ("READY", "RECEIVED"):
                    raise InvalidData("Download this project's complete target capture")
                return self.reply(200, maximo_target.carrier(workspace, job), "application/json", "Maximo-Complete-Target.json")
            if kind == "load":
                saved = maximo_load.load(workspace, query.get("operation"))
                if saved["request"]["project_id"] != project_id: raise InvalidData("Select the original project's load")
                return self.reply(200, maximo_target.wire(saved, maximum=16*1024*1024), "application/json", "Maximo-Prepared-Load.json")
            raise InvalidData("Select the complete capture or prepared load")
        if endpoint == "refresh":
            workspace.project(project_id)
            if not write:
                return self.reply(200, {"refreshes": list_jobs(workspace, project_id)})
            value = self.json_body()
            operation = value.get("operation")
            if value.get("action") == "resume":
                selected = read_job(job_root(workspace, operation))
                if selected["binding"]["project_id"] != project_id:
                    raise InvalidData("Continue the refresh in its original project")
                if selected["binding"]["actor"] != session["actor"]:
                    raise InvalidData("Sign in as the original refresh operator to continue this request")
            elif value.get("action") == "start":
                prepare(workspace, project_id, session["actor"], operation, value.get("revision"),
                        value.get("page_width", 500), value.get("geometry_width", 100), value.get("source_operation"))
            else:
                raise InvalidData("Choose a new refresh or resume its original saved operation")
            self.server.refresh_workers.start(operation)
            root = job_root(workspace, operation)
            return self.reply(202, summary(root, read_job(root)))
        if not write and endpoint == "refresh-file":
            root = job_root(workspace, query.get("operation"))
            selected = read_job(root)
            if selected["binding"]["project_id"] != project_id:
                raise InvalidData("Download this original project's refresh output")
            name = query.get("name")
            if name not in OUTPUT_NAMES or name not in selected["outputs"]:
                raise KeyError(name)
            media = ("application/zip" if OUTPUT_NAMES[name].endswith(".zip")
                     else "text/html; charset=utf-8" if name == "report"
                     else "application/geo+json" if name == "geometry" else "application/json")
            return self.reply(200, output_body(root, selected["outputs"][name]), media, OUTPUT_NAMES[name])
        if not write and endpoint == "records":
            return self.reply(200, workspace.records(project_id, query.get("kind"), query.get("query", ""),
                int(query.get("page", "0")), int(query.get("page_size", "50")), query.get("record_id")))
        if not write and endpoint == "report":
            return self.reply(200, workspace.report(project_id), "text/html; charset=utf-8", "municipal-asset-handoff.html")
        if not write and endpoint == "export":
            return self.reply(200, workspace.export(project_id, query.get("release") or None), "application/zip", "mcpherson-handoff-" + project_id + ".zip")
        if write and endpoint == "inputs":
            body = self.read_body(32 * 1024 * 1024)
            return self.reply(201, workspace.import_data(project_id, int(self.headers.get("X-Revision", "-1")), session["actor"],
                self.headers.get("X-Operation-Id"), query.get("kind"), query.get("filename", ""), query.get("format"), body))
        if write and endpoint == "action":
            value = self.json_body()
            common = {"project_id": project_id, "expected_revision": value.get("revision"), "actor": session["actor"], "operation": value.get("operation")}
            payload = value.get("payload", {})
            if not isinstance(payload, dict):
                raise InvalidData("Action fields must be a JSON object")
            actions = {"mapping": workspace.save_mapping, "select_input": workspace.select_input,
                "settings": workspace.save_settings, "review": workspace.review, "exclude": workspace.exclude,
                "repair": workspace.propose_repair, "request_status": workspace.request_status,
                "apply_returns": workspace.apply_returns, "withdraw_change": workspace.withdraw_change,
                "native_check": workspace.native_check, "release": workspace.release, "restore_revision": workspace.restore_revision}
            if value.get("action") not in actions or any(key in common for key in payload):
                raise InvalidData("Unknown project action")
            return self.reply(200, actions[value["action"]](**common, **payload))
        raise KeyError(url.path)
