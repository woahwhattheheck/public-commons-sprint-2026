"""Lifecycle of the optional outbound transport in the original workbench launcher.

Only private receiving-machine state selects this service. Scientific exports
retain this source and never copy its configuration, credentials or journal.
"""
from __future__ import annotations
import argparse
import contextlib
import ctypes
import importlib.util
import json
import os
from pathlib import Path
import queue
import re
import runpy
import signal
import socket
import stat
import subprocess
import sys
import threading
import time

SCHEMA = "upstate.workbench-transport-opening/v1"
LIMIT = 256 * 1024


def _private_json(path):
    path = Path(path)
    if path.is_symlink():
        raise ValueError("The private transport selection cannot be a symbolic link")
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > LIMIT:
            raise ValueError("Choose a bounded regular private transport JSON file")
        if os.name == "posix" and (info.st_uid != os.getuid() or info.st_mode & 0o077):
            raise ValueError("The transport selection must be owned by this user with mode 0600")
        body = stream.read(LIMIT + 1)
        if len(body) != info.st_size:
            raise ValueError("The private transport selection changed while it was read")
    value = json.loads(body)
    if not isinstance(value, dict):
        raise ValueError("The private transport selection must be a JSON object")
    return value


def _outside(path, selection):
    resolved = Path(path).resolve()
    for key in ("application", "workspace"):
        root = Path(selection[key]).resolve()
        if resolved == root or root in resolved.parents:
            raise ValueError("Keep transport configuration and state outside application and scientific Workspace directories")
    return Path(path).expanduser().absolute()


