#!/usr/bin/env python3
"""Retain original Upper Savannah public overlay editions and exact provider identities."""
from __future__ import annotations
import argparse, gzip, json, os, pathlib, re, tempfile
from datetime import datetime, timezone
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

# Reuse the original source publication and geometry interpretation already delivered.
from capture_upstream_network import exact_write, encode, digest, now, PLANNING_SHA

LIMIT = 64 * 1024 * 1024
FOCUS_SHA = "c5e0af7bd6fb8aa72ebb7283ceae6bb694bc203ce98ef0a0e33ce200800c6806"
FOCUS_HUCS = {"030601010703", "030601010704", "030601020507", "030601020502"}
SERVICES = {
    "oconee-parcels": {"title": "Oconee County native parcels", "role": "PARCEL",
        "url": "https://arcserver2.oconeesc.com/arcgis/rest/services/PARCELDATA/MapServer/1",
        "scope": "focus", "page_size": 100},
    "anderson-parcels": {"title": "Anderson County native parcels", "role": "PARCEL",
        "url": "https://propertyviewer.andersoncountysc.org/arcgis/rest/services/NewPropertyViewer/MapServer/5",
        "scope": "focus", "page_size": 100},
    "padus-manager": {"title": "USGS PAD-US published manager inventory", "role": "PROTECTED_LANDS",
        "url": "https://services.arcgis.com/v01gqwM5QqNysAAi/ArcGIS/rest/services/PADUS_Manager_Type/FeatureServer/0",
        "scope": "reporting", "page_size": 50},
    "nhd-flowline": {"title": "USGS NHD Flowline - Large Scale", "role": "NHD",
        "url": "https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/6",
        "scope": "reporting", "page_size": 100},
    "nhd-waterbody": {"title": "USGS NHD Waterbody - Large Scale", "role": "NHD",
        "url": "https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/12",
        "scope": "reporting", "page_size": 50},
    "nwi-wetlands": {"title": "US Fish and Wildlife Service National Wetlands Inventory", "role": "NWI",
        "url": "https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0",
        "scope": "reporting", "page_size": 100},
    "scdes-water-classification-provisional-20261012": {
        "title": "Water Classification - Provisional", "role": "WATER_CLASSIFICATION",
        "url": "https://gis.des.sc.gov/gisserver/rest/services/water/Water_Classifications/MapServer/0",
        "scope": "reporting", "page_size": 100, "classification_status": "provisional"},
    "scdes-surface-water-intakes-20261012": {
        "title": "Surface Water Intakes", "role": "SOURCE_WATER_INTAKES",
        "url": "https://gis.des.sc.gov/gisserver/rest/services/water/Public_Water_Supply/MapServer/0",
        "scope": "reporting", "page_size": 100},
    "scdes-sw-protection-areas-20261012": {
        "title": "SW Protection Areas (SWPA)", "role": "SOURCE_WATER_PROTECTION_AREAS",
        "url": "https://gis.des.sc.gov/gisserver/rest/services/water/Public_Water_Supply/MapServer/2",
        "scope": "reporting", "page_size": 25},
    "scdes-pwsw-protection-zones-20261012": {
        "title": "PWSW Protection Zones", "role": "SOURCE_WATER_PROTECTION_ZONES",
        "url": "https://gis.des.sc.gov/gisserver/rest/services/water/Public_Water_Supply/MapServer/3",
        "scope": "reporting", "page_size": 50},
}

def clean_headers(headers):
    return {key: value for key, value in headers.items()
            if key.lower() not in {"set-cookie", "authorization", "proxy-authorization"}}

