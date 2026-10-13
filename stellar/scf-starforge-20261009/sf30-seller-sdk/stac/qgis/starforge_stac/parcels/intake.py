# SPDX-License-Identifier: MIT
"""Exact retained public-parcel input and source assertions.

The input manifest identifies complete original files and requested parcel keys.
All source rows remain in those files; the indexed projection retains references
and selected source assertions for review without copying the original bodies.
"""
from __future__ import annotations
import copy
import csv
from decimal import Decimal, InvalidOperation, localcontext
import io
import json
from pathlib import Path
import re

from ..model import (require, QgisReceivingError, descriptor, directory, member,
    file_digest, sha_bytes, value_sha, json_bytes, MAX_JSON)

SCHEMA = "starforge.parcel-source-receiving.v1"
MANIFEST = "parcel-source-receiving.json"
KEY = re.compile(r"^[A-Z0-9]{16}$")
CITY_FAMILIES = frozenset(("city-eproperties-csv", "city-tax-register-csv", "city-eproperties-json", "city-tax-register-json"))
FAMILIES = frozenset(("city-eproperties-csv", "city-tax-register-csv", "city-eproperties-json", "city-tax-register-json",
    "county-assessment-json", "pittsburgh-parcels-geojson", "source-metadata"))
ROW_FAMILIES = FAMILIES - {"source-metadata"}
MAX_FILES = 10000
MAX_RECORDS = 500000
ASSESSMENTS = {
    "county-assessed": ("COUNTYTOTAL", "COUNTYLAND", "COUNTYBUILDING"),
    "local-assessed": ("LOCALTOTAL", "LOCALLAND", "LOCALBUILDING"),
    "base-year-2012-appraisal": ("FAIRMARKETTOTAL", "FAIRMARKETLAND", "FAIRMARKETBUILDING"),
}
AREA_FIELDS = {
    "city-eproperties-csv": ("parc_sq_ft", "city-reported-square-feet", "square-feet"),
    "county-assessment-json": ("LOTAREA", "county-reported-square-feet", "square-feet"),
    "pittsburgh-parcels-geojson": ("calcacreag", "publisher-reported-acreage", "acres"),
}

def exact_json(value):
    if value is None: return "null"
    if value is True: return "true"
    if value is False: return "false"
    if isinstance(value, Decimal):
        require(value.is_finite(), "PARCEL_NUMBER", "Retain finite original numbers.")
        return str(value)
    if type(value) in (int, float):
        return json.dumps(value, allow_nan=False, separators=(",", ":"))
    if isinstance(value, str): return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list): return "[" + ",".join(exact_json(x) for x in value) + "]"
    require(isinstance(value, dict) and all(isinstance(k, str) for k in value),
            "PARCEL_JSON", "Use original JSON objects with text keys.")
    return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + exact_json(value[k]) for k in sorted(value)) + "}"

def exact_bytes(value):
    return (exact_json(value) + "\n").encode("utf-8")