def _write_private(path, value):
    temporary = path.with_name("." + path.name + "-" + os.urandom(8).hex())
    body = (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    try:
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        if path.is_symlink():
            raise ValueError("Private transport state cannot be a symbolic link")
        os.replace(temporary, path)
        if os.name == "posix":
            fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
    finally:
        with contextlib.suppress(FileNotFoundError):
            temporary.unlink()


def prepare(selection, state, configured=None):
    """Resolve private configuration before starting/verifying the native origin."""
    state = Path(state).resolve()
    pointer = state / "workbench-transport.json"
    explicit = configured is not None
    if explicit:
        path = Path(configured).expanduser().absolute()
    elif pointer.exists():
        retained = _private_json(pointer)
        if (retained.get("schema") != SCHEMA or retained.get("hostname") != socket.gethostname()
                or retained.get("application") != selection["application"]
                or retained.get("project_id") != selection["project_id"]):
            raise ValueError("The private transport selection belongs to another original receiving session")
        path = Path(retained["config"])
    else:
        path = state / "eco-transport.json"
        if not path.exists():
            return None
    path = _outside(path, selection)
    data = _private_json(path)
    if data.get("schema") != "upstate.eco-native-connector/v1":
        raise ValueError("Choose the original native HTTPS connector configuration")
    if sys.platform != "linux":
        raise ValueError("This configured outbound connector requires the qualified Linux receiving runtime")
    def selected_path(key):
        value = data.get(key)
        if not isinstance(value, str) or not value:
            raise ValueError("The private transport configuration requires " + key)
        return (path.parent / value).resolve()
    application = selected_path("application")
    session = selected_path("native_session_file")
    if application != Path(selection["application"]).resolve() or session != state / "workbench-session.json":
        raise ValueError("The transport must select this exact application and its original private workbench-session.json")
    _outside(selected_path("state_directory"), selection)
    for key in ("connector_token_file", "native_token_file"):
        if data.get(key):
            _outside(selected_path(key), selection)
    if not data.get("connector_token_file") or "connector_token" in data or "native_token" in data:
        raise ValueError("Select the existing private connector credential file; keep credentials outside the launch selection")
    origin_policy = runpy.run_path(str(application / "operator/origin_policy.py"))
    origin = origin_policy["advertised_origin"](data.get("edge_origin"))
    if origin is None:
        raise ValueError("The private transport configuration requires its exact existing HTTPS edge_origin")
    if selection.get("advertised_origin") is not None and selection["advertised_origin"] != origin:
        raise ValueError("The private connector origin differs from the original selected advertised HTTPS origin")
    selection["advertised_origin"] = origin
    required = ("source_tools/eco_native_connector.py", "source_tools/workbench_transport.py",
                "integration/NATIVE_HTTPS_CONNECTOR.md",
                "integration/component_fragments/native-https-connector.json")
    if any(not (application / relative).is_file() for relative in required):
        raise ValueError("Receive the complete native HTTPS connector and lifecycle source before enabling it")
    return {"config": str(path), "state": str(state), "explicit": explicit,
            "application": str(application), "project_id": selection["project_id"],
            "python": selection["python"]}


class Controller:
    """Own one child inside the existing launcher, never an additional operator."""
    def __init__(self, prepared, record, verify_existing):
        self.prepared, self.record = prepared, record
        self.verify_existing = verify_existing
        self.next_native_check = 0.0
        self.native_alive = True
        self.root = Path(prepared["state"])
        self.process = None
        self.owner = None
        self.events = queue.Queue()
        self.reused = False
        self.phase = "configured"
        self.code = None
        self.retry_at = None
        self.delay = 1
        self.last_signature = None
        self.closed = False
        self.terminal_error = False

    def _status(self):
        return {"schema": SCHEMA, "hostname": socket.gethostname(),
                "state": self.phase, "code": self.code,
                "owner_pid": os.getpid(),
                "connector_pid": self.process.pid if self.process and self.process.poll() is None else None,
                "project_id": self.prepared["project_id"],
                "workspace_key": self.record["workspace_key"]}

    def _publish(self, phase, code=None):
        changed = self.phase != phase or self.code != code
        self.phase, self.code = phase, code
        _write_private(self.root / "workbench-transport-status.json", self._status())
        if changed:
            value = {"event": "workbench_https", "state": phase}
            if code:
                value["code"] = code
            print(json.dumps(value, sort_keys=True), flush=True)

    def _signature(self):
        paths = [Path(self.prepared["config"]),
                 Path(self.prepared["application"]) / "source_tools/eco_native_connector.py"]
        try:
            data = _private_json(paths[0])
            for key in ("connector_token_file", "native_token_file"):
                if data.get(key):
                    paths.append((paths[0].parent / data[key]).resolve())
            return tuple((str(p), p.stat().st_mtime_ns, p.stat().st_size) for p in paths)
        except (OSError, ValueError, TypeError):
            return None

    def start(self):
        import fcntl
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        flags = os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(self.root / ".workbench-transport-owner.lock", flags, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            os.close(fd)
            self.reused = True
            print(json.dumps({"event": "workbench_https", "state": "existing-owner"}), flush=True)
            return
        except BaseException:
            os.close(fd)
            raise
        self.owner = fd
        _write_private(self.root / "workbench-transport.json", {
            "schema": SCHEMA, "hostname": socket.gethostname(),
            "config": self.prepared["config"], "application": self.prepared["application"],
            "project_id": self.prepared["project_id"]})
        self._spawn()

    def _spawn(self):
        self.last_signature = self._signature()
        command = [self.prepared["python"], "-I", "-B",
                   str(Path(self.prepared["application"]) / "source_tools/workbench_transport.py"),
                   "--run-native", "--config", self.prepared["config"],
                   "--parent-pid", str(os.getpid())]
        self.code = None
        self.terminal_error = False
        interrupted = []
        previous = None
        if (threading.current_thread() is threading.main_thread()
                and signal.getsignal(signal.SIGINT) is signal.default_int_handler):
            previous = signal.signal(signal.SIGINT, lambda signum, frame: interrupted.append(signum))
        try:
            self.process = subprocess.Popen(command, cwd=self.prepared["application"],
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding="utf-8", errors="replace", bufsize=1, start_new_session=True)
        finally:
            if previous is not None:
                signal.signal(signal.SIGINT, previous)
        if interrupted:
            raise KeyboardInterrupt
        child = self.process
        def collect():
            assert child.stdout is not None
            try:
                for line in child.stdout:
                    if len(line) > 4096:
                        continue
                    try:
                        value = json.loads(line)
                    except ValueError:
                        continue
                    if isinstance(value, dict):
                        self.events.put((child.pid, value))
            finally:
                child.stdout.close()
        threading.Thread(target=collect, name="workbench-https-output", daemon=True).start()
        self.retry_at = None
        self._publish("connecting")

    def poll(self):
        if self.reused or self.closed:
            return
        while True:
            try:
                pid, value = self.events.get_nowait()
            except queue.Empty:
                break
            if not self.process or pid != self.process.pid:
                continue
            code = value.get("code")
            if not isinstance(code, str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,95}", code):
                code = None
            event = value.get("event")
            if event == "connected":
                self.delay = 1
                self._publish("connected")
            elif event in ("connector_error", "reconnecting", "startup_retry"):
                if event == "connector_error":
                    self.terminal_error = True
                self._publish("error" if event == "connector_error" else "reconnecting", code)
        if self.process is not None and self.process.poll() is not None:
            if self.phase != "stopped":
                self._publish("stopped", self.code or "CONNECTOR_PROCESS_EXITED")
            signature = self._signature()
            # Fatal native/auth/config errors remain visible. A changed original
            # credential/config/source is received by a new child using the SAME journal.
            if self.terminal_error:
                if signature is not None and signature != self.last_signature:
                    self._spawn()
                return
            if self.retry_at is None:
                self.retry_at = time.monotonic() + self.delay
                self.delay = min(30, self.delay * 2)
            elif time.monotonic() >= self.retry_at:
                self._spawn()

    def native_present(self):
        # Reuse the original launcher\'s authenticated session verification. This
        # is only needed when this terminal owns transport for an existing server.
        if time.monotonic() < self.next_native_check:
            return self.native_alive
        self.next_native_check = time.monotonic() + 5
        try:
            self.native_alive = self.verify_existing() is not None
        except (OSError, ValueError, RuntimeError):
            self.native_alive = False
        return self.native_alive

    def close(self):
        if self.closed or self.reused:
            return
        self.closed = True
        try:
            if self.process is not None and self.process.poll() is None:
                try:
                    self.process.terminate()
                except ProcessLookupError:
                    pass
                deadline = time.monotonic() + 15
                forced = False
                while self.process.poll() is None:
                    try:
                        if not forced and time.monotonic() >= deadline:
                            # Only this Popen child is terminated. The original native
                            # server/task and durable transport journal remain intact.
                            try:
                                self.process.kill()
                            except ProcessLookupError:
                                pass
                            forced = True
                        self.process.wait(timeout=.5)
                    except subprocess.TimeoutExpired:
                        pass
                    except KeyboardInterrupt:
                        pass
        finally:
            if self.owner is not None:
                try:
                    self._publish("closed", self.code)
                finally:
                    os.close(self.owner)
                    self.owner = None


def _run_native(config, parent_pid):
    # The existing selected Linux process is also the service lifetime owner.
    # If its launcher dies, preserve the original journal and stop accepting work.
    if sys.platform != "linux" or os.getppid() != parent_pid:
        raise RuntimeError("The original Linux workbench launcher must own this connector")
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(1, signal.SIGTERM, 0, 0, 0) != 0:
        raise OSError(ctypes.get_errno(), "Could not bind the connector to its original launcher")
    if os.getppid() != parent_pid:
        return 1
    source = Path(__file__).resolve().with_name("eco_native_connector.py")
    spec = importlib.util.spec_from_file_location("_workbench_native_https", source)
    if spec is None or spec.loader is None:
        raise RuntimeError("The complete original connector source is required")
    native = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(native)
    return native.main(["--config", str(config)])


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-native", action="store_true", required=True)
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--parent-pid", required=True, type=int)
    args = parser.parse_args(argv)
    try:
        return _run_native(args.config, args.parent_pid)
    except (OSError, ValueError, RuntimeError) as error:
        print(json.dumps({"event": "connector_error", "code": type(error).__name__}), flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
