"""Supervise original Workspace runs and reconnect the same owned Linux worker."""
from __future__ import annotations
import contextlib
import datetime as dt
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import threading
import time

from model.common import (atomic_json, digest, file_digest, held, identifier,
                          now, read_json, verify_file)
from model.native_worker import SCHEMA, identity_matches, process_identity, signal_owned
from model.native_execution import storage_exhausted

APPLICATION = Path(__file__).resolve().parents[1]


class NativeJobError(RuntimeError):
    def __init__(self, code, message, status=409):
        super().__init__(message)
        self.code, self.status = code, status


class NativeJobCancelled(NativeJobError):
    pass


class NativeJobDetached(NativeJobError):
    pass


class _RetainedWorkspace:
    """The retained-input wrapper sees the real workspace and supervised run."""
    def __init__(self, supervisor, task, workspace):
        self._supervisor, self._task, self._workspace = supervisor, task, workspace

    def __getattr__(self, name):
        return getattr(self._workspace, name)

    def run(self, run_id):
        if run_id != self._task["payload"].get("run_id"):
            raise NativeJobError("NATIVE_SELECTION", "Retain the originally selected native run.", 422)
        return self._supervisor.execute(self._task, self._workspace)


def _read(path):
    try:
        return read_json(path)
    except (OSError, ValueError):
        return None


