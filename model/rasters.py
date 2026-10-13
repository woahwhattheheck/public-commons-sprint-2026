"""Native grid, explicit scenario edits and output-unit derivations."""
from __future__ import annotations
import math
from contextlib import contextmanager
from pathlib import Path
import shutil
from .common import (atomic_bytes, atomic_json, describe_file, digest, file_digest,
                     finite, held, read_json, verify_file)

RESOLUTION = 30.0
RATE_UNITS = {"nitrogen_export": "kg/ha/year",
              "phosphorus_export": "kg/ha/year",
              "sediment_export": "metric_tonnes/ha/year"}
MASS_UNITS = {"nitrogen_export": "kg/pixel/year",
              "phosphorus_export": "kg/pixel/year",
              "sediment_export": "metric_tonnes/pixel/year"}

def vector_environment():
    """Use the original vector runtime's GDAL/PROJ data in a scoped context.

    Adopted from the accepted Tucannon native receiving path (Commons PR34039).
    Rasterio and Fiona wheels can carry different GDAL resource editions.
    """
    import fiona
    package = Path(fiona.__file__).resolve().parent
    options = {"CPL_VSIL_GZIP_WRITE_PROPERTIES": "NO"}
    if (package / "gdal_data").is_dir():
        options["GDAL_DATA"] = str(package / "gdal_data")
    if (package / "proj_data" / "proj.db").is_file():
        options["PROJ_LIB"] = str(package / "proj_data")
    return fiona.Env(**options)

def native_vector_path(path):
    """Read the retained native body, including its original gzip carrier."""
    path = Path(path).resolve(strict=True)
    with path.open("rb") as original:
        gzip_encoded = original.read(2) == b"\x1f\x8b"
    return "/vsigzip/" + str(path) if gzip_encoded else str(path)

def vector_geometry(path, *, layer=None, where=None, target_crs=None):
    import fiona
    from pyproj import CRS, Transformer
    from shapely.geometry import shape
    from shapely.ops import transform
    rows = []
    kwargs = {"layer": layer} if layer else {}
    with vector_environment(), fiona.open(native_vector_path(path), **kwargs) as src:
        native = CRS.from_user_input(src.crs_wkt or src.crs)
        target = CRS.from_user_input(target_crs) if target_crs else native
        project = Transformer.from_crs(native, target, always_xy=True)
        for feature in src:
            properties = dict(feature["properties"])
            if where and any(properties.get(k) != v for k, v in where.items()):
                continue
            if not feature["geometry"]:
                continue
            geometry = shape(feature["geometry"])
            if geometry.is_empty:
                continue
            if not geometry.is_valid:
                raise ValueError("Source feature " + str(feature.id) + " requires an explicit geometry correction")
            if native != target:
                geometry = transform(project.transform, geometry)
            rows.append({"id": str(feature.id), "properties": properties, "geometry": geometry})
    if not rows:
        raise ValueError("The selected vector source/filter contains no geometry")
    return rows, target

def polygon_union(rows):
    from shapely.ops import unary_union
    geometries = [row["geometry"] for row in rows]
    if any(g.geom_type not in ("Polygon", "MultiPolygon") for g in geometries):
        raise ValueError("A model domain or reporting mask must contain polygons")
    result = unary_union(geometries)
    if result.is_empty or not result.is_valid:
        raise ValueError("The selected polygon union is invalid")
    return result

def write_geometry(path, geometry, crs, *, layer, title):
    import fiona
    from shapely.geometry import mapping
    from shapely.geometry import MultiPolygon
    if geometry.geom_type == "Polygon":
        geometry = MultiPolygon([geometry])
    schema = {"geometry": "MultiPolygon", "properties": {"id": "int", "title": "str"}}
    with vector_environment(), fiona.open(path, "w", driver="GPKG", schema=schema,
                    crs_wkt=crs.to_wkt(), layer=layer) as out:
        out.write({"geometry": mapping(geometry), "properties": {"id": 1, "title": title}})

