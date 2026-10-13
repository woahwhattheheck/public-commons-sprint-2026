# SPDX-License-Identifier: MIT
"""Parcel/document evidence and named review in the original QgisWorkspace."""
from __future__ import annotations
import copy
import csv
import datetime as dt
from decimal import Decimal, InvalidOperation
import html
import io
import json
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from .model import (HASH, REQUEST, require, json_bytes, value_sha, sha_bytes, utc_now,
                    descriptor, member, read_json, file_digest, retain_copy, retain_bytes)

SCHEMA = "starforge.parcel-evidence.v1"
KEY = "parcelEvidence"
KINDS = ("sources", "cases", "findings", "successions", "observations", "reports")
PREFIX = {"sources":"evidence-source-", "cases":"evidence-case-", "findings":"evidence-finding-",
          "successions":"evidence-succession-", "observations":"evidence-observation-", "reports":"evidence-report-"}
ROLES = ("PARCEL", "EFFECTIVE_FEMA", "PRELIMINARY_FEMA", "LOMC", "DNR_BEST_AVAILABLE",
         "LOCAL_ORDINANCE", "STRUCTURE", "PROPOSED_IMPROVEMENT", "SURVEY", "OTHER")
CLASSES = ("SOURCE_FACT", "REVIEWED_INTERPRETATION", "AGENCY_QUESTION", "PROFESSIONAL_QUESTION")
STATUSES = ("OPEN", "REVIEWED", "ANSWERED", "WITHDRAWN")
MAX_SOURCE = 128 * 1024 * 1024

def text(value, label, maximum=4000, required=True):
    require(isinstance(value, str) and len(value) <= maximum and "\0" not in value and
            (not required or bool(value.strip())), "EVIDENCE_TEXT", label + " is required.")
    return value.strip()

def exact(value, allowed, required=()):
    require(isinstance(value, dict) and set(value) <= set(allowed) and set(required) <= set(value),
            "EVIDENCE_FIELDS", "Use the complete documented evidence fields.")

def identity(value):
    require(isinstance(value, str) and REQUEST.fullmatch(value), "EVIDENCE_ID", "Use the original record identity.")
    return value

def date(value, label):
    if value in ("", None):
        return None
    try:
        require(isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value),
                "EVIDENCE_DATE", label + " must be a calendar date.")
        dt.date.fromisoformat(value)
    except (TypeError, ValueError):
        require(False, "EVIDENCE_DATE", label + " must be a real calendar date.")
    return value

def stamp(value, label):
    try:
        result = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        require(result.tzinfo is not None, "EVIDENCE_TIME", label + " needs an explicit UTC offset.")
    except (TypeError, ValueError, AttributeError):
        require(False, "EVIDENCE_TIME", label + " must be an original timestamp with offset.")
    return result.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")

def data(state, create=False):
    if KEY not in state:
        if not create:
            return {"schema": SCHEMA, **{kind: [] for kind in KINDS}}
        state[KEY] = {"schema": SCHEMA, **{kind: [] for kind in KINDS}}
    return state[KEY]

def get(state, kind, record_id):
    found = next((row for row in data(state)[kind] if row["id"] == record_id), None)
    require(found is not None, "EVIDENCE_RECORD", "Select an original " + kind + " record.", id=record_id)
    return found

def current(state, kind, logical):
    field = "caseId" if kind == "cases" else "findingId"
    values = [row for row in data(state)[kind] if row[field] == logical]
    require(values, "EVIDENCE_RECORD", "Select a saved " + field + ".")
    return values[-1]

def put(state, kind, value):
    row = {"schema": SCHEMA, **copy.deepcopy(value)}
    row["id"] = PREFIX[kind] + value_sha(row)
    require(not any(r["id"] == row["id"] for r in data(state, True)[kind]),
            "EVIDENCE_RECORD_EXISTS", "This immutable evidence record is already retained.")
    data(state, True)[kind].append(row)
    return row

def refs(state, values):
    require(isinstance(values, list) and 1 <= len(values) <= 1000,
            "EVIDENCE_SOURCES", "Select original sources with exact page, section or feature locators.")
    result, seen = [], set()
    for value in values:
        exact(value, ("sourceId", "locator", "sourcePageIndex0", "printedPage", "section"), ("sourceId", "locator"))
        source = get(state, "sources", value["sourceId"])
        ref = {"sourceId": source["id"], "fileSha256": source["file"]["sha256"],
               "locator": text(value["locator"], "Exact source locator", 2000)}
        if value.get("sourcePageIndex0") is not None:
            page = value["sourcePageIndex0"]
            require(type(page) is int and 0 <= page <= 1000000, "EVIDENCE_PAGE", "Use the original zero-based PDF page index.")
            ref["sourcePageIndex0"] = page
        for key, label in (("printedPage", "Printed page label"), ("section", "Original section anchor")):
            if value.get(key) is not None:
                ref[key] = text(value[key], label, 2000, False)
        pair = value_sha(ref)
        require(pair not in seen, "EVIDENCE_SOURCES", "Do not repeat the same source locator.")
        seen.add(pair); result.append(ref)
    return result

def raw_refs(values):
    return [{k:v for k,v in r.items() if k != "fileSha256"} for r in values]

def feature_collection(obj):
    require(isinstance(obj, dict) and "error" not in obj and isinstance(obj.get("features"), list),
            "EVIDENCE_FEATURE_SOURCE", "Choose an original GeoJSON collection or ArcGIS FeatureSet response.")
    if obj.get("type") == "FeatureCollection":
        fmt = "GEOJSON"
        field = None
    else:
        require((obj.get("geometryType") is None or obj.get("geometryType") in ("esriGeometryPoint", "esriGeometryMultipoint",
                "esriGeometryPolyline", "esriGeometryPolygon", "esriGeometryEnvelope")) and
                (obj.get("spatialReference") is None or isinstance(obj.get("spatialReference"), dict)) and
                (isinstance(obj.get("fields"), list) or isinstance(obj.get("fieldAliases"), dict)) and
                all(isinstance(r, dict) and isinstance(r.get("attributes"), dict) for r in obj["features"]),
                "EVIDENCE_FEATURE_SOURCE", "Retain the original ArcGIS fields, geometry type and spatial reference when returned.")
        fmt = "ESRI_FEATURE_SET"
        field = obj.get("objectIdFieldName")
    coverage = {"returnedFeatureCount": len(obj["features"]),
                "exceededTransferLimit": obj.get("exceededTransferLimit"),
                "numberMatched": obj.get("numberMatched"), "numberReturned": obj.get("numberReturned"),
                "responseCount": obj.get("count"), "links": copy.deepcopy(obj.get("links")),
                "wholeDatasetVerified": False,
                "meaning": "One retained response or file; completion of its local pages does not establish a complete publisher dataset."}
    if "exceededTransferLimit" in obj:
        require(type(obj["exceededTransferLimit"]) is bool, "EVIDENCE_COVERAGE", "Keep the original transfer-limit flag.")
    return fmt, field, coverage

def feature_from_object(source, obj, index, expected=None):
    fmt, field, coverage = feature_collection(obj)
    require(type(index) is int and 0 <= index < len(obj["features"]), "EVIDENCE_FEATURE", "Select an original zero-based feature position.")
    row = obj["features"][index]
    props = row.get("properties") if fmt == "GEOJSON" and isinstance(row, dict) else row.get("attributes") if isinstance(row, dict) else None
    require(isinstance(row, dict) and isinstance(props, dict) and
            (fmt != "GEOJSON" or row.get("type") == "Feature"),
            "EVIDENCE_FEATURE", "The selected original feature is invalid.")
    digest = value_sha(row)
    require(expected is None or expected == digest, "EVIDENCE_FEATURE_CHANGED", "The selected original feature differs from its reviewed identity.")
    return {"sourceId": source["id"], "sourceFileSha256": source["file"]["sha256"],
            "index": index, "featureId": copy.deepcopy(row.get("id") if fmt == "GEOJSON" else props.get(field)),
            "featureSha256": digest, "coordinateReference": source["coordinateReference"],
            "originalCrs": copy.deepcopy(obj.get("crs") if fmt == "GEOJSON" else obj.get("spatialReference")),
            "format": fmt, "originalFeature": copy.deepcopy(row),
            "properties": copy.deepcopy(props), "geometry": copy.deepcopy(row.get("geometry")),
            "geometrySha256": value_sha(row.get("geometry")), "featureCount": len(obj["features"]),
            "responseMetadata": {k:copy.deepcopy(v) for k,v in obj.items() if k != "features"},
            "coverage": coverage}

