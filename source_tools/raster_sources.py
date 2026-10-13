"""Original public raster intake for the Upper Savannah scientific workspace.

Run these commands inside the existing native GIS job. No model is executed.
"""
from __future__ import annotations
import argparse
import hashlib
import gzip
import json
import math
import os
from pathlib import Path
import re
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from model.common import atomic_json, describe_file, digest, file_digest, held, now, read_json

DEM_SERVICE = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer"
PRISM_ANNUAL = "https://data.prism.oregonstate.edu/normals/us/800m/ppt/monthly/prism_ppt_us_30s_2020_avg_30y.zip"
EXPORT_REFERENCE = "https://developers.arcgis.com/rest/services-reference/enterprise/export-image/"
PRISM_REFERENCE = "https://prism.oregonstate.edu/normals/"
HEADERS = ("Date", "ETag", "Last-Modified", "Content-Type", "Content-Length",
           "Content-Encoding", "Accept-Ranges", "Retry-After")

def _fsync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def _matches(path, record):
    return (path.is_file() and path.stat().st_size == record["bytes"]
            and file_digest(path) == record["sha256"])

def capture(url, path, *, maximum_bytes):
    """Retain one full HTTP entity and reuse its completed exact-byte receipt."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    receipt_path = path.with_name(path.name + ".capture.json")
    partial = path.with_name(path.name + ".partial")
    with held(path.with_name(path.name + ".lock")):
        prior = read_json(receipt_path) if receipt_path.exists() else None
        if prior and prior["url"] != url:
            raise ValueError("Select a separate source directory for a different request")
        if prior and prior.get("state") in ("received", "complete"):
            selected = path if path.exists() else partial
            if not _matches(selected, prior):
                raise ValueError("Retained HTTP source bytes differ: " + str(selected))
            if selected == partial:
                os.replace(partial, path)
                _fsync_directory(path.parent)
            if prior["state"] != "complete":
                prior["state"] = "complete"
                atomic_json(receipt_path, prior)
            return prior
        if path.exists():
            raise ValueError("A source body exists without its complete capture receipt")
        attempt = (prior or {}).get("attempt", 0) + 1
        request_record = {"schema": "upstate.public-source-capture/v1", "url": url,
                          "state": "receiving", "requested_at": now(), "attempt": attempt}
        if prior:
            request_record["previous_attempt"] = {
                k: prior[k] for k in ("attempt", "requested_at", "observed_at", "status", "error", "received_bytes")
                if k in prior}
        atomic_json(receipt_path, request_record)
        received = 0
        h = hashlib.sha256()
        try:
            request = urllib.request.Request(url, headers={
                "User-Agent": "Commons-Upper-Savannah-Source/1.0", "Accept-Encoding": "identity"})
            with urllib.request.urlopen(request, timeout=60) as response, partial.open("wb") as out:
                record = {**request_record, "status": response.status, "final_url": response.url,
                          "headers": {k: response.headers[k] for k in HEADERS if k in response.headers}}
                atomic_json(receipt_path, record)
                if response.status != 200:
                    raise ValueError("Source request did not return the complete HTTP entity")
                for block in iter(lambda: response.read(1024 * 1024), b""):
                    received += len(block)
                    if received > maximum_bytes:
                        raise ValueError("Original HTTP entity exceeds this source's declared maximum")
                    out.write(block)
                    h.update(block)
                length = response.headers.get("Content-Length")
                if length is not None and received != int(length):
                    raise ValueError("Original HTTP entity is incomplete")
                out.flush()
                os.fsync(out.fileno())
            record.update(state="received", observed_at=now(), bytes=received, sha256=h.hexdigest())
            atomic_json(receipt_path, record)
            os.replace(partial, path)
            _fsync_directory(path.parent)
            record["state"] = "complete"
            atomic_json(receipt_path, record)
            return record
        except BaseException as error:
            current = read_json(receipt_path)
            if current.get("state") not in ("received", "complete"):
                current.update(state="interrupted", observed_at=now(), received_bytes=received,
                               error=type(error).__name__ + ": " + str(error))
                if isinstance(error, urllib.error.HTTPError):
                    current.update(status=error.code, final_url=error.url,
                                   headers={k: error.headers[k] for k in HEADERS if k in error.headers})
                atomic_json(receipt_path, current)
            raise

def source_grid(reference, domain, *, layer=None, where=None, buffer_m=1000):
    from model import rasters
    import rasterio
    from pyproj import CRS
    if not math.isfinite(buffer_m) or buffer_m <= 0:
        raise ValueError("Supply the explicit positive model-domain buffer in metres")
    with rasterio.open(reference) as dataset:
        target = CRS.from_user_input(dataset.crs)
    rows, _ = rasters.vector_geometry(domain, layer=layer, where=where, target_crs=target)
    geometry = rasters.polygon_union(rows).buffer(buffer_m)
    grid = rasters.grid_definition(reference, geometry)
    return grid

def _tile_requests(grid, maximum, *, image_sr=None):
    width, height = grid["width"], grid["height"]
    a, b, left, d, e, top = grid["transform"]
    if b or d or a != 30 or e != -30:
        raise ValueError("DEM preparation requires the retained unrotated 30m reference grid")
    from pyproj import CRS
    reference_crs = CRS.from_user_input(grid["crs"])
    if image_sr is None:
        epsg = reference_crs.to_epsg()
        image_sr = str(epsg) if epsg else json.dumps({"wkt": grid["crs"]}, separators=(",", ":"))
    elif not isinstance(image_sr, str) or not image_sr:
        raise ValueError("The original request coordinate system is missing")
    elif re.fullmatch(r"[1-9][0-9]*", image_sr):
        if not reference_crs.equals(CRS.from_epsg(int(image_sr)), ignore_axis_order=True):
            raise ValueError("The original numeric request CRS differs from its saved grid")
    elif image_sr != json.dumps({"wkt": grid["crs"]}, separators=(",", ":")):
        raise ValueError("The original request WKT differs from its saved grid")
    for row in range(0, height, maximum):
        for col in range(0, width, maximum):
            w, h = min(maximum, width-col), min(maximum, height-row)
            bbox = [left + col*a, top + (row+h)*e, left + (col+w)*a, top + row*e]
            query = {
                "f": "image", "bbox": ",".join(format(value, ".17g") for value in bbox),
                "bboxSR": image_sr, "imageSR": image_sr, "size": f"{w},{h}",
                "adjustAspectRatio": "false", "format": "tiff", "pixelType": "F32",
                "bandIds": "0", "renderingRule": '{"rasterFunction":"None"}',
                "interpolation": "RSP_BilinearInterpolation", "compression": "LZ77"}
            yield {"row": row, "col": col, "width": w, "height": h, "bbox": bbox,
                   "file": f"original/3dep-r{row:06d}-c{col:06d}.tif",
                   "url": DEM_SERVICE + "/exportImage?" + urllib.parse.urlencode(query)}

def plan_dem(reference, domain, metadata_path, directory, *, vintage, layer=None,
             where=None, buffer_m=1000, tile_size=2048):
    """Save the original grid and requests before acquisition on any worker."""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    if not isinstance(vintage, str) or not vintage.strip():
        raise ValueError("Supply the retained elevation service edition")
    if isinstance(tile_size, bool) or not isinstance(tile_size, int):
        raise ValueError("Tile size must be an integer number of reference pixels")
    with held(directory / "prepare.lock", blocking=False):
        grid = source_grid(reference, domain, layer=layer, where=where, buffer_m=buffer_m)
        metadata_bytes = Path(metadata_path).read_bytes()
        metadata_encoding = "gzip" if metadata_bytes.startswith(bytes((0x1F, 0x8B))) else "identity"
        decoded_metadata = gzip.decompress(metadata_bytes) if metadata_encoding == "gzip" else metadata_bytes
        metadata = json.loads(decoded_metadata)
        metadata_filename = "original/service.json" + (".gz" if metadata_encoding == "gzip" else "")
        available = [int(metadata.get("maxImageWidth", 0)), int(metadata.get("maxImageHeight", 0))]
        if (metadata.get("bandCount") != 1 or metadata.get("pixelType") != "F32"
                or "Image" not in metadata.get("capabilities", "")):
            raise ValueError("Select the retained original 3DEP elevation ImageServer metadata")
        if tile_size < 1 or min(available) < tile_size:
            raise ValueError("Tile dimensions exceed the observed original image-service limit")
        functions = [item.get("name") for item in metadata.get("rasterFunctionInfos", [])]
        if "None" not in functions:
            raise ValueError("The observed elevation service does not advertise its unrendered data path")
        plan = {"schema": "upstate.3dep-native-source/v1", "source": DEM_SERVICE, "vintage": vintage,
                "reference_sha256": file_digest(reference), "domain_sha256": file_digest(domain),
                "domain_layer": layer, "domain_filter": where, "buffer_m": buffer_m,
                "metadata_sha256": hashlib.sha256(metadata_bytes).hexdigest(),
                "metadata_decoded_sha256": hashlib.sha256(decoded_metadata).hexdigest(),
                "metadata_encoding": metadata_encoding, "metadata_file": metadata_filename,
                "grid": grid, "tile_size": tile_size,
                "interpolation": "RSP_BilinearInterpolation", "pixel_type": "F32",
                "rendering_rule": {"rasterFunction": "None"}, "compression": "LZ77",
                "mosaic_rule": {"selection": "observed provider default",
                               "defaultMosaicMethod": metadata.get("defaultMosaicMethod"),
                               "mosaicOperator": metadata.get("mosaicOperator"),
                               "sortField": metadata.get("sortField"), "sortValue": metadata.get("sortValue")},
                "export_contract": EXPORT_REFERENCE}
        atomic_json(directory / "plan.json", plan, immutable=True)

        from model.common import atomic_bytes
        original_metadata = directory / metadata_filename
        atomic_bytes(original_metadata, metadata_bytes, immutable=True)
        requests = list(_tile_requests(grid, tile_size))
        atomic_json(directory / "requests.json",
                    {"plan_sha256": digest(plan), "tiles": requests}, immutable=True)
        return {"schema": "upstate.3dep-plan-result/v1",
                "directory": str(directory.resolve()), "plan_sha256": digest(plan),
                "tile_count": len(requests), "grid": grid,
                "uncompressed_mosaic_bytes": grid["width"] * grid["height"] * 4,
                "metadata_file": metadata_filename,
                "plan_file": "plan.json", "requests_file": "requests.json"}

def _load_dem_plan(directory):
    directory = Path(directory)
    plan = read_json(directory / "plan.json")
    if (plan.get("schema") != "upstate.3dep-native-source/v1"
            or plan.get("source") != DEM_SERVICE):
        raise ValueError("Select an original 3DEP source plan")
    grid = plan["grid"]
    for name in ("width", "height"):
        value = grid.get(name)
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            raise ValueError("The retained DEM grid has invalid " + name)
    size = plan["tile_size"]
    if isinstance(size, bool) or not isinstance(size, int) or size <= 0:
        raise ValueError("The retained DEM tile size must be positive")
    from model.common import relative_file
    metadata_path = relative_file(directory, plan["metadata_file"])
    metadata_bytes = metadata_path.read_bytes()
    if hashlib.sha256(metadata_bytes).hexdigest() != plan["metadata_sha256"]:
        raise ValueError("The original elevation service metadata changed")
    decoded = gzip.decompress(metadata_bytes) if plan.get("metadata_encoding") == "gzip" else metadata_bytes
    if hashlib.sha256(decoded).hexdigest() != plan["metadata_decoded_sha256"]:
        raise ValueError("The original decoded elevation metadata changed")
    metadata = json.loads(decoded)
    if (metadata.get("bandCount") != 1 or metadata.get("pixelType") != "F32"
            or "Image" not in metadata.get("capabilities", "")
            or "None" not in [x.get("name") for x in metadata.get("rasterFunctionInfos", [])]
            or size > min(int(metadata.get("maxImageWidth", 0)),
                          int(metadata.get("maxImageHeight", 0)))):
        raise ValueError("The retained DEM request is incompatible with its service metadata")
    expected = {"pixel_type": "F32", "rendering_rule": {"rasterFunction": "None"},
                "interpolation": "RSP_BilinearInterpolation", "compression": "LZ77"}
    if any(plan.get(key) != value for key, value in expected.items()):
        raise ValueError("The source plan no longer uses its original numeric elevation request")
    request_path = directory / "requests.json"
    if request_path.exists():
        requests = read_json(request_path)
        if (not isinstance(requests, dict) or set(requests) != {"plan_sha256", "tiles"}
                or requests["plan_sha256"] != digest(plan)
                or not isinstance(requests["tiles"], list) or not requests["tiles"]
                or not isinstance(requests["tiles"][0], dict)
                or not isinstance(requests["tiles"][0].get("url"), str)):
            raise ValueError("The saved requests no longer bind the original source plan")
        # Preserve the original wire CRS across GIS versions: authority inference
        # can change while the retained WKT, source grid and requests stay the same.
        query = urllib.parse.parse_qs(
            urllib.parse.urlsplit(requests["tiles"][0]["url"]).query,
            keep_blank_values=True, strict_parsing=True)
        spatial_references = query.get("imageSR", [])
        if len(spatial_references) != 1:
            raise ValueError("The original request has no unique coordinate system")
        tiles = list(_tile_requests(grid, size, image_sr=spatial_references[0]))
        if requests != {"plan_sha256": digest(plan), "tiles": tiles}:
            raise ValueError("The original tile requests changed")
    else:
        # Existing one-command preparations predate the separate request carrier.
        tiles = list(_tile_requests(grid, size))
    return plan, tiles


def _dem_tile_record(directory, tile, grid, *, verify=True):
    """Inspect an original tile and its complete HTTP receipt."""
    import rasterio
    from rasterio.transform import Affine
    from pyproj import CRS
    path = Path(directory) / tile["file"]
    receipt = read_json(path.with_name(path.name + ".capture.json"))
    if (receipt.get("state") != "complete" or receipt.get("status") != 200
            or receipt.get("url") != tile["url"]
            or not path.is_file() or path.stat().st_size != receipt.get("bytes")):
        raise ValueError("An elevation tile has no matching complete HTTP entity: " + tile["file"])
    if verify and file_digest(path) != receipt.get("sha256"):
        raise ValueError("Original elevation tile bytes changed: " + tile["file"])
    with rasterio.open(path) as actual:
        expected = Affine(*grid["transform"]) * Affine.translation(tile["col"], tile["row"])
        if (actual.count != 1 or actual.width != tile["width"] or actual.height != tile["height"]
                or actual.dtypes[0] != "float32"
                or actual.crs != CRS.from_user_input(grid["crs"])
                or not actual.transform.almost_equals(expected, precision=1e-7)):
            raise ValueError("Returned original elevation tile differs from its exact requested grid: "
                             + tile["file"])
    return {**tile, "capture": {key: receipt[key] for key in
                              ("bytes", "sha256", "requested_at", "observed_at")}}


def _dem_complete_entry(directory, plan):
    path = Path(directory) / "source-entry.json"
    if not path.exists():
        return None
    entry = read_json(path)
    if entry.get("preparation_sha256") != digest(plan):
        raise ValueError("This prepared DEM belongs to another source grid")
    for item in [entry, *entry["companions"]]:
        if not _matches(Path(directory) / item["path"], item):
            raise ValueError("Prepared DEM or original companion bytes changed: " + item["path"])
    return entry


def dem_status(directory, *, verify=False):
    """Read useful acquisition state without acquiring a job lock or requesting data."""
    directory = Path(directory)
    plan, tiles = _load_dem_plan(directory)
    counts = {"ready": 0, "pending": 0, "incomplete": 0, "invalid": 0}
    rows = []
    retained_bytes = 0
    for tile in tiles:
        path = directory / tile["file"]
        receipt_path = path.with_name(path.name + ".capture.json")
        row = {key: tile[key] for key in ("file", "row", "col", "width", "height")}
        row["state"] = "pending"
        if receipt_path.exists():
            try:
                receipt = read_json(receipt_path)
                if (receipt.get("url") != tile["url"]):
                    row.update(state="invalid", error="Receipt belongs to a different request")
                elif (receipt.get("state") == "complete" and receipt.get("status") == 200
                      and path.is_file() and path.stat().st_size == receipt.get("bytes")):
                    if verify:
                        _dem_tile_record(directory, tile, plan["grid"], verify=True)
                    row.update(state="ready", bytes=receipt["bytes"], sha256=receipt["sha256"])
                    retained_bytes += receipt["bytes"]
                else:
                    row.update(state="incomplete", capture_state=receipt.get("state"),
                               status=receipt.get("status"), received_bytes=receipt.get("received_bytes", 0))
                    for key in ("error", "requested_at", "observed_at"):
                        if key in receipt:
                            row[key] = receipt[key]
                    headers = receipt.get("headers", {})
                    if headers.get("Retry-After") is not None:
                        row["retry_after"] = headers["Retry-After"]
            except (ValueError, OSError, KeyError, TypeError) as error:
                row.update(state="invalid", error=type(error).__name__ + ": " + str(error))
        elif path.exists():
            row.update(state="invalid", error="Original body has no HTTP receipt")
        counts[row["state"]] += 1
        rows.append(row)
    result = {"schema": "upstate.3dep-status/v1", "plan_sha256": digest(plan),
              "directory": str(directory.resolve()), "observed_at": now(),
              "counts": counts, "tile_count": len(tiles), "retained_bytes": retained_bytes,
              "tile_checks": "bytes, hashes and TIFF grid" if verify else "receipt and file size",
              "ready_fraction": counts["ready"] / len(tiles) if tiles else 0,
              "tiles": rows, "grid": plan["grid"], "state": "acquiring"}
    if counts["ready"] == len(tiles):
        result["state"] = "ready-to-assemble"
    entry_path = directory / "source-entry.json"
    if entry_path.exists():
        try:
            entry = _dem_complete_entry(directory, plan) if verify else read_json(entry_path)
            if (counts["ready"] != len(tiles)
                    or entry.get("preparation_sha256") != digest(plan)
                    or not (directory / entry["path"]).is_file()
                    or (directory / entry["path"]).stat().st_size != entry["bytes"]):
                raise ValueError("The source entry does not match its retained mosaic")
            result.update(state="complete", source_entry=entry)
        except (ValueError, OSError, KeyError, TypeError) as error:
            result.update(state="invalid-output", output_error=type(error).__name__ + ": " + str(error))
    progress_path = directory / "acquisition-progress.json"
    if progress_path.exists():
        result["last_acquisition"] = read_json(progress_path)
    assembly_path = directory / "assembly-progress.json"
    if assembly_path.exists():
        result["last_assembly"] = read_json(assembly_path)
    return result


def acquire_dem(directory, *, workers=1, progress=None):
    """Acquire the existing original requests; every completed tile survives interruption.

    Worker count affects concurrency only, never grid, tile size or source identity.
    Provider throttling stops new dispatch and records its actual Retry-After.
    Re-enter this operation to reuse completed captures; each URL is attempted once
    per invocation and the original per-file locks prevent a duplicate writer.
    """
    from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
    import time
    if isinstance(workers, bool) or not isinstance(workers, int) or workers <= 0:
        raise ValueError("Workers must be a positive integer")
    directory = Path(directory)
    with held(directory / "prepare.lock", blocking=False):
        plan, tiles = _load_dem_plan(directory)
        started = now()
        clock = time.monotonic()
        rows = [{"file": tile["file"], "state": "pending"} for tile in tiles]
        progress_path = directory / "acquisition-progress.json"
        stop_dispatch = False
        deferred_reason = None
        next_index = 0
        futures = {}
        records = {}
        failures = []

        def publish(state):
            completed = sum(row["state"] == "complete" for row in rows)
            report = {"schema": "upstate.3dep-acquisition/v1", "plan_sha256": digest(plan),
                      "state": state, "started_at": started, "updated_at": now(),
                      "elapsed_seconds": round(time.monotonic() - clock, 6),
                      "workers": workers, "tile_count": len(tiles), "complete_tiles": completed,
                      "failed_tiles": len(failures), "pending_tiles": sum(
                          row["state"] == "pending" for row in rows),
                      "received_bytes": sum(row.get("bytes", 0) for row in rows),
                      "reused_tiles": sum(row.get("reused", False) for row in rows),
                      "tiles": rows}
            if deferred_reason:
                report["provider_deferral"] = deferred_reason
            atomic_json(progress_path, report)
            if progress:
                progress({key: value for key, value in report.items() if key != "tiles"})
            return report

        def one(index):
            tile = tiles[index]
            path = directory / tile["file"]
            receipt_path = path.with_name(path.name + ".capture.json")
            reused = False
            if receipt_path.exists():
                previous = read_json(receipt_path)
                reused = previous.get("state") == "complete" and path.is_file()
            capture(tile["url"], path, maximum_bytes=tile["width"] * tile["height"] * 6 + 4 * 1024 * 1024)
            record = _dem_tile_record(directory, tile, plan["grid"], verify=True)
            return record, reused

        executor = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="upstate-3dep")
        publish("acquiring")
        try:
            while next_index < len(tiles) or futures:
                while not stop_dispatch and next_index < len(tiles) and len(futures) < workers:
                    index = next_index
                    next_index += 1
                    rows[index]["state"] = "receiving"
                    futures[executor.submit(one, index)] = index
                if not futures:
                    break
                done, _ = wait(futures, return_when=FIRST_COMPLETED)
                for future in sorted(done, key=lambda f: futures[f]):
                    index = futures.pop(future)
                    try:
                        record, reused = future.result()
                        records[index] = record
                        rows[index].update(state="complete", reused=reused, **record["capture"])
                    except Exception as error:
                        failure = {"file": tiles[index]["file"], "state": "failed",
                                   "error": type(error).__name__ + ": " + str(error)}
                        if isinstance(error, urllib.error.HTTPError):
                            failure["status"] = error.code
                            after = error.headers.get("Retry-After") if error.headers else None
                            if after is not None:
                                failure["retry_after"] = after
                            if error.code in (401, 403, 429) or (error.code == 503 and after is not None):
                                stop_dispatch = True
                                deferred_reason = {key: value for key, value in failure.items()
                                                   if key != "state"}
                        rows[index] = failure
                        failures.append(failure)
                    publish("draining" if stop_dispatch else "acquiring")
            if failures or len(records) != len(tiles):
                report = publish("deferred" if stop_dispatch else "incomplete")
                first = failures[0]["error"] if failures else "Some original tiles remain pending"
                raise RuntimeError(f"DEM acquisition retained {len(records)}/{len(tiles)} tiles. "
                                   f"{first}. Continue the same directory after the recorded condition is resolved: "
                                   + str(progress_path))
            atomic_json(directory / "tiles.json",
                        {"plan_sha256": digest(plan), "tiles": [records[i] for i in range(len(tiles))]},
                        immutable=True)
            return publish("acquired")
        except BaseException:
            if not failures:
                publish("interrupted")
            for future in futures:
                future.cancel()
            raise
        finally:
            executor.shutdown(wait=True, cancel_futures=True)


def assemble_dem(directory, *, progress=None):
    """Assemble only retained original tiles; this phase makes no HTTP requests."""
    from model import rasters
    import numpy as np
    import rasterio
    from rasterio.windows import Window
    import time
    directory = Path(directory)
    with held(directory / "prepare.lock", blocking=False):
        plan, requests = _load_dem_plan(directory)
        complete = _dem_complete_entry(directory, plan)
        if complete is not None:
            return complete
        grid = plan["grid"]
        vintage = plan["vintage"]
        metadata_filename = plan["metadata_file"]
        tiles = [_dem_tile_record(directory, tile, grid, verify=True) for tile in requests]
        atomic_json(directory / "tiles.json",
                    {"plan_sha256": digest(plan), "tiles": tiles}, immutable=True)
        started = now()
        clock = time.monotonic()

        def emit_assembly(state, finished_tiles, valid_cells, nodata_cells, *, error=None):
            item = {"schema": "upstate.3dep-assembly/v1", "plan_sha256": digest(plan),
                    "state": state, "started_at": started, "updated_at": now(),
                    "elapsed_seconds": round(time.monotonic() - clock, 6),
                    "tile_count": len(tiles), "assembled_tiles": finished_tiles,
                    "valid_cells": valid_cells, "nodata_cells": nodata_cells}
            if error is not None:
                item["error"] = error
            atomic_json(directory / "assembly-progress.json", item)
            if progress:
                progress(item)

        emit_assembly("assembling", 0, 0, 0)
        result_path = directory / "source-entry.json"
        destination = directory / "dem.tif"
        pending = directory / "dem.tif.partial"
        profile = rasters.output_profile(grid)
        valid, missing, low, high = 0, 0, None, None
        finished_tiles = 0
        try:
            with rasterio.Env(GDAL_CACHEMAX=64*1024*1024), rasterio.open(pending, "w", **profile) as out:
                for tile_index, tile in enumerate(tiles):
                    with rasterio.open(directory / tile["file"]) as original:
                        for _, window in original.block_windows(1):
                            data = original.read(1, window=window, masked=True)
                            raw = np.ma.getdata(data)
                            bad = np.ma.getmaskarray(data) | ~np.isfinite(raw)
                            values = raw.copy()
                            values[bad] = profile["nodata"]
                            good = values[~bad]
                            valid += int(good.size)
                            missing += int(bad.sum())
                            if good.size:
                                low = float(good.min()) if low is None else min(low, float(good.min()))
                                high = float(good.max()) if high is None else max(high, float(good.max()))
                            target = Window(window.col_off+tile["col"], window.row_off+tile["row"], window.width, window.height)
                            out.write(values, 1, window=target)
                    finished_tiles = tile_index + 1
                    emit_assembly("assembling", finished_tiles, valid, missing)
                out.update_tags(units="m", source=DEM_SERVICE, source_vintage=vintage,
                                rendering_rule="None", assembly="Original aligned Float32 tile values, no further resampling")
            if not valid:
                raise ValueError("The original elevation exports contain no finite numeric cells")
            with pending.open("rb") as handle:
                os.fsync(handle.fileno())
            os.replace(pending, destination)
            _fsync_directory(directory)
            companions = [describe_file(directory, directory / name)
                          for name in ["plan.json", "tiles.json", metadata_filename]]
            for tile in tiles:
                for name in (tile["file"], tile["file"]+".capture.json"):
                    companions.append(describe_file(directory, directory / name))
            entry = {"id": "usgs-3dep-dem-" + digest(plan)[:16], "title": "USGS 3DEP original elevation mosaic",
                     "kind": "raster", "role": "DEM", "uri": DEM_SERVICE, "vintage": vintage, "units": "m",
                     "resampling": "bilinear", **describe_file(directory, destination), "companions": companions,
                     "preparation_sha256": digest(plan), "grid": grid,
                     "observed": {"valid_cells": valid, "nodata_cells": missing, "minimum_m": low, "maximum_m": high},
                     "derivation": "Provider exports on the original NLCD-aligned 30m grid; exact disjoint pixel assembly"}
            atomic_json(result_path, entry, immutable=True)
            emit_assembly("complete", len(tiles), valid, missing)
            return entry
        except BaseException as error:
            try:
                emit_assembly(
                    "interrupted" if isinstance(error, (KeyboardInterrupt, SystemExit)) else "failed",
                    finished_tiles, valid, missing,
                    error={"type": type(error).__name__, "message": str(error)})
            except Exception:
                # Preserve the original failure if progress storage or its callback fails.
                pass
            raise

def prepare_dem(reference, domain, metadata_path, directory, *, vintage, layer=None,
                where=None, buffer_m=1000, tile_size=2048, workers=1, progress=None):
    """Run the original DEM intake, reusing its immutable plan and original tiles."""
    plan_dem(reference, domain, metadata_path, directory, vintage=vintage,
             layer=layer, where=where, buffer_m=buffer_m, tile_size=tile_size)
    plan, _ = _load_dem_plan(directory)
    with held(Path(directory) / "prepare.lock", blocking=False):
        complete = _dem_complete_entry(directory, plan)
    if complete is not None:
        return complete
    acquire_dem(directory, workers=workers, progress=progress)
    return assemble_dem(directory, progress=progress)


def prepare_prism(directory, *, archive_path=None, capture_path=None, transfer_path=None):
    import rasterio
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / "prepare.lock"):
        source = Path(archive_path).resolve() if archive_path else directory / "prism-ppt-1991-2020-800m.zip"
        transfer_sha = None
        transfer_raw = None
        if transfer_path:
            if not archive_path or capture_path:
                raise ValueError("A received PRISM transfer requires its original archive and transfer result")
            from .source_transfer import received_transfer, capture_from_transfer
            transfer_path = Path(transfer_path).resolve(strict=True)
            transfer_raw = transfer_path.read_bytes()
            transfer_sha = hashlib.sha256(transfer_raw).hexdigest()
            transferred, original = received_transfer(
                transfer_path, source, source_url=PRISM_ANNUAL, maximum_bytes=96*1024*1024)
            receipt = capture_from_transfer(transferred, original, transfer_sha256=transfer_sha)
        elif archive_path:
            if not source.is_file():
                raise ValueError("Select the retained complete original PRISM annual archive")
            receipt_path = Path(capture_path) if capture_path else source.with_name(source.name+".capture.json")
            receipt = read_json(receipt_path)
            if (receipt.get("url") != PRISM_ANNUAL or receipt.get("status") != 200
                    or receipt.get("state") != "complete" or not _matches(source, receipt)):
                raise ValueError("PRISM archive differs from the original complete annual source receipt")
        else:
            receipt = capture(PRISM_ANNUAL, source, maximum_bytes=96*1024*1024)
        result_path = directory / "source-entry.json"
        if result_path.exists():
            entry = read_json(result_path)
            if (entry["original_archive_sha256"] != receipt["sha256"]
                    or not _matches(directory/entry["path"], entry)
                    or (transfer_sha is not None and entry.get("transfer_receipt_sha256") != transfer_sha)):
                raise ValueError("Retained precipitation source differs")
            for item in entry["companions"]:
                if not _matches(directory / item["path"], item):
                    raise ValueError("An original precipitation companion changed")
            return entry
        with zipfile.ZipFile(source) as archive:
            infos = archive.infolist()
            tiffs = [x for x in infos if x.filename.lower().endswith((".tif", ".tiff")) and not x.is_dir()]
            if len(tiffs) != 1 or len({i.filename for i in infos}) != len(infos):
                raise ValueError("Select the single-raster original annual PRISM archive")
            selected = tiffs[0]
            if selected.file_size > 512*1024*1024:
                raise ValueError("Original annual precipitation raster exceeds the declared intake")
            destination = directory / "precipitation.tif"
            pending = directory / "precipitation.tif.partial"
            with archive.open(selected) as original, pending.open("wb") as out:
                for block in iter(lambda: original.read(1024*1024), b""):
                    out.write(block)
                out.flush()
                os.fsync(out.fileno())
            os.replace(pending, destination)
            members = [{"name": info.filename, "bytes": info.file_size, "crc32": f"{info.CRC:08x}"} for info in infos]
        with rasterio.open(destination) as dataset:
            if dataset.count != 1 or not dataset.crs:
                raise ValueError("The original precipitation member lacks its native single-band grid")
            actual = {"crs": dataset.crs.to_wkt(), "transform": list(dataset.transform)[:6],
                      "width": dataset.width, "height": dataset.height, "nodata": dataset.nodata,
                      "dtype": dataset.dtypes[0], "native_tags": dataset.tags(), "resolution": list(dataset.res),
                      "band_scale": dataset.scales[0], "band_offset": dataset.offsets[0]}
            if not math.isfinite(dataset.scales[0]) or dataset.scales[0] <= 0 or dataset.offsets[0] != 0:
                raise ValueError("The original precipitation band requires a different explicit unit conversion")
        # Retain the complete original archive beside its native raster without re-encoding.
        local_archive = directory / "original/prism-ppt-1991-2020-800m.zip"
        local_archive.parent.mkdir(exist_ok=True)
        if local_archive.resolve() != source.resolve():
            from model.common import retain_file
            if not local_archive.exists():
                try:
                    os.link(source, local_archive)
                except OSError as error:
                    import errno
                    if error.errno != errno.EXDEV:
                        raise
                    original_object = retain_file(directory, source, receipt["sha256"])
                    os.link(directory / original_object["object"], local_archive)
            if not _matches(local_archive, receipt):
                raise ValueError("The retained original precipitation archive changed during handoff")
        atomic_json(directory / "original/prism.capture.json", receipt, immutable=True)
        atomic_json(directory / "original/archive-members.json", members, immutable=True)
        if transfer_raw is not None:
            from model.common import atomic_bytes
            atomic_bytes(directory / "original/source-transfer.json", transfer_raw, immutable=True)
        entry = {"id": "prism-ppt-1991-2020-800m", "title": "PRISM 1991-2020 annual precipitation normal",
                 "kind": "raster", "role": "PRECIPITATION", "uri": PRISM_ANNUAL,
                 "vintage": "1991-2020 annual precipitation climate normal",
                 "units": "mm/year", "resampling": "bilinear", **describe_file(directory, destination),
                 "original_archive_sha256": receipt["sha256"], "native_grid": actual,
                 "companions": [describe_file(directory, local_archive),
                                describe_file(directory, directory / "original/prism.capture.json"),
                                describe_file(directory, directory / "original/archive-members.json")],
                 "use": "Annual precipitation as the explicitly selected NDR runoff proxy",
                 "source_resolution": "Original 30-arcsecond (nominal 800m) grid; model alignment retains this source resolution",
                 "citation": {"publisher": "PRISM Group, Oregon State University",
                              "url": "https://prism.oregonstate.edu/", "accessed_at": receipt["observed_at"],
                              "documentation": PRISM_REFERENCE}}
        if transfer_sha is not None:
            entry["transfer_receipt_sha256"] = transfer_sha
            entry["companions"].append(describe_file(directory, directory / "original/source-transfer.json"))
        if actual["band_scale"] != 1:
            entry["conversion"] = {"factor": actual["band_scale"], "target_units": "mm/year",
                                   "reference": "Original PRISM raster band scale metadata retained in native_grid"}
        atomic_json(result_path, entry, immutable=True)
        return entry

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    def add_plan_options(command):
        command.add_argument("--reference", required=True)
        command.add_argument("--domain", required=True)
        command.add_argument("--layer")
        command.add_argument("--where-json")
        command.add_argument("--buffer-m", type=float, default=1000)
        command.add_argument("--service-metadata", required=True)
        command.add_argument("--vintage", required=True)
        command.add_argument("--tile-size", type=int, default=2048)
        command.add_argument("--output", required=True)

    dem = sub.add_parser("dem", help="Prepare original numeric elevation from source through exact assembly")
    add_plan_options(dem)
    dem.add_argument("--workers", type=int, default=1)
    plan = sub.add_parser("dem-plan", help="Save the original grid and portable tile requests")
    add_plan_options(plan)
    acquire = sub.add_parser("dem-acquire", help="Acquire or resume the retained original requests")
    acquire.add_argument("--output", required=True)
    acquire.add_argument("--workers", type=int, default=1)
    assemble = sub.add_parser("dem-assemble", help="Assemble original retained tiles without network access")
    assemble.add_argument("--output", required=True)
    status = sub.add_parser("dem-status", help="Read retained tile progress and final source state")
    status.add_argument("--output", required=True)
    status.add_argument("--verify", action="store_true", help="Also inspect source hashes and TIFF grids")

    prism = sub.add_parser("prism", help="Retain the original annual 800m PRISM normal and its native raster")
    prism.add_argument("--output", required=True)
    prism.add_argument("--archive", help="Reuse the existing source ZIP with its adjacent capture receipt")
    prism.add_argument("--capture", help="Use the original archive receipt at this explicit retained path")
    prism.add_argument("--transfer", help="Receive the existing original archive through its completed SourceArtifacts result")
    args = parser.parse_args(argv)

    def progress(item):
        import sys
        print(json.dumps(item, sort_keys=True, ensure_ascii=False, allow_nan=False), file=sys.stderr, flush=True)

    if args.command in ("dem", "dem-plan"):
        arguments = {"vintage": args.vintage, "layer": args.layer,
                     "where": json.loads(args.where_json) if args.where_json else None,
                     "buffer_m": args.buffer_m, "tile_size": args.tile_size}
        if args.command == "dem":
            result = prepare_dem(args.reference, args.domain, args.service_metadata, args.output,
                                 workers=args.workers, progress=progress, **arguments)
        else:
            result = plan_dem(args.reference, args.domain, args.service_metadata, args.output, **arguments)
    elif args.command == "dem-acquire":
        result = acquire_dem(args.output, workers=args.workers, progress=progress)
    elif args.command == "dem-assemble":
        result = assemble_dem(args.output, progress=progress)
    elif args.command == "dem-status":
        result = dem_status(args.output, verify=args.verify)
    else:
        result = prepare_prism(args.output, archive_path=args.archive, capture_path=args.capture,
                               transfer_path=args.transfer)
    print(json.dumps(result, sort_keys=True, ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