def grid_definition(reference, model_geometry, *, resolution=None):
    """Retain the reference lattice, including native grids other than 30 metres.

    An explicit resolution is a compatibility assertion about the source, not
    permission to resample it to a different scientific grid. The established
    nominal-30-metre normalization remains unchanged for the Upstate sources.
    """
    import rasterio
    from pyproj import CRS
    from rasterio.transform import Affine
    requested = None if resolution is None else finite(
        resolution, "model grid resolution", positive=True)
    with rasterio.open(reference) as ref:
        crs = CRS.from_user_input(ref.crs)
        if not crs.is_projected or any(abs(axis.unit_conversion_factor - 1) > 1e-12 for axis in crs.axis_info[:2]):
            raise ValueError("Select a projected reference grid in metres")
        observed = ref.transform
        if (not all(math.isfinite(value) for value in list(observed)[:6])
                or observed.b != 0 or observed.d != 0
                or observed.a <= 0 or observed.e >= 0):
            raise ValueError("Reference grid must be finite, north-up and unrotated")
        source_x, source_y = observed.a, -observed.e
        nominal_30 = (
            math.isclose(source_x, RESOLUTION, rel_tol=1e-9, abs_tol=1e-12)
            and math.isclose(source_y, RESOLUTION, rel_tol=1e-9, abs_tol=1e-12))
        # Publisher rounding can put the two nominal-30 axes on opposite
        # sides of 30 while each meets the existing normalization tolerance.
        # Recognize that established source case before the generic square test.
        if not nominal_30 and not math.isclose(source_x, source_y, rel_tol=1e-9, abs_tol=1e-12):
            raise ValueError("Select the original nominally square reference grid")
        if requested is not None and (
                not math.isclose(source_x, requested, rel_tol=1e-9, abs_tol=1e-12)
                or not math.isclose(source_y, requested, rel_tol=1e-9, abs_tol=1e-12)):
            raise ValueError("Requested resolution differs from the original reference grid")
        if nominal_30:
            # Preserve the established Upstate grid, its provenance and cache key.
            # Published coverage coefficients can round nominal 30 m spacing.
            anchor = Affine(RESOLUTION, 0, observed.c, 0, -RESOLUTION, observed.f)
            method = "Exact 30-metre cells anchored at the original reference upper-left corner"
        else:
            anchor = observed
            method = "Original reference cell sizes and upper-left corner preserved"
        pixel_x, pixel_y = anchor.a, -anchor.e
        left, bottom, right, top = model_geometry.bounds
        if (not all(math.isfinite(v) for v in (left, bottom, right, top))
                or left >= right or bottom >= top):
            raise ValueError("The selected model extent is empty or nonfinite")
        def edge(value):
            # A source footprint reconstructed through vector coordinates can
            # land a few floating-point units from its original integer edge.
            # Use an absolute cell tolerance; distant offsets get no extra slack.
            nearest = round(value)
            if not nominal_30 and math.isclose(value, nearest, rel_tol=0, abs_tol=1e-7):
                return nearest
            return value
        c0 = math.floor(edge((left - anchor.c) / pixel_x))
        c1 = math.ceil(edge((right - anchor.c) / pixel_x))
        r0 = math.floor(edge((anchor.f - top) / pixel_y))
        r1 = math.ceil(edge((anchor.f - bottom) / pixel_y))
        transform = anchor * Affine.translation(c0, r0)
        width, height = c1 - c0, r1 - r0
        corner_shifts = []
        for col, row in ((c0, r0), (c1, r0), (c0, r1), (c1, r1)):
            source_corner_x, source_corner_y = observed * (col, row)
            model_x, model_y = anchor * (col, row)
            corner_shifts.append(math.hypot(model_x - source_corner_x, model_y - source_corner_y))
        normalization = {
            "source_transform": list(observed)[:6],
            "source_width": ref.width, "source_height": ref.height,
            "source_pixel_size_m": [source_x, source_y],
            "model_anchor_transform": list(anchor)[:6],
            "changed": observed != anchor,
            "maximum_reference_corner_shift_m": max(corner_shifts),
            "model_window": {"col_off": c0, "row_off": r0, "width": width, "height": height},
            "method": method,
            "source_alignment": "Original source alignment policy; nearest-neighbor for land-cover codes",
        }
    if width <= 0 or height <= 0:
        raise ValueError("The selected model extent is empty")
    area = abs(transform.a * transform.e - transform.b * transform.d) / 10000.0
    if not math.isfinite(area) or area <= 0:
        raise ValueError("Reference grid must have a finite positive pixel area")
    return {"crs": crs.to_wkt(), "crs_name": crs.to_string(),
            "transform": list(transform)[:6], "width": width, "height": height,
            "resolution_m": pixel_x, "pixel_area_ha": area,
            "reference_alignment": normalization["method"],
            "reference_normalization": normalization,
            "bounds": [transform.c, transform.f + height * transform.e,
                       transform.c + width * transform.a, transform.f]}

