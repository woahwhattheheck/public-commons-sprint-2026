"""Execute the selected published InVEST engines inside their retained native run."""
from __future__ import annotations
import hashlib
import importlib
import importlib.metadata
import inspect
import logging
import sys
from pathlib import Path
from .common import (INVEST_SOURCE, INVEST_VERSION, atomic_json, describe_file, digest,
                     file_digest, held, identifier, now, read_json, verify_file)
from . import rasters
from .model_selection import (models, run_models, required_roles, required_outputs, run_scope,
                              validate_completed_run, common_comparison_outputs)
from .reuse import native_companions, registry_snapshot, verify_stage
from .stage_cache import runtime_environment, signature, recover, register, execution_slot
from .native_arguments import build_native_arguments
from .native_execution import NativeExecution


def runtime(selection=None):
    active = models(selection)
    installed = importlib.metadata.version("natcap.invest")
    if installed != INVEST_VERSION:
        raise ValueError("This adapter selects natcap.invest " + INVEST_VERSION + "; current runtime is " + installed)
    # The published NDR implementation imports SDR itself. Pin that actual
    # dependency too, while executing only the explicitly selected models.
    dependencies = ("ndr", "sdr") if "ndr" in active else ("sdr",)
    loaded = {name: importlib.import_module("natcap.invest." + name + "." + name)
              for name in dependencies}
    source = {"version": installed, "declared_source": INVEST_SOURCE, "modules": {},
              "selected_models": list(active), "environment": runtime_environment()}
    for name, module in loaded.items():
        path = Path(inspect.getsourcefile(module))
        body = path.read_bytes()
        git_blob = hashlib.sha1(b"blob " + str(len(body)).encode() + b"\0" + body).hexdigest()
        if git_blob != INVEST_SOURCE[name + "_blob"]:
            raise ValueError("Installed " + name.upper() + " source differs from the selected official 3.20.0 tag")
        source["modules"][name] = {"filename": path.name, "sha256": file_digest(path), "git_blob": git_blob}
    return {name: loaded[name] for name in active}, source