class OriginalResponses:
    """A response is immutable; rerunning resumes the exact request and retained body."""
    def __init__(self, root, retry_failed=False):
        self.root = pathlib.Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.retry_failed = retry_failed
        self.locations = {}

    def path(self, name):
        return self.locations[name]

    def response(self, name, url, parameters=None):
        if not re.fullmatch(r"[a-zA-Z0-9_.-]+", name):
            raise ValueError("Use a simple response identity")
        data = None if parameters is None else urlencode(parameters).encode("utf-8")
        method = "GET" if data is None else "POST"
        request_identity = {"url": url, "method": method,
                            "body_sha256": None if data is None else digest(data),
                            "parameters": parameters}
        base = self.root / name
        attempts = sorted(self.root.glob(name + ".attempt-*"))
        folder = attempts[-1] if attempts else base
        if folder.exists() and self.retry_failed:
            previous = json.loads((folder / "receipt.json").read_bytes())
            previous_body = gzip.decompress((folder / "body.json.gz").read_bytes())
            try:
                previous_value = json.loads(previous_body)
            except (ValueError, UnicodeDecodeError):
                previous_value = None
            failed = (previous["status"] != 200 or not isinstance(previous_value, dict)
                      or "error" in previous_value)
            if failed:
                if previous["request"] != request_identity:
                    raise ValueError("Retry requested for another retained source request")
                if previous.get("headers"):
                    from email.utils import parsedate_to_datetime
                    retry = next((v for k, v in previous.get("headers", {}).items()
                                  if k.lower() == "retry-after"), None)
                    if retry:
                        try:
                            due = datetime.fromisoformat(previous["captured_at"]).timestamp() + float(retry)
                        except ValueError:
                            due = parsedate_to_datetime(retry).timestamp()
                        if datetime.now(timezone.utc).timestamp() < due:
                            raise ValueError("Original Retry-After window has not elapsed")
                folder = self.root / (name + ".attempt-" + str(len(attempts)+1).zfill(6))
        if folder.exists():
            receipt = json.loads((folder / "receipt.json").read_bytes())
            if receipt["request"] != request_identity:
                raise ValueError("A retained response belongs to another request: " + name)
            packed = (folder / "body.json.gz").read_bytes()
            body = gzip.decompress(packed)
            if (len(packed) != receipt["stored_bytes"] or digest(packed) != receipt["stored_sha256"]
                    or len(body) != receipt["bytes"] or digest(body) != receipt["sha256"]):
                raise ValueError("A retained original response changed: " + name)
        else:
            started = now()
            headers = {"User-Agent": "TJLabs Upper Savannah original source capture",
                       "Accept": "application/json", "Accept-Encoding": "identity"}
            if data is not None:
                headers["Content-Type"] = "application/x-www-form-urlencoded"
            request = Request(url, data=data, headers=headers, method=method)
            try:
                response = urlopen(request, timeout=60)
            except HTTPError as error:
                response = error
            with response:
                wire = response.read(LIMIT + 1)
                if len(wire) > LIMIT:
                    raise ValueError("Original HTTP response exceeds 64 MiB")
                content_encoding = response.headers.get("Content-Encoding", "identity").lower()
                if content_encoding not in ("identity", "gzip"):
                    raise ValueError("Unsupported original Content-Encoding: " + content_encoding)
                body = gzip.decompress(wire) if content_encoding == "gzip" else wire
                if len(body) > LIMIT:
                    raise ValueError("Decoded original response exceeds 64 MiB")
                packed = gzip.compress(body, mtime=0)
                receipt = {"request": request_identity, "response_url": response.geturl(),
                           "status": response.status, "headers": clean_headers(response.headers),
                           "requested_at": started, "captured_at": now(),
                           "bytes": len(body), "sha256": digest(body),
                           "stored_bytes": len(packed), "stored_sha256": digest(packed),
                           "storage_encoding": "gzip", "content_encoding": content_encoding,
                           "wire_bytes": len(wire), "wire_sha256": digest(wire)}
            with tempfile.TemporaryDirectory(prefix="." + name + "-", dir=self.root) as temporary:
                staged = pathlib.Path(temporary) / "response"
                staged.mkdir()
                exact_write(staged / "body.json.gz", packed)
                if data is not None:
                    exact_write(staged / "request.form", data)
                if wire != body:
                    exact_write(staged / "wire.bin", wire)
                    receipt["wire_file"] = "wire.bin"
                exact_write(staged / "receipt.json", encode(receipt))
                os.rename(staged, folder)
            print(json.dumps({"response": str(folder), "status": receipt["status"],
                              "bytes": receipt["bytes"]}), flush=True)
        self.locations[name] = folder
        if receipt["status"] != 200:
            raise ValueError("Original HTTP status " + str(receipt["status"]) + " retained at " + str(folder))
        value = json.loads(body)
        if not isinstance(value, dict) or "error" in value:
            raise ValueError("Original provider response requires review at " + str(folder))
        return value, receipt

    def query(self, name, base, parameters):
        return self.response(name, base + "/query", {"f": "json", **parameters})

