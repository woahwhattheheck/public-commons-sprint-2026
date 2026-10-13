"""Continue exact saved ensemble runs as parameter studies within each scenario.

The original ensemble remains the land-cover contrast. This continuation holds
each original scenario fixed and compares its original parameter profiles.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import argparse
import json

from .common import (atomic_json, canonical, describe_file, digest, held,
                     identifier, now, read_json, verify_file)
from .model_selection import run_models
from . import parameter_studies as studies
from . import parameter_report_source as reports

SCHEMA = "upstate.ensemble-parameter-studies/v1"
DIRECTORY = "ensemble-parameter-studies"
METHOD = (
    "Each study holds one original land-cover scenario and the original grid, "
    "forcing and coefficient source fixed. Its parameter changes are case minus "
    "the original reference profile on that pair's valid cells. The original "
    "ensemble retains land-cover effects; these are distinct scientific questions."
)


def _option(value, name, default):
    result = value.get(name, default)
    if type(result) is not bool:
        raise ValueError(name + " must be true or false")
    return result


def _axis(axis):
    refs = [value if isinstance(value, str) else canonical(value)
            for value in axis["references"]]
    return {"name": axis["id"], "parameters": list(axis["targets"]),
            "values": deepcopy(axis["values"]), "reason": axis["reason"],
            "references": refs}


def _plan(workspace, key):
    key = identifier(key)
    plan = workspace._get("ensembles", key)
    path = workspace.root / "ensembles" / (key + ".json")
    descriptor = describe_file(workspace.root, path)
    original = read_json(verify_file(workspace.root, descriptor))
    if {**original, "id": key} != plan:
        raise ValueError("The saved ensemble changed during its original source capture")
    return plan, descriptor


def _designs(workspace, value):
    if not isinstance(value, dict):
        raise ValueError("Choose an original ensemble for parameter continuation")
    allowed = {"ensemble_id", "title", "purpose", "reporting_areas",
               "difference_maps", "render_reports", "scenario_ids"}
    if set(value) - allowed:
        raise ValueError("Unknown ensemble continuation fields: " + ", ".join(sorted(set(value) - allowed)))
    plan, descriptor = _plan(workspace, value.get("ensemble_id"))
    if not plan.get("axes"):
        raise ValueError("This continuation needs the ensemble's original explicit parameter axes")
    design = {"factorial": "factorial", "one_at_a_time": "one-at-a-time"}.get(plan["design"])
    if design is None:
        raise ValueError("Retain the original factorial or one-at-a-time design")
    available = list(plan.get("scenario_ids") or
                     [plan["baseline_scenario_id"], *plan["alternative_scenario_ids"]])
    scenario_ids = value.get("scenario_ids", available)
    if (not isinstance(scenario_ids, list) or not scenario_ids
            or len(set(scenario_ids)) != len(scenario_ids)
            or any(item not in available for item in scenario_ids)):
        raise ValueError("Choose distinct scenarios from the saved original ensemble")
    scenario_ids = [key for key in available if key in scenario_ids]
    title = str(value.get("title") or plan["title"]).strip()
    purpose = str(value.get("purpose") or METHOD).strip()
    if not title or not purpose:
        raise ValueError("Name the parameter continuation and its question")
    areas = deepcopy(value.get("reporting_areas", []))
    maps = _option(value, "difference_maps", False)
    render = _option(value, "render_reports", True)
    axes = [_axis(axis) for axis in plan["axes"]]
    designs, used_runs, pending = [], set(), []
    for base_id in plan["base_profile_ids"]:
        members = [member for member in plan["members"] if member["parent_profile_id"] == base_id]
        if not members:
            continue
        base_members = [member for member in members if member["profile_id"] == base_id]
        if len(base_members) != 1:
            raise ValueError("The retained parameter group needs its exact original reference profile")
        reference_member = base_members[0]
        profiles = {member["profile_id"]: workspace._get("profiles", member["profile_id"])
                    for member in members}
        for scenario_id in scenario_ids:
            scenario = workspace._get("scenarios", scenario_id)
            baseline_choices = [run for run in reference_member["runs"]
                                if run["scenario_id"] == scenario_id]
            if len(baseline_choices) != 1:
                raise ValueError("The source member needs exactly one run for each original scenario")
            baseline = workspace.inspect_run(baseline_choices[0]["run_id"])
            active = run_models(baseline)
            selection = {
                "schema": studies.SELECTION_SCHEMA,
                "title": title + " | " + scenario["title"] + " | " + profiles[base_id]["title"],
                "purpose": purpose, "baseline_run_id": baseline["id"],
                "design": design, "axes": axes, "reporting_areas": areas,
                "difference_maps": maps}
            selection, _, profile = studies._selection(workspace, selection)
            definitions = [{"id": "baseline", "overrides": {}, "axis_values": []},
                           *list(studies._cases(selection, profile))]
            if len(definitions) < 2 or len({case["id"] for case in definitions}) != len(definitions):
                raise ValueError("The retained axes need distinct original parameter cases")
            by_signature = {}
            for member in members:
                signature = studies._profile_signature(profiles[member["profile_id"]], models=active)
                by_signature.setdefault(signature, []).append(member)
            case_runs, bindings = {}, []
            matched = set()
            for definition in definitions:
                changed = studies._apply(profile, definition["overrides"], models=active)
                signature = studies._profile_signature(changed, models=active)
                matches = by_signature.get(signature, [])
                if len(matches) != 1:
                    raise ValueError("The original ensemble does not contain exactly one matching profile "
                                     "for every parameter case; keep its original ensemble report")
                member = matches[0]
                if member["id"] in matched:
                    raise ValueError("Two parameter cases select the same original ensemble member")
                matched.add(member["id"])
                choices = [run for run in member["runs"] if run["scenario_id"] == scenario_id]
                if len(choices) != 1:
                    raise ValueError("The original member repeats or lacks the selected scenario")
                native = workspace.inspect_run(choices[0]["run_id"])
                if (native["selection"]["grid_id"] != plan["grid_id"]
                        or native["selection"]["scenario_id"] != scenario_id
                        or native["selection"]["profile_id"] != member["profile_id"]
                        or run_models(native) != active):
                    raise ValueError("The native selection differs from its original ensemble member")
                used_runs.add(native["id"])
                if native["state"] != "complete":
                    pending.append({"run_id": native["id"], "state": native["state"],
                                    "member_id": member["id"], "scenario_id": scenario_id})
                case_runs[definition["id"]] = native["id"]
                bindings.append({"case_id": definition["id"], "member_id": member["id"],
                                 "profile_id": member["profile_id"], "run_id": native["id"],
                                 "run_selection": deepcopy(native["selection"]),
                                 "assignments": deepcopy(member["assignments"])})
            if matched != {member["id"] for member in members}:
                raise ValueError("The original parameter group contains cases outside its saved axis design")
            provenance = {"identity": {
                "schema": "upstate.ensemble-parameter-origin/v1",
                "ensemble_id": plan["id"], "ensemble_plan": descriptor,
                "base_profile_id": base_id, "scenario_id": scenario_id,
                "source_axes": deepcopy(plan["axes"]), "source_design": plan["design"],
                "source_reason": plan["reason"], "members": bindings,
                "interpretation": METHOD},
                "files": [descriptor]}
            designs.append({"key": digest({"base_profile_id": base_id, "scenario_id": scenario_id}),
                            "base_profile_id": base_id, "scenario_id": scenario_id,
                            "scenario_title": scenario["title"], "selection": selection,
                            "case_runs": case_runs, "provenance": provenance})
    if not designs:
        raise ValueError("The original ensemble has no coherent retained parameter groups")
    normalized = {"ensemble_id": plan["id"], "title": title, "purpose": purpose,
                  "scenario_ids": scenario_ids, "reporting_areas": areas,
                  "difference_maps": maps, "render_reports": render}
    identity = {"schema": SCHEMA, "workspace_id": workspace.project["id"],
                "selection": normalized, "ensemble_plan": descriptor,
                "designs": designs}
    return identity, {"study_count": len(designs), "native_runs": len(used_runs),
                      "complete_native_runs": len(used_runs) - len({row["run_id"] for row in pending}),
                      "pending": pending}


def preview(workspace, value):
    identity, counts = _designs(workspace, value)
    return {"id": digest(identity), "workspace_id": workspace.project["id"],
            "ensemble_id": identity["selection"]["ensemble_id"],
            "selection": identity["selection"], "counts": counts,
            "ready": not counts["pending"], "method": METHOD,
            "studies": [{"key": row["key"], "title": row["selection"]["title"],
                         "scenario_id": row["scenario_id"], "scenario_title": row["scenario_title"],
                         "base_profile_id": row["base_profile_id"], "cases": len(row["case_runs"]),
                         "native_run_ids": list(row["case_runs"].values())}
                        for row in identity["designs"]]}


def get(workspace, operation_id):
    key = identifier(operation_id)
    directory = workspace.root / DIRECTORY / key
    state = read_json(directory / "operation.json")
    if (state.get("schema") != SCHEMA or state.get("id") != key
            or state.get("workspace_id") != workspace.project["id"]
            or digest(state["identity"]) != key
            or state.get("selection") != state["identity"]["selection"]
            or state.get("ensemble_id") != state["identity"]["selection"]["ensemble_id"]):
        raise ValueError("The saved continuation belongs to another original ensemble selection")
    verify_file(workspace.root, state["identity"]["ensemble_plan"])
    designs = {row["key"]: row for row in state["identity"]["designs"]}
    rows, seen = [], set()
    for row in state.get("studies", []):
        design = designs.get(row.get("key"))
        if design is None or row["key"] in seen:
            raise ValueError("The saved continuation repeats or substitutes an original scenario group")
        seen.add(row["key"])
        current = studies.inspect(workspace, row["experiment_id"])
        selection = current["selection"]
        if (selection.get("retained_source") != design["provenance"]
                or any(selection.get(name) != value for name, value in design["selection"].items())
                or {case["id"]: case["run_id"] for case in current["cases"]} != design["case_runs"]
                or any(row.get(name) != design[name] for name in ("scenario_id", "base_profile_id"))):
            raise ValueError("The retained study changed its original ensemble lineage")
        source = reports.get(workspace, row["source_operation_id"]) if row.get("source_operation_id") else None
        if source is not None and source["experiment_id"] != current["id"]:
            raise ValueError("The saved report source belongs to another original parameter study")
        rows.append({**row, "state": current["state"], "progress": current["progress"],
                     "source": source})
    if state.get("state") == "complete" and seen != set(designs):
        raise ValueError("The completed continuation omits an original scenario study")
    return {**state, "studies": rows}


def latest(workspace, ensemble_id):
    key = identifier(ensemble_id)
    path = workspace.root / "ensemble_results" / key / "latest-parameter-studies.json"
    if not path.exists():
        return None
    pointer = read_json(path)
    if pointer.get("ensemble_id") != key:
        raise ValueError("The saved continuation pointer names another original ensemble")
    value = get(workspace, pointer["operation_id"])
    if value["ensemble_id"] != key:
        raise ValueError("The saved continuation belongs to another original ensemble")
    return value


def continue_studies(workspace, value):
    identity, counts = _designs(workspace, value)
    if counts["pending"]:
        raise ValueError("Complete the named original ensemble runs before aggregating parameter studies: " +
                         ", ".join(row["run_id"] for row in counts["pending"]))
    key = digest(identity)
    directory = workspace.root / DIRECTORY / key
    with held(workspace.root / ".workspace.lock", blocking=False):
        directory.mkdir(parents=True, exist_ok=True)
        atomic_json(directory / "selection.json", identity, immutable=True)
    path = directory / "operation.json"
    with held(directory / ".bridge.lock", blocking=False):
        state = read_json(path) if path.exists() else {
            "schema": SCHEMA, "id": key, "identity": identity,
            "workspace_id": workspace.project["id"], "ensemble_id": identity["selection"]["ensemble_id"],
            "selection": identity["selection"], "created_at": now(), "state": "preparing", "studies": []}
        if state["identity"] != identity:
            raise ValueError("Retain the original ensemble continuation selection")
        state.update(state="preparing", updated_at=now())
        atomic_json(path, state)
        # Publish the pointer before derived work so the original preview can
        # reopen completed studies even if a later summary/report is interrupted.
        atomic_json(workspace.root / "ensemble_results" / state["ensemble_id"] /
                    "latest-parameter-studies.json", {"operation_id": key, "ensemble_id": state["ensemble_id"]})
        try:
            by_key = {row["key"]: row for row in state["studies"]}
            for design in identity["designs"]:
                state.update(active_study=design["key"], updated_at=now())
                atomic_json(path, state)
                retained = studies.prepare_retained(workspace, design["selection"], design["case_runs"],
                                                    provenance=design["provenance"])
                row = by_key.get(design["key"])
                if row is None:
                    row = {"key": design["key"], "experiment_id": retained["id"],
                           "scenario_id": design["scenario_id"], "scenario_title": design["scenario_title"],
                           "base_profile_id": design["base_profile_id"], "title": design["selection"]["title"]}
                    state["studies"].append(row)
                    by_key[row["key"]] = row
                    atomic_json(path, state)
                elif row["experiment_id"] != retained["id"]:
                    raise ValueError("The saved bridge changed its original Parameter study")
                # Reopen a complete original result edition without repeating its
                # raster aggregation. An interrupted summary resumes natively.
                if not retained.get("artifacts", {}).get("results"):
                    studies.summarize(workspace, retained["id"])
                else:
                    verify_file(workspace.root / "experiments" / retained["id"],
                                retained["artifacts"]["results"])
                if identity["selection"]["render_reports"]:
                    if row.get("source_operation_id"):
                        prepared = reports.get(workspace, row["source_operation_id"])
                    else:
                        choices = reports.catalog(workspace, retained["id"])
                        prepared = reports.prepare(workspace, {
                            "experiment_id": retained["id"], "title": row["title"],
                            "expected_artifact_sha256": choices["artifact_sha256"]}, render=True)
                        row["source_operation_id"] = prepared["id"]
                row["updated_at"] = now()
                atomic_json(path, state)
            state.update(state="complete", active_study=None, updated_at=now())
            state.setdefault("completed_at", now())
            state.pop("error", None)
            state["files"] = {"selection": describe_file(workspace.root, directory / "selection.json")}
            atomic_json(path, state)
            atomic_json(workspace.root / "ensemble_results" / state["ensemble_id"] /
                        "latest-parameter-studies.json", {"operation_id": key, "ensemble_id": state["ensemble_id"]})
            return get(workspace, key)
        except BaseException as error:
            state.update(state="partial", error={"type": type(error).__name__, "message": str(error)},
                         updated_at=now())
            try:
                atomic_json(path, state)
            except OSError:
                pass
            raise


def main(argv=None):
    from .workspace import Workspace
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--ensemble-id", required=True)
    parser.add_argument("--title")
    parser.add_argument("--purpose")
    parser.add_argument("--selection", type=Path,
                        help="Optional original reporting areas and scenario selection JSON")
    parser.add_argument("--preview", action="store_true")
    parser.add_argument("--no-report", action="store_true")
    parser.add_argument("--difference-maps", action="store_true")
    args = parser.parse_args(argv)
    value = read_json(args.selection) if args.selection else {}
    value["ensemble_id"] = args.ensemble_id
    for name in ("title", "purpose"):
        if getattr(args, name):
            value[name] = getattr(args, name)
    if args.no_report:
        value["render_reports"] = False
    if args.difference_maps:
        value["difference_maps"] = True
    ws = Workspace(args.workspace)
    result = preview(ws, value) if args.preview else continue_studies(ws, value)
    print(json.dumps(result, sort_keys=True, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
