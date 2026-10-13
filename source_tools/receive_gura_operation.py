#!/usr/bin/env python3
"""Run the original Gura native, planning, report and parameter-study workflow.

Every phase uses its maintained source-native receiver and the same retained
Workspace. Native cases run serially in isolated interpreters. The operation
lease remains held by an active child even if this supervisor is interrupted.
"""
from __future__ import annotations
import argparse, datetime, fcntl, hashlib, json, os, subprocess, sys
from pathlib import Path

def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def atomic(path, value):
    temporary = path.with_name(path.name + ".partial")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True, type=Path)
    parser.add_argument("--operation", required=True, type=Path)
    parser.add_argument("--workspace", type=Path,
                        help="Existing scientific Workspace; default: OPERATION/workspace")
    parser.add_argument("--inputs", type=Path,
                        help="Original NDR.zip and SDR.zip directory; default: OPERATION/inputs")
    args = parser.parse_args()
    app = args.application.resolve(strict=True)
    root = args.operation.resolve()
    workspace = (args.workspace or root / "workspace").resolve()
    inputs = (args.inputs or root / "inputs").resolve()
    if root.is_relative_to(workspace):
        raise ValueError("Keep the operation directory outside the scientific Workspace; the suite archive must be external")
    root.mkdir(parents=True, exist_ok=True)
    root.joinpath("logs").mkdir(exist_ok=True)
    state_path = root / "operation.json"
    with (root / "operation.lock").open("a") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        state = json.loads(state_path.read_text()) if state_path.exists() else {
            "schema": "commons.gura-complete-operation/v1", "created_at": utc(),
            "application": str(app), "workspace": str(workspace), "inputs": str(inputs),
            "python": sys.executable, "phases": {}}
        if state.get("schema") != "commons.gura-complete-operation/v1" or not isinstance(state.get("phases"), dict):
            raise ValueError("The operation directory contains a different receiving manifest")
        for key, value in {"application": str(app), "workspace": str(workspace),
                           "inputs": str(inputs), "python": sys.executable}.items():
            if state[key] != value:
                raise ValueError("Resume the same operation target: " + key)
        env = dict(os.environ)
        for key in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
            env[key] = "1"
        env["GDAL_CACHEMAX"] = "64"
        env["PYTHONUNBUFFERED"] = "1"
        env["MALLOC_ARENA_MAX"] = "2"
        env["GURA_OPERATION_LOCK_FD"] = str(lock.fileno())
        env["GURA_OPERATION_LOCK_PATH"] = str(root / "operation.lock")
        temporary = root / "tmp"
        temporary.mkdir(exist_ok=True)
        env["TMPDIR"] = str(temporary)
        common = ["--application", str(app), "--workspace", str(workspace),
                  "--inputs", str(inputs)]
        phases = [
            ("original-reference", "receive_gura_native.py",
             common + ["--models", "ndr", "sdr", "--mode", "both"]),
            ("planning", "receive_gura_planning.py", common + ["--min-coverage", "0.90"]),
            ("native-study-release", "receive_gura_study.py", common),
            ("parameter-studies", "receive_gura_studies.py", common + ["--isolate-native-cases"]),
        ]
        state.update(state="running", pid=os.getpid(), updated_at=utc(),
                     failed_phases=[], completed_at=None)
        atomic(state_path, state)
        failures = []
        for key, driver, argv in phases:
            if key == "native-study-release" and "planning" in failures:
                state["phases"][key] = {"state": "waiting-for-planning", "updated_at": utc()}
                atomic(state_path, state)
                continue
            if key == "parameter-studies":
                planning_path = workspace / "gura-receiving" / "gura-planning-state.json"
                planning = json.loads(planning_path.read_text(encoding="utf-8")) if planning_path.is_file() else {}
                if "planning" not in failures and planning.get("evaluation_run_id"):
                    argv += ["--include-planning-evaluation"]
                argv += ["--archive", str(root / "gura-parameter-suite.zip")]
            command = [sys.executable, str(app / "source_tools" / driver), *argv]
            phase = state["phases"].setdefault(key, {})
            attempt = int(phase.get("attempt", 0)) + 1
            log_path = root / "logs" / (key + "-" + str(attempt) + ".log")
            for field in ("exit_code", "completed_at", "pid", "launch_error"):
                phase.pop(field, None)
            phase.update(state="running", started_at=utc(), attempt=attempt,
                         command=command, log=str(log_path),
                         driver_sha256=hashlib.sha256((app / "source_tools" / driver).read_bytes()).hexdigest())
            state.update(active_phase=key, updated_at=utc())
            atomic(state_path, state)
            log = None
            try:
                log = log_path.open("w", encoding="utf-8")
                process = subprocess.Popen(command, cwd=app, env=env,
                                           stdout=log, stderr=subprocess.STDOUT,
                                           pass_fds=(lock.fileno(),))
            except OSError as error:
                if log is not None:
                    log.close()
                phase["launch_error"] = {"type": type(error).__name__, "message": str(error)}
                code = 1
            else:
                with log:
                    phase["pid"] = process.pid
                    # If this write fails after launch, propagate the error.
                    # The child retains the lease; never start a second phase.
                    atomic(state_path, state)
                    code = process.wait()
            phase.update(state="complete" if code == 0 else "error",
                         exit_code=code, completed_at=utc())
            state.update(updated_at=utc())
            if code:
                failures.append(key)
                state["failed_phases"] = list(failures)
                atomic(state_path, state)
                print(json.dumps({"state": "error", "phase": key, "exit_code": code,
                                  "log": str(log_path)}), flush=True)
                if key == "original-reference":
                    state["state"] = "error"
                    atomic(state_path, state)
                    return code
            atomic(state_path, state)
        state.update(state="partial" if failures else "complete", active_phase=None,
                     failed_phases=failures, completed_at=utc() if not failures else None, updated_at=utc())
        atomic(state_path, state)
        print(json.dumps({"state": state["state"], "failed_phases": failures,
                          "operation": str(state_path)}), flush=True)
        return 1 if failures else 0

if __name__ == "__main__":
    raise SystemExit(main())