def read_masks(planning, reference):
    import shapefile
    original = (planning / "PlanningBasins2023.shp").read_bytes()
    if digest(original) != PLANNING_SHA:
        raise ValueError("Use the retained original PlanningBasins2023 shapefile")
    import pyproj
    original_prj = (planning / "PlanningBasins2023.prj").read_bytes()
    if digest(original_prj) != "16375a22022b8b34455292d576c5ebb590083e406d754a9abbcca6994c3e3261":
        raise ValueError("Use the original reporting-mask coordinate reference")
    if pyproj.CRS.from_wkt(original_prj.decode()).to_epsg() != 26917:
        raise ValueError("The original reporting mask must retain EPSG:26917")
    if digest((planning / "PlanningBasins2023.dbf").read_bytes()) != "0c792056dcaff94eaa9fb5a22d576a6c42bcce763a885a289f4cdd15434b4dba":
        raise ValueError("Use the original planning attributes")
    reader = shapefile.Reader(str(planning / "PlanningBasins2023.shp"))
    matches = [(number, record) for number, record in enumerate(reader.iterShapeRecords(), 1)
               if record.record.as_dict().get("Basin") == "Upper Savannah"]
    if len(matches) != 1 or matches[0][0] != 5:
        raise ValueError("The reporting mask is whole original Upper Savannah record 5")
    shape = matches[0][1].shape
    starts = list(shape.parts) + [len(shape.points)]
    rings = [[list(point) for point in shape.points[starts[i]:starts[i+1]]]
             for i in range(len(starts)-1)]
    reporting = {"id": "planning-upper-savannah-record-5", "geometry": {"rings": rings},
                 "spatial_reference": {"wkid": 26917},
                 "source": "PlanningBasins2023.shp", "source_sha256": PLANNING_SHA}
    path = reference / "selected-four-huc12.json.gz"
    compressed = path.read_bytes()
    if digest(compressed) != FOCUS_SHA:
        raise ValueError("Use the four original captured utility-focus HUC12 features")
    source = json.loads(gzip.decompress(compressed))
    source_sr = source.get("spatialReference")
    if not source_sr:
        raise ValueError("Original WBD source does not declare its coordinate reference")
    focus = []
    for feature in source["features"]:
        attributes = feature["attributes"]
        huc = next((str(v) for k, v in attributes.items() if k.lower() == "huc12"), None)
        if huc not in FOCUS_HUCS:
            raise ValueError("Unexpected original utility-focus watershed")
        focus.append({"id": huc, "geometry": feature["geometry"],
                      "spatial_reference": source_sr, "source": path.name,
                      "source_sha256": digest(compressed)})
    if {value["id"] for value in focus} != FOCUS_HUCS or len(focus) != 4:
        raise ValueError("The original four utility-focus watersheds must be complete")
    return {"reporting": [reporting], "focus": focus}

def oid_field(metadata):
    name = metadata.get("objectIdField") or metadata.get("objectIdFieldName")
    if not name:
        names = [field["name"] for field in metadata["fields"] if field["type"] == "esriFieldTypeOID"]
        if len(names) != 1:
            raise ValueError("Original layer must publish one native object ID field")
        name = names[0]
    return name

def exact_ids(value, field):
    if value.get("exceededTransferLimit"):
        raise ValueError("The original selection ID response is truncated")
    values = value.get("objectIds")
    if values is None:
        values = []
    if not isinstance(values, list) or any(type(v) is not int for v in values):
        raise ValueError("Original object IDs must be native integers")
    if len(values) != len(set(values)):
        raise ValueError("Original selection contains duplicate object IDs")
    declared = value.get("objectIdFieldName")
    if declared is not None and declared != field:
        raise ValueError("Selection and layer object-ID contracts differ")
    return sorted(values)

