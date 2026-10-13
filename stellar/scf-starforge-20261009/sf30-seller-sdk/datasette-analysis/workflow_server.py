"""Local industrial operator and gateway-side API for original source workflows."""
from __future__ import annotations

import hashlib
import fcntl
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import secrets
import signal
import stat
import sys
import threading
from urllib.parse import parse_qs, quote, unquote, urlsplit
import webbrowser

from workflow_engine import (SCHEMA, Workflow, WorkflowError, atomic_json, canonical,
                             file_descriptor, read_json)

HERE = Path(__file__).resolve().parent
MAX_BODY = 32 * 1024 * 1024
MAX_INPUT_CHUNK = 8 * 1024 * 1024
INPUT_READ_TIMEOUT = 60


def configuration_view(configuration):
    """Expose the installed operating plan without host credentials or private source paths."""
    cfg = configuration or {}
    analysis = cfg.get("analysis", {})
    query = analysis.get("query", {})
    queries = analysis.get("queries") or ([query] if query else [])
    report = analysis.get("report", {})
    supplier = cfg.get("delivery", {}).get("supplier")
    source_alias = cfg.get("sourceAlias", "source")
    related_sources = cfg.get("relatedSources", {})
    sources = []
    for alias, selected in [(source_alias, cfg.get("source", {})), *related_sources.items()]:
        metadata = selected.get("source", {})
        metadata = metadata if isinstance(metadata, dict) else {}
        sources.append({"alias": alias, "kind": selected.get("kind"),
                        "title": selected.get("name") or metadata.get("title") or alias})
    describe = lambda item: {key: item[key] for key in (
        "name", "title", "sql", "parameterNames", "maxRows", "note") if key in item}
    return {"schema": SCHEMA, "configured": bool(cfg),
            "profile": cfg.get("profile"), "title": cfg.get("title", cfg.get("profile")),
            "sourceKind": cfg.get("source", {}).get("kind"),
            "query": describe(query), "queries": [describe(item) for item in queries],
            "report": {key: report[key] for key in ("title", "introduction", "note") if key in report},
            "sourceAlias": source_alias, "sources": sources,
            "relatedSources": sorted(related_sources), "relatedSourceAliases": sorted(related_sources),
            "supplier": ({"enabled": True, "sourceBindings": supplier.get("sourceBindings", {}),
                          "coverage": bool(supplier.get("coverage"))} if isinstance(supplier, dict) else None),
            "sourceArchive": bool(cfg.get("sourceArchive")),
            "jms": bool(cfg.get("delivery", {}).get("jms")),
            "callback": bool(cfg.get("delivery", {}).get("callback"))}


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, workspace, configuration, port, *, configuration_file=None,
                 providers_configuration=None, providers_file=None):
        self.workspace = Path(workspace).expanduser().absolute()
        self.configuration = configuration
        self.configuration_file = configuration_file
        self.provider_configuration_file = providers_file
        with Workflow(self.workspace) as workflow:
            self.workspace_id = workflow.db.execute(
                "SELECT value FROM workflow_meta WHERE key='workspaceId'").fetchone()[0]
        self.capability = secrets.token_urlsafe(32)
        self.jobs, self.job_lock = {}, threading.Lock()
        from provider_workflows import ProviderWorkflows
        self.providers = ProviderWorkflows(self.workspace, providers_configuration,
                                           configuration_file=providers_file)
        try:
            super().__init__(("127.0.0.1", port), Handler)
        except Exception:
            self.providers.close()
            raise
        self.origin = "http://127.0.0.1:" + str(self.server_port)


    def server_close(self):
        try:
            self.providers.close()
        finally:
            super().server_close()

    def health(self):
        analysis = (self.configuration or {}).get("analysis")
        native = {"configured": isinstance(analysis, dict), "ready": False}
        if isinstance(analysis, dict):
            native.update(workspace=analysis.get("workspace"), operationId=analysis.get("operationId"))
            try:
                from operator_client import DatasetteOperatorClient
                original = DatasetteOperatorClient.from_workspace(analysis["workspace"], timeout=3).status()
                if original["operation_id"] != analysis["operationId"]:
                    raise WorkflowError("WORKFLOW_ANALYSIS_OPERATION_CHANGED",
                                        "Open the selected original Analysis operation.")
                native.update(ready=True, workspaceId=original["workspace_id"])
            except Exception as error:
                native["error"] = getattr(error, "code", type(error).__name__)
        return {"schema": SCHEMA, "status": "READY", "ready": True,
                "pid": os.getpid(), "workspace": str(self.workspace),
                "workspaceId": self.workspace_id, "profile": (self.configuration or {}).get("profile"),
                "configuration": self.configuration_file,
                "providerConfiguration": self.provider_configuration_file, "analysis": native}

    def start_job(self, request_id, action, function):
        key = (request_id, action)
        with self.job_lock:
            running = self.jobs.get(key)
            if running is not None and running.is_alive():
                return False

            def operate():
                try:
                    with Workflow(self.workspace) as workflow:
                        function(workflow)
                except Exception as error:
                    print(canonical({"schema": SCHEMA, "requestId": request_id,
                                     "operation": action, "error": getattr(error, "code", type(error).__name__),
                                     "message": str(error)}), file=sys.stderr, flush=True)
                finally:
                    with self.job_lock:
                        self.jobs.pop(key, None)

            thread = threading.Thread(target=operate, name="source-workflow-" + action, daemon=True)
            self.jobs[key] = thread
            thread.start()
        return True


