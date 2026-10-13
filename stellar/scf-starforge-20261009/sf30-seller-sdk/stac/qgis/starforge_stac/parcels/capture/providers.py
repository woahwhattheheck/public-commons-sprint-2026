# SPDX-License-Identifier: MIT
"""Publisher contracts for complete Pittsburgh parcel refreshes.

The original parcel intake owns CSV/JSON parsing, key validation and facts.
This adapter only builds the observed public GETs and proves response coverage.
"""
from __future__ import annotations
import hashlib
import json
from urllib.parse import urlencode, urlsplit
from ..intake import KEY, original_records, read_exact, exact_bytes

WPRDC = "https://data.wprdc.org"
GEOMETRY = "https://pghbridgis.pittsburghpa.gov/hosting/rest/services/ThreeOneOneServices/MapServer/5"
CITY = "e1dcee82-9179-4306-8167-5891915b62a7"
TAX = "4ff5eb17-e2ad-4818-97c4-8f91fc6b6396"
COUNTY = "65855e14-549e-4992-b5be-d629afc676fa"
HOSTS = frozenset(("data.wprdc.org", "pghbridgis.pittsburghpa.gov"))
PROFILE = "pittsburgh-public-parcels.v1"
BATCH = 64
MAX_KEYS = 100000
MAX_BODY = 256 * 1024 * 1024
MAX_TOTAL = 8 * 1024 * 1024 * 1024

class CaptureError(ValueError):
    def __init__(self, code, message, **detail):
        super().__init__(message)
        self.code, self.detail = code, detail
    def value(self):
        return {"code": self.code, "message": str(self), **self.detail}

def check(condition, code, message, **detail):
    if not condition:
        raise CaptureError(code, message, **detail)

def json_bytes(value):
    return exact_bytes(value)

def digest(body):
    return hashlib.sha256(body).hexdigest()

def public_url(value):
    parsed = urlsplit(value)
    check(parsed.scheme == "https" and parsed.hostname in HOSTS and
          parsed.port in (None, 443) and not parsed.username and not parsed.password and not parsed.fragment,
          "CAPTURE_URL", "Use the original HTTPS publisher without credentials or fragments.")
    return value

def job(identity, source_id, family, url, **extra):
    return {"id": identity, "sourceId": source_id, "family": family,
            "sourceUrl": public_url(url), **extra}

def initial_jobs():
    result = []
    for identity, resource, package, family in (
        ("city-eproperties", CITY, "city-owned-properties", "city-eproperties-csv"),
        ("city-tax-register", TAX, "city-owned-property", "city-tax-register-csv"),
    ):
        result.append(job(identity + "-catalog-before", identity, "source-metadata",
            WPRDC + "/api/3/action/package_show?" + urlencode({"id": package}), phase="before", resourceId=resource))
        result.append(job(identity + "-csv", identity, family,
            WPRDC + "/datastore/dump/" + resource))
    result.append(job("county-assessment-catalog-before", "county-assessment", "source-metadata",
        WPRDC + "/api/3/action/package_show?id=property-assessments", phase="before", resourceId=COUNTY))
    result.append(job("pittsburgh-parcels-catalog-before", "pittsburgh-parcels", "source-metadata",
        GEOMETRY + "?f=pjson", phase="before"))
    return result

def final_jobs():
    result = []
    for item in initial_jobs():
        if item["family"] == "source-metadata":
            result.append({**item, "id": item["id"].replace("-before", "-after"), "phase": "after"})
    return result

def lookup_job(kind, pins, identity=None, geometry_limit=2000):
    pins = list(pins)
    check(pins and len(pins) <= BATCH and len(set(pins)) == len(pins) and
          all(isinstance(pin, str) and KEY.fullmatch(pin) for pin in pins),
          "CAPTURE_KEYS", "Use the exact distinct original 16-character parcel keys.")
    identity = identity or kind + "-" + digest(json_bytes(pins))[:24]
    if kind == "county":
        url = WPRDC + "/api/3/action/datastore_search?" + urlencode({
            "resource_id": COUNTY, "filters": json.dumps({"PARID": pins}, separators=(",", ":")),
            "limit": 1000, "sort": "_id"})
        return job(identity, "county-assessment", "county-assessment-json", url,
                   requestedPins=pins, kind=kind)
    check(kind == "geometry", "CAPTURE_KIND", "Select County assessment or original parcel geometry.")
    check(type(geometry_limit) is int and 1 <= geometry_limit <= 2000,
          "CAPTURE_GEOMETRY_LIMIT", "Use the original selected layer record limit.")
    where = "pin IN (" + ",".join("'" + pin + "'" for pin in pins) + ")"
    url = GEOMETRY + "/query?" + urlencode({"f": "geojson", "where": where,
        "outFields": "*", "returnGeometry": "true", "outSR": 4326,
        "orderByFields": "OBJECTID_1", "resultRecordCount": geometry_limit})
    return job(identity, "pittsburgh-parcels", "pittsburgh-parcels-geojson", url,
               requestedPins=pins, kind=kind, recordLimit=geometry_limit, coordinateReferenceSystem="EPSG:4326")

