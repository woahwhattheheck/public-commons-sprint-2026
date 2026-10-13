"""Disk-backed native mosaics and restartable 30 m terrain preparation.

Original tiles are mosaicked in their shared native lattice before a single
horizontal reprojection. No depression filling, hydrologic conditioning, vertical
datum transformation, invented elevations or polygon-edge zero fill is applied.
"""
from __future__ import annotations

import gzip
import math
import os
from pathlib import Path
import shutil
from typing import Any, Callable

from .terrain_catalog import inspect_raster, sources
from .terrain_io import (TerrainError, atomic_json, copy_original, describe, file_sha,
                         identity, locked, now, read_json, relative_path,
                         sync_directory, verify)

NODATA = -3.4028234663852886e38


def validate_grid(value: dict[str, Any]) -> dict[str, Any]:
    from pyproj import CRS
    from affine import Affine
    if not isinstance(value, dict):
        raise TerrainError("Select the original 30 m grid definition")
    crs = CRS.from_user_input(value["crs"])
    transform = list(value["transform"])
    width, height = value["width"], value["height"]
    if (len(transform) != 6 or not all(math.isfinite(float(x)) for x in transform)
            or isinstance(width, bool) or isinstance(height, bool)
            or int(width) != width or int(height) != height or width <= 0 or height <= 0):
        raise TerrainError("Invalid finite terrain grid dimensions or transform")
    if (not crs.is_projected or len(crs.axis_info) < 2
            or any(abs(float(axis.unit_conversion_factor)-1) > 1e-12 for axis in crs.axis_info[:2])):
        raise TerrainError("The target terrain grid must be projected in metres")
    a, b, c, d, e, f = map(float, transform)
    if b != 0 or d != 0 or abs(a-30) > 1e-9 or abs(e+30) > 1e-9:
        raise TerrainError("The model terrain grid must use unrotated, square, exact 30 m cells")
    from rasterio.transform import array_bounds
    transform = Affine(30, 0, c, 0, -30, f)
    return {"crs": crs.to_wkt(), "crs_name": crs.to_string(),
            "transform": list(transform)[:6], "width": int(width), "height": int(height),
            "resolution_m": 30.0, "pixel_area_ha": 0.09,
            "bounds": list(array_bounds(int(height), int(width), transform))}


def reference_grid(path: Path | str) -> dict[str, Any]:
    import rasterio
    with rasterio.open(path) as source:
        grid = {"crs": source.crs.to_wkt() if source.crs else None,
                "transform": list(source.transform)[:6],
                "width": source.width, "height": source.height}
    return validate_grid(grid)


def read_geometry(path: Path | str, target_crs, *, layer=None, where=None):
    """Read all selected original polygons, without simplification or silent repair."""
    import fiona
    from pyproj import CRS, Transformer
    from shapely.geometry import shape, mapping
    from shapely.ops import transform, unary_union
    path = Path(path).resolve(strict=True)
    with path.open("rb") as original:
        compressed = original.read(2) == b"\x1f\x8b"
    native_path = "/vsigzip/"+path.as_posix() if compressed else str(path)
    parameters = {}
    fiona_root = Path(fiona.__file__).parent
    for key, folder in (("GDAL_DATA", "gdal_data"), ("PROJ_DATA", "proj_data"), ("PROJ_LIB", "proj_data")):
        if (fiona_root / folder).is_dir():
            parameters[key] = str(fiona_root / folder)
    geometries = []
    with fiona.Env(**parameters), fiona.open(native_path, layer=layer) as source:
        origin = CRS.from_user_input(source.crs_wkt or source.crs)
        transformer = Transformer.from_crs(origin, target_crs, always_xy=True)
        for feature in source:
            if where and any(str(feature["properties"].get(key)) != str(value) for key, value in where.items()):
                continue
            if feature["geometry"] is None:
                raise TerrainError("Selected model-domain feature has no geometry")
            polygon = shape(feature["geometry"])
            if polygon.geom_type not in ("Polygon", "MultiPolygon") or polygon.is_empty or not polygon.is_valid:
                raise TerrainError("Selected model-domain geometry is not a valid original polygon")
            projected = transform(transformer.transform, polygon)
            if projected.is_empty or not projected.is_valid or not all(math.isfinite(x) for x in projected.bounds):
                raise TerrainError("Model-domain transformation produced invalid coordinates")
            geometries.append(projected)
    if not geometries:
        raise TerrainError("The model-domain selection contains no polygons")
    combined = unary_union(geometries)
    if not combined.is_valid:
        raise TerrainError("The original selected-domain union is invalid")
    return combined, {"features": len(geometries), "original_crs": origin.to_wkt(),
                      "target_crs": CRS.from_user_input(target_crs).to_wkt(),
                      "area_ha": float(combined.area/10000), "geometry": mapping(combined)}


