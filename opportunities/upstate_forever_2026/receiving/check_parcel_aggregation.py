"""One focused receiving check for the parcel native-block aggregation change."""
from __future__ import annotations
import argparse
import ast
import importlib.util
import json
import math
from contextlib import ExitStack
from pathlib import Path
from time import perf_counter
import numpy as np
import rasterio
from rasterio.io import MemoryFile
from rasterio.transform import from_origin
from shapely.geometry import box, Polygon, MultiPolygon

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    helper_path = args.source / "model" / "parcel_aggregate.py"
    priorities_path = args.source / "model" / "priorities.py"
    source = priorities_path.read_text(encoding="utf-8")
    module = ast.parse(source, filename=str(priorities_path))
    original = next(node for node in module.body if isinstance(node, ast.FunctionDef) and node.name == "_sum")
    namespace = {"math": math}
    exec(compile(ast.Module(body=[original], type_ignores=[]), str(priorities_path), "exec"), namespace)
    legacy = namespace["_sum"]
    specification = importlib.util.spec_from_file_location("ed6e_parcel_aggregate", helper_path)
    helper = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(helper)

    class Counted:
        def __init__(self, source):
            self.source, self.reads = source, 0
        def __getattr__(self, name):
            return getattr(self.source, name)
        def read(self, *positional, **keywords):
            self.reads += 1
            return self.source.read(*positional, **keywords)

    width, height = 80, 64
    transform = from_origin(0, height * 30, 30, 30)
    whole = box(0, 0, width * 30, height * 30)
    geometries = [
        whole, whole,
        box(-300, -300, 600, 600),
        box(-600, -600, -30, -30),
        box(1, 1, 2, 2),
        box(0, 1440, 480, 1920),
        box(0, 480, 480, 960),
        Polygon([(150, 150), (1500, 150), (1500, 1500), (150, 150)],
                holes=[[(450, 450), (750, 450), (750, 750), (450, 750)]]),
        MultiPolygon([box(30, 30, 150, 150), box(1800, 1500, 2100, 1800)]),
        Polygon([(0, 0), (2100, 180), (1200, 1770)]),
    ]
    geometries.extend(box(60 * column, 60 * row, 60 * column + 330, 60 * row + 390)
                      for row in range(5) for column in range(8))
    with ExitStack() as stack:
        layers = {}
        for number in range(8):
            block = 16 if number < 6 else 32
            values = ((np.arange(height * width, dtype="float32").reshape(height, width) % 97) / 13
                      + number - 3).astype("float32")
            values[:16, :16] = 0
            values[32:48, :16] = -9999
            values[18, 18] = np.nan
            values[19, 19] = np.inf
            memory = stack.enter_context(MemoryFile())
            with memory.open(driver="GTiff", width=width, height=height, count=1,
                             dtype="float32", crs="EPSG:5070", transform=transform,
                             nodata=-9999, tiled=True, blockxsize=block, blockysize=block) as output:
                output.write(values, 1)
            layers["layer-" + str(number)] = Counted(stack.enter_context(memory.open()))
        started = perf_counter()
        reference = {name: [legacy(source, geometry) for geometry in geometries]
                     for name, source in layers.items()}
        original_seconds = perf_counter() - started
        original_reads = sum(source.reads for source in layers.values())
        for source in layers.values():
            source.reads = 0
        # This forces a layer-chunk boundary within the shared 16x16 block group.
        actual, processing = helper.aggregate_layers(layers, geometries, layer_memory_bytes=9000)
        for name in layers:
            for index, expected in enumerate(reference[name]):
                for field in ("sum", "mean", "valid_cells", "selected_cells"):
                    observed = actual[name][index][field]
                    if observed != expected[field]:
                        raise AssertionError({"layer": name, "parcel": index, "field": field,
                                              "expected": expected[field], "actual": observed})
        measured_reads = sum(source.reads for source in layers.values())
        one_pass_reads = sum(sum(1 for _ in source.block_windows(1)) for source in layers.values())
        assert measured_reads == one_pass_reads == processing["raster_reads"]
        assert measured_reads < original_reads
        assert actual["layer-0"][5]["sum"] == 0.0
        assert actual["layer-0"][6]["sum"] is None
        assert actual["layer-0"][4]["selected_cells"] == 0
        assert actual["layer-0"][0] == actual["layer-0"][1]
        result = {
            "operation_id": "UPSTATE-FULL-PRODUCT-BUILD-BRYCE-20261012",
            "component": "ED6E parcel native-block aggregation",
            "status": "PASS",
            "scope": "One focused aggregation equivalence and read-count receiving check",
            "geometries": len(geometries), "layers": len(layers),
            "compared_fields": ["sum", "mean", "valid_cells", "selected_cells"],
            "exact_field_comparisons": len(geometries) * len(layers) * 4,
            "original_raster_reads": original_reads, "new_raster_reads": measured_reads,
            "read_reduction_fraction": 1 - measured_reads / original_reads,
            "original_elapsed_seconds": original_seconds,
            "processing": processing,
            "runtime": {"rasterio": rasterio.__version__, "numpy": np.__version__},
            "fixture": "Purpose-built aggregation inputs; this check does not execute an ecosystem model"
        }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()
