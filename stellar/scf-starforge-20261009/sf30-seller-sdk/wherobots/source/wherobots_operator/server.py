"""Loopback operator UI over the same durable workspace used by the CLI."""
from __future__ import annotations

import contextlib
from concurrent.futures import ThreadPoolExecutor
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
from pathlib import Path
import secrets
import threading
import traceback
from urllib.parse import parse_qs, unquote, urlsplit
import uuid

from .storage import Workspace, OperationError, canonical, digest, identifier, now, private_directory
from . import workflow

WEB = Path(__file__).resolve().parent / "web"


class Operator:
    def __init__(self, workspace, provider_factory=None):
        self.workspace = workspace
        if provider_factory is None:
            from .native import NativeProvider
            provider_factory = NativeProvider
        self.provider_factory = provider_factory
        self.pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="wherobots-operator")
        self.futures = {}
        self.mutex = threading.Lock()
        for task in workspace.records("task"):
            if task["state"] in {"QUEUED", "RUNNING"}:
                workspace.save_record("task", task["id"], {**task, "state": "INTERRUPTED",
                    "updated_at": now(), "message": "Reopen the original operation and resume its retained state."},
                    task["revision_sha256"])

    def close(self):
        self.pool.shutdown(wait=True)

    def start(self, action, arguments, request_id=None):
        request_id = identifier(request_id or uuid.uuid4().hex, "request ID")
        request_digest = digest({"action": action, "arguments": arguments})
        with self.mutex:
            try:
                existing = self.workspace.get_record("task", request_id)
            except OperationError as error:
                if error.status != 404:
                    raise
            else:
                if existing["request_sha256"] != request_digest:
                    raise OperationError("REQUEST_REUSED", "This request ID already belongs to another action.", status=409)
                return existing
            task = self.workspace.save_record("task", request_id, {
                "id": request_id, "action": action, "arguments": arguments,
                "workflow_id": arguments.get("workflow_id"), "operation_id": arguments.get("operation_id"),
                "request_sha256": request_digest, "state": "QUEUED", "created_at": now(), "updated_at": now()})
            self.futures[request_id] = self.pool.submit(self._run, task)
            return task

    def _run(self, task):
        workspace = self.workspace
        task = workspace.save_record("task", task["id"], {**task, "state": "RUNNING", "updated_at": now()},
                                     task["revision_sha256"])
        try:
            args, action = task["arguments"], task["action"]
            if action in {"submit", "recover", "refresh", "cancel", "capture"}:
                provider = self.provider_factory()
                operation_id = args["operation_id"]
                if action == "recover":
                    result = workflow.recover(workspace, operation_id, provider, args.get("native_run_id"))
                elif action == "refresh":
                    result = workflow.refresh(workspace, operation_id, provider, args.get("include_logs", False))
                elif action == "capture":
                    result = workflow.capture_outputs(workspace, operation_id, provider)
                else:
                    result = getattr(workflow, action)(workspace, operation_id, provider)
            elif action == "compare":
                from .editions import compare_editions
                result = compare_editions(workspace, args["left_id"], args["right_id"])
            elif action == "export":
                from .portable import export_handover
                directory = private_directory(workspace.directory / "exports", create=True)
                path = directory / (task["id"] + ".zip")
                receipt = export_handover(workspace, args["workflow_id"], path)
                result = {"export_id": task["id"], "filename": args["workflow_id"] + "-wherobots.zip",
                          "bytes": path.stat().st_size, "receipt": receipt}
            elif action == "import":
                from .portable import import_handover
                result = import_handover(workspace, workspace.object_path(args["object"]["sha256"]))
            else:
                raise OperationError("UNKNOWN_ACTION", "Select a documented operator action.")
            workspace.save_record("task", task["id"], {**task, "state": "COMPLETE", "updated_at": now(), "result": result},
                                  task["revision_sha256"])
        except BaseException as error:
            from .native import NativeProvider
            workspace.save_record("task", task["id"], {**task, "state": "FAILED", "updated_at": now(),
                "error": NativeProvider.error(error)}, task["revision_sha256"])

    def state(self):
        workspace = self.workspace
        def summary(record, keys):
            return {key: record.get(key) for key in keys}
        workflows = [{"id": x["id"], "title": x["definition"]["title"],
                      "revision_sha256": x["revision_sha256"], "updated_at": x["updated_at"]}
                     for x in workspace.records("workflow")]
        operations = [summary(x, ("id", "workflow_id", "state", "native_run_id", "native_status",
            "created_at", "updated_at", "output_editions", "latest_cost", "revision_sha256"))
            for x in workspace.records("operation")]
        editions = [summary(x, ("id", "workflow_id", "operation_id", "native_run_id", "created_at",
            "revision_sha256")) for x in workspace.records("edition")]
        tasks = [summary(x, ("id", "action", "state", "workflow_id", "operation_id", "created_at", "updated_at", "error"))
                 for x in workspace.records("task")]
        return {"workspace_id": workspace.workspace_id, "title": workspace.title,
                "workflows": workflows, "operations": operations, "editions": editions,
                "tasks": sorted(tasks, key=lambda x: x["created_at"], reverse=True)[:100]}


