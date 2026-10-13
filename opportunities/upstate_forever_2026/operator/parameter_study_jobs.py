"""Run saved parameter cases through the existing owned native supervisor."""
from __future__ import annotations

from model import parameter_studies
from model.common import identifier, read_json
from model.native_execution import native_batch_lease, process_interrupted
from native_jobs import NativeJobCancelled, NativeJobDetached, NativeJobError


def bound_task(task, workspace, key, run_id):
    if (task.get("action") != "parameter-study.run"
            or identifier(task["payload"].get("experiment_id")) != identifier(key)):
        raise NativeJobError("PARAMETER_STUDY_TASK", "Choose the original parameter-study task.", 422)
    return {**task, "_native_study_context": parameter_studies.native_case_context(
        workspace, key, identifier(run_id))}


def select_task(task, workspace):
    key = identifier(task["payload"].get("experiment_id"))
    state = parameter_studies._read(workspace, key)
    run_ids = set(row["run_id"] for row in state["cases"])
    selected = state.get("active_run_id")
    if selected not in run_ids:
        candidates = []
        for run_id in run_ids:
            for path in (workspace.root / "runs" / run_id / "supervision").glob("*/request.json"):
                try:
                    request = read_json(path)
                except (OSError, ValueError):
                    continue
                if request.get("study_context", {}).get("study_id") == key:
                    candidates.append((request.get("created_at", ""), run_id))
        selected = max(candidates)[1] if candidates else state["selection"]["baseline_run_id"]
    return bound_task(task, workspace, key, selected)


class _StudyInterrupt(KeyboardInterrupt):
    def __init__(self, original):
        super().__init__(str(original))
        self.original = original


class _StudyWorkspace:
    def __init__(self, supervisor, task, workspace, key):
        self.supervisor, self.task = supervisor, task
        self.workspace, self.key = workspace, key
        self.custody_fds = ()

    def __getattr__(self, name):
        return getattr(self.workspace, name)

    def _boundary(self):
        with self.supervisor.lock:
            stopping = self.task["id"] in self.supervisor.pending_stops
        if stopping:
            raise _StudyInterrupt(NativeJobCancelled(
                "NATIVE_STOPPED", "The saved study stopped before its next native case."))
        if self.supervisor.operator.closing:
            raise _StudyInterrupt(NativeJobDetached(
                "NATIVE_DETACHED", "Reopen this saved study to reconnect its retained native case."))

    def run(self, run_id):
        self._boundary()
        task = bound_task(self.task, self.workspace, self.key, run_id)
        task["_native_custody_fds"] = self.custody_fds
        # Retain the original completed-run verification path; it loads no model.
        if self.workspace.inspect_run(run_id)["state"] == "complete":
            return self.workspace.run(run_id)
        try:
            return self.supervisor.execute(task, self.workspace)
        except (NativeJobDetached, NativeJobCancelled) as error:
            raise _StudyInterrupt(error) from error

    def compare_runs(self, run_ids):
        self._boundary()
        return self.workspace.compare_runs(run_ids)


def execute_study(supervisor, task, workspace, key):
    """Resume the original engine with supervised children and its exact cases."""
    key = identifier(key)
    if identifier(task["payload"].get("experiment_id")) != key:
        raise NativeJobError("PARAMETER_STUDY_SELECTION", "The task names another saved study.")
    proxy = _StudyWorkspace(supervisor, task, workspace, key)
    try:
        # A surviving child retains the batch lease after its parent closes.
        # Reconnect before acquiring that lease or starting the coordinator.
        state = parameter_studies._read(workspace, key)
        for run_id in dict.fromkeys(row["run_id"] for row in state["cases"]):
            proxy._boundary()
            selected_task = bound_task(task, workspace, key, run_id)
            try:
                supervisor.reconnect_existing(selected_task, workspace)
            except (NativeJobDetached, NativeJobCancelled):
                raise
            except NativeJobError as error:
                if process_interrupted(error):
                    try:
                        parameter_studies.record_interruption(workspace, key, error)
                    except OSError as recording_error:
                        # Keep the exact process interruption as the primary failure.
                        raise error from recording_error
                    raise
                if error.code != "NATIVE_PROCESS_EXIT":
                    raise
        with native_batch_lease(workspace.root / ".native-model-batch.lock") as fd:
            proxy.custody_fds = (fd,)
            return parameter_studies.execute(proxy, key)
    except _StudyInterrupt as interrupt:
        raise interrupt.original from None
    finally:
        with supervisor.lock:
            supervisor.pending_stops.discard(task["id"])
