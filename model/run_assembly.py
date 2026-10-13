"""Complete one native run using explicitly selected original NDR and SDR stages."""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path, PurePosixPath
from .common import (INVEST_SOURCE, INVEST_VERSION, MODEL_OUTPUTS, atomic_json, canonical,
                     describe_file, digest, held, identifier, now, read_json, verify_file)
from .grid_reuse import source_identity
from .model_selection import run_models, required_roles, run_scope
from .native_arguments import build_native_arguments
from .reuse import copy_verified, destination_file, native_companions, verify_stage
from .stage_cache import INPUT_PATHS

SCHEMA = "upstate.completed-model-assembly/v1"
ROLES = {"dem_path": "DEM", "runoff_proxy_path": "PRECIPITATION",
         "erosivity_path": "R_FACTOR", "erodibility_path": "K_FACTOR",
         "watersheds_path": "model_domain"}


def _number(value):
    if isinstance(value, float) and not math.isfinite(value):
        return {"nonfinite": "nan" if math.isnan(value) else "infinity" if value > 0 else "-infinity"}
    return value


def _raster_data(path):
    """Hash every actual cell and mask in fixed windows; compression is immaterial."""
    import rasterio
    from rasterio.windows import Window
    with rasterio.Env(GDAL_CACHEMAX=64 * 1024 * 1024), rasterio.open(path) as src:
        header = {"count": src.count, "width": src.width, "height": src.height,
                  "crs": src.crs.to_wkt() if src.crs else None,
                  "transform": [_number(value) for value in tuple(src.transform)],
                  "dtypes": list(src.dtypes), "nodata": [_number(value) for value in src.nodatavals],
                  "scales": [_number(value) for value in src.scales],
                  "offsets": [_number(value) for value in src.offsets], "units": list(src.units)}
        result = hashlib.sha256(canonical(header))
        for row in range(0, src.height, 512):
            for column in range(0, src.width, 512):
                window = Window(column, row, min(512, src.width - column),
                                min(512, src.height - row))
                result.update(canonical([column, row, int(window.width), int(window.height)]))
                for band in range(1, src.count + 1):
                    values = src.read(band, window=window)
                    result.update(values.astype(values.dtype.newbyteorder("<"), copy=False).tobytes(order="C"))
                    result.update(src.read_masks(band, window=window).tobytes(order="C"))
        return {"schema": "upstate.exact-native-raster/v1", "sha256": result.hexdigest(),
                "header": header}


def _vector_data(path):
    """Hash ordered native layers, schema, feature IDs, attributes and coordinates."""
    import fiona
    from shapely.geometry import mapping, shape
    from .rasters import native_vector_path, vector_environment
    result = hashlib.sha256()
    with vector_environment():
        source = native_vector_path(path)
        layers = fiona.listlayers(source)
        result.update(canonical({"schema": "upstate.exact-native-vector/v1", "layers": layers}))
        counts = {}
        for layer in layers:
            with fiona.open(source, layer=layer) as src:
                result.update(canonical({"layer": layer, "crs": src.crs_wkt,
                    "geometry": src.schema["geometry"],
                    "properties": list(src.schema["properties"].items())}) + b"\n")
                count = 0
                for feature in src:
                    geometry = mapping(shape(feature["geometry"])) if feature["geometry"] else None
                    result.update(canonical({"id": str(feature.id), "properties": dict(feature["properties"]),
                                             "geometry": geometry}) + b"\n")
                    count += 1
                counts[layer] = count
                result.update(canonical({"features": count}) + b"\n")
    return {"schema": "upstate.exact-native-vector/v1", "sha256": result.hexdigest(),
            "layer_features": counts}


def _verified(root, descriptor, cache):
    key = (str(root), descriptor["path"], descriptor["bytes"], descriptor["sha256"])
    if key not in cache:
        cache[key] = verify_file(root, descriptor)
    return cache[key]


def _input(workspace, path, descriptor):
    companions = native_companions(path.parent, {"body": {**descriptor, "path": path.name}})
    def companion_name(item):
        name = Path(item["path"]).name
        return name[len(path.stem):] if path.suffix.lower() == ".shp" else name[len(path.name):]
    return {"path": path, "descriptor": descriptor,
            "record": {"path": path.relative_to(workspace.root).as_posix(),
                       "bytes": descriptor["bytes"], "sha256": descriptor["sha256"],
                       "units": descriptor.get("units"),
                       "companions": [{"name": companion_name(item), "bytes": item["bytes"],
                                       "sha256": item["sha256"]} for item in companions]}}


