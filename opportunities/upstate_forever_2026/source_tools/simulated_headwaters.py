"""Build and operate the retained simulated Piedmont headwaters demonstration.

All rasters, vectors and coefficients are declared simulated inputs. Native
Workspace/InVEST, delivery and portable producers calculate every result.
"""
from __future__ import annotations

import argparse
import csv
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import shutil
import sys
import tempfile
import time

APP = Path(__file__).resolve().parents[1]
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))

DEMO_ID = "upstate-simulated-piedmont-headwaters-v1"
OPERATION = "UPSTATE-DEMO-SIMULATED-INPUTS-20261013T140000Z"
EDITION = APP / "source" / "simulated_headwaters_20261013"
TABLE_FIELDS = ("lucode", "load_n", "load_p", "load_type_n", "load_type_p",
                "eff_n", "eff_p", "crit_len_n", "crit_len_p",
                "proportion_subsurface_n", "usle_c", "usle_p")
ASSUMED_COEFFICIENTS = (
    (21, 8, .9, .05, .05, .05),
    (41, 2, .12, .8, .8, .003),
    (81, 10, .7, .35, .35, .025),
    (82, 22, 1.8, .15, .15, .18),
)
UNITS = {"DEM": "m", "NLCD": "class", "PRECIPITATION": "mm/year",
         "R_FACTOR": "MJ*mm/(ha*h*year)", "K_FACTOR": "t*ha*h/(ha*MJ*mm)",
         "RESTORATION_MASK": "mask"}


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = path.with_name("." + path.name + ".pending")
    with pending.open("w", encoding="utf-8") as stream:
        json.dump(value, stream, indent=2, sort_keys=True, allow_nan=False)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(pending, path)


def sha256(path):
    result = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def descriptor(root, path):
    path = Path(path)
    return {"path": path.relative_to(root).as_posix(),
            "bytes": path.stat().st_size, "sha256": sha256(path)}


def verify_files(root, items):
    for item in items:
        path = Path(root) / item["path"]
        if path.stat().st_size != item["bytes"] or sha256(path) != item["sha256"]:
            raise ValueError("Retained demo input changed: " + item["path"])


def event(name, **values):
    print(json.dumps({"event": name, "at": utc_now(), **values},
                     sort_keys=True, allow_nan=False), flush=True)


def check_recipe(recipe):
    import numpy as np
    if recipe.get("schema") != "upstate.simulated-input-recipe/v1" or recipe.get("demo_id") != DEMO_ID:
        raise ValueError("Select the retained headwaters input recipe")
    grid = recipe["grid"]
    if (grid["width"], grid["height"], grid["resolution_m"], grid["crs"]) != (120, 120, 30, "EPSG:26917"):
        raise ValueError("Retained demonstration grid differs")
    arrays = {}
    for role in UNITS:
        values = np.asarray(recipe["arrays"][role])
        if values.size != grid["width"] * grid["height"] or not np.isfinite(values).all():
            raise ValueError("Incomplete/nonfinite input array: " + role)
        arrays[role] = values.reshape(grid["height"], grid["width"])
    if set(np.unique(arrays["NLCD"]).tolist()) != {21, 41, 81, 82}:
        raise ValueError("Unexpected simulated land-cover classes")
    if not np.isin(arrays["RESTORATION_MASK"], [0, 1]).all():
        raise ValueError("Restoration mask must be binary")
    change = (arrays["RESTORATION_MASK"] == 1) & np.isin(arrays["NLCD"], [81, 82])
    count = int(change.sum())
    if count != recipe["input_summary"]["changed_cells"]:
        raise ValueError("Restoration cells differ from original input summary")
    for role in ("PRECIPITATION", "R_FACTOR", "K_FACTOR"):
        if not (arrays[role] > 0).all():
            raise ValueError("Expected positive assumed physical input: " + role)
    return arrays


