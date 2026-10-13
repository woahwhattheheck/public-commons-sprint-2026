"""Execute regional models now and join later map context to their retained results.

Uses the maintained Workspace and original InVEST engines. Scientific input,
grid, profile and run identities survive the later arrival of parcel, protection,
hydrography and source-water editions.
"""
from __future__ import annotations
import argparse
import copy
import hashlib
import json
from pathlib import Path
import re
import sys
from .common import (ROLES, SOURCE_IDS, atomic_bytes, atomic_json, digest, held,
                     identifier, now, read_json, required_roles, selected_models)
from .native_batch import _application_sources, _run_summary
from .workspace import Workspace
from .scenario_summary import build_core_summary, write_summary

CORE_PLAN = "upstate.regional-core-plan/v1"
CORE_RESULT = "upstate.regional-core-result/v1"
FINISH_PLAN = "upstate.regional-delivery-plan/v1"
NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}\Z")


def _sha(body):
    return hashlib.sha256(body).hexdigest()


def _name(value, label):
    if not isinstance(value, str) or not NAME.fullmatch(value):
        raise ValueError(label + " must use letters, numbers, dots, underscores or hyphens")
    return value


def _document(parent, spec):
    if not isinstance(spec, dict) or set(spec) != {"path", "sha256"}:
        raise ValueError("Each source edition selects exactly its manifest path and SHA256")
    expected = identifier(spec["sha256"])
    if not isinstance(spec["path"], str) or not spec["path"]:
        raise ValueError("Select the original source manifest path")
    path = (parent / spec["path"]).resolve(strict=True)
    body = path.read_bytes()
    if _sha(body) != expected:
        raise ValueError("The selected source manifest changed: " + str(path))
    manifest = json.loads(body)
    if manifest.get("schema") != "upstate.sources/v1":
        raise ValueError("Select an original upstate.sources/v1 manifest")
    entries = manifest.get("entries")
    if not isinstance(entries, list) or not all(isinstance(row, dict) for row in entries):
        raise ValueError("The source manifest must contain its actual entry list")
    ids = [row.get("id") for row in entries]
    if any(not isinstance(key, str) or not key for key in ids) or len(set(ids)) != len(ids):
        raise ValueError("Each source entry needs its original unique identity")
    return path, body, manifest


def _plan(path):
    body = path.read_bytes()
    plan = json.loads(body)
    required = {"schema", "title", "sources", "grid", "profile", "baseline"}
    if plan.get("schema") != CORE_PLAN or not required <= set(plan) or set(plan) - required - {"models", "reuse_source_run_ids"}:
        raise ValueError("Select a complete upstate.regional-core-plan/v1 document")
    if not isinstance(plan["title"], str) or not plan["title"].strip():
        raise ValueError("Name the regional scientific selection")
    manifest_path, manifest_bytes, manifest = _document(path.parent, plan["sources"])
    by_id = {row["id"]: row for row in manifest["entries"]}
    plan = copy.deepcopy(plan)
    if "reuse_source_run_ids" in plan:
        plan["reuse_source_run_ids"] = _reuse_source_ids(plan["reuse_source_run_ids"])
    grid, profile, baseline = plan["grid"], plan["profile"], plan["baseline"]
    if any(not isinstance(value, dict) or "source_collection_id" in value
           for value in (grid, profile, baseline)):
        raise ValueError("Grid, profile and baseline bind the selected core source edition")
    selections = [selected_models(value["models"]) for value in (plan, grid, profile) if "models" in value]
    models = selections[0] if selections else selected_models()
    if any(value != models for value in selections):
        raise ValueError("Core plan, grid and profile must select the same native models")
    for value in (grid, profile):
        if models == selected_models():
            value.pop("models", None)
        else:
            value["models"] = models
    inputs = grid.get("input_sources")
    needed = required_roles(models)
    if not isinstance(inputs, dict) or set(needed) - set(inputs):
        raise ValueError("Bind the physical inputs required by " + ", ".join(models))
    for role in needed:
        source_id = inputs[role]
        if source_id not in by_id or by_id[source_id].get("kind") != "raster":
            raise ValueError(role + " requires its actual retained raster source")
    if models != selected_models():
        grid["input_sources"] = {role: inputs[role] for role in needed}
    for name in ("reporting_area", "model_domain"):
        choice = grid.get(name)
        if (not isinstance(choice, dict) or choice.get("source_id") not in by_id
                or by_id[choice["source_id"]].get("kind") != "vector"):
            raise ValueError("Select the actual " + name + " polygon source")
    table = profile.get("biophysical_source_id")
    if table not in by_id or by_id[table].get("kind") != "table":
        raise ValueError("Select the published biophysical table in the core source edition")
    if baseline.get("kind") != "baseline" or baseline.get("patches"):
        raise ValueError("The core uses the selected original land-cover baseline")
    return plan, body, manifest_path, manifest_bytes, models


