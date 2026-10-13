"""Area-accounted comparison of original native pixel-mass rasters.

The original rasters remain authoritative and unchanged. Within a retained valid
cell, its mass is allocated uniformly over that cell's projected rectangle.
This diagnostic does not create a native run or predict subcell concentrations.
Only equivalent projected-metre, north-up unrotated grids are supported.
"""
from __future__ import annotations
import math
import os
from pathlib import Path
import tempfile

from .common import atomic_json, canonical, describe_file, digest, held, read_json, verify_file

VERSION = "native-mass-rectangular-overlap-1"
BANDS = ("reference_shared_mass", "case_shared_mass", "case_minus_reference",
         "shared_valid_area_m2", "reference_shared_fraction")
METHOD = (
    "Each original raster already stores annual mass per native pixel. Allocate "
    "that stored mass once by the exact projected rectangular overlap fraction, "
    "assuming uniform mass within each valid cell. Pair only areas where both "
    "original rasters have finite valid values. Diagnostic cells use the reference "
    "lattice for display; they are not new native predictions. Original reporting "
    "masks selected pixel centres, so boundary support can differ by grid."
)


def _grid(dataset):
    from pyproj import CRS
    crs = CRS.from_user_input(dataset.crs)
    t = dataset.transform
    if (not crs.is_projected or len(crs.axis_info) < 2
            or any(abs(axis.unit_conversion_factor - 1.0) > 1e-12 for axis in crs.axis_info[:2])
            or not all(math.isfinite(v) for v in list(t)[:6])
            or t.a <= 0 or t.e >= 0 or t.b != 0 or t.d != 0
            or dataset.width <= 0 or dataset.height <= 0):
        raise ValueError("Structural comparison requires original projected-metre north-up unrotated grids")
    return {"crs": crs.to_wkt(), "transform": list(t)[:6],
            "width": dataset.width, "height": dataset.height,
            "pixel_area_m2": abs(t.a * t.e), "units": dataset.tags().get("units"),
            "nodata": dataset.nodata}


def _name_state(path):
    value = Path(path).stat()
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)


def _window_record(window):
    return {name: int(getattr(window, name)) for name in ("col_off", "row_off", "width", "height")}


def _windows(width, height, edge):
    from rasterio.windows import Window
    for row in range(0, height, edge):
        for col in range(0, width, edge):
            yield Window(col, row, min(edge, width - col), min(edge, height - row))


def _values(dataset, window):
    import numpy as np
    values = dataset.read(1, window=window, masked=True)
    raw = np.ma.getdata(values).astype("float64", copy=False)
    valid = ~np.ma.getmaskarray(values) & np.isfinite(raw)
    if np.any(raw[valid] < 0):
        raise ValueError("Original native annual export contains negative mass")
    return raw, valid


def _intervals(origin, step, first, count):
    import numpy as np
    values = origin + (first + np.arange(count, dtype="float64")) * step
    return np.minimum(values, values + step), np.maximum(values, values + step)


def _weights(a_origin, a_step, a_first, a_count, b_origin, b_step, b_first, b_count):
    import numpy as np
    lo_a, hi_a = _intervals(a_origin, a_step, a_first, a_count)
    lo_b, hi_b = _intervals(b_origin, b_step, b_first, b_count)
    return np.maximum(0.0, np.minimum(hi_a[:, None], hi_b[None, :])
                      - np.maximum(lo_a[:, None], lo_b[None, :]))


def _other_window(reference, window, other):
    from rasterio.windows import bounds, Window
    left, bottom, right, top = bounds(window, reference.transform)
    t = other.transform
    # Outward integer bounds include all possible intersecting source cells.
    c0 = max(0, min(other.width, math.floor((left - t.c) / t.a)))
    c1 = max(0, min(other.width, math.ceil((right - t.c) / t.a)))
    r0 = max(0, min(other.height, math.floor((top - t.f) / t.e)))
    r1 = max(0, min(other.height, math.ceil((bottom - t.f) / t.e)))
    return Window(c0, r0, max(0, c1 - c0), max(0, r1 - r0))


