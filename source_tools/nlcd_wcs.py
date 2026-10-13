"""Acquire and retain Annual NLCD through its original numeric WCS contract.

This source workflow composes the existing scientific workspace and HTTP capture.
It preserves original DescribeCoverage, the selected domain, native GeoTIFF,
source receipts, and a categorical input on the returned native pixel grid.
"""
from __future__ import annotations
import argparse
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import urllib.parse
import xml.etree.ElementTree as ET

from model.common import (atomic_bytes, atomic_json, describe_file, digest,
                          file_digest, held, now, read_json, retain_file)
from model import rasters
from .raster_sources import capture

ENDPOINT = "https://dmsdata.cr.usgs.gov/geoserver/mrlc_Land-Cover-Native_conus_year_data/wcs"
COVERAGE = "mrlc_Land-Cover-Native_conus_year_data__Land-Cover-Native_conus_year_data"
DESCRIPTION_URL = ENDPOINT + "?" + urllib.parse.urlencode([
    ("service", "WCS"), ("version", "2.0.1"), ("request", "DescribeCoverage"),
    ("coverageId", COVERAGE)])
NS = {"wcs": "http://www.opengis.net/wcs/2.0",
      "gml": "http://www.opengis.net/gml/3.2",
      "gmlcov": "http://www.opengis.net/gmlcov/1.0",
      "swe": "http://www.opengis.net/swe/2.0",
      "wcsgs": "http://www.geoserver.org/wcsgs/2.0"}
INT_NODATA = -2147483648

def _text(root, query):
    found = root.find(query, NS)
    if found is None or not found.text or not found.text.strip():
        raise ValueError("Original WCS description omits " + query)
    return found.text.strip()

def _numbers(text, length):
    values = [float(value) for value in text.split()]
    if len(values) != length or not all(math.isfinite(x) for x in values):
        raise ValueError("The original WCS coordinate tuple is invalid")
    return values

def read_description(path):
    raw = Path(path).read_bytes()
    if len(raw) > 4 * 1024 * 1024:
        raise ValueError("Select the original single-coverage description")
    body = gzip.decompress(raw) if raw[:2] == b"\x1f\x8b" else raw
    if len(body) > 4 * 1024 * 1024 or b"<!DOCTYPE" in body.upper():
        raise ValueError("The coverage description is not the expected XML document")
    root = ET.fromstring(body)
    descriptions = root.findall("wcs:CoverageDescription", NS)
    if len(descriptions) != 1:
        raise ValueError("Select the one original Annual NLCD coverage description")
    item = descriptions[0]
    coverage = _text(item, "wcs:CoverageId")
    if coverage != COVERAGE:
        raise ValueError("The description identifies a different source coverage")
    envelope = item.find("gml:boundedBy/gml:EnvelopeWithTimePeriod", NS)
    grid = item.find("gml:domainSet/gml:RectifiedGrid", NS)
    if envelope is None or grid is None or grid.get("dimension") != "2":
        raise ValueError("Annual NLCD requires its original two-dimensional rectified grid")
    axes = envelope.get("axisLabels", "").split()
    if axes != ["X", "Y", "time"]:
        raise ValueError("The source axes require a separately reviewed WCS request")
    low = [int(x) for x in _text(grid, "gml:limits/gml:GridEnvelope/gml:low").split()]
    high = [int(x) for x in _text(grid, "gml:limits/gml:GridEnvelope/gml:high").split()]
    origin = _numbers(_text(grid, "gml:origin/gml:Point/gml:pos"), 2)
    offsets = [_numbers(x.text or "", 2) for x in grid.findall("gml:offsetVector", NS)]
    if (len(low) != 2 or len(high) != 2 or len(offsets) != 2
            or any(a > b for a, b in zip(low, high))
            or offsets[0][1] != 0 or offsets[1][0] != 0
            or not math.isclose(offsets[0][0], 30, abs_tol=1e-5)
            or not math.isclose(offsets[1][1], -30, abs_tol=1e-5)):
        raise ValueError("Select the original north-up 30-metre Annual NLCD grid")
    time_domain = item.find("gmlcov:metadata/gmlcov:Extension/wcsgs:TimeDomain", NS)
    if time_domain is None:
        raise ValueError("The source description omits the available annual editions")
    times = [_text(x, "gml:timePosition") for x in time_domain.findall("gml:TimeInstant", NS)]
    if not times or len(times) != len(set(times)):
        raise ValueError("Original source time values are empty or duplicated")
    fields = item.findall("gmlcov:rangeType/swe:DataRecord/swe:field", NS)
    if len(fields) != 1 or fields[0].get("name") != "PALETTE_INDEX":
        raise ValueError("Select the original scalar land-cover class field")
    nil = [float(x.text) for x in fields[0].findall(
        "swe:Quantity/swe:nilValues/swe:NilValues/swe:nilValue", NS)]
    if not all(math.isfinite(x) and x.is_integer() for x in nil):
        raise ValueError("Original categorical nil values need an explicit interpretation")
    unit = fields[0].find("swe:Quantity/swe:uom", NS)
    native_format = _text(item, "wcs:ServiceParameters/wcs:nativeFormat")
    if native_format.lower() != "image/tiff":
        raise ValueError("The source does not advertise its original TIFF coverage format")
    contract = {
        "coverage_id": coverage, "crs": envelope.get("srsName"),
        "axis_labels": axes, "lower_corner": _numbers(_text(envelope, "gml:lowerCorner"), 2),
        "upper_corner": _numbers(_text(envelope, "gml:upperCorner"), 2),
        "grid_low": low, "grid_high": high, "origin": origin,
        "offset_vectors": offsets, "time_values": times, "time_default": time_domain.get("default"),
        "range_field": "PALETTE_INDEX", "published_nil_values": nil,
        "published_range_unit": unit.get("code") if unit is not None else None,
        "native_format": native_format, "description_sha256": hashlib.sha256(body).hexdigest(),
        "description_bytes": len(body), "stored_description_sha256": hashlib.sha256(raw).hexdigest(),
        "stored_description_bytes": len(raw),
        "stored_description_encoding": "gzip" if raw != body else "identity"}
    return contract, raw, body

