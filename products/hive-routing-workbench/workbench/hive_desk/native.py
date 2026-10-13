"""Original Hive binary deployment, process lifetime and graceful termination."""
from __future__ import annotations
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import platform
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

from .editions import edition_bytes, load_edition, materialize_edition
from .util import environment_name, identity, json_text, process_identity, require, same_process
from .workspace import SOURCE_PIN, Workspace, durable_file, now, sha

RELEASE = "hive-router/v0.3.4"
RELEASE_BINARIES = {
    "d59fc37101f1ae9c78dffc7a62dafd1ab7e4905aaa300e692661067b32670af6":
        {"bytes": 70274296, "platform": "Linux", "machine": ["x86_64", "amd64"], "asset": "hive_router_linux_amd64"},
    "b4e5e0c36a08f1e3bf25946228de2f00c99c672945358facdf1f6c2dc28b3bb3":
        {"bytes": 63567664, "platform": "Linux", "machine": ["aarch64", "arm64"], "asset": "hive_router_linux_arm64"},
}
TERMINAL = {"exited", "interrupted", "failed"}

@contextmanager
def deployment_lock(workspace, deployment_id, blocking=True):
    root = workspace.root / "runtime-locks"
    root.mkdir(exist_ok=True, mode=0o700)
    descriptor = os.open(root / (deployment_id + ".lock"), os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB))
        yield descriptor
    finally:
        os.close(descriptor)

def _item(workspace, deployment_id):
    item = workspace.get("deployment", deployment_id)
    require(item, "Select a prepared native deployment.")
    return item

def _local_item(workspace, deployment_id):
    item = _item(workspace, deployment_id)
    require(item["data"].get("installation") == str(workspace.root),
            "Prepare this saved edition for the receiving installation before operating its native process.")
    return item

def _save(workspace, deployment_id, patch):
    current = _item(workspace, deployment_id)
    return workspace.save("deployment", deployment_id, {**current["data"], **patch}, current["revision"])

def inspect_binary(path):
    path = Path(path).resolve()
    require(path.is_file() and not path.is_symlink(), "Select the original published Hive executable.")
    found = identity(path)
    selected = RELEASE_BINARIES.get(found["sha256"])
    require(selected and selected["bytes"] == found["bytes"], "Select the exact published Hive v0.3.4 Linux binary.")
    require(platform.system() == selected["platform"] and platform.machine().lower() in selected["machine"],
            "The selected original binary does not match this Linux host.")
    require(os.access(path, os.X_OK), "The original binary needs its executable permission.")
    return {"path": str(path), **found, **selected, "release": RELEASE, "sourcePin": SOURCE_PIN}

def prepare(workspace, edition_id, binary, name=None, environment_names=None):
    edition = load_edition(workspace, edition_id)
    selected = inspect_binary(binary)
    names = sorted(set(environment_name(key) for key in (environment_names or [])))
    require("ROUTER_CONFIG_FILE_PATH" not in names, "The saved edition selects its own original configuration path.")
    missing = [key for key in names if key not in os.environ]
    require(not missing, "Connect the selected existing environment variables: " + ", ".join(missing))
    config = edition["data"]["configuration"]
    http = config.get("http", {})
    require(isinstance(http, dict), "Select the explicit native HTTP configuration.")
    host = http.get("host", "0.0.0.0")
    port = http.get("port", 4000)
    require(isinstance(host, str) and host in {"127.0.0.1", "::1", "localhost"},
            "Select an explicit loopback router listener for this private operator installation.")
    require(isinstance(port, int) and 1 <= port <= 65535, "Select an explicit native router port.")
    for key in ("HOST", "PORT", "ROUTER_HTTP_HOST", "ROUTER_HTTP_PORT", "SUPERGRAPH_FILE_PATH"):
        require(key not in names, "Keep the listener and selected supergraph in the reviewed original configuration.")
    graph_path = http.get("graphql_endpoint", "/graphql")
    require(isinstance(graph_path, str) and graph_path.startswith("/") and not graph_path.startswith("//"),
            "Select the native GraphQL endpoint.")
    binding = {"edition": edition_id, "binary": selected, "environmentNames": names, "installation": str(workspace.root)}
    deployment_id = sha(json_text(binding).encode("utf-8"))[:32]
    existing = workspace.get("deployment", deployment_id)
    if existing:
        return existing
    directory = workspace.root / "runtime" / deployment_id / "edition"
    materialize_edition(workspace, edition, directory)
    address = "[" + host + "]" if ":" in host else host
    body = {**binding, "name": name or edition["data"]["name"], "directory": str(directory),
            "configPath": str(directory / edition["data"]["manifest"]["config_file"]),
            "baseUrl": "http://" + address + ":" + str(port), "graphqlPath": graph_path,
            "state": "prepared", "attempts": [], "createdAt": now()}
    return workspace.save("deployment", deployment_id, body)

