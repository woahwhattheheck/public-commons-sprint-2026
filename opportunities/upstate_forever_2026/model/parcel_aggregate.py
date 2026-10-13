"""Aggregate aligned outputs for every parcel while sharing native block reads.

The grouping preserves each layer's original native block summation order.
Every geometry remains independent, including overlapping or identical parcels.
"""
from __future__ import annotations

from collections import defaultdict
from numbers import Integral
from time import perf_counter


def aggregate_layers(layers, geometries, *, layer_memory_bytes=64 * 1024 * 1024):
    """Return per-layer, per-geometry statistics and actual processing counts.

    ``layers`` contains already-open, single-band Rasterio datasets on the same
    grid. ``geometries`` uses that grid's CRS. Geometry positions remain their
    record identities; no parcel is burned over another parcel's cells.

    A memory-sized layer chunk only controls how many raster blocks are held at
    once. Every selected layer and geometry is processed.
    """
    import numpy as np
    from rasterio.features import geometry_mask
    from rasterio.windows import bounds
    from shapely.geometry import box
    from shapely.strtree import STRtree

    started = perf_counter()
    if not layers:
        raise ValueError("Parcel aggregation requires at least one output layer")
    if isinstance(layer_memory_bytes, bool) or not isinstance(layer_memory_bytes, int) or layer_memory_bytes <= 0:
        raise ValueError("Layer working memory must be a positive integer number of bytes")
    geometries = list(geometries)
    count = len(geometries)
    reference = next(iter(layers.values()))
    groups = defaultdict(list)
    for name, source in layers.items():
        if source.count != 1:
            raise ValueError("Parcel output layers must have one band: " + str(name))
        if (source.crs != reference.crs or source.transform != reference.transform
                or source.width != reference.width or source.height != reference.height):
            raise ValueError("Parcel output layers must share the same retained grid: " + str(name))
        groups[tuple(source.block_shapes[0])].append((name, source))

    sums = {name: np.zeros(count, dtype="float64") for name in layers}
    valid_counts = {name: np.zeros(count, dtype="int64") for name in layers}
    selected_counts = {shape: np.zeros(count, dtype="int64") for shape in groups}
    indexed = [(index, geometry) for index, geometry in enumerate(geometries)
               if geometry is not None and not geometry.is_empty]
    tree = STRtree([geometry for _, geometry in indexed]) if indexed else None
    # Shapely 2 returns original positions; Shapely 1 returns original objects.
    # Retain repeated object identities as distinct parcel records in either API.
    legacy_positions = defaultdict(list)
    for position, (_, geometry) in enumerate(indexed):
        legacy_positions[id(geometry)].append(position)

    reads = read_pixels = visited_blocks = parcel_blocks = mask_evaluations = 0
    for block_shape, group in groups.items():
        if tree is None:
            break
        group_reference = group[0][1]
        for _, window in group_reference.block_windows(1):
            visited_blocks += 1
            hits = tree.query(box(*bounds(window, group_reference.transform)))
            candidates = set()
            for hit in hits:
                if isinstance(hit, Integral):
                    candidates.add(indexed[int(hit)][0])
                else:
                    positions = legacy_positions.get(id(hit))
                    if positions is None:
                        raise ValueError("Spatial index returned an unknown parcel geometry")
                    candidates.update(indexed[position][0] for position in positions)
            if not candidates:
                continue
            candidates = sorted(candidates)
            parcel_blocks += len(candidates)
            height, width = int(window.height), int(window.width)
            pixels = height * width
            # Account for a native data array, its mask, and finite-value support.
            layer_bytes = max(np.dtype(source.dtypes[0]).itemsize + 2 for _, source in group) * pixels
            chunk_size = max(1, layer_memory_bytes // max(1, layer_bytes))
            transform = group_reference.window_transform(window)
            for chunk_start in range(0, len(group), chunk_size):
                arrays = []
                for name, source in group[chunk_start:chunk_start + chunk_size]:
                    data = source.read(1, window=window, masked=True)
                    support = ~np.ma.getmaskarray(data) & np.isfinite(data.data)
                    arrays.append((name, data.data, support))
                    reads += 1
                    read_pixels += pixels
                for index in candidates:
                    inside = geometry_mask(
                        [geometries[index].__geo_interface__], out_shape=(height, width),
                        transform=transform, invert=True, all_touched=False)
                    mask_evaluations += 1
                    selected = int(np.count_nonzero(inside))
                    if chunk_start == 0:
                        selected_counts[block_shape][index] += selected
                    if not selected:
                        continue
                    for name, data, support in arrays:
                        good = inside & support
                        valid = int(np.count_nonzero(good))
                        if valid:
                            valid_counts[name][index] += valid
                            sums[name][index] += float(np.sum(data[good], dtype="float64"))

    result = {}
    for name in layers:
        records = []
        for index in range(count):
            valid = int(valid_counts[name][index])
            selected = int(selected_counts[tuple(layers[name].block_shapes[0])][index])
            total = float(sums[name][index]) if valid else None
            records.append({
                "sum": total,
                "mean": total / valid if valid else None,
                "valid_cells": valid,
                "selected_cells": selected,
                "coverage_fraction": valid / selected if selected else 0.0,
            })
        result[name] = records
    processing = {
        "method": "Spatially indexed native-block aggregation; independent parcel pixel-centre masks",
        "parcels": count,
        "raster_layers": len(layers),
        "native_block_layouts": [
            {"height": shape[0], "width": shape[1], "layers": [name for name, _ in group]}
            for shape, group in groups.items()],
        "visited_blocks": visited_blocks,
        "parcel_blocks": parcel_blocks,
        "mask_evaluations": mask_evaluations,
        "raster_reads": reads,
        "read_pixels": read_pixels,
        "elapsed_seconds": perf_counter() - started,
    }
    return result, processing
