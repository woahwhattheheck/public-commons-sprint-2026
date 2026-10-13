"""Partition actual paired export responses against selected model input changes."""
from __future__ import annotations
import csv
from contextlib import ExitStack
import heapq
import math
from pathlib import Path

SCALE_POWER = -149
METRICS = {"nitrogen_export": ("ndr", "kg/year"),
           "phosphorus_export": ("ndr", "kg/year"),
           "sediment_export": ("sdr", "metric_tonnes/year")}
CATEGORIES = {0: "same_code_same_coefficients", 1: "code_only",
              2: "coefficient_only", 3: "code_and_coefficients", 255: "unmapped_input"}
PEAKS_PER_DIRECTION = 50


def _binary_sum(values):
    """Exact sum of finite Float32 values in units of 2**-149.

    At most 2**28 mantissas per chunk keep every bincount addition an exact
    integer in Float64. Current native TIFF windows are only 256 by 256.
    """
    import numpy as np
    values = np.asarray(values, dtype="float32").ravel()
    result = 0
    for start in range(0, values.size, 1 << 28):
        bits = values[start:start + (1 << 28)].view("uint32")
        exponent = ((bits >> 23) & 255).astype("int32")
        if np.any(exponent == 255):
            raise ValueError("Only finite retained export differences enter a response partition")
        mantissa = (bits & 0x7fffff).astype("int64")
        mantissa += (exponent != 0).astype("int64") * (1 << 23)
        mantissa *= 1 - 2 * (bits >> 31).astype("int64")
        totals = np.bincount(exponent, weights=mantissa, minlength=255)
        for exp in np.flatnonzero(totals):
            result += int(totals[exp]) << max(0, int(exp) - 1)
    return result


def _mass(binary):
    value = math.ldexp(binary, SCALE_POWER)
    if not math.isfinite(value):
        raise ValueError("The exact response sum exceeds finite annual-mass range")
    return value


def _empty():
    return {"cells": 0, "increased_cells": 0, "decreased_cells": 0,
            "unchanged_cells": 0, "increase_binary": 0, "reduction_binary": 0}


def _add(counter, values):
    import numpy as np
    increased, decreased = values[values > 0], values[values < 0]
    counter["cells"] += int(values.size)
    counter["increased_cells"] += int(increased.size)
    counter["decreased_cells"] += int(decreased.size)
    counter["unchanged_cells"] += int(np.count_nonzero(values == 0))
    counter["increase_binary"] += _binary_sum(increased)
    counter["reduction_binary"] -= _binary_sum(decreased)


def _finish(counter, area):
    increase, reduction = counter["increase_binary"], counter["reduction_binary"]
    result = {name: value for name, value in counter.items() if not name.endswith("_binary")}
    result.update(
        valid_area_ha=counter["cells"] * area,
        increased_area_ha=counter["increased_cells"] * area,
        decreased_area_ha=counter["decreased_cells"] * area,
        unchanged_area_ha=counter["unchanged_cells"] * area,
        gross_increase_mass=_mass(increase),
        gross_reduction_mass=_mass(reduction),
        net_change_mass=_mass(increase - reduction),
        absolute_response_mass=_mass(increase + reduction),
        exact_binary_units={"gross_increase": str(increase), "gross_reduction": str(reduction),
                            "net_change": str(increase - reduction),
                            "absolute_response": str(increase + reduction)},
        increase_to_reduction_ratio=(increase / reduction) if reduction else None)
    return result


def _top(heap, raw, valid, direction, window, before, after, classified):
    """Keep deterministic top responses without sorting or retaining the full grid."""
    import numpy as np
    magnitude = raw if direction == "increase" else -raw
    candidates = np.flatnonzero(valid & (magnitude > 0))
    if not candidates.size:
        return
    values = magnitude.ravel()[candidates]
    count = min(PEAKS_PER_DIRECTION, candidates.size)
    if values.size > count:
        threshold = np.partition(values, values.size - count)[values.size - count]
        # Include equal boundary values before stable row/column tie selection.
        candidates = candidates[values >= threshold]
        values = magnitude.ravel()[candidates]
    order = np.lexsort((candidates, -values))[:count]
    width = raw.shape[1]
    before_data, before_valid = before
    after_data, after_valid = after
    for local in candidates[order]:
        rr, cc = divmod(int(local), width)
        row, col = int(window.row_off) + rr, int(window.col_off) + cc
        item = (float(magnitude[rr, cc]), -row, -col, float(raw[rr, cc]),
                int(before_data[rr, cc]) if before_valid[rr, cc] else None,
                int(after_data[rr, cc]) if after_valid[rr, cc] else None,
                int(classified[rr, cc]))
        if len(heap) < PEAKS_PER_DIRECTION:
            heapq.heappush(heap, item)
        elif item[:3] > heap[0][:3]:
            heapq.heapreplace(heap, item)


