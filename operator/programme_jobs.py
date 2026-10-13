"""Join original programme scheduling to the owned native worker."""
from __future__ import annotations

from model.common import atomic_json, digest, identifier, read_json
from model.compute_programme import ComputeProgrammes
from model.native_execution import process_interrupted
from native_jobs import NativeJobCancelled, NativeJobDetached, NativeJobError

def supported(task):
    return (task.get("action") == "compute.programme.run"
            or (task.get("action") == "compute.programme.pair-completion"
                and task.get("payload", {}).get("run") is True))


def programme_id(task, workspace):
    key = identifier(task["payload"].get("programme_id"))
    if task.get("action") == "compute.programme.pair-completion":
        manager = ComputeProgrammes(workspace)
        state = manager._state(key)
        path = workspace.root / "compute-programmes" / key / "supervision" / (identifier(task["id"]) + ".json")
        if path.exists():
            retained = read_json(path)
            if (retained.get("task_id") != task["id"]
                    or retained.get("original_payload_sha256") != digest(task["payload"])
                    or retained.get("parent_programme_id") != key):
                raise NativeJobError("PROGRAMME_SELECTION", "The paired task continuation changed.")
            child = retained.get("programme_id")
            if child not in {row.get("programme_id") for row in state.get("pair_completions", {}).values()}:
                raise NativeJobError("PROGRAMME_SELECTION", "The paired continuation is outside its parent programme.")
            return identifier(child)
        child = state.get("pair_completions", {}).get(
            task["payload"].get("expected_preview_id"), {}).get("programme_id")
        if not child:
            child = task.get("result", {}).get("id")
        if not child:
            raise NativeJobError("PROGRAMME_PREPARING",
                                 "The paired completion is still being prepared.", 409)
        key = identifier(child)
    return key


def bound_task(task, workspace, key, run_id):
    """Keep the real task and payload; add a checked execution binding."""
    if not supported(task):
        raise NativeJobError("PROGRAMME_TASK", "Choose an original programme execution task.", 422)
    record = ComputeProgrammes(workspace)._load(identifier(key))
    matches = [row for row in record["runs"] if row["run_id"] == identifier(run_id)]
    if not matches:
        raise NativeJobError("PROGRAMME_RUN", "This native run is outside the retained programme.", 422)
    # Named cases may share the same scientific run. Preserve all matching bindings.
    context = {"programme_id": key, "run_id": run_id,
               "bindings_sha256": digest(matches)}
    value = dict(task)
    value["_native_context"] = context
    return value


def select_task(task, workspace):
    """Select the current original case, or its latest retained worker."""
    key = programme_id(task, workspace)
    manager = ComputeProgrammes(workspace)
    record, state = manager._load(key), manager._state(key)
    current = state.get("current_run")
    binding = next((row for row in record["runs"] if row["key"] == current), None)
    if binding is None:
        candidates = []
        for run_id in dict.fromkeys(row["run_id"] for row in record["runs"]):
            root = workspace.root / "runs" / run_id / "supervision"
            for path in root.glob("*/request.json"):
                try:
                    request = read_json(path)
                except (OSError, ValueError):
                    continue
                if request.get("programme_context", {}).get("programme_id") == key:
                    candidates.append((request.get("created_at", ""), run_id))
        if candidates:
            run_id = max(candidates)[1]
        else:
            run_id = next(row["run_id"] for row in record["runs"]
                          if row["key"] == record["selection"]["baseline_run"])
    else:
        run_id = binding["run_id"]
    return bound_task(task, workspace, key, run_id)


class _ProgrammeInterrupt(KeyboardInterrupt):
    """Use the coordinator's original interrupted-attempt boundary."""
    def __init__(self, original):
        super().__init__(str(original))
        self.original = original


class _ProgrammeWorkspace:
    def __init__(self, supervisor, task, workspace, key):
        self.supervisor, self.task = supervisor, task
        self.workspace, self.key = workspace, key
        self.record = ComputeProgrammes(workspace)._load(key)

    def __getattr__(self, name):
        return getattr(self.workspace, name)

    def _boundary(self):
        with self.supervisor.lock:
            stopping = self.task["id"] in self.supervisor.pending_stops
        if stopping:
            # resume() clears an earlier pause. Reassert Stop at the actual
            # execution boundary before a first case or assembly can start.
            ComputeProgrammes(self.workspace).pause(self.key)
            raise _ProgrammeInterrupt(NativeJobCancelled(
                "NATIVE_STOPPED", "The calculation stopped and its original programme is paused."))
        if self.supervisor.operator.closing:
            raise _ProgrammeInterrupt(NativeJobDetached(
                "NATIVE_DETACHED",
                "The operator closed. Resume this programme to reconnect its retained calculation."))

    def _context(self, run_id):
        return bound_task(self.task, self.workspace, self.key, run_id)

    def run(self, run_id):
        self._boundary()
        task = self._context(run_id)
        try:
            return self.supervisor.execute(task, self.workspace)
        except (NativeJobDetached, NativeJobCancelled) as error:
            raise _ProgrammeInterrupt(error) from error

    def combine_runs(self, selection, source_runs, *, execute=False):
        self._boundary()
        if execute:
            raise NativeJobError("PROGRAMME_ASSEMBLY",
                                 "The programme must retain its original deferred assembly.", 422)
        matches = [row for row in self.record["runs"]
                   if row["native_selection"] == selection
                   and row.get("source_runs") == source_runs]
        if not matches:
            raise NativeJobError("PROGRAMME_ASSEMBLY",
                                 "Assembly inputs differ from the retained programme binding.", 422)
        task = self._context(matches[0]["run_id"])
        previous = self.supervisor._latest(task)
        # The original assembler takes .run.lock. Reconnect first while its
        # original worker still owns that lock, including a new operator task.
        if previous and self.supervisor._alive(previous):
            self.run(matches[0]["run_id"])
        self._boundary()
        return self.workspace.combine_runs(selection, source_runs, execute=False)

    def compare_runs(self, run_ids):
        self._boundary()
        return self.workspace.compare_runs(run_ids)


