#!/usr/bin/env python3
"""Continue prepared native runs through the original local operator and reconnect."""
from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

SCHEMA = "upstate.operator-native-receiving/v1"
TERMINAL = {"complete", "failed", "cancelled", "interrupted"}


def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as target:
            target.write(canonical(value) + b"\n")
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, path)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temporary)


def identity(pid):
    try:
        root = Path("/proc") / str(int(pid))
        stat = (root / "stat").read_text()
        fields = stat[stat.rfind(")") + 2:].split()
        if fields[0] == "Z":
            return None
        return {"pid": int(pid), "start_ticks": fields[19],
                "boot_id": Path("/proc/sys/kernel/random/boot_id").read_text().strip(),
                "command_sha256": hashlib.sha256((root / "cmdline").read_bytes()).hexdigest()}
    except (OSError, ValueError, IndexError):
        return None


def alive(record):
    return bool(record and identity(record["pid"]) == record)


def contained(path, parent):
    return path == parent or parent in path.parents


def public_job(job):
    return {key: job.get(key) for key in
            ("task_id", "run_id", "task_state", "run_state", "execution_id", "alive",
             "created_at", "heartbeat_at", "elapsed_seconds", "worker", "reconnected",
             "stop_requested", "native_execution", "run_error", "failure", "resources")}


class ReceivingError(RuntimeError):
    pass


class DeadlineReached(ReceivingError):
    pass


