"""Retain original Annual NLCD native WPS crops and adopt the complete source.

This composes the maintained nlcd_wcs source validator. Requests use the public
named native coverage, an explicitly selected dated granule basename, and exact
native pixel windows from the already-retained model-domain plan.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

from model.common import atomic_bytes, atomic_json, describe_file, digest, file_digest, held, now, read_json
from . import nlcd_wcs

ENDPOINT = "https://dmsdata.cr.usgs.gov/geoserver/ows"
CATALOG_COVERAGE = "mrlc_Land-Cover-Native_conus_year_data:Land-Cover-Native_conus_year_data"
FORMAT = "upstate.annual-nlcd-native-wps/v1"
TIFF_SIGNATURES = (b"II*\x00", b"MM\x00*", b"II+\x00", b"MM\x00+")
XML_NS = {"wps": "http://www.opengis.net/wps/1.0.0", "ows": "http://www.opengis.net/ows/1.1"}


def _integer(value, name, minimum=1):
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ValueError(name + " must be an integer >= " + str(minimum))
    return value


def _check_url(value):
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
        raise ValueError("Supply the original public HTTPS source reference")
    return value


def _file_record(root, path):
    return describe_file(root, path)


def _verify(root, record):
    path = Path(root) / record["path"]
    if not nlcd_wcs._matches(path, record):
        raise ValueError("Retained original source changed: " + str(path))
    return path


def _xml_escape(value):
    return (value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;").replace("'", "&apos;"))


def _filter(basename, version="1.1"):
    # An anchored basename suffix prevents a parent directory containing the year
    # from matching every other annual granule.
    escaped = basename.replace("!", "!!").replace("*", "!*").replace("?", "!?")
    escape_attribute = "escapeChar" if version == "1.1" else "escape"
    return ('<ogc:Filter xmlns:ogc="http://www.opengis.net/ogc">'
            '<ogc:PropertyIsLike wildCard="*" singleChar="?" ' + escape_attribute + '="!">'
            '<ogc:PropertyName>location</ogc:PropertyName><ogc:Literal>*'
            + _xml_escape(escaped) + '</ogc:Literal></ogc:PropertyIsLike></ogc:Filter>')


def _wkt(bounds):
    left, bottom, right, top = bounds
    pairs = ((left, bottom), (right, bottom), (right, top), (left, top), (left, bottom))
    return "POLYGON ((" + ", ".join(format(x, ".17g") + " " + format(y, ".17g") for x, y in pairs) + "))"


def request_for(bounds, basename, *, transport):
    geometry = _wkt(bounds)
    if transport == "get":
        inner_query = {
            "service": "WPS", "version": "1.0.0", "request": "Execute",
            "identifier": "gs:GetFullCoverage",
            "DataInputs": "name=" + CATALOG_COVERAGE + ";filter=" + _filter(basename, "1.0"),
            "RawDataOutput": "result",
        }
        inner = "http://geoserver/wps?" + urllib.parse.urlencode(inner_query)
        query = {
            "service": "WPS", "version": "1.0.0", "request": "Execute",
            "identifier": "gs:CropCoverage",
            "DataInputs": "coverage=@href=" + inner + "@mimetype=image/tiff;cropShape="
                          + geometry + "@mimetype=application/wkt",
            "RawDataOutput": "result",
        }
        return {"method": "GET", "url": ENDPOINT + "?" + urllib.parse.urlencode(query),
                "body": None, "headers": {"Accept": "image/tiff, application/xml"}}
    if transport != "post":
        raise ValueError("Select the reviewed original GET or POST transport")
    body = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<wps:Execute service="WPS" version="1.0.0" '
        'xmlns:wps="http://www.opengis.net/wps/1.0.0" '
        'xmlns:ows="http://www.opengis.net/ows/1.1" '
        'xmlns:xlink="http://www.w3.org/1999/xlink">'
        '<ows:Identifier>gs:CropCoverage</ows:Identifier><wps:DataInputs><wps:Input>'
        '<ows:Identifier>coverage</ows:Identifier>'
        '<wps:Reference mimeType="image/tiff" xlink:href="http://geoserver/wps" method="POST">'
        '<wps:Body><wps:Execute service="WPS" version="1.0.0">'
        '<ows:Identifier>gs:GetFullCoverage</ows:Identifier><wps:DataInputs>'
        '<wps:Input><ows:Identifier>name</ows:Identifier><wps:Data><wps:LiteralData>'
        + CATALOG_COVERAGE + '</wps:LiteralData></wps:Data></wps:Input>'
        '<wps:Input><ows:Identifier>filter</ows:Identifier><wps:Data>'
        '<wps:ComplexData mimeType="text/xml; subtype=filter/1.1">' + _filter(basename)
        + '</wps:ComplexData></wps:Data></wps:Input></wps:DataInputs><wps:ResponseForm>'
        '<wps:RawDataOutput mimeType="image/tiff"><ows:Identifier>result</ows:Identifier>'
        '</wps:RawDataOutput></wps:ResponseForm></wps:Execute></wps:Body></wps:Reference>'
        '</wps:Input><wps:Input><ows:Identifier>cropShape</ows:Identifier><wps:Data>'
        '<wps:ComplexData mimeType="application/wkt">' + geometry
        + '</wps:ComplexData></wps:Data></wps:Input></wps:DataInputs><wps:ResponseForm>'
        '<wps:RawDataOutput mimeType="image/tiff"><ows:Identifier>result</ows:Identifier>'
        '</wps:RawDataOutput></wps:ResponseForm></wps:Execute>'
    )
    return {"method": "POST", "url": ENDPOINT, "body": body,
            "headers": {"Content-Type": "application/xml; charset=utf-8", "Accept": "image/tiff, application/xml"}}


def _native_window(plan, col, row, width, height):
    contract = plan["coverage"]
    ox, oy = contract["origin"]
    sx, sy = contract["offset_vectors"][0][0], contract["offset_vectors"][1][1]
    # Coverage origin is a pixel centre. Crop rectangles enclose whole cells.
    left = ox + (col - 0.5) * sx
    right = ox + (col + width - 0.5) * sx
    top = oy + (row - 0.5) * sy
    bottom = oy + (row + height - 0.5) * sy
    return {"native_col": col, "native_row": row, "width": width, "height": height,
            "bounds": [left, bottom, right, top],
            "transform": [sx, 0.0, left, 0.0, sy, top]}


def make_operation(plan_path, description, domain, directory, *, granule_basename,
                   granule_reference, collection_reference, tile_size=2048, transport="post",
                   probe=False):
    plan_path, description, domain = (Path(p).resolve(strict=True) for p in (plan_path, description, domain))
    plan_raw = plan_path.read_bytes()
    plan = json.loads(plan_raw)
    if plan.get("schema") != "upstate.annual-nlcd-wcs-plan/v1":
        raise ValueError("Select the existing evaluated Annual NLCD source plan")
    if plan.get("endpoint") != nlcd_wcs.ENDPOINT:
        raise ValueError("The original plan selects another published source service")
    contract, description_raw, _ = nlcd_wcs.read_description(description)
    if contract != plan.get("coverage"):
        raise ValueError("The description and evaluated native plan differ")
    if file_digest(domain) != plan["domain_sha256"] or domain.stat().st_size != plan["domain_bytes"]:
        raise ValueError("The domain differs from the exact retained plan")
    if plan.get("domain_feature_count") != 217 or plan.get("buffer_m") != 1000:
        raise ValueError("This operation requires the original 217-feature domain plus its 1000-metre buffer")
    if contract["coverage_id"] != nlcd_wcs.COVERAGE:
        raise ValueError("The plan selects another native coverage")
    year = plan["time"][:4]
    if not re.fullmatch(r"\d{4}", year) or not re.fullmatch(r"[A-Za-z0-9_.-]+", granule_basename):
        raise ValueError("Supply one dated original granule basename without a directory or wildcard")
    # The explicit selected year must be present in the basename. Its source
    # reference is kept alongside the exact suffix filter used by the reader.
    if year not in granule_basename:
        raise ValueError("The selected dated granule basename does not bind the plan year")
    tile_size = _integer(tile_size, "tile_size")
    if tile_size > 8192:
        raise ValueError("Keep original native requests at or below 8192 pixels on each axis")
    _check_url(granule_reference)
    _check_url(collection_reference)
    c0, r0, c1, r1 = plan["native_grid_index_envelope"]
    for value in (c0, r0, c1, r1):
        _integer(value, "native grid index", minimum=0)
    if c1 < c0 or r1 < r0:
        raise ValueError("The retained native-grid envelope is empty")
    if probe:
        # Four cells at the centre of the same model request, not a new study or
        # a national corner that could be entirely nodata.
        col, row = (c0 + c1) // 2, (r0 + r1) // 2
        windows = [_native_window(plan, col, row, 2, 2)]
    else:
        windows = [_native_window(plan, col, row, min(tile_size, c1-col+1), min(tile_size, r1-row+1))
                   for row in range(r0, r1+1, tile_size) for col in range(c0, c1+1, tile_size)]
    tiles = []
    for index, window in enumerate(windows):
        request = request_for(window["bounds"], granule_basename, transport=transport)
        tiles.append({"key": "tile-" + format(index, "04d"), **window,
                      "request": request, "request_sha256": digest(request)})
    operation = {
        "schema": FORMAT, "purpose": "four-cell original-domain probe" if probe else "complete original regional source",
        "mode": "probe" if probe else "regional", "plan_sha256": hashlib.sha256(plan_raw).hexdigest(),
        "description_sha256": contract["description_sha256"], "domain_sha256": plan["domain_sha256"],
        "domain_feature_count": 217, "buffer_m": 1000, "coverage_name": CATALOG_COVERAGE,
        "source_time": plan["time"], "collection": plan["collection"],
        "original_plan_collection_reference": plan["collection_reference"],
        "collection_reference": collection_reference, "granule_basename": granule_basename,
        "granule_reference": granule_reference, "granule_filter": _filter(granule_basename),
        "selection_meaning": "Only a location ending in the complete explicitly selected dated basename",
        "grid": _native_window(plan, c0, r0, c1-c0+1, r1-r0+1),
        "published_nil_values": contract["published_nil_values"], "transport": transport,
        "tile_size": tile_size, "tiles": tiles,
    }
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    atomic_json(directory / "operation.json", operation, immutable=True)
    nlcd_wcs._retain(plan_path, directory / "original/plan.json", operation["plan_sha256"])
    description_name = "coverage-description.xml.gz" if description_raw[:2] == b"\x1f\x8b" else "coverage-description.xml"
    nlcd_wcs._retain(description, directory / "original" / description_name, file_digest(description))
    domain_name = "model-domain" + "".join(domain.suffixes)
    nlcd_wcs._retain(domain, directory / "original" / domain_name, plan["domain_sha256"])
    atomic_json(directory / "original/source-binding.json", {
        "description": description_name, "domain": domain_name, "operation_id": digest(operation),
        "plan_sha256": operation["plan_sha256"], "granule_reference": granule_reference,
        "granule_basename": granule_basename,
        "collection_reference": collection_reference,
    }, immutable=True)
    return operation


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(req.full_url, code, "Retain a reviewed original endpoint before following a redirect", headers, fp)


def _exceptions(path):
    if path.stat().st_size > 4 * 1024 * 1024:
        return ["The original non-TIFF response exceeds the XML inspection size"]
    raw = path.read_bytes()
    if b"<!DOCTYPE" in raw.upper():
        return ["Original response contains an XML document type; retained without expansion"]
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return ["Original response is not a TIFF or a parseable OGC XML response"]
    texts = [" ".join((node.text or "").split()) for node in root.iter()
             if node.tag.rsplit("}", 1)[-1] in ("ExceptionText", "ServiceException")]
    return [value for value in texts if value] or ["Original XML contains no completed raw TIFF output"]


def _fetch(directory, tile, *, timeout, maximum_bytes, retry_uncertain=False, retry_failed=False):
    directory = Path(directory)
    receipt_path = directory / "receipt.json"
    if receipt_path.exists():
        receipt = read_json(receipt_path)
        if receipt["request_sha256"] != tile["request_sha256"]:
            raise ValueError("The existing tile belongs to another exact original request")
        _verify(directory, receipt["body"])
        return receipt
    attempts = sorted((path for path in (directory/"attempts").glob("*")
                       if path.is_dir() and path.name.isdigit()), key=lambda path: int(path.name))
    prior = [path/"state.json" for path in attempts if (path/"state.json").is_file()]
    if prior:
        latest = read_json(prior[-1])
        if latest.get("request_sha256") != tile["request_sha256"]:
            raise ValueError("The previous original attempt belongs to a different request")
        if latest.get("state") == "complete":
            # Complete original bytes may outlive a process interrupted just
            # before its convenience receipt was written.
            body = _verify(directory, latest["body"])
            with body.open("rb") as handle:
                signature = handle.read(4)
            if latest.get("http_status") != 200 or signature not in TIFF_SIGNATURES:
                raise ValueError("The saved completed attempt is not its original HTTP200 TIFF")
            atomic_json(receipt_path, latest, immutable=True)
            return latest
        if latest.get("state") in ("issued", "transport_uncertain") and not retry_uncertain:
            raise RuntimeError("Original request may still be executing. Reconnect its owner/status or explicitly use --retry-uncertain: " + str(prior[-1]))
        if latest.get("state") in ("response_failed", "response_too_large") and not retry_failed:
            raise RuntimeError("Read the retained original response before --retry-failed: " + str(prior[-1]))
    # Orphan directories can precede state.json; preserve them and allocate the
    # next numeric directory rather than colliding with the interrupted one.
    next_attempt = max((int(path.name) for path in attempts), default=0)+1
    attempt = directory / "attempts" / format(next_attempt, "04d")
    attempt.mkdir(parents=True, exist_ok=False)
    request = tile["request"]
    atomic_json(attempt / "request.json", request, immutable=True)
    data = request["body"].encode("utf-8") if request["body"] is not None else None
    if data is not None:
        atomic_bytes(attempt / "request.xml", data, immutable=True)
    state = {"schema": "upstate.original-wps-http/v1", "state": "issued", "issued_at": now(),
             "request_sha256": tile["request_sha256"], "request": request,
             "timeout_seconds": timeout, "maximum_bytes": maximum_bytes}
    atomic_json(attempt / "state.json", state)
    pending = attempt / "response.partial"
    received, hasher = 0, hashlib.sha256()
    response_meta = {}
    opener = urllib.request.build_opener(_NoRedirect)
    req = urllib.request.Request(request["url"], data=data, headers=request["headers"], method=request["method"])
    try:
        try:
            response = opener.open(req, timeout=timeout)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            response_meta = {"http_status": response.code, "response_url": response.geturl(),
                             "response_headers": list(response.headers.items())}
            with pending.open("xb") as out:
                while True:
                    part = response.read(min(1024*1024, maximum_bytes-received+1))
                    if not part:
                        break
                    out.write(part)
                    hasher.update(part)
                    received += len(part)
                    if received > maximum_bytes:
                        raise OverflowError("Original response exceeds selected maximum_bytes")
                out.flush()
                os.fsync(out.fileno())
        body = attempt / "response.body"
        os.replace(pending, body)
        with body.open("rb") as handle:
            signature = handle.read(4)
        state.update(response_meta)
        state.update(completed_at=now(), body=_file_record(directory, body))
        if response_meta["http_status"] != 200 or signature not in TIFF_SIGNATURES:
            state.update(state="response_failed", exceptions=_exceptions(body))
            atomic_json(attempt / "state.json", state)
            raise RuntimeError("Original WPS response: " + "; ".join(state["exceptions"]))
        state["state"] = "complete"
        atomic_json(attempt / "state.json", state)
        atomic_json(receipt_path, state, immutable=True)
        return state
    except RuntimeError:
        raise
    except Exception as error:
        if pending.exists():
            state["partial"] = _file_record(directory, pending)
        state.update(response_meta)
        state.update(state="response_too_large" if isinstance(error, OverflowError) else "transport_uncertain",
                     observed_at=now(), error={"type": type(error).__name__, "message": str(error)},
                     received_bytes=received, received_sha256=hasher.hexdigest())
        atomic_json(attempt / "state.json", state)
        raise


def _inspect_tile(path, tile, plan):
    import numpy as np
    import rasterio
    from pyproj import CRS
    from rasterio.windows import Window

    with rasterio.open(path) as source:
        if source.count != 1 or source.dtypes[0] != "uint8":
            raise ValueError("Native source crop must have one uint8 class band")
        if source.crs != CRS.from_user_input(plan["coverage"]["crs"]):
            raise ValueError("Original native crop CRS differs from the retained source description")
        transform = source.transform
        expected = tile["transform"]
        if (abs(transform.b) > 1e-12 or abs(transform.d) > 1e-12
                or not math.isclose(transform.a, expected[0], rel_tol=1e-9, abs_tol=1e-5)
                or not math.isclose(transform.e, expected[4], rel_tol=1e-9, abs_tol=1e-5)):
            raise ValueError("Native crop resolution/orientation differs from the original grid")
        col = (expected[2]-transform.c)/transform.a
        row = (expected[5]-transform.f)/transform.e
        if not math.isclose(col, round(col), abs_tol=1e-4) or not math.isclose(row, round(row), abs_tol=1e-4):
            raise ValueError("Native crop pixel centres do not align with the retained original anchor")
        col, row = round(col), round(row)
        if col < 0 or row < 0 or col+tile["width"] > source.width or row+tile["height"] > source.height:
            raise ValueError("Returned native crop omits requested original cells")
        if source.scales[0] != 1 or source.offsets[0] != 0:
            raise ValueError("Native categorical crop has an unexpected scale/offset")
        window = Window(col, row, tile["width"], tile["height"])
        counts, valid, missing = {}, 0, 0
        for rowoff in range(0, tile["height"], 256):
            strip = Window(col, row+rowoff, tile["width"], min(256, tile["height"]-rowoff))
            data = source.read(1, window=strip, masked=True)
            raw = np.ma.getdata(data)
            mask = np.ma.getmaskarray(data) | np.isin(raw, plan["coverage"]["published_nil_values"])
            codes, amounts = np.unique(raw[~mask], return_counts=True)
            for code, amount in zip(codes, amounts):
                key = str(int(code))
                counts[key] = counts.get(key, 0)+int(amount)
            valid += int((~mask).sum())
            missing += int(mask.sum())
        return {"crs": source.crs.to_wkt(), "transform": list(transform)[:6],
                "width": source.width, "height": source.height, "dtype": source.dtypes[0],
                "nodata": source.nodata, "source_window": [col, row, tile["width"], tile["height"]],
                "valid_cells": valid, "nodata_cells": missing, "class_counts": counts,
                "source_tags": source.tags(), "band_tags": source.tags(1),
                "scale": source.scales[0], "offset": source.offsets[0]}


def _mosaic(directory, operation, plan, completed):
    import numpy as np
    import rasterio
    from rasterio.transform import Affine
    from rasterio.windows import Window
    from pyproj import CRS

    destination = directory / "native-mosaic.tif"
    descriptor_path = directory / "native-mosaic.json"
    if descriptor_path.exists():
        descriptor = read_json(descriptor_path)
        if descriptor["operation_id"] != digest(operation):
            raise ValueError("The retained native mosaic belongs to another source operation")
        _verify(directory, descriptor["artifact"])
        return destination
    grid = operation["grid"]
    nils = plan["coverage"]["published_nil_values"]
    if not nils or any(value != int(value) or not 0 <= value <= 255 for value in nils):
        raise ValueError("Native mosaic requires the original uint8 nil value")
    nodata = int(nils[0])
    pending = directory / "native-mosaic.partial.tif"
    # A prior incomplete derived mosaic can be rebuilt from completed original
    # responses. Never delete or overwrite the retained source response bodies.
    if pending.exists():
        pending.unlink()
    profile = {"driver": "GTiff", "dtype": "uint8", "nodata": nodata, "count": 1,
               "crs": CRS.from_user_input(plan["coverage"]["crs"]).to_wkt(), "transform": Affine(*grid["transform"]),
               "width": grid["width"], "height": grid["height"], "tiled": True,
               "blockxsize": 256, "blockysize": 256, "compress": "deflate", "BIGTIFF": "IF_SAFER"}
    total_pixels = 0
    with rasterio.Env(GDAL_CACHEMAX=32*1024*1024, GDAL_NUM_THREADS="1"), rasterio.open(pending, "w", **profile) as out:
        for tile, receipt, observed in completed:
            source_path = _verify(directory / "tiles" / tile["key"], receipt["body"])
            col, row, width, height = observed["source_window"]
            destination_col = tile["native_col"]-grid["native_col"]
            destination_row = tile["native_row"]-grid["native_row"]
            with rasterio.open(source_path) as source:
                for rowoff in range(0, height, 256):
                    rows = min(256, height-rowoff)
                    data = source.read(1, window=Window(col, row+rowoff, width, rows), masked=True)
                    raw = np.ma.getdata(data)
                    mask = np.ma.getmaskarray(data) | np.isin(raw, nils)
                    values = raw.copy()
                    values[mask] = nodata
                    out.write(values, 1, window=Window(destination_col, destination_row+rowoff, width, rows))
            total_pixels += width*height
        if total_pixels != grid["width"]*grid["height"]:
            raise ValueError("The completed source crops do not cover the entire planned native window")
        out.update_tags(
            source_operation=digest(operation), source_time=operation["source_time"], units="class",
            preparation="Disjoint original native-grid crop windows copied without spatial resampling",
            granule_basename=operation["granule_basename"], native_nodata_policy="Original mask plus published nil values")
    with pending.open("rb") as handle:
        os.fsync(handle.fileno())
    os.replace(pending, destination)
    atomic_json(descriptor_path, {
        "operation_id": digest(operation), "artifact": _file_record(directory, destination),
        "meaning": "Derived lossless mosaic of the retained original WPS response windows",
        "tile_count": len(completed), "copied_cells": total_pixels,
        "source_resampling": "none; exact integer windows on original native grid",
    }, immutable=True)
    return destination


def _domain_support(path, domain, plan):
    """Count actual original class coverage in every selected source polygon."""
    import numpy as np
    import rasterio
    from rasterio.features import geometry_mask, geometry_window
    from rasterio.windows import Window
    from shapely.geometry import mapping

    results = []
    with rasterio.Env(GDAL_CACHEMAX=32*1024*1024), rasterio.open(path) as source:
        rows, reader = nlcd_wcs._domain_geometry(
            domain, layer=plan.get("domain_layer"), where=plan.get("domain_filter"),
            target_crs=source.crs)
        if len(rows) != plan["domain_feature_count"]:
            raise ValueError("Original domain feature count changed during source support calculation")
        for row in rows:
            geometry = mapping(row["geometry"])
            window = geometry_window(source, [geometry])
            selected, valid = 0, 0
            counts = {}
            for rowoff in range(0, int(window.height), 256):
                current = Window(int(window.col_off), int(window.row_off)+rowoff,
                                 int(window.width), min(256, int(window.height)-rowoff))
                inside = geometry_mask([geometry], out_shape=(int(current.height), int(current.width)),
                                       transform=source.window_transform(current),
                                       invert=True, all_touched=False)
                data = source.read(1, window=current, masked=True)
                raw = np.ma.getdata(data)
                available = inside & ~np.ma.getmaskarray(data)
                selected += int(inside.sum())
                valid += int(available.sum())
                codes, amounts = np.unique(raw[available], return_counts=True)
                for code, amount in zip(codes, amounts):
                    key = str(int(code))
                    counts[key] = counts.get(key, 0)+int(amount)
            results.append({"source_id": row["id"], "properties": row["properties"],
                            "selected_cells": selected, "valid_cells": valid,
                            "missing_cells": selected-valid,
                            "valid_fraction": valid/selected if selected else None,
                            "class_counts": counts, "complete": selected > 0 and valid == selected})
    return {"schema": "upstate.annual-nlcd-domain-support/v1",
            "domain_sha256": plan["domain_sha256"], "feature_count": len(results),
            "cell_selection": "Native pixel centre inside each original projected polygon",
            "reader": reader, "features": results,
            "complete": all(row["complete"] for row in results),
            "complete_features": sum(row["complete"] for row in results),
            "feature_sum_selected_cells": sum(row["selected_cells"] for row in results),
            "feature_sum_valid_cells": sum(row["valid_cells"] for row in results),
            "aggregation": "Feature sums count any overlapping source polygons separately"}


def _adopt(directory, operation, plan, completed):
    manifest_path = directory / "sources.json"
    entry_path = directory / "source-entry.json"
    if entry_path.exists():
        entry = read_json(entry_path)
        if entry.get("preparation_sha256") != digest(operation):
            raise ValueError("The existing source entry belongs to another exact operation")
        _verify(directory, entry)
        for companion in entry["companions"]:
            _verify(directory, companion)
        atomic_json(manifest_path, {"schema": "upstate.sources/v1", "entries": [entry]}, immutable=True)
        return entry
    native = _mosaic(directory, operation, plan, completed)
    observed = nlcd_wcs._inspect_and_prepare(native, directory / "land-cover.tif", plan)
    atomic_json(directory / "native-raster.json", observed, immutable=True)
    binding = read_json(directory/"original/source-binding.json")
    support = _domain_support(directory/"land-cover.tif", directory/"original"/binding["domain"], plan)
    atomic_json(directory/"domain-support.json", support, immutable=True)
    if not support["complete"]:
        incomplete = [row["source_id"] for row in support["features"] if not row["complete"]]
        raise ValueError("Original native land-cover cells are missing inside source polygons: "
                         + ", ".join(incomplete) + ". Actual counts are retained in domain-support.json")
    companion_paths = [directory / "operation.json", directory / "native-raster.json",
                       directory / "native-mosaic.json", directory / "domain-support.json", native]
    companion_paths += [path for path in (directory/"original").rglob("*") if path.is_file()]
    for tile, receipt, _ in completed:
        tile_dir = directory / "tiles" / tile["key"]
        companion_paths.extend(path for path in tile_dir.rglob("*") if path.is_file()
                               and not path.name.endswith((".lock", ".partial")))
    companions = [_file_record(directory, path) for path in sorted(set(companion_paths))]
    entry = {
        "id": "usgs-annual-nlcd-wps-" + operation["source_time"][:4] + "-" + digest(operation)[:16],
        "title": "USGS Annual NLCD " + operation["source_time"][:4] + " original native land-cover classes",
        "kind": "raster", "role": "NLCD", "units": "class", "resampling": "nearest",
        "uri": ENDPOINT, "vintage": operation["collection"] + "; source time " + operation["source_time"],
        "collection_reference": operation["collection_reference"],
        **_file_record(directory, directory / "land-cover.tif"),
        "preparation_sha256": digest(operation), "source_time": operation["source_time"],
        "source_description_sha256": operation["description_sha256"],
        "model_domain_sha256": operation["domain_sha256"], "domain_feature_count": 217, "buffer_m": 1000,
        "granule_basename": operation["granule_basename"], "granule_reference": operation["granule_reference"],
        "granule_filter": operation["granule_filter"],
        "source_protocol": "WPS1.0 internal catalog read followed by native coverage crop",
        "source_request_count": len(completed), "native_grid": observed,
        "domain_support": {"path": "domain-support.json", "complete_features": support["complete_features"],
                           "feature_count": support["feature_count"], "complete": support["complete"]},
        "derivation": "Original native class windows mosaicked without resampling; native mask and published nil cells normalized",
        "companions": companions,
    }
    atomic_json(entry_path, entry, immutable=True)
    atomic_json(manifest_path, {"schema": "upstate.sources/v1", "entries": [entry]}, immutable=True)
    return entry


def receive(directory, *, timeout=180, maximum_bytes=64*1024*1024,
            retry_uncertain=False, retry_failed=False, plan_only=False):
    directory = Path(directory)
    timeout = _integer(timeout, "timeout")
    maximum_bytes = _integer(maximum_bytes, "maximum_bytes")
    with held(directory / "receive.lock"):
        operation = read_json(directory / "operation.json")
        if operation.get("schema") != FORMAT:
            raise ValueError("Select the existing native WPS operation")
        plan_path = directory / "original/plan.json"
        if file_digest(plan_path) != operation["plan_sha256"]:
            raise ValueError("The retained original model plan changed")
        plan = read_json(plan_path)
        binding = read_json(directory / "original/source-binding.json")
        if binding["operation_id"] != digest(operation):
            raise ValueError("The retained source binding differs from this operation")
        if file_digest(directory/"original"/binding["domain"]) != operation["domain_sha256"]:
            raise ValueError("The retained original model domain changed")
        contract, _, _ = nlcd_wcs.read_description(directory/"original"/binding["description"])
        if contract != plan["coverage"]:
            raise ValueError("The retained original coverage description changed")
        if plan_only:
            return {"operation_id": digest(operation), "mode": operation["mode"],
                    "tile_count": len(operation["tiles"]), "directory": str(directory),
                    "planned_pixels": sum(t["width"]*t["height"] for t in operation["tiles"])}
        completed = []
        for tile in operation["tiles"]:
            if digest(tile["request"]) != tile["request_sha256"]:
                raise ValueError("A retained tile request changed")
            tile_dir = directory / "tiles" / tile["key"]
            receipt = _fetch(tile_dir, tile, timeout=timeout, maximum_bytes=maximum_bytes,
                             retry_uncertain=retry_uncertain, retry_failed=retry_failed)
            path = _verify(tile_dir, receipt["body"])
            observed = _inspect_tile(path, tile, plan)
            atomic_json(tile_dir/"native-raster.json", observed, immutable=True)
            completed.append((tile, receipt, observed))
            print(json.dumps({"operation_id": digest(operation), "tile": tile["key"], "state": "complete",
                              "completed_tiles": len(completed), "total_tiles": len(operation["tiles"]),
                              "valid_cells": observed["valid_cells"], "bytes": receipt["body"]["bytes"]}),
                  flush=True)
        if operation["mode"] == "probe":
            result = {"schema": "upstate.annual-nlcd-native-probe/v1", "operation_id": digest(operation),
                      "directory": str(directory), "source_time": operation["source_time"],
                      "granule_basename": operation["granule_basename"], "native_raster": completed[0][2],
                      "receipt": completed[0][1]}
            atomic_json(directory/"probe-result.json", result, immutable=True)
            return result
        return _adopt(directory, operation, plan, completed)


def receive_file(directory, key, original, original_receipt):
    """Adopt an actual completed GET response captured by the existing loader."""
    directory = Path(directory)
    with held(directory / "receive.lock"):
        operation = read_json(directory/"operation.json")
        if operation.get("schema") != FORMAT or operation["transport"] != "get":
            raise ValueError("A public URL-loader response belongs to a retained GET operation")
        matches = [tile for tile in operation["tiles"] if tile["key"] == key]
        if len(matches) != 1:
            raise ValueError("Select exactly one retained source tile key")
        tile = matches[0]
        directory_for_tile = directory/"tiles"/key
        receipt_path = directory_for_tile/"receipt.json"
        if receipt_path.exists():
            previous = read_json(receipt_path)
            existing = _verify(directory_for_tile, previous["body"])
            if (file_digest(original) != file_digest(existing)
                    or previous["request_sha256"] != tile["request_sha256"]):
                raise ValueError("The completed tile already retains another original response")
            return previous
        # This maintained receiver verifies exact URL, actual byte count/SHA and
        # either HTTP200 or the original completed external-provider reference.
        target, provider_receipt = nlcd_wcs._receive_original(
            {"url": tile["request"]["url"]}, original, original_receipt, directory_for_tile)
        with target.open("rb") as handle:
            if handle.read(4) not in TIFF_SIGNATURES:
                raise ValueError("The original loader response is not a TIFF; retained response is available for diagnosis")
        plan_path = directory/"original/plan.json"
        if file_digest(plan_path) != operation["plan_sha256"]:
            raise ValueError("The retained original model plan changed")
        observed = _inspect_tile(target, tile, read_json(plan_path))
        receipt = {"schema": "upstate.original-wps-http/v1", "state": "complete",
                   "request": tile["request"], "request_sha256": tile["request_sha256"],
                   "received_at": now(), "body": _file_record(directory_for_tile, target),
                   "http_status": provider_receipt.get("status"),
                   "provider_receipt": provider_receipt,
                   "meaning": "Original public GET source response retained by the named source provider"}
        atomic_json(directory_for_tile/"native-raster.json", observed, immutable=True)
        atomic_json(receipt_path, receipt, immutable=True)
        return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("plan", "probe", "capture", "resume", "receive-file"))
    parser.add_argument("--output", required=True)
    parser.add_argument("--tile")
    parser.add_argument("--original")
    parser.add_argument("--original-receipt")
    parser.add_argument("--plan")
    parser.add_argument("--description")
    parser.add_argument("--domain")
    parser.add_argument("--granule-basename")
    parser.add_argument("--granule-reference")
    parser.add_argument("--collection-reference")
    parser.add_argument("--tile-size", type=int, default=2048)
    parser.add_argument("--transport", choices=("post", "get"), default="post")
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--maximum-bytes", type=int, default=64*1024*1024)
    parser.add_argument("--retry-uncertain", action="store_true")
    parser.add_argument("--retry-failed", action="store_true")
    args = parser.parse_args(argv)
    if args.command == "receive-file":
        if not all((args.tile, args.original, args.original_receipt)):
            parser.error("receive-file requires --tile, --original and --original-receipt")
        result = receive_file(args.output, args.tile, args.original, args.original_receipt)
        print(json.dumps(result, indent=2, sort_keys=True, allow_nan=False))
        return
    if args.command != "resume":
        missing = [name for name in ("plan", "description", "domain", "granule_basename",
                                    "granule_reference", "collection_reference")
                   if not getattr(args, name)]
        if missing:
            parser.error("Supply original source bindings: " + ", ".join("--"+name.replace("_", "-") for name in missing))
        with held(Path(args.output)/"receive.lock"):
            make_operation(args.plan, args.description, args.domain, args.output,
                           granule_basename=args.granule_basename, granule_reference=args.granule_reference,
                           collection_reference=args.collection_reference, tile_size=args.tile_size,
                           transport=args.transport, probe=args.command == "probe")
    result = receive(args.output, timeout=args.timeout, maximum_bytes=args.maximum_bytes,
                     retry_uncertain=args.retry_uncertain, retry_failed=args.retry_failed,
                     plan_only=args.command == "plan")
    print(json.dumps(result, indent=2, sort_keys=True, allow_nan=False))


if __name__ == "__main__":
    main()