def plan(root: Path | str, grid: dict[str, Any], *, source_ids: list[str] | None = None,
         title: str = "Upper Savannah retained terrain", domain_path: Path | str | None = None,
         domain_layer: str | None = None, domain_where: dict[str, Any] | None = None,
         reference_path: Path | str | None = None, source_reference: dict[str, Any] | None = None,
         resampling: str = "bilinear", chunk_size: int = 1024) -> dict[str, Any]:
    root = Path(root).resolve()
    checked = validate_grid(grid)
    selected = sources(root, source_ids)
    if not selected:
        raise TerrainError("Retain at least one complete numeric DEM source first")
    if resampling not in ("bilinear", "nearest", "average"):
        raise TerrainError("Choose bilinear, nearest or average elevation resampling")
    if not isinstance(chunk_size, int) or not 64 <= chunk_size <= 4096:
        raise TerrainError("Choose a processing chunk width between 64 and 4096 cells")
    domain = None
    selection_files = []
    if domain_path:
        domain_path = Path(domain_path).resolve(strict=True)
        geometry, metadata = read_geometry(domain_path, checked["crs"], layer=domain_layer, where=domain_where)
        from shapely.geometry import box
        if not geometry.intersects(box(*checked["bounds"])):
            raise TerrainError("The selected model domain does not intersect this grid")
        folder = root / "selections" / file_sha(domain_path)
        copy_original(domain_path, folder / domain_path.name)
        original_files = [describe(root, folder / domain_path.name)]
        if domain_path.suffix.lower() == ".shp":
            for extension in (".shx", ".dbf", ".prj", ".cpg"):
                companion = domain_path.with_suffix(extension)
                if companion.exists():
                    copy_original(companion, folder / companion.name)
                    original_files.append(describe(root, folder / companion.name))
        outside = geometry.difference(box(*checked["bounds"]))
        domain = {**metadata, "layer": domain_layer, "where": domain_where, "files": original_files,
                  "outside_grid_area_ha": float(outside.area/10000),
                  "inside_grid_area_ha": float(geometry.intersection(box(*checked["bounds"])).area/10000),
                  "contained_by_grid": outside.is_empty or outside.area < 1e-7,
                  "coverage_rule": "Unique selected-domain pixel centres, without clipping the computational DEM"}
        selection_files += original_files
    if reference_path:
        reference_path = Path(reference_path).resolve(strict=True)
        # Preserve source identity without duplicating a multi-gigabyte NLCD raster.
        # The exact independent grid definition is sufficient for terrain replay.
        reference = {"sha256": file_sha(reference_path), "bytes": reference_path.stat().st_size,
                     "filename": reference_path.name, "grid_definition": checked}
    else:
        reference = {"grid_definition": checked}
    value = {"schema": "upstate.terrain-plan/v1", "title": title,
             "source_ids": [source["id"] for source in selected],
             "source_records": [describe(root, root/"sources"/(source["id"]+".json")) for source in selected],
             "grid": checked, "reference": reference, "source_reference": source_reference,
             "domain": domain, "selection_files": selection_files,
             "resampling": resampling, "chunk_size": chunk_size,
             "native_overlap": "First valid original sample in declared source order; no blending",
             "vertical_operation": "Original scale and offset, then declared unit conversion to metres; no datum shift",
             "hydrologic_conditioning": "None; the original InVEST engine retains its preprocessing",
             "output_dtype": "float32", "output_nodata": NODATA}
    key = identity(value)
    atomic_json(root/"plans"/(key+".json"), value, immutable=True)
    return {**value, "id": key}