class NativeJobs:
    def __init__(self, operator):
        self.operator = operator
        self.lock = threading.RLock()
        self.processes = {}
        self.pending_stops = set()

    @staticmethod
    def supports(task):
        return (task.get("action") in {"run.start", "compute.programme.run"}
                or (task.get("action") == "compute.programme.pair-completion"
                    and task.get("payload", {}).get("run") is True))

    def _selection(self, task):
        ws = self.operator.ws(task["workspace"])
        if task.get("action") == "run.start":
            run_id = identifier(task["payload"].get("run_id"))
        else:
            from programme_jobs import bound_task, select_task
            if "_native_context" not in task:
                task.update(select_task(task, ws))
            context = task["_native_context"]
            checked = bound_task(task, ws, context["programme_id"], context["run_id"])
            if checked["_native_context"] != context:
                raise NativeJobError("PROGRAMME_SELECTION", "The retained programme binding changed.")
            run_id = context["run_id"]
        run = ws.inspect_run(run_id)
        return ws, run

    def _latest(self, task):
        ws, run = self._selection(task)
        root = ws.root / "runs" / run["id"] / "supervision"
        candidates = []
        if root.exists():
            for path in root.glob("*/request.json"):
                request = _read(path)
                if not request:
                    continue
                context = task.get("_native_context")
                if context:
                    if request.get("programme_context") != context:
                        continue
                elif request.get("task_id") != task["id"]:
                    continue
                if (request.get("run_id") != run["id"]
                        or request.get("project_id") != ws.project["id"]
                        or request.get("selection") != run["selection"]
                        or (not context and "original_payload" in request
                            and request["original_payload"] != task["payload"])):
                    raise NativeJobError("NATIVE_SELECTION", "The retained worker selection changed.")
                wanted = digest({k: v for k, v in request.items() if k != "request_sha256"})
                if request.get("request_sha256") != wanted:
                    raise NativeJobError("NATIVE_REQUEST_CHANGED", "The retained worker request changed.")
                if identifier(request.get("execution_id")) != path.parent.name:
                    raise NativeJobError("NATIVE_EXECUTION_CHANGED", "The native execution directory differs.")
                candidates.append((request.get("created_at", ""), path.parent, request))
        if not candidates:
            return None
        _, directory, request = max(candidates, key=lambda value: value[0])
        identity_record = _read(directory / "worker.json") or _read(directory / "launch.json") or {}
        if identity_record.get("request_sha256") not in (None, request["request_sha256"]):
            raise NativeJobError("NATIVE_WORKER_CHANGED", "The original worker receipt changed.")
        return {"directory": directory, "request": request,
                "identity": identity_record.get("identity"),
                "worker": identity_record, "run": run, "workspace": ws}

    @staticmethod
    def _alive(execution):
        return bool(execution and execution.get("identity")
                    and identity_matches(execution["identity"]))

    def _stop_record(self, execution):
        request, directory = execution["request"], execution["directory"]
        record = {"schema": "upstate.native-stop/v1", "execution_id": request["execution_id"],
                  "request_sha256": request["request_sha256"],
                  "task_id": request["task_id"], "requested_at": now()}
        old = _read(directory / "stop.json")
        if old and (old.get("execution_id"), old.get("request_sha256")) == (
                request["execution_id"], request["request_sha256"]):
            return old
        atomic_json(directory / "stop.json", record, immutable=True)
        return record

    def request_stop(self, task):
        if task.get("action") != "run.start":
            from programme_jobs import programme_id
            from model.compute_programme import ComputeProgrammes
            ws = self.operator.ws(task["workspace"])
            # Pause the coordinator before stopping its current owned worker.
            ComputeProgrammes(ws).pause(programme_id(task, ws))
        execution = self._latest(task)
        if execution and self._alive(execution):
            self._stop_record(execution)
        elif task["state"] == "running":
            # The user can stop during the short interval before the worker starts.
            with self.lock:
                self.pending_stops.add(task["id"])
            if execution and not _read(execution["directory"] / "finished.json"):
                self._stop_record(execution)
        else:
            raise NativeJobError("NATIVE_FINISHED",
                                 "This task has no active calculation to stop. Open its current result or resume its retained selection.")
        return {**task, "_native_job": self.snapshot(task)}

    def _new(self, task, ws, run):
        source_paths = ("model/native_worker.py", "operator/native_jobs.py",
                        "model/native.py", "model/workspace.py", "model/common.py")
        source = {name: file_digest(APPLICATION / name) for name in source_paths}
        request = {"schema": SCHEMA, "task_id": task["id"],
                   "operation_id": task["operation_id"], "attempt": len(task["attempts"]),
                   "project_id": ws.project["id"], "workspace": str(ws.root),
                   "run_id": run["id"], "selection": run["selection"],
                   "original_payload": task["payload"],
                   "created_at": now(), "application_source": source}
        if task.get("_native_context"):
            request["programme_context"] = task["_native_context"]
            request["task_action"] = task["action"]
            for name in ("model/compute_programme.py", "operator/programme_jobs.py"):
                source[name] = file_digest(APPLICATION / name)
        request["execution_id"] = digest(request)
        request["request_sha256"] = digest(request)
        directory = ws.root / "runs" / run["id"] / "supervision" / request["execution_id"]
        directory.mkdir(parents=True, exist_ok=True)
        atomic_json(directory / "request.json", request, immutable=True)
        environment = dict(os.environ)
        environment["PYTHONUNBUFFERED"] = "1"
        environment["PYTHONDONTWRITEBYTECODE"] = "1"
        process = None
        with (directory / "process.log").open("ab", buffering=0) as output:
            process = subprocess.Popen(
                [sys.executable, "-B", "-m", "model.native_worker",
                 "--request", str(directory / "request.json")],
                cwd=APPLICATION, env=environment, stdin=subprocess.DEVNULL,
                stdout=output, stderr=subprocess.STDOUT, close_fds=True, start_new_session=True)
        identity = process_identity(process.pid)
        launch = {"schema": "upstate.native-launch/v1", "execution_id": request["execution_id"],
                  "request_sha256": request["request_sha256"], "started_at": now(),
                  "identity": identity, "pid": process.pid}
        atomic_json(directory / "launch.json", launch, immutable=True)
        execution = {"directory": directory, "request": request, "identity": identity,
                     "worker": launch, "run": run, "workspace": ws}
        with self.lock:
            self.processes[request["execution_id"]] = process
            if task["id"] in self.pending_stops:
                self._stop_record(execution)
                self.pending_stops.discard(task["id"])
        return execution, process

    def _complete(self, execution):
        path = execution["directory"] / "result.json"
        result = _read(path)
        if not result:
            return None
        request = execution["request"]
        if (result.get("execution_id") != request["execution_id"]
                or result.get("request_sha256") != request["request_sha256"]):
            raise NativeJobError("NATIVE_RESULT_CHANGED", "The original worker result belongs to another request.")
        value = result.get("result", {})
        if (value.get("state") != "complete" or value.get("id") != request["run_id"]
                or value.get("selection") != request["selection"]):
            raise NativeJobError("NATIVE_RESULT_SELECTION", "The worker result differs from the selected native run.")
        ws = execution["workspace"]
        current = ws.inspect_run(request["run_id"])
        if current.get("state") != "complete" or current.get("artifacts") != value.get("artifacts"):
            raise NativeJobError("NATIVE_RESULT_STATE", "The current original run differs from its completed worker result.")
        for artifact in current.get("artifacts", {}).values():
            verify_file(ws.root / "runs" / request["run_id"], artifact)
        return value

    def _record_exit(self, execution, state, *, returncode=None, error=None):
        request = execution["request"]
        value = {"schema": "upstate.native-supervision/v1",
                 "execution_id": request["execution_id"], "task_id": request["task_id"],
                 "request_sha256": request["request_sha256"], "state": state,
                 "ended_at": now(), "returncode": returncode}
        if error:
            value["error"] = error
        atomic_json(execution["directory"] / "supervision.json", value)

    def _mark_interrupted(self, execution, message):
        """Only reconcile a dead worker; never edit a run held by another process."""
        ws, request = execution["workspace"], execution["request"]
        directory = ws.root / "runs" / request["run_id"]
        try:
            with held(directory / ".run.lock", blocking=False):
                run = ws.inspect_run(request["run_id"])
                if run.get("state") == "running":
                    run.update(state="failed", updated_at=now(),
                               error={"type": "NativeWorkerInterrupted", "message": message})
                    atomic_json(directory / "run.json", run)
        except BlockingIOError:
            pass

    def create_pair_completion(self, task, manager, key, *, expected_preview_id=None):
        from programme_jobs import create_pair_completion
        return create_pair_completion(self, task, manager, key, expected_preview_id=expected_preview_id)

    def execute_programme(self, task, manager, key, *, only_runs=None):
        from programme_jobs import execute_programme
        return execute_programme(self, task, manager, key, only_runs=only_runs)

    def execute_retained(self, task, ws):
        """Keep original ECO-RUN12 retention outside the same detached worker."""
        from ecsa_runs.upstate import invoke_original_run
        # Current retention seeds explicitly selected completed stages before run().
        # That operation takes .run.lock; reconnect the existing owned calculation
        # first so an ordinary operator restart cannot collide with its live lock.
        if "source_runs" in task["payload"]:
            execution = self._latest(task)
            if execution and self._alive(execution):
                self.execute(task, ws)
        return invoke_original_run(self.operator, task,
                                   _RetainedWorkspace(self, task, ws),
                                   task["payload"]["run_id"])

    def execute(self, task, ws):
        _, run = self._selection(task)
        gate = ws.root / "runs" / run["id"] / ".native-supervision.lock"
        with held(gate, blocking=False):
            execution = self._latest(task)
            if execution:
                complete = self._complete(execution)
                if complete:
                    return complete
            if execution and self._alive(execution):
                with self.lock:
                    process = self.processes.get(execution["request"]["execution_id"])
                atomic_json(execution["directory"] / "reconnected.json",
                            {"task_id": task["id"], "at": now(),
                             "operator_attempt": len(task["attempts"]),
                             "execution_id": execution["request"]["execution_id"]})
            else:
                execution, process = self._new(task, ws, run)
            return self._monitor(execution, process)

    def reconnect_existing(self, task, ws):
        """Drain an already-owned programme child without starting another case."""
        _, run = self._selection(task)
        with held(ws.root / "runs" / run["id"] / ".native-supervision.lock", blocking=False):
            execution = self._latest(task)
            if not execution or not self._alive(execution):
                return None
            with self.lock:
                process = self.processes.get(execution["request"]["execution_id"])
            atomic_json(execution["directory"] / "reconnected.json",
                        {"task_id": task["id"], "at": now(),
                         "operator_attempt": len(task["attempts"]),
                         "execution_id": execution["request"]["execution_id"],
                         "boundary": "before_programme_resume"})
            return self._monitor(execution, process)

    def _monitor(self, execution, process):
        directory, request = execution["directory"], execution["request"]
        stop_started = None
        signals_sent = set()
        while True:
            complete = self._complete(execution)
            if complete:
                if process:
                    with contextlib.suppress(subprocess.TimeoutExpired):
                        process.wait(timeout=3)
                returncode = process.poll() if process else None
                self._record_exit(execution, "complete", returncode=returncode)
                with self.lock:
                    self.processes.pop(request["execution_id"], None)
                return complete
            worker = _read(directory / "worker.json") or _read(directory / "launch.json") or {}
            if worker.get("identity"):
                execution["identity"] = worker["identity"]
            returncode = process.poll() if process else None
            alive = (returncode is None) if process else self._alive(execution)
            stop = _read(directory / "stop.json")
            selected_stop = bool(stop and stop.get("execution_id") == request["execution_id"]
                                 and stop.get("request_sha256") == request["request_sha256"])
            if selected_stop and alive:
                if stop_started is None:
                    stop_started = time.monotonic()
                elapsed = time.monotonic() - stop_started
                sig = signal.SIGKILL if elapsed >= 30 else signal.SIGTERM if elapsed >= 15 else signal.SIGINT
                if sig not in signals_sent and self._alive(execution):
                    signals_sent.add(sig)
                    # Identity and session membership are checked before every signal.
                    with contextlib.suppress(ProcessLookupError):
                        signal_owned(directory, execution["identity"], request["execution_id"],
                                     request["request_sha256"], sig)
            failure = _read(directory / "failure.json")
            if failure or not alive:
                if process:
                    with contextlib.suppress(subprocess.TimeoutExpired):
                        process.wait(timeout=3)
                    returncode = process.poll()
                # The worker publishes its result before ending. Read again after exit.
                complete = self._complete(execution)
                if complete:
                    self._record_exit(execution, "complete", returncode=returncode)
                    return complete
                cancelled = bool((failure or {}).get("stopped") or selected_stop)
                message = ((failure or {}).get("message") or
                           "The native worker ended before producing a completed result"
                           + (" (process exit " + str(returncode) + ")" if returncode is not None else "") + ".")
                error = (NativeJobCancelled(
                    "NATIVE_STOPPED",
                    "Calculation stopped. Its retained completed stages remain available when you resume.")
                    if cancelled else NativeJobError("NATIVE_PROCESS_EXIT", message, 500))
                recording_errors = []
                try:
                    # Keep the original cause before any same-filesystem writes.
                    if not cancelled:
                        try:
                            native_failure = execution["workspace"].inspect_run(request["run_id"]).get("error")
                            if isinstance(native_failure, dict):
                                error.native_failure = native_failure
                        except OSError as recording_error:
                            recording_errors.append(recording_error)
                    try:
                        self._mark_interrupted(execution, message)
                    except OSError as recording_error:
                        recording_errors.append(recording_error)
                    try:
                        self._record_exit(execution, "cancelled" if cancelled else "failed",
                                          returncode=returncode, error={"message": message})
                    except OSError as recording_error:
                        recording_errors.append(recording_error)
                finally:
                    with self.lock:
                        self.processes.pop(request["execution_id"], None)
                if recording_errors:
                    error.supervision_errors = [
                        {"type": type(item).__name__, "message": str(item), "errno": item.errno}
                        for item in recording_errors]
                    if not cancelled:
                        error.native_failure = {
                            **getattr(error, "native_failure", {
                                "type": type(error).__name__, "message": str(error)}),
                            "supervision_errors": error.supervision_errors}
                    # Preserve capacity classification even when another receipt
                    # failed first, and retain the original process error above it.
                    cause = next((item for item in recording_errors if storage_exhausted(item)),
                                 recording_errors[0])
                    raise error from cause
                raise error
            if self.operator.closing:
                # Let Operator.close finish while the detached native worker continues.
                self._record_exit(execution, "detached")
                with self.lock:
                    self.processes.pop(request["execution_id"], None)
                raise NativeJobDetached("NATIVE_DETACHED",
                                        "The operator closed while its native calculation continued. Reopen this task to reconnect to the same worker.")
            time.sleep(0.4)

    @staticmethod
    def _resources(identity):
        if not identity or not identity_matches(identity):
            return {}
        values = {}
        try:
            status = (Path("/proc") / str(identity["pid"]) / "status").read_text()
            for line in status.splitlines():
                if line.startswith(("VmRSS:", "VmHWM:", "Threads:")):
                    key, raw = line.split(":", 1)
                    number = int(raw.split()[0])
                    values[{"VmRSS": "resident_bytes", "VmHWM": "peak_resident_bytes",
                            "Threads": "threads"}[key]] = number * 1024 if key.startswith("Vm") else number
        except (OSError, ValueError, IndexError):
            return {}
        return values if identity_matches(identity) else {}

    def snapshot(self, task):
        ws, run = self._selection(task)
        execution = self._latest(task)
        value = {"schema": "upstate.native-job-view/v1", "task_id": task["id"],
                 "run_id": run["id"], "task_state": task["state"],
                 "run_state": run["state"], "selection": run["selection"],
                 "stages": run.get("stages", {}), "artifacts": run.get("artifacts", {}),
                 "native_execution": run.get("execution"), "run_error": run.get("error"),
                 "alive": False, "stop_requested": False,
                 "storage_free_bytes": shutil.disk_usage(ws.root).free}
        if task.get("_native_context"):
            value["programme_context"] = task["_native_context"]
        if not execution:
            with self.lock:
                value["stop_requested"] = task["id"] in self.pending_stops
            return value
        request, directory = execution["request"], execution["directory"]
        heartbeat = _read(directory / "heartbeat.json") or {}
        finished = _read(directory / "finished.json") or {}
        supervision = _read(directory / "supervision.json") or {}
        stop = _read(directory / "stop.json")
        value.update(execution_id=request["execution_id"], created_at=request["created_at"],
                     alive=self._alive(execution), worker=execution["worker"],
                     heartbeat_at=heartbeat.get("at"),
                     elapsed_seconds=finished.get("elapsed_seconds", heartbeat.get("elapsed_seconds")),
                     stop_requested=bool(stop), stop_requested_at=(stop or {}).get("requested_at"),
                     reconnected=_read(directory / "reconnected.json"),
                     supervision=supervision, failure=_read(directory / "failure.json"),
                     resources=self._resources(execution.get("identity")))
        if value["alive"] and value["elapsed_seconds"] is None:
            start = dt.datetime.fromisoformat(request["created_at"])
            value["elapsed_seconds"] = max(0, (dt.datetime.now(dt.timezone.utc) - start).total_seconds())
        return value

    def view(self, task_id, workspace, *, stream="native", offset=0, expected_run=None,
             expected_execution=None):
        task = self.operator.task(identifier(task_id))
        if task["workspace"] != workspace:
            raise NativeJobError("NATIVE_WORKSPACE", "Choose this task in its original workspace.", 404)
        snapshot = self.snapshot(task)
        execution = self._latest(task)
        ws, run = self._selection(task)
        if stream not in {"native", "process"}:
            raise NativeJobError("NATIVE_LOG", "Choose the native or process log.", 422)
        path = (ws.root / "runs" / run["id"] / "native.log" if stream == "native"
                else execution["directory"] / "process.log" if execution else None)
        changed_run = bool(expected_run and expected_run != run["id"])
        execution_id = execution["request"]["execution_id"] if execution else None
        changed_execution = bool(stream == "process" and expected_execution
                                 and expected_execution != execution_id)
        reset = changed_run or changed_execution
        offset = 0 if reset else max(0, int(offset))
        log = {"stream": stream, "offset": offset, "next_offset": offset,
               "bytes": 0, "text": "", "reset": reset}
        if path and path.exists():
            with path.open("rb") as source:
                size = os.fstat(source.fileno()).st_size
                if offset > size:
                    offset = 0
                    log["reset"] = True
                source.seek(offset)
                data = source.read(65536)
            log.update(offset=offset, next_offset=offset + len(data),
                       bytes=size, text=data.decode("utf-8", "replace"))
        return {"task": task, "native_job": snapshot, "log": log}
