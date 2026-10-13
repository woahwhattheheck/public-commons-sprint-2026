"""Continue the original saved ensemble through its owned native workers."""
from __future__ import annotations

from model.common import identifier, read_json
from model.ensemble_native import native_case_context, retained_plan, run_ids
from model.ensembles import Ensembles
from model.native_execution import native_batch_lease, process_interrupted, storage_exhausted
from native_jobs import NativeJobCancelled, NativeJobDetached, NativeJobError


def bound_task(task, workspace, key, run_id):
    if (task.get("action") != "ensemble.run"
            or identifier(task["payload"].get("ensemble_id")) != identifier(key)):
        raise NativeJobError("ENSEMBLE_TASK", "Choose the original saved ensemble task.", 422)
    return {**task, "_native_ensemble_context":
            native_case_context(workspace, key, identifier(run_id))}


def select_task(task, workspace):
    key = identifier(task["payload"].get("ensemble_id"))
    plan = retained_plan(workspace, key)
    ordered = run_ids(plan)
    state_path = workspace.root / "ensemble_results" / key / "state.json"
    state = read_json(state_path) if state_path.exists() else {}
    active = state.get("active") or {}
    selected = active.get("run_id")
    if selected not in ordered:
        candidates = []
        for run_id in ordered:
            for path in (workspace.root / "runs" / run_id / "supervision").glob("*/request.json"):
                try:
                    request = read_json(path)
                except (OSError, ValueError):
                    continue
                if request.get("ensemble_context", {}).get("ensemble_id") == key:
                    candidates.append((request.get("created_at", ""), run_id))
        selected = max(candidates)[1] if candidates else ordered[0]
    return bound_task(task, workspace, key, selected)


class _EnsembleInterrupt(KeyboardInterrupt):
    """Bypass continue-on-error only for stop, detach and process interruption."""
    def __init__(self, original):
        super().__init__(str(original))
        self.original = original


class _EnsembleWorkspace:
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
            raise _EnsembleInterrupt(NativeJobCancelled(
                "NATIVE_STOPPED", "The saved ensemble stopped before its next native case."))
        if self.supervisor.operator.closing:
            raise _EnsembleInterrupt(NativeJobDetached(
                "NATIVE_DETACHED", "Reopen this ensemble to reconnect its retained native case."))

    def run(self, run_id):
        self._boundary()
        try:
            task = bound_task(self.task, self.workspace, self.key, run_id)
        except ValueError as error:
            raise _EnsembleInterrupt(NativeJobError(
                "ENSEMBLE_SELECTION", str(error))) from error
        task["_native_custody_fds"] = self.custody_fds
        try:
            # Verify completed output through the original reuse path, without
            # starting another process or changing completed scientific output.
            if self.workspace.inspect_run(run_id)["state"] == "complete":
                return self.workspace.run(run_id)
            return self.supervisor.execute(task, self.workspace)
        except (NativeJobDetached, NativeJobCancelled) as error:
            raise _EnsembleInterrupt(error) from error
        except NativeJobError as error:
            # Capacity/signal failure is one interrupted campaign, not a reason
            # to immediately launch every remaining case against that failure.
            if (error.code != "NATIVE_PROCESS_EXIT" or process_interrupted(error)
                    or storage_exhausted(error)):
                raise _EnsembleInterrupt(error) from error
            raise
        except OSError as error:
            if storage_exhausted(error):
                raise _EnsembleInterrupt(error) from error
            raise

    def compare_runs(self, run_ids):
        self._boundary()
        return self.workspace.compare_runs(run_ids)


def execute_ensemble(supervisor, task, workspace, key, *, continue_on_error=True):
    key = identifier(key)
    if (task.get("action") != "ensemble.run"
            or identifier(task["payload"].get("ensemble_id")) != key):
        raise NativeJobError("ENSEMBLE_SELECTION", "The task names another saved ensemble.")
    if not isinstance(continue_on_error, bool):
        raise NativeJobError("ENSEMBLE_OPTION", "Continue-on-error must be true or false.", 422)
    plan = retained_plan(workspace, key)
    proxy = _EnsembleWorkspace(supervisor, task, workspace, key)
    try:
        # The original live child may still own the batch lease after an
        # operator exit. Drain/reconcile that exact child before acquiring it.
        for run_id in run_ids(plan):
            proxy._boundary()
            selected_task = bound_task(task, workspace, key, run_id)
            try:
                supervisor.reconnect_existing(selected_task, workspace)
            except (NativeJobDetached, NativeJobCancelled):
                raise
            except NativeJobError as error:
                if (error.code != "NATIVE_PROCESS_EXIT" or process_interrupted(error)
                    or storage_exhausted(error)):
                    raise
        with native_batch_lease(workspace.root / ".native-model-batch.lock") as fd:
            proxy.custody_fds = (fd,)
            return Ensembles(proxy).run(key, continue_on_error=continue_on_error)
    except _EnsembleInterrupt as interrupt:
        raise interrupt.original from None
    finally:
        with supervisor.lock:
            supervisor.pending_stops.discard(task["id"])