def execute_run(workspace, key, *, reuse_source_run_ids=None):
    directory = workspace.root / "runs" / key
    with held(directory / ".run.lock", blocking=False):
        # Read after acquiring the lock so a completed or resumed operation is
        # never replaced by the caller's earlier snapshot.
        state = workspace.inspect_run(key)
        active = run_models(state)
        if state["state"] == "complete":
            validate_completed_run(state)
            for artifact in state["artifacts"].values():
                verify_file(directory, artifact)
            return {**state, "reused": True, "model_scope": run_scope(state)}
        # Runtime loading, input reads and log creation belong to the same
        # recoverable attempt as the native calculation itself.
        with NativeExecution(directory, state) as execution:
            root_logger = logging.getLogger()
            previous_level = root_logger.level
            handler = None
            try:
                execution.phase("reuse_selection")
                retained_sources = (state.get("reuse_source_run_ids", ())
                                    if reuse_source_run_ids is None else reuse_source_run_ids)
                if not isinstance(retained_sources, (list, tuple)):
                    raise ValueError("Select original source run IDs as a list or tuple")
                retained_sources = tuple(dict.fromkeys(identifier(value) for value in retained_sources))
                if key in retained_sources:
                    raise ValueError("Reuse source runs must differ from the receiving run")
                if reuse_source_run_ids is not None:
                    state["reuse_source_run_ids"] = list(retained_sources)
                    execution.save()
                execution.phase("log")
                handler = logging.FileHandler(directory / "native.log", encoding="utf-8")
                handler.setFormatter(logging.Formatter("%(asctime)s %(name)s %(levelname)s %(message)s"))
                root_logger.setLevel(logging.INFO)
                root_logger.addHandler(handler)
                previous_runtime = state.get("runtime")
                unfinished = [name for name in active if name not in state["stages"]]
                for name in active:
                    if name in state["stages"]:
                        execution.phase("verify_stage", model=name)
                        stage = state["stages"][name]
                        verify_stage(directory, stage)
                        if "runtime" not in stage and previous_runtime:
                            stage["runtime"] = previous_runtime
                        register(workspace, key, name, stage)
                unfinished_outputs = [name for name in required_outputs(active)
                                      if name not in state["artifacts"]]
                for name in required_outputs(active):
                    if name in state["artifacts"]:
                        execution.phase("verify_export", artifact=name)
                        verify_file(directory, state["artifacts"][name])
                # A failure during export or final publication can leave every
                # selected native stage complete. Use their original outputs
                # directly; loading or executing InVEST again is unnecessary.
                modules = {}
                arguments = {}
                input_matcher = None
                runtime_source = previous_runtime
                if unfinished or unfinished_outputs:
                    execution.phase("grid")
                    grid = workspace.get_grid(state["selection"]["grid_id"])
                    grid_directory = workspace.root / "grids" / grid["id"]
                    needed = (required_roles(unfinished) + ("model_domain",)) if unfinished else ()
                    if unfinished_outputs:
                        needed += ("reporting_mask",)
                    paths = {name: verify_file(grid_directory, grid["files"][name]) for name in needed}
                    verified_inputs = {str(path.resolve()): grid["files"][name] for name, path in paths.items()}
                if unfinished:
                    execution.phase("runtime")
                    modules, runtime_source = runtime(unfinished)
                    if previous_runtime and previous_runtime != runtime_source:
                        state.setdefault("runtime_history", []).append(
                            {"recorded_at": now(), "runtime": previous_runtime})
                    state["runtime"] = runtime_source
                    execution.phase("sources")
                    profile = workspace._get("profiles", state["selection"]["profile_id"])
                    scenario = workspace._get("scenarios", state["selection"]["scenario_id"])
                    table, table_entry = workspace.source_file(
                        profile["source_collection_id"], profile["biophysical_source_id"])
                    if table_entry["body"]["sha256"] != profile["table_summary"]["sha256"]:
                        raise ValueError("Original biophysical table differs from the saved profile")
                    verified_inputs[str(table.resolve())] = table_entry["body"]
                    lulc = paths["NLCD"]
                    if scenario["kind"] == "landcover":
                        execution.phase("landcover")
                        if "landcover" in state["stages"]:
                            lulc = verify_file(directory, state["stages"]["landcover"]["artifact"])
                        else:
                            lulc = directory / "scenario_lulc.tif"
                            edits = rasters.make_scenario(
                                paths["NLCD"], lulc, grid["grid"], scenario["patches"],
                                source_loader=lambda sid: workspace.source_file(scenario["source_collection_id"], sid),
                                allowed_codes=set(profile["table_summary"]["lucodes"]))
                            state["stages"]["landcover"] = {
                                "completed_at": now(), "edits": edits,
                                "artifact": describe_file(directory, lulc, units="class")}
                            execution.save()
                        verified_inputs[str(lulc.resolve())] = state["stages"]["landcover"]["artifact"]
                    arguments = build_native_arguments(unfinished, profile, paths, table, lulc)
                    if retained_sources:
                        from .native_equivalence import NativeInputMatcher
                        input_matcher = NativeInputMatcher(
                            workspace, key, target_lulc=lulc, target_runtime=runtime_source)
                for name, module in modules.items():
                    args = {**arguments[name], "workspace_dir": str(directory / name)}
                    execution.phase("stage_identity", model=name)
                    selected = signature(name, args, runtime_source, verified_inputs=verified_inputs)
                    execution.phase("waiting_stage", model=name)
                    with execution_slot(workspace, selected):
                        execution.phase("stage_reuse", model=name)
                        reused, rejected = recover(
                            workspace, key, name, selected, directory, args,
                            source_run_ids=retained_sources, matcher=input_matcher,
                            progress=execution.reuse_progress)
                        if rejected:
                            state.setdefault("reuse_observations", {})[name] = rejected
                        if reused is not None:
                            state["stages"][name] = reused
                            # Save the reusable completed stage before indexing it.
                            execution.save()
                            register(workspace, key, name, reused)
                            logging.getLogger(__name__).info(
                                "Reused original %s stage from run %s", name, reused["reused_from"]["run_id"])
                            continue
                        execution.phase("validate", model=name)
                        args_path = directory / (name + "-arguments.json")
                        atomic_json(args_path, args)
                        errors = module.validate(args)
                        if errors:
                            state["validation"] = {name: [{"fields": list(fields), "message": message}
                                                           for fields, message in errors]}
                            raise ValueError("Native " + name.upper() + " validation: " +
                                             "; ".join(message for _, message in errors))
                        execution.phase("native", model=name)
                        started = now()
                        registry = module.execute(args)
                        if not isinstance(registry, dict):
                            raise ValueError("Native engine did not return its original output registry")
                        files, outputs, additional_files = registry_snapshot(directory, name, registry)
                        stage = {"started_at": started, "completed_at": now(),
                                 "arguments": describe_file(directory, args_path),
                                 "files": files, "registry_ids": sorted(registry),
                                 "registry_outputs": outputs,
                                 "additional_files": additional_files,
                                 "companions": native_companions(directory, files),
                                 "input_signature": selected, "runtime": runtime_source}
                        state["stages"][name] = stage
                        execution.phase("retain_stage", model=name)
                        register(workspace, key, name, stage)
                output_selection = {"nitrogen_export": ("ndr", "n_total_export"),
                                    "phosphorus_export": ("ndr", "p_surface_export"),
                                    "sediment_export": ("sdr", "sed_export")}
                for name in unfinished_outputs:
                    model, native_id = output_selection[name]
                    execution.phase("export", model=model, artifact=name)
                    stage = state["stages"][model]["files"]
                    if native_id not in stage:
                        raise ValueError("Original native registry lacks " + native_id)
                    source = verify_file(directory, stage[native_id])
                    target = directory / (name + ".tif")
                    summary = rasters.rate_to_mass(source, target, grid["grid"],
                                                   reporting_mask=paths["reporting_mask"], pollutant=name)
                    state["artifacts"][name] = describe_file(directory, target, **summary,
                                                            native_output=stage[native_id])
                    execution.save()
                state.update(state="complete", completed_at=now(), updated_at=now())
                state["model_scope"] = validate_completed_run(state)
                execution.finish()
                return state
            finally:
                if handler is not None:
                    root_logger.removeHandler(handler)
                    root_logger.setLevel(previous_level)
                    primary_failure = sys.exc_info()[1]
                    try:
                        handler.close()
                    except OSError:
                        if primary_failure is None:
                            raise