def feature(workspace, state, source_id, index, expected=None):
    source = get(state, "sources", source_id)
    require(source["mediaType"].split(";")[0].strip() in ("application/geo+json", "application/json", "application/vnd.esri+json"),
            "EVIDENCE_FEATURE_SOURCE", "Select an original GeoJSON or ArcGIS source edition.")
    require(source["coordinateReference"], "EVIDENCE_CRS", "Record the original source coordinate reference before selecting a feature.")
    body = member(workspace.root, source["file"]["path"])
    file_digest(body, expected=source["file"])
    obj, raw = read_json(body, limit=MAX_SOURCE)
    require(len(raw) == source["file"]["bytes"] and sha_bytes(raw) == source["file"]["sha256"],
            "EVIDENCE_SOURCE_CHANGED", "The parsed original feature response changed during reading.")
    return feature_from_object(source, obj, index, expected)

def source_rows(workspace, source_id, offset=0, limit=25):
    state = workspace.read()
    source = get(state, "sources", source_id)
    require(type(offset) is int and offset >= 0 and type(limit) is int and 1 <= limit <= 100,
            "EVIDENCE_PAGE", "Select a page of one to 100 original features.")
    path = member(workspace.root, source["file"]["path"])
    file_digest(path, expected=source["file"])
    obj, raw = read_json(path, limit=MAX_SOURCE)
    require(len(raw) == source["file"]["bytes"] and sha_bytes(raw) == source["file"]["sha256"],
            "EVIDENCE_SOURCE_CHANGED", "The parsed original feature response changed during reading.")
    fmt, _, coverage = feature_collection(obj)
    rows = []
    for index in range(offset, min(len(obj["features"]), offset + limit)):
        row = feature_from_object(source, obj, index)
        geometry = row["geometry"]
        rows.append({k:row[k] for k in ("index", "featureId", "featureSha256", "properties", "geometrySha256")})
        rows[-1].update({"geometryType": geometry.get("type") if fmt == "GEOJSON" and isinstance(geometry, dict) else obj.get("geometryType"),
                         "geometryPresent": geometry is not None, "format": fmt})
    return {"sourceId": source_id, "sourceFileSha256": source["file"]["sha256"],
            "coordinateReference": source["coordinateReference"],
            "originalCrs": obj.get("crs") if fmt == "GEOJSON" else obj.get("spatialReference"),
            "format": fmt, "coverage": coverage,
            "items": rows, "offset": offset, "limit": limit, "total": len(obj["features"]),
            "complete": offset + len(rows) >= len(obj["features"])}

def native_layer_binding(root, project, native_id):
    path = member(root, project["file"]["path"])
    file_digest(path, expected=project["file"])
    with zipfile.ZipFile(path) as archive:
        names = [n for n in archive.namelist() if n.endswith(".qgs")]
        require(len(names) == 1, "EVIDENCE_NATIVE_MAP", "Retain exactly one original QGIS map definition.")
        info = archive.getinfo(names[0])
        require(info.file_size <= MAX_SOURCE, "EVIDENCE_NATIVE_MAP", "The original map XML exceeds the receiving limit.")
        tree = ET.fromstring(archive.read(names[0]))
    matches = [node for node in tree.findall(".//projectlayers/maplayer") if node.findtext("id") == native_id]
    require(len(matches) == 1, "EVIDENCE_NATIVE_LAYER", "Bind the native feature to its exact saved map layer.")
    values = {}
    for node in matches[0].findall(".//customproperties//*"):
        key = node.get("key") or node.get("name")
        if key in ("starforge/layerId", "starforge/sourceId"):
            require(key not in values or values[key] == node.get("value"), "EVIDENCE_NATIVE_LAYER", "Native map source properties conflict.")
            values[key] = node.get("value")
    layer = next((r for r in project.get("layers", []) if r["id"] == values.get("starforge/layerId")), None)
    require(layer is not None and layer["sourceId"] == values.get("starforge/sourceId"),
            "EVIDENCE_NATIVE_LAYER", "Keep the original stable layer and receiving source identities.")
    return layer

def map_observation(root, state, operation, feature_id, business_field):
    require(operation["status"] == "COMPLETED" and operation["input"]["action"] == "map.features" and
            operation["input"]["workspaceId"] == state["id"] and operation["inputSha256"] == value_sha(operation["input"]),
            "EVIDENCE_NATIVE_OBSERVATION", "Select an actual completed original native feature read.")
    observed = operation["result"]
    rows = observed.get("rows", [])
    matches = [r for r in rows if str(r.get("featureId")) == str(feature_id)]
    require(len(matches) == 1, "EVIDENCE_NATIVE_FEATURE", "Select one original native feature in that exact returned page.")
    field = text(business_field, "Original native business identity field", 240)
    columns, original_values = observed.get("fields", []), matches[0].get("values", [])
    require(isinstance(columns, list) and isinstance(original_values, list) and len(columns) == len(original_values) and
            all(isinstance(c, dict) and isinstance(c.get("name"), str) for c in columns) and
            len({c["name"] for c in columns}) == len(columns), "EVIDENCE_NATIVE_FIELDS", "Keep the original native field order and values.")
    values = {c["name"]: original_values[index] for index, c in enumerate(columns)}
    require(field in values and values[field] not in (None, "") and not isinstance(values[field], (dict,list,bool)), "EVIDENCE_BUSINESS_ID", "Use the actual returned parcel/business identity field.")
    project_id = operation["input"]["payload"]["projectId"]
    project = next((r for r in state["projects"] if r["id"] == project_id), None)
    require(project is not None and observed.get("projectId") == project_id, "EVIDENCE_NATIVE_PROJECT", "Retain the exact original native map.")
    native_id = text(observed.get("nativeLayerId"), "Original native layer ID", 2000)
    layer = native_layer_binding(root, project, native_id)
    requested = operation["input"]["payload"]["layerId"]
    require(requested in (layer["id"], native_id) and observed.get("layerId") == requested,
            "EVIDENCE_NATIVE_LAYER", "The original request and returned native layer differ.")
    return {"requestId": operation["requestId"], "inputSha256": operation["inputSha256"],
            "resultSha256": value_sha(observed), "projectId": project_id, "projectFile": copy.deepcopy(project["file"]),
            "layer": copy.deepcopy(layer), "nativeLayerId": native_id,
            "fields": copy.deepcopy(columns), "feature": copy.deepcopy(matches[0]), "businessField": field,
            "businessValue": copy.deepcopy(values[field]), "extent": copy.deepcopy(observed.get("extent")),
            "subsetString": observed.get("subsetString"), "page": {k:copy.deepcopy(observed.get(k)) for k in ("offset", "limit", "hasMore", "complete", "nativeFeatureCount")},
            "meaning": "Original native feature-page observation; extent selection alone establishes no polygon intersection."}

def original_native_operation(workspace, request_id):
    from .analyst_state import _validate_record
    with workspace._connect() as db:
        exists = db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='analyst_requests'").fetchone()
        row = db.execute("SELECT body FROM analyst_requests WHERE request_id=?", (identity(request_id),)).fetchone() if exists else None
    require(row is not None, "EVIDENCE_NATIVE_OBSERVATION", "Retain the original completed native analyst request.")
    return _validate_record(json.loads(row[0]), workspace.read()["id"])