def output_profile(grid, *, categorical=False):
    from rasterio.transform import Affine
    return {"driver": "GTiff", "height": grid["height"], "width": grid["width"],
            "count": 1, "crs": grid["crs"], "transform": Affine(*grid["transform"]),
            "dtype": "int32" if categorical else "float32",
            "nodata": -2147483648 if categorical else -3.4028234663852886e38,
            "tiled": True, "blockxsize": 256, "blockysize": 256,
            "compress": "deflate", "predictor": 2 if categorical else 3,
            "BIGTIFF": "IF_SAFER"}

@contextmanager
def _atomic_raster(destination):
    """Install a finished TIFF while keeping the previous destination intact."""
    import os
    import tempfile
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    pending = None
    try:
        with tempfile.NamedTemporaryFile(dir=destination.parent,
                prefix="." + destination.name + "-", suffix=".partial.tif", delete=False) as out:
            pending = Path(out.name)
        yield pending
        with pending.open("rb") as complete:
            os.fsync(complete.fileno())
        os.replace(pending, destination)
        pending = None
        descriptor = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


def _alignment_tile(cache, selection_id, window, profile):
    """Reuse only an atomically recorded, intact native tile."""
    import numpy as np
    name = "r" + str(int(window.row_off)) + "-c" + str(int(window.col_off))
    metadata_path = cache / (name + ".json")
    if not metadata_path.exists():
        return None
    try:
        metadata = read_json(metadata_path)
        coordinates = [int(window.col_off), int(window.row_off),
                       int(window.width), int(window.height)]
        if (metadata.get("schema") != "upstate.alignment-tile/v1"
                or metadata.get("selection_id") != selection_id
                or metadata.get("window") != coordinates):
            return None
        retained = verify_file(cache, metadata["array"])
        data = np.load(retained, allow_pickle=False)
        if (data.shape != (int(window.height), int(window.width))
                or data.dtype != np.dtype(profile["dtype"])):
            return None
        return data
    except (OSError, ValueError, KeyError, TypeError, EOFError):
        # A derived cache tile can always be rebuilt from the retained source.
        # Missing or interrupted metadata never marks an output complete.
        return None


def _retain_alignment_tile(cache, selection_id, window, values):
    import hashlib
    import io
    import numpy as np
    name = "r" + str(int(window.row_off)) + "-c" + str(int(window.col_off))
    payload = io.BytesIO()
    np.save(payload, values, allow_pickle=False)
    body = payload.getvalue()
    artifact = {"path": name + ".npy", "bytes": len(body),
                "sha256": hashlib.sha256(body).hexdigest()}
    atomic_bytes(cache / artifact["path"], body)
    atomic_json(cache / (name + ".json"), {
        "schema": "upstate.alignment-tile/v1", "selection_id": selection_id,
        "window": [int(window.col_off), int(window.row_off),
                   int(window.width), int(window.height)],
        "array": artifact,
    })


