# SPDX-License-Identifier: MIT
"""Source-bound address candidates inside the original QGIS evidence workspace.

Candidates support named review; they are not address corrections, postal
validation, geocoding results, dispatch certification or duplicate verdicts.
"""
from __future__ import annotations
import copy
import csv
import io
import json
import math
import re
import unicodedata
from collections import defaultdict
from pathlib import Path
from . import parcel_evidence as evidence
from .model import require, member, json_bytes, value_sha, sha_bytes, retain_bytes, utc_now

SCHEMA = "starforge.address-review.v1"
MEDIA_TYPE = "application/vnd.starforge.address-review+json"
MAX_ROWS = 50000
MAX_BYTES = 256 * 1024 * 1024
FIELDS = ("identity", "number", "street", "building", "unitType", "unit", "postalCity",
          "region", "postalCode", "municipality", "county", "authority", "sourceDate")
SIGNATURE = ("number", "street", "building", "unitType", "unit", "postalCity", "region", "postalCode")
RULES = ("ADDRESS_SIGNATURE", "EXACT_POINT", "REPEATED_IDENTITY", "MISSING_REQUIRED", "POINT_GEOMETRY")
NORMALIZATION = "Unicode NFC; trim; collapse Unicode whitespace; casefold. No abbreviation, punctuation, unit, postal or municipality substitution."
LIMITATION = ("Candidates require source-owner or analyst review. A matching address signature or point is not proof of a duplicate. "
              "Municipality and postal city have separate meanings. No postal deliverability, geocoding, NG911 or emergency-dispatch certification is performed.")
PROFILE = {
    "id": "asdi-situs-address-v1",
    "title": "ASDI SITUS_ADDRESS_PT — explicit source mapping",
    "metadataUrl": "https://gis.arkansas.gov/arcgis/rest/services/FEATURESERVICES/Location/FeatureServer/14?f=pjson",
    "mapping": {"identity": "globalid", "number": "adr_num_comp", "street": "pstr_fulnam",
                "building": "adr_bldg", "unitType": "adr_unit_typ", "unit": "adr_unit_id",
                "postalCity": "adr_city", "region": "adr_state", "postalCode": "adr_zip5",
                "municipality": "adr_muni", "county": "cnty_name", "authority": "add_auth",
                "sourceDate": "date_ed"},
    "required": ["identity", "number", "street", "postalCity", "region", "postalCode"],
    "rules": list(RULES),
    "sourceNotes": [
        "objectid is the retained response object identifier; globalid is the selected business identity.",
        "adr_muni is municipality and adr_city is postal city. Their difference is not an error.",
        "date_ed is a source string; this profile does not infer a publisher timestamp.",
        "adr_zip4='0000' is preserved as a source value; no postal-invalid verdict is inferred.",
        "Original point geometry and declared CRS are retained. lon_x/lat_y attributes are not substituted for projected geometry.",
        "Required-field choices are an analyst screening policy, not an issuer compliance specification."
    ]
}