class Handler(BaseHTTPRequestHandler):
    server_version = "SourceWorkflow"
    sys_version = ""

    def log_message(self, *args):
        return

    def _headers(self, status, content_type, size):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(size))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy",
                         "default-src 'self'; script-src 'self'; style-src 'self'; "
                         "object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")

    def _json(self, value, status=200):
        raw = canonical(value).encode()
        self._headers(status, "application/json; charset=utf-8", len(raw))
        self.end_headers()
        self.wfile.write(raw)

    def _authorize(self):
        supplied = self.headers.get("X-Workflow-Capability", "")
        if not hmac.compare_digest(supplied, self.server.capability):
            raise WorkflowError("WORKFLOW_CAPABILITY", "Open this operator's complete original local URL.")
        origin = self.headers.get("Origin")
        if origin is not None and origin != self.server.origin:
            raise WorkflowError("WORKFLOW_ORIGIN", "Use the original local operator or configured server-to-server gateway.")
        if self.headers.get("Sec-Fetch-Site") in {"cross-site"}:
            raise WorkflowError("WORKFLOW_ORIGIN", "Open the original local operator.")

    def _body(self):
        length = self.headers.get("Content-Length", "")
        if not length.isdecimal() or not 0 < int(length) <= MAX_BODY:
            raise WorkflowError("WORKFLOW_REQUEST_SIZE", "Submit the original JSON request within the configured body size.")
        raw = self.rfile.read(int(length))
        if len(raw) != int(length):
            raise WorkflowError("WORKFLOW_REQUEST_INCOMPLETE", "Send the complete original request.")
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise WorkflowError("WORKFLOW_REQUEST_OBJECT", "Use an original JSON object.")
        return value

    def _parts(self):
        return [unquote(p) for p in urlsplit(self.path).path.split("/") if p]

    def _error(self, error):
        code = getattr(error, "code", type(error).__name__)
        status = 401 if code == "WORKFLOW_CAPABILITY" else 403 if code == "WORKFLOW_ORIGIN" else (
            404 if code in {"WORKFLOW_NOT_FOUND", "WORKFLOW_FILE_NOT_FOUND", "WORKFLOW_ROUTE", "PROVIDER_INPUT_NOT_FOUND"} else 409
            if code in {"WORKFLOW_RUNNING", "WORKFLOW_REQUEST_CHANGED", "WORKFLOW_CONFIGURATION_CHANGED",
                     "PROVIDER_INPUT_BUSY", "PROVIDER_INPUT_INTENT_CHANGED", "PROVIDER_INPUT_CHUNK_CHANGED"} else 400)
        self._json({"schema": SCHEMA, "error": code, "message": str(error),
                    "requestId": getattr(error, "request_id", None)}, status)

    def do_GET(self):
        try:
            path = urlsplit(self.path).path
            static = {"/": ("workflow_app.html", "text/html; charset=utf-8"),
                      "/workflow_app.mjs": ("workflow_app.mjs", "text/javascript; charset=utf-8"),
                      "/workflow_app.css": ("workflow_app.css", "text/css; charset=utf-8"),
                      "/provider_workflows.mjs": ("provider_workflows.mjs", "text/javascript; charset=utf-8"),
                      "/provider_inputs.mjs": ("provider_inputs.mjs", "text/javascript; charset=utf-8"),
                      "/provider_workflows.css": ("provider_workflows.css", "text/css; charset=utf-8")}
            if path in static:
                name, kind = static[path]
                raw = (HERE / name).read_bytes()
                self._headers(200, kind, len(raw))
                self.end_headers()
                self.wfile.write(raw)
                return
            self._authorize()
            parts = self._parts()
            if parts[:2] == ["api", "providers"]:
                return self._provider_get(parts)
            with Workflow(self.server.workspace) as workflow:
                if parts == ["api", "health"]:
                    return self._json(self.server.health())
                if parts == ["api", "configuration"]:
                    return self._json(configuration_view(self.server.configuration))
                if parts == ["api", "requests"]:
                    return self._json(workflow.status())
                if parts == ["api", "inbox"]:
                    rows = workflow.db.execute(
                        "SELECT receipt_json FROM workflow_received_results ORDER BY received_at DESC").fetchall()
                    return self._json({"schema": SCHEMA, "results": [json.loads(r["receipt_json"]) for r in rows]})
                if len(parts) >= 3 and parts[:2] == ["api", "requests"]:
                    request_id = parts[2]
                    if len(parts) == 3:
                        history = parse_qs(urlsplit(self.path).query).get("history") == ["true"]
                        detail = workflow.status(request_id, history=history)
                        row = workflow._row(request_id)
                        cfg = json.loads(row["configuration_json"]) if row["configuration_json"] else (
                            self.server.configuration if
                            (self.server.configuration or {}).get("profile") == row["profile"] else None)
                        detail["configuration"] = configuration_view(cfg)
                        return self._json(detail)
                    if len(parts) == 4 and parts[3] == "envelope":
                        return self._json(workflow.envelope(request_id))
                    if len(parts) == 5 and parts[3] == "files":
                        selected = workflow.original_file(request_id, parts[4])
                        file = file_descriptor(selected["path"], name=selected["name"],
                                               expected_sha256=selected["sha256"],
                                               expected_bytes=selected["bytes"])
                        kind = selected.get("contentType", "application/octet-stream")
                        if not isinstance(kind, str) or not re.fullmatch(r"[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+", kind):
                            kind = "application/octet-stream"
                        self._headers(200, kind, file["bytes"])
                        self.send_header("X-Content-SHA256", file["sha256"])
                        self.send_header("Content-Disposition", "attachment; filename*=UTF-8''" + quote(file["name"], safe=""))
                        self.end_headers()
                        with open(file["path"], "rb") as stream:
                            while block := stream.read(1024 * 1024):
                                self.wfile.write(block)
                        return
            raise WorkflowError("WORKFLOW_ROUTE", "Select an original workflow route.")
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception as error:
            self._error(error)

    def _provider_get(self, parts):
        provider = self.server.providers
        if parts == ["api", "providers", "inputs"]:
            return self._json(provider.list_inputs())
        if len(parts) == 4 and parts[:3] == ["api", "providers", "inputs"]:
            return self._json(provider.input_status(parts[3]))
        if len(parts) == 5 and parts[:3] == ["api", "providers", "inputs"] and parts[4] == "file":
            path, selected = provider.input_file(parts[3])
            descriptor = file_descriptor(path, name=selected["name"],
                                         expected_sha256=selected["sha256"],
                                         expected_bytes=selected["bytes"])
            kind = selected.get("contentType", "application/octet-stream")
            if not isinstance(kind, str) or not re.fullmatch(r"[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+", kind):
                kind = "application/octet-stream"
            self._headers(200, kind, descriptor["bytes"])
            self.send_header("X-Content-SHA256", descriptor["sha256"])
            self.send_header("Content-Disposition", "attachment; filename*=UTF-8''" + quote(descriptor["name"], safe=""))
            self.end_headers()
            with open(descriptor["path"], "rb") as stream:
                while block := stream.read(1024 * 1024):
                    self.wfile.write(block)
            return
        if parts == ["api", "providers", "catalog"]:
            return self._json(provider.catalog())
        if parts == ["api", "providers", "operations"]:
            return self._json(provider.list_operations())
        if len(parts) == 4 and parts[:3] == ["api", "providers", "operations"]:
            return self._json(provider.operation(parts[3]))
        if len(parts) == 6 and parts[:3] == ["api", "providers", "operations"] and parts[4] == "files":
            path, selected = provider.file(parts[3], parts[5])
            descriptor = file_descriptor(path, name=selected["name"],
                                         expected_sha256=selected["sha256"],
                                         expected_bytes=selected["bytes"])
            kind = selected.get("contentType", "application/octet-stream")
            if not isinstance(kind, str) or not re.fullmatch(r"[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+", kind):
                kind = "application/octet-stream"
            self._headers(200, kind, descriptor["bytes"])
            self.send_header("X-Content-SHA256", descriptor["sha256"])
            self.send_header("Content-Disposition", "attachment; filename*=UTF-8''" + quote(descriptor["name"], safe=""))
            self.end_headers()
            with open(descriptor["path"], "rb") as stream:
                while block := stream.read(1024 * 1024):
                    self.wfile.write(block)
            return
        raise WorkflowError("WORKFLOW_ROUTE", "Select an original provider workflow route.")

    def _provider_input_chunk(self, ident):
        # An early rejection or interrupted read must never leave binary bytes
        # available to be interpreted as a later HTTP request.
        self.close_connection = True
        def header(name):
            values = self.headers.get_all(name, [])
            if len(values) != 1:
                raise WorkflowError("PROVIDER_INPUT_CHUNK_HEADERS",
                                    "Send each original chunk header exactly once.")
            return values[0]
        if self.headers.get_all("Transfer-Encoding", []):
            raise WorkflowError("PROVIDER_INPUT_CHUNK_HEADERS",
                                "Send one complete fixed-length original chunk.")
        length, offset, sha256 = header("Content-Length"), header("X-Input-Offset"), header("X-Content-SHA256")
        if (not re.fullmatch(r"[0-9]{1,8}", length) or not 0 < int(length) <= MAX_INPUT_CHUNK
                or not re.fullmatch(r"[0-9]{1,16}", offset) or int(offset) > 9007199254740991
                or not re.fullmatch(r"[a-f0-9]{64}", sha256)):
            raise WorkflowError("PROVIDER_INPUT_CHUNK_HEADERS",
                                "Send the exact original chunk length, offset and SHA-256.")
        previous_timeout = self.connection.gettimeout()
        try:
            self.connection.settimeout(INPUT_READ_TIMEOUT)
            result = self.server.providers.input_chunk(
                ident, offset=int(offset), length=int(length), sha256=sha256, source=self.rfile)
        except TimeoutError:
            raise WorkflowError("PROVIDER_INPUT_CHUNK_TIMEOUT",
                                "This chunk stopped receiving bytes. Reopen its retained status and resume the same input.") from None
        finally:
            self.connection.settimeout(previous_timeout)
        return self._json(result)

    def _provider_post(self, parts, body):
        if parts == ["api", "providers", "inputs"]:
            return self._json(self.server.providers.begin_input(body), 201)
        if len(parts) == 5 and parts[:3] == ["api", "providers", "inputs"] and parts[4] == "complete":
            return self._json(self.server.providers.complete_input(parts[3], body))
        if parts == ["api", "providers", "operations"]:
            return self._json(self.server.providers.submit(body), 202)
        if len(parts) == 5 and parts[:3] == ["api", "providers", "operations"] and parts[4] == "run":
            if body:
                raise WorkflowError("WORKFLOW_PROVIDER_REQUEST_CHANGED",
                                    "Run the complete retained request without replacing its inputs.")
            selected = self.server.providers.prepared(parts[3])
            with Workflow(self.server.workspace) as workflow:
                original = workflow.accept(selected["request"])
                request_id = original["requestId"]
                with workflow.lock(request_id):
                    cfg = workflow._bind(workflow._row(request_id), selected["configuration"])
                started = False
                if not original.get("result"):
                    started = self.server.start_job(request_id, "run", lambda w: w.run(request_id, cfg))
                return self._json({"schema": SCHEMA, "operationId": parts[3], "requestId": request_id,
                                   "started": started, "request": workflow.status(request_id)}, 202)
        raise WorkflowError("WORKFLOW_ROUTE", "Select an original provider workflow operation.")

    def do_POST(self):
        try:
            self._authorize()
            parts = self._parts()
            if len(parts) == 5 and parts[:3] == ["api", "providers", "inputs"] and parts[4] == "chunks":
                return self._provider_input_chunk(parts[3])
            body = self._body()
            if parts[:2] == ["api", "providers"]:
                return self._provider_post(parts, body)
            with Workflow(self.server.workspace) as workflow:
                if parts == ["api", "requests"]:
                    accepted = workflow.accept(body.get("request", body),
                                               execution_id=body.get("executionId"),
                                               transport=body.get("transport"))
                    original_request = accepted["request"]
                    parent_id = original_request.get("parentRequestId")
                    if parent_id:
                        parent = workflow.db.execute(
                            "SELECT * FROM workflow_requests WHERE request_id=?", (parent_id,)).fetchone()
                        if parent is not None and parent["profile"] == accepted["profile"] and parent["configuration_json"]:
                            with workflow.lock(accepted["requestId"]):
                                workflow._bind(workflow._row(accepted["requestId"]),
                                               json.loads(parent["configuration_json"]))
                    selected = workflow.status(accepted["requestId"])
                    selected["replayed"] = accepted["replayed"]
                    return self._json(selected, 201)
                if parts == ["api", "results"]:
                    return self._json(workflow.receive_result(body))
                if len(parts) != 4 or parts[:2] != ["api", "requests"]:
                    raise WorkflowError("WORKFLOW_ROUTE", "Select an original workflow operation.")
                request_id, action = parts[2], parts[3]
                row = workflow._row(request_id)
                if action == "run":
                    cfg = json.loads(row["configuration_json"]) if row["configuration_json"] else self.server.configuration
                    if cfg is None:
                        raise WorkflowError("WORKFLOW_CONFIGURATION", "Start this operator with its installed configuration.")
                    with workflow.lock(request_id):
                        workflow._bind(row, cfg)
                    self.server.start_job(request_id, "run", lambda w: w.run(request_id, cfg))
                    return self._json(workflow.status(request_id), 202)
                if action == "callback":
                    attempt = body.get("attemptId")
                    self.server.start_job(request_id, "callback", lambda w: w.callback(request_id, attempt))
                    return self._json(workflow.status(request_id), 202)
                if action == "publish":
                    return self._json(workflow.publish(request_id, body.get("attemptId")))
                if action == "published":
                    return self._json(workflow.published(request_id, body.get("attemptId"),
                                                         count=body.get("messagesCount"), response=body.get("response")))
                if action == "acknowledge":
                    return self._json(workflow.acknowledge(request_id, body))
                if action == "export":
                    name = "Source_Workflow_" + row["run_id"] + "_" + row["result_sha"][:12] + ".zip" if row["result_sha"] else None
                    if name is None:
                        raise WorkflowError("WORKFLOW_RESULT_PENDING", "Continue the native source and report operation.")
                    destination = workflow._directory(row) / "exports" / name
                    return self._json(workflow.export(request_id, destination))
            raise WorkflowError("WORKFLOW_ROUTE", "Select an original workflow operation.")
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception as error:
            self.close_connection = True
            self._error(error)