def status(workspace, deployment_id, probes=True):
    item = _item(workspace, deployment_id)
    data = dict(item["data"])
    if data.get("installation") != str(workspace.root):
        return {**item, "observation": {"nativeAlive": False, "supervisorAlive": False,
            "nativeProcess": None, "observedState": "earlier-installation",
            "installation": data.get("installation"), "currentInstallation": str(workspace.root)}}
    current = data.get("currentAttempt")
    native_process = current.get("nativeProcess") if current and same_process(current.get("nativeProcess")) else _owned_native(workspace, deployment_id, data)
    native_alive = same_process(native_process)
    supervisor_alive = same_process(current.get("supervisor")) if current else False
    observation = {"nativeAlive": native_alive, "supervisorAlive": supervisor_alive, "nativeProcess": native_process}
    if current and data["state"] in {"running", "starting", "stopping"} and not native_alive and not supervisor_alive:
        observation["observedState"] = "interrupted"
    elif native_alive:
        observation["observedState"] = "running"
    else:
        observation["observedState"] = data["state"]
    if probes and native_alive:
        for path in ("/health", "/readiness"):
            try:
                response = urllib.request.build_opener(urllib.request.ProxyHandler({})).open(data["baseUrl"] + path, timeout=3)
                with response:
                    body = response.read()
                    observation[path[1:]] = {"status": response.status, "body": body.decode("utf-8", "replace")}
            except urllib.error.HTTPError as error:
                observation[path[1:]] = {"status": error.code, "body": error.read().decode("utf-8", "replace")}
            except (OSError, urllib.error.URLError) as error:
                observation[path[1:]] = {"error": str(error)}
    return {**item, "observation": observation}

def _owned_native(workspace, deployment_id, data):
    """Recover the actual original child from its inherited lease, executable and edition directory."""
    if data.get("installation") != str(workspace.root):
        return None
    lease_path = workspace.root / "runtime-locks" / (deployment_id + ".lock")
    try:
        wanted = lease_path.stat()
    except FileNotFoundError:
        return None
    matched = []
    for process in Path("/proc").iterdir():
        if not process.name.isdigit():
            continue
        observed = process_identity(process.name)
        if not observed or observed["executable"] != data["binary"]["path"]:
            continue
        try:
            if Path(os.readlink(process / "cwd")).resolve() != Path(data["directory"]).resolve():
                continue
            for fd in (process / "fd").iterdir():
                try:
                    value = fd.stat()
                    if (value.st_dev, value.st_ino) == (wanted.st_dev, wanted.st_ino):
                        matched.append(observed)
                        break
                except (FileNotFoundError, PermissionError):
                    pass
        except (FileNotFoundError, PermissionError):
            continue
    require(len(matched) <= 1, "More than one original native process owns this deployment lease; inspect its retained owner records.")
    return matched[0] if matched else None