def write_inputs(output, recipe_path):
    import numpy as np
    import rasterio
    from rasterio.transform import Affine
    import fiona
    from fiona.crs import CRS

    recipe_path = Path(recipe_path).resolve(strict=True)
    recipe = read_json(recipe_path)
    arrays = check_recipe(recipe)
    checksum = sha256(recipe_path)
    destination = output / "inputs"
    source_receipt = destination / "input-receiving.json"
    if source_receipt.exists():
        prior = read_json(source_receipt)
        if prior["recipe_sha256"] != checksum:
            raise ValueError("Continue this output directory with its original recipe")
        verify_files(destination, prior["files"])
        return prior, recipe
    if destination.exists():
        raise ValueError("Existing inputs directory has no complete receipt; preserve it and select a new output directory")
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".simulated-inputs-", dir=output) as pending:
        root = Path(pending)
        grid = recipe["grid"]
        entries = []
        source_ids = {}

        def source(role, path, kind, **metadata):
            source_id = "SIM_" + role.upper()
            source_ids[role] = source_id
            entries.append({
                "id": source_id,
                "title": "SIMULATED: " + role.replace("_", " ").lower(),
                "uri": "upstate.simulated-input:" + DEMO_ID + "/" + path.name,
                "vintage": "2026-10-13 simulated demonstration edition",
                "kind": kind, "path": path.name,
                "sha256": sha256(path),
                "classification": "simulated", "recipe_sha256": checksum,
                **metadata,
            })

        for role, values in arrays.items():
            categorical = role in ("NLCD", "RESTORATION_MASK")
            path = root / (role.lower() + ".tif")
            dtype = "int16" if categorical else "float64"
            nodata = -9999
            with rasterio.open(path, "w", driver="GTiff", width=grid["width"],
                               height=grid["height"], count=1, dtype=dtype,
                               crs=grid["crs"], transform=Affine(*grid["transform"]),
                               nodata=nodata, compress="deflate") as target:
                target.write(values.astype(dtype), 1)
                target.update_tags(demo_id=DEMO_ID, classification="SIMULATED",
                                   role=role, units=UNITS[role],
                                   recipe_sha256=checksum)
            source(role, path, "raster", units=UNITS[role],
                   resampling="nearest" if categorical else "bilinear")

        schema = {"geometry": "Polygon",
                  "properties": {"demo_id": "str", "simulated": "int",
                                 "area_id": "str", "title": "str", "ws_id": "int"}}
        for role, feature in recipe["features"].items():
            path = root / (role + ".gpkg")
            with fiona.open(path, "w", driver="GPKG", layer=role,
                            crs=CRS.from_user_input(grid["crs"]), schema=schema) as target:
                target.write({
                    "geometry": feature["geometry"],
                    "properties": {"demo_id": DEMO_ID, "simulated": 1,
                                   "area_id": feature["properties"]["id"],
                                   "title": feature["properties"]["title"], "ws_id": 1},
                })
            source(role, path, "vector", layer=role)

        table = root / "biophysical.csv"
        with table.open("w", newline="", encoding="utf-8") as stream:
            writer = csv.DictWriter(stream, fieldnames=TABLE_FIELDS)
            writer.writeheader()
            for code, load_n, load_p, eff_n, eff_p, usle_c in ASSUMED_COEFFICIENTS:
                writer.writerow({
                    "lucode": code, "load_n": load_n, "load_p": load_p,
                    "load_type_n": "measured-runoff", "load_type_p": "measured-runoff",
                    "eff_n": eff_n, "eff_p": eff_p, "crit_len_n": 100,
                    "crit_len_p": 100, "proportion_subsurface_n": 0,
                    "usle_c": usle_c, "usle_p": 1,
                })
        source("BIOPHYSICAL", table, "table", units="declared in input-assumptions.json")
        assumptions = {
            "schema": "upstate.simulated-assumptions/v1", "demo_id": DEMO_ID,
            "classification": recipe["classification"], "recipe_sha256": checksum,
            "assumptions": recipe["assumptions"],
            "nutrient_loading": "Assumed runoff-export coefficients in kg/ha/year. The native measured-runoff enum describes coefficient semantics, not field measurement. Values are simulated.",
            "runoff_scaling": "Native NDR applies the common precipitation proxy divided by its source mean. Table loads are not pre-scaled.",
            "retention": "eff_n/eff_p are assumed maximum retention proportions; crit_len_n/crit_len_p are 100 m; groundwater nitrogen share is zero.",
            "sediment": "usle_c/usle_p are dimensionless assumed cover/support factors; all support factors are one.",
            "stream_threshold": "100 contributing 30 m cells = 9 ha; both native models use MFD.",
            "parameter_profile": "NDR k=2, subsurface length=150m, efficiency=.5; SDR k=2, maximum=.8, IC0=.5, maximum slope length=122m. These are demonstration assumptions.",
            "input_summary": recipe["input_summary"],
            "methods": [
                "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html",
                "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html",
            ],
        }
        atomic_json(root / "input-assumptions.json", assumptions)
        source("ASSUMPTIONS", root / "input-assumptions.json", "document")
        shutil.copyfile(recipe_path, root / "input-recipe.json")
        source("RECIPE", root / "input-recipe.json", "document")
        generator = recipe_path.parent / "generate-inputs.mjs"
        if generator.is_file():
            shutil.copyfile(generator, root / generator.name)
            source("GENERATOR", root / generator.name, "document")
        shutil.copyfile(Path(__file__), root / "simulated_headwaters.py")
        source("RUNNER", root / "simulated_headwaters.py", "document")
        atomic_json(root / "sources.json", {
            "schema": "upstate.sources/v1", "title": recipe["title"],
            "classification": recipe["classification"], "entries": entries,
        })
        receipt = {
            "schema": "upstate.simulated-input-receiving/v1", "demo_id": DEMO_ID,
            "recipe_sha256": checksum, "source_ids": source_ids,
            "input_summary": recipe["input_summary"],
            "files": [descriptor(root, path) for path in sorted(root.iterdir()) if path.is_file()],
        }
        atomic_json(root / "input-receiving.json", receipt)
        os.rename(root, destination)
    verify_files(destination, receipt["files"])
    return receipt, recipe