def serve(workspace, *, configuration_path=None, providers_path=None, port=0, open_browser=False):
    configuration_file = file_descriptor(configuration_path) if configuration_path else None
    configuration = read_json(configuration_file["path"]) if configuration_file else None
    if configuration_file:
        file_descriptor(configuration_file["path"], expected_sha256=configuration_file["sha256"],
                        expected_bytes=configuration_file["bytes"])
    providers_file = file_descriptor(providers_path) if providers_path else None
    providers_configuration = read_json(providers_file["path"]) if providers_file else None
    if providers_file:
        file_descriptor(providers_file["path"], expected_sha256=providers_file["sha256"],
                        expected_bytes=providers_file["bytes"])
    with Workflow(workspace) as workflow:
        directory = workflow.path
    descriptor = os.open(directory / "source-workflow-server.lock",
                         os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    server = None
    launch_file = directory / "source-workflow-launch.json"
    previous_term = None
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise WorkflowError("WORKFLOW_LISTENER_LOCK", "Use the original private listener lock.")
        os.fchmod(descriptor, 0o600)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise WorkflowError("WORKFLOW_LISTENER_RUNNING",
                                "Open the existing original workflow listener.") from None
        server = Server(directory, configuration, port, configuration_file=configuration_file,
                        providers_configuration=providers_configuration, providers_file=providers_file)
        launch = {"schema": SCHEMA, "status": "LISTENING",
                  "url": server.origin + "/#" + server.capability,
                  "pid": os.getpid(), "workspace": str(server.workspace),
                  "workspaceId": server.workspace_id, "privateLaunch": str(launch_file),
                  "profile": (configuration or {}).get("profile"),
                  "configuration": configuration_file,
                  "providerConfiguration": providers_file}
        atomic_json(launch_file, launch)
        print(canonical(launch), flush=True)
        if open_browser:
            webbrowser.open(launch["url"])
        if threading.current_thread() is threading.main_thread():
            def stop(signum, frame):
                raise KeyboardInterrupt
            previous_term = signal.signal(signal.SIGTERM, stop)
        try:
            server.serve_forever(poll_interval=0.5)
        except KeyboardInterrupt:
            pass
    finally:
        if previous_term is not None:
            signal.signal(signal.SIGTERM, previous_term)
        try:
            if server is not None:
                server.server_close()
                if launch_file.is_file():
                    current = read_json(launch_file)
                    if current.get("pid") == os.getpid() and current.get("workspaceId") == server.workspace_id:
                        launch_file.unlink()
        finally:
            os.close(descriptor)
