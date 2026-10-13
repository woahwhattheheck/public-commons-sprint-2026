"""Execute actual regional land-cover alternatives against a retained scientific core."""
from __future__ import annotations
import argparse
import copy
import json
from pathlib import Path
import sys
from .common import atomic_bytes, atomic_json, digest, held, now, read_json, selected_models
from .native_batch import _application_sources
from .regional_job import (CORE_RESULT, _document, _execute_native, _name, _progress,
                           _reuse_source_ids, _run_outcome, _sha)
from .workspace import Workspace
from .scenario_summary import build_core_summary, write_summary

PLAN = "upstate.regional-scenarios-plan/v1"
RESULT = "upstate.regional-scenarios-result/v1"


def execute(core_path, plan_path, *, output=None):
    """Run retained land-cover alternatives and write their annual decision tables."""
    core_path, plan_path = Path(core_path).resolve(strict=True), Path(plan_path).resolve(strict=True)
    core_bytes, plan_bytes = core_path.read_bytes(), plan_path.read_bytes()
    core, plan = json.loads(core_bytes), json.loads(plan_bytes)
    if core.get("schema") != CORE_RESULT or plan.get("schema") != PLAN:
        raise ValueError("Select the retained regional core result and regional scenarios plan")
    if set(plan) - {"schema", "sources", "scenarios"} or not isinstance(plan.get("scenarios"), dict) or not plan["scenarios"]:
        raise ValueError("Supply the named actual regional land-cover scenarios")
    definitions = copy.deepcopy(plan["scenarios"])
    if "baseline" in definitions:
        raise ValueError("The retained core already supplies the baseline")
    sources = plan.get("sources", {})
    if not isinstance(sources, dict) or "model" in sources:
        raise ValueError("Name added mask source editions; model names the scientific core")
    documents = {}
    for alias, spec in sources.items():
        _name(alias, "Source edition name")
        documents[alias] = _document(plan_path.parent, spec)
    for name, definition in definitions.items():
        _name(name, "Scenario name")
        if (not isinstance(definition, dict) or "source_collection_id" in definition
                or definition.get("kind") != "landcover" or not definition.get("patches")):
            raise ValueError("Each scenario needs explicit original land-cover change masks")
        if "reuse_source_run_ids" in definition:
            definition["reuse_source_run_ids"] = _reuse_source_ids(definition["reuse_source_run_ids"])
        alias = definition.get("source_alias", "model")
        if not isinstance(alias, str) or alias not in {"model", *documents}:
            raise ValueError("Each scenario selects its named mask source edition")
    workspace = Workspace(core["workspace_path"])
    if workspace.project["id"] != core["workspace_id"]:
        raise ValueError("Continue the regional core in its original workspace")
    collection = workspace._get("sources", core["source_collection_id"])
    if collection["original_manifest"]["sha256"] != core["source_manifest_sha256"]:
        raise ValueError("The core source edition differs from the completed result")
    grid = workspace.get_grid(core["grid_id"])
    baseline = workspace.inspect_run(core["baseline_run_id"])
    expected = {"grid_id": grid["id"], "profile_id": core["profile_id"], "scenario_id": core["scenario_id"]}
    if baseline["state"] != "complete" or any(baseline["selection"][k] != v for k, v in expected.items()):
        raise ValueError("The selected scientific core has not completed with the retained selections")
    models = selected_models(baseline["selection"])
    application = _application_sources()
    identity = {"core_result_sha256": _sha(core_bytes), "plan_sha256": _sha(plan_bytes),
                "sources": {alias: _sha(doc[1]) for alias, doc in documents.items()},
                "application_sources": application}
    key = digest(identity)
    directory = workspace.root / "regional-scenarios" / key
    directory.mkdir(parents=True, exist_ok=True)
    with held(workspace.root / ".native-model-batch.lock", blocking=False):
        atomic_bytes(directory / "plan.json", plan_bytes, immutable=True)
        atomic_json(directory / "input.json", identity, immutable=True)
        progress = directory / "progress.json"
        state = read_json(progress) if progress.exists() else {
            "schema": "upstate.regional-scenarios-progress/v1", "id": key,
            "workspace_id": workspace.project["id"], "created_at": now(),
            "source_collections": {}, "scenarios": {}, "runs": {}}
        if state.get("id") != key or state.get("workspace_id") != workspace.project["id"]:
            raise ValueError("Resume the original scenario operation in its retained workspace")
        try:
            state.pop("error", None)
            _progress(progress, state, state="running", phase="sources", grid_id=grid["id"])
            collections = {"model": core["source_collection_id"]}
            for alias, (path, body, manifest) in documents.items():
                old = state["source_collections"].get(alias)
                value = workspace._get("sources", old) if old else workspace.import_sources(path)
                if value["original_manifest"]["sha256"] != identity["sources"][alias]:
                    raise ValueError("The retained scenario source edition changed: " + alias)
                collections[alias] = value["id"]
                state["source_collections"][alias] = value["id"]
                _progress(progress, state, phase="sources:" + alias)
            outcomes = {}
            for name, definition in definitions.items():
                alias = definition.pop("source_alias", "model")
                reuse_source_run_ids = definition.pop("reuse_source_run_ids", None)
                scenario = workspace.save_scenario({**definition, "source_collection_id": collections[alias]})
                if state["scenarios"].get(name) and state["scenarios"][name] != scenario["id"]:
                    raise ValueError("The retained named scenario changed: " + name)
                state["scenarios"][name] = scenario["id"]
                run = workspace.prepare_run({"grid_id": grid["id"], "profile_id": core["profile_id"],
                                             "scenario_id": scenario["id"]})
                if state["runs"].get(name) and state["runs"][name] != run["id"]:
                    raise ValueError("The retained named native run changed: " + name)
                if run["id"] in [value for other, value in state["runs"].items() if other != name]:
                    raise ValueError("Two scenario names select the same native run")
                state["runs"][name] = run["id"]
                _progress(progress, state, phase="native:" + name, run_id=run["id"])
                run = _execute_native(workspace, run["id"], reuse_source_run_ids)
                if run["state"] != "complete":
                    raise RuntimeError("The regional scenario native run did not complete: " + name)
                outcomes[name] = _run_outcome(run)
                _progress(progress, state, phase="completed:" + name)
            _progress(progress, state, phase="comparison")
            comparison = workspace.compare_runs([baseline["id"], *[state["runs"][name] for name in definitions]])
            retained = directory / "result.json"
            completed_at = read_json(retained)["completed_at"] if retained.exists() else now()
            result = {"schema": RESULT, "scenario_selection_id": key,
                      "core_selection_id": core["core_selection_id"], "core_result_sha256": _sha(core_bytes),
                      "workspace_path": str(workspace.root), "workspace_id": workspace.project["id"],
                      "grid_id": grid["id"], "profile_id": core["profile_id"], "models": models,
                      "baseline_run_id": baseline["id"], "scenario_runs": state["runs"],
                      "scenarios": state["scenarios"], "source_collections": collections,
                      "comparison_id": comparison["id"], "model_outcomes": outcomes,
                      "application_sources": application, "completed_at": completed_at,
                      "summary_directory": directory.relative_to(workspace.root).as_posix()}
            atomic_json(retained, result, immutable=True)
            summary_files = write_summary(directory, build_core_summary(workspace, core, result))
            if output is not None:
                atomic_json(Path(output), result, immutable=True)
            _progress(progress, state, state="complete", phase="complete", completed_at=completed_at,
                      summary_files=summary_files)
            return result
        except BaseException as error:
            _progress(progress, state, state="failed",
                      error={"type": type(error).__name__, "message": str(error)})
            raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--core-result", required=True, type=Path)
    parser.add_argument("--plan", required=True, type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    try:
        result = execute(args.core_result, args.plan, output=args.output)
        print(json.dumps({"schema": result["schema"], "workspace_id": result["workspace_id"],
                          "grid_id": result["grid_id"], "models": result["models"],
                          "baseline_run_id": result["baseline_run_id"], "scenario_runs": result["scenario_runs"],
                          "comparison_id": result["comparison_id"],
                          "summary_directory": str(Path(result["workspace_path"]) / result["summary_directory"]),
                          "output": str(args.output.resolve()) if args.output else None}, sort_keys=True), flush=True)
        return 0
    except (ValueError, OSError, KeyError, TypeError, ImportError, RuntimeError) as error:
        print(json.dumps({"state": "failed", "type": type(error).__name__, "message": str(error)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