def normalize_subject(workspace, state, value):
    exact(value, ("id", "label", "kind", "jurisdiction", "identity", "sourceReferences", "feature", "mapObservation"),
          ("id", "label", "kind", "jurisdiction", "identity", "sourceReferences"))
    require(value["kind"] in ("PARCEL", "STRUCTURE", "PROPOSED_IMPROVEMENT", "AREA"),
            "EVIDENCE_SUBJECT", "Keep parcel, structure, proposed improvement and area subjects distinct.")
    result = {"id": identity(value["id"]), "label": text(value["label"], "Subject label", 240),
              "kind": value["kind"], "jurisdiction": text(value["jurisdiction"], "Subject jurisdiction", 500),
              "identity": text(value["identity"], "Original business parcel or subject identity", 2000),
              "sourceReferences": refs(state, value["sourceReferences"])}
    if value.get("feature") is not None:
        ref = value["feature"]
        exact(ref, ("sourceId", "index", "featureSha256", "businessField"), ("sourceId", "index", "featureSha256", "businessField"))
        selected = feature(workspace, state, ref["sourceId"], ref["index"], ref["featureSha256"])
        source = get(state, "sources", ref["sourceId"])
        require(source["role"] == value["kind"] or value["kind"] == "AREA" and source["role"] in
                ("PARCEL", "EFFECTIVE_FEMA", "PRELIMINARY_FEMA", "LOMC", "DNR_BEST_AVAILABLE", "SURVEY", "OTHER"),
                "EVIDENCE_SOURCE_ROLE", "Select a source whose declared role matches the original subject kind.")
        field = text(ref["businessField"], "Original parcel identity field", 240)
        require(field in selected["properties"] and selected["properties"][field] not in (None, "") and
                not isinstance(selected["properties"][field], (dict, list, bool)),
                "EVIDENCE_BUSINESS_ID", "Select the original nonempty scalar business identity field.")
        require(any(r["sourceId"] == ref["sourceId"] for r in result["sourceReferences"]),
                "EVIDENCE_FEATURE_SOURCE", "Cite the selected feature source.")
        result["feature"] = {**selected, "businessField": field, "businessValue": copy.deepcopy(selected["properties"][field])}
    if value.get("mapObservation") is not None:
        ref = value["mapObservation"]
        exact(ref, ("requestId", "featureId", "businessField"), ("requestId", "featureId", "businessField"))
        operation = original_native_operation(workspace, ref["requestId"])
        result["mapObservation"] = map_observation(workspace.root, state, operation, ref["featureId"], ref["businessField"])
    if result.get("feature") and result.get("mapObservation"):
        require(str(result["feature"]["businessValue"]) == str(result["mapObservation"]["businessValue"]),
                "EVIDENCE_SUBJECT_BINDING", "The source feature and native feature must identify the same original business parcel or subject.")
    return result

def normalize_case(workspace, state, definition, previous, case_id):
    exact(definition, ("title", "jurisdiction", "purpose", "proposedUse", "asOf", "scope",
          "assumptions", "sourceReferences", "subjects", "professionalQuestions"), ("title", "jurisdiction",
          "purpose", "proposedUse", "asOf", "scope", "sourceReferences", "subjects"))
    subjects = definition["subjects"]
    require(isinstance(subjects, list) and 1 <= len(subjects) <= 10000, "EVIDENCE_SUBJECT", "Retain all selected original subjects.")
    subjects = [normalize_subject(workspace, state, s) for s in subjects]
    require(len({s["id"] for s in subjects}) == len(subjects), "EVIDENCE_SUBJECT", "Subject identifiers must be unique in this case.")
    questions = definition.get("professionalQuestions", [])
    require(isinstance(questions, list) and len(questions) <= 1000, "EVIDENCE_QUESTIONS", "Use the complete question list.")
    return {"caseId": case_id, "previousId": previous["id"] if previous else None,
            "title": text(definition["title"], "Case title", 500),
            "jurisdiction": text(definition["jurisdiction"], "Case jurisdiction", 500),
            "purpose": text(definition["purpose"], "Decision being supported", 8000),
            "proposedUse": text(definition["proposedUse"], "Proposed use or improvement, including unknowns", 8000),
            "asOf": date(definition["asOf"], "Case as-of date"),
            "scope": text(definition["scope"], "Research scope", 12000),
            "assumptions": text(definition.get("assumptions", ""), "Assumptions", 12000, False),
            "sourceReferences": refs(state, definition["sourceReferences"]), "subjects": subjects,
            "professionalQuestions": [text(q, "Question", 4000) for q in questions]}

def normalize_finding(state, definition, case, previous, finding_id):
    exact(definition, ("title", "classification", "status", "statement", "applicability", "assumptions",
        "subjectIds", "sourceReferences", "reviewer", "reviewedAt", "nextAction", "responsibleRole",
        "dueDate", "answer", "answerReferences", "correctionReason"), ("title", "classification", "status",
        "statement", "applicability", "subjectIds", "sourceReferences", "reviewer", "reviewedAt",
        "nextAction", "responsibleRole"))
    require(definition["classification"] in CLASSES and definition["status"] in STATUSES,
            "EVIDENCE_CLASSIFICATION", "Select an explicit source fact, interpretation or original question and its review status.")
    ids = definition["subjectIds"]
    require(isinstance(ids, list) and ids and len(set(ids)) == len(ids) and
            set(ids) <= {s["id"] for s in case["subjects"]},
            "EVIDENCE_SUBJECT", "Bind the finding to the exact subjects in this case edition.")
    answer = text(definition.get("answer", ""), "Answer", 12000, definition["status"] == "ANSWERED")
    answer_refs = refs(state, definition["answerReferences"]) if definition.get("answerReferences") else []
    require(definition["status"] != "ANSWERED" or answer_refs, "EVIDENCE_ANSWER", "An answered question requires its original answer source.")
    require(definition["status"] != "ANSWERED" or definition["classification"] in ("AGENCY_QUESTION", "PROFESSIONAL_QUESTION"),
            "EVIDENCE_ANSWER", "Use ANSWERED for an original agency or professional question.")
    return {"caseId": case["caseId"], "caseVersionId": case["id"], "findingId": finding_id,
        "previousId": previous["id"] if previous else None, "title": text(definition["title"], "Finding title", 500),
        "classification": definition["classification"], "status": definition["status"],
        "statement": text(definition["statement"], "Source fact, reviewed interpretation or question", 16000),
        "applicability": text(definition["applicability"], "Parcel/use applicability", 12000),
        "assumptions": text(definition.get("assumptions", ""), "Limitations and assumptions", 12000, False),
        "subjectIds": list(ids), "sourceReferences": refs(state, definition["sourceReferences"]),
        "reviewer": text(definition["reviewer"], "Named reviewer", 240),
        "reviewedAt": stamp(definition["reviewedAt"], "Review time"),
        "nextAction": text(definition["nextAction"], "Specific next action or recorded completion", 8000),
        "responsibleRole": text(definition["responsibleRole"], "Responsible agency or professional role", 500),
        "dueDate": date(definition.get("dueDate"), "Action due date"), "answer": answer,
        "answerReferences": answer_refs,
        "correctionReason": text(definition.get("correctionReason", ""), "Reason for the successor finding", 8000, bool(previous))}

def heads(state, kind, case_id=None):
    field = "caseId" if kind == "cases" else "findingId"
    selected = {}
    for row in data(state)[kind]:
        if case_id is None or row.get("caseId") == case_id:
            selected[row[field]] = row
    return list(selected.values())