def align_source(source, destination, grid, *, categorical=False,
                 resampling=None, conversion=None, checkpoint_directory=None,
                 source_identity=None):
    """Align source windows and retain completed tiles for interrupted work.

    Workspace callers supply the complete retained body/companion identity.
    Standalone local callers can omit it; each GDAL-listed source file is then
    hashed before checkpoint reuse. The final TIFF is replaced only after all
    blocks and metadata have been written and closed.
    """
    import numpy as np
    import rasterio
    from contextlib import nullcontext
    from rasterio.enums import Resampling
    from rasterio.vrt import WarpedVRT
    profile = output_profile(grid, categorical=categorical)
    method = resampling or ("nearest" if categorical else "bilinear")
    if method not in {"nearest", "bilinear", "average", "mode"}:
        raise ValueError("Select nearest, bilinear, average or mode resampling")
    if categorical and method not in {"nearest", "mode"}:
        raise ValueError("Land-cover codes require nearest or mode resampling")
    factor = finite((conversion or {}).get("factor", 1), "conversion.factor", positive=True)
    if factor != 1 and not (conversion or {}).get("reference"):
        raise ValueError("Supply the reference for the physical-unit conversion")
    if categorical and factor != 1:
        raise ValueError("Land-cover class codes cannot use a physical-unit scale factor")
    counts, valid, missing, low, high = {}, 0, 0, None, None
    completed_tiles, reused_tiles = 0, 0
    selection_id, cache = None, None
    with rasterio.Env(GDAL_CACHEMAX=64 * 1024 * 1024), rasterio.open(source) as src:
        if src.count != 1:
            raise ValueError("Select a single-band scientific input")
        if checkpoint_directory is not None:
            if source_identity is None:
                bodies = []
                for name in dict.fromkeys([str(source), *src.files]):
                    original = Path(name).resolve(strict=True)
                    bodies.append({"path": str(original), "bytes": original.stat().st_size,
                                   "sha256": file_digest(original)})
                source_identity = {"files": bodies}
            selection = {
                "schema": "upstate.source-alignment/v1",
                "source": source_identity, "grid": grid,
                "categorical": bool(categorical), "resampling": method,
                "conversion": conversion, "conversion_factor": factor,
                "output_dtype": profile["dtype"], "output_nodata": profile["nodata"],
                "block_shape": [profile["blockysize"], profile["blockxsize"]],
                "warp_memory_mb": 64,
                "implementation": "window-alignment-v1",
                "runtime": {"rasterio": rasterio.__version__,
                            "gdal": rasterio.__gdal_version__,
                            "proj": getattr(rasterio, "__proj_version__", None)},
            }
            selection_id = digest(selection)
            cache = Path(checkpoint_directory) / selection_id
        lock = held(cache / ".alignment.lock", blocking=False) if cache else nullcontext()
        with lock:
            if cache:
                atomic_json(cache / "selection.json", selection, immutable=True)
            with WarpedVRT(src, crs=profile["crs"], transform=profile["transform"],
                           width=profile["width"], height=profile["height"],
                           nodata=profile["nodata"], dtype=profile["dtype"],
                           resampling=getattr(Resampling, method), warp_mem_limit=64) as vrt:
                with _atomic_raster(destination) as pending:
                    with rasterio.open(pending, "w", **profile) as out:
                        for _, window in out.block_windows(1):
                            values = _alignment_tile(cache, selection_id, window, profile) if cache else None
                            if values is not None:
                                reused_tiles += 1
                            else:
                                data = vrt.read(1, window=window, masked=True)
                                mask = np.ma.getmaskarray(data) | ~np.isfinite(np.ma.getdata(data))
                                values = np.ma.getdata(data).copy()
                                if factor != 1 and np.any(~mask):
                                    scaled = values[~mask].astype("float64") * factor
                                    limits = np.finfo(profile["dtype"])
                                    if (np.any(~np.isfinite(scaled))
                                            or np.any(scaled < limits.min) or np.any(scaled > limits.max)):
                                        raise ValueError("Input conversion exceeds the finite output value range")
                                    values[~mask] = scaled
                                if np.any(values[~mask] == profile["nodata"]):
                                    raise ValueError("Input conversion collides with the output nodata value")
                                values[mask] = profile["nodata"]
                                values = values.astype(profile["dtype"], copy=False)
                                if cache:
                                    _retain_alignment_tile(cache, selection_id, window, values)
                            usable = np.isfinite(values) & (values != profile["nodata"])
                            current = values[usable]
                            if categorical:
                                codes, amounts = np.unique(current, return_counts=True)
                                for code, amount in zip(codes, amounts):
                                    code = str(int(code))
                                    counts[code] = counts.get(code, 0) + int(amount)
                            if current.size:
                                current_low, current_high = float(current.min()), float(current.max())
                                low = current_low if low is None else min(low, current_low)
                                high = current_high if high is None else max(high, current_high)
                            valid += int(current.size)
                            missing += int(values.size - current.size)
                            out.write(values, 1, window=window)
                            completed_tiles += 1
                        out.update_tags(resampling=method, unit_conversion_factor=str(factor),
                                        source_filename=Path(source).name)
    return {"resampling": method, "conversion": conversion, "valid_cells": valid,
            "nodata_cells": missing, "minimum": low, "maximum": high,
            "class_counts": counts if categorical else None,
            "preparation": {"tile_count": completed_tiles, "reused_tiles": reused_tiles,
                            "checkpoint_id": selection_id,
                            "completion": "Atomically installed complete raster"}}

