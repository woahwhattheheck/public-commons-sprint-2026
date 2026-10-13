"""Source-bound highway field work, supervisor decisions and proposed ArcGIS edits.

Pure standard-library business domain. The caller owns storage, compare-and-swap,
request replay, actors, time and original byte blobs. This module performs no I/O
other than the supplied read_blob function and never calls an ArcGIS service.
"""
from __future__ import annotations
import copy
import datetime as dt
import hashlib
import json
import math
import re
import uuid
from typing import Callable, Any

SCHEMA = "geocove.highway-workspace.v1"
CAPTURE_SCHEMA = "geocove.arcgis-capture.v1"

class DomainError(ValueError):
    def __init__(self, code: str, message: str, details: Any = None):
        super().__init__(message)
        self.code, self.details = code, details

def canonical(value):
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True,
                          separators=(",", ":"), allow_nan=False)
    except (ValueError, TypeError) as exc:
        raise DomainError("invalid_json", "Values must be finite JSON.") from exc

def digest(value):
    raw = value if isinstance(value, bytes) else canonical(value).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()

def _need(ok, code, message, details=None):
    if not ok:
        raise DomainError(code, message, details)

def _text(value, label, maximum=10000, empty=False):
    _need(isinstance(value, str) and len(value) <= maximum
          and (empty or bool(value.strip())) and "\x00" not in value,
          "invalid_text", label + " is missing or invalid.")
    return value

def _id(value, label="ID"):
    _text(value, label, 180)
    _need(bool(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:@-]*", value)),
          "invalid_id", label + " must be a stable plain identifier.")
    return value

def _integer(value, label, minimum=0, maximum=9007199254740991):
    _need(type(value) is int and minimum <= value <= maximum,
          "invalid_integer", label + " is outside its supported integer range.")
    return value

def _time(value, label="Timestamp"):
    _text(value, label, 80)
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise DomainError("invalid_time", label + " must be an ISO timestamp.") from exc
    _need(parsed.tzinfo is not None and parsed.utcoffset() is not None,
          "invalid_time", label + " must include its time zone.")
    return parsed

def _actor(value):
    _need(isinstance(value, dict), "invalid_actor", "Supply the operating person.")
    return {"id": _id(value.get("id"), "Actor ID"),
            "name": _text(value.get("name"), "Actor name", 200)}

def _same(a, b):
    # JSON numbers can cross the browser as 1 instead of 1.0; preserve the
    # original value when they are numerically equal, keeping booleans distinct.
    if type(a) in (int,float) and type(b) in (int,float):
        return a == b
    if isinstance(a,dict) and isinstance(b,dict):
        return a.keys() == b.keys() and all(_same(a[k],b[k]) for k in a)
    if isinstance(a,list) and isinstance(b,list):
        return len(a)==len(b) and all(_same(x,y) for x,y in zip(a,b))
    return type(a) is type(b) and a == b

def _seal(value):
    result = copy.deepcopy(value)
    result["sha256"] = digest(result)
    return result

def _check_seal(value, label):
    _need(isinstance(value, dict) and isinstance(value.get("sha256"), str),
          "invalid_seal", label + " has no saved identity.")
    raw = {k: v for k, v in value.items() if k != "sha256"}
    _need(value["sha256"] == digest(raw), "changed_record",
          label + " differs from its saved identity.")

def new_state(workspace_id, title, created_at):
    _time(created_at)
    return {"schema": SCHEMA, "id": _id(workspace_id),
            "title": _text(title, "Workspace title", 300), "createdAt": created_at,
            "updatedAt": created_at, "captures": [], "activeCaptureId": None,
            "forms": [], "activeForms": {}, "inspections": [], "proposals": []}

class Source:
    """Resolve and validate complete original response bodies by their identity."""
    def __init__(self, read_blob):
        self.read_blob = read_blob
        self.raw_cache, self.json_cache, self.dataset_cache = {}, {}, {}

    def raw(self, descriptor):
        _need(isinstance(descriptor, dict), "invalid_descriptor",
              "A complete original-file descriptor is required.")
        sha = descriptor.get("sha256")
        _need(isinstance(sha, str) and bool(re.fullmatch("[0-9a-f]{64}", sha)),
              "invalid_descriptor", "The original file SHA-256 is invalid.")
        size = _integer(descriptor.get("bytes"), "Original file bytes")
        _text(descriptor.get("path"), "Original file path", 2000)
        _text(descriptor.get("mediaType"), "Original media type", 200)
        if sha not in self.raw_cache:
            raw = self.read_blob(sha)
            _need(isinstance(raw, bytes), "missing_source",
                  "The original byte resolver must return bytes.", {"sha256": sha})
            _need(len(raw) == size and digest(raw) == sha, "changed_source",
                  "Original bytes do not match the saved descriptor.", {"sha256": sha})
            self.raw_cache[sha] = raw
        raw = self.raw_cache[sha]
        _need(len(raw) == size, "changed_source", "A repeated source has a different size.")
        return raw

    def json(self, descriptor):
        sha = descriptor.get("sha256")
        if sha not in self.json_cache:
            try:
                value = json.loads(self.raw(descriptor).decode("utf-8-sig"),
                                   parse_constant=lambda x: (_ for _ in ()).throw(ValueError(x)))
            except (ValueError, UnicodeError) as exc:
                raise DomainError("invalid_source", "Original source is not finite JSON.",
                                  {"sha256": sha}) from exc
            _need(not (isinstance(value, dict) and "error" in value),
                  "source_error", "The original provider returned an error response.",
                  {"sha256": sha})
            self.json_cache[sha] = value
        return self.json_cache[sha]

    def dataset(self, capture, layer_id):
        key = (capture["id"], layer_id)
        if key in self.dataset_cache:
            return self.dataset_cache[key]
        manifest = capture["manifest"]
        entry = next((x for x in manifest["datasets"] if x["id"] == layer_id), None)
        _need(entry is not None, "unknown_dataset", "Dataset is not in this source edition.")
        metadata = self.json(entry["metadata"])
        final_metadata = self.json(entry["finalMetadata"])
        _need(isinstance(metadata, dict) and isinstance(metadata.get("fields"), list),
              "invalid_metadata", "Original layer field metadata is required.")
        _need(metadata.get("id", layer_id) == layer_id, "dataset_identity",
              "Layer metadata has a different original identity.")
        fields = metadata["fields"]
        _need(all(isinstance(f, dict) and isinstance(f.get("name"), str) for f in fields)
              and len({f["name"] for f in fields}) == len(fields),
              "invalid_metadata", "Original field names must be unique.")
        oid_field = metadata.get("objectIdField") or metadata.get("objectIdFieldName")
        if not oid_field:
            candidates = [f["name"] for f in fields if f.get("type")=="esriFieldTypeOID"]
            if len(candidates)==1:
                oid_field=candidates[0]
        _need(isinstance(oid_field, str) and any(f["name"] == oid_field for f in fields),
              "missing_object_id", "The original layer has no usable object ID field.")
        initial_ids = self.json(entry["idQuery"])
        final_ids = self.json(entry["finalIdQuery"])
        _need(isinstance(initial_ids, dict) and isinstance(initial_ids.get("objectIds"), list)
              and isinstance(final_ids, dict) and isinstance(final_ids.get("objectIds"), list),
              "invalid_ids", "Both complete original ID query responses are required.")
        for values in (initial_ids["objectIds"], final_ids["objectIds"]):
            for value in values:
                _integer(value, "Original object ID", 0)
            _need(len(values) == len(set(values)), "duplicate_ids",
                  "Original ID query contains duplicate identities.")
        for result in (initial_ids, final_ids):
            _need(result.get("objectIdFieldName", oid_field) == oid_field,
                  "object_id_field", "The ID query and field metadata disagree.")
        records = {}
        duplicates = []
        observed_limited = False
        for descriptor in entry["featurePages"]:
            page = self.json(descriptor)
            observed_limited = observed_limited or page.get("exceededTransferLimit") is True
            _need(isinstance(page, dict) and isinstance(page.get("features"), list),
                  "invalid_features", "A complete original feature page is required.")
            for feature in page["features"]:
                _need(isinstance(feature, dict) and isinstance(feature.get("attributes"), dict),
                      "invalid_feature", "Original feature attributes are missing.")
                oid = feature["attributes"].get(oid_field)
                _integer(oid, "Original feature object ID", 0)
                if oid in records:
                    duplicates.append(oid)
                else:
                    records[oid] = copy.deepcopy(feature)
        initial_set, received_set = set(initial_ids["objectIds"]), set(records)
        missing, unexpected = sorted(initial_set-received_set), sorted(received_set-initial_set)
        coverage = entry["coverage"]
        _need(coverage.get("initialObjectIds") == len(initial_set)
              and coverage.get("finalObjectIds") == len(final_ids["objectIds"])
              and coverage.get("capturedFeatures") == len(records)
              and sorted(coverage.get("missingObjectIds", [])) == missing
              and sorted(coverage.get("unexpectedObjectIds", [])) == unexpected
              and sorted(set(coverage.get("duplicateObjectIds", []))) == sorted(set(duplicates)),
              "coverage_mismatch", "Dataset coverage differs from the retained original pages.")
        attachments = {}
        for item in entry.get("attachments", []):
            parent = _integer(item.get("parentObjectId"), "Attachment parent ID", 0)
            info = item.get("info")
            _need(isinstance(info, dict), "invalid_attachment", "Original attachment information is missing.")
            aid = info.get("id")
            _integer(aid, "Original attachment ID", 0)
            bucket = attachments.setdefault(parent, [])
            _need(all(x["info"].get("id") != aid for x in bucket),
                  "duplicate_attachment", "Original attachment identity is duplicated.")
            _need(item.get("state") in ("CAPTURED", "UNAVAILABLE"),
                  "invalid_attachment", "Attachment source state is invalid.")
            if item["state"] == "CAPTURED":
                self.raw(item.get("content"))
            else:
                _need(item.get("content") is None, "invalid_attachment",
                      "Unavailable attachment must not contain invented bytes.")
            bucket.append(copy.deepcopy(item))
        manifest_parents=set()
        for item in entry.get("attachmentManifests", []):
            parent=_integer(item.get("parentObjectId"),"Attachment manifest parent",0)
            _need(parent not in manifest_parents and parent in records,
                  "attachment_parent","Original attachment manifest parent is duplicated or absent.")
            manifest_parents.add(parent)
            listing=self.json(item["descriptor"])
            observed_limited = observed_limited or listing.get("exceededTransferLimit") is True
            _need(isinstance(listing,dict) and isinstance(listing.get("attachmentInfos"),list),
                  "attachment_listing","Original attachment listing is incomplete.")
            originals=listing["attachmentInfos"]
            retained=attachments.get(parent,[])
            _need(len(originals)==len(retained) and
                  sorted((canonical(x) for x in originals)) ==
                  sorted((canonical(x["info"]) for x in retained)),
                  "attachment_listing","Retained attachment information differs from its original response.")
        _need(set(attachments)<=manifest_parents,"attachment_listing",
              "A retained attachment has no original listing.")
        if metadata.get("hasAttachments") is True:
            _need(manifest_parents==received_set & initial_set,"attachment_coverage",
                  "Original attachment listings are missing for a captured feature.")
        for parent,items in attachments.items():
            global_field=metadata.get("globalIdField")
            for item in items:
                _need(item.get("parentGlobalId")==(records[parent]["attributes"].get(global_field) if global_field else None),
                      "attachment_parent","Attachment global identity differs from its original feature.")
                if item["state"]=="CAPTURED":
                    _need(item["content"]["bytes"]==item["info"].get("size"),
                          "attachment_size","Attachment bytes differ from their original listed size.")
        unavailable=sum(x["state"]=="UNAVAILABLE" for values in attachments.values() for x in values)
        listed=sum(len(values) for values in attachments.values())
        _need(coverage.get("attachments")=={"listed":listed,"captured":listed-unavailable,"unavailable":unavailable},
              "attachment_coverage","Attachment coverage differs from the original listings and bytes.")
        initial_count=self.json(entry["countQuery"]).get("count")
        final_count=self.json(entry["finalCountQuery"]).get("count")
        _integer(initial_count,"Initial source count",0); _integer(final_count,"Final source count",0)
        _need(coverage.get("initialReportedCount")==initial_count and
              coverage.get("finalReportedCount")==final_count,"count_coverage",
              "Captured row counts differ from their original count responses.")
        limited=observed_limited
        complete=not(missing or unexpected or duplicates or unavailable or limited or
                     initial_count!=len(initial_ids["objectIds"]) or final_count!=len(final_ids["objectIds"]))
        changed=(sorted(initial_ids["objectIds"])!=sorted(final_ids["objectIds"]) or
                 canonical(metadata)!=canonical(final_metadata) or initial_count!=final_count or unavailable>0 or
                 initial_count!=len(initial_ids["objectIds"]) or final_count!=len(final_ids["objectIds"]))
        _need(coverage.get("complete") is complete and coverage.get("sourceChanged") is changed,
              "capture_observation","Source coverage and change observations differ from their retained responses.")
        result = {"entry": entry, "metadata": metadata, "finalMetadata": final_metadata,
                  "fields": {f["name"]: f for f in fields}, "objectIdField": oid_field,
                  "globalIdField": metadata.get("globalIdField") or None,
                  "records": records, "attachments": attachments,
                  "initialIds": initial_ids["objectIds"], "finalIds": final_ids["objectIds"]}
        self.dataset_cache[key] = result
        return result

