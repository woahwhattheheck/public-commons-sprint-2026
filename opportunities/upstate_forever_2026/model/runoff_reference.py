"""Derive native NDR runoff references from completed retained baseline stages.

InVEST 3.20 normalizes its watershed-masked runoff raster by the raster's
own mean unless runoff_proxy_av is supplied. This module uses that same
reduction and retains the actual reference before saving selected profiles.
"""
from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path

from .common import (INVEST_SOURCE, INVEST_VERSION, atomic_json, digest, finite,
                     held, identifier, read_json, verify_file)
from .model_selection import run_models, selected
from .reuse import native_companions

SCHEMA = "upstate.ndr-runoff-reference/v1"
SELECTION_SCHEMA = "upstate.ndr-runoff-reference-selection/v1"
METHOD = {
    "model": "NDR", "version": "3.20.0",
    "source_url": "https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/ndr/ndr.py",
    "source_sha256": "5c4353d9548af59d048c0ea14b39545e0f3e813d43371a93127e2f3cbc87508b",
    "function": "_normalize_raster",
    "registry_id": "masked_runoff_proxy",
    "reducer": "pygeoprocessing.raster_reduce with the native NumPy sum/count reducer",
    "reduction_arguments": "Native raster_reduce nodata and block defaults",
}


def _checked(reference):
    if not isinstance(reference, dict) or reference.get("schema") != SCHEMA:
        raise ValueError("Select a retained native runoff reference")
    body = {name: value for name, value in reference.items() if name != "id"}
    if identifier(reference.get("id")) != digest(body):
        raise ValueError("Retained runoff reference changed")
    if reference["selection"].get("schema") != SELECTION_SCHEMA:
        raise ValueError("Runoff reference has a different source selection")
    finite(reference["mean"], "native masked runoff mean")
    finite(reference["value_sum"], "native masked runoff sum")
    count = reference["valid_cell_count"]
    if type(count) is not int or count <= 0:
        raise ValueError("Runoff reference needs actual valid native pixels")
    return reference


def _path(workspace, selection):
    return workspace.root / "runoff-references" / (digest(selection) + ".json")


def _file_state(path):
    """Detect changes during the reduction without rereading every large body."""
    result = []
    for item in [path] + [Path(str(path) + suffix)
                          for suffix in (".aux.xml", ".msk", ".ovr")]:
        if item.exists():
            stat = item.stat()
            result.append((str(item), stat.st_dev, stat.st_ino, stat.st_size,
                           stat.st_mtime_ns, stat.st_ctime_ns))
        else:
            result.append((str(item), None))
    return tuple(result)


def _source(workspace, run_id):
    run = workspace.inspect_run(identifier(run_id))
    if "ndr" not in run_models(run):
        raise ValueError("Select a retained baseline that includes NDR")
    run_selection = run["selection"]
    scenario = workspace._get("scenarios", run_selection["scenario_id"])
    if scenario["kind"] != "baseline":
        raise ValueError("Use the original land-cover baseline for a runoff reference")
    stage = run.get("stages", {}).get("ndr")
    if not stage or not stage.get("completed_at"):
        raise ValueError("Execute the selected baseline NDR stage before deriving its reference")
    runtime = stage.get("runtime") or run.get("runtime", {})
    if runtime.get("version") != INVEST_VERSION:
        raise ValueError("Select the retained published InVEST 3.20 NDR stage")
    for model in ("ndr", "sdr"):
        if runtime.get("modules", {}).get(model, {}).get("git_blob") != INVEST_SOURCE[model + "_blob"]:
            raise ValueError("The source NDR stage uses another native dependency: " + model)
    directory = workspace.root / "runs" / run["id"]
    entry = stage.get("files", {}).get("masked_runoff_proxy")
    if entry is None:
        raise ValueError("Retain the native masked_runoff_proxy registry raster from this baseline")
    path = verify_file(directory, entry)
    arguments_path = verify_file(directory, stage["arguments"])
    arguments = read_json(arguments_path)
    # Match the native execute() conversion, including its automatic-mean case.
    supplied = arguments.get("runoff_proxy_av")
    supplied = finite(supplied, "baseline supplied runoff mean") if supplied else None
    companions = native_companions(directory, {"masked_runoff_proxy": entry})
    expected_companion_paths = {entry["path"] + suffix
                                for suffix in (".aux.xml", ".msk", ".ovr")}
    for item in stage.get("companions", []):
        if item["path"] in expected_companion_paths:
            verify_file(directory, item)
    requested = stage.get("requested_arguments")
    if requested:
        verify_file(directory, requested)
    grid = workspace.get_grid(run_selection["grid_id"])
    selection = {
        "schema": SELECTION_SCHEMA, "workspace_id": workspace.project["id"],
        "baseline_run_id": run["id"], "grid_id": grid["id"],
        "profile_id": run_selection["profile_id"], "scenario_id": scenario["id"],
        "method": METHOD,
        "native_stage_completed_at": stage["completed_at"],
        "native_stage_runtime": runtime,
        "native_stage_reused_from": stage.get("reused_from"),
        "masked_runoff_proxy": entry, "companions": companions,
        "native_arguments": stage["arguments"],
        "requested_arguments": requested,
        "runoff_units": grid["files"]["PRECIPITATION"].get("units"),
    }
    return path, selection, supplied