def _matches(path, descriptor):
    return (path.is_file() and path.stat().st_size == descriptor["bytes"]
            and file_digest(path) == descriptor["sha256"])

def _retain(source, destination, expected=None):
    source = Path(source).resolve(strict=True)
    destination = Path(destination)
    expected = expected or file_digest(source)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        if file_digest(destination) != expected or destination.stat().st_size != source.stat().st_size:
            raise ValueError("A different original source already occupies " + str(destination))
        return
    try:
        os.link(source, destination)
    except OSError as error:
        import errno
        if error.errno != errno.EXDEV:
            raise
        result = retain_file(destination.parent, source, expected)
        object_path = destination.parent / result["object"]
        os.link(object_path, destination)
        object_path.unlink()
    if file_digest(destination) != expected:
        raise ValueError("Original source changed during its retained handoff")

def _domain_geometry(path, *, layer, where, target_crs):
    """Use the original WBD ring reader for its retained native Esri packet."""
    path = Path(path)
    if not (path.name.endswith(".esri.json") or path.name.endswith(".esri.json.gz")):
        rows, target = rasters.vector_geometry(path, layer=layer, where=where, target_crs=target_crs)
        return rows, {"reader": "model.rasters.vector_geometry", "target_crs": target.to_string()}
    if layer:
        raise ValueError("A retained single-layer Esri collection has no selectable layer name")
    from pyproj import CRS, Transformer
    from shapely.ops import transform
    from source.capture_upstream_network import esri_polygon
    opener = gzip.open if path.name.endswith(".gz") else open
    with opener(path, "rb") as handle:
        body = handle.read(64*1024*1024+1)
    if len(body) > 64*1024*1024:
        raise ValueError("The selected native domain exceeds the retained collection input limit")
    original = json.loads(body)
    if original.get("geometryType") != "esriGeometryPolygon":
        raise ValueError("The selected source is not its original native polygon collection")
    spatial = original.get("spatialReference") or {}
    wkid = spatial.get("latestWkid") or spatial.get("wkid")
    if not wkid and not spatial.get("wkt"):
        raise ValueError("The original native domain omits its source CRS")
    native = CRS.from_user_input("EPSG:" + str(wkid) if wkid else spatial["wkt"])
    target = CRS.from_user_input(target_crs)
    projection = Transformer.from_crs(native, target, always_xy=True)
    identity_field = original.get("objectIdFieldName")
    if not identity_field:
        raise ValueError("The original domain omits its native object-ID field")
    rows, corrections, identities = [], [], set()
    for feature in original["features"]:
        properties = feature["attributes"]
        if where and any(properties.get(k) != v for k, v in where.items()):
            continue
        if properties.get(identity_field) is None:
            raise ValueError("An original domain feature omits its native identity")
        identity = str(properties[identity_field])
        if identity in identities:
            raise ValueError("The selected native domain repeats an original object ID")
        identities.add(identity)
        geometry = esri_polygon(feature.get("geometry"), corrections, identity)
        if native != target:
            geometry = transform(projection.transform, geometry)
        if geometry.is_empty or not geometry.is_valid:
            raise ValueError("The original domain requires a reviewed projected geometry correction")
        rows.append({"id": identity, "properties": properties, "geometry": geometry})
    if not rows:
        raise ValueError("The selected original domain/filter contains no geometry")
    return rows, {"reader": "source.capture_upstream_network.esri_polygon",
                  "reader_git_blob": "106b648d69c2dbe62839e9b2463fbdae3aa4c792",
                  "source_format": "Esri JSON", "source_crs": spatial,
                  "target_crs": target.to_string(), "object_id_field": identity_field,
                  "analysis_corrections": corrections,
                  "original_decoded_sha256": hashlib.sha256(body).hexdigest(),
                  "original_decoded_bytes": len(body)}