def normalize_payload(value):
    evidence.exact(value, ("title", "jurisdiction", "asOf", "scope", "sourceIds", "metadataSourceId",
                          "inventory", "mapping", "required", "rules", "caseId", "caseVersionId"),
                   ("title", "jurisdiction", "asOf", "scope", "sourceIds", "mapping", "required", "rules"))
    value = copy.deepcopy(value)
    for key, maximum in (("title", 500), ("jurisdiction", 500), ("scope", 12000)):
        value[key] = evidence.text(value[key], key, maximum)
    value["asOf"] = evidence.date(value["asOf"], "Review as-of date")
    require(value["asOf"] is not None, "ADDRESS_DATE", "Choose the review as-of date.")
    ids = value["sourceIds"]
    require(isinstance(ids, list) and 1 <= len(ids) <= 100 and all(isinstance(x, str) and x for x in ids)
            and len(set(ids)) == len(ids), "ADDRESS_SOURCES", "Select one to 100 distinct retained original feature files.")
    mapping = value["mapping"]
    require(isinstance(mapping, dict) and set(mapping) <= set(FIELDS), "ADDRESS_MAPPING", "Map the supported address fields explicitly.")
    value["mapping"] = {key: evidence.text(mapping.get(key, ""), "Original field", 240, False) for key in FIELDS}
    for key in ("required", "rules"):
        allowed = FIELDS if key == "required" else RULES
        require(isinstance(value[key], list) and all(isinstance(x, str) and x in allowed for x in value[key]) and
                len(value[key]) == len(set(value[key])), "ADDRESS_POLICY", "Use distinct supported screening rules and fields.")
    require(value["rules"], "ADDRESS_POLICY", "Select at least one explicit screening rule.")
    require(all(value["mapping"][k] for k in value["required"]), "ADDRESS_MAPPING", "Map every required field.")
    if "ADDRESS_SIGNATURE" in value["rules"]:
        require(all(value["mapping"][k] for k in SIGNATURE), "ADDRESS_MAPPING",
                "Map every address signature component, including building and unit. Do not silently ignore apartments.")
    if "REPEATED_IDENTITY" in value["rules"]:
        require(value["mapping"]["identity"], "ADDRESS_MAPPING", "Map the original business identity.")
    inventory = value.get("inventory") or {}
    evidence.exact(inventory, ("openingCount", "openingIds", "closingCount", "closingIds"), ())
    require(not inventory or set(inventory) == {"openingCount", "openingIds", "closingCount", "closingIds"},
            "ADDRESS_INVENTORY", "Select all four original inventory observations, or use explicitly limited retained-file coverage.")
    value["inventory"] = inventory
    require(all(isinstance(v, str) and v for v in inventory.values()), "ADDRESS_INVENTORY", "Choose retained inventory sources.")
    if inventory:
        require(value.get("metadataSourceId"), "ADDRESS_METADATA", "Select original layer metadata for the inventory object-ID field.")
    for key in ("metadataSourceId", "caseId", "caseVersionId"):
        require(value.get(key) is None or isinstance(value[key], str) and bool(value[key]), "ADDRESS_SELECTION", "Use an exact saved selection or null.")
    require(bool(value.get("caseId")) == bool(value.get("caseVersionId")), "ADDRESS_CASE", "Retain the exact prior case edition with its case ID.")
    return value


def _load(workspace, source, budget):
    file = source["file"]
    require(0 < file["bytes"] <= evidence.MAX_SOURCE, "ADDRESS_SOURCE_SIZE", "Select an original file within the retained source limit.")
    budget[0] += file["bytes"]
    require(budget[0] <= MAX_BYTES, "ADDRESS_SOURCE_SIZE", "Selected sources exceed the 256 MiB analysis limit.")
    path = member(workspace.root, file["path"])
    require(path.is_file() and not path.is_symlink(), "ADDRESS_SOURCE", "The retained ordinary original source is missing.")
    with path.open("rb") as stream:
        raw = stream.read(file["bytes"] + 1)
    require(len(raw) == file["bytes"] and sha_bytes(raw) == file["sha256"],
            "ADDRESS_SOURCE_CHANGED", "The retained source no longer matches its original bytes.")
    try:
        value = json.loads(raw.decode("utf-8-sig"), parse_constant=lambda _: (_ for _ in ()).throw(ValueError("nonfinite JSON")))
    except (UnicodeError, ValueError):
        require(False, "ADDRESS_JSON", "Choose a complete original JSON source.")
    require(isinstance(value, dict) and "error" not in value, "ADDRESS_JSON", "A successful original JSON response is required.")
    return value


def _normal(value):
    if value is None:
        return ""
    return " ".join(unicodedata.normalize("NFC", str(value)).split()).casefold()


def _oid(value):
    # Object identifiers are numeric identities here; do not coerce text or booleans.
    return value if type(value) is int else None