def union_selection(csv_sources):
    selected, invalid = set(), 0
    sources = []
    for source_id, family, body in csv_sources:
        check(family in ("city-eproperties-csv", "city-tax-register-csv"),
              "CAPTURE_CITY", "Select the two original complete City CSVs.")
        sources.append({"sourceId": source_id, "field": "pin"})
        for _, row, _ in original_records(body, family):
            key = row.get("pin")
            if isinstance(key, str) and KEY.fullmatch(key):
                selected.add(key)
            else:
                invalid += 1
    keys = sorted(selected)
    check(keys and len(keys) <= MAX_KEYS, "CAPTURE_SELECTION",
          "Use a nonempty selected union of at most 100,000 original keys.", selected=len(keys))
    return keys, {"mode": "union", "sources": sources, "expectedDistinctKeys": len(keys),
        "invalidRecords": invalid,
        "keysSha256": digest(json.dumps(keys, separators=(",", ":"), ensure_ascii=True).encode("ascii"))}

def metadata_identity(item, body):
    value = read_exact(body)
    if item["sourceId"] == "pittsburgh-parcels":
        check(isinstance(value, dict) and not value.get("error") and isinstance(value.get("fields"), list),
              "CAPTURE_METADATA", "Retain the original successful parcel layer description.")
        check(type(value.get("maxRecordCount")) is int and value["maxRecordCount"] > 0,
              "CAPTURE_GEOMETRY_LIMIT", "Retain the original layer response limit.")
        return {key: value.get(key) for key in
            ("id", "name", "type", "fields", "objectIdField", "maxRecordCount", "extent",
             "editingInfo", "currentVersion", "advancedQueryCapabilities")}
    check(isinstance(value, dict) and value.get("success") is True and
          isinstance(value.get("result"), dict), "CAPTURE_METADATA",
          "Retain the original successful publisher catalogue.")
    resources = [x for x in value["result"].get("resources", []) if x.get("id") == item.get("resourceId")]
    check(len(resources) == 1, "CAPTURE_RESOURCE", "The original selected resource is absent or ambiguous in its catalogue.")
    resource = resources[0]
    return {key: resource.get(key) for key in
        ("id", "url", "format", "last_modified", "metadata_modified", "hash", "size", "datastore_active")}

def response_summary(item, body):
    family = item["family"]
    if family == "source-metadata":
        return {"status": "COMPLETE", "metadataIdentity": metadata_identity(item, body)}
    if family in ("city-eproperties-csv", "city-tax-register-csv"):
        count = sum(1 for _ in original_records(body, family))
        check(count > 0, "CAPTURE_EMPTY_CITY", "The complete City source contains no rows.")
        return {"status": "COMPLETE", "records": count}
    value = read_exact(body)
    if family == "county-assessment-json":
        check(isinstance(value, dict) and value.get("success") is True and
              isinstance(value.get("result"), dict), "CAPTURE_COUNTY", "The publisher did not return a successful datastore result.")
        result = value["result"]
        records = result.get("records")
        check(isinstance(records, list) and type(result.get("total")) is int and result["total"] >= len(records),
              "CAPTURE_COUNTY", "Retain the complete original selected response and total.")
        truncated = result["total"] > len(records)
    else:
        check(family == "pittsburgh-parcels-geojson" and isinstance(value, dict) and
              value.get("type") == "FeatureCollection" and isinstance(value.get("features"), list),
              "CAPTURE_GEOMETRY", "The publisher did not return an original GeoJSON FeatureCollection.")
        records = value["features"]
        truncated = value.get("exceededTransferLimit") is True or (
            len(records) >= item.get("recordLimit", 2000) and value.get("exceededTransferLimit") is not False)
    if truncated:
        check(len(item["requestedPins"]) > 1, "CAPTURE_DENSE_KEY",
              "One parcel exceeds a complete original response; retain this response for explicit publisher review.",
              job=item["id"], key=item["requestedPins"][0])
        return {"status": "SPLIT", "records": len(records)}
    wanted = set(item["requestedPins"])
    matched, identities = set(), set()
    for _, row, geometry in original_records(body, family):
        key = row.get("PARID" if family == "county-assessment-json" else "pin")
        check(isinstance(key, str) and key in wanted, "CAPTURE_SCOPE",
              "The response contains a parcel outside the exact requested cohort.", key=key)
        identity = row.get("_id" if family == "county-assessment-json" else "OBJECTID_1")
        check(identity is not None and str(identity) not in identities, "CAPTURE_ROW_ID",
              "The selected publisher response has a missing or duplicate original row identifier.")
        identities.add(str(identity))
        matched.add(key)
    return {"status": "COMPLETE", "records": len(records), "matchedKeys": sorted(matched),
            "missingKeys": sorted(wanted - matched)}