def compare_runs(workspace, ids):
    if len(ids) < 2 or len(set(ids)) != len(ids):
        raise ValueError("Select a baseline and at least one distinct alternative run")
    runs = [workspace.inspect_run(key) for key in ids]
    if any(r["state"] != "complete" for r in runs):
        raise ValueError("Finish the selected native model runs")
    common_outputs = common_comparison_outputs(runs)
    from .native_versions import comparison_versions, models_for_outputs
    versions = comparison_versions(runs, models_for_outputs(common_outputs))
    baseline = runs[0]
    if any(r["selection"]["grid_id"] != baseline["selection"]["grid_id"] for r in runs[1:]):
        raise ValueError("Run comparison requires the same retained reporting/model grid")
    key = digest({"runs": ids, "direction": "alternative minus baseline",
                  "native_version_provenance": versions})
    directory = workspace.root / "comparisons" / key
    directory.mkdir(parents=True, exist_ok=True)
    result = {"schema": "upstate.run-comparison/v1", "id": key, "baseline_run_id": ids[0],
              "direction": "alternative minus baseline", "alternatives": [],
              "common_artifacts": list(common_outputs),
              "native_version_provenance": versions,
              "model_scopes": {run["id"]: run_scope(run) for run in runs}}
    with held(directory / ".comparison.lock", blocking=False):
        previous_path = directory / "comparison.json"
        if previous_path.exists():
            previous = read_json(previous_path)
            if (previous.get("schema") != "upstate.run-comparison/v1"
                    or previous.get("id") != key
                    or previous.get("baseline_run_id") != ids[0]
                    or [r["run_id"] for r in previous.get("alternatives", [])] != ids[1:]
                    or previous.get("common_artifacts") != list(common_outputs)
                    or previous.get("native_version_provenance") != versions):
                raise ValueError("Retained comparison selection or native version provenance differs")
            for alternative in previous["alternatives"]:
                for artifact in alternative["artifacts"].values():
                    verify_file(directory, artifact)
            return previous
        for alternative in runs[1:]:
            value = {"run_id": alternative["id"], "selection": alternative["selection"],
                     "profile_changed": alternative["selection"]["profile_id"] != baseline["selection"]["profile_id"],
                     "artifacts": {}}
            for name in common_outputs:
                a = verify_file(workspace.root / "runs" / baseline["id"], baseline["artifacts"][name])
                b = verify_file(workspace.root / "runs" / alternative["id"], alternative["artifacts"][name])
                path = directory / (alternative["id"] + "-" + name + ".tif")
                summary = rasters.difference(a, b, path)
                value["artifacts"][name] = describe_file(directory, path, units=rasters.MASS_UNITS[name], **summary)
            result["alternatives"].append(value)
        atomic_json(directory / "comparison.json", result)
    return result
