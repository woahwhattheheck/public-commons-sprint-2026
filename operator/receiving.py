#!/usr/bin/env python3
"""Receive completed Upper Savannah native models through the original operator."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import selectors
import subprocess
import sys
import tempfile
import time
import uuid

APP = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP))
from model.common import canonical, file_digest, held
from model.workspace import Workspace

def atomic(path, value, *, raw=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = value if raw else canonical(value) + b"\n"
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".operator-receiving-", delete=False) as file:
            temporary = Path(file.name)
            file.write(data)
            file.flush()
            os.fsync(file.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
        temporary = None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)

def record(path):
    path = Path(path).resolve(strict=True)
    return {"path": str(path), "bytes": path.stat().st_size, "sha256": file_digest(path)}

def checked_model(path, workspace_override=None):
    original = Path(path).read_bytes()
    value = json.loads(original)
    if value.get("schema") != "upstate.native-model-receiving/v1":
        raise ValueError("Select the actual original native-model receiving result")
    for field in ("workspace_id", "source_collection_id", "grid_id", "profiles", "scenarios",
                  "runs", "comparison_id", "delivery_selection"):
        if field not in value:
            raise ValueError("The original native handoff lacks " + field)
    workspace = Workspace(workspace_override or value["workspace_path"])
    if workspace.project["id"] != value["workspace_id"]:
        raise ValueError("The original native workspace identity differs")
    overview = workspace.overview()
    workspace._get("sources", value["source_collection_id"])
    workspace.get_grid(value["grid_id"])
    for kind in ("profiles", "scenarios"):
        for key in value[kind].values():
            workspace._get(kind, key)
    if len(set(value["runs"].values())) < 2:
        raise ValueError("Complete the original baseline and at least one alternative")
    for key in value["runs"].values():
        run = workspace.inspect_run(key)
        if run["state"] != "complete" or run["selection"]["grid_id"] != value["grid_id"]:
            raise ValueError("The selected original model run is incomplete or uses another grid")
    if not any(x["id"] == value["comparison_id"] for x in overview["comparisons"]):
        raise ValueError("The original paired run comparison is absent")
    selected = value["delivery_selection"]
    if selected["baseline_run_id"] not in value["runs"].values():
        raise ValueError("The delivery baseline differs from the native handoff")
    if not selected["scenario_run_ids"] or any(x not in value["runs"].values() for x in selected["scenario_run_ids"]):
        raise ValueError("The delivery alternatives differ from the native handoff")
    return value, workspace, original

def run_command(argv, output, name, *, timeout=None):
    log = output / (name + ".stdout")
    errors = output / (name + ".stderr")
    with log.open("wb") as stdout, errors.open("wb") as stderr:
        child = subprocess.Popen(argv, stdout=stdout, stderr=stderr, env=os.environ.copy())
        try:
            code = child.wait(timeout=timeout)
        except BaseException:
            child.terminate()
            try:
                child.wait(timeout=20)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
            raise
    if code:
        text = errors.read_text(errors="replace")[-12000:]
        raise RuntimeError(name + " exited " + str(code) + ": " + text)
    return log

class OperatorProcess:
    def __init__(self, application, workspace, state, received, output, name, upload_mib):
        self.error = output / (name + "-server.stderr")
        self.error_file = self.error.open("ab")
        self.child = subprocess.Popen([
            sys.executable, "-B", str(application / "operator/server.py"), "--workspace", str(workspace),
            "--operator-state", str(state), "--restore-directory", str(received), "--port", "0",
            "--upload-limit-mib", str(upload_mib)],
            stdout=subprocess.PIPE, stderr=self.error_file, env=os.environ.copy(), text=True)
        try:
            selector = selectors.DefaultSelector()
            selector.register(self.child.stdout, selectors.EVENT_READ)
            try:
                if not selector.select(timeout=60):
                    raise RuntimeError("The original operator did not return its startup URL")
                line = self.child.stdout.readline()
            finally:
                selector.close()
            if not line:
                raise RuntimeError("The original operator stopped before startup: " + self.error.read_text(errors="replace")[-10000:])
            self.receipt = json.loads(line)
            if self.receipt["project"]["id"] is None:
                raise ValueError("The original operator omitted its workspace identity")
        except BaseException:
            self.close()
            raise

    def close(self):
        if self.child.poll() is None:
            self.child.terminate()
            try:
                self.child.wait(timeout=120)
            except subprocess.TimeoutExpired:
                self.child.kill()
                self.child.wait()
        if self.child.stdout:
            self.child.stdout.close()
        self.error_file.close()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("model_receiving", type=Path)
    parser.add_argument("--workspace", type=Path, help="The same received model workspace at its current path")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--operator-state", type=Path)
    parser.add_argument("--scratch", required=True, type=Path)
    parser.add_argument("--source-revision", required=True)
    parser.add_argument("--node", required=True, type=Path)
    parser.add_argument("--node-modules", required=True, type=Path)
    parser.add_argument("--chromium", required=True, type=Path)
    parser.add_argument("--upload-limit-mib", type=int, default=4096)
    parser.add_argument("--task-timeout-seconds", type=int, default=14400)
    parser.add_argument("--omit-native-intermediates", action="store_true")
    parser.add_argument("--resume-failed-tasks", action="store_true",
                        help="Continue the retained failed task after its concrete source/input repair")
    args = parser.parse_args()
    if not 1 <= args.upload_limit_mib <= 65536 or args.task_timeout_seconds <= 0:
        raise ValueError("Select the receiving file capacity and native task observation interval")
    for path in (args.node, args.chromium, args.node_modules / "playwright/index.mjs"):
        if not path.is_file():
            raise ValueError("Select the actual installed receiving runtime: " + str(path))
    model, workspace, original = checked_model(args.model_receiving, args.workspace)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    scratch = args.scratch.resolve()
    scratch.mkdir(parents=True, exist_ok=True, mode=0o700)
    state = (args.operator_state or output / "private/operator-state").resolve()
    received_root = scratch / "received"
    progress = output / "operator-browser-progress.json"
    source_sha = hashlib.sha256(original).hexdigest()
    result_path = output / "operator-receiving-result.json"
    with held(output / ".operator-receiving.lock", blocking=False):
        original_path = output / "original-native-model-result.json"
        if original_path.exists() and original_path.read_bytes() != original:
            raise ValueError("The retained native-model handoff differs")
        if not original_path.exists():
            atomic(original_path, original, raw=True)
        if result_path.exists():
            accepted = json.loads(result_path.read_text())
            if accepted.get("complete"):
                if (accepted.get("workspace_id") != model["workspace_id"] or
                        accepted.get("original_model_result", {}).get("sha256") != source_sha):
                    raise ValueError("The completed receiving result belongs to another native model handoff")
                for name in ("browser_progress", "delivery_archive", "workspace_archive"):
                    item = accepted[name]
                    if record(item["path"]) != item:
                        raise ValueError("The completed receiving artifact differs: " + name)
                print(json.dumps({"complete": True, "reused": True,
                                  "source_revision": accepted["source_revision"],
                                  "workspace_id": model["workspace_id"], "result": record(result_path),
                                  "workspace_archive": accepted["workspace_archive"],
                                  "delivery_archive": accepted["delivery_archive"]}), flush=True)
                return
        result = {"schema": "upstate.operator-native-receiving/v1", "source_revision": args.source_revision,
                  "original_model_result": record(original_path), "workspace_id": model["workspace_id"],
                  "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "complete": False,
                  "runtime": {"python": sys.version, "node": str(args.node), "chromium": str(args.chromium)}}
        attempt_dir = output / "attempts" / str(uuid.uuid4())
        attempt_dir.mkdir(parents=True)
        control = output / "private/control.json"
        server = None
        try:
            if progress.exists():
                previous = json.loads(progress.read_text())
                if previous["model_receiving_sha256"] != source_sha:
                    raise ValueError("The browser continuation belongs to another native-model result")
                received = previous.get("received")
                if received and not Path(received["directory"]).exists():
                    from model.portable import restore
                    archive = previous["workspace_archive"]
                    if file_digest(archive["path"]) != archive["sha256"]:
                        raise ValueError("The original receiving archive changed")
                    restored = restore(archive["path"], received["directory"])
                    if restored["project"]["id"] != model["workspace_id"] or restored["archive_sha256"] != archive["sha256"]:
                        raise ValueError("Reconstructed receiving differs from the retained original")
                    result["receiving_reconstructed"] = restored
            server = OperatorProcess(APP, workspace.root, state, received_root, attempt_dir, "original", args.upload_limit_mib)
            def browser(mode, current_server, application):
                receipt = current_server.receipt
                if receipt["project"]["id"] != model["workspace_id"]:
                    raise ValueError("The operator opened another native workspace")
                atomic(control, {"mode": mode, "operator_url": receipt["operator_url"],
                    "workspace_key": receipt["workspace_key"], "model": model,
                    "model_receiving_sha256": source_sha, "source_revision": args.source_revision,
                    "output": str(output), "progress": str(progress), "node_modules": str(args.node_modules.resolve()),
                    "chromium": str(args.chromium.resolve()), "include_intermediates": not args.omit_native_intermediates,
                    "resume_failed_tasks": args.resume_failed_tasks, "task_timeout_seconds": args.task_timeout_seconds})
                run_command([str(args.node), str(application / "operator/receiving.mjs"), str(control)],
                            attempt_dir, mode + "-browser")
            browser("operate", server, APP)
            stage = json.loads(progress.read_text())
            server.close()
            server = None
            receiving = stage["received"]
            application = Path(receiving["application"])
            directory = Path(receiving["workspace"])
            cli = run_command([sys.executable, "-B", str(application / "model/cli.py"),
                               "--workspace", str(directory), "overview"], attempt_dir, "delivered-cli")
            overview = json.loads(cli.read_text())
            if overview["project"]["id"] != model["workspace_id"]:
                raise ValueError("The delivered original CLI opened another workspace")
            for key in model["runs"].values():
                if not any(x["id"] == key and x["state"] == "complete" for x in overview["runs"]):
                    raise ValueError("The delivered CLI lost a completed native result")
            server = OperatorProcess(application, directory, output / "private/received-operator",
                                     scratch / "received-again", attempt_dir, "delivered", args.upload_limit_mib)
            browser("reopened", server, application)
            stage = json.loads(progress.read_text())
            if not stage.get("complete"):
                raise ValueError("The delivered original browser did not finish")
            result.update(complete=True, completed_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                          browser_progress=record(progress), delivery_archive=stage["delivery_archive"],
                          workspace_archive=stage["workspace_archive"], received=receiving,
                          delivered_cli=record(cli), original_run_ids=model["runs"],
                          original_comparison_id=model["comparison_id"])
            atomic(result_path, result)
            print(json.dumps({"complete": True, "workspace_id": model["workspace_id"],
                              "result": record(result_path), "workspace_archive": stage["workspace_archive"],
                              "delivery_archive": stage["delivery_archive"]}), flush=True)
        except BaseException as error:
            result["error"] = {"type": type(error).__name__, "message": str(error)}
            if progress.exists():
                result["browser_progress"] = record(progress)
            atomic(result_path, result)
            raise
        finally:
            if server is not None:
                server.close()
            control.unlink(missing_ok=True)

if __name__ == "__main__":
    main()
