"""Expose the original experiment cases to the shared compute programme.

Copyright TokenJunkieLabs. Preparation uses the original profile/run identities.
The ES-EXP engine continues to own execution, paired metrics and final summaries.
"""
from __future__ import annotations
import argparse
import copy
import itertools
import json
from pathlib import Path
import sys
from .common import atomic_json, describe_file, digest, held, identifier, now, read_json
from . import experiments

SCHEMA = "upstate.experiment-programme-materialization/v1"


def _match_run(run, case):
    if run["id"] != case["run_id"] or run["selection"] != case["selection"]:
        raise ValueError("Prepared native run differs from the original experiment case")


def _native_status(workspace, case, option):
    profile_path = workspace.root / "profiles" / (option["id"] + ".json")
    run_path = workspace.root / "runs" / case["run_id"] / "run.json"
    if profile_path.exists():
        profile = workspace._get("profiles", option["id"])
        if profile["id"] != case["profile_id"]:
            raise ValueError("Retained profile differs from the original experiment case")
    result = {
        "profile_materialized": profile_path.exists(),
        "run_materialized": run_path.exists(),
        "native_state": "not_prepared",
    }
    if run_path.exists():
        run = workspace.inspect_run(case["run_id"])
        _match_run(run, case)
        result["native_state"] = run["state"]
        result["native_completed_at"] = run.get("completed_at")
        if run.get("error") and run["state"] != "complete":
            result["native_error"] = run["error"]
    return result



def _page_definitions(workspace, plan, offset, limit):
    # The current engine exposes indexed design helpers. Preserve compatibility
    # with the original retained engine while allowing deep pages to seek directly.
    helpers = ("_indexed_design", "_indexed_profile", "_case_definition")
    if not all(callable(getattr(experiments, name, None)) for name in helpers):
        yield from itertools.islice(
            experiments._case_definitions(workspace, plan), offset, offset + limit)
        return
    base = workspace._get("profiles", plan["baseline"]["profile_id"])
    layout = experiments._indexed_design(workspace, plan["selection"], base)
    scenario_ids = [plan["baseline"]["scenario_id"]] + plan["selection"]["scenario_ids"]
    scenario_count = len(scenario_ids)
    total = layout["count"] * scenario_count
    if total != plan["counts"]["cases"]:
        raise ValueError("The indexed design differs from the retained experiment case count")
    previous_profile_index, option = None, None
    scenarios = {}
    for ordinal in range(offset, min(total, offset + limit)):
        profile_index, scenario_index = divmod(ordinal, scenario_count)
        if profile_index != previous_profile_index:
            option = experiments._indexed_profile(layout, profile_index)
            previous_profile_index = profile_index
        scenario_id = scenario_ids[scenario_index]
        if scenario_id not in scenarios:
            scenarios[scenario_id] = workspace._get("scenarios", scenario_id)
        yield experiments._case_definition(
            plan, option, scenarios[scenario_id], ordinal), option


def expanded_cases(workspace, experiment_id, offset=0, limit=100):
    """Page original case definitions with live preparation/native status.

    This does not save profiles, prepare runs, or submit calculations. A native
    run ID in an unprepared case is the original engine's deterministic planned
    selection; run_materialized distinguishes it from a retained native run.
    """
    if type(offset) is not int or offset < 0 or type(limit) is not int or limit <= 0:
        raise ValueError("Use a nonnegative offset and a positive page size")
    experiment_id = identifier(experiment_id)
    plan = experiments._plan(workspace, experiment_id)
    directory = experiments._directory(workspace, experiment_id)
    rows = []
    for expected, option in _page_definitions(workspace, plan, offset, limit):
        case = copy.deepcopy(experiments._retained_case(directory, expected))
        case.update(_native_status(workspace, case, option))
        rows.append(case)
    next_offset = offset + len(rows)
    return {
        "schema": "upstate.expanded-experiment-cases/v1",
        "experiment_id": experiment_id, "workspace_id": workspace.project["id"],
        "baseline": plan["baseline"], "cases": rows,
        "offset": offset, "limit": limit, "total_cases": plan["counts"]["cases"],
        "next_offset": next_offset if next_offset < plan["counts"]["cases"] else None,
    }