def compare(state, case_id, left_id, right_id):
    case = current(state, "cases", case_id)
    left, right = get(state, "sources", left_id), get(state, "sources", right_id)
    require(left_id != right_id and left["seriesKey"] == right["seriesKey"] and left["role"] == right["role"] and left["issuer"] == right["issuer"],
            "EVIDENCE_SUCCESSOR", "Compare distinct original editions of the same declared source series.")
    subjects = {v["id"]:v for v in case["subjects"]}
    affected = [r for r in heads(state, "findings", case_id)
                if any(v["sourceId"] == left_id for v in r["sourceReferences"] + r["answerReferences"]) or
                any(v["sourceId"] == left_id for subject_id in r["subjectIds"]
                    for v in subjects.get(subject_id, {}).get("sourceReferences", []))]
    fields = ("title", "role", "issuer", "jurisdiction", "sourceUri", "publishedDate", "effectiveDate",
              "retrievedAt", "coordinateReference", "edition", "notes", "documentScope", "coverageNotes",
              "publisherUpdatedAt", "queryDescription", "file")
    result = {"schema": SCHEMA, "caseId": case_id, "caseVersionId": case["id"],
        "leftSourceId": left_id, "rightSourceId": right_id,
        "sameOriginalBytes": left["file"]["sha256"] == right["file"]["sha256"],
        "changes": {key: {"earlier": left.get(key), "later": right.get(key)}
                    for key in fields if left.get(key) != right.get(key)},
        "affectedFindings": [{"id": r["id"], "findingId": r["findingId"], "title": r["title"],
                             "classification": r["classification"], "status": r["status"]} for r in affected],
        "affectedSubjects": [s["id"] for s in case["subjects"] if any(
            r["sourceId"] == left_id for r in s["sourceReferences"])],
        "meaning": "Byte equality and changed metadata are source observations. Applicability and semantic equivalence require named review."}
    result["comparisonSha256"] = value_sha(result)
    return result

def inspect_file(path):
    path = Path(path).expanduser().absolute()
    require(path.is_file() and not path.is_symlink(), "EVIDENCE_SOURCE_FILE", "Choose the complete original source file.")
    result = file_digest(path)
    require(0 < result["bytes"] <= MAX_SOURCE, "EVIDENCE_SOURCE_SIZE", "Use a nonempty complete source up to 128 MiB.")
    return {"file": str(path), "filename": path.name, **result}

def save_source(workspace, payload, common):
    exact(payload, ("file", "bytes", "sha256", "definition"), ("file", "bytes", "sha256", "definition"))
    replay = workspace.operation(common["request_id"], "evidence.source.save", payload)
    if replay is not None:
        return replay
    require(type(payload["bytes"]) is int and 0 < payload["bytes"] <= MAX_SOURCE and
            isinstance(payload["sha256"], str) and HASH.fullmatch(payload["sha256"]),
            "EVIDENCE_SOURCE_IDENTITY", "Inspect and retain the complete original file identity.")
    original = Path(payload["file"]).expanduser().absolute()
    inspected = inspect_file(original)
    require(inspected["bytes"] == payload["bytes"] and inspected["sha256"] == payload["sha256"],
            "EVIDENCE_SOURCE_CHANGED", "The original source differs from the inspected bytes.")
    file = retain_copy(original, workspace.root, "evidence/files/" + payload["sha256"],
                       {"path": original.name, "bytes": payload["bytes"], "sha256": payload["sha256"]})
    definition = payload["definition"]
    exact(definition, ("title", "seriesKey", "edition", "role", "issuer", "jurisdiction", "sourceUri",
        "publishedDate", "effectiveDate", "retrievedAt", "mediaType", "coordinateReference", "notes", "previousId",
        "documentScope", "coverageNotes", "publisherUpdatedAt", "queryDescription"),
        ("title", "seriesKey", "edition", "role", "issuer", "jurisdiction", "sourceUri", "retrievedAt", "mediaType"))
    def update(state):
        previous = get(state, "sources", definition["previousId"]) if definition.get("previousId") else None
        series = text(definition["seriesKey"], "Original source series", 240)
        require(previous is None or previous["seriesKey"] == series and previous["role"] == definition["role"] and previous["issuer"] == text(definition["issuer"], "Original issuer", 500), "EVIDENCE_SUCCESSOR", "Keep the original source series when recording its next edition.")
        require(definition["role"] in ROLES, "EVIDENCE_SOURCE_ROLE", "Select the actual source role.")
        uri = text(definition["sourceUri"], "Original source URI", 8000)
        require(re.match(r"^(https?://|urn:)", uri), "EVIDENCE_SOURCE_URI", "Record the original public URL or explicit original-source URN.")
        row = put(state, "sources", {"title": text(definition["title"], "Source title", 500),
            "seriesKey": series, "edition": text(definition["edition"], "Issuer edition or explicit unknown", 500),
            "role": definition["role"], "issuer": text(definition["issuer"], "Original issuer", 500),
            "jurisdiction": text(definition["jurisdiction"], "Original jurisdiction", 500),
            "sourceUri": uri, "publishedDate": date(definition.get("publishedDate"), "Publication date"),
            "effectiveDate": date(definition.get("effectiveDate"), "Effective date"),
            "retrievedAt": stamp(definition["retrievedAt"], "Original retrieval time"),
            "mediaType": text(definition["mediaType"], "Original media type", 240),
            "coordinateReference": text(definition.get("coordinateReference", ""), "Original coordinate reference", 1000, False),
            "notes": text(definition.get("notes", ""), "Source context and limitations", 12000, False),
            "documentScope": text(definition.get("documentScope", ""), "Full document or excerpt scope", 8000, False),
            "coverageNotes": text(definition.get("coverageNotes", ""), "Selected source coverage and omissions", 8000, False),
            "queryDescription": text(definition.get("queryDescription", ""), "Original query selection and paging", 8000, False),
            "publisherUpdatedAt": stamp(definition["publisherUpdatedAt"], "Publisher update timestamp") if definition.get("publisherUpdatedAt") else None,
            "previousId": previous["id"] if previous else None, "file": file,
            "filename": original.name, "createdAt": utc_now(), "actor": common["actor"]})
        return {"sourceId": row["id"], "source": row}
    return workspace._mutate(action="evidence.source.save", payload=payload, update=update, **common)

def save_case(workspace, payload, common):
    exact(payload, ("caseId", "previousId", "definition"), ("definition",))
    def update(state):
        previous = current(state, "cases", payload["caseId"]) if payload.get("caseId") else None
        require((payload.get("previousId") or None) == (previous["id"] if previous else None),
                "EVIDENCE_CASE_CHANGED", "Keep the original case edition while preparing its successor.")
        logical = previous["caseId"] if previous else "case-" + value_sha({"workspace":state["id"],"request":common["request_id"]})
        row = put(state, "cases", {**normalize_case(workspace, state, payload["definition"], previous, logical),
                    "createdAt": utc_now(), "actor": common["actor"]})
        return {"caseId": logical, "caseVersionId": row["id"], "case": row}
    return workspace._mutate(action="evidence.case.save", payload=payload, update=update, **common)

def save_finding(workspace, payload, common):
    exact(payload, ("caseId", "caseVersionId", "findingId", "previousId", "definition"),
          ("caseId", "caseVersionId", "definition"))
    def update(state):
        case = current(state, "cases", payload["caseId"])
        require(case["id"] == payload["caseVersionId"], "EVIDENCE_CASE_CHANGED", "Review the current exact case edition before saving.")
        previous = current(state, "findings", payload["findingId"]) if payload.get("findingId") else None
        require((payload.get("previousId") or None) == (previous["id"] if previous else None) and
                (previous is None or previous["caseId"] == case["caseId"]),
                "EVIDENCE_FINDING_CHANGED", "Keep the original finding's current edition.")
        logical = previous["findingId"] if previous else "finding-" + value_sha({"workspace":state["id"],"request":common["request_id"]})
        row = put(state, "findings", {**normalize_finding(state, payload["definition"], case, previous, logical),
                  "createdAt": utc_now(), "actor": common["actor"]})
        return {"caseId": case["caseId"], "findingId": logical, "findingVersionId": row["id"], "finding": row}
    return workspace._mutate(action="evidence.finding.save", payload=payload, update=update, **common)

