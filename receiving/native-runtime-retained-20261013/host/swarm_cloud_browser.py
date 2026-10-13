#!/usr/bin/env python3
"""Reuse one native Chromium inside the original cloud worker's namespace.

Run swarm-worker browser serve through the existing native run/start command.
Clients on other exec namespaces use the original retained file transport.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import queue
import re
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from integrations.shared_equipment.requester_file_queue import (
    FileQueueClient, FileQueueError, read_record, request_deadline_expired, valid_id, write_record,
)
from integrations.shared_equipment.requester_file_runtime import RequesterFileRuntime, _redact
import swarm_cloud_job as native

SCHEMA = "commons.native-cloud-browser/v1"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def hash_file(path):
    result = hashlib.sha256()
    with Path(path).open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def select_native_host(path):
    """Compose an already-equipped original engine without copying its runtime."""
    global native
    if not path:
        return
    directory = Path(path).expanduser().resolve(strict=True)
    source = directory / "swarm_cloud_job.py"
    require(source.is_file(), "The selected native host must contain its original job engine.")
    sys.path.insert(0, str(directory))
    spec = importlib.util.spec_from_file_location("swarm_cloud_job", source)
    module = importlib.util.module_from_spec(spec)
    sys.modules["swarm_cloud_job"] = module
    spec.loader.exec_module(module)
    native = module


def private_directory(path):
    path = Path(path).expanduser().absolute()
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    require(path.is_dir() and not path.is_symlink(), "Use a real operation directory.")
    return path


def prepared(value, operation_id=None):
    """Pin the actual journey source before the existing queue accepts intent."""
    require(isinstance(value, dict), "The browser request must be a JSON object.")
    value = dict(value)
    value["kind"] = "browser.run"
    value["operation_id"] = valid_id(operation_id or value.get("operation_id"))
    project = Path(value["project"]).expanduser().resolve(strict=True)
    module = Path(value["module"]).expanduser().resolve(strict=True)
    require(project.is_dir() and module.is_file(), "Select an existing project and journey module.")
    observed = hash_file(module)
    if value.get("module_sha256"):
        require(value["module_sha256"] == observed, "The selected journey source changed.")
    value.update(project=str(project), module=str(module), module_sha256=observed)
    require(isinstance(value.get("parameters", {}), dict), "Journey parameters must be an object.")
    require(isinstance(value.get("context", {}), dict), "Browser context options must be an object.")
    duration = value.get("timeout_seconds", 300)
    require(isinstance(duration, (int, float)) and not isinstance(duration, bool) and 0 < duration <= 86400,
            "Choose a positive journey timeout up to one day.")
    require(not request_deadline_expired(value), "The original browser deadline has expired.")
    value["artifacts"] = native.artifact_paths(project, value.get("artifacts", []))
    servers = value.get("servers", [])
    require(isinstance(servers, list), "Product servers must be an array.")
    names = set()
    for server in servers:
        require(isinstance(server, dict), "Each product server must be an object.")
        name = server.get("name")
        require(isinstance(name, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,39}", name),
                "Use a short stable server name.")
        require(name not in names, "Each product server needs a distinct name.")
        names.add(name)
        command = server.get("command")
        require(isinstance(command, list) and command and
                all(isinstance(part, str) and "\0" not in part for part in command) and command[0],
                "Each product server needs its exact executable and argument array.")
        ready = server.get("ready_url")
        require(isinstance(ready, str), "Each product server needs its actual readiness URL.")
        parsed = urllib.parse.urlsplit(ready.replace("{port}", "12345"))
        require(parsed.scheme in {"http", "https"} and parsed.hostname in {"localhost", "127.0.0.1", "::1"}
                and not parsed.username and not parsed.password,
                "Use the product server's local readiness URL.")
        ready_seconds = server.get("ready_timeout_seconds", 45)
        require(isinstance(ready_seconds, (int, float)) and not isinstance(ready_seconds, bool)
                and 0 < ready_seconds <= duration, "Server readiness must fit the journey deadline.")
        statuses = server.get("ready_statuses", [200])
        require(isinstance(statuses, list) and statuses and
                all(isinstance(status, int) and 100 <= status <= 599 for status in statuses),
                "Use actual HTTP readiness status codes.")
        if server.get("project"):
            require(Path(server["project"]).is_dir(), "The product server project must exist.")
    return value


def browser_status(runtime, browser):
    """Join last browser state to its original driver's observed generation."""
    if not isinstance(browser, dict):
        return browser
    driver = runtime.get("browser_driver") if isinstance(runtime, dict) else None
    if not isinstance(driver, dict):
        return browser
    driver = dict(driver)
    result = {**browser, "driver": driver}
    same = (driver.get("driver_id") is not None
            and browser.get("driver_id") == driver["driver_id"]
            and browser.get("runtime_generation") == driver.get("runtime_generation"))
    if not same:
        result.update(state="previous_generation", last_reported_state=browser.get("state"))
        return result
    # A later reader may observe the ended original process even if its parent
    # died before reaping it. Preserve unknown exit code and signal in that case.
    if driver.get("state") not in {"exited", "not_started"}:
        identity = driver.get("process")
        if identity and native.alive(identity):
            driver["liveness"] = "alive"
        elif identity and getattr(native, "_supervisor_ended", lambda _: False)(identity):
            driver["liveness"] = "ended"
            driver["state"] = "ended_without_exit_observation"
        else:
            driver["liveness"] = "unavailable"
    state = driver.get("state")
    if state in {"exited", "ended_without_exit_observation"}:
        result.update(state="closed" if driver.get("browser_closed") is True else "driver_exited",
                      last_reported_state=browser.get("state"))
    elif state == "response_pipe_closed":
        result.update(state="driver_response_closed", last_reported_state=browser.get("state"))
    elif driver.get("liveness") == "unavailable":
        result.update(state="driver_unobserved", last_reported_state=browser.get("state"))
    return result