def _point(feature, fmt, crs):
    geometry = feature.get("geometry")
    if not isinstance(geometry, dict):
        return None
    if fmt == "GEOJSON":
        coordinates = geometry.get("coordinates")
        if geometry.get("type") != "Point" or not isinstance(coordinates, list) or len(coordinates) < 2:
            return None
        point = coordinates
    else:
        if not all(k in geometry for k in ("x", "y")):
            return None
        point = [geometry["x"], geometry["y"]]
        point.extend(geometry[k] for k in ("z", "m") if k in geometry)
    if not all(type(x) in (int, float) and math.isfinite(x) for x in point):
        return None
    # Different CRSs never share a point group. No rounding or distance tolerance.
    return value_sha({"crs": crs, "coordinates": point})


def _csv(rows, keys):
    out = io.StringIO(newline="")
    writer = csv.writer(out, lineterminator="\r\n")
    writer.writerow(keys)
    for row in rows:
        cells = []
        for key in keys:
            value = row.get(key)
            if isinstance(value, (dict, list)):
                value = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
            elif value is None:
                value = ""
            else:
                value = str(value)
            # Spreadsheet-safe view only. JSON and original files retain exact values.
            if value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")):
                value = "'" + value
            cells.append(value)
        writer.writerow(cells)
    return out.getvalue().encode("utf-8")