def _reuse_source_ids(value):
    """Normalize original run IDs while retaining the caller's candidate order."""
    if not isinstance(value, list):
        raise ValueError("reuse_source_run_ids must be a list of retained run IDs")
    return list(dict.fromkeys(identifier(item) for item in value))


def _execute_native(workspace, run_id, reuse_source_run_ids=None):
    """Continue the normal native run with its optional retained donor choices."""
    if reuse_source_run_ids is None:
        return workspace.run(run_id)
    return workspace.run(run_id, reuse_source_run_ids=reuse_source_run_ids)


def _run_outcome(run):
    """Keep the persisted provenance of the stages that produced each quantity."""
    result = _run_summary(run)
    for model, stage in run.get("stages", {}).items():
        selected = result["stages"][model]
        for field in ("runtime", "input_signature", "reused_from", "source_run_id"):
            if field in stage:
                selected[field] = copy.deepcopy(stage[field])
    for field in ("reuse_source_run_ids", "reuse_observations"):
        if field in run:
            result[field] = copy.deepcopy(run[field])
    return result


def _progress(path, record, **changes):
    record.update(changes, updated_at=now())
    atomic_json(path, record)
    print(json.dumps({key: record.get(key) for key in
                      ("id", "state", "phase", "source_collection_id", "grid_id", "run_id")},
                     sort_keys=True), flush=True)


