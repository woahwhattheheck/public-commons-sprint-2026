"""Native VGI process lifetime inside the existing private buyer workspace."""
from __future__ import annotations

from datetime import datetime, timezone
import fcntl
import hashlib
import importlib.metadata
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import re
import stat
import threading

from ..errors import StateError
from ..storage import digest, dump, parse, read

SDK_COMMIT = "bf8b0b3902e1ff165ac413e4a216801f03ed8693"
RPC_COMMIT = "ca89b6d9c0d793cf8d708103d9cd1abf5f808271"
VERSIONS = {"vgi-python": "0.43.1", "vgi-rpc": "0.51.0",
            "duckdb": "1.5.6", "waitress": "3.0.2"}
SOURCE_FILES = (
    ("vgi", "serve.py", "395fc1161602340dbb8f4e4c6975483fc6c79589"),
    ("vgi", "catalog/descriptors.py", "c33e2f950517c382a7bdf29b97b7464b60a0b58b"),
    ("vgi", "table_function.py", "2405b25eef83ec8bc832e495baf622449e96bb01"),
    ("vgi", "client/client.py", "3d6c83db181e670ee7ea03fa457e29a2261cfe03"),
    ("vgi", "function_storage.py", "dfe2e6f6adc264780b2e50fb92393e26ea3a756e"),
    ("vgi_rpc", "http/server/_middleware.py", "30a3b0f0721d7ab6b156c4ba6b5502a29f113bd6"),
)
_REQUEST = re.compile(r"^[a-f0-9]{32}$")
_MAX_RECORD = 8 * 1024 * 1024


def _now():
    return datetime.now(timezone.utc).isoformat()


def _need(ok, code):
    if not ok:
        raise StateError(code)


def _request(value):
    _need(isinstance(value, str) and _REQUEST.fullmatch(value),
          "VGI_REQUEST_ID_REQUIRED")
    return value


def _json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def runtime_info():
    """Read the actual optional dependency and selected native source edition."""
    import sys
    installed = {}
    for name, expected in VERSIONS.items():
        try:
            actual = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            actual = None
        installed[name] = {"expected": expected, "installed": actual,
                           "matches": actual == expected}
    sources = []
    for package, relative, expected in SOURCE_FILES:
        actual = None
        try:
            spec = importlib.util.find_spec(package)
            _need(spec is not None and spec.submodule_search_locations,
                  "VGI_SELECTED_RUNTIME_REQUIRED")
            root = Path(next(iter(spec.submodule_search_locations)))
            raw = (root / relative).read_bytes()
            actual = hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()
        except (OSError, StateError, ModuleNotFoundError, ValueError):
            pass
        sources.append({"package": package, "path": relative, "git_blob": actual,
                        "expected_git_blob": expected, "matches": actual == expected})
    python_ok = sys.version_info >= (3, 13)
    return {"schema": "stellar-forge.vgi-runtime.v1",
            "python": {"version": list(sys.version_info[:3]), "executable": sys.executable,
                       "supported": python_ok},
            "packages": installed, "sources": sources,
            "sdk_commit": SDK_COMMIT, "rpc_commit": RPC_COMMIT,
            "ready": python_ok and all(x["matches"] for x in installed.values())
                     and all(x["matches"] for x in sources),
            "authentication": {
                "static_bearer_configured": bool(os.environ.get("VGI_BEARER_TOKENS")),
                "jwt_configured": bool(os.environ.get("VGI_JWT_ISSUER")
                                       and os.environ.get("VGI_JWT_AUDIENCE")),
                "proxy_proof_mode": os.environ.get("VGI_PROXY_PROOF_MODE", "off"),
            }}


def require_runtime():
    result = runtime_info()
    _need(result["ready"], "VGI_SELECTED_RUNTIME_REQUIRED")
    return result


def _lock_file(path):
    fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        _need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1
              and info.st_uid == os.getuid() and not info.st_mode & 0o077,
              "VGI_PRIVATE_RUNTIME_LOCK_REQUIRED")
        return os.fdopen(fd, "r+b", buffering=0)
    except BaseException:
        os.close(fd)
        raise