def operate(args):
    from model.common import held
    output = args.output.resolve()
    workspace = args.workspace.resolve()
    if output == workspace or output in workspace.parents or workspace in output.parents:
        raise ValueError("Keep the scientific Workspace and demo output in separate sibling directories")
    output.mkdir(parents=True, exist_ok=True)
    with held(output / ".demo-operation.lock", blocking=False):
        return operate_locked(args, output)


def operate_locked(args, output):
    from model.workspace import Workspace
    source, recipe = write_inputs(output, args.recipe)
    receipt_path = output / "demo-receiving.json"
    workspace_path = args.workspace.resolve()
    receipt = read_json(receipt_path) if receipt_path.exists() else {
        "schema": "upstate.simulated-demo-receiving/v1", "operation": OPERATION,
        "demo_id": DEMO_ID, "classification": recipe["classification"],
        "created_at": utc_now(), "workspace": str(workspace_path),
        "output": str(output), "workspace_directory": str(workspace_path),
        "output_directory": str(output), "recipe_sha256": source["recipe_sha256"],
        "input_summary": source["input_summary"], "source_ids": source["source_ids"],
        "stages": {}, "alternative_run_ids": [],
    }
    if receipt["recipe_sha256"] != source["recipe_sha256"] or Path(receipt["workspace"]) != workspace_path:
        raise ValueError("Resume the original recipe and Workspace recorded in demo-receiving.json")

    def save(**values):
        receipt.update(values, updated_at=utc_now())
        atomic_json(receipt_path, receipt)

    def phase(name, operation):
        started = time.perf_counter()
        save(active_stage=name, state="running")
        event("demo_stage_started", stage=name)
        try:
            result = operation()
        except Exception as exc:
            receipt["stages"].setdefault(name, {})["last_error"] = {
                "type": type(exc).__name__, "message": str(exc), "at": utc_now()}
            save(state="failed")
            raise
        elapsed = time.perf_counter() - started
        prior = receipt["stages"].get(name, {})
        receipt["stages"][name] = {
            "state": "complete", "first_completed_at": prior.get("first_completed_at", utc_now()),
            "first_elapsed_seconds": prior.get("first_elapsed_seconds", elapsed),
            "last_elapsed_seconds": elapsed,
            "completed_visits": prior.get("completed_visits", 0) + 1,
        }
        save()
        event("demo_stage_complete", stage=name, elapsed_seconds=elapsed)
        return result

    ws = Workspace(workspace_path, create=True, title=recipe["title"])
    save(project_id=ws.project["id"])
    imported = phase("import_sources", lambda: ws.import_sources(output / "inputs" / "sources.json"))
    collection = imported["id"]
    ids = source["source_ids"]
    save(source_collection_id=collection)
    profile = phase("save_profile", lambda: ws.save_profile({
        "title": "SIMULATED: Piedmont NDR/SDR assumptions",
        "source_collection_id": collection, "biophysical_source_id": ids["BIOPHYSICAL"],
        "models": ["ndr", "sdr"],
        "references": ["upstate.simulated-input:" + DEMO_ID + "/input-assumptions.json",
                       "recipe-sha256:" + source["recipe_sha256"],
                       "InVEST 3.20.0 NDR/SDR user guides and native implementation"],
        "ndr": {"threshold_flow_accumulation": 100, "k_param": 2,
                "flow_dir_algorithm": "mfd", "subsurface_critical_length_n": 150,
                "subsurface_eff_n": .5},
        "sdr": {"threshold_flow_accumulation": 100, "k_param": 2,
                "flow_dir_algorithm": "mfd", "sdr_max": .8, "ic_0_param": .5, "l_max": 122},
    }))
    save(profile_id=profile["id"])
    baseline = phase("save_baseline", lambda: ws.save_scenario({
        "title": recipe["scenario"]["baseline_title"], "kind": "baseline",
        "reason": "Use the complete retained simulated present land-cover edition.",
        "source_collection_id": collection, "patches": [],
    }))
    alternative = phase("save_alternative", lambda: ws.save_scenario({
        "title": recipe["scenario"]["title"], "kind": "landcover",
        "reason": recipe["scenario"]["reason"], "source_collection_id": collection,
        "patches": [{"mask_source_id": ids["RESTORATION_MASK"],
                     "from_codes": recipe["scenario"]["from_codes"],
                     "to_code": recipe["scenario"]["to_code"],
                     "reason": recipe["scenario"]["reason"]}],
    }))
    save(baseline_scenario_id=baseline["id"], alternative_scenario_ids=[alternative["id"]])
    grid = phase("prepare_grid", lambda: ws.prepare_grid({
        "title": "SIMULATED: 30 m headwaters model/reporting grid",
        "models": ["ndr", "sdr"], "source_collection_id": collection,
        "input_sources": {role: ids[role] for role in ("DEM", "NLCD", "PRECIPITATION", "R_FACTOR", "K_FACTOR")},
        "reporting_area": {"source_id": ids["reporting_area"], "layer": "reporting_area"},
        "model_domain": {"source_id": ids["model_domain"], "layer": "model_domain"},
        "upstream_buffer_m": 0, "resolution_m": 30,
        "domain_reason": "The retained simulated terrain covers the full explicit virtual catchment; no external upstream cells are asserted.",
    }))
    save(grid_id=grid["id"])
    runs = []
    for scenario in (baseline, alternative):
        runs.append(ws.prepare_run({"grid_id": grid["id"], "profile_id": profile["id"],
                                    "scenario_id": scenario["id"], "models": ["ndr", "sdr"]}))
    save(baseline_run_id=runs[0]["id"], alternative_run_ids=[runs[1]["id"]])
    if args.prepare_only:
        save(state="prepared", active_stage=None)
        return receipt
    installed = importlib.metadata.version("natcap.invest")
    if installed != recipe["model_version"]:
        raise ValueError("This retained demo requires native InVEST " + recipe["model_version"] + "; installed " + installed)
    save(invest_version=installed)
    for index, run in enumerate(runs):
        result = phase("baseline_native" if index == 0 else "alternative_native",
                       lambda key=run["id"]: ws.run(key))
        if result.get("state") != "complete":
            raise ValueError("Native run did not complete: " + run["id"])
    comparison = phase("compare_runs", lambda: ws.compare_runs([run["id"] for run in runs]))
    save(comparison_id=comparison["id"])
    atomic_json(output / "native-comparison.json", comparison)

    from model import native_process_report
    process_selection = {
        "schema": "upstate.native-process-selection/v1",
        "title": "Simulated headwaters: native nutrient and sediment processes",
        "run_ids": [run["id"] for run in runs], "models": ["ndr", "sdr"],
        "include_figures": True,
    }
    atomic_json(output / "native-process-selection.json", process_selection)
    process_report = phase("native_process_report",
                           lambda: native_process_report.build(ws, process_selection, render=True))
    save(native_process_report_id=process_report["id"])
    delivery_selection = {
        "delivery_mode": "native_study", "audit_scope": "source-native",
        "native_study": {"title": recipe["title"],
                         "purpose": "A declared simulated input edition operated through native NDR/SDR and paired riparian restoration.",
                         "reference": "recipe-sha256:" + source["recipe_sha256"]},
        "baseline_run_id": runs[0]["id"], "scenario_run_ids": [runs[1]["id"]],
        "contact": {"name": "Upper Savannah project team",
                    "organization": "Internal simulated demonstration", "email": ""},
        "source_roles": {},
        "overlays": {
            "drinking_water": {"source_collection_id": collection,
                               "source_id": ids["drinking_water"],
                               "label": "Simulated drinking-water source area"},
            "high_quality_waters": {"source_collection_id": collection,
                                   "source_id": ids["high_quality"],
                                   "label": "Simulated headwater conservation priority area"},
        },
        "map_settings": {"weights": {"nitrogen_export": 1, "phosphorus_export": 1, "sediment_export": 1}},
        "notes": recipe["assumptions"],
    }
    delivery_selection = native_process_report.attach(ws, process_report["id"], delivery_selection)
    atomic_json(output / "delivery-selection.json", delivery_selection)
    delivery = phase("mapped_delivery", lambda: ws.build_delivery(delivery_selection))
    if delivery.get("state") != "complete":
        raise ValueError("Finish the mapped delivery before archiving the demonstration")
    save(delivery_id=delivery["id"], delivery_state=delivery["state"])
    atomic_json(output / "mapped-delivery.json", delivery)

    from model import portable
    edition_id = delivery["id"]
    archives = output / "archives"
    archives.mkdir(parents=True, exist_ok=True)
    archive = archives / (edition_id + ".zip")
    records = receipt.setdefault("archive_editions", {})
    record = records.setdefault(edition_id, {})
    required_members = [
        "workspace/workspace.json",
        *["workspace/runs/" + run["id"] + "/run.json" for run in runs],
        "workspace/deliveries/" + edition_id + "/delivery-state.json",
    ]

    def inspect_selected_archive():
        manifest = portable.inspect_archive(archive, verify=True)
        if manifest["project"] != ws.project:
            raise ValueError("Existing archive belongs to another scientific project")
        if any(name not in manifest["members"] for name in required_members):
            raise ValueError("Existing archive lacks the selected completed runs or delivery")
        return manifest

    if record.get("backup"):
        saved = record["backup"]
        if archive.stat().st_size != saved["bytes"] or sha256(archive) != saved["sha256"]:
            raise ValueError("Retained demo archive changed")
        manifest = inspect_selected_archive()
    elif archive.exists():
        manifest = phase("recover_published_archive", inspect_selected_archive)
        saved = {
            "schema": manifest["schema"], "project_id": manifest["project"]["id"],
            "path": str(archive), "bytes": archive.stat().st_size,
            "sha256": sha256(archive), "members": len(manifest["members"]),
            "selection": manifest["selection"], "recovered_existing_archive": True,
        }
    else:
        saved = phase("archive", lambda: ws.backup(archive, include_intermediates=True))
        manifest = inspect_selected_archive()
    record["backup"] = saved
    save(backup=saved, archive_edition_id=edition_id, archive_editions=records)
    restored_root = output / "reopened" / edition_id
    if record.get("restored"):
        restored = record["restored"]
    elif restored_root.exists():
        def recover_restored():
            for name, original in manifest["members"].items():
                actual = restored_root / name
                if (actual.is_symlink() or not actual.is_file()
                        or actual.stat().st_size != original["bytes"]
                        or sha256(actual) != original["sha256"]):
                    raise ValueError("Existing receiving member differs: " + name)
            original_project = read_json(restored_root / "workspace" / "workspace.json")
            if original_project != manifest["project"]:
                raise ValueError("Existing receiving project differs")
            return {
                "schema": "upstate.scientific-workspace-receiving/v1",
                "project": original_project, "directory": str(restored_root),
                "workspace": str(restored_root / "workspace"),
                "application": str(restored_root / "application"),
                "archive_sha256": saved["sha256"], "members": len(manifest["members"]),
                "selection": manifest["selection"], "identity": "MATCH",
                "recovered_existing_receiving": True,
            }
        restored = phase("recover_published_receiving", recover_restored)
    else:
        restored_root.parent.mkdir(parents=True, exist_ok=True)
        restored = phase("restore", lambda: portable.restore(archive, restored_root))
    record["restored"] = restored
    save(restored=restored, archive_editions=records)
    reopened = Workspace(restored["workspace"])
    if reopened.project["id"] != ws.project["id"]:
        raise ValueError("Reopened project identity differs")
    for original in runs:
        if reopened.inspect_run(original["id"]).get("state") != "complete":
            raise ValueError("Reopened native run is incomplete")
    if reopened.retained_item("deliveries", delivery["id"]).get("id") != delivery["id"]:
        raise ValueError("Reopened delivery identity differs")
    save(state="complete", active_stage=None, reopened_project_id=reopened.project["id"],
         completed_at=receipt.get("completed_at", utc_now()))
    event("demo_complete", receipt=str(receipt_path), baseline_run_id=runs[0]["id"],
          alternative_run_ids=[runs[1]["id"]], delivery_id=delivery["id"],
          archive=receipt["backup"])
    return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--recipe", type=Path, default=EDITION / "input-recipe.json")
    parser.add_argument("--prepare-only", action="store_true",
                        help="Retain actual inputs/grid/scenarios and prepared runs before native execution.")
    args = parser.parse_args(argv)
    result = operate(args)
    print(json.dumps(result, indent=2, sort_keys=True, allow_nan=False))


if __name__ == "__main__":
    main()
