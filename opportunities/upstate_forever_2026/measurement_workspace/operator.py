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

BASE = "/api/measurement-workspace"
MAX_BODY = 128 * 1024 * 1024

class Measurements:
    def __init__(self, workspace: Any, *, data_dir: str | Path,
                 reaches: Callable[[Any], list[dict]], node: str = "node") -> None:
        self.workspace = workspace
        self.directory = Path(data_dir).resolve()
        self.directory.mkdir(parents=True, exist_ok=True)
        self.reach_resolver = reaches
        self.node = shutil.which(node)
        if self.node is None:
            raise RuntimeError("Node 22.16 or newer is required for the measurement SQLite engine")
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

    def _ensure(self) -> tuple[int, str]:
        with self._lock:
            if self._closed:
                raise RuntimeError("Measurement service is closed")
            self._sync_reaches()
            if self._process and self._process.poll() is None:
                return self._port, self._token
            if self._process:
                for stream in (self._process.stdin, self._process.stdout):
                    if stream: stream.close()
            if self._log:
                self._log.close()
            self._log = (self.directory / "measurement-process.log").open("ab", buffering=0)
            env = {**os.environ, "MEASUREMENTS_INTERNAL_TOKEN": self._token}
            env['MEASUREMENTS_PYTHON'] = sys.executable
            command = [self.node, str(Path(__file__).parent / "engine" / "cli.mjs"),
                       "serve", "--workspace", str(self.directory), "--host", "127.0.0.1", "--port", "0"]
            process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                       stderr=self._log, env=env, close_fds=True)
            self._process = process
            ready = queue.Queue()
            threading.Thread(target=lambda: ready.put(process.stdout.readline()), daemon=True).start()
            try:
                line = ready.get(timeout=12)
                value = json.loads(line)
                if not value.get("ready") or value.get("host") != "127.0.0.1" or not isinstance(value.get("port"), int):
                    raise ValueError("Invalid measurement child readiness")
                self._port = value["port"]
            except Exception as exc:
                process.kill(); process.wait(timeout=5)
                raise RuntimeError("Measurement engine did not start; inspect measurement-process.log") from exc
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
        return p == BASE or p.startswith(BASE + "/") or p in {"/measurements", "/measurements/", "/measurements/workspace.js", "/measurements/workspace.css", "/measurements/collections.mjs", "/measurements/large_files.mjs"}

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
            if self._process and self._process.poll() is None:
                if self._process.stdin: self._process.stdin.close()
                try: self._process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    self._process.terminate()
                    try: self._process.wait(timeout=3)
                    except subprocess.TimeoutExpired: self._process.kill(); self._process.wait(timeout=3)
            if self._log: self._log.close(); self._log = None
