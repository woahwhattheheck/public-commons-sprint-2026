"""One complete, explicitly authored SOFTWARE exercise, not watershed model evidence.

Produces GeoTIFF interventions and native-shaped GPKG/shapefile result carriers.
The fixture executor is deliberately labeled, does NOT implement InVEST science,
and is not exposed by the customer CLI. Native integration uses the actual
natcap.invest executors. Run: python exercise.py /path/to/new/exercise-directory
"""
from __future__ import annotations
import copy
from pathlib import Path
import shutil
import sys
import time
import json
import fiona
import numpy as np
import rasterio
from rasterio.transform import from_origin
from shapely.geometry import box, mapping
from eco_scenario_lab.engine import freeze, revise, run_workspace, verify_plan
from eco_scenario_lab.results import BINDINGS, build_comparison, rank, render_report
from eco_scenario_lab.store import (ScenarioError, atomic_json, dataset_hash, file_hash,
                                    export_workspace, receive_workspace, read_json)

ROOT = Path(sys.argv[1]).resolve()
if ROOT.exists():
    raise RuntimeError("Use a fresh exercise directory")
ROOT.mkdir(parents=True)
t0 = time.monotonic()
inputs = ROOT / "inputs"
inputs.mkdir()
SIZE = 2048
transform = from_origin(300000, 4000000, 30, 30)
original = np.full((SIZE, SIZE), 82, dtype="uint8")
original[:16, :] = 255
original[:, :16] = 255
with rasterio.open(inputs / "lulc.tif", "w", driver="GTiff", count=1, width=SIZE,
                   height=SIZE, dtype="uint8", nodata=255, crs="EPSG:26917", transform=transform,
                   tiled=True, compress="deflate", blockxsize=512, blockysize=512) as dst:
    dst.write(original, 1)
parcels = []
# 256 disjoint parcels, each with stable IDs. Chosen parcels span block boundaries.
for row in range(16):
    for col in range(16):
        left, top = transform * (col * 128 + 20, row * 128 + 20)
        right, bottom = transform * (col * 128 + 100, row * 128 + 100)
        parcels.append({"type": "Feature", "geometry": mapping(box(left, bottom, right, top)),
                        "properties": {"parcel_id": f"P-{row:02d}-{col:02d}"}})
with fiona.open(inputs / "parcels.gpkg", "w", driver="GPKG", crs="EPSG:26917", layer="parcels",
                schema={"geometry": "Polygon", "properties": {"parcel_id": "str"}}) as dst:
    dst.writerecords(parcels)
with fiona.open(inputs / "watersheds.gpkg", "w", driver="GPKG", crs="EPSG:26917", layer="watersheds",
                schema={"geometry": "Polygon", "properties": {"ws_id": "int"}}) as dst:
    for ws in range(2):
        left, top = transform * (ws * 1024, 0)
        right, bottom = transform * ((ws+1) * 1024, SIZE)
        dst.write({"geometry": mapping(box(left, bottom, right, top)), "properties": {"ws_id": ws+1}})
(inputs / "biophysical.csv").write_text("lucode,load_n,load_p,eff_n,eff_p,crit_len_n,crit_len_p,proportion_subsurface_n,usle_c,usle_p,lulc_veg,root_depth,kc\n82,10,1,0.1,0.1,30,30,0,0.1,1,1,1000,1\n41,1,0.1,0.8,0.8,30,30,0,0.01,1,1,1500,0.8\n")
left_ids = [p["properties"]["parcel_id"] for p in parcels if int(p["properties"]["parcel_id"][-2:]) < 8]
right_ids = [p["properties"]["parcel_id"] for p in parcels if int(p["properties"]["parcel_id"][-2:]) >= 8]
scenarios = [{"id": name, "cost_cents": cost, "interventions": [{"parcel_ids": ids, "to_code": 41, "from_codes": [82]}]}
             for name, cost, ids in [("west", 100000, left_ids), ("east", 120000, right_ids),
                                     ("combined", 180000, left_ids + right_ids)]]
models = {m: {"args": {"lulc_path": "inputs/lulc.tif", "watersheds_path": "inputs/watersheds.gpkg",
                       "biophysical_table_path": "inputs/biophysical.csv"}, "result": {"id_field": "ws_id"}}
          for m in BINDINGS}
models["ndr"]["args"].update(calc_n=True, calc_p=True)
plan = {"schema": 1, "project_id": "authored-software-exercise", "setup_id": "fixture-v1", "currency": "USD",
        "source_manifest": {"kind": "authored-software-fixture", "description": "Not Upper Savannah data or InVEST model results"},
        "lulc_path": "inputs/lulc.tif", "parcels_path": "inputs/parcels.gpkg", "parcel_id_field": "parcel_id",
        "pixel_rule": "center", "models": models, "scenarios": scenarios,
        "cases": [{"id": "case-a", "overrides": {}},
                  {"id": "case-b", "overrides": {m: {"fixture_multiplier": 1.5} for m in models}}]}
atomic_json(ROOT / "plan.json", plan)
workspace = ROOT / "workspace"
prepared = freeze(ROOT / "plan.json", workspace)
assert prepared["planned_native_runs"] == 24
state = read_json(workspace / "state.json")
assert state["prepared"]["west"]["changed_pixels"] == 819200
assert state["prepared"]["combined"]["changed_pixels"] == 1638400
with rasterio.open(workspace / state["prepared"]["combined"]["path"]) as src:
    data = src.read(1)
    assert np.all(data[original == 255] == 255)
    assert src.transform == transform
    assert src.crs.to_epsg() == 26917

