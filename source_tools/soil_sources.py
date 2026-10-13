"""Prepare original USDA whole-soil K on the retained NLCD grid.

Geometry comes from native SDA geographic AOIs. Coefficients come from its
unchanged whole-soil interpretation over the actual observed mapunit keys.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
import datetime as dt
from decimal import Decimal
import email.utils
import gzip
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

from model.common import (atomic_bytes, atomic_json, describe_file, digest,
                          file_digest, held, now, read_json)
from model import rasters

SERVICE = "https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest"
REFERENCE = "https://sdmdataaccess.nrcs.usda.gov/documents/AdvancedQueries.html"
K_REFERENCE = "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/sdr.html"
K_FACTOR = Decimal("0.1317")
K_UNITS = "t*ha*h/(ha*MJ*mm)"
ATTR_QUERY = ("SELECT * FROM sdvattribute WHERE attributename LIKE '%K Factor%' "
              "OR attributename LIKE '%Erodibility%'")
HEADERS = ("Date", "Content-Type", "Content-Length", "Content-Encoding", "ETag",
           "Last-Modified", "Retry-After")
POLYGON_FUNCTION = "SDA_Get_AoiSoilMapunitPolygon_By_AoiId"
POLYGON_ID = "AoiSoilMapUnitPolygonID"
POLYGON_FIELDS = ("AoiId", "AoiPartID", POLYGON_ID, "MapUnitKey", "MuPolygonKey",
                  "AreaSymbol", "MapUnitName", "MapUnitSymbol",
                  "NationalMapUnitSymbol", "SpatialVersion", "AreaAcres")

def _int(value):
    text = str(value)
    if not re.fullmatch(r"[0-9]+", text):
        raise ValueError("Expected an actual nonnegative native integer, received " + repr(value))
    return int(text)

def _fsync(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)

def _decode(wire, headers):
    encoding = headers.get("Content-Encoding", "").strip().lower()
    if encoding not in ("", "identity", "gzip"):
        raise ValueError("Retained SDA response uses unsupported content encoding: " + encoding)
    if encoding == "gzip":
        with gzip.GzipFile(fileobj=io.BytesIO(wire), mode="rb") as stream:
            decoded = stream.read(128 * 1024 * 1024 + 1)
    else:
        decoded = wire
    if len(decoded) > 128 * 1024 * 1024:
        raise ValueError("Decoded native SDA response exceeds the declared source limit")
    return decoded

def _retry_at(record):
    value = record.get("headers", {}).get("Retry-After")
    if not value:
        return None
    if value.isdecimal():
        origin_text = record.get("observed_at") or record.get("recovery_observed_at")
        if not origin_text:
            raise ValueError("Record the actual recovery time before continuing this retained Retry-After")
        origin = dt.datetime.fromisoformat(origin_text)
        return origin + dt.timedelta(seconds=int(value))
    try:
        parsed = email.utils.parsedate_to_datetime(value)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=dt.timezone.utc)
    except (TypeError, ValueError):
        raise ValueError("Inspect the retained provider Retry-After value before continuing")

class Sda:
    """One source capture directory with original request and response bytes."""
    def __init__(self, root, *, resume=False):
        self.root = Path(root)
        self.resume = resume

    def _received(self, directory, record):
        body = directory / record["stored_file"]
        pending = body.with_name(body.name + ".partial")
        chosen = body if body.is_file() else pending
        if (not chosen.is_file() or chosen.stat().st_size != record["stored_bytes"]
                or file_digest(chosen) != record["stored_sha256"]):
            raise ValueError("Original SDA response storage changed: " + str(chosen))
        with gzip.open(chosen, "rb") as source:
            wire = source.read(record["bytes"] + 1)
        if len(wire) != record["bytes"] or hashlib.sha256(wire).hexdigest() != record["sha256"]:
            raise ValueError("Original SDA response bytes changed")
        if chosen == pending:
            os.replace(pending, body)
            _fsync(directory)
        if record["state"] != "complete":
            record["state"] = "complete"
            atomic_json(directory / record["receipt_file"], record)
        return _decode(wire, record.get("headers", {}))

    def post(self, name, fields, *, maximum_bytes=32 * 1024 * 1024):
        directory = self.root / "original" / name
        directory.mkdir(parents=True, exist_ok=True)
        fields = {key: str(value) for key, value in fields.items()}
        payload = urllib.parse.urlencode(sorted(fields.items())).encode("utf-8")
        intent = {"schema": "upstate.sda-request/v1", "url": SERVICE,
                  "method": "POST", "content_type": "application/x-www-form-urlencoded",
                  "fields": fields, "request_sha256": hashlib.sha256(payload).hexdigest(),
                  "maximum_response_bytes": maximum_bytes}
        atomic_json(directory / "request.json", intent, immutable=True)
        previous_paths = sorted(directory.glob("[0-9][0-9][0-9][0-9].capture.json"))
        prior = read_json(previous_paths[-1]) if previous_paths else None
        if prior:
            if prior["request_sha256"] != intent["request_sha256"]:
                raise ValueError("Original source request identity differs")
            if prior["state"] in ("received", "complete"):
                decoded = self._received(directory, prior)
                if prior["status"] == 200:
                    return decoded
                if prior["status"] not in (408, 429, 500, 502, 503, 504):
                    raise ValueError("Original SDA HTTP " + str(prior["status"]) + " response is retained")
            if not self.resume:
                raise ValueError("Continue the retained incomplete source request with --resume")
            if (prior.get("headers", {}).get("Retry-After", "").isdecimal()
                    and not prior.get("observed_at") and not prior.get("recovery_observed_at")):
                # A killed receiver can retain HTTP headers before it records
                # completion. Observe recovery once, retaining the full original
                # backoff interval without inventing a provider receipt time.
                prior["recovery_observed_at"] = now()
                atomic_json(directory / prior["receipt_file"], prior)
            deadline = _retry_at(prior)
            if deadline and dt.datetime.now(dt.timezone.utc) < deadline:
                raise ValueError("Original SDA Retry-After remains active until " + deadline.isoformat())
        attempt = (prior["attempt"] if prior else 0) + 1
        if attempt > 9999:
            raise ValueError("Inspect this original source request's retained attempts")
        body = directory / f"{attempt:04d}.body.gz"
        receipt = directory / f"{attempt:04d}.capture.json"
        pending = body.with_name(body.name + ".partial")
        record = {**intent, "schema": "upstate.sda-response/v1", "attempt": attempt,
                  "state": "requesting", "requested_at": now(), "stored_file": body.name,
                  "receipt_file": receipt.name, "storage_encoding": "gzip"}
        atomic_json(receipt, record)
        received = 0
        h = hashlib.sha256()
        try:
            request = urllib.request.Request(SERVICE, data=payload, method="POST", headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json,application/xml,text/xml",
                "Accept-Encoding": "identity",
                "User-Agent": "Commons-Upper-Savannah-Native-Soils/1.0"})
            try:
                response = urllib.request.urlopen(request, timeout=60)
            except urllib.error.HTTPError as error:
                response = error
            with response, pending.open("xb") as raw:
                record.update(state="receiving", status=response.status, final_url=response.url,
                              headers={k: response.headers[k] for k in HEADERS if k in response.headers})
                atomic_json(receipt, record)
                with gzip.GzipFile(filename="", fileobj=raw, mode="wb", mtime=0, compresslevel=6) as out:
                    for block in iter(lambda: response.read(1024 * 1024), b""):
                        received += len(block)
                        if received > maximum_bytes:
                            raise ValueError("Original SDA response exceeds the selected source page size")
                        out.write(block)
                        h.update(block)
                length = response.headers.get("Content-Length")
                if length is not None and received != int(length):
                    raise ValueError("Original SDA response is incomplete")
                raw.flush()
                os.fsync(raw.fileno())
            record.update(state="received", observed_at=now(), bytes=received, sha256=h.hexdigest(),
                          stored_bytes=pending.stat().st_size, stored_sha256=file_digest(pending))
            atomic_json(receipt, record)
            decoded = self._received(directory, record)
            if record["status"] != 200:
                raise ValueError("Original SDA HTTP " + str(record["status"]) + " response is retained")
            print(json.dumps({"source_request": name, "bytes": received, "sha256": record["sha256"]}),
                  flush=True)
            return decoded
        except BaseException as error:
            retained = read_json(receipt)
            if retained.get("state") not in ("received", "complete"):
                retained.update(state="interrupted", observed_at=now(), received_bytes=received,
                                error={"type": type(error).__name__, "message": str(error)})
                if pending.exists():
                    retained.update(partial_stored_bytes=pending.stat().st_size,
                                    partial_stored_sha256=file_digest(pending))
                atomic_json(receipt, retained)
            raise

    def query(self, name, sql, *, maximum_bytes=32 * 1024 * 1024):
        return table(self.post(name, {"QUERY": sql, "FORMAT": "JSON+COLUMNNAME+METADATA"},
                               maximum_bytes=maximum_bytes))

def table(raw):
    document = json.loads(raw.decode("utf-8-sig"), parse_float=Decimal)
    rows = document.get("Table") if isinstance(document, dict) else None
    if (not isinstance(rows, list) or len(rows) < 2 or not isinstance(rows[0], list)
            or not rows[0] or not all(isinstance(x, str) for x in rows[0])
            or len(set(rows[0])) != len(rows[0])
            or len(rows[1]) != len(rows[0])
            or not all(isinstance(x, str) and "ColumnOrdinal=" in x for x in rows[1])):
        raise ValueError("Retain and inspect the original SDA tabular response envelope")
    if any(not isinstance(row, list) or len(row) != len(rows[0]) for row in rows[2:]):
        raise ValueError("Original SDA row width differs from its returned schema")
    return [dict(zip(rows[0], [str(value) if isinstance(value, Decimal) else value
                               for value in row])) for row in rows[2:]]

def _catalog_attributes(value):
    if isinstance(value, dict):
        if "attributekey" in value and "attributename" in value:
            yield value
        for child in value.values():
            yield from _catalog_attributes(child)
    elif isinstance(value, list):
        for child in value:
            yield from _catalog_attributes(child)

def _metadata(directory, path, receipt_path):
    raw = Path(path).read_bytes()
    receipt = read_json(receipt_path)
    if (receipt.get("url") != SERVICE or receipt.get("status") != 200
            or receipt.get("bytes") != len(raw)
            or receipt.get("sha256") != hashlib.sha256(raw).hexdigest()):
        raise ValueError("Select the exact original successful SDA attribute metadata capture")
    rows = table(_decode(raw, receipt.get("headers", {})))
    chosen = [r for r in rows if r["attributename"] == "K Factor, Whole Soil"
              and r["attributetablename"] == "chorizon" and r["attributecolumnname"] == "kwfact"]
    if len(chosen) != 1:
        raise ValueError("Select the native whole-soil Kw interpretation metadata")
    chosen = chosen[0]
    if (chosen["attributelogicaldatatype"] != "Choice"
            or chosen["effectivelogicaldatatype"] != "Choice"
            or chosen["algorithmname"] != "Dominant Condition"
            or chosen["depthqualifiermode"] != "Surface Layer"
            or str(chosen["interpnullsaszeroflag"]) != "0"):
        raise ValueError("The native whole-soil interpretation defaults changed; select their current scientific method")
    destination = directory / "original/attribute-metadata.body"
    atomic_bytes(destination, raw, immutable=True)
    atomic_json(directory / "original/attribute-metadata.capture.json", receipt, immutable=True)
    return chosen, receipt

def _geometry_ids(client, name, aoi):
    source = f"{POLYGON_FUNCTION}({_int(aoi)})"
    count = client.query(name + "/polygon-count", f"SELECT COUNT_BIG(*) AS record_count FROM {source}")
    if len(count) != 1:
        raise ValueError("Original soil geometry count is ambiguous")
    count = _int(count[0]["record_count"])
    rows = client.query(name + "/polygon-ids",
                        f"SELECT {POLYGON_ID}, MapUnitKey, MuPolygonKey, AreaSymbol, SpatialVersion "
                        f"FROM {source} ORDER BY {POLYGON_ID}")
    ids = [_int(row[POLYGON_ID]) for row in rows]
    if len(rows) != count or len(set(ids)) != count:
        raise ValueError("Original SDA polygon ID coverage differs from its count")
    return rows

def _geometry_pages(client, tile, *, page_size, on_page=None, page_workers=1):
    """Receive original pages with ordered validation/ingest and bounded overlap."""
    if type(page_workers) is not int or page_workers not in (1, 2):
        raise ValueError("Choose one or two native soil page workers")
    name = tile["name"]
    aoi = _int(tile["aoiid"])
    ids = _geometry_ids(client, name, aoi)
    by_id = {_int(row[POLYGON_ID]): row for row in ids}
    ordered = sorted(by_id)
    pages = []
    failed = threading.Event()

    def receive(start):
        # Each page has its own immutable request/response directory. Workers
        # only receive and validate originals; the caller alone changes SQLite.
        try:
            selected = ordered[start:start + page_size]
            query_name = name + f"/polygons-{start:07d}"
            fields = ", ".join(POLYGON_FIELDS)
            sql = (f"SELECT {fields}, AoiSoilMapUnitPolygonGeo.STSrid AS GeometrySrid, "
                   "AoiSoilMapUnitPolygonGeo.STGeometryType() AS GeometryType, "
                   "CONVERT(varchar(max), AoiSoilMapUnitPolygonGeo.STAsBinary(), 2) AS GeometryWkb "
                   f"FROM {POLYGON_FUNCTION}({aoi}) WHERE {POLYGON_ID} IN ("
                   + ",".join(map(str, selected)) + f") ORDER BY {POLYGON_ID}")
            rows = client.query(query_name, sql, maximum_bytes=64 * 1024 * 1024)
            actual = [_int(row[POLYGON_ID]) for row in rows]
            if actual != selected:
                raise ValueError("An original native polygon page differs from its exact ID selection")
            for row in rows:
                baseline = by_id[_int(row[POLYGON_ID])]
                if any(row[key] != baseline[key] for key in baseline):
                    raise ValueError("Native polygon attributes changed between ID and geometry capture")
                if _int(row["AoiId"]) != aoi or _int(row["GeometrySrid"]) != 4326:
                    raise ValueError("Native soil polygon has another AOI or coordinate reference")
                if not isinstance(row["GeometryWkb"], str) or not re.fullmatch(r"[0-9A-Fa-f]+", row["GeometryWkb"]):
                    raise ValueError("Native soil geometry lacks its original hexadecimal WKB")
            return rows, {"request": query_name, "ids": selected, "sql": sql}
        except BaseException:
            failed.set()
            raise

    starts = iter(range(0, len(ordered), page_size))
    if page_workers == 1:
        for start in starts:
            rows, page = receive(start)
            if on_page is not None:
                on_page(rows)
            pages.append(page)
            del rows
        return ids, pages

    # At most two page results (running or received) exist in this window.
    # Consume in the original ID order before admitting another request.
    executor = ThreadPoolExecutor(max_workers=page_workers, thread_name_prefix="soil-page")
    pending = []
    try:
        for unused in range(page_workers):
            if failed.is_set():
                break
            start = next(starts, None)
            if start is not None:
                pending.append(executor.submit(receive, start))
        while pending:
            rows, page = pending.pop(0).result()
            if on_page is not None:
                on_page(rows)
            pages.append(page)
            del rows
            if not failed.is_set():
                start = next(starts, None)
                if start is not None:
                    pending.append(executor.submit(receive, start))
    finally:
        # No future page is scheduled after an observed failure. Finish any
        # already admitted response so Sda retains its body/receipt for resume;
        # the enclosing tile transaction still rolls back on any exception.
        failed.set()
        for future in pending:
            future.cancel()
        executor.shutdown(wait=True, cancel_futures=True)
    return ids, pages

def _choice_coefficients(ratings, legend, aoi, result_id):
    """Decode the native Kw choice strings while retaining all source columns."""
    labels = {}
    for row in legend:
        if (_int(row["AoiID"]) != aoi
                or _int(row["AoiSoilThematicMapID"]) != result_id):
            raise ValueError("Native K legend belongs to a different interpretation")
        label = row["LegendText"]
        if label in labels and labels[label] != row["RgbString"]:
            raise ValueError("Native K legend has an ambiguous repeated choice")
        labels[label] = row["RgbString"]
    coefficients = []
    for row in ratings:
        if (_int(row["AoiID"]) != aoi
                or _int(row["AoiSoilThematicMapID"]) != result_id):
            raise ValueError("A native soil rating belongs to a different interpretation")
        label, numeric = row["MapUnitRatingString"], row["MapUnitRatingNumeric"]
        if label is None:
            if numeric is not None:
                raise ValueError("Native Kw Choice metadata requires its original choice string")
            value = None
        else:
            if (not isinstance(label, str)
                    or not re.fullmatch(r"(?:[0-9]+(?:[.][0-9]*)?|[.][0-9]+)", label)
                    or label not in labels or labels[label] != row["RgbString"]):
                raise ValueError("Native whole-soil K choice is absent from its numeric source legend")
            coefficient = Decimal(label)
            if not coefficient.is_finite() or coefficient < 0:
                raise ValueError("Native whole-soil K is not a finite nonnegative coefficient")
            if numeric is not None and Decimal(str(numeric)) != coefficient:
                raise ValueError("Native numeric and choice K columns disagree")
            value = str(coefficient)
        coefficients.append({"MapUnitKey": row["MapUnitKey"],
                             "source_field": "MapUnitRatingString",
                             "source_value": label, "value": value})
    return coefficients

def _native_rule(client, name, mukeys, key):
    created = json.loads(client.post(name + "/aoi", {
        "SERVICE": "aoi", "REQUEST": "create", "MUKEYLIST": ",".join(map(str, mukeys))}))
    aoi = _int(created["id"])
    observed = client.query(name + "/mapunits",
                            f"SELECT MapUnitKey FROM SDA_Get_AoiMapunit_By_AoiId({aoi}) ORDER BY MapUnitKey")
    if [_int(row["MapUnitKey"]) for row in observed] != mukeys:
        raise ValueError("The native interpretation AOI changed the requested mapunit set")
    catalog = json.loads(client.post(name + "/catalog", {
        "SERVICE": "interpretation", "REQUEST": "getcatalog", "AOIID": aoi}))
    if not any(_int(row["attributekey"]) == key and row["attributename"] == "K Factor, Whole Soil"
               for row in _catalog_attributes(catalog)):
        raise ValueError("The actual mapunit selection does not expose the original whole-soil K rule")
    short_raw = client.post(name + "/rule-short", {
        "SERVICE": "interpretation", "REQUEST": "getruledata", "AOIID": aoi,
        "ATTRIBUTEKEY": key, "FORMAT": "short"})
    long_raw = client.post(name + "/rule-long", {
        "SERVICE": "interpretation", "REQUEST": "getruledata", "AOIID": aoi,
        "ATTRIBUTEKEY": key, "FORMAT": "long"})
    short = json.loads(short_raw.decode("utf-8-sig"))
    if (_int(short.get("aoiid")) != aoi or _int(short.get("ruleid")) != key
            or short.get("AggregationMethod") != "Dominant Condition"
            or short.get("HorizonAggregationMethod") != "Surface Layer"
            or str(short.get("InterpretNullsAsZero", "False")).lower() not in ("false", "0")):
        raise ValueError("Retain the actual whole-soil surface-layer interpretation before selecting its parameters")
    xml = ET.fromstring(long_raw)
    parameters = {}
    for node in xml.iter():
        if node.tag.rsplit("}", 1)[-1] == "Parameter" and node.get("shortname"):
            parameters[node.get("shortname")] = dict(node.attrib)
    for field, value in short.items():
        if field not in parameters:
            raise ValueError("Original short rule field is absent from its native long-form definition: " + field)
        node = parameters[field]
        if node.get("Value", node.get("Default")) != value:
            raise ValueError("Original short and long default values differ: " + field)
    # Send the exact returned short-form JSON, with every native parameter unchanged.
    rated = json.loads(client.post(name + "/interpretation", {
        "SERVICE": "interpretation", "REQUEST": "getrating",
        "SHORTFORMDATA": short_raw.decode("utf-8-sig")}))
    result_id = _int(rated["interpresultid"])
    metadata = client.query(name + "/result",
        f"SELECT * FROM SDA_Get_AoiSoilThematicMap_By_AoiSoilThematicMapId({result_id})")
    if (len(metadata) != 1 or _int(metadata[0]["AoiID"]) != aoi
            or _int(metadata[0]["AoiSoilThematicMapID"]) != result_id
            or _int(metadata[0]["AttributeKey"]) != key
            or metadata[0]["AggregationMethod"] != "Dominant Condition"
            or metadata[0]["LayerOption"] != "Surface Layer"
            or str(metadata[0]["InterpretNullsAsZero"]).lower() not in ("false", "0")):
        raise ValueError("The native calculated K interpretation returned another method")
    ratings = client.query(name + "/ratings",
        f"SELECT * FROM SDA_Get_AoiSoilThematicMapRating_By_AoiSoilThematicMapId({result_id}) ORDER BY MapUnitKey")
    if [_int(row["MapUnitKey"]) for row in ratings] != mukeys:
        raise ValueError("The native K ratings do not cover the actual mapunit-key set")
    legend = client.query(name + "/legend",
        f"SELECT * FROM SDA_Get_AoiSoilThematicMapLegend_By_AoiSoilThematicMapId({result_id})")
    coefficients = _choice_coefficients(ratings, legend, aoi, result_id)
    return {"aoiid": aoi, "interpresultid": result_id,
            "parameters": {k: v for k, v in short.items() if k != "aoiid"},
            "metadata": metadata[0], "ratings": ratings,
            "legend": legend, "coefficients": coefficients}

def _polygons(geometry):
    if geometry.is_empty:
        return []
    if geometry.geom_type == "Polygon":
        return [geometry]
    if geometry.geom_type in ("MultiPolygon", "GeometryCollection"):
        return [part for item in geometry.geoms for part in _polygons(item)]
    return []

def prepare(reference, domain, metadata_path, metadata_receipt, directory, *,
            vintage, layer=None, where=None, buffer_m=1000, tile_size=512,
            page_size=128, rating_batch=1000, null_policy="preserve", resume=False):
    import numpy as np
    import rasterio
    from rasterio.features import rasterize
    from rasterio.transform import Affine
    from rasterio.vrt import WarpedVRT
    from rasterio.windows import Window, bounds as window_bounds
    from pyproj import CRS, Transformer
    import shapely
    from shapely.geometry import box, mapping
    from shapely.ops import transform

    if null_policy not in ("preserve", "nlcd-water-zero"):
        raise ValueError("Select preserve or the explicit original-NLCD open-water policy")
    if (not math.isfinite(buffer_m) or buffer_m <= 0 or not 1 <= tile_size <= 1024
            or not 1 <= page_size <= 1000 or not 1 <= rating_batch <= 1000):
        raise ValueError("Select positive source tiles/pages and at most 1000 native mapunit keys per AOI")
    directory = Path(directory).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / "prepare.lock"):
        with rasterio.open(reference) as dataset:
            crs = CRS.from_user_input(dataset.crs)
        if not crs.is_projected or not all(abs(axis.unit_conversion_factor - 1) < 1e-12 for axis in crs.axis_info):
            raise ValueError("The selected NLCD model grid must use projected metres")
        native, _ = rasters.vector_geometry(domain, layer=layer, where=where, target_crs=crs)
        model_domain = rasters.polygon_union(native).buffer(buffer_m)
        grid = rasters.grid_definition(reference, model_domain)
        affine = Affine(*grid["transform"])
        if affine.a != 30 or affine.e != -30 or affine.b or affine.d:
            raise ValueError("Soil preparation requires the original unrotated 30m grid")
        metadata, metadata_capture = _metadata(directory, metadata_path, metadata_receipt)
        key = _int(metadata["attributekey"])
        plan = {"schema": "upstate.sda-whole-soil-source/v1", "source": SERVICE,
                "vintage": vintage, "attribute_key": key, "attribute_name": metadata["attributename"],
                "native_field": "chorizon.kwfact", "native_rating_field": "MapUnitRatingString",
                "native_rating_datatype": "Choice", "method": "Dominant Condition / Surface Layer",
                "metadata_sha256": metadata_capture["sha256"],
                "reference_sha256": file_digest(reference), "domain_sha256": file_digest(domain),
                "domain_layer": layer, "domain_filter": where, "buffer_m": buffer_m, "grid": grid,
                "tile_size": tile_size, "geometry_page_size": page_size, "rating_batch_size": rating_batch,
                "native_geometry_crs": "EPSG:4326", "aoi_geometry": "Geographic bounding rectangle over each target tile plus one-pixel halo",
                "pixel_selection": "Original GDAL polygon rasterization at pixel centres",
                "null_policy": null_policy, "customary_to_si_factor": str(K_FACTOR),
                "target_units": K_UNITS, "api_reference": REFERENCE, "unit_reference": K_REFERENCE,
                "runtime": {"rasterio": rasterio.__version__, "shapely": shapely.__version__}}
        atomic_json(directory / "plan.json", plan, immutable=True)
        final = directory / "source-entry.json"
        if final.exists():
            entry = read_json(final)
            if entry["preparation_sha256"] != digest(plan):
                raise ValueError("Prepared original soil source belongs to another selection")
            for item in [entry, *entry["companions"]]:
                path = directory / item["path"]
                if path.stat().st_size != item["bytes"] or file_digest(path) != item["sha256"]:
                    raise ValueError("Retained soil source or companion bytes changed")
            atomic_json(directory / "source-manifest.json", {
                "schema": "upstate.sources/v1", "title": entry["title"],
                "entries": [entry]}, immutable=True)
            return entry

        client = Sda(directory, resume=resume)
        survey_query = ("SELECT areasymbol, areaname, saverest FROM sacatalog WHERE "
                        "areasymbol LIKE 'SC%' OR areasymbol LIKE 'GA%' OR areasymbol LIKE 'NC%' "
                        "ORDER BY areasymbol")
        surveys_before = {r["areasymbol"]: r for r in client.query("regional-surveys-before", survey_query)}
        to_native = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
        to_grid = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
        tiles, all_mukeys, versions = [], set(), {}
        for row in range(0, grid["height"], tile_size):
            for col in range(0, grid["width"], tile_size):
                width, height = min(tile_size, grid["width"]-col), min(tile_size, grid["height"]-row)
                bounds = window_bounds(Window(col, row, width, height), affine)
                if not model_domain.intersects(box(*bounds)):
                    continue
                west, south, east, north = to_native.transform_bounds(
                    bounds[0]-30, bounds[1]-30, bounds[2]+30, bounds[3]+30, densify_pts=101)
                if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
                    raise ValueError("Native SDA source AOI is outside geographic bounds")
                aoi_wkt = box(west, south, east, north).wkt
                name = f"geometry/r{row:07d}-c{col:07d}"
                created = json.loads(client.post(name + "/aoi", {
                    "SERVICE": "aoi", "REQUEST": "create", "AOICOORDS": aoi_wkt}))
                tile = {"name": name, "row": row, "col": col, "width": width, "height": height,
                        "aoiid": _int(created["id"]), "native_aoi_wkt": aoi_wkt}
                ids, pages = _geometry_pages(client, tile, page_size=page_size)
                tile.update(polygons=len(ids), pages=pages)
                for original in ids:
                    mukey = _int(original["MapUnitKey"])
                    if not 0 < mukey <= 2147483647:
                        raise ValueError("The native mapunit key is outside its declared SQL integer type")
                    all_mukeys.add(mukey)
                    survey, version = original["AreaSymbol"], str(original["SpatialVersion"])
                    if survey in versions and versions[survey] != version:
                        raise ValueError("A native soil survey spatial version changed during capture: " + survey)
                    versions[survey] = version
                tiles.append(tile)
        if not tiles or not all_mukeys:
            raise ValueError("The actual model domain contains no returned native soil mapunits")
        atomic_json(directory / "geometry-capture.json",
                    {"plan_sha256": digest(plan), "tiles": tiles,
                     "native_survey_spatial_versions": versions,
                     "mapunit_keys": sorted(all_mukeys)}, immutable=True)

        coefficients, batches, parameters = {}, [], None
        ordered = sorted(all_mukeys)
        for start in range(0, len(ordered), rating_batch):
            selected = ordered[start:start + rating_batch]
            result = _native_rule(client, f"ratings/batch-{start:07d}", selected, key)
            if parameters is not None and result["parameters"] != parameters:
                raise ValueError("The native whole-soil interpretation changed across mapunit batches")
            parameters = result["parameters"]
            for original in result["coefficients"]:
                mukey = _int(original["MapUnitKey"])
                value = original["value"]
                coefficients[mukey] = None if value is None else Decimal(str(value))
            batches.append(result)
        surveys_after = {r["areasymbol"]: r for r in client.query("regional-surveys-after", survey_query)}
        for survey in versions:
            if (survey not in surveys_before or survey not in surveys_after
                    or surveys_before[survey] != surveys_after[survey]):
                raise ValueError("An actual source survey edition changed during native capture: " + survey)
        atomic_json(directory / "survey-editions.json",
                    {"surveys": [surveys_before[name] for name in sorted(versions)],
                     "native_spatial_versions": versions}, immutable=True)
        # Preserve native Choice strings, their exact Decimal projection, and the full source legend.
        atomic_json(directory / "ratings.json",
                    {"plan_sha256": digest(plan), "parameters": parameters, "batches": batches},
                    immutable=True)

        destination = directory / "soil-k.tif"
        pending = directory / "soil-k.tif.partial"
        profile = rasters.output_profile(grid)
        counts = {"model_domain_cells": 0, "native_rated_cells": 0,
                  "native_unrated_cells": 0, "no_polygon_cells": 0,
                  "different_mapunit_cells": 0, "different_rating_cells": 0,
                  "open_water_zero_cells": 0, "unresolved_land_cells": 0,
                  "source_nonarea_geometries": 0}
        low, high = None, None
        tile_lookup = {(t["row"], t["col"]): t for t in tiles}
        nodata = profile["nodata"]
        with rasterio.Env(GDAL_CACHEMAX=64*1024*1024), rasterio.open(reference) as nlcd:
            with WarpedVRT(nlcd, crs=crs, transform=affine, width=grid["width"], height=grid["height"],
                           resampling=rasterio.enums.Resampling.nearest) as cover, \
                    rasterio.open(pending, "w", **profile) as out:
                for row in range(0, grid["height"], tile_size):
                    for col in range(0, grid["width"], tile_size):
                        width, height = min(tile_size, grid["width"]-col), min(tile_size, grid["height"]-row)
                        window = Window(col, row, width, height)
                        tile_transform = affine * Affine.translation(col, row)
                        domain_mask = rasterize([(mapping(model_domain), 1)], out_shape=(height, width),
                                                transform=tile_transform, fill=0, dtype="uint8",
                                                all_touched=False).astype(bool)
                        values = np.full((height, width), nodata, dtype="float32")
                        tile = tile_lookup.get((row, col))
                        if tile is None:
                            if domain_mask.any():
                                raise ValueError("A selected model-domain tile lacks its native soil capture")
                            out.write(values, 1, window=window)
                            continue
                        shapes = []
                        for page in tile["pages"]:
                            rows = client.query(page["request"], page["sql"], maximum_bytes=64*1024*1024)
                            for original in rows:
                                geometry = shapely.from_wkb(bytes.fromhex(original["GeometryWkb"]))
                                if not geometry.is_valid:
                                    raise ValueError("Original native soil polygon is invalid: " + str(original[POLYGON_ID]))
                                polygon_parts = _polygons(geometry)
                                if not polygon_parts:
                                    counts["source_nonarea_geometries"] += 1
                                for part in polygon_parts:
                                    shapes.append((mapping(transform(to_grid.transform, part)), _int(original["MapUnitKey"])))
                        labels = rasterize(shapes, out_shape=(height, width), transform=tile_transform,
                                           fill=0, dtype="int32", all_touched=False) if shapes else np.zeros((height,width), dtype="int32")
                        by_mukey = sorted(shapes, key=lambda item: item[1])
                        highest = rasterize(by_mukey, out_shape=(height,width), transform=tile_transform,
                                            fill=0, dtype="int32", all_touched=False) if shapes else labels
                        lowest = rasterize(list(reversed(by_mukey)), out_shape=(height,width),
                                           transform=tile_transform, fill=0, dtype="int32",
                                           all_touched=False) if shapes else labels
                        different = (highest != lowest) & domain_mask
                        mismatch = np.zeros((height,width), dtype=bool)
                        if different.any():
                            # Min/max bounds include every overlapping native value.
                            # None has its own rank and stays distinct from numerical zero.
                            native_values = set(coefficients[mukey] for _, mukey in shapes)
                            ordered_values = sorted(native_values,
                                key=lambda value: (value is not None, value if value is not None else Decimal(0)))
                            ranks = {value: index + 1 for index, value in enumerate(ordered_values)}
                            by_rating = sorted([(geometry, ranks[coefficients[mukey]])
                                                for geometry, mukey in shapes], key=lambda item: item[1])
                            maximum_rating = rasterize(by_rating, out_shape=(height,width),
                                transform=tile_transform, fill=0, dtype="int32", all_touched=False)
                            minimum_rating = rasterize(list(reversed(by_rating)), out_shape=(height,width),
                                transform=tile_transform, fill=0, dtype="int32", all_touched=False)
                            mismatch = different & (maximum_rating != minimum_rating)
                        rated = np.zeros((height,width), dtype=bool)
                        for mukey in np.unique(labels[domain_mask]):
                            mukey = int(mukey)
                            if not mukey:
                                continue
                            if mukey not in coefficients:
                                raise ValueError("Original soil polygon has no native interpretation row")
                            coefficient = coefficients[mukey]
                            selected = (labels == mukey) & domain_mask
                            if coefficient is not None:
                                values[selected] = float(coefficient * K_FACTOR)
                                rated[selected] = True
                        rated[mismatch] = False
                        values[mismatch] = nodata
                        land_cover = cover.read(1, window=window, masked=True)
                        water = (np.ma.getdata(land_cover) == 11) & ~np.ma.getmaskarray(land_cover) & domain_mask
                        if null_policy == "nlcd-water-zero":
                            zeros = water & ~rated & ~mismatch
                            values[zeros] = 0
                            counts["open_water_zero_cells"] += int(zeros.sum())
                        else:
                            zeros = np.zeros((height,width), dtype=bool)
                        valid = rated | zeros
                        values[~domain_mask] = nodata
                        counts["model_domain_cells"] += int(domain_mask.sum())
                        counts["native_rated_cells"] += int(rated.sum())
                        counts["native_unrated_cells"] += int(((labels > 0) & domain_mask & ~rated & ~mismatch).sum())
                        counts["no_polygon_cells"] += int(((labels == 0) & domain_mask).sum())
                        counts["different_mapunit_cells"] += int(different.sum())
                        counts["different_rating_cells"] += int(mismatch.sum())
                        counts["unresolved_land_cells"] += int((domain_mask & ~valid & ~water).sum())
                        good = values[valid]
                        if good.size:
                            low = float(good.min()) if low is None else min(low, float(good.min()))
                            high = float(good.max()) if high is None else max(high, float(good.max()))
                        out.write(values, 1, window=window)
                out.update_tags(units=K_UNITS, original_attribute="chorizon.kwfact",
                                interpretation="Dominant Condition / Surface Layer",
                                customary_to_si_factor=str(K_FACTOR), null_policy=null_policy,
                                source=SERVICE, source_vintage=vintage, preparation_sha256=digest(plan))
        with pending.open("rb") as handle:
            os.fsync(handle.fileno())
        os.replace(pending, destination)
        _fsync(directory)
        counts.update(minimum_si=low, maximum_si=high,
                      unique_mapunits=len(all_mukeys), native_geometry_tiles=len(tiles),
                      native_interpretations=len(batches))
        atomic_json(directory / "coverage.json", counts, immutable=True)
        companions = [describe_file(directory, path) for path in sorted(directory.rglob("*"))
                      if path.is_file() and path != destination and path != final
                      and path.name not in ("prepare.lock", "source-manifest.json")
                      and not path.name.endswith((".partial", ".lock"))]
        entry = {"id": "usda-whole-soil-k-" + digest(plan)[:16],
                 "title": "USDA native whole-soil surface K on the original NLCD grid",
                 "kind": "raster", "role": "K_FACTOR", "uri": SERVICE, "vintage": vintage,
                 "units": K_UNITS, "resampling": "nearest", **describe_file(directory, destination),
                 "preparation_sha256": digest(plan), "grid": grid, "observed": counts,
                 "native_attribute": "chorizon.kwfact", "native_parameters": parameters,
                 "unit_conversion": {"factor": str(K_FACTOR), "applied": True,
                                     "target_units": K_UNITS, "reference": K_REFERENCE},
                 "null_policy": null_policy, "companions": companions}
        atomic_json(final, entry, immutable=True)
        atomic_json(directory / "source-manifest.json", {
            "schema": "upstate.sources/v1", "title": entry["title"],
            "entries": [entry]}, immutable=True)
        return entry

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference", required=True, help="Original numeric NLCD raster")
    parser.add_argument("--domain", required=True, help="Retained complete upstream-domain vector")
    parser.add_argument("--layer")
    parser.add_argument("--where-json")
    parser.add_argument("--buffer-m", type=float, default=1000)
    parser.add_argument("--attribute-metadata", required=True)
    parser.add_argument("--metadata-capture", required=True)
    parser.add_argument("--vintage", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--tile-size", type=int, default=512)
    parser.add_argument("--page-size", type=int, default=128)
    parser.add_argument("--rating-batch", type=int, default=1000)
    parser.add_argument("--null-policy", choices=("preserve", "nlcd-water-zero"), default="preserve")
    parser.add_argument("--resume", action="store_true",
                        help="Continue an explicitly retained incomplete public-source request")
    args = parser.parse_args(argv)
    result = prepare(args.reference, args.domain, args.attribute_metadata, args.metadata_capture,
                     args.output, vintage=args.vintage, layer=args.layer,
                     where=json.loads(args.where_json) if args.where_json else None,
                     buffer_m=args.buffer_m, tile_size=args.tile_size, page_size=args.page_size,
                     rating_batch=args.rating_batch, null_policy=args.null_policy, resume=args.resume)
    print(json.dumps(result, sort_keys=True, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