def _start_locked(workspace, deployment_id, source_root):
    _local_item(workspace, deployment_id)
    with deployment_lock(workspace, deployment_id, blocking=False) as lease_fd:
        item = _item(workspace, deployment_id)
        data = item["data"]
        active = data.get("currentAttempt", {})
        if same_process(active.get("nativeProcess")) or same_process(active.get("supervisor")):
            return status(workspace, deployment_id)
        edition = load_edition(workspace, data["edition"])
        materialize_edition(workspace, edition, data["directory"])
        missing = [key for key in data["environmentNames"] if key not in os.environ]
        require(not missing, "Connect the selected existing native environment: " + ", ".join(missing))
        attempts = list(data["attempts"])
        if data["state"] == "queued" and active:
            # Acquiring the inherited original lease establishes that no supervisor/child owns this queued launch.
            attempt = dict(active)
            token = attempt["id"]
            attempt["recoveredQueueAt"] = now()
        else:
            if active and data["state"] not in TERMINAL:
                previous = {**active, "state": "interrupted", "reconciledAt": now()}
                if previous.get("logPath") and Path(previous["logPath"]).is_file():
                    previous["log"] = workspace.put_file(previous["logPath"])
                attempts.append(previous)
            token = uuid.uuid4().hex
            attempt = {"id": token, "queuedAt": now(), "state": "queued", "sourcePin": SOURCE_PIN,
                       "edition": data["edition"], "binary": data["binary"], "environmentNames": data["environmentNames"]}
        supervisor_log = workspace.root / "runtime" / deployment_id / ("supervisor-" + token + ".log")
        attempt["supervisorLog"] = str(supervisor_log)
        _save(workspace, deployment_id, {"state": "queued", "currentAttempt": attempt, "attempts": attempts})
        env = dict(os.environ)
        env["PYTHONPATH"] = str(Path(source_root).resolve()) + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        with supervisor_log.open("ab") as log:
            try:
                subprocess.Popen([sys.executable, "-B", "-m", "hive_desk.worker",
                    "--workspace", str(workspace.root), "--deployment", deployment_id, "--attempt", token,
                    "--lease-fd", str(lease_fd)], cwd=str(Path(source_root).resolve()), env=env,
                    stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                    start_new_session=True, pass_fds=(lease_fd,))
            except BaseException as error:
                attempt.update({"state": "failed", "endedAt": now(), "error": type(error).__name__ + ": " + str(error)})
                _save(workspace, deployment_id, {"state": "failed", "currentAttempt": attempt,
                    "attempts": attempts + [attempt]})
                raise
        # The worker alone records its PID and subsequent state. It already owns this exact inherited lease.
    return status(workspace, deployment_id, probes=False)

def start(workspace, deployment_id, source_root):
    """Start once; an existing supervisor/actual child immediately returns its current native state."""
    try:
        return _start_locked(workspace, deployment_id, source_root)
    except BlockingIOError:
        return status(workspace, deployment_id)

