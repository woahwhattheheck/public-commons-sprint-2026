"""Exact raster summaries and linear percentiles without full-grid arrays.

Order statistics are selected one byte at a time from sortable native numeric
keys. Every eligible pixel participates; there is no sampling or bin-width
approximation. Float32 needs at most four windowed scans, Float64 at most eight.
Only the selected rank prefixes are refined after the first scan.
"""
from __future__ import annotations

import math
from .common import finite


def raster_windows(raster, *, window_size=512):
    """Fixed-size windows also bound memory for striped or untiled sources."""
    from rasterio.windows import Window
    if (isinstance(window_size, bool) or not isinstance(window_size, int)
            or window_size <= 0):
        raise ValueError("Raster window size must be a positive integer")
    for row in range(0, raster.height, window_size):
        for col in range(0, raster.width, window_size):
            yield Window(col, row, min(window_size, raster.width - col),
                         min(window_size, raster.height - row))


def _values(raster, *, positive_only, window_size, absolute):
    import numpy as np
    for window in raster_windows(raster, window_size=window_size):
        data = raster.read(1, window=window, masked=True)
        raw = np.ma.getdata(data)
        valid = ~np.ma.getmaskarray(data) & np.isfinite(raw)
        valid_count = int(np.count_nonzero(valid))
        values = raw[valid]
        if absolute:
            if values.dtype.kind == "i":
                # Unsigned magnitudes also represent abs(minimum signed int).
                unsigned = values.astype("u" + str(values.dtype.itemsize))
                values = np.where(values < 0, np.negative(unsigned), unsigned)
            else:
                values = np.abs(values)
        if positive_only:
            values = values[values > 0]
        yield values, valid_count


def _numeric_keys(values, dtype):
    """Map native finite numbers to monotonically ordered unsigned integers."""
    import numpy as np
    unsigned = np.dtype("u" + str(dtype.itemsize))
    bits = values.astype(dtype, copy=False).view(unsigned)
    sign = np.array(1 << (dtype.itemsize * 8 - 1), dtype=unsigned)
    if dtype.kind == "f":
        return np.where(bits & sign, ~bits, bits ^ sign)
    if dtype.kind == "i":
        return bits ^ sign
    return bits


def _key_value(key, dtype):
    import numpy as np
    width = dtype.itemsize * 8
    sign = 1 << (width - 1)
    if dtype.kind == "f":
        bits = key ^ sign if key & sign else (~key & ((1 << width) - 1))
    elif dtype.kind == "i":
        bits = key ^ sign
    else:
        bits = key
    return np.array([bits], dtype="u" + str(dtype.itemsize)).view(dtype)[0].item()


def _bucket(histogram, rank):
    import numpy as np
    cumulative = np.cumsum(histogram, dtype="int64")
    if rank < 0 or not len(cumulative) or rank >= int(cumulative[-1]):
        raise RuntimeError("Raster values changed during exact percentile selection")
    bucket = int(np.searchsorted(cumulative, rank, side="right"))
    before = int(cumulative[bucket - 1]) if bucket else 0
    return bucket, rank - before