def field_rows(value, wanted, field):
    features = value.get("features")
    if not isinstance(features, list):
        raise ValueError("Original page has no features array")
    ids = [feature.get("attributes", {}).get(field) for feature in features]
    if any(type(x) is not int for x in ids) or len(ids) != len(set(ids)) or set(ids) != set(wanted):
        raise ValueError("Page membership differs from its exact requested object IDs")
    return features

def geometry_flags(value, metadata):
    flags = {}
    for name in ("hasZ", "hasM"):
        declarations = [value[name]] if name in value else []
        declarations.extend(feature["geometry"][name] for feature in value.get("features", [])
                            if feature.get("geometry") and name in feature["geometry"])
        if any(type(flag) is not bool for flag in declarations):
            raise ValueError("Original geometry axis flags must be Boolean")
        if len(set(declarations)) > 1:
            raise ValueError("Original page has conflicting geometry axis flags")
        flag = declarations[0] if declarations else metadata.get(name, False)
        if type(flag) is not bool:
            raise ValueError("Original layer geometry axis flag must be Boolean")
        flags[name] = flag
    return flags

def publish_features(path, metadata, page_rows, linear_rows, field, flags):
    """Model intake is derived; every original response remains separately retained."""
    header = {"displayFieldName": metadata.get("displayField", ""),
              "fieldAliases": {x["name"]: x.get("alias", x["name"]) for x in metadata["fields"]},
              "geometryType": metadata["geometryType"],
              "spatialReference": metadata.get("sourceSpatialReference") or metadata["extent"]["spatialReference"],
              "fields": metadata["fields"], **flags}
    with tempfile.TemporaryDirectory(prefix=".features-", dir=path.parent) as temporary:
        staged = pathlib.Path(temporary) / "features.esri.json.gz"
        with staged.open("xb") as raw:
            with gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as output:
                lead = json.dumps(header, ensure_ascii=False, separators=(",", ":")).encode()
                output.write(lead[:-1] + b',"features":[')
                first = True
                for page in page_rows:
                    value = json.loads(gzip.decompress(pathlib.Path(page).read_bytes()))
                    for feature in value["features"]:
                        oid = feature["attributes"][field]
                        if oid in linear_rows:
                            feature = linear_rows[oid]
                        if not first:
                            output.write(b",")
                        output.write(json.dumps(feature, ensure_ascii=False, separators=(",", ":")).encode())
                        first = False
                output.write(b"]}")
            raw.flush(); os.fsync(raw.fileno())
        exact_write(path, staged.read_bytes())

def equivalent_sr(a, b):
    # Identical native declarations require no geometry engine on a receiver.
    va = a.get("latestVcsWkid") or a.get("vcsWkid") or a.get("latestVCSWkid")
    vb = b.get("latestVcsWkid") or b.get("vcsWkid") or b.get("latestVCSWkid")
    if va and vb and va != vb:
        return False
    wa, wb = a.get("wkt"), b.get("wkt")
    if wa and wb and wa == wb:
        return True
    if not wa and not wb:
        ca, cb = a.get("latestWkid") or a.get("wkid"), b.get("latestWkid") or b.get("wkid")
        if ca is not None and cb is not None:
            ca, cb = int(ca), int(cb)
            ca = 3857 if ca in (102100, 102113) else ca
            cb = 3857 if cb in (102100, 102113) else cb
            if ca == cb:
                return True
    # Preserve the existing full CRS comparison for nontrivial declarations.
    import pyproj
    def crs(value):
        if value.get("wkt"):
            return pyproj.CRS.from_wkt(value["wkt"])
        code = value.get("latestWkid") or value.get("wkid")
        if code is None:
            raise ValueError("Original spatial reference has no WKID or WKT")
        if int(code) in (102100, 102113):
            code = 3857
        try:
            return pyproj.CRS.from_user_input("EPSG:" + str(code))
        except pyproj.exceptions.CRSError:
            return pyproj.CRS.from_user_input("ESRI:" + str(code))
    va = a.get("latestVcsWkid") or a.get("vcsWkid") or a.get("latestVCSWkid")
    vb = b.get("latestVcsWkid") or b.get("vcsWkid") or b.get("latestVCSWkid")
    if va and vb and va != vb:
        return False
    return crs(a).equals(crs(b), ignore_axis_order=True)