def _capture(state, capture_id=None):
    cid = capture_id or state["activeCaptureId"]
    result = next((x for x in state["captures"] if x["id"] == cid), None)
    _need(result is not None, "unknown_capture", "Choose a retained source edition.")
    return result

def _form(state, form_id):
    result = next((x for x in state["forms"] if x["id"] == form_id), None)
    _need(result is not None, "unknown_form", "Choose a saved field form.")
    return result

def _inspection(state, inspection_id):
    result = next((x for x in state["inspections"] if x["id"] == inspection_id), None)
    _need(result is not None, "unknown_inspection", "Inspection does not exist.")
    return result

def _source_binding(state, source, capture_id, layer_id, object_id):
    capture = _capture(state, capture_id)
    dataset = source.dataset(capture, layer_id)
    feature = dataset["records"].get(object_id)
    _need(feature is not None, "missing_feature",
          "The actual source record is absent from this edition.", {"objectId": object_id})
    attachments = sorted(dataset["attachments"].get(object_id, []),
                         key=lambda x: x["info"]["id"])
    global_id = feature["attributes"].get(dataset["globalIdField"]) if dataset["globalIdField"] else None
    return {"captureId": capture["id"], "captureSha256": capture["manifest"]["sha256"],
            "serviceUrl": capture["manifest"]["service"]["url"],
            "serviceItemId": capture["manifest"]["service"].get("itemId"),
            "layerId": layer_id, "objectId": object_id, "objectIdField": dataset["objectIdField"],
            "globalIdField": dataset["globalIdField"], "globalId": global_id,
            "featureSha256": digest(feature), "attachmentSetSha256": digest(attachments),
            "feature": copy.deepcopy(feature), "attachments": copy.deepcopy(attachments)}, dataset

def _read_only(field, metadata):
    protected = {metadata.get("objectIdField"), metadata.get("globalIdField"),
                 metadata.get("typeIdField")}
    edit_info = metadata.get("editFieldsInfo") or {}
    protected.update(v for v in edit_info.values() if isinstance(v,str))
    return (field.get("editable") is False or field.get("type") in
            ("esriFieldTypeOID", "esriFieldTypeGlobalID", "esriFieldTypeGeometry",
             "esriFieldTypeBlob", "esriFieldTypeRaster") or field["name"] in protected - {metadata.get("typeIdField")})

def _numeric(value, label, integer=False, low=None, high=None):
    _need(type(value) in (int, float) and math.isfinite(value)
          and (not integer or type(value) is int), "invalid_number", label+" requires a finite "+("integer." if integer else "number."))
    _need(low is None or value >= low, "below_minimum", label+" is below its minimum.")
    _need(high is None or value <= high, "above_maximum", label+" exceeds its maximum.")
    return value

def _date(value, label, unknown_timezone=False):
    if type(value) is int:
        _need(-8640000000000000 <= value <= 8640000000000000, "invalid_date", label+" is outside the supported date range.")
        return value
    _need(not unknown_timezone, "unknown_timezone",
          label+" uses the source's unknown time zone; supply its original epoch-millisecond representation.")
    parsed = _time(value, label)
    return int(parsed.timestamp()*1000)