def profile(grid: dict[str, Any], **changes) -> dict[str, Any]:
    from affine import Affine
    return {"driver": "GTiff", "width": grid["width"], "height": grid["height"],
            "count": 1, "dtype": "float32", "crs": grid["crs"],
            "transform": Affine(*grid["transform"]), "nodata": NODATA,
            "tiled": True, "blockxsize": 256, "blockysize": 256,
            "compress": "deflate", "predictor": 3, "BIGTIFF": "IF_SAFER", **changes}


def _publish_raster(pending: Path, path: Path) -> None:
    with pending.open("rb") as stream:
        os.fsync(stream.fileno())
    os.replace(pending, path)
    sync_directory(path.parent)


def native_mosaic(root: Path, selected: list[dict[str, Any]]) -> dict[str, Any]:
    import numpy as np
    import rasterio
    from affine import Affine
    from rasterio.merge import merge
    from rasterio.crs import CRS
    from .terrain_catalog import datum_key
    datums = {datum_key(source["vertical_datum"]) for source in selected}
    if len(datums) != 1:
        raise TerrainError("One native terrain mosaic must use a common declared vertical datum")
    selection = {"schema": "upstate.terrain-native-mosaic/v1", "sources": [x["id"] for x in selected],
                 "overlap": "first valid", "dtype": "float32", "units": "m", "nodata": NODATA}
    key = identity(selection)
    folder = root / "mosaics" / key
    record_path = folder / "mosaic.json"
    with locked(folder/"mosaic.lock"):
        if record_path.exists():
            record = read_json(record_path)
            if record["selection"] != selection:
                raise TerrainError("Retained native mosaic belongs to different sources")
            verify(root, record["file"])
            return record
        paths = []
        native = None
        for source in selected:
            original = verify(root, source["files"][0])
            with rasterio.open(original) as dataset:
                actual = (dataset.crs, dataset.transform.a, dataset.transform.e,
                          dataset.transform.c, dataset.transform.f)
                if native is None:
                    native = actual
                else:
                    same_crs = dataset.crs == native[0]
                    same_res = (math.isclose(actual[1], native[1], rel_tol=1e-10, abs_tol=1e-12)
                                and math.isclose(actual[2], native[2], rel_tol=1e-10, abs_tol=1e-12))
                    same_lattice = (abs((actual[3]-native[3])/native[1]-round((actual[3]-native[3])/native[1])) < 1e-5
                                    and abs((actual[4]-native[4])/native[2]-round((actual[4]-native[4])/native[2])) < 1e-5)
                    if not (same_crs and same_res and same_lattice):
                        raise TerrainError("Selected DEMs do not share one native CRS/resolution/lattice; select a homogeneous edition")
                factor, scale, offset = source["vertical_factor_to_m"], dataset.scales[0], dataset.offsets[0]
                # Normalize masks as well as numeric units, so unlabelled NaN samples
                # do not defeat first-valid overlap selection. Originals remain unchanged.
                needs_normalization = True
                if needs_normalization:
                    normalized = folder / (source["id"]+"-metres.tif")
                    pending = normalized.with_suffix(".tif.partial")
                    kwargs = dataset.profile.copy()
                    kwargs.update(driver="GTiff", dtype="float32", nodata=NODATA, count=1,
                                  tiled=True, blockxsize=256, blockysize=256,
                                  compress="deflate", predictor=3, BIGTIFF="IF_SAFER")
                    with rasterio.open(pending, "w", **kwargs) as out:
                        for _, window in dataset.block_windows(1):
                            data = dataset.read(1, window=window, masked=True)
                            raw = np.ma.getdata(data)
                            bad = np.ma.getmaskarray(data) | ~np.isfinite(raw)
                            converted = (raw.astype("float64")*scale+offset)*factor
                            if not np.isfinite(converted[~bad]).all() or np.any(np.abs(converted[~bad]) >= abs(NODATA)):
                                raise TerrainError("Source elevation normalization overflowed Float32")
                            converted[bad] = NODATA
                            out.write(converted.astype("float32"), 1, window=window)
                        out.update_tags(units="m", vertical_datum=source["vertical_datum"],
                                        source_id=source["id"], conversion="(raw*scale+offset)*unit_factor")
                        out.set_band_unit(1, "m")
                    _publish_raster(pending, normalized)
                    paths.append(normalized)
                else:
                    paths.append(original)
        destination = folder / "mosaic.tif"
        pending = folder / "mosaic.tif.partial"
        with rasterio.Env(GDAL_CACHEMAX=64*1024*1024):
            merge(paths, dst_path=pending, dtype="float32", nodata=np.float32(NODATA),
                  res=(native[1], -native[2]), method="first", mem_limit=64,
                  dst_kwds={"tiled": True, "blockxsize": 256, "blockysize": 256,
                            "compress": "deflate", "predictor": 3, "BIGTIFF": "IF_SAFER"})
        with rasterio.open(pending, "r+") as out:
            out.update_tags(units="m", vertical_datum=selected[0]["vertical_datum"],
                            source_order=",".join(source["id"] for source in selected),
                            overlap_resolution="first valid original sample", hydrologic_conditioning="none")
            out.set_band_unit(1, "m")
        _publish_raster(pending, destination)
        record = {"selection": selection, "id": key, "file": describe(root, destination),
                  "native_grid": inspect_raster(destination, scan=False),
                  "vertical_datum": selected[0]["vertical_datum"]}
        atomic_json(record_path, record, immutable=True)
        return record


