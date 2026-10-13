"""Compact programme observations and pages over the original native records.

The full computation, report and CLI readers remain in ComputeProgrammes.
Only read-side projections use the existing bounded atomic-record cache.
"""
from __future__ import annotations

from .common import digest, identifier
from .compute_programme import ComputeProgrammes, PROGRAMME_SCHEMA, _error, _run_snapshot
from .model_selection import validate_completed_run
from .native_execution import _active, inspect_execution
from .record_catalog import ProjectedFileCache


def _number(value, name, default, maximum=None):
    if value in (None, ""):
        return default
    if isinstance(value, bool):
        raise ValueError(name + " must be a nonnegative integer")
    try:
        result = int(value)
    except (TypeError, ValueError, OverflowError):
        raise ValueError(name + " must be a nonnegative integer") from None
    if result < 0 or str(result) != str(value) or (maximum is not None and result > maximum):
        raise ValueError(name + " must be a nonnegative integer"
                         + (" up to " + str(maximum) if maximum is not None else ""))
    return result


class ProgrammeViews:
    """Reuse unchanged projections; observe every native lock on each read."""

    def __init__(self):
        self.records = ProjectedFileCache(max_bytes=32 * 1024 * 1024)
        self.progress = ProjectedFileCache(max_bytes=16 * 1024 * 1024)
        self.native = ProjectedFileCache(max_bytes=16 * 1024 * 1024)

    def record(self, workspace, key):
        manager = ComputeProgrammes(workspace)
        key = identifier(key)

        def project(value):
            value = manager._check_record(key, value)
            return {**{name: value[name] for name in
                    ("schema", "id", "workspace_id", "title", "selection", "runs", "created_at")},
                    "source_reference": value["identity"]["source_reference"]}

        value = self.records.read(manager._directory(key) / "programme.json", project)
        if value["id"] != key or value["workspace_id"] != workspace.project["id"]:
            raise ValueError("Programme belongs to another retained workspace")
        return value

    def _state(self, manager, key):
        def project(value):
            value = manager._check_state(key, value)
            return {name: value.get(name) for name in (
                "schema", "programme_id", "workspace_id", "state", "phase", "current_run",
                "attempts", "requested_runs", "updated_at", "completed_at", "latest_report",
                "comparison_errors", "execution_sources", "error", "deliveries", "pair_completions")}
        value = self.progress.read(manager._directory(key) / "progress.json", project)
        return manager._check_state(key, value)

    def _native(self, workspace, key):
        def project(value):
            if digest(value["selection"]) != key:
                raise ValueError("Original run selection changed")
            validate_completed_run(value)
            return {**{name: value.get(name) for name in ("selection", "state", "error")},
                    "source_sha256": digest(value)}
        return self.native.read(workspace.root / "runs" / key / "run.json", project)

    @staticmethod
    def _overlay(binding, native, active, state):
        visible = "interrupted" if native["state"] == "running" and not active else native["state"]
        row = {**binding, "state": visible, "native_state": visible, "active": active}
        for name in ("error", "programme_error", "failure_stage"):
            row.pop(name, None)
        row["native_revision"] = native.get("source_sha256", binding.get("native_revision"))
        if visible == "failed":
            row["error"] = native.get("error")
        attempts = (state.get("attempts") or {}).get(binding["key"], [])
        if attempts and attempts[-1]["state"] == "failed" and not active:
            error = attempts[-1].get("error")
            row.update(state="failed", programme_error=error,
                       failure_stage="programme execution or output verification")
            if not row.get("error"):
                row["error"] = error
        return row

    @staticmethod
    def _missing(binding, error, state):
        row = {**binding, "state": "missing", "native_state": "missing",
               "active": False, "stages": {}, "artifacts": {}, "error": _error(error)}
        attempts = (state.get("attempts") or {}).get(binding["key"], [])
        row["attempts"] = attempts
        if attempts and attempts[-1]["state"] == "failed":
            row.update(state="failed", programme_error=attempts[-1].get("error"),
                       failure_stage="programme execution or output verification")
        return row

    @staticmethod
    def _count(rows):
        result = {"total": len(rows), "complete": 0, "failed": 0, "running": 0, "pending": 0}
        for row in rows:
            result[row["state"] if row["state"] in ("complete", "failed", "running") else "pending"] += 1
        return result

    def read(self, workspace, key, *, offset=0, limit=100, case_filter="all", query="",
             run_id=None, include_cases=True, include_keys=False):
        key = identifier(key)
        offset = _number(offset, "Case offset", 0)
        limit = _number(limit, "Page size", 100, 500)
        if limit == 0 and include_cases:
            raise ValueError("Case page size must be positive")
        if case_filter not in ("all", "unfinished", "failed", "complete"):
            raise ValueError("Choose all, unfinished, failed or complete cases")
        if not isinstance(query, str):
            raise ValueError("Search the original case key, title or native run")
        wanted = query.strip().casefold()
        run_id = identifier(run_id) if run_id is not None else None
        manager = ComputeProgrammes(workspace)
        record, state = self.record(workspace, key), self._state(manager, key)
        active, control = manager._active(key), manager._control(key)
        rows, originals = [], {}
        for binding in record["runs"]:
            native_id = binding["run_id"]
            try:
                if native_id not in originals:
                    value = self._native(workspace, native_id)
                    originals[native_id] = (value, _active(workspace.root / "runs" / native_id))
                native, native_active = originals[native_id]
                if native["selection"] != binding["native_selection"]:
                    raise ValueError("Native run differs from the saved programme binding")
                row = self._overlay(binding, native, native_active, state)
            except (ValueError, OSError, KeyError) as exc:
                row = self._missing(binding, exc, state)
            rows.append(row)
        counts = self._count(rows)
        visible = state["state"]
        if visible == "running" and not active:
            visible = "interrupted"
        if visible == "complete" and counts["complete"] != counts["total"]:
            visible = "failed" if counts["failed"] else "partial"
        filtered = [row for row in rows if
            (run_id is None or row["run_id"] == run_id)
            and (case_filter == "all" or
                 (row["state"] != "complete" if case_filter == "unfinished" else row["state"] == case_filter))
            and (not wanted or wanted in " ".join(str(row.get(name, "")) for name in
                 ("key", "title", "run_id", "profile_id", "scenario_id")).casefold())]
        if run_id is not None and not filtered:
            raise ValueError("The native run is outside this original saved programme")
        if limit:
            offset = min(offset, max(0, ((len(filtered) - 1) // limit) * limit))
        selected = ((filtered if run_id else filtered[offset:offset + limit])
                    if include_cases else [])
        detailed = []
        observed = {}
        for row in selected:
            native_id = row["run_id"]
            try:
                if native_id not in observed:
                    native = workspace.inspect_run(native_id)
                    observation = inspect_execution(workspace, native_id, log_bytes=0)
                    observed[native_id] = (native, observation)
                native, observation = observed[native_id]
                if native["selection"] != row["native_selection"]:
                    raise ValueError("Native run differs from the saved programme binding")
                current = {**row, **_run_snapshot(native)}
                current.update({name: observation[name] for name in (
                    "state", "recorded_state", "active", "execution", "execution_history", "storage")})
                current = self._overlay(current, {"state": observation["state"],
                    "error": observation.get("error")}, observation["active"], state)
                current["attempts"] = (state.get("attempts") or {}).get(row["key"], [])
                detailed.append(current)
            except (ValueError, OSError, KeyError) as exc:
                detailed.append(self._missing(row, exc, state))
        if detailed:
            replacements = {row["key"]: row for row in detailed}
            rows = [replacements.get(row["key"], row) for row in rows]
            counts = self._count(rows)
            if state["state"] == "complete" and counts["complete"] != counts["total"]:
                visible = "failed" if counts["failed"] else "partial"
        latest = state.get("latest_report") or {}
        metadata = {name: value for name, value in record["selection"].items() if name != "runs"}
        return {"schema": PROGRAMME_SCHEMA, "id": key, "programme_id": key,
                "workspace_id": record["workspace_id"], "title": record["title"],
                "selection": metadata, "selection_complete": False,
                "source_reference": record["source_reference"],
                "state": visible, "recorded_state": state["state"], "phase": state["phase"],
                "active": active, "native_active": any(row["active"] for row in rows),
                "pause_requested": control["pause_requested"],
                "current_run": state.get("current_run"), "counts": counts, "runs": detailed,
                "baseline_run": record["selection"]["baseline_run"],
                "requested_runs": state.get("requested_runs") or [],
                "created_at": record["created_at"], "updated_at": state["updated_at"],
                "completed_at": state.get("completed_at"),
                "comparison_errors": state.get("comparison_errors") or {},
                "execution_sources": state.get("execution_sources"), "error": state.get("error"),
                "report": latest or None, "latest_report": latest or None,
                "files": latest.get("files", []), "deliveries": state.get("deliveries") or {},
                "pair_completion": manager._pair_completion_origin(key, record),
                "pair_completions": state.get("pair_completions") or {},
                "page": {"offset": offset, "limit": limit, "total": len(filtered),
                         "programme_total": len(rows), "filter": case_filter, "query": query},
                **({"case_keys": [row["key"] for row in filtered]} if include_keys else {}),
                "observation_id": digest({"programme_id": key, "state": state["state"],
                    "updated_at": state["updated_at"], "active": active, "control": control,
                    "rows": [(row["key"], row["state"], row["active"], row.get("native_revision")) for row in rows]})}

    def keys(self, workspace, key, *, case_filter="unfinished"):
        value = self.read(workspace, key, limit=0, include_cases=False,
                          case_filter=case_filter, include_keys=True)
        return {"programme_id": value["id"], "keys": value["case_keys"],
                "count": len(value["case_keys"]), "observation_id": value["observation_id"]}

    def catalog(self, workspace, *, include_completed_sources=False):
        views = self
        class Manager(ComputeProgrammes):
            def status(self, key, *, include_ensemble_candidates=True):
                return views.read(self.workspace, key, limit=0, include_cases=False)
        return Manager(workspace).catalog(include_completed_sources=include_completed_sources)


DEFAULT_VIEWS = ProgrammeViews()
