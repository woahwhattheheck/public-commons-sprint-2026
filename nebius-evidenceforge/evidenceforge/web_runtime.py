"""Local original-task workspace with retained Nebius and authored-control runs."""
from __future__ import annotations

import argparse
import json
import secrets
import signal
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

from .core import EvidenceError, strict_json_loads
from .focused_execution import run_task, task_detail
from .workloads import task_manifest
from .loopback_guard import allowed_request
from .provider import provider_state
from .retained_runs import (list_operations, read_operation, read_artifacts,
                            download_bundle, read_provider_record, _identity)

TOKEN = secrets.token_urlsafe(32)
LOCK = threading.Lock()
ROOT = Path(__file__).resolve().parents[1] / ".focused-runs"
PAGE_PATH = Path(__file__).with_name("runtime_page.html")
ASSETS = {"/runtime.js": ("runtime.js", "application/javascript"),
          "/runtime.css": ("runtime.css", "text/css")}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def setup(self):
        super().setup()
        self.connection.settimeout(15)

    def send_bytes(self, status, body, kind, filename=None):
        try:
            self.send_response(status)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'")
            if filename:
                self.send_header("Content-Disposition", 'attachment; filename="' + filename + '"')
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            # The run is already durable. A lost browser connection changes
            # neither its result nor the recorded provider attempt.
            pass

    def send(self, status, data, kind="application/json"):
        self.send_bytes(status, data.encode("utf-8"), kind + "; charset=utf-8")

    def error(self, status, code, message, operation_id=None):
        payload = {"error": code, "message": message}
        if operation_id:
            payload["operation_id"] = operation_id
        self.send(status, json.dumps(payload))

    def do_GET(self):
        if not allowed_request(self.headers, self.server.server_port):
            self.error(403, "local_origin_required", "Open this workspace at its displayed local URL.")
            return
        parsed = urlparse(self.path)
        if parsed.path == "/":
            config = json.dumps({"token": TOKEN, "tasks": task_manifest()}).replace("<", "\\u003c")
            page = PAGE_PATH.read_text(encoding="utf-8").replace("__CONFIG__", config)
            self.send(200, page, "text/html")
            return
        if parsed.path in ASSETS:
            filename, kind = ASSETS[parsed.path]
            self.send(200, Path(__file__).with_name(filename).read_text(encoding="utf-8"), kind)
            return
        if self.headers.get("X-Action-Token") != TOKEN:
            self.error(403, "action_token_invalid", "Reload the local workspace to obtain its current action token.")
            return
        identity = None
        try:
            if parsed.path == "/api/provider":
                self.send(200, json.dumps(provider_state()))
                return
            if parsed.path == "/api/operations":
                self.send(200, json.dumps(list_operations(ROOT)))
                return
            query = parse_qs(parsed.query)
            values = query.get("id", [])
            if len(values) != 1:
                raise ValueError("One task or operation ID is required")
            if parsed.path == "/api/task":
                self.send(200, json.dumps(task_detail(values[0])))
                return
            identity = _identity(values[0])
            if parsed.path in {"/api/operation", "/api/result"}:
                operation = read_operation(ROOT, identity)
                if parsed.path == "/api/operation":
                    self.send(200, json.dumps(operation))
                elif operation["result_verified"]:
                    self.send(200, json.dumps(operation["run"]))
                else:
                    self.error(409, "result_not_complete", operation["message"], identity)
                return
            if parsed.path == "/api/artifacts":
                self.send(200, json.dumps(read_artifacts(ROOT, identity)))
                return
            if parsed.path == "/api/download":
                data = download_bundle(ROOT, identity)
                self.send_bytes(200, data, "application/zip", identity + ".zip")
                return
            if parsed.path == "/api/provider-record":
                data = read_provider_record(ROOT, identity)
                self.send_bytes(200, data, "application/json", identity + "-provider-api.json")
                return
        except FileNotFoundError:
            self.error(404, "retained_file_missing", "The selected retained operation or artifact was not found.", identity)
            return
        except (EvidenceError, ValueError, KeyError, TypeError) as exc:
            self.error(400, "retained_request_invalid", str(exc)[:350], identity)
            return
        except OSError:
            self.error(503, "retained_storage_unavailable", "The original retained storage could not be read.", identity)
            return
        self.error(404, "endpoint_not_found", "The requested workspace endpoint does not exist.")

    def do_POST(self):
        if not allowed_request(self.headers, self.server.server_port, mutation=True):
            self.error(403, "local_origin_required", "Open this workspace at its displayed local URL.")
            return
        if self.path != "/api/run" or self.headers.get("X-Action-Token") != TOKEN:
            self.error(403, "action_token_invalid", "Reload the local workspace to obtain its current action token.")
            return
        identity = None
        try:
            if self.headers.get("Transfer-Encoding"):
                raise ValueError("A complete JSON request is required")
            lengths = self.headers.get_all("Content-Length", [])
            if len(lengths) != 1:
                raise ValueError("One Content-Length is required")
            length = int(lengths[0])
            if not 0 < length <= 8192:
                raise ValueError("Task request exceeds its byte limit")
            body = strict_json_loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(body, dict):
                raise ValueError("Task request must be an object")
            if set(body) == {"task", "control", "operation_id"}:
                if body["control"] not in {"baseline", "corrected"}:
                    raise ValueError("Unknown authored control")
                mode = body["control"]
                model, tokens, seconds = None, 4096, 120
            elif set(body) == {"task", "mode", "operation_id", "model", "maximum_output_tokens", "seconds"}:
                mode, model = body["mode"], body["model"]
                tokens, seconds = body["maximum_output_tokens"], body["seconds"]
                if mode not in {"baseline", "corrected", "nebius"}:
                    raise ValueError("Choose a current-model run or one authored control")
                if mode == "nebius":
                    if not isinstance(model, str) or not model.strip() or len(model) > 256:
                        raise ValueError("Select a current NVIDIA model from the account inventory")
                elif model is not None:
                    raise ValueError("Authored controls do not select a provider model")
            else:
                raise ValueError("Task request fields do not match the original runtime contract")
            identity = _identity(body["operation_id"])
            task_detail(body["task"])
            if type(tokens) is not int or not 128 <= tokens <= 8192:
                raise ValueError("Output token limit must be 128–8192")
            if type(seconds) not in (int, float) or not 5 <= seconds <= 120:
                raise ValueError("Operation deadline must be 5–120 seconds")
        except (ValueError, TypeError, KeyError, UnicodeDecodeError, TimeoutError) as exc:
            self.error(400, "run_request_invalid", str(exc)[:350], identity)
            return
        if not LOCK.acquire(False):
            self.error(409, "run_active", "An original task is already running. Inspect its retained operation.", identity)
            return
        try:
            run = run_task(body["task"], output_root=ROOT, operation_id=identity,
                           control=mode if mode != "nebius" else "corrected",
                           live=mode == "nebius", model=model, seconds=seconds,
                           maximum_output_tokens=tokens)
            self.send(200, json.dumps(run))
        except EvidenceError as exc:
            self.error(409, "run_not_completed", str(exc)[:350], identity)
        except (OSError, ValueError, KeyError, TypeError):
            self.error(500, "run_not_completed", "The task did not finish. Inspect its retained journal and provider record.", identity)
        finally:
            LOCK.release()


class RuntimeServer(ThreadingHTTPServer):
    # Finish the active operation before process shutdown releases the server.
    # An interrupted browser is independent of the native task lifecycle.
    daemon_threads = False
    block_on_close = True


def main(argv=None):
    global ROOT
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8081)
    parser.add_argument("--runs")
    args = parser.parse_args(argv)
    if args.runs:
        ROOT = Path(args.runs).resolve()
    server = RuntimeServer(("127.0.0.1", args.port), Handler)
    print(f"EvidenceForge: http://127.0.0.1:{server.server_port}", flush=True)
    previous_term = None
    stopping = False
    def request_stop(signum, frame):
        nonlocal stopping
        if not stopping:
            stopping = True
            # Raising here exits serve_forever in its own thread. Calling
            # server.shutdown() synchronously from this handler would deadlock.
            raise KeyboardInterrupt
    if threading.current_thread() is threading.main_thread():
        previous_term = signal.signal(signal.SIGTERM, request_stop)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        try:
            server.server_close()
        finally:
            if previous_term is not None:
                signal.signal(signal.SIGTERM, previous_term)


if __name__ == "__main__":
    main()
