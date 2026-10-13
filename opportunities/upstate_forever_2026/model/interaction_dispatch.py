"""Process-isolated dispatch of retained conservation coalition runs.

Scientific selections stay in the immutable interaction plan. Worker count,
dispatch priority and optional original-stage donors describe execution only.
"""
from __future__ import annotations

from concurrent.futures import FIRST_COMPLETED, ProcessPoolExecutor, wait
from concurrent.futures.process import BrokenProcessPool
from copy import deepcopy
import inspect
import multiprocessing
from pathlib import Path

from .common import held, identifier, now


def options(workspace, workers, reuse_source_run_ids):
    if type(workers) is not int or workers < 1:
        raise ValueError("workers must be a positive integer")
    if reuse_source_run_ids is not None and not isinstance(reuse_source_run_ids, (list, tuple)):
        raise ValueError("reuse_source_run_ids must be a list of retained native run IDs")
    donors = list(dict.fromkeys(identifier(value) for value in (reuse_source_run_ids or ())))
    for run_id in donors:
        workspace.inspect_run(run_id)
    return workers, None if reuse_source_run_ids is None else donors


def _native_job(workspace_root, run_id, donors, supports_donors):
    """One spawn-safe entrypoint; no Workspace, logger or GIS object is pickled."""
    from .workspace import Workspace
    workspace = Workspace(Path(workspace_root))
    lock = Path(workspace.root) / "runs" / run_id / ".run.lock"
    while True:
        # Another operation may already own this same retained run. Wait for its
        # actual lock, then reopen state; an orphaned lock releases on process exit.
        with held(lock, blocking=True):
            current = workspace.inspect_run(run_id)
            if current.get("state") == "complete":
                return {"run_id": run_id}
        try:
            if supports_donors and donors is not None:
                workspace.run(run_id, reuse_source_run_ids=[value for value in donors if value != run_id])
            else:
                workspace.run(run_id)
            return {"run_id": run_id}
        except BlockingIOError as exc:
            # Only retry a real competing run lock. An unrelated native EAGAIN
            # must remain a recorded execution failure.
            try:
                with held(lock, blocking=False):
                    pass
            except BlockingIOError:
                continue
            return {"run_id": run_id, "error": {
                "error_type": type(exc).__name__, "message": str(exc)}}
        except Exception as exc:
            return {"run_id": run_id, "error": {
                "error_type": type(exc).__name__, "message": str(exc)}}


def _priority(case, action_count):
    mask = case["mask"]
    if mask == 0:
        return (0, 0, mask)
    if mask == (1 << action_count) - 1:
        return (1, action_count, mask)
    size = mask.bit_count()
    return (2 if size == 1 else 3 if size == 2 else 4, size, mask)


def _stage_lineage(run):
    reused = native = 0
    for model in ("ndr", "sdr"):
        stage = run.get("stages", {}).get(model)
        if stage and stage.get("completed_at"):
            if stage.get("reused_from"):
                reused += 1
            else:
                native += 1
    return reused, native


def _active(workspace, entries):
    result = []
    for entry in entries:
        row = {key: entry[key] for key in ("coalition_key", "run_id", "submitted_at")}
        try:
            run = workspace.inspect_run(entry["run_id"])
            execution = run.get("execution") or {}
            row.update(native_state=run.get("state"), phase=execution.get("phase"),
                       model=execution.get("model"), pid=execution.get("pid"),
                       host=execution.get("host"))
        except (OSError, ValueError) as exc:
            row.update(native_state="unavailable", phase="inspect",
                       inspection_error=str(exc), model=None, pid=None, host=None)
        result.append(row)
    return result


