"""Native grid, explicit scenario edits and output-unit derivations."""
from __future__ import annotations
import math
from pathlib import Path
import shutil
from .common import atomic_json, describe_file, digest, finite

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

def grid_definition(reference, model_geometry, *, resolution=RESOLUTION):
    import rasterio
    from pyproj import CRS
    from rasterio.transform import Affine
    resolution = finite(resolution, "model grid resolution", positive=True)
    if resolution != RESOLUTION:
        raise ValueError("The scientific model requires an exact 30-metre grid")
    with rasterio.open(reference) as ref:
        crs = CRS.from_user_input(ref.crs)
        if not crs.is_projected or any(abs(axis.unit_conversion_factor - 1) > 1e-12 for axis in crs.axis_info[:2]):
            raise ValueError("Select a projected reference grid in metres")
        observed = ref.transform
        if (not all(math.isfinite(value) for value in list(observed)[:6])
                or abs(observed.b) > 1e-12 or abs(observed.d) > 1e-12
                or observed.a <= 0 or observed.e >= 0):
            raise ValueError("Reference grid must be finite, north-up and unrotated")
        if (not math.isclose(observed.a, resolution, rel_tol=1e-9, abs_tol=1e-12)
                or not math.isclose(-observed.e, resolution, rel_tol=1e-9, abs_tol=1e-12)):
            raise ValueError("Select the original nominal 30-metre reference land-cover grid")
        # Native coverage descriptions can round their nominal 30 m coefficients.
        # Keep their upper-left corner, then declare one exact model grid before
        # the original source aligner resamples into it. Source bytes stay intact.
        anchor = Affine(resolution, 0, observed.c, 0, -resolution, observed.f)
        left, bottom, right, top = model_geometry.bounds
        c0 = math.floor((left - anchor.c) / resolution)
        c1 = math.ceil((right - anchor.c) / resolution)
        r0 = math.floor((anchor.f - top) / resolution)
        r1 = math.ceil((anchor.f - bottom) / resolution)
        transform = anchor * Affine.translation(c0, r0)
        width, height = c1 - c0, r1 - r0
        corner_shifts = []
        for col, row in ((c0, r0), (c1, r0), (c0, r1), (c1, r1)):
            source_x, source_y = observed * (col, row)
            model_x, model_y = anchor * (col, row)
            corner_shifts.append(math.hypot(model_x - source_x, model_y - source_y))
        normalization = {
            "source_transform": list(observed)[:6],
            "source_width": ref.width, "source_height": ref.height,
            "source_pixel_size_m": [observed.a, -observed.e],
            "model_anchor_transform": list(anchor)[:6],
            "changed": observed != anchor,
            "maximum_reference_corner_shift_m": max(corner_shifts),
            "model_window": {"col_off": c0, "row_off": r0, "width": width, "height": height},
            "method": "Exact 30-metre cells anchored at the original reference upper-left corner",
            "source_alignment": "Original source alignment policy; nearest-neighbor for land-cover codes",
        }
    if width <= 0 or height <= 0:
        raise ValueError("The selected model extent is empty")
    return {"crs": crs.to_wkt(), "crs_name": crs.to_string(),
            "transform": list(transform)[:6], "width": width, "height": height,
            "resolution_m": resolution, "pixel_area_ha": resolution * resolution / 10000,
            "reference_alignment": normalization["method"],
            "reference_normalization": normalization,
            "bounds": [transform.c, transform.f - height * resolution,
                       transform.c + width * resolution, transform.f]}

def output_profile(grid, *, categorical=False):
    from rasterio.transform import Affine
    return {"driver": "GTiff", "height": grid["height"], "width": grid["width"],
            "count": 1, "crs": grid["crs"], "transform": Affine(*grid["transform"]),
            "dtype": "int32" if categorical else "float32",
            "nodata": -2147483648 if categorical else -3.4028234663852886e38,
            "tiled": True, "blockxsize": 256, "blockysize": 256,
            "compress": "deflate", "predictor": 2 if categorical else 3,
            "BIGTIFF": "IF_SAFER"}

def align_source(source, destination, grid, *, categorical=False,
                 resampling=None, conversion=None):
    import numpy as np
    import rasterio
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
    counts, valid, missing, low, high = {}, 0, 0, None, None
    with rasterio.Env(GDAL_CACHEMAX=64 * 1024 * 1024), rasterio.open(source) as src:
        if src.count != 1:
            raise ValueError("Select a single-band scientific input")
        with WarpedVRT(src, crs=profile["crs"], transform=profile["transform"],
                       width=profile["width"], height=profile["height"],
                       nodata=profile["nodata"], dtype=profile["dtype"],
                       resampling=getattr(Resampling, method), warp_mem_limit=64) as vrt:
            with rasterio.open(destination, "w", **profile) as out:
                for _, window in out.block_windows(1):
                    data = vrt.read(1, window=window, masked=True)
                    mask = np.ma.getmaskarray(data) | ~np.isfinite(np.ma.getdata(data))
                    values = np.ma.getdata(data).copy()
                    if factor != 1:
                        values[~mask] *= factor
                    if np.any(~np.isfinite(values[~mask])):
                        raise ValueError("Input conversion produced a non-finite value")
                    if categorical:
                        codes, amounts = np.unique(values[~mask], return_counts=True)
                        for code, amount in zip(codes, amounts):
                            counts[str(int(code))] = counts.get(str(int(code)), 0) + int(amount)
                    if np.any(~mask):
                        current = values[~mask]
                        low = float(current.min()) if low is None else min(low, float(current.min()))
                        high = float(current.max()) if high is None else max(high, float(current.max()))
                    valid += int((~mask).sum())
                    missing += int(mask.sum())
                    values[mask] = profile["nodata"]
                    out.write(values.astype(profile["dtype"]), 1, window=window)
                out.update_tags(resampling=method, unit_conversion_factor=str(factor),
                                source_filename=Path(source).name)
    return {"resampling": method, "conversion": conversion, "valid_cells": valid,
            "nodata_cells": missing, "minimum": low, "maximum": high,
            "class_counts": counts if categorical else None}