def save_succession(workspace, payload, common):
    exact(payload, ("caseId", "leftSourceId", "rightSourceId", "comparisonSha256", "decisions", "note"),
          ("caseId", "leftSourceId", "rightSourceId", "comparisonSha256", "decisions", "note"))
    def update(state):
        compared = compare(state, payload["caseId"], payload["leftSourceId"], payload["rightSourceId"])
        require(compared["comparisonSha256"] == payload["comparisonSha256"], "EVIDENCE_COMPARISON_CHANGED",
                "Reinspect the complete current source/finding comparison before applying decisions.")
        case = current(state, "cases", payload["caseId"])
        decisions = payload["decisions"]
        expected = {v["id"] for v in compared["affectedFindings"]}
        require(isinstance(decisions, list) and len(decisions) == len(expected) and
                {v.get("findingVersionId") for v in decisions} == expected,
                "EVIDENCE_COMPLETE_REVIEW", "Retain one explicit decision for every affected current finding.")
        output = []
        for decision in decisions:
            exact(decision, ("findingVersionId", "decision", "reason", "replacement"),
                  ("findingVersionId", "decision", "reason"))
            require(decision["decision"] in ("KEEP_EARLIER", "REVIEW_REQUIRED", "ADOPT_LATER", "WITHDRAW"),
                    "EVIDENCE_SUCCESSOR_DECISION", "Choose the explicit treatment of each affected finding.")
            previous = get(state, "findings", decision["findingVersionId"])
            value = {"findingVersionId": previous["id"], "decision": decision["decision"],
                     "reason": text(decision["reason"], "Source succession decision reason", 8000)}
            if decision["decision"] in ("ADOPT_LATER", "WITHDRAW"):
                require(isinstance(decision.get("replacement"), dict), "EVIDENCE_REPLACEMENT",
                        "Review the complete replacement finding before adopting the later source or withdrawing.")
                body = normalize_finding(state, decision["replacement"], case, previous, previous["findingId"])
                if decision["decision"] == "ADOPT_LATER":
                    require(any(r["sourceId"] == payload["rightSourceId"] for r in body["sourceReferences"]),
                            "EVIDENCE_REPLACEMENT", "The adopted finding must cite the exact later source and locator.")
                else:
                    require(body["status"] == "WITHDRAWN", "EVIDENCE_REPLACEMENT", "The withdrawn successor must retain WITHDRAWN status and its reason.")
                changed = put(state, "findings", {**body, "createdAt": utc_now(), "actor": common["actor"]})
                value["replacementId"] = changed["id"]
            else:
                require("replacement" not in decision, "EVIDENCE_REPLACEMENT", "A retained earlier finding keeps its original body.")
            output.append(value)
        row = put(state, "successions", {"caseId": case["caseId"], "caseVersionId": case["id"],
                    "comparison": compared, "decisions": output, "note": text(payload["note"], "Complete succession review", 12000),
                    "createdAt": utc_now(), "actor": common["actor"]})
        return {"caseId": case["caseId"], "successionId": row["id"], "succession": row}
    return workspace._mutate(action="evidence.succession.save", payload=payload, update=update, **common)


def finding_review(state, case, findings):
    """Derived review context never rewrites the originally named finding."""
    sources = data(state)["sources"]
    positions = {r["id"]:i for i,r in enumerate(sources)}
    series = {}
    for row in sources:
        series.setdefault((row["seriesKey"],row["role"],row["issuer"]),[]).append(row)
    subjects = {s["id"]:s for s in case["subjects"]}
    output = []
    for finding in findings:
        reasons, decisions = [], []
        if finding["caseVersionId"] != case["id"]:
            reasons.append("CASE_EDITION_CHANGED")
        cited = {r["sourceId"] for r in finding["sourceReferences"] + finding["answerReferences"]}
        for subject_id in finding["subjectIds"]:
            cited.update(r["sourceId"] for r in subjects.get(subject_id, {}).get("sourceReferences", []))
        for left_id in sorted(cited):
            left = get(state, "sources", left_id)
            later = [r for r in series[(left["seriesKey"],left["role"],left["issuer"])] if positions[r["id"]] > positions[left_id]]
            for right in later:
                matches = []
                for succession in data(state)["successions"]:
                    comparison = succession["comparison"]
                    if succession["caseId"] != case["caseId"] or comparison["leftSourceId"] != left_id or comparison["rightSourceId"] != right["id"]:
                        continue
                    matches.extend(d for d in succession["decisions"] if d["findingVersionId"] == finding["id"])
                decision = matches[-1] if matches else None
                decisions.append({"leftSourceId":left_id,"rightSourceId":right["id"],"decision":copy.deepcopy(decision)})
                if decision is None or decision["decision"] == "REVIEW_REQUIRED":
                    reasons.append("SOURCE_SUCCESSOR_REQUIRES_REVIEW")
        output.append({"findingVersionId":finding["id"],"findingId":finding["findingId"],
                       "state":"REVIEW_REQUIRED" if reasons else "CURRENT_RECORDED_REVIEW",
                       "reasons":list(dict.fromkeys(reasons)), "sourceDecisions":decisions})
    return output

def case_snapshot(state, case_id):
    case = current(state, "cases", case_id)
    history = {kind: [copy.deepcopy(r) for r in data(state)[kind] if r.get("caseId") == case_id]
               for kind in ("cases", "findings", "successions", "observations")}
    source_ids = set()
    for row in history["cases"]:
        source_ids.update(v["sourceId"] for v in row["sourceReferences"])
        for subject in row["subjects"]:
            source_ids.update(v["sourceId"] for v in subject["sourceReferences"])
    for row in history["findings"]:
        source_ids.update(v["sourceId"] for v in row["sourceReferences"] + row["answerReferences"])
    for row in history["successions"]:
        source_ids.update((row["comparison"]["leftSourceId"], row["comparison"]["rightSourceId"]))
    # Include complete declared source lineage, even when an earlier edition is only indirectly cited.
    queue = list(source_ids)
    while queue:
        source = get(state, "sources", queue.pop())
        if source["previousId"] and source["previousId"] not in source_ids:
            source_ids.add(source["previousId"]); queue.append(source["previousId"])
    return {"schema": SCHEMA, "workspaceId": state["id"], "revision": state["revision"],
            "case": copy.deepcopy(case), "currentFindings": copy.deepcopy(heads(state, "findings", case_id)),
            "history": history, "observations": copy.deepcopy(history["observations"]),
            "findingReview": finding_review(state, case, heads(state, "findings", case_id)),
            "sources": [copy.deepcopy(r) for r in data(state)["sources"] if r["id"] in source_ids]}

def csv_bytes(columns, rows):
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(columns)
    for row in rows:
        # Keep the original value explicit while preventing spreadsheet formula interpretation.
        cells = [str(row.get(key, "")) if row.get(key) is not None else "" for key in columns]
        writer.writerow(["'" + v if v.startswith(("=", "+", "-", "@", "\t", "\r")) else v for v in cells])
    return output.getvalue().encode("utf-8")

def report_files(workspace, snapshot, title, interpretation):
    rows = []
    reviews = {r["findingVersionId"]:r for r in snapshot.get("findingReview", [])}
    for row in snapshot["currentFindings"]:
        refs_text = "\n".join(r["sourceId"] + " · " + r["locator"] +
                    (" · PDF index " + str(r["sourcePageIndex0"]) if "sourcePageIndex0" in r else "") +
                    (" · printed " + r["printedPage"] if r.get("printedPage") else "") +
                    (" · section " + r["section"] if r.get("section") else "") for r in row["sourceReferences"])
        answer_text = "\n".join(r["sourceId"] + " · " + r["locator"] for r in row["answerReferences"])
        rows.append({**row, "subjectIds": "; ".join(row["subjectIds"]), "sourceReferences": refs_text,
                     "answerReferences": answer_text, "sourceReviewState": reviews.get(row["id"], {}).get("state", "REVIEW_REQUIRED")})
    columns = ("findingId", "title", "classification", "status", "sourceReviewState", "statement", "applicability", "assumptions",
               "subjectIds", "sourceReferences", "reviewer", "reviewedAt", "nextAction", "responsibleRole", "dueDate", "answer", "answerReferences")
    require(sum(source["file"]["bytes"] for source in snapshot["sources"]) <= 512 * 1024 * 1024,
            "EVIDENCE_REPORT_SIZE", "Use the complete native workspace handover for a source set larger than 512 MiB.")
    report = {"schema":SCHEMA,"title":title,"interpretation":interpretation,"workspaceId":snapshot["workspaceId"],
              "caseId":snapshot["case"]["caseId"],"caseVersionId":snapshot["case"]["id"],
              "sourceRevision":snapshot["revision"],"snapshotSha256":value_sha(snapshot)}
    files = {"case.json": json_bytes(snapshot), "report.json":json_bytes(report), "findings.csv": csv_bytes(columns, rows),
             "actions.csv": csv_bytes(("findingId", "classification", "status", "sourceReviewState", "nextAction", "responsibleRole", "dueDate"), rows),
             "observations.json":json_bytes(snapshot.get("observations", []))}
    for source in snapshot["sources"]:
        path = member(workspace.root, source["file"]["path"])
        file_digest(path, expected=source["file"])
        files["sources/" + source["id"] + "/" + re.sub(r"[^A-Za-z0-9._-]", "_", source["filename"])] = path.read_bytes()
    from .parcel_evidence_reports import map_members, render_report
    files.update(map_members(workspace.root, snapshot))
    files["OPEN.html"] = render_report(snapshot, title, interpretation, files)
    files["manifest.json"] = json_bytes({"schema": SCHEMA, "workspaceId": snapshot["workspaceId"],
        "caseId": snapshot["case"]["caseId"], "caseVersionId": snapshot["case"]["id"], "revision": snapshot["revision"],
        "files":[{"path":name,"bytes":len(body),"sha256":sha_bytes(body)} for name,body in sorted(files.items())]})
    return files