def run_core(workspace_path, plan_path, *, source_reference, output=None):
    """Run a regional baseline and write its retained annual quantity tables."""
    plan_path = Path(plan_path).resolve(strict=True)
    plan, plan_bytes, manifest_path, manifest_bytes, models = _plan(plan_path)
    if not isinstance(source_reference, str) or not source_reference.strip():
        raise ValueError("Record the selected immutable application source reference")
    application = _application_sources()
    identity = {"plan_sha256": _sha(plan_bytes), "source_manifest_sha256": _sha(manifest_bytes),
                "source_reference": source_reference, "application_sources": application}
    key = digest(identity)
    workspace = Workspace(workspace_path, create=True, title=plan["title"])
    directory = workspace.root / "regional-model" / key
    directory.mkdir(parents=True, exist_ok=True)
    with held(workspace.root / ".native-model-batch.lock", blocking=False):
        atomic_bytes(directory / "plan.json", plan_bytes, immutable=True)
        atomic_bytes(directory / "source-manifest.json", manifest_bytes, immutable=True)
        atomic_json(directory / "input.json", identity, immutable=True)
        progress = directory / "progress.json"
        state = read_json(progress) if progress.exists() else {
            "schema": "upstate.regional-core-progress/v1", "id": key,
            "workspace_id": workspace.project["id"], "created_at": now()}
        if state.get("id") != key or state.get("workspace_id") != workspace.project["id"]:
            raise ValueError("Continue the original regional operation in its own workspace")
        try:
            state.pop("error", None)
            _progress(progress, state, state="running", phase="sources")
            collection = (workspace._get("sources", state["source_collection_id"])
                          if state.get("source_collection_id") else workspace.import_sources(manifest_path))
            if collection["original_manifest"]["sha256"] != identity["source_manifest_sha256"]:
                raise ValueError("The original scientific source collection changed")
            collection_id = collection["id"]
            _progress(progress, state, source_collection_id=collection_id, phase="profile")
            profile = workspace.save_profile({**plan["profile"], "source_collection_id": collection_id})
            scenario = workspace.save_scenario({**plan["baseline"], "source_collection_id": collection_id})
            for field, value in (("profile_id", profile["id"]), ("scenario_id", scenario["id"])):
                if state.get(field) and state[field] != value:
                    raise ValueError("The retained core " + field + " changed")
                state[field] = value
            grid_spec = {**plan["grid"], "source_collection_id": collection_id}
            _progress(progress, state, phase="grid")
            if state.get("grid_id"):
                grid = workspace.get_grid(state["grid_id"])
                if grid["spec"] != grid_spec:
                    raise ValueError("The retained core grid selection changed")
            else:
                grid = workspace.prepare_grid(grid_spec)
            _progress(progress, state, grid_id=grid["id"], phase="native")
            run = workspace.prepare_run({"grid_id": grid["id"], "profile_id": profile["id"],
                                         "scenario_id": scenario["id"]})
            if state.get("run_id") and state["run_id"] != run["id"]:
                raise ValueError("The retained core native run changed")
            _progress(progress, state, run_id=run["id"])
            run = _execute_native(workspace, run["id"], plan.get("reuse_source_run_ids"))
            if run["state"] != "complete":
                raise RuntimeError("The original regional native run did not complete")
            retained = directory / "result.json"
            completed_at = read_json(retained)["completed_at"] if retained.exists() else now()
            result = {"schema": CORE_RESULT, "core_selection_id": key,
                      "workspace_path": str(workspace.root), "workspace_id": workspace.project["id"],
                      "source_collection_id": collection_id, "models": models,
                      "source_manifest_sha256": identity["source_manifest_sha256"],
                      "source_reference": source_reference, "application_sources": application,
                      "grid_id": grid["id"], "profile_id": profile["id"],
                      "scenario_id": scenario["id"], "baseline_run_id": run["id"],
                      "model_outcome": _run_outcome(run), "completed_at": completed_at,
                      "summary_directory": directory.relative_to(workspace.root).as_posix()}
            atomic_json(retained, result, immutable=True)
            summary_files = write_summary(directory, build_core_summary(workspace, result, title=plan["title"]))
            _progress(progress, state, state="complete", phase="complete", completed_at=completed_at,
                      summary_files=summary_files)
            if output is not None:
                atomic_json(Path(output), result, immutable=True)
            return result
        except BaseException as error:
            _progress(progress, state, state="failed",
                      error={"type": type(error).__name__, "message": str(error)})
            raise


def _choices(value, collections, workspace):
    if isinstance(value, list):
        return [_choices(item, collections, workspace) for item in value]
    if not isinstance(value, dict):
        return value
    result = {key: _choices(item, collections, workspace) for key, item in value.items()}
    if "source_id" in result:
        alias = result.pop("source_alias", "model")
        if not isinstance(alias, str) or alias not in collections or "source_collection_id" in result:
            raise ValueError("Select an existing named delivery source edition")
        workspace.source_file(collections[alias], result["source_id"])
        result["source_collection_id"] = collections[alias]
    elif "source_alias" in result or "source_collection_id" in result:
        raise ValueError("A delivery source choice needs its source_id")
    return result


