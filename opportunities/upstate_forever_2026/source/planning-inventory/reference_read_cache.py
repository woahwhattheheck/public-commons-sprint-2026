"""Compare cached and direct reads on actual aligned retained planning rasters."""
from __future__ import annotations

import argparse
from contextlib import ExitStack
import hashlib
import importlib.util
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--raster", type=Path, action="append", required=True,
                        help="Actual retained reporting mask or annual mass raster; repeat for all selected runs")
    parser.add_argument("--cache-bytes", type=int, default=32 * 1024 * 1024)
    args = parser.parse_args()
    import numpy as np
    import rasterio
    from rasterio.windows import Window

    source = args.application / "model" / "raster_block_cache.py"
    spec = importlib.util.spec_from_file_location("receiving_native_block_cache", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    # Validate the supplied budget before reading original data.
    module.NativeBlockCache(args.cache_bytes)
    paths = [path.resolve(strict=True) for path in args.raster]
    before = [(path.stat().st_size, path.stat().st_mtime_ns) for path in paths]
    results = []
    with ExitStack() as stack:
        datasets = [stack.enter_context(rasterio.open(path)) for path in paths]
        reference = datasets[0]
        for dataset in datasets:
            if (dataset.count != 1 or dataset.width != reference.width
                    or dataset.height != reference.height or dataset.crs != reference.crs
                    or dataset.transform != reference.transform):
                raise ValueError("Select aligned single-band rasters from the same retained planning grid")
        height, width = reference.height, reference.width
        if min(height, width) <= 0:
            raise ValueError("The retained planning grid must contain cells")
        bh, bw = reference.block_shapes[0]
        anchors = [(0, 0), (max(0, min(width - 1, bw - 3)), max(0, min(height - 1, bh - 3))),
                   (width // 2, height // 2), (max(0, width - 19), max(0, height - 17))]
        windows = []
        for x, y in dict.fromkeys(anchors):
            windows.append(Window(x, y, min(512, width - x), min(512, height - y)))
        # Include a small block-contained request; larger requests may use the
        # direct path when their aligned rectangle exceeds a small budget.
        windows.append(Window(0, 0, min(512, bw, width), min(512, bh, height)))
        # A one-block budget can exercise eviction between original datasets
        # or corner/middle blocks without forcing hundreds of striped reads.
        block_budget = max(
            min(ds.height, ds.block_shapes[0][0]) * min(ds.width, ds.block_shapes[0][1])
            * (np.dtype(ds.dtypes[0]).itemsize + 1) for ds in datasets)
        budgets = list(dict.fromkeys((0, 1, block_budget, args.cache_bytes)))
        for budget in budgets:
            cache = module.NativeBlockCache(budget)
            comparisons = support_checks = 0
            try:
                for _ in range(2):
                    for window in windows:
                        original, received = [], []
                        for number, dataset in enumerate(datasets):
                            direct = dataset.read(1, window=window, masked=True)
                            cached = cache.read(dataset, window, label=str(paths[number]))
                            for observed in (cached, cache.read(dataset, window, label=str(paths[number]))):
                                if (not np.array_equal(np.ma.getdata(direct), np.ma.getdata(observed), equal_nan=True)
                                        or not np.array_equal(np.ma.getmaskarray(direct), np.ma.getmaskarray(observed))
                                        or direct.dtype != observed.dtype or direct.shape != observed.shape):
                                    raise AssertionError("Cached data/mask differs from the original native read")
                                comparisons += 1
                            # Editing a caller's returned window must not alter
                            # the retained cache or another caller's result.
                            cached.data.flat[0] = 0
                            cached.mask = np.ma.getmaskarray(cached).copy()
                            cached.mask.flat[0] = not bool(cached.mask.flat[0])
                            again = cache.read(dataset, window, label=str(paths[number]))
                            if (not np.array_equal(np.ma.getdata(direct), np.ma.getdata(again), equal_nan=True)
                                    or not np.array_equal(np.ma.getmaskarray(direct), np.ma.getmaskarray(again))):
                                raise AssertionError("A caller modified retained cache bytes")
                            comparisons += 1
                            original.append(direct)
                            received.append(again)
                        common = np.ones(original[0].shape, dtype=bool)
                        for value in original:
                            common &= ~np.ma.getmaskarray(value) & np.isfinite(np.ma.getdata(value))
                        observed_common = np.ones(received[0].shape, dtype=bool)
                        for value in received:
                            observed_common &= ~np.ma.getmaskarray(value) & np.isfinite(np.ma.getdata(value))
                        if not np.array_equal(common, observed_common):
                            raise AssertionError("Common all-raster valid support changed")
                        for direct, cached in zip(original, received):
                            left = np.ma.getdata(direct).astype("float64")[common].sum(dtype="float64")
                            right = np.ma.getdata(cached).astype("float64")[observed_common].sum(dtype="float64")
                            if left != right:
                                raise AssertionError("The original window's float64 reduction changed")
                        support_checks += 1
                metrics = cache.snapshot()
                if metrics["source_reads"] != metrics["block_read_batches"] + metrics["direct_reads"]:
                    raise AssertionError("Native read counters do not reconcile")
                if not budget and metrics["source_reads"] != metrics["window_requests"]:
                    raise AssertionError("Zero-budget reads did not preserve the direct path")
                if metrics["peak_retained_array_bytes"] > budget:
                    raise AssertionError("Retained array bytes exceeded the explicit cache budget")
                results.append({"budget_bytes": budget, "array_comparisons": comparisons,
                                "common_support_and_reduction_checks": support_checks,
                                "reads": metrics})
            finally:
                cache.clear()
    after = [(path.stat().st_size, path.stat().st_mtime_ns) for path in paths]
    if before != after:
        raise ValueError("An original raster changed during the receiving check")
    print(json.dumps({
        "schema": "upstate.planning-read-equivalence/v1",
        "helper_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "rasters": [{"path": str(path), "bytes": stat[0], "mtime_ns": stat[1]}
                    for path, stat in zip(paths, before)],
        "grid": {"width": width, "height": height},
        "windows": [list(window.flatten()) for window in windows],
        "results": results,
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