def _native_total(dataset, directory, role, binding, edge):
    import numpy as np
    path = directory / (role + "-own-support.json")
    if path.exists():
        retained = read_json(path)
        if canonical(retained.get("binding")) != canonical(binding):
            raise ValueError("Own-support totals belong to different original raster bytes")
        return retained["totals"]
    sums, counts = [], []
    for window in _windows(dataset.width, dataset.height, edge):
        values, valid = _values(dataset, window)
        sums.append(float(np.sum(values[valid], dtype="float64")))
        counts.append(int(np.count_nonzero(valid)))
    count = sum(counts)
    result = {"valid_cells": count, "valid_area_m2": count * abs(dataset.transform.a * dataset.transform.e),
              "mass": math.fsum(sums) if count else None}
    atomic_json(path, {"binding": binding, "totals": result}, immutable=True)
    return result


def _tile(reference, alternative, window, directory, binding, edge, index):
    import numpy as np
    import rasterio
    from rasterio.windows import Window
    key = "%08d" % index
    record_path = directory / "tiles" / (key + ".json")
    if record_path.exists():
        record = read_json(record_path)
        if canonical(record.get("binding")) != canonical(binding) or record.get("window") != _window_record(window):
            raise ValueError("Retained overlap tile belongs to a different source/window")
        verify_file(directory, record["file"])
        return record
    av, valid_a = _values(reference, window)
    height, width = av.shape
    areas = np.zeros((height, width), dtype="float64")
    case_mass = np.zeros((height, width), dtype="float64")
    other = _other_window(reference, window, alternative) if np.any(valid_a) else Window(0, 0, 0, 0)
    for local in _windows(int(other.width), int(other.height), edge):
        selected = Window(other.col_off + local.col_off, other.row_off + local.row_off,
                          local.width, local.height)
        bv, valid_b = _values(alternative, selected)
        if not np.any(valid_b):
            continue
        wy = _weights(reference.transform.f, reference.transform.e, int(window.row_off), height,
                      alternative.transform.f, alternative.transform.e,
                      int(selected.row_off), int(selected.height))
        wx = _weights(reference.transform.c, reference.transform.a, int(window.col_off), width,
                      alternative.transform.c, alternative.transform.a,
                      int(selected.col_off), int(selected.width))
        weights = valid_b.astype("float64")
        area_b = abs(alternative.transform.a * alternative.transform.e)
        with np.errstate(over="raise", invalid="raise"):
            areas += (wy @ weights) @ wx.T
            case_mass += (wy @ np.where(valid_b, bv / area_b, 0.0)) @ wx.T
    area_a = abs(reference.transform.a * reference.transform.e)
    tolerance = max(1e-9, area_a * 1e-10)
    if np.any(areas > area_a + tolerance) or np.any(areas < 0):
        raise ValueError("Overlap weights exceed an original reference cell")
    # Roundoff below the declared tolerance is bounded to the original cell.
    areas = np.minimum(areas, area_a)
    shared = valid_a & (areas > 0)
    areas = np.where(shared, areas, 0.0)
    reference_mass = np.where(shared, av * (areas / area_a), 0.0)
    case_mass = np.where(shared, case_mass, 0.0)
    change = case_mass - reference_mass
    if any(np.any(~np.isfinite(values[shared])) for values in (reference_mass, case_mass, change)):
        raise ValueError("Overlap calculation exceeds finite diagnostic range")
    summary = {"reference_shared_mass": float(np.sum(reference_mass, dtype="float64")),
               "case_shared_mass": float(np.sum(case_mass, dtype="float64")),
               "shared_valid_area_m2": float(np.sum(areas, dtype="float64")),
               "reference_cells_with_shared_support": int(np.count_nonzero(shared))}
    values = [reference_mass, case_mass, change, areas, areas / area_a]
    nodata = -1.7976931348623157e308
    profile = {"driver": "GTiff", "width": width, "height": height, "count": len(BANDS),
               "dtype": "float64", "crs": reference.crs, "transform": reference.window_transform(window),
               "nodata": nodata, "compress": "deflate"}
    target = directory / "tiles" / (key + ".tif")
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".overlap-", suffix=".tif", dir=target.parent)
    os.close(fd)
    temp = Path(temporary)
    try:
        with rasterio.open(temp, "w", **profile) as output:
            for band, (name, value) in enumerate(zip(BANDS, values), 1):
                output.write(np.where(shared, value, nodata), band)
                output.set_band_description(band, name)
            output.update_tags(method=METHOD, version=VERSION, binding=digest(binding))
        with temp.open("rb") as source:
            os.fsync(source.fileno())
        if target.exists():
            # This name has no journal yet: only an exact deterministic tile can
            # be adopted. No first completed published tile is overwritten.
            expected = describe_file(target.parent, target)
            actual = describe_file(temp.parent, temp)
            if any(expected[key] != actual[key] for key in ("bytes", "sha256")):
                raise ValueError("An unjournaled overlap tile differs from its original deterministic result")
        else:
            os.link(temp, target)
        record = {"binding": binding, "window": _window_record(window),
                  "file": describe_file(directory, target), "summary": summary}
        atomic_json(record_path, record, immutable=True)
        return record
    finally:
        temp.unlink(missing_ok=True)