def _read(src, window):
    import numpy as np
    value = src.read(1, window=window, masked=True)
    raw = np.ma.getdata(value)
    return raw, ~np.ma.getmaskarray(value) & np.isfinite(raw)


def build_response(difference_paths, descriptors, input_maps, lulc_paths, grid,
                   parameter_changes, output_dir):
    """Return a physical response ledger and actual cell-centre GIS inventory.

    The original native comparator owns the net outcome and support. This
    function partitions that exact retained difference; it does not rerun it.
    """
    import numpy as np
    import rasterio
    from pyproj import CRS, Transformer
    from . import rasters

    directory = Path(output_dir)
    crs = CRS.from_user_input(grid["crs"])
    to_geographic = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
    results, points = {}, []
    with ExitStack() as stack:
        before, after = [stack.enter_context(rasterio.open(path)) for path in lulc_paths]
        classified = {model: stack.enter_context(rasterio.open(path)) for model, path in input_maps.items()}
        for metric, path in difference_paths.items():
            model, annual_units = METRICS[metric]
            descriptor = descriptors[metric]
            if descriptor.get("units") != rasters.MASS_UNITS[metric]:
                raise ValueError("The original paired response has unexpected mass units")
            expected = float(descriptor["sum_change"])
            if not math.isfinite(expected):
                raise ValueError("The retained paired annual change is nonfinite")
            counter = _empty()
            groups = {name: _empty() for name in CATEGORIES.values()}
            heaps = {"increase": [], "reduction": []}
            sequential_sum, cells = 0.0, 0
            with rasterio.open(path) as response:
                if np.dtype(response.dtypes[0]) != np.dtype("float32"):
                    raise ValueError("Use the current native application's retained Float32 paired export")
                for operand in (before, after, classified[model]):
                    rasters.check_same_grid(response, operand)
                transform = response.transform
                area = abs(transform.a * transform.e - transform.b * transform.d) / 10000
                for _, window in response.block_windows(1):
                    raw, valid = _read(response, window)
                    values = raw[valid]
                    # This is the source comparator's own block traversal/order.
                    sequential_sum += float(values.sum(dtype="float64"))
                    cells += int(values.size)
                    category = classified[model].read(1, window=window)
                    unknown = set(map(int, np.unique(category[valid]))) - set(CATEGORIES)
                    if unknown:
                        raise ValueError("Input change map contains an unknown response category")
                    _add(counter, values)
                    for code, name in CATEGORIES.items():
                        _add(groups[name], raw[valid & (category == code)])
                    operands = (_read(before, window), _read(after, window))
                    for direction in heaps:
                        _top(heaps[direction], raw, valid, direction, window,
                             operands[0], operands[1], category)
                if cells != descriptor["valid_cells"] or sequential_sum != expected:
                    raise ValueError("The response raster does not exactly reproduce its retained native comparison")
                exact = counter["increase_binary"] - counter["reduction_binary"]
                partition_exact = sum(value["increase_binary"] - value["reduction_binary"]
                                      for value in groups.values())
                if exact != partition_exact or cells != sum(value["cells"] for value in groups.values()):
                    raise RuntimeError("The input-category response partition failed to reconcile")
                unchanged = groups["same_code_same_coefficients"]
                code_only = groups["code_only"]
                outside_absolute = sum(value["increase_binary"] + value["reduction_binary"]
                                       for value in (unchanged, code_only))
                total_absolute = counter["increase_binary"] + counter["reduction_binary"]
                summary = _finish(counter, area)
                summary.update(
                    native_model=model, units=annual_units,
                    original_sum_change=expected,
                    original_valid_cells=cells,
                    reproduced_native_sum_change=sequential_sum,
                    partition_sum_exact_binary_units=str(partition_exact),
                    native_sum_roundoff_mass=expected - _mass(exact),
                    global_parameter_changes=parameter_changes.get(model, []),
                    input_categories={name: _finish(value, area) for name, value in groups.items()},
                    outside_changed_coefficients_absolute_response_fraction=(
                        outside_absolute / total_absolute if total_absolute else None),
                    interpretation=(
                        "Responses are changes in modeled source contributions reaching streams. "
                        "Input categories partition where those source cells are located. "
                        "Flow routing and configuration changes can affect other source cells."),
                    point_count={direction: len(heap) for direction, heap in heaps.items()})
                # Keep the exact original net as the operator-facing total.
                summary["net_change_mass"] = expected
                results[metric] = summary
                for direction, heap in heaps.items():
                    for rank, item in enumerate(sorted(heap, key=lambda x: (-x[0], -x[1], -x[2])), 1):
                        _, neg_row, neg_col, change, from_code, to_code, category = item
                        row, col = -neg_row, -neg_col
                        x, y = transform * (col + 0.5, row + 0.5)
                        longitude, latitude = to_geographic.transform(x, y)
                        if not all(math.isfinite(v) for v in (x, y, longitude, latitude)):
                            raise ValueError("An actual response cell has nonfinite projected coordinates")
                        points.append({
                            "metric": metric, "direction": direction, "rank": rank,
                            "row": row, "column": col, "native_x": x, "native_y": y,
                            "longitude": longitude, "latitude": latitude,
                            "delta_mass": change, "units": annual_units,
                            "baseline_code": from_code, "alternative_code": to_code,
                            "input_category": CATEGORIES[category],
                            "native_model": model,
                            "global_parameters_changed": bool(parameter_changes.get(model))})
    _write_points(directory / "response-cells.gpkg", points, crs)
    fields = ("metric", "native_model", "units", "input_category", "cells", "valid_area_ha",
              "increased_cells", "increased_area_ha", "decreased_cells", "decreased_area_ha",
              "unchanged_cells", "unchanged_area_ha", "gross_increase_mass",
              "gross_reduction_mass", "net_change_mass", "absolute_response_mass",
              "exact_net_binary_units", "global_parameters_changed")
    with (directory / "response-partitions.csv").open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        for metric, result in results.items():
            for name, group in result["input_categories"].items():
                writer.writerow({
                    **{key: group[key] for key in fields if key in group},
                    "metric": metric, "native_model": result["native_model"], "units": result["units"],
                    "input_category": name,
                    "exact_net_binary_units": group["exact_binary_units"]["net_change"],
                    "global_parameters_changed": bool(result["global_parameter_changes"])})
    point_fields = tuple(points[0]) if points else (
        "metric", "direction", "rank", "row", "column", "native_x", "native_y",
        "longitude", "latitude", "delta_mass", "units", "baseline_code", "alternative_code",
        "input_category", "native_model", "global_parameters_changed")
    with (directory / "response-cells.csv").open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=point_fields)
        writer.writeheader()
        writer.writerows(points)
    return {
        "schema": "upstate.native-response-ledger/v1", "metrics": results,
        "largest_cell_responses": points,
        "source_crs": crs.to_wkt(), "source_crs_name": crs.to_string(), "point_layer": "response_cells",
        "coordinate_reference": "Centres of actual retained native cells, with original row/column and CRS",
        "selection": {"per_metric_per_direction": PEAKS_PER_DIRECTION,
                      "rank": "Absolute response within its sign; row then column break ties",
                      "sign_rule": "Strict sign of the retained paired Float32 difference"},
        "exact_sum": {"binary_unit_power": SCALE_POWER,
                      "definition": "Exact integers multiplied by 2**-149 give physical annual mass",
                      "reconciliation": "Input categories reconcile exactly in binary units; the original native block sum is reproduced exactly",
                      "roundoff": "native_sum_roundoff_mass records floating summation roundoff separately"},
        "global_parameter_interpretation": "Changed global parameters apply to the comparison as a whole and are never allocated to a particular input category",
        "files": {"response_cells": "response-cells.gpkg",
                  "response_points": "response-cells.csv",
                  "response_partitions": "response-partitions.csv"},
    }


def _write_points(path, rows, crs):
    import fiona
    from .rasters import vector_environment
    properties = {"metric": "str", "direction": "str", "rank": "int", "row": "int64",
                  "column": "int64", "delta_mass": "float", "units": "str",
                  "baseline_code": "int", "alternative_code": "int",
                  "input_category": "str", "native_model": "str", "global_params": "int"}
    with vector_environment(), fiona.open(
            path, "w", driver="GPKG", layer="response_cells",
            crs_wkt=crs.to_wkt(), schema={"geometry": "Point", "properties": properties}) as target:
        for row in rows:
            data = {key: row[key] for key in properties if key != "global_params"}
            data["global_params"] = int(row["global_parameters_changed"])
            target.write({"geometry": {"type": "Point", "coordinates": (row["native_x"], row["native_y"])},
                          "properties": data})