def _serve_locked(workspace, host="127.0.0.1", port=0, provider_factory=None, on_ready=None):
    if host not in {"127.0.0.1", "localhost"}:
        raise OperationError("LOOPBACK_HOST", "Open this private operator on 127.0.0.1 or localhost.")
    token = secrets.token_urlsafe(32)
    operator = Operator(workspace, provider_factory)
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "WherobotsOperator/1.0"
        def log_message(self, *_):
            pass

        def _send(self, code, data, content_type="application/json; charset=utf-8", headers=None):
            payload = canonical(data) if content_type.startswith("application/json") else data
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
            for key, value in (headers or {}).items():
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(payload)

        def _authenticated(self, mutation=False):
            authority = f"{host}:{self.server.server_address[1]}"
            if self.headers.get("Host") != authority:
                raise OperationError("HOST_MISMATCH", "Open the original local operator address.", status=403)
            origin = self.headers.get("Origin")
            if origin is not None and origin != "http://" + authority:
                raise OperationError("ORIGIN_MISMATCH", "Use the original operator tab for this action.", status=403)
            authorization = self.headers.get("Authorization", "")
            cookie = SimpleCookie()
            with contextlib.suppress(Exception):
                cookie.load(self.headers.get("Cookie", ""))
            cookie_token = cookie["wherobots_session"].value if "wherobots_session" in cookie else ""
            supplied = authorization[7:] if authorization.startswith("Bearer ") else ""
            valid = bool(supplied) and secrets.compare_digest(supplied, token)
            if not mutation and not valid:
                valid = bool(cookie_token) and secrets.compare_digest(cookie_token, token)
            if not valid:
                raise OperationError("SESSION_REQUIRED", "Open the local launch URL to connect this operator tab.", status=401)

        def _json(self):
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                raise OperationError("BODY_LENGTH", "Supply the complete request length.") from None
            if length <= 0 or length > 2 * 1024 * 1024:
                raise OperationError("REQUEST_SIZE", "Use a JSON request within 2 MiB.")
            try:
                result = json.loads(self.rfile.read(length))
            except (ValueError, UnicodeError):
                raise OperationError("REQUEST_JSON", "Supply a valid UTF-8 JSON request.") from None
            if not isinstance(result, dict):
                raise OperationError("REQUEST_OBJECT", "Supply a JSON request object.")
            return result

        def _upload(self, maximum):
            try:
                length = int(self.headers.get("Content-Length", "-1"))
            except ValueError:
                raise OperationError("BODY_LENGTH", "Select a complete file with a declared byte length.") from None
            if not 0 <= length <= maximum:
                raise OperationError("UPLOAD_SIZE", "The selected file exceeds this receiving operation's byte limit.")
            directory = private_directory(workspace.directory / "uploads", create=True)
            path = directory / uuid.uuid4().hex
            try:
                remaining = length
                with path.open("xb") as stream:
                    while remaining:
                        chunk = self.rfile.read(min(1024 * 1024, remaining))
                        if not chunk:
                            raise OperationError("UPLOAD_INCOMPLETE", "The file upload ended before its complete byte length.")
                        stream.write(chunk); remaining -= len(chunk)
                    stream.flush(); os.fsync(stream.fileno())
                return workspace.put_object(path)
            finally:
                with contextlib.suppress(FileNotFoundError):
                    path.unlink()

        def _download(self, path, filename):
            if path.is_symlink() or not path.is_file():
                raise OperationError("DOWNLOAD_MISSING", "The requested complete file is unavailable.", status=404)
            filename = Path(filename).name.replace('"', "_").replace("\r", "_").replace("\n", "_")
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(path.stat().st_size))
            self.send_header("Content-Disposition", 'attachment; filename="' + filename.encode("ascii", "replace").decode() + '"')
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            with path.open("rb") as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    self.wfile.write(chunk)

        def _get(self):
            url = urlsplit(self.path)
            path = unquote(url.path)
            query = parse_qs(url.query)
            if path in {"/", "/index.html", "/app.js", "/style.css"}:
                # The public shell contains no connection or workspace data.
                asset = WEB / ("index.html" if path == "/" else path[1:])
                kind = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
                        ".css": "text/css; charset=utf-8"}[asset.suffix]
                self._send(200, asset.read_bytes(), kind)
                return
            self._authenticated()
            parts = path.strip("/").split("/")
            if path == "/api/state":
                self._send(200, operator.state()); return
            if path == "/api/runtime":
                from .native import runtime_info
                self._send(200, runtime_info()); return
            if len(parts) == 3 and parts[0] == "api":
                kind = {"workflows": "workflow", "operations": "operation", "editions": "edition", "tasks": "task"}.get(parts[1])
                if kind:
                    self._send(200, workspace.get_record(kind, parts[2])); return
                if parts[1] == "objects":
                    self._download(workspace.object_path(parts[2]), query.get("filename", [parts[2]])[0]); return
                if parts[1] == "exports":
                    task = workspace.get_record("task", parts[2])
                    if task["action"] != "export" or task["state"] != "COMPLETE":
                        raise OperationError("EXPORT_STATE", "Wait for the complete export task before downloading.", status=409)
                    self._download(workspace.directory / "exports" / (task["id"] + ".zip"), task["result"]["filename"]); return
            if len(parts) == 4 and parts[:2] == ["api", "operations"] and parts[3] == "events":
                self._send(200, workspace.events("operation", parts[2], int(query.get("after", ["0"])[0]),
                                                 int(query.get("limit", ["100"])[0]))); return
            if len(parts) == 4 and parts[:2] == ["api", "editions"] and parts[3] == "rows":
                from .editions import edition_rows
                self._send(200, edition_rows(workspace, parts[2], query.get("dataset", [""])[0],
                    int(query.get("offset", ["0"])[0]), int(query.get("limit", ["100"])[0]))); return
            if len(parts) == 4 and parts[:2] == ["api", "operations"] and parts[3] == "logs":
                capture = int(query["capture"][0]) if "capture" in query else None
                self._send(200, workflow.captured_logs(workspace, parts[2], capture,
                    int(query.get("offset", ["0"])[0]), int(query.get("limit", ["100"])[0]))); return
            raise OperationError("ROUTE", "Select a documented operator view.", status=404)

        def _post(self):
            self._authenticated(mutation=True)
            url = urlsplit(self.path)
            parts = unquote(url.path).strip("/").split("/")
            query = parse_qs(url.query)
            if url.path == "/api/session":
                if int(self.headers.get("Content-Length", "0")):
                    self._json()
                self._send(200, {"connected": True}, headers={
                    "Set-Cookie": "wherobots_session=" + token + "; HttpOnly; SameSite=Strict; Path=/"})
                return
            if url.path == "/api/files":
                maximum = int(query.get("max_bytes", [str(64 * 1024 * 1024)])[0])
                maximum = min(maximum, 2 * 1024 ** 3)
                ref = self._upload(maximum)
                filename = query.get("filename", ["source"])[0]
                self._send(201, {"filename": Path(filename).name, **ref, "object": ref}); return
            if url.path == "/api/import/handover":
                ref = self._upload(3 * 1024 ** 3)
                task = operator.start("import", {"object": ref}, query.get("request_id", [None])[0])
                self._send(202, task); return
            body = self._json()
            if url.path == "/api/workflows":
                self._send(200, workflow.save_workflow(workspace, body["definition"],
                    body.get("expected_revision"), body.get("actor", "operator"))); return
            if url.path == "/api/adopt":
                self._send(200, workflow.adopt_customer_input(workspace,
                    workspace.object_path(body["input_object"]["sha256"]), body["files"], body["account"],
                    body.get("expected_revision"), body.get("actor", "operator"))); return
            if len(parts) == 4 and parts[:2] == ["api", "workflows"] and parts[3] == "review":
                self._send(201, workflow.review(workspace, parts[2], body["operation_id"],
                    body["expected_revision"], body.get("actor", "operator"), body.get("mode", "submit"))); return
            if len(parts) == 4 and parts[:2] == ["api", "operations"] and parts[3] in {"submit", "recover", "refresh", "cancel", "capture"}:
                task = operator.start(parts[3], {**{k: v for k, v in body.items() if k != "request_id"},
                    "operation_id": parts[2]}, body.get("request_id"))
                self._send(202, task); return
            if url.path in {"/api/compare", "/api/export"}:
                action = parts[-1]
                task = operator.start(action, {k: v for k, v in body.items() if k != "request_id"}, body.get("request_id"))
                self._send(202, task); return
            raise OperationError("ROUTE", "Select a documented operator action.", status=404)

        def do_GET(self):
            self._handle(self._get)

        def do_POST(self):
            self._handle(self._post)

        def _handle(self, method):
            try:
                method()
            except (BrokenPipeError, ConnectionResetError):
                return
            except OperationError as error:
                self._send(error.status, error.as_dict())
            except (KeyError, TypeError, ValueError) as error:
                self._send(422, {"error": "INVALID_INPUT", "message": "The request is missing or has an invalid field: " + str(error)})
            except Exception as error:
                from .native import NativeProvider
                self._send(500, NativeProvider.error(error))

    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    address = f"http://{host}:{server.server_address[1]}/#token={token}"
    if on_ready:
        on_ready(address, server, operator)
    else:
        print(json.dumps({"url": address, "workspace_id": workspace.workspace_id}), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        operator.close()


def serve(workspace, host="127.0.0.1", port=0, provider_factory=None, on_ready=None):
    with workspace.operation_lock("web-server"):
        return _serve_locked(workspace, host, port, provider_factory, on_ready)
