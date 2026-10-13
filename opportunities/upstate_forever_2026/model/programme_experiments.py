"""Materialize a saved experiment into the existing native programme operator.

The experiment planner owns parameter expansion and its paired baselines.
This adapter retains those exact generated selections for programme execution.
"""
from __future__ import annotations

from pathlib import Path

from .common import digest, held, identifier
from .compute_programme import (ComputeProgrammes, SELECTION_SCHEMA,
                                _models, _native_selection)


def _engine():
    try:
        from . import experiments
    except ImportError as exc:
        raise ValueError("Install the saved experiment planner in this application.") from exc
    return experiments


def catalog(workspace):
    if not (Path(__file__).resolve().parent / "experiments.py").is_file():
        return {"experiments_available": False, "experiments": []}
    engine = _engine()
    rows = []
    for path in sorted((workspace.root / "experiments").glob("*/plan.json")):
        key = identifier(path.parent.name)
        try:
            plan = engine._plan(workspace, key)
            state = engine._state(workspace, key)
            rows.append({"id": key, "title": plan["selection"]["title"],
                         "state": state["state"], "counts": plan["counts"],
                         "grid_id": plan["baseline"]["grid_id"],
                         "baseline_run_id": plan["baseline"]["run_id"],
                         "updated_at": state.get("updated_at")})
        except (ValueError, OSError, KeyError) as exc:
            rows.append({"id": key, "state": "unavailable", "error": str(exc)})
    return {"experiments_available": True, "experiments": rows}


def _reference(workspace, plan):
    reference = workspace.inspect_run(plan["baseline"]["run_id"])
    selected = reference["selection"]
    if any(selected[name] != plan["baseline"][name]
           for name in ("grid_id", "profile_id", "scenario_id")):
        raise ValueError("The experiment reference differs from its retained native selection.")
    return reference


def _row(case, reference):
    selected = reference["selection"]
    source_selection = case["selection"]
    for name in ("grid_id", "invest_version"):
        if source_selection.get(name) != selected[name]:
            raise ValueError("An experiment case differs from its retained native grid or model version.")
    for name in ("profile_id", "scenario_id"):
        if source_selection.get(name) != case[name]:
            raise ValueError("An experiment case differs from its generated profile or scenario.")
    # Older saved planners omitted partial models from generated run IDs.
    # The retained reference run preserves the actual requested native stages.
    models = _models(source_selection.get("models"), selected.get("models"))
    native = _native_selection(selected["grid_id"], case["profile_id"],
                               case["scenario_id"], models)
    run_id = digest(native)
    if case["kind"] in ("reference", "parameter"):
        if case["scenario_id"] != selected["scenario_id"]:
            raise ValueError("A parameter case must retain the reference land cover.")
        baseline_id = reference["id"]
    elif case["kind"] == "landcover":
        baseline_id = digest(_native_selection(
            selected["grid_id"], case["profile_id"], selected["scenario_id"], models))
    else:
        raise ValueError("Select a reference, parameter, or land-cover experiment case.")
    pairing = {"case_id": case["id"], "kind": case["kind"],
               "run_id": run_id, "baseline_run_id": baseline_id}
    source_run_id = case.get("source_run_id", case["run_id"])
    source_baseline_id = case.get("source_baseline_run_id", case["baseline_run_id"])
    if run_id != source_run_id:
        pairing["source_run_id"] = source_run_id
    if baseline_id != source_baseline_id:
        pairing["source_baseline_run_id"] = source_baseline_id
    row = {
        "key": case["id"],
        "title": case["profile_title"] + " / " + case["scenario_title"],
        "profile_id": case["profile_id"], "scenario_id": case["scenario_id"],
        "reason": "Prepared " + case["kind"] + " case from the saved experiment.",
        "experiment_key": case["id"],
        "changes": {
            "parameters": case["changes"],
            "pairing": pairing,
        },
    }
    if "models" in native:
        row["models"] = native["models"]
    return row


def preview(workspace, experiment_id, offset=0, limit=100):
    key = identifier(experiment_id)
    if type(offset) is not int or offset < 0 or type(limit) is not int or limit <= 0:
        raise ValueError("Choose a nonnegative case offset and a positive page size.")
    engine = _engine()
    plan = engine._plan(workspace, key)
    reference = _reference(workspace, plan)
    cases = engine.inspect(workspace, key, offset=offset, limit=limit)["cases"]
    next_offset = offset + len(cases)
    rows = [_row(case, reference) for case in cases]
    return {
        "schema": "upstate.experiment-programme-preview/v1",
        "experiment_id": key, "title": plan["selection"]["title"],
        "grid_id": plan["baseline"]["grid_id"],
        "reference_run_id": plan["baseline"]["run_id"],
        "counts": plan["counts"], "offset": offset, "limit": limit,
        "next_offset": next_offset if next_offset < plan["counts"]["cases"] else None,
        "cases": [{**row, "native_run_id": row["changes"]["pairing"]["run_id"],
                   "kind": row["changes"]["pairing"]["kind"]} for row in rows],
        "comparison_basis": {
            "programme": "The saved original reference run is the programme comparison baseline.",
            "experiment": "Each case retains its original paired baseline native run for scientific attribution.",
        },
    }


