#!/usr/bin/env python3
"""Run the original Gura native, planning, report and parameter-study workflow.

Every phase uses its maintained source-native receiver and the same retained
Workspace. Native cases run serially in isolated interpreters. The operation
lease remains held by an active child even if this supervisor is interrupted.
"""
from __future__ import annotations
import argparse, contextlib, datetime, fcntl, hashlib, json, os, signal, subprocess, sys, time
from pathlib import Path

def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def atomic(path, value):
    temporary = path.with_name(path.name + ".partial")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def deadline(value):
    """Require an absolute, timezone-aware instant; never infer a local cutoff."""
    if value is None:
        return None
    try:
        selected = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (TypeError, ValueError) as error:
        raise argparse.ArgumentTypeError("Use an absolute ISO-8601 deadline with timezone") from error
    if selected.tzinfo is None or selected.utcoffset() is None:
        raise argparse.ArgumentTypeError("The deadline must include its timezone")
    return selected.astimezone(datetime.timezone.utc)


@contextlib.contextmanager
def stop_requests(cutoff):
    """Record termination intent without interrupting an atomic state write."""
    requested = {}
    previous = {}

    def receive(signum, frame):
        requested.setdefault("reason", "signal")
        requested.setdefault("signal", signum)
        requested.setdefault("requested_at", utc())

    def observe():
        if not requested and cutoff is not None and datetime.datetime.now(
                datetime.timezone.utc) >= cutoff:
            requested.update(reason="deadline", signal=signal.SIGINT,
                             requested_at=utc(), deadline_utc=cutoff.isoformat())
        return dict(requested)

    try:
        for signum in (signal.SIGINT, signal.SIGTERM):
            previous[signum] = signal.getsignal(signum)
            if previous[signum] != signal.SIG_IGN:
                signal.signal(signum, receive)
        yield observe
    finally:
        for signum, handler in previous.items():
            signal.signal(signum, handler)


def stop_child(process):
    """Stop only this invocation's new session, including its native descendants."""
    actions = []
    # The phase was started with start_new_session=True. Nested native-case
    # children inherit that process group and the original operation lease.
    for signum, grace in ((signal.SIGINT, 10), (signal.SIGTERM, 5), (signal.SIGKILL, 5)):
        try:
            os.killpg(process.pid, signum)
        except ProcessLookupError:
            break
        actions.append({"signal": signum, "sent_at": utc()})
        until = time.monotonic() + grace
        while time.monotonic() < until:
            process.poll()
            try:
                os.killpg(process.pid, 0)
            except ProcessLookupError:
                return process.wait(), actions
            time.sleep(0.1)
    # Never dispatch another phase if an uninterruptible descendant still owns
    # the lease. Its inherited descriptor remains the final custody authority.
    try:
        code = process.wait(timeout=1)
    except subprocess.TimeoutExpired:
        code = None
    return code, actions


def wait_child(process, observe):
    while True:
        request = observe()
        if request:
            code, actions = stop_child(process)
            return code, {**request, "signals_sent": actions, "returned_at": utc()}
        try:
            code = process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            continue
        if code < 0 or code in (130, 137, 143):
            # A killed phase is a stop of this attempt, even if its caller
            # converted a nested child's signal into a conventional exit code.
            _, actions = stop_child(process)
            return code, {"reason": "child-interrupted", "return_code": code,
                          "signals_sent": actions, "returned_at": utc()}
        return code, None


