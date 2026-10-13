"""Run one saved structural study through the original owned native supervisor."""
from __future__ import annotations

from copy import deepcopy

from model.common import identifier, read_json
from model.native_execution import native_batch_lease, process_interrupted
from model.structural_studies import StructuralStudies
from native_jobs import NativeJobCancelled, NativeJobDetached, NativeJobError


def original_context(task):
    value = {name: deepcopy(task.get(name)) for name in
             ("operation_id", "workspace", "action", "payload", "request_sha256", "requested_by")}
    value["task_id"] = task["id"]
    return value


def bound_task(task, workspace, study_id, run_id):
    key = identifier(study_id)
    if (task.get("action") != "structural-study.run"
            or identifier(task.get("payload", {}).get("study_id")) != key):
        raise NativeJobError("STRUCTURAL_STUDY_TASK", "Choose the original structural-study task.", 422)
    context = StructuralStudies(workspace).native_case_context(key, identifier(run_id))
    return {**task, "_native_structural_context": context}


def select_task(task, workspace):
    key = identifier(task["payload"].get("study_id"))
    current = StructuralStudies(workspace).inspect(key)
    ordered = list(dict.fromkeys(row["run_id"] for row in current["cases"]))
    if not ordered:
        raise NativeJobError("STRUCTURAL_STUDY_CASES", "This saved study has no original native cases.", 422)
    selected = current.get("active_run_id")
    if selected not in ordered:
        candidates = []
        for run_id in ordered:
            for path in (workspace.root / "runs" / run_id / "supervision").glob("*/request.json"):
                try:
                    request = read_json(path)
                except (OSError, ValueError):
                    continue
                if request.get("structural_context", {}).get("study_id") == key:
                    candidates.append((request.get("created_at", ""), run_id))
        selected = max(candidates)[1] if candidates else ordered[0]
    return bound_task(task, workspace, key, selected)


class _StudyInterrupt(KeyboardInterrupt):
    def __init__(self, original):
        super().__init__(str(original))
        self.original = original


class _StructuralExecutor:
    def __init__(self, supervisor, task, workspace, study_id):
        self.supervisor, self.task = supervisor, task
        self.workspace, self.study_id = workspace, study_id
        self.custody_fds = ()

    def boundary(self):
        with self.supervisor.lock:
            stopping = self.task["id"] in self.supervisor.pending_stops
        if stopping:
            raise _StudyInterrupt(NativeJobCancelled(
                "NATIVE_STOPPED", "The saved structural study stopped before its next native case."))
        if self.supervisor.operator.closing:
            raise _StudyInterrupt(NativeJobDetached(
                "NATIVE_DETACHED", "Reopen this saved structural study to reconnect its retained native case."))

    def __call__(self, run_id, *, progress=None):
        self.boundary()
        task = bound_task(self.task, self.workspace, self.study_id, run_id)
        task["_native_custody_fds"] = self.custody_fds
        if self.workspace.inspect_run(run_id)["state"] == "complete":
            # The maintained completed-run path verifies retained outputs without another model.
            return self.workspace.run(run_id)
        try:
            result = self.supervisor.execute(task, self.workspace)
            self.boundary()
            return result
        except (NativeJobDetached, NativeJobCancelled) as error:
            raise _StudyInterrupt(error) from error


def execute_study(supervisor, task, workspace, study_id):
    """Keep the frozen case list, canonical request and existing Linux process custody."""
    key = identifier(study_id)
    if (task.get("action") != "structural-study.run"
            or identifier(task["payload"].get("study_id")) != key):
        raise NativeJobError("STRUCTURAL_STUDY_SELECTION", "The task names another saved structural study.")
    service = StructuralStudies(workspace)
    # Accepted original results are independent of present worker/lease activity.
    # The model still verifies the exact action, request and retained task context.
    if service.operation(task["id"])["status"] == "COMPLETE":
        return service.execute(key, operation_id=task["id"], context=original_context(task))
    runner = _StructuralExecutor(supervisor, task, workspace, key)
    try:
        # A surviving child retains the inherited batch lease. Reconnect to its
        # original execution before waiting on that same lease.
        current = service.inspect(key)
        for run_id in dict.fromkeys(row["run_id"] for row in current["cases"]):
            runner.boundary()
            selected = bound_task(task, workspace, key, run_id)
            try:
                supervisor.reconnect_existing(selected, workspace)
            except (NativeJobDetached, NativeJobCancelled):
                raise
            except NativeJobError as error:
                if process_interrupted(error):
                    try:
                        service.record_interruption(key, error)
                    except OSError as recording_error:
                        raise error from recording_error
                    raise
                if error.code != "NATIVE_PROCESS_EXIT":
                    raise
        with native_batch_lease(workspace.root / ".native-model-batch.lock") as fd:
            runner.custody_fds = (fd,)
            runner.boundary()
            return service.execute(key, operation_id=task["id"], context=original_context(task),
                                   run_executor=runner)
    except _StudyInterrupt as interrupt:
        try:
            service.record_interruption(key, interrupt.original)
        except OSError as recording_error:
            raise interrupt.original from recording_error
        raise interrupt.original from None
    finally:
        with supervisor.lock:
            supervisor.pending_stops.discard(task["id"])