class Driver:
    """One owned child and a retained observation for its exact runtime generation."""
    def __init__(self, owner):
        self.owner = owner
        self.process = None
        self.replies = queue.Queue()
        self._write_lock = threading.Lock()
        self._state_lock = threading.RLock()
        self._observation = None
        self._reader = None

    def _observe(self, process=None, observation=None):
        with self._state_lock:
            observation = self._observation if observation is None else observation
            process = self.process if process is None else process
            if observation is None:
                return {"runtime_generation": self.owner.runtime_id, "driver_id": None,
                        "state": "not_started", "exit_code": None, "signal": None,
                        "browser_closed": True}
            if process is not None:
                code = process.poll()
                if code is not None:
                    observation.update(state="exited", exit_code=code,
                                       signal=-code if code < 0 else None)
                    observation.setdefault("exit_observed_at", time.time())
                elif observation.get("response_pipe_closed"):
                    observation["state"] = "response_pipe_closed"
            return dict(observation)

    def report(self):
        return self._observe()

    def _read(self, descriptor, replies, process, observation):
        try:
            with os.fdopen(descriptor, "rb") as source:
                for line in source:
                    try:
                        response = json.loads(line)
                        if response.get("event") == "idle_shutdown":
                            with self._state_lock:
                                observation["browser_closed"] = True if response.get("browser_closed") is True else None
                                observation["browser_close"] = {key: response[key] for key in
                                    ("browser_closed", "close_method", "cleanup_errors", "error") if key in response}
                                current = self._observation is observation
                            if current:
                                self.owner.stop_requested.set()
                                self.owner._announce()
                        else:
                            replies.put(response)
                    except (ValueError, UnicodeError):
                        replies.put({"pipe_error": "browser_driver_response_invalid"})
        finally:
            # EOF can precede waitpid by a scheduling turn. Only this parent's
            # Popen supplies an exit code; an absent/unreadable PID does not.
            try:
                process.wait(timeout=0.25)
            except subprocess.TimeoutExpired:
                pass
            with self._state_lock:
                observation["response_pipe_closed"] = True
                current = self._observation is observation
            observed = self._observe(process, observation)
            if current:
                # Complete this original result and retire the broken owner.
                # Unattempted requests retain the existing generation continuation.
                self.owner.stop_requested.set()
                self.owner._announce()
            replies.put({"pipe_error": "browser_driver_ended", "driver": observed})

    def start(self):
        if self.process and self.process.poll() is None:
            require(not self.report().get("response_pipe_closed"),
                    "The original browser driver response channel ended.")
            return
        require(not self.owner.stop_requested.is_set(), "The original browser runtime is stopping.")
        if self.process:
            self.close()
            require(not self.owner.stop_requested.is_set(), "The original browser runtime is stopping.")
        args = self.owner.options
        read_fd, write_fd = os.pipe()
        log_fd = os.open(self.owner.queue.root / "browser.log",
                         os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
        self.replies = queue.Queue()
        environment = dict(os.environ, SWARM_BROWSER_RESPONSE_FD=str(write_fd),
                           TMPDIR=str(self.owner.browser_temp))
        try:
            process = subprocess.Popen(
                [args.node_executable, str(Path(__file__).with_suffix(".mjs"))],
                stdin=subprocess.PIPE, stdout=log_fd, stderr=log_fd, env=environment,
                pass_fds=(write_fd,), close_fds=True)
            with self._state_lock:
                self.process = process
                self._observation = {"driver_id": uuid.uuid4().hex,
                    "runtime_generation": self.owner.runtime_id,
                    "pid": process.pid, "pid_scope": "requesting-runtime",
                    "process": getattr(native, "child_process_identity", native.process_identity)(process.pid),
                    "state": "running", "started_at": time.time(),
                    "exit_code": None, "signal": None, "browser_closed": None,
                    "response_pipe_closed": False, "stop_method": None}
                observation = self._observation
        except BaseException:
            os.close(read_fd)
            raise
        finally:
            os.close(write_fd)
            os.close(log_fd)
        self._reader = threading.Thread(target=self._read,
            args=(read_fd, self.replies, process, observation), daemon=True,
            name="native-browser-replies")
        self._reader.start()
        self.owner._announce()
        try:
            result = self.call("configure", {
                "playwright_module": args.playwright_module, "executable": args.executable,
                "browser_args": args.browser_arg, "idle_seconds": args.idle_seconds,
                "temporary_root": str(self.owner.browser_temp),
                "state_path": str(self.owner.queue.root / "browser-state.json"),
                "driver_id": observation["driver_id"],
                "runtime_generation": self.owner.runtime_id,
            }, timeout=30, ensure=False)
            require(result.get("ok"), "The existing browser dependencies could not initialize; inspect browser.log.")
        except Exception:
            self.close()
            raise

    def call(self, method, value, *, timeout, ensure=True):
        if ensure:
            self.start()
        request_id = uuid.uuid4().hex
        data = json.dumps({"id": request_id, "method": method, "value": value},
                          ensure_ascii=False, allow_nan=False).encode("utf-8") + b"\n"
        with self._write_lock:
            require(self.process and self.process.poll() is None, "The browser driver is not running.")
            self.process.stdin.write(data)
            self.process.stdin.flush()
        deadline = time.monotonic() + timeout
        while True:
            if self.owner.abort_requested.is_set() and method != "shutdown":
                self.abort()
                raise RuntimeError("browser_operation_stopped")
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                self.abort()
                raise TimeoutError("browser_driver_response_timeout")
            try:
                reply = self.replies.get(timeout=min(0.2, remaining))
            except queue.Empty:
                continue
            if reply.get("pipe_error"):
                raise RuntimeError(reply["pipe_error"])
            require(reply.get("id") == request_id, "The browser response identity changed.")
            result = reply["result"]
            if method == "shutdown":
                with self._state_lock:
                    self._observation["browser_closed"] = True if result.get("browser_closed") is True else None
                    self._observation["browser_close"] = {key: result[key] for key in
                        ("browser_closed", "close_method", "cleanup_errors", "error") if key in result}
            return result

    def abort(self):
        process = self.process
        if process and process.poll() is None:
            with self._state_lock:
                self._observation["stop_method"] = "terminate"
            process.terminate()

    def close(self):
        process = self.process
        if not process:
            return self.report()
        if process.poll() is None:
            with self._state_lock:
                self._observation["stop_method"] = "shutdown"
            try:
                self.call("shutdown", {}, timeout=8, ensure=False)
            except (OSError, ValueError, RuntimeError):
                self.abort()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                with self._state_lock:
                    self._observation["stop_method"] = "kill_after_shutdown_timeout"
                process.kill()
                process.wait()
        self._observe(process, self._observation)
        if process.stdin:
            try:
                process.stdin.close()
            except OSError:
                pass
        self.process = None
        if self._reader and self._reader is not threading.current_thread():
            self._reader.join(timeout=1)
        self.owner._announce()
        return self.report()


class BrowserRuntime(RequesterFileRuntime):
    def __init__(self, options):
        super().__init__(options.queue, credential_refs=(), workers=1)
        self.options = options
        self.temporary = private_directory(options.temp_root)
        self.browser_temp = private_directory(self.temporary / "browser")
        self.abort_requested = threading.Event()
        self.driver = Driver(self)
        self._servers = {}
        self._server_owners = {}
        self._recovered_servers = None
        self._active_browser = None

    def metadata(self):
        value = super().metadata()
        value.update(runtime_kind=SCHEMA, peer=self.options.peer,
                     temporary_root=str(self.temporary), records_root=str(native.runs_root(self.options.records_root)),
                     active_operation=self._active_browser, native_host=str(Path(native.__file__).parent),
                     recovered_servers=self._recovered_servers, browser_driver=self.driver.report())
        return value

    def _save_server_owners(self):
        self._storage_call("browser_server_ownership", lambda: write_record(
            self.queue.root / "browser-servers.json",
            {"schema": SCHEMA + "/servers", "executions": list(self._server_owners.values())}, replace=True))

    def on_runtime_acquired(self):
        retained = read_record(self.queue.root / "browser-servers.json")
        if retained is None:
            return
        require(retained.get("schema") == SCHEMA + "/servers" and isinstance(retained.get("executions"), list),
                "The original browser server ownership record is invalid.")
        for entry in retained["executions"]:
            request = self.queue.request(valid_id(entry["job_id"]))
            claim = read_record(self.queue.path("claims", entry["job_id"]))
            require(request and request["payload"].get("kind") == "browser.run" and claim
                    and request["payload_sha256"] == entry["payload_sha256"] == claim["payload_sha256"],
                    "The owned server must retain its original claimed browser request.")
            require(entry["server_name"] in {server["name"] for server in request["payload"].get("servers", [])},
                    "The retained server is absent from the original browser request.")
            operation = "browser-server-" + hashlib.sha256(
                (request["payload"]["operation_id"] + "\0" + entry["server_name"]).encode()).hexdigest()[:32]
            root = Path(entry["record"]).resolve()
            require(root == native.run_path(operation, str(root.parent))
                    and entry["intent"].get("operation_id") == operation,
                    "The owned server's original native identity changed.")
            original = native.read_json(root / "request.json")
            require(original is None or original.get("intent") == entry["intent"],
                    "The retained server command differs from the original owned intent.")
            self._servers[operation] = root
            self._server_owners[operation] = entry
        self._recovered_servers = self._stop_servers()
        require(not self._recovered_servers["errors"],
                "The original product server cleanup is still pending; inspect its retained native record.")

    def on_runtime_releasing(self):
        try:
            self._stop_servers()
        finally:
            self.driver.close()
            self._storage_call("browser_driver_final", self._publish_metadata)

    def signal_stop(self):
        self.abort_requested.set()
        self.stop_requested.set()
        self.driver.abort()
        for root in list(self._servers.values()):
            try:
                native.stop(root)
            except (OSError, ValueError):
                pass

    def _start_servers(self, request, value, temporary, deadline):
        endpoints, reports = {}, []
        for server in value.get("servers", []):
            require(time.monotonic() < deadline, "The original browser deadline has expired.")
            require(not self.abort_requested.is_set(), "The original worker was stopped.")
            name = server["name"]
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as reservation:
                reservation.bind(("127.0.0.1", 0))
                port = reservation.getsockname()[1]
            command = [part.replace("{port}", str(port)) for part in server["command"]]
            ready_url = server["ready_url"].replace("{port}", str(port))
            base_url = server.get("base_url", ready_url).replace("{port}", str(port))
            suffix = hashlib.sha256((value["operation_id"] + "\0" + name).encode()).hexdigest()[:32]
            operation = "browser-server-" + suffix
            root = native.run_path(operation, self.options.records_root)
            require(not (root / "request.json").exists(),
                    "This product server already has retained execution; inspect it.")
            args = argparse.Namespace(operation_id=operation, peer=self.options.peer,
                project=str(Path(server.get("project", value["project"])).resolve()), command=command,
                java=None, node=None, artifact=[], records_root=self.options.records_root,
                worker_root=self.options.worker_root, temp_root=str(private_directory(temporary / name)),
                memory_mib=None, memory_reclaim="none")
            intent = {"operation_id": operation, "peer": args.peer, "project": args.project,
                      "command": command, "java": None, "node": None, "artifacts": []}
            for key in ("worker_root", "temp_root"):
                if getattr(args, key):
                    intent[key] = str(Path(getattr(args, key)).expanduser().resolve())
            self._servers[operation] = root
            self._server_owners[operation] = {"job_id": request["job_id"], "server_name": name,
                "payload_sha256": request["payload_sha256"], "record": str(root), "intent": intent}
            # Ownership precedes launch. A replacement of this queue can stop
            # the exact original child supervisors without replaying a journey.
            self._save_server_owners()
            require(time.monotonic() < deadline, "The original browser deadline has expired.")
            report = native.start(args)
            require(not report.get("reused"), "This product server already has retained execution; inspect it.")
            reports.append({"name": name, "operation_id": operation, "record": str(root), "base_url": base_url})
            ready_deadline = min(deadline, time.monotonic() + server.get("ready_timeout_seconds", 45))
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            while True:
                require(not self.abort_requested.is_set(), "The original worker was stopped.")
                state = native.inspect(root)
                if state.get("state") in native.TERMINAL or state.get("state") in {"interrupted", "orphaned_running"}:
                    raise RuntimeError("product_server_ended_before_readiness:" + name)
                try:
                    ready_request = urllib.request.Request(ready_url, method="GET")
                    try:
                        response = opener.open(ready_request, timeout=min(1, max(0.1, ready_deadline - time.monotonic())))
                    except urllib.error.HTTPError as error:
                        response = error
                    with response:
                        if response.status in server.get("ready_statuses", [200]):
                            break
                except (OSError, urllib.error.URLError):
                    pass
                if time.monotonic() >= ready_deadline:
                    raise TimeoutError("product_server_readiness_timeout:" + name)
                self.abort_requested.wait(0.1)
            endpoints[name] = base_url
        return endpoints, reports

    def _stop_servers(self):
        owned = dict(self._servers)
        errors = []
        for operation, root in owned.items():
            if not (root / "request.json").exists():
                self._servers.pop(operation, None)
                self._server_owners.pop(operation, None)
                continue
            try:
                native.stop(root)
            except (OSError, ValueError) as error:
                errors.append({"operation_id": operation, "error_type": type(error).__name__})
        deadline = time.monotonic() + 10
        reports = []
        while self._servers and time.monotonic() < deadline:
            for operation, root in list(self._servers.items()):
                try:
                    report = native.inspect(root)
                    if not report.get("process_alive") and not report.get("supervisor_alive"):
                        reports.append({"operation_id": operation, "state": report["state"],
                                        "exit_code": report.get("exit_code"), "record": str(root)})
                        self._servers.pop(operation, None)
                        self._server_owners.pop(operation, None)
                except (OSError, ValueError):
                    pass
            if self._servers:
                time.sleep(0.1)
        for operation, root in self._servers.items():
            errors.append({"operation_id": operation, "error": "product_server_cleanup_pending",
                           "record": str(root)})
        if errors:
            self.stop_requested.set()
        self._save_server_owners()
        return {"servers": reports, "errors": errors}

    def _run(self, request):
        value = prepared(request["payload"])
        root_job_id = request.get("rebind", {}).get("root_job_id", request["job_id"])
        require(value["operation_id"] == root_job_id,
                "The browser operation must retain its original workflow ID.")
        temporary = private_directory(self.temporary / "operations" / value["operation_id"])
        self._active_browser = value["operation_id"]
        self._announce()
        attempted = False
        outcome, servers = {}, []
        try:
            allowance = value.get("timeout_seconds", 300)
            if value.get("deadline_at") is not None:
                allowance = min(allowance, value["deadline_at"] - time.time())
            require(allowance > 0, "The original browser deadline has expired.")
            deadline = time.monotonic() + allowance
            self.driver.call("prepare", {"operation_id": value["operation_id"]},
                timeout=min(30, max(0.001, deadline - time.monotonic())))
            require(time.monotonic() < deadline, "The original browser deadline has expired.")
            endpoints, servers = self._start_servers(request, value, temporary, deadline)
            require(time.monotonic() < deadline, "The product servers consumed the journey deadline.")
            attempted = True
            outcome = self.driver.call("run", {**value, "temporary_root": str(temporary),
                "servers": endpoints, "timeout_seconds": deadline - time.monotonic()},
                timeout=max(1, deadline - time.monotonic()) + 15)
            if hash_file(value["module"]) != value["module_sha256"]:
                outcome.update(ok=False, error="journey_source_changed_during_operation", uncertain=True)
        except Exception as error:
            server_started = any((root / "request.json").exists() for root in self._servers.values())
            outcome = {"ok": False, "error": str(error), "error_type": type(error).__name__,
                       "uncertain": attempted or server_started, "journey_attempted": attempted,
                       "server_started": server_started}
        finally:
            try:
                cleanup = self._stop_servers()
            except Exception as error:
                cleanup = {"servers": [], "errors": [{"error_type": type(error).__name__}]}
                self.stop_requested.set()
            self._active_browser = None
            if self.driver.report().get("response_pipe_closed"):
                self.driver.close()
            self._announce()
            if not attempted and self.driver.process and self.driver.process.poll() is None:
                try:
                    self.driver.call("finish", {}, timeout=5, ensure=False)
                except (OSError, ValueError, RuntimeError):
                    self.driver.abort()
        try:
            artifacts = native.collect_artifacts(Path(value["project"]), value["artifacts"])
        except Exception as error:
            artifacts = {"files": [], "errors": [{"error_type": type(error).__name__}]}
        if cleanup["errors"] or artifacts["errors"]:
            outcome.update(ok=False, error=outcome.get("error") or "browser_operation_finalization_incomplete")
        return _redact({**outcome, "schema": SCHEMA + "/result", "operation_id": value["operation_id"],
            "project": value["project"], "module": value["module"], "module_sha256": value["module_sha256"],
            "driver": self.driver.report(),
            "root_job_id": root_job_id, "job_id": request["job_id"],
            "runtime_generation": self.runtime_id, "deadline_at": value.get("deadline_at"),
            "server_executions": servers, "cleanup": cleanup, "artifacts": artifacts,
            "temporary_root": str(temporary)}, ())

    def handle_request(self, request):
        kind = request["payload"].get("kind")
        try:
            if kind == "browser.run":
                return self._run(request)
            if kind in {"status", "browser.status"}:
                return self.metadata()
            if kind == "browser.shutdown":
                driver = self.driver.close()
                self.stop_requested.set()
                closed = driver.get("browser_closed") is True
                return {"ok": closed, "browser_closed": True if closed else None,
                        "uncertain": not closed, "driver": driver,
                        **({} if closed else {"error": "browser_shutdown_unconfirmed"})}
            raise ValueError("Use a native browser request for this worker.")
        except Exception as error:
            return {"ok": False, "error": str(error), "error_type": type(error).__name__,
                    "uncertain": bool(self._active_browser), "journey_attempted": bool(self._active_browser)}

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="action", required=True)
    serving = commands.add_parser("serve")
    serving.add_argument("--queue", required=True)
    serving.add_argument("--peer", required=True)
    serving.add_argument("--records-root")
    serving.add_argument("--native-host", help="existing equipped host directory; reuses its original job engine")
    serving.add_argument("--worker-root", default=os.environ.get("SWARM_WORKER_ROOT"))
    serving.add_argument("--temp-root", default=os.environ.get("SWARM_WORKER_TMP_ROOT") or os.environ.get("TMPDIR"))
    serving.add_argument("--executable", default=os.environ.get("LOCAL_CHROMIUM_EXECUTABLE"))
    serving.add_argument("--node-executable", default=os.environ.get("CODEX_PRIMARY_RUNTIME_NODE") or shutil.which("node"))
    default_modules = os.environ.get("CODEX_PRIMARY_RUNTIME_NODE_MODULES")
    serving.add_argument("--playwright-module",
                         default=str(Path(default_modules) / "playwright-core/index.mjs") if default_modules else "playwright")
    serving.add_argument("--browser-arg", action="append", default=[])
    serving.add_argument("--idle-seconds", type=float, default=120)
    for name in ("submit", "recover", "rebind", "shutdown", "status"):
        sub = commands.add_parser(name)
        sub.add_argument("--queue", required=True)
        if name != "status":
            sub.add_argument("--operation-id", required=True)
            sub.add_argument("--timeout", type=float, default=55)
        if name == "submit":
            sub.add_argument("--request", required=True)
            sub.add_argument("--no-continue-unattempted", action="store_true",
                help="return a generation rejection without creating its safe continuation")
        elif name == "recover":
            sub.add_argument("--continue-unattempted", action="store_true",
                help="continue only a definitive, unattempted generation rejection")
        elif name == "rebind":
            sub.add_argument("--runtime-id", required=True,
                help="observed current generation from browser status")
    args = parser.parse_args(argv)
    try:
        if args.action == "serve":
            select_native_host(args.native_host)
            require(args.node_executable and Path(args.node_executable).is_file(),
                    "Select the existing Node executable.")
            require(args.executable and Path(args.executable).is_file(),
                    "Select the existing Chromium executable.")
            require(args.temp_root, "Select the original worker's temporary root.")
            require(args.idle_seconds >= 0, "Idle close seconds cannot be negative.")
            runtime = BrowserRuntime(args)
            for sig in (signal.SIGTERM, signal.SIGINT):
                signal.signal(sig, lambda *_: runtime.signal_stop())
            runtime.serve()
            return 0
        client = FileQueueClient(args.queue)
        if args.action == "status":
            metadata = client.metadata()
            result = {"runtime": metadata,
                      "browser": browser_status(metadata, read_record(client.queue.root / "browser-state.json")),
                      "jobs": client.jobs()}
        else:
            if args.action == "submit":
                value = json.loads(Path(args.request).read_text(encoding="utf-8"))
                value = prepared(value, args.operation_id)
                client.submit(value, job_id=args.operation_id)
            elif args.action == "shutdown":
                client.submit({"kind": "browser.shutdown"}, job_id=args.operation_id)
            elif args.action == "rebind":
                client.rebind(args.operation_id, runtime_id=args.runtime_id)
            continue_unattempted = ((args.action == "submit" and not args.no_continue_unattempted)
                or (args.action == "recover" and args.continue_unattempted))
            result = client.wait(args.operation_id, timeout=args.timeout,
                follow_rebinds=args.action != "shutdown", rebind_runtime=continue_unattempted)
        print(json.dumps(result, ensure_ascii=False, allow_nan=False), flush=True)
        if result.get("state") in {"running", "queued", "rebind_pending"}:
            return 3
        outcome = result.get("result", result)
        return 1 if outcome.get("ok") is False or outcome.get("uncertain") else 0
    except (OSError, ValueError, KeyError, TypeError, FileQueueError) as error:
        print(json.dumps({"ok": False, "error": str(error), "error_type": type(error).__name__}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