def build_report(workspace, payload, common):
    exact(payload, ("caseId", "caseVersionId", "title", "interpretation", "mapRequestIds"),
          ("caseId", "caseVersionId", "title", "interpretation"))
    replay = workspace.operation(common["request_id"], "evidence.report.build", payload)
    if replay is not None:
        return replay
    state = workspace.read()
    require(state["revision"] == common["revision"], "REVISION_CHANGED", "Refresh the exact original project revision.")
    snapshot = case_snapshot(state, payload["caseId"])
    from .parcel_evidence_reports import selected_map_views
    snapshot["mapViews"] = selected_map_views(workspace.root, snapshot, workspace.snapshot().get("analystRequests", []), payload.get("mapRequestIds", []))
    require(snapshot["case"]["id"] == payload["caseVersionId"], "EVIDENCE_CASE_CHANGED", "Review the current exact case before freezing its report.")
    title = text(payload["title"], "Report title", 500)
    interpretation = text(payload["interpretation"], "Full report interpretation and remaining questions", 16000)
    files = report_files(workspace, snapshot, title, interpretation)
    # Content-derived records make a lost post-build database commit recoverable.
    identity = value_sha({"payload": payload, "snapshot": snapshot})
    prefix = "evidence/reports/" + identity
    retained = [retain_bytes(workspace.root, prefix + "/" + name, body) for name, body in sorted(files.items())]
    archive_name = prefix + "/complete-report.zip"
    archive_path = member(workspace.root, archive_name, existing=False)
    if archive_path.exists():
        with zipfile.ZipFile(archive_path) as archive:
            require(set(archive.namelist()) == set(files) and len(archive.namelist()) == len(files),
                    "EVIDENCE_REPORT_CHANGED", "The original report archive membership changed.")
            for name, body in files.items():
                require(archive.read(name) == body, "EVIDENCE_REPORT_CHANGED", "The original report archive member changed.", path=name)
        zip_record = {"path": archive_name, **file_digest(archive_path)}
    else:
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for name, body in sorted(files.items()):
                info = zipfile.ZipInfo(name, (1980,1,1,0,0,0)); info.external_attr = 0o100600 << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, body)
        zip_record = retain_bytes(workspace.root, archive_name, stream.getvalue())
    def update(current_state):
        require(case_snapshot(current_state, payload["caseId"]) == {k:v for k,v in snapshot.items() if k != "mapViews"},
                "EVIDENCE_REPORT_CHANGED", "The original case changed during report generation.")
        row = put(current_state, "reports", {"caseId": payload["caseId"], "caseVersionId": payload["caseVersionId"],
                "title": title, "interpretation": interpretation, "sourceRevision": snapshot["revision"],
                "snapshotSha256": value_sha(snapshot), "files": retained, "archive": zip_record,
                "createdAt": utc_now(), "actor": common["actor"]})
        return {"caseId": payload["caseId"], "reportId": row["id"], "report": row}
    return workspace._mutate(action="evidence.report.build", payload=payload, update=update, **common)