def _materialize(reference, records, directory, binding):
    import rasterio
    from rasterio.windows import Window
    target = directory / "shared-support-diagnostic.tif"
    descriptor_path = directory / "diagnostic-file.json"
    if descriptor_path.exists():
        record = read_json(descriptor_path)
        if canonical(record.get("binding")) != canonical(binding):
            raise ValueError("Saved structural diagnostic has another original source binding")
        verify_file(directory, record["file"])
        return record["file"]
    fd, temporary = tempfile.mkstemp(prefix=".overlap-map-", suffix=".tif", dir=directory)
    os.close(fd)
    temp = Path(temporary)
    profile = {"driver": "GTiff", "width": reference.width, "height": reference.height,
               "count": len(BANDS), "dtype": "float64", "crs": reference.crs,
               "transform": reference.transform, "nodata": -1.7976931348623157e308,
               "compress": "deflate", "tiled": True, "blockxsize": 256, "blockysize": 256,
               "BIGTIFF": "IF_SAFER"}
    try:
        with rasterio.open(temp, "w", **profile) as output:
            for record in records:
                window = Window(**record["window"])
                with rasterio.open(verify_file(directory, record["file"])) as tile:
                    output.write(tile.read(), window=window)
            for index, name in enumerate(BANDS, 1):
                output.set_band_description(index, name)
            output.update_tags(method=METHOD, version=VERSION, binding=digest(binding),
                               direction="case minus reference", native_prediction="false")
        with temp.open("rb") as source:
            os.fsync(source.fileno())
        if target.exists():
            previous = describe_file(directory, target)
            actual = describe_file(directory, temp)
            if any(previous[key] != actual[key] for key in ("bytes", "sha256")):
                raise ValueError("First completed structural diagnostic differs; preserve its original generation")
        else:
            os.link(temp, target)
        descriptor = describe_file(directory, target, bands=list(BANDS),
                                   interpretation="reference-lattice area-allocation diagnostic")
        atomic_json(descriptor_path, {"binding": binding, "file": descriptor}, immutable=True)
        return descriptor
    finally:
        temp.unlink(missing_ok=True)