def run_cases(workspace, plan, state, *, workers=1, reuse_source_run_ids=None, checkpoint):
    """Dispatch prepared native IDs, consuming actual run records incrementally."""
    workers, donors = options(workspace, workers, reuse_source_run_ids)
    grouped = {}
    by_key = {case["key"]: case for case in plan["coalitions"]}
    for key, retained in state["cases"].items():
        if key not in by_key:
            raise ValueError("The interaction checkpoint contains an unknown coalition")
        grouped.setdefault(retained["run_id"], []).append(retained)
    schedule, seen = [], set()
    for case in sorted(plan["coalitions"], key=lambda value: _priority(value, len(plan["actions"]))):
        run_id = state["cases"][case["key"]]["run_id"]
        if run_id not in seen:
            schedule.append({"coalition_key": case["key"], "run_id": run_id})
            seen.add(run_id)
    skipped, reused_count, native_count = 0, 0, 0
    pending = []
    for entry in schedule:
        run = workspace.inspect_run(entry["run_id"])
        for row in grouped[entry["run_id"]]:
            if run["selection"] != row["selection"]:
                raise ValueError("A scheduled native run changed its retained selection")
            row["state"] = run.get("state")
            row.pop("error", None)
        if run.get("state") == "complete":
            skipped += 1
            reused, native = _stage_lineage(run)
            reused_count += reused
            native_count += native
        else:
            pending.append(entry)
    effective = min(workers, max(1, len(pending)))
    supports_donors = "reuse_source_run_ids" in inspect.signature(workspace.run).parameters
    if donors and not supports_donors and pending:
        raise ValueError("This installed native runner does not support retained source-run donors")
    if effective > 1:
        from . import native, stage_cache
        if (not callable(getattr(stage_cache, "execution_slot", None))
                or not callable(getattr(native, "execution_slot", None))):
            raise ValueError(
                "Parallel native dispatch needs the current shared signature execution_slot; "
                "install the current native runner or select one worker")
    stamp = now()
    state["execution"] = {
        "schema": "upstate.interaction-execution/v1",
        "mode": "spawn" if effective > 1 else "serial",
        "requested_workers": workers, "workers": effective,
        "schedule": "baseline-full-singletons-pairs-cardinality/v1",
        "reuse_source_run_ids": list(donors or []),
        "reuse_policy": "retained" if donors is None else "explicit", "started_at": stamp,
        "updated_at": stamp, "completed_at": None,
        "submitted_runs": 0, "finished_runs": 0, "skipped_complete_runs": skipped,
        "reused_stage_records": reused_count, "native_stage_records": native_count,
    }
    state["state"] = "running"
    state["completed_cases"] = sum(row["state"] == "complete" for row in state["cases"].values())
    state["active_cases"] = []
    state["active_case"] = None
    checkpoint("native")

    def progress(entries):
        state["active_cases"] = _active(workspace, entries)
        state["active_case"] = deepcopy(state["active_cases"][0]) if state["active_cases"] else None
        state["execution"]["updated_at"] = now()
        checkpoint("native")

    def consume(entry, response):
        run_id = entry["run_id"]
        rows = grouped[run_id]
        previous_complete = sum(row["state"] == "complete" for row in rows)
        try:
            actual = workspace.inspect_run(run_id)
            if any(actual["selection"] != row["selection"] for row in rows):
                raise ValueError("A dispatched native run changed its retained selection")
            native_state = actual.get("state")
            if native_state == "complete":
                for row in rows:
                    row["state"] = "complete"
                    row.pop("error", None)
                reused, native = _stage_lineage(actual)
                state["execution"]["reused_stage_records"] += reused
                state["execution"]["native_stage_records"] += native
                if response.get("error"):
                    state.setdefault("execution_warnings", []).append({
                        "run_id": run_id, "native_state": native_state, **response["error"]})
            else:
                detail = response.get("error") or actual.get("error") or {
                    "error_type": "IncompleteNativeRun",
                    "message": "Native run did not complete (" + str(native_state) + ")",
                }
                raise _CaseFailure(native_state, detail)
        except Exception as exc:
            detail = exc.detail if isinstance(exc, _CaseFailure) else {
                "error_type": type(exc).__name__, "message": str(exc)}
            error = {
                "phase": "native", "coalition_key": entry["coalition_key"], "run_id": run_id,
                "native_state": getattr(exc, "native_state", None), **detail,
            }
            state["errors"].append(error)
            for row in rows:
                row["state"] = "failed"
                row["error"] = deepcopy(error)
        state["completed_cases"] += (
            sum(row["state"] == "complete" for row in rows) - previous_complete)
        state["execution"]["finished_runs"] += 1
        state["execution"]["updated_at"] = now()
        checkpoint("native")

    if effective == 1:
        try:
            for entry in pending:
                entry = {**entry, "submitted_at": now()}
                state["execution"]["submitted_runs"] += 1
                progress([entry])
                response = _native_job(str(workspace.root), entry["run_id"], donors, supports_donors)
                consume(entry, response)
        except BaseException as exc:
            state["state"] = "interrupted" if isinstance(exc, (KeyboardInterrupt, SystemExit)) else "failed"
            state["execution"]["interrupted_at"] = now()
            state["errors"].append({
                "phase": "native-dispatch", "error_type": type(exc).__name__, "message": str(exc)})
            checkpoint("native")
            raise
        progress([])
    else:
        pool = ProcessPoolExecutor(max_workers=effective, mp_context=multiprocessing.get_context("spawn"))
        in_flight = {}
        position = 0
        try:
            while position < len(pending) or in_flight:
                while position < len(pending) and len(in_flight) < effective:
                    entry = {**pending[position], "submitted_at": now()}
                    position += 1
                    future = pool.submit(
                        _native_job, str(workspace.root), entry["run_id"], donors, supports_donors)
                    in_flight[future] = entry
                    state["execution"]["submitted_runs"] += 1
                progress(list(in_flight.values()))
                finished, _ = wait(in_flight, timeout=2.0, return_when=FIRST_COMPLETED)
                for future in finished:
                    entry = in_flight.pop(future)
                    try:
                        response = future.result()
                    except BrokenProcessPool as exc:
                        consume(entry, {"run_id": entry["run_id"], "error": {
                            "error_type": type(exc).__name__, "message": str(exc)}})
                        raise
                    except Exception as exc:
                        response = {"run_id": entry["run_id"], "error": {
                            "error_type": type(exc).__name__, "message": str(exc)}}
                    consume(entry, response)
            pool.shutdown(wait=True)
        except BaseException as exc:
            # The original run IDs and stage journals remain authoritative even
            # if this orchestration process is interrupted. Submitted workers can
            # finish; a resumed dispatcher waits on their existing run locks.
            for future in in_flight:
                future.cancel()
            pool.shutdown(wait=False, cancel_futures=True)
            for future, entry in list(in_flight.items()):
                if future.done() and not future.cancelled():
                    try:
                        response = future.result()
                    except BaseException as failure:
                        response = {"run_id": entry["run_id"], "error": {
                            "error_type": type(failure).__name__, "message": str(failure)}}
                    consume(entry, response)
            state["state"] = "interrupted" if isinstance(exc, (KeyboardInterrupt, SystemExit)) else "failed"
            state["execution"]["interrupted_at"] = now()
            state["errors"].append({
                "phase": "native-dispatch", "error_type": type(exc).__name__,
                "message": str(exc), "remaining_prepared_runs": len(pending) - position,
            })
            progress(list(in_flight.values()))
            raise
        progress([])
    state["execution"]["completed_at"] = now()
    state["execution"]["updated_at"] = state["execution"]["completed_at"]
    checkpoint("native")


class _CaseFailure(Exception):
    def __init__(self, native_state, detail):
        super().__init__(detail.get("message", "Native case did not complete"))
        self.native_state = native_state
        self.detail = detail