def _scenario(workspace, value):
    if value["kind"] == "baseline":
        return {"kind": "baseline"}
    patches = []
    for patch in value["patches"]:
        patches.append({"source": source_identity(workspace, value["source_collection_id"],
                                                  patch["mask_source_id"]),
                        "layer": patch.get("layer"), "where": patch.get("where"),
                        "from_codes": sorted(set(patch["from_codes"])), "to_code": patch["to_code"]})
    return {"kind": "landcover", "patches": patches}


def _context(workspace, run, active, verified):
    directory = workspace.root / "runs" / run["id"]
    grid = workspace.get_grid(run["selection"]["grid_id"])
    grid_directory = workspace.root / "grids" / grid["id"]
    profile = workspace._get("profiles", run["selection"]["profile_id"])
    scenario = workspace._get("scenarios", run["selection"]["scenario_id"])
    names = tuple(dict.fromkeys(required_roles(active) + ("model_domain", "reporting_mask")))
    paths = {name: _verified(grid_directory, grid["files"][name], verified) for name in names}
    table, entry = workspace.source_file(profile["source_collection_id"], profile["biophysical_source_id"])
    if entry["body"]["sha256"] != profile["table_summary"]["sha256"]:
        raise ValueError("The original biophysical table differs from its saved profile")
    inputs = {name: _input(workspace, paths[role], grid["files"][role])
              for name, role in ROLES.items() if role in paths}
    inputs["biophysical_table_path"] = _input(workspace, table, entry["body"])
    inputs["baseline_landcover"] = _input(workspace, paths["NLCD"], grid["files"]["NLCD"])
    inputs["reporting_mask"] = _input(workspace, paths["reporting_mask"], grid["files"]["reporting_mask"])
    if scenario["kind"] == "landcover":
        lulc = directory / "scenario_lulc.tif"
        if "landcover" in run["stages"]:
            descriptor = run["stages"]["landcover"]["artifact"]
            original = _verified(directory, descriptor, verified)
            if original != lulc:
                raise ValueError("The retained land-cover preparation uses another native path")
            inputs["lulc_path"] = _input(workspace, original, descriptor)
    else:
        lulc = paths["NLCD"]
        inputs["lulc_path"] = inputs["baseline_landcover"]
    arguments = {name: {**values, "workspace_dir": str(directory / name)}
                 for name, values in build_native_arguments(active, profile, paths, table, lulc).items()}
    return {"run": run, "directory": directory, "grid": grid, "profile": profile,
            "scenario": scenario, "scenario_selection": _scenario(workspace, scenario),
            "inputs": inputs, "arguments": arguments}


def _stage(context, model, workspace):
    run = context["run"]
    if model not in run_models(run) or model not in run.get("stages", {}):
        raise ValueError("The selected source run has no completed " + model.upper() + " stage")
    stage = run["stages"][model]
    verify_stage(context["directory"], stage)
    for _, (owner, output) in MODEL_OUTPUTS.items():
        if owner == model and output not in stage["files"]:
            raise ValueError("The completed " + model.upper() + " registry lacks " + output)
    source = stage.get("runtime") or run.get("runtime")
    if not isinstance(source, dict) or source.get("version") != INVEST_VERSION:
        raise ValueError("Retain the original completed stage's native runtime record")
    if source.get("modules", {}).get(model, {}).get("git_blob") != INVEST_SOURCE[model + "_blob"]:
        raise ValueError("The completed native stage uses another published implementation")
    # Earlier selected-stage adapters recorded the executed module. Retain that
    # original runtime exactly; check additional dependency pins when recorded.
    for name in ("ndr", "sdr"):
        module = source.get("modules", {}).get(name)
        if module is not None and module.get("git_blob") != INVEST_SOURCE[name + "_blob"]:
            raise ValueError("A recorded native dependency uses another published implementation")
    if stage.get("input_signature"):
        selected = stage["input_signature"]
        if digest(selected["selection"]) != selected["id"]:
            raise ValueError("The completed stage's retained input identity changed")
    argument_file = stage.get("requested_arguments") or stage["arguments"]
    original_arguments = read_json(verify_file(context["directory"], argument_file))
    expected = context["arguments"][model]
    if set(original_arguments) != set(expected):
        raise ValueError("The source run's original native argument fields differ")
    # Portable receiving changes the workspace prefix. Derive that one original
    # prefix from the saved workspace_dir and match every input beneath it.
    saved_directory = original_arguments.get("workspace_dir")
    suffix = "/runs/" + run["id"] + "/" + model
    if (not isinstance(saved_directory, str) or not saved_directory.endswith(suffix)
            or not saved_directory.startswith("/") or "\\" in saved_directory):
        raise ValueError("The original native arguments select another run directory")
    original_root = PurePosixPath(saved_directory[:-len(suffix)] or "/")
    for name, value in expected.items():
        if name == "workspace_dir":
            continue
        observed = original_arguments[name]
        if name in INPUT_PATHS[model] and value not in (None, ""):
            relative = Path(value).relative_to(workspace.root).as_posix()
            if observed != str(original_root / relative):
                raise ValueError("The original native input path differs: " + model + "." + name)
        elif observed != value:
            raise ValueError("The original native argument differs: " + model + "." + name)
    if "lulc_path" not in context["inputs"]:
        raise ValueError("Retain the source run's completed land-cover preparation")
    return {**stage, "runtime": source}