def _statistics(data, bad, domain):
    import numpy as np
    def measure(mask):
        values = data[mask & ~bad].astype("float64")
        return {"cells": int(mask.sum()), "valid": int(values.size),
                "missing": int(np.count_nonzero(mask & bad)),
                "sum": float(values.sum(dtype="float64")),
                "sum_squares": float(np.square(values).sum(dtype="float64")),
                "minimum_m": float(values.min()) if values.size else None,
                "maximum_m": float(values.max()) if values.size else None}
    return {"grid": measure(np.ones(data.shape, dtype="bool")), "domain": measure(domain)}


def _combine_statistics(records):
    output = {}
    for kind in ("grid", "domain"):
        values = [record["statistics"][kind] for record in records]
        count = sum(x["valid"] for x in values)
        total_cells = sum(x["cells"] for x in values)
        total = sum(x["sum"] for x in values)
        squares = sum(x["sum_squares"] for x in values)
        lows = [x["minimum_m"] for x in values if x["minimum_m"] is not None]
        highs = [x["maximum_m"] for x in values if x["maximum_m"] is not None]
        output[kind] = {"cells": total_cells, "valid_cells": count,
                        "nodata_cells": sum(x["missing"] for x in values),
                        "valid_fraction": count/total_cells if total_cells else None,
                        "pixel_area_ha": 0.09, "valid_area_ha": count*0.09,
                        "minimum_m": min(lows) if lows else None, "maximum_m": max(highs) if highs else None,
                        "mean_m": total/count if count else None,
                        "standard_deviation_m": math.sqrt(max(0, squares/count-(total/count)**2)) if count else None}
    return output


def _plan(root: Path, key: str):
    if not isinstance(key, str) or len(key) != 64 or any(c not in "0123456789abcdef" for c in key):
        raise TerrainError("Select an existing retained terrain plan ID")
    value = read_json(root/"plans"/(key+".json"))
    if identity(value) != key or value.get("schema") != "upstate.terrain-plan/v1":
        raise TerrainError("Retained terrain plan changed")
    for record in value["source_records"] + value["selection_files"]:
        verify(root, record)
    return value