def create_pair_completion(supervisor, task, manager, key, *, expected_preview_id=None):
    """Pin the actual preview before the original coordinator creates a child."""
    workspace = manager.workspace
    if identifier(task["payload"].get("programme_id")) != key:
        raise NativeJobError("PROGRAMME_SELECTION", "The paired task belongs to another parent.")
    directory = workspace.root / "compute-programmes" / identifier(key) / "supervision"
    path = directory / (identifier(task["id"]) + ".preview.json")
    identity = {"schema": "upstate.programme-task-preview/v1", "task_id": task["id"],
                "parent_programme_id": key, "original_payload_sha256": digest(task["payload"])}
    if path.exists():
        retained = read_json(path)
        if ({name: value for name, value in retained.items() if name != "preview_id"} != identity
                or (expected_preview_id is not None and retained.get("preview_id") != expected_preview_id)):
            raise NativeJobError("PROGRAMME_SELECTION", "The original paired task preview changed.")
        preview = identifier(retained["preview_id"])
    else:
        preview = identifier(expected_preview_id) if expected_preview_id is not None else identifier(
            manager.pair_completion_preview(key)["preview_id"])
        directory.mkdir(parents=True, exist_ok=True)
        atomic_json(path, {**identity, "preview_id": preview}, immutable=True)
    return manager.create_pair_completion(key, expected_preview_id=preview)


def execute_programme(supervisor, task, manager, key, *, only_runs=None):
    """Keep the original coordinator, including paired-completion children."""
    workspace = manager.workspace
    if task.get("action") == "compute.programme.pair-completion":
        parent = identifier(task["payload"].get("programme_id"))
        continuations = ComputeProgrammes(workspace)._state(parent).get("pair_completions", {})
        preview = task["payload"].get("expected_preview_id")
        candidates = ([continuations[preview]] if preview in continuations
                      else list(continuations.values()) if preview is None else [])
        if key not in {row.get("programme_id") for row in candidates}:
            raise NativeJobError("PROGRAMME_SELECTION", "The paired child differs from its retained parent.")
        path = workspace.root / "compute-programmes" / parent / "supervision" / (identifier(task["id"]) + ".json")
        retained = {"schema": "upstate.programme-task-continuation/v1",
                    "task_id": task["id"], "parent_programme_id": parent,
                    "programme_id": key, "original_payload_sha256": digest(task["payload"])}
        if path.exists():
            if read_json(path) != retained:
                raise NativeJobError("PROGRAMME_SELECTION", "The paired task already retains another continuation.")
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            atomic_json(path, retained, immutable=True)
    checked = programme_id(task, workspace)
    if checked != key:
        raise NativeJobError("PROGRAMME_SELECTION",
                             "The execution differs from the original task's programme.", 422)
    proxy = _ProgrammeWorkspace(supervisor, task, workspace, key)
    original = manager.workspace
    manager.workspace = proxy
    try:
        # An explicit continuation can select another subset. Finish the same
        # programme's already-owned child before its coordinator starts that
        # subset, without launching any omitted case or altering its selection.
        for run_id in dict.fromkeys(row["run_id"] for row in proxy.record["runs"]):
            proxy._boundary()
            selected_task = bound_task(task, workspace, key, run_id)
            try:
                supervisor.reconnect_existing(selected_task, workspace)
            except (NativeJobDetached, NativeJobCancelled):
                raise
            except NativeJobError as error:
                # Only an ordinary prior process failure belongs to the
                # coordinator's selected-cohort disposition. Identity and
                # result failures must stop this continuation immediately.
                if error.code != "NATIVE_PROCESS_EXIT" or process_interrupted(error):
                    raise
        return manager.resume(key, only_runs=only_runs)
    except _ProgrammeInterrupt as interrupt:
        raise interrupt.original from None
    finally:
        manager.workspace = original
        with supervisor.lock:
            supervisor.pending_stops.discard(task["id"])
