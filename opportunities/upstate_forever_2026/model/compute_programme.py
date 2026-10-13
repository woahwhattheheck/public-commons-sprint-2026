"""Coordinate retained native NDR/SDR runs, recovery, and later GIS delivery.

This module consumes prepared Workspace grid/profile/scenario IDs. Experiment
designers own parameter generation; the original native engine owns science.
"""
from __future__ import annotations

import csv
import io
import json
from pathlib import Path
import re

from .common import (INVEST_VERSION, ROLES, SOURCE_IDS, atomic_bytes, atomic_json,
                     canonical, describe_file, digest, finite, held, identifier,
                     now, read_json, verify_file)
from .profiles import checked_parameters, scenario_spec
from . import common as scientific_common

SELECTION_SCHEMA = "upstate.compute-programme-selection/v1"
PROGRAMME_SCHEMA = "upstate.compute-programme/v1"
STATE_SCHEMA = "upstate.compute-programme-progress/v1"
REPORT_SCHEMA = "upstate.compute-programme-report/v1"
CONTROL_SCHEMA = "upstate.compute-programme-control/v1"
NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}\Z")
POLLUTANTS = {
    "nitrogen_export": ("kg/pixel/year", "kg/year"),
    "phosphorus_export": ("kg/pixel/year", "kg/year"),
    "sediment_export": ("metric_tonnes/pixel/year", "metric_tonnes/year"),
}
POLLUTANT_MODELS = {"nitrogen_export": "ndr", "phosphorus_export": "ndr",
                   "sediment_export": "sdr"}
ENGINE_FILES = ("common.py", "profiles.py", "workspace.py", "rasters.py",
                "native.py", "compute_programme.py")


def _copy(value):
    return json.loads(canonical(value))