def _match(name, old, new, exact):
    left, right = old["record"], new["record"]
    content = lambda value: {key: value[key] for key in ("bytes", "sha256", "units", "companions")}
    mode, evidence = "original_bytes", None
    if content(left) != content(right):
        if left["units"] != right["units"]:
            raise ValueError("Completed-stage input units differ: " + name)
        suffixes = {old["path"].suffix.lower(), new["path"].suffix.lower()}
        if suffixes <= {".tif", ".tiff"}:
            reader, mode = _raster_data, "every_native_cell_and_mask"
        elif suffixes <= {".gpkg", ".shp", ".geojson", ".json"} and name == "watersheds_path":
            reader, mode = _vector_data, "every_native_feature_and_attribute"
        else:
            raise ValueError("Completed-stage original input bytes differ: " + name)
        values = []
        for item in (old, new):
            key = (mode, digest(content(item["record"])))
            if key not in exact:
                exact[key] = reader(item["path"])
            values.append(exact[key])
        if values[0] != values[1]:
            raise ValueError("Completed-stage native input values differ: " + name)
        evidence = values[0]
    return {"input": name, "match": mode, "source": left, "target": right,
            **({"native_data": evidence} if evidence is not None else {})}


def _matches(model, original, target, exact):
    from pyproj import CRS
    left_grid, right_grid = original["grid"]["grid"], target["grid"]["grid"]
    if CRS.from_user_input(left_grid["crs"]) != CRS.from_user_input(right_grid["crs"]):
        raise ValueError("The completed native stage uses another model coordinate system")
    fields = ("transform", "width", "height", "resolution_m", "pixel_area_ha")
    if {key: left_grid[key] for key in fields} != {key: right_grid[key] for key in fields}:
        raise ValueError("The completed native stage uses another physical reporting/model grid")
    if original["scenario_selection"] != target["scenario_selection"]:
        raise ValueError("The completed native stage uses another land-cover scenario")
    a = {key: value for key, value in original["arguments"][model].items()
         if key not in INPUT_PATHS[model] and key != "workspace_dir"}
    b = {key: value for key, value in target["arguments"][model].items()
         if key not in INPUT_PATHS[model] and key != "workspace_dir"}
    if a != b:
        raise ValueError("The completed " + model.upper() + " stage uses other native parameters")
    names = tuple(dict.fromkeys(INPUT_PATHS[model] + ("baseline_landcover", "reporting_mask")))
    return [_match(name, original["inputs"][name], target["inputs"][name], exact)
            for name in names if name != "drainage_path"]


def _outputs(context, stage, model):
    companions = {item["path"]: item for item in stage.get("companions", [])}
    for item in native_companions(context["directory"], stage["files"]):
        companions.setdefault(item["path"], item)
    additional = list(stage.get("additional_files", []))
    bodies = list(stage["files"].values()) + list(companions.values()) + additional
    directories = set()
    for output in stage.get("registry_outputs", {}).values():
        if output.get("kind") == "directory":
            directories.add(output["path"])
            directories.update(output.get("directories", []))
    for relative in [item["path"] for item in bodies] + sorted(directories):
        if (not isinstance(relative, str) or not Path(relative).parts
                or Path(relative).parts[0] != model):
            raise ValueError("The original output belongs to another native model")
        original = destination_file(context["directory"], relative)
        if relative in directories and not original.is_dir():
            raise ValueError("Retain the original native registry directory: " + relative)
    argument_name = model + "-source-arguments-" + stage["arguments"]["sha256"] + ".json"
    original_arguments = {**stage["arguments"], "path": argument_name}
    return {"descriptors": bodies + [original_arguments],
            "companions": [companions[name] for name in sorted(companions)],
            "additional_files": additional, "directories": sorted(directories),
            "argument_name": argument_name}


