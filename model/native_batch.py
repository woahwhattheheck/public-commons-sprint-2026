"""Run one retained full source/grid/profile/scenario selection through Workspace.

The native engines and their existing stage recovery remain in model.native.
This entry point supplies the actual selection consumed by operator.receiving.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
from .common import (ROLES, SOURCE_IDS, atomic_bytes, atomic_json, canonical,
                     describe_file, digest, file_digest, held, now, read_json)
from .workspace import Workspace

PLAN_SCHEMA = "upstate.native-model-plan/v1"
PROGRESS_SCHEMA = "upstate.native-model-progress/v1"
HANDOFF_SCHEMA = "upstate.native-model-receiving/v1"
NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}\Z")

def load_receiving(path, workspace_override=None):
    original = Path(path).read_bytes()
    value = json.loads(original)
    if value.get("schema") != "upstate.native-model-receiving/v1":
        raise ValueError("Select the actual original native-model receiving result")
    for field in ("workspace_id", "source_collection_id", "grid_id", "profiles", "scenarios",
                  "runs", "comparison_id", "delivery_selection"):
        if field not in value:
            raise ValueError("The original native handoff lacks " + field)
    workspace = Workspace(workspace_override or value["workspace_path"])
    if workspace.project["id"] != value["workspace_id"]:
        raise ValueError("The original native workspace identity differs")
    overview = workspace.overview()
    workspace._get("sources", value["source_collection_id"])
    workspace.get_grid(value["grid_id"])
    for kind in ("profiles", "scenarios"):
        for key in value[kind].values():
            workspace._get(kind, key)
    if len(set(value["runs"].values())) < 2:
        raise ValueError("Complete the original baseline and at least one alternative")
    for key in value["runs"].values():
        run = workspace.inspect_run(key)
        if run["state"] != "complete" or run["selection"]["grid_id"] != value["grid_id"]:
            raise ValueError("The selected original model run is incomplete or uses another grid")
    if not any(x["id"] == value["comparison_id"] for x in overview["comparisons"]):
        raise ValueError("The original paired run comparison is absent")
    selected = value["delivery_selection"]
    if selected["baseline_run_id"] not in value["runs"].values():
        raise ValueError("The delivery baseline differs from the native handoff")
    if not selected["scenario_run_ids"] or any(x not in value["runs"].values() for x in selected["scenario_run_ids"]):
        raise ValueError("The delivery alternatives differ from the native handoff")
    return value, workspace, original


def _named(value, label):
    if not isinstance(value, dict) or not value:
        raise ValueError(label + " must be a nonempty named object")
    if any(not isinstance(k, str) or not NAME.fullmatch(k) for k in value):
        raise ValueError(label + " names must use letters, numbers, dots, underscores or hyphens")
    if any(not isinstance(v, dict) for v in value.values()):
        raise ValueError(label + " definitions must be objects")
    return value

def _source_choices(value, source_ids, collection=None):
    if isinstance(value, list):
        return [_source_choices(item, source_ids, collection) for item in value]
    if not isinstance(value, dict):
        return value
    result = {k: _source_choices(v, source_ids, collection) for k, v in value.items()}
    if "source_id" in result:
        if result["source_id"] not in source_ids:
            raise ValueError("Selection refers to an absent original source: " + str(result["source_id"]))
        if "source_collection_id" in result:
            raise ValueError("The native plan binds its one composed source edition; remove embedded collection IDs")
        if collection is not None:
            result["source_collection_id"] = collection
    return result

def _validate_plan(plan, manifest):
    if plan.get("schema") != PLAN_SCHEMA:
        raise ValueError("Select an original upstate.native-model-plan/v1 document")
    allowed = {"schema", "title", "source_manifest", "source_manifest_sha256", "grid",
               "profiles", "scenarios", "runs", "comparison", "delivery"}
    if set(plan) - allowed:
        raise ValueError("Unknown native plan fields: " + ", ".join(sorted(set(plan) - allowed)))
    if not isinstance(plan.get("title"), str) or not plan["title"].strip():
        raise ValueError("Name the scientific model selection")
    if manifest.get("schema") != "upstate.sources/v1":
        raise ValueError("Select the composed original source manifest")
    entries = manifest.get("entries", [])
    if not isinstance(entries, list) or not all(isinstance(e, dict) for e in entries):
        raise ValueError("Original source entries must be a list")
    ids = [e.get("id") for e in entries]
    if any(not isinstance(k, str) or not k for k in ids) or len(set(ids)) != len(ids):
        raise ValueError("The original source edition must have unique source IDs")
    source_ids = set(ids)
    by_id = {entry["id"]: entry for entry in entries}
    profiles = _named(plan.get("profiles"), "Profiles")
    scenarios = _named(plan.get("scenarios"), "Scenarios")
    runs = _named(plan.get("runs"), "Runs")
    for name, profile in profiles.items():
        if "source_collection_id" in profile:
            raise ValueError("Profile " + name + " must use the selected composed source edition")
        if profile.get("biophysical_source_id") not in source_ids:
            raise ValueError("Profile " + name + " needs its actual retained biophysical table")
    for name, scenario in scenarios.items():
        if "source_collection_id" in scenario:
            raise ValueError("Scenario " + name + " must use the selected composed source edition")
        for patch in scenario.get("patches", []):
            if patch.get("mask_source_id") not in source_ids:
                raise ValueError("Scenario " + name + " refers to an absent retained change mask")
    for name, selection in runs.items():
        if set(selection) != {"profile", "scenario"}:
            raise ValueError("Each named run selects exactly profile and scenario names")
        if selection["profile"] not in profiles or selection["scenario"] not in scenarios:
            raise ValueError("Run " + name + " refers to an absent profile or scenario")
    comparison = plan.get("comparison")
    if (not isinstance(comparison, list) or len(comparison) < 2
            or any(not isinstance(k, str) for k in comparison)
            or len(set(comparison)) != len(comparison) or any(k not in runs for k in comparison)):
        raise ValueError("Select one baseline followed by distinct actual alternative runs")
    grid = plan.get("grid")
    if not isinstance(grid, dict) or "source_collection_id" in grid:
        raise ValueError("Define the grid from the composed source edition")
    inputs = grid.get("input_sources", {})
    if (not isinstance(inputs, dict) or set(inputs) != set(ROLES)
            or any(not isinstance(k, str) or k not in source_ids for k in inputs.values())):
        raise ValueError("Bind all five physical model input roles to their actual retained source IDs")
    for key in ("reporting_area", "model_domain"):
        if not isinstance(grid.get(key), dict) or grid[key].get("source_id") not in source_ids:
            raise ValueError("Retain the actual " + key + " source selection")
    delivery = plan.get("delivery")
    if not isinstance(delivery, dict):
        raise ValueError("Supply the source-bound seven-map delivery selection")
    if "baseline_run_id" in delivery or "scenario_run_ids" in delivery:
        raise ValueError("The plan uses named runs; completed native IDs are filled from the original outcomes")
    base_name = delivery.get("baseline_run")
    future = delivery.get("scenario_runs")
    if (not isinstance(base_name, str) or base_name not in runs
            or not isinstance(future, list) or not future or any(not isinstance(k, str) for k in future)):
        raise ValueError("Select the named current and explicit future land-cover runs for delivery")
    if len(set([base_name] + future)) != 1 + len(future) or any(k not in runs for k in future):
        raise ValueError("Delivery run names must be distinct retained selections")
    base = runs[base_name]
    if scenarios[base["scenario"]].get("kind") != "baseline":
        raise ValueError("The delivery baseline must use the original land-cover edition")
    if comparison[0] != base_name or any(k not in comparison[1:] for k in future):
        raise ValueError("The retained comparison must include the delivery baseline and every future selection")
    for name in future:
        choice = runs[name]
        if choice["profile"] != base["profile"] or scenarios[choice["scenario"]].get("kind") != "landcover":
            raise ValueError("Future-service maps require explicit land-cover changes under the common baseline profile")
    roles = delivery.get("source_roles", {})
    if not isinstance(roles, dict) or set(SOURCE_IDS) - set(ROLES) - {"LS_FACTOR"} - set(roles):
        raise ValueError("Retain the original protected-land, parcel, NHD and NWI sources for delivery")
    overlays = delivery.get("overlays", {})
    if not isinstance(overlays, dict) or any(k not in overlays for k in ("drinking_water", "high_quality_waters")):
        raise ValueError("Retain actual drinking-water and high-quality-water overlay selections")
    contact = delivery.get("contact")
    if (not isinstance(contact, dict) or any(not isinstance(contact.get(k), str)
            or not contact[k].strip() for k in ("name", "organization", "email"))):
        raise ValueError("Retain the actual responsible name, organization and email before native execution")
    for group, choices in (("delivery source", roles), ("delivery overlay", overlays)):
        for name, choice in choices.items():
            if (not isinstance(choice, dict) or not isinstance(choice.get("source_id"), str)
                    or choice["source_id"] not in source_ids):
                raise ValueError(group + " " + name + " needs an actual retained source_id")
            if name == "LS_FACTOR":
                raise ValueError("The original SDR terrain calculation supplies LS_FACTOR")
            if group == "delivery overlay" or name in ("PROTECTED_LANDS", "PARCEL", "NHD", "NWI"):
                if by_id[choice["source_id"]].get("kind") != "vector":
                    raise ValueError(group + " " + name + " requires its original vector source")
            if name in ROLES and choice["source_id"] != inputs[name]:
                raise ValueError("Delivery must preserve the actual modeled " + name + " source selection")
    _source_choices(delivery, source_ids)
    return source_ids

def _application_sources():
    root = Path(__file__).resolve().parent.parent
    paths = set()
    for directory in ("model", "source_tools", "operator"):
        base = root / directory
        if base.is_dir():
            paths.update(p for p in base.rglob("*") if p.is_file()
                         and not p.is_symlink() and p.suffix in (".py", ".mjs", ".js", ".html", ".css", ".md")
                         and "__pycache__" not in p.parts)
    for name in ("audit.py", "raster_checks.py", "package_delivery.py",
                 "delivery_snapshot.py", "handoff_view.py", "focused_check.py", "README.md"):
        path = root / name
        if path.is_file():
            paths.add(path)
    return [describe_file(root, p) for p in sorted(paths)]

def _progress(path, record, **updates):
    record.update(updates, updated_at=now())
    record.pop("error", None)
    atomic_json(path, record)
    print(json.dumps({"phase": record["phase"], "native_selection_id": record["id"],
                      "completed_runs": sorted(record.get("completed_runs", {})),
                      "updated_at": record["updated_at"]}), flush=True)

def _run_summary(run):
    return {"id": run["id"], "selection": run["selection"], "state": run["state"],
            "runtime": run.get("runtime"), "started_at": min(
                (v["started_at"] for v in run["stages"].values() if "started_at" in v), default=None),
            "completed_at": run["completed_at"],
            "stages": {k: {"completed_at": v.get("completed_at"),
                           "files": len(v.get("files", {}))}
                       for k, v in run["stages"].items()},
            "artifacts": run["artifacts"]}

def execute(workspace_path, plan_path, *, source_reference, handoff_path=None):
    plan_path = Path(plan_path).resolve(strict=True)
    plan_bytes = plan_path.read_bytes()
    plan = json.loads(plan_bytes)
    manifest_path = (plan_path.parent / plan["source_manifest"]).resolve(strict=True)
    manifest_bytes = manifest_path.read_bytes()
    manifest_sha = hashlib.sha256(manifest_bytes).hexdigest()
    if not re.fullmatch(r"[0-9a-f]{64}", str(plan.get("source_manifest_sha256", ""))):
        raise ValueError("Bind the actual composed source manifest SHA256 in the native plan")
    if manifest_sha != plan["source_manifest_sha256"]:
        raise ValueError("The selected original source manifest changed")
    manifest = json.loads(manifest_bytes)
    source_ids = _validate_plan(plan, manifest)
    if not isinstance(source_reference, str) or not source_reference.strip():
        raise ValueError("Record the selected immutable application source reference")
    application = _application_sources()
    identity = {"plan_sha256": hashlib.sha256(plan_bytes).hexdigest(),
                "source_manifest_sha256": manifest_sha,
                "source_reference": source_reference,
                "application_sources": application}
    key = digest(identity)
    workspace = Workspace(workspace_path, create=True, title=plan["title"])
    directory = workspace.root / "native-model" / key
    directory.mkdir(parents=True, exist_ok=True)
    with held(workspace.root / ".native-model-batch.lock", blocking=False):
        atomic_bytes(directory / "plan.json", plan_bytes, immutable=True)
        atomic_json(directory / "input.json", identity, immutable=True)
        progress_path = directory / "progress.json"
        if progress_path.exists():
            state = read_json(progress_path)
            if (state.get("schema") != PROGRESS_SCHEMA or state.get("id") != key
                    or state.get("workspace_id") != workspace.project["id"]):
                raise ValueError("The retained native selection belongs to another original workspace")
        else:
            state = {"schema": PROGRESS_SCHEMA, "id": key, "workspace_id": workspace.project["id"],
                     "state": "running", "phase": "sources", "created_at": now(),
                     "profiles": {}, "scenarios": {}, "runs": {}, "completed_runs": {}}
            _progress(progress_path, state)
        try:
            _progress(progress_path, state, state="running")
            if state.get("source_collection_id"):
                collection = workspace._get("sources", state["source_collection_id"])
                if collection["original_manifest"]["sha256"] != manifest_sha:
                    raise ValueError("The original native source collection differs from the selected manifest")
            else:
                collection = workspace.import_sources(manifest_path)
                if collection["original_manifest"]["sha256"] != manifest_sha:
                    raise ValueError("Original source manifest changed during native intake")
                _progress(progress_path, state, source_collection_id=collection["id"], phase="profiles")
            collection_id = collection["id"]
            for name, definition in plan["profiles"].items():
                profile = workspace.save_profile({**definition, "source_collection_id": collection_id})
                if name in state["profiles"] and state["profiles"][name] != profile["id"]:
                    raise ValueError("The original named profile changed")
                state["profiles"][name] = profile["id"]
                _progress(progress_path, state, phase="profiles")
            for name, definition in plan["scenarios"].items():
                scenario = workspace.save_scenario({**definition, "source_collection_id": collection_id})
                if name in state["scenarios"] and state["scenarios"][name] != scenario["id"]:
                    raise ValueError("The original named scenario changed")
                state["scenarios"][name] = scenario["id"]
                _progress(progress_path, state, phase="scenarios")
            grid_spec = {**plan["grid"], "source_collection_id": collection_id}
            if state.get("grid_id"):
                grid = workspace.get_grid(state["grid_id"])
                if grid["spec"] != grid_spec:
                    raise ValueError("The original native grid selection changed")
            else:
                _progress(progress_path, state, phase="grid")
                grid = workspace.prepare_grid(grid_spec)
                _progress(progress_path, state, grid_id=grid["id"], phase="runs")
            for name, selection in plan["runs"].items():
                run = workspace.prepare_run({"grid_id": grid["id"],
                    "profile_id": state["profiles"][selection["profile"]],
                    "scenario_id": state["scenarios"][selection["scenario"]]})
                if name in state["runs"] and state["runs"][name] != run["id"]:
                    raise ValueError("The original named native run changed")
                state["runs"][name] = run["id"]
                _progress(progress_path, state, phase="run:" + name)
                # execute_run reuses its completed source-bound native stages.
                run = workspace.run(run["id"])
                if run["state"] != "complete":
                    raise RuntimeError("The original native run has not completed: " + name)
                state["completed_runs"][name] = _run_summary(run)
                _progress(progress_path, state, phase="run:" + name)
            comparison = workspace.compare_runs([state["runs"][name] for name in plan["comparison"]])
            delivery = _source_choices(plan["delivery"], source_ids, collection_id)
            delivery["baseline_run_id"] = state["runs"][delivery.pop("baseline_run")]
            delivery["scenario_run_ids"] = [state["runs"][name] for name in delivery.pop("scenario_runs")]
            retained_receiving = read_json(directory / "receiving.json") if (directory / "receiving.json").exists() else None
            if retained_receiving and (retained_receiving.get("native_selection_id") != key
                    or retained_receiving.get("workspace_id") != workspace.project["id"]):
                raise ValueError("Retained receiving output belongs to another native selection")
            completed_at = (retained_receiving["completed_at"] if retained_receiving else state.get("completed_at")) or now()
            output = {"schema": HANDOFF_SCHEMA, "native_selection_id": key,
                      "workspace_path": str(workspace.root), "workspace_id": workspace.project["id"],
                      "source_collection_id": collection_id, "source_manifest_sha256": manifest_sha,
                      "source_reference": source_reference, "application_sources": application,
                      "grid_id": grid["id"], "profiles": state["profiles"], "scenarios": state["scenarios"],
                      "runs": state["runs"], "comparison_id": comparison["id"],
                      "model_outcomes": state["completed_runs"], "delivery_selection": delivery,
                      "completed_at": completed_at}
            atomic_json(directory / "receiving.json", output, immutable=True)
            _progress(progress_path, state, state="complete", phase="complete",
                      completed_at=output["completed_at"], comparison_id=comparison["id"],
                      receiving=describe_file(directory, directory / "receiving.json"))
            if handoff_path is not None:
                atomic_json(Path(handoff_path), output, immutable=True)
            return output
        except BaseException as exc:
            state.update(state="failed", updated_at=now(),
                         error={"type": type(exc).__name__, "message": str(exc)})
            atomic_json(progress_path, state)
            raise

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--source-reference", required=True,
                        help="The exact immutable application source selected by the native caller")
    parser.add_argument("--handoff", type=Path,
                        help="Also retain the completed native selection at this original receiving path")
    parser.add_argument("--complete-delivery", type=Path,
                        help="Continue native runs into seven map families and a received editable project")
    parser.add_argument("--receive-directory", type=Path,
                        help="New receiving directory; defaults beneath the complete-delivery output")
    args = parser.parse_args(argv)
    if args.receive_directory and not args.complete_delivery:
        parser.error("--receive-directory requires --complete-delivery")
    try:
        result = execute(args.workspace, args.plan, source_reference=args.source_reference,
                         handoff_path=args.handoff)
        if args.complete_delivery:
            from .regional_delivery import complete_delivery
            original = (args.handoff or Path(result["workspace_path"]) / "native-model" /
                        result["native_selection_id"] / "receiving.json")
            completed = complete_delivery(original, output=args.complete_delivery,
                workspace_path=args.workspace, receive_directory=args.receive_directory)
            print(json.dumps(completed, indent=2, ensure_ascii=False, sort_keys=True, allow_nan=False))
            return 0
        print(json.dumps({"schema": result["schema"], "workspace_id": result["workspace_id"],
                          "native_selection_id": result["native_selection_id"], "runs": result["runs"],
                          "comparison_id": result["comparison_id"],
                          "handoff": str(args.handoff.resolve()) if args.handoff else None}, sort_keys=True))
        return 0
    except (ValueError, OSError, RuntimeError, KeyError, ImportError) as exc:
        print(json.dumps({"state": "failed", "type": type(exc).__name__, "message": str(exc)}),
              file=sys.stderr, flush=True)
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
