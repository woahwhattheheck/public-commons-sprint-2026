"""Content-selected reuse of original native stages within this workspace."""
from __future__ import annotations
import copy
import importlib.metadata
import logging
import platform
from pathlib import Path
import sys
from .common import (atomic_json, describe_file, digest, file_digest, held,
                     identifier, now, read_json)
from .model_selection import run_models
from .reuse import (copy_verified, dataset_companions, destination_file,
                    native_companions, verify_stage)

INPUT_PATHS = {
    "ndr": ("dem_path", "lulc_path", "watersheds_path", "biophysical_table_path", "runoff_proxy_path"),
    "sdr": ("dem_path", "lulc_path", "watersheds_path", "biophysical_table_path",
            "erosivity_path", "erodibility_path", "drainage_path"),
}
LOGGER = logging.getLogger(__name__)


def runtime_environment():
    """Record the actual native environment used for an exact-stage match."""
    result = {"python": list(sys.version_info[:3]), "implementation": platform.python_implementation(),
              "system": platform.system(), "machine": platform.machine(), "packages": {}}
    for package in ("natcap.invest", "numpy", "scipy", "pygeoprocessing",
                    "taskgraph", "GDAL", "shapely", "pandas", "pint"):
        try:
            result["packages"][package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            result["packages"][package] = None
    try:
        from osgeo import gdal
        result["gdal"] = gdal.VersionInfo("--version")
    except ImportError:
        result["gdal"] = None
    return result


def _input_body(path, verified_inputs):
    path = Path(path).resolve(strict=True)
    if not path.is_file():
        raise ValueError("Native stage input is not an original regular file")
    retained = (verified_inputs or {}).get(str(path))
    if retained is not None:
        if path.stat().st_size != retained["bytes"]:
            raise ValueError("Verified native input length changed: " + path.name)
        return {"bytes": retained["bytes"], "sha256": retained["sha256"]}
    return {"bytes": path.stat().st_size, "sha256": file_digest(path)}


def signature(model, arguments, runtime_source, *, verified_inputs=None):
    if model not in INPUT_PATHS:
        raise ValueError("Select a published native model")
    values = {key: value for key, value in arguments.items()
              if key not in ("workspace_dir", "n_workers") + INPUT_PATHS[model]}
    inputs = {}
    for name in INPUT_PATHS[model]:
        selected_path = arguments.get(name)
        if selected_path in (None, ""):
            inputs[name] = None
            continue
        path = Path(selected_path).resolve(strict=True)
        body = _input_body(path, verified_inputs)
        companions = {member.name[len(path.stem):]: _input_body(member, verified_inputs)
                      for member in dataset_companions(path)}
        if companions:
            body["companions"] = companions
        inputs[name] = body
    dependencies = ("ndr", "sdr") if model == "ndr" else ("sdr",)
    modules = {name: runtime_source["modules"][name] for name in dependencies}
    selection = {"schema": "upstate.native-stage-inputs/v1", "model": model,
                 "invest_version": runtime_source["version"], "modules": modules,
                 "environment": runtime_source["environment"], "arguments": values, "inputs": inputs}
    # results_suffix remains part of values because it determines registry names.
    return {"id": digest(selection), "selection": selection}


def _scientific_signature(selected):
    if digest(selected["selection"]) != selected["id"]:
        raise ValueError("Native stage input identity differs")
    value = selected["selection"]
    if (value.get("schema") != "upstate.native-stage-inputs/v1"
            or value.get("model") not in INPUT_PATHS):
        raise ValueError("Native stage input selection has an unknown model")
    value = {**value, "arguments": {key: item for key, item in value["arguments"].items()
                                   if key != "n_workers"}}
    return {"id": digest(value), "selection": value}


def execution_slot(workspace, selected):
    """Serialize production of a matching stage through the existing native loop."""
    selected = _scientific_signature(selected)
    return held(workspace.root / "stage-cache" / identifier(selected["id"]) / ".compute.lock")


def register(workspace, run_id, model, stage):
    original = stage.get("input_signature")
    if not original:
        return
    selected = _scientific_signature(original)
    if selected["selection"]["model"] != model or not stage.get("completed_at"):
        raise ValueError("The indexed native stage differs from its completed model")
    run_id = identifier(run_id)
    key = identifier(selected["id"])
    record = {"schema": "upstate.native-stage-cache/v1", "id": key,
              "run_id": run_id, "model": model, "completed_at": stage["completed_at"],
              "source_input_signature": original["id"]}
    try:
        # The pointer can be refreshed after an interrupted operation is resumed.
        # Original run records and their input snapshots remain authoritative.
        atomic_json(workspace.root / "stage-cache" / key / (run_id + "-" + model + ".json"),
                    record)
    except OSError as exc:
        LOGGER.info("Completed native %s stage retained; index update deferred: %s", model, exc)


def _check_destinations(directory, files):
    seen = {}
    for item in files:
        path = item["path"]
        if path in seen and (seen[path]["bytes"], seen[path]["sha256"]) != (item["bytes"], item["sha256"]):
            raise ValueError("Native reuse has conflicting original output paths")
        seen[path] = item
        destination_file(directory, path)


def _native_member(directory, model, relative):
    if not isinstance(relative, str) or not Path(relative).parts or Path(relative).parts[0] != model:
        raise ValueError("Native reuse output belongs to another model stage")
    return destination_file(directory, relative)


def _candidate_indexes(workspace, model, selected, requested_arguments):
    keys = [selected["id"]]
    if "n_workers" in requested_arguments:
        # Older indexed stages retained this scheduling control. Look up their
        # exact predecessor key while comparing the same scientific selection.
        previous = copy.deepcopy(selected["selection"])
        previous["arguments"]["n_workers"] = requested_arguments["n_workers"]
        old_key = digest(previous)
        if old_key not in keys:
            keys.append(old_key)
    for key in keys:
        folder = workspace.root / "stage-cache" / identifier(key)
        for path in sorted(folder.glob("*-" + model + ".json")):
            yield key, path


def recover(workspace, run_id, model, selected, directory, requested_arguments):
    """Copy a complete matching stage, retaining its original source provenance.

    Every output body is verified during its independent transfer. Interrupted
    transfers retain complete matching files and can continue with the same or
    another available source. Historical stages require their recorded input
    signature; they are never re-keyed from today's input files.
    """
    selected = _scientific_signature(selected)
    if selected["selection"]["model"] != model:
        raise ValueError("Native stage request selects another model")
    run_id = identifier(run_id)
    observations, seen = [], set()
    for index_key, path in _candidate_indexes(workspace, model, selected, requested_arguments):
        try:
            record = read_json(path)
            if (record.get("schema") != "upstate.native-stage-cache/v1"
                    or record.get("id") != index_key or record.get("model") != model):
                raise ValueError("Native reuse index differs")
            original_id = identifier(record["run_id"])
            if original_id == run_id or original_id in seen:
                continue
            seen.add(original_id)
            original = workspace.inspect_run(original_id)
            if model not in run_models(original):
                raise ValueError("Original run did not select this native model")
            stage = original["stages"][model]
            if _scientific_signature(stage["input_signature"]) != selected:
                raise ValueError("Original stage inputs differ")
            old_directory = workspace.root / "runs" / original_id
            # Descriptor arguments are small; large outputs are hashed exactly
            # as they are copied or cloned below, rather than in a second pass.
            verify_stage(old_directory, stage, outputs=False)
            companion_map = {item["path"]: item for item in stage.get("companions", [])}
            for item in native_companions(old_directory, stage["files"]):
                companion_map.setdefault(item["path"], item)
            companions = [companion_map[name] for name in sorted(companion_map)]
            additional_files = list(stage.get("additional_files", []))
            output_files = list(stage["files"].values()) + companions + additional_files
            for item in output_files:
                _native_member(directory, model, item["path"])
            registry_outputs = stage.get("registry_outputs", {})
            directories = []
            for item in registry_outputs.values():
                if item.get("kind") == "directory":
                    directories.append(_native_member(directory, model, item["path"]))
                    directories.extend(_native_member(directory, model, member)
                                       for member in item.get("directories", []))
            original_arguments = {**stage["arguments"],
                "path": model + "-source-arguments-" + stage["arguments"]["sha256"] + ".json"}
            _check_destinations(directory, output_files + [original_arguments])
            transfer = {"files": 0, "bytes": 0, "methods": {}}
            reuse_started = now()
            copied = {}
            for item in output_files:
                if item["path"] not in copied:
                    copied[item["path"]] = copy_verified(
                        old_directory, item, directory, transfer=transfer,
                        replace_mismatch=True)
            files = {name: dict(item) for name, item in stage["files"].items()}
            copied_companions = [dict(item) for item in companions]
            source_arguments = copy_verified(
                old_directory, stage["arguments"], directory,
                path=original_arguments["path"], transfer=transfer,
                replace_mismatch=True)
            for target in directories:
                target.mkdir(parents=True, exist_ok=True)
            request_path = directory / (model + "-arguments.json")
            atomic_json(request_path, requested_arguments)
            completed = now()
            result = {
                **stage, "arguments": source_arguments, "files": files,
                "companions": copied_companions,
                "additional_files": [dict(item) for item in additional_files],
                "requested_arguments": describe_file(directory, request_path),
                "input_signature": selected,
                "reuse_started_at": reuse_started,
                "reused_at": completed, "transfer": transfer,
                "reused_from": {
                    "run_id": original_id, "model": model,
                    "stage_started_at": stage.get("started_at"),
                    "stage_completed_at": stage["completed_at"],
                    "input_signature": stage["input_signature"]["id"],
                    "requested_input_signature": selected["id"],
                    "original_arguments": stage["arguments"],
                    "previous_reuse": stage.get("reused_from"),
                },
            }
            return result, observations
        except (OSError, ValueError, KeyError, TypeError) as exc:
            observations.append({"index": path.relative_to(workspace.root).as_posix(),
                                 "reason": str(exc)})
            continue
    return None, observations
