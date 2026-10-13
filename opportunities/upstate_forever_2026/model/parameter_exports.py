"""Retain requested parameter-study GIS outputs and stream portable archives."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import stat
import tempfile
import time
import zipfile

from .common import describe_file, identifier, relative_file
from .model_selection import required_outputs, run_models
from .rasters import MASS_UNITS
from .reuse import copy_verified

EDITION = "parameter-study-exports/2"


def retain_differences(workspace, directory, state):
    """Carry the exact maintained comparison into the study's own directory."""
    requested = state["selection"]["difference_maps"]
    index = {"requested": requested, "comparison_id": None, "alternatives": []}
    files = {}
    if not requested:
        return index, files
    completed = [case for case in state["cases"] if case["state"] == "complete"]
    if not completed or completed[0]["id"] != "baseline":
        raise ValueError("Retain the completed original parameter baseline before exporting maps")
    if len(completed) < 2:
        index["state"] = "awaiting-completed-alternative"
        return index, files
    ids = [case["run_id"] for case in completed]
    comparison = workspace.compare_runs(ids)
    if (comparison.get("baseline_run_id") != ids[0]
            or [row["run_id"] for row in comparison["alternatives"]] != ids[1:]
            or comparison.get("direction") != "alternative minus baseline"):
        raise ValueError("Parameter difference maps changed their retained case order")
    comparison_id = identifier(comparison["id"])
    source_root = workspace.root / "comparisons" / comparison_id
    prefix = "difference-maps/" + comparison_id + "/"
    comparison_file = describe_file(source_root, source_root / "comparison.json")
    files["map_comparison"] = copy_verified(
        source_root, comparison_file, directory, path=prefix + "comparison.json")
    baseline = workspace.inspect_run(ids[0])
    pollutants = required_outputs(run_models(baseline))
    grid_id = identifier(baseline["selection"]["grid_id"])
    grid_root = workspace.root / "grids" / grid_id
    files["map_grid"] = copy_verified(
        grid_root, describe_file(grid_root, grid_root / "grid.json"), directory,
        path=prefix + "grid.json")
    for case, alternative in zip(completed[1:], comparison["alternatives"]):
        outputs = {}
        if set(alternative["artifacts"]) != set(pollutants):
            raise ValueError("Parameter difference maps lack the selected model exports")
        for pollutant in pollutants:
            original = alternative["artifacts"][pollutant]
            if original.get("units") != MASS_UNITS[pollutant]:
                raise ValueError("Parameter difference map has different annual-mass units")
            descriptor = copy_verified(
                source_root, original, directory, path=prefix + original["path"])
            files["map_" + case["id"] + "_" + pollutant] = descriptor
            outputs[pollutant] = descriptor
        index["alternatives"].append({
            "case_id": case["id"], "case": case["label"], "run_id": case["run_id"],
            "profile_id": case["profile_id"], "artifacts": outputs})
    index.update(state="complete", comparison_id=comparison_id, baseline_run_id=ids[0],
                 direction=comparison["direction"], comparison=files["map_comparison"],
                 grid_id=grid_id, grid=files["map_grid"],
                 basis="Alternative minus baseline on paired valid native cells; annual mass per pixel.")
    state["comparison_id"] = comparison_id
    return index, files


def _identity(value):
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)


def write_archive(directory, destination, descriptors, *, progress=None):
    """Stream exact retained members, including large GeoTIFFs, into one ZIP."""
    directory = Path(directory).resolve()
    destination = Path(destination)
    members = {}
    for item in descriptors:
        name = item["path"]
        relative_file(directory, name)
        if name in members and members[name] != item:
            raise ValueError("Parameter archive repeats a member with different source bytes")
        members[name] = item
    started, published = time.monotonic(), None
    observation = {"schema": "upstate.parameter-archive-progress/v1",
                   "phase": "preparing", "members_total": len(members),
                   "members_completed": 0, "source_bytes_total": sum(
                       item["bytes"] for item in members.values()),
                   "source_bytes_processed": 0, "current_member": None,
                   "current_member_bytes": 0}
    def report(*, force=False, **changes):
        nonlocal published
        observation.update(changes)
        instant = time.monotonic()
        observation["elapsed_seconds"] = max(0.0, instant - started)
        if progress and (force or published is None or instant - published >= 1.0):
            progress(dict(observation))
            published = instant
    report(force=True)
    pending = None
    try:
        with tempfile.NamedTemporaryFile(dir=destination.parent, prefix=".parameter-",
                                         suffix=".zip", delete=False) as out:
            pending = Path(out.name)
        with zipfile.ZipFile(pending, "w", allowZip64=True) as archive:
            for name, item in sorted(members.items()):
                original = relative_file(directory, name)
                report(phase="streaming", current_member=name, current_member_bytes=0)
                with original.open("rb") as source:
                    before = os.fstat(source.fileno())
                    if not stat.S_ISREG(before.st_mode):
                        raise ValueError("Parameter archive member is no longer a regular file")
                    info = zipfile.ZipInfo(name)
                    info.external_attr = (stat.S_IFREG | 0o600) << 16
                    info.compress_type = (zipfile.ZIP_STORED if original.suffix.lower()
                                          in {".tif", ".tiff", ".zip"} else zipfile.ZIP_DEFLATED)
                    checksum, size = hashlib.sha256(), 0
                    with archive.open(info, "w", force_zip64=True) as output:
                        for block in iter(lambda: source.read(1024 * 1024), b""):
                            output.write(block)
                            checksum.update(block)
                            size += len(block)
                            observation["source_bytes_processed"] += len(block)
                            report(current_member_bytes=size)
                    if (_identity(before) != _identity(os.fstat(source.fileno()))
                            or size != item["bytes"] or checksum.hexdigest() != item["sha256"]):
                        raise ValueError("Parameter archive source changed: " + name)
                observation["members_completed"] += 1
                report(current_member=None, current_member_bytes=0)
        report(phase="publishing", current_member=None)
        with pending.open("rb") as original:
            os.fsync(original.fileno())
        os.replace(pending, destination)
        pending = None
        fd = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
        report(force=True, phase="complete", current_member=None)
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)
