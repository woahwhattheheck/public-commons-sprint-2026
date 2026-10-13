"""Run one original Workspace calculation in a recoverable Linux process."""
from __future__ import annotations
import argparse
import contextlib
import hashlib
import os
from pathlib import Path
import signal
import sys
import threading
import time
import traceback

from .common import atomic_json, digest, file_digest, held, identifier, now, read_json
from .native_execution import resource_status

SCHEMA = "upstate.native-worker-request/v1"


def process_identity(pid=None):
    """Identity survives reconnect and rejects a recycled PID or namespace."""
    pid = os.getpid() if pid is None else int(pid)
    row = Path("/proc") / str(pid)
    try:
        stat = (row / "stat").read_text().rsplit(")", 1)[1].split()
        if stat[0] in {"Z", "X"}:
            return None
        return {"pid": pid, "start_ticks": stat[19],
                "boot_id": Path("/proc/sys/kernel/random/boot_id").read_text().strip(),
                "command_sha256": hashlib.sha256((row / "cmdline").read_bytes()).hexdigest(),
                "process_group": os.getpgid(pid)}
    except (OSError, ValueError, IndexError, ProcessLookupError):
        return None


def identity_matches(expected):
    current = process_identity(expected.get("pid", -1))
    return bool(current and all(current.get(k) == expected.get(k)
                                for k in ("pid", "start_ticks", "boot_id", "process_group", "command_sha256"))
                and current["process_group"] == current["pid"])


def signal_owned(directory, identity, execution_id, request_sha256, signum):
    """Share signal receipts between a connected supervisor and its detached worker."""
    directory = Path(directory)
    with held(directory / ".stop.lock"):
        receipt = directory / ("signal-" + str(int(signum)) + ".json")
        if receipt.exists() or not identity_matches(identity):
            return False
        atomic_json(receipt, {"execution_id": execution_id,
                             "request_sha256": request_sha256,
                             "signal_requested": int(signum), "at": now(),
                             "identity": identity}, immutable=True)
        os.killpg(identity["process_group"], signum)
        return True


class NativeStop(BaseException):
    pass


