"""Prepare the disjoint matched-area control on the original simulated grid.

Only a companion mask/source collection and third land-cover scenario are added.
The original baseline/restoration source collection, runs and profile are reused.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import sys
import tempfile

APP = Path(__file__).resolve().parents[1]
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))


def file_sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def prepare(ws, receipt, recipe_path, control_path, output):
    import numpy as np
    import rasterio
    from rasterio.transform import Affine
    from model.common import atomic_json, describe_file, held, read_json, verify_file
    from model.scenario_footprint import preview_run

    recipe_path, control_path = Path(recipe_path).resolve(strict=True), Path(control_path).resolve(strict=True)
    recipe, control = read_json(recipe_path), read_json(control_path)
    recipe_sha = file_sha(recipe_path)
    if (control.get("schema") != "upstate.simulated-matched-control/v1" or
            control.get("source_recipe_sha256") != recipe_sha or
            control.get("demo_id") != recipe.get("demo_id") or
            control.get("grid") != recipe.get("grid") or
            control.get("mask_role") != "MATCHED_CONTROL_MASK" or
            recipe_sha != receipt["recipe_sha256"]):
        raise ValueError("The control companion must bind the original receiving recipe")
    if ws.project["id"] != receipt["project_id"]:
        raise ValueError("Continue the original simulated scientific Workspace")
    baseline = ws.inspect_run(receipt["baseline_run_id"])
    for key in ("grid_id", "profile_id"):
        if baseline["selection"][key] != receipt[key]:
            raise ValueError("Retain the original baseline " + key)
    grid = recipe["grid"]
    original_grid = ws.get_grid(receipt["grid_id"])["grid"]
    if any(original_grid[k] != grid[k] for k in ("width", "height")) or not all(
            math.isclose(float(a), float(b), rel_tol=0, abs_tol=1e-8)
            for a, b in zip(original_grid["transform"][:6], grid["transform"][:6])):
        raise ValueError("Retain the original prepared pixel grid")
    mask = np.asarray(control["mask"])
    lulc = np.asarray(recipe["arrays"]["NLCD"])
    riparian = np.asarray(recipe["arrays"]["RESTORATION_MASK"])
    if (mask.shape != (14400,) or not np.isin(mask, [0, 1]).all() or
            np.any((mask == 1) & (riparian == 1)) or
            int(((mask == 1) & (lulc == 81)).sum()) != 236 or
            int(((mask == 1) & (lulc == 82)).sum()) != 399 or
            int(mask.sum()) != 635):
        raise ValueError("Select the complete disjoint 236-pasture/399-crop control")
    if (control["scenario"].get("from_codes") != [81, 82] or
            control["scenario"].get("to_code") != 41):
        raise ValueError("Retain the class-matched conversion to forest")
    mask_source_id = "SIM_MATCHED_CONTROL_MASK"
    changed_indices = np.flatnonzero(mask == 1).tolist()
    if (control.get("changed_indices") != changed_indices or
            control.get("changed_cells") != 635 or
            not math.isclose(float(control.get("changed_area_ha", -1)), 57.15,
                             rel_tol=0, abs_tol=1e-8)):
        raise ValueError("Retain the canonical control cell indices and area")
    key = file_sha(control_path)
    root = Path(output).resolve() / key
    root.mkdir(parents=True, exist_ok=True)
    with held(root / ".prepare.lock", blocking=False):
        inputs = root / "inputs"
        receiving = inputs / "input-receiving.json"
        if receiving.exists():
            original = read_json(receiving)
            if original["control_sha256"] != key or original["recipe_sha256"] != recipe_sha:
                raise ValueError("Retained control input identity differs")
            for item in original["files"]:
                verify_file(inputs, item)
        else:
            if inputs.exists():
                raise ValueError("Existing control inputs lack their retained receiving record")
            with tempfile.TemporaryDirectory(prefix=".control-inputs-", dir=root) as name:
                pending = Path(name)
                mask_path = pending / "control-mask.tif"
                with rasterio.open(mask_path, "w", driver="GTiff", width=grid["width"],
                                   height=grid["height"], count=1, dtype="int16",
                                   crs=grid["crs"], transform=Affine(*grid["transform"][:6]),
                                   nodata=-9999, compress="deflate") as target:
                    target.write(mask.astype("int16").reshape(grid["height"], grid["width"]), 1)
                    target.update_tags(classification="SIMULATED", role="MATCHED_CONTROL_MASK",
                                       recipe_sha256=recipe_sha, control_sha256=key, units="mask")
                shutil.copyfile(control_path, pending / "matched-control.json")
                shutil.copyfile(Path(__file__), pending / "simulated_headwaters_control.py")
                generator = control_path.parent / "generate-matched-control.mjs"
                if not generator.is_file():
                    raise ValueError("Retain the deterministic control generator beside its input")
                shutil.copyfile(generator, pending / "generate-matched-control.mjs")
                entries = []
                for source_id, title, path, kind in (
                        (mask_source_id, "SIMULATED: matched-area control mask", mask_path, "raster"),
                        ("SIM_MATCHED_CONTROL_INPUT", "SIMULATED: original matched-control inputs", pending / "matched-control.json", "document"),
                        ("SIM_MATCHED_CONTROL_GENERATOR", "Matched-control deterministic source", pending / "generate-matched-control.mjs", "document"),
                        ("SIM_MATCHED_CONTROL_RECEIVER", "Matched-control original Workspace receiver", pending / "simulated_headwaters_control.py", "document")):
                    entry = {"id": source_id, "title": title,
                             "uri": "upstate.simulated-input:" + recipe["demo_id"] + "/control/" + path.name,
                             "vintage": "2026-10-13 simulated demonstration edition",
                             "kind": kind, "path": path.name, "sha256": file_sha(path),
                             "classification": "simulated", "recipe_sha256": recipe_sha,
                             "control_sha256": key}
                    if kind == "raster":
                        entry.update(units="mask", resampling="nearest")
                    entries.append(entry)
                atomic_json(pending / "sources.json", {
                    "schema": "upstate.sources/v1", "title": control["scenario"]["title"],
                    "classification": "simulated", "entries": entries})
                atomic_json(pending / "input-receiving.json", {
                    "schema": "upstate.simulated-control-receiving/v1",
                    "control_sha256": key, "recipe_sha256": recipe_sha,
                    "files": [describe_file(pending, p) for p in sorted(pending.iterdir()) if p.is_file()]})
                os.rename(pending, inputs)
        collection = ws.import_sources(inputs / "sources.json")
        scenario = ws.save_scenario({
            "title": control["scenario"]["title"], "kind": "landcover",
            "reason": control["scenario"]["reason"], "source_collection_id": collection["id"],
            "patches": [{"mask_source_id": mask_source_id, "from_codes": [81, 82], "to_code": 41,
                         "reason": control["scenario"]["reason"]}]})
        selection = {"grid_id": receipt["grid_id"], "profile_id": receipt["profile_id"],
                     "scenario_id": scenario["id"]}
        if "models" in baseline["selection"]:
            selection["models"] = baseline["selection"]["models"]
        run = ws.prepare_run(selection)
        footprint = preview_run(ws, run["id"])
        summary = footprint["summary"]
        if (summary["net_changed_cells"] != 635 or
                not math.isclose(summary["net_changed_hectares"], 57.15, rel_tol=0, abs_tol=1e-8)):
            raise ValueError("Actual prepared control footprint differs from the retained 635 cells")
        result = {"schema": "upstate.simulated-control-preparation/v1",
                  "project_id": ws.project["id"], "recipe_sha256": recipe_sha,
                  "control_sha256": key, "baseline_run_id": baseline["id"],
                  "grid_id": receipt["grid_id"], "profile_id": receipt["profile_id"],
                  "source_collection_id": collection["id"], "source_id": mask_source_id,
                  "scenario_id": scenario["id"], "run_id": run["id"],
                  "footprint_id": footprint["id"], "footprint_summary": summary,
                  "matching_summary": {
                      "method": control["matching"]["method"],
                      "changed_cells": control["changed_cells"],
                      "changed_hectares": control["changed_area_ha"],
                      "overlap_with_riparian_cells": 0,
                      "runoff_proxy_mean": control["matching"]["common_grid_precipitation_mean_mm_year"],
                      "classes": control["matching"]["by_original_class"],
                      "interpretation": control["interpretation"]},
                  "state": "prepared"}
        atomic_json(root / "control-prepared.json", result, immutable=True)
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--receipt", required=True)
    parser.add_argument("--recipe", required=True)
    parser.add_argument("--control", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    from model.workspace import Workspace
    from model.common import read_json
    result = prepare(Workspace(args.workspace), read_json(args.receipt), args.recipe, args.control, args.output)
    print(json.dumps(result, indent=2, sort_keys=True, allow_nan=False))


if __name__ == "__main__":
    main()
