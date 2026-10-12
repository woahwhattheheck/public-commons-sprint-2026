# SPDX-License-Identifier: MIT
"""One owned native QGIS child per original field request."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import traceback
import uuid

from .model import QgisWorkspace, QgisReceivingError, require, read_json, json_bytes, value_sha, retain_bytes
from .field import operation_lock, REQUEST, FIELD_ACTIONS

def _atomic(path, value):
    path = Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".field-progress-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as target:
            target.write(json_bytes(value))
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)

def _stop(child):
    if child.poll() is not None:
        return
    if os.name == "posix":
        os.killpg(child.pid, signal.SIGTERM)
    else:
        child.terminate()
    try:
        child.wait(timeout=10)
    except subprocess.TimeoutExpired:
        if os.name == "posix":
            os.killpg(child.pid, signal.SIGKILL)
        else:
            child.kill()
        child.wait(timeout=10)

def run_native(workspace, action, payload, *, native_command, qfieldsync_path="", prefix_path="",
               revision=None, request_id=None, actor="", progress=None):
    require(action in FIELD_ACTIONS | {"field.inspect", "field.reopen"},
            "FIELD_ACTION", "Choose a supported native field action.")
    require(isinstance(native_command, list) and native_command and
            all(isinstance(x, str) and x and "\0" not in x for x in native_command),
            "FIELD_NATIVE_COMMAND", "Select the installed native QGIS Python command.")
    executable = Path(native_command[0]).expanduser()
    require(executable.is_absolute() and executable.is_file(), "FIELD_NATIVE_COMMAND",
            "Select the actual native QGIS Python executable or installed wrapper.")
    state = workspace.read()
    request_id = request_id or "field-inspect-" + uuid.uuid4().hex
    require(REQUEST.fullmatch(request_id), "FIELD_REQUEST", "Use the original saved field request ID.")
    common = {"revision": state["revision"] if revision is None else revision,
              "request_id": request_id, "actor": actor or "Project inspection"}
    request = {"schema": "starforge.qfield.worker-request.v1", "workspace": str(workspace.root),
               "workspaceId": state["id"], "action": action, "payload": payload, "common": common}
    sha = value_sha(request)
    job = workspace.root / "field" / "operations" / request_id / "bridge"
    job.mkdir(mode=0o700, parents=True, exist_ok=True)
    request_path = job / "request.json"
    response_path = job / "response.json"
    with operation_lock(job) as lock:
        retain_bytes(job, "request.json", json_bytes(request))
        if response_path.is_file():
            response, _ = read_json(response_path)
            require(response.get("requestSha256") == sha and response.get("closed") is True,
                    "FIELD_RESPONSE_IDENTITY", "This retained native result belongs to another original request.")
            if response.get("ok"):
                return response["result"]
            # A source/runtime correction may retry the same failed request;
            # retain the previous failure before starting its own new attempt.
            saved = "failure-" + value_sha(response) + ".json"
            retain_bytes(job, saved, json_bytes(response))
            response_path.unlink()
        env = dict(os.environ)
        roots = [str(Path(__file__).resolve().parent.parent)]
        if qfieldsync_path:
            base = Path(qfieldsync_path).expanduser().absolute()
            require(base.is_dir(), "FIELD_QFIELDSYNC_SOURCE", "Select the installed QFieldSync or libqfieldsync directory.")
            roots += [str(base), str(base / "libqfieldsync"), str(base / "libs")]
        if env.get("PYTHONPATH"):
            roots.append(env["PYTHONPATH"])
        env["PYTHONPATH"] = os.pathsep.join(roots)
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        env["QT_QPA_PLATFORM"] = "offscreen"
        env["QGIS_CUSTOM_CONFIG_PATH"] = str(job / "qgis-profile")
        if prefix_path:
            env["QGIS_PREFIX_PATH"] = str(Path(prefix_path).expanduser())
        command = [str(executable), *native_command[1:], "-B", "-m", "starforge_stac.field_bridge", "--worker", str(request_path)]
        log_path = job / ("native-" + uuid.uuid4().hex + ".log")
        options = {"cwd": str(workspace.root), "env": env, "stdin": subprocess.DEVNULL, "start_new_session": os.name == "posix"}
        if os.name == "posix" and lock is not None:
            options["pass_fds"] = (lock.fileno(),)
        child = None
        started = time.monotonic()
        try:
            with log_path.open("wb") as log:
                child = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT, **options)
                while child.poll() is None:
                    value = {"phase": "native-field", "action": action, "elapsedSeconds": round(time.monotonic() - started, 1)}
                    current = job / "progress.json"
                    if current.is_file():
                        try:
                            observed, _ = read_json(current, limit=100000)
                            if observed.get("requestSha256") == sha:
                                value.update(observed.get("progress", {}))
                        except (OSError, QgisReceivingError):
                            pass
                    if progress:
                        progress(value)
                    time.sleep(.075)
                code = child.wait()
            require(response_path.is_file(), "FIELD_NATIVE_RESULT",
                    "The original native child ended before retaining a complete result. Resume this same saved request.",
                    exitCode=code, log=str(log_path))
            response, _ = read_json(response_path)
            require(response.get("requestSha256") == sha and response.get("closed") is True,
                    "FIELD_RESPONSE_IDENTITY", "The native child did not close with the selected original request.")
            if not response.get("ok"):
                error = response.get("error", {})
                raise QgisReceivingError(error.get("code", "FIELD_NATIVE_FAILED"),
                                         error.get("message", "The original native field operation failed."),
                                         nativeDetails=error.get("details", {}), log=str(log_path))
            require(code == 0, "FIELD_NATIVE_EXIT", "The native field child returned a failing exit status.", exitCode=code)
            return response["result"]
        finally:
            if child is not None:
                _stop(child)

def worker(path):
    request, _ = read_json(path)
    require(request.get("schema") == "starforge.qfield.worker-request.v1", "FIELD_REQUEST", "Use the original worker request.")
    workspace = QgisWorkspace(request["workspace"])
    require(workspace.read()["id"] == request["workspaceId"], "FIELD_WORKSPACE_CHANGED", "The selected workspace identity changed.")
    sha = value_sha(request)
    job = Path(path).parent
    response = {"schema": "starforge.qfield.worker-response.v1", "requestSha256": sha, "closed": False, "ok": False}
    app = None
    last_progress = 0.0
    def progress(value):
        nonlocal last_progress
        now = time.monotonic()
        if now - last_progress >= .15 or value.get("phase", "").endswith("complete"):
            _atomic(job / "progress.json", {"requestSha256": sha, "progress": value})
            last_progress = now
    try:
        from qgis.core import QgsApplication, QgsProject
        if os.environ.get("QGIS_PREFIX_PATH"):
            QgsApplication.setPrefixPath(os.environ["QGIS_PREFIX_PATH"], True)
        app = QgsApplication([], False)
        app.initQgis()
        # Import only after the actual selected provider environment is initialized.
        from .field import field_command
        from .field_native import inspect_field_project, reopen_field_project
        action = request["action"]
        if action == "field.inspect":
            result = inspect_field_project(workspace, request["payload"]["projectId"], progress)
        elif action == "field.reopen":
            native, result = reopen_field_project(workspace, request["payload"]["projectId"], progress=progress)
            native.clear()
            del native
        else:
            result = field_command(workspace, action, request["payload"], progress=progress, **request["common"])
        response.update({"ok": True, "result": result})
    except BaseException as exc:
        response["error"] = {"code": getattr(exc, "code", "FIELD_NATIVE_FAILED"), "message": str(exc),
                             "details": getattr(exc, "details", {}), "type": type(exc).__name__}
        traceback.print_exc()
    finally:
        try:
            if app is not None:
                from qgis.core import QgsProject
                QgsProject.instance().clear()
                import gc
                gc.collect()
                app.exitQgis()
                del app
        except BaseException as exc:
            response["ok"] = False
            response["error"] = {"code": "FIELD_NATIVE_CLOSE", "message": str(exc), "type": type(exc).__name__}
        response["closed"] = True
        _atomic(job / "response.json", response)
    return 0 if response["ok"] else 1

def main():
    parser = argparse.ArgumentParser(description="Original QGIS field worker; normally invoked by the existing operator dock.")
    parser.add_argument("--worker", required=True)
    args = parser.parse_args()
    return worker(Path(args.worker).absolute())

if __name__ == "__main__":
    raise SystemExit(main())
