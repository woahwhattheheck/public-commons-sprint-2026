"""Focused internal checks for physical map quantities and retained exports."""
from __future__ import annotations
import csv
import io
import json
from pathlib import Path
import sys
import tempfile

APP = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(APP))
if len(sys.argv) > 2:
    sys.path.insert(0, str(Path(sys.argv[2]).resolve()))

import numpy as np
import rasterio
from rasterio.transform import from_origin
from model import map_summary
from model.common import describe_file, digest


def raster(path, values, *, crs="EPSG:26917", mask=None):
    values = np.array(values, dtype="float32")
    with rasterio.open(path, "w", driver="GTiff", height=values.shape[0],
                       width=values.shape[1], count=1, dtype="float32",
                       transform=from_origin(330000, 3861000, 30, 30),
                       crs=crs, nodata=-9999) as dst:
        dst.write(values, 1)
        if mask is not None:
            dst.write_mask(np.array(mask, dtype="uint8"))


def dataset(root, path, *, signed=True, units="kg/pixel/year", title="Signed nutrient change"):
    scale = {"minimum": -3, "maximum": 3, "units": units, "signed": signed,
             "label": "Focused internal fixture scale"}
    return {"id": digest({"fixture": path.name}), "title": title,
            "kind": "scenario_difference" if signed else "relative_priority",
            "signed": signed, "units": units, "file": describe_file(root, path),
            "companions": [], "source_raster": path.name,
            "source_file": describe_file(root, path), "grid_id": "fixture-grid",
            "profile_id": "fixture-profile", "baseline_run_id": "fixture-baseline",
            "comparison_id": "fixture-comparison", "pollutant": "nitrogen_export",
            "runs": [{"id": "fixture-baseline", "scenario": {"title": "Fixture reference"}},
                     {"id": "fixture-alternative", "scenario": {"title": "Fixture alternative"}}],
            "source_editions": [], "support": "Explicit tiny internal numerical fixture; no real watershed claim.",
            "derivation": {"direction": "alternative minus baseline"},
            "maps": [{"map_key": "fixture-map", "family": "future_nutrient_runoff",
                      "panel": 1, "title": title, "display_scale": scale}]}


def close(actual, expected):
    assert abs(actual - expected) <= max(1e-10, abs(expected) * 1e-9), (actual, expected)


with tempfile.TemporaryDirectory(prefix="eco-map-quantities-") as temp:
    root = Path(temp)
    path = root / "signed.tif"
    raster(path, [[-4, 0, 2], [7, -9999, float("nan")]])
    item = dataset(root, path)
    q = map_summary.measure(path, item)
    assert q["support"]["valid_cells"] == 4
    assert q["support"]["invalid_cells"] == 2
    close(q["support"]["valid_area_ha"], 0.36)
    close(q["annual_mass"], 5)
    assert q["annual_mass_units"] == "kg/year"
    close(q["directions"]["negative"]["annual_mass"], -4)
    close(q["directions"]["positive"]["annual_mass"], 9)
    assert q["directions"]["zero"]["cells"] == 1
    pct = {row["percentile"]: row["value"] for row in q["values"]["percentiles"]}
    close(pct[50], 1)
    close(pct[95], 6.25)
    scale = next(iter(q["display_scales"].values()))
    assert (scale["below_cells"], scale["above_cells"]) == (1, 1)

    # Unitless scores retain values, with no physical mass total.
    score = dataset(root, path, signed=False, units="dimensionless (0–1)")
    s = map_summary.measure(path, score)
    assert s["annual_mass"] is None and s["annual_mass_units"] is None
    assert "annual_mass" not in s["directions"]["positive"]

    # A real zero surface differs from an entirely missing surface.
    empty_path, zero_path = root / "empty.tif", root / "zero.tif"
    raster(empty_path, [[-9999, float("nan")]])
    raster(zero_path, [[0, 0]])
    empty = map_summary.measure(empty_path, dataset(root, empty_path))
    zero = map_summary.measure(zero_path, dataset(root, zero_path))
    assert empty["annual_mass"] is None and empty["values"]["minimum"] is None
    assert zero["annual_mass"] == 0 and zero["support"]["valid_cells"] == 2

    # CRS units enter area once; source mass pixels are never area-multiplied.
    foot_path = root / "feet.tif"
    raster(foot_path, [[2]], crs="EPSG:2264")
    feet = map_summary.measure(foot_path, dataset(root, foot_path))
    close(feet["support"]["pixel_area_ha"], 900 * (1200 / 3937) ** 2 / 10000)
    close(feet["annual_mass"], 2)

    panel = {"title": item["title"], "units": item["units"], "signed": True,
             "source_raster": path.name, "display_scale": item["maps"][0]["display_scale"],
             "dataset": {"id": item["id"], "file": item["file"]}}
    sheet = {"map_key": "fixture-map", "family": "future_nutrient_runoff", "title": "Numerical fixture", "panels": [panel]}
    state = {"id": "fixture-delivery", "files": {}, "atlas": {
        "title": "Focused internal fixture", "grid_id": "fixture-grid",
        "baseline_run_id": "fixture-baseline", "scenario_run_ids": ["fixture-alternative"],
        "delivery_mode": "native_study", "datasets": {"datasets": [item]}, "pages": [sheet]}}
    result = map_summary.write(root, state)
    exported = list(csv.DictReader(io.StringIO((root / map_summary.CSV_PATH).read_text(encoding="utf-8-sig"))))
    assert len(exported) == 1 and float(exported[0]["annual_mass"]) == 5
    assert float(exported[0]["negative_annual_mass"]) == -4
    assert exported[0]["raster_sha256"] == item["file"]["sha256"]
    assert "0.36 ha" in map_summary.html_for_sheet(result, sheet)
    assert len(map_summary.report_sections(result)) == 1
    assert map_summary.client_sections(result)[0]["tables"][0]["rows"][0][2] == "5"
    original_measure = map_summary.measure
    map_summary.measure = lambda *a, **kw: (_ for _ in ()).throw(AssertionError("Accepted raster was rescanned"))
    assert map_summary.write(root, state)["id"] == result["id"]
    map_summary.measure = original_measure
    changed = json.loads(json.dumps(result))
    changed["datasets"][0]["quantities"]["annual_mass"] = 900
    try:
        map_summary.validate(changed)
    except ValueError:
        pass
    else:
        raise AssertionError("Changed numeric result must not retain an accepted summary identity")

print(json.dumps({"status": "PASS", "cases": ["signed mass and zeros", "exact quantiles and display caps", "dimensionless units", "empty versus zero support", "projected-foot area", "CSV identity and resumed output"]}))