def compare(reference_path, case_path, directory, *, pollutant, reference_file,
            case_file, tile_size=128, progress=None):
    """Compare complete original files with bounded in-memory tiles and replay."""
    import rasterio
    from pyproj import CRS
    from .rasters import MASS_UNITS
    if type(tile_size) is not int or not 16 <= tile_size <= 512:
        raise ValueError("Choose a structural comparison tile size between 16 and 512")
    if pollutant not in MASS_UNITS:
        raise ValueError("Choose an original annual native pollutant output")
    reference_path, case_path, directory = map(Path, (reference_path, case_path, directory))
    directory.mkdir(parents=True, exist_ok=True)
    # The complete descriptors arrive from the original run and are verified here
    # exactly once before raster reads. Later named-file checks catch replacement.
    before_a, before_b = _name_state(reference_path), _name_state(case_path)
    for path, descriptor, expected in ((reference_path, reference_file, before_a),
                                       (case_path, case_file, before_b)):
        verify_file(path.parent, {**descriptor, "path": path.name})
        if _name_state(path) != expected:
            raise ValueError("An original native raster changed while binding its complete bytes")
    with held(directory / ".overlap.lock", blocking=False):
        with rasterio.open(reference_path) as a, rasterio.open(case_path) as b:
            ga, gb = _grid(a), _grid(b)
            if not CRS.from_user_input(a.crs).equals(CRS.from_user_input(b.crs)):
                raise ValueError("Different projected CRSs require an explicitly reviewed transformation; this original-grid comparison does not warp inputs")
            units = MASS_UNITS[pollutant]
            if ga["units"] != units or gb["units"] != units:
                raise ValueError("Structural comparison requires original " + units + " pixel-mass rasters")
            binding = {"version": VERSION, "pollutant": pollutant, "units": units,
                       "reference_file": reference_file, "case_file": case_file,
                       "reference_grid": ga, "case_grid": gb, "tile_size": tile_size}
            result_path = directory / "result.json"
            if result_path.exists():
                result = read_json(result_path)
                if canonical(result.get("binding")) != canonical(binding):
                    raise ValueError("Structural result belongs to different original sources or method")
                verify_file(directory, result["diagnostic"])
                if _name_state(reference_path) != before_a or _name_state(case_path) != before_b:
                    raise ValueError("An original raster changed during completed-result recovery")
                return result
            atomic_json(directory / "binding.json", binding, immutable=True)
            own_a = _native_total(a, directory, "reference", binding, tile_size)
            own_b = _native_total(b, directory, "case", binding, tile_size)
            records = []
            total = math.ceil(a.width / tile_size) * math.ceil(a.height / tile_size)
            for index, window in enumerate(_windows(a.width, a.height, tile_size)):
                records.append(_tile(a, b, window, directory, binding, tile_size, index))
                if progress:
                    progress({"phase": "geographic-overlap", "pollutant": pollutant,
                              "completed_tiles": index + 1, "total_tiles": total})
            shared_area = math.fsum(row["summary"]["shared_valid_area_m2"] for row in records)
            shared_a = math.fsum(row["summary"]["reference_shared_mass"] for row in records)
            shared_b = math.fsum(row["summary"]["case_shared_mass"] for row in records)
            area_tolerance = max(1e-6, min(own_a["valid_area_m2"], own_b["valid_area_m2"]) * 1e-9)
            if shared_area > min(own_a["valid_area_m2"], own_b["valid_area_m2"]) + area_tolerance:
                raise ValueError("Shared support exceeds one original valid footprint")
            def side(own, shared):
                mass = own["mass"]
                tolerance = max(1e-9, abs(mass or 0) * 1e-9)
                if mass is not None and shared > mass + tolerance:
                    raise ValueError("Allocated mass exceeds its original own-support mass")
                return {**own, "shared_area_m2": shared_area,
                        "omitted_valid_area_m2": max(0.0, own["valid_area_m2"] - shared_area),
                        "shared_mass": shared if shared_area > 0 else None,
                        "omitted_mass": max(0.0, mass - shared) if mass is not None else None,
                        "shared_fraction_of_own_area": shared_area / own["valid_area_m2"] if own["valid_area_m2"] else None}
            reference, case = side(own_a, shared_a), side(own_b, shared_b)
            diagnostic = _materialize(a, records, directory, binding)
            if _name_state(reference_path) != before_a or _name_state(case_path) != before_b:
                raise ValueError("An original native raster changed during structural comparison")
            result = {"schema": "upstate.structural-overlap/v1", "binding": binding,
                      "pollutant": pollutant, "mass_units": units.replace("/pixel", ""),
                      "area_units": "m2 in the original projected CRS", "method": METHOD,
                      "reference": reference, "case": case,
                      "shared_valid_area_m2": shared_area,
                      "change_shared_mass": shared_b - shared_a if shared_area > 0 else None,
                      "percent_change_shared": 100 * (shared_b - shared_a) / shared_a if shared_area > 0 and shared_a else None,
                      "direction": "case minus reference",
                      "diagnostic": diagnostic, "tile_count": len(records),
                      "limitations": [
                          "Within-cell uniform mass allocation is an explicit diagnostic assumption.",
                          "The original reporting masks select pixel centres; their own-support totals are unchanged.",
                          "Different comparisons may have different shared support; do not rank totals from unlike areas.",
                          "These are modeled annual exports to streams, not measured intake concentrations.",
                          "The diagnostic does not establish causality when more than one source or factor changed.",
                      ]}
            atomic_json(result_path, result, immutable=True)
            return result
