"""Bounded read reuse for exact integer windows of retained native rasters."""
from __future__ import annotations

from collections import OrderedDict
import math

DEFAULT_CACHE_BYTES = 32 * 1024 * 1024


class NativeBlockCache:
    """Cache first-band native blocks without changing requested cells or masks.

    Returned arrays own their bytes. The budget counts retained NumPy data and
    Boolean masks; caller windows, temporary batch buffers, GDAL buffers and
    Python object overhead are separate. Zero disables caching. An aligned
    request larger than the budget uses the original direct-window read.
    """

    def __init__(self, byte_budget=DEFAULT_CACHE_BYTES):
        if type(byte_budget) is not int or byte_budget < 0:
            raise ValueError("raster_cache_bytes must be a nonnegative integer")
        self.byte_budget = byte_budget
        self._blocks = OrderedDict()
        self._datasets = {}
        self._sources = {}
        self._bytes = 0
        self._peak = 0
        self._counts = {name: 0 for name in (
            "window_requests", "requested_pixels", "source_reads", "source_pixels",
            "cache_hits", "cache_misses", "block_read_batches", "evictions", "direct_reads",
            "disabled_reads", "oversized_block_reads", "oversized_window_reads")}

    def _count(self, source, name, amount=1):
        self._counts[name] += amount
        source[name] += amount

    def _source(self, dataset, label):
        token = id(dataset)
        if token not in self._datasets:
            self._datasets[token] = dataset
            self._sources[token] = {
                "label": str(label if label is not None else dataset.name),
                **{name: 0 for name in self._counts},
            }
        return token, self._sources[token]

    def _evict(self, needed, source):
        while self._blocks and self._bytes + needed > self.byte_budget:
            _, (data, mask) = self._blocks.popitem(last=False)
            self._bytes -= data.nbytes + mask.nbytes
            self._count(source, "evictions")

    def _native_read(self, dataset, window, source):
        self._count(source, "source_reads")
        self._count(source, "source_pixels", int(window.width) * int(window.height))
        return dataset.read(1, window=window, masked=True)

    def read(self, dataset, window, *, label=None):
        """Return the exact first-band masked array for an in-bounds integer window."""
        import numpy as np
        from rasterio.windows import Window

        if dataset.closed:
            raise ValueError("Read the retained raster while its dataset is open")
        if dataset.count != 1:
            raise ValueError("Planning read reuse requires a single-band native raster")
        values = (window.col_off, window.row_off, window.width, window.height)
        if any(not math.isfinite(value) or value != int(value) for value in values):
            raise ValueError("Planning read windows must contain finite integer cells")
        x0, y0, width, height = map(int, values)
        if (min(x0, y0, width, height) < 0 or x0 + width > dataset.width
                or y0 + height > dataset.height):
            raise ValueError("Planning read windows must stay within the retained raster")
        token, source = self._source(dataset, label)
        self._count(source, "window_requests")
        self._count(source, "requested_pixels", width * height)
        dtype = np.dtype(dataset.dtypes[0])
        bh, bw = dataset.block_shapes[0]
        # A striped native block can exceed the complete cache budget. Reading
        # only the requested window then retains the original memory behavior.
        maximum_block_bytes = min(bh, dataset.height) * min(bw, dataset.width) * (dtype.itemsize + 1)
        if not self.byte_budget or maximum_block_bytes > self.byte_budget:
            self._count(source, "direct_reads")
            self._count(source, "disabled_reads" if not self.byte_budget else "oversized_block_reads")
            return self._native_read(dataset, window, source)

        if not width or not height:
            return np.ma.array(np.empty((height, width), dtype=dtype),
                               mask=np.empty((height, width), dtype=bool), copy=False)
        first_row, last_row = y0 // bh, (y0 + height - 1) // bh
        first_col, last_col = x0 // bw, (x0 + width - 1) // bw
        aligned_width = min(dataset.width, (last_col + 1) * bw) - first_col * bw
        aligned_height = min(dataset.height, (last_row + 1) * bh) - first_row * bh
        aligned_bytes = aligned_width * aligned_height * (dtype.itemsize + 1)
        if aligned_bytes > self.byte_budget:
            self._count(source, "direct_reads")
            self._count(source, "oversized_window_reads")
            return self._native_read(dataset, window, source)

        output = np.empty((height, width), dtype=dtype)
        invalid = np.empty((height, width), dtype=bool)

        def copy_intersection(data, mask, bx, by):
            block_height, block_width = data.shape
            left, top = max(x0, bx), max(y0, by)
            right = min(x0 + width, bx + block_width)
            bottom = min(y0 + height, by + block_height)
            dst = (slice(top - y0, bottom - y0), slice(left - x0, right - x0))
            src = (slice(top - by, bottom - by), slice(left - bx, right - bx))
            output[dst] = data[src]
            invalid[dst] = mask[src]

        missing = []
        for row in range(first_row, last_row + 1):
            for col in range(first_col, last_col + 1):
                key = (token, row, col)
                retained = self._blocks.pop(key, None)
                if retained is None:
                    missing.append((row, col))
                else:
                    self._count(source, "cache_hits")
                    self._blocks[key] = retained
                    copy_intersection(*retained, col * bw, row * bh)

        if missing:
            # Read a contiguous native-block rectangle once, including for
            # striped rasters. Repeated single-block reads would turn one
            # original window into hundreds of Rasterio calls.
            batch_x = min(col for _, col in missing) * bw
            batch_y = min(row for row, _ in missing) * bh
            batch_right = min(dataset.width, (max(col for _, col in missing) + 1) * bw)
            batch_bottom = min(dataset.height, (max(row for row, _ in missing) + 1) * bh)
            needed = sum(min(bh, dataset.height - row * bh)
                         * min(bw, dataset.width - col * bw)
                         * (dtype.itemsize + 1) for row, col in missing)
            self._evict(needed, source)
            self._count(source, "block_read_batches")
            value = self._native_read(
                dataset, Window(batch_x, batch_y, batch_right - batch_x,
                                batch_bottom - batch_y), source)
            batch_data = np.ma.getdata(value)
            batch_mask = np.ma.getmaskarray(value)
            expected_shape = (batch_bottom - batch_y, batch_right - batch_x)
            if batch_data.shape != expected_shape or batch_data.dtype != dtype:
                raise ValueError("Native block read changed the retained raster shape or dtype")
            for row, col in missing:
                bx, by = col * bw, row * bh
                block_width = min(bw, dataset.width - bx)
                block_height = min(bh, dataset.height - by)
                part = (slice(by - batch_y, by - batch_y + block_height),
                        slice(bx - batch_x, bx - batch_x + block_width))
                # Independent block allocations keep retained-byte accounting
                # exact after evictions; views would retain the whole batch.
                data = batch_data[part].copy()
                mask = batch_mask[part].copy()
                data.setflags(write=False)
                mask.setflags(write=False)
                self._blocks[(token, row, col)] = (data, mask)
                self._bytes += data.nbytes + mask.nbytes
                self._peak = max(self._peak, self._bytes)
                self._count(source, "cache_misses")
                copy_intersection(data, mask, bx, by)
        return np.ma.array(output, mask=invalid, copy=False)

    def snapshot(self):
        return {
            "method": "original-native-block-lru/2",
            "byte_budget": self.byte_budget,
            "retained_array_bytes": self._bytes,
            "peak_retained_array_bytes": self._peak,
            "retained_blocks": len(self._blocks),
            **self._counts,
            "sources": [dict(value) for value in self._sources.values()],
            "counter_meaning": "Actual Rasterio read calls and returned native pixels; OS/GDAL cache hits and physical disk reads are not measured.",
            "memory_meaning": "Retained data and Boolean mask arrays only; working windows, temporary batch buffers, GDAL buffers and Python object overhead are separate.",
        }

    def clear(self):
        self._blocks.clear()
        self._datasets.clear()
        self._bytes = 0