def _preflight(directory, descriptors, original_directories=()):
    selected, directories = {}, set(original_directories)
    for item in descriptors:
        path = item["path"]
        if path in selected and (selected[path]["bytes"], selected[path]["sha256"]) != (
                item["bytes"], item["sha256"]):
            raise ValueError("The selected native stages have conflicting output paths: " + path)
        selected[path] = item
        destination = destination_file(directory, path)
        if destination.exists() and not destination.is_file():
            raise ValueError("A native output destination is not a regular file: " + path)
        directories.update(parent.as_posix() for parent in PurePosixPath(path).parents
                           if parent.as_posix() != ".")
    for relative in sorted(directories):
        if relative in selected:
            raise ValueError("A native output is selected as both file and directory: " + relative)
        target = destination_file(directory, relative)
        if target.exists() and not target.is_dir():
            raise ValueError("A native output directory is occupied by a file: " + relative)
    # Planned bodies belong only to unfinished target stages. Complete target
    # stages were verified separately and remain in place. An interrupted
    # transfer is replaced atomically by the next complete original body.


def seed_completed_models(workspace, selection, source_runs):
    """Seed the ordinary full run from selected original completed native stages."""
    if not isinstance(source_runs, dict) or set(source_runs) != {"ndr", "sdr"}:
        raise ValueError("Select the original NDR and SDR run IDs")
    sources = {name: identifier(source_runs[name]) for name in ("ndr", "sdr")}
    prepared = workspace.prepare_run(selection)
    if run_models(prepared) != ("ndr", "sdr"):
        raise ValueError("Prepare a combined NDR/SDR grid and parameter profile")
    directory = workspace.root / "runs" / prepared["id"]
    with held(directory / ".run.lock", blocking=False):
        state = workspace.inspect_run(prepared["id"])
        if state["state"] == "complete":
            return {**state, "reused": True}
        verified, exact = {}, {}
        originals, stages = {}, {}
        for name, key in sources.items():
            originals[name] = _context(workspace, workspace.inspect_run(key), (name,), verified)
            stages[name] = _stage(originals[name], name, workspace)
        target = _context(workspace, state, ("ndr", "sdr"), verified)
        if any(original["scenario_selection"] != target["scenario_selection"]
               for original in originals.values()):
            raise ValueError("Select completed native stages for the combined run's actual land-cover scenario")
        landcover, landcover_companions = None, []
        if target["scenario"]["kind"] == "landcover" and "lulc_path" not in target["inputs"]:
            owner = originals["ndr"]
            landcover = {**owner["run"]["stages"]["landcover"],
                         "reused_from_run_id": owner["run"]["id"]}
            original_lulc = owner["inputs"]["lulc_path"]
            target["inputs"]["lulc_path"] = {**original_lulc, "record": {
                **original_lulc["record"],
                "path": (directory / "scenario_lulc.tif").relative_to(workspace.root).as_posix()}}
            companions = {item["path"]: item for item in landcover.get("companions", [])}
            for item in native_companions(owner["directory"],
                                          {"landcover": landcover["artifact"]}):
                companions.setdefault(item["path"], item)
            landcover_companions = [companions[name] for name in sorted(companions)]
        matches = {name: _matches(name, originals[name], target, exact) for name in ("ndr", "sdr")}
        keep, planned, outputs, directories = {}, [], {}, []
        for name in ("ndr", "sdr"):
            if name in state["stages"]:
                keep[name] = _stage(target, name, workspace)
            else:
                outputs[name] = _outputs(originals[name], stages[name], name)
                planned.extend(outputs[name]["descriptors"])
                directories.extend(outputs[name]["directories"])
        if landcover is not None:
            planned.append(landcover["artifact"])
            planned.extend(landcover_companions)
        _preflight(directory, planned, directories)
        selected = {"schema": SCHEMA, "target_selection": state["selection"], "source_runs": sources}
        previous_assembly = state.get("assembly")
        assembly = {"schema": SCHEMA, "id": digest(selected), "selection": selected,
                    "created_at": now(), "models": {}, "source_workspace_id": workspace.project["id"]}
        if previous_assembly and previous_assembly["id"] == assembly["id"]:
            assembly["created_at"] = previous_assembly["created_at"]
        if previous_assembly and previous_assembly["id"] != assembly["id"]:
            # A previous completed stage remains useful in this ordinary run.
            # Its original assembly is retained in the full operation history.
            state.setdefault("assembly_history", []).append(state["assembly"])
        if landcover is not None:
            landcover_transfer = {"files": 0, "bytes": 0, "methods": {}}
            landcover["artifact"] = copy_verified(originals["ndr"]["directory"],
                landcover["artifact"], directory, path="scenario_lulc.tif",
                transfer=landcover_transfer, replace_mismatch=True)
            landcover["companions"] = [copy_verified(originals["ndr"]["directory"], item, directory,
                transfer=landcover_transfer, replace_mismatch=True) for item in landcover_companions]
            landcover["transfer"] = landcover_transfer
            state["stages"]["landcover"] = landcover
        for name in ("ndr", "sdr"):
            original, stage = originals[name], stages[name]
            if name in keep:
                state["stages"][name] = keep[name]
                retained = (previous_assembly.get("models", {}).get(name)
                            if previous_assembly and previous_assembly["id"] == assembly["id"] else None)
                assembly["models"][name] = retained or {"mode": "already_completed_in_target",
                    "requested_source_run_id": sources[name], "retained_stage": keep[name],
                    "input_matches": matches[name]}
                continue
            plan = outputs[name]
            transfer = {"files": 0, "bytes": 0, "methods": {},
                        "directories": len(plan["directories"])}
            reuse_started = now()
            copied = {}
            for item in (list(stage["files"].values()) + plan["companions"] +
                         plan["additional_files"]):
                if item["path"] not in copied:
                    copied[item["path"]] = copy_verified(original["directory"], item, directory,
                        transfer=transfer, replace_mismatch=True)
            files = {key: copied[item["path"]] for key, item in stage["files"].items()}
            copied_companions = [copied[item["path"]] for item in plan["companions"]]
            copied_additional = [copied[item["path"]] for item in plan["additional_files"]]
            for relative in plan["directories"]:
                destination_file(directory, relative).mkdir(parents=True, exist_ok=True)
            arguments = copy_verified(original["directory"], stage["arguments"], directory,
                path=plan["argument_name"], transfer=transfer, replace_mismatch=True)
            requested = directory / (name + "-arguments.json")
            atomic_json(requested, target["arguments"][name])
            state["stages"][name] = {**stage, "files": files, "companions": copied_companions,
                "additional_files": copied_additional, "arguments": arguments,
                "requested_arguments": describe_file(directory, requested),
                "reuse_started_at": reuse_started, "reused_at": now(), "transfer": transfer,
                "reused_from": {
                    "run_id": original["run"]["id"], "model": name,
                    "stage_completed_at": stage["completed_at"], "mode": "selected_completed_stage",
                    "input_signature": stage.get("input_signature", {}).get("id"),
                    "original_arguments": stage["arguments"], "previous_reuse": stage.get("reused_from")}}
            assembly["models"][name] = {"mode": "selected_completed_stage",
                "source_run_id": original["run"]["id"], "source_selection": original["run"]["selection"],
                "source_runtime": stage["runtime"], "source_arguments": stage["arguments"],
                "input_matches": matches[name]}
            # A complete adopted model is durable immediately. A subsequent I/O
            # interruption resumes this same run and preserves its original stages.
            state.update(state="prepared", updated_at=now(), assembly=assembly)
            state.pop("error", None)
            atomic_json(directory / "run.json", state)
        state.update(state="prepared", updated_at=now(), assembly=assembly)
        state.pop("error", None)
        state.pop("validation", None)
        state["model_scope"] = run_scope(state)
        atomic_json(directory / "run.json", state)
        return state


def combine_runs(workspace, selection, source_runs, *, execute=True):
    """Return the normal full run; execution finishes derived outputs and skips adopted engines."""
    state = seed_completed_models(workspace, selection, source_runs)
    return workspace.run(state["id"]) if execute else state


def main():
    from .workspace import Workspace
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--selection", type=Path, required=True)
    parser.add_argument("--source-runs", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    workspace = Workspace(args.workspace)
    result = combine_runs(workspace, read_json(args.selection), read_json(args.source_runs))
    if args.output:
        atomic_json(args.output, result)
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