def prepare(root: Path | str, plan_id: str, *, progress: Callable[[dict], None] | None = None,
            stop_after_chunks: int | None = None) -> dict[str, Any]:
    import numpy as np
    import rasterio
    from affine import Affine
    from rasterio.enums import Resampling
    from rasterio.features import geometry_mask
    from rasterio.vrt import WarpedVRT
    from rasterio.windows import Window
    root = Path(root).resolve()
    selection = _plan(root, plan_id)
    selected = sources(root, selection["source_ids"])
    grid = selection["grid"]
    folder = root / "prepared" / plan_id
    job = root / "jobs" / ("prepare-"+plan_id+".json")
    pause = root / "jobs" / ("prepare-"+plan_id+".pause.json")
    entry_path = root / ("source-entry-"+plan_id+".json")
    source_manifest = root / ("sources-"+plan_id+".json")
    with locked(folder/"prepare.lock"):
        if entry_path.exists():
            entry = read_json(entry_path)
            if entry["preparation_sha256"] != plan_id:
                raise TerrainError("Prepared terrain belongs to another plan")
            for member in [entry]+entry["companions"]:
                verify(root, member)
            # A receiver may have died between entry creation and manifest creation.
            _source_manifest(root, selection, entry, entry_path, source_manifest)
            return {"state": "complete", "plan_id": plan_id, "entry": entry,
                    "manifest": source_manifest.relative_to(root).as_posix(), "reused": True}
        state = {"schema": "upstate.terrain-preparation/v1", "plan_id": plan_id,
                 "state": "preparing_native_mosaic", "updated_at": now(), "completed_chunks": 0}
        atomic_json(job, state)
        try:
            native = native_mosaic(root, selected)
            source = verify(root, native["file"])
            state.update(state="reprojecting", native_mosaic=native["id"], updated_at=now())
            atomic_json(job, state)
            chunks = []
            chunk_size = selection["chunk_size"]
            windows = [Window(col, row, min(chunk_size, grid["width"]-col), min(chunk_size, grid["height"]-row))
                       for row in range(0, grid["height"], chunk_size)
                       for col in range(0, grid["width"], chunk_size)]
            state["total_chunks"] = len(windows)
            transform = Affine(*grid["transform"])
            domain_geometry = selection["domain"]["geometry"] if selection["domain"] else None
            state["coverage_selection"] = "selected polygon centres" if domain_geometry else "whole target grid"
            completed_now = 0
            with rasterio.Env(GDAL_CACHEMAX=64*1024*1024), rasterio.open(source) as original, WarpedVRT(
                    original, crs=grid["crs"], transform=transform, width=grid["width"], height=grid["height"],
                    src_nodata=NODATA, nodata=NODATA, dtype="float32", warp_mem_limit=64,
                    resampling=getattr(Resampling, selection["resampling"])) as vrt:
                for window in windows:
                    if pause.exists():
                        state.update(state="paused", updated_at=now())
                        atomic_json(job, state)
                        return state
                    name = f"r{int(window.row_off):07d}-c{int(window.col_off):07d}"
                    path = folder / "chunks" / (name+".tif")
                    record_path = folder / "chunks" / (name+".json")
                    if record_path.exists():
                        record = read_json(record_path)
                        if record["plan_id"] != plan_id or record["window"] != list(window.flatten()):
                            raise TerrainError("Retained preparation chunk belongs to another selection")
                        verify(root, record["file"])
                    else:
                        data = vrt.read(1, window=window, masked=True)
                        values = np.ma.getdata(data).copy()
                        bad = np.ma.getmaskarray(data) | ~np.isfinite(values) | (values == NODATA)
                        values[bad] = NODATA
                        subset_transform = transform * Affine.translation(window.col_off, window.row_off)
                        domain = (geometry_mask([domain_geometry], out_shape=values.shape,
                                                transform=subset_transform, invert=True, all_touched=False)
                                  if domain_geometry else np.ones(values.shape, dtype="bool"))
                        record = {"plan_id": plan_id, "window": list(window.flatten()),
                                  "statistics": _statistics(values, bad, domain)}
                        path.parent.mkdir(parents=True, exist_ok=True)
                        pending = path.with_suffix(".tif.partial")
                        with rasterio.open(pending, "w", **profile(grid, width=int(window.width), height=int(window.height),
                                                                  transform=subset_transform)) as out:
                            out.write(values.astype("float32"), 1)
                        _publish_raster(pending, path)
                        record["file"] = describe(root, path)
                        atomic_json(record_path, record, immutable=True)
                        completed_now += 1
                    chunks.append(record)
                    state.update(completed_chunks=len(chunks), updated_at=now())
                    atomic_json(job, state)
                    if progress:
                        progress(dict(state))
                    if stop_after_chunks is not None and completed_now >= stop_after_chunks:
                        raise InterruptedError("Requested interruption after completed terrain chunks")
            state.update(state="assembling", updated_at=now())
            atomic_json(job, state)
            destination = folder / "dem.tif"
            pending = folder / "dem.tif.partial"
            with rasterio.open(pending, "w", **profile(grid)) as out:
                for record in chunks:
                    window = Window(*record["window"])
                    with rasterio.open(verify(root, record["file"])) as chunk:
                        out.write(chunk.read(1), 1, window=window)
                out.update_tags(units="m", vertical_datum=native["vertical_datum"],
                                plan_sha256=plan_id, horizontal_resampling=selection["resampling"],
                                source="USGS 3DEP retained static elevation",
                                hydrologic_conditioning="none", vertical_datum_transformation="none")
                out.set_band_unit(1, "m")
            _publish_raster(pending, destination)
            stats = _combine_statistics(chunks)
            coverage = {"schema": "upstate.terrain-coverage/v1", "plan_id": plan_id,
                        "grid": grid, "statistics": stats,
                        "selected_domain": selection["domain"] is not None,
                        "domain_within_grid": selection["domain"]["contained_by_grid"] if selection["domain"] else True,
                        "outside_grid_area_ha": selection["domain"]["outside_grid_area_ha"] if selection["domain"] else 0.0,
                        "domain_complete": (stats["domain"]["nodata_cells"] == 0 and stats["domain"]["cells"] > 0
                                            and (not selection["domain"] or selection["domain"]["contained_by_grid"])),
                        "method": "All target cells inspected; polygon coverage uses unique pixel centres",
                        "domain_area_rule": "Pixel-centre coverage is distinct from exact vector area",
                        "vertical_datum": native["vertical_datum"]}
            coverage_path = folder / "coverage.json"
            atomic_json(coverage_path, coverage, immutable=True)
            companions = list(selection["source_records"]) + list(selection["selection_files"])
            companions += [describe(root, root/"plans"/(plan_id+".json")), describe(root, coverage_path)]
            for record in selected:
                companions += record["files"]
            unique = {item["path"]: item for item in companions}
            entry = {"id": "usgs-3dep-static-dem-"+plan_id[:20], "title": selection["title"],
                     "kind": "raster", "role": "DEM", "uri": "https://www.usgs.gov/3d-elevation-program",
                     "vintage": "; ".join(sorted({str(item["vintage"]) for item in selected})),
                     "units": "m", "vertical_datum": native["vertical_datum"], "resampling": selection["resampling"],
                     **describe(root, destination), "companions": list(unique.values()),
                     "preparation_sha256": plan_id, "grid": grid,
                     "observed": {"valid_cells": stats["grid"]["valid_cells"],
                                  "nodata_cells": stats["grid"]["nodata_cells"],
                                  "minimum_m": stats["grid"]["minimum_m"], "maximum_m": stats["grid"]["maximum_m"],
                                  "domain": stats["domain"], "domain_complete": coverage["domain_complete"]},
                     "derivation": "Native-lattice first-valid mosaic; one horizontal reprojection to the frozen 30m grid",
                     "source_ids": selection["source_ids"], "hydrologic_conditioning": "none"}
            from .terrain_report import write_report
            report_files = write_report(root, selection, plan_id, entry, coverage, selected)
            entry["companions"] += [describe(root, path) for path in report_files]
            atomic_json(entry_path, entry, immutable=True)
            _source_manifest(root, selection, entry, entry_path, source_manifest)
            state.update(state="complete", updated_at=now(), source_entry=entry_path.name,
                         manifest=source_manifest.name, observed=entry["observed"])
            atomic_json(job, state)
            return {"state": "complete", "plan_id": plan_id, "entry": entry,
                    "manifest": source_manifest.name, "reused": False}
        except BaseException as error:
            state.update(state="interrupted", updated_at=now(), error=type(error).__name__+": "+str(error))
            atomic_json(job, state)
            raise


def _source_manifest(root, selection, entry, entry_path, target):
    imported_entry = {**entry, "companions": entry["companions"]+[describe(root, entry_path)]}
    value = {"schema": "upstate.sources/v1", "title": selection["title"], "captured_at": None,
             "entries": [imported_entry],
             "scope": {"terrain_plan": entry["preparation_sha256"], "source_reference": selection["source_reference"]},
             "notes": ["Original DEMs and XML are retained as companions, with full target-grid coverage.",
                       "No hydrologic conditioning or vertical datum transformation was performed.",
                       "The existing Workspace.import_sources consumes this manifest without a replacement writer."]}
    atomic_json(target, value, immutable=True)


def pause(root: Path | str, plan_id: str, *, resume: bool = False):
    root = Path(root).resolve()
    _plan(root, plan_id)
    path = root/"jobs"/("prepare-"+plan_id+".pause.json")
    if resume:
        path.unlink(missing_ok=True)
    else:
        atomic_json(path, {"plan_id": plan_id, "requested_at": now()})
    return {"plan_id": plan_id, "pause_requested": not resume}
