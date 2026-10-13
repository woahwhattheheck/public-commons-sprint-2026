"""Content-selected reuse of original native stages within this workspace."""
from __future__ import annotations
import copy
import importlib.metadata
import logging
import platform
from pathlib import Path
import sys
import time
from .common import (atomic_json, describe_file, digest, file_digest, held,
                     identifier, now, read_json, verify_file)
from .model_selection import run_models
from .native_execution import storage_exhausted
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


def _adopt_candidate_file(source_root, descriptor, directory, adopted, *, path=None,
                          transfer=None):
    """Track new or replaced inodes, including a late fsync failure."""
    relative = descriptor["path"] if path is None else path
    target = destination_file(directory, relative)
    before = target.stat() if target.exists() else None
    try:
        return copy_verified(source_root, descriptor, directory, path=path,
                             transfer=transfer, replace_mismatch=True)
    finally:
        try:
            current = target.lstat()
        except FileNotFoundError:
            current = None
        # An exact retained file keeps its pre-existing inode and is not ours
        # to remove if another member of this donor candidate fails later.
        if current is not None and (before is None or
                (current.st_dev, current.st_ino) != (before.st_dev, before.st_ino)):
            adopted[relative] = (target, current.st_dev, current.st_ino)


def _discard_candidate(adopted):
    """Remove only this failed attempt's still-owned destination inodes."""
    for target, device, inode in reversed(tuple(adopted.values())):
        try:
            current = target.lstat()
            if (current.st_dev, current.st_ino) == (device, inode):
                target.unlink()
        except FileNotFoundError:
            pass


def _discard_unselected_companions(directory, model, files, expected_paths):
    """Remove sidecars left by an interrupted older, differently encoded donor."""
    for item in files.values():
        path = _native_member(directory, model, item["path"])
        for companion in dataset_companions(path):
            relative = companion.relative_to(directory).as_posix()
            if relative not in expected_paths:
                _native_member(directory, model, relative).unlink()


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


class _ReuseProgress:
    """Publish small current-run observations without changing candidate identities."""

    def __init__(self, model, selected, callback):
        self.callback = callback
        self.started = time.monotonic()
        self.last_published = None
        self.value = {
            "schema": "upstate.native-stage-reuse-progress/v1",
            "model": model, "input_signature": selected["id"],
            "started_at": now(), "phase": "searching",
            "index_candidates_checked": 0, "explicit_candidates_checked": 0,
            "rejected_candidates": 0, "source_run_id": None,
            "candidate_kind": None, "files_completed": 0,
            "logical_bytes_completed": 0, "files_total": None,
            "logical_bytes_total": None, "current_file": None,
        }
        self.emit(force=True)

    def emit(self, *, force=False, **changes):
        self.value.update(changes)
        instant = time.monotonic()
        self.value.update(updated_at=now(), elapsed_seconds=max(0.0, instant - self.started))
        if self.callback and (force or self.last_published is None
                              or instant - self.last_published >= 1.0):
            # A progress-record write failure is an operation failure, not a
            # scientific donor mismatch to suppress while trying another donor.
            try:
                self.callback(copy.deepcopy(self.value))
            except Exception as error:
                raise RuntimeError("Could not retain native-stage reuse progress") from error
            self.last_published = instant
        return copy.deepcopy(self.value)

    def candidate(self, run_id, indexed):
        name = "index_candidates_checked" if indexed else "explicit_candidates_checked"
        self.value[name] += 1
        self.emit(phase="checking", source_run_id=run_id,
                  candidate_kind="exact_index" if indexed else "explicit_source",
                  files_completed=0, logical_bytes_completed=0,
                  files_total=None, logical_bytes_total=None, current_file=None)

    def transfer(self, transfer, *, current_file=None, phase="transferring", force=False):
        return self.emit(force=force, phase=phase, current_file=current_file,
                         files_completed=transfer["files"],
                         logical_bytes_completed=transfer["bytes"],
                         transfer_methods=dict(transfer["methods"]))