def _text(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Supply " + label)
    return value.strip()


def _name(value, label):
    if not isinstance(value, str) or not NAME.fullmatch(value):
        raise ValueError(label + " must use 1-64 letters, numbers, dots, underscores or hyphens")
    return value


def _error(exc):
    return {"type": type(exc).__name__, "message": str(exc)}


def _engine_sources():
    root = Path(__file__).resolve().parent
    names = list(ENGINE_FILES)
    # These selected-model and reuse helpers participate in native execution.
    names.extend(name for name in ("model_selection.py", "reuse.py", "grid_reuse.py", "stage_cache.py")
                 if (root / name).is_file())
    return [describe_file(root, root / name) for name in names]


def _models(value=None, inherited=None):
    values = inherited if value is None else value
    selector = getattr(scientific_common, "selected_models", None)
    if callable(selector):
        return selector(values)
    if values is None:
        return ["ndr", "sdr"]
    if (not isinstance(values, (list, tuple)) or not values
            or any(not isinstance(name, str) for name in values)):
        raise ValueError("Select distinct native models: ndr, sdr, or both")
    names = [name.strip().lower() for name in values]
    if len(set(names)) != len(names) or set(names) - {"ndr", "sdr"}:
        raise ValueError("Select each native model once from ndr, sdr")
    return [name for name in ("ndr", "sdr") if name in names]


def _shared_output_comparisons():
    from . import native
    return callable(getattr(native, "common_comparison_outputs", None))


def _comparison_disposition(baseline, alternative):
    baseline_models = _models(baseline["selection"].get("models"))
    alternative_models = _models(alternative["selection"].get("models"))
    common = [model for model in baseline_models if model in alternative_models]
    if not common:
        kind, reason = "no_common_outputs", "The selected runs calculate different native models."
    elif baseline_models != alternative_models and not _shared_output_comparisons():
        kind, reason = "models_differ", "This installed native difference engine requires matching model selections."
    else:
        return None
    return {"kind": kind, "baseline_run_id": baseline["id"], "run_id": alternative["id"],
            "baseline_models": baseline_models, "models": alternative_models,
            "common_models": common, "artifacts": {}, "reason": reason}


def _grid_identity(grid):
    return digest({key: grid[key] for key in ("id", "spec", "grid", "files", "inputs")})


def _native_selection(grid_id, profile_id, scenario_id, models=None):
    value = {"schema": "upstate.run-selection/v1", "grid_id": grid_id,
             "profile_id": profile_id, "scenario_id": scenario_id,
             "invest_version": INVEST_VERSION}
    selected = _models(models)
    if selected != ["ndr", "sdr"]:
        value["models"] = selected
    return value


def _run_snapshot(run):
    from . import native
    scope = getattr(native, "run_scope", None)
    state = run["state"]
    result = {
        "run_id": run["id"], "state": state, "selection": run["selection"],
        "models": _models(run["selection"].get("models")),
        "model_scope": scope(run) if callable(scope) else run.get("model_scope"),
        "created_at": run.get("created_at"), "updated_at": run.get("updated_at"),
        "completed_at": run.get("completed_at"), "runtime": run.get("runtime"),
        "stages": {name: {key: value[key] for key in
                   ("started_at", "completed_at", "arguments", "registry_ids", "edits",
                    "input_signature", "runtime", "reused_from", "reused_at")
                   if key in value} for name, value in run.get("stages", {}).items()},
        "artifacts": run.get("artifacts", {}),
        "reuse_observations": run.get("reuse_observations", {}),
    }
    # The original runner retains historical validation details after recovery.
    # Display them as current failure details only while the run is failed.
    if state == "failed":
        result["error"] = run.get("error")
        result["validation"] = run.get("validation", {})
    return result


class ComputeProgrammes:
    """An additive execution ledger over the original immutable Workspace IDs."""

    def __init__(self, workspace):
        self.workspace = workspace
        self.root = workspace.root / "compute-programmes"

    def _directory(self, key):
        return self.root / identifier(key)

    def _load(self, key):
        key = identifier(key)
        value = read_json(self._directory(key) / "programme.json")
        if (value.get("schema") != PROGRAMME_SCHEMA or value.get("id") != key
                or value.get("workspace_id") != self.workspace.project["id"]
                or digest(value.get("identity")) != key):
            raise ValueError("Programme identity differs from this retained workspace")
        identity = value["identity"]
        if value.get("selection") != identity["selection"]:
            raise ValueError("Retained programme selection changed")
        if value.get("runs") != identity["runs"]:
            raise ValueError("Retained programme run bindings changed")
        return value

    def _state(self, key):
        state = read_json(self._directory(key) / "progress.json")
        if (state.get("schema") != STATE_SCHEMA or state.get("programme_id") != key
                or state.get("workspace_id") != self.workspace.project["id"]):
            raise ValueError("Programme progress belongs to another retained selection")
        return state

    def _write_state(self, key, record, **changes):
        record.update(changes, updated_at=now())
        atomic_json(self._directory(key) / "progress.json", record)
        return record

    def _control(self, key):
        path = self._directory(key) / "control.json"
        if not path.exists():
            return {"schema": CONTROL_SCHEMA, "programme_id": key,
                    "workspace_id": self.workspace.project["id"], "pause_requested": False}
        value = read_json(path)
        if (value.get("schema") != CONTROL_SCHEMA or value.get("programme_id") != key
                or value.get("workspace_id") != self.workspace.project["id"]):
            raise ValueError("Programme control belongs to another retained selection")
        return value

    def _set_pause(self, key, requested):
        self._load(key)
        directory = self._directory(key)
        with held(directory / ".control.lock"):
            control = self._control(key)
            control.update(pause_requested=bool(requested), updated_at=now())
            atomic_json(directory / "control.json", control)
        return control

    def _active(self, key):
        try:
            with held(self._directory(key) / ".execution.lock", blocking=False):
                return False
        except BlockingIOError:
            return True

    def _bindings(self, selection):
        grid = self.workspace.get_grid(selection["grid_id"])
        baseline_name = selection["baseline_run"]
        baseline = next(row for row in selection["runs"] if row["key"] == baseline_name)
        baseline_profile = self.workspace._get("profiles", baseline["profile_id"])
        rows = []
        for row in selection["runs"]:
            profile = self.workspace._get("profiles", row["profile_id"])
            scenario = self.workspace._get("scenarios", row["scenario_id"])
            models = _models(row.get("models"), grid["spec"].get("models"))
            if models != ["ndr", "sdr"] and not callable(getattr(scientific_common, "selected_models", None)):
                raise ValueError("Install the selected-model native core before preparing a partial-model programme")
            if set(models) - set(_models(grid["spec"].get("models"))):
                raise ValueError("Grid does not contain the selected native models: " + row["key"])
            if set(models) - set(_models(profile.get("models"))):
                raise ValueError("Profile does not supply the selected native models: " + row["key"])
            needed_roles = {"DEM", "NLCD"}
            if "ndr" in models:
                needed_roles.add("PRECIPITATION")
            if "sdr" in models:
                needed_roles.update(("R_FACTOR", "K_FACTOR"))
            missing_roles = needed_roles - set(grid["files"])
            if missing_roles:
                raise ValueError("Prepare actual grid inputs for " + row["key"] + ": " + ", ".join(sorted(missing_roles)))
            available_codes = {int(code) for code in grid["inputs"]["NLCD"]["class_counts"]}
            missing_codes = available_codes - set(profile["table_summary"]["lucodes"])
            if missing_codes:
                raise ValueError("Biophysical table lacks retained land-cover codes: " + ", ".join(map(str, sorted(missing_codes))))
            checked_parameters(profile)
            scenario_spec(_copy(scenario))
            native = _native_selection(grid["id"], profile["id"], scenario["id"], models)
            changes = {}
            for model in _models(native.get("models")):
                selected_parameters = profile.get(model, {})
                baseline_parameters = baseline_profile.get(model, {})
                for parameter in sorted(set(selected_parameters) | set(baseline_parameters)):
                    a = baseline_parameters.get(parameter)
                    b = selected_parameters.get(parameter)
                    if a != b:
                        changes[model + "." + parameter] = {"baseline": a, "selected": b}
            rows.append({
                **row, "run_id": digest(native), "native_selection": native,
                "parameter_changes": changes,
                "table_changed": profile["table_summary"]["sha256"] != baseline_profile["table_summary"]["sha256"],
                "scenario_changed": scenario["id"] != baseline["scenario_id"],
                "profile_title": profile["title"], "scenario_title": scenario["title"],
                "scenario_kind": scenario["kind"],
            })
        return grid, rows

    def preview(self, spec):
        if not isinstance(spec, dict) or spec.get("schema") != SELECTION_SCHEMA:
            raise ValueError("Select an " + SELECTION_SCHEMA + " document")
        allowed = {"schema", "title", "description", "grid_id", "baseline_run", "runs", "source_reference"}
        if set(spec) - allowed:
            raise ValueError("Unknown programme fields: " + ", ".join(sorted(set(spec) - allowed)))
        selection = _copy(spec)
        selection["title"] = _text(selection.get("title"), "the programme title")
        identifier(selection.get("grid_id"))
        if "description" in selection:
            selection["description"] = _text(selection["description"], "the programme description")
        if "source_reference" in selection:
            selection["source_reference"] = _text(selection["source_reference"], "the application source reference")
        rows = selection.get("runs")
        if not isinstance(rows, list) or not rows:
            raise ValueError("Select one or more named native runs")
        keys = []
        allowed_run = {"key", "title", "profile_id", "scenario_id", "reason", "experiment_key", "changes", "models"}
        for row in rows:
            if not isinstance(row, dict) or set(row) - allowed_run:
                raise ValueError("A run selects key, title, profile_id, scenario_id and optional experiment context")
            keys.append(_name(row.get("key"), "Run key"))
            row["title"] = _text(row.get("title"), "each run title")
            identifier(row.get("profile_id"))
            identifier(row.get("scenario_id"))
            if "models" in row:
                row["models"] = _models(row["models"])
            for name in ("reason", "experiment_key"):
                if name in row:
                    row[name] = _text(row[name], name)
            if "changes" in row and not isinstance(row["changes"], dict):
                raise ValueError("Run changes must be a retained experiment-context object")
        if len(set(keys)) != len(keys):
            raise ValueError("Named run keys must be distinct")
        if selection.get("baseline_run") not in keys:
            raise ValueError("Select one of the named runs as the comparison baseline")
        grid, bindings = self._bindings(selection)
        result_rows = []
        for binding in bindings:
            path = self.workspace.root / "runs" / binding["run_id"] / "run.json"
            native = self.workspace.inspect_run(binding["run_id"]) if path.exists() else None
            result_rows.append({**binding, "state": native["state"] if native else "unprepared",
                                "existing": native is not None})
        return {"schema": "upstate.compute-programme-preview/v1", "selection": selection,
                "baseline_run": selection["baseline_run"], "grid_id": grid["id"],
                "grid_identity": _grid_identity(grid), "runs": result_rows,
                "run_count": len(bindings),
                "unique_run_count": len({row["run_id"] for row in bindings}),
                "warnings": ([("Runs compare their common native outputs; each selected pollutant also retains its own total."
                              if _shared_output_comparisons() else
                              "This native difference engine requires matching model selections; individual model totals remain available.")]
                    if len({tuple(_models(row["native_selection"].get("models"))) for row in bindings}) > 1 else [])}

    def _initial_state(self, record):
        return {"schema": STATE_SCHEMA, "programme_id": record["id"],
                "workspace_id": self.workspace.project["id"], "state": "prepared",
                "phase": "prepared", "created_at": record["created_at"], "updated_at": record["created_at"],
                "current_run": None, "attempts": {}, "comparisons": {}, "comparison_errors": {},
                "requested_runs": [], "completed_at": None, "latest_report": None, "deliveries": {}}

    def create(self, spec, source_reference=None):
        if source_reference is not None:
            spec = _copy(spec)
            supplied = _text(source_reference, "the application source reference")
            if spec.get("source_reference") not in (None, supplied):
                raise ValueError("The requested source reference differs from the programme selection")
            spec["source_reference"] = supplied
        preview = self.preview(spec)
        selection = preview["selection"]
        engine = _engine_sources()
        reference = selection.get("source_reference") or "installed-source:" + digest(engine)
        grid, bindings = self._bindings(selection)
        identity = {"selection": selection, "workspace_id": self.workspace.project["id"],
                    "source_reference": reference, "engine_sources": engine,
                    "grid_identity": _grid_identity(grid), "runs": bindings}
        key = digest(identity)
        directory = self._directory(key)
        directory.mkdir(parents=True, exist_ok=True)
        with held(directory / ".programme.lock", blocking=False):
            if (directory / "programme.json").exists():
                record = self._load(key)
                if not (directory / "progress.json").exists():
                    atomic_json(directory / "progress.json", self._initial_state(record), immutable=True)
            else:
                for row in bindings:
                    run = self.workspace.prepare_run({name: row["native_selection"][name]
                        for name in ("grid_id", "profile_id", "scenario_id", "models")
                        if name in row["native_selection"]})
                    if run["id"] != row["run_id"]:
                        raise ValueError("Native preparation returned a different retained run")
                from .native_batch import _application_sources
                record = {"schema": PROGRAMME_SCHEMA, "id": key, "programme_id": key,
                          "workspace_id": self.workspace.project["id"], "title": selection["title"],
                          "selection": selection, "identity": identity, "runs": bindings,
                          "application_sources": _application_sources(), "created_at": now()}
                atomic_json(directory / "programme.json", record, immutable=True)
                atomic_json(directory / "progress.json", self._initial_state(record), immutable=True)
        return self.status(key)

    def status(self, key):
        record = self._load(key)
        state = self._state(key)
        active = self._active(key)
        control = self._control(key)
        rows, counts = [], {"total": len(record["runs"]), "complete": 0,
                            "failed": 0, "running": 0, "pending": 0}
        for binding in record["runs"]:
            try:
                native = self.workspace.inspect_run(binding["run_id"])
                if native["selection"] != binding["native_selection"]:
                    raise ValueError("Native run differs from the saved programme binding")
                row = {**binding, **_run_snapshot(native)}
            except (ValueError, OSError, KeyError) as exc:
                row = {**binding, "state": "missing", "stages": {}, "artifacts": {}, "error": _error(exc)}
            row["native_state"] = row["state"]
            row["attempts"] = state["attempts"].get(binding["key"], [])
            if row["attempts"] and row["attempts"][-1]["state"] == "failed":
                row.update(state="failed", error=row["attempts"][-1].get("error"),
                           failure_stage="programme execution or output verification")
            count_key = row["state"] if row["state"] in ("complete", "failed", "running") else "pending"
            counts[count_key] += 1
            rows.append(row)
        visible_state = state["state"]
        if visible_state == "running" and not active:
            visible_state = "interrupted"
        if visible_state == "complete" and counts["complete"] != counts["total"]:
            visible_state = "failed" if counts["failed"] else "partial"
        latest = state.get("latest_report") or {}
        return {"schema": PROGRAMME_SCHEMA, "id": key, "programme_id": key,
                "workspace_id": record["workspace_id"], "title": record["title"],
                "selection": record["selection"], "source_reference": record["identity"]["source_reference"],
                "state": visible_state, "recorded_state": state["state"], "phase": state["phase"],
                "active": active, "pause_requested": control["pause_requested"],
                "current_run": state.get("current_run"), "counts": counts, "runs": rows,
                "baseline_run": record["selection"]["baseline_run"],
                "requested_runs": state.get("requested_runs", []),
                "created_at": record["created_at"], "updated_at": state["updated_at"],
                "completed_at": state.get("completed_at"), "comparisons": state.get("comparisons", {}),
                "comparison_errors": state.get("comparison_errors", {}),
                "execution_sources": state.get("execution_sources"),
                "error": state.get("error"), "report": latest or None, "latest_report": latest or None,
                "files": latest.get("files", []), "deliveries": state.get("deliveries", {})}

    def catalog(self):
        programmes = []
        for path in sorted(self.root.glob("*/programme.json")):
            try:
                value = self.status(path.parent.name)
                programmes.append({key: value[key] for key in
                    ("id", "title", "state", "phase", "counts", "updated_at", "baseline_run", "active", "pause_requested")})
            except (ValueError, OSError, KeyError) as exc:
                programmes.append({"id": path.parent.name, "state": "unavailable", "error": _error(exc)})
        grids = []
        for path in sorted((self.workspace.root / "grids").glob("*/grid.json")):
            value = read_json(path)
            grids.append({"id": value["id"], "title": value.get("spec", {}).get("title", value["id"][:12]),
                          "state": value["state"],
                          "models": _models(value.get("spec", {}).get("models")),
                          "source_collection_id": value.get("spec", {}).get("source_collection_id")})
        profiles = [{"id": p["id"], "title": p["title"],
                     "source_collection_id": p["source_collection_id"],
                     "biophysical_source_id": p["biophysical_source_id"],
                     "models": _models(p.get("models")),
                     "parameters": {model: p[model] for model in ("ndr", "sdr") if model in p}}
                    for p in self.workspace._list("profiles")]
        scenarios = [{"id": p["id"], "title": p["title"], "kind": p["kind"],
                      "source_collection_id": p["source_collection_id"]}
                     for p in self.workspace._list("scenarios")]
        return {"schema": "upstate.compute-programme-catalog/v1", "selection_schema": SELECTION_SCHEMA,
                "programmes": programmes, "grids": grids, "profiles": profiles, "scenarios": scenarios,
                "model_selection_available": callable(getattr(scientific_common, "selected_models", None))}

    def pause(self, key):
        control = self._set_pause(key, True)
        return {"schema": CONTROL_SCHEMA, "programme_id": key, "pause_requested": True,
                "updated_at": control["updated_at"], "boundary": "after the current native run or comparison"}

    def resume(self, key, only_runs=None):
        self._set_pause(key, False)
        return self.execute(key, only_runs=only_runs)

    def _check_execution(self, record, engine_sources=None):
        current = _engine_sources() if engine_sources is None else engine_sources
        # Retain the original complete inventory while allowing lifecycle/report
        # repairs to this coordinator. Every scientific dependency still matches.
        scientific = lambda values: [item for item in values
                                     if item["path"] != "compute_programme.py"]
        if scientific(current) != scientific(record["identity"]["engine_sources"]):
            raise ValueError("Programme scientific engine source changed; reopen its retained application or create a new programme")
        grid = self.workspace.get_grid(record["selection"]["grid_id"])
        if _grid_identity(grid) != record["identity"]["grid_identity"]:
            raise ValueError("Programme grid inputs or output identities changed")
        _, bindings = self._bindings(record["selection"])
        if bindings != record["runs"]:
            raise ValueError("Programme profile or scenario binding changed")
        return grid

    def _recover_attempts(self, key, state):
        recovered_at = now()
        changed = False
        for attempts in state["attempts"].values():
            for attempt in attempts:
                if attempt.get("state") != "running":
                    continue
                try:
                    native = self.workspace.inspect_run(attempt["run_id"])
                    observation = {"state": native["state"], "completed_stages": {
                        name: stage["completed_at"] for name, stage in native.get("stages", {}).items()
                        if stage.get("completed_at")}}
                except (ValueError, OSError, KeyError) as exc:
                    observation = {"state": "unavailable", "error": _error(exc)}
                # This closes a lost coordinator attempt, preserving the native
                # runner state. The next attempt verifies/reuses native files.
                attempt.update(state="interrupted", recovered_at=recovered_at,
                               native_state_at_recovery=observation["state"],
                               recovery_observation=observation)
                changed = True
        if changed:
            self._write_state(key, state)

    def _pause_boundary(self, key, state):
        if self._control(key)["pause_requested"]:
            self._write_state(key, state, state="paused", phase="paused", current_run=None)
            return True
        return False

    def execute(self, key, only_runs=None):
        record = self._load(key)
        names = [row["key"] for row in record["runs"]]
        baseline_name = record["selection"]["baseline_run"]
        if only_runs is not None and not isinstance(only_runs, (list, tuple)):
            raise ValueError("only_runs must be a list of named programme keys")
        requested = list(names) if only_runs is None else list(only_runs)
        if (not requested or any(not isinstance(name, str) for name in requested)
                or len(set(requested)) != len(requested) or set(requested) - set(names)):
            raise ValueError("Select distinct named programme runs for execution")
        selected = [baseline_name] + [name for name in requested if name != baseline_name]
        by_name = {row["key"]: row for row in record["runs"]}
        directory = self._directory(key)
        with held(self.workspace.root / ".native-model-batch.lock", blocking=False), \
                held(directory / ".execution.lock", blocking=False), \
                held(directory / ".programme.lock", blocking=False):
            state = self._state(key)
            if self._pause_boundary(key, state):
                return {**self.status(key), "active": False}
            self._write_state(key, state, state="running", phase="inputs", current_run=None,
                              requested_runs=requested, effective_runs=selected, error=None)
            try:
                self._recover_attempts(key, state)
                execution_sources = _engine_sources()
                self._write_state(key, state, execution_sources=execution_sources)
                self._check_execution(record, execution_sources)
                orchestrator_source = next(item for item in execution_sources
                                           if item["path"] == "compute_programme.py")
                # Resolve a missing or different native runtime once before a series.
                unfinished = [name for name in selected
                    if self.workspace.inspect_run(by_name[name]["run_id"])["state"] != "complete"]
                if unfinished:
                    from .native import runtime
                    needed_models = [model for model in ("ndr", "sdr") if any(
                        model in _models(by_name[name]["native_selection"].get("models")) for name in unfinished)]
                    if callable(getattr(scientific_common, "selected_models", None)):
                        runtime(needed_models)
                    else:
                        runtime()
                verified_runs = set()
                for name in selected:
                    if self._pause_boundary(key, state):
                        break
                    binding = by_name[name]
                    attempts = state["attempts"].setdefault(name, [])
                    attempt = {"number": len(attempts) + 1, "started_at": now(),
                               "state": "running", "run_id": binding["run_id"],
                               "orchestrator_source": orchestrator_source}
                    attempts.append(attempt)
                    self._write_state(key, state, current_run=name, phase="run:" + name)
                    try:
                        if binding["run_id"] in verified_runs:
                            native = self.workspace.inspect_run(binding["run_id"])
                            reused = True
                        else:
                            native = self.workspace.run(binding["run_id"])
                            reused = bool(native.get("reused"))
                            verified_runs.add(binding["run_id"])
                        if native["state"] != "complete":
                            raise RuntimeError("Native run did not complete: " + name)
                        attempt.update(state="complete", completed_at=now(), reused=reused)
                    except Exception as exc:
                        attempt.update(state="failed", completed_at=now(), error=_error(exc))
                    self._write_state(key, state)
                if state["state"] != "paused":
                    baseline = self.workspace.inspect_run(by_name[baseline_name]["run_id"])
                    if baseline["state"] == "complete":
                        for name in selected:
                            if name == baseline_name:
                                continue
                            if self._pause_boundary(key, state):
                                break
                            alternative = self.workspace.inspect_run(by_name[name]["run_id"])
                            if alternative["state"] != "complete":
                                continue
                            self._write_state(key, state, phase="comparison:" + name, current_run=None)
                            try:
                                if alternative["id"] == baseline["id"]:
                                    comparison = {"kind": "identity", "baseline_run_id": baseline["id"],
                                                  "run_id": alternative["id"], "artifacts": {}}
                                else:
                                    comparison = _comparison_disposition(baseline, alternative)
                                    if comparison is None:
                                        result = self.workspace.compare_runs([baseline["id"], alternative["id"]])
                                        comparison = {"kind": "native", "id": result["id"],
                                                      "baseline_run_id": baseline["id"],
                                                      "common_artifacts": result.get("common_artifacts",
                                                          list(result["alternatives"][0]["artifacts"])),
                                                      "model_scopes": result.get("model_scopes"),
                                                      **result["alternatives"][0]}
                                state["comparisons"][name] = comparison
                                state["comparison_errors"].pop(name, None)
                            except Exception as exc:
                                state["comparisons"].pop(name, None)
                                state["comparison_errors"][name] = _error(exc)
                            self._write_state(key, state)
                if state["state"] != "paused":
                    actual = {name: self.workspace.inspect_run(binding["run_id"])
                              for name, binding in by_name.items()}
                    failed_attempts = {name for name in names if state["attempts"].get(name)
                                       and state["attempts"][name][-1]["state"] == "failed"}
                    all_runs = (all(value["state"] == "complete" for value in actual.values())
                                and not failed_attempts)
                    all_comparisons = all(name == baseline_name or name in state["comparisons"] for name in names)
                    selected_failures = [name for name in selected if actual[name]["state"] != "complete" or name in failed_attempts]
                    terminal = ("complete" if all_runs and all_comparisons else
                                "failed" if selected_failures or state["comparison_errors"] else "partial")
                    self._write_state(key, state, state=terminal, phase=terminal, current_run=None,
                                      completed_at=(state.get("completed_at") or now()) if terminal == "complete" else None)
                self.report(key, _locked=True)
            except BaseException as exc:
                terminal = "interrupted" if isinstance(exc, (KeyboardInterrupt, SystemExit)) else "failed"
                current = state.get("current_run")
                if current and state["attempts"].get(current) and state["attempts"][current][-1]["state"] == "running":
                    state["attempts"][current][-1].update(state=terminal, completed_at=now(), error=_error(exc))
                self._write_state(key, state, state=terminal, phase=state["phase"], error=_error(exc))
                if not isinstance(exc, (KeyboardInterrupt, SystemExit)):
                    try:
                        self.report(key, _locked=True)
                    except Exception as report_error:
                        self._write_state(key, state, report_error=_error(report_error))
                raise
        return self.status(key)

    def _report_payload(self, key):
        status = self.status(key)
        record = self._load(key)
        by_name = {row["key"]: row for row in status["runs"]}
        baseline = by_name[status["baseline_run"]]
        rows = []
        for run in status["runs"]:
            for pollutant, (cell_units, annual_units) in POLLUTANTS.items():
                model = POLLUTANT_MODELS[pollutant]
                if model not in run.get("models", _models(run["native_selection"].get("models"))):
                    continue
                artifact = run.get("artifacts", {}).get(pollutant) if run["state"] == "complete" else None
                base_artifact = baseline.get("artifacts", {}).get(pollutant) if baseline["state"] == "complete" else None
                row = {"run_key": run["key"], "run_id": run["run_id"], "title": run["title"],
                       "profile_id": run["profile_id"], "scenario_id": run["scenario_id"],
                       "experiment_key": run.get("experiment_key"), "model": model, "pollutant": pollutant,
                       "state": run["state"], "total": None, "units": annual_units,
                       "valid_cells": None, "valid_area_ha": None, "baseline_total": None,
                       "baseline_valid_cells": None, "total_change": None,
                       "comparison_cells": None, "percent_change": None, "support_matches": None,
                       "comparison_id": None, "parameter_changes": run["parameter_changes"],
                       "table_changed": run["table_changed"], "scenario_changed": run["scenario_changed"],
                       "artifact": None, "comparison_artifact": None,
                       "comparison_state": "pending", "comparison_reason": None}
                if run["state"] == "complete" and artifact is None:
                    raise ValueError("Completed native run lacks its selected export: " + run["key"] + "/" + pollutant)
                if artifact is not None:
                    if artifact.get("units") != cell_units or artifact.get("sum_units") != annual_units:
                        raise ValueError("Native output summary units differ for " + pollutant)
                    row["total"] = finite(artifact["sum"], "native total", minimum=0)
                    row["valid_cells"] = int(artifact["valid_cells"])
                    area = finite(artifact["pixel_area_ha"], "native pixel area", positive=True)
                    row["valid_area_ha"] = row["valid_cells"] * area
                    row["artifact"] = {**artifact, "path": "runs/" + run["run_id"] + "/" + artifact["path"]}
                if base_artifact is not None:
                    row["baseline_total"] = finite(base_artifact["sum"], "baseline total", minimum=0)
                    row["baseline_valid_cells"] = int(base_artifact["valid_cells"])
                comparison = status["comparisons"].get(run["key"])
                if comparison:
                    row["comparison_state"] = comparison["kind"]
                    row["comparison_reason"] = comparison.get("reason")
                elif run["key"] in status["comparison_errors"]:
                    row["comparison_state"] = "failed"
                    row["comparison_reason"] = status["comparison_errors"][run["key"]].get("message")
                same_run = run["run_id"] == baseline["run_id"]
                if artifact is not None and base_artifact is not None and same_run:
                    row.update(total_change=0.0, comparison_cells=row["valid_cells"], support_matches=True,
                               percent_change=0.0 if row["baseline_total"] else None, comparison_state="identity")
                elif artifact is not None and base_artifact is not None and comparison:
                    item = comparison.get("artifacts", {}).get(pollutant)
                    if item is not None:
                        cells = int(item["valid_cells"])
                        matches = cells == row["valid_cells"] == row["baseline_valid_cells"]
                        change = finite(item["sum_change"], "native common-cell change")
                        row.update(total_change=change, comparison_cells=cells, support_matches=matches,
                                   comparison_id=comparison["id"],
                                   percent_change=(100.0 * change / row["baseline_total"])
                                       if matches and row["baseline_total"] else None,
                                   comparison_artifact={**item, "path": "comparisons/" + comparison["id"] + "/" + item["path"]})
                if artifact is not None and base_artifact is None:
                    row["comparison_state"] = "no_baseline_output"
                    row["comparison_reason"] = "A matching " + model.upper() + " baseline output is required for this pollutant change."
                row["change_basis"] = "alternative minus baseline on the native comparison's common valid cells"
                rows.append(row)
        return {"schema": REPORT_SCHEMA, "programme_id": key, "workspace_id": record["workspace_id"],
                "title": status["title"], "programme_state": status["state"], "counts": status["counts"],
                "baseline_run": status["baseline_run"], "grid_id": record["selection"]["grid_id"],
                "source_reference": record["identity"]["source_reference"],
                "engine_sources": record["identity"]["engine_sources"],
                "execution_sources": status.get("execution_sources"),
                "rows": rows, "comparisons": status["comparisons"],
                "comparison_errors": status["comparison_errors"],
                "interpretation": {
                    "completion": "A completed run has finished its selected native models; each row names the model and pollutant.",
                    "totals": "Annual mass within each native output's retained reporting mask.",
                    "change": "Native difference rasters use the intersection of baseline and alternative valid cells.",
                    "model_scope": ("Native comparisons use common selected outputs on the same retained grid. Each other selected pollutant retains its individual annual total."
                                    if _shared_output_comparisons() else
                                    "This native comparison engine uses matching model selections; each selected run retains its individual annual totals."),
                    "percent": "Percent change is available when native common-cell count equals both output counts and baseline mass is positive.",
                    "coverage": "Valid area is original valid cells multiplied by the retained pixel area in hectares.",
                    "parameters": "Parameter changes are read from actual saved profiles relative to the selected baseline.",
                }}

    def report(self, key, _locked=False):
        if not _locked:
            with held(self._directory(key) / ".programme.lock", blocking=False):
                return self.report(key, _locked=True)
        payload = self._report_payload(key)
        report_id = digest(payload)
        directory = self._directory(key) / "reports" / report_id
        path = directory / "report.json"
        if path.exists():
            report = read_json(path)
            if report.get("id") != report_id or {k: v for k, v in report.items() if k not in ("id", "generated_at")} != payload:
                raise ValueError("Retained computation report differs from its actual output summaries")
        else:
            report = {**payload, "id": report_id, "generated_at": now()}
            atomic_json(path, report, immutable=True)
        fields = ("run_key", "run_id", "title", "profile_id", "scenario_id", "experiment_key",
                  "model", "pollutant", "state", "total", "units", "valid_cells", "valid_area_ha",
                  "baseline_total", "baseline_valid_cells", "total_change", "comparison_cells",
                  "percent_change", "support_matches", "comparison_id", "comparison_state", "comparison_reason")
        stream = io.StringIO(newline="")
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(report["rows"])
        atomic_bytes(directory / "report.csv", stream.getvalue().encode("utf-8"), immutable=True)
        def label(value):
            return str(value).replace("|", "\\|").replace("\n", " ").replace("\r", " ")
        def number(value):
            return "" if value is None else format(value, ".10g")
        lines = ["# " + label(report["title"]), "",
                 "Programme: " + key, "", "State: " + report["programme_state"], "",
                 "| Run | Pollutant | Annual mass | Units | Valid ha | Common-cell change | Common cells | Change % |",
                 "| --- | --- | ---: | --- | ---: | ---: | ---: | ---: |"]
        for row in report["rows"]:
            values = (row["title"], row["pollutant"], number(row["total"]), row["units"],
                      number(row["valid_area_ha"]), number(row["total_change"]),
                      number(row["comparison_cells"]), number(row["percent_change"]))
            lines.append("| " + " | ".join(label(value) for value in values) + " |")
        lines.extend(["", "## Interpretation", ""])
        lines.extend(report["interpretation"].values())
        lines.extend(["", "## Source", "", "Application: " + report["source_reference"],
                      "", "Grid: " + report["grid_id"], ""])
        atomic_bytes(directory / "report.md", ("\n".join(lines)).encode("utf-8"), immutable=True)
        files = [describe_file(self.workspace.root, directory / name)
                 for name in ("report.json", "report.csv", "report.md")]
        state = self._state(key)
        self._write_state(key, state, latest_report={"id": report_id, "files": files,
                                                     "generated_at": report["generated_at"]})
        return {**report, "files": files}

    def read_report(self, key):
        self._load(key)
        latest = self._state(key).get("latest_report")
        if not latest:
            return {"schema": REPORT_SCHEMA, "programme_id": key, "state": "unavailable", "rows": [], "files": []}
        item = next(value for value in latest["files"] if value["path"].endswith("/report.json"))
        report = read_json(verify_file(self.workspace.root, item))
        payload = {k: v for k, v in report.items() if k not in ("id", "generated_at")}
        if report.get("programme_id") != key or report.get("id") != latest["id"] or digest(payload) != latest["id"]:
            raise ValueError("Saved computation report belongs to another original selection")
        return {**report, "files": latest["files"]}

    def delivery_preview(self, key, selection):
        record = self._load(key)
        if not isinstance(selection, dict):
            raise ValueError("Supply the complete named-run delivery selection")
        choice = _copy(selection)
        if "baseline_run_id" in choice or "scenario_run_ids" in choice:
            raise ValueError("Use the programme's named baseline_run and scenario_runs")
        by_name = {row["key"]: row for row in record["runs"]}
        base_name = choice.get("baseline_run")
        names = choice.get("scenario_runs")
        if (not isinstance(base_name, str) or base_name not in by_name or not isinstance(names, list) or not names
                or any(not isinstance(name, str) or name not in by_name for name in names)
                or len(set([base_name] + names)) != len(names) + 1):
            raise ValueError("Select a distinct named baseline and future land-cover runs")
        native_ids = [by_name[name]["run_id"] for name in [base_name] + names]
        if any(_models(by_name[name]["native_selection"].get("models")) != ["ndr", "sdr"]
               for name in [base_name] + names):
            raise ValueError("Select baseline and future runs containing both NDR and SDR for the complete seven-map delivery")
        if len(set(native_ids)) != len(native_ids):
            raise ValueError("Select distinct actual native runs for the delivery comparison")
        base = by_name[base_name]
        if base["scenario_kind"] != "baseline":
            raise ValueError("Delivery baseline must use the retained original land cover")
        for name in names:
            run = by_name[name]
            if run["scenario_kind"] != "landcover" or run["profile_id"] != base["profile_id"]:
                raise ValueError("Future maps require explicit land-cover runs under the same baseline profile")
        grid = self.workspace.get_grid(record["selection"]["grid_id"])
        collection_id = grid["spec"]["source_collection_id"]
        roles = choice.get("source_roles")
        overlays = choice.get("overlays")
        needed = set(SOURCE_IDS) - set(ROLES) - {"LS_FACTOR"}
        if not isinstance(roles, dict) or needed - set(roles):
            raise ValueError("Select the retained protected-land, parcel, NHD and NWI sources")
        if "LS_FACTOR" in roles:
            raise ValueError("The original SDR terrain output supplies LS_FACTOR")
        if not isinstance(overlays, dict) or {"drinking_water", "high_quality_waters"} - set(overlays):
            raise ValueError("Select retained drinking-water and high-quality-water overlays")
        contact = choice.get("contact")
        if not isinstance(contact, dict):
            raise ValueError("Supply the actual GIS metadata contact")
        for field in ("name", "organization", "email"):
            _text(contact.get(field), "the metadata contact " + field)
        for group, values in (("source_roles", roles), ("overlays", overlays)):
            for name, value in values.items():
                if not isinstance(value, dict):
                    raise ValueError("Delivery source selections must be objects")
                value.setdefault("source_collection_id", collection_id)
                collection = self.workspace._get("sources", identifier(value["source_collection_id"]))
                entries = [entry for entry in collection["entries"] if entry["id"] == value.get("source_id")]
                if len(entries) != 1:
                    raise ValueError("Delivery source is absent from its retained collection: " + name)
                if (group == "overlays" or name in needed) and entries[0]["kind"] != "vector":
                    raise ValueError("Delivery " + name + " requires its retained vector source")
                if name in ROLES and (value["source_collection_id"] != collection_id
                        or value["source_id"] != grid["spec"]["input_sources"][name]):
                    raise ValueError("Delivery must preserve the actual modeled " + name + " source")
        choice["baseline_run_id"] = base["run_id"]
        choice["scenario_run_ids"] = [by_name[name]["run_id"] for name in names]
        choice.pop("baseline_run")
        choice.pop("scenario_runs")
        run_states = {name: self.workspace.inspect_run(by_name[name]["run_id"])["state"]
                      for name in [base_name] + names}
        return {"schema": "upstate.compute-programme-delivery-preview/v1", "programme_id": key,
                "selection": choice, "baseline_run": base_name, "scenario_runs": names,
                "run_states": run_states, "ready": all(state == "complete" for state in run_states.values())}

    def prepare_delivery(self, key, selection, handoff_path=None):
        preview = self.delivery_preview(key, selection)
        if not preview["ready"]:
            raise ValueError("Complete the selected baseline and future runs before building their GIS delivery")
        record = self._load(key)
        directory = self._directory(key)
        delivery_key = digest(preview["selection"])
        with held(self.workspace.root / ".native-model-batch.lock", blocking=False), \
                held(directory / ".programme.lock", blocking=False):
            state = self._state(key)
            selected_names = [preview["baseline_run"]] + preview["scenario_runs"]
            by_name = {row["key"]: row for row in record["runs"]}
            self._check_execution(record)
            attempt = state["deliveries"].setdefault(delivery_key, {"state": "prepared",
                       "selection": preview["selection"], "created_at": now()})
            attempt.update(state="building", updated_at=now())
            self._write_state(key, state)
            try:
                result = self.workspace.build_delivery(preview["selection"])
                if result["state"] != "complete":
                    raise RuntimeError("The original seven-map delivery has not completed")
                comparison = self.workspace.compare_runs([by_name[name]["run_id"] for name in selected_names])
                grid = self.workspace.get_grid(record["selection"]["grid_id"])
                collection = self.workspace._get("sources", grid["spec"]["source_collection_id"])
                outcomes = {}
                for name, row in by_name.items():
                    native = self.workspace.inspect_run(row["run_id"])
                    if native["state"] != "complete":
                        continue
                    outcomes[name] = {
                        "id": native["id"], "selection": native["selection"], "state": native["state"],
                        "runtime": native.get("runtime"),
                        "started_at": min((v["started_at"] for v in native["stages"].values()
                                           if "started_at" in v), default=None),
                        "completed_at": native["completed_at"],
                        "stages": {stage: {"completed_at": value.get("completed_at"),
                                          "files": len(value.get("files", {})) + int("artifact" in value)}
                                   for stage, value in native["stages"].items()},
                        "artifacts": native["artifacts"],
                    }
                output = {"schema": "upstate.native-model-receiving/v1", "native_selection_id": key,
                          "programme_id": key, "workspace_path": str(self.workspace.root),
                          "workspace_id": self.workspace.project["id"],
                          "source_collection_id": collection["id"],
                          "source_manifest_sha256": collection["original_manifest"]["sha256"],
                          "source_reference": record["identity"]["source_reference"],
                          "application_sources": record["application_sources"],
                          "grid_id": grid["id"],
                          "profiles": {name: row["profile_id"] for name, row in by_name.items()},
                          "scenarios": {name: row["scenario_id"] for name, row in by_name.items()},
                          "runs": {name: by_name[name]["run_id"] for name in outcomes},
                          "comparison_id": comparison["id"], "model_outcomes": outcomes,
                          "delivery_selection": preview["selection"], "delivery_id": result["id"],
                          "completed_at": result["completed_at"]}
                target = directory / "deliveries" / delivery_key / "receiving.json"
                atomic_json(target, output, immutable=True)
                attempt.update(state="complete", updated_at=now(), delivery_id=result["id"],
                               receiving=describe_file(self.workspace.root, target), files=result.get("files", {}))
                attempt.pop("error", None)
                self._write_state(key, state)
                if handoff_path is not None:
                    atomic_json(Path(handoff_path), output, immutable=True)
                files = [attempt["receiving"]] + [
                    {**item, "path": "deliveries/" + result["id"] + "/" + item["path"]}
                    for item in result.get("files", {}).values()]
                return {**output, "receiving": attempt["receiving"], "delivery": result, "files": files}
            except BaseException as exc:
                attempt.update(state="failed", updated_at=now(), error=_error(exc))
                self._write_state(key, state)
                raise