def _raster_statistics(raster, *, percentiles=(), positive_only=False, absolute=False, window_size=512):
    """Summarize an open Rasterio dataset's first band using bounded windows.

    valid_cells counts all finite unmasked cells. selected_cells additionally
    applies positive_only after an optional absolute-value transform. Sum, mean,
    extrema and percentiles describe those selected cells. Empty selections have
    sum=0 and None for other statistics.

    Percentiles use exact zero-based ranks (n-1)*(q/100) and linear interpolation
    between their actual native values, with Float64 rank/interpolation
    arithmetic. The result order matches the requested percentile order.
    """
    import numpy as np
    dtype = np.dtype(raster.dtypes[0]).newbyteorder("=")
    if dtype.kind not in "iuf" or dtype.itemsize not in (1, 2, 4, 8):
        raise ValueError("Exact raster statistics require a real numeric band")
    if absolute and dtype.kind == "i":
        dtype = np.dtype("u" + str(dtype.itemsize))
    requested = [finite(value, "Raster percentile", minimum=0) for value in percentiles]
    if any(value > 100 for value in requested):
        raise ValueError("Raster percentiles must be between 0 and 100")
    width = dtype.itemsize * 8
    first_histogram = np.zeros(256, dtype="int64")
    count, valid_count, low, high = 0, 0, None, None
    # Neumaier compensated addition retains small window totals without a list
    # that grows with the number of windows.
    total, correction = 0.0, 0.0
    for values, current_valid in _values(
            raster, positive_only=positive_only, window_size=window_size, absolute=absolute):
        valid_count += current_valid
        if not values.size:
            continue
        count += int(values.size)
        current_low, current_high = values.min().item(), values.max().item()
        low = current_low if low is None else min(low, current_low)
        high = current_high if high is None else max(high, current_high)
        addition = float(values.sum(dtype="float64"))
        updated = total + addition
        if abs(total) >= abs(addition):
            correction += (total - updated) + addition
        else:
            correction += (addition - updated) + total
        total = updated
        if requested:
            keys = _numeric_keys(values, dtype)
            buckets = (keys >> (width - 8)).astype("int64")
            first_histogram += np.bincount(buckets, minlength=256)
    total += correction
    if not math.isfinite(total):
        raise ValueError("Raster total exceeds the finite Float64 range")
    results = []
    scans = 1
    if count:
        ranks = {}
        for value in requested:
            position = (count - 1) * (value / 100.0)
            lower = min(count - 1, max(0, math.floor(position)))
            fraction = position - lower
            upper = lower if fraction == 0 else min(count - 1, lower + 1)
            ranks[value] = (lower, upper, fraction)
        selected = {0: low, count - 1: high}
        targets = {rank for lower, upper, _ in ranks.values()
                   for rank in (lower, upper) if rank not in selected}
        if low == high:
            selected.update({rank: low for rank in targets})
            targets = set()
        nodes = {}
        for rank in targets:
            prefix, local_rank = _bucket(first_histogram, rank)
            nodes[rank] = (prefix, local_rank)
        for shift in range(width - 16, -1, -8):
            if not nodes:
                break
            prefixes = {prefix for prefix, _ in nodes.values()}
            histograms = {prefix: np.zeros(256, dtype="int64") for prefix in prefixes}
            for values, _ in _values(
                    raster, positive_only=positive_only, window_size=window_size, absolute=absolute):
                if not values.size:
                    continue
                keys = _numeric_keys(values, dtype)
                previous = keys >> (shift + 8)
                for prefix, histogram in histograms.items():
                    chosen = keys[previous == prefix]
                    if chosen.size:
                        buckets = ((chosen >> shift) & 255).astype("int64")
                        histogram += np.bincount(buckets, minlength=256)
            scans += 1
            nodes = {
                rank: ((prefix << 8) | bucket, remainder)
                for rank, (prefix, local_rank) in nodes.items()
                for bucket, remainder in [_bucket(histograms[prefix], local_rank)]
            }
        for rank, (key, _) in nodes.items():
            selected[rank] = _key_value(key, dtype)
        for value in requested:
            lower, upper, fraction = ranks[value]
            a, b = float(selected[lower]), float(selected[upper])
            # Evaluate from the nearer endpoint to avoid cancellation.
            if fraction >= 0.5:
                result = b - (b - a) * (1.0 - fraction)
            else:
                result = a + (b - a) * fraction
            if not math.isfinite(result):
                result = a * (1.0 - fraction) + b * fraction
            results.append({"percentile": value, "value": result})
    else:
        results = [{"percentile": value, "value": None} for value in requested]
    return {
        "valid_cells": valid_count,
        "invalid_cells": int(raster.width) * int(raster.height) - valid_count,
        "selected_cells": count,
        "excluded_nonpositive_cells": valid_count - count if positive_only else 0,
        "minimum": low, "maximum": high, "sum": total,
        "mean": total / count if count else None,
        "percentiles": results,
        "positive_only": bool(positive_only), "absolute_values": bool(absolute),
        "method": "Exact native-value order statistics with Float64 linear interpolation",
        "window_size": window_size, "scans": scans,
    }


def raster_statistics(raster, *, percentiles=(), positive_only=False, absolute=False, window_size=512):
    """Compute exact windowed statistics from a path or open raster dataset."""
    from contextlib import ExitStack
    from os import PathLike
    import rasterio
    with rasterio.Env(GDAL_CACHEMAX=64 * 1024 * 1024), ExitStack() as stack:
        source = stack.enter_context(rasterio.open(raster)) if isinstance(raster, (str, PathLike)) else raster
        return _raster_statistics(
            source, percentiles=percentiles, positive_only=positive_only,
            absolute=absolute, window_size=window_size)


def raster_percentile(raster, percentile, *, positive_only=False, absolute=False, window_size=512):
    """Return one exact percentile, or None when no cells are selected."""
    return raster_statistics(
        raster, percentiles=[percentile], positive_only=positive_only, absolute=absolute,
        window_size=window_size)["percentiles"][0]["value"]