def seed_metadata(responses, source):
    if not source or (responses.root / "metadata").exists():
        return
    receipt_path = source / "receipt.json"
    body_path = source / "body.json.gz"
    if not receipt_path.exists() or not body_path.exists():
        return
    receipt_bytes = receipt_path.read_bytes()
    original = json.loads(receipt_bytes)
    packed = body_path.read_bytes()
    body = gzip.decompress(packed)
    if (digest(packed) != original["stored_sha256"] or len(packed) != original["stored_bytes"]
            or digest(body) != original["sha256"] or len(body) != original["bytes"]):
        raise ValueError("The retained metadata source changed")
    original_url = original.get("url", original.get("requested_url"))
    original_status = original.get("status", original.get("http_status"))
    if not isinstance(original_url, str) or type(original_status) is not int:
        raise ValueError("The original metadata receipt lacks its URL or HTTP status")
    receipt = {"request": {"url": original_url, "method": "GET",
                          "body_sha256": None, "parameters": None},
               "response_url": original["final_url"], "status": original_status,
               "headers": clean_headers(original["headers"]),
               "requested_at": original["requested_at"], "captured_at": original["observed_at"],
               "bytes": len(body), "sha256": digest(body), "stored_bytes": len(packed),
               "stored_sha256": digest(packed), "storage_encoding": "gzip",
               "original_metadata_capture": original,
               "metadata_source_receipt_sha256": digest(receipt_bytes)}
    wire = None
    wire_path = source / "wire.bin"
    if wire_path.exists():
        wire = wire_path.read_bytes()
        if (digest(wire) != original.get("wire_sha256")
                or len(wire) != original.get("wire_bytes")):
            raise ValueError("The original metadata HTTP entity changed")
        receipt.update({"wire_sha256": digest(wire), "wire_bytes": len(wire),
                        "content_encoding": original.get("content_encoding", "identity")})
    elif original.get("wire_sha256") not in (None, digest(body)):
        raise ValueError("The retained metadata declares a separate HTTP entity that is absent")
    with tempfile.TemporaryDirectory(prefix=".metadata-seed-", dir=responses.root) as temporary:
        staged = pathlib.Path(temporary) / "response"
        staged.mkdir()
        exact_write(staged / "body.json.gz", packed)
        exact_write(staged / "receipt.json", encode(receipt))
        exact_write(staged / "source-receipt.json", receipt_bytes)
        if wire is not None:
            exact_write(staged / "wire.bin", wire)
        os.rename(staged, responses.root / "metadata")

def native_geometry_parameters(metadata, source_sr):
    """Request stored coordinates when the service's map CRS is different."""
    published_sr = metadata.get("spatialReference") or metadata.get("extent", {}).get("spatialReference")
    def declaration(value):
        if not value:
            return None
        vertical = (value.get("latestVcsWkid") or value.get("vcsWkid")
                    or value.get("latestVCSWkid"))
        if value.get("wkt"):
            return ("wkt", value["wkt"], vertical)
        code = value.get("latestWkid") or value.get("wkid")
        if code is None:
            return None
        code = int(code)
        return ("wkid", 3857 if code in (102100, 102113) else code, vertical)
    source_declaration = declaration(source_sr)
    if source_declaration is not None and source_declaration == declaration(published_sr):
        return {}
    # ArcGIS defaults to the map CRS; preserve the full original native declaration.
    return {"outSR": json.dumps(source_sr, sort_keys=True, separators=(",", ":"))}


def source_where(spec):
    """Retain the publisher's exact feature predicate as part of source selection."""
    value = spec.get("where", "1=1")
    if not isinstance(value, str) or not value.strip() or "\0" in value:
        raise ValueError("Use a nonempty original ArcGIS feature selection")
    return value


