"""Pair portfolio evaluations with their original baseline definition.

This module selects and resumes original native runs. It performs no raster
calculation and never changes a retained run's declared or observed identity.
"""
from __future__ import annotations

from copy import deepcopy
from .common import INVEST_VERSION, digest, identifier, read_json
from .model_selection import normalize_selection, run_models, validate_completed_run
from .native_versions import POLICY, native_version, model_versions, comparison_versions

SCHEMA = "upstate.portfolio-pairing/v1"


def _summary(run):
    return {"id": run["id"], "state": run.get("state"),
            "selection": deepcopy(run["selection"]), "models": list(run_models(run)),
            "native_version": native_version(run), "model_versions": model_versions(run)}


def context(workspace, record, run):
    if run.get("state") != "complete":
        raise ValueError("Complete the selected portfolio evaluation before continuing.")
    validate_completed_run(run)
    scenario = workspace._get("scenarios", run["selection"]["scenario_id"])
    if scenario.get("portfolio_id") != record["id"]:
        raise ValueError("The selected native evaluation belongs to another portfolio.")
    if run["selection"]["grid_id"] != record["context"]["grid_id"]:
        raise ValueError("The portfolio evaluation must retain its original reporting/model grid.")
    original = workspace.inspect_run(record["context"]["baseline_run_id"])
    definition = workspace._get("scenarios", original["selection"]["scenario_id"])
    if definition.get("kind") != "baseline":
        raise ValueError("The portfolio's retained ranking baseline needs its original baseline scenario.")
    if original["selection"]["grid_id"] != run["selection"]["grid_id"]:
        raise ValueError("The ranking baseline and evaluation use different original model grids.")
    comparison_versions([run], run_models(run))
    return original


def reasons(original, run, baseline, *, complete=True):
    result = []
    if baseline["selection"].get("scenario_id") != original["selection"]["scenario_id"]:
        result.append("Different original baseline scenario")
    for key, title in (("grid_id", "reporting/model grid"), ("profile_id", "parameter profile")):
        if baseline["selection"].get(key) != run["selection"].get(key):
            result.append("Different " + title)
    if run_models(baseline) != run_models(run):
        result.append("Different selected native models")
    target_versions = model_versions(run)
    candidate_versions = model_versions(baseline, run_models(run))
    for model, target in target_versions.items():
        value = candidate_versions[model]["comparison_version"]
        if not value:
            result.append("No executed or retained requested " + model.upper() + " version")
        elif value != target["comparison_version"]:
            result.append("Different " + model.upper() + " engine: " + str(value) +
                          " versus evaluation " + str(target["comparison_version"]))
    if complete and baseline.get("state") != "complete":
        result.append("Native baseline is " + str(baseline.get("state") or "unavailable"))
    if baseline.get("state") == "complete":
        try:
            validate_completed_run(baseline)
        except ValueError as error:
            result.append(str(error))
    return result


def require_pair(original, run, baseline):
    issues = reasons(original, run, baseline)
    if issues:
        raise ValueError("Choose the matching portfolio baseline: " + "; ".join(issues))
    return baseline


def prepared_selection(original, run):
    value = {"schema": "upstate.run-selection/v1",
             "grid_id": run["selection"]["grid_id"],
             "profile_id": run["selection"]["profile_id"],
             "scenario_id": original["selection"]["scenario_id"],
             "invest_version": INVEST_VERSION, "models": list(run_models(run))}
    return normalize_selection(value)[0]