def from_run(workspace, baseline_run_id):
    """Retain the actual masked-raster mean and its original native identities.

    A completed NDR stage is sufficient when another selected model is still
    unfinished. Repeated calls reuse the retained reference after checking its
    original raster, companions, arguments and source selection.
    """
    path, selection, supplied = _source(workspace, baseline_run_id)
    target = _path(workspace, selection)
    with held(target.with_suffix(".lock"), blocking=False):
        if target.exists():
            reference = _checked(read_json(target))
            if reference["selection"] != selection:
                raise ValueError("Retained runoff reference source selection differs")
            return reference
        import numpy
        import pygeoprocessing
        from .stage_cache import runtime_environment

        before = _file_state(path)
        # These are the exact reducer operations in the pinned NDR function.
        # Leave raster_reduce's native block ordering and nodata defaults intact.
        value_sum, value_count = pygeoprocessing.raster_reduce(
            function=lambda sum_count, block: (
                sum_count[0] + numpy.sum(block), sum_count[1] + block.size),
            raster_path_band=(str(path), 1),
            initializer=(0, 0))
        if value_count <= 0:
            raise ValueError("The retained native runoff raster has no valid cells")
        value_mean = value_sum
        value_mean /= value_count
        if _file_state(path) != before:
            raise ValueError("The native runoff raster or a companion changed during reduction")
        mean = finite(value_mean, "native masked runoff mean")
        total = finite(value_sum, "native masked runoff sum")
        reference = {
            "schema": SCHEMA, "selection": selection,
            "mean": mean, "mean_hex": mean.hex(),
            "value_sum": total, "valid_cell_count": int(value_count),
            "baseline_supplied_mean": supplied,
            "baseline_effective_mean": supplied if supplied is not None else mean,
            "derivation_environment": runtime_environment(),
        }
        reference["id"] = digest(reference)
        atomic_json(target, reference, immutable=True)
        return _checked(reference)


def save_profile(workspace, source_profile_id, reference, *, title, reason):
    """Save a normal native profile using this actual fixed runoff reference."""
    reference = _checked(reference)
    selection = reference["selection"]
    if selection["workspace_id"] != workspace.project["id"]:
        raise ValueError("Use the runoff reference retained by this workspace")
    retained = _checked(read_json(_path(workspace, selection)))
    if retained != reference:
        raise ValueError("Use the complete original retained runoff reference")
    if not isinstance(title, str) or not title.strip():
        raise ValueError("Name the fixed-reference parameter profile")
    if not isinstance(reason, str) or not reason.strip():
        raise ValueError("Explain the scientific purpose of fixing the runoff reference")
    source = workspace._get("profiles", identifier(source_profile_id))
    if "ndr" not in selected(source):
        raise ValueError("Select a profile containing native NDR parameters")
    mean = finite(reference["mean"], "fixed native runoff reference", positive=True)
    value = copy.deepcopy(source)
    value.pop("id", None)
    value.pop("schema", None)
    value["title"] = title.strip()
    value["ndr"]["runoff_proxy_av"] = mean
    references = value.get("references", [])
    if not isinstance(references, list):
        references = [references]
    provenance = {
        "kind": "native-runoff-reference", "reference_id": reference["id"],
        "baseline_run_id": selection["baseline_run_id"],
        "grid_id": selection["grid_id"],
        "masked_runoff_proxy_sha256": selection["masked_runoff_proxy"]["sha256"],
        "source_profile_id": source["id"],
        "source_profile_runoff_proxy_av": source.get("ndr", {}).get("runoff_proxy_av"),
        "value": mean, "units": selection["runoff_units"], "reason": reason.strip(),
        "source": METHOD["source_url"],
    }
    if provenance not in references:
        references.append(provenance)
    value["references"] = references
    value["runoff_reference"] = provenance
    return workspace.save_profile(value)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--baseline-run-id", required=True)
    parser.add_argument("--profile-id", action="append", default=[],
                        help="Retained profile to derive; repeat for several. Defaults to the baseline profile.")
    parser.add_argument("--title-prefix", default="Fixed native runoff mean / ")
    parser.add_argument("--reason", required=True)
    parser.add_argument("--execute-baseline", action="store_true",
                        help="Execute or resume the prepared baseline through the original native pipeline first.")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    from .workspace import Workspace
    workspace = Workspace(args.workspace)
    baseline = workspace.inspect_run(identifier(args.baseline_run_id))
    if args.execute_baseline and not baseline.get("stages", {}).get("ndr", {}).get("completed_at"):
        baseline = workspace.run(baseline["id"])
    reference = from_run(workspace, baseline["id"])
    profile_ids = args.profile_id or [baseline["selection"]["profile_id"]]
    profiles = []
    for key in dict.fromkeys(profile_ids):
        original = workspace._get("profiles", identifier(key))
        derived = save_profile(
            workspace, key, reference, title=args.title_prefix + original["title"],
            reason=args.reason)
        profiles.append({"id": derived["id"], "title": derived["title"],
                         "source_profile_id": key,
                         "runoff_proxy_av": derived["ndr"]["runoff_proxy_av"]})
    result = {"schema": "upstate.ndr-runoff-reference-receiving/v1",
              "workspace_id": workspace.project["id"], "reference": reference,
              "profile_ids": [profile["id"] for profile in profiles], "profiles": profiles}
    if args.output:
        atomic_json(args.output, result)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