def _field_value(value, field, metadata):
    name, kind = field["name"], field["type"]
    if value is None:
        _need(field.get("nullable") is not False, "null_field", name+" cannot be null.")
        return None
    if kind in ("esriFieldTypeString", "esriFieldTypeXML"):
        _text(value, name, max(field.get("length") or 1000000, 1), empty=True)
        limit = field.get("length")
        _need(not limit or len(value.encode("utf-16-le"))//2 <= limit,
              "field_length", name+" exceeds its published text length.")
        return value
    ranges = {"esriFieldTypeSmallInteger":(-32768,32767),
              "esriFieldTypeInteger":(-2147483648,2147483647),
              "esriFieldTypeBigInteger":(-9007199254740991,9007199254740991),
              "esriFieldTypeOID":(0,9007199254740991)}
    if kind in ranges:
        if type(value) is float and math.isfinite(value) and value.is_integer():
            value = int(value)
        return _numeric(value, name, True, *ranges[kind])
    if kind in ("esriFieldTypeSingle", "esriFieldTypeDouble"):
        bound = 3.4028234663852886e38 if kind == "esriFieldTypeSingle" else 1.7976931348623157e308
        return _numeric(value, name, False, -bound, bound)
    if kind == "esriFieldTypeDate":
        return _date(value, name, metadata.get("datesInUnknownTimezone", metadata.get("datesInUnknownTimeZone", False)))
    if kind in ("esriFieldTypeGUID", "esriFieldTypeGlobalID"):
        _text(value, name, 40)
        try:
            uuid.UUID(value.strip("{}"))
        except ValueError as exc:
            raise DomainError("invalid_guid", name+" requires a complete GUID.") from exc
        return value
    if kind == "esriFieldTypeDateOnly":
        _text(value, name, 10)
        try:
            dt.date.fromisoformat(value)
        except ValueError as exc:
            raise DomainError("invalid_date", name+" requires YYYY-MM-DD.") from exc
        _need(bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", value)), "invalid_date", name+" requires YYYY-MM-DD.")
        return value
    if kind == "esriFieldTypeTimeOnly":
        _text(value, name, 32)
        try:
            parsed = dt.time.fromisoformat(value)
        except ValueError as exc:
            raise DomainError("invalid_time", name+" requires a local time.") from exc
        _need(parsed.tzinfo is None, "invalid_time", name+" is a time-only field.")
        return value
    if kind == "esriFieldTypeTimestampOffset":
        _time(value, name)
        return value
    raise DomainError("unsupported_field", name+" has an unsupported editable source type: "+str(kind))

def _domain_value(value, field, attributes, metadata):
    domain = field.get("domain")
    type_field = metadata.get("typeIdField")
    if type_field and metadata.get("types"):
        subtype = next((t for t in metadata["types"] if _same(t.get("id"), attributes.get(type_field))), None)
        _need(subtype is not None, "invalid_subtype", "The selected source subtype is not published by this layer.")
        domains = subtype.get("domains") or {}
        if field["name"] in domains:
            override = domains[field["name"]]
            if not (isinstance(override, dict) and override.get("type") == "inherited"):
                domain = override
    if value is None or domain is None:
        return
    _need(isinstance(domain, dict), "invalid_domain", "The original field domain is malformed.")
    if domain.get("type") == "codedValue":
        _need(any(_same(value, item.get("code")) for item in domain.get("codedValues", [])),
              "coded_value", field["name"]+" requires a published coded value.")
    elif domain.get("type") == "range":
        bounds = domain.get("range")
        _need(isinstance(bounds, list) and len(bounds) == 2,
              "invalid_domain", "The original range domain is malformed.")
        _numeric(value, field["name"], False, bounds[0], bounds[1])
    elif domain.get("type") not in (None, "inherited"):
        raise DomainError("unsupported_domain", "Unsupported source domain "+str(domain.get("type")))

def _geometry(value, metadata):
    if value is None:
        return None
    _need(isinstance(value, dict), "invalid_geometry", "Geometry must be an ArcGIS JSON object.")
    kind = metadata.get("geometryType")
    allowed = {"esriGeometryPoint":{"x","y","z","m","spatialReference"},
               "esriGeometryMultipoint":{"points","spatialReference"},
               "esriGeometryPolyline":{"paths","spatialReference"},
               "esriGeometryPolygon":{"rings","spatialReference"}}
    _need(kind in allowed and set(value) <= allowed[kind], "invalid_geometry",
          "Geometry does not match the original layer type.")
    expected_sr = metadata.get("sourceSpatialReference") or (metadata.get("extent") or {}).get("spatialReference")
    supplied_sr = value.get("spatialReference")
    if supplied_sr is not None and expected_sr is not None:
        aliases = lambda s: {s.get("wkid"), s.get("latestWkid")} - {None}
        _need(_same(supplied_sr, expected_sr) or bool(aliases(supplied_sr)&aliases(expected_sr)),
              "spatial_reference", "Geometry must use the original layer spatial reference.")
    dim = 2 + int(bool(metadata.get("hasZ"))) + int(bool(metadata.get("hasM")))
    def vertex(point):
        _need(isinstance(point, list) and len(point) == dim,
              "geometry_dimension", "Vertex dimensions differ from the original layer.")
        for coordinate in point:
            _numeric(coordinate, "Coordinate")
    if kind == "esriGeometryPoint":
        _need("x" in value and "y" in value, "invalid_geometry", "A point needs x and y.")
        for key in ("x","y","z","m"):
            if key in value:
                _numeric(value[key], "Point "+key)
        _need(("z" in value) == bool(metadata.get("hasZ")) and
              ("m" in value) == bool(metadata.get("hasM")),
              "geometry_dimension", "Point dimensions differ from the original layer.")
    elif kind == "esriGeometryMultipoint":
        _need(isinstance(value.get("points"), list) and bool(value["points"]),
              "invalid_geometry", "Multipoint needs its complete points.")
        for point in value["points"]:
            vertex(point)
    else:
        key = "paths" if kind == "esriGeometryPolyline" else "rings"
        _need(isinstance(value.get(key), list) and bool(value[key]),
              "invalid_geometry", "Geometry needs its complete "+key+".")
        for part in value[key]:
            _need(isinstance(part, list) and len(part) >= (2 if key=="paths" else 4),
                  "invalid_geometry", "Geometry part is too short.")
            for point in part:
                vertex(point)
            if key == "rings":
                _need(_same(part[0], part[-1]), "open_ring", "Polygon rings must be closed.")
    return copy.deepcopy(value)

def _validate_manifest(manifest, source):
    _need(isinstance(manifest, dict) and manifest.get("schema") == CAPTURE_SCHEMA,
          "capture_schema", "Choose a complete native ArcGIS capture manifest.")
    _check_seal(manifest, "Capture manifest")
    _id(manifest.get("id"), "Capture ID")
    _id(manifest.get("operationId"), "Capture operation ID")
    for key in ("createdAt", "startedAt", "completedAt"):
        _time(manifest.get(key), "Capture "+key)
    _need(_time(manifest["startedAt"]) <= _time(manifest["completedAt"]),
          "capture_time", "Capture completion precedes its start.")
    service = manifest.get("service")
    _need(isinstance(service, dict), "capture_service", "Original service metadata is required.")
    _text(service.get("url"), "Original service URL", 3000)
    _need(service["url"].startswith("https://"), "capture_service", "The original service must use HTTPS.")
    metadata = source.json(service["metadata"])
    final_metadata = source.json(service["finalMetadata"])
    _need(metadata.get("serviceItemId") == service.get("itemId"),
          "service_identity", "The service item identity differs from its original metadata.")
    files = manifest.get("files")
    _need(isinstance(files, list) and len(files) > 0,
          "capture_files", "The complete capture file set is required.")
    paths = set()
    for descriptor in files:
        path = descriptor.get("path") if isinstance(descriptor, dict) else None
        _need(isinstance(path, str) and not path.startswith("/") and "\\" not in path
              and ":" not in path and all(p not in ("", ".", "..") for p in path.split("/")),
              "unsafe_source_path", "Original file paths must be relative and unambiguous.")
        _need(path not in paths, "duplicate_source_path", "Capture paths must be unique.")
        paths.add(path)
        source.raw(descriptor)
    _need(manifest.get("bytes") == sum(f["bytes"] for f in files),
          "capture_size", "Capture byte count differs from its original file set.")
    datasets = manifest.get("datasets")
    _need(isinstance(datasets, list) and bool(datasets)
          and len({x.get("id") for x in datasets}) == len(datasets),
          "capture_datasets", "Select unique source layers or tables.")
    selection = manifest.get("selection")
    _need(isinstance(selection, dict) and isinstance(selection.get("layers"), list)
          and isinstance(selection.get("tables"), list), "capture_selection",
          "The original source selection is missing.")
    wanted = selection["layers"] + selection["tables"]
    _need(len(wanted) == len(set(wanted)) and set(wanted) == {x["id"] for x in datasets},
          "capture_selection", "The source selection differs from the captured datasets.")
    listed = {(f["sha256"], f["bytes"], f["path"]) for f in files}
    def listed_descriptor(value):
        if isinstance(value, dict):
            if {"sha256","bytes","mediaType","path"} <= set(value):
                _need((value["sha256"],value["bytes"],value["path"]) in listed,
                      "unlisted_source", "A captured source descriptor is absent from its file set.")
            else:
                for child in value.values():
                    listed_descriptor(child)
        elif isinstance(value, list):
            for child in value:
                listed_descriptor(child)
    listed_descriptor(service)
    listed_descriptor(datasets)
    capture = {"id": manifest["id"], "manifest": manifest}
    for dataset in datasets:
        _integer(dataset.get("id"), "Dataset ID", 0)
        _need(dataset.get("type") in ("layer","table"), "dataset_type", "Dataset type is invalid.")
        _need((dataset["id"] in selection["layers"]) == (dataset["type"] == "layer"),
              "dataset_type", "Layer/table selection disagrees with its type.")
        source.dataset(capture, dataset["id"])
    expected_coverage={"complete":all(d["coverage"]["complete"] for d in datasets),
                       "sourceChanged":canonical(metadata)!=canonical(final_metadata) or
                                       any(d["coverage"]["sourceChanged"] for d in datasets)}
    _need(manifest.get("coverage")==expected_coverage,"capture_coverage",
          "Service capture coverage differs from its original service and dataset responses.")
    return metadata

def _form_definition(state, body, source, actor, at):
    capture = _capture(state, body.get("captureId"))
    layer_id = _integer(body.get("layerId"), "Form dataset ID", 0)
    dataset = source.dataset(capture, layer_id)
    key, fid = _id(body.get("key"), "Form key"), _id(body.get("id"), "Form ID")
    _need(not any(f["id"] == fid for f in state["forms"]), "duplicate_form", "Form edition ID already exists.")
    previous = state["activeForms"].get(key)
    _need(body.get("previousFormId") == previous, "stale_form",
          "The active form edition changed. Reopen it before saving.")
    if previous:
        old = _form(state, previous)
        _need(old["layerId"] == layer_id and
              _capture(state, old["captureId"])["manifest"]["service"]["url"] == capture["manifest"]["service"]["url"],
              "form_source_identity", "A form key must keep its original service and dataset identity.")
    fields = body.get("fields")
    _need(isinstance(fields, list) and 0 < len(fields) <= 200, "form_fields",
          "A field form needs between one and 200 complete field definitions.")
    known, mapped, result = set(), set(), []
    supported = {"source","text","integer","number","boolean","date","choice"}
    allowed_keys = {"key","label","kind","sourceField","required","readOnly","choices",
                    "maxLength","minimum","maximum","help"}
    for field in fields:
        _need(isinstance(field, dict) and not(set(field)-allowed_keys),
              "form_field", "A form field contains unsupported properties.")
        fkey = _id(field.get("key"), "Field key")
        _need(fkey not in known, "duplicate_field", "Field keys must be unique.")
        known.add(fkey)
        kind = field.get("kind")
        _need(kind in supported, "field_kind", "Choose a supported form field kind.")
        for flag in ("required","readOnly"):
            _need(type(field.get(flag, False)) is bool, "field_flag", flag+" must be true or false.")
        source_name = field.get("sourceField")
        readonly = field.get("readOnly", False)
        if kind == "source":
            _need(source_name in dataset["fields"], "unknown_source_field",
                  "A mapped field is absent from the original dataset.", {"field": source_name})
            _need(source_name not in mapped, "duplicate_mapping",
                  "Map each original source field only once per form.")
            mapped.add(source_name)
            readonly = readonly or _read_only(dataset["fields"][source_name], dataset["metadata"])
        else:
            _need(source_name is None, "field_mapping", "Local form fields must not name a source column.")
        choices = field.get("choices", [])
        _need(isinstance(choices, list), "field_choices", "Choices must be a complete array.")
        codes = set()
        for choice in choices:
            _need(isinstance(choice, dict) and set(choice) == {"value","label"}
                  and (choice["value"] is None or type(choice["value"]) in (str,int,float,bool)),
                  "field_choice", "Each choice needs one primitive value and a label.")
            _text(choice["label"], "Choice label", 300)
            code = canonical(choice["value"])
            _need(code not in codes, "duplicate_choice", "Choice values must be unique.")
            codes.add(code)
        _need(kind != "choice" or bool(choices), "field_choices", "A choice field needs its choices.")
        maximum_length = field.get("maxLength")
        if maximum_length is not None:
            _integer(maximum_length, "Maximum text length", 1, 1000000)
        minimum, maximum = field.get("minimum"), field.get("maximum")
        for bound in (minimum, maximum):
            if bound is not None:
                _numeric(bound, "Field limit")
        _need(minimum is None or maximum is None or minimum <= maximum,
              "field_limits", "A field's minimum exceeds its maximum.")
        result.append({"key":fkey,"label":_text(field.get("label"),"Field label",300),
                       "kind":kind,"sourceField":source_name,"required":field.get("required",False),
                       "readOnly":readonly,"choices":copy.deepcopy(choices),
                       "maxLength":maximum_length,"minimum":minimum,"maximum":maximum,
                       "help":_text(field.get("help",""),"Field help",3000,empty=True)})
    attachment = body.get("attachments", {})
    _need(isinstance(attachment, dict), "attachment_policy", "Attachment options are required.")
    policy = {"enabled":attachment.get("enabled",True),"required":attachment.get("required",False),
              "maxFiles":attachment.get("maxFiles",20),"maxBytes":attachment.get("maxBytes",67108864),
              "allowedTypes":attachment.get("allowedTypes",[])}
    _need(type(policy["enabled"]) is bool and type(policy["required"]) is bool,
          "attachment_policy", "Attachment flags must be true or false.")
    _need(policy["enabled"] or not policy["required"], "attachment_policy",
          "Disabled attachments cannot be required.")
    _integer(policy["maxFiles"],"Maximum attachment count",1,1000)
    _integer(policy["maxBytes"],"Maximum attachment bytes",1,1073741824)
    _need(isinstance(policy["allowedTypes"],list) and
          all(isinstance(v,str) and bool(re.fullmatch(r"[a-zA-Z0-9.+-]+/(?:[a-zA-Z0-9.+-]+|\*)",v))
              for v in policy["allowedTypes"]), "attachment_policy", "Allowed attachment media types are invalid.")
    geometry_editable = body.get("geometryEditable", False)
    _need(type(geometry_editable) is bool, "geometry_policy", "Geometry option must be true or false.")
    _need(not geometry_editable or (dataset["metadata"].get("geometryType") and
                                   dataset["metadata"].get("allowGeometryUpdates") is not False),
          "geometry_policy", "The original source does not support this geometry proposal.")
    return _seal({"id":fid,"key":key,"previousFormId":previous,
                  "revision":1+(old["revision"] if previous else 0),
                  "title":_text(body.get("title"),"Form title",300),
                  "description":_text(body.get("description",""),"Form description",10000,empty=True),
                  "captureId":capture["id"],"layerId":layer_id,"fields":result,
                  "geometryEditable":geometry_editable,"attachments":policy,
                  "at":at,"actor":actor})

def _initial_answers(form, feature):
    attrs = feature["attributes"]
    return {f["key"]:copy.deepcopy(attrs.get(f["sourceField"])) if f["kind"]=="source" else None
            for f in form["fields"]}

def _answers(form, values, binding, dataset, final=False):
    _need(isinstance(values, dict), "answers", "Answers must be a complete field object.")
    known = {f["key"] for f in form["fields"]}
    _need(not(set(values)-known), "unknown_answer", "The answers include a field outside this form.")
    attrs = copy.deepcopy(binding["feature"]["attributes"])
    normalized = {}
    for field in form["fields"]:
        key, kind = field["key"], field["kind"]
        original = attrs.get(field["sourceField"]) if kind=="source" else None
        value = values.get(key, original)
        if final and field["required"]:
            _need(value is not None and not(isinstance(value,str) and not value.strip()),
                  "required_field", field["label"]+" is required.", {"fieldKey":key})
        if field["readOnly"]:
            _need(_same(value, original), "read_only_field",
                  field["label"]+" is retained from its original source.")
            normalized[key] = copy.deepcopy(original)
            continue
        if value is None:
            if final and kind=="source" and not _same(value, original):
                _field_value(value, dataset["fields"][field["sourceField"]], dataset["metadata"])
            normalized[key] = None
            if kind=="source":
                attrs[field["sourceField"]] = None
            continue
        if kind=="source":
            source_field = dataset["fields"].get(field["sourceField"])
            _need(source_field is not None, "changed_form_schema",
                  "A mapped source field disappeared; save and select a compatible form edition.")
            if _same(value, original):
                normalized[key] = copy.deepcopy(value)
                continue
            _need(not _read_only(source_field,dataset["metadata"]), "read_only_field",
                  field["label"]+" is read-only in the current source.")
            value = _field_value(value, source_field, dataset["metadata"])
            attrs[field["sourceField"]] = value
        elif kind=="text":
            _text(value,field["label"],field["maxLength"] or 1000000,empty=True)
        elif kind in ("integer","number"):
            value = _numeric(value,field["label"],kind=="integer",field["minimum"],field["maximum"])
        elif kind=="boolean":
            _need(type(value) is bool,"invalid_boolean",field["label"]+" requires true or false.")
        elif kind=="date":
            value = _date(value,field["label"])
        elif kind=="choice":
            _need(any(_same(value,c["value"]) for c in field["choices"]),
                  "invalid_choice",field["label"]+" requires one of its saved choices.")
        if field["maxLength"] is not None and isinstance(value,str):
            _need(len(value)<=field["maxLength"],"field_length",field["label"]+" is too long.")
        if type(value) in (int,float) and kind!="date":
            _numeric(value,field["label"],False,field["minimum"],field["maximum"])
        normalized[key] = copy.deepcopy(value)
    # Apply subtype domains only after the entire proposed attribute set is known.
    for field in form["fields"]:
        if field["kind"]=="source" and (
                not _same(normalized[field["key"]],binding["feature"]["attributes"].get(field["sourceField"])) or
                (dataset["metadata"].get("typeIdField") and
                 not _same(attrs.get(dataset["metadata"]["typeIdField"]),
                           binding["feature"]["attributes"].get(dataset["metadata"]["typeIdField"])))):
            _domain_value(normalized[field["key"]],dataset["fields"][field["sourceField"]],
                          attrs,dataset["metadata"])
    type_field=dataset["metadata"].get("typeIdField")
    if type_field and not _same(attrs.get(type_field),binding["feature"]["attributes"].get(type_field)):
        for name,source_field in dataset["fields"].items():
            if name in attrs:
                _domain_value(attrs[name],source_field,attrs,dataset["metadata"])
    return normalized

def _attachments(form, values, source, final=False):
    _need(isinstance(values,list),"attachments","Attachments must be a complete array.")
    policy=form["attachments"]
    _need(policy["enabled"] or not values,"attachments_disabled","This form does not accept added attachments.")
    _need(len(values)<=policy["maxFiles"],"attachment_count","This form's attachment count is exceeded.")
    if final and policy["required"]:
        _need(bool(values),"required_attachment","Add the required field attachment.")
    result, identities = [],set()
    for item in values:
        _need(isinstance(item,dict),"attachment","Attachment metadata is incomplete.")
        aid = _id(item.get("id"),"Local attachment ID")
        _need(aid not in identities,"duplicate_attachment","Local attachment IDs must be unique.")
        identities.add(aid)
        name = _text(item.get("name"),"Attachment filename",250)
        _need("/" not in name and "\\" not in name and name not in (".",".."),
              "attachment_name","Use an original filename without directory components.")
        media = _text(item.get("mediaType"),"Attachment media type",200)
        _need("\r" not in media and "\n" not in media,
              "attachment_media_type","Attachment media type contains a line break.")
        _need(not policy["allowedTypes"] or any(media==t or
              (t.endswith("/*") and media.startswith(t[:-1])) for t in policy["allowedTypes"]),
              "attachment_media_type","Attachment media type is outside the form's selected types.")
        size = _integer(item.get("bytes"),"Attachment bytes",0,policy["maxBytes"])
        desc = {"sha256":item.get("sha256"),"bytes":size,"mediaType":media,"path":"local/"+aid+"/"+name}
        source.raw(desc)
        result.append({"id":aid,"name":name,"mediaType":media,"bytes":size,"sha256":desc["sha256"]})
    return result

def _version(inspection):
    _need(inspection.get("versions"),"inspection_history","Inspection history is missing.")
    value = inspection["versions"][-1]
    _need(value["number"]==inspection["currentVersion"] and value["sha256"]==inspection["currentSha256"],
          "inspection_version","Inspection's current edition differs from its history.")
    return value

def _expected(inspection, value):
    _need(type(value) is int and value==inspection["currentVersion"],
          "stale_inspection","This inspection has a newer saved edition.",
          {"currentVersion":inspection["currentVersion"]})

def _append_version(inspection, previous, actor, at, **changes):
    value = {k:copy.deepcopy(v) for k,v in previous.items() if k not in ("sha256","number","at","actor")}
    value.update(changes)
    value.update(number=len(inspection["versions"])+1,at=at,actor=actor)
    sealed = _seal(value)
    inspection["versions"].append(sealed)
    inspection["currentVersion"],inspection["currentSha256"] = sealed["number"],sealed["sha256"]
    inspection["formId"] = sealed["formId"]
    inspection["formRevision"] = sealed["formRevision"]
    return sealed

def _current_binding(state, inspection, source):
    version = _version(inspection)
    old = version["binding"]
    active = _capture(state)
    _need(active["manifest"]["service"]["url"]==old["serviceUrl"] and
          active["manifest"]["service"].get("itemId")==old["serviceItemId"],
          "source_service_changed","The active source is a different ArcGIS service.")
    return _source_binding(state,source,active["id"],old["layerId"],old["objectId"])

def _assessment(state, inspection, source):
    version = _version(inspection)
    old = version["binding"]
    try:
        current, dataset = _current_binding(state,inspection,source)
    except DomainError as exc:
        return {"status":"source-unavailable","code":exc.code,"message":str(exc),
                "currentCaptureId":state["activeCaptureId"],"changedFields":[]}
    before,after = old["feature"]["attributes"],current["feature"]["attributes"]
    changes = [{"field":k,"previous":copy.deepcopy(before.get(k)),"current":copy.deepcopy(after.get(k))}
               for k in sorted(set(before)|set(after)) if not _same(before.get(k),after.get(k))]
    geometry_changed = not _same(old["feature"].get("geometry"),current["feature"].get("geometry"))
    attachment_changed = old["attachmentSetSha256"]!=current["attachmentSetSha256"]
    schema_changed = source.dataset(_capture(state,old["captureId"]),old["layerId"])["metadata"]!=dataset["metadata"]
    return {"status":"changed" if changes or geometry_changed or attachment_changed or schema_changed else "current",
            "currentCaptureId":current["captureId"],"changedFields":changes,
            "geometryChanged":geometry_changed,"attachmentsChanged":attachment_changed,
            "schemaChanged":schema_changed,"currentFeatureSha256":current["featureSha256"],
            "coverage":copy.deepcopy(dataset["entry"]["coverage"]),
            "observations":copy.deepcopy(dataset["entry"].get("observations",[]))}

def _latest_submission(inspection):
    return inspection["submissions"][-1] if inspection["submissions"] else None

def _decision_for(inspection, version):
    did = version.get("decisionId")
    return next((d for d in inspection["decisions"] if d["id"] == did), None)

def _ready_source(state, inspection, source):
    assessment = _assessment(state, inspection, source)
    _need(assessment["status"] == "current", "source_refresh",
          "Review the source changes and rebase this inspection before submitting its edits.", assessment)
    return assessment

def _candidate(inspection, form, version, submission_id, decision_id):
    binding = version["binding"]
    attributes = {}
    for field in form["fields"]:
        if field["kind"] == "source":
            name = field["sourceField"]
            value = version["answers"][field["key"]]
            if not _same(value, binding["feature"]["attributes"].get(name)):
                attributes[name] = copy.deepcopy(value)
    geometry_changed = not _same(version["geometry"], binding["feature"].get("geometry"))
    update = {"attributes": {binding["objectIdField"]: binding["objectId"], **attributes}}
    if geometry_changed:
        update["geometry"] = copy.deepcopy(version["geometry"])
    return {"inspectionId": inspection["id"], "submissionId": submission_id,
            "decisionId": decision_id, "formId": form["id"], "formSha256": form["sha256"],
            "version": version["number"], "versionSha256": version["sha256"],
            "source": copy.deepcopy(binding), "changedFields": sorted(attributes),
            "geometryChanged": geometry_changed,
            "update": update if attributes or geometry_changed else None,
            "attachmentAdds": copy.deepcopy(version["attachments"])}

def _rebase(state, inspection, body, source, actor, at):
    previous = _version(inspection)
    _expected(inspection, body.get("expectedVersion"))
    old_form = _form(state, previous["formId"])
    form = _form(state, body.get("formId") or old_form["id"])
    _need(form["key"] == old_form["key"] and form["layerId"] == old_form["layerId"],
          "rebase_form", "Choose an edition of this inspection's original form.")
    old_binding = previous["binding"]
    binding, dataset = _source_binding(state, source, body.get("captureId"),
                                       old_binding["layerId"], old_binding["objectId"])
    _need(binding["serviceUrl"] == old_binding["serviceUrl"] and
          binding["serviceItemId"] == old_binding["serviceItemId"],
          "rebase_service", "A source refresh must retain the same service identity.")
    _need(old_binding["globalId"] is None or binding["globalId"] == old_binding["globalId"],
          "source_identity_changed", "This object ID now names a different original global ID.")
    _need(_capture(state,form["captureId"])["manifest"]["service"]["url"] == binding["serviceUrl"],
          "rebase_form", "The selected form belongs to a different service.")
    choices = body.get("conflictChoices", {})
    _need(isinstance(choices, dict) and all(v in ("keep","current") for v in choices.values()),
          "conflict_choices", "Select keep or current for each conflicting source field.")
    old_fields = {f["sourceField"]: f for f in old_form["fields"] if f["kind"] == "source"}
    new_fields = {f["sourceField"]: f for f in form["fields"] if f["kind"] == "source"}
    old_attrs, current_attrs = old_binding["feature"]["attributes"], binding["feature"]["attributes"]
    removed_changes = [name for name, f in old_fields.items() if name not in new_fields
                       and not _same(previous["answers"].get(f["key"]), old_attrs.get(name))]
    _need(not removed_changes, "unmapped_changes",
          "The replacement form must retain every source field with a pending local edit.",
          {"fields":removed_changes})
    values = _initial_answers(form, binding["feature"])
    conflicts, applied = [], []
    for field in form["fields"]:
        key, name = field["key"], field["sourceField"]
        if field["kind"] != "source":
            old_local = next((f for f in old_form["fields"] if f["key"] == key and f["kind"] == field["kind"]), None)
            if old_local:
                values[key] = copy.deepcopy(previous["answers"].get(key))
            continue
        _need(name in dataset["fields"], "changed_form_schema",
              "Choose a form edition that maps the current source fields.", {"field":name})
        old_field = old_fields.get(name)
        if old_field is None:
            continue
        before, current = old_attrs.get(name), current_attrs.get(name)
        local = previous["answers"].get(old_field["key"])
        local_changed, remote_changed = not _same(local,before), not _same(current,before)
        conflict = local_changed and remote_changed and not _same(local,current)
        if conflict and name not in choices:
            conflicts.append({"field":name,"original":before,"local":local,"current":current})
            continue
        take_local = local_changed and (not conflict or choices.get(name) == "keep")
        values[key] = copy.deepcopy(local if take_local else current)
        if conflict:
            applied.append({"field":name,"choice":choices[name],"original":before,"local":local,"current":current})
    old_geometry, current_geometry = old_binding["feature"].get("geometry"), binding["feature"].get("geometry")
    local_geometry = previous["geometry"]
    local_changed = not _same(local_geometry,old_geometry)
    remote_changed = not _same(current_geometry,old_geometry)
    geometry_conflict = local_changed and remote_changed and not _same(local_geometry,current_geometry)
    if geometry_conflict and "$geometry" not in choices:
        conflicts.append({"field":"$geometry","original":old_geometry,"local":local_geometry,"current":current_geometry})
    geometry = copy.deepcopy(local_geometry if local_changed and
                             (not geometry_conflict or choices.get("$geometry") == "keep") else current_geometry)
    if geometry_conflict and "$geometry" in choices:
        applied.append({"field":"$geometry","choice":choices["$geometry"]})
    _need(not conflicts, "source_conflicts", "Choose each field value to keep during this source refresh.",
          {"conflicts":conflicts})
    _need(set(choices) <= set(old_fields)|{"$geometry"}, "conflict_choices",
          "A conflict choice names an unknown original field.")
    values = _answers(form, values, binding, dataset)
    if not _same(geometry,binding["feature"].get("geometry")):
        _need(form["geometryEditable"],"geometry_read_only","This form retains source geometry.")
        geometry = _geometry(geometry,dataset["metadata"])
    attachments = _attachments(form,previous["attachments"],source)
    note = _text(body.get("note",""),"Source refresh note",10000,empty=True)
    return _append_version(inspection,previous,actor,at,formId=form["id"],
                           formRevision=form["revision"],binding=binding,answers=values,
                           geometry=geometry,attachments=attachments,status="draft",
                           submissionId=None,decisionId=None,reason=note,
                           sourceRefresh={"previousCaptureId":old_binding["captureId"],
                                          "currentCaptureId":binding["captureId"],"choices":applied})

def _proposal_records(state, candidates, source):
    grouped,services={},set()
    for candidate in candidates:
        binding=candidate["source"]
        services.add((binding["serviceUrl"],binding["serviceItemId"]))
        iid=candidate["inspectionId"]
        key=(binding["layerId"],binding["objectId"])
        entry=grouped.get(key)
        if entry is None:
            entry=grouped[key]={"layerId":key[0],"objectId":key[1],
                "globalId":binding["globalId"],"objectIdField":binding["objectIdField"],
                "baseFeatureSha256":binding["featureSha256"],
                "baseAttachmentSetSha256":binding["attachmentSetSha256"],
                "source":copy.deepcopy(binding),"inspectionIds":[],
                "attributes":{},"hasGeometry":False,"geometry":None,"attachmentAdds":[]}
        _need(entry["baseFeatureSha256"]==binding["featureSha256"] and
              entry["baseAttachmentSetSha256"]==binding["attachmentSetSha256"] and
              entry["objectIdField"]==binding["objectIdField"] and entry["globalId"]==binding["globalId"],
              "proposal_source_conflict","Approved inspections use different originals for one object.")
        entry["inspectionIds"].append(iid)
        if candidate["update"] is not None:
            for field in candidate["changedFields"]:
                value=candidate["update"]["attributes"][field]
                _need(field not in entry["attributes"] or _same(entry["attributes"][field],value),
                      "proposal_field_conflict","Approved inspections propose different values for one source field.",
                      {"layerId":key[0],"objectId":key[1],"field":field})
                entry["attributes"][field]=copy.deepcopy(value)
            if candidate["geometryChanged"]:
                proposed=candidate["update"].get("geometry")
                _need(not entry["hasGeometry"] or _same(entry["geometry"],proposed),
                      "proposal_geometry_conflict","Approved inspections propose different geometry for one object.")
                entry["hasGeometry"],entry["geometry"]=True,copy.deepcopy(proposed)
        for item in candidate["attachmentAdds"]:
            prior=next((a for a in entry["attachmentAdds"] if a["id"]==item["id"]),None)
            _need(prior is None or _same(prior,item),"proposal_attachment_conflict",
                  "An attachment identity has conflicting approved contents.")
            if prior is None:
                entry["attachmentAdds"].append(copy.deepcopy(item))
    _need(len(services)==1,"proposal_service","An edit proposal must address one original ArcGIS service.")
    records=[]
    for _,item in sorted(grouped.items()):
        binding=item["source"]
        dataset=source.dataset(_capture(state,binding["captureId"]),binding["layerId"])
        attributes=item["attributes"]
        final_attrs={**copy.deepcopy(binding["feature"]["attributes"]),**copy.deepcopy(attributes)}
        for name,value in attributes.items():
            field=dataset["fields"].get(name)
            _need(field is not None and not _read_only(field,dataset["metadata"]),
                  "proposal_field","Combined proposal contains an unknown or read-only source field.")
            _need(_same(_field_value(value,field,dataset["metadata"]),value),
                  "proposal_field","Combined proposal contains a value with a different source type.")
            _domain_value(value,field,final_attrs,dataset["metadata"])
        type_field=dataset["metadata"].get("typeIdField")
        if type_field and not _same(final_attrs.get(type_field),binding["feature"]["attributes"].get(type_field)):
            for name,field in dataset["fields"].items():
                if name in final_attrs:
                    _domain_value(final_attrs[name],field,final_attrs,dataset["metadata"])
        attrs={item["objectIdField"]:item["objectId"],**item.pop("attributes")}
        changed=bool(len(attrs)>1 or item["hasGeometry"])
        update={"attributes":attrs} if changed else None
        if item.pop("hasGeometry"):
            update["geometry"]=_geometry(item["geometry"],dataset["metadata"])
        item.pop("geometry")
        item["update"]=update
        records.append(item)
    return records,next(iter(services))

def _proposal_capabilities(capture, source):
    metadata=source.json(capture["manifest"]["service"]["metadata"])
    return {"syncEnabled":metadata.get("syncEnabled"),
            "supportsApplyEditsWithGlobalIds":metadata.get("supportsApplyEditsWithGlobalIds")}

def _create_proposal(state, body, source, actor, at):
    pid=_id(body.get("id"),"Proposal ID")
    _need(not any(p["id"]==pid for p in state["proposals"]),
          "duplicate_proposal","Proposal ID already exists.")
    ids=body.get("inspectionIds")
    _need(isinstance(ids,list) and bool(ids) and len(ids)==len(set(ids)),
          "proposal_inspections","Choose unique approved inspections.")
    candidates=[]
    for iid in ids:
        inspection=_inspection(state,iid)
        version=_version(inspection)
        decision=_decision_for(inspection,version)
        _need(version["status"]=="approved" and decision and decision["decision"]=="approve",
              "approval_required","Each proposal inspection needs its current supervisor approval.",
              {"inspectionId":iid})
        _ready_source(state,inspection,source)
        candidate=copy.deepcopy(decision["candidate"])
        _need(_same(candidate["source"],version["binding"]),"changed_approval",
              "The current inspection source differs from its approval.")
        original=inspection["versions"][candidate["version"]-1]
        _need(_same(_operating_fields(original),_operating_fields(version)),
              "changed_approval","The current inspection values differ from its approved edition.")
        candidates.append(candidate)
    records,(service_url,service_id)=_proposal_records(state,candidates,source)
    current=_capture(state)
    proposal=_seal({"id":pid,"schema":"geocove.approved-edit-proposal.v1",
                    "at":at,"actor":actor,"serviceUrl":service_url,"serviceItemId":service_id,
                    "captureId":current["id"],"captureSha256":current["manifest"]["sha256"],
                    "inspectionIds":list(ids),"candidates":candidates,"records":records,
                    "capabilities":_proposal_capabilities(current,source),
                    "state":"prepared","routing":"original-object-id","providerOperations":[]})
    state["proposals"].append(proposal)
    return {"proposalId":pid,"sha256":proposal["sha256"],"records":len(records)}

def _operating_fields(version):
    return {k:copy.deepcopy(version[k]) for k in
            ("formId","formRevision","binding","answers","geometry","attachments","note")}

def apply(state, command, read_blob):
    """Apply one deterministic command. Storage owns request replay and atomic CAS."""
    _need(isinstance(state,dict) and state.get("schema")==SCHEMA,
          "workspace_schema","Choose a highway workspace.")
    _need(isinstance(command,dict) and set(command)=={"requestId","kind","actor","at","body"},
          "command","Commands need requestId, kind, actor, at and body.")
    _id(command["requestId"],"Request ID")
    actor,at=_actor(command["actor"]),command["at"]
    _time(at)
    _need(_time(at)>=_time(state["createdAt"]),"command_time","Command precedes workspace creation.")
    kind,body=command["kind"],command["body"]
    _need(isinstance(body,dict),"command_body","Command body must be an object.")
    work=copy.deepcopy(state)
    source=Source(read_blob)
    if isinstance(kind,str) and kind.startswith("dispatch."):
        from .dispatch import apply_dispatch
        work,result=apply_dispatch(work,command,read_blob)
    elif kind=="reconciliation.record":
        from .reconciliation import apply_reconciliation
        work,result=apply_reconciliation(work,command,read_blob)
    elif isinstance(kind,str) and kind.startswith("field."):
        from .field_exchange import apply_field_exchange
        work,result=apply_field_exchange(work,command,read_blob)
    elif kind=="capture.import":
        manifest=body.get("manifest")
        _validate_manifest(manifest,source)
        previous=next((x for x in work["captures"] if x["id"]==manifest["id"]),None)
        _need(previous is None or _same(previous["manifest"],manifest),
              "capture_collision","A retained source edition already uses this ID with different contents.")
        if previous is None:
            work["captures"].append({"id":manifest["id"],"manifest":copy.deepcopy(manifest),"at":at,"actor":actor})
        work["activeCaptureId"]=manifest["id"]
        result={"captureId":manifest["id"],"sha256":manifest["sha256"],"reused":previous is not None}
    elif kind=="form.save":
        form=_form_definition(work,body,source,actor,at)
        work["forms"].append(form)
        work["activeForms"][form["key"]]=form["id"]
        result={"formId":form["id"],"key":form["key"],"revision":form["revision"],"sha256":form["sha256"]}
    elif kind=="inspection.open":
        iid=_id(body.get("id"),"Inspection ID")
        _need(not any(i["id"]==iid for i in work["inspections"]),
              "duplicate_inspection","Inspection ID already exists.")
        form=_form(work,body.get("formId"))
        object_id=_integer(body.get("objectId"),"Object ID",0)
        assignment=body.get("assignmentId")
        capture_id=form["captureId"]
        assigned=None
        if assignment is not None:
            _id(assignment,"Assignment ID")
            assigned=(work.get("dispatch") or {}).get("assignments",{}).get(assignment)
            _need(assigned is not None,"unknown_assignment","Choose an actual retained dispatch assignment.")
            _need(assigned["formId"]==form["id"] and assigned["formRevision"]==form["revision"] and
                  assigned["sourceRef"]["layerId"]==form["layerId"] and
                  assigned["sourceRef"]["objectId"]==object_id,
                  "assignment_source","Inspection must use its assignment's exact form and original object.")
            capture_id=assigned["sourceRef"]["captureId"]
        binding,dataset=_source_binding(work,source,capture_id,form["layerId"],object_id)
        if assigned is not None:
            _need(_same(_source_ref(binding),assigned["sourceRef"]),
                  "assignment_source","Inspection source differs from its retained assignment.")
            original_capture=_capture(work,form["captureId"])
            _need(original_capture["manifest"]["service"]["url"]==binding["serviceUrl"] and
                  original_capture["manifest"]["service"].get("itemId")==binding["serviceItemId"],
                  "assignment_service","Assignment and form belong to different original services.")
        version=_seal({"number":1,"at":at,"actor":actor,"formId":form["id"],
                       "formRevision":form["revision"],"binding":binding,
                       "answers":_initial_answers(form,binding["feature"]),
                       "geometry":copy.deepcopy(binding["feature"].get("geometry")),
                       "attachments":[],"note":"","reason":"","status":"draft",
                       "submissionId":None,"decisionId":None,"sourceRefresh":None})
        inspection={"id":iid,"assignmentId":assignment,"formId":form["id"],
                    "formRevision":form["revision"],"createdAt":at,"createdBy":actor,
                    "versions":[version],"submissions":[],"decisions":[],
                    "currentVersion":1,"currentSha256":version["sha256"]}
        work["inspections"].append(inspection)
        result={"inspectionId":iid,"version":1,"sha256":version["sha256"]}
    elif kind in ("inspection.save","inspection.correct"):
        inspection=_inspection(work,body.get("id"))
        previous=_version(inspection)
        _expected(inspection,body.get("expectedVersion"))
        form=_form(work,previous["formId"])
        correction=kind=="inspection.correct"
        _need(correction or previous["status"] in ("draft","returned"),
              "inspection_state","Use a supervisor correction to revise a submitted or decided inspection.")
        reason=_text(body.get("reason",""),"Correction reason",10000,empty=not correction)
        binding=previous["binding"]
        dataset=source.dataset(_capture(work,binding["captureId"]),binding["layerId"])
        answers=_answers(form,body.get("answers"),binding,dataset)
        _need("geometry" in body,"inspection_geometry","Supply the retained or proposed full geometry.")
        geometry=body["geometry"]
        if not _same(geometry,binding["feature"].get("geometry")):
            _need(form["geometryEditable"],"geometry_read_only","This form retains source geometry.")
            geometry=_geometry(geometry,dataset["metadata"])
        attachments=_attachments(form,body.get("attachments"),source)
        note=_text(body.get("note",""),"Inspection note",30000,empty=True)
        version=_append_version(inspection,previous,actor,at,answers=answers,note=note,
                                geometry=geometry,attachments=attachments,reason=reason,
                                status="draft",submissionId=None,decisionId=None)
        result={"inspectionId":inspection["id"],"version":version["number"],"sha256":version["sha256"]}
    elif kind=="inspection.submit":
        inspection=_inspection(work,body.get("id"))
        previous=_version(inspection)
        _expected(inspection,body.get("expectedVersion"))
        _need(previous["status"] in ("draft","returned"),"inspection_state",
              "Submit an open field inspection.")
        sid=_id(body.get("submissionId"),"Submission ID")
        _need(not any(s["id"]==sid for i in work["inspections"] for s in i["submissions"]),
              "duplicate_submission","Submission ID already exists.")
        form=_form(work,previous["formId"])
        binding=previous["binding"]
        dataset=source.dataset(_capture(work,binding["captureId"]),binding["layerId"])
        answers=_answers(form,previous["answers"],binding,dataset,final=True)
        attachments=_attachments(form,previous["attachments"],source,final=True)
        _need(_same(answers,previous["answers"]) and _same(attachments,previous["attachments"]),
              "unsaved_normalization","Save the normalized field values before submitting.")
        assessment=_ready_source(work,inspection,source)
        submission=_seal({"id":sid,"at":at,"actor":actor,
                          "inspectionId":inspection["id"],"version":previous["number"],
                          "versionSha256":previous["sha256"],"formId":form["id"],
                          "formSha256":form["sha256"],"source":copy.deepcopy(binding),
                          "assessment":assessment})
        inspection["submissions"].append(submission)
        version=_append_version(inspection,previous,actor,at,status="submitted",submissionId=sid,decisionId=None)
        result={"inspectionId":inspection["id"],"submissionId":sid,
                "version":version["number"],"sha256":version["sha256"]}
    elif kind=="inspection.decide":
        inspection=_inspection(work,body.get("id"))
        previous=_version(inspection)
        submission=_latest_submission(inspection)
        _need(previous["status"]=="submitted" and submission and
              submission["id"]==body.get("submissionId")==previous["submissionId"],
              "stale_submission","Open the current submitted edition before recording a decision.")
        did=_id(body.get("decisionId"),"Decision ID")
        _need(not any(d["id"]==did for i in work["inspections"] for d in i["decisions"]),
              "duplicate_decision","Decision ID already exists.")
        decision=body.get("decision")
        _need(decision in ("approve","return","reject"),"decision","Choose approve, return or reject.")
        note=_text(body.get("note",""),"Supervisor decision note",30000,empty=decision=="approve")
        form=_form(work,previous["formId"])
        original=inspection["versions"][submission["version"]-1]
        candidate=None
        if decision=="approve":
            _ready_source(work,inspection,source)
            candidate=_candidate(inspection,form,original,submission["id"],did)
        record=_seal({"id":did,"at":at,"actor":actor,"decision":decision,"note":note,
                      "inspectionId":inspection["id"],"submissionId":submission["id"],
                      "submissionSha256":submission["sha256"],
                      "version":original["number"],"versionSha256":original["sha256"],
                      "candidate":candidate})
        inspection["decisions"].append(record)
        version=_append_version(inspection,previous,actor,at,
                                status={"approve":"approved","return":"returned","reject":"rejected"}[decision],
                                decisionId=did)
        result={"inspectionId":inspection["id"],"decisionId":did,
                "status":version["status"],"version":version["number"],"sha256":version["sha256"]}
    elif kind=="inspection.rebase":
        inspection=_inspection(work,body.get("id"))
        version=_rebase(work,inspection,body,source,actor,at)
        result={"inspectionId":inspection["id"],"version":version["number"],"sha256":version["sha256"]}
    elif kind=="proposal.create":
        result=_create_proposal(work,body,source,actor,at)
    else:
        raise DomainError("unknown_command","Unknown highway command: "+str(kind))
    # Late offline work retains its actual operation time without moving the workspace clock backwards.
    work["updatedAt"]=max((state["updatedAt"],at),key=_time)
    return work,result

def _source_ref(binding):
    return {k:copy.deepcopy(binding[k]) for k in ("captureId","layerId","objectId","globalId")}

def _inspection_summary(state, inspection):
    version=_version(inspection)
    form=_form(state,version["formId"])
    decision=_decision_for(inspection,version)
    approval=({k:copy.deepcopy(decision[k]) for k in ("decision","id","at","actor")}
              if decision else None)
    return {"id":inspection["id"],"assignmentId":inspection.get("assignmentId"),
            "formId":form["id"],"formRevision":form["revision"],"title":form["title"],
            "sourceRef":_source_ref(version["binding"]),"status":version["status"],
            "currentVersion":version["number"],"currentSha256":version["sha256"],
            "submissionId":version.get("submissionId"),"approval":approval,
            "updatedAt":version["at"],"updatedBy":copy.deepcopy(version["actor"])}

def dataset_records(state, capture_id, layer_id, read_blob):
    source=Source(read_blob)
    capture=_capture(state,capture_id)
    dataset=source.dataset(capture,_integer(layer_id,"Dataset ID",0))
    return {"captureId":capture["id"],"layerId":layer_id,
            "name":dataset["entry"]["name"],"type":dataset["entry"]["type"],
            "metadata":copy.deepcopy(dataset["metadata"]),
            "coverage":copy.deepcopy(dataset["entry"]["coverage"]),
            "observations":copy.deepcopy(dataset["entry"].get("observations",[])),
            "records":[{"objectId":oid,
                        "globalId":feature["attributes"].get(dataset["globalIdField"]) if dataset["globalIdField"] else None,
                        "feature":copy.deepcopy(feature),
                        "attachments":copy.deepcopy(dataset["attachments"].get(oid,[]))}
                       for oid,feature in sorted(dataset["records"].items())]}

def inspection_view(state, inspection_id, read_blob):
    source=Source(read_blob)
    inspection=_inspection(state,inspection_id)
    version=_version(inspection)
    binding=version["binding"]
    dataset=source.dataset(_capture(state,binding["captureId"]),binding["layerId"])
    return {"inspection":copy.deepcopy(inspection),"version":copy.deepcopy(version),
            "form":copy.deepcopy(_form(state,version["formId"])),
            "source":{"binding":copy.deepcopy(binding),"metadata":copy.deepcopy(dataset["metadata"]),
                      "coverage":copy.deepcopy(dataset["entry"]["coverage"]),
                      "observations":copy.deepcopy(dataset["entry"].get("observations",[]))},
            "assessment":_assessment(state,inspection,source),
            "proposals":[copy.deepcopy(p) for p in state["proposals"] if inspection_id in p["inspectionIds"]]}

def dispatch_context(state, read_blob):
    source=Source(read_blob)
    captures=[]
    for capture in state["captures"]:
        datasets=[]
        for item in capture["manifest"]["datasets"]:
            dataset=source.dataset(capture,item["id"])
            datasets.append({"layerId":item["id"],"name":item["name"],
                             "objectIds":sorted(dataset["records"]),
                             "objectRefs":[{"objectId":oid,"globalId":feature["attributes"].get(dataset["globalIdField"]) if dataset["globalIdField"] else None} for oid,feature in sorted(dataset["records"].items())],
                             "globalIdField":dataset["globalIdField"]})
        captures.append({"id":capture["id"],"serviceUrl":capture["manifest"]["service"]["url"],
                         "serviceItemId":capture["manifest"]["service"].get("itemId"),
                         "datasets":datasets})
    return {"captures":captures,
            "forms":[{**{k:copy.deepcopy(f[k]) for k in ("id","key","revision","sha256","captureId","layerId","title")},
                      "active":state["activeForms"].get(f["key"])==f["id"]} for f in state["forms"]],
            "inspections":[_inspection_summary(state,i) for i in state["inspections"]]}

def describe(state, read_blob):
    source=Source(read_blob)
    captures=[]
    for capture in state["captures"]:
        datasets=[]
        for item in capture["manifest"]["datasets"]:
            dataset=source.dataset(capture,item["id"])
            datasets.append({"id":item["id"],"name":item["name"],"type":item["type"],
                             "metadata":copy.deepcopy(dataset["metadata"]),
                             "coverage":copy.deepcopy(item["coverage"]),
                             "observations":copy.deepcopy(item.get("observations",[])),
                             "recordCount":len(dataset["records"])})
        captures.append({"id":capture["id"],"at":capture["at"],"actor":copy.deepcopy(capture["actor"]),
                         "serviceUrl":capture["manifest"]["service"]["url"],
                         "serviceItemId":capture["manifest"]["service"].get("itemId"),
                         "sha256":capture["manifest"]["sha256"],"datasets":datasets})
    result={k:copy.deepcopy(state[k]) for k in ("schema","id","title","createdAt","updatedAt","activeCaptureId")}
    result.update(captures=captures,
                  forms=[{**copy.deepcopy(f),"active":state["activeForms"].get(f["key"])==f["id"]}
                         for f in state["forms"]],
                  inspections=[_inspection_summary(state,i) for i in state["inspections"]],
                  proposals=copy.deepcopy(state["proposals"]))
    try:
        from .dispatch import dispatch_view
    except ImportError as error:
        if state.get("dispatch"):
            raise DomainError("missing_dispatch","This workspace requires its original dispatch source.") from error
        result["dispatch"]=None
    else:
        result["dispatch"]=dispatch_view(state,read_blob)
    try:
        from .reconciliation import reconciliation_view
    except ImportError as error:
        if state.get("reconciliation"):
            raise DomainError("missing_reconciliation","This workspace requires its original reconciliation source.") from error
        result["reconciliation"]=None
    else:
        result["reconciliation"]=reconciliation_view(state,read_blob)
    if state.get("fieldExchange") is not None:
        from .field_exchange import view
        result["fieldExchange"]=view(state,read_blob)
    else:
        result["fieldExchange"]=None
    return result

def validate_state(state, read_blob):
    """Validate retained editions and their real source bytes during full workspace intake."""
    _need(isinstance(state,dict) and state.get("schema")==SCHEMA,
          "workspace_schema","Choose a complete highway workspace.")
    _id(state.get("id"),"Workspace ID")
    _text(state.get("title"),"Workspace title",300)
    _time(state.get("createdAt"))
    _need(_time(state.get("updatedAt"))>=_time(state["createdAt"]),
          "workspace_time","Workspace update precedes creation.")
    source=Source(read_blob)
    for key in ("captures","forms","inspections","proposals"):
        rows=state.get(key)
        _need(isinstance(rows,list) and all(isinstance(v,dict) and isinstance(v.get("id"),str) for v in rows)
              and len({v["id"] for v in rows})==len(rows),
              "workspace_collection","Workspace "+key+" need complete unique records.")
    for capture in state["captures"]:
        _need(capture["id"]==capture["manifest"]["id"],"capture_identity","Capture identity differs from manifest.")
        _validate_manifest(capture["manifest"],source)
        _actor(capture["actor"]); _time(capture["at"])
    if state["captures"]:
        _capture(state)
    else:
        _need(state.get("activeCaptureId") is None,"active_capture","An empty workspace has no active source.")
    prior={}
    for form in state["forms"]:
        _check_seal(form,"Form edition")
        _id(form["id"]); _actor(form["actor"]); _time(form["at"])
        previous=prior.get(form["key"])
        _need(form["previousFormId"]==(previous["id"] if previous else None) and
              form["revision"]==(previous["revision"]+1 if previous else 1),
              "form_history","Form editions must retain their complete ordered history.")
        dataset=source.dataset(_capture(state,form["captureId"]),form["layerId"])
        _need(all(f["kind"]!="source" or f["sourceField"] in dataset["fields"] for f in form["fields"]),
              "form_source","A form field is absent from its saved original source.")
        prior[form["key"]]=form
    _need(state.get("activeForms")=={key:form["id"] for key,form in prior.items()},
          "active_forms","Active forms differ from the complete form history.")
    submissions,decisions=set(),set()
    for inspection in state["inspections"]:
        _id(inspection["id"]); _actor(inspection["createdBy"]); _time(inspection["createdAt"])
        _version(inspection)
        for number,version in enumerate(inspection["versions"],1):
            _check_seal(version,"Inspection edition")
            _need(version["number"]==number,"inspection_history","Inspection editions must remain in order.")
            _actor(version["actor"]); _time(version["at"])
            form=_form(state,version["formId"])
            _need(form["revision"]==version["formRevision"],"form_revision","Inspection form revision changed.")
            binding=version["binding"]
            expected,dataset=_source_binding(state,source,binding["captureId"],binding["layerId"],binding["objectId"])
            _need(_same(expected,binding),"source_binding","Inspection original source binding changed.")
            _need(form["layerId"]==binding["layerId"] and
                  _capture(state,form["captureId"])["manifest"]["service"]["url"]==binding["serviceUrl"],
                  "form_source","Inspection form and original dataset identity differ.")
            _need(version["status"] in ("draft","submitted","returned","approved","rejected"),
                  "inspection_status","Inspection status is invalid.")
            normalized=_answers(form,version["answers"],binding,dataset,
                                final=version["status"] in ("submitted","approved"))
            _need(_same(normalized,version["answers"]),"inspection_answers","Saved answers differ from their typed values.")
            _need(_same(_attachments(form,version["attachments"],source,
                                     final=version["status"] in ("submitted","approved")),version["attachments"]),
                  "inspection_attachments","Saved attachment descriptors changed.")
            if not _same(version["geometry"],binding["feature"].get("geometry")):
                _need(form["geometryEditable"],"geometry_read_only","This saved form retains original geometry.")
                _geometry(version["geometry"],dataset["metadata"])
        for submission in inspection["submissions"]:
            _check_seal(submission,"Submission")
            _need(submission["id"] not in submissions,"duplicate_submission","Submission IDs must be unique.")
            submissions.add(submission["id"])
            number=_integer(submission["version"],"Submitted edition",1,len(inspection["versions"]))
            version=inspection["versions"][number-1]
            _need(submission["inspectionId"]==inspection["id"] and
                  submission["versionSha256"]==version["sha256"] and
                  submission["formSha256"]==_form(state,version["formId"])["sha256"] and
                  _same(submission["source"],version["binding"]),
                  "submission_binding","Submission differs from its retained inspection and source.")
        for decision in inspection["decisions"]:
            _check_seal(decision,"Supervisor decision")
            _need(decision["id"] not in decisions,"duplicate_decision","Decision IDs must be unique.")
            decisions.add(decision["id"])
            submission=next((s for s in inspection["submissions"] if s["id"]==decision["submissionId"]),None)
            _need(submission is not None and decision["inspectionId"]==inspection["id"] and
                  submission["sha256"]==decision["submissionSha256"],
                  "decision_binding","Supervisor decision differs from its original submission.")
            _need(decision["decision"] in ("approve","return","reject"),"decision","Saved decision is invalid.")
            if decision["decision"]=="approve":
                original=inspection["versions"][submission["version"]-1]
                expected=_candidate(inspection,_form(state,original["formId"]),original,
                                    submission["id"],decision["id"])
                _need(_same(decision["candidate"],expected),"candidate_binding","Approved edit differs from its original field work.")
            else:
                _need(decision["candidate"] is None,"candidate_binding","An unapproved decision cannot contain approved edits.")
        for version in inspection["versions"]:
            sid,did=version["submissionId"],version["decisionId"]
            if version["status"]=="draft":
                _need(sid is None and did is None,"draft_approval",
                      "A corrected or rebased draft must clear current submission and approval references.")
                continue
            submission=next((x for x in inspection["submissions"] if x["id"]==sid),None)
            _need(submission is not None,"submission_binding",
                  "Submitted or decided inspection points to a missing submission.")
            original=inspection["versions"][submission["version"]-1]
            _need(original["number"]<version["number"] and
                  _same(_operating_fields(original),_operating_fields(version)),
                  "submission_values","A submitted or decided edition differs from its original submitted work.")
            if version["status"]=="submitted":
                _need(did is None,"submitted_decision","A pending submission cannot carry a decided outcome.")
            else:
                decision=next((d for d in inspection["decisions"] if d["id"]==did),None)
                expected={"approved":"approve","returned":"return","rejected":"reject"}[version["status"]]
                _need(decision is not None and decision["submissionId"]==sid and decision["decision"]==expected,
                      "decision_binding","Inspection status differs from its original supervisor decision.")
        current=_version(inspection)
        _need(inspection["formId"]==current["formId"] and inspection["formRevision"]==current["formRevision"],
              "inspection_form","Current inspection form differs from its retained edition.")
    for proposal in state["proposals"]:
        _check_seal(proposal,"Approved proposal")
        _need(proposal.get("schema")=="geocove.approved-edit-proposal.v1" and
              proposal.get("state")=="prepared" and proposal.get("providerOperations")==[],
              "proposal_state","Choose the original prepared proposal.")
        capture=_capture(state,proposal["captureId"])
        _need(capture["manifest"]["sha256"]==proposal["captureSha256"] and
              proposal["serviceUrl"]==capture["manifest"]["service"]["url"] and
              proposal["serviceItemId"]==capture["manifest"]["service"].get("itemId") and
              _same(proposal["capabilities"],_proposal_capabilities(capture,source)) and
              proposal.get("routing")=="original-object-id",
              "proposal_source","Proposal service, capabilities or capture binding changed.")
        _need(bool(proposal["inspectionIds"]) and
              len(proposal["inspectionIds"])==len(set(proposal["inspectionIds"])) and
              len(proposal["inspectionIds"])==len(proposal["candidates"]),
              "proposal_candidates","Proposal candidates differ from their inspection set.")
        for iid,candidate in zip(proposal["inspectionIds"],proposal["candidates"]):
            inspection=_inspection(state,iid)
            decision=next((d for d in inspection["decisions"] if d["id"]==candidate["decisionId"]),None)
            _need(decision and decision["decision"]=="approve" and _same(decision["candidate"],candidate),
                  "proposal_binding","Proposal differs from its original approval.")
        expected_records,(service_url,service_id)=_proposal_records(state,proposal["candidates"],source)
        _need(_same(expected_records,proposal["records"]) and
              service_url==proposal["serviceUrl"] and service_id==proposal["serviceItemId"],
              "proposal_records","Proposal updates and attachments differ from its frozen approved candidates.")
    if state.get("reconciliation") is not None:
        from .reconciliation import validate_reconciliation
        validate_reconciliation(state,read_blob)
    if state.get("fieldExchange") is not None:
        from .field_exchange import validate
        validate(state,read_blob)
    canonical(state)
