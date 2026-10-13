#!/usr/bin/env python3
"""Capture SC DES classified-water source layers without changing native geometry.

Run from the retained Upper Savannah project. Uses only the Python standard library.
The companion high_quality_water_crosswalk.py performs local spatial analysis.
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

APP_ID = "d0827cf30d3c490f9e22dd1000b8195a"
PORTAL = "https://gis.des.sc.gov/gisportal"
CURRENT_PDF = "https://des.sc.gov/sites/des/files/Library/Regulations/R.61-69.pdf"
PROPOSED_PDF = (
    "https://des.sc.gov/sites/des/files/Library/Regulations/"
    "5474_R.61-68%20%26%2069%20NPR_Full%20Text.pdf"
)
SCHEMA = "upstate.classified-water-capture/v1"

try:
    from .water_classifications import classification_scope
except ImportError:
    from water_classifications import classification_scope


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def sha(body):
    return hashlib.sha256(body).hexdigest()


def encode(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(",", ":")) + "\n").encode("utf-8")


def exact_write(path, body):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != body:
            raise ValueError("Retained source member differs: " + str(path))
        return
    pending = path.with_name(path.name + ".pending-" + str(os.getpid()))
    with pending.open("xb") as stream:
        stream.write(body)
        stream.flush()
        os.fsync(stream.fileno())
    try:
        # A concurrent receiver may have completed this exact same member.
        os.link(pending, path)
    except FileExistsError:
        if path.read_bytes() != body:
            raise ValueError("Concurrent source member differs: " + str(path))
    finally:
        pending.unlink(missing_ok=True)


def public_url(url):
    value = urllib.parse.urlsplit(url)
    if value.scheme != "https" or not value.hostname or value.username or value.password:
        raise ValueError("Use the original public HTTPS source URL")
    if value.fragment:
        value = value._replace(fragment="")
    return urllib.parse.urlunsplit(value)


def query_url(url, values):
    parts = urllib.parse.urlsplit(public_url(url))
    query = dict(urllib.parse.parse_qsl(parts.query, keep_blank_values=True))
    query.update({key: str(value) for key, value in values.items()})
    return urllib.parse.urlunsplit(parts._replace(query=urllib.parse.urlencode(query)))


def describe(root, path):
    path = Path(path)
    body = path.read_bytes()
    return {"path": path.relative_to(root).as_posix(),
            "sha256": sha(body), "bytes": len(body)}


def read_retained(root, item):
    path = root / item["path"]
    body = path.read_bytes()
    if len(body) != item["bytes"] or sha(body) != item["sha256"]:
        raise ValueError("Retained member changed: " + item["path"])
    return body


class Capture:
    def __init__(self, root, pause=0.4, page_size=100):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.pause = pause
        self.page_size = page_size
        self.last_request = 0.0
        self.files = {}

    def remember(self, path):
        item = describe(self.root, path)
        self.files[item["path"]] = item
        return item

    def fetch(self, relative, url, *, expect_json=True):
        """Retain exact response bytes and URL; reuse only the identical request."""
        path = self.root / relative
        receipt_path = path.with_name(path.name + ".request.json")
        url = public_url(url)
        if receipt_path.exists():
            receipt = json.loads(receipt_path.read_bytes())
            if receipt["url"] != url:
                raise ValueError("A retained request path belongs to another URL")
            raw = read_retained(self.root, receipt["body"])
        else:
            time.sleep(max(0.0, self.pause - (time.monotonic() - self.last_request)))
            request = urllib.request.Request(
                url, headers={"User-Agent": "Upstate-Source-Capture/1.0",
                              "Accept-Encoding": "identity"})
            for attempt in range(4):
                try:
                    with urllib.request.urlopen(request, timeout=60) as response:
                        raw = response.read()
                        header = {key.lower(): value for key, value in response.headers.items()
                                  if key.lower() in ("date", "etag", "last-modified",
                                                     "content-type", "content-length")}
                        final_url = response.url
                    self.last_request = time.monotonic()
                    break
                except urllib.error.HTTPError as error:
                    self.last_request = time.monotonic()
                    if error.code not in (429, 502, 503, 504) or attempt == 3:
                        raise
                    retry = error.headers.get("Retry-After", "")
                    delay = int(retry) if retry.isdigit() else 2 ** (attempt + 1)
                    time.sleep(min(60, max(1, delay)))
            exact_write(path, raw)
            receipt = {"url": url, "final_url": final_url, "captured_at": now(),
                       "headers": header, "body": self.remember(path)}
            exact_write(receipt_path, encode(receipt))
        self.remember(path)
        self.remember(receipt_path)
        if not expect_json:
            return raw, receipt
        value = json.loads(raw)
        if not isinstance(value, dict) or value.get("error"):
            raise ValueError("Source response is not a successful JSON object: " + url)
        return value, receipt

    def json(self, relative, url, values=None):
        return self.fetch(relative, query_url(url, {"f": "json", **(values or {})}))[0]


def walk(value):
    if isinstance(value, dict):
        for key, item in value.items():
            yield key, item
            yield from walk(item)
    elif isinstance(value, list):
        for item in value:
            yield from walk(item)


def discover(args):
    capture = Capture(args.output, args.request_pause)
    pending, seen, services = [APP_ID], set(), set()
    items = []
    while pending:
        item_id = pending.pop(0)
        if item_id in seen:
            continue
        if len(seen) >= 32:
            raise ValueError("Unexpectedly large app-item graph; inspect retained discovery responses")
        seen.add(item_id)
        base = PORTAL + "/sharing/rest/content/items/" + item_id
        item = capture.json("discovery/items/" + item_id + ".json", base)
        data = capture.json("discovery/items/" + item_id + "-data.json", base + "/data")
        items.append({"id": item_id, "title": item.get("title"), "type": item.get("type")})
        for key, value in walk(data):
            if not isinstance(value, str):
                continue
            if key.lower() in ("itemid", "webmap", "webmapid") and re.fullmatch(r"[a-fA-F0-9]{32}", value):
                pending.append(value)
            if key.lower() == "url" and re.search(r"/(?:MapServer|FeatureServer)(?:/\d+)?/?(?:\?.*)?$", value):
                services.add(public_url(value.split("?")[0]).rstrip("/"))
    layers = []
    for service in sorted(services):
        key = sha(service.encode())[:16]
        metadata = capture.json("discovery/services/" + key + ".json", service)
        if re.search(r"/\d+$", service):
            definitions = [(service, metadata)]
        else:
            definitions = []
            for layer in metadata.get("layers", []):
                if layer.get("subLayerIds"):
                    continue
                url = service + "/" + str(layer["id"])
                value = capture.json("discovery/layers/" + sha(url.encode())[:16] + ".json", url)
                definitions.append((url, value))
        for url, layer in definitions:
            if layer.get("geometryType") not in ("esriGeometryPolyline", "esriGeometryPolygon"):
                continue
            fields = layer.get("fields", [])
            searchable = " ".join(str(layer.get(k, "")) for k in ("name", "description"))
            layers.append({"url": url, "name": layer.get("name"),
                           "description": layer.get("description"),
                           "geometry_type": layer.get("geometryType"),
                           "likely_classification_layer": bool(re.search(
                               r"classif|outstanding|trout", searchable, re.I)),
                           "fields": fields, "drawingInfo": layer.get("drawingInfo")})
    result = {"schema": "upstate.classified-water-discovery/v1", "created_at": now(),
              "app_id": APP_ID, "portal": PORTAL, "items": items, "layers": layers,
              "files": list(capture.files.values())}
    exact_write(capture.root / "discovery.json", encode(result))
    print(json.dumps({"discovery": str(capture.root / "discovery.json"),
                      "layers": [{"url": x["url"], "name": x["name"],
                                  "likely_classification_layer": x["likely_classification_layer"]}
                                 for x in layers]}, indent=2))


def layer_id(url):
    return "scdes-classified-" + sha(url.encode())[:16]


def editing_date(metadata):
    return (metadata.get("editingInfo") or {}).get("lastEditDate")


def capture_layer(capture, source_url):
    url = public_url(source_url).rstrip("/")
    if not re.search(r"/(?:MapServer|FeatureServer)/\d+$", url):
        raise ValueError("Capture an exact published feature layer URL, including its layer number")
    key = layer_id(url)
    folder = key + "/"
    metadata = capture.json(folder + "layer.json", url)
    fields = metadata.get("fields", [])
    oid = native_oid(metadata)
    query = url + "/query"
    count = capture.json(folder + "count.json", query,
                         {"where": "1=1", "returnCountOnly": "true"})["count"]
    id_response = capture.json(folder + "object-ids.json", query,
                               {"where": "1=1", "returnIdsOnly": "true"})
    ids = id_response.get("objectIds")
    if ids is None:
        ids = [] if count == 0 else None
    if (not isinstance(ids, list) or len(ids) != count or len(set(ids)) != len(ids)
            or any(isinstance(i, bool) or not isinstance(i, int) for i in ids)):
        raise ValueError("Native unique IDs must exactly match the published count")
    if id_response.get("objectIdFieldName") not in (None, oid):
        raise ValueError("Native object-ID field changed")
    ids = sorted(ids)
    features, pages, references, geometry_types = {}, [], [], set()

    def get_page(requested):
        page_key = sha(encode(requested))[:16]
        relative = folder + "pages/" + page_key + ".json"
        result = capture.json(relative, query, {
            "objectIds": ",".join(map(str, requested)), "outFields": "*",
            "returnGeometry": "true", "returnTrueCurves": "true",
            "returnZ": "true", "returnM": "true"})
        rows = result.get("features")
        if result.get("exceededTransferLimit"):
            if len(requested) == 1:
                raise ValueError("The provider truncated one complete native feature")
            middle = len(requested) // 2
            get_page(requested[:middle])
            get_page(requested[middle:])
            return
        if not isinstance(rows, list) or len(rows) != len(requested):
            raise ValueError("Native feature page count differs from its requested ID set")
        actual = [f.get("attributes", {}).get(oid) for f in rows]
        if len(set(actual)) != len(actual) or set(actual) != set(requested):
            raise ValueError("Native page does not contain exactly its requested object IDs")
        if result.get("spatialReference") is not None:
            references.append(result["spatialReference"])
        if result.get("geometryType"):
            geometry_types.add(result["geometryType"])
        if result.get("fields") is not None and result["fields"] != fields:
            # ArcGIS query schemas can omit layer-only metadata. Preserve each declaration.
            if [(f["name"], f.get("type")) for f in result["fields"]
                    if f.get("type") != "esriFieldTypeGeometry"] != [
                    (f["name"], f.get("type")) for f in fields
                    if f.get("type") != "esriFieldTypeGeometry"]:
                raise ValueError("Query and layer field names/types differ")
        for row in rows:
            identity = row["attributes"][oid]
            if identity in features:
                raise ValueError("A native object ID occurs in more than one complete page")
            features[identity] = row
        pages.append({**describe(capture.root, capture.root / relative),
                      "object_ids": requested})

    page_size = min(capture.page_size, max(1, int(metadata.get("maxRecordCount") or 100)))
    for start in range(0, len(ids), page_size):
        get_page(ids[start:start + page_size])
    if set(features) != set(ids):
        raise ValueError("Completed pages must contain the complete original ID set")
    spatial = (references[0] if references else
               (metadata.get("extent") or {}).get("spatialReference"))
    if not isinstance(spatial, dict):
        raise ValueError("The native source must declare its original spatial reference")
    def crs_key(value):
        return value.get("wkt2") or value.get("wkt") or value.get("latestWkid") or value.get("wkid")
    if any(crs_key(reference) != crs_key(spatial) for reference in references):
        raise ValueError("Native page coordinate systems differ")
    geometry_type = metadata.get("geometryType")
    if geometry_types and geometry_types != {geometry_type}:
        raise ValueError("Native geometry type changed between pages")
    # Fresh end requests establish the source did not publish a different ID set
    # or exposed edit date while the retained pages were acquired.
    suffix = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    end_metadata = capture.json(folder + "layer-end-" + suffix + ".json", url)
    end_ids = capture.json(folder + "object-ids-end-" + suffix + ".json", query,
                           {"where": "1=1", "returnIdsOnly": "true"})
    if set(end_ids.get("objectIds") or []) != set(ids):
        raise ValueError("Native IDs changed during capture; retained responses remain available")
    if editing_date(metadata) != editing_date(end_metadata):
        raise ValueError("Publisher edit date changed during capture; create a fresh edition")
    combined = {"objectIdFieldName": oid, "geometryType": geometry_type,
                "spatialReference": spatial, "fields": fields,
                "hasZ": metadata.get("hasZ", False), "hasM": metadata.get("hasM", False),
                "features": [features[i] for i in ids]}
    decoded = encode(combined)
    combined_path = capture.root / folder / "features.esri.json.gz"
    exact_write(combined_path, gzip.compress(decoded, mtime=0))
    capture.remember(combined_path)
    return {"id": key, "url": url, "title": metadata.get("name") or key,
            "oid_field": oid, "source_crs": spatial, "geometry_type": geometry_type,
            "field_schema": fields, "metadata_path": folder + "layer.json",
            "object_ids_path": folder + "object-ids.json", "count_path": folder + "count.json",
            "pages": pages, "combined_path": folder + "features.esri.json.gz",
            "decoded_sha256": sha(decoded), "decoded_bytes": len(decoded),
            "feature_count": len(features), "editing_date": editing_date(metadata),
            "native_page_order": "Retained within each original response",
            "combined_order": "Derived collection sorted by original numeric object ID",
            "geometry_transform": "None in source capture"}



def write_generated_manifest(root, manifest):
    """Refresh generated source metadata while preserving immutable source bodies."""
    root = Path(root)
    path = root / "sources.json"
    body = encode(manifest)
    if not path.exists():
        exact_write(path, body)
        return
    if path.is_symlink():
        raise ValueError("The generated source manifest must be a regular local file")
    previous_body = path.read_bytes()
    if previous_body == body:
        return
    previous = json.loads(previous_body)
    if previous.get("schema") != "upstate.sources/v1":
        raise ValueError("Existing sources.json belongs to another source schema")

    def source_identities(document):
        entries = document.get("entries")
        if not isinstance(entries, list):
            raise ValueError("Generated manifest has no source entries")
        identities = {}
        for entry in entries:
            identifier = entry["id"]
            if identifier in identities:
                raise ValueError("Generated manifest repeats a source identifier")
            members = [entry, *(entry.get("companions") or [])]
            identities[identifier] = (
                entry["kind"],
                sorted((member["path"], member["sha256"], member["bytes"])
                       for member in members),
            )
        return identities

    if source_identities(previous) != source_identities(manifest):
        raise ValueError("Generated manifests describe different retained source bodies; "
                         "use the output directory for the selected source edition")
    for entry in manifest["entries"]:
        for member in [entry, *(entry.get("companions") or [])]:
            read_retained(root, member)
    # Preserve the exact former import manifest; the native source members stay fixed.
    exact_write(root / "source-manifests" / (sha(previous_body) + ".json"), previous_body)
    pending = None
    try:
        with tempfile.NamedTemporaryFile(mode="wb", dir=root,
                                         prefix="sources-", suffix=".pending",
                                         delete=False) as stream:
            pending = Path(stream.name)
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        current_body = path.read_bytes()
        if current_body == body:
            return
        if current_body != previous_body:
            raise ValueError("Generated source manifest changed concurrently; rerun adoption")
        os.replace(pending, path)
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


def write_source_manifest(root, result):
    files = {item["path"]: item for item in result["files"]}
    entries = []
    for layer in result["layers"]:
        companions = [row for path, row in files.items()
                      if path.startswith(layer["id"] + "/") and path != layer["combined_path"]]
        entries.append({"id": layer["id"], "title": layer["title"], "kind": "vector",
                        **files[layer["combined_path"]], "uri": layer["url"],
                        "vintage": ("publisher edit epoch-ms " + str(layer["editing_date"])
                                    if layer["editing_date"] is not None else
                                    ((layer.get("selection") or {}).get("original_capture_date")
                                     or result["created_at"])),
                        "observed_at": result["created_at"], "source_format": "Esri JSON",
                        "encoding": "gzip", "decoded_sha256": layer["decoded_sha256"],
                        "decoded_bytes": layer["decoded_bytes"],
                        "role": "WATER_CLASSIFICATION",
                        "capture_role": "WATER_CLASSIFICATION_SOURCE",
                        "id_field": layer["oid_field"],
                        "native_oid_field": layer["oid_field"],
                        "class_field": (layer.get("selection") or {}).get("class_field"),
                        "field_schema": layer["field_schema"],
                        "metadata": {
                            "id_field": layer["oid_field"],
                            "native_oid_field": layer["oid_field"],
                            "class_field": (layer.get("selection") or {}).get("class_field"),
                            "classification_status": layer.get("data_status"),
                        },
                        "source_spatial_reference": layer["source_crs"],
                        "native_feature_count": layer["feature_count"],
                        "upstream_source_id": layer.get("upstream_source_id"),
                        "data_status": layer.get("data_status"),
                        "source_selection": layer.get("selection"),
                        **{key: layer[key] for key in ("jurisdiction", "classification_system") if key in layer},
                        "source_adoption": layer.get("adoption"),
                        "representation": "Derived native-feature collection; exact publisher pages are companions",
                        "companions": companions})
    for item in result["documents"]:
        entries.append({"id": item["id"], "title": item["title"], "kind": "document",
                        **files[item["path"]], "uri": item["uri"],
                        "vintage": item["id"], "designation_status": item["status"],
                        "observed_at": item["captured_at"]})
    title = ("Jurisdiction-qualified classified-water source edition" if any(layer.get("classification_system") for layer in result["layers"])
             else "SC DES classified-water source edition")
    manifest = {"schema": "upstate.sources/v1", "title": title,
                "captured_at": result["created_at"], "entries": entries,
                "notes": ["Original object IDs, all source fields, native geometry and CRS retained.",
                          "Current and proposed regulatory editions remain separate sources.",
                          "The assembled feature collection is derived solely by concatenating native responses."]}
    write_generated_manifest(root, manifest)


def capture_command(args):
    capture = Capture(args.output, args.request_pause, args.page_size)
    final_path = capture.root / "capture.json"
    if final_path.exists():
        retained = json.loads(final_path.read_bytes())
        if retained.get("schema") != SCHEMA:
            raise ValueError("Output directory belongs to another capture schema")
        if retained.get("acquisition_mode") == "retained-source-adoption":
            raise ValueError("This directory is an adopted selection; reuse it with adopt, or capture a new complete edition elsewhere")
        if {x["url"] for x in retained["layers"]} != {public_url(u).rstrip("/") for u in args.layer_url}:
            raise ValueError("Use a new source directory for a different layer set")
        for item in retained["files"]:
            read_retained(capture.root, item)
        write_source_manifest(capture.root, retained)
        print(json.dumps({"capture": str(final_path), "sources": str(capture.root / "sources.json"), "reused": True,
                          "sha256": sha(final_path.read_bytes())}))
        return
    layers = [capture_layer(capture, url) for url in dict.fromkeys(args.layer_url)]
    documents = []
    for edition, url, status, title in (
            ("current-2023", CURRENT_PDF, "current", "SC R.61-69 classified waters; CWA effective 2023-12-12"),
            ("proposed-2026-5474", PROPOSED_PDF, "proposed", "SC R.61-68 and R.61-69 proposed amendments, document 5474")):
        relative = "regulations/" + edition + ".pdf"
        raw, receipt = capture.fetch(relative, url, expect_json=False)
        if not raw.startswith(b"%PDF-"):
            raise ValueError("The original regulation URL did not return a PDF")
        documents.append({"id": "sc-r61-69-" + edition, "path": relative,
                          "uri": url, "status": status, "title": title,
                          "captured_at": receipt["captured_at"]})
    result = {"schema": SCHEMA, "created_at": now(), "app_id": APP_ID,
              "layers": layers, "documents": documents,
              "files": list(capture.files.values())}
    exact_write(final_path, encode(result))
    write_source_manifest(capture.root, result)
    print(json.dumps({"capture": str(final_path), "sources": str(capture.root / "sources.json"),
                      "layers": [{"id": x["id"], "features": x["feature_count"],
                                  "url": x["url"]} for x in layers]}, indent=2))



def native_oid(metadata):
    """Resolve field names by their Esri type; display aliases are not identifiers."""
    fields = metadata.get("fields") or []
    declared = [item["name"] for item in fields if item.get("type") == "esriFieldTypeOID"]
    if len(declared) != 1:
        raise ValueError("The original metadata must declare exactly one esriFieldTypeOID field")
    return declared[0]


def retained_json(path):
    body = Path(path).read_bytes()
    decoded = gzip.decompress(body) if body[:2] == b"\x1f\x8b" else body
    value = json.loads(decoded)
    if not isinstance(value, dict) or value.get("error"):
        raise ValueError("Expected a successful retained source JSON object: " + str(path))
    return body, value


def crs_identity(value):
    if not isinstance(value, dict):
        raise ValueError("Retain the original Esri spatialReference object")
    code = value.get("latestWkid") or value.get("wkid")
    if code is not None:
        code = int(code)
        return ("wkid", 3857 if code in (102100, 102113, 3857) else code)
    if value.get("wkt"):
        return ("wkt", value["wkt"])
    raise ValueError("Original source response has no usable spatial reference")


def adopt(args):
    """Assemble existing publisher responses into the capture contract without HTTP requests."""
    specification_body, specification = retained_json(args.selection)
    selection_v2 = specification.get("schema") == "upstate.retained-classified-water-selection/v2"
    if specification.get("schema") not in ("upstate.retained-classified-water-selection/v1", "upstate.retained-classified-water-selection/v2"):
        raise ValueError("Select the retained classified-water selection specification")
    if selection_v2:
        classification_scope(specification, required=True)
    url = public_url(specification["layer_url"]).rstrip("/")
    if not re.search(r"/(?:MapServer|FeatureServer)/\d+$", url):
        raise ValueError("Selection must identify an exact native service layer")
    key = layer_id(url)
    metadata_body, metadata = retained_json(args.metadata)
    expected_metadata = specification.get("metadata_sha256")
    if expected_metadata and sha(metadata_body) != expected_metadata:
        raise ValueError("Retained original metadata differs from the selected source edition")
    oid = native_oid(metadata)
    if specification.get("oid_field", oid) != oid:
        raise ValueError("Selection native ID does not match the original esriFieldTypeOID field")
    fields = metadata.get("fields") or []
    field_types = {item["name"]: item.get("type") for item in fields
                   if item.get("type") != "esriFieldTypeGeometry"}
    geometry_type = metadata.get("geometryType")
    if geometry_type not in ("esriGeometryPolyline", "esriGeometryPolygon"):
        raise ValueError("Adopt a native line or polygon classification layer")
    # MapServer returns its published layer coordinates by default; sourceSpatialReference
    # can separately describe the underlying database. Preserve both in raw metadata.
    metadata_spatial = ((metadata.get("extent") or {}).get("spatialReference")
                        or metadata.get("spatialReference") or metadata.get("sourceSpatialReference"))
    page_values, features, geometry_spatial = [], {}, None
    originals = [
        ("selection", Path(args.selection), specification_body),
        ("metadata", Path(args.metadata), metadata_body),
    ]
    for ordinal, filename in enumerate(args.features):
        body, value = retained_json(filename)
        if value.get("exceededTransferLimit"):
            raise ValueError("The retained geometry response is truncated; use its complete original pages")
        if value.get("geometryType", geometry_type) != geometry_type:
            raise ValueError("Original geometry response and layer metadata have different geometry types")
        spatial = value.get("spatialReference") or metadata_spatial
        if geometry_spatial is None:
            geometry_spatial = spatial
        if crs_identity(spatial) != crs_identity(geometry_spatial):
            raise ValueError("Original geometry pages have different source coordinate systems")
        if metadata_spatial is not None and crs_identity(spatial) != crs_identity(metadata_spatial):
            raise ValueError("Original geometry response CRS differs from layer metadata")
        query_fields = value.get("fields")
        if query_fields is not None:
            actual_types = {item["name"]: item.get("type") for item in query_fields
                            if item.get("type") != "esriFieldTypeGeometry"}
            if actual_types != field_types:
                raise ValueError("Retained feature field names/types differ from original layer metadata")
        rows = value.get("features")
        if not isinstance(rows, list):
            raise ValueError("Retained geometry response has no features array")
        ids = []
        for feature in rows:
            attributes = feature.get("attributes")
            identity = attributes.get(oid) if isinstance(attributes, dict) else None
            if isinstance(identity, bool) or not isinstance(identity, int):
                raise ValueError("Original esriFieldTypeOID must contain integer IDs: " + oid)
            if identity in features:
                raise ValueError("Duplicate original feature across retained geometry responses: " + str(identity))
            if not isinstance(feature.get("geometry"), dict):
                raise ValueError("Selected original feature lacks native geometry: " + str(identity))
            features[identity] = feature
            ids.append(identity)
        originals.append(("features-" + str(ordinal), Path(filename), body))
        page_values.append((len(originals) - 1, ids, value))
    if specification.get("geometry_response_count", len(page_values)) != len(page_values):
        raise ValueError("Retained geometry response count differs from the selected source edition")
    geometry_bytes = sum(len(body) for role, _, body in originals if role.startswith("features-"))
    if specification.get("geometry_response_bytes", geometry_bytes) != geometry_bytes:
        raise ValueError("Retained original geometry byte count differs from the selected source edition")
    if geometry_spatial is None:
        geometry_spatial = metadata_spatial
    crs_identity(geometry_spatial)
    expected_count = specification.get("expected_feature_count")
    if expected_count is None or isinstance(expected_count, bool) or not isinstance(expected_count, int):
        raise ValueError("Specify the observed source-selection feature count")
    if len(features) != expected_count:
        raise ValueError("Original feature count differs from the selected source edition: "
                         + str(len(features)) + " versus " + str(expected_count))
    class_field = specification["class_field"]
    huc_field = specification.get("huc_field") if selection_v2 else specification["huc_field"]
    if class_field not in field_types or (huc_field is not None and huc_field not in field_types):
        raise ValueError("Selection class/HUC field does not match actual metadata")
    attribute_filters = specification.get("attribute_filters", {}) if selection_v2 else {}
    if selection_v2:
        expected_ids = specification.get("expected_object_ids")
        if (not isinstance(expected_ids, list) or
                any(isinstance(v, bool) or not isinstance(v, int) for v in expected_ids) or
                len(expected_ids) != len(set(expected_ids)) or set(expected_ids) != set(features)):
            raise ValueError("Registry v2 adoption requires the exact unique original object-ID inventory")
        if not isinstance(attribute_filters, dict) or any(
                field not in field_types or not isinstance(values, list) or not values or
                any(isinstance(v, (dict, list)) for v in values)
                for field, values in attribute_filters.items()):
            raise ValueError("Attribute selection must use actual fields and nonempty original scalar values")
        if huc_field is None and not attribute_filters:
            raise ValueError("A source without publisher HUCs must retain its actual attribute-selection predicate")
    class_counts, publisher_hucs = {}, set()
    for feature in features.values():
        attributes = feature["attributes"]
        class_value, huc = attributes.get(class_field), attributes.get(huc_field)
        if class_value not in specification["included_class_codes"]:
            raise ValueError("A retained feature lies outside the selected source classes")
        if huc_field is not None:
            if (not isinstance(huc, str) or not re.fullmatch(r"\d{12}", huc)
                    or not any(huc.startswith(prefix) for prefix in specification["included_huc_prefixes"])):
                raise ValueError("A retained publisher HUC does not meet the original selection")
            publisher_hucs.add(huc)
        if any(field not in attributes or attributes[field] not in values
               for field, values in attribute_filters.items()):
            raise ValueError("An original feature does not match the retained attribute selection")
        class_counts[class_value] = class_counts.get(class_value, 0) + 1
    if specification.get("expected_publisher_huc_count", len(publisher_hucs)) != len(publisher_hucs):
        raise ValueError("Publisher HUC count differs from the selected source edition")
    expected_classes = specification.get("expected_class_counts", {})
    if expected_classes and any(class_counts.get(code, 0) != expected_classes.get(code, 0)
                                for code in set(class_counts) | set(expected_classes)):
        raise ValueError("Class totals differ from the selected original source counts")
    attributes_by_id, attribute_columns = {}, set()
    for ordinal, filename in enumerate(args.attributes or []):
        body, value = retained_json(filename)
        rows = value.get("features")
        if not isinstance(rows, list):
            raise ValueError("The retained attribute response has no features array")
        for field in value.get("fields") or []:
            if field.get("type") == "esriFieldTypeGeometry":
                continue
            if field.get("name") not in field_types or field.get("type") != field_types[field["name"]]:
                raise ValueError("Attribute query projection differs from original layer field metadata")
        for row in rows:
            attributes = row.get("attributes")
            identity = attributes.get(oid) if isinstance(attributes, dict) else None
            if isinstance(identity, bool) or not isinstance(identity, int):
                raise ValueError("Original attribute page lacks the actual native OID")
            if identity in attributes_by_id:
                raise ValueError("Attribute inventory repeats a native ID; select either combined or paged attributes")
            required_attributes = {oid, class_field} | ({huc_field} if huc_field is not None else set()) | set(attribute_filters)
            if not required_attributes.issubset(attributes):
                raise ValueError("Attribute inventory must retain the native ID, class and original selection fields")
            if not set(attributes).issubset(field_types):
                raise ValueError("Attribute inventory includes fields absent from the original layer metadata")
            attribute_columns.update(attributes)
            attributes_by_id[identity] = attributes
        originals.append(("attributes-" + str(ordinal), Path(filename), body))
    if args.attributes:
        if set(attributes_by_id) != set(features):
            raise ValueError("Original geometry and attribute inventories contain different native IDs")
        for identity, attributes in attributes_by_id.items():
            original = features[identity]["attributes"]
            differences = sorted(name for name, value in attributes.items()
                                 if name not in original or original[name] != value)
            if differences:
                raise ValueError("Original attributes differ for OID " + str(identity)
                                 + ": " + ", ".join(differences[:10]))
    for ordinal, filename in enumerate(args.companion or []):
        path = Path(filename)
        originals.append(("companion-" + str(ordinal), path, path.read_bytes()))
    input_inventory = [{"role": role, "filename": path.name, "sha256": sha(body), "bytes": len(body)}
                       for role, path, body in originals]
    operation_digest = sha(encode({"layer_url": url, "inputs": input_inventory}))
    capture = Capture(args.output)
    final_path = capture.root / "capture.json"
    if final_path.exists():
        previous = json.loads(final_path.read_bytes())
        if previous.get("schema") != SCHEMA or previous.get("input_digest") != operation_digest:
            raise ValueError("Use a new output directory for a different retained source edition")
        for item in previous["files"]:
            read_retained(capture.root, item)
        write_source_manifest(capture.root, previous)
        print(json.dumps({"capture": str(final_path), "sources": str(capture.root / "sources.json"),
                          "reused": True, "features": expected_count}))
        return
    retained_paths = []
    for ordinal, (role, original_path, body) in enumerate(originals):
        relative = key + "/retained/" + str(ordinal).zfill(3) + "-" + role + "/" + original_path.name
        target = capture.root / relative
        exact_write(target, body)
        capture.remember(target)
        retained_paths.append(relative)
    ids = sorted(features)
    id_path, count_path = key + "/derived-object-ids.json", key + "/derived-count.json"
    exact_write(capture.root / id_path, encode({
        "objectIdFieldName": oid, "objectIds": ids,
        "derivation": "Exact unique native OIDs from retained original geometry responses",
        "upstream_source_id": specification["source_id"],
    }))
    exact_write(capture.root / count_path, encode({
        "count": len(ids), "expected_selection_count": expected_count,
        "derivation": "Count of retained original geometry features; checked against selected source edition",
        "class_counts": class_counts,
    }))
    capture.remember(capture.root / id_path)
    capture.remember(capture.root / count_path)
    combined = {"objectIdFieldName": oid, "geometryType": geometry_type,
                "spatialReference": geometry_spatial, "fields": fields,
                "hasZ": metadata.get("hasZ", False), "hasM": metadata.get("hasM", False),
                "features": [features[identity] for identity in ids]}
    decoded = encode(combined)
    combined_path = key + "/features.esri.json.gz"
    exact_write(capture.root / combined_path, gzip.compress(decoded, mtime=0))
    capture.remember(capture.root / combined_path)
    pages = [{**describe(capture.root, capture.root / retained_paths[index]), "object_ids": page_ids}
             for index, page_ids, _ in page_values]
    layer = {
        "id": key, "url": url, "title": specification.get("source_title") or metadata.get("name") or key,
        "oid_field": oid, "source_crs": geometry_spatial, "geometry_type": geometry_type,
        "field_schema": fields, "metadata_path": retained_paths[1],
        "object_ids_path": id_path, "count_path": count_path,
        "pages": pages, "combined_path": combined_path,
        "decoded_sha256": sha(decoded), "decoded_bytes": len(decoded),
        "feature_count": len(ids), "editing_date": editing_date(metadata),
        "native_page_order": "Unchanged in retained original responses",
        "combined_order": "Derived native collection sorted by true esriFieldTypeOID",
        "geometry_transform": "None in retained source adoption",
        "upstream_source_id": specification["source_id"],
        "data_status": specification.get("data_status"),
        "selection": specification,
        **({key: specification[key] for key in ("jurisdiction", "classification_system")} if selection_v2 else {}),
        "publisher_huc_field": huc_field,
        "publisher_huc_count": len(publisher_hucs),
        "attribute_inventory_checked": bool(args.attributes),
        "attribute_inventory_columns": sorted(attribute_columns),
        "attribute_inventory_comparison": "All original projected attributes compared by native OID; full geometry attributes unchanged",
        "adoption": {
            "mode": "Existing original source responses; no network acquisition",
            "metadata_sha256": sha(metadata_body), "input_digest": operation_digest,
            "count_and_ids": "Derived from retained geometry and checked against selection totals",
            "original_capture_date": specification.get("original_capture_date"),
            "retained_input_inventory": input_inventory,
        },
    }
    result = {"schema": SCHEMA, "created_at": now(), "app_id": specification.get("application_id"),
              "acquisition_mode": "retained-source-adoption", "input_digest": operation_digest,
              "layers": [layer], "documents": [], "files": list(capture.files.values())}
    exact_write(final_path, encode(result))
    write_source_manifest(capture.root, result)
    print(json.dumps({"capture": str(final_path), "sources": str(capture.root / "sources.json"),
                      "layer_id": key, "upstream_source_id": specification["source_id"],
                      "features": len(ids), "class_counts": class_counts,
                      "publisher_hucs": len(publisher_hucs), "oid_field": oid}, indent=2))


def inspect(args):
    root = Path(args.capture).resolve()
    document = json.loads((root / "capture.json").read_bytes())
    if document.get("schema") != SCHEMA:
        raise ValueError("Select the classified-water source capture")
    for item in document["files"]:
        read_retained(root, item)
    result = []
    for layer in document["layers"]:
        _, data = retained_json(root / layer["combined_path"])
        columns = []
        for field in layer["field_schema"]:
            if field.get("type") not in ("esriFieldTypeString", "esriFieldTypeSmallInteger",
                                          "esriFieldTypeInteger"):
                continue
            counts = {}
            for feature in data["features"]:
                value = feature["attributes"].get(field["name"])
                key = json.dumps(value, ensure_ascii=False)
                counts[key] = counts.get(key, 0) + 1
            columns.append({"name": field["name"], "alias": field.get("alias"),
                            "domain": field.get("domain"), "distinct": len(counts),
                            "values": counts if len(counts) <= 80 else None})
        result.append({"id": layer["id"], "url": layer["url"], "title": layer["title"],
                       "feature_count": layer["feature_count"], "candidate_fields": columns})
    print(json.dumps({"layers": result}, ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    command = sub.add_parser("discover", help="Retain official Atlas configuration and native layer metadata")
    command.add_argument("--output", required=True)
    command.add_argument("--request-pause", type=float, default=0.4)
    command.set_defaults(function=discover)
    command = sub.add_parser("capture", help="Capture complete original layers and current/proposed regulations")
    command.add_argument("--layer-url", action="append", required=True)
    command.add_argument("--output", required=True)
    command.add_argument("--request-pause", type=float, default=0.4)
    command.add_argument("--page-size", type=int, default=100)
    command.set_defaults(function=capture_command)
    command = sub.add_parser("adopt", help="Use retained original metadata and complete feature responses without querying again")
    command.add_argument("--selection", required=True)
    command.add_argument("--metadata", required=True)
    command.add_argument("--features", action="append", required=True)
    command.add_argument("--attributes", action="append")
    command.add_argument("--companion", action="append")
    command.add_argument("--output", required=True)
    command.set_defaults(function=adopt)
    command = sub.add_parser("inspect", help="Print exact native fields and class-domain values for binding")
    command.add_argument("--capture", required=True)
    command.set_defaults(function=inspect)
    args = parser.parse_args()
    if getattr(args, "request_pause", 0) < 0:
        parser.error("request pause must be nonnegative")
    if getattr(args, "page_size", 1) < 1 or getattr(args, "page_size", 1) > 1000:
        parser.error("page size must be between 1 and 1000")
    args.function(args)


if __name__ == "__main__":
    main()
