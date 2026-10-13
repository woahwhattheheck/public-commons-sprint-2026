"""Retain requested parameter-study GIS outputs and stream portable archives."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import stat
import tempfile
import time
import zipfile

from .common import atomic_json, describe_file, digest, file_digest, identifier, read_json, relative_file
from .model_selection import required_outputs, run_models
from .rasters import MASS_UNITS
from .reuse import copy_verified

EDITION = "parameter-study-exports/3"

MEMBER_SCHEMA = "upstate.parameter-export-members/v1"


def member_descriptors(directory, descriptors):
    """Validate one complete, uniquely named set of retained export bodies."""
    directory = Path(directory)
    members = {}
    for item in descriptors:
        if not isinstance(item, dict):
            raise ValueError("A parameter export member must describe one file")
        name, size, checksum = item.get("path"), item.get("bytes"), item.get("sha256")
        if (not isinstance(name, str) or not name
                or isinstance(size, bool) or not isinstance(size, int) or size < 0
                or not isinstance(checksum, str) or len(checksum) != 64
                or any(c not in "0123456789abcdef" for c in checksum)):
            raise ValueError("A parameter export member needs its path, byte length and SHA256")
        relative_file(directory, name)
        if name in members and members[name] != item:
            raise ValueError("Parameter exports repeat a member with different source metadata")
        members[name] = dict(item)
    return members


def retain_member_manifest(workspace, directory, state, descriptors):
    """Describe all standalone ZIP members, including retained scientific context."""
    members = member_descriptors(directory, descriptors)
    if "export-manifest.json" in members or "experiment-results.zip" in members:
        raise ValueError("The study member manifest cannot recursively include its own bundle")
    value = {
        "schema": MEMBER_SCHEMA, "edition": EDITION,
        "workspace_id": workspace.project["id"], "study_id": state["id"],
        "selection_sha256": digest(state["selection"]),
        "files": [members[name] for name in sorted(members)],
        "members": len(members),
        "logical_bytes": sum(item["bytes"] for item in members.values()),
        "layout": "All members use their original study-relative paths.",
        "scientific_context": (
            "Includes native arguments, requested arguments, paired aggregation context "
            "and adopted aggregation ancestry alongside the quantitative results and requested maps."
        ),
    }
    atomic_json(Path(directory) / "export-manifest.json", value)
    return describe_file(directory, Path(directory) / "export-manifest.json")



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


def _checked_file(path, expected=None, *, progress=None):
    """Hash one regular body with before/after identity checks, without buffering it."""
    checksum, size = hashlib.sha256(), 0
    with Path(path).open("rb") as source:
        before = os.fstat(source.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise ValueError("A parameter archive body must be a regular file")
        for block in iter(lambda: source.read(1024 * 1024), b""):
            checksum.update(block)
            size += len(block)
            if progress:
                progress(len(block), size)
        if (_identity(before) != _identity(os.fstat(source.fileno()))
                or _identity(before) != _identity(Path(path).stat())):
            raise ValueError("A parameter archive body changed during verification")
    actual = {"bytes": size, "sha256": checksum.hexdigest()}
    if expected is not None and any(actual[key] != expected.get(key) for key in actual):
        raise ValueError("A retained parameter archive body differs from its original bytes")
    return actual


def write_archive(directory, destination, descriptors, *, progress=None):
    """Stream exact retained members, including large GeoTIFFs, into one ZIP."""
    directory = Path(directory).resolve()
    destination = Path(destination)
    members = member_descriptors(directory, descriptors)
    checkpoint = destination.with_name("." + destination.name + ".members.json")
    selection = {
        "schema": "upstate.parameter-archive-members/v1",
        "implementation_sha256": file_digest(Path(__file__)),
        "files": [members[name] for name in sorted(members)],
        "format": "sorted-zip64-fixed-time-stored-gis-and-zip-deflated-other/v1",
    }
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
    cached = None
    if (checkpoint.is_file() and not checkpoint.is_symlink()
            and destination.is_file() and not destination.is_symlink()):
        try:
            candidate = read_json(checkpoint)
            if (isinstance(candidate, dict)
                    and candidate.get("schema") == "upstate.parameter-archive-checkpoint/v1"
                    and candidate.get("selection") == selection
                    and isinstance(candidate.get("archive"), dict)):
                cached = candidate
        except (OSError, ValueError, TypeError):
            pass
    if cached is not None:
        # A cache hit still verifies every current scientific member and the
        # published ZIP. It avoids another ZIP write/compression pass, not the
        # original byte checks required for independent receiving.
        for name, item in sorted(members.items()):
            report(phase="verifying", current_member=name, current_member_bytes=0)
            def checked(count, size):
                observation["source_bytes_processed"] += count
                report(current_member_bytes=size)
            _checked_file(relative_file(directory, name), item, progress=checked)
            observation["members_completed"] += 1
        try:
            report(phase="verifying-archive", current_member=None, current_member_bytes=0)
            _checked_file(destination, cached["archive"])
        except (OSError, ValueError, TypeError):
            # Keep the old derived ZIP until a complete replacement is ready.
            cached = None
        if cached is not None:
            report(force=True, phase="complete", current_member=None, reused=True)
            return
        observation.update(source_bytes_processed=0, members_completed=0)
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
        archive_identity = _checked_file(destination)
        atomic_json(checkpoint, {"schema": "upstate.parameter-archive-checkpoint/v1",
                                 "selection": selection, "archive": archive_identity})
        report(force=True, phase="complete", current_member=None, reused=False)
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)