def read_exact(body):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, "PARCEL_JSON_DUPLICATE_KEY", "An original JSON object repeats a field.", field=key)
            result[key] = value
        return result
    try:
        return json.loads(body.decode("utf-8-sig"), parse_float=Decimal,
            parse_int=int, object_pairs_hook=pairs,
            parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
    except (UnicodeError, ValueError) as error:
        raise QgisReceivingError("PARCEL_JSON_INVALID", "The retained original JSON cannot be decoded.") from error

def text(value):
    if value is None: return None
    if isinstance(value, (str, int, Decimal)): return str(value)
    raise QgisReceivingError("PARCEL_SCALAR", "The original source field must be a scalar.")

def meaningful(value):
    return value is not None and str(value).strip() != ""

def decimal_text(value):
    if value is None or isinstance(value, str) and not value.strip(): return None
    require(type(value) is not bool and isinstance(value, (str, int, Decimal)),
            "PARCEL_NUMBER", "Retain the source number as an exact decimal.")
    try: number = Decimal(str(value).strip())
    except InvalidOperation as error:
        raise QgisReceivingError("PARCEL_NUMBER", "The source field is not an exact decimal.") from error
    require(number.is_finite() and len(str(number)) <= 256,
            "PARCEL_NUMBER", "Retain a finite source decimal of at most 256 characters.")
    return str(number)

def exact_sum_matches(total, left, right):
    with localcontext() as context:
        context.prec = 1024
        return Decimal(total) == Decimal(left) + Decimal(right)

def canonical_record(raw):
    # _id is a captured datastore row number, not the publisher's stable record ID.
    return {key: value for key, value in raw.items() if key != "_id"}

def original_records(body, family):
    if family in ("city-eproperties-csv", "city-tax-register-csv"):
        try: stream = io.StringIO(body.decode("utf-8-sig"), newline="")
        except UnicodeError as error:
            raise QgisReceivingError("PARCEL_CSV_ENCODING", "Use the complete original UTF-8 CSV.") from error
        reader = csv.DictReader(stream)
        require(reader.fieldnames and len(reader.fieldnames) == len(set(reader.fieldnames)) and
                "pin" in reader.fieldnames, "PARCEL_CSV_FIELDS",
                "Keep the original distinct CSV columns and parcel key field.")
        if family == "city-eproperties-csv":
            require("id" in reader.fieldnames and "owner" in reader.fieldnames,
                    "PARCEL_CITY_FIELDS", "Retain the original eProperty record ID and owner fields.")
        for index, row in enumerate(reader):
            require(None not in row and all(value is not None for value in row.values()),
                    "PARCEL_CSV_ROW", "An original CSV record has a different number of columns.", row=index)
            yield index, row, None
        return
    document = read_exact(body)
    if family in ("county-assessment-json", "city-eproperties-json", "city-tax-register-json"):
        require(isinstance(document, dict) and document.get("success") is True and
                isinstance(document.get("result", {}).get("records"), list),
                "PARCEL_COUNTY_RESPONSE", "Use the complete successful original County datastore response.")
        result = document["result"]
        require(type(result.get("total")) is int and result["total"] == len(result["records"]),
                "PARCEL_COUNTY_PAGE", "Retain the complete selected County response, including every returned record.",
                total=result.get("total"), received=len(result["records"]))
        records = result["records"]
        for index, row in enumerate(records):
            required_key = "PARID" if family == "county-assessment-json" else "pin"
            require(isinstance(row, dict) and required_key in row and
                    (family != "city-eproperties-json" or "id" in row),
                    "PARCEL_DATASTORE_ROW", "Retain each original datastore record and its source key.")
            yield index, row, None
        return
    require(family == "pittsburgh-parcels-geojson" and isinstance(document, dict) and
            document.get("type") == "FeatureCollection" and isinstance(document.get("features"), list),
            "PARCEL_GEOMETRY_RESPONSE", "Use the original provider GeoJSON FeatureCollection.")
    require(document.get("exceededTransferLimit") is not True, "PARCEL_GEOMETRY_PAGE",
            "Finish the provider's original selected geometry page before importing.")
    for index, feature in enumerate(document["features"]):
        require(isinstance(feature, dict) and feature.get("type") == "Feature" and
                isinstance(feature.get("properties"), dict), "PARCEL_GEOMETRY_FEATURE",
                "Keep original GeoJSON feature properties.")
        geometry = feature.get("geometry")
        require(geometry is None or isinstance(geometry, dict) and
                geometry.get("type") in ("Polygon", "MultiPolygon") and isinstance(geometry.get("coordinates"), list),
                "PARCEL_GEOMETRY_TYPE", "Retain the original parcel polygon or explicit missing geometry.")
        yield index, feature["properties"], geometry

def source_assertions(raw, family, record_id, geometry):
    family = {"city-eproperties-json": "city-eproperties-csv", "city-tax-register-json": "city-tax-register-csv"}.get(family, family)
    claims, problems = [], []
    def add(kind, field, value, **context):
        if not meaningful(value): return
        item = {"kind": kind, "field": field, "value": text(value), "recordId": record_id, **context}
        item["id"] = "claim-" + value_sha(item)
        claims.append(item)
    def number(kind, field, **context):
        try: value = decimal_text(raw.get(field))
        except QgisReceivingError:
            problems.append({"code": "SOURCE_NUMBER_INVALID", "recordId": record_id, "field": field})
            return
        if value is not None:
            add(kind, field, value, **context)
    if family == "city-eproperties-csv":
        add("owner-assertion", "owner", raw.get("owner"))
        add("status-assertion", "current_status", raw.get("current_status"))
        add("inventory-assertion", "inventory_type", raw.get("inventory_type"))
        add("class-assertion", "class", raw.get("class"))
        add("zoning-assertion", "zoned_as", raw.get("zoned_as"))
        for field in ("acquisition_date", "last_updated"):
            add("source-date", field, raw.get(field))
    if family == "city-tax-register-csv":
        number("historical-sale", "sale_price", currency="USD",
               act77GentDate=text(raw.get("act77_gent_date")), lastPaymentDate=text(raw.get("last_payment_date")),
               treasurySaleDate=text(raw.get("treasury_sale_date")),
               partitionLatestSaleDate=text(raw.get("partition_latest_sale_date")))
    if family in ("city-eproperties-csv", "city-tax-register-csv"):
        add("ward-assertion", "ward", raw.get("ward"))
        add("district-assertion", "council_district", raw.get("council_district"))
        add("neighborhood-assertion", "neighborhood_name", raw.get("neighborhood_name"))
        for field in ("dpw_streets", "dpw_enviro", "dpw_parks"):
            add("service-zone", field, raw.get(field))
    if family == "county-assessment-json":
        context = {"currency": "USD", "taxYear": text(raw.get("TAXYEAR")), "asOfDate": text(raw.get("ASOFDATE"))}
        for basis, (total, land, building) in ASSESSMENTS.items():
            try:
                values = [decimal_text(raw.get(field)) for field in (total, land, building)]
            except QgisReceivingError:
                problems.append({"code": "SOURCE_NUMBER_INVALID", "recordId": record_id, "field": total})
                continue
            if values[0] is not None:
                add("assessment", total, values[0], basis=basis, land=values[1], building=values[2], **context)
                if all(value is not None for value in values) and not exact_sum_matches(values[0], values[1], values[2]):
                    problems.append({"code": "PUBLISHED_TOTAL_DIFFERS", "recordId": record_id, "field": total})
        for field, kind in (("TAXDESC", "tax-status"), ("CLASSDESC", "class-assertion"),
                            ("USEDESC", "use-assertion"), ("OWNERDESC", "owner-type")):
            add(kind, field, raw.get(field))
        number("historical-sale", "SALEPRICE", currency="USD", saleDate=text(raw.get("SALEDATE")),
               recordDate=text(raw.get("RECORDDATE")), saleCode=text(raw.get("SALECODE")),
               saleDescription=text(raw.get("SALEDESC")))
    if family == "pittsburgh-parcels-geojson":
        add("owner-assertion", "propertyow", raw.get("propertyow"))
        add("tax-agent", "agent", raw.get("agent"))
        for field, kind in (("taxdesc", "tax-status"), ("classdesc", "class-assertion"), ("usedesc", "use-assertion")):
            add(kind, field, raw.get(field))
        if geometry is not None:
            add("geometry", "geometry", sha_bytes(exact_bytes(geometry)),
                coordinateReferenceSystem="EPSG:4326", geometryType=geometry["type"])
    if family in AREA_FIELDS:
        field, basis, unit = AREA_FIELDS[family]
        number("area", field, basis=basis, unit=unit)
    return claims, problems

class ParcelIntake:
    def __init__(self, root, expected_sha256=None, progress=None):
        self.root = directory(root)
        manifest_path = member(self.root, MANIFEST)
        require(manifest_path.stat().st_size <= 32 * 1024 * 1024, "PARCEL_MANIFEST_LIMIT",
                "Keep a complete source manifest below 32 MiB.")
        self.body = manifest_path.read_bytes()
        self.id = sha_bytes(self.body)
        require(expected_sha256 is None or expected_sha256 == self.id,
                "PARCEL_INPUT_CHANGED", "The selected original parcel manifest changed.")
        self.manifest = read_exact(self.body)
        require(isinstance(self.manifest, dict) and self.manifest.get("schema") == SCHEMA and
                isinstance(self.manifest.get("files"), list) and 0 < len(self.manifest["files"]) <= MAX_FILES,
                "PARCEL_SOURCE_SCHEMA", "Use the complete original parcel source receiving manifest.")
        selection = self.manifest.get("selection")
        require(isinstance(selection, dict) and selection.get("mode") in ("union", "explicit"),
                "PARCEL_SELECTION", "Choose the original union or explicit parcel-key cohort.")
        require(isinstance(self.manifest.get("label"), str) and self.manifest["label"].strip() and
                any(isinstance(self.manifest.get(field), str) and self.manifest[field]
                    for field in ("createdAt", "capturedAt")) and
                all(self.manifest.get(field) is None or isinstance(self.manifest[field], str) and self.manifest[field]
                    for field in ("createdAt", "capturedAt")),
                "PARCEL_CAPTURE_IDENTITY", "Retain the source edition label and its original assembly or capture time.")
        self.files = []
        seen = set()
        for raw in self.manifest["files"]:
            item = descriptor(raw)
            require(item["path"] != MANIFEST and item["path"] not in seen and item.get("family") in FAMILIES and
                    isinstance(item.get("sourceId"), str) and item["sourceId"] and
                    ((item["family"] == "source-metadata" and "sourceUrl" not in item) or
                     (isinstance(item.get("sourceUrl"), str) and item["sourceUrl"].startswith(("https://", "http://")))) and
                    isinstance(item.get("capturedAt"), str) and item["capturedAt"],
                    "PARCEL_SOURCE_FILE", "Retain each original file's unique path, source and capture time; active source files also require their original public URL.")
            seen.add(item["path"])
            require(item["bytes"] <= MAX_JSON, "PARCEL_SOURCE_SIZE", "Each original parcel source file supports up to 256 MiB.")
            file_digest(member(self.root, item["path"]), expected=item, progress=progress)
            if item["family"] in ("county-assessment-json", "pittsburgh-parcels-geojson", "city-eproperties-json", "city-tax-register-json"):
                require(isinstance(item.get("requestedPins"), list) and
                        all(isinstance(key, str) and KEY.fullmatch(key) for key in item["requestedPins"]) and
                        len(set(item["requestedPins"])) == len(item["requestedPins"]),
                        "PARCEL_CAPTURE_SCOPE", "Retain the exact distinct parcel keys requested from this provider.")
            if item["family"] == "pittsburgh-parcels-geojson":
                require(item.get("coordinateReferenceSystem") == "EPSG:4326",
                        "PARCEL_GEOMETRY_CRS", "Identify the actual provider outSR=4326 GeoJSON response.")
            self.files.append(item)
        require(sum(item["bytes"] for item in self.files) <= 8 * 1024 * 1024 * 1024,
                "PARCEL_INTAKE_SIZE", "Use a parcel source edition of at most 8 GiB.")

    def prepare(self, progress=None):
        selection = self.manifest["selection"]
        if selection["mode"] == "explicit":
            require(isinstance(selection.get("keys"), list) and selection["keys"] and
                    all(isinstance(key, str) and KEY.fullmatch(key) for key in selection["keys"]) and
                    len(set(selection["keys"])) == len(selection["keys"]),
                    "PARCEL_SELECTION", "Retain the exact distinct selected parcel keys.")
            selected = set(selection["keys"])
            union_sources = set()
        else:
            require(isinstance(selection.get("sources"), list) and selection["sources"] and
                    all(isinstance(x, dict) and x.get("field") == "pin" and isinstance(x.get("sourceId"), str)
                        for x in selection["sources"]), "PARCEL_SELECTION",
                    "Retain the actual City source IDs and their pin field for the union.")
            union_sources = {item["sourceId"] for item in selection["sources"]}
            require(union_sources <= {item["sourceId"] for item in self.files
                    if item["family"] in CITY_FAMILIES},
                    "PARCEL_SELECTION_SOURCES", "The union requires every selected original City file.")
            selected = set()
        records_by_key, exceptions, coverage, source_stats = {}, [], {}, []
        count = 0
        for file_index, item in enumerate(self.files):
            family = item["family"]
            if family == "source-metadata": continue
            body = member(self.root, item["path"]).read_bytes()
            require(len(body) == item["bytes"] and sha_bytes(body) == item["sha256"],
                    "PARCEL_SOURCE_CHANGED", "A source file changed during intake.", path=item["path"])
            requested = set(item.get("requestedPins", []))
            for key in requested:
                coverage.setdefault(key, {}).setdefault(family, set()).add(item["sha256"])
            accepted, invalid = 0, 0
            for index, raw, geometry in original_records(body, family):
                count += 1
                require(count <= MAX_RECORDS, "PARCEL_RECORD_LIMIT", "The complete edition exceeds 500,000 source records.")
                value = raw.get("PARID" if family == "county-assessment-json" else "pin")
                ref = {"fileSha256": item["sha256"], "sourceId": item["sourceId"], "path": item["path"], "row": index}
                if not isinstance(value, str) or not KEY.fullmatch(value):
                    exceptions.append({"code": "PARCEL_KEY_INVALID", "value": text(value), "source": ref})
                    invalid += 1
                    continue
                key = value
                if requested:
                    require(key in requested, "PARCEL_CAPTURE_SCOPE",
                            "A provider returned a parcel outside the retained requested-key set.", key=key, path=item["path"])
                if item["sourceId"] in union_sources: selected.add(key)
                raw_sha = sha_bytes(exact_bytes(canonical_record(raw)))
                geometry_sha = sha_bytes(exact_bytes(geometry)) if geometry is not None else None
                stable_id = text(raw.get("id")) if family in ("city-eproperties-csv", "city-eproperties-json") else key
                if family in ("city-eproperties-csv", "city-eproperties-json"):
                    require(meaningful(stable_id), "PARCEL_RECORD_ID", "Keep the publisher's original eProperty record ID.")
                identity = {"sourceId": item["sourceId"], "family": family, "key": key,
                            "recordId": stable_id, "recordSha256": raw_sha, "geometrySha256": geometry_sha}
                record_id = "record-" + value_sha(identity)
                parcel = records_by_key.setdefault(key, {})
                record = parcel.get(record_id)
                if record is None:
                    claims, problems = source_assertions(raw, family, record_id, geometry)
                    address = text(raw.get("address"))
                    if not address and family == "county-assessment-json":
                        address = " ".join(str(raw.get(field) or "").strip() for field in
                                           ("PROPERTYHOUSENUM", "PROPERTYADDRESS", "PROPERTYCITY")).strip()
                    record = {**identity, "id": record_id, "references": [], "claims": claims,
                              "issues": problems, "address": address}
                    parcel[record_id] = record
                record["references"].append(ref)
                accepted += 1
            source_stats.append({"path": item["path"], "sourceId": item["sourceId"], "family": family,
                                 "records": accepted + invalid, "validKeyRecords": accepted, "invalidKeyRecords": invalid,
                                 "requestedKeys": len(requested)})
            if progress: progress({"phase": "parcel-intake", "completedFiles": file_index + 1,
                                   "totalFiles": len(self.files), "sourceRecords": count, "path": item["path"]})
        keys = sorted(selected)
        keys_sha = sha_bytes(json.dumps(keys, ensure_ascii=True, separators=(",", ":")).encode("ascii"))
        if "expectedDistinctKeys" in selection:
            require(type(selection["expectedDistinctKeys"]) is int and selection["expectedDistinctKeys"] == len(keys),
                    "PARCEL_SELECTION_COUNT", "The received selected-key count differs from its source receipt.",
                    expected=selection["expectedDistinctKeys"], actual=len(keys))
        if "keysSha256" in selection:
            require(selection["keysSha256"] == keys_sha, "PARCEL_SELECTION_CHANGED",
                    "The exact selected parcel keys differ from the retained original selection.")
        if "invalidRecords" in selection:
            invalid_selected = sum(item["invalidKeyRecords"] for item in source_stats if item["sourceId"] in union_sources)
            require(selection["invalidRecords"] == invalid_selected, "PARCEL_EXCEPTION_COUNT",
                    "The original union's invalid-key count differs from its retained receipt.")
        rows = []
        for key in keys:
            records = sorted(records_by_key.get(key, {}).values(), key=lambda row: row["id"])
            claims = sorted((claim for row in records for claim in row["claims"]), key=lambda claim: claim["id"])
            problems = [issue for row in records for issue in row["issues"]]
            for kind in ("owner-assertion", "status-assertion", "ward-assertion"):
                values = {" ".join(claim["value"].split()).casefold() for claim in claims if claim["kind"] == kind}
                if len(values) > 1: problems.append({"code": "SOURCE_ASSERTIONS_DIFFER", "kind": kind, "values": sorted(values)})
            record_groups = {}
            for row in records:
                record_groups.setdefault((row["sourceId"], row["family"], row["recordId"]), []).append(row["id"])
            for (source_id, family, record_id), members in record_groups.items():
                if len(members) > 1:
                    problems.append({"code": "SOURCE_RECORD_CONFLICT", "sourceId": source_id, "family": family,
                                     "recordId": record_id, "records": members})
            status = {}
            for family in ("county-assessment-json", "pittsburgh-parcels-geojson"):
                matched = [row["id"] for row in records if row["family"] == family]
                requests = sorted(coverage.get(key, {}).get(family, set()))
                status[family] = {"state": "MATCHED" if matched else "NO_MATCH" if requests else "NOT_REQUESTED",
                                  "requestFileSha256s": requests, "records": len(matched)}
            if status["pittsburgh-parcels-geojson"]["state"] == "MATCHED" and not any(x["kind"] == "geometry" for x in claims):
                problems.append({"code": "SOURCE_GEOMETRY_MISSING"})
            facts_sha = value_sha({"key": key, "records": [{field: row[field] for field in
                ("sourceId", "family", "recordId", "recordSha256", "geometrySha256")} for row in records]})
            for record in records:
                record.pop("claims", None)
                record.pop("issues", None)
            rows.append({"key": key, "factsSha256": facts_sha, "records": records, "claims": claims,
                         "coverage": status, "issues": problems})
        summary = {"selectedKeys": len(keys), "keysSha256": keys_sha, "sourceRecords": count,
            "invalidKeyRecords": len(exceptions), "outOfSelectionKeys": len(set(records_by_key) - selected),
            "conflictedKeys": sum(bool(row["issues"]) for row in rows),
            "countyMatchedKeys": sum(row["coverage"]["county-assessment-json"]["state"] == "MATCHED" for row in rows),
            "geometryMatchedKeys": sum(row["coverage"]["pittsburgh-parcels-geojson"]["state"] == "MATCHED" for row in rows),
            "sources": source_stats}
        return {"rows": rows, "exceptions": exceptions, "summary": summary,
                "manifestSha256": self.id, "manifest": self.manifest, "files": self.files}
