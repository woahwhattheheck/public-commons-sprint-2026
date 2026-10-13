"""Prepare an original PRISM period as a native-grid mean annual precipitation source.

The public annual grids are cumulative totals. Whole calendar years replace
their twelve monthly requests; edge months remain explicit. Every selected
month contributes exactly once, with no day weighting of precipitation totals.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import time
import zipfile

from model.common import (atomic_bytes, atomic_json, describe_file, digest,
                          file_digest, held, now, read_json, verify_file)
from model import rasters
from .nlcd_wcs import _domain_geometry
from .raster_sources import capture

SCHEMA = "upstate.prism-period-source/v1"
ENDPOINT = "https://services.nacse.org/prism/data/get/us"
REFERENCES = {
    "service": "https://prism.oregonstate.edu/documents/PRISM_downloads_web_service.pdf",
    "formats": "https://prism.nacse.org/formats/",
    "units": "https://prism.oregonstate.edu/faq/",
    "datasets": "https://prism.oregonstate.edu/documents/PRISM_datasets.pdf",
}
RESOLUTIONS = {"800m": ("30s", 1/120), "4km": ("25m", 1/24)}
NODATA = -9999.0


def periods(start, end):
    """Partition complete whole-year support into disjoint annual/monthly totals."""
    first, stop = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
    if (first.day != 1 or stop.day != 1 or stop <= first
            or first.month != stop.month or not 1895 <= first.year
            or stop.year - first.year > 100):
        raise ValueError("Select 1–100 complete years with month-start exclusive endpoints")
    result, current = [], first
    while current < stop:
        if current.month == 1 and dt.date(current.year+1, 1, 1) <= stop:
            following, token, months = dt.date(current.year+1, 1, 1), current.strftime("%Y"), 12
        else:
            following = dt.date(current.year + (current.month == 12), current.month % 12 + 1, 1)
            token, months = current.strftime("%Y%m"), 1
        result.append({"token": token, "start": current.isoformat(),
                       "end": following.isoformat(), "months": months})
        current = following
    if sum(x["months"] for x in result) != 12*(stop.year-first.year):
        raise ValueError("The original precipitation periods do not partition complete years")
    return result


def _domain_files(path):
    path = Path(path).resolve(strict=True)
    files = [path]
    if path.suffix.lower() == ".shp":
        for suffix in (".shx", ".dbf", ".prj"):
            item = path.with_suffix(suffix)
            if not item.is_file():
                raise ValueError("Retain the original shapefile companion " + suffix)
            files.append(item)
        for suffix in (".cpg", ".qix"):
            if path.with_suffix(suffix).is_file():
                files.append(path.with_suffix(suffix))
    return files


def _selected_domain(path, *, layer=None, where=None, buffer_m=0):
    """Read an unfiltered original GeoJSON without requiring a vector driver.

    Other formats and explicit layer/filter selectors retain the maintained
    vector-reader contract. RFC 7946 coordinates use longitude, latitude;
    older named-CRS GeoJSON retains its explicit original CRS.
    """
    from shapely.geometry import shape
    from shapely.ops import transform, unary_union
    from pyproj import CRS, Transformer
    from functools import partial

    path = Path(path)
    value = read_json(path) if path.suffix.lower() in {".json", ".geojson"} else None
    if (isinstance(value, dict) and value.get("type") == "FeatureCollection"
            and layer is None and where is None):
        crs_member = value.get("crs")
        if crs_member is None:
            source_crs = CRS.from_user_input("OGC:CRS84")
        elif (isinstance(crs_member, dict) and crs_member.get("type") == "name"
              and isinstance(crs_member.get("properties"), dict)
              and crs_member["properties"].get("name")):
            source_crs = CRS.from_user_input(crs_member["properties"]["name"])
        else:
            raise ValueError("Retain a supported original named CRS for this GeoJSON domain")
        target_crs = CRS.from_epsg(5070)
        project = Transformer.from_crs(source_crs, target_crs, always_xy=True)
        features = value.get("features")
        if not isinstance(features, list) or not features:
            raise ValueError("The original domain GeoJSON has no polygon features")
        polygons, identifiers = [], []
        for index, feature in enumerate(features):
            if (not isinstance(feature, dict) or feature.get("type") != "Feature"
                    or not isinstance(feature.get("geometry"), dict)
                    or feature["geometry"].get("type") not in {"Polygon", "MultiPolygon"}):
                raise ValueError("The complete original domain must contain polygon features")
            geometry = shape(feature["geometry"])
            if geometry.is_empty or not geometry.is_valid:
                raise ValueError("The original domain contains an empty or invalid polygon")
            geometry = transform(partial(project.transform, errcheck=True), geometry)
            if (geometry.is_empty or not geometry.is_valid
                    or not all(math.isfinite(value) for value in geometry.bounds)):
                raise ValueError("The original domain cannot be projected as a finite valid polygon")
            polygons.append(geometry)
            raw_id = feature.get("id")
            identifiers.append(str(index) if raw_id is None else str(raw_id))
        if len(set(identifiers)) != len(identifiers):
            raise ValueError("The original domain repeats a GeoJSON feature identity")
        geometry = unary_union(polygons)
        reader = {"format": "GeoJSON", "method": "shapely-pyproj",
                  "source_crs": source_crs.to_string(), "target_crs": target_crs.to_string(),
                  "axis_order": "x-y", "feature_identity": "original-id-or-zero-based-index"}
    else:
        rows, reader = _domain_geometry(path, layer=layer, where=where, target_crs="EPSG:5070")
        geometry = rasters.polygon_union(rows)
        identifiers = [row["id"] for row in rows]
    if buffer_m:
        geometry = geometry.buffer(buffer_m)
    if geometry.is_empty or not geometry.is_valid:
        raise ValueError("The selected complete contributing domain is invalid")
    return geometry, reader, identifiers


def plan(domain, *, start, end, resolution="800m", buffer_m=1000,
         layer=None, where=None, maximum_clip_pixels=4000000):
    if resolution not in RESOLUTIONS:
        raise ValueError("Select the original public 800m or 4km PRISM product")
    if not math.isfinite(buffer_m) or buffer_m < 0:
        raise ValueError("The explicit hydrologic context buffer must be nonnegative metres")
    if type(maximum_clip_pixels) is not int or maximum_clip_pixels <= 0:
        raise ValueError("The native source-window cell ceiling must be a positive integer")
    files = _domain_files(domain)
    identities = [describe_file(item.parent, item) for item in files]
    selected, reader, feature_ids = _selected_domain(
        files[0], layer=layer, where=where, buffer_m=buffer_m)
    from shapely.geometry import mapping
    sequence = periods(start, end)
    code = RESOLUTIONS[resolution][0]
    for item in sequence:
        item.update(url=ENDPOINT + "/" + resolution + "/ppt/" + item["token"],
                    archive="prism_ppt_us_" + code + "_" + item["token"] + ".zip")
    value = {"schema": SCHEMA, "variable": "ppt", "dataset_type": "AN",
             "resolution": resolution, "start": start, "end": end,
             "years": dt.date.fromisoformat(end).year-dt.date.fromisoformat(start).year,
             "period_end_convention": "exclusive", "periods": sequence,
             "domain": {"files": identities, "layer": layer, "where": where,
                        "reader": reader, "feature_ids": feature_ids,
                        "buffer_m": buffer_m, "crs": "EPSG:5070",
                        "geometry": json.loads(json.dumps(mapping(selected)))},
             "maximum_clip_pixels": maximum_clip_pixels, "references": REFERENCES,
             "method": "Sum disjoint original cumulative precipitation totals; divide by complete years."}
    value["id"] = digest(value)
    return value


def _package(archive_path, period, selected):
    """Inspect exact original archive members without extracting a national raster."""
    expected = period["archive"][:-4]
    records, metadata = [], {}
    with zipfile.ZipFile(archive_path) as archive:
        members = [item for item in archive.infolist() if not item.is_dir()]
        names = [item.filename for item in members]
        if len(names) != len(set(names)):
            raise ValueError("The original PRISM archive repeats a member name")
        for item in members:
            parts = PurePosixPath(item.filename)
            if parts.is_absolute() or ".." in parts.parts or item.flag_bits & 1:
                raise ValueError("The original PRISM archive has an unsupported member")
            if item.file_size > 2*1024**3:
                raise ValueError("Original PRISM archive member exceeds the retained source ceiling")
            record = {"member": item.filename, "bytes": item.file_size,
                      "compressed_bytes": item.compress_size, "crc32": format(item.CRC, "08x")}
            if item.filename.endswith((".info.txt", ".xml", ".prj")) and item.file_size <= 4*1024**2:
                raw = archive.read(item)  # Native ZIP CRC is checked by this read.
                metadata[item.filename] = raw.decode("utf-8-sig")
                record["sha256"] = hashlib.sha256(raw).hexdigest()
            records.append(record)
        rasters_ = [name for name in names if PurePosixPath(name).name == expected + ".tif"]
        infos = [name for name in metadata if PurePosixPath(name).name == expected + ".info.txt"]
        xmls = [name for name in metadata if PurePosixPath(name).name == expected + ".xml"]
        if len(rasters_) != 1 or len(infos) != 1 or len(xmls) != 1:
            raise ValueError("PRISM period, variable, resolution or original metadata differs from selection")
        original_info = metadata[infos[0]]
        match = re.search(r"(?mi)^\s*PRISM_DATASET_TYPE\s*[:=]\s*([^\r\n]+)", original_info)
        if not match or match.group(1).strip().strip('"') != selected["dataset_type"]:
            raise ValueError("The original PRISM info must identify the selected AN dataset")
    return {"raster_member": rasters_[0], "members": records,
            "original_metadata": metadata}


def _clip(archive_path, directory, period, selected, common_grid):
    import numpy as np
    import rasterio
    from rasterio.windows import Window, from_bounds
    from pyproj import Transformer
    from shapely.geometry import shape
    from shapely.ops import transform

    body = _package(archive_path, period, selected)
    source_uri = "/vsizip/" + str(archive_path.resolve()) + "/" + body["raster_member"]
    output = directory / (period["token"] + ".tif")
    receipt_path = directory / (period["token"] + ".json")
    archive_sha = file_digest(archive_path)
    identity = {"plan_id": selected["id"], "period": period, "archive_sha256": archive_sha}
    if receipt_path.exists():
        record = read_json(receipt_path)
        if record["identity"] != identity:
            raise ValueError("Retained precipitation clip belongs to another source")
        verify_file(directory, record["raster"])
        if common_grid is not None and record["grid"] != common_grid:
            raise ValueError("Retained original PRISM grids are not the same lattice")
        return record
    with rasterio.Env(GDAL_CACHEMAX=64*1024**2), rasterio.open(source_uri) as src:
        if src.count != 1 or not src.crs or not src.crs.is_geographic:
            raise ValueError("Select the original geographic single-band precipitation grid")
        affine = src.transform
        spacing = RESOLUTIONS[selected["resolution"]][1]
        if (affine.b or affine.d or not math.isclose(affine.a, spacing, abs_tol=1e-9)
                or not math.isclose(affine.e, -spacing, abs_tol=1e-9)):
            raise ValueError("The original PRISM resolution or orientation differs")
        if not all(math.isfinite(x) for x in (src.scales[0], src.offsets[0])) or src.scales[0] <= 0:
            raise ValueError("The original PRISM scale/offset is invalid")
        projection = Transformer.from_crs("EPSG:5070", src.crs, always_xy=True)
        geometry = transform(projection.transform, shape(selected["domain"]["geometry"]))
        # Keep one original cell around the requested geometry for later interpolation.
        raw = from_bounds(*geometry.bounds, transform=affine)
        c0, r0 = math.floor(raw.col_off)-1, math.floor(raw.row_off)-1
        c1 = math.ceil(raw.col_off+raw.width)+1
        r1 = math.ceil(raw.row_off+raw.height)+1
        if c0 < 0 or r0 < 0 or c1 > src.width or r1 > src.height:
            raise ValueError("Complete contributing domain lies outside the original climate grid")
        window = Window(c0, r0, c1-c0, r1-r0)
        if window.width*window.height > selected["maximum_clip_pixels"]:
            raise ValueError("Select a smaller contributing source window or an explicit larger ceiling")
        grid = {"crs": src.crs.to_wkt(), "transform": list(src.window_transform(window))[:6],
                "width": int(window.width), "height": int(window.height)}
        if common_grid is not None and grid != common_grid:
            raise ValueError("Original PRISM periods use different source lattices")
        native = {"crs": src.crs.to_wkt(), "transform": list(affine)[:6],
                  "width": src.width, "height": src.height, "dtype": src.dtypes[0],
                  "nodata": src.nodata, "scale": src.scales[0], "offset": src.offsets[0],
                  "tags": src.tags(), "band_tags": src.tags(1)}
        profile = {"driver": "GTiff", "count": 1, "dtype": "float64", "nodata": NODATA,
                   "crs": src.crs, "transform": src.window_transform(window),
                   "width": grid["width"], "height": grid["height"],
                   "tiled": True, "blockxsize": 256, "blockysize": 256, "compress": "deflate"}
        partial = output.with_suffix(".partial.tif")
        valid = 0
        with rasterio.open(partial, "w", **profile) as dst:
            for _, block in dst.block_windows(1):
                original_window = Window(block.col_off+c0, block.row_off+r0, block.width, block.height)
                data = src.read(1, window=original_window, masked=True)
                values = data.data.astype("float64")*src.scales[0]+src.offsets[0]
                missing = np.ma.getmaskarray(data) | ~np.isfinite(values)
                if np.any(values[~missing] < 0):
                    raise ValueError("Original valid precipitation is negative")
                valid += int((~missing).sum())
                values[missing] = NODATA
                dst.write(values, 1, window=block)
            dst.update_tags(units="mm", source_period_start=period["start"],
                            source_period_end_exclusive=period["end"], source_archive_sha256=archive_sha)
        if not valid:
            raise ValueError("The selected climate source window has no valid precipitation")
        os.replace(partial, output)
    record = {"identity": identity, "grid": grid, "native": native, "package": body,
              "raster": describe_file(directory, output), "valid_cells": valid,
              "units": "mm", "conversion": "Native band scale/offset applied once"}
    atomic_json(receipt_path, record, immutable=True)
    return record


def _mean(directory, selected, clips):
    import numpy as np
    import rasterio
    from affine import Affine
    grid = clips[0]["grid"]
    path = directory / "precipitation.tif"
    pending = directory / "precipitation.partial.tif"
    profile = {"driver": "GTiff", "count": 1, "dtype": "float32", "nodata": NODATA,
               "crs": grid["crs"], "transform": Affine(*grid["transform"]),
               "width": grid["width"], "height": grid["height"], "tiled": True,
               "blockxsize": 256, "blockysize": 256, "compress": "deflate"}
    valid_cells, minimum, maximum = 0, None, None
    from contextlib import ExitStack
    with rasterio.Env(GDAL_CACHEMAX=64*1024**2), ExitStack() as stack:
        sources = [stack.enter_context(rasterio.open(directory/"clips"/item["raster"]["path"]))
                   for item in clips]
        with rasterio.open(pending, "w", **profile) as dst:
            for _, window in dst.block_windows(1):
                total = np.zeros((int(window.height), int(window.width)), dtype="float64")
                complete = np.ones(total.shape, dtype=bool)
                for src in sources:
                    data = src.read(1, window=window, masked=True)
                    present = ~np.ma.getmaskarray(data) & np.isfinite(data.data)
                    complete &= present
                    total[present] += data.data[present]
                values = np.full(total.shape, NODATA, dtype="float32")
                annual = total[complete]/selected["years"]
                if not np.all(np.isfinite(annual)) or np.any(annual > np.finfo("float32").max):
                    raise ValueError("Mean annual precipitation exceeds the output encoding")
                values[complete] = annual
                valid_cells += int(complete.sum())
                if complete.any():
                    lo, hi = float(values[complete].min()), float(values[complete].max())
                    minimum = lo if minimum is None else min(lo, minimum)
                    maximum = hi if maximum is None else max(hi, maximum)
                dst.write(values, 1, window=window)
            dst.update_tags(units="mm/year", source_period_start=selected["start"],
                            source_period_end_exclusive=selected["end"], source_years=str(selected["years"]),
                            aggregation="sum_disjoint_original_totals_divide_complete_years")
    if not valid_cells:
        raise ValueError("No climate cells have complete support across every selected period")
    os.replace(pending, path)
    return {"valid_cells": valid_cells, "missing_cells": grid["width"]*grid["height"]-valid_cells,
            "minimum": minimum, "maximum": maximum, "units": "mm/year"}


def prepare(directory, *, domain, start, end, resolution="800m", buffer_m=1000,
            layer=None, where=None, maximum_clip_pixels=4000000,
            maximum_archive_bytes=300*1024**2, download=True):
    root = Path(directory).resolve()
    root.mkdir(parents=True, exist_ok=True)
    selected = plan(domain, start=start, end=end, resolution=resolution, buffer_m=buffer_m,
                    layer=layer, where=where, maximum_clip_pixels=maximum_clip_pixels)
    plan_path, result_path = root/"plan.json", root/"result.json"
    with held(root/".prepare.lock", blocking=False):
        if plan_path.exists() and read_json(plan_path) != selected:
            raise ValueError("Use a new source directory for a changed period/domain/product selection")
        atomic_json(plan_path, selected, immutable=True)
        if result_path.exists():
            result = read_json(result_path)
            if result["plan_id"] != selected["id"]:
                raise ValueError("The completed climate source has another identity")
            for entry in result["files"]:
                verify_file(root, entry)
            return result
        for sub in ("original", "clips", "domain"):
            (root/sub).mkdir(exist_ok=True)
        for item in _domain_files(domain):
            raw = item.read_bytes()
            expected = next(x for x in selected["domain"]["files"] if x["path"] == item.name)
            if hashlib.sha256(raw).hexdigest() != expected["sha256"]:
                raise ValueError("Original contributing domain changed during preparation")
            atomic_bytes(root/"domain"/item.name, raw, immutable=True)
        clips, common_grid = [], None
        progress_path = root/"progress.json"
        last_request = None
        for period in selected["periods"]:
            original = root/"original"/period["archive"]
            receipt = original.with_name(original.name+".capture.json")
            if not original.exists() or receipt.exists():
                if not download and not (original.exists() and receipt.exists()
                                         and read_json(receipt).get("state") == "complete"):
                    raise ValueError("Receive the exact original PRISM entity " + period["archive"])
                if download and not original.exists() and last_request is not None:
                    time.sleep(max(0, 2-(time.monotonic()-last_request)))
                if download or receipt.exists():
                    capture(period["url"], original, maximum_bytes=maximum_archive_bytes)
                    last_request = time.monotonic()
            record = _clip(original, root/"clips", period, selected, common_grid)
            common_grid = record["grid"]
            clips.append(record)
            atomic_json(progress_path, {"plan_id": selected["id"], "completed": len(clips),
                                       "expected": len(selected["periods"]), "last_period": period["token"],
                                       "observed_at": now()})
        statistics = _mean(root, selected, clips)
        derivation = {"schema": SCHEMA, "plan_id": selected["id"], "periods": selected["periods"],
                      "years": selected["years"], "grid": common_grid, "statistics": statistics,
                      "source_units": "mm cumulative per original period", "units": "mm/year",
                      "support": "Only cells valid in every selected original period are retained",
                      "native_model_interpretation": "NDR uses spatial relative precipitation; its default runoff "
                         "normalization divides by the actual watershed-masked mean. This source changes period "
                         "and spatial pattern, not an independent scalar rainfall-response parameter.",
                      "references": REFERENCES}
        atomic_json(root/"derivation.json", derivation, immutable=True)
        companions = [describe_file(root, item) for item in sorted(root.rglob("*"))
                      if item.is_file() and item.name not in ("precipitation.tif", "result.json",
                         "source-entry.json", "source-manifest.json", "progress.json")
                      and not item.name.endswith((".lock", ".partial", ".partial.tif"))]
        entry = {"id": "prism-period-"+selected["id"][:24],
                 "title": "PRISM mean annual precipitation "+start+" to "+end+" (exclusive)",
                 "kind": "raster", "role": "PRECIPITATION", "uri": REFERENCES["service"],
                 "vintage": start+" through "+end+" exclusive; actual received AN grid editions retained",
                 "units": "mm/year", "resampling": "bilinear", "source_resolution": resolution,
                 "temporal_support": {"start": start, "end": end, "years": selected["years"]},
                 **describe_file(root, root/"precipitation.tif"), "companions": companions,
                 "citation": "PRISM Climate Group, Oregon State University; original grids and release metadata retained",
                 "lineage": derivation, "use": "Period-matched spatial runoff proxy for native NDR"}
        atomic_json(root/"source-entry.json", entry, immutable=True)
        manifest = {"schema": "upstate.sources/v1", "title": entry["title"], "entries": [entry]}
        atomic_json(root/"source-manifest.json", manifest, immutable=True)
        outputs = companions + [describe_file(root, root/name) for name in (
            "precipitation.tif", "source-entry.json", "source-manifest.json")]
        result = {"schema": SCHEMA, "plan_id": selected["id"], "source_id": entry["id"],
                  "source_manifest": "source-manifest.json", "period_count": len(clips),
                  "years": selected["years"], "statistics": statistics,
                  "completed_at": now(), "files": outputs}
        atomic_json(result_path, result, immutable=True)
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--domain", required=True)
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    parser.add_argument("--resolution", choices=sorted(RESOLUTIONS), default="800m")
    parser.add_argument("--buffer-m", type=float, default=1000)
    parser.add_argument("--layer")
    parser.add_argument("--where", help="Exact native source property equality mapping as JSON")
    parser.add_argument("--maximum-clip-pixels", type=int, default=4000000)
    parser.add_argument("--maximum-archive-bytes", type=int, default=300*1024**2)
    parser.add_argument("--originals-only", action="store_true", help="Adopt already retained archives without network requests")
    parser.add_argument("--plan-only", action="store_true")
    parser.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    options = dict(domain=args.domain, start=args.start, end=args.end,
                   resolution=args.resolution, buffer_m=args.buffer_m, layer=args.layer,
                   where=json.loads(args.where) if args.where else None,
                   maximum_clip_pixels=args.maximum_clip_pixels)
    if args.plan_only:
        result = plan(**options)
        atomic_json(Path(args.output), result, immutable=True)
    else:
        result = prepare(args.output, **options, maximum_archive_bytes=args.maximum_archive_bytes,
                         download=not args.originals_only)
    print(json.dumps(result, indent=2, sort_keys=True, allow_nan=False))


if __name__ == "__main__":
    main()
