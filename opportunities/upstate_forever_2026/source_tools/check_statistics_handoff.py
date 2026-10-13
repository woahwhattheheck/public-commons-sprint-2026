"""Compare the original statistics handoff with bounded handoff on retained SDR rasters."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import time

from model.common import atomic_json, describe_file, held
from model.native_stats import bounded_raster_statistics, SOURCE_SHA256


def _identity(path):
    path = Path(path).resolve(strict=True)
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return {"path": str(path), "bytes": path.stat().st_size, "sha256": digest.hexdigest()}


def _compare(first, second):
    import numpy
    from osgeo import gdal
    import pygeoprocessing
    left = gdal.OpenEx(str(first), gdal.OF_RASTER)
    right = gdal.OpenEx(str(second), gdal.OF_RASTER)
    try:
        if left is None or right is None:
            raise ValueError("Both original comparison rasters must open")
        geometry = {
            "size": [left.RasterXSize, left.RasterYSize],
            "geotransform": list(left.GetGeoTransform()),
            "projection": left.GetProjection(),
            "bands": left.RasterCount}
        candidate = {
            "size": [right.RasterXSize, right.RasterYSize],
            "geotransform": list(right.GetGeoTransform()),
            "projection": right.GetProjection(),
            "bands": right.RasterCount}
        if geometry != candidate:
            raise ValueError("Statistics handoff changed raster geometry")
        a, b = left.GetRasterBand(1), right.GetRasterBand(1)
        a_nodata, b_nodata = a.GetNoDataValue(), b.GetNoDataValue()
        same_nodata = (a_nodata == b_nodata or
                       (isinstance(a_nodata, float) and isinstance(b_nodata, float)
                        and math.isnan(a_nodata) and math.isnan(b_nodata)))
        if a.DataType != b.DataType or not same_nodata:
            raise ValueError("Statistics handoff changed raster type or nodata")
        pixels = differences = 0
        for offsets in pygeoprocessing.iterblocks((str(first), 1), offset_only=True):
            x, y = a.ReadAsArray(**offsets), b.ReadAsArray(**offsets)
            pixels += x.size
            equal = numpy.equal(x, y) | (numpy.isnan(x) & numpy.isnan(y))
            differences += int(numpy.count_nonzero(~equal))
        if differences:
            raise ValueError("Statistics handoff changed " + str(differences) + " original output cells")
        baseline_statistics = a.GetStatistics(False, False)
        candidate_statistics = b.GetStatistics(False, False)
        baseline_valid = a.GetMetadataItem("STATISTICS_VALID_PERCENT")
        candidate_valid = b.GetMetadataItem("STATISTICS_VALID_PERCENT")
        if baseline_statistics != candidate_statistics or baseline_valid != candidate_valid:
            raise ValueError("Original statistics values or valid percentage differ")
        return {"pixels_compared": pixels, "differing_cells": differences,
                "statistics_equal": True, "statistics": baseline_statistics,
                "valid_percent": baseline_valid, "geometry": geometry}
    finally:
        left = right = None


def compare_original_masks(rasters, output):
    """Use the actual published SDR mutual-mask operation on retained original inputs."""
    import pygeoprocessing
    from natcap.invest.sdr import sdr
    from model.native import runtime
    from model import native_stats
    runtime(("sdr",))  # Match the published original InVEST source before using its op.
    inputs = [_identity(path) for path in rasters]
    if len(inputs) != 4 or len({row["path"] for row in inputs}) != 4:
        raise ValueError("Select four distinct retained aligned SDR rasters: DEM, LULC, R and K")
    root = Path(output).resolve()
    root.mkdir(parents=True, exist_ok=True)
    with held(root / ".statistics-comparison.lock", blocking=False):
        selection = {"schema": "upstate.native-statistics-comparison/v1",
                     "inputs": inputs, "operations": ["sdr._create_mutual_mask_op",
                                                     "sdr._mask_single_raster_op"],
                     "target_nodata": 0, "dependency_source_sha256": SOURCE_SHA256,
                     "adapter_sha256": _identity(native_stats.__file__)["sha256"]}
        atomic_json(root / "selection.json", selection, immutable=True)
        result_path = root / "comparison.json"
        if result_path.exists():
            from model.common import read_json, verify_file
            result = read_json(result_path)
            if result["selection"] != selection:
                raise ValueError("Saved statistics comparison selects different original inputs")
            for record in result["outputs"].values():
                verify_file(root, record)
            return result
        paths = [row["path"] for row in inputs]
        timings = {}
        start = time.monotonic()
        pygeoprocessing.raster_map(
            op=sdr._create_mutual_mask_op, rasters=paths,
            target_path=str(root / "original-mask.tif"), target_nodata=0)
        pygeoprocessing.raster_map(
            op=sdr._mask_single_raster_op,
            rasters=[paths[0], str(root / "original-mask.tif")],
            target_path=str(root / "original-masked-dem.tif"))
        timings["original_seconds"] = time.monotonic() - start
        start = time.monotonic()
        with bounded_raster_statistics() as handoff:
            pygeoprocessing.raster_map(
                op=sdr._create_mutual_mask_op, rasters=paths,
                target_path=str(root / "bounded-mask.tif"), target_nodata=0)
            pygeoprocessing.raster_map(
                op=sdr._mask_single_raster_op,
                rasters=[paths[0], str(root / "bounded-mask.tif")],
                target_path=str(root / "bounded-masked-dem.tif"))
        timings["bounded_seconds"] = time.monotonic() - start
        result = {"schema": selection["schema"], "selection": selection,
                  "state": ("complete" if handoff["mode"] == "bounded_original_statistics"
                            else "original_dependency_compared"),
                  "comparisons": {
                      "mutual_mask": _compare(root / "original-mask.tif", root / "bounded-mask.tif"),
                      "masked_dem": _compare(root / "original-masked-dem.tif",
                                             root / "bounded-masked-dem.tif")},
                  "handoff": handoff, "timings": timings,
                  "outputs": {name: describe_file(root, root / name) for name in
                              ("original-mask.tif", "bounded-mask.tif",
                               "original-masked-dem.tif", "bounded-masked-dem.tif")}}
        if [_identity(row["path"]) for row in inputs] != inputs:
            raise ValueError("An original comparison input changed during calculation")
        atomic_json(result_path, result, immutable=True)
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rasters", nargs=4, required=True,
                        metavar=("DEM", "LULC", "R_FACTOR", "K_FACTOR"))
    parser.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    result = compare_original_masks(args.rasters, args.output)
    print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)
    return 0 if result["state"] == "complete" else 2


if __name__ == "__main__":
    raise SystemExit(main())
