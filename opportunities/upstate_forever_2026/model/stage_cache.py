"""Content-selected reuse of original native stages within this workspace."""
from __future__ import annotations
import importlib.metadata
import platform
from pathlib import Path
import sys
from .common import atomic_json, describe_file, digest, file_digest, identifier, now, read_json
from .model_selection import run_models
from .reuse import copy_verified, destination_file, native_companions, verify_stage

INPUT_PATHS = {
    "ndr": ("dem_path", "lulc_path", "watersheds_path", "biophysical_table_path", "runoff_proxy_path"),
    "sdr": ("dem_path", "lulc_path", "watersheds_path", "biophysical_table_path",
            "erosivity_path", "erodibility_path", "drainage_path"),
}


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


def signature(model, arguments, runtime_source, *, verified_inputs=None):
    if model not in INPUT_PATHS:
        raise ValueError("Select a published native model")
    values = {key: value for key, value in arguments.items()
              if key not in ("workspace_dir",) + INPUT_PATHS[model]}
    inputs = {}
    for name in INPUT_PATHS[model]:
        selected_path = arguments.get(name)
        if selected_path in (None, ""):
            inputs[name] = None
            continue
        path = Path(selected_path).resolve(strict=True)
        if not path.is_file():
            raise ValueError("Native stage input is not an original regular file: " + name)
        retained = (verified_inputs or {}).get(str(path))
        if retained is not None:
            if path.stat().st_size != retained["bytes"]:
                raise ValueError("Verified native input length changed: " + name)
            inputs[name] = {"bytes": retained["bytes"], "sha256": retained["sha256"]}
        else:
            inputs[name] = {"bytes": path.stat().st_size, "sha256": file_digest(path)}
        companions = []
        suffix = path.suffix.lower()
        if suffix == ".shp":
            candidates = [item for item in path.parent.glob(path.stem + ".*") if item != path]
        elif suffix in (".tif", ".tiff"):
            candidates = [Path(str(path) + tail) for tail in (".aux.xml", ".msk", ".ovr")]
        else:
            candidates = []
        for companion in sorted(candidates):
            if companion.is_file():
                companions.append({"name": companion.name, "bytes": companion.stat().st_size,
                                   "sha256": file_digest(companion)})
        if companions:
            inputs[name]["companions"] = companions
    dependencies = ("ndr", "sdr") if model == "ndr" else ("sdr",)
    modules = {name: runtime_source["modules"][name] for name in dependencies}
    selection = {"schema": "upstate.native-stage-inputs/v1", "model": model,
                 "invest_version": runtime_source["version"], "modules": modules,
                 "environment": runtime_source["environment"], "arguments": values, "inputs": inputs}
    return {"id": digest(selection), "selection": selection}


def register(workspace, run_id, model, stage):
    selected = stage.get("input_signature")
    if not selected:
        return
    if digest(selected["selection"]) != selected["id"]:
        raise ValueError("Native stage input identity differs")
    run_id = identifier(run_id)
    key = identifier(selected["id"])
    record = {"schema": "upstate.native-stage-cache/v1", "id": key,
              "run_id": run_id, "model": model, "completed_at": stage["completed_at"]}
    atomic_json(workspace.root / "stage-cache" / key / (run_id + "-" + model + ".json"),
                record, immutable=True)


def _check_destinations(directory, files):
    seen = {}
    for item in files:
        path = item["path"]
        if path in seen and (seen[path]["bytes"], seen[path]["sha256"]) != (item["bytes"], item["sha256"]):
            raise ValueError("Native reuse has conflicting original output paths")
        seen[path] = item
        target = destination_file(directory, path)
        if target.exists():
            from .common import verify_file
            verify_file(directory, item)


def recover(workspace, run_id, model, selected, directory, requested_arguments):
    """Return an original matching stage, or None; malformed candidates stay explicit.

    Only completed stages recorded by this adapter are indexed. A surviving stage
    in a later failed run remains useful. Every retained body is checked before
    it is linked/copied; unindexed historical runs remain readable normally.
    """
    folder = workspace.root / "stage-cache" / identifier(selected["id"])
    observations = []
    candidates = sorted(folder.glob("*-" + model + ".json")) if folder.exists() else []
    for path in candidates:
        try:
            record = read_json(path)
            if (record.get("schema") != "upstate.native-stage-cache/v1"
                    or record.get("id") != selected["id"] or record.get("model") != model):
                raise ValueError("Native reuse index differs")
            original_id = identifier(record["run_id"])
            if original_id == run_id:
                continue
            original = workspace.inspect_run(original_id)
            if model not in run_models(original):
                raise ValueError("Original run did not select this native model")
            stage = original["stages"][model]
            if stage.get("input_signature") != selected:
                raise ValueError("Original stage inputs differ")
            old_directory = workspace.root / "runs" / original_id
            verify_stage(old_directory, stage)
            companions = native_companions(old_directory, stage["files"])
            by_path = {item["path"]: item for item in stage.get("companions", [])}
            by_path.update({item["path"]: item for item in companions})
            companions = [by_path[name] for name in sorted(by_path)]
            output_files = list(stage["files"].values()) + companions
            original_arguments = {**stage["arguments"], "path": model + "-source-arguments.json"}
            _check_destinations(directory, output_files + [original_arguments])
        except (OSError, ValueError, KeyError, TypeError) as exc:
            observations.append({"index": path.relative_to(workspace.root).as_posix(),
                                 "reason": str(exc)})
            continue
        # Mutation starts only after the full original candidate and all existing
        # destinations have been checked. Any I/O failure leaves this same run
        # resumable, with no unrelated original or output replaced.
        files = {name: copy_verified(old_directory, item, directory)
                 for name, item in stage["files"].items()}
        copied_companions = [copy_verified(old_directory, item, directory) for item in companions]
        source_arguments = copy_verified(old_directory, stage["arguments"], directory,
                                         path=original_arguments["path"])
        request_path = directory / (model + "-arguments.json")
        atomic_json(request_path, requested_arguments)
        result = {
            **stage, "arguments": source_arguments, "files": files,
            "companions": copied_companions,
            "requested_arguments": describe_file(directory, request_path),
            "input_signature": selected,
            "reused_at": now(),
            "reused_from": {
                "run_id": original_id, "model": model,
                "stage_completed_at": stage["completed_at"],
                "input_signature": selected["id"],
                "original_arguments": stage["arguments"],
                "previous_reuse": stage.get("reused_from"),
            },
        }
        return result, observations
    return None, observations