def make_plan(description, domain, directory, *, selected_time, buffer_m=1000,
              layer=None, where=None, expected_features=None, description_receipt=None,
              collection=None, collection_reference=None):
    from pyproj import CRS
    if not collection or not isinstance(collection, str) or not collection.strip():
        raise ValueError("Supply the selected published Annual NLCD collection edition")
    if not collection_reference or not str(collection_reference).startswith("https://"):
        raise ValueError("Supply the original collection release or dataset reference")
    contract, raw, body = read_description(description)
    native_crs = CRS.from_user_input(contract["crs"])
    if native_crs.to_epsg() != 5070:
        raise ValueError("Select the observed original EPSG:5070 land-cover coverage")
    if selected_time not in contract["time_values"]:
        raise ValueError("Select an exact time value from the original coverage description")
    if not math.isfinite(buffer_m) or buffer_m <= 0:
        raise ValueError("Supply the positive model-domain buffer in metres")
    domain = Path(domain).resolve(strict=True)
    domain_hash = file_digest(domain)
    rows, domain_reader = _domain_geometry(domain, layer=layer, where=where, target_crs=native_crs)
    if expected_features is not None and len(rows) != expected_features:
        raise ValueError("The domain does not contain the selected original feature count")
    if file_digest(domain) != domain_hash:
        raise ValueError("The original domain changed while its geometry was read")
    union = rasters.polygon_union(rows)
    buffered = union.buffer(buffer_m)
    if buffered.is_empty or not buffered.is_valid:
        raise ValueError("The explicitly buffered source domain is invalid")
    left, bottom, right, top = buffered.bounds
    xmin, ymin = contract["lower_corner"]
    xmax, ymax = contract["upper_corner"]
    if left < xmin or bottom < ymin or right > xmax or top > ymax:
        raise ValueError("The complete selected domain is outside the advertised coverage")
    ox, oy = contract["origin"]
    sx, sy = contract["offset_vectors"][0][0], contract["offset_vectors"][1][1]
    c0 = max(contract["grid_low"][0], math.floor((left-ox)/sx)-1)
    c1 = min(contract["grid_high"][0], math.ceil((right-ox)/sx)+1)
    r0 = max(contract["grid_low"][1], math.floor((top-oy)/sy)-1)
    r1 = min(contract["grid_high"][1], math.ceil((bottom-oy)/sy)+1)
    requested = [ox+c0*sx, oy+r1*sy, ox+c1*sx, oy+r0*sy]
    if c1 <= c0 or r1 <= r0:
        raise ValueError("The selected native coverage window is empty")
    query = [
        ("service", "WCS"), ("version", "2.0.1"), ("request", "GetCoverage"),
        ("coverageId", contract["coverage_id"]), ("format", contract["native_format"]),
        ("subset", "X(" + ",".join(format(x, ".17g") for x in (requested[0], requested[2])) + ")"),
        ("subset", "Y(" + ",".join(format(x, ".17g") for x in (requested[1], requested[3])) + ")"),
        ("subset", 'time("' + selected_time + '")'),
        ("geotiff:compression", "Deflate"), ("geotiff:tiling", "true"),
        ("geotiff:tilewidth", "256"), ("geotiff:tileheight", "256")]
    receipt_raw = Path(description_receipt).read_bytes() if description_receipt else None
    if receipt_raw:
        receipt = json.loads(receipt_raw)
        declared = receipt.get("original_sha256") or receipt.get("sha256")
        if declared != contract["description_sha256"]:
            raise ValueError("The original description receipt names different source bytes")
    plan = {
        "schema": "upstate.annual-nlcd-wcs-plan/v1", "endpoint": ENDPOINT,
        "collection": collection.strip(), "collection_reference": collection_reference,
        "description_uri": DESCRIPTION_URL, "coverage": contract, "time": selected_time,
        "query": [{"name": k, "value": v} for k, v in query],
        "url": ENDPOINT + "?" + urllib.parse.urlencode(query),
        "request_bounds": requested, "native_grid_index_envelope": [c0, r0, c1, r1],
        "domain_sha256": domain_hash, "domain_bytes": domain.stat().st_size,
        "domain_layer": layer, "domain_filter": where, "domain_feature_count": len(rows),
        "domain_reader": domain_reader,
        "domain_bounds": list(union.bounds), "buffered_domain_bounds": list(buffered.bounds),
        "buffer_m": buffer_m, "request_pixel_estimate": (c1-c0+1)*(r1-r0+1),
        "source_resolution_m": 30, "request_resampling": "native grid; no scale or reprojection parameter",
        "compression": "lossless Deflate", "description_receipt_sha256":
            hashlib.sha256(receipt_raw).hexdigest() if receipt_raw else None}
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    atomic_json(directory / "plan.json", plan, immutable=True)
    suffix = ".xml.gz" if contract["stored_description_encoding"] == "gzip" else ".xml"
    atomic_bytes(directory / ("original/coverage-description" + suffix), raw, immutable=True)
    atomic_json(directory / "original/coverage-contract.json", contract, immutable=True)
    if receipt_raw:
        atomic_bytes(directory / "original/description-loader-receipt.json", receipt_raw, immutable=True)
    domain_name = "original/model-domain" + "".join(domain.suffixes)
    _retain(domain, directory / domain_name, domain_hash)
    atomic_json(directory / "original/domain-binding.json", {
        "source_file": domain_name, "sha256": domain_hash, "feature_count": len(rows),
        "layer": layer, "where": where, "buffer_m": buffer_m, "reader": domain_reader,
        "meaning": "Complete selected upstream model domain; original geometry retained"}, immutable=True)
    return plan