def run_request(request_path):
    request_path = Path(request_path).resolve(strict=True)
    request = read_json(request_path)
    if request.get("schema") != SCHEMA:
        raise ValueError("Choose an original native worker request")
    run_id = identifier(request["run_id"])
    execution_id = identifier(request["execution_id"])
    workspace_path = Path(request["workspace"]).resolve(strict=True)
    directory = workspace_path / "runs" / run_id / "supervision" / execution_id
    if request_path != directory / "request.json":
        raise ValueError("The worker request is outside its selected native run")
    if request.get("request_sha256") != digest({k: v for k, v in request.items()
                                              if k != "request_sha256"}):
        raise ValueError("The retained native request changed")

    application = Path(__file__).resolve().parents[1]
    for name, expected in request.get("application_source", {}).items():
        path = (application / name).resolve(strict=True)
        if not path.is_relative_to(application) or file_digest(path) != expected:
            raise ValueError("The native worker application source changed: " + name)
    from .workspace import Workspace
    workspace = Workspace(workspace_path)
    state = workspace.inspect_run(run_id)
    if state["selection"] != request["selection"]:
        raise ValueError("The native run selection differs from the retained worker request")
    if workspace.project["id"] != request["project_id"]:
        raise ValueError("The native request belongs to a different project")

    context = request.get("programme_context")
    if context:
        from .compute_programme import ComputeProgrammes
        programme = ComputeProgrammes(workspace)._load(identifier(context["programme_id"]))
        bindings = [row for row in programme["runs"] if row["run_id"] == run_id]
        if (context.get("run_id") != run_id or not bindings
                or digest(bindings) != context.get("bindings_sha256")
                or any(row["native_selection"] != request["selection"] for row in bindings)):
            raise ValueError("The worker run differs from its original programme binding")

    stopped = threading.Event()
    identity = process_identity()
    if not identity or identity["process_group"] != os.getpid():
        raise ValueError("The native worker needs its own Linux process group")
    started = time.monotonic()
    worker = {"schema": "upstate.native-worker/v1", "execution_id": execution_id,
              "run_id": run_id, "task_id": request["task_id"],
              "request_sha256": request["request_sha256"], "started_at": now(),
              "identity": identity, "python": sys.version.split()[0],
              "workspace": str(workspace_path), "resources": resource_status()}

    def interrupt(signum, frame):
        raise NativeStop("The operator requested a stop of this calculation")

    signal.signal(signal.SIGINT, interrupt)
    signal.signal(signal.SIGTERM, interrupt)

    def heartbeat():
        first_stop = None
        sent = set()
        while not stopped.is_set():
            with contextlib.suppress(OSError):
                atomic_json(directory / "heartbeat.json", {
                    "schema": "upstate.native-heartbeat/v1", "execution_id": execution_id,
                    "at": now(), "elapsed_seconds": time.monotonic() - started,
                    "identity": identity, "resources": resource_status()})
            stop_path = directory / "stop.json"
            if stop_path.exists():
                try:
                    stop = read_json(stop_path)
                    selected = (stop.get("execution_id") == execution_id
                                and stop.get("request_sha256") == request["request_sha256"])
                except (OSError, ValueError):
                    selected = False
                if selected:
                    if first_stop is None:
                        first_stop = time.monotonic()
                        with contextlib.suppress(OSError):
                            atomic_json(directory / "stop-acknowledged.json", {
                                "execution_id": execution_id, "at": now(),
                                "request_sha256": request["request_sha256"]})
                    elapsed = time.monotonic() - first_stop
                    stage = signal.SIGKILL if elapsed >= 30 else signal.SIGTERM if elapsed >= 15 else signal.SIGINT
                    if stage not in sent:
                        sent.add(stage)
                        # This process owns the fresh session and every signaled child.
                        with contextlib.suppress(ProcessLookupError):
                            signal_owned(directory, identity, execution_id, request["request_sha256"], stage)
            stopped.wait(1)

    with held(directory / ".worker.lock", blocking=False):
        atomic_json(directory / "worker.json", worker, immutable=True)
        ticker = threading.Thread(target=heartbeat, name="native-worker-heartbeat", daemon=True)
        try:
            ticker.start()
            print("Starting original native run " + run_id, flush=True)
            result = workspace.run(run_id)
            if result.get("id") != run_id or result.get("state") != "complete":
                raise ValueError("The original native calculation did not complete")
            atomic_json(directory / "result.json", {
                "schema": "upstate.native-worker-result/v1", "execution_id": execution_id,
                "request_sha256": request["request_sha256"], "completed_at": now(),
                "elapsed_seconds": time.monotonic() - started, "result": result})
            print("Original native run completed " + run_id, flush=True)
            return 0
        except BaseException as error:
            is_stop = isinstance(error, (NativeStop, KeyboardInterrupt))
            detail = {"schema": "upstate.native-worker-failure/v1", "execution_id": execution_id,
                      "request_sha256": request["request_sha256"], "at": now(),
                      "elapsed_seconds": time.monotonic() - started,
                      "stopped": is_stop, "type": type(error).__name__, "message": str(error)}
            with contextlib.suppress(OSError):
                atomic_json(directory / "failure.json", detail)
                (directory / "error.txt").write_text(traceback.format_exc(), encoding="utf-8")
            print(("Stopped" if is_stop else "Failed") + " original native run: " + str(error), flush=True)
            return 130 if is_stop else 1
        finally:
            stopped.set()
            ticker.join(timeout=2)
            with contextlib.suppress(OSError):
                atomic_json(directory / "finished.json", {
                    "execution_id": execution_id, "at": now(),
                    "elapsed_seconds": time.monotonic() - started,
                    "request_sha256": request["request_sha256"]})


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", required=True)
    args = parser.parse_args(argv)
    return run_request(args.request)


if __name__ == "__main__":
    raise SystemExit(main())