class HTTPRuntime:
    """Own one original vendor WSGI server, its lock and its launch receipt.

    The same native server can be started from the buyer operator or directly
    from the foreground CLI. A lock covers the actual listener lifetime. A
    saved PID is information; it is never used to signal an unrelated process.
    """

    def __init__(self, service):
        self.service = service
        self.workspace = service.workspace
        self.directory = self.workspace.directory
        self.record_path = self.directory / "vgi-launch.json"
        self.lock_path = self.directory / "vgi-http.lock"
        self._mutex = threading.RLock()
        self._server = None
        self._dispatcher = None
        self._map = None
        self._thread = None
        self._lock = None
        self._record = None
        self._failure = None

    def _retained(self):
        try:
            value = parse(read(self.record_path, _MAX_RECORD))
        except FileNotFoundError:
            return None
        identity = self.workspace.identity()
        _need(isinstance(value, dict)
              and value.get("schema") == "stellar-forge.vgi-launch.v1"
              and value.get("workspace_id") == identity["workspace_id"],
              "VGI_RUNTIME_RECEIPT_CHANGED")
        return value

    def state(self):
        with self._mutex:
            retained = self._record or self._retained()
            if self._thread is not None and self._thread.is_alive():
                return dict(retained or {}, observed="RUNNING", owned=True,
                            thread_alive=True, observed_at=_now())
            if self._server is not None:
                return dict(retained or {}, observed="FAILED", owned=True,
                            thread_alive=False, failure=self._failure,
                            observed_at=_now())
            handle = _lock_file(self.lock_path)
            try:
                try:
                    fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    return dict(retained or {}, observed="EXTERNAL_OWNER", owned=False,
                                observed_at=_now())
                status = retained.get("state") if retained else None
                observed = "INTERRUPTED" if status in {"STARTING", "RUNNING", "STOPPING"} \
                           else status or "STOPPED"
                return dict(retained or {}, observed=observed, owned=False,
                            observed_at=_now())
            finally:
                handle.close()

    def start(self, *, request_id, expected_revision, host="127.0.0.1", port=0,
              authenticate=None):
        request_id = _request(request_id)
        _need(type(expected_revision) is int and expected_revision >= 0,
              "VGI_SERVICE_REVISION_REQUIRED")
        _need(type(port) is int and 0 <= port <= 65535, "VGI_PORT_INVALID")
        _need(isinstance(host, str), "VGI_LISTEN_ADDRESS_INVALID")
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            raise StateError("VGI_LISTEN_ADDRESS_INVALID") from None
        # An exact numeric address makes the selected listener reproducible.
        host = str(address)
        request = {"request_id": request_id, "expected_revision": expected_revision,
                   "host": host, "port": port}
        request_sha = digest(_json(request))
        with self._mutex:
            if self._server is not None:
                current = self.state()
                _need(current.get("observed") == "RUNNING",
                      "VGI_RUNTIME_REQUIRES_STOP")
                _need(current.get("request_sha256") == request_sha,
                      "VGI_RUNTIME_ALREADY_OPEN")
                return dict(current, reopened=True)
            selected_runtime = require_runtime()
            selected = self.service.snapshot()
            _need(selected["revision"] == expected_revision,
                  "VGI_SERVICE_REVISION_CHANGED")
            handle = _lock_file(self.lock_path)
            try:
                try:
                    fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    raise StateError("VGI_RUNTIME_ALREADY_OPEN") from None
                prior = self._retained()
                if prior and prior.get("request_id") == request_id:
                    _need(prior.get("request_sha256") == request_sha,
                          "VGI_RUNTIME_ORIGINAL_REQUEST_CHANGED")
                    _need(prior.get("state") not in {"STOPPED"},
                          "VGI_RUNTIME_START_ALREADY_CLOSED")
                from .worker import create_http_app
                from waitress.server import create_server
                from waitress.task import ThreadedTaskDispatcher
                from vgi_rpc.http.server._serve import waitress_arrow_tuning

                # The vendor resolves authentication from the existing process
                # environment. Neither token values nor signing keys enter this
                # public runtime receipt or the private operator's JSON state.
                app, descriptor = create_http_app(
                    self.service, authenticate=authenticate, snapshot=selected)
                record = {"schema": "stellar-forge.vgi-launch.v1",
                          "workspace_id": selected["workspace_id"],
                          "service_id": selected["service_id"],
                          "request_id": request_id, "request_sha256": request_sha,
                          "request": request, "state": "STARTING", "pid": os.getpid(),
                          "started_at": _now(), "catalog": descriptor,
                          "runtime": selected_runtime}
                dump(self.record_path, record)
                socket_map = {}
                dispatcher = ThreadedTaskDispatcher()
                dispatcher.set_thread_count(2)
                server = None
                try:
                    tuning = waitress_arrow_tuning()
                    tuning.update({"host": host, "port": port, "threads": 2,
                                   "asyncore_loop_timeout": 0.2,
                                   "channel_timeout": 30,
                                   "clear_untrusted_proxy_headers": True})
                    server = create_server(app, map=socket_map,
                                           _dispatcher=dispatcher, **tuning)
                    actual_port = int(server.effective_port)
                    actual_host = str(server.effective_host)
                    url_host = "[" + actual_host + "]" if ":" in actual_host else actual_host
                    record.update({"state": "RUNNING", "host": actual_host,
                                   "port": actual_port,
                                   "address": "http://" + url_host + ":" + str(actual_port)})
                    dump(self.record_path, record)
                    self._server, self._dispatcher, self._map = server, dispatcher, socket_map
                    self._lock, self._record = handle, record
                    self._failure = None

                    def serve():
                        try:
                            server.run()
                        except BaseException as error:
                            self._failure = type(error).__name__

                    self._thread = threading.Thread(target=serve,
                        name="starforge-vgi-http", daemon=False)
                    self._thread.start()
                    return self.state()
                except BaseException:
                    from waitress import wasyncore
                    if server is not None:
                        server.close()
                    dispatcher.shutdown(cancel_pending=True, timeout=5)
                    wasyncore.close_all(socket_map)
                    self._server = self._dispatcher = self._map = self._thread = None
                    self._lock = self._record = None
                    raise
            except BaseException:
                handle.close()
                raise

    def stop(self, *, request_id=None):
        if request_id is not None:
            _request(request_id)
        with self._mutex:
            if self._server is None:
                observed = self.state()
                _need(observed.get("observed") != "EXTERNAL_OWNER",
                      "VGI_RUNTIME_EXTERNAL_OWNER")
                return dict(observed, stopped=True, reopened=True)
            retained = dict(self._record)
            if request_id is not None:
                _need(retained["request_id"] == request_id,
                      "VGI_RUNTIME_ORIGINAL_REQUEST_CHANGED")
            # Closing only the listener leaves established channels in Waitress'
            # private socket map. Shut down the original dispatcher and channels
            # as well before releasing the lifetime lock.
            retained.update({"state": "STOPPING", "stopping_at": _now()})
            try:
                dump(self.record_path, retained)
            except OSError:
                # Local receipt loss must not strand an owned live listener.
                pass
            server, dispatcher, socket_map, thread = (
                self._server, self._dispatcher, self._map, self._thread)
            server.close()
            dispatcher.shutdown(cancel_pending=True, timeout=10)
            from waitress import wasyncore
            wasyncore.close_all(socket_map)
            thread.join(timeout=10)
            with dispatcher.lock:
                workers_remain = bool(dispatcher.threads)
            _need(not thread.is_alive() and not workers_remain,
                  "VGI_RUNTIME_STOP_INCOMPLETE")
            self._server = self._dispatcher = self._map = self._thread = None
            retained.update({"state": "STOPPED", "stopped_at": _now()})
            self._record = retained
            try:
                dump(self.record_path, retained)
            finally:
                if self._lock is not None:
                    self._lock.close()
                    self._lock = None
            return dict(retained, observed="STOPPED", owned=False, stopped=True)

    def wait(self):
        thread = self._thread
        _need(thread is not None, "VGI_RUNTIME_NOT_STARTED")
        thread.join()
        _need(self._failure is None, "VGI_RUNTIME_FAILED")

    def close(self):
        if self._server is not None:
            self.stop()
