"""Receive saved USGS elevation requests on a network-equipped Linux host.

Only the Python standard library is required. The existing GIS DEM receiver
validates TIFF grids and numerical cells after transport.
"""
from __future__ import annotations

import argparse
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import re
import tempfile
import time
import urllib.error
import urllib.parse
import zipfile

from model.common import atomic_json, canonical, digest, file_digest, held, now, read_json, relative_file
from .raster_sources import DEM_SERVICE, EXPORT_REFERENCE, capture

SCHEMA = "upstate.3dep-transfer/v1"
STATUS_SCHEMA = "upstate.3dep-transfer-status/v1"


def _integer(value, label, minimum=0):
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ValueError(label + " must be an integer at least " + str(minimum))
    return value


def _finite(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(label + " must be finite")
    return value



def _declared_epsg(crs):
    """Read the CRS-level EPSG ID without substituting a nested datum/unit ID."""
    direct = re.fullmatch(r"EPSG\s*:\s*([1-9][0-9]*)", crs.strip(), re.IGNORECASE)
    if direct:
        return direct.group(1)
    depth, index, quoted, start = 0, 0, False, None
    codes = set()
    while index < len(crs):
        char = crs[index]
        if char == '"':
            if quoted and index+1 < len(crs) and crs[index+1] == '"':
                index += 2
                continue
            quoted = not quoted
        elif not quoted:
            if char in "[(":
                if depth == 1:
                    token_end = index
                    while token_end and crs[token_end-1].isspace():
                        token_end -= 1
                    token_start = token_end
                    while token_start and (crs[token_start-1].isalnum() or crs[token_start-1] == "_"):
                        token_start -= 1
                    if crs[token_start:token_end].upper() in ("AUTHORITY", "ID"):
                        start = token_start
                depth += 1
            elif char in "])":
                depth -= 1
                if depth < 0:
                    raise ValueError("The retained CRS declaration has unmatched brackets")
                if depth == 1 and start is not None:
                    clause = crs[start:index+1]
                    code = re.match(
                        r'(?:AUTHORITY|ID)\s*[\[(]\s*"EPSG"\s*,\s*"?([1-9][0-9]*)"?\s*(?=,|\]|\))',
                        clause, re.IGNORECASE)
                    if code:
                        codes.add(code.group(1))
                    start = None
        index += 1
    if quoted or depth or len(codes) > 1:
        raise ValueError("The retained CRS declaration is incomplete or has conflicting root IDs")
    return next(iter(codes), None)


def selection(directory):
    """Validate the frozen GIS plan and exact disjoint HTTP request selection."""
    directory = Path(directory).resolve(strict=True)
    plan_path = relative_file(directory, "plan.json")
    requests_path = relative_file(directory, "requests.json")
    plan = read_json(plan_path)
    if (plan.get("schema") != "upstate.3dep-native-source/v1"
            or plan.get("source") != DEM_SERVICE
            or plan.get("export_contract") != EXPORT_REFERENCE):
        raise ValueError("Select the original saved 3DEP source plan")
    for name in ("reference_sha256", "domain_sha256", "metadata_sha256", "metadata_decoded_sha256"):
        if not isinstance(plan.get(name), str) or not re.fullmatch(r"[0-9a-f]{64}", plan[name]):
            raise ValueError("The saved plan has an invalid " + name)
    plan_sha = digest(plan)
    requests = read_json(requests_path)
    if not isinstance(requests, dict) or set(requests) != {"plan_sha256", "tiles"}:
        raise ValueError("The saved requests must contain the original plan binding and tiles")
    if requests["plan_sha256"] != plan_sha or not isinstance(requests["tiles"], list):
        raise ValueError("The tile requests belong to another source plan")
    grid = plan["grid"]
    width = _integer(grid["width"], "Grid width", 1)
    height = _integer(grid["height"], "Grid height", 1)
    tile_size = _integer(plan["tile_size"], "Tile size", 1)
    transform = grid["transform"]
    if not isinstance(transform, list) or len(transform) != 6:
        raise ValueError("The saved grid needs its six original affine values")
    a, b, left, d, e, top = [_finite(value, "Affine value") for value in transform]
    if (a, b, d, e) != (30, 0, 0, -30):
        raise ValueError("The saved DEM grid must retain its unrotated 30 m cells")
    if not isinstance(grid.get("crs"), str) or not grid["crs"].strip():
        raise ValueError("The saved grid needs its original CRS")
    if _finite(plan["buffer_m"], "Domain buffer") <= 0:
        raise ValueError("The saved positive domain buffer is required")
    if not isinstance(plan.get("vintage"), str) or not plan["vintage"].strip():
        raise ValueError("The retained service edition is required")
    fixed = {"pixel_type": "F32", "rendering_rule": {"rasterFunction": "None"},
             "interpolation": "RSP_BilinearInterpolation", "compression": "LZ77"}
    if any(plan.get(key) != value for key, value in fixed.items()):
        raise ValueError("The saved plan must keep the original numeric elevation request")

    metadata_name = plan["metadata_file"]
    encoding = plan.get("metadata_encoding")
    expected_metadata = {"identity": "original/service.json", "gzip": "original/service.json.gz"}
    if encoding not in expected_metadata or metadata_name != expected_metadata[encoding]:
        raise ValueError("Use the original retained elevation service metadata member")
    metadata_path = relative_file(directory, metadata_name)
    raw = metadata_path.read_bytes()
    decoded = gzip.decompress(raw) if encoding == "gzip" else raw
    if (hashlib.sha256(raw).hexdigest() != plan["metadata_sha256"]
            or hashlib.sha256(decoded).hexdigest() != plan["metadata_decoded_sha256"]):
        raise ValueError("The original elevation service metadata changed")
    metadata = json.loads(decoded)
    limits = [int(metadata.get("maxImageWidth", 0)), int(metadata.get("maxImageHeight", 0))]
    if (metadata.get("bandCount") != 1 or metadata.get("pixelType") != "F32"
            or "Image" not in metadata.get("capabilities", "")
            or "None" not in [row.get("name") for row in metadata.get("rasterFunctionInfos", [])]
            or tile_size > min(limits)):
        raise ValueError("The saved request exceeds its retained numeric service contract")

    expected_count = ((width + tile_size - 1) // tile_size) * ((height + tile_size - 1) // tile_size)
    tiles = requests["tiles"]
    if len(tiles) != expected_count:
        raise ValueError("The original disjoint request set is incomplete")
    origin = urllib.parse.urlsplit(DEM_SERVICE)
    reference = None
    reference_binding = None
    declared_epsg = _declared_epsg(grid["crs"])
    index = 0
    for row in range(0, height, tile_size):
        for col in range(0, width, tile_size):
            tile = tiles[index]
            index += 1
            if not isinstance(tile, dict) or set(tile) != {
                    "row", "col", "width", "height", "bbox", "file", "url"}:
                raise ValueError("A tile no longer has its original request fields")
            w, h = min(tile_size, width-col), min(tile_size, height-row)
            bbox = [left + col*a, top + (row+h)*e, left + (col+w)*a, top + row*e]
            expected = {"row": row, "col": col, "width": w, "height": h,
                        "bbox": bbox, "file": f"original/3dep-r{row:06d}-c{col:06d}.tif"}
            for key in ("row", "col", "width", "height"):
                _integer(tile[key], "Tile " + key, 0 if key in ("row", "col") else 1)
            if not isinstance(tile["bbox"], list) or len(tile["bbox"]) != 4:
                raise ValueError("An original tile bounding box is missing")
            for value in tile["bbox"]:
                _finite(value, "Tile bounding box")
            if any(tile.get(key) != value for key, value in expected.items()):
                raise ValueError("The request set changed its grid, order, coverage or filenames")
            url = tile["url"]
            if not isinstance(url, str):
                raise ValueError("An original tile URL is missing")
            parsed = urllib.parse.urlsplit(url)
            if (parsed.scheme != origin.scheme or parsed.netloc != origin.netloc
                    or parsed.path != origin.path + "/exportImage" or parsed.fragment):
                raise ValueError("Tile transport accepts only the original USGS exportImage origin")
            pairs = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True, strict_parsing=True)
            query = dict(pairs)
            if len(query) != len(pairs):
                raise ValueError("An original tile URL contains duplicate query parameters")
            spatial_reference = query.get("imageSR")
            if not isinstance(spatial_reference, str) or not spatial_reference:
                raise ValueError("An original request CRS is missing")
            if re.fullmatch(r"[1-9][0-9]*", spatial_reference):
                if declared_epsg is not None and spatial_reference != declared_epsg:
                    raise ValueError("The numeric request CRS differs from the saved grid's root EPSG ID")
                reference_binding = "declared_epsg" if declared_epsg else "gis_inferred_epsg"
            else:
                if spatial_reference != json.dumps({"wkt": grid["crs"]}, separators=(",", ":")):
                    raise ValueError("The original request WKT differs from its saved grid")
                reference_binding = "exact_wkt"
            if reference is None:
                reference = spatial_reference
            elif reference != spatial_reference:
                raise ValueError("The original tile requests must use one retained CRS")
            expected_query = {
                "f": "image", "bbox": ",".join(format(value, ".17g") for value in bbox),
                "bboxSR": spatial_reference, "imageSR": spatial_reference, "size": f"{w},{h}",
                "adjustAspectRatio": "false", "format": "tiff", "pixelType": "F32",
                "bandIds": "0", "renderingRule": '{"rasterFunction":"None"}',
                "interpolation": "RSP_BilinearInterpolation", "compression": "LZ77"}
            if (query != expected_query
                    or url != DEM_SERVICE + "/exportImage?" + urllib.parse.urlencode(expected_query)):
                raise ValueError("An original USGS export URL changed its exact query")
    return {"directory": directory, "plan": plan, "plan_sha256": plan_sha, "tiles": tiles,
            "requests_sha256": file_digest(requests_path), "metadata_file": metadata_name,
            "request_crs": reference, "request_crs_binding": reference_binding}


def _tile_state(directory, tile, *, verify=False):
    path = directory / tile["file"]
    receipt_path = path.with_name(path.name + ".capture.json")
    row = {key: tile[key] for key in ("file", "row", "col", "width", "height")}
    row["state"] = "pending"
    if not receipt_path.exists():
        if path.exists():
            row.update(state="invalid", error="Original body has no capture receipt")
        return row
    try:
        receipt = read_json(receipt_path)
        if not isinstance(receipt, dict) or receipt.get("url") != tile["url"]:
            raise ValueError("The original capture receipt belongs to another request")
        if receipt.get("state") == "complete":
            expected_bytes = _integer(receipt["bytes"], "Captured bytes", 1)
            expected_sha = receipt["sha256"]
            if not isinstance(expected_sha, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_sha):
                raise ValueError("The original capture digest is invalid")
            if (receipt.get("status") != 200 or not path.is_file()
                    or path.stat().st_size != expected_bytes):
                raise ValueError("The original complete body and receipt differ")
            if verify and file_digest(path) != expected_sha:
                raise ValueError("The original captured body changed")
            row.update(state="complete", bytes=expected_bytes, sha256=expected_sha,
                       observed_at=receipt.get("observed_at"))
        else:
            row.update(state="incomplete", capture_state=receipt.get("state"),
                       received_bytes=receipt.get("received_bytes", 0), status=receipt.get("status"))
            if receipt.get("error"):
                row["error"] = receipt["error"]
            headers = receipt.get("headers", {})
            if isinstance(headers, dict) and headers.get("Retry-After") is not None:
                row["retry_after"] = headers["Retry-After"]
    except (ValueError, TypeError, KeyError, OSError) as error:
        row.update(state="invalid", error=type(error).__name__ + ": " + str(error))
    return row


def inspect_transfer(directory, *, verify=False):
    selected = selection(directory)
    rows = [_tile_state(selected["directory"], tile, verify=verify) for tile in selected["tiles"]]
    counts = {state: sum(row["state"] == state for row in rows)
              for state in ("complete", "pending", "incomplete", "invalid")}
    return {"schema": STATUS_SCHEMA, "plan_sha256": selected["plan_sha256"],
            "requests_sha256": selected["requests_sha256"], "observed_at": now(),
            "request_crs": selected["request_crs"],
            "request_crs_binding": selected["request_crs_binding"],
            "directory": str(selected["directory"]), "tile_count": len(rows), "counts": counts,
            "state": "transferred" if counts["complete"] == len(rows) else "incomplete",
            "retained_bytes": sum(row.get("bytes", 0) for row in rows),
            "verification": "HTTP identity and SHA-256" if verify else "HTTP identity and body length",
            "next_operation": "GIS dem-status --verify, then dem-assemble",
            "tiles": rows}


def receive(directory, *, workers=1, progress=None):
    """Receive every selected original entity once; reuse complete capture receipts."""
    _integer(workers, "Workers", 1)
    directory = Path(directory)
    with held(directory / "prepare.lock", blocking=False):
        selected = selection(directory)
        directory, tiles = selected["directory"], selected["tiles"]
        rows = [{"file": tile["file"], "state": "pending"} for tile in tiles]
        started, timer = now(), time.monotonic()
        next_index, completed, reused = 0, 0, 0
        deferred = None
        failures = []
        futures = {}
        progress_path = directory / "transfer-progress.json"

        def emit(state):
            report = {"schema": SCHEMA, "plan_sha256": selected["plan_sha256"],
                      "requests_sha256": selected["requests_sha256"], "state": state,
                      "request_crs": selected["request_crs"],
                      "request_crs_binding": selected["request_crs_binding"],
                      "started_at": started, "updated_at": now(), "workers": workers,
                      "elapsed_seconds": round(time.monotonic()-timer, 6), "tile_count": len(tiles),
                      "complete_tiles": completed, "reused_tiles": reused,
                      "pending_tiles": sum(row["state"] == "pending" for row in rows),
                      "failed_tiles": len(failures),
                      "received_bytes": sum(row.get("bytes", 0) for row in rows),
                      "verification": "Original HTTP entities; GIS validation follows transfer",
                      "tiles": rows}
            if deferred:
                report["provider_deferral"] = deferred
            atomic_json(progress_path, report)
            if progress:
                progress({key: value for key, value in report.items() if key != "tiles"})
            return report

        def one(index):
            tile = tiles[index]
            before = _tile_state(directory, tile)
            record = capture(tile["url"], directory / tile["file"],
                             maximum_bytes=tile["width"]*tile["height"]*6+4*1024*1024)
            after = _tile_state(directory, tile)
            if after["state"] != "complete":
                raise ValueError(after.get("error", "Original entity has no complete HTTP receipt"))
            return record, before["state"] == "complete"

        executor = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="upstate-dem-transfer")
        try:
            emit("receiving")
            while next_index < len(tiles) or futures:
                while deferred is None and next_index < len(tiles) and len(futures) < workers:
                    index = next_index
                    next_index += 1
                    rows[index]["state"] = "receiving"
                    futures[executor.submit(one, index)] = index
                if not futures:
                    break
                done, _ = wait(futures, return_when=FIRST_COMPLETED)
                for future in sorted(done, key=lambda item: futures[item]):
                    index = futures.pop(future)
                    try:
                        receipt, was_reused = future.result()
                        rows[index].update(state="complete", bytes=receipt["bytes"],
                                           sha256=receipt["sha256"], reused=was_reused,
                                           observed_at=receipt["observed_at"])
                        completed += 1
                        reused += int(was_reused)
                    except Exception as error:
                        failure = {"file": tiles[index]["file"], "state": "failed",
                                   "error": type(error).__name__ + ": " + str(error)}
                        if isinstance(error, urllib.error.HTTPError):
                            failure["status"] = error.code
                            retry_after = error.headers.get("Retry-After") if error.headers else None
                            if retry_after is not None:
                                failure["retry_after"] = retry_after
                            if error.code in (401, 403, 429) or (error.code == 503 and retry_after is not None):
                                deferred = {key: value for key, value in failure.items() if key != "state"}
                        elif isinstance(error, (urllib.error.URLError, TimeoutError)):
                            deferred = {key: value for key, value in failure.items() if key != "state"}
                        elif isinstance(error, OSError) and error.errno == 28:
                            deferred = {key: value for key, value in failure.items() if key != "state"}
                        failures.append(failure)
                        rows[index] = failure
                    emit("draining" if deferred else "receiving")
            if failures or completed != len(tiles):
                report = emit("deferred" if deferred else "incomplete")
                raise RuntimeError(
                    f"Received {completed}/{len(tiles)} original tiles; continue the same directory "
                    f"after the retained condition is resolved. Progress: {progress_path}")
            return emit("transferred")
        except BaseException:
            for future in futures:
                future.cancel()
            if not failures:
                emit("interrupted")
            raise
        finally:
            executor.shutdown(wait=True, cancel_futures=True)