def _receive_original(plan, source, source_receipt, directory):
    source = Path(source).resolve(strict=True)
    receipt_raw = Path(source_receipt).read_bytes()
    receipt = json.loads(receipt_raw)
    if (receipt.get("url") != plan["url"] or receipt.get("state") != "complete"
            or not _matches(source, receipt)):
        raise ValueError("The received TIFF does not match the exact original WCS request and receipt")
    if receipt.get("status") != 200:
        provider = receipt.get("provider") or {}
        if (receipt.get("schema") != "upstate.external-original-source/v1"
                or provider.get("type") != "notion_file_upload"
                or provider.get("status") != "uploaded" or not provider.get("file_upload_id")
                or not provider.get("stable_file_reference")
                or provider.get("content_length") != receipt["bytes"]
                or receipt.get("status") is not None):
            raise ValueError("Retain the actual completed HTTP or source-loader receipt")
    destination = directory / "original/annual-nlcd.tif"
    _retain(source, destination, receipt["sha256"])
    atomic_bytes(directory / "original/annual-nlcd.tif.capture.json", receipt_raw, immutable=True)
    return destination, receipt

def _inspect_and_prepare(original, destination, plan):
    import numpy as np
    import rasterio
    from pyproj import CRS
    contract = plan["coverage"]
    with original.open("rb") as src:
        signature = src.read(4)
    if signature not in (b"II*\x00", b"MM\x00*", b"II+\x00", b"MM\x00+"):
        raise ValueError("The retained provider response is not a TIFF coverage; inspect its original body")
    pending = destination.with_name(destination.name + ".partial")
    counts, valid, missing, metadata_nil_cells = {}, 0, 0, 0
    with rasterio.Env(GDAL_CACHEMAX=64*1024*1024), rasterio.open(original) as source:
        if source.count != 1 or source.dtypes[0] != "uint8":
            raise ValueError("The original land-cover coverage is not a single uint8 class band")
        if source.crs != CRS.from_user_input(contract["crs"]):
            raise ValueError("Returned land-cover coordinates differ from the original source CRS")
        t = source.transform
        sx, sy = contract["offset_vectors"][0][0], contract["offset_vectors"][1][1]
        if (t.b or t.d or not math.isclose(t.a, sx, abs_tol=1e-5)
                or not math.isclose(t.e, sy, abs_tol=1e-5)):
            raise ValueError("Returned land-cover cells differ from the native unscaled 30m grid")
        ox, oy = contract["origin"]
        ci, ri = (t.c + t.a/2 - ox)/sx, (t.f + t.e/2 - oy)/sy
        if not math.isclose(ci, round(ci), abs_tol=1e-4) or not math.isclose(ri, round(ri), abs_tol=1e-4):
            raise ValueError("Returned land-cover pixel centres differ from the described native anchor")
        left, bottom, right, top = plan["buffered_domain_bounds"]
        tolerance = max(abs(t.a), abs(t.e))*1e-5
        if (source.bounds.left > left+tolerance or source.bounds.bottom > bottom+tolerance
                or source.bounds.right < right-tolerance or source.bounds.top < top-tolerance):
            raise ValueError("Returned land-cover raster does not cover the complete buffered upstream domain")
        if source.scales[0] != 1 or source.offsets[0] != 0:
            raise ValueError("Original categorical values require an explicit source-scale interpretation")
        observed = {
            "crs": source.crs.to_wkt(), "transform": list(t)[:6], "width": source.width,
            "height": source.height, "dtype": source.dtypes[0], "count": source.count,
            "nodata": source.nodata, "bounds": list(source.bounds), "tags": source.tags(),
            "band_tags": source.tags(1), "band_scale": source.scales[0], "band_offset": source.offsets[0],
            "mask_flags": [[str(x) for x in flags] for flags in source.mask_flag_enums],
            "native_grid_start_indices": [round(ci), round(ri)],
            "published_nil_values": contract["published_nil_values"],
            "published_range_unit": contract["published_range_unit"]}
        try:
            observed["native_colormap"] = {str(k): list(v) for k,v in source.colormap(1).items()}
        except ValueError:
            observed["native_colormap"] = None
        profile = dict(source.profile)
        profile.update(driver="GTiff", dtype="int32", nodata=INT_NODATA, count=1,
                       tiled=True, blockxsize=256, blockysize=256, compress="deflate",
                       predictor=2, BIGTIFF="IF_SAFER")
        profile.pop("photometric", None)
        profile.pop("interleave", None)
        with rasterio.open(pending, "w", **profile) as out:
            for _, window in out.block_windows(1):
                data = source.read(1, window=window, masked=True)
                raw = np.ma.getdata(data)
                native_mask = np.ma.getmaskarray(data)
                declared_nil = np.isin(raw, contract["published_nil_values"])
                metadata_nil_cells += int((declared_nil & ~native_mask).sum())
                mask = native_mask | declared_nil
                values = raw.astype("int32")
                values[mask] = INT_NODATA
                codes, amounts = np.unique(raw[~mask], return_counts=True)
                for code, amount in zip(codes, amounts):
                    key = str(int(code))
                    counts[key] = counts.get(key, 0) + int(amount)
                valid += int((~mask).sum())
                missing += int(mask.sum())
                out.write(values, 1, window=window)
            out.update_tags(
                units="class", source=plan["url"], source_time=plan["time"],
                preparation="Original categorical values copied on the unchanged native grid",
                nil_policy="Native raster mask plus original DescribeCoverage nil values",
                source_description_sha256=contract["description_sha256"])
    if valid == 0:
        raise ValueError("The selected source coverage contains no valid land-cover cells")
    with pending.open("rb") as src:
        os.fsync(src.fileno())
    os.replace(pending, destination)
    fd = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
    observed.update(valid_cells=valid, nodata_cells=missing, class_counts=counts,
                    extra_published_nil_cells=metadata_nil_cells,
                    prepared_nodata=INT_NODATA, prepared_dtype="int32")
    return observed

