"""Retain and crop the original legacy NLCD2011 amended-2014 product.

This source is distinct from Annual NLCD. Original categorical cells and their
30 m lattice are retained in a bounded contributing-domain window. No national
Imagine raster is extracted and no class interpolation is performed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import zipfile

from model.common import (atomic_bytes, atomic_json, describe_file, digest,
                          file_digest, held, now, read_json, verify_file)
from model import rasters
from .prism_period import _domain_files, _selected_domain
from .raster_sources import capture

SCHEMA = "upstate.legacy-nlcd2011-source/v1"
BASENAME = "nlcd_2011_landcover_2011_edition_2014_10_10"
ARCHIVE = BASENAME + ".zip"
URL = "https://edcftp.cr.usgs.gov/project/landcover/NLCD2011/" + ARCHIVE
METADATA_URL = "https://www.mrlc.gov/downloads/sciweb1/shared/mrlc/metadata/landcover.html"
CLASSES = frozenset((11, 12, 21, 22, 23, 24, 31, 41, 42, 43, 52, 71, 81, 82, 90, 95))
NODATA = 255


def package(path):
    """Identify the original Imagine member and retain small original metadata."""
    records, metadata, raster = [], {}, []
    with zipfile.ZipFile(path) as archive:
        members = [x for x in archive.infolist() if not x.is_dir()]
        names = [x.filename for x in members]
        if len(names) != len(set(names)):
            raise ValueError("The original NLCD archive repeats a member name")
        for item in members:
            name = PurePosixPath(item.filename)
            if name.is_absolute() or ".." in name.parts or item.flag_bits & 1:
                raise ValueError("The original NLCD archive has an unsupported member")
            records.append({"name": item.filename, "bytes": item.file_size,
                            "compressed_bytes": item.compress_size, "crc32": format(item.CRC, "08x")})
            if name.name.lower() == BASENAME + ".img":
                raster.append(item.filename)
            if item.file_size <= 8*1024**2 and name.suffix.lower() in (".xml", ".txt", ".html", ".htm"):
                raw = archive.read(item)
                metadata[item.filename] = {"sha256": hashlib.sha256(raw).hexdigest(),
                    "bytes": len(raw), "content": raw.decode("utf-8-sig", errors="replace")}
        if len(raster) != 1:
            raise ValueError("Retain the exact original legacy NLCD2011 amended-2014 Imagine raster archive")
    return {"raster_member": raster[0], "members": records, "metadata": metadata,
            "metadata_reference": METADATA_URL}


def _selection(domain, *, buffer_m, layer, where, maximum_clip_pixels):
    if not math.isfinite(buffer_m) or buffer_m < 0:
        raise ValueError("The hydrologic context buffer must be nonnegative metres")
    if type(maximum_clip_pixels) is not int or maximum_clip_pixels <= 0:
        raise ValueError("The native window cell ceiling must be a positive integer")
    originals = _domain_files(domain)
    geometry, reader, feature_ids = _selected_domain(
        originals[0], layer=layer, where=where, buffer_m=buffer_m)
    from shapely.geometry import mapping
    value = {"schema": SCHEMA, "product": BASENAME, "url": URL,
             "domain": {"files": [describe_file(p.parent, p) for p in originals],
                        "layer": layer, "where": where, "reader": reader,
                        "feature_ids": feature_ids,
                        "buffer_m": buffer_m, "crs": "EPSG:5070",
                        "geometry": json.loads(json.dumps(mapping(geometry)))},
             "maximum_clip_pixels": maximum_clip_pixels,
             "method": "Native 30 m categorical window; no interpolation; actual source masks retained"}
    value["id"] = digest(value)
    return value


def _crop(archive, output, selected, archive_sha):
    import numpy as np
    import rasterio
    from rasterio.crs import CRS
    from rasterio.features import bounds as geometry_bounds
    from rasterio.warp import transform_geom
    from rasterio.windows import Window, from_bounds
    content = package(archive)
    vsi = "/vsizip/" + str(archive.resolve()) + "/" + content["raster_member"]
    partial = output.with_name(output.stem + ".partial.tif")
    with rasterio.Env(GDAL_CACHEMAX=64*1024**2), rasterio.open(vsi) as src:
        if src.count != 1 or src.crs != CRS.from_epsg(5070):
            raise ValueError("The original NLCD2011 source must be one-band NAD83/CONUS Albers")
        if not (src.width == 161190 and src.height == 104424
                and abs(src.transform.a-30) < 1e-9 and abs(src.transform.e+30) < 1e-9
                and abs(src.transform.b) < 1e-12 and abs(src.transform.d) < 1e-12):
            raise ValueError("The actual legacy source dimensions/lattice differ from original USGS metadata")
        if not np.issubdtype(np.dtype(src.dtypes[0]), np.integer):
            raise ValueError("The original land-cover source must retain categorical integer codes")
        if any(float(x) != 1 for x in src.scales) or any(float(x) != 0 for x in src.offsets):
            raise ValueError("Unexpected scaling of original categorical land-cover codes")
        geometry = transform_geom(selected["domain"]["crs"], src.crs,
                                  selected["domain"]["geometry"])
        floating = from_bounds(*geometry_bounds(geometry), transform=src.transform)
        left, top = math.floor(floating.col_off), math.floor(floating.row_off)
        right, bottom = math.ceil(floating.col_off+floating.width), math.ceil(floating.row_off+floating.height)
        if left < 0 or top < 0 or right > src.width or bottom > src.height:
            raise ValueError("The complete selected contributing-domain window exceeds original NLCD coverage")
        width, height = right-left, bottom-top
        if width*height > selected["maximum_clip_pixels"] or min(width, height) <= 0:
            raise ValueError("The selected original NLCD window exceeds the explicit cell ceiling or is empty")
        window = Window(left, top, width, height)
        affine = src.window_transform(window)
        native = {"crs": src.crs.to_wkt(), "width": src.width, "height": src.height,
                  "transform": list(src.transform)[:6], "dtype": src.dtypes[0], "nodata": src.nodata,
                  "driver": src.driver, "scales": list(src.scales), "offsets": list(src.offsets),
                  "window": [left, top, width, height]}
        grid = {"crs": src.crs.to_wkt(), "width": width, "height": height,
                "transform": list(affine)[:6], "nodata": NODATA, "pixel_area_ha": .09}
        profile = {"driver": "GTiff", "width": width, "height": height, "count": 1,
                   "dtype": "uint8", "nodata": NODATA, "crs": src.crs, "transform": affine,
                   "tiled": True, "blockxsize": 256, "blockysize": 256, "compress": "deflate"}
        histogram, valid_cells = {}, 0
        with rasterio.open(partial, "w", **profile) as dst:
            for _, local in dst.block_windows(1):
                original = Window(left+local.col_off, top+local.row_off, local.width, local.height)
                data = src.read(1, window=original, masked=True)
                valid = ~np.ma.getmaskarray(data)
                values = data.data[valid]
                unexpected = set(int(x) for x in np.unique(values))-CLASSES
                if unexpected:
                    raise ValueError("Unrecognized valid original NLCD2011 class codes: " + str(sorted(unexpected)))
                encoded = np.full(data.shape, NODATA, dtype="uint8")
                encoded[valid] = values
                dst.write(encoded, 1, window=local)
                codes, counts = np.unique(values, return_counts=True)
                for code, count in zip(codes, counts):
                    key = str(int(code))
                    histogram[key] = histogram.get(key, 0)+int(count)
                valid_cells += int(valid.sum())
            dst.update_tags(source_product=BASENAME, source_archive_sha256=archive_sha,
                            units="NLCD class code", resampling="none; original categorical window")
        if not valid_cells:
            raise ValueError("The selected original NLCD window has no valid land-cover cells")
        os.replace(partial, output)
    return {"package": content, "native": native, "grid": grid,
            "statistics": {"valid_cells": valid_cells, "missing_cells": width*height-valid_cells,
                           "class_cell_counts": histogram},
            "source_archive_sha256": archive_sha}


def prepare(directory, *, domain, archive=None, buffer_m=1000, layer=None,
            where=None, maximum_clip_pixels=10000000, download=True):
    root = Path(directory).resolve()
    root.mkdir(parents=True, exist_ok=True)
    selected = _selection(domain, buffer_m=buffer_m, layer=layer, where=where,
                          maximum_clip_pixels=maximum_clip_pixels)
    with held(root/".prepare.lock", blocking=False):
        if (root/"plan.json").exists() and read_json(root/"plan.json") != selected:
            raise ValueError("Use a new source directory for changed legacy NLCD/domain selection")
        atomic_json(root/"plan.json", selected, immutable=True)
        if (root/"result.json").exists():
            saved = read_json(root/"result.json")
            if saved["plan_id"] != selected["id"]:
                raise ValueError("The completed source has a different selection")
            for item in saved["files"]:
                verify_file(root, item)
            return saved
        (root/"original").mkdir(exist_ok=True)
        (root/"domain").mkdir(exist_ok=True)
        original = root/"original"/ARCHIVE
        if archive is not None:
            from model.reuse import copy_verified
            provided = Path(archive).resolve(strict=True)
            copy_verified(provided.parent, describe_file(provided.parent, provided),
                          root/"original", path=ARCHIVE)
        elif not original.exists() or original.with_name(original.name+".capture.json").exists():
            if not download and (not original.exists() or
                    read_json(original.with_name(original.name+".capture.json")).get("state") != "complete"):
                raise ValueError("Receive the complete original legacy NLCD archive or allow its public download")
            if download:
                capture(URL, original, maximum_bytes=2*1024**3)
        for item in _domain_files(domain):
            raw = item.read_bytes()
            expected = next(x for x in selected["domain"]["files"] if x["path"] == item.name)
            if hashlib.sha256(raw).hexdigest() != expected["sha256"]:
                raise ValueError("The original contributing-domain source changed during preparation")
            atomic_bytes(root/"domain"/item.name, raw, immutable=True)
        archive_sha = file_digest(original)
        derived = _crop(original, root/"landcover.tif", selected, archive_sha)
        if file_digest(original) != archive_sha:
            raise ValueError("The retained original land-cover archive changed during processing")
        atomic_json(root/"derivation.json", derived, immutable=True)
        companions = [describe_file(root, path) for path in sorted(root.rglob("*"))
                      if path.is_file() and path.name not in ("landcover.tif", "result.json",
                         "source-entry.json", "source-manifest.json") and
                         not path.name.endswith((".lock", ".partial", ".partial.tif"))]
        entry = {"id": "legacy-nlcd2011-"+selected["id"][:24], "title": "Legacy NLCD2011 land cover — amended 2014",
                 "kind": "raster", "role": "NLCD", "uri": URL, "vintage": "2011 edition; amended 2014-10-10",
                 "units": "class", "resampling": "nearest",
                 "citation": "U.S. Geological Survey, NLCD2011 Land Cover (2011 edition, amended 2014)",
                 "metadata_uri": METADATA_URL, "lineage": derived,
                 **describe_file(root, root/"landcover.tif"), "companions": companions}
        atomic_json(root/"source-entry.json", entry, immutable=True)
        atomic_json(root/"source-manifest.json", {"schema": "upstate.sources/v1",
                    "title": entry["title"], "entries": [entry]}, immutable=True)
        files = companions+[describe_file(root, root/name) for name in (
            "landcover.tif", "source-entry.json", "source-manifest.json")]
        result = {"schema": SCHEMA, "plan_id": selected["id"], "source_id": entry["id"],
                  "source_manifest": "source-manifest.json", "statistics": derived["statistics"],
                  "completed_at": now(), "files": files}
        atomic_json(root/"result.json", result, immutable=True)
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--domain", required=True)
    parser.add_argument("--archive", help="Already retained original legacy NLCD2011 archive")
    parser.add_argument("--buffer-m", type=float, default=1000)
    parser.add_argument("--layer")
    parser.add_argument("--where", help="Exact source property equality mapping as JSON")
    parser.add_argument("--maximum-clip-pixels", type=int, default=10000000)
    parser.add_argument("--originals-only", action="store_true")
    parser.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    result = prepare(args.output, domain=args.domain, archive=args.archive, buffer_m=args.buffer_m,
                     layer=args.layer, where=json.loads(args.where) if args.where else None,
                     maximum_clip_pixels=args.maximum_clip_pixels, download=not args.originals_only)
    print(json.dumps(result, indent=2, sort_keys=True, allow_nan=False))


if __name__ == "__main__":
    main()