def bundle(directory, archive):
    """Carry the saved selection and completed original tile/receipt pairs together."""
    directory = Path(directory)
    archive = Path(archive).resolve()
    archive.parent.mkdir(parents=True, exist_ok=True)
    with held(directory / "prepare.lock", blocking=False):
        selected = selection(directory)
        directory = selected["directory"]
        if archive.is_relative_to(directory):
            raise ValueError("Write the transfer ZIP outside the selected source directory")
        if archive.exists():
            raise ValueError("Select a new transfer archive path; keep the earlier received edition")
        status = inspect_transfer(directory, verify=True)
        files = ["plan.json", "requests.json", selected["metadata_file"]]
        for row in status["tiles"]:
            if row["state"] == "complete":
                files.extend((row["file"], row["file"] + ".capture.json"))
        verified = {row["file"]: row for row in status["tiles"] if row["state"] == "complete"}
        members = []
        for name in files:
            path = relative_file(directory, name)
            record = verified.get(name)
            members.append({"path": name, "bytes": record["bytes"] if record else path.stat().st_size,
                            "sha256": record["sha256"] if record else file_digest(path)})
        manifest = {"schema": "upstate.3dep-transfer-bundle/v1",
                    "plan_sha256": selected["plan_sha256"],
                    "requests_sha256": selected["requests_sha256"],
                    "created_at": now(), "tile_count": len(selected["tiles"]),
                    "complete_tiles": status["counts"]["complete"],
                    "transport_complete": status["state"] == "transferred",
                    "verification": "Original HTTP entities and SHA-256; GIS verification is the receiving step",
                    "files": members, "tile_status": status["tiles"]}
        descriptor, name = tempfile.mkstemp(prefix=".dem-transfer-", suffix=".zip", dir=archive.parent)
        os.close(descriptor)
        pending = Path(name)
        try:
            with zipfile.ZipFile(pending, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as out:
                for member in members:
                    out.write(directory / member["path"], member["path"])
                out.writestr("transfer-bundle.json", canonical(manifest) + b"\n")
            with pending.open("rb") as stream:
                os.fsync(stream.fileno())
            os.replace(pending, archive)
            fd = os.open(archive.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
        finally:
            if pending.exists():
                pending.unlink()
        return {"schema": "upstate.3dep-transfer-bundle-result/v1",
                "archive": str(archive), "bytes": archive.stat().st_size, "sha256": file_digest(archive),
                "plan_sha256": selected["plan_sha256"],
                "requests_sha256": selected["requests_sha256"],
                "complete_tiles": status["counts"]["complete"],
                "tile_count": len(selected["tiles"]), "transport_complete": status["state"] == "transferred"}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    inspect = commands.add_parser("inspect", help="Read original source request and capture state")
    inspect.add_argument("--output", required=True)
    inspect.add_argument("--verify", action="store_true", help="Check original body SHA-256s")
    transport = commands.add_parser("receive", help="Receive the exact original saved requests")
    transport.add_argument("--output", required=True)
    transport.add_argument("--workers", type=int, default=1)
    package = commands.add_parser("bundle", help="Package the selected original completed entities")
    package.add_argument("--output", required=True)
    package.add_argument("--archive", required=True)
    args = parser.parse_args(argv)

    def progress(item):
        import sys
        print(json.dumps(item, sort_keys=True, ensure_ascii=False, allow_nan=False),
              file=sys.stderr, flush=True)

    try:
        if args.command == "inspect":
            result = inspect_transfer(args.output, verify=args.verify)
        elif args.command == "receive":
            result = receive(args.output, workers=args.workers, progress=progress)
        else:
            result = bundle(args.output, args.archive)
    except Exception as error:
        import sys
        print(json.dumps({"ok": False, "error": type(error).__name__ + ": " + str(error),
                          "source_directory": args.output}, sort_keys=True, allow_nan=False),
              file=sys.stderr, flush=True)
        return 1
    print(json.dumps(result, sort_keys=True, ensure_ascii=False, indent=2, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