class LocalOperator:
    """Own or reconnect only the operator process recorded in this receiving edition."""

    def __init__(self, application, workspace, state, output, python, save):
        self.application, self.workspace, self.state = application, workspace, state
        self.private = output / "private"
        self.private.mkdir(mode=0o700, exist_ok=True)
        self.session_file = self.private / "operator.json"
        self.python, self.save = python, save
        self.process = None
        self.session = None
        self.startup = None
        self.http = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def _startup(self, log):
        try:
            with Path(log).open(encoding="utf-8", errors="replace") as source:
                for line in source:
                    try:
                        item = json.loads(line)
                    except ValueError:
                        continue
                    if isinstance(item, dict) and all(key in item for key in
                                                     ("operator_url", "workspace_key", "origin", "project")):
                        parsed = urllib.parse.urlsplit(item["origin"])
                        address = urllib.parse.urlsplit(item["operator_url"])
                        if (parsed.scheme != "http" or parsed.hostname != "127.0.0.1"
                                or parsed.username or parsed.password or not parsed.port
                                or address.scheme != parsed.scheme or address.netloc != parsed.netloc):
                            raise ReceivingError("The retained operator did not return its loopback origin.")
                        credential = urllib.parse.parse_qs(address.fragment).get("token", [])
                        if len(credential) != 1 or not credential[0]:
                            raise ReceivingError("The original operator startup capability is missing.")
                        return item
        except FileNotFoundError:
            pass
        return None

    def start(self, timeout):
        if self.session_file.exists():
            previous = read(self.session_file)
            expected = {"application": str(self.application), "workspace": str(self.workspace),
                        "operator_state": str(self.state), "python": self.python}
            if any(previous.get(key) != value for key, value in expected.items()):
                raise ReceivingError("Resume the same application, interpreter, Workspace and operator-state.")
            if alive(previous.get("identity")):
                self.session = previous
                self.startup = self._startup(previous["log"])
                if not self.startup:
                    raise ReceivingError("The original operator is alive but its startup record is incomplete; retain it for inspection.")
                self.request("GET", "/api/whoami")
                return
        serial = time.time_ns()
        log = self.private / ("operator-" + str(serial) + ".log")
        command = [self.python, "-B", "-u", str(self.application / "operator" / "server.py"),
                   "--workspace", str(self.workspace), "--operator-state", str(self.state), "--port", "0"]
        environment = dict(os.environ)
        environment.update(PYTHONUNBUFFERED="1", PYTHONDONTWRITEBYTECODE="1",
                           GDAL_CACHEMAX=environment.get("GDAL_CACHEMAX", "16"),
                           GDAL_NUM_THREADS=environment.get("GDAL_NUM_THREADS", "1"))
        fd = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "ab", buffering=0) as stream:
            self.process = subprocess.Popen(command, cwd=self.application, env=environment,
                                            stdin=subprocess.DEVNULL, stdout=stream,
                                            stderr=subprocess.STDOUT, close_fds=True, start_new_session=True)
        self.session = {"application": str(self.application), "workspace": str(self.workspace),
                        "operator_state": str(self.state), "python": self.python,
                        "identity": identity(self.process.pid), "pid": self.process.pid,
                        "log": str(log), "command": command, "started_at": utc()}
        write(self.session_file, self.session)
        self.save(operator={"pid": self.process.pid, "started_at": self.session["started_at"],
                            "identity": self.session["identity"], "log": str(log)})
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if self.process.poll() is not None:
                raise ReceivingError("The original operator exited during startup; inspect " + str(log))
            self.startup = self._startup(log)
            if self.startup:
                self.request("GET", "/api/whoami")
                return
            time.sleep(.2)
        raise ReceivingError("The original operator is still starting; retain " + str(log) + " and rerun this same command.")

    def request(self, method, route, payload=None, query=None):
        if not self.startup:
            raise ReceivingError("The original operator has no startup record.")
        origin = self.startup["origin"]
        credential = urllib.parse.parse_qs(urllib.parse.urlsplit(self.startup["operator_url"]).fragment)["token"][0]
        url = origin + route
        if query:
            url += "?" + urllib.parse.urlencode(query)
        headers = {"Authorization": "Bearer " + credential, "Origin": origin,
                   "Accept-Encoding": "identity", "Accept": "application/json"}
        data = None
        if payload is not None:
            headers["Content-Type"] = "application/json"
            data = canonical(payload)
        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with self.http.open(request, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            body = error.read(65536).decode("utf-8", "replace")
            raise ReceivingError("Original operator HTTP " + str(error.code) + ": " + body) from None

    def close(self, timeout):
        if not self.session:
            return
        record = self.session.get("identity")
        if not alive(record):
            if self.process:
                self.process.poll()
            self.startup = None
            return
        # Signal this exact recorded operator, never the worker or a process group.
        os.kill(record["pid"], signal.SIGTERM)
        end = time.monotonic() + timeout
        while alive(record) and time.monotonic() < end:
            if self.process:
                self.process.poll()
            time.sleep(.2)
        if alive(record):
            raise ReceivingError("The original operator is still draining. Keep its PID and state; no replacement was launched.")
        if self.process:
            self.process.wait(timeout=1)
        self.startup = None

    def view(self, task_id):
        return self.request("GET", "/api/native-job",
                            query={"workspace": self.startup["workspace_key"], "id": task_id,
                                   "stream": "native", "offset": "0"})


def run(args):
    application = args.application.resolve(strict=True)
    workspace = args.workspace.resolve(strict=True)
    output = args.output.resolve()
    state = args.operator_state.resolve() if args.operator_state else output / "operator-state"
    for name, path in (("output", output), ("operator-state", state)):
        if any(contained(path, parent) or contained(parent, path) for parent in (application, workspace)):
            raise ReceivingError("Keep " + name + " separate from the application and scientific Workspace.")
    if output == state or contained(output, state):
        raise ReceivingError("Keep the output receipt outside the operator-state directory.")
    if os.name != "posix" or not Path("/proc/self/stat").exists():
        raise ReceivingError("Use the existing Linux native host for process-identity reconnect.")
    runs = list(dict.fromkeys(args.run_id))
    if args.prepared_receipt:
        prepared = read(args.prepared_receipt)
        original = prepared.get("workspace_directory") or prepared.get("workspace")
        if not original or Path(original).resolve() != workspace:
            raise ReceivingError("The prepared demo receipt belongs to another Workspace.")
        runs = list(dict.fromkeys([prepared["baseline_run_id"],
                                  *prepared.get("alternative_run_ids", []), *runs]))
    if not runs or any(not isinstance(key, str) or not key or not key.isalnum() for key in runs):
        raise ReceivingError("Select the original prepared run IDs or the original demo-receiving.json.")
    deadline = dt.datetime.fromisoformat(args.deadline.replace("Z", "+00:00"))
    if deadline.tzinfo is None:
        raise ReceivingError("Use a deadline with an explicit UTC offset.")
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock = (output / ".operator-native-receiving.lock").open("a")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    try:
        return run_locked(args, application, workspace, output, state, runs, deadline)
    finally:
        fcntl.flock(lock, fcntl.LOCK_UN)
        lock.close()


def run_locked(args, application, workspace, output, state, runs, deadline):
    receipt_path = output / "operator-native-receiving.json"
    selection = {"application": str(application), "workspace": str(workspace),
                 "operator_state": str(state), "python": str(Path(args.python).absolute()),
                 "run_ids": runs}
    digest = hashlib.sha256(canonical(selection)).hexdigest()
    receipt = read(receipt_path) if receipt_path.exists() else {
        "schema": SCHEMA, "selection": selection, "selection_sha256": digest,
        "created_at": utc(), "state": "prepared", "runs": {}, "normal_close": None}
    if receipt.get("schema") != SCHEMA or receipt.get("selection") != selection:
        raise ReceivingError("Resume the exact receiving selection and output directory.")

    def save(**changes):
        receipt.update(changes, updated_at=utc())
        write(receipt_path, receipt)

    keep_operator = False

    def checkpoint(task_id=None):
        nonlocal keep_operator
        if dt.datetime.now(dt.timezone.utc) < deadline:
            return
        task_id = task_id or receipt.get("active_task_id")
        cutoff = DeadlineReached("The original task was checkpointed at the selected deadline; no automatic resume is scheduled.")
        recording_error = None

        def retain_cutoff(**values):
            nonlocal recording_error
            try:
                save(**values)
            except OSError as error:
                recording_error = error

        # Stop belongs to the existing supervisor. Receipt capacity must never
        # prevent its request or detach its escalation monitor prematurely.
        if task_id:
            keep_operator = True
            if not operator.startup:
                operator.start(args.startup_timeout)
            observed = operator.view(task_id)
            task, job = observed["task"], observed["native_job"]
            if task["state"] in {"queued", "running"} or job.get("alive"):
                result = operator.request("POST", "/api/task/cancel", {"id": task_id})
                receipt["deadline_stop"] = {"requested_at": utc(), "task_id": task_id,
                                            "state": result.get("state")}
                retain_cutoff(state="deadline_stopping", deadline=args.deadline)
                # A reopened operator marks an old task interrupted. Reattach
                # that same live, stop-marked child so its maintained monitor
                # performs the original SIGINT/TERM/KILL escalation.
                after_cancel = operator.view(task_id)
                stopped_task, stopped_job = after_cancel["task"], after_cancel["native_job"]
                if stopped_job.get("alive") and stopped_task["state"] not in {"queued", "running"}:
                    if not stopped_job.get("stop_requested"):
                        # Queued-task cancellation can race a retained live child.
                        # The now-inactive original task admits its native Stop.
                        operator.request("POST", "/api/task/cancel", {"id": task_id})
                    operator.request("POST", "/api/task/resume", {"id": task_id})
                end = time.monotonic() + args.stop_timeout
                while True:
                    observed = operator.view(task_id)
                    task, job = observed["task"], observed["native_job"]
                    receipt["deadline_stop"].update(observed_at=utc(), task_state=task["state"],
                                                    native_job=public_job(job))
                    if not job.get("alive") and task["state"] in TERMINAL:
                        keep_operator = False
                        break
                    if time.monotonic() >= end:
                        retain_cutoff(state="deadline_stop_pending", deadline=args.deadline)
                        error = ReceivingError("The original supervisor is still stopping its owned worker. Its operator remains running; inspect this same task.")
                        if recording_error:
                            raise error from recording_error
                        raise error
                    time.sleep(min(args.poll_seconds, 1.0))
            else:
                keep_operator = False
        retain_cutoff(state="deadline_reached", deadline=args.deadline)
        if recording_error:
            raise cutoff from recording_error
        raise cutoff

    operator = LocalOperator(application, workspace, state, output, selection["python"], save)
    current = None

    def reconnect(task_id, before):
        close_record = receipt["normal_close"]
        if close_record["state"] == "closing":
            operator.close(args.close_timeout)
            close_record.update(closed_at=utc(), state="closed")
            save()
        if close_record["state"] == "closed":
            operator.start(args.startup_timeout)
        after = operator.view(task_id)["native_job"]
        if after.get("execution_id") != before.get("execution_id"):
            raise ReceivingError("The original execution changed across normal operator close.")
        old_identity = (before.get("worker") or {}).get("identity")
        new_identity = (after.get("worker") or {}).get("identity")
        if old_identity != new_identity:
            raise ReceivingError("The original worker identity changed across normal operator close.")
        close_record.update(reopened_at=utc(), after=public_job(after),
            state="reopened", same_execution=True, same_worker_identity=True)
        save()
        checkpoint(task_id)
        if not after.get("alive") and after.get("run_state") != "complete":
            close_record.update(state="worker_ended", observed_at=utc())
            save()
            raise ReceivingError("The original child ended while the operator reopened; inspect its retained failure before another attempt.")
        task = operator.request("POST", "/api/task/resume", {"id": task_id})
        if task["id"] != task_id:
            raise ReceivingError("The original resume returned another task.")
        close_record.update(resumed_at=utc(), state="resumed", resume_task_id=task["id"])
        save()
        return task

    try:
        checkpoint()
        operator.start(args.startup_timeout)
        workspace_key = operator.startup["workspace_key"]
        project_id = operator.startup["project"]["id"]
        if receipt.get("project_id") not in (None, project_id):
            raise ReceivingError("The original project identity changed.")
        save(state="running", workspace_key=workspace_key, project_id=project_id, deadline=args.deadline)
        for index, run_id in enumerate(runs):
            checkpoint()
            row = receipt["runs"].setdefault(run_id, {
                "operation_id": "operator-native-" + hashlib.sha256(
                    canonical({"course": digest, "run_id": run_id})).hexdigest(),
                "selected_at": utc()})
            save()
            if row.get("task_id"):
                task = operator.request("GET", "/api/task", query={"id": row["task_id"]})
            else:
                task = operator.request("POST", "/api/actions", {
                    "workspace": workspace_key, "action": "run.start",
                    "payload": {"run_id": run_id}, "operation_id": row["operation_id"]})
            if (task.get("workspace") != workspace_key or task.get("action") != "run.start"
                    or task.get("payload") != {"run_id": run_id}):
                raise ReceivingError("The existing task does not match the selected original run.")
            current = task["id"]
            row.update(task_id=current, actual_operation_id=task["operation_id"],
                       requested_by=task.get("requested_by"), task_state=task["state"])
            save(active_run_id=run_id, active_task_id=current)
            pending_close = receipt.get("normal_close")
            if (pending_close and pending_close.get("task_id") == current
                    and pending_close.get("state") in {"closing", "closed", "reopened"}):
                task = reconnect(current, pending_close["before"])
            if task["state"] == "interrupted" or (args.resume_failed and task["state"] in {"failed", "cancelled"}):
                task = operator.request("POST", "/api/task/resume", {"id": current})
            while True:
                checkpoint(current)
                value = operator.view(current)
                task, job = value["task"], value["native_job"]
                row.update(task_state=task["state"], native_job=public_job(job),
                           attempts=task.get("attempts", []), observed_at=utc())
                save()
                if task["state"] == "complete":
                    if task.get("result", {}).get("id") != run_id:
                        raise ReceivingError("The completed task returned another run.")
                    row.update(completed_at=utc(), result=task["result"])
                    save()
                    break
                if task["state"] in TERMINAL:
                    row["error"] = task.get("error")
                    save(state=task["state"])
                    raise ReceivingError("The original task is " + task["state"] + "; inspect the retained task and native failure.")
                if index == 0 and job.get("alive") and receipt.get("normal_close") is None:
                    before = public_job(job)
                    receipt["normal_close"] = {"requested_at": utc(), "task_id": current,
                                               "before": before, "state": "closing"}
                    save()
                    task = reconnect(current, before)
                time.sleep(args.poll_seconds)
            current = None
        if receipt.get("normal_close") is None:
            receipt["normal_close"] = {"state": "completed_before_live_close",
                                      "observed_at": utc()}
        operator.close(args.close_timeout)
        save(state="complete", completed_at=utc(), active_run_id=None, active_task_id=None)
        return receipt
    except BaseException as error:
        if not isinstance(error, DeadlineReached):
            try:
                save(state="interrupted" if isinstance(error, (KeyboardInterrupt, SystemExit)) else "failed",
                     error={"type": type(error).__name__, "message": str(error)},
                     active_task_id=current or receipt.get("active_task_id"))
            except OSError as receipt_error:
                raise error from receipt_error
        raise
    finally:
        # An ordinary close detaches a still-active native child for the same task.
        # No unconditional SIGKILL or implicit fresh worker is introduced.
        if operator.startup and not keep_operator:
            try:
                operator.close(args.close_timeout)
            except Exception as close_error:
                with contextlib.suppress(OSError):
                    save(close_error={"type": type(close_error).__name__, "message": str(close_error)})


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--prepared-receipt", type=Path)
    parser.add_argument("--run-id", action="append", default=[])
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--operator-state", type=Path)
    parser.add_argument("--python", default=sys.executable)
    parser.add_argument("--deadline", required=True, help="Explicit ISO8601 cutoff, including UTC offset.")
    parser.add_argument("--startup-timeout", type=float, default=90)
    parser.add_argument("--close-timeout", type=float, default=60)
    parser.add_argument("--stop-timeout", type=float, default=90,
                        help="Time to observe the existing supervisor stop, at least 35 seconds.")
    parser.add_argument("--poll-seconds", type=float, default=1)
    parser.add_argument("--resume-failed", action="store_true",
                        help="Explicitly resume a retained failed/cancelled task once at entry.")
    args = parser.parse_args(argv)
    if min(args.startup_timeout, args.close_timeout, args.poll_seconds) <= 0 or args.stop_timeout < 35:
        parser.error("Use positive startup/close/poll durations and at least 35 seconds for the original stop drain.")
    def interrupt(*_):
        raise KeyboardInterrupt("The receiving client was interrupted; retain its original task.")
    previous_term = signal.signal(signal.SIGTERM, interrupt)
    try:
        result = run(args)
    except KeyboardInterrupt as error:
        print(json.dumps({"state": "interrupted", "message": str(error)}))
        return 130
    except DeadlineReached as error:
        print(json.dumps({"state": "deadline_reached", "message": str(error)}))
        return 75
    except Exception as error:
        print(json.dumps({"state": "failed", "error": type(error).__name__, "message": str(error)}), file=sys.stderr)
        return 1
    finally:
        signal.signal(signal.SIGTERM, previous_term)
    print(json.dumps({"state": result["state"], "project_id": result["project_id"],
                      "receipt": str(args.output.resolve() / "operator-native-receiving.json"),
                      "run_ids": result["selection"]["run_ids"],
                      "normal_close": (result.get("normal_close") or {}).get("state")}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