def inspect(workspace, record, run):
    original = context(workspace, record, run)
    selection = prepared_selection(original, run)
    prepared_id = digest(selection)
    candidates = []
    invalid = []
    prepared_run = None
    for path in sorted((workspace.root / "runs").glob("*/run.json")):
        try:
            raw = read_json(path)
            selected = raw.get("selection") or {}
            if (selected.get("grid_id") != run["selection"]["grid_id"]
                    or selected.get("scenario_id") != original["selection"]["scenario_id"]):
                continue
            candidate = workspace.inspect_run(identifier(path.parent.name))
            if candidate["id"] == prepared_id:
                prepared_run = candidate
            item = _summary(candidate)
            item["reasons"] = reasons(original, run, candidate)
            item["eligible"] = not item["reasons"]
            candidates.append(item)
        except (ValueError, KeyError) as error:
            invalid.append({"run_id": path.parent.name, "reason": str(error)})
    candidates.sort(key=lambda row: (not row["eligible"], row["id"] != prepared_id,
                                    row["id"] != original["id"], row["id"]))
    eligible = [row for row in candidates if row["eligible"]]
    current = next((row for row in candidates if row["id"] == prepared_id), None)
    execution_issues = []
    target_versions = model_versions(run)
    stages = (prepared_run or {}).get("stages") or {}
    unfinished = [name for name in run_models(run) if name not in stages]
    runtime_preflight = None
    if current and current["state"] == "complete":
        if not current["eligible"]:
            execution_issues.append("The retained completed baseline is incompatible; preserve it and select a compatible original.")
        unfinished = []
    elif unfinished:
        # Match the original runner's actual loading/source checks, without
        # preparing files or executing models. Requested identity stays separate.
        try:
            from .native import runtime
            _, runtime_preflight = runtime(unfinished)
        except Exception as error:
            execution_issues.append("The original native runtime cannot execute the unfinished baseline models: " + str(error))
    retained_versions = model_versions(prepared_run, run_models(run)) if prepared_run else {}
    for model, version in target_versions.items():
        if model in stages:
            observed = retained_versions[model]["comparison_version"]
            if observed != version["comparison_version"]:
                execution_issues.append("The retained " + model.upper() +
                                        " baseline stage records a different executed engine.")
        elif runtime_preflight:
            observed = runtime_preflight.get("version")
            if observed != version["comparison_version"]:
                execution_issues.append("The original runtime would execute " + model.upper() + " with " +
                                        str(observed) + "; the evaluation used " +
                                        str(version["comparison_version"]) + ".")
    return {"schema": SCHEMA, "portfolio_id": record["id"],
            "ranking_baseline": _summary(original), "evaluation": _summary(run),
            "baseline_scenario_id": original["selection"]["scenario_id"],
            "candidates": candidates, "excluded_records": invalid,
            "selected_baseline_run_id": eligible[0]["id"] if eligible else None,
            "ready": bool(eligible), "prepared_baseline_run_id": prepared_id,
            "prepared_selection": selection,
            "can_complete": not execution_issues, "execution_issues": execution_issues,
            "version_policy": POLICY, "runtime_preflight": runtime_preflight,
            "unfinished_models": unfinished}


def resolve(workspace, record, run, *, baseline_run_id=None, execute=True):
    """Use an actual compatible retained baseline, or its original native runner."""
    if not isinstance(execute, bool):
        raise ValueError("Choose whether to execute the matching baseline.")
    original = context(workspace, record, run)
    state = inspect(workspace, record, run)
    selected = identifier(baseline_run_id) if baseline_run_id else state["selected_baseline_run_id"]
    if selected:
        baseline = workspace.inspect_run(selected)
        if baseline.get("state") == "complete":
            return require_pair(original, run, baseline)
        if selected != state["prepared_baseline_run_id"]:
            raise ValueError("Use the actual completed baseline or this application's original paired definition.")
    else:
        selected = state["prepared_baseline_run_id"]
        try:
            baseline = workspace.inspect_run(selected)
        except FileNotFoundError:
            baseline = None
    if not state["can_complete"]:
        raise ValueError(" ".join(state["execution_issues"]))
    if baseline is None:
        baseline = workspace.prepare_run(state["prepared_selection"])
        if (baseline["id"] != state["prepared_baseline_run_id"]
                or baseline["selection"] != state["prepared_selection"]):
            raise ValueError("The prepared baseline differs from the original paired selection.")
    if baseline.get("state") == "complete":
        return require_pair(original, run, baseline)
    if not execute:
        raise ValueError("Matching baseline " + baseline["id"] + " is " +
                         str(baseline.get("state")) +
                         ". Complete its original native run or enable matching-baseline completion.")
    workspace.run(baseline["id"])
    return require_pair(original, run, workspace.inspect_run(baseline["id"]))


def binding(original, run, baseline):
    """Persist the actual three run identities alongside every retained result."""
    return {"schema": "upstate.portfolio-native-pair/v1",
            "ranking_baseline": _summary(original),
            "baseline": _summary(baseline), "evaluation": _summary(run),
            "version_policy": POLICY,
            "comparison_versions": comparison_versions([baseline, run], run_models(run))["versions"]}
