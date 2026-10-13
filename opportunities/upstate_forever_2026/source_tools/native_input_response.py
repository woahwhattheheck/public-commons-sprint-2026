"""Publish a complete offline reader of original completed parameter studies.

The native Workspace and parameter-study modules own calculations, masks, units,
case identity and exports. This consumer retains their exact files and all cells.
"""
from __future__ import annotations
import argparse
import base64
import csv
import gzip
import hashlib
import json
from pathlib import Path
import sys

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from model.common import canonical, verify_file
from model.workspace import Workspace
from model import parameter_studies

SCHEMA = "upstate.native-input-response/v1"
TEMPLATE = Path(__file__).with_name("native_input_response.html")


def build(workspace_path, study_ids, output):
    import numpy as np
    import rasterio
    workspace = Workspace(workspace_path)
    output = Path(output).resolve()
    if output == workspace.root or output.is_relative_to(workspace.root):
        raise ValueError("Keep the reading package outside the original scientific Workspace")
    keys = list(dict.fromkeys(study_ids))
    if not keys:
        raise ValueError("Choose at least one complete original parameter study")
    output.mkdir(parents=True, exist_ok=True)
    packet = {"schema": SCHEMA, "project": workspace.project, "studies": [], "files": {}}
    flat_rows = []
    def retain(path, relative):
        path = Path(path)
        data = path.read_bytes()
        checksum = hashlib.sha256(data).hexdigest()
        destination = output / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists() and destination.read_bytes() != data:
            raise ValueError("Receiving output already holds different bytes: " + relative)
        if not destination.exists():
            destination.write_bytes(data)
        packet["files"].setdefault(relative, {"bytes": len(data), "sha256": checksum,
            "body": base64.b64encode(data).decode("ascii")})
        return relative
    for key in keys:
        state = parameter_studies.inspect(workspace, key)
        if state["state"] != "complete" or state["progress"]["completed"] != len(state["cases"]):
            raise ValueError("Complete the selected original study before publishing: " + key)
        root = workspace.root / "experiments" / key
        results_path = verify_file(root, state["artifacts"]["results"])
        results = json.loads(results_path.read_text(encoding="utf-8"))
        if results["experiment_id"] != key or results["workspace_id"] != workspace.project["id"]:
            raise ValueError("The result matrix belongs to another original study")
        baseline = workspace.inspect_run(state["selection"]["baseline_run_id"])
        scenario = workspace._get("scenarios", baseline["selection"]["scenario_id"])
        grid = workspace.get_grid(baseline["selection"]["grid_id"])
        study = {"id": key, "title": state["selection"]["title"],
            "scenario": scenario["title"], "selection": state["selection"],
            "rows": results["rows"], "cases": [], "downloads": {},
            "comparison_basis": results["comparison_basis"], "mass_basis": results["mass_basis"],
            "grid_id": grid["id"]}
        for label in ("report", "results", "csv", "selection", "profiles", "native_versions", "archive"):
            descriptor = state["artifacts"][label]
            original = verify_file(root, descriptor)
            study["downloads"][label] = retain(original, f"studies/{key}/" + descriptor["path"])
        # Retain every standalone member so the original report's relative links work.
        manifest_path = verify_file(root, state["artifacts"]["export_manifest"])
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest["study_id"] != key or manifest["workspace_id"] != workspace.project["id"]:
            raise ValueError("The original complete export manifest belongs to another study")
        for descriptor in manifest["files"]:
            retain(verify_file(root, descriptor), f"studies/{key}/" + descriptor["path"])
        retain(manifest_path, f"studies/{key}/export-manifest.json")
        differences = {row["run_id"]: row for row in results.get("difference_maps", {}).get("alternatives", [])}
        for case in state["cases"]:
            run = workspace.inspect_run(case["run_id"])
            case_row = {"id": case["id"], "run_id": run["id"], "label": case["label"],
                        "overrides": case["overrides"], "layers": {}}
            for pollutant in state["pollutants"]:
                modes = {"annual": (workspace.root / "runs" / run["id"], run["artifacts"][pollutant])}
                if run["id"] in differences:
                    modes["difference"] = (root, differences[run["id"]]["artifacts"][pollutant])
                case_row["layers"][pollutant] = {}
                for mode, (folder, descriptor) in modes.items():
                    path = verify_file(folder, descriptor)
                    relative = (f"rasters/{run['id']}/{pollutant}.tif" if mode == "annual"
                                else f"studies/{key}/" + descriptor["path"])
                    download = retain(path, relative)
                    with rasterio.open(path) as source:
                        values = source.read(1).astype("<f8", copy=False)
                        valid = (source.read_masks(1) > 0) & np.isfinite(values)
                        if not valid.any():
                            raise ValueError("The original raster has no finite valid cells")
                        transform = source.transform
                        layer = {"download": download, "width": source.width, "height": source.height,
                            "crs": str(source.crs), "affine": list(transform)[:6],
                            "units": descriptor["units"], "minimum": float(values[valid].min()),
                            "maximum": float(values[valid].max()), "valid_cells": int(valid.sum()),
                            "values": base64.b64encode(values.tobytes(order="C")).decode("ascii"),
                            "mask": base64.b64encode(valid.astype("uint8").tobytes(order="C")).decode("ascii")}
                        case_row["layers"][pollutant][mode] = layer
            study["cases"].append(case_row)
        packet["studies"].append(study)
        for row in results["rows"]:
            flat_rows.append({"study_id": key, "scenario": scenario["title"], **row})
    raw = canonical(packet)
    signature = hashlib.sha256(raw).hexdigest()
    payload = base64.b64encode(gzip.compress(raw, compresslevel=6, mtime=0)).decode("ascii")
    html = TEMPLATE.read_text(encoding="utf-8").replace("__NATIVE_PACKET__", payload).replace("__NATIVE_SIGNATURE__", signature)
    (output / "Native_Input_Response.html").write_text(html, encoding="utf-8")
    (output / "native-input-response.json").write_bytes(raw)
    columns = list(flat_rows[0])
    with (output / "all-results.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        for row in flat_rows:
            writer.writerow({k: json.dumps(v, sort_keys=True) if isinstance(v, (dict, list)) else v for k, v in row.items()})
    result = {"schema": SCHEMA, "project_id": workspace.project["id"], "study_ids": keys,
        "studies": len(keys), "cases": sum(len(row["cases"]) for row in packet["studies"]),
        "result_rows": len(flat_rows), "original_files": len(packet["files"]),
        "data_sha256": signature, "reader": "Native_Input_Response.html"}
    (output / "reader.json").write_text(json.dumps(result, indent=2)+"\n", encoding="utf-8")
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--study", action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    print(json.dumps(build(args.workspace, args.study, args.output), indent=2))


if __name__ == "__main__":
    main()
