"""Compact saved parameter-study pages over the original native records.

Full scientific inspection, execution, calibration and exports remain with the
maintained parameter-study engine. These projections only serve navigation.
"""
from __future__ import annotations

import fcntl
import json
import os

from .common import digest, identifier
from .model_selection import run_models, selected, validate_completed_run
from .native_execution import _active
from .native_versions import model_versions, version_label
from .parameter_studies import _baseline_versions, _bind_state
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


def _study_active(directory):
    try:
        fd = os.open(directory / ".experiment.lock", os.O_RDONLY | os.O_NOFOLLOW)
    except FileNotFoundError:
        return False
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return False
        except BlockingIOError:
            return True
    finally:
        os.close(fd)


def _bind_case(state, case, native):
    active = selected(state["baseline_selection"])
    selection = native["selection"]
    if (selection["profile_id"] != case["profile_id"]
            or run_models(native) != active
            or any(selection[name] != state["baseline_selection"][name]
                   for name in ("grid_id", "scenario_id"))):
        raise ValueError("An experiment case changed its retained model selection")
    if "run_selection" in case:
        if not isinstance(case["run_selection"], dict) or selection != case["run_selection"]:
            raise ValueError("An experiment case changed its original saved run selection")
    elif selection.get("invest_version") != state["baseline_selection"].get("invest_version"):
        raise ValueError("A legacy experiment case changed its retained requested version")
    if case["id"] == "baseline" and (
            case["run_id"] != state["selection"]["baseline_run_id"]
            or selection != state["baseline_selection"]):
        raise ValueError("The experiment baseline differs from its original saved run")