def write_mask(destination, grid, geometry):
    import rasterio
    from rasterio.features import rasterize
    from shapely.geometry import mapping
    profile = output_profile(grid, categorical=True)
    profile.update(dtype="uint8", nodata=255)
    shapes = [(mapping(geometry), 1)]
    with rasterio.open(destination, "w", **profile) as out:
        for _, window in out.block_windows(1):
            data = rasterize(shapes, out_shape=(int(window.height), int(window.width)),
                             transform=out.window_transform(window), fill=0, all_touched=False,
                             dtype="uint8")
            out.write(data, 1, window=window)
        out.update_tags(cell_selection="pixel centre within reporting polygon")

def make_scenario(baseline, destination, grid, patches, *, source_loader, allowed_codes):
    """Apply ordered native edits and count actual value changes."""
    from .scenario_footprint import make_scenario as apply_footprint
    return apply_footprint(baseline, destination, grid, patches,
                           source_loader=source_loader, allowed_codes=allowed_codes)

def check_same_grid(a, b):
    if a.crs != b.crs or a.width != b.width or a.height != b.height or not a.transform.almost_equals(b.transform, precision=1e-9):
        raise ValueError("Scientific rasters have different grids")

def rate_to_mass(source, destination, grid, *, reporting_mask, pollutant):
    """Place native aligned cells on the retained grid and convert annual rates."""
    import numpy as np
    import rasterio
    from rasterio.windows import Window
    profile = output_profile(grid)
    target_crs = rasterio.crs.CRS.from_user_input(profile["crs"])
    total, count = 0.0, 0
    with rasterio.open(source) as src, rasterio.open(reporting_mask) as mask:
        t = src.transform
        target = profile["transform"]
        if (not all(math.isfinite(value) for value in list(t)[:6] + list(target)[:6])
                or target.a <= 0 or target.e >= 0 or target.b or target.d
                or t.a <= 0 or t.e >= 0
                or not math.isclose(target.a, -target.e, rel_tol=1e-9, abs_tol=1e-12)):
            raise ValueError("Selected model grid must retain finite north-up square cells")
        if (not target_crs.is_projected
                or str(target_crs.linear_units).lower() not in ("metre", "meter", "metres", "meters")
                or src.crs != target_crs or src.crs != mask.crs
                or not math.isclose(t.a, target.a, rel_tol=0, abs_tol=1e-9)
                or not math.isclose(t.e, target.e, rel_tol=0, abs_tol=1e-9)
                or t.b or t.d):
            raise ValueError("Native model output is not the selected projected metre grid")
        if (mask.transform != target or mask.width != profile["width"]
                or mask.height != profile["height"]):
            raise ValueError("Reporting mask differs from the selected model grid")
        # Native watershed crops keep the reference lattice; offsets use the
        # actual native cell sizes and the retained original origin.
        dx, dy = (target.c - t.c) / t.a, (target.f - t.f) / t.e
        if (not math.isclose(dx, round(dx), rel_tol=0, abs_tol=1e-7)
                or not math.isclose(dy, round(dy), rel_tol=0, abs_tol=1e-7)):
            raise ValueError("Native model output has shifted pixel centres")
        if (abs((target.a - t.a) / t.a) * max(src.width, grid["width"]) > 1e-7
                or abs((target.e - t.e) / t.e) * max(src.height, grid["height"]) > 1e-7):
            raise ValueError("Native model output accumulates a pixel alignment shift across the retained extent")
        area = abs(t.a * t.e - t.b * t.d) / 10000.0
        if not math.isfinite(area) or area <= 0:
            raise ValueError("Native model output must have a finite positive pixel area")
        with rasterio.open(destination, "w", **profile) as out:
            for _, window in out.block_windows(1):
                native_window = Window(window.col_off + round(dx), window.row_off + round(dy),
                                       window.width, window.height)
                values = src.read(1, window=native_window, masked=True, boundless=True)
                selected = mask.read(1, window=window) == 1
                raw = np.ma.getdata(values).astype("float64")
                invalid = np.ma.getmaskarray(values) | ~np.isfinite(raw) | ~selected
                if np.any(raw[~invalid] < 0):
                    raise ValueError("Native annual export contains a negative value")
                result = raw * area
                result[invalid] = profile["nodata"]
                converted = result.astype("float32")
                if np.any(~np.isfinite(converted[~invalid])):
                    raise ValueError("Native annual export exceeds the retained raster value range")
                total += float(converted[~invalid].sum(dtype="float64"))
                count += int((~invalid).sum())
                out.write(converted, 1, window=window)
            out.update_tags(units=MASS_UNITS[pollutant], native_units=RATE_UNITS[pollutant],
                            conversion=f"native annual rate multiplied by pixel area {area:.17g} ha",
                            model_version="3.20.0", reporting_mask="pixel-centre selection",
                            nodata_policy="native and reporting mask retained")
    return {"units": MASS_UNITS[pollutant], "native_units": RATE_UNITS[pollutant],
            "pixel_area_ha": area, "valid_cells": count, "sum": total,
            "sum_units": MASS_UNITS[pollutant].replace("/pixel", "")}