def analyze(workspace, payload, common):
    payload = normalize_payload(payload)
    replay = workspace.operation(common["request_id"], "evidence.address.analyze", payload)
    if replay is not None:
        return replay
    state = workspace.read()
    require(state["revision"] == common["revision"], "REVISION_CONFLICT", "Review the current original workspace before analysis.")
    previous = evidence.current(state, "cases", payload["caseId"]) if payload.get("caseId") else None
    require(previous is None or previous["id"] == payload["caseVersionId"], "ADDRESS_CASE_CHANGED", "The selected case has a later edition.")
    case_id = previous["caseId"] if previous else "case-" + value_sha({"workspace": state["id"], "request": common["request_id"]})
    selected = list(payload["sourceIds"])
    extras = [payload.get("metadataSourceId"), *payload.get("inventory", {}).values()]
    for key in extras:
        if key and key not in selected:
            selected.append(key)
    sources = {key: evidence.get(state, "sources", key) for key in selected}
    budget = [0]
    original = {key: _load(workspace, sources[key], budget) for key in selected}
    metadata = original.get(payload.get("metadataSourceId"), {})
    oid_field = metadata.get("objectIdField") or metadata.get("objectIdFieldName")
    declared = metadata.get("fields", [])
    require(isinstance(declared, list), "ADDRESS_METADATA", "Retain the original metadata field list.")
    declared_names = {r.get("name") for r in declared if isinstance(r, dict)}
    mapped = set(filter(None, payload["mapping"].values()))
    if metadata:
        require(mapped <= declared_names, "ADDRESS_MAPPING", "A selected field is absent from the original layer metadata.", fields=sorted(mapped - declared_names))
    rows, pages = [], []
    groups = {rule: defaultdict(list) for rule in ("ADDRESS_SIGNATURE", "EXACT_POINT", "REPEATED_IDENTITY")}
    missing_rows, geometry_rows = [], []
    for source_id in payload["sourceIds"]:
        obj = original[source_id]
        fmt, supplied_oid, coverage = evidence.feature_collection(obj)
        object_field = supplied_oid or oid_field
        require(len(rows) + len(obj["features"]) <= MAX_ROWS, "ADDRESS_ROWS", "Split cohorts exceeding 50,000 original records into explicit review cases.")
        crs = obj.get("crs") if fmt == "GEOJSON" else obj.get("spatialReference")
        if fmt == "GEOJSON" and crs is None:
            crs = {"meaning": "GeoJSON default WGS84 longitude/latitude"}
        if fmt == "ESRI_FEATURE_SET":
            require(isinstance(crs, dict) and bool(crs), "ADDRESS_CRS", "Retain the original Esri response CRS; do not assume coordinate units.")
        fields = {f.get("name") for f in obj.get("fields", []) if isinstance(f, dict)}
        require(not fields or mapped <= fields, "ADDRESS_MAPPING", "A selected field is absent from a retained response's declared fields.", sourceId=source_id)
        pages.append({"sourceId": source_id, "fileSha256": sources[source_id]["file"]["sha256"],
                      "format": fmt, "objectIdField": object_field, "originalCrs": copy.deepcopy(crs), "coverage": coverage})
        for index, feature in enumerate(obj["features"]):
            require(isinstance(feature, dict) and (fmt != "GEOJSON" or feature.get("type") == "Feature"),
                    "ADDRESS_ROW", "Retain each complete original feature.", sourceId=source_id, index=index)
            attrs = feature.get("properties") if fmt == "GEOJSON" else feature.get("attributes")
            require(isinstance(attrs, dict), "ADDRESS_ROW", "Keep every original feature and its attributes.", sourceId=source_id, index=index)
            require(mapped <= set(attrs), "ADDRESS_MAPPING", "A mapped field is absent from an original record; choose the actual field mapping.",
                    sourceId=source_id, index=index, fields=sorted(mapped - set(attrs)))
            values = {key: copy.deepcopy(attrs.get(field)) if field else None for key, field in payload["mapping"].items()}
            require(all(value is None or type(value) in (str, int, float, bool) for value in values.values()),
                    "ADDRESS_FIELD_TYPE", "Address screening requires original scalar or null attribute values.")
            row_id = "row-" + value_sha({"sourceId": source_id, "index": index})
            missing = [key for key in payload["required"] if not _normal(values[key])]
            point_key = _point(feature, fmt, crs)
            row = {"id": row_id, "sourceId": source_id, "sourceIndex": index, "featureSha256": value_sha(feature),
                   "objectId": attrs.get(object_field) if object_field else feature.get("id"),
                   "values": values, "missingRequired": missing, "pointValid": point_key is not None, "candidateIds": []}
            rows.append(row)
            if missing:
                missing_rows.append(row_id)
            if point_key is None:
                geometry_rows.append(row_id)
            signature = tuple(_normal(values[key]) for key in SIGNATURE)
            if signature[0] and signature[1]:
                groups["ADDRESS_SIGNATURE"][signature].append(row_id)
            if point_key:
                groups["EXACT_POINT"][point_key].append(row_id)
            identity = _normal(values["identity"])
            if identity:
                groups["REPEATED_IDENTITY"][identity].append(row_id)
    candidates = []
    descriptions = {
        "ADDRESS_SIGNATURE": "Matching complete address signature; inspect original units, source lineage and authority before deciding whether records duplicate an address.",
        "EXACT_POINT": "Exactly matching original coordinates in the same declared CRS; shared locations may be legitimate.",
        "REPEATED_IDENTITY": "Repeated selected business identity; inspect original versions and publisher identity rules.",
        "MISSING_REQUIRED": "One or more analyst-selected required fields are blank or null; confirm applicability with the source owner.",
        "POINT_GEOMETRY": "Missing or unsupported/nonfinite point geometry; no substitute point has been invented."
    }
    def candidate(rule, members, key):
        candidate_id = "candidate-" + value_sha({"rule": rule, "rowIds": members, "comparison": key})
        candidates.append({"id": candidate_id, "rule": rule, "rowIds": members, "comparison": key,
                           "meaning": descriptions[rule], "status": "UNREVIEWED_CANDIDATE"})
    for rule, buckets in groups.items():
        if rule in payload["rules"]:
            for key, members in buckets.items():
                if len(members) > 1:
                    candidate(rule, members, key)
    by_id = {row["id"]: row for row in rows}
    if "MISSING_REQUIRED" in payload["rules"]:
        for row_id in missing_rows:
            candidate("MISSING_REQUIRED", [row_id], by_id[row_id]["missingRequired"])
    if "POINT_GEOMETRY" in payload["rules"]:
        for row_id in geometry_rows:
            candidate("POINT_GEOMETRY", [row_id], None)
    for item in candidates:
        for row_id in item["rowIds"]:
            by_id[row_id]["candidateIds"].append(item["id"])
    inventory = {"mode": "RETAINED_FILES_ONLY", "openingCount": None, "closingCount": None,
                 "receivedCount": len(rows), "objectIdSetsMatch": None, "wholeDatasetVerified": False,
                 "meaning": "Only these retained source files are covered; publisher-wide completeness has not been established."}
    if payload.get("inventory"):
        inv = {k: original[v] for k, v in payload["inventory"].items()}
        counts = [inv[k].get("count") for k in ("openingCount", "closingCount")]
        id_lists = [inv[k].get("objectIds") for k in ("openingIds", "closingIds")]
        require(all(type(n) is int and 0 <= n <= MAX_ROWS for n in counts) and
                all(isinstance(ids, list) and len(ids) <= MAX_ROWS and all(_oid(v) is not None for v in ids) for ids in id_lists),
                "ADDRESS_INVENTORY", "Use original integer count and complete object-ID inventory responses.")
        require(all(len(set(ids)) == len(ids) for ids in id_lists), "ADDRESS_INVENTORY", "An original ID inventory contains repeated identifiers.")
        received_ids = [row["objectId"] for row in rows]
        matched = (all(_oid(v) is not None for v in received_ids) and len(set(received_ids)) == len(received_ids)
                   and counts[0] == counts[1] == len(rows) == len(id_lists[0]) == len(id_lists[1])
                   and set(id_lists[0]) == set(id_lists[1]) == set(received_ids))
        inventory = {"mode": "OPEN_CLOSE_ID_INVENTORY", "openingCount": counts[0], "closingCount": counts[1],
                     "receivedCount": len(rows), "objectIdSetsMatch": matched, "wholeDatasetVerified": False,
                     "meaning": ("Opening, received and closing object-ID sets match for the declared query. This is membership evidence, not a transactional value snapshot or whole publisher dataset certification."
                                 if matched else "The retained count/ID observations differ. Coverage is incomplete or changed; keep the original observations and resolve the discrepancy before relying on cohort completeness."),
                     "sourceIds": copy.deepcopy(payload["inventory"])}
    summary = {"rows": len(rows), "candidateGroups": len(candidates),
               "rowsWithCandidates": sum(bool(row["candidateIds"]) for row in rows),
               "byRule": {rule: sum(c["rule"] == rule for c in candidates) for rule in payload["rules"]}}
    analysis = {"schema": SCHEMA, "workspaceId": state["id"], "caseId": case_id, "requestId": common["request_id"],
                "basis": {"workspaceRevision": common["revision"], "caseVersionId": previous["id"] if previous else None},
                "title": payload["title"], "jurisdiction": payload["jurisdiction"], "asOf": payload["asOf"], "scope": payload["scope"],
                "policy": {key: copy.deepcopy(payload[key]) for key in ("mapping", "required", "rules")},
                "normalization": NORMALIZATION, "limitation": LIMITATION, "summary": summary, "inventory": inventory,
                "sources": [{"sourceId": key, "title": sources[key]["title"], "file": sources[key]["file"],
                             "sourceUri": sources[key]["sourceUri"], "retrievedAt": sources[key]["retrievedAt"]} for key in selected],
                "pages": pages, "rows": rows, "candidates": candidates}
    generated = [("analysis.json", MEDIA_TYPE, json_bytes(analysis)),
                 ("records.csv", "text/csv; charset=utf-8", _csv(
                     [{**row, **row["values"]} for row in rows], ("id", "sourceId", "sourceIndex", "objectId", *FIELDS,
                                                               "missingRequired", "pointValid", "candidateIds"))),
                 ("candidates.csv", "text/csv; charset=utf-8", _csv(candidates, ("id", "rule", "rowIds", "comparison", "meaning", "status")))]
    require(all(len(body) <= evidence.MAX_SOURCE for _, _, body in generated), "ADDRESS_OUTPUT_SIZE",
            "The complete analysis exceeds the source-file bound; use a smaller explicitly selected cohort.")
    retained = [(name, media, retain_bytes(workspace.root, "evidence/files/" + sha_bytes(body), body)) for name, media, body in generated]
    def update(current):
        prior = evidence.current(current, "cases", case_id) if previous else None
        require(prior is None or prior["id"] == payload["caseVersionId"], "ADDRESS_CASE_CHANGED", "Keep the exact reviewed prior case edition.")
        created = utc_now()
        results = []
        for name, media, file in retained:
            series = "address-review:" + case_id + ":" + name
            older = [s for s in evidence.data(current)["sources"] if s["seriesKey"] == series]
            results.append(evidence.put(current, "sources", {
                "title": payload["title"] + " — " + name, "seriesKey": series, "edition": common["request_id"],
                "role": "OTHER", "issuer": "Named analyst's recorded address screening", "jurisdiction": payload["jurisdiction"],
                "sourceUri": "urn:starforge:address-review:" + common["request_id"] + ":" + name,
                "publishedDate": None, "effectiveDate": None, "retrievedAt": created, "mediaType": media,
                "coordinateReference": "Original CRS retained separately for every source page.",
                "notes": LIMITATION + " CSV formula-like cells are prefixed with an apostrophe; JSON and original files are exact.",
                "documentScope": "Complete selected cohort and screening policy.", "coverageNotes": inventory["meaning"],
                "queryDescription": payload["scope"], "publisherUpdatedAt": None,
                "previousId": older[-1]["id"] if older else None, "file": file, "filename": "address-" + name,
                "createdAt": created, "actor": common["actor"]}))
        source_refs = [{"sourceId": key, "locator": "Complete retained original file"} for key in selected]
        source_refs += [{"sourceId": row["id"], "locator": "Complete derived " + name} for row, (name, _, _) in zip(results, retained)]
        if prior:
            existing_refs = evidence.raw_refs(prior["sourceReferences"])
            source_refs = existing_refs + [ref for ref in source_refs if ref["sourceId"] not in {r["sourceId"] for r in existing_refs}]
        require(len(source_refs) <= 1000, "ADDRESS_REFERENCES", "This case has reached the complete source-reference limit; start an explicitly separate cohort case.")
        subjects = copy.deepcopy(prior["subjects"]) if prior else []
        # Re-normalize preserved native subjects from their original accepted request shape.
        for subject in subjects:
            subject["sourceReferences"] = evidence.raw_refs(subject["sourceReferences"])
            if subject.get("feature"):
                subject["feature"] = {key: subject["feature"][key] for key in ("sourceId", "index", "featureSha256", "businessField")}
            if subject.get("mapObservation"):
                subject["mapObservation"] = {key: subject["mapObservation"][key] for key in ("requestId", "featureId", "businessField")}
        cohort = {"id": "address-cohort", "label": payload["title"], "kind": "AREA", "jurisdiction": payload["jurisdiction"],
                  "identity": "Recorded address-source cohort; row identities are retained in " + results[0]["id"],
                  "sourceReferences": source_refs}
        subjects = [s for s in subjects if s["id"] != "address-cohort"] + [cohort]
        definition = {"title": payload["title"], "jurisdiction": payload["jurisdiction"],
                      "purpose": "Review address-source candidates and retain named decisions with their exact original evidence.",
                      "proposedUse": "Data-quality commissioning; source-owner decisions remain explicit.",
                      "asOf": payload["asOf"], "scope": payload["scope"], "assumptions": LIMITATION,
                      "sourceReferences": source_refs, "subjects": subjects,
                      "professionalQuestions": prior.get("professionalQuestions", []) if prior else []}
        case = evidence.put(current, "cases", {**evidence.normalize_case(workspace, current, definition, prior, case_id),
                                               "createdAt": created, "actor": common["actor"]})
        return {"caseId": case_id, "caseVersionId": case["id"], "analysisSourceId": results[0]["id"],
                "recordMatrixSourceId": results[1]["id"], "candidateMatrixSourceId": results[2]["id"],
                "summary": summary, "inventory": inventory}
    return workspace._mutate(action="evidence.address.analyze", payload=payload, update=update, **common)


