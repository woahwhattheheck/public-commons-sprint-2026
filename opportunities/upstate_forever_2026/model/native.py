"""Execute the selected published InVEST engines inside their retained native run."""
from __future__ import annotations
import hashlib
import importlib
import importlib.metadata
import inspect
import logging
from pathlib import Path
from .common import (INVEST_SOURCE, INVEST_VERSION, atomic_json, describe_file, digest,
                     file_digest, held, identifier, now, read_json, verify_file)
from . import rasters
from .model_selection import (models, run_models, required_roles, required_outputs, run_scope,
                              validate_completed_run, common_comparison_outputs)
from .reuse import native_companions, registry_snapshot, verify_stage
from .stage_cache import runtime_environment, signature, recover, register, execution_slot
from .native_arguments import build_native_arguments


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
        # Donor choices describe execution, not scientific selection. Retain
        # them outside selection so a resumed run keeps its original item ID.
        retained_sources = (state.get("reuse_source_run_ids", ())
                            if reuse_source_run_ids is None else reuse_source_run_ids)
        if not isinstance(retained_sources, (list, tuple)):
            raise ValueError("Select original source run IDs as a list or tuple")
        retained_sources = tuple(dict.fromkeys(identifier(value) for value in retained_sources))
        if key in retained_sources:
            raise ValueError("Reuse source runs must differ from the receiving run")
        if reuse_source_run_ids is not None:
            state.update(reuse_source_run_ids=list(retained_sources), updated_at=now())
            atomic_json(directory / "run.json", state)
        modules, runtime_source = runtime(active)
        grid = workspace.get_grid(state["selection"]["grid_id"])
        grid_directory = workspace.root / "grids" / grid["id"]
        needed = required_roles(active) + ("model_domain", "reporting_mask")
        paths = {name: verify_file(grid_directory, grid["files"][name]) for name in needed}
        verified_inputs = {str(path.resolve()): grid["files"][name] for name, path in paths.items()}
        profile = workspace._get("profiles", state["selection"]["profile_id"])
        scenario = workspace._get("scenarios", state["selection"]["scenario_id"])
        table, table_entry = workspace.source_file(profile["source_collection_id"], profile["biophysical_source_id"])
        if table_entry["body"]["sha256"] != profile["table_summary"]["sha256"]:
            raise ValueError("Original biophysical table differs from the saved profile")
        # source_file has just verified the original object and native view.
        verified_inputs[str(table.resolve())] = table_entry["body"]
        previous_runtime = state.get("runtime")
        if previous_runtime and previous_runtime != runtime_source:
            state.setdefault("runtime_history", []).append(
                {"recorded_at": now(), "runtime": previous_runtime})
        for name in active:
            if name in state["stages"] and "runtime" not in state["stages"][name] and previous_runtime:
                state["stages"][name]["runtime"] = previous_runtime
        state.update(state="running", updated_at=now(), runtime=runtime_source)
        state.pop("error", None)
        state.pop("validation", None)
        atomic_json(directory / "run.json", state)
        handler = logging.FileHandler(directory / "native.log", encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(asctime)s %(name)s %(levelname)s %(message)s"))
        root_logger = logging.getLogger()
        previous_level = root_logger.level
        root_logger.setLevel(logging.INFO)
        root_logger.addHandler(handler)
        try:
            lulc = paths["NLCD"]
            if scenario["kind"] == "landcover":
                if "landcover" in state["stages"]:
                    lulc = verify_file(directory, state["stages"]["landcover"]["artifact"])
                else:
                    lulc = directory / "scenario_lulc.tif"
                    edits = rasters.make_scenario(
                        paths["NLCD"], lulc, grid["grid"], scenario["patches"],
                        source_loader=lambda sid: workspace.source_file(scenario["source_collection_id"], sid),
                        allowed_codes=set(profile["table_summary"]["lucodes"]))
                    state["stages"]["landcover"] = {"completed_at": now(), "edits": edits,
                                                    "artifact": describe_file(directory, lulc, units="class")}
                    atomic_json(directory / "run.json", state)
            if scenario["kind"] == "landcover":
                verified_inputs[str(lulc.resolve())] = state["stages"]["landcover"]["artifact"]
            arguments = build_native_arguments(active, profile, paths, table, lulc)
            input_matcher = None
            if retained_sources:
                from .native_equivalence import NativeInputMatcher
                input_matcher = NativeInputMatcher(
                    workspace, key, target_lulc=lulc, target_runtime=runtime_source)
            for name, module in modules.items():
                args = {**arguments[name], "workspace_dir": str(directory / name)}
                if name in state["stages"]:
                    verify_stage(directory, state["stages"][name])
                    # An original pre-selection stage stays intact. Indexing it
                    # requires the input/runtime signature recorded at execution.
                    register(workspace, key, name, state["stages"][name])
                    continue
                selected = signature(name, args, runtime_source, verified_inputs=verified_inputs)
                with execution_slot(workspace, selected):
                    reused, rejected = recover(
                        workspace, key, name, selected, directory, args,
                        source_run_ids=retained_sources, matcher=input_matcher)
                    if rejected:
                        state.setdefault("reuse_observations", {})[name] = rejected
                    if reused is not None:
                        state["stages"][name] = reused
                        register(workspace, key, name, reused)
                        atomic_json(directory / "run.json", state)
                        logging.getLogger(__name__).info(
                            "Reused original %s stage from run %s", name, reused["reused_from"]["run_id"])
                        continue
                    args_path = directory / (name + "-arguments.json")
                    atomic_json(args_path, args)
                    errors = module.validate(args)
                    if errors:
                        state["validation"] = {name: [{"fields": list(fields), "message": message}
                                                       for fields, message in errors]}
                        raise ValueError("Native " + name.upper() + " validation: " +
                                         "; ".join(message for _, message in errors))
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
                    atomic_json(directory / "run.json", state)
                    register(workspace, key, name, stage)
            output_selection = {"nitrogen_export": ("ndr", "n_total_export"),
                                "phosphorus_export": ("ndr", "p_surface_export"),
                                "sediment_export": ("sdr", "sed_export")}
            for name in required_outputs(active):
                model, native_id = output_selection[name]
                if name in state["artifacts"]:
                    verify_file(directory, state["artifacts"][name])
                    continue
                stage = state["stages"][model]["files"]
                if native_id not in stage:
                    raise ValueError("Original native registry lacks " + native_id)
                source = verify_file(directory, stage[native_id])
                target = directory / (name + ".tif")
                summary = rasters.rate_to_mass(source, target, grid["grid"],
                                               reporting_mask=paths["reporting_mask"], pollutant=name)
                state["artifacts"][name] = describe_file(directory, target, **summary,
                                                        native_output=stage[native_id])
                atomic_json(directory / "run.json", state)
            state.update(state="complete", completed_at=now(), updated_at=now())
            state["model_scope"] = validate_completed_run(state)
            atomic_json(directory / "run.json", state)
            return state
        except BaseException as exc:
            state.update(state="failed", updated_at=now(),
                         error={"type": type(exc).__name__, "message": str(exc)})
            state["model_scope"] = run_scope(state)
            atomic_json(directory / "run.json", state)
            raise
        finally:
            root_logger.removeHandler(handler)
            root_logger.setLevel(previous_level)
            handler.close()

def compare_runs(workspace, ids):
    if len(ids) < 2 or len(set(ids)) != len(ids):
        raise ValueError("Select a baseline and at least one distinct alternative run")
    runs = [workspace.inspect_run(key) for key in ids]
    if any(r["state"] != "complete" for r in runs):
        raise ValueError("Finish the selected native model runs")
    common_outputs = common_comparison_outputs(runs)
    baseline = runs[0]
    if any(r["selection"]["grid_id"] != baseline["selection"]["grid_id"] for r in runs[1:]):
        raise ValueError("Run comparison requires the same retained reporting/model grid")
    key = digest({"runs": ids, "direction": "alternative minus baseline"})
    directory = workspace.root / "comparisons" / key
    directory.mkdir(parents=True, exist_ok=True)
    result = {"schema": "upstate.run-comparison/v1", "id": key, "baseline_run_id": ids[0],
              "direction": "alternative minus baseline", "alternatives": [],
              "common_artifacts": list(common_outputs),
              "model_scopes": {run["id"]: run_scope(run) for run in runs}}
    with held(directory / ".comparison.lock", blocking=False):
        previous_path = directory / "comparison.json"
        if previous_path.exists():
            previous = read_json(previous_path)
            if previous.get("baseline_run_id") != ids[0] or [r["run_id"] for r in previous.get("alternatives", [])] != ids[1:]:
                raise ValueError("Retained comparison selection differs")
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