def materialize_cases(workspace, experiment_id):
    """Save original derived profiles and prepare their native runs.

    The same experiment lock serializes this operation with ES-EXP execution.
    Native model calculation is left to the existing execution owner. Repeating
    this call reuses the original profiles/runs and completed case results.
    """
    experiment_id = identifier(experiment_id)
    plan = experiments._plan(workspace, experiment_id)
    directory = experiments._directory(workspace, experiment_id)
    path = directory / "programme-materialization.json"
    with held(directory / ".experiment.lock", blocking=False):
        previous = read_json(path) if path.exists() else None
        if previous and (previous.get("experiment_id") != experiment_id or
                         previous.get("workspace_id") != workspace.project["id"]):
            raise ValueError("Materialization belongs to another original experiment")
        state = {
            "schema": SCHEMA, "experiment_id": experiment_id,
            "workspace_id": workspace.project["id"], "state": "preparing",
            "created_at": previous["created_at"] if previous else now(),
            "updated_at": now(), "active_case_id": None,
            "counts": {"total": plan["counts"]["cases"], "prepared": 0,
                       "reused_runs": 0, "failed": 0},
            "errors": [], "files": {},
        }
        atomic_json(path, state)
        ready_profiles = set()
        active = None
        try:
            for case, option in experiments._case_definitions(workspace, plan):
                active = case
                state.update(active_case_id=case["id"], updated_at=now())
                atomic_json(path, state)
                try:
                    if option["id"] not in ready_profiles:
                        profile_path = workspace.root / "profiles" / (option["id"] + ".json")
                        if profile_path.exists():
                            profile = workspace._get("profiles", option["id"])
                        elif option["derived"]:
                            profile = workspace.save_profile(option["profile"])
                        else:
                            raise ValueError("The original selected profile is missing")
                        if profile["id"] != option["id"]:
                            raise ValueError("Derived profile differs from the original planned identity")
                        ready_profiles.add(profile["id"])
                    existed = (workspace.root / "runs" / case["run_id"] / "run.json").exists()
                    run = workspace.prepare_run(case["selection"])
                    _match_run(run, case)
                    receipt_path = directory / "prepared-cases" / (case["id"] + ".json")
                    identity = {
                        "schema": "upstate.prepared-experiment-case/v1",
                        "experiment_id": experiment_id, "case_id": case["id"],
                        "profile_id": case["profile_id"], "run_id": run["id"],
                        "baseline_run_id": case["baseline_run_id"],
                        "selection": run["selection"],
                    }
                    if receipt_path.exists():
                        prior = read_json(receipt_path)
                        if any(prior.get(key) != value for key, value in identity.items()):
                            raise ValueError("Prepared case receipt differs from the original selection")
                    else:
                        atomic_json(receipt_path, {
                            **identity, "prepared_at": now(),
                            "native_state_when_prepared": run["state"],
                        }, immutable=True)
                    state["counts"]["prepared"] += 1
                    state["counts"]["reused_runs"] += int(existed)
                except Exception as exc:
                    error = {
                        "case_id": case["id"], "run_id": case["run_id"],
                        "type": type(exc).__name__, "message": str(exc), "at": now(),
                    }
                    state["errors"].append(error)
                    state["counts"]["failed"] += 1
                    atomic_json(directory / "preparation-errors" / (digest(error) + ".json"),
                                error, immutable=True)
                state.update(active_case_id=None, updated_at=now())
                atomic_json(path, state)
                active = None
            state["state"] = "complete" if not state["counts"]["failed"] else (
                "partial" if state["counts"]["prepared"] else "failed")
            if state["state"] == "complete":
                state["completed_at"] = now()
            atomic_json(path, state)
            # Path is relative to the original experiment directory for its
            # existing download-ticket/export service.
            result = copy.deepcopy(state)
            result["files"]["materialization"] = describe_file(directory, path)
            return result
        except BaseException as exc:
            state.update(
                state="interrupted", active_case_id=active["id"] if active else None,
                updated_at=now(),
                error={"type": type(exc).__name__, "message": str(exc)},
            )
            atomic_json(path, state)
            raise


def main(argv=None):
    from .workspace import Workspace
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--experiment", required=True)
    commands = parser.add_subparsers(dest="command", required=True)
    page = commands.add_parser("expanded")
    page.add_argument("--offset", type=int, default=0)
    page.add_argument("--limit", type=int, default=100)
    commands.add_parser("materialize")
    args = parser.parse_args(argv)
    try:
        workspace = Workspace(args.workspace)
        result = (expanded_cases(workspace, args.experiment, args.offset, args.limit)
                  if args.command == "expanded" else materialize_cases(workspace, args.experiment))
        print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))
        return 0 if result.get("state") not in ("failed", "partial", "interrupted") else 1
    except (ValueError, OSError, RuntimeError, KeyError) as exc:
        print(json.dumps({"state": "failed", "type": type(exc).__name__, "message": str(exc)}),
              file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