def difference(baseline, alternative, destination):
    import numpy as np
    import rasterio
    with rasterio.open(baseline) as a, rasterio.open(alternative) as b:
        check_same_grid(a, b)
        total, count = 0.0, 0
        with rasterio.open(destination, "w", **a.profile) as out:
            for _, window in a.block_windows(1):
                av, bv = a.read(1, window=window, masked=True), b.read(1, window=window, masked=True)
                value = bv.astype("float64") - av.astype("float64")
                mask = np.ma.getmaskarray(value) | ~np.isfinite(np.ma.getdata(value))
                data = np.ma.getdata(value)
                data[mask] = a.nodata
                converted = data.astype(a.dtypes[0])
                if np.any(~np.isfinite(converted[~mask])):
                    raise ValueError("Scenario difference exceeds the retained raster value range")
                total += float(converted[~mask].sum(dtype="float64"))
                count += int((~mask).sum())
                out.write(converted, 1, window=window)
            out.update_tags(**a.tags(), difference_direction="alternative minus baseline")
    return {"sum_change": total, "valid_cells": count, "direction": "alternative minus baseline"}

def combined_priority(inputs, destination, *, weights, percentile=95, selected_caps=None):
    import numpy as np
    import rasterio
    from contextlib import ExitStack
    if set(weights) != set(inputs) or any(finite(x, "priority weight", minimum=0) < 0 for x in weights.values()):
        raise ValueError("Supply nonnegative weights for the three named pollutants")
    weight_sum = sum(float(v) for v in weights.values())
    percentile = finite(percentile, "Priority percentile", positive=True)
    if not math.isfinite(weight_sum) or weight_sum <= 0 or percentile > 100:
        raise ValueError("Priority weights and percentile must be finite and positive")
    caps = {}
    if selected_caps is not None and set(selected_caps) != set(inputs):
        raise ValueError("Explicit priority caps must cover the three named pollutants")
    with ExitStack() as stack:
        rasters = {key: stack.enter_context(rasterio.open(path)) for key, path in inputs.items()}
        first = next(iter(rasters.values()))
        for key, raster in rasters.items():
            check_same_grid(first, raster)
            if selected_caps is None:
                from .raster_stats import raster_percentile
                value = raster_percentile(raster, percentile, positive_only=True)
                caps[key] = value if value is not None else 0.0
            else:
                caps[key] = finite(selected_caps[key], "Priority cap", minimum=0)
        profile = dict(first.profile)
        with rasterio.open(destination, "w", **profile) as out:
            for _, window in first.block_windows(1):
                score = np.zeros((int(window.height), int(window.width)), dtype="float64")
                invalid = np.zeros(score.shape, dtype=bool)
                for key, raster in rasters.items():
                    if float(weights[key]) == 0:
                        continue
                    data = raster.read(1, window=window, masked=True)
                    raw = np.asarray(np.ma.getdata(data), dtype="float64")
                    valid = ~np.ma.getmaskarray(data) & np.isfinite(raw)
                    invalid |= ~valid
                    if np.any(raw[valid] < 0):
                        raise ValueError("Annual physical export contains a negative value: " + key)
                    if caps[key] == 0 and np.any(raw[valid] > 0):
                        raise ValueError("Positive export requires a positive priority cap: " + key)
                    if caps[key] > 0:
                        score += float(weights[key]) * np.clip(np.where(valid, raw, 0) / caps[key], 0, 1)
                score /= weight_sum
                score[invalid] = first.nodata
                out.write(score.astype(profile["dtype"]), 1, window=window)
            out.update_tags(units="dimensionless", method="weighted clipped baseline positive-cell percentile normalization")
    return {"method": "sum(weight * clip(export / positive-cell percentile, 0, 1)) / sum(weights)",
            "percentile": float(percentile) if selected_caps is None else None, "caps": caps, "weights": weights,
            "zero_cap_policy": "A zero cap requires zero valid export for a positively weighted pollutant",
            "units": "dimensionless", "interpretation": "relative export priority within the retained reporting mask"}