def recover(workspace, run_id, model, selected, directory, requested_arguments,
            *, source_run_ids=(), matcher=None, progress=None):
    """Copy a complete matching stage, retaining its original source provenance.

    Every output body is verified during its independent transfer. Interrupted
    transfers retain complete matching files and can continue with the same or
    another available source. Indexed stages require their recorded signature.
    Explicit source runs may also match actual scientific inputs through the
    receiving runtime; their original signature and comparison are retained.
    """
    selected = _scientific_signature(selected)
    if selected["selection"]["model"] != model:
        raise ValueError("Native stage request selects another model")
    run_id = identifier(run_id)
    if not isinstance(source_run_ids, (list, tuple)):
        raise ValueError("Select original source run IDs as a list or tuple")
    explicit = tuple(dict.fromkeys(identifier(value) for value in source_run_ids))
    # Resolve exact content signatures before potentially reading raster values
    # for explicit cross-edition donors. The index is advisory: original stage
    # signatures and every copied output remain authoritative.
    candidates = [(index_key, path, None) for index_key, path in
                  _candidate_indexes(workspace, model, selected, requested_arguments)]
    candidates.extend((None, workspace.root / "runs" / value / "run.json", value)
                      for value in explicit)
    journal = _ReuseProgress(model, selected, progress)
    observations, seen = [], set()
    for index_key, path, explicit_id in candidates:
        adopted, phase, original_id = {}, "validation", None
        try:
            if explicit_id is None:
                record = read_json(path)
                if (record.get("schema") != "upstate.native-stage-cache/v1"
                        or record.get("id") != index_key or record.get("model") != model):
                    raise ValueError("Native reuse index differs")
                original_id = identifier(record["run_id"])
            else:
                original_id = explicit_id
            if original_id == run_id or original_id in seen:
                continue
            journal.candidate(original_id, explicit_id is None)
            original = workspace.inspect_run(original_id)
            if model not in run_models(original):
                raise ValueError("Original run did not select this native model")
            stage = original["stages"][model]
            old_directory = workspace.root / "runs" / original_id
            original_signature = stage.get("input_signature")
            original_selection = (_scientific_signature(original_signature)
                                  if original_signature else None)
            equivalence = None
            if original_selection != selected:
                if explicit_id is None or matcher is None:
                    raise ValueError("Original stage inputs differ")
                if matcher.target_run_id != run_id:
                    raise ValueError("Native input matcher belongs to another target run")
                target_runtime = getattr(matcher, "target_runtime", None)
                requested = selected["selection"]
                if (not target_runtime or
                        target_runtime.get("version") != requested["invest_version"] or
                        target_runtime.get("environment") != requested["environment"] or
                        any(target_runtime.get("modules", {}).get(dependency) != module
                            for dependency, module in requested["modules"].items())):
                    raise ValueError("Bind the matcher to the actual receiving native runtime")
                # Scientific matching may ignore container bytes and unused
                # table columns, never an original native flag or output suffix.
                original_arguments = read_json(verify_file(old_directory, stage["arguments"]))
                original_values = {key: value for key, value in original_arguments.items()
                                   if key not in ("workspace_dir", "n_workers") + INPUT_PATHS[model]}
                if original_values != requested["arguments"]:
                    raise ValueError("Original native arguments differ")
                journal.emit(phase="comparing_original_inputs")
                equivalence = matcher.compare(original_id, model)
                if not equivalence["matches"]:
                    raise ValueError("Original stage inputs differ: " +
                                     "; ".join(equivalence["differences"]))
            # An invalid or stale index may still have an explicitly selected
            # scientific donor. Mark it seen only after its inputs matched.
            seen.add(original_id)
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
            unique_outputs = {item["path"]: item for item in output_files}
            journal.emit(force=True, phase="transferring",
                         files_total=len(unique_outputs) + 1,
                         logical_bytes_total=sum(item["bytes"] for item in unique_outputs.values())
                                             + stage["arguments"]["bytes"])
            reuse_started = now()
            phase = "copy"
            copied = {}
            for item in output_files:
                if item["path"] not in copied:
                    journal.transfer(transfer, current_file=item["path"], force=not copied)
                    copied[item["path"]] = _adopt_candidate_file(
                        old_directory, item, directory, adopted, transfer=transfer)
            files = {name: dict(item) for name, item in stage["files"].items()}
            copied_companions = [dict(item) for item in companions]
            journal.transfer(transfer, current_file=original_arguments["path"])
            source_arguments = _adopt_candidate_file(
                old_directory, stage["arguments"], directory, adopted,
                path=original_arguments["path"], transfer=transfer)
            _discard_unselected_companions(directory, model, files,
                                          {item["path"] for item in output_files})
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
                "reuse_lookup": journal.transfer(transfer, phase="complete", force=True),
                "reused_from": {
                    "run_id": original_id, "model": model,
                    "stage_started_at": stage.get("started_at"),
                    "stage_completed_at": stage["completed_at"],
                    "input_signature": (original_signature or {}).get("id"),
                    "requested_input_signature": selected["id"],
                    "original_arguments": stage["arguments"],
                    "original_input_signature": original_signature,
                    "input_equivalence": equivalence,
                    "previous_reuse": stage.get("reused_from"),
                },
            }
            return result, observations
        except (OSError, ValueError, KeyError, TypeError) as exc:
            if storage_exhausted(exc):
                # Completed independent files remain usable by the same run's
                # next attempt. Its existing recovery reserve records ENOSPC/
                # EDQUOT; another donor or calculation cannot repair capacity.
                raise
            _discard_candidate(adopted)
            observations.append({"index": path.relative_to(workspace.root).as_posix(),
                                 "phase": phase, "reason": str(exc)})
            journal.value["rejected_candidates"] += 1
            journal.emit(phase="searching", current_file=None,
                         last_rejection={"source_run_id": original_id,
                                         "phase": phase, "reason": str(exc)})
            continue
    journal.emit(force=True, phase="no_matching_stage", current_file=None)
    return None, observations