def keep_attempt(root, key, phase):
    if not phase:
        return
    body = (json.dumps(phase, indent=2) + "\n").encode("utf-8")
    digest = hashlib.sha256(body).hexdigest()
    directory = root / "attempts" / key
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / (digest + ".json")
    try:
        with target.open("xb") as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
    except FileExistsError:
        if target.read_bytes() != body:
            raise ValueError("Original receiving attempt archive changed")
    return str(target.relative_to(root))

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True, type=Path)
    parser.add_argument("--operation", required=True, type=Path)
    parser.add_argument("--workspace", type=Path,
                        help="Existing scientific Workspace; default: OPERATION/workspace")
    parser.add_argument("--inputs", type=Path,
                        help="Original NDR.zip and SDR.zip directory; default: OPERATION/inputs")
    parser.add_argument("--deadline-utc", type=deadline,
                        help="Stop this attempt at an explicit UTC instant and preserve its saved cases")
    args = parser.parse_args(argv)
    app = args.application.resolve(strict=True)
    root = args.operation.resolve()
    workspace = (args.workspace or root / "workspace").resolve()
    inputs = (args.inputs or root / "inputs").resolve()
    if root.is_relative_to(workspace):
        raise ValueError("Keep the operation directory outside the scientific Workspace; the suite archive must be external")
    root.mkdir(parents=True, exist_ok=True)
    root.joinpath("logs").mkdir(exist_ok=True)
    state_path = root / "operation.json"
    with stop_requests(args.deadline_utc) as observe, (root / "operation.lock").open("a") as lock:
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
        continuation = [sys.executable, "-B", str(Path(__file__).resolve()),
                        "--application", str(app), "--operation", str(root),
                        "--workspace", str(workspace), "--inputs", str(inputs)]
        if args.deadline_utc is not None:
            continuation += ["--deadline-utc", args.deadline_utc.isoformat()]
        state.pop("interruption", None)
        state["continue_argv"] = continuation
        state["execution_policy"] = {"deadline_utc": args.deadline_utc.isoformat()
                                      if args.deadline_utc else None,
                                      "phase_children": "owned-process-session"}
        state.update(state="running", pid=os.getpid(), updated_at=utc(),
                     failed_phases=[], completed_at=None)
        atomic(state_path, state)
        failures = []
        for key, driver, argv in phases:
            requested = observe()
            if requested:
                state.update(state="interrupted", active_phase=None, interruption=requested,
                             completed_at=None, updated_at=utc())
                atomic(state_path, state)
                print(json.dumps({"state": "interrupted", "operation": str(state_path),
                                  "interruption": requested}), flush=True)
                return 130
            if key == "native-study-release" and "planning" in failures:
                original_phase = state["phases"].get(key, {})
                archived_phase = keep_attempt(root, key, original_phase)
                state["phases"][key] = {"state": "waiting-for-planning", "updated_at": utc(),
                                        "previous_attempts": list(original_phase.get("previous_attempts", []))
                                        + ([archived_phase] if archived_phase else [])}
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
            previous_attempt = keep_attempt(root, key, phase)
            history = list(phase.get("previous_attempts", []))
            if previous_attempt and previous_attempt not in history:
                history.append(previous_attempt)
            phase["previous_attempts"] = history
            attempt = int(phase.get("attempt", 0)) + 1
            log_path = root / "logs" / (key + "-" + str(attempt) + ".log")
            for field in ("exit_code", "completed_at", "pid", "launch_error", "interruption"):
                phase.pop(field, None)
            phase.update(state="running", started_at=utc(), attempt=attempt,
                         command=command, log=str(log_path),
                         driver_sha256=hashlib.sha256((app / "source_tools" / driver).read_bytes()).hexdigest())
            state.update(active_phase=key, updated_at=utc())
            atomic(state_path, state)
            log = None
            interrupted = None
            process = None
            try:
                log = log_path.open("w", encoding="utf-8")
                process = subprocess.Popen(command, cwd=app, env=env,
                                           stdout=log, stderr=subprocess.STDOUT,
                                           pass_fds=(lock.fileno(),), start_new_session=True)
            except OSError as error:
                if log is not None:
                    log.close()
                phase["launch_error"] = {"type": type(error).__name__, "message": str(error)}
                code = 1
            else:
                with log:
                    phase["pid"] = process.pid
                    try:
                        atomic(state_path, state)
                        code, interrupted = wait_child(process, observe)
                    except BaseException as error:
                        # A failed receipt must not orphan this deadline controller.
                        # Preserve the original failure if cleanup itself fails.
                        try:
                            stop_child(process)
                        except BaseException as cleanup_error:
                            error.gura_cleanup_error = {
                                "type": type(cleanup_error).__name__,
                                "message": str(cleanup_error)}
                        raise
            phase.update(state="complete" if code == 0 else "interrupted" if interrupted else "error",
                         exit_code=code, completed_at=utc())
            state.update(updated_at=utc())
            if interrupted:
                phase["interruption"] = interrupted
                state.update(state="interrupted", active_phase=None, interruption=interrupted,
                             failed_phases=failures + ([key] if code != 0 else []),
                             completed_at=None)
                atomic(state_path, state)
                print(json.dumps({"state": "interrupted", "phase": key, "exit_code": code,
                                  "log": str(log_path), "interruption": interrupted}), flush=True)
                return 130
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