def validate_evidence(state, records=None):
    value = data(state)
    require(isinstance(value, dict) and value.get("schema") == SCHEMA and set(value) == {"schema", *KINDS},
            "EVIDENCE_STATE", "Keep the complete original evidence state.")
    by_kind = {}
    for kind in KINDS:
        require(isinstance(value[kind], list), "EVIDENCE_STATE", "Keep every original evidence record.")
        found = {}
        for row in value[kind]:
            require(isinstance(row, dict) and row.get("schema") == SCHEMA and isinstance(row.get("id"),str) and
                    row["id"] == PREFIX[kind] + value_sha({k:v for k,v in row.items() if k != "id"}) and row["id"] not in found,
                    "EVIDENCE_IDENTITY", "An immutable evidence record is missing, repeated or changed.", kind=kind)
            require(isinstance(row.get("actor"), str) and bool(row["actor"].strip()), "EVIDENCE_ACTOR", "Keep the original named actor.")
            stamp(row["createdAt"], "Record time")
            found[row["id"]] = row
        by_kind[kind] = found
    source_ids = set(by_kind["sources"])
    def verify_refs(values):
        require(isinstance(values, list), "EVIDENCE_REFERENCE", "Keep original source references.")
        for ref in values:
            require(isinstance(ref, dict) and ref.get("sourceId") in source_ids and
                    ref.get("fileSha256") == by_kind["sources"][ref["sourceId"]]["file"]["sha256"],
                    "EVIDENCE_REFERENCE", "A cited original source or exact locator changed.")
        if values:
            require(refs(state, raw_refs(values)) == values, "EVIDENCE_REFERENCE", "Keep exact structured original source/page/section references.")
    visited = set()
    for source in value["sources"]:
        descriptor(source["file"])
        for key in ("title","seriesKey","edition","issuer","jurisdiction","sourceUri","mediaType"):
            text(source.get(key), "Original source " + key, 8000)
        date(source.get("publishedDate"), "Publication date"); date(source.get("effectiveDate"), "Effective date")
        stamp(source["retrievedAt"], "Original retrieval time")
        if source.get("publisherUpdatedAt"):
            stamp(source["publisherUpdatedAt"], "Publisher update time")
        require(source["file"]["path"] == "evidence/files/" + source["file"]["sha256"],
                "EVIDENCE_SOURCE_PATH", "Retain the original content-addressed source file.")
        require(source["role"] in ROLES and (source["previousId"] is None or source["previousId"] in visited and
                by_kind["sources"][source["previousId"]]["seriesKey"] == source["seriesKey"] and
                by_kind["sources"][source["previousId"]]["role"] == source["role"] and
                by_kind["sources"][source["previousId"]]["issuer"] == source["issuer"]),
                "EVIDENCE_SOURCE_LINEAGE", "Retain the complete ordered source lineage.")
        visited.add(source["id"])
    previous = {}
    for case in value["cases"]:
        require(case["previousId"] == previous.get(case["caseId"]), "EVIDENCE_CASE_LINEAGE", "Retain every case edition in order.")
        previous[case["caseId"]] = case["id"]; verify_refs(case["sourceReferences"])
        require(case["sourceReferences"] and isinstance(case.get("subjects"), list) and 1 <= len(case["subjects"]) <= 10000,
                "EVIDENCE_CASE", "Keep the complete original case sources and subjects.")
        require(len({s["id"] for s in case["subjects"]}) == len(case["subjects"]), "EVIDENCE_SUBJECT", "Keep distinct case subjects.")
        for subject in case["subjects"]:
            verify_refs(subject["sourceReferences"])
            require(subject["sourceReferences"] and subject["kind"] in ("PARCEL","STRUCTURE","PROPOSED_IMPROVEMENT","AREA"),
                    "EVIDENCE_SUBJECT", "Keep the original source-bound subject kind.")
            identity(subject["id"]); text(subject["identity"], "Original business subject identity", 2000)
            ref = subject.get("feature")
            if ref:
                require(ref["sourceId"] in source_ids and ref["sourceFileSha256"] == by_kind["sources"][ref["sourceId"]]["file"]["sha256"] and
                        ref["geometrySha256"] == value_sha(ref["geometry"]),
                        "EVIDENCE_FEATURE_IDENTITY", "Keep the exact original feature and geometry identity.")
            observed = subject.get("mapObservation")
            if observed:
                require(any(p["id"] == observed["projectId"] and p["file"] == observed["projectFile"] for p in state["projects"]),
                        "EVIDENCE_NATIVE_PROJECT", "Keep the original native map observation and project.")
    previous = {}
    for finding in value["findings"]:
        require(finding["previousId"] == previous.get(finding["findingId"]) and finding["caseVersionId"] in by_kind["cases"] and
                by_kind["cases"][finding["caseVersionId"]]["caseId"] == finding["caseId"] and finding["classification"] in CLASSES and
                finding["status"] in STATUSES, "EVIDENCE_FINDING_LINEAGE", "Retain each exact reviewed finding and original case edition.")
        previous[finding["findingId"]] = finding["id"]
        require(finding["sourceReferences"] and finding["subjectIds"] and len(set(finding["subjectIds"])) == len(finding["subjectIds"]),
                "EVIDENCE_FINDING", "Keep original named finding source and subject selections.")
        text(finding["reviewer"], "Named reviewer", 240); stamp(finding["reviewedAt"], "Review time")
        require(finding["status"] != "ANSWERED" or finding["classification"] in ("AGENCY_QUESTION","PROFESSIONAL_QUESTION") and
                finding["answer"].strip() and finding["answerReferences"], "EVIDENCE_ANSWER", "Keep the complete original answer and its source.")
        verify_refs(finding["sourceReferences"]); verify_refs(finding["answerReferences"])
        require(set(finding["subjectIds"]) <= {s["id"] for s in by_kind["cases"][finding["caseVersionId"]]["subjects"]},
                "EVIDENCE_SUBJECT", "Keep the finding's original subjects.")
    for succession in value["successions"]:
        comparison = succession["comparison"]
        require(comparison["comparisonSha256"] == value_sha({k:v for k,v in comparison.items() if k!="comparisonSha256"}) and
                comparison["leftSourceId"] in source_ids and comparison["rightSourceId"] in source_ids and
                succession["caseVersionId"] in by_kind["cases"] and
                by_kind["cases"][succession["caseVersionId"]]["caseId"] == succession["caseId"] and
                comparison["caseId"] == succession["caseId"] and comparison["caseVersionId"] == succession["caseVersionId"],
                "EVIDENCE_SUCCESSION", "Keep the complete original source comparison.")
        for decision in succession["decisions"]:
            require(decision["findingVersionId"] in by_kind["findings"] and
                    by_kind["findings"][decision["findingVersionId"]]["caseId"] == succession["caseId"] and
                    decision["decision"] in ("KEEP_EARLIER","REVIEW_REQUIRED","ADOPT_LATER","WITHDRAW") and
                    (not decision.get("replacementId") or decision["replacementId"] in by_kind["findings"] and
                     by_kind["findings"][decision["replacementId"]]["previousId"] == decision["findingVersionId"]),
                    "EVIDENCE_SUCCESSION", "Keep all original reviewed source decisions.")

    for observation in value["observations"]:
        require(observation["caseVersionId"] in by_kind["cases"] and
                by_kind["cases"][observation["caseVersionId"]]["caseId"] == observation["caseId"],
                "EVIDENCE_OBSERVATION", "Keep the native observation's exact original case edition.")
        subjects = {r["id"]:r for r in by_kind["cases"][observation["caseVersionId"]]["subjects"]}
        selected_ids = [observation["leftSubjectId"], observation["rightSubjectId"]]
        require(len(set(selected_ids)) == 2 and all(k in subjects and subjects[k].get("mapObservation") for k in selected_ids),
                "EVIDENCE_OBSERVATION", "Keep both distinct original source-bound native subjects.")
        crs = observation.get("measurementCrs")
        require(isinstance(crs, dict) and set(crs) == {"input","authorityId","wkt","units"},
                "EVIDENCE_OBSERVATION", "Retain the full original measurement CRS.")
        for key in ("input","wkt","units"):
            text(crs[key], "Original measurement CRS " + key, 32000)
        text(crs["authorityId"], "Measurement authority ID", 2000, False)
        text(observation["measurementMethod"], "Native measurement method", 8000)
        text(observation["purpose"], "Observation purpose and scope", 8000)
        result = observation.get("result")
        require(isinstance(result, dict) and isinstance(result.get("inputs"), list) and len(result["inputs"]) == 2,
                "EVIDENCE_OBSERVATION", "Retain both full original native inputs.")
        for item, selected_id in zip(result["inputs"], selected_ids):
            subject = subjects[selected_id]; observed = subject["mapObservation"]
            require(item.get("subjectId") == selected_id and item.get("kind") == subject["kind"] and
                    item.get("businessIdentity") == subject["identity"] and item.get("sourceReferences") == subject["sourceReferences"] and
                    item.get("mapObservation") == observed and item.get("nativeLayerId") == observed["nativeLayerId"] and
                    item.get("fields") == observed["fields"] and item.get("values") == observed["feature"]["values"],
                    "EVIDENCE_OBSERVATION_BINDING", "Keep the spatial result's exact original subject, business ID, source and native field binding.")
            for key in ("originalGeometryWkbSha256","transformedGeometryWkbSha256"):
                require(isinstance(item.get(key),str) and HASH.fullmatch(item[key]), "EVIDENCE_OBSERVATION_GEOMETRY", "Keep both exact native geometry identities.")
            text(item.get("originalCrsWkt"), "Original native CRS", 32000)
            require(isinstance(item.get("readback"),dict) and any(r.get("layerId") == observed["layer"]["id"] and
                    r.get("sourceId") == observed["layer"]["sourceId"] for r in item["readback"].get("layers",[])),
                    "EVIDENCE_OBSERVATION_BINDING", "Keep the original native map source readback.")
        for key in ("intersects","leftWithinRight","rightWithinLeft","touches","intersectionEmpty"):
            require(type(result.get(key)) is bool, "EVIDENCE_OBSERVATION", "Keep each actual native predicate.")
        require(not any(result[k] for k in ("leftWithinRight","rightWithinLeft","touches")) or result["intersects"],
                "EVIDENCE_OBSERVATION", "The native predicates contradict each other.")
        for key in ("intersectionArea","intersectionLength"):
            try:
                require(isinstance(result.get(key),str), "EVIDENCE_OBSERVATION", "Keep the original native numeric representation.")
                number = Decimal(result[key])
                require(number.is_finite() and number >= 0, "EVIDENCE_OBSERVATION", "Native measurements must be finite and nonnegative.")
            except InvalidOperation:
                require(False, "EVIDENCE_OBSERVATION", "Keep the original native numeric representation.")
        require(result.get("lengthUnit") == crs["units"] and result.get("areaUnit") == crs["units"]+" squared",
                "EVIDENCE_OBSERVATION_UNITS", "Keep the declared native projected measurement units.")
        digest = result.get("intersectionGeometryWkbSha256")
        require(digest is None and result["intersectionEmpty"] and result.get("intersectionGeometry") is None or
                isinstance(digest,str) and HASH.fullmatch(digest) and isinstance(result.get("intersectionGeometry"),dict),
                "EVIDENCE_OBSERVATION_GEOMETRY", "Keep the actual original intersection geometry and its native identity.")
        text(result.get("qgisVersion"), "Original QGIS version", 500)
        text(result.get("meaning"), "Measurement interpretation", 8000)
    for report in value["reports"]:
        require(report["caseVersionId"] in by_kind["cases"], "EVIDENCE_REPORT", "Keep the report's original case edition.")
    for record in evidence_file_refs({"state": state}):
        descriptor(record)
        if records is not None:
            require(record["path"] in records and all(record[k] == records[record["path"]][k] for k in ("bytes","sha256")),
                    "EVIDENCE_FILE_CLOSURE", "The complete handover is missing an original evidence file.", path=record["path"])
    return value


