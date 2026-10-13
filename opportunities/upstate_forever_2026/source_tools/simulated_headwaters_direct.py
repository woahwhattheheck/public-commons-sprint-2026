#!/usr/bin/env python3
"""TokenJunkieLabs synthetic headwaters: official InVEST 3.20 NDR + SDR.

Preparation requires numpy/rasterio/fiona/shapely, not InVEST or pygeoprocessing.
Native execution requires the existing official natcap.invest 3.20 runtime.
This is an isolated synthetic replica, not the original nine-file workspace.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import importlib.metadata
import json
import logging
import math
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import traceback
from datetime import datetime, timezone

# These controls apply before any native/GIS/numerical library is imported.
for _key, _value in {"GDAL_CACHEMAX": "16", "GDAL_NUM_THREADS": "1",
                    "OMP_NUM_THREADS": "1", "OPENBLAS_NUM_THREADS": "1",
                    "MKL_NUM_THREADS": "1", "NUMEXPR_NUM_THREADS": "1"}.items():
    os.environ[_key] = _value

CASE_ID = "TJL-SYNTHETIC-HEADWATERS-120X120-20261013"
SCENARIOS = ("baseline", "riparian_restoration", "matched_control")
SOURCES = {
    "ndr_guide": "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html",
    "sdr_guide": "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html",
    "ndr_source": "https://raw.githubusercontent.com/natcap/invest/3.20.0/src/natcap/invest/ndr/ndr.py",
    "sdr_source": "https://raw.githubusercontent.com/natcap/invest/3.20.0/src/natcap/invest/sdr/sdr.py",
}
SOURCE_SHA256 = {
    "ndr_source": "5c4353d9548af59d048c0ea14b39545e0f3e813d43371a93127e2f3cbc87508b",
    "sdr_source": "257ce59ee2eed4711cfbced4251f20737902155f86b0fb16f85b7926ac2ec278",
}
DEFAULT_CONFIG = {
    "case_id": CASE_ID, "synthetic": True, "rows": 120, "cols": 120,
    "pixel_m": 30, "crs": "EPSG:32617", "origin_x": 500000,
    "origin_y": 3900000, "cutoff_utc": "2026-10-13T14:00:00Z",
    "terrain": {"outlet_elevation_m": 100, "valley_column": 60,
                "longitudinal_slope": 0.025, "cross_valley_slope": 0.06,
                "cross_valley_curvature_per_m": 0.000005},
    "rainfall_mm_year": {"south": 1100, "north": 1300},
    "erosivity_MJ_mm_per_ha_hour_year": 4000,
    "erodibility_metric_ton_ha_hour_per_ha_MJ_mm": 0.025,
    "routing": {"flow_dir_algorithm": "mfd", "threshold_flow_accumulation": 100},
    "ndr": {"k_param": 2.0, "subsurface_critical_length_n": 150,
            "subsurface_eff_n": 0.8},
    "sdr": {"k_param": 2.0, "sdr_max": 0.8, "ic_0_param": 0.5, "l_max": 122},
    "lulc_parameters": [
        {"lucode": 1, "description": "Forest", "load_n": 5, "load_p": 0.4,
         "eff_n": 0.8, "eff_p": 0.8, "crit_len_n": 150, "crit_len_p": 150,
         "proportion_subsurface_n": 0, "usle_c": 0.003, "usle_p": 1},
        {"lucode": 2, "description": "Pasture", "load_n": 30, "load_p": 3,
         "eff_n": 0.5, "eff_p": 0.5, "crit_len_n": 150, "crit_len_p": 150,
         "proportion_subsurface_n": 0, "usle_c": 0.02, "usle_p": 1},
        {"lucode": 3, "description": "Crop", "load_n": 100, "load_p": 15,
         "eff_n": 0.2, "eff_p": 0.2, "crit_len_n": 150, "crit_len_p": 150,
         "proportion_subsurface_n": 0, "usle_c": 0.2, "usle_p": 0.8},
        {"lucode": 4, "description": "Developed", "load_n": 20, "load_p": 2,
         "eff_n": 0.1, "eff_p": 0.1, "crit_len_n": 150, "crit_len_p": 150,
         "proportion_subsurface_n": 0, "usle_c": 0.1, "usle_p": 1},
    ],
    "parameter_basis": "Editable illustrative assumptions; no observed/calibrated parameter claim. Nutrient loads are application rates in kg/ha/year; native InVEST applies on-pixel retention. C/P and efficiencies are dimensionless; critical lengths are metres.",
}
ROOT: Path | None = None
CHILD: subprocess.Popen | None = None


def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    temporary.replace(path)


def event(stage, **values):
    record = {"time_utc": now(), "stage": stage, **values}
    print(json.dumps(record, allow_nan=False), flush=True)
    if ROOT:
        with (ROOT / "stages.jsonl").open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(record, allow_nan=False) + "\n")
        write_json(ROOT / "status.json", record)


def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for part in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(part)
    return h.hexdigest()


def cutoff(config):
    return datetime.fromisoformat(config["cutoff_utc"].replace("Z", "+00:00")).timestamp()


def remaining(config):
    seconds = cutoff(config) - time.time()
    if seconds <= 0:
        raise TimeoutError("Owner build cutoff reached; outputs retained as incomplete")
    return seconds


def write_csv(path, rows):
    if not rows:
        return
    with Path(path).open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def prepare(config):
    import numpy as np
    import rasterio
    from rasterio.transform import from_origin
    import fiona
    from shapely.geometry import box, mapping, Point, LineString

    remaining(config)
    assert config["synthetic"] is True
    assert (config["rows"], config["cols"], config["pixel_m"]) == (120, 120, 30)
    inputs = ROOT / "inputs"
    inputs.mkdir(exist_ok=True)
    rows, cols = np.indices((120, 120))
    x = (cols - config["terrain"]["valley_column"]) * 30.0
    upstream = (119 - rows) * 30.0
    t = config["terrain"]
    dem = (t["outlet_elevation_m"] + t["longitudinal_slope"] * upstream
           + t["cross_valley_slope"] * np.abs(x)
           + t["cross_valley_curvature_per_m"] * x*x)
    # Every non-outlet cell has a lower neighbor toward the valley/south.
    assert np.all(np.diff(dem, axis=0) < 0)
    assert np.argmin(dem) == 119 * 120 + t["valley_column"]
    rainfall = config["rainfall_mm_year"]["south"] + (
        config["rainfall_mm_year"]["north"] - config["rainfall_mm_year"]["south"]) * (119-rows)/119
    baseline = np.full((120, 120), 3, dtype="int16")
    baseline[(cols < 36) | (rows < 24)] = 1
    baseline[(cols >= 36) & (cols < 78) & (rows >= 24)] = 2
    baseline[(cols >= 108) & (rows >= 84)] = 4
    riparian = (np.abs(x) <= 90) & (rows >= 24)
    control = (cols >= 71) & (cols < 78) & (rows >= 24)
    assert int(riparian.sum()) == int(control.sum()) == 672
    assert np.all(baseline[riparian] == 2) and np.all(baseline[control] == 2)
    assert not np.any(riparian & control)
    transform = from_origin(config["origin_x"], config["origin_y"], 30, 30)
    profile = dict(driver="GTiff", width=120, height=120, count=1,
                   crs=config["crs"], transform=transform, compress="deflate")
    def raster(name, array, dtype="float32", units="unitless"):
        with rasterio.open(inputs / name, "w", **profile, dtype=dtype, nodata=-9999) as dst:
            dst.write(np.asarray(array, dtype=dtype), 1)
            dst.update_tags(case_id=CASE_ID, synthetic="true", units=units)
    raster("dem.tif", dem, units="m")
    raster("rainfall.tif", rainfall, units="mm/year; NDR normalized runoff proxy")
    raster("erosivity.tif", np.full((120, 120), config["erosivity_MJ_mm_per_ha_hour_year"]), units="MJ mm/(ha hour year)")
    raster("erodibility.tif", np.full((120, 120), config["erodibility_metric_ton_ha_hour_per_ha_MJ_mm"]), units="metric ton ha hour/(ha MJ mm)")
    raster("riparian_change_mask.tif", riparian, "int16")
    raster("matched_control_change_mask.tif", control, "int16")
    lulc = {}
    cover_rows = []
    for scenario in SCENARIOS:
        values = baseline.copy()
        if scenario != "baseline":
            values[riparian if scenario == "riparian_restoration" else control] = 1
        raster(f"lulc_{scenario}.tif", values, "int16")
        lulc[scenario] = values
        for parameter in config["lulc_parameters"]:
            count = int((values == parameter["lucode"]).sum())
            cover_rows.append(dict(scenario=scenario, lucode=parameter["lucode"],
                                   description=parameter["description"], cells=count,
                                   fraction=count/14400, area_ha=count*0.09))
    # A fictional UTM grid supplies metre units, not a real-site location claim.
    x0, y0 = config["origin_x"], config["origin_y"]
    geometries = [("watershed.gpkg", "Polygon", box(x0, y0-3600, x0+3600, y0)),
                  ("outlet.gpkg", "Point", Point(x0+60*30+15, y0-119*30-15)),
                  ("conceptual_valley.gpkg", "LineString", LineString([(x0+1815, y0-15), (x0+1815, y0-3585)]))]
    for name, kind, geometry in geometries:
        path = inputs / name
        # Regeneration is scoped to this named replica's own prepared input.
        if path.exists():
            path.unlink()
        with fiona.open(path, "w", driver="GPKG", crs=config["crs"],
                        schema={"geometry": kind, "properties": {"ws_id": "int"}}, layer="source") as dst:
            dst.write({"geometry": mapping(geometry), "properties": {"ws_id": 1}})
    parameters = []
    for p in config["lulc_parameters"]:
        parameters.append({**p, "load_type_n": "application-rate", "load_type_p": "application-rate"})
    write_csv(inputs / "biophysical.csv", parameters)
    write_csv(inputs / "landcover_areas.csv", cover_rows)
    write_json(ROOT / "config.json", config)
    manifest = dict(case_id=CASE_ID, synthetic=True, original_workspace=False,
                    cells=14400, pixel_area_ha=0.09, area_km2=12.96,
                    changed_cells=672, changed_area_ha=60.48,
                    matched_control="Same original pasture cover, area and row positions; lateral position differs.",
                    geometry="Synthetic V-shaped valley with unique southern low cell; stream network is calculated by native routing. Conceptual valley/outlet layers are reference geometry, not routing inputs.",
                    input_files=[dict(path=str(p.relative_to(ROOT)), bytes=p.stat().st_size, sha256=digest(p)) for p in sorted(inputs.iterdir()) if p.is_file()],
                    parameter_basis=config["parameter_basis"], sources=SOURCES, source_sha256=SOURCE_SHA256)
    write_json(ROOT / "input_manifest.json", manifest)
    event("prepared", case_id=CASE_ID, cells=14400, area_km2=12.96,
          changed_cells=672, changed_area_ha=60.48)


def model_args(config, scenario, model):
    inputs = ROOT / "inputs"
    args = dict(workspace_dir=str(ROOT / "native" / scenario / model), results_suffix="",
                dem_path=str(inputs / "dem.tif"), lulc_path=str(inputs / f"lulc_{scenario}.tif"),
                watersheds_path=str(inputs / "watershed.gpkg"),
                biophysical_table_path=str(inputs / "biophysical.csv"),
                n_workers=-1, **config["routing"], **config[model])
    if model == "ndr":
        args.update(calc_n=True, calc_p=True, runoff_proxy_path=str(inputs / "rainfall.tif"))
    else:
        args.update(erosivity_path=str(inputs / "erosivity.tif"),
                    erodibility_path=str(inputs / "erodibility.tif"), drainage_path="")
    return args


def native_child(model, args_path):
    event("native_process_start", model=model, python=sys.version, executable=sys.executable)
    version = importlib.metadata.version("natcap.invest")
    if version.split("+")[0] != "3.20.0":
        raise RuntimeError(f"Official InVEST 3.20.0 required; installed {version}")
    from natcap.invest.ndr import ndr
    from natcap.invest.sdr import sdr
    from osgeo import gdal
    gdal.SetCacheMax(16*1024*1024)
    module = {"ndr": ndr, "sdr": sdr}[model]
    args = json.loads(Path(args_path).read_text())
    Path(args["workspace_dir"]).mkdir(parents=True, exist_ok=True)
    warnings = module.validate(args)
    write_json(Path(args["workspace_dir"]) / "native_validation.json", warnings)
    if warnings:
        raise RuntimeError(f"Native {model} validation failed: {warnings}")
    event("native_validation_complete", model=model, warnings=0, version=version)
    registry = module.execute(args)
    write_json(Path(args["workspace_dir"]) / "native_execution.json",
               dict(version=version, module_path=module.__file__, module_sha256=digest(module.__file__),
                    completed_utc=now(), args=args, registry=registry))
    event("native_execute_complete", model=model)


def stop_child():
    global CHILD
    if CHILD is None or CHILD.poll() is not None:
        return
    if os.name == "posix":
        os.killpg(CHILD.pid, signal.SIGTERM)
    else:
        CHILD.terminate()
    try:
        CHILD.wait(timeout=8)
    except subprocess.TimeoutExpired:
        if os.name == "posix":
            os.killpg(CHILD.pid, signal.SIGKILL)
        else:
            CHILD.kill()
        CHILD.wait()


def run_native(config, scenario, model):
    global CHILD
    seconds = remaining(config)
    args = model_args(config, scenario, model)
    path = ROOT / "arguments" / f"{scenario}_{model}.json"
    write_json(path, args)
    event("native_launch", scenario=scenario, model=model, seconds_to_cutoff=seconds)
    CHILD = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--native-child", model,
                              "--args", str(path)], start_new_session=(os.name == "posix"))
    try:
        code = CHILD.wait(timeout=seconds)
    except subprocess.TimeoutExpired:
        stop_child()
        raise TimeoutError(f"Owner cutoff interrupted {scenario}/{model}; partial native files retained")
    if code:
        raise RuntimeError(f"Native {scenario}/{model} exited {code}")
    remaining(config)


def collect_scenario(scenario):
    import numpy as np
    import rasterio
    import fiona
    metrics = [("nitrogen", "ndr", "n_total_export.tif", "watershed_results_ndr.gpkg", "n_total_export", "kg/year"),
               ("phosphorus", "ndr", "p_surface_export.tif", "watershed_results_ndr.gpkg", "p_surface_export", "kg/year"),
               ("sediment", "sdr", "sed_export.tif", "watershed_results_sdr.shp", "sed_export", "metric_ton/year")]
    result, display = {"scenario": scenario}, {}
    for name, model, raster_name, vector_name, field, unit in metrics:
        directory = ROOT / "native" / scenario / model
        with rasterio.open(directory / raster_name) as src:
            values = src.read(1, masked=True)
            assert (src.height, src.width) == (120, 120), src.shape
            assert src.crs.to_epsg() == 32617
            area_ha = abs(src.transform.a * src.transform.e) / 10000
            assert math.isclose(area_ha, 0.09, rel_tol=1e-9)
            raw_sum = float(values.sum(dtype="float64"))
            finite = values.compressed()
            assert finite.size and np.isfinite(finite).all() and np.min(finite) >= -1e-6
            raster_mass = raw_sum * area_ha  # Exactly once: official 3.20 rates per hectare.
            display[name] = dict(native_raster=str((directory / raster_name).relative_to(ROOT)),
                                 units="kg/ha/year" if model == "ndr" else "metric_ton/ha/year",
                                 width=120, height=120,
                                 cells=[None if np.ma.is_masked(v) else round(float(v), 7) for v in values.flat])
        with fiona.open(directory / vector_name) as src:
            assert field in src.schema["properties"], (field, src.schema)
            vector_mass = sum(float(feature["properties"][field]) for feature in src)
        assert math.isclose(raster_mass, vector_mass, rel_tol=1e-5, abs_tol=1e-5), (name, raster_mass, vector_mass)
        result[name + "_export"] = vector_mass
        result[name + "_unit"] = unit
        result[name + "_raw_raster_sum"] = raw_sum
        result[name + "_raster_mass_once"] = raster_mass
        result[name + "_valid_cells"] = int(finite.size)
        result[name + "_aggregation_difference"] = raster_mass - vector_mass
    with rasterio.open(ROOT / "native" / scenario / "ndr" / "stream.tif") as src:
        streams = src.read(1, masked=True)
        count = int(np.ma.filled(streams == 1, False).sum())
        assert count > 0, "Native routing produced no stream"
        result["native_stream_cells"] = count
        display["stream"] = {"width": 120, "height": 120,
                             "cells": [None if np.ma.is_masked(v) else int(v) for v in streams.flat]}
    write_json(ROOT / "results" / f"{scenario}.json", result)
    return result, display


def comparison(results, displays):
    base = next(item for item in results if item["scenario"] == "baseline")
    rows = []
    for result in results:
        for metric in ("nitrogen", "phosphorus", "sediment"):
            baseline, value = base[metric+"_export"], result[metric+"_export"]
            rows.append(dict(scenario=result["scenario"], metric=metric,
                             export=value, unit=result[metric+"_unit"], baseline_export=baseline,
                             change_alternative_minus_baseline=value-baseline,
                             reduction_baseline_minus_alternative=baseline-value,
                             reduction_percent=None if baseline == 0 else 100*(baseline-value)/baseline))
    summary = dict(case_id=CASE_ID, synthetic=True, status="COMPLETE_NATIVE",
                   interpretation="Illustrative annual land-origin export reaching the modeled stream network. No observed catchment, calibrated forecast, in-stream/reservoir fate or intake concentration is calculated.",
                   aggregation="InVEST 3.20 native raster rates multiplied by 0.09 ha/pixel once; checked against native watershed vector aggregates.",
                   scenario_results=results, comparisons=rows, sources=SOURCES)
    write_json(ROOT / "comparison.json", summary)
    write_csv(ROOT / "comparison.csv", rows)
    write_json(ROOT / "visualization.json", dict(case_id=CASE_ID, comparisons=rows, scenarios=displays))
    payload = json.dumps(dict(comparisons=rows, scenarios=displays)).replace("<", "\\u003c")
    html = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic headwaters — native InVEST results</title><style>body{font:15px/1.5 Segoe UI,system-ui,sans-serif;margin:24px auto;padding:0 16px;max-width:1060px;color:#293238}h1{font-size:26px}select{font:inherit;padding:8px;width:100%;max-width:380px}table{border-collapse:collapse;width:100%;font-size:13px}td,th{padding:9px;border-bottom:1px solid #ccd2d6;text-align:left;white-space:nowrap}.scroll{overflow:auto}section{margin:24px 0}canvas{width:min(100%,480px);image-rendering:pixelated;border:1px solid #ccd2d6}small{color:#58636a}</style><h1>Synthetic headwaters</h1><p>Native InVEST 3.20 NDR and SDR · 120 × 120 cells · 30 m · 12.96 km².</p><p>Illustrative land-origin annual export reaching the modeled stream network. Three synthetic scenarios; no intake concentration or calibrated forecast.</p><label>Scenario <select id="scenario"></select></label><div class="scroll"><table><thead><tr><th>Scenario</th><th>Quantity</th><th>Export/year</th><th>Reduction vs baseline</th></tr></thead><tbody id="totals"></tbody></table></div><div id="maps"></div><p><a href="comparison.csv">Comparison CSV</a> · <a href="comparison.json">Complete summary</a> · <a href="input_manifest.json">Synthetic inputs and parameters</a></p><p><a href="''' + SOURCES["ndr_guide"] + '''">Official NDR guide</a> · <a href="''' + SOURCES["sdr_guide"] + '''">Official SDR guide</a></p><script type="application/json" id="data">''' + payload + '''</script><script>const d=JSON.parse(document.getElementById('data').textContent),s=document.getElementById('scenario');for(const k of Object.keys(d.scenarios)){const o=document.createElement('option');o.value=k;o.textContent=k.replaceAll('_',' ');s.append(o)}document.getElementById('totals').innerHTML=d.comparisons.map(r=>'<tr><td>'+r.scenario+'</td><td>'+r.metric+'</td><td>'+r.export.toLocaleString('en-US',{maximumFractionDigits:3})+' '+r.unit+'</td><td>'+(r.reduction_percent===null?'—':r.reduction_percent.toFixed(2)+'%')+'</td></tr>').join('');function draw(){const root=document.getElementById('maps');root.replaceChildren();for(const metric of ['nitrogen','phosphorus','sediment']){const a=d.scenarios[s.value][metric],all=Object.values(d.scenarios).flatMap(v=>v[metric].cells).filter(v=>v!==null),hi=Math.max(...all),section=document.createElement('section'),h=document.createElement('h2'),small=document.createElement('small'),c=document.createElement('canvas');h.textContent=metric;small.textContent=a.units+'; common color scale across scenarios, 0 to '+hi.toPrecision(4);c.width=a.width;c.height=a.height;const ctx=c.getContext('2d'),im=ctx.createImageData(c.width,c.height);a.cells.forEach((v,i)=>{const t=hi?Math.sqrt(Math.max(0,v||0)/hi):0;im.data.set(v===null?[230,233,235,255]:[Math.round(240-190*t),Math.round(246-145*t),Math.round(249-90*t),255],i*4)});ctx.putImageData(im,0,0);section.append(h,small,document.createElement('br'),c);root.append(section)}}s.onchange=draw;draw();</script></html>'''
    (ROOT / "OPEN_RESULTS.html").write_text(html, encoding="utf-8")


def main():
    global ROOT
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("simulated-headwaters-direct"))
    parser.add_argument("--config", type=Path)
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--native-child", choices=("ndr", "sdr"), help=argparse.SUPPRESS)
    parser.add_argument("--args", type=Path, help=argparse.SUPPRESS)
    options = parser.parse_args()
    logging.basicConfig(level=logging.INFO, stream=sys.stdout,
                        format="%(asctime)s %(levelname)s %(name)s %(message)s")
    if options.native_child:
        native_child(options.native_child, options.args)
        return
    ROOT = options.root.resolve()
    ROOT.mkdir(parents=True, exist_ok=True)
    config = json.loads(options.config.read_text()) if options.config else DEFAULT_CONFIG
    event("process_start", case_id=CASE_ID, python=sys.version, root=str(ROOT),
          prepare_only=options.prepare_only, cutoff_utc=config["cutoff_utc"])
    def interrupted(signum, frame):
        raise KeyboardInterrupt(f"Signal {signum}")
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        prepare(config)
        if options.prepare_only:
            event("PREPARED_ONLY", native_models_executed=False)
            return
        results, displays = [], {}
        for scenario in SCENARIOS:
            for model in ("ndr", "sdr"):
                run_native(config, scenario, model)
            result, display = collect_scenario(scenario)
            results.append(result)
            displays[scenario] = display
            event("scenario_complete", scenario=scenario, result=result)
        remaining(config)
        comparison(results, displays)
        remaining(config)
        event("COMPLETE_NATIVE", scenarios=3, native_models=6,
              report=str(ROOT / "OPEN_RESULTS.html"))
    except (TimeoutError, KeyboardInterrupt) as error:
        stop_child()
        event("INTERRUPTED", reason=str(error), completed=False)
        raise SystemExit(124)
    except Exception as error:
        stop_child()
        event("FAILED", reason=str(error), completed=False, traceback=traceback.format_exc())
        raise


if __name__ == "__main__":
    main()