def write_mask(destination, grid, geometry):
    import rasterio
    from rasterio.features import rasterize
    from shapely.geometry import mapping
    profile = output_profile(grid, categorical=True)
    profile.update(dtype="uint8", nodata=255)
    with rasterio.open(destination, "w", **profile) as out:
        for _, window in out.block_windows(1):
            data = rasterize([(mapping(geometry), 1)], out_shape=(int(window.height), int(window.width)),
                             transform=out.window_transform(window), fill=0, all_touched=False,
                             dtype="uint8")
            out.write(data, 1, window=window)
        out.update_tags(cell_selection="pixel centre within reporting polygon")

def make_scenario(baseline, destination, grid, patches, *, source_loader, allowed_codes):
    import numpy as np
    import rasterio
    from rasterio.features import rasterize
    from shapely.geometry import mapping
    prepared = []
    for patch in patches:
        if patch["to_code"] not in allowed_codes:
            raise ValueError("Scenario destination code lacks a biophysical table row")
        source, entry = source_loader(patch["mask_source_id"])
        rows, _ = vector_geometry(source, layer=patch.get("layer") or entry.get("layer"),
                                  where=patch.get("where"), target_crs=grid["crs"])
        geometry = polygon_union(rows)
        prepared.append((patch, geometry, 0))
    counts = [0] * len(prepared)
    profile = output_profile(grid, categorical=True)
    with rasterio.open(baseline) as src, rasterio.open(destination, "w", **profile) as out:
        for _, window in out.block_windows(1):
            data = src.read(1, window=window, masked=True)
            invalid = np.ma.getmaskarray(data)
            values = np.ma.getdata(data).copy()
            for i, (patch, geometry, _) in enumerate(prepared):
                mask = rasterize([(mapping(geometry), 1)], out_shape=values.shape,
                                 transform=src.window_transform(window), fill=0, dtype="uint8").astype(bool)
                selected = mask & ~invalid & np.isin(values, patch["from_codes"])
                counts[i] += int(selected.sum())
                values[selected] = patch["to_code"]
            values[invalid] = profile["nodata"]
            out.write(values.astype("int32"), 1, window=window)
        out.update_tags(scenario_edit_order="declared patch order", nodata_policy="original nodata retained")
    return [{"index": i, "changed_cells": count, "changed_hectares": count * grid["pixel_area_ha"],
             "patch": prepared[i][0]} for i, count in enumerate(counts)]

def check_same_grid(a, b):
    if a.crs != b.crs or a.width != b.width or a.height != b.height or not a.transform.almost_equals(b.transform, precision=1e-9):
        raise ValueError("Scientific rasters have different grids")

def rate_to_mass(source, destination, grid, *, reporting_mask, pollutant):
    """Place native aligned cells on the retained grid and convert annual rates."""
    import numpy as np
    import rasterio
    from rasterio.windows import Window
    profile = output_profile(grid)
    total, count = 0.0, 0
    with rasterio.open(source) as src, rasterio.open(reporting_mask) as mask:
        t = src.transform
        target = profile["transform"]
        if src.crs != mask.crs or abs(t.a - 30) > 1e-9 or abs(t.e + 30) > 1e-9 or t.b or t.d:
            raise ValueError("Native model output is not the selected 30m projected grid")
        dx, dy = (target.c - t.c) / 30, (t.f - target.f) / 30
        if not math.isclose(dx, round(dx), abs_tol=1e-7) or not math.isclose(dy, round(dy), abs_tol=1e-7):
            raise ValueError("Native model output has shifted pixel centres")
        area = abs(t.a * t.e - t.b * t.d) / 10000.0
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
    if weight_sum <= 0 or not 0 < float(percentile) <= 100:
        raise ValueError("Priority weights and percentile must be positive")
    caps = {}
    if selected_caps is not None and set(selected_caps) != set(inputs):
        raise ValueError("Explicit priority caps must cover the three named pollutants")
    with ExitStack() as stack:
        rasters = {key: stack.enter_context(rasterio.open(path)) for key, path in inputs.items()}
        first = next(iter(rasters.values()))
        for key, raster in rasters.items():
            check_same_grid(first, raster)
            if selected_caps is None:
                values = raster.read(1, masked=True).compressed()
                values = values[np.isfinite(values) & (values > 0)]
                caps[key] = float(np.percentile(values, percentile)) if values.size else 0.0
                del values
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
                    invalid |= np.ma.getmaskarray(data) | ~np.isfinite(np.ma.getdata(data))
                    if caps[key] > 0:
                        score += float(weights[key]) * np.clip(np.ma.filled(data, 0) / caps[key], 0, 1)
                score /= weight_sum
                score[invalid] = first.nodata
                out.write(score.astype(profile["dtype"]), 1, window=window)
            out.update_tags(units="dimensionless", method="weighted clipped baseline positive-cell percentile normalization")
    return {"method": "sum(weight * clip(export / positive-cell percentile, 0, 1)) / sum(weights)",
            "percentile": float(percentile) if selected_caps is None else None, "caps": caps, "weights": weights,
            "units": "dimensionless", "interpretation": "relative export priority within the retained reporting mask"}