calls = []
failure = {"pending": True}
def fixture_executor(model, args, expected_version, python, log):
    """Native carrier/driver integration fixture; deliberately not InVEST science."""
    calls.append((model, args["lulc_path"]))
    log.write_text("SOFTWARE FIXTURE EXECUTOR — not a native InVEST run\n")
    if failure["pending"] and model == "sdr":
        failure["pending"] = False
        raise RuntimeError("Injected process interruption for recovery exercise")
    with rasterio.open(args["lulc_path"]) as src:
        values = src.read(1)
        fraction = [float((values[:, w*1024:(w+1)*1024] == 41).mean()) for w in range(2)]
    output = Path(args["workspace_dir"]) / BINDINGS[model]["path"]
    output.parent.mkdir(parents=True, exist_ok=True)
    metrics = BINDINGS[model]["metrics"]
    properties = {"ws_id": "int", **{m["field"]: "float:24.10" for m in metrics.values()}}
    driver = "GPKG" if output.suffix == ".gpkg" else "ESRI Shapefile"
    with fiona.open(output, "w", driver=driver, crs="EPSG:26917",
                    schema={"geometry": "Polygon", "properties": properties}) as dst:
        with fiona.open(args["watersheds_path"]) as src:
            for feature in reversed(list(src)):  # Deliberately reorder rows.
                ws = feature["properties"]["ws_id"]
                f = fraction[ws-1]
                props = {"ws_id": ws}
                for name, meta in metrics.items():
                    # Distinct nonlinear software fixture response exercises full
                    # alternatives; this formula is NOT a hydrologic model.
                    base = 1000 if model == "ndr" else 100 if model == "sdr" else 50000
                    factor = args.get("fixture_multiplier", 1.0)
                    props[meta["field"]] = base * (1 - f*f) * factor
                dst.write({"geometry": feature["geometry"], "properties": props})
    return {"engine": "authored-software-fixture", "model": model, "invest_version": expected_version}

state = run_workspace(workspace, executor=fixture_executor, engine_identity="SOFTWARE-FIXTURE-NOT-INVEST", stop_after=5)
assert len(calls) == 5 and any(j["status"] == "failed" for j in state["jobs"].values())
state = run_workspace(workspace, executor=fixture_executor, engine_identity="SOFTWARE-FIXTURE-NOT-INVEST")
assert len(calls) == 25
assert len(state["jobs"]) == 24 and all(j["status"] == "complete" for j in state["jobs"].values())
assert any(len(j["attempts"]) == 2 for j in state["jobs"].values())
run_workspace(workspace, executor=fixture_executor, engine_identity="SOFTWARE-FIXTURE-NOT-INVEST")
assert len(calls) == 25, "Warm cache must not rerun completed jobs"
comparison = build_comparison(workspace)
assert len(comparison["rows"]) == 80 and not comparison["incomplete"]
assert all(r["benefit"] is None for r in comparison["rows"] if r["model"] == "annual_water_yield")
objectives = [{"watershed_id": str(i), "metric": "nitrogen_export"} for i in [1, 2]]
ranking = rank(comparison, objectives, 180000)
assert {s["scenario_id"] for s in ranking["scenarios"]} == {"baseline", "west", "east", "combined"}
render_report(workspace, comparison, ranking)
atomic_json(workspace / "reports" / "ranking.json", ranking)
assert "SOFTWARE-FIXTURE-NOT-INVEST" in (workspace / "reports" / "index.html").read_text()

exported = export_workspace(workspace, ROOT / "exercise.ecoscenarios.zip")
received = ROOT / "received"
receive_workspace(ROOT / "exercise.ecoscenarios.zip", received)
assert build_comparison(received) == comparison
run_workspace(received, executor=fixture_executor, engine_identity="SOFTWARE-FIXTURE-NOT-INVEST")
assert len(calls) == 25, "Received complete workspaces reuse verified completed runs"
atomic_json(ROOT / "revision.json", {"setup_id": "fixture-v2", "scenarios": [scenarios[2]]})
revision = revise(received, ROOT / "revision", ROOT / "revision.json")
assert revision["scenarios"] == 1
assert read_json(received / "plan.json")["setup_id"] == "fixture-v1"

# Reject changed DBF values even if SHP geometry is unchanged.
sdr_job = next(j for j in state["jobs"].values() if j["model"] == "sdr")
shp = received / sdr_job["native_table_path"]
dbf = shp.with_suffix(".dbf")
original_dbf = dbf.read_bytes()
modified = bytearray(original_dbf); modified[-2] ^= 1
dbf.write_bytes(modified)
try:
    build_comparison(received)
    raise AssertionError("DBF mutation was accepted")
except ScenarioError:
    pass
dbf.write_bytes(original_dbf)
# Duplicate parcel ownership is rejected before any runnable workspace is published.
bad = copy.deepcopy(plan)
bad["scenarios"][0]["interventions"].append(bad["scenarios"][0]["interventions"][0])
atomic_json(ROOT / "bad.json", bad)
try:
    freeze(ROOT / "bad.json", ROOT / "bad-workspace")
    raise AssertionError("Overlapping ownership was accepted")
except ScenarioError:
    pass
assert not (ROOT / "bad-workspace").exists()
summary = {"kind": "software-integration-exercise", "native_invest_executed": False,
           "raster_cells": SIZE*SIZE, "parcels": len(parcels), "scenarios_including_baseline": 4,
           "matched_cases": 2, "models": 3, "retained_jobs": len(state["jobs"]),
           "executor_calls_including_recovery": len(calls), "paired_metric_rows": len(comparison["rows"]),
           "verified_portable_files": exported["files"], "independent_revision": revision["plan_sha256"],
           "elapsed_seconds": round(time.monotonic()-t0, 3)}
atomic_json(ROOT / "exercise-summary.json", summary)
print(json.dumps(summary, indent=2))