def analyses(state, case_id=None):
    case = evidence.current(state, "cases", case_id) if case_id else None
    referenced = {r["sourceId"] for r in case["sourceReferences"]} if case else None
    return [{"id": s["id"], "title": s["title"], "createdAt": s["createdAt"], "actor": s["actor"],
             "previousId": s["previousId"], "file": s["file"]}
            for s in evidence.data(state)["sources"]
            if s["mediaType"] == MEDIA_TYPE and (referenced is None or s["id"] in referenced)]


def read_analysis(workspace, source_id):
    state = workspace.read()
    source = evidence.get(state, "sources", source_id)
    require(source["mediaType"] == MEDIA_TYPE, "ADDRESS_ANALYSIS", "Select a saved address analysis.")
    value = _load(workspace, source, [0])
    require(value.get("schema") == SCHEMA and value.get("workspaceId") == state["id"],
            "ADDRESS_ANALYSIS", "The saved analysis belongs to a different source or workspace.")
    receipt = workspace.operation(value.get("requestId"))
    require(isinstance(receipt, dict) and receipt.get("analysisSourceId") == source_id and
            receipt.get("caseId") == value.get("caseId"), "ADDRESS_ANALYSIS",
            "Select a complete analysis produced by its original accepted operation.")
    return value


def read_route(workspace, path, query):
    from .parcel_evidence_operator import parameter, pagination
    if path == "/api/evidence/address/catalog":
        require(set(query) <= {"caseId"}, "ADDRESS_QUERY", "Select an original case.")
        state = workspace.read()
        return {"schema": SCHEMA, "workspaceId": state["id"], "revision": state["revision"],
                "fields": list(FIELDS), "rules": list(RULES), "profiles": [copy.deepcopy(PROFILE)],
                "analyses": analyses(state, parameter(query, "caseId")), "limits": {"rows": MAX_ROWS, "bytes": MAX_BYTES},
                "normalization": NORMALIZATION, "limitation": LIMITATION}
    if path not in ("/api/evidence/address/summary", "/api/evidence/address/rows", "/api/evidence/address/candidates", "/api/evidence/address/members"):
        return None
    require(set(query) <= {"sourceId", "offset", "limit", "search", "rule", "candidateId"}, "ADDRESS_QUERY", "Use the saved source and explicit page/filter.")
    value = read_analysis(workspace, parameter(query, "sourceId"))
    if path.endswith("/summary"):
        return {k: copy.deepcopy(v) for k, v in value.items() if k not in ("rows", "candidates")}
    offset, limit = pagination(query)
    term = evidence.text(parameter(query, "search", ""), "Search", 500, False).casefold()
    rule = parameter(query, "rule", "")
    require(not rule or rule in RULES, "ADDRESS_QUERY", "Choose an original screening rule.")
    if path.endswith("/members"):
        candidate = next((c for c in value["candidates"] if c["id"] == parameter(query, "candidateId")), None)
        require(candidate is not None, "ADDRESS_CANDIDATE", "Select an original saved candidate.")
        selected = set(candidate["rowIds"])
        rows = [r for r in value["rows"] if r["id"] in selected]
    elif path.endswith("/rows"):
        matching = {rid for c in value["candidates"] if not rule or c["rule"] == rule for rid in c["rowIds"]}
        rows = [r for r in value["rows"] if (not rule or r["id"] in matching) and
                (not term or term in json.dumps(r, ensure_ascii=False, sort_keys=True).casefold())]
    else:
        by_id = {r["id"]: r for r in value["rows"]}
        rows = []
        for candidate in value["candidates"]:
            if rule and candidate["rule"] != rule:
                continue
            records = [by_id[rid] for rid in candidate["rowIds"]]
            if not term or term in json.dumps(candidate, ensure_ascii=False, sort_keys=True).casefold() or any(
                    term in json.dumps(row, ensure_ascii=False, sort_keys=True).casefold() for row in records):
                rows.append({k: copy.deepcopy(v) for k, v in candidate.items() if k != "rowIds"} |
                            {"recordCount": len(records), "sample": records[:3]})
    return {"sourceId": parameter(query, "sourceId"), "caseId": value["caseId"], "items": rows[offset:offset+limit],
            "offset": offset, "limit": limit, "total": len(rows), "complete": offset+limit >= len(rows)}
