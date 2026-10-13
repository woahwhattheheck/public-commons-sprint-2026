#!/usr/bin/env python3
"""One native ordered-patch reference case: overlap, same-code writes, and reversion."""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    app = Path(args.application).resolve(strict=True)
    output = Path(args.output).resolve()
    sys.path.insert(0, str(app))
    import numpy as np
    import rasterio
    import fiona
    import pyproj
    import shapely
    from rasterio.transform import from_origin
    from shapely.geometry import box, mapping
    from model.workspace import Workspace
    from model.rasters import grid_definition, make_scenario
    from model.scenario_footprint import apply_scenario, validate_destination_codes

    output.mkdir(parents=True, exist_ok=False)
    inputs = output / "reference-inputs"
    inputs.mkdir()
    nodata = -2147483648
    before = np.full((32, 32), 41, dtype="int32")
    before[0, 0] = nodata
    before[31, 31] = 0  # Untouched raw code verifies the original low-level contract.
    raster = inputs / "reference-baseline.tif"
    with rasterio.open(raster, "w", driver="GTiff", count=1, width=32, height=32,
                       dtype="int32", crs="EPSG:5070", nodata=nodata,
                       transform=from_origin(0, 960, 30, 30)) as dst:
        dst.write(before, 1)
        dst.update_tags(purpose="Known implementation reference array")
    entries = []
    for identity, geometry in (("left", box(0, 0, 480, 960)),
                               ("top", box(0, 480, 960, 960))):
        path = inputs / (identity + ".gpkg")
        with fiona.open(path, "w", driver="GPKG", crs="EPSG:5070", layer="mask",
                        schema={"geometry": "Polygon", "properties": {"name": "str"}}) as dst:
            dst.write({"geometry": mapping(geometry), "properties": {"name": identity}})
        entries.append({"id": identity, "title": "Reference " + identity,
                        "kind": "vector", "role": "SCENARIO_MASK", "layer": "mask",
                        "uri": "urn:upstate:implementation-reference:" + identity,
                        "vintage": "Known implementation reference geometry",
                        "path": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                        "bytes": path.stat().st_size, "companions": []})
    manifest = inputs / "sources.json"
    manifest.write_text(json.dumps({"schema": "upstate.sources/v1",
                        "title": "Ordered-patch implementation reference", "entries": entries}), encoding="utf-8")
    ws = Workspace(output / "workspace", create=True, title="Ordered-patch implementation reference")
    collection = ws.import_sources(manifest)
    definitions = (("left", [41], 22), ("top", [41, 22], 22), ("left", [22], 22),
                   ("left", [22], 82), ("top", [22, 82], 41))
    patches = [{"mask_source_id": mask, "from_codes": origins, "to_code": target,
                "reason": "Known ordered-patch reference step " + str(i + 1)}
               for i, (mask, origins, target) in enumerate(definitions)]
    scenario = ws.save_scenario({"title": "Known overlap and reversion",
                                "kind": "landcover", "source_collection_id": collection["id"],
                                "reason": "Implementation reference", "patches": patches})
    loader = lambda identity: ws.source_file(collection["id"], identity)
    grid = grid_definition(raster, box(0, 0, 960, 960))
    report = apply_scenario(raster, output / "kernel.tif", grid, scenario["patches"],
                            source_loader=loader, allowed_codes={22, 41, 82},
                            change_mask=output / "net-mask.tif")
    summary = report["summary"]
    expected = {"total_cells": 1024, "valid_cells": 1023, "nodata_cells": 1,
                "unique_mask_cells": 767, "unique_eligible_cells": 767,
                "ever_changed_cells": 767, "changed_more_than_once_cells": 767,
                "reverted_to_baseline_cells": 511, "net_changed_cells": 256,
                "unchanged_cells": 767, "patch_changed_assignments": 1789}
    if any(summary[key] != value for key, value in expected.items()):
        raise AssertionError({"expected": expected, "observed": summary})
    if not math.isclose(summary["net_changed_hectares"], 23.04, abs_tol=1e-10):
        raise AssertionError("256 final 30 m cells must equal 23.04 hectares")
    rows = report["patches"]
    for key, expected_values in (
            ("eligible_cells", [511, 511, 511, 511, 511]),
            ("changed_cells", [511, 256, 0, 511, 511]),
            ("already_destination_cells", [0, 255, 511, 0, 0]),
            ("final_owned_cells", [0, 0, 0, 256, 0])):
        if [row[key] for row in rows] != expected_values:
            raise AssertionError(key)
    expected_pixels = before.copy()
    expected_pixels[16:, :16] = 82
    expected_mask = (expected_pixels != before).astype("uint8")
    expected_mask[before == nodata] = 255
    with rasterio.open(output / "kernel.tif") as src:
        if not np.array_equal(src.read(1), expected_pixels):
            raise AssertionError("The ordered raster differs from the declared reference")
    with rasterio.open(output / "net-mask.tif") as src:
        if not np.array_equal(src.read(1), expected_mask):
            raise AssertionError("The final mask must contain only the 256 remaining changes")
    native_rows = make_scenario(raster, output / "native-entrypoint.tif", grid,
                                scenario["patches"], source_loader=loader, allowed_codes={22, 41, 82})
    with rasterio.open(output / "native-entrypoint.tif") as src:
        if native_rows != rows or not np.array_equal(src.read(1), expected_pixels):
            raise AssertionError("The original native entrypoint and preview kernel have diverged")
    try:
        validate_destination_codes({"table_summary": {"lucodes": [22, 41]}}, scenario)
    except ValueError as error:
        if "82" not in str(error):
            raise
    else:
        raise AssertionError("A missing destination row must fail before native execution")
    report["implementation_reference"] = {
        "purpose": "Known categorical and geometry behavior of the installed application",
        "scenario_id": scenario["id"], "collection_id": collection["id"],
        "interpreter": sys.executable,
        "versions": {"numpy": np.__version__, "rasterio": rasterio.__version__,
                     "fiona": fiona.__version__, "pyproj": pyproj.__version__, "shapely": shapely.__version__},
        "native_entrypoint_matches_kernel": True}
    (output / "ordered-reference-result.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"result": str(output / "ordered-reference-result.json"),
                      "net_changed_cells": 256, "net_changed_hectares": 23.04,
                      "native_entrypoint_matches_kernel": True}))


if __name__ == "__main__":
    main()