def prepare(description, domain, directory, *, selected_time, buffer_m=1000,
            layer=None, where=None, expected_features=None, description_receipt=None,
            original=None, original_receipt=None, maximum_bytes=512*1024*1024,
            collection=None, collection_reference=None):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / "prepare.lock"):
        plan = make_plan(description, domain, directory, selected_time=selected_time,
                         buffer_m=buffer_m, layer=layer, where=where,
                         expected_features=expected_features, description_receipt=description_receipt,
                         collection=collection, collection_reference=collection_reference)
        output = directory / "source-entry.json"
        if output.exists():
            entry = read_json(output)
            if entry.get("preparation_sha256") != digest(plan) or not _matches(directory/entry["path"], entry):
                raise ValueError("The saved NLCD source belongs to another preparation")
            for companion in entry["companions"]:
                if not _matches(directory/companion["path"], companion):
                    raise ValueError("A retained original NLCD companion has changed")
            atomic_json(directory/"sources.json", {"schema": "upstate.sources/v1", "entries": [entry]}, immutable=True)
            return entry
        if bool(original) != bool(original_receipt):
            raise ValueError("Select the original TIFF and its exact source receipt together")
        if original:
            source, receipt = _receive_original(plan, original, original_receipt, directory)
        else:
            source = directory / "original/annual-nlcd.tif"
            receipt = capture(plan["url"], source, maximum_bytes=maximum_bytes)
        observed = _inspect_and_prepare(source, directory/"land-cover.tif", plan)
        atomic_json(directory/"original/native-raster.json", observed, immutable=True)
        paths = ["plan.json"] + sorted(
            p.relative_to(directory).as_posix() for p in (directory/"original").rglob("*")
            if p.is_file() and not p.name.endswith((".lock", ".partial")))
        companions = [describe_file(directory, directory/name) for name in paths]
        entry = {
            "id": "usgs-annual-nlcd-" + plan["time"][:4] + "-" + digest(plan)[:16],
            "title": "USGS Annual NLCD " + plan["time"][:4] + " original land-cover classes",
            "kind": "raster", "role": "NLCD", "units": "class", "resampling": "nearest",
            "uri": plan["url"], "vintage": plan["collection"] + "; explicit source time " + plan["time"],
            "collection_reference": plan["collection_reference"],
            **describe_file(directory, directory/"land-cover.tif"),
            "preparation_sha256": digest(plan), "original_raster_sha256": receipt["sha256"],
            "source_time": plan["time"], "source_description_sha256": plan["coverage"]["description_sha256"],
            "model_domain_sha256": plan["domain_sha256"], "domain_feature_count": plan["domain_feature_count"],
            "buffer_m": buffer_m, "native_grid": observed,
            "derivation": "Native WCS class values copied without spatial resampling; source-declared nil cells normalized",
            "companions": companions}
        atomic_json(output, entry, immutable=True)
        atomic_json(directory/"sources.json", {"schema": "upstate.sources/v1", "entries": [entry]}, immutable=True)
        return entry

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("plan", "capture", "receive"))
    parser.add_argument("--description", required=True)
    parser.add_argument("--description-receipt")
    parser.add_argument("--collection", required=True)
    parser.add_argument("--collection-reference", required=True)
    parser.add_argument("--domain", required=True)
    parser.add_argument("--layer")
    parser.add_argument("--where-json")
    parser.add_argument("--expected-features", type=int)
    parser.add_argument("--time", required=True, help="Exact published annual time value")
    parser.add_argument("--buffer-m", type=float, default=1000)
    parser.add_argument("--output", required=True)
    parser.add_argument("--original", help="Already received original WCS TIFF")
    parser.add_argument("--original-receipt", help="Exact HTTP or external-original-source receipt")
    parser.add_argument("--maximum-bytes", type=int, default=512*1024*1024)
    args = parser.parse_args(argv)
    options = dict(selected_time=args.time, buffer_m=args.buffer_m, layer=args.layer,
                   where=json.loads(args.where_json) if args.where_json else None,
                   expected_features=args.expected_features, description_receipt=args.description_receipt,
                   collection=args.collection, collection_reference=args.collection_reference)
    if args.maximum_bytes < 1:
        parser.error("--maximum-bytes must be positive")
    if args.command == "plan":
        with held(Path(args.output)/"prepare.lock"):
            result = make_plan(args.description, args.domain, args.output, **options)
    else:
        if args.command == "receive" and (not args.original or not args.original_receipt):
            parser.error("receive requires --original and --original-receipt")
        if args.command == "capture" and (args.original or args.original_receipt):
            parser.error("Use receive for an already acquired original TIFF")
        result = prepare(args.description, args.domain, args.output,
                         original=args.original, original_receipt=args.original_receipt,
                         maximum_bytes=args.maximum_bytes, **options)
    print(json.dumps(result, indent=2, sort_keys=True, allow_nan=False))

if __name__ == "__main__":
    main()
