"""Materialize a saved experiment into the existing native programme operator.

The experiment planner owns parameter expansion and its paired baselines.
This adapter retains those exact generated selections for programme execution.
"""
from __future__ import annotations

from pathlib import Path

from .common import digest, identifier, selected_models
from .compute_programme import ComputeProgrammes, SELECTION_SCHEMA


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
    if selected_models(selected) != selected_models(plan["baseline"]):
        raise ValueError("The experiment reference differs from its retained selected native models.")
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
    models = selected_models(source_selection)
    if models != selected_models(selected):
        raise ValueError("An experiment case must retain the reference native model families.")
    native = dict(source_selection)
    run_id = digest(native)
    if run_id != case["run_id"]:
        raise ValueError("The materialized experiment run differs from its retained native selection.")
    if case["kind"] in ("reference", "parameter"):
        if case["scenario_id"] != selected["scenario_id"]:
            raise ValueError("A parameter case must retain the reference land cover.")
        baseline_id = reference["id"]
    elif case["kind"] == "landcover":
        baseline_id = digest({**native, "scenario_id": selected["scenario_id"]})
    else:
        raise ValueError("Select a reference, parameter, or land-cover experiment case.")
    if baseline_id != case["baseline_run_id"]:
        raise ValueError("The experiment case differs from its original matched baseline.")
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
    cases = engine.expanded_cases(workspace, key, offset=offset, limit=limit)["cases"]
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
    """Materialize the shared experiment iterator and prepare its native programme."""
    key = identifier(experiment_id)
    engine = _engine()
    manager = ComputeProgrammes(workspace)
    plan = engine._plan(workspace, key)
    reference = _reference(workspace, plan)
    rows, native_runs = [], {}
    reference_key = None
    # The shared iterator takes the experiment lock around each retained case.
    # Do not hold it across this loop or while the programme takes its own lock.
    for case in engine.materialize_cases(workspace, key):
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



def experiment_origin(workspace, programme):
    """Resolve the saved experiment behind a programme or its pair continuation."""
    source = programme.get("selection", {}).get("source_reference", "")
    prefix = "upstate.experiment:"
    completion_prefix = "upstate.programme-pair-completion:"
    source_programme_id = programme.get("programme_id", programme.get("id"))
    if isinstance(source, str) and source.startswith(completion_prefix):
        manager = ComputeProgrammes(workspace)
        seen = set()
        while source.startswith(completion_prefix):
            cursor = identifier(source_programme_id)
            if cursor in seen:
                raise ValueError("The matched-pair programme origin contains a cycle.")
            seen.add(cursor)
            record = manager._load(cursor)
            if record["selection"].get("source_reference") != source:
                raise ValueError("The completed programme differs from its retained pair-completion origin.")
            origin = manager._pair_completion_origin(cursor, record)
            if origin is None:
                raise ValueError("Retain the original matched-pair continuation before synchronizing its experiment.")
            parent = manager._load(origin["parent_programme_id"])
            source_programme_id = parent["id"]
            source = parent["selection"].get("source_reference", "")
            if not isinstance(source, str):
                return None
    if not isinstance(source, str) or not source.startswith(prefix):
        return None
    return {"experiment_id": identifier(source[len(prefix):]),
            "source_programme_id": source_programme_id}


def sync_completed(workspace, programme):
    """Retain experiment metrics for native runs completed by its programme."""
    if programme.get("state") != "complete":
        return None
    origin = experiment_origin(workspace, programme)
    if origin is None:
        return None
    key = origin["experiment_id"]
    source_programme_id = origin["source_programme_id"]
    engine = _engine()
    plan = engine._plan(workspace, key)
    reference = _reference(workspace, plan)
    # Keep one lookup for completed native IDs and their verification status.
    # Shared paired baselines need only one retained-run read.
    completed = {row["run_id"]: False for row in programme["runs"]
                 if row.get("native_state", row.get("state")) == "complete"}
    total = plan["counts"]["cases"]
    count = offset = 0
    while offset < total:
        page = engine.expanded_cases(workspace, key, offset=offset, limit=500)
        cases = page["cases"]
        if not cases:
            raise ValueError("The saved experiment case page ended before its retained case count.")
        for case in cases:
            row = _row(case, reference)
            pairing = row["changes"]["pairing"]
            for run_id in (pairing["run_id"], pairing["baseline_run_id"]):
                if run_id not in completed:
                    raise ValueError("The completed programme must contain every selected experiment run and its paired baseline.")
                if not completed[run_id]:
                    if workspace.inspect_run(run_id)["state"] != "complete":
                        raise ValueError("Complete the selected native run before synchronizing experiment results: " + run_id)
                    completed[run_id] = True
            count += 1
        offset += len(cases)
    if count != total:
        raise ValueError("The completed programme differs from the retained experiment case count.")
    # Programme execute/resume has released its native locks before this call.
    # The experiment executor retains the actual matched metrics and summary;
    # completed_only prevents native calculation if a run changes meanwhile.
    result = engine.execute(workspace, key, completed_only=True)
    # Both the native programme and experiment summary locks are released.
    # An existing study keeps its original source/spatial context when reopened.
    from .study_report import refresh_existing
    refresh_existing(workspace, key)
    return {"experiment_id": key, "state": result["state"],
            "source_programme_id": source_programme_id,
            "completed_programme_id": programme.get("programme_id", programme.get("id")),
            "progress": result["progress"], "updated_at": result.get("updated_at"),
            "completed_at": result.get("completed_at")}