def finish_delivery(core_path, plan_path, *, output=None, build=False):
    """Join actual completed scenarios and context without rerunning any model."""
    core_path, plan_path = Path(core_path).resolve(strict=True), Path(plan_path).resolve(strict=True)
    core_bytes, plan_bytes = core_path.read_bytes(), plan_path.read_bytes()
    core, plan = json.loads(core_bytes), json.loads(plan_bytes)
    if core.get("schema") != CORE_RESULT or plan.get("schema") != FINISH_PLAN:
        raise ValueError("Select the original regional core result and regional delivery plan")
    allowed = {"schema", "sources", "scenario_runs", "comparison_runs", "delivery"}
    if set(plan) - allowed or not {"sources", "scenario_runs", "delivery"} <= set(plan):
        raise ValueError("The delivery plan requires sources, scenario_runs and delivery")
    workspace = Workspace(core["workspace_path"])
    if workspace.project["id"] != core["workspace_id"]:
        raise ValueError("The completed core belongs to another workspace")
    collection = workspace._get("sources", core["source_collection_id"])
    if collection["original_manifest"]["sha256"] != core["source_manifest_sha256"]:
        raise ValueError("The scientific core source edition changed")
    grid = workspace.get_grid(core["grid_id"])
    baseline = workspace.inspect_run(core["baseline_run_id"])
    expected = {"grid_id": core["grid_id"], "profile_id": core["profile_id"], "scenario_id": core["scenario_id"]}
    if baseline["state"] != "complete" or any(baseline["selection"][k] != v for k, v in expected.items()):
        raise ValueError("The original scientific baseline is incomplete or differs")
    if selected_models(baseline["selection"]) != selected_models():
        raise ValueError("The seven-family delivery requires the completed combined NDR/SDR core")
    scenarios, comparisons = plan["scenario_runs"], plan.get("comparison_runs", {})
    if not isinstance(scenarios, dict) or not scenarios or not isinstance(comparisons, dict):
        raise ValueError("Select named completed future scenario runs")
    if "baseline" in scenarios or "baseline" in comparisons or set(scenarios) & set(comparisons):
        raise ValueError("Each named completed run must have a distinct name")
    run_ids = {"baseline": baseline["id"], **scenarios, **comparisons}
    for name, key in run_ids.items():
        _name(name, "Run name")
        identifier(key)
    if len(set(run_ids.values())) != len(run_ids):
        raise ValueError("Select distinct completed model runs")
    runs = {}
    for name, key in run_ids.items():
        run = workspace.inspect_run(key)
        if (run["state"] != "complete" or run["selection"]["grid_id"] != grid["id"]
                or selected_models(run["selection"]) != selected_models()):
            raise ValueError("Delivery runs must complete both models on the original regional grid")
        if name in scenarios:
            scenario = workspace._get("scenarios", run["selection"]["scenario_id"])
            if run["selection"]["profile_id"] != core["profile_id"] or scenario["kind"] != "landcover":
                raise ValueError("Future-service maps require land-cover changes under the baseline profile")
        runs[name] = run
    sources = plan["sources"]
    if not isinstance(sources, dict) or "model" in sources:
        raise ValueError("Name added source editions; model names the retained scientific core")
    documents = {}
    for alias, spec in sources.items():
        _name(alias, "Source edition name")
        documents[alias] = _document(plan_path.parent, spec)
    selected = plan["delivery"]
    if not isinstance(selected, dict) or {"baseline_run_id", "scenario_run_ids"} & set(selected):
        raise ValueError("Delivery inherits the original baseline and selected scenario runs")
    roles, overlays = selected.get("source_roles", {}), selected.get("overlays", {})
    context_roles = set(SOURCE_IDS) - set(ROLES) - {"LS_FACTOR"}
    if not isinstance(roles, dict) or context_roles - set(roles):
        raise ValueError("Bind protected lands, parcels, NHD and NWI for the seven-map delivery")
    if not isinstance(overlays, dict) or {"drinking_water", "high_quality_waters"} - set(overlays):
        raise ValueError("Bind the actual source-water and high-quality-water overlays")
    contact = selected.get("contact", {})
    if not isinstance(contact, dict) or any(not isinstance(contact.get(k), str) or not contact[k].strip()
            for k in ("name", "organization", "email")):
        raise ValueError("Retain the responsible contact for the GIS metadata")
    identity = {"core_result_sha256": _sha(core_bytes), "plan_sha256": _sha(plan_bytes),
                "sources": {alias: _sha(doc[1]) for alias, doc in documents.items()}}
    key = digest(identity)
    directory = workspace.root / "regional-deliveries" / key
    directory.mkdir(parents=True, exist_ok=True)
    with held(workspace.root / ".native-model-batch.lock", blocking=False):
        atomic_bytes(directory / "plan.json", plan_bytes, immutable=True)
        atomic_json(directory / "input.json", identity, immutable=True)
        progress = directory / "progress.json"
        state = read_json(progress) if progress.exists() else {
            "schema": "upstate.regional-delivery-progress/v1", "id": key,
            "workspace_id": workspace.project["id"], "created_at": now(), "source_collections": {}}
        if state.get("id") != key or state.get("workspace_id") != workspace.project["id"]:
            raise ValueError("Continue the original delivery operation in its own workspace")
        try:
            state.pop("error", None)
            _progress(progress, state, state="running", phase="context")
            collections = {"model": core["source_collection_id"]}
            for alias, (path, body, manifest) in documents.items():
                old = state["source_collections"].get(alias)
                retained = workspace._get("sources", old) if old else workspace.import_sources(path)
                if retained["original_manifest"]["sha256"] != identity["sources"][alias]:
                    raise ValueError("The retained context source edition changed: " + alias)
                collections[alias] = retained["id"]
                state["source_collections"][alias] = retained["id"]
                _progress(progress, state, phase="context:" + alias)
            selection = _choices(selected, collections, workspace)
            for role in context_roles:
                choice = selection["source_roles"][role]
                _, entry = workspace.source_file(choice["source_collection_id"], choice["source_id"])
                if entry["kind"] != "vector":
                    raise ValueError(role + " requires its original vector edition")
            selection["baseline_run_id"] = baseline["id"]
            selection["scenario_run_ids"] = list(scenarios.values())
            _progress(progress, state, phase="comparison")
            comparison = workspace.compare_runs(list(run_ids.values()))
            receiving = directory / "receiving.json"
            completed_at = read_json(receiving)["completed_at"] if receiving.exists() else now()
            result = {"schema": "upstate.native-model-receiving/v1", "native_selection_id": key,
                      "core_selection_id": core["core_selection_id"],
                      "workspace_path": str(workspace.root), "workspace_id": workspace.project["id"],
                      "source_collection_id": core["source_collection_id"], "source_collections": collections,
                      "source_manifest_sha256": core["source_manifest_sha256"],
                      "source_reference": core["source_reference"], "application_sources": core["application_sources"],
                      "grid_id": core["grid_id"],
                      "profiles": {name: run["selection"]["profile_id"] for name, run in runs.items()},
                      "scenarios": {name: run["selection"]["scenario_id"] for name, run in runs.items()},
                      "runs": run_ids, "comparison_id": comparison["id"],
                      "model_outcomes": {name: _run_outcome(run) for name, run in runs.items()},
                      "delivery_selection": selection, "completed_at": completed_at}
            atomic_json(receiving, result, immutable=True)
            if output is not None:
                atomic_json(Path(output), result, immutable=True)
            if build:
                _progress(progress, state, phase="delivery")
                state["delivery_id"] = workspace.build_delivery(selection)["id"]
            _progress(progress, state, state="complete", phase="complete", completed_at=completed_at)
            return result
        except BaseException as error:
            _progress(progress, state, state="failed",
                      error={"type": type(error).__name__, "message": str(error)})
            raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    run = commands.add_parser("run", help="Execute or resume the selected regional scientific baseline")
    run.add_argument("--workspace", required=True, type=Path)
    run.add_argument("--plan", required=True, type=Path)
    run.add_argument("--source-reference", required=True)
    run.add_argument("--output", type=Path)
    finish = commands.add_parser("finish", help="Join completed scenarios and spatial context to original models")
    finish.add_argument("--core-result", required=True, type=Path)
    finish.add_argument("--plan", required=True, type=Path)
    finish.add_argument("--output", type=Path)
    finish.add_argument("--build", action="store_true", help="Build the complete existing seven-map delivery")
    args = parser.parse_args(argv)
    try:
        result = (run_core(args.workspace, args.plan, source_reference=args.source_reference, output=args.output)
                  if args.command == "run" else
                  finish_delivery(args.core_result, args.plan, output=args.output, build=args.build))
        print(json.dumps({"schema": result["schema"], "workspace_id": result["workspace_id"],
                          "grid_id": result["grid_id"], "baseline_run_id": result.get("baseline_run_id"),
                          "models": result.get("models"), "runs": result.get("runs"),
                          "summary_directory": str(Path(result["workspace_path"]) / result["summary_directory"])
                          if result.get("summary_directory") else None,
                          "output": str(args.output.resolve()) if args.output else None}, sort_keys=True), flush=True)
        return 0
    except (ValueError, OSError, KeyError, TypeError, ImportError, RuntimeError) as error:
        print(json.dumps({"state": "failed", "type": type(error).__name__, "message": str(error)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
