"""Bounded complete-cell geographic views for retained GIS edition change rasters."""
from __future__ import annotations

from copy import deepcopy
import json
import math
from pathlib import Path

from . import gis_project as gis

SCHEMA = "upstate.gis-raster-change-view/v1"
MAX_SIDE = 256
WINDOW = 512
TEMPLATE = "gis_review_raster_view.html"


def _coordinate_units(crs):
    from pyproj import CRS
    axes = CRS.from_wkt(crs.to_wkt()).axis_info
    names = [axis.unit_name for axis in axes[:2]]
    return names[0] if len(names) == 2 and names[0] == names[1] else None


def build(directory, comparison):
    """Retain every native support cell; aggregate display bins without resampling."""
    import numpy as np
    import rasterio
    from rasterio.windows import Window

    directory = Path(directory)
    support_path = directory / "support-change.tif"
    if not support_path.exists():
        return None
    if not comparison.get("same_grid") or not comparison.get("same_band"):
        raise ValueError("A geographic change view requires the original paired native grid and band")
    difference_path = directory / "value-change.tif"
    numeric = comparison.get("difference") is not None
    if difference_path.exists() != numeric:
        raise ValueError("The retained physical-difference file does not match its original comparison")
    expected = comparison["counts"]
    with rasterio.open(support_path) as support:
        if support.count != 1 or support.crs is None:
            raise ValueError("Choose the original single-band georeferenced support-change raster")
        header = comparison["headers"]["exported"]
        if (support.width != header["width"] or support.height != header["height"]
                or tuple(support.transform)[:6] != tuple(header["transform"])
                or support.crs != rasterio.crs.CRS.from_wkt(header["crs"])):
            raise ValueError("The retained support raster differs from its original native grid")
        column_step = max(1, math.ceil(support.width / MAX_SIDE))
        row_step = max(1, math.ceil(support.height / MAX_SIDE))
        width = math.ceil(support.width / column_step)
        height = math.ceil(support.height / row_step)
        size = width * height
        counts = np.zeros((4, size), dtype="uint64")
        physical_count = np.zeros(size, dtype="uint64")
        minimum = np.full(size, np.inf, dtype="float64")
        maximum = np.full(size, -np.inf, dtype="float64")
        difference = rasterio.open(difference_path) if numeric else None
        try:
            if difference and (difference.count != 1 or difference.crs != support.crs
                    or difference.width != support.width or difference.height != support.height
                    or difference.transform != support.transform):
                raise ValueError("The retained difference and support rasters have different native grids")
            for row in range(0, support.height, WINDOW):
                for col in range(0, support.width, WINDOW):
                    window = Window(col, row, min(WINDOW, support.width-col), min(WINDOW, support.height-row))
                    codes = support.read(1, window=window, masked=False)
                    if not np.isin(codes, (0, 1, 2, 3)).all():
                        raise ValueError("The original support raster contains an unknown change code")
                    bins = (((np.arange(codes.shape[0]) + row) // row_step)[:, None] * width
                            + ((np.arange(codes.shape[1]) + col) // column_step)[None, :]).ravel()
                    flat_codes = codes.ravel()
                    for code in range(4):
                        counts[code] += np.bincount(bins[flat_codes == code], minlength=size).astype("uint64")
                    if difference:
                        values = difference.read(1, window=window, masked=True)
                        valid = ~np.ma.getmaskarray(values) & np.isfinite(values.data)
                        if (valid & (codes != 1)).any():
                            raise ValueError("A physical difference falls outside original common finite-valid support")
                        selected = bins[valid.ravel()]
                        finite_values = values.data[valid]
                        physical_count += np.bincount(selected, minlength=size).astype("uint64")
                        np.minimum.at(minimum, selected, finite_values)
                        np.maximum.at(maximum, selected, finite_values)
        finally:
            if difference:
                difference.close()
        names = ("neither_valid", "common_valid", "added_valid", "removed_valid")
        for code, name in enumerate(names):
            if int(counts[code].sum()) != expected[name]:
                raise ValueError("The complete geographic support view differs from original " + name)
        if int(counts.sum()) != support.width * support.height or expected["cells"] != support.width * support.height:
            raise ValueError("The geographic view did not retain every original native cell")
        if numeric and (int(physical_count.sum()) != comparison["difference"]["valid_cells"]
                or int(counts[1].sum()) - int(physical_count.sum()) != expected.get("unrepresentable_difference_cells", 0)):
            raise ValueError("The geographic view differs from the original representable physical-difference support")
        record = {
            "schema": SCHEMA, "width": width, "height": height,
            "native_width": support.width, "native_height": support.height,
            "column_step": column_step, "row_step": row_step,
            "transform": list(support.transform)[:6],
            "crs": support.crs.to_wkt(), "crs_label": support.crs.to_string(),
            "coordinate_units": _coordinate_units(support.crs),
            "selected_bands": deepcopy(comparison["selected_bands"]),
            "units": deepcopy(comparison["units"]),
            "method": "Complete native-cell aggregation into contiguous grid bins; no resampling",
            "support_codes": {"0": "neither finite-valid", "1": "both finite-valid",
                              "2": "added finite-valid", "3": "removed finite-valid"},
            "cells": {
                "neither": counts[0].tolist(), "common": counts[1].tolist(),
                "added": counts[2].tolist(), "removed": counts[3].tolist(),
                "physical_count": physical_count.tolist(),
                "physical_minimum": [float(value) if math.isfinite(value) else None for value in minimum],
                "physical_maximum": [float(value) if math.isfinite(value) else None for value in maximum],
            },
            "physical_comparison": ("received minus exported" if numeric else comparison.get("physical_comparison",
                                    "No physical difference was calculated for this comparison")),
            "physical_available": numeric,
            "unrepresentable_difference_cells": expected.get("unrepresentable_difference_cells", 0),
            "files": {"support": "support-change.tif",
                      "difference": "value-change.tif" if numeric else None,
                      "data": "raster-view.json"},
        }
    path = directory / "raster-view.json"
    gis.save(path, record)
    return path


def render(report, directory):
    """Embed retained views and exact relative artifacts in the portable report."""
    directory = Path(directory)
    payload = deepcopy(report)
    for row in payload["layers"]:
        descriptor = row.get("raster_view")
        if descriptor is None:
            continue
        gis.checked(directory, descriptor)
        path = gis.local(directory, descriptor["path"])
        view = gis.load(path)
        if view.get("schema") != SCHEMA:
            raise ValueError("Choose a retained geographic GIS change view")
        prefix = path.parent.relative_to(directory).as_posix()
        view["files"] = {name: (prefix + "/" + member if member else None)
                         for name, member in view["files"].items()}
        declared = {item["path"] for item in row["files"]}
        if any(member not in declared for member in view["files"].values() if member):
            raise ValueError("A geographic view references an undeclared original change artifact")
        row["raster_view"] = view
    serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    for character, escaped in (("<", "\\u003c"), (">", "\\u003e"), ("&", "\\u0026"),
                               ("\u2028", "\\u2028"), ("\u2029", "\\u2029")):
        serialized = serialized.replace(character, escaped)
    template = Path(__file__).with_name(TEMPLATE).read_text(encoding="utf-8")
    marker = "__GIS_REVIEW_PAYLOAD__"
    if template.count(marker) != 1:
        raise ValueError("The original geographic review template payload marker changed")
    return template.replace(marker, serialized, 1)
