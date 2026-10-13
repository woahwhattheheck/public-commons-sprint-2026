"""Create an original land-cover scenario from a saved conservation footprint.

Copyright 2026 TokenJunkieLabs. Selected land becomes a retained polygon source.
The maintained Workspace and its NDR/SDR runner calculate the resulting case.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil

from .common import atomic_json, describe_file, digest, file_digest, held, identifier, now, read_json, verify_file
from . import conservation

SCHEMA = "upstate.conservation-scenario/v1"
SEMANTICS = (
    "A selected plan supplies the exact land-cover change footprint. "
    "The saved original scenario must be run through the maintained model to "
    "calculate the effect of changing only that footprint. Existing whole-scenario "
    "differences inside selected land describe those earlier scenarios."
)


def _spec(value):
    if not isinstance(value, dict):
        raise ValueError("Submit a conservation scenario selection")
    value = dict(value)
    plan_id = identifier(value.get("plan_id"))
    title = str(value.get("title") or "").strip()
    reason = str(value.get("reason") or "").strip()
    if not title or not reason:
        raise ValueError("Name the land-cover scenario and explain the proposed change")
    codes = value.get("from_codes")
    if not isinstance(codes, list) or not codes or any(type(x) is not int for x in codes):
        raise ValueError("List the original integer land-cover codes to change")
    to_code = value.get("to_code")
    if type(to_code) is not int:
        raise ValueError("Select the replacement integer land-cover code")
    codes = sorted(set(codes))
    if to_code in codes:
        raise ValueError("Exclude the replacement code from the original codes")
    run = value.get("prepare_run")
    if run is not None:
        if not isinstance(run, dict):
            raise ValueError("Choose the existing grid and parameter profile")
        run = {"grid_id": identifier(run.get("grid_id")),
               "profile_id": identifier(run.get("profile_id"))}
    return {"plan_id": plan_id, "title": title, "reason": reason,
            "from_codes": codes, "to_code": to_code, "prepare_run": run}


def _validate_run(workspace, selection, footprint, layer):
    """Reject a proposed run that cannot represent the full selected footprint."""
    if selection["prepare_run"] is None:
        return None
    run = selection["prepare_run"]
    profile = workspace._get("profiles", run["profile_id"])
    grid = workspace.get_grid(run["grid_id"])
    if grid.get("state") != "complete":
        raise ValueError("Complete the selected model grid before preparing this scenario run")
    allowed = set(profile["table_summary"]["lucodes"])
    if selection["to_code"] not in allowed:
        raise ValueError("The selected parameter table needs coefficients for the replacement land-cover code")
    from . import rasters
    from pyproj import CRS
    crs = CRS.from_user_input(grid["grid"]["crs"])
    selected_rows, _ = rasters.vector_geometry(footprint, layer=layer, target_crs=crs)
    selected = rasters.polygon_union(selected_rows)
    reporting_path = verify_file(workspace.root / "grids" / grid["id"],
                                 grid["files"]["reporting_area"])
    report_rows, _ = rasters.vector_geometry(reporting_path, target_crs=crs)
    reporting = rasters.polygon_union(report_rows)
    if selected.is_empty or selected.area <= 0:
        raise ValueError("Choose a plan with selected land")
    outside = selected.difference(reporting).area
    if outside > max(0.01, selected.area * 1e-9):
        raise ValueError("The selected model reporting area does not cover the complete plan footprint. "
                         "Choose its covering grid or save a plan within the intended reporting area.")
    return {"grid_id": grid["id"], "profile_id": profile["id"],
            "covered_fraction": 1.0, "analysis_crs": crs.to_string()}


def create_scenario(workspace, value):
    """Save a source-bound native scenario and optionally prepare its original run.

    Repeating exactly the same selection reopens the same scenario/run. A revised
    code, footprint, reason, grid or profile creates another retained selection.
    """
    selection = _spec(value)
    plan = conservation.get_plan(workspace, selection["plan_id"])
    if not plan.get("selected_ids"):
        raise ValueError("Select at least one planning unit and save the plan")
    descriptor = plan.get("files", {}).get("footprint")
    if not isinstance(descriptor, dict):
        raise ValueError("Rebuild the saved plan's selected-footprint GeoPackage")
    footprint = verify_file(workspace.root, descriptor)
    layer = descriptor.get("layer", "selected_union")
    stamp = {
        "schema": SCHEMA, "project_id": workspace.project["id"],
        "selection": selection, "study_id": plan["study_id"],
        "footprint_sha256": descriptor["sha256"], "layer": layer,
        "selected_ids": list(plan["selected_ids"]),
    }
    key = digest(stamp)
    directory = workspace.root / "conservation-scenarios" / key
    directory.mkdir(parents=True, exist_ok=True)
    record_path = directory / "scenario.json"
    with held(directory / ".create.lock"):
        if record_path.exists():
            result = read_json(record_path)
            if result.get("state") == "complete":
                workspace._get("scenarios", result["scenario_id"])
                workspace.source_file(result["source_collection_id"], result["mask_source_id"])
                if result.get("run_id"):
                    workspace.inspect_run(result["run_id"])
                return {**result, "reused": True}
        coverage = _validate_run(workspace, selection, footprint, layer)
        source_id = "conservation-plan-union-" + plan["id"]
        mask = directory / "selected-union.gpkg"
        if mask.exists():
            if mask.stat().st_size != descriptor["bytes"] or file_digest(mask) != descriptor["sha256"]:
                raise ValueError("The retained scenario footprint differs from its selected plan")
        else:
            try:
                os.link(footprint, mask)
            except OSError:
                shutil.copyfile(footprint, mask)
            if mask.stat().st_size != descriptor["bytes"] or file_digest(mask) != descriptor["sha256"]:
                mask.unlink(missing_ok=True)
                raise ValueError("The selected plan footprint changed while preparing its scenario")
        manifest = {
            "schema": "upstate.sources/v1",
            "title": selection["title"] + " — selected conservation footprint",
            "captured_at": plan.get("created_at"),
            "scope": {
                "purpose": "Exact union of the saved plan's reporting-clipped planning units",
                "study_id": plan["study_id"], "plan_id": plan["id"],
                "selected_ids": list(plan["selected_ids"]),
                "analysis_crs": plan.get("analysis_crs"),
            },
            "notes": [SEMANTICS],
            "entries": [{
                "id": source_id, "kind": "vector", "role": "SCENARIO_MASK",
                "title": selection["title"] + " — selected land",
                "uri": "urn:upstate:conservation-plan:" + plan["id"] + ":selected-union",
                "vintage": "Saved conservation plan " + plan["id"],
                "path": mask.name, "layer": layer, "sha256": descriptor["sha256"],
                "scope": {
                    "source_plan_id": plan["id"], "source_study_id": plan["study_id"],
                    "footprint_sha256": descriptor["sha256"],
                },
            }],
        }
        manifest_path = directory / "sources.json"
        atomic_json(manifest_path, manifest, immutable=True)
        state = {**stamp, "id": key, "state": "preparing",
                 "created_at": now(), "method": SEMANTICS,
                 "run_coverage": coverage}
        if record_path.exists():
            state["created_at"] = read_json(record_path).get("created_at", state["created_at"])
        atomic_json(record_path, state)
        # The original source store and native scenario methods retain their own
        # stable identities. A failed optional run preparation can resume here.
        collection = workspace.import_sources(manifest_path)
        scenario = workspace.save_scenario({
            "title": selection["title"], "kind": "landcover",
            "reason": selection["reason"],
            "source_collection_id": collection["id"],
            "patches": [{
                "mask_source_id": source_id, "layer": layer,
                "from_codes": selection["from_codes"], "to_code": selection["to_code"],
                "reason": selection["reason"],
            }],
            "conservation": {
                "study_id": plan["study_id"], "plan_id": plan["id"],
                "footprint_sha256": descriptor["sha256"],
                "selected_ids": list(plan["selected_ids"]),
            },
        })
        state.update(source_collection_id=collection["id"],
                     mask_source_id=source_id, scenario_id=scenario["id"],
                     scenario=scenario)
        atomic_json(record_path, state)
        if selection["prepare_run"] is not None:
            native_run = workspace.prepare_run({
                **selection["prepare_run"], "scenario_id": scenario["id"],
            })
            state.update(run_id=native_run["id"], run_state=native_run["state"])
        state.update(state="complete", completed_at=now(), files={
            "source_manifest": describe_file(workspace.root, manifest_path),
            "footprint": {**describe_file(workspace.root, mask), "layer": layer},
        })
        atomic_json(record_path, state)
        return state


def main(argv=None):
    import argparse
    from .workspace import Workspace
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("selection", type=Path,
                        help="JSON with plan_id, title, reason, from_codes, to_code and optional prepare_run")
    args = parser.parse_args(argv)
    result = create_scenario(Workspace(args.workspace), read_json(args.selection))
    print(json.dumps(result, sort_keys=True, indent=2))


if __name__ == "__main__":
    main()