def supervise(workspace_root, deployment_id, attempt_id, lease_fd):
    """Keep the inherited original lease in both supervisor and actual router until they exit."""
    with Workspace(workspace_root) as workspace:
        expected_lock = workspace.root / "runtime-locks" / (deployment_id + ".lock")
        inherited, expected = os.fstat(lease_fd), expected_lock.stat()
        require((inherited.st_dev, inherited.st_ino) == (expected.st_dev, expected.st_ino),
                "The native supervisor requires its original deployment lease.")
        fcntl.flock(lease_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        item = _local_item(workspace, deployment_id)
        data = item["data"]
        attempt = dict(data.get("currentAttempt", {}))
        require(data["state"] == "queued" and attempt.get("id") == attempt_id, "Reopen this exact queued native attempt.")
        selected = inspect_binary(data["binary"]["path"])
        edition = load_edition(workspace, data["edition"])
        materialize_edition(workspace, edition, data["directory"])
        native_env = {key: os.environ[key] for key in ("PATH", "LANG", "LC_ALL", "TZ", "TMPDIR", "LD_LIBRARY_PATH", "SSL_CERT_FILE", "SSL_CERT_DIR") if key in os.environ}
        native_env.update({key: os.environ[key] for key in data["environmentNames"]})
        native_env["ROUTER_CONFIG_FILE_PATH"] = data["configPath"]
        log_path = workspace.root / "runtime" / deployment_id / ("native-" + attempt_id + ".log")
        attempt.update({"supervisor": process_identity(os.getpid()), "state": "starting", "startedAt": now(), "logPath": str(log_path)})
        _save(workspace, deployment_id, {"state": "starting", "currentAttempt": attempt})
        child = None
        try:
            with log_path.open("xb") as log:
                child = subprocess.Popen([selected["path"]], cwd=data["directory"], env=native_env,
                    stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, pass_fds=(lease_fd,))
                attempt.update({"nativeProcess": process_identity(child.pid), "state": "running"})
                _save(workspace, deployment_id, {"state": "running", "currentAttempt": attempt})
                code = child.wait()
                log.flush()
                os.fsync(log.fileno())
            attempt.update({"state": "exited", "exitCode": code, "endedAt": now(), "log": workspace.put_file(log_path)})
            _save(workspace, deployment_id, {"state": "exited", "currentAttempt": attempt,
                "attempts": data["attempts"] + [attempt]})
            return code
        except BaseException as error:
            if child is not None and child.poll() is None:
                child.terminate()
                child.wait()
            attempt.update({"state": "failed", "endedAt": now(), "error": type(error).__name__ + ": " + str(error)})
            if log_path.exists():
                attempt["log"] = workspace.put_file(log_path)
            _save(workspace, deployment_id, {"state": "failed", "currentAttempt": attempt,
                "attempts": data["attempts"] + [attempt]})
            raise
        finally:
            os.close(lease_fd)

def stop(workspace, deployment_id):
    _local_item(workspace, deployment_id)
    item = status(workspace, deployment_id, probes=False)
    attempt = item["data"].get("currentAttempt", {})
    process = item["observation"].get("nativeProcess")
    require(same_process(process), "The retained original native child is already stopped.")
    os.kill(process["pid"], signal.SIGTERM)
    return {"deployment": deployment_id, "attempt": attempt["id"], "signal": "SIGTERM", "sentAt": now(),
            "nativeProcess": process}

def reconcile(workspace, deployment_id):
    """Rejoin an original orphaned child, or close its attempt after the inherited lease is free."""
    item = _local_item(workspace, deployment_id)
    data = item["data"]
    attempt = dict(data.get("currentAttempt", {}))
    require(attempt, "This deployment has no native attempt.")
    observed = _owned_native(workspace, deployment_id, data)
    if observed:
        if same_process(attempt.get("supervisor")) or attempt.get("nativeProcess") == observed:
            return status(workspace, deployment_id)
        attempt.update({"nativeProcess": observed, "state": "running", "rejoinedAt": now()})
        return _save(workspace, deployment_id, {"state": "running", "currentAttempt": attempt})
    with deployment_lock(workspace, deployment_id, blocking=False):
        item = _item(workspace, deployment_id)
        data = item["data"]
        attempt = dict(data.get("currentAttempt", {}))
        require(not same_process(attempt.get("nativeProcess")) and not same_process(attempt.get("supervisor")),
                "The original native process is still active.")
        if data["state"] in TERMINAL:
            return item
        if data["state"] == "queued":
            return {**item, "continuation": "native.start reuses this exact queued attempt under its original lease"}
        attempt.update({"state": "interrupted", "reconciledAt": now()})
        if attempt.get("logPath") and Path(attempt["logPath"]).is_file():
            attempt["log"] = workspace.put_file(attempt["logPath"])
        return _save(workspace, deployment_id, {"state": "interrupted", "currentAttempt": attempt,
            "attempts": data["attempts"] + [attempt]})

def wait_ready(workspace, deployment_id, timeout=60):
    deadline = time.monotonic() + float(timeout)
    last = None
    while time.monotonic() < deadline:
        last = status(workspace, deployment_id)
        if last["observation"].get("readiness", {}).get("status") == 200:
            return last
        if last["data"]["state"] in TERMINAL:
            raise ValueError("Original Hive process ended before readiness: " + json_text(last))
        time.sleep(0.2)
    raise TimeoutError("Original Hive readiness did not arrive within the selected startup window: " + json_text(last))