def create(workspace, experiment_id):
    key = identifier(experiment_id)
    engine = _engine()
    manager = ComputeProgrammes(workspace)
    directory = workspace.root / "experiments" / key
    with held(directory / ".experiment.lock", blocking=False):
        plan = engine._plan(workspace, key)
        reference = _reference(workspace, plan)
        rows, native_runs, profiles = [], {}, set()
        reference_key = None
        for case, option in engine._case_definitions(workspace, plan):
            if option["id"] not in profiles:
                if option["derived"]:
                    saved = workspace.save_profile(option["profile"])
                else:
                    saved = workspace._get("profiles", option["id"])
                if saved["id"] != option["id"]:
                    raise ValueError("Materialized experiment profile differs from its original selection.")
                profiles.add(option["id"])
            row = _row(case, reference)
            rows.append(row)
            native_runs[row["key"]] = row["changes"]["pairing"]["run_id"]
            if case["kind"] == "reference" and native_runs[row["key"]] == reference["id"]:
                if reference_key is not None:
                    raise ValueError("The experiment expanded more than one original reference case.")
                reference_key = row["key"]
        if not reference_key or len(rows) != plan["counts"]["cases"]:
            raise ValueError("The saved experiment's expanded case count or reference differs.")
        prepared_ids = set(native_runs.values())
        if any(row["changes"]["pairing"]["baseline_run_id"] not in prepared_ids for row in rows):
            raise ValueError("The experiment must retain each case's matching native baseline.")
        selection = {
            "schema": SELECTION_SCHEMA, "title": plan["selection"]["title"],
            "description": "Native programme from retained experiment " + key,
            "grid_id": plan["baseline"]["grid_id"], "baseline_run": reference_key,
            "runs": rows, "source_reference": "upstate.experiment:" + key,
        }
        proposed = manager.preview(selection)
        if any(row["run_id"] != native_runs[row["key"]] for row in proposed["runs"]):
            raise ValueError("Prepared programme selections differ from the canonical native case bindings.")
        result = manager.create(proposed["selection"])
        return {**result, "experiment_id": key,
                "experiment_pairing": "selection.runs[].changes.pairing"}



def sync_completed(workspace, programme):
    """Retain experiment metrics for native runs completed by its programme."""
    if programme.get("state") != "complete":
        return None
    source = programme.get("selection", {}).get("source_reference", "")
    prefix = "upstate.experiment:"
    if not isinstance(source, str) or not source.startswith(prefix):
        return None
    key = identifier(source[len(prefix):])
    engine = _engine()
    plan = engine._plan(workspace, key)
    reference = _reference(workspace, plan)
    completed = {row["run_id"] for row in programme["runs"]
                 if row.get("native_state", row.get("state")) == "complete"}
    required = set()
    count = 0
    for case, _ in engine._case_definitions(workspace, plan):
        row = _row(case, reference)
        pairing = row["changes"]["pairing"]
        if (case["run_id"] != pairing["run_id"]
                or case["baseline_run_id"] != pairing["baseline_run_id"]):
            raise ValueError("The experiment planner must retain the selected native models before result synchronization.")
        required.update((pairing["run_id"], pairing["baseline_run_id"]))
        count += 1
    if count != plan["counts"]["cases"] or not required.issubset(completed):
        raise ValueError("The completed programme must contain every selected experiment run and its paired baseline.")
    for run_id in required:
        if workspace.inspect_run(run_id)["state"] != "complete":
            raise ValueError("Complete the selected native run before synchronizing experiment results: " + run_id)
    # The executor takes its own experiment/native locks, reuses these completed
    # runs, and computes the planner's actual paired metrics and saved summary.
    # completed_only also prevents native execution if a run changes meanwhile.
    result = engine.execute(workspace, key, completed_only=True)
    return {"experiment_id": key, "state": result["state"],
            "progress": result["progress"], "updated_at": result.get("updated_at"),
            "completed_at": result.get("completed_at")}