class ParameterViews:
    """Cache isolated original projections and observe live locks on each read."""

    def __init__(self):
        self.records = ProjectedFileCache(max_bytes=32 * 1024 * 1024)
        self.native = ProjectedFileCache(max_bytes=16 * 1024 * 1024)

    def record(self, workspace, key):
        key = identifier(key)

        def spec_projection(value):
            if digest(value) != key:
                raise ValueError("Retained parameter-study specification changed")
            return {**value, "id": key}

        spec = self.records.read(workspace.root / "experiment-specs" / (key + ".json"),
                                 spec_projection)

        def project(value):
            state = _bind_state(workspace, key, spec, value)
            if not isinstance(state.get("cases"), list):
                raise ValueError("The saved parameter-study case inventory changed")
            return state

        state = self.records.read(workspace.root / "experiments" / key / "experiment.json", project)
        # Check a changed specification and receiving project even on cache hits.
        return _bind_state(workspace, key, spec, state)

    def _native(self, workspace, key):
        key = identifier(key)

        def project(value):
            # Same original selection and completed-stage validation as inspect_run.
            if value.get("id") != key or digest(value["selection"]) != key:
                raise ValueError("Original run identity or selection changed")
            validate_completed_run(value)
            versions = model_versions(value) if value["state"] == "complete" else None
            return {"selection": value["selection"], "state": value["state"],
                    "error": value.get("error"), "source_sha256": digest(value),
                    "baseline_versions": _baseline_versions(value),
                    "native_versions": versions,
                    "native_version_labels": ({model: version_label(info)
                        for model, info in versions.items()} if versions is not None else None)}

        return self.native.read(workspace.root / "runs" / key / "run.json", project)

    def case_context(self, workspace, key, run_id):
        """Return the original worker binding without reading unrelated native runs."""
        key, run_id = identifier(key), identifier(run_id)
        state = self.record(workspace, key)
        matches = [case for case in state["cases"] if case["run_id"] == run_id]
        if not matches:
            raise ValueError("The native worker run is outside this saved parameter study")
        native = self._native(workspace, run_id)
        for case in matches:
            _bind_case(state, case, native)
        bindings = [{name: case[name] for name in (
            "id", "run_id", "profile_id", "run_selection", "overrides", "axis_values")
            if name in case} for case in matches]
        context = {"schema": "upstate.parameter-study-worker-context/v1", "study_id": key,
                   "run_id": run_id, "selection_sha256": digest(state["selection"]),
                   "bindings_sha256": digest(bindings)}
        return state, matches, context

    def read(self, workspace, key, *, offset=0, limit=50, case_filter="all", query="",
             run_id=None):
        key = identifier(key)
        offset = _number(offset, "Case offset", 0)
        limit = _number(limit, "Case page size", 50, 500)
        if case_filter not in ("all", "unfinished", "complete", "failed", "interrupted"):
            raise ValueError("Choose all, unfinished, complete, failed or interrupted cases")
        if not isinstance(query, str):
            raise ValueError("Search an original case, parameter or run ID")
        wanted = query.strip().casefold()
        run_id = identifier(run_id) if run_id is not None else None
        state = self.record(workspace, key)
        originals, rows = {}, []
        for case in state["cases"]:
            native_id = identifier(case["run_id"])
            if native_id not in originals:
                native = self._native(workspace, native_id)
                originals[native_id] = (native, _active(workspace.root / "runs" / native_id))
            native, native_active = originals[native_id]
            _bind_case(state, case, native)
            row = dict(case)
            visible = ("interrupted" if native["state"] == "running" and not native_active
                       else native["state"])
            row.update(state=visible, recorded_state=native["state"], active=native_active)
            if native.get("error"):
                row["error"] = native["error"]
            else:
                row.pop("error", None)
            if native["state"] == "complete":
                row["native_versions"] = native["native_versions"]
                row["native_version_labels"] = native["native_version_labels"]
            else:
                row.pop("native_versions", None)
                row.pop("native_version_labels", None)
            if case["id"] == "baseline":
                state.update(native["baseline_versions"])
            rows.append(row)
        if run_id is not None and not any(row["run_id"] == run_id for row in rows):
            raise ValueError("The native run is outside this original saved study")
        completed = sum(row["state"] == "complete" for row in rows)
        failed = sum(row["state"] == "failed" for row in rows)
        running = sum(row["state"] == "running" for row in rows)
        interrupted = sum(row["state"] == "interrupted" for row in rows)
        active = _study_active(workspace.root / "experiments" / key)
        native_active = any(row["active"] for row in rows)
        recorded = state["state"]
        visible = "interrupted" if recorded == "running" and not active else recorded
        if visible == "complete" and completed != len(rows):
            visible = "partial"
        filtered = [row for row in rows if
            (run_id is None or row["run_id"] == run_id)
            and (case_filter == "all" or
                 (row["state"] != "complete" if case_filter == "unfinished"
                  else row["state"] == case_filter))
            and (not wanted or wanted in " ".join([
                str(row.get("id", "")), str(row.get("label", "")),
                str(row.get("run_id", "")), str(row.get("profile_id", "")),
                json.dumps(row.get("overrides", {}), ensure_ascii=False, sort_keys=True),
            ]).casefold())]
        if limit:
            offset = min(offset, max(0, ((len(filtered) - 1) // limit) * limit))
        else:
            offset = 0
        page = filtered if run_id is not None else filtered[offset:offset + limit]
        result = {name: value for name, value in state.items() if name != "cases"}
        result.update(state=visible, recorded_state=recorded, active=active,
                      native_active=native_active, cases=page, case_count=len(rows),
                      cases_complete=len(page) == len(rows),
                      progress={"total": len(rows), "completed": completed, "failed": failed,
                                "running": running, "interrupted": interrupted,
                                "pending": len(rows) - completed - failed - running - interrupted},
                      active_case=next((row for row in rows
                                        if row["id"] == state.get("active_case_id")), None),
                      page={"offset": offset, "limit": limit, "total": len(filtered),
                            "study_total": len(rows), "filter": case_filter, "query": query},
                      observation_id=digest({"study_id": key, "updated_at": state.get("updated_at"),
                          "recorded_state": recorded, "active": active,
                          "rows": [(row["id"], row["state"], row["active"],
                                    originals[row["run_id"]][0]["source_sha256"]) for row in rows]}))
        return result


DEFAULT_VIEWS = ParameterViews()
