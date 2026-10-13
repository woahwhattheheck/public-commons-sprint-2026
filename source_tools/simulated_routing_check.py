"""Inspect the simulated case using the original PyGeoProcessing routing calls.

This reads the retained recipe and calculates actual D8/MFD rasters. It performs
no NDR/SDR run and leaves the Workspace model inputs and run identities intact.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.metadata
import json
import math
import os
import sys
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))

SCHEMA = "upstate.simulated-native-routing-check/v1"


def fingerprint(path):
    path = Path(path)
    return {"bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def _write(path, value):
    temp = Path(path).with_suffix(".pending.json")
    temp.write_text(json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n",
                    encoding="utf-8")
    os.replace(temp, path)


def _distance(u, v):
    distances = []
    for a, b in (((.22, 0), (.5, .6)), ((.78, 0), (.5, .6)), ((.5, .6), (.5, 1))):
        dx, dy = b[0] - a[0], b[1] - a[1]
        t = max(0, min(1, ((u-a[0])*dx + (v-a[1])*dy) / (dx*dx + dy*dy)))
        distances.append(math.hypot(u-a[0]-t*dx, v-a[1]-t*dy) * 3600)
    return min(distances)


def run(recipe_path, output, *, threshold=100):
    os.environ.setdefault("GDAL_CACHEMAX", "16")
    os.environ.setdefault("GDAL_NUM_THREADS", "1")
    import numpy as np
    import rasterio
    from affine import Affine
    import pygeoprocessing
    from pygeoprocessing import routing
    from model.common import held

    recipe_path = Path(recipe_path).resolve(strict=True)
    recipe = json.loads(recipe_path.read_text(encoding="utf-8"))
    grid = recipe["grid"]
    if (recipe.get("demo_id") != "upstate-simulated-piedmont-headwaters-v1" or
            (grid["width"], grid["height"], grid["resolution_m"], grid["crs"]) !=
            (120, 120, 30, "EPSG:26917")):
        raise ValueError("Select the retained 120x120, 30m headwaters case")
    if not math.isfinite(threshold) or threshold <= 0:
        raise ValueError("The native flow threshold must be finite and positive")
    versions = {name: importlib.metadata.version(name)
                for name in ("pygeoprocessing", "rasterio", "numpy")}
    identity = {"schema": SCHEMA, "recipe": fingerprint(recipe_path),
                "source": fingerprint(__file__), "threshold_cells": threshold,
                "versions": versions}
    root = Path(output).resolve()
    root.mkdir(parents=True, exist_ok=True)
    with held(root / ".routing-check.lock", blocking=False):
        identity_path = root / "identity.json"
        if identity_path.exists():
            if json.loads(identity_path.read_text()) != identity:
                raise ValueError("Use another output directory for this input/runtime edition")
        else:
            _write(identity_path, identity)
        result_path = root / "routing-check.json"
        if result_path.exists():
            result = json.loads(result_path.read_text())
            for name, record in result["files"].items():
                if fingerprint(root / name) != record:
                    raise ValueError("Retained routing result differs: " + name)
            return result
        shape = (grid["height"], grid["width"])
        dem = np.asarray(recipe["arrays"]["DEM"], dtype="float64").reshape(shape)
        lulc = np.asarray(recipe["arrays"]["NLCD"]).reshape(shape)
        mask = np.asarray(recipe["arrays"]["RESTORATION_MASK"]).reshape(shape)
        if not np.isfinite(dem).all() or not np.isin(mask, [0, 1]).all():
            raise ValueError("Original terrain/mask contains invalid values")
        changed = (mask == 1) & np.isin(lulc, [81, 82])
        distances = np.array([_distance((c+.5)/120, (r+.5)/120)
                              for r in range(120) for c in range(120)]).reshape(shape)
        source_dem = root / "dem.tif"
        with rasterio.open(source_dem, "w", driver="GTiff", width=120, height=120,
                           count=1, dtype="float64", crs=grid["crs"],
                           transform=Affine(*grid["transform"]), nodata=-9999,
                           tiled=True, compress="deflate") as target:
            target.write(dem, 1)
        filled = root / "filled-dem.tif"
        routing.fill_pits((str(source_dem), 1), str(filled), working_dir=str(root))
        with rasterio.open(filled) as target:
            filled_values = target.read(1)
        summaries = {}
        for algorithm in ("d8", "mfd"):
            direction = root / (algorithm + "-direction.tif")
            accumulation = root / (algorithm + "-accumulation.tif")
            stream = root / (algorithm + "-stream.tif")
            channel_distance = root / (algorithm + "-channel-distance.tif")
            getattr(routing, "flow_dir_" + algorithm)(
                (str(filled), 1), str(direction), working_dir=str(root))
            getattr(routing, "flow_accumulation_" + algorithm)(
                (str(direction), 1), str(accumulation))
            if algorithm == "mfd":
                routing.extract_streams_mfd(
                    (str(accumulation), 1), (str(direction), 1), float(threshold), str(stream))
            else:
                with rasterio.open(accumulation) as src:
                    values = src.read(1, masked=True)
                    stream_values = np.where(np.ma.getmaskarray(values), 255,
                                             (values.filled(0) >= threshold).astype("uint8"))
                    metadata = src.profile.copy()
                metadata.update(dtype="uint8", nodata=255)
                with rasterio.open(stream, "w", **metadata) as target:
                    target.write(stream_values.astype("uint8"), 1)
            getattr(routing, "distance_to_channel_" + algorithm)(
                (str(direction), 1), (str(stream), 1), str(channel_distance))
            with rasterio.open(accumulation) as src:
                acc = src.read(1, masked=True)
            with rasterio.open(stream) as src:
                channels = src.read(1) == 1
            with rasterio.open(channel_distance) as src:
                channel_reach = src.read(1, masked=True)
            reaches = (~np.ma.getmaskarray(channel_reach) &
                       np.isfinite(channel_reach.filled(np.nan)) &
                       (channel_reach.filled(-1) >= 0))
            interior = channels.copy()
            interior[[0, -1], :] = False
            interior[:, [0, -1]] = False
            selected_distances = distances[channels]
            summaries[algorithm] = {
                "threshold_cells": threshold, "threshold_hectares": threshold * .09,
                "stream_cells": int(channels.sum()),
                "stream_cells_in_original_mask": int((channels & (mask == 1)).sum()),
                "stream_cells_within_90m_of_axes": int((channels & (distances <= 90)).sum()),
                "interior_stream_cells": int(interior.sum()),
                "interior_stream_cells_within_90m": int((interior & (distances <= 90)).sum()),
                "stream_cells_on_changed_land": int((channels & changed).sum()),
                "mean_axis_distance_m": float(selected_distances.mean()) if selected_distances.size else None,
                "max_axis_distance_m": float(selected_distances.max()) if selected_distances.size else None,
                "changed_cells_with_downstream_channel": int((changed & reaches).sum()),
                "changed_cells_without_downstream_channel": int((changed & ~reaches).sum()),
                "row100_central_accumulation": [float(acc[100, 59]), float(acc[100, 60])],
            }
        files = {p.name: fingerprint(p) for p in sorted(root.glob("*.tif"))}
        result = {**identity, "state": "complete", "grid": grid,
                  "changed_cells": int(changed.sum()),
                  "changed_hectares": float(changed.sum()) * .09,
                  "pit_fill_changed_cells": int((filled_values != dem).sum()),
                  "algorithms": summaries, "files": files,
                  "interpretation": [
                      "These are actual original-library routing rasters on the retained simulated terrain.",
                      "The restored riparian cells surround an existing forest channel strip; zero changed channel cells is expected.",
                      "NDR/SDR outputs are calculated separately by the original Workspace run.",
                  ]}
        _write(result_path, result)
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--recipe", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--threshold", type=float, default=100)
    args = parser.parse_args()
    print(json.dumps(run(args.recipe, args.output, threshold=args.threshold),
                     indent=2, sort_keys=True, allow_nan=False))


if __name__ == "__main__":
    main()