def validate_evidence_files(root, snapshot):
    """Close original file and completed-request bindings before export or DB publication."""
    root = Path(root)
    state = snapshot["state"]
    value = validate_evidence(state)
    from .analyst_state import validate_analyst_snapshot
    operations = {r["requestId"]:r for r in validate_analyst_snapshot(snapshot)}
    sources = {r["id"]:r for r in value["sources"]}
    parsed = {}
    def original(source):
        if source["id"] not in parsed:
            filename = member(root, source["file"]["path"])
            file_digest(filename, expected=source["file"])
            obj, raw = read_json(filename, limit=MAX_SOURCE)
            require(len(raw) == source["file"]["bytes"] and sha_bytes(raw) == source["file"]["sha256"],
                    "EVIDENCE_SOURCE_CHANGED", "The parsed original response changed during receiving.")
            parsed[source["id"]] = obj
        return parsed[source["id"]]
    for record in evidence_file_refs(snapshot):
        file_digest(member(root, record["path"]), expected=record)
    for case in value["cases"]:
        for subject in case["subjects"]:
            selected = subject.get("feature")
            if selected:
                source = sources[selected["sourceId"]]
                require(source["role"] == subject["kind"] or subject["kind"] == "AREA" and source["role"] in
                        ("PARCEL", "EFFECTIVE_FEMA", "PRELIMINARY_FEMA", "LOMC", "DNR_BEST_AVAILABLE", "SURVEY", "OTHER"),
                        "EVIDENCE_SOURCE_ROLE", "The retained subject source role changed.")
                expected = feature_from_object(source, original(source), selected["index"], selected["featureSha256"])
                field = selected["businessField"]
                require(field in expected["properties"] and expected["properties"][field] not in (None, "") and
                        not isinstance(expected["properties"][field], (dict,list,bool)), "EVIDENCE_BUSINESS_ID", "The retained original business field changed.")
                expected.update({"businessField":field,"businessValue":copy.deepcopy(expected["properties"][field])})
                require(expected == selected and any(r["sourceId"] == source["id"] for r in subject["sourceReferences"]),
                        "EVIDENCE_FEATURE_CLOSURE", "The complete selected feature, coverage or original business identity changed.")
            observed = subject.get("mapObservation")
            if observed:
                operation = operations.get(observed["requestId"])
                require(operation is not None, "EVIDENCE_NATIVE_CLOSURE", "The handover must retain the original completed native read.")
                expected = map_observation(root, state, operation, observed["feature"]["featureId"], observed["businessField"])
                require(expected == observed, "EVIDENCE_NATIVE_CLOSURE", "The saved native map/feature observation differs from its original completed request.")
                if selected:
                    require(str(selected["businessValue"]) == str(observed["businessValue"]),
                            "EVIDENCE_SUBJECT_BINDING", "The retained original source and native feature identify different subjects.")

    for observation in value["observations"]:
        original = [r for r in snapshot.get("requests",[]) if r.get("result",{}).get("event",{}).get("action") == "evidence.spatial" and
                    r.get("result",{}).get("observationId") == observation["id"]]
        require(len(original) == 1 and original[0]["result"]["observation"] == observation,
                "EVIDENCE_OBSERVATION_HISTORY", "Retain the exact original saved native spatial operation and complete result.")
    for report in value["reports"]:
        records = {r["path"]:r for r in report["files"]}
        require(len(records) == len(report["files"]) and report["archive"]["path"].endswith("/complete-report.zip"),
                "EVIDENCE_REPORT_CLOSURE", "Keep each complete original report member once.")
        prefix = report["archive"]["path"].rsplit("/",1)[0] + "/"
        require(all(name.startswith(prefix) for name in records), "EVIDENCE_REPORT_CLOSURE", "Keep report files in the original report directory.")
        relative = {name[len(prefix):]:r for name,r in records.items()}
        required = {"case.json","report.json","findings.csv","actions.csv","observations.json","map-views.json","OPEN.html","manifest.json"}
        require(required <= set(relative), "EVIDENCE_REPORT_CLOSURE", "The original report needs its complete interpretation, findings and native observations.")
        frozen, _ = read_json(member(root, prefix+"case.json"))
        metadata, _ = read_json(member(root, prefix+"report.json"))
        manifest, _ = read_json(member(root, prefix+"manifest.json"))
        observations, _ = read_json(member(root, prefix+"observations.json"))
        require(value_sha(frozen) == report["snapshotSha256"] and frozen["workspaceId"] == state["id"] and
                frozen["case"]["id"] == report["caseVersionId"] and frozen["case"]["caseId"] == report["caseId"] and
                frozen["revision"] == report["sourceRevision"], "EVIDENCE_REPORT_CLOSURE", "Keep the exact original report snapshot.")
        require(metadata == {"schema":SCHEMA,"title":report["title"],"interpretation":report["interpretation"],
                "workspaceId":state["id"],"caseId":report["caseId"],"caseVersionId":report["caseVersionId"],
                "sourceRevision":report["sourceRevision"],"snapshotSha256":report["snapshotSha256"]},
                "EVIDENCE_REPORT_CLOSURE", "The original report interpretation or selected case changed.")
        require(observations == frozen.get("observations",[]) and observations == frozen["history"]["observations"],
                "EVIDENCE_REPORT_CLOSURE", "Keep all original frozen native observations.")
        require(frozen["case"] in value["cases"] and
                all(row in value[kind] for kind in ("cases","findings","successions","observations") for row in frozen["history"][kind]) and
                all(row in value["findings"] for row in frozen["currentFindings"]),
                "EVIDENCE_REPORT_CLOSURE", "Keep the frozen original case and named review history.")
        expected_sources = set()
        for source in frozen["sources"]:
            require(source == sources.get(source["id"]), "EVIDENCE_REPORT_CLOSURE", "A frozen source edition changed.")
            name = "sources/" + source["id"] + "/" + re.sub(r"[^A-Za-z0-9._-]", "_", source["filename"])
            expected_sources.add(name)
            require(name in relative and all(relative[name][k] == source["file"][k] for k in ("bytes","sha256")),
                    "EVIDENCE_REPORT_CLOSURE", "The report omitted or changed an original cited source.")
        from .parcel_evidence_reports import validate_report_views
        map_files = validate_report_views(root, frozen, list(operations.values()))
        for name, body in map_files.items():
            require(name in relative and relative[name]["bytes"] == len(body) and relative[name]["sha256"] == sha_bytes(body),
                    "EVIDENCE_REPORT_MAP", "The report changed an original selected map view.", path=name)
        require(set(relative) == required | expected_sources | set(map_files),
                "EVIDENCE_REPORT_CLOSURE", "The full report source inventory changed.")
        require(manifest == {"schema":SCHEMA,"workspaceId":state["id"],"caseId":report["caseId"],"caseVersionId":report["caseVersionId"],
                "revision":report["sourceRevision"],"files":[{"path":name,"bytes":relative[name]["bytes"],"sha256":relative[name]["sha256"]}
                for name in sorted(relative) if name!="manifest.json"]}, "EVIDENCE_REPORT_CLOSURE", "The report manifest differs from its original member inventory.")
        with zipfile.ZipFile(member(root, report["archive"]["path"])) as archive:
            require(set(archive.namelist()) == set(relative) and len(archive.namelist()) == len(relative),
                    "EVIDENCE_REPORT_CLOSURE", "The original report archive membership changed.")
            for name, record in relative.items():
                info = archive.getinfo(name)
                require(not info.is_dir() and info.file_size == record["bytes"] and sha_bytes(archive.read(name)) == record["sha256"],
                        "EVIDENCE_REPORT_CLOSURE", "An original report archive member changed.", path=name)
    return value

def evidence_file_refs(snapshot):
    value = data(snapshot["state"])
    files = [row["file"] for row in value["sources"]]
    for report in value["reports"]:
        files.extend(report["files"]); files.append(report["archive"])
    result = {}
    for record in files:
        record = descriptor(record)
        require(record["path"] not in result or result[record["path"]] == record,
                "EVIDENCE_FILE_CONFLICT", "An evidence path has two different source identities.")
        result[record["path"]] = record
    return list(result.values())
