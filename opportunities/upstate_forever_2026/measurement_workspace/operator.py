"""Managed standard-library bridge for the existing Python operator HTTP server.

Call service.try_handle(self) from the original handler AFTER its authentication,
or service.wrap(Handler, authorize=your_existing_authentication_function).
The native Workspace instance and explicit reach resolver are owned by the caller.
"""
from __future__ import annotations
import atexit
import hashlib
import http.client
import json
import os
from pathlib import Path
import queue
import secrets
import shutil
import subprocess
import sys
import threading
from typing import Any, Callable
from urllib.parse import urlsplit
from .node_runtime import inspect_node, MeasurementRuntimeError

BASE = "/api/measurement-workspace"
MAX_BODY = 128 * 1024 * 1024

class Measurements:
    def __init__(self, workspace: Any, *, data_dir: str | Path,
                 reaches: Callable[[Any], list[dict]], node: str | None = None) -> None:
        self.workspace = workspace
        self.directory = Path(data_dir).resolve()
        self.directory.mkdir(parents=True, exist_ok=True)
        self.reach_resolver = reaches
        self._node_selection = node
        self.node = None
        self.runtime = None
        self._collector = None
        self._lock = threading.RLock()
        self._process: subprocess.Popen | None = None
        self._port: int | None = None
        self._token = secrets.token_urlsafe(32)
        self._log = None
        self._closed = False
        atexit.register(self.close)

    def _sync_reaches(self) -> None:
        rows = self.reach_resolver(self.workspace)
        if not isinstance(rows, list) or any(not isinstance(r, dict) or not isinstance(r.get("id"), str) or not r["id"] for r in rows):
            raise ValueError("Reach resolver must return the original Workspace's list of objects with string id")
        if len({r["id"] for r in rows}) != len(rows):
            raise ValueError("Native reach identities must be unique")
        encoded = json.dumps(rows, ensure_ascii=False, allow_nan=False).encode()
        target = self.directory / "reaches.json"
        if target.exists() and target.read_bytes() == encoded:
            return
        temp = target.with_suffix(".pending")
        with temp.open("wb") as stream:
            stream.write(encoded); stream.flush(); os.fsync(stream.fileno())
        temp.replace(target)

    def _release_child(self) -> None:
        process = self._process
        if process is not None and process.poll() is None:
            raise RuntimeError("The original Measurements child is still running")
        if self._collector is not None:
            self._collector.join()
            self._collector = None
        if process is not None:
            for stream in (process.stdin, process.stdout):
                if stream is not None:
                    stream.close()
        self._process = None
        self._port = None
        if self._log is not None:
            self._log.close()
            self._log = None

    def _ensure(self) -> tuple[int, str]:
        with self._lock:
            if self._closed:
                raise RuntimeError("Measurement service is closed")
            self._sync_reaches()
            if self._process and self._process.poll() is None:
                if self._port is None:
                    raise RuntimeError("The original Measurements child has not completed startup")
                return self._port, self._token
            self._release_child()
            self.runtime = inspect_node(self._node_selection)
            self.node = self.runtime["selected_executable"]
            self._log = (self.directory / "measurement-process.log").open("ab", buffering=0)
            log = self._log
            try:
                log.write(("\n[measurements-runtime] " + json.dumps(self.runtime, ensure_ascii=False) + "\n").encode("utf-8"))
            except (OSError, ValueError) as exc:
                self._release_child()
                raise MeasurementRuntimeError("ENGINE_LOG", "Measurements cannot write its local process log; check the Workspace volume before opening the engine.") from exc
            env = {**os.environ, "MEASUREMENTS_INTERNAL_TOKEN": self._token}
            env["MEASUREMENTS_PYTHON"] = sys.executable
            command = [self.node, str(Path(__file__).parent / "engine" / "cli.mjs"),
                       "serve", "--workspace", str(self.directory), "--host", "127.0.0.1", "--port", "0"]
            try:
                process = subprocess.Popen(
                    command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                    stderr=log, env=env, close_fds=True,
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            except OSError as exc:
                try:
                    log.write(("[measurements-start] " + str(exc) + "\n").encode("utf-8", errors="replace"))
                except (OSError, ValueError):
                    pass
                self._release_child()
                raise MeasurementRuntimeError("ENGINE_EXECUTION", "Measurements could not launch the inspected Node runtime; inspect measurement-process.log.") from exc
            self._process = process
            ready = queue.Queue(maxsize=1)
            # Drain stdout for the child's whole lifetime, including shutdown.
            # The first line is a small readiness record; later output is retained
            # locally and cannot fill the unread pipe during a long operation.
            self._log_error = None
            self._stdout_error = None
            def retain_output(chunk):
                if self._log_error is not None:
                    return
                try:
                    log.write(chunk)
                except (OSError, ValueError) as exc:
                    # A full/unavailable log destination must not stop stdout
                    # drainage and strand the child's active scientific write.
                    self._log_error = str(exc)
            def collect():
                try:
                    line = process.stdout.readline(16385)
                    ready.put(line)
                    if line:
                        retain_output(line)
                    while True:
                        chunk = process.stdout.read(65536)
                        if not chunk:
                            break
                        retain_output(chunk)
                except (OSError, ValueError) as exc:
                    self._stdout_error = str(exc)
                    try:
                        ready.put_nowait(exc)
                    except queue.Full:
                        pass
            self._collector = threading.Thread(target=collect, name="measurements-stdout", daemon=True)
            self._collector.start()
            try:
                line = ready.get(timeout=12)
                if isinstance(line, Exception):
                    raise line
                if len(line) > 16384 or not line.endswith(b"\n"):
                    raise ValueError("Missing or oversized child readiness response")
                value = json.loads(line)
                if (not isinstance(value, dict) or value.get("ready") is not True
                        or value.get("host") != "127.0.0.1"
                        or type(value.get("port")) is not int
                        or not 1 <= value["port"] <= 65535
                        or value.get("pid") != process.pid):
                    raise ValueError("Invalid measurement child readiness")
                self._port = value["port"]
                if process.poll() is not None:
                    raise RuntimeError("Measurement child exited during startup")
            except Exception as exc:
                # A child that never became ready has accepted no proxied writes.
                # Normal close below always uses the existing stdin drain.
                if process.poll() is None:
                    process.kill()
                process.wait()
                code = process.returncode
                retain_output(("[measurements-start] " + str(exc) + "; exit " + str(code) + "\n").encode("utf-8", errors="replace"))
                self._release_child()
                raise MeasurementRuntimeError(
                    "ENGINE_STARTUP", "Measurements did not open with Node " + self.runtime["version"]
                    + " (exit " + str(code) + "). Inspect measurement-process.log for the original startup error.") from exc
            return self._port, self._token

    def request(self, method: str, path: str, body: bytes = b"") -> tuple[int, dict, bytes]:
        """Typed Python/API use. No automatic replay of a possibly committed mutation."""
        if method not in {"GET", "POST", "PUT"}:
            raise ValueError("Unsupported measurement request method")
        if not self.handles(path):
            raise ValueError("Request path is outside the measurement extension")
        port, token = self._ensure()
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=195)
        try:
            connection.request(method, path, body=body, headers={"X-Measurement-Internal-Token": token,
                                "Content-Type": "application/json", "Content-Length": str(len(body))})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def json(self, method: str, operation: str = "", payload: Any = None) -> Any:
        encoded = b"" if payload is None else json.dumps(payload, ensure_ascii=False, allow_nan=False).encode()
        status, _, content = self.request(method, BASE + ("/" + operation.lstrip("/") if operation else ""), encoded)
        result = json.loads(content)
        if status >= 400:
            raise RuntimeError(f"Measured-data HTTP {status}: {result.get('error', 'request failed')}")
        return result

    @staticmethod
    def handles(path: str) -> bool:
        p = urlsplit(path).path
        return p == BASE or p.startswith(BASE + "/") or p in {"/measurements/edition_reader.mjs", "/measurements/edition_review.mjs", "/measurements/collection_folder.mjs", "/measurements/eco_handovers.mjs", "/measurements/chiques_nutrients.mjs", "/measurements/intake_comparison.mjs", "/measurements/observation_editions.mjs", "/measurements/observation_editions.css", "/measurements/sediment.mjs", "/measurements/sediment_comparisons.mjs", "/measurements/benchmarks.mjs", "/measurements", "/measurements/", "/measurements/source_reconciliation.mjs", "/measurements/source_reconciliation.css", "/measurements/source_handback.mjs", "/measurements/source_handback.css", "/measurements/results.mjs", "/measurements/result_handback.mjs", "/measurements/flow_editions.mjs", "/measurements/flow_editions.css", "/measurements/flow_loads_ui.mjs", "/measurements/flow_load_comparison_ui.mjs", "/measurements/workspace.js", "/measurements/workspace.css", "/measurements/collections.mjs", "/measurements/collection_working.mjs", "/measurements/collection_transfer.mjs", "/measurements/large_files.mjs", "/measurements/intake.mjs"}

    def try_handle(self, handler) -> bool:
        """Return False without touching unrelated native routes or response writers."""
        if not self.handles(handler.path):
            return False
        try:
            origin = handler.headers.get("Origin")
            if origin and urlsplit(origin).netloc != handler.headers.get("Host"):
                self._error(handler, 403, "Cross-origin measurement writes are not accepted")
                return True
            if handler.headers.get("Transfer-Encoding"):
                self._error(handler, 411, "Use a Content-Length request body")
                return True
            size = int(handler.headers.get("Content-Length", "0"))
            if size < 0 or size > MAX_BODY:
                self._error(handler, 413, "Upload exceeds the 128 MiB process limit")
                return True
            data = handler.rfile.read(size) if size else b""
            if len(data) != size:
                self._error(handler, 400, "Incomplete upload body")
                return True
            if urlsplit(handler.path).path in {"/measurements", "/measurements/"}:
                path = "/"
                port, token = self._ensure()
                # Embedded workspace HTML is served only through the original app.
                connection = http.client.HTTPConnection("127.0.0.1", port, timeout=30)
                try:
                    connection.request("GET", path, headers={"X-Measurement-Internal-Token": token})
                    response = connection.getresponse(); status=response.status; headers=dict(response.getheaders()); content=response.read()
                finally:
                    connection.close()
            else:
                status, headers, content = self.request(handler.command, handler.path, data)
            handler.send_response(status)
            for key, value in headers.items():
                if key.lower() in {"content-type", "content-disposition", "cache-control", "x-content-type-options"}:
                    handler.send_header(key, value)
            handler.send_header("Content-Length", str(len(content)))
            handler.end_headers(); handler.wfile.write(content)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except (ValueError, json.JSONDecodeError) as exc:
            self._error(handler, 400, str(exc))
        except MeasurementRuntimeError as exc:
            self._error(handler, 503, str(exc))
        except Exception:
            self._error(handler, 503, "Measurement operation unavailable; inspect the local measurement-process.log. Refresh before retrying a write.")
        return True

    @staticmethod
    def _error(handler, status: int, message: str) -> None:
        body = json.dumps({"error": message}).encode()
        handler.send_response(status); handler.send_header("Content-Type", "application/json")
        handler.send_header("Content-Length", str(len(body))); handler.end_headers(); handler.wfile.write(body)

    def wrap(self, original_handler: type, *, authorize: Callable[[Any], bool]) -> type:
        """One-line server registration; the supplied existing auth runs before interception.

        authorize must return True, or write its own denial response and return False.
        Original methods retain control for every non-measurement route.
        """
        service = self
        def dispatch(method):
            def operation(handler):
                if service.handles(handler.path):
                    if authorize(handler): service.try_handle(handler)
                    return
                original = getattr(original_handler, "do_" + method, None)
                if original is None: handler.send_error(405)
                else: original(handler)
            return operation
        return type("Measured" + original_handler.__name__, (original_handler,),
                    {"do_" + method: dispatch(method) for method in ("GET", "POST", "PUT")})

    def close(self) -> None:
        with self._lock:
            self._closed = True
            process = self._process
            if process is not None and process.poll() is None:
                # The managed engine's existing stdin-end route stops accepting
                # connections and waits for active HTTP requests before SQLite
                # closes. Do not turn an ordinary close into TerminateProcess
                # after three seconds while an import/export is committing.
                if process.stdin is not None:
                    try:
                        process.stdin.close()
                    except BrokenPipeError:
                        pass
                process.wait()
            self._release_child()