def capture_layer(root, identity, spec, masks, retry_failed=False, metadata_root=None, responses=None):
    where = source_where(spec)
    selected_parameters = {"where": where} if where != "1=1" else {}
    folder = root / identity
    folder.mkdir(parents=True, exist_ok=True)
    if responses is None:
        responses = OriginalResponses(folder / "responses", retry_failed=retry_failed)
    elif pathlib.Path(responses.root).resolve() != (folder / "responses").resolve():
        raise ValueError("The original response client belongs to another capture folder")
    seed_metadata(responses, metadata_root / identity if metadata_root else None)
    metadata, _ = responses.response("metadata", spec["url"] + "?f=pjson")
    field = oid_field(metadata)
    if metadata.get("geometryType") not in ("esriGeometryPolygon", "esriGeometryPolyline", "esriGeometryPoint"):
        raise ValueError("Unsupported original overlay geometry: " + str(metadata.get("geometryType")))
    source_sr = metadata.get("sourceSpatialReference") or metadata.get("extent", {}).get("spatialReference")
    if not source_sr:
        raise ValueError("Original service does not declare its source CRS")
    geometry_parameters = native_geometry_parameters(metadata, source_sr)
    selections, selected = [], set()
    for mask in masks[spec["scope"]]:
        geometry = {**mask["geometry"], "spatialReference": mask["spatial_reference"]}
        parameters = {"where": where, "geometry": json.dumps(geometry, separators=(",", ":")),
                      "geometryType": "esriGeometryPolygon", "inSR": json.dumps(mask["spatial_reference"]),
                      "spatialRel": "esriSpatialRelIntersects"}
        count, count_receipt = responses.query("count-" + mask["id"], spec["url"],
                                              {**parameters, "returnCountOnly": "true"})
        listed, ids_receipt = responses.query("ids-" + mask["id"], spec["url"],
                                              {**parameters, "returnIdsOnly": "true"})
        ids = exact_ids(listed, field)
        if type(count.get("count")) is not int or count["count"] != len(ids):
            raise ValueError("Original count and selected IDs changed; both responses retained for review")
        selections.append({"mask": mask, "count": len(ids), "object_ids": ids,
                           "count_sha256": count_receipt["sha256"], "ids_sha256": ids_receipt["sha256"]})
        selected.update(ids)
    ids = sorted(selected)
    exact_write(folder / "selection.json", encode({"native_object_id_field": field,
                "scope": spec["scope"], "source_spatial_reference": source_sr, **selected_parameters,
                "selections": selections, "unique_count": len(ids), "object_ids": ids}))
    page_size = min(spec["page_size"], int(metadata.get("maxRecordCount") or spec["page_size"]))
    if page_size < 1:
        raise ValueError("Invalid provider page size")
    pages, linear, curves = [], {}, []
    observed_flags = None
    def acquire(batch):
        nonlocal observed_flags
        label = "features-" + digest(encode(batch))[:20]
        if geometry_parameters:
            # Keep earlier default-CRS responses under their original request identities.
            label += "-native-" + digest(encode(geometry_parameters))[:12]
        value, receipt = responses.query(label, spec["url"], {"objectIds": ",".join(map(str, batch)),
            "outFields": "*", "returnGeometry": "true", "returnTrueCurves": "true",
            "returnZ": "true", "returnM": "true", **geometry_parameters, **selected_parameters})
        if value.get("exceededTransferLimit"):
            if len(batch) == 1:
                raise ValueError("Original provider truncates one exact feature")
            midpoint = len(batch) // 2
            acquire(batch[:midpoint]); acquire(batch[midpoint:])
            return
        rows = field_rows(value, batch, field)
        flags = geometry_flags(value, metadata)
        if observed_flags is not None and flags != observed_flags:
            raise ValueError("Original pages differ in their Z/M axis contract")
        observed_flags = flags
        page_sr = value.get("spatialReference") or source_sr
        if not equivalent_sr(page_sr, source_sr):
            # The requested native declaration and returned page CRS must agree before publication.
            raise ValueError("Original page and layer source coordinate declarations differ; inspect before combining")
        page = responses.path(label) / "body.json.gz"
        pages.append(str(page))
        curved = [row for row in rows if row.get("geometry") and
                  ("curveRings" in row["geometry"] or "curvePaths" in row["geometry"])]
        if curved:
            curve_ids = [row["attributes"][field] for row in curved]
            linear_label = label + "-provider-linear"
            result, linear_receipt = responses.query(linear_label, spec["url"], {
                "objectIds": ",".join(map(str, curve_ids)), "outFields": "*",
                "returnGeometry": "true", "returnTrueCurves": "false", "returnZ": "true", "returnM": "true",
                **geometry_parameters, **selected_parameters})
            if result.get("exceededTransferLimit"):
                raise ValueError("Exact provider-linear curve response truncated")
            if not equivalent_sr(result.get("spatialReference") or source_sr, page_sr):
                raise ValueError("Provider-linear and original curve responses use different coordinate references")
            if geometry_flags(result, metadata) != flags:
                raise ValueError("Provider-linear and original curve responses have different Z/M axis flags")
            resolved = field_rows(result, curve_ids, field)
            before = {row["attributes"][field]: row for row in curved}
            for row in resolved:
                oid = row["attributes"][field]
                if row["attributes"] != before[oid]["attributes"] or not row.get("geometry"):
                    raise ValueError("Curve representation has changed source attributes or absent geometry")
                if "curveRings" in row["geometry"] or "curvePaths" in row["geometry"]:
                    raise ValueError("Provider did not return a linear representation")
                linear[oid] = row
                curves.append({"object_id": oid, "original_response": str(page.relative_to(root)),
                    "original_sha256": receipt["sha256"],
                    "analysis_response": str((responses.path(linear_label)/"body.json.gz").relative_to(root)),
                    "analysis_sha256": linear_receipt["sha256"],
                    "method": "Provider returnTrueCurves=false, original native CRS, no generalization or tolerance supplied"})
    for start in range(0, len(ids), page_size):
        acquire(ids[start:start+page_size])
    path = folder / "features.esri.json.gz"
    publish_features(path, metadata, pages, linear, field, observed_flags or geometry_flags({}, metadata))
    packed = path.read_bytes()
    files = []
    for item in sorted(folder.rglob("*")):
        if item.is_file() and item.name != "layer-capture.json":
            body = item.read_bytes()
            files.append({"path": item.relative_to(root).as_posix(), "bytes": len(body), "sha256": digest(body)})
    result = {"id": identity, "title": spec["title"], "role": spec["role"],
              "uri": spec["url"], "kind": "vector", "source_crs": source_sr,
              "id_field": field, "feature_count": len(ids), "scope": spec["scope"], **selected_parameters,
              "source_name": metadata.get("name"),
              "source_description": metadata.get("description", ""),
              "source_copyright": metadata.get("copyrightText", ""),
              "classification_status": spec.get("classification_status"),
              "geometry_flags": observed_flags or geometry_flags({}, metadata),
              "path": path.relative_to(root).as_posix(), "sha256": digest(packed),
              "storage_encoding": "gzip", "decoded_sha256": digest(gzip.decompress(packed)),
              "files": files, "curve_representations": curves,
              "coverage": spec.get("coverage") or ("Complete original county features intersecting the four utility-focus HUC12s"
                           if spec["scope"] == "focus" else
                           "Complete original features intersecting the whole PlanningBasins2023 Upper Savannah reporting polygon"),
              "derivation": "Feature order/grouping normalized from unchanged native field values; all original HTTP bodies, attributes, geometries and numeric source tokens are retained in response files"}
    exact_write(folder / "layer-capture.json", encode(result))
    return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    parser.add_argument("--planning-source", required=True)
    parser.add_argument("--reference-wbd-source", required=True)
    parser.add_argument("--metadata-root", default=str(pathlib.Path(__file__).resolve().parent / "overlay-metadata"),
                        help="Reuse byte-verified original metadata captures before any source metadata request")
    parser.add_argument("--retry-failed", action="store_true",
                        help="Make one new preserved attempt for an original failed request, honoring Retry-After")
    parser.add_argument("--sources", default=",".join(SERVICES),
                        help="Comma-separated complete native sources; defaults to all ten")
    args = parser.parse_args()
    chosen = args.sources.split(",")
    if len(chosen) != len(set(chosen)) or any(x not in SERVICES for x in chosen):
        raise ValueError("Select unique documented native source IDs")
    root = pathlib.Path(args.output).absolute()
    root.mkdir(parents=True, exist_ok=True)
    selection = {"schema": "upstate.overlay-source-selection/v1", "source_ids": chosen,
                 "source_contracts": {key: SERVICES[key] for key in chosen},
                 "planning_sha256": PLANNING_SHA, "focus_gzip_sha256": FOCUS_SHA}
    exact_write(root / "request.json", encode(selection))
    masks = read_masks(pathlib.Path(args.planning_source), pathlib.Path(args.reference_wbd_source))
    exact_write(root / "masks.json", encode(masks))
    sources = [capture_layer(root, key, SERVICES[key], masks, args.retry_failed, pathlib.Path(args.metadata_root)) for key in chosen]
    manifest = {"schema": "upstate.sources/v1", "title": "Original Upper Savannah overlay source edition",
                "entries": [], "scope": {"reporting": "Whole original PlanningBasins2023 Upper Savannah record 5",
                  "parcel_selection": "Complete county intersections with the four original utility-focus HUC12s",
                  "focus_huc12": sorted(FOCUS_HUCS)}}
    for source in sources:
        manifest["entries"].append({"id": source["id"], "title": source["title"],
            "uri": source["uri"], "vintage": "provider-observed source edition; see original response UTC timestamps",
            "kind": "vector", "role": source["role"], "path": source["path"], "sha256": source["sha256"],
            "id_field": source["id_field"],
            "companions": [{"path": source["id"] + "/layer-capture.json",
                "sha256": digest((root/source["id"]/"layer-capture.json").read_bytes())}]
                + [row for row in source["files"] if row["path"] != source["path"]],
            "metadata": {"source_crs": source["source_crs"], "feature_count": source["feature_count"],
                "scope": source["scope"], "curve_representations": source["curve_representations"],
                "source_capture": "layer-capture.json",
                "source_name": source["source_name"], "source_description": source["source_description"],
                "source_copyright": source["source_copyright"],
                "classification_status": source["classification_status"]}})
    manifest["entries"].append({"id": "overlay-native-selection-context",
        "title": "Original overlay query masks and source selection", "kind": "document",
        "uri": "https://des.sc.gov/sites/des/files/Documents/BOW/Water%20Resources/Hydrology/Upper%20Savannah/FinalUpperSavannahRiverBasinPlan2025.pdf",
        "vintage": "PlanningBasins2023 with original WBD focus capture 2026-10-12",
        "path": "masks.json", "sha256": digest((root/"masks.json").read_bytes()),
        "companions": [{"path": "request.json", "sha256": digest((root/"request.json").read_bytes())}]})
    exact_write(root / "model-sources.json", encode(manifest))
    exact_write(root / "capture.json", encode({"schema": "upstate.overlay-source-capture/v1",
        "sources": sources, "source_selection": selection,
        "notes": ["Retained county parcel coverage is the complete declared four-HUC intersection, not all basin counties.",
                  "PAD-US contains overlapping management/designation records; inventory geometry is not a unique-area total.",
                  "SCDES classifications retain their original provisional edition and class fields for an explicit reviewed delivery selection.",
                  "Source-water intakes and published protection zones retain their native utility and time-of-travel context.",
                  "The workbench binds the high_quality_waters selection to an actual class/where filter and its separate authoritative rule source."]}))
    print(json.dumps({"complete": True, "root": str(root), "layers": len(sources),
        "features": sum(x["feature_count"] for x in sources),
        "manifest_sha256": digest((root/"capture.json").read_bytes())}), flush=True)

if __name__ == "__main__":
    main()
