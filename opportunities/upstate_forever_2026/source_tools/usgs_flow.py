"""Retain original USGS daily discharge and regional station context.

The acquisition uses the maintained USGS OGC v1 service. It writes original
response bodies, exact request/source manifests, station GeoJSON, daily CSVs,
and period summaries. Daily discharge remains hydrologic context; this module
does not estimate nutrient/sediment loads or change native model parameters.
"""
from __future__ import annotations

import argparse
import collections
import csv
import datetime as dt
import gzip
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

EDITION = "upstate.usgs-flow/1.0.0"
API = "https://api.waterdata.usgs.gov/ogcapi/v1/collections/"
FLOW_PARAMETER = "00060"
MEAN_STATISTIC = "00003"
CFS_TO_CMS = 0.028316846592
MAX_BODY = 64 * 1024 * 1024


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def utcnow():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def write_bytes(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_file() and sha(path.read_bytes()) == sha(data):
        return
    temporary = path.with_name(path.name + ".part")
    with temporary.open("wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def write_json(path, value):
    write_bytes(path, (json.dumps(value, ensure_ascii=False, indent=2,
                                 allow_nan=False) + "\n").encode("utf-8"))


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def safe_name(value):
    text = re.sub(r"[^A-Za-z0-9_.-]+", "_", str(value))
    if not text or text in (".", ".."):
        raise ValueError("A nonempty source identity is required")
    return text


class SourceClient:
    def __init__(self, directory, *, interval=1.1, attempts=5, timeout=90):
        self.root = Path(directory)
        self.root.mkdir(parents=True, exist_ok=True)
        self.interval = float(interval)
        self.attempts = int(attempts)
        self.timeout = int(timeout)
        self.previous_request = 0.0
        self.used = {}
        if not math.isfinite(self.interval) or self.interval < 0:
            raise ValueError("Request interval must be finite and nonnegative")
        if self.attempts < 1 or self.timeout < 1:
            raise ValueError("Attempts and timeout must be positive")

    def url(self, collection, **parameters):
        return API + collection + "/items?" + urllib.parse.urlencode(
            {"f": "json", "limit": 1000, **parameters})

    def _validate_url(self, url):
        parts = urllib.parse.urlsplit(url)
        if (parts.scheme != "https" or parts.hostname != "api.waterdata.usgs.gov"
                or parts.username or parts.password or parts.port not in (None, 443)
                or not parts.path.startswith("/ogcapi/v1/collections/")):
            raise ValueError("A USGS v1 source or pagination URL is required")
        if any(k.lower() in ("api_key", "apikey", "token")
               for k, _ in urllib.parse.parse_qsl(parts.query)):
            raise ValueError("Keep credentials out of retained source URLs")

    def get(self, url):
        self._validate_url(url)
        identity = sha(url.encode("utf-8"))
        body_path = self.root / (identity + ".json.gz")
        receipt_path = self.root / (identity + ".receipt.json")
        if body_path.is_file() and receipt_path.is_file():
            receipt = read_json(receipt_path)
            packed = body_path.read_bytes()
            if receipt.get("request_url") != url:
                raise ValueError("Retained request identity changed")
            if sha(packed) != receipt.get("retained_sha256"):
                raise ValueError("Retained USGS compressed source has changed")
            body = gzip.decompress(packed)
            if sha(body) != receipt.get("body_sha256"):
                raise ValueError("Retained USGS source body has changed")
            value = json.loads(body)
            self.used[identity] = receipt
            return value, identity

        for attempt in range(self.attempts):
            delay = self.interval - (time.monotonic() - self.previous_request)
            if delay > 0:
                time.sleep(delay)
            self.previous_request = time.monotonic()
            request = urllib.request.Request(
                url, headers={"Accept": "application/geo+json,application/json",
                              "User-Agent": "UpperSavannah-USGSFlow/1.0"})
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as reply:
                    final_url = reply.geturl()
                    self._validate_url(final_url)
                    wire = reply.read(MAX_BODY + 1)
                    if len(wire) > MAX_BODY:
                        raise ValueError("USGS page exceeds the retained-page size")
                    encoding = reply.headers.get("Content-Encoding", "").lower()
                    body = gzip.decompress(wire) if encoding == "gzip" else wire
                    if len(body) > MAX_BODY:
                        raise ValueError("Decoded USGS page exceeds the size limit")
                    value = json.loads(body)
                    if not isinstance(value, dict) or value.get("type") != "FeatureCollection":
                        raise ValueError("USGS returned a non-FeatureCollection source")
                    packed = gzip.compress(body, mtime=0)
                    receipt = {
                        "schema": "upstate.original-http-source/v1",
                        "request_url": url, "resolved_url": final_url,
                        "retrieved_at": utcnow(), "http_status": reply.status,
                        "content_type": reply.headers.get("Content-Type"),
                        "source_content_encoding": encoding or None,
                        "etag": reply.headers.get("ETag"),
                        "last_modified": reply.headers.get("Last-Modified"),
                        "body_bytes": len(body), "body_sha256": sha(body),
                        "retained_file": body_path.name,
                        "retained_encoding": "gzip", "retained_bytes": len(packed),
                        "retained_sha256": sha(packed),
                        "number_returned": value.get("numberReturned"),
                        "number_matched": value.get("numberMatched"),
                    }
                    write_bytes(body_path, packed)
                    write_json(receipt_path, receipt)
                    self.used[identity] = receipt
                    return value, identity
            except urllib.error.HTTPError as error:
                if error.code not in (429, 500, 502, 503, 504) or attempt + 1 == self.attempts:
                    raise
                header = error.headers.get("Retry-After", "")
                try:
                    pause = float(header)
                except ValueError:
                    try:
                        import email.utils
                        retry_at = email.utils.parsedate_to_datetime(header)
                        pause = max(0.0, (retry_at - dt.datetime.now(dt.timezone.utc)).total_seconds())
                    except (TypeError, ValueError):
                        pause = min(30.0, 2.0 ** attempt)
                time.sleep(max(self.interval, min(pause, 60.0)))
            except (TimeoutError, urllib.error.URLError):
                if attempt + 1 == self.attempts:
                    raise
                time.sleep(min(30.0, 2.0 ** attempt))
        raise RuntimeError("USGS request did not complete")

    def features(self, url):
        seen_pages, seen_ids = set(), {}
        while url:
            if url in seen_pages:
                raise ValueError("USGS pagination repeated a source URL")
            seen_pages.add(url)
            page, request_id = self.get(url)
            features = page.get("features")
            if not isinstance(features, list):
                raise ValueError("USGS response has no feature list")
            returned = page.get("numberReturned")
            if returned is not None and int(returned) != len(features):
                raise ValueError("USGS page feature count differs from numberReturned")
            for feature in features:
                if not isinstance(feature, dict) or feature.get("type") != "Feature":
                    raise ValueError("USGS returned a malformed feature")
                fid = feature.get("id")
                if fid is None:
                    raise ValueError("USGS feature lacks its original observation ID")
                identity, fingerprint = str(fid), sha(canonical(feature).encode("utf-8"))
                if identity in seen_ids:
                    if seen_ids[identity] != fingerprint:
                        raise ValueError("One original feature ID changed across pages")
                    continue
                seen_ids[identity] = fingerprint
                yield feature, request_id
            links = [x.get("href") for x in page.get("links", [])
                     if x.get("rel") == "next"]
            if len(links) > 1:
                raise ValueError("USGS page has multiple next links")
            url = urllib.parse.urljoin(url, links[0]) if links else None
            if url and not features:
                raise ValueError("USGS returned an empty page with a continuation")


def _polygons(geometry):
    if not geometry:
        raise ValueError("Domain feature lacks geometry")
    if geometry["type"] == "Polygon":
        return [geometry["coordinates"]]
    if geometry["type"] == "MultiPolygon":
        return geometry["coordinates"]
    raise ValueError("Domain geometry must be Polygon or MultiPolygon")


def _ring_contains(point, ring):
    x, y = point
    inside = False
    for left, right in zip(ring, ring[1:] + ring[:1]):
        ax, ay = left[:2]
        bx, by = right[:2]
        cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax)
        if abs(cross) <= 1e-12 and min(ax, bx) - 1e-12 <= x <= max(ax, bx) + 1e-12 \
                and min(ay, by) - 1e-12 <= y <= max(ay, by) + 1e-12:
            return True, True
        if (ay > y) != (by > y) and x < ax + (y - ay) * (bx - ax) / (by - ay):
            inside = not inside
    return inside, False


def _covers(point, polygon):
    # Parity handles GeoJSON holes and every outer/hole ring of one Esri feature.
    inside = False
    for ring in polygon:
        hit, boundary = _ring_contains(point, ring)
        if boundary:
            return True
        if hit:
            inside = not inside
    return inside


def _domain_object(body):
    decoded = gzip.decompress(body) if body[:2] == b"\x1f\x8b" else body
    return decoded, json.loads(decoded)


def _domain_candidate(value, count):
    if not isinstance(value, dict) or len(value.get("features", [])) != count:
        return False
    if value.get("type") == "FeatureCollection":
        return all((f.get("geometry") or {}).get("type") in ("Polygon", "MultiPolygon")
                   for f in value["features"])
    return all(isinstance(f.get("attributes"), dict)
               and isinstance((f.get("geometry") or {}).get("rings"), list)
               for f in value["features"])


def load_domain(path, *, member=None, expected_features=217, huc_field=None,
                expected_decoded_sha256=None):
    path = Path(path)
    original = path.read_bytes()
    original_sha = sha(original)
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as archive:
            names = [member] if member else [
                name for name in archive.namelist()
                if name.lower().endswith((".json", ".geojson", ".json.gz", ".geojson.gz"))]
            candidates = []
            for name in names:
                if name not in archive.namelist():
                    raise ValueError("Requested original domain ZIP member is absent")
                try:
                    decoded, value = _domain_object(archive.read(name))
                except (UnicodeDecodeError, ValueError, OSError):
                    continue
                if _domain_candidate(value, expected_features):
                    candidates.append((name, decoded, value))
            if len(candidates) != 1:
                raise ValueError("Select the exact polygon JSON member with --domain-member; "
                                 "matching members: " + repr([x[0] for x in candidates]))
            member, decoded, value = candidates[0]
    else:
        decoded, value = _domain_object(original)
    if expected_decoded_sha256 and sha(decoded) != expected_decoded_sha256.lower():
        raise ValueError("Decoded original domain differs from its supplied source SHA256")
    if not _domain_candidate(value, expected_features):
        raise ValueError("Original domain polygon count differs from --expected-features")

    esri = value.get("type") != "FeatureCollection"
    raw_features = value["features"]
    source_kind = "esri-feature-set" if esri else "geojson-feature-collection"
    if esri:
        reference = value.get("spatialReference")
        references = [(f.get("geometry") or {}).get("spatialReference")
                      for f in raw_features if (f.get("geometry") or {}).get("spatialReference")]
        if reference is None and references and all(x == references[0] for x in references):
            reference = references[0]
        if not isinstance(reference, dict):
            raise ValueError("The original Esri feature set must declare spatialReference")
        if references and any(x != reference for x in references):
            raise ValueError("Original Esri feature geometries declare different reference systems")
        wkid = reference.get("latestWkid", reference.get("wkid"))
        crs_name = "EPSG:" + str(wkid) if wkid is not None else reference.get("wkt")
        if not crs_name:
            raise ValueError("Original Esri spatialReference needs its declared WKID or WKT")
        features = [{"type": "Feature", "properties": f["attributes"],
                     "geometry": {"type": "Polygon", "coordinates": f["geometry"]["rings"]}}
                    for f in raw_features]
    else:
        reference = value.get("crs")
        crs_name = str((reference or {}).get("properties", {}).get("name", "OGC:CRS84"))
        features = raw_features

    transformer = None
    transformation = {"source_crs": crs_name, "target_crs": "EPSG:4326",
                      "operation": "Published WGS84 coordinates retained",
                      "accuracy_metres": 0}
    geographic_names = ("OGC:CRS84", "urn:ogc:def:crs:OGC:1.3:CRS84",
                        "EPSG:4326", "urn:ogc:def:crs:EPSG::4326")
    if crs_name not in geographic_names:
        try:
            from pyproj import CRS, Transformer
        except ImportError as error:
            raise RuntimeError("Use the existing GIS interpreter with pyproj to read the "
                               "original declared " + str(crs_name) + " domain") from error
        native_crs = CRS.from_user_input(crs_name)
        if not native_crs.is_geographic:
            raise ValueError("This original-source intake expects the declared geographic domain CRS")
        transformer = Transformer.from_crs(
            native_crs, CRS.from_epsg(4326), always_xy=True, allow_ballpark=False)

    available_keys = set.intersection(*(set(f["properties"]) for f in features))
    candidates = [huc_field] if huc_field else [
        key for key in available_keys if key.casefold() == "huc12"]
    candidates = [key for key in candidates if key and key in available_keys and all(
        isinstance(f["properties"].get(key), str)
        and re.fullmatch(r"\d{12}", f["properties"][key]) for f in features)]
    if len(candidates) != 1:
        raise ValueError("Select the original string HUC12 property with --huc-field")
    key = candidates[0]
    identities = [f["properties"][key] for f in features]
    if len(set(identities)) != len(identities):
        raise ValueError("Original domain has duplicate HUC12 identities")
    polygons, xs, ys = [], [], []
    for feature, huc in zip(features, identities):
        for raw_polygon in _polygons(feature["geometry"]):
            if not raw_polygon or any(len(ring) < 4 for ring in raw_polygon):
                raise ValueError("Original domain contains an incomplete polygon ring")
            polygon = []
            for original_ring in raw_polygon:
                if any(len(coord) < 2 for coord in original_ring):
                    raise ValueError("Original domain ring contains an incomplete coordinate")
                native_ring = [coord[:2] for coord in original_ring]
                ring = (list(transformer.itransform(native_ring))
                        if transformer is not None else native_ring)
                for x, y in ring:
                    if (not all(math.isfinite(float(v)) for v in (x, y))
                            or not -180 <= x <= 180 or not -90 <= y <= 90):
                        raise ValueError("Original domain did not resolve to finite WGS84 coordinates")
                    xs.append(x)
                    ys.append(y)
                polygon.append(ring)
            polygons.append((huc, polygon))
    if transformer is not None:
        transformation.update(operation=transformer.description,
                              accuracy_metres=transformer.accuracy)
    manifest = {"original_path": str(path.resolve()), "file_sha256": original_sha,
                "member": member, "decoded_bytes": len(decoded), "decoded_sha256": sha(decoded),
                "source_format": source_kind, "feature_count": len(features), "huc_field": key,
                "huc12": sorted(identities), "source_spatial_reference": reference,
                "coordinate_operation": transformation, "matching_crs": "EPSG:4326",
                "bbox": [min(xs), min(ys), max(xs), max(ys)]}
    return polygons, manifest, decoded


def matching_hucs(feature, polygons):
    geometry = feature.get("geometry") or {}
    if geometry.get("type") != "Point":
        return []
    coordinates = geometry.get("coordinates", [])
    if len(coordinates) < 2:
        return []
    point = coordinates[:2]
    if not all(isinstance(x, (int, float)) and math.isfinite(x) for x in point):
        return []
    return sorted({huc for huc, polygon in polygons if _covers(point, polygon)})


def list_field(value):
    if value is None:
        return []
    return [str(v) for v in value] if isinstance(value, list) else [str(value)]


def mean_flow_unit(unit):
    text = str(unit or "").strip().lower().replace(" ", "")
    if text in ("ft^3/s", "ft3/s", "cfs", "ft³/s"):
        return CFS_TO_CMS
    if text in ("m^3/s", "m3/s", "m³/s"):
        return 1.0
    return None


def row_value(feature, request_id, metadata, start, end):
    prop = feature["properties"]
    station = str(prop.get("monitoring_location_id", ""))
    series = str(prop.get("time_series_id", prop.get("timeseries_id", "")))
    expected_series = str(metadata["id"])
    expected_station = str(metadata["properties"]["monitoring_location_id"])
    if station != expected_station or series != expected_series:
        raise ValueError("Daily observation has a different original station/series")
    if prop.get("parameter_code") != FLOW_PARAMETER or prop.get("statistic_id") != MEAN_STATISTIC:
        raise ValueError("Daily observation is not original mean discharge (00060/00003)")
    date_text = str(prop.get("time", ""))
    day = dt.date.fromisoformat(date_text)
    if not start <= day <= end:
        raise ValueError("Daily observation lies outside the requested dates")
    raw = prop.get("value")
    try:
        numeric = float(raw)
        if not math.isfinite(numeric):
            numeric = None
    except (TypeError, ValueError):
        numeric = None
    declared = prop.get("unit_of_measure")
    series_unit = metadata["properties"].get("unit_of_measure")
    if declared and series_unit and mean_flow_unit(declared) != mean_flow_unit(series_unit):
        raise ValueError("Observation and original series units disagree")
    unit = declared or series_unit
    factor = mean_flow_unit(unit)
    approvals = list_field(prop.get("approval_status", prop.get("approvals_status")))
    qualifier = list_field(prop.get("qualifier"))
    converted = numeric * factor if numeric is not None and factor is not None else None
    return {
        "observation_id": str(feature["id"]), "monitoring_location_id": station,
        "time_series_id": series, "date": day.isoformat(),
        "water_year": day.year + (day.month >= 10),
        "source_value": raw, "source_unit": unit,
        "unit_source": "observation" if declared else "time_series_metadata",
        "discharge_m3_s": converted,
        "conversion_factor": factor, "approval_status": "|".join(approvals),
        "qualifier": "|".join(qualifier), "last_modified": prop.get("last_modified"),
        "source_request_id": request_id,
    }


ROW_FIELDS = ["observation_id", "monitoring_location_id", "time_series_id", "date",
              "water_year", "source_value", "source_unit", "unit_source",
              "discharge_m3_s", "conversion_factor", "approval_status", "qualifier",
              "last_modified", "source_request_id"]


def csv_bytes(rows, fields):
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return stream.getvalue().encode("utf-8")


def percentile(values, fraction):
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower, upper = math.floor(position), math.ceil(position)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def summaries(rows, station, series, start, end):
    periods = collections.defaultdict(list)
    for row in rows:
        periods[row["date"][:7]].append(row)
        periods[row["date"][:4]].append(row)
    # Create explicit empty months and years inside the requested interval.
    day = start
    while day <= end:
        periods.setdefault(day.strftime("%Y-%m"), [])
        periods.setdefault(str(day.year), [])
        day += dt.timedelta(days=1)
    result = []
    for period, values in sorted(periods.items()):
        year = int(period[:4])
        if len(period) == 4:
            first, last = dt.date(year, 1, 1), dt.date(year, 12, 31)
        else:
            month = int(period[5:])
            first = dt.date(year, month, 1)
            following = (dt.date(year + 1, 1, 1) if month == 12
                         else dt.date(year, month + 1, 1))
            last = following - dt.timedelta(days=1)
        first, last = max(first, start), min(last, end)
        expected = (last - first).days + 1
        by_day = collections.defaultdict(list)
        for row in values:
            by_day[row["date"]].append(row)
        duplicates = [date for date, records in by_day.items() if len(records) != 1]
        usable = [records[0] for records in by_day.values()
                  if len(records) == 1 and records[0]["discharge_m3_s"] is not None]
        numbers = [row["discharge_m3_s"] for row in usable]
        approved = sum(row["approval_status"].lower() == "approved" for row in usable)
        missing = [(first + dt.timedelta(days=i)).isoformat() for i in range(expected)
                   if (first + dt.timedelta(days=i)).isoformat() not in by_day]
        result.append({
            "monitoring_location_id": station, "time_series_id": series,
            "period": period, "requested_start": first.isoformat(),
            "requested_end": last.isoformat(), "expected_days": expected,
            "observed_days": len(by_day), "numeric_unique_days": len(numbers),
            "approved_numeric_days": approved,
            "qualified_numeric_days": sum(bool(x["qualifier"]) for x in usable),
            "duplicate_dates": "|".join(sorted(duplicates)),
            "missing_dates": "|".join(missing),
            "complete_numeric_period": len(numbers) == expected and not duplicates,
            "mean_discharge_m3_s": math.fsum(numbers) / len(numbers) if numbers else None,
            "minimum_discharge_m3_s": min(numbers) if numbers else None,
            "median_discharge_m3_s": percentile(numbers, 0.5),
            "p90_discharge_m3_s": percentile(numbers, 0.9),
            "maximum_discharge_m3_s": max(numbers) if numbers else None,
        })
    return result


SUMMARY_FIELDS = [
    "monitoring_location_id", "time_series_id", "period", "requested_start",
    "requested_end", "expected_days", "observed_days", "numeric_unique_days",
    "approved_numeric_days", "qualified_numeric_days", "duplicate_dates",
    "missing_dates", "complete_numeric_period", "mean_discharge_m3_s",
    "minimum_discharge_m3_s", "median_discharge_m3_s", "p90_discharge_m3_s",
    "maximum_discharge_m3_s"]


def context_markdown(stations, summaries, start, end):
    lines = [
        "# Regional observed river-flow context", "",
        "Original USGS daily mean discharge, parameter 00060 and statistic 00003.",
        "Requested period: " + start.isoformat() + " through " + end.isoformat() + ".", "",
        "## Monitoring locations", "",
        "| Station | Official name | Source drainage area (mi²) | Containing original HUC12 |",
        "| --- | --- | ---: | --- |",
    ]
    for row in stations:
        clean = lambda value: str(value if value is not None else "").replace("|", r"\|").replace("\n", " ")
        lines.append("| " + " | ".join(clean(row.get(key)) for key in
                     ("monitoring_location_id", "name", "drainage_area",
                      "containing_domain_huc12")) + " |")
    lines += ["", "## Calendar-year coverage and mean flow", "",
              "| Station | Original series | Period | Numeric days / requested days | Approved days | Mean flow (m³/s) |",
              "| --- | --- | --- | ---: | ---: | ---: |"]
    for row in summaries:
        if len(row["period"]) != 4:
            continue
        value = row["mean_discharge_m3_s"]
        mean = format(value, ".8g") if value is not None else ""
        lines.append("| " + " | ".join([
            row["monitoring_location_id"], row["time_series_id"], row["period"],
            str(row["numeric_unique_days"]) + " / " + str(row["expected_days"]),
            str(row["approved_numeric_days"]), mean]) + " |")
    lines += [
        "", "Each mean uses the finite daily values shown in its coverage count. "
        "The coverage CSV identifies missing dates, duplicate dates, source qualifiers "
        "and the exact first/last requested day. Separate original time series remain separate.",
        "", "Station geometry is the published WGS84 point. A containing HUC12 identifies "
        "that point's location in the retained domain. The station drainage area belongs "
        "to its whole upstream contributing basin; use the original basin geometry when "
        "relating its flow to model exports.",
        "", "Flow units are preserved in observations.csv. The normalized m³/s column "
        "uses the exact conversion 1 ft³ = 0.028316846592 m³ where the original unit is ft³/s. "
        "Original approved/provisional status, qualifiers, observation IDs and modification "
        "timestamps are retained for review.",
        "", "Use this capture with the corresponding source-water measurements and mapped "
        "upstream support when designing calibration or scenario comparisons. The capture's "
        "quantity is daily mean volumetric flow.",
        "", "## Original sources", "",
        "https://api.waterdata.usgs.gov/ogcapi/v1/collections/daily", "",
        "https://api.waterdata.usgs.gov/ogcapi/v1/collections/time-series-metadata", "",
        "https://api.waterdata.usgs.gov/ogcapi/v1/collections/monitoring-locations", "",
        "The source manifest links every request to its complete retained response body.", "",
    ]
    return "\n".join(lines)


def workspace_source_manifest(root, selection_id, start, end, source_time, requests, series_ids):
    names = ["selection.json", "source_manifest.json", "stations.geojson",
             "stations.csv", "series.geojson", "coverage.csv", "hydrology_context.md"]
    for request_id in sorted(requests):
        names.extend(["original/" + request_id + ".json.gz",
                      "original/" + request_id + ".receipt.json"])
    names.extend("series/" + safe_name(series_id) + ".csv" for series_id in sorted(series_ids))
    if read_json(root / "selection.json").get("domain"):
        names.append("domain/original-domain.json.gz")
    companion_paths = [root / name for name in names]
    companions = [{"path": p.relative_to(root).as_posix(), "sha256": sha(p.read_bytes())}
                  for p in companion_paths]
    path = root / "workspace-sources.json"
    write_json(path, {
        "schema": "upstate.sources/v1",
        "title": "USGS daily river-flow context " + start.isoformat() + " to " + end.isoformat(),
        "captured_at": source_time,
        "scope": {"selection_id": selection_id, "quantity": "volumetric_flow_rate",
                  "statistic": "daily_mean", "parameter_code": FLOW_PARAMETER,
                  "statistic_id": MEAN_STATISTIC, "native_normalized_units": "m^3/s"},
        "entries": [{
            "id": "USGS_DAILY_DISCHARGE", "title": "Original USGS daily mean river discharge",
            "kind": "table", "path": "observations.csv",
            "sha256": sha((root / "observations.csv").read_bytes()),
            "uri": API + "daily", "vintage": start.isoformat() + "/" + end.isoformat(),
            "units": "Original source units and normalized m^3/s",
            "companions": companions,
        }, {
            "id": "USGS_FLOW_STATIONS", "title": "Original USGS discharge monitoring locations",
            "kind": "vector", "path": "stations.geojson",
            "sha256": sha((root / "stations.geojson").read_bytes()),
            "uri": API + "monitoring-locations", "vintage": source_time,
            "crs": "EPSG:4326",
            "companions": [{"path": "stations.csv",
                            "sha256": sha((root / "stations.csv").read_bytes())}],
        }],
        "notes": ["Original daily values, station metadata and per-request bodies are retained.",
                  "Station point membership and whole upstream drainage support are recorded separately."],
    })
    return path, names


def capture(directory, *, start, end, domain=None, domain_member=None,
            expected_features=217, huc_field=None, expected_decoded_sha256=None,
            domain_source_uri=None, station_ids=None,
            request_interval=1.1, attempts=5):
    start, end = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
    if start > end:
        raise ValueError("Start must precede end")
    station_ids = sorted(set(station_ids or []))
    if not domain and not station_ids:
        raise ValueError("Provide the original domain or explicit original station IDs")
    if any(not re.fullmatch(r"USGS-\d{8,15}", x) for x in station_ids):
        raise ValueError("Station IDs must retain the USGS- prefix and original digits")
    polygons, domain_info, domain_body = load_domain(
        domain, member=domain_member, expected_features=expected_features,
        huc_field=huc_field, expected_decoded_sha256=expected_decoded_sha256) if domain else ([], None, None)
    root = Path(directory)
    root.mkdir(parents=True, exist_ok=True)
    if domain_info:
        domain_info["source_uri"] = domain_source_uri
        domain_info["content_uri"] = "urn:sha256:" + domain_info["decoded_sha256"]
        domain_info["retained_source_file"] = "domain/original-domain.json.gz"
        retained_domain = gzip.compress(domain_body, mtime=0)
        domain_info["retained_source_sha256"] = sha(retained_domain)
    selection = {"edition": EDITION, "start": start.isoformat(), "end": end.isoformat(),
                 "domain": domain_info, "station_ids": station_ids,
                 "parameter_code": FLOW_PARAMETER, "statistic_id": MEAN_STATISTIC}
    identity_selection = dict(selection)
    if domain_info:
        identity_selection["domain"] = {k: v for k, v in domain_info.items() if k != "original_path"}
    selection_id = sha(canonical(identity_selection).encode("utf-8"))
    selection_path = root / "selection.json"
    if selection_path.is_file() and read_json(selection_path).get("id") != selection_id:
        raise ValueError("This capture directory belongs to a different retained selection")
    if not selection_path.is_file():
        write_json(selection_path, {"id": selection_id, **selection})
    if domain_info:
        write_bytes(root / domain_info["retained_source_file"], retained_domain)
    client = SourceClient(root / "original", interval=request_interval, attempts=attempts)
    current = {"schema": "upstate.usgs-flow-capture/v1", "edition": EDITION,
               "selection_id": selection_id, "state": "running",
               "started_at": utcnow(), "station_count": 0, "series_count": 0,
               "observation_count": 0, "completed_series": [], "products": []}

    def checkpoint():
        current["updated_at"] = utcnow()
        current["original_requests"] = list(client.used)
        write_json(root / "capture.json", current)

    checkpoint()
    try:
        queries = []
        common = {"parameter_code": FLOW_PARAMETER, "statistic_id": MEAN_STATISTIC}
        if station_ids:
            queries = [client.url("time-series-metadata",
                                  monitoring_location_id=identity, **common)
                       for identity in station_ids]
        else:
            queries = [client.url("time-series-metadata",
                                  bbox=",".join(format(x, ".12g") for x in domain_info["bbox"]),
                                  **common)]
        metadata = {}
        for query in queries:
            for feature, request_id in client.features(query):
                prop = feature["properties"]
                if prop.get("parameter_code") != FLOW_PARAMETER or prop.get("statistic_id") != MEAN_STATISTIC:
                    raise ValueError("USGS series query returned a different observed property")
                if str(prop.get("computation_period_identifier", "")).lower() != "daily":
                    continue
                begin, finish = str(prop.get("begin") or "")[:10], str(prop.get("end") or "")[:10]
                if (begin and dt.date.fromisoformat(begin) > end) or (
                        finish and dt.date.fromisoformat(finish) < start):
                    continue
                if domain_info and not matching_hucs(feature, polygons):
                    continue
                identity = str(feature["id"])
                if identity in metadata and metadata[identity]["feature"] != feature:
                    raise ValueError("Original series metadata changed between queries")
                metadata[identity] = {"feature": feature, "source_request_id": request_id}
        write_json(root / "series.geojson",
                   {"type": "FeatureCollection",
                    "features": [x["feature"] for x in metadata.values()]})
        station_features, station_rows, all_rows, all_summaries = [], [], [], []
        for identity in sorted({str(x["feature"]["properties"]["monitoring_location_id"])
                                for x in metadata.values()}):
            location_rows = list(client.features(client.url(
                "monitoring-locations", id=identity)))
            location_rows = [(feature, request_id) for feature, request_id in location_rows
                             if str(feature["properties"].get("monitoring_location_id",
                                                             feature.get("id"))) == identity]
            if len(location_rows) != 1:
                raise ValueError("Expected one original USGS monitoring-location record: " + identity)
            feature, request_id = location_rows[0]
            prop = feature["properties"]
            hucs = matching_hucs(feature, polygons) if domain_info else []
            if domain_info and not hucs:
                raise ValueError("Original station and series geometry disagree on the domain")
            station_features.append(feature)
            station_rows.append({
                "monitoring_location_id": identity,
                "name": prop.get("monitoring_location_name"),
                "site_type_code": prop.get("site_type_code"),
                "source_hydrologic_unit_code": prop.get("hydrologic_unit_code"),
                "containing_domain_huc12": "|".join(hucs),
                "spatial_relationship": "point_within_original_domain" if domain_info
                                        else "explicit_station_selection",
                "drainage_area": prop.get("drainage_area"),
                "contributing_drainage_area": prop.get("contributing_drainage_area"),
                "drainage_area_unit": "square miles",
                "source_request_id": request_id,
                "source_page": "https://waterdata.usgs.gov/monitoring-location/" + identity + "/",
            })
        write_json(root / "stations.geojson",
                   {"type": "FeatureCollection", "features": station_features})
        station_fields = [
            "monitoring_location_id", "name", "site_type_code",
            "source_hydrologic_unit_code", "containing_domain_huc12",
            "spatial_relationship", "drainage_area", "contributing_drainage_area",
            "drainage_area_unit", "source_request_id", "source_page"]
        write_bytes(root / "stations.csv", csv_bytes(station_rows, station_fields))
        current["station_count"] = len(station_rows)
        current["requested_stations_without_matching_daily_series"] = sorted(
            set(station_ids) - {x["monitoring_location_id"] for x in station_rows})
        current["series_count"] = len(metadata)
        checkpoint()
        for series_id, record in sorted(metadata.items()):
            feature = record["feature"]
            station = feature["properties"]["monitoring_location_id"]
            rows = []
            for year in range(start.year, end.year + 1):
                left, right = max(start, dt.date(year, 1, 1)), min(end, dt.date(year, 12, 31))
                query = client.url("daily", time_series_id=series_id,
                                   datetime=left.isoformat() + "/" + right.isoformat(),
                                   parameter_code=FLOW_PARAMETER, statistic_id=MEAN_STATISTIC)
                for observation, request_id in client.features(query):
                    rows.append(row_value(observation, request_id, feature, start, end))
            rows.sort(key=lambda x: (x["date"], x["observation_id"]))
            rows_path = root / "series" / (safe_name(series_id) + ".csv")
            write_bytes(rows_path, csv_bytes(rows, ROW_FIELDS))
            series_summaries = summaries(rows, station, series_id, start, end)
            all_rows.extend(rows)
            all_summaries.extend(series_summaries)
            current["completed_series"].append({
                "time_series_id": series_id, "monitoring_location_id": station,
                "observations": len(rows), "file": str(rows_path.relative_to(root)),
                "sha256": sha(rows_path.read_bytes()),
                "metadata_request_id": record["source_request_id"],
            })
            current["observation_count"] += len(rows)
            checkpoint()
            print(canonical({"event": "series_complete", "series": series_id,
                             "station": station, "observations": len(rows)}), flush=True)
        write_bytes(root / "observations.csv", csv_bytes(all_rows, ROW_FIELDS))
        write_bytes(root / "coverage.csv", csv_bytes(all_summaries, SUMMARY_FIELDS))
        write_json(root / "source_manifest.json", {
            "schema": "upstate.usgs-flow-sources/v1", "selection_id": selection_id,
            "requests": list(client.used.values()),
            "sources_directory": "original",
            "observations": "Original daily mean discharge; USGS parameter 00060, statistic 00003",
            "normalized_unit": "m^3/s", "ft3_to_m3_exact": CFS_TO_CMS,
            "calendar": "Original USGS date; water year ends September 30",
            "summary_method": "Monthly/calendar-year summaries of unique finite daily values",
            "quantiles": "Linear interpolation between sorted daily values",
            "spatial_method": "Station point intersects original domain polygons, with boundary included",
            "use": "Hydrologic context and source selection for the original model/report",
        })
        write_bytes(root / "hydrology_context.md", context_markdown(
            station_rows, all_summaries, start, end).encode("utf-8"))
        source_time = max((r["retrieved_at"] for r in client.used.values()), default=current["started_at"])
        _, names = workspace_source_manifest(root, selection_id, start, end, source_time,
                                             client.used, metadata)
        for name in sorted(set(names + ["observations.csv", "workspace-sources.json"])):
            path = root / name
            current["products"].append({"path": name, "bytes": path.stat().st_size,
                                        "sha256": sha(path.read_bytes())})
        current["state"] = "complete"
        checkpoint()
        return current
    except BaseException as error:
        current["state"] = "interrupted"
        current["error"] = {"type": type(error).__name__, "message": str(error)}
        checkpoint()
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    parser.add_argument("--start", default="2023-01-01")
    parser.add_argument("--end", default="2023-12-31")
    parser.add_argument("--domain", help="Original geographic GeoJSON, Esri JSON/gzip or retained ZIP")
    parser.add_argument("--domain-member", help="Exact original polygon JSON/gzip member inside ZIP")
    parser.add_argument("--expected-domain-sha256", help="SHA256 of the original decoded domain JSON")
    parser.add_argument("--huc-field")
    parser.add_argument("--domain-source-uri", help="Original publisher/query URI for the retained domain")
    parser.add_argument("--expected-features", type=int, default=217)
    parser.add_argument("--stations", nargs="*", default=[])
    parser.add_argument("--request-interval", type=float, default=1.1)
    parser.add_argument("--attempts", type=int, default=5)
    parser.add_argument("--workspace", help="Import the completed capture into this original Workspace")
    args = parser.parse_args(argv)
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    import fcntl
    with (output / ".capture.lock").open("a+") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        result = capture(args.output, start=args.start, end=args.end,
                         domain=args.domain, domain_member=args.domain_member,
                         expected_features=args.expected_features, huc_field=args.huc_field,
                         expected_decoded_sha256=args.expected_domain_sha256,
                         domain_source_uri=args.domain_source_uri,
                         station_ids=args.stations, request_interval=args.request_interval,
                         attempts=args.attempts)
        if args.workspace:
            sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
            from model.workspace import Workspace
            source = Workspace(args.workspace).import_sources(output / "workspace-sources.json")
            imported = {"source_collection_id": source["id"],
                        "workspace": str(Path(args.workspace).resolve()),
                        "source_manifest": "workspace-sources.json",
                        "capture_selection_id": result["selection_id"]}
            write_json(output / "workspace-import.json", imported)
            result["workspace_import"] = imported
        print(canonical({
            "state": result["state"], "selection_id": result["selection_id"],
            "station_count": result["station_count"], "series_count": result["series_count"],
            "observation_count": result["observation_count"],
            "capture_manifest": str((output / "capture.json").resolve()),
            "workspace_import": result.get("workspace_import"),
        }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
