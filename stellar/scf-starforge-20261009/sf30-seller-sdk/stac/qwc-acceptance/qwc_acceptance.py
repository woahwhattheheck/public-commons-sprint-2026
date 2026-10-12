"""Native QGIS/QWC publication acceptance, retained responses and change review.

This module consumes a publication selected by the existing publisher. It never
edits a QGIS project, QWC configuration, deployment selection or identity store.
Python 3.11+, standard library. Original response bytes remain immutable.
"""
from __future__ import annotations

import contextlib
import copy
import datetime as dt
import fcntl
import hashlib
import html
import io
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
import zlib
import xml.etree.ElementTree as ET

SCHEMA = "starforge.qwc.publication-acceptance.v1"
MAX_BODY = 32 * 1024 * 1024
MAX_SOURCE = 16 * 1024 * 1024
MAX_CONFIG = 4 * 1024 * 1024
OPERATIONS = {"GetCapabilities", "GetProjectSettings", "GetMap", "GetFeatureInfo", "GetPrint"}
SAFE_HEADERS = {"content-type", "content-length", "content-encoding", "etag",
                "last-modified", "cache-control", "date", "x-qgis-request-id"}
STANDARD_PARAMS = {
    "SERVICE", "REQUEST", "VERSION", "MAP", "LAYERS", "STYLES", "CRS", "SRS",
    "BBOX", "WIDTH", "HEIGHT", "FORMAT", "TRANSPARENT", "QUERY_LAYERS",
    "INFO_FORMAT", "FEATURE_COUNT", "I", "J", "X", "Y", "TEMPLATE", "DPI",
}
CHECK_FIELDS = {"id", "title", "operation", "params", "expect", "role_expectations"}
EXPECT_FIELDS = {"status", "media_types", "image_size", "required_layers",
                 "forbidden_layers", "queryable_layers", "required_templates",
                 "required_crs", "required_keywords", "feature_ids", "minimum_features", "denial_codes", "required_attributes", "forbidden_attributes", "attribute_rules", "xml_root"}
PARAM_NAME = re.compile(r"map[0-9]+:(?:EXTENT|LAYERS|STYLES|SCALE|ROTATION)$", re.I)
IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$")
SHA = re.compile(r"[a-f0-9]{64}$")


class AcceptanceError(ValueError):
    def __init__(self, code, message, **details):
        super().__init__(message)
        self.code, self.details = code, details

    def as_dict(self):
        return {"code": self.code, "message": str(self), **self.details}


def need(condition, code, message, **details):
    if not condition:
        raise AcceptanceError(code, message, **details)


def stamp():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def pack(value):
    return (json.dumps(value, sort_keys=True, ensure_ascii=False,
                       separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def identifier(value, field="id"):
    need(isinstance(value, str) and IDENTIFIER.fullmatch(value),
         "INVALID_ID", f"{field} must be a short file-safe identifier")
    return value


def text(value, field, maximum=1000):
    need(isinstance(value, str) and value.strip() and len(value) <= maximum,
         "INVALID_TEXT", f"{field} is required and must be at most {maximum} characters")
    return value


def finite(value, field):
    need(isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value),
         "INVALID_NUMBER", f"{field} must be a finite number")
    return value


def relative(value):
    need(isinstance(value, str) and "\\" not in value and "\x00" not in value,
         "INVALID_PATH", "A member needs a relative POSIX path")
    path = PurePosixPath(value)
    need(not path.is_absolute() and all(x not in ("", ".", "..") for x in value.split("/")),
         "INVALID_PATH", "A member cannot escape its receiving directory")
    return value


def load_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            need(key not in result, "DUPLICATE_JSON_KEY", f"Duplicate JSON key: {key}")
            result[key] = value
        return result
    try:
        return json.loads(raw.decode("utf-8-sig"), object_pairs_hook=pairs,
                          parse_constant=lambda value: (_ for _ in ()).throw(
                              AcceptanceError("INVALID_JSON_NUMBER", value)))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise AcceptanceError("INVALID_JSON", str(exc)) from exc


def read_file(path, limit=MAX_BODY):
    path = Path(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        need(stat.S_ISREG(info.st_mode), "NOT_REGULAR", f"Not a regular file: {path.name}")
        need(info.st_size <= limit, "FILE_TOO_LARGE", f"{path.name} exceeds {limit} bytes")
        with os.fdopen(fd, "rb", closefd=False) as stream:
            raw = stream.read(limit + 1)
        need(len(raw) <= limit and len(raw) == info.st_size,
             "FILE_CHANGED", f"{path.name} changed while reading")
        return raw
    finally:
        os.close(fd)


def fsync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def retain(path, raw):
    """Publish equal immutable bytes, preserving an existing different file."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.exists() or path.is_symlink():
        need(read_file(path, max(len(raw), MAX_CONFIG)) == raw,
             "IMMUTABLE_FILE_CHANGED", f"Retained file differs: {path.name}")
        return
    fd, temporary = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            need(read_file(path, max(len(raw), MAX_CONFIG)) == raw,
                 "IMMUTABLE_FILE_CHANGED", f"Concurrent retained file differs: {path.name}")
        fsync_directory(path.parent)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temporary)


def replace_json(path, value):
    path = Path(path)
    fd, temporary = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(pack(value))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        fsync_directory(path.parent)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temporary)


def descriptor(path, raw, media_type=None):
    item = {"path": relative(path), "bytes": len(raw), "sha256": sha(raw)}
    if media_type:
        item["media_type"] = media_type
    return item


def endpoint(value):
    text(value, "service.url", 4096)
    part = urllib.parse.urlsplit(value)
    need(part.scheme in ("http", "https") and part.hostname and not part.username
         and not part.password and not part.fragment,
         "INVALID_ENDPOINT", "Select an HTTP(S) service URL without credentials or a fragment")
    if part.scheme == "http":
        need(part.hostname in ("127.0.0.1", "::1", "localhost"),
             "INSECURE_ENDPOINT", "Plain HTTP is supported only for the selected local service")
    pairs = urllib.parse.parse_qsl(part.query, keep_blank_values=True, strict_parsing=True)
    need(len(pairs) <= 1 and all(k.upper() == "MAP" for k, _ in pairs),
         "ENDPOINT_QUERY", "Put request parameters in the plan; only a fixed MAP may be in the service URL")
    return value


def validate_expect(value):
    need(isinstance(value, dict) and set(value) <= EXPECT_FIELDS,
         "INVALID_EXPECTATION", "The check has unknown expectation fields")
    for key in ("required_layers", "forbidden_layers", "queryable_layers",
                "required_templates", "required_crs", "required_keywords", "feature_ids", "denial_codes", "media_types", "required_attributes", "forbidden_attributes"):
        if key in value:
            need(isinstance(value[key], list) and all(isinstance(x, str) for x in value[key]),
                 "INVALID_EXPECTATION", f"{key} must be a list of strings")
    if "attribute_rules" in value:
        rules = value["attribute_rules"]
        need(isinstance(rules, list) and len(rules) <= 100, "ATTRIBUTE_RULES", "Use up to 100 selected layer/field rules")
        for rule in rules:
            need(isinstance(rule, dict) and set(rule) <= {"layer", "feature_id", "group_path", "required", "forbidden", "allowed"},
                 "ATTRIBUTE_RULE", "A field rule selects a native layer, optional feature/group, and field expectations")
            text(rule.get("layer"), "attribute_rule.layer", 500)
            if "feature_id" in rule:
                text(rule["feature_id"], "attribute_rule.feature_id", 500)
            for field in ("group_path", "required", "forbidden", "allowed"):
                if field in rule:
                    need(isinstance(rule[field], list) and all(isinstance(x, str) for x in rule[field]),
                         "ATTRIBUTE_RULE", f"{field} must preserve a list of native names")
    if "xml_root" in value:
        text(value["xml_root"], "xml_root", 500)
    if "status" in value:
        need(isinstance(value["status"], list) and value["status"] and
             all(isinstance(x, int) and not isinstance(x, bool) and 100 <= x <= 599 for x in value["status"]),
             "INVALID_EXPECTATION", "status must contain actual HTTP status codes")
    if "image_size" in value:
        need(isinstance(value["image_size"], list) and len(value["image_size"]) == 2 and
             all(isinstance(x, int) and not isinstance(x, bool) and 1 <= x <= 4096
                 for x in value["image_size"]),
             "INVALID_EXPECTATION", "image_size must contain two positive pixel dimensions")
    if "minimum_features" in value:
        need(isinstance(value["minimum_features"], int) and
             not isinstance(value["minimum_features"], bool) and value["minimum_features"] >= 0,
             "INVALID_EXPECTATION", "minimum_features must be a nonnegative integer")


def validate_plan(plan):
    need(isinstance(plan, dict) and set(plan) <= {"schema", "run_id", "title", "publication", "service", "roles", "checks", "notes"} and plan.get("schema") == SCHEMA,
         "PLAN_SCHEMA", "Use the publication acceptance plan schema")
    identifier(plan.get("run_id"), "run_id")
    text(plan.get("title"), "title", 300)
    need(isinstance(plan.get("publication"), dict) and plan["publication"],
         "PUBLICATION_REQUIRED", "Retain the original publisher's selected publication identity")
    service = plan.get("service")
    need(isinstance(service, dict) and set(service) <= {"url", "map", "wms_version"},
         "INVALID_SERVICE", "service has unknown fields")
    endpoint(service.get("url"))
    need(service.get("wms_version", "1.3.0") in ("1.3.0", "1.1.1"),
         "WMS_VERSION", "Select the original WMS 1.3.0 or 1.1.1 contract")
    if "map" in service:
        text(service["map"], "service.map", 2000)
    roles = plan.get("roles")
    need(isinstance(roles, list) and 1 <= len(roles) <= 20,
         "ROLES_REQUIRED", "Select the existing role views")
    role_ids = set()
    for role in roles:
        need(isinstance(role, dict) and set(role) <= {"id", "title", "authentication", "principal_reference"},
             "INVALID_ROLE", "Role descriptors contain identities, not credentials")
        role_id = identifier(role.get("id"), "role.id")
        need(role_id not in role_ids, "DUPLICATE_ROLE", role_id)
        role_ids.add(role_id)
        text(role.get("title"), "role.title", 200)
        need(role.get("authentication") in ("anonymous", "existing_session"),
             "ROLE_AUTHENTICATION", "Use anonymous or an existing authorized session")
        if role["authentication"] == "existing_session":
            text(role.get("principal_reference"), "principal_reference", 500)
        if "principal_reference" in role:
            text(role["principal_reference"], "principal_reference", 500)
    checks = plan.get("checks")
    need(isinstance(checks, list) and 1 <= len(checks) <= 100,
         "CHECKS_REQUIRED", "Select the publication operations to review")
    check_ids = set()
    for check in checks:
        need(isinstance(check, dict) and set(check) <= CHECK_FIELDS,
             "INVALID_CHECK", "A check has unknown fields")
        check_id = identifier(check.get("id"), "check.id")
        need(check_id not in check_ids, "DUPLICATE_CHECK", check_id)
        check_ids.add(check_id)
        text(check.get("title"), "check.title", 300)
        need(check.get("operation") in OPERATIONS, "INVALID_OPERATION", "Use an original read-only WMS operation")
        params = check.get("params", {})
        need(isinstance(params, dict), "INVALID_PARAMS", "params must be an object")
        normalized = set()
        for key, value in params.items():
            upper = key.upper()
            need(upper not in normalized, "DUPLICATE_PARAMETER", key)
            normalized.add(upper)
            need(upper in STANDARD_PARAMS or PARAM_NAME.fullmatch(key),
                 "UNSUPPORTED_PARAMETER", f"Unsupported publication-read parameter: {key}")
            need(upper not in ("SERVICE", "REQUEST", "VERSION", "MAP"),
                 "BOUND_PARAMETER", f"{key} comes from the selected service")
            need(isinstance(value, (str, int, float, bool)) and
                 not (isinstance(value, float) and not math.isfinite(value)),
                 "INVALID_PARAMETER", key)
            rendered = str(value)
            need(len(rendered) <= 12000 and "\x00" not in rendered,
                 "INVALID_PARAMETER", key)
            if upper.endswith("LAYERS"):
                need("EXTERNAL_WMS:" not in rendered.upper(),
                     "EXTERNAL_LAYER", "Receive external layers through the original publisher before review")
            if upper in ("WIDTH", "HEIGHT"):
                need(str(value).isdigit() and 1 <= int(value) <= 4096,
                     "IMAGE_LIMIT", "Choose an image dimension from 1 to 4096")
            if upper == "FEATURE_COUNT":
                need(str(value).isdigit() and 1 <= int(value) <= 1000,
                     "FEATURE_LIMIT", "FEATURE_COUNT must be from 1 to 1000")
        validate_expect(check.get("expect", {}))
        overrides = check.get("role_expectations", {})
        need(isinstance(overrides, dict) and set(overrides) <= role_ids,
             "UNKNOWN_ROLE", "A role expectation must name a selected existing role")
        for override in overrides.values():
            validate_expect(override)
    return copy.deepcopy(plan)


def request_for(plan, check):
    service = plan["service"]
    part = urllib.parse.urlsplit(service["url"])
    params = dict(urllib.parse.parse_qsl(part.query, keep_blank_values=True))
    if "map" in service:
        old = next((v for k, v in params.items() if k.upper() == "MAP"), None)
        need(old is None or old == service["map"], "MAP_CONFLICT", "The selected MAP paths differ")
        params = {k: v for k, v in params.items() if k.upper() != "MAP"}
        params["MAP"] = service["map"]
    params.update({"SERVICE": "WMS", "VERSION": service.get("wms_version", "1.3.0"),
                   "REQUEST": check["operation"]})
    for key, value in check.get("params", {}).items():
        params[key] = str(value).lower() if isinstance(value, bool) else str(value)
    query = urllib.parse.urlencode(sorted(params.items()))
    return {"method": "GET", "url": urllib.parse.urlunsplit(
        (part.scheme, part.netloc, part.path, query, "")), "params": params,
        "operation": check["operation"]}


def local_name(tag):
    return tag.rsplit("}", 1)[-1]


def xml_root(raw):
    upper = raw[:MAX_BODY].upper()
    need(b"<!DOCTYPE" not in upper and b"<!ENTITY" not in upper,
         "XML_DECLARATION", "DTD and entity declarations are not accepted in service metadata")
    try:
        return ET.fromstring(raw)
    except ET.ParseError as exc:
        raise AcceptanceError("INVALID_XML", str(exc)) from exc


def children(node, name):
    return [x for x in node if local_name(x.tag) == name]


def child_text(node, name):
    values = children(node, name)
    return (values[0].text or "").strip() if values else None


def capability_model(raw):
    root = xml_root(raw)
    need(local_name(root.tag) in ("WMS_Capabilities", "WMT_MS_Capabilities"),
         "NOT_CAPABILITIES", "The response is not native WMS capabilities")
    layers, templates, formats = [], [], {}
    keywords = [node.text or "" for service in children(root, "Service")
                for group in children(service, "KeywordList") for node in children(group, "Keyword")]
    def walk(node, inherited, path):
        own_crs = [v.strip() for x in node if local_name(x.tag) in ("CRS", "SRS")
                   for v in (x.text or "").split() if v.strip()]
        crs = sorted(set(inherited["crs"] + own_crs))
        queryable = node.get("queryable", inherited["queryable"])
        styles = dict(inherited["styles"])
        for style in children(node, "Style"):
            name = child_text(style, "Name")
            if name:
                styles[name] = {"name": name, "title": child_text(style, "Title")}
        boxes = dict(inherited["boxes"])
        for box in children(node, "BoundingBox"):
            reference = box.get("CRS") or box.get("SRS")
            if reference:
                boxes[reference] = {k: box.get(k) for k in ("minx", "miny", "maxx", "maxy")}
        name, title = child_text(node, "Name"), child_text(node, "Title")
        current = path + ([title or name] if title or name else [])
        state = {"crs": crs, "queryable": queryable, "styles": styles, "boxes": boxes}
        if name:
            layers.append({"name": name, "title": title, "path": current,
                           "queryable": str(queryable).lower() in ("1", "true"),
                           "crs": crs, "styles": [styles[k] for k in sorted(styles)],
                           "bounding_boxes": boxes})
        for layer in children(node, "Layer"):
            walk(layer, state, current)
    for capability in children(root, "Capability"):
        for layer in children(capability, "Layer"):
            walk(layer, {"crs": [], "queryable": "0", "styles": {}, "boxes": {}}, [])
        for request in children(capability, "Request"):
            for operation in request:
                formats[local_name(operation.tag)] = [x.text.strip() for x in children(operation, "Format")
                                                      if x.text]
    for template in root.iter():
        if local_name(template.tag) == "ComposerTemplate":
            templates.append({"name": template.get("name"),
                              "width": template.get("width"), "height": template.get("height"),
                              "maps": [{"name": x.get("name"), "width": x.get("width"),
                                        "height": x.get("height")} for x in template
                                       if local_name(x.tag) == "ComposerMap"]})
    return {"version": root.get("version"), "layers": layers, "templates": templates,
            "formats": formats, "keywords": keywords}


def native_exception(raw):
    if not raw.lstrip().startswith(b"<"):
        return None
    try:
        root = xml_root(raw)
    except AcceptanceError:
        return None
    if local_name(root.tag) not in ("ServiceExceptionReport", "ExceptionReport"):
        return None
    result = []
    for node in root.iter():
        if local_name(node.tag) in ("ServiceException", "Exception"):
            result.append({"code": node.get("code") or node.get("exceptionCode"),
                           "locator": node.get("locator"),
                           "message": " ".join(x.strip() for x in node.itertext() if x.strip())[:4000]})
    return result or [{"code": None, "message": "Native service exception"}]


def png_dimensions(raw):
    need(raw[:8] == b"\x89PNG\r\n\x1a\n", "NOT_PNG", "The native map response is not PNG")
    offset, size, saw_data, finished = 8, None, False, False
    while offset + 12 <= len(raw):
        count = int.from_bytes(raw[offset:offset + 4], "big")
        kind = raw[offset + 4:offset + 8]
        end = offset + 12 + count
        need(end <= len(raw), "INCOMPLETE_PNG", "The original map body ends inside a PNG chunk")
        data = raw[offset + 8:offset + 8 + count]
        crc = int.from_bytes(raw[offset + 8 + count:end], "big")
        need(zlib.crc32(kind + data) & 0xffffffff == crc, "PNG_CHUNK_HASH", "The original map has a damaged PNG chunk")
        if offset == 8:
            need(kind == b"IHDR" and count == 13, "PNG_HEADER", "The original PNG header is invalid")
            size = [int.from_bytes(data[:4], "big"), int.from_bytes(data[4:8], "big")]
            need(all(1 <= x <= 4096 for x in size), "PNG_DIMENSIONS", "The native map exceeds its selected pixel limit")
        if kind == b"IDAT":
            saw_data = True
        if kind == b"IEND":
            need(count == 0 and end == len(raw), "PNG_TRAILER", "The original PNG trailer is incomplete")
            finished = True
            break
        offset = end
    need(size and saw_data and finished, "INCOMPLETE_PNG", "The native map lacks complete image data")
    return size



def feature_info_model(raw, media, expect):
    """Preserve original native values and ordered attributes, including groups."""
    if media in ("application/json", "application/geo+json"):
        value = load_json(raw)
        need(isinstance(value, dict) and value.get("type") == "FeatureCollection" and
             isinstance(value.get("features"), list), "NOT_FEATURE_COLLECTION",
             "The selected JSON response is not a native FeatureCollection")
        features, fields = [], []
        for index, feature in enumerate(value["features"]):
            need(isinstance(feature, dict) and feature.get("type") == "Feature", "INVALID_FEATURE",
                 "A native feature response contains a malformed Feature")
            properties = feature.get("properties")
            need(properties is None or isinstance(properties, dict), "INVALID_PROPERTIES",
                 "Native JSON feature properties must be an object or null")
            identity = str(feature["id"]) if "id" in feature else None
            attributes = [{"sequence": i, "name": name, "value": original, "group_path": []}
                          for i, (name, original) in enumerate((properties or {}).items())]
            features.append({"sequence": index, "id": identity,
                "attributes": attributes, "geometry": copy.deepcopy(feature.get("geometry")),
                "foreign_members": {k: copy.deepcopy(v) for k, v in feature.items()
                                    if k not in ("type", "id", "properties", "geometry")}})
            fields.extend({**item, "layer": None, "feature_id": identity} for item in attributes)
        return {"format": "GeoJSON", "field_structure": "geojson_properties", "feature_count": len(features),
                "feature_ids": [x["id"] for x in features if x["id"] is not None],
                "features": features, "fields": fields,
                "property_names": sorted({x["name"] for x in fields}),
                "foreign_members": {k: copy.deepcopy(v) for k, v in value.items()
                                    if k not in ("type", "features")}}
    if media in ("text/xml", "application/xml", "application/vnd.ogc.gml"):
        root = xml_root(raw)
        name = local_name(root.tag)
        selected_root = expect.get("xml_root")
        root_matches = (root.tag == selected_root if selected_root and selected_root.startswith("{") else
                        name == selected_root if selected_root else name in ("GetFeatureInfoResponse", "FeatureCollection"))
        need(root_matches, "NOT_FEATURE_RESPONSE", "The selected XML root differs from the original project profile")
        fields, layers, ids = [], [], []
        count = 0
        def attributes(parent):
            out = []
            def visit(node, group_path, group_tags):
                for child in node:
                    child_name = local_name(child.tag)
                    if child_name == "Attribute":
                        out.append({"sequence": len(out), "name": child.get("name"),
                            "value": child.get("value"), "text": child.text,
                            "group_path": list(group_path), "group_tags": list(group_tags),
                            "xml_attributes": dict(child.attrib)})
                    elif child_name not in ("Feature", "Layer"):
                        visit(child, group_path + [child_name], group_tags + [child.tag])
            visit(parent, [], [])
            return out
        for layer in (x for x in root.iter() if local_name(x.tag) == "Layer"):
            layer_name = layer.get("name")
            direct = attributes(layer)
            entry = {"sequence": len(layers), "name": layer_name, "title": layer.get("title"),
                     "xml_attributes": dict(layer.attrib), "attributes": direct, "features": []}
            fields.extend({**item, "layer": layer_name, "feature_id": None} for item in direct)
            for feature in children(layer, "Feature"):
                identity = feature.get("id", feature.get("{http://www.opengis.net/gml}id"))
                values = attributes(feature)
                entry["features"].append({"sequence": len(entry["features"]), "id": identity,
                    "xml_attributes": dict(feature.attrib), "attributes": values})
                fields.extend({**item, "layer": layer_name, "feature_id": identity} for item in values)
                if identity is not None:
                    ids.append(identity)
                count += 1
            layers.append(entry)
        model = {"format": "native XML", "field_structure": "qgis_layer_attributes", "root": root.tag, "root_attributes": dict(root.attrib),
                 "feature_count": count, "feature_ids": ids, "layers": layers,
                 "fields": fields, "property_names": sorted({x["name"] for x in fields if x["name"] is not None})}
        if name == "FeatureCollection" and not layers:
            # Preserve the original GML tree without assigning QGIS aliases or IDs.
            def tree(node):
                return {"tag": node.tag, "attributes": dict(node.attrib), "text": node.text,
                        "tail": node.tail, "children": [tree(x) for x in node]}
            members = [x for x in root if local_name(x.tag) in ("featureMember", "member")]
            model.update({"field_structure": "unparsed_gml", "native_members": [tree(x) for x in members], "feature_count": len(members),
                          "feature_ids": [x.get("{http://www.opengis.net/gml}id")
                                          for member in members for x in member
                                          if x.get("{http://www.opengis.net/gml}id")]})
        return model
    if media in ("text/plain", "text/html") and media in expect.get("media_types", []):
        return {"field_structure": "unparsed_text", "feature_count": None, "feature_ids": [], "text": raw.decode("utf-8", errors="replace"),
                "review": "Review the retained original textual feature response"}
    raise AcceptanceError("FEATURE_INFO_FORMAT", "Select a feature-info format supported by this exact endpoint")


def evaluate_fields(expect, model, issues):
    selected = bool(expect.get("required_attributes") or expect.get("forbidden_attributes") or expect.get("attribute_rules"))
    if selected and model.get("field_structure") not in ("qgis_layer_attributes", "geojson_properties"):
        issues.append({"code": "FIELD_STRUCTURE_UNAVAILABLE",
                       "message": "The selected native format has no supported field model for these role expectations.",
                       "format": model.get("field_structure")})
        return
    if expect.get("attribute_rules") and model.get("field_structure") != "qgis_layer_attributes":
        issues.append({"code": "FIELD_LAYER_STRUCTURE_UNAVAILABLE",
                       "message": "Scoped layer/group rules require the original QGIS XML field structure."})
    names = set(model.get("property_names", []))
    missing = sorted(set(expect.get("required_attributes", [])) - names)
    if missing:
        issues.append({"code": "FEATURE_ATTRIBUTES", "missing": missing})
    forbidden = set(expect.get("forbidden_attributes", []))
    exposed = [x for x in model.get("fields", []) if x["name"] in forbidden]
    if exposed:
        issues.append({"code": "FORBIDDEN_ATTRIBUTES", "fields": exposed})
    for rule in expect.get("attribute_rules", []):
        fields = [x for x in model.get("fields", []) if x["layer"] == rule["layer"]
                  and ("feature_id" not in rule or x["feature_id"] == rule["feature_id"])
                  and ("group_path" not in rule or x["group_path"] == rule["group_path"])]
        actual = {x["name"] for x in fields}
        missing = sorted(set(rule.get("required", [])) - actual)
        disallowed = [x for x in fields if x["name"] in rule.get("forbidden", []) or
                      ("allowed" in rule and x["name"] not in rule["allowed"])]
        if missing or disallowed:
            issues.append({"code": "ROLE_ATTRIBUTE_RULE", "selection": rule,
                           "missing": missing, "unexpected": disallowed})


def evaluate(check, role_id, response, raw):
    expect = {**check.get("expect", {}), **check.get("role_expectations", {}).get(role_id, {})}
    issues, model = [], {}
    status = response["status"]
    media = response.get("media_type", "").split(";", 1)[0].lower()
    exceptions = native_exception(raw)
    allowed_status = expect.get("status", [200])
    if status not in allowed_status:
        issues.append({"code": "HTTP_STATUS", "expected": allowed_status, "actual": status})
    expected_codes = set(expect.get("denial_codes", []))
    if expected_codes and not exceptions:
        issues.append({"code": "EXPECTED_DENIAL_MISSING", "expected": sorted(expected_codes),
                       "message": "The selected role was expected to receive a native service denial."})
    if exceptions:
        model["exceptions"] = exceptions
        codes = {x["code"] for x in exceptions}
        if not expected_codes or not codes <= expected_codes:
            issues.append({"code": "SERVICE_EXCEPTION", "actual": exceptions})
    if media in ("text/html", "application/xhtml+xml") and not exceptions and not (check["operation"] == "GetFeatureInfo" and media in expect.get("media_types", [])):
        issues.append({"code": "HTML_RESPONSE", "message": "A login page or HTML response does not satisfy a WMS operation"})
    if expect.get("media_types") and media not in expect["media_types"]:
        issues.append({"code": "MEDIA_TYPE", "expected": expect["media_types"], "actual": media})
    if status not in (200, 201) or exceptions:
        return {"state": "PASS" if not issues else "REVIEW", "issues": issues, "model": model}
    operation = check["operation"]
    try:
        if operation in ("GetCapabilities", "GetProjectSettings"):
            model = capability_model(raw)
            by_name = {x["name"]: x for x in model["layers"]}
            missing_keywords = sorted(set(expect.get("required_keywords", [])) - set(model["keywords"]))
            if missing_keywords:
                issues.append({"code": "PUBLICATION_KEYWORD", "missing": missing_keywords,
                               "actual": model["keywords"]})
            for key, want_present in (("required_layers", True), ("forbidden_layers", False)):
                actual = [x for x in expect.get(key, []) if (x in by_name) != want_present]
                if actual:
                    issues.append({"code": key.upper(), "layers": actual})
            nonqueryable = [x for x in expect.get("queryable_layers", [])
                            if x not in by_name or not by_name[x]["queryable"]]
            if nonqueryable:
                issues.append({"code": "QUERYABLE_LAYERS", "layers": nonqueryable})
            for name in expect.get("required_layers", []):
                if name in by_name:
                    missing = sorted(set(expect.get("required_crs", [])) - set(by_name[name]["crs"]))
                    if missing:
                        issues.append({"code": "LAYER_CRS", "layer": name, "missing": missing})
            names = {x["name"] for x in model["templates"]}
            missing = sorted(set(expect.get("required_templates", [])) - names)
            if missing:
                issues.append({"code": "PRINT_TEMPLATES", "missing": missing})
        elif operation == "GetMap":
            width, height = png_dimensions(raw)
            model = {"image_size": [width, height]}
            if expect.get("image_size") and expect["image_size"] != [width, height]:
                issues.append({"code": "IMAGE_SIZE", "expected": expect["image_size"], "actual": [width, height]})
        elif operation == "GetPrint":
            need(raw.startswith(b"%PDF-") and b"%%EOF" in raw[-2048:],
                 "NOT_COMPLETE_PDF", "Retain the complete original PDF print response")
            model = {"pdf_version": raw[:8].decode("ascii", errors="replace"),
                     "visual_review": "Open the retained PDF and review its selected layout"}
        elif operation == "GetFeatureInfo":
            model = feature_info_model(raw, media, expect)
            ids = model["feature_ids"]
            evaluate_fields(expect, model, issues)
            if expect.get("feature_ids") and model["feature_count"] is None:
                issues.append({"code": "FEATURE_STRUCTURE_UNAVAILABLE", "message": "This textual response needs operator review"})
            else:
                missing = sorted(set(expect.get("feature_ids", [])) - set(ids))
                if missing:
                    issues.append({"code": "FEATURE_IDS", "missing": missing, "actual": ids})
            if "minimum_features" in expect:
                if model["feature_count"] is None or model["feature_count"] < expect["minimum_features"]:
                    issues.append({"code": "FEATURE_COUNT", "actual": model["feature_count"],
                                   "minimum": expect["minimum_features"]})
    except AcceptanceError as exc:
        issues.append(exc.as_dict())
    return {"state": "PASS" if not issues else "REVIEW", "issues": issues, "model": model}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, url):
        return None


def fetch_native(request, session=None, timeout=30, max_bytes=MAX_BODY):
    """One selected native GET through the host's normal configured transport."""
    need(request["method"] == "GET", "METHOD", "Only native publication reads are supported")
    headers = {"Accept": "*/*", "Accept-Encoding": "identity",
               "User-Agent": "Starforge-QWC-Publication-Acceptance/1"}
    if session:
        supplied = session.get("headers", {})
        need(isinstance(supplied, dict) and set(k.lower() for k in supplied) <= {"authorization", "cookie"},
             "SESSION_HEADERS", "Use the existing session's Authorization or Cookie header")
        for name, value in supplied.items():
            need(isinstance(value, str) and value and "\r" not in value and "\n" not in value,
                 "SESSION_HEADER", "A session header is malformed")
            headers[name] = value
    original = urllib.request.Request(request["url"], headers=headers, method="GET")
    started = time.monotonic()
    opener = urllib.request.build_opener(NoRedirect())
    try:
        response = opener.open(original, timeout=timeout)
    except urllib.error.HTTPError as exc:
        response = exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise AcceptanceError("NATIVE_TRANSPORT", type(exc).__name__ + ": " + str(getattr(exc, "reason", exc))[:500]) from exc
    with response:
        status = response.status
        observed_headers = {}
        for name in SAFE_HEADERS:
            values = response.headers.get_all(name)
            if values:
                observed_headers[name] = values
        raw = bytearray()
        while True:
            need(time.monotonic() - started <= timeout, "CAPTURE_TIMEOUT", "The native response exceeded its deadline")
            part = response.read1(min(65536, max_bytes + 1 - len(raw)))
            if not part:
                break
            raw.extend(part)
            need(len(raw) <= max_bytes, "CAPTURE_LIMIT", "The native response exceeds the selected byte limit")
        declared = response.headers.get("Content-Length")
        if declared and declared.isdigit():
            need(len(raw) == int(declared), "INCOMPLETE_RESPONSE", "The native body differs from Content-Length")
        return bytes(raw), {"status": status, "headers": observed_headers,
                            "media_type": response.headers.get("Content-Type", "application/octet-stream"),
                            "observed_at": stamp(), "transport": "native_http_get",
                            "duration_ms": round((time.monotonic() - started) * 1000)}


class PublicationReview:
    def __init__(self, directory):
        self.root = Path(directory).absolute()
        self.state_path = self.root / "review.json"
        state = self.read()
        need(state.get("schema") == SCHEMA, "WORKSPACE_SCHEMA", "Not a publication review workspace")
        self.workspace_id = state["id"]

    @classmethod
    def create(cls, directory, title):
        target = Path(directory).absolute()
        text(title, "title", 300)
        need(not target.exists() and not target.is_symlink(), "DESTINATION_EXISTS", "Choose a new review directory")
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = Path(tempfile.mkdtemp(prefix="." + target.name + "-", dir=target.parent))
        try:
            retain(temporary / "review.json", pack({"schema": SCHEMA, "id": str(uuid.uuid4()),
                    "title": title, "revision": 0, "created_at": stamp(),
                    "runs": {}, "reviews": {}, "events": [], "operations": {}}))
            os.rename(temporary, target)
            fsync_directory(target.parent)
        finally:
            if temporary.exists():
                shutil.rmtree(temporary)
        return cls(target)

    def read(self):
        return load_json(read_file(self.state_path, 64 * 1024 * 1024))

    @contextlib.contextmanager
    def locked(self):
        fd = os.open(self.root / "review.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            info = os.fstat(fd)
            need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1,
                 "LOCK_FILE", "The original review lock must be a private regular file")
            fcntl.flock(fd, fcntl.LOCK_EX)
            yield
        finally:
            os.close(fd)

    def verify(self, item):
        path = self.root / relative(item["path"])
        try:
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        except FileNotFoundError as exc:
            raise AcceptanceError("RETAINED_ARTIFACT_UNAVAILABLE",
                 "The original receipt is retained; this receiving directory does not contain that artifact.",
                 path=item["path"], sha256=item["sha256"], bytes=item["bytes"]) from exc
        try:
            info = os.fstat(fd)
            need(stat.S_ISREG(info.st_mode) and info.st_size == item["bytes"],
                 "RETAINED_BYTES_CHANGED", item["path"])
            h, count = hashlib.sha256(), 0
            with os.fdopen(fd, "rb", closefd=False) as stream:
                while part := stream.read(1024 * 1024):
                    count += len(part)
                    h.update(part)
            need(count == item["bytes"] and h.hexdigest() == item["sha256"],
                 "RETAINED_BYTES_CHANGED", item["path"])
        finally:
            os.close(fd)
        return path

    def receiving_context(self):
        path = self.root / "receiving-context.json"
        return load_json(read_file(path, MAX_CONFIG)) if path.exists() else None

    def member(self, item):
        path = self.root / relative(item["path"])
        raw = read_file(path, max(MAX_BODY, item["bytes"]))
        need(len(raw) == item["bytes"] and sha(raw) == item["sha256"],
             "RETAINED_BYTES_CHANGED", f"Retained bytes differ: {item['path']}")
        return raw

    def mutate(self, kind, operation_id, actor, request, callback, expected_revision=None, resume_local=False):
        identifier(operation_id, "operation_id")
        text(actor, "actor", 200)
        fingerprint = sha(pack({"kind": kind, "request": request, "actor": actor}))
        with self.locked():
            state = self.read()
            previous = state["operations"].get(operation_id)
            if previous:
                need(previous["fingerprint"] == fingerprint, "OPERATION_INPUT_CHANGED",
                     "A retained operation ID cannot select different input")
                if previous["state"] == "COMPLETE":
                    return copy.deepcopy(previous["result"])
                context = self.receiving_context()
                snapshot_export = state.get("export_provenance", {}).get("operation_id")
                imported_snapshot = snapshot_export == operation_id and not (self.root / "exports" / f"{operation_id}.prepared.json").exists()
                need(not imported_snapshot and not (context and operation_id in context["original_operation_ids"]),
                     "IMPORTED_OPERATION_HISTORY", "This operation belongs to the imported original workspace snapshot. Select a new receiving operation to continue.", original_operation=operation_id, source_archive_sha256=context["archive_sha256"] if context else None)
                if previous["state"] == "FAILED" and not resume_local:
                    raise AcceptanceError("RETAINED_FAILED_OPERATION",
                         "This original operation failed. Inspect it before selecting a new operation.",
                         original_error=previous["error"])
            elif expected_revision is not None:
                need(state["revision"] == expected_revision, "REVISION_CHANGED",
                     "Review current state before saving this change", actual_revision=state["revision"])
            started = previous["started_at"] if previous else stamp()
            attempts = copy.deepcopy(previous.get("attempts", [])) if previous else []
            if previous:
                attempts.append({k: v for k, v in previous.items() if k != "attempts"})
            state["operations"][operation_id] = {"kind": kind, "fingerprint": fingerprint,
                "actor": actor, "request": request, "state": "RUNNING", "started_at": started, "attempts": attempts}
            replace_json(self.state_path, state)
            try:
                result = callback(state, fingerprint)
            except Exception as exc:
                state["operations"][operation_id].update({"state": "FAILED", "ended_at": stamp(),
                    "error": exc.as_dict() if isinstance(exc, AcceptanceError)
                             else {"code": type(exc).__name__, "message": str(exc)[:1000]}})
                replace_json(self.state_path, state)
                raise
            state["revision"] += 1
            event = {"revision": state["revision"], "operation_id": operation_id, "kind": kind,
                     "actor": actor, "at": stamp()}
            state["events"].append(event)
            state["operations"][operation_id].update({"state": "COMPLETE", "ended_at": event["at"], "result": result})
            replace_json(self.state_path, state)
            return copy.deepcopy(result)

    def add_run(self, plan, sources, *, operation_id, actor, expected_revision=None):
        plan = validate_plan(plan)
        need(isinstance(sources, dict) and 1 <= len(sources) <= 100,
             "ORIGINAL_SOURCES", "Retain the selected original publication/source manifest files")
        source_items = []
        for name, raw in sorted(sources.items()):
            relative(name)
            need(isinstance(raw, bytes) and len(raw) <= MAX_SOURCE,
                 "SOURCE_LIMIT", "Each selected source manifest must be bytes below 16 MiB")
            source_items.append(descriptor("runs/" + plan["run_id"] + "/source/" + name, raw))
        request = {"plan": plan, "sources": source_items}
        def apply(state, fingerprint):
            run_id = plan["run_id"]
            old = state["runs"].get(run_id)
            need(old is None or old["fingerprint"] == fingerprint,
                 "RUN_EXISTS", "This run ID already selects a different publication or plan")
            if old is not None:
                self.verify(old["plan"])
                for item in old["sources"]:
                    self.verify(item)
                return {"run_id": run_id, "plan_sha256": old["plan"]["sha256"], "sources": old["sources"]}
            for name, raw in sorted(sources.items()):
                retain(self.root / "runs" / run_id / "source" / relative(name), raw)
            plan_raw = pack(plan)
            plan_item = descriptor(f"runs/{run_id}/plan.json", plan_raw, "application/json")
            retain(self.root / plan_item["path"], plan_raw)
            result = {"id": run_id, "title": plan["title"], "publication": plan["publication"],
                      "fingerprint": fingerprint, "plan": plan_item, "sources": source_items,
                      "captures": {}, "created_at": old["created_at"] if old else stamp()}
            state["runs"][run_id] = result
            return {"run_id": run_id, "plan_sha256": plan_item["sha256"], "sources": source_items}
        return self.mutate("add_run", operation_id, actor, request, apply, expected_revision)

    def plan(self, run_id):
        identifier(run_id, "run_id")
        state = self.read()
        need(run_id in state["runs"], "RUN_NOT_FOUND", run_id)
        return validate_plan(load_json(self.member(state["runs"][run_id]["plan"])))

    def capture(self, run_id, check_id, role_id, *, operation_id, actor, session=None,
                supplied=None, transport=fetch_native):
        plan = self.plan(run_id)
        check = next((x for x in plan["checks"] if x["id"] == check_id), None)
        role = next((x for x in plan["roles"] if x["id"] == role_id), None)
        need(check is not None and role is not None, "SELECTION_NOT_FOUND", "Select an existing check and role")
        request = request_for(plan, check)
        binding = {"run_id": run_id, "check_id": check_id, "role_id": role_id,
                   "plan_sha256": sha(pack(plan)), "request": request,
                   "principal_reference": role.get("principal_reference"),
                   "publication": copy.deepcopy(plan["publication"])}
        if supplied:
            need(isinstance(supplied, (tuple, list)) and len(supplied) in (2, 3),
                 "IMPORTED_RESPONSE", "Supply the complete native body, observed metadata, and original metadata bytes when available")
            raw, meta = supplied[:2]
            need(isinstance(meta, dict), "IMPORTED_METADATA", "The original metadata must be an object")
            metadata_raw = supplied[2] if len(supplied) == 3 else pack(meta)
            need(isinstance(metadata_raw, bytes) and len(metadata_raw) <= MAX_CONFIG
                 and load_json(metadata_raw) == meta, "IMPORTED_METADATA_BYTES",
                 "The original metadata bytes must match the selected observed metadata")
            need(isinstance(raw, bytes) and len(raw) <= MAX_BODY,
                 "CAPTURE_LIMIT", "The original native response exceeds 32 MiB")
            need(meta.get("role_id") == role_id and meta.get("principal_reference") == role.get("principal_reference"),
                 "IMPORTED_ROLE_CHANGED", "The original native capture must bind the selected role and principal reference")
            need(meta.get("request") == request, "CAPTURE_REQUEST_CHANGED",
                 "Imported native request must match the exact selected request")
            same_publication = meta.get("publication") == plan["publication"]
            same_plan = meta.get("plan_sha256") == binding["plan_sha256"]
            need(same_publication or same_plan, "IMPORTED_PUBLICATION_CHANGED",
                 "The original native capture must identify this exact publication or its original complete plan",
                 selected_publication=plan["publication"])

            if isinstance(meta.get("body"), dict):
                need(meta["body"].get("bytes") == len(raw) and meta["body"].get("sha256") == sha(raw),
                     "IMPORTED_BODY_CHANGED", "The original response receipt identifies different body bytes")
            binding["imported"] = {"bytes": len(raw), "sha256": sha(raw),
                                   "metadata_bytes": len(metadata_raw), "metadata_sha256": sha(metadata_raw)}

        def apply(state, fingerprint):
            directory = self.root / "captures" / identifier(operation_id)
            metadata_path = directory / "capture.json"
            if metadata_path.exists():
                result = load_json(read_file(metadata_path, MAX_BODY))
                need(result["fingerprint"] == fingerprint, "CAPTURE_CONFLICT", "Retained capture input differs")
                self.member(result["body"])
            else:
                if supplied:
                    body, incoming = supplied[:2]
                    original_response = incoming.get("response", incoming)
                    need(isinstance(original_response, dict), "IMPORTED_RESPONSE", "Retain the original response observation")
                    observed = {k: copy.deepcopy(original_response[k]) for k in
                                ("status", "headers", "media_type", "observed_at", "duration_ms") if k in original_response}
                    observed["transport"] = "imported_native_response"
                else:
                    need(session is None or session.get("role_id") == role_id,
                         "SESSION_ROLE", "Use the selected existing role's session")
                    if role["authentication"] == "existing_session":
                        need(session and session.get("headers"), "SESSION_REQUIRED",
                             "Supply the selected role's existing authorized session for this operation")
                        need(session.get("principal_reference") == role.get("principal_reference"),
                             "SESSION_PRINCIPAL", "The session must bind the selected principal reference")
                    else:
                        need(not session or not session.get("headers"), "ANONYMOUS_ROLE",
                             "The anonymous check does not use another role's session")
                    body, observed = transport(request, session=session)
                need(isinstance(body, bytes) and len(body) <= MAX_BODY, "CAPTURE_LIMIT", "Native response is too large")
                need(isinstance(observed.get("status"), int) and 100 <= observed["status"] <= 599,
                     "HTTP_STATUS", "Record the actual HTTP status")
                need(isinstance(observed.get("headers", {}), dict), "RESPONSE_HEADERS", "Record response header lists")
                safe = {}
                for key, values in observed.get("headers", {}).items():
                    if key.lower() in SAFE_HEADERS:
                        need(isinstance(values, list) and all(isinstance(x, str) for x in values),
                             "RESPONSE_HEADERS", "Preserve each observed header value")
                        safe[key.lower()] = values
                observed["headers"] = safe
                text(observed.get("observed_at"), "observed_at", 100)
                try:
                    dt.datetime.fromisoformat(observed["observed_at"].replace("Z", "+00:00"))
                except ValueError as exc:
                    raise AcceptanceError("OBSERVED_TIME", "Use the original ISO observation time") from exc
                observed.setdefault("media_type", "application/octet-stream")
                item = descriptor(f"captures/{operation_id}/body", body, observed["media_type"])
                result = {"schema": SCHEMA, "operation_id": operation_id, "fingerprint": fingerprint,
                          **binding, "response": observed, "body": item,
                          "evaluation": evaluate(check, role_id, observed, body)}
                retain(self.root / item["path"], body)
                if supplied:
                    imported_item = descriptor(f"captures/{operation_id}/imported-metadata.json", metadata_raw, "application/json")
                    retain(self.root / imported_item["path"], metadata_raw)
                    result["imported_metadata"] = imported_item
                retain(metadata_path, pack(result))
            state["runs"][run_id]["captures"].setdefault(check_id, {}).setdefault(role_id, [])
            captures = state["runs"][run_id]["captures"][check_id][role_id]
            if operation_id not in captures:
                captures.append(operation_id)
            return result
        result = self.mutate("capture", operation_id, actor, binding, apply)
        self.member(result["body"])
        return result

    def capture_record(self, capture_id):
        identifier(capture_id, "capture_id")
        value = load_json(read_file(self.root / "captures" / capture_id / "capture.json", MAX_BODY))
        self.verify(value["body"])
        return value

    def save_review(self, capture_id, decision, note, *, operation_id, actor, expected_revision):
        need(decision in ("accepted", "correction_required", "not_applicable"),
             "REVIEW_DECISION", "Select accepted, correction_required or not_applicable")
        text(note, "review note", 8000)
        capture = self.capture_record(capture_id)
        request = {"capture_id": capture_id, "capture_sha256": sha(pack(capture)),
                   "decision": decision, "note": note}
        def apply(state, fingerprint):
            review = {**request, "actor": actor, "at": stamp(), "operation_id": operation_id}
            state["reviews"].setdefault(capture_id, []).append(review)
            return review
        return self.mutate("review", operation_id, actor, request, apply, expected_revision)

    def overview(self):
        state = self.read()
        result = {k: state[k] for k in ("schema", "id", "title", "revision", "created_at", "reviews", "events", "operations")}
        context = self.receiving_context()
        if context:
            result["receiving_context"] = context
            result["operations"] = copy.deepcopy(result["operations"])
            for operation_id, operation in result["operations"].items():
                if operation_id in context["original_operation_ids"] and operation["state"] == "RUNNING":
                    operation["view_state"] = "RETAINED_RUNNING_HISTORY"
        result["runs"] = []
        for run in state["runs"].values():
            plan = load_json(self.member(run["plan"]))
            item = copy.deepcopy(run)
            item["roles"], item["checks"], item["service"] = plan["roles"], plan["checks"], plan["service"]
            item["results"] = {}
            for check_id, roles in run["captures"].items():
                for role_id, ids in roles.items():
                    item["results"][check_id + "/" + role_id] = [self.capture_record(value) for value in ids]
            result["runs"].append(item)
        return result

    def compare(self, left_id, right_id):
        state = self.read()
        need(left_id in state["runs"] and right_id in state["runs"], "RUN_NOT_FOUND", "Select two retained runs")
        left, right = state["runs"][left_id], state["runs"][right_id]
        changes = []
        keys = {(c, r) for run in (left, right) for c, roles in run["captures"].items() for r in roles}
        for check_id, role_id in sorted(keys):
            values = []
            for run in (left, right):
                ids = run["captures"].get(check_id, {}).get(role_id, [])
                values.append(self.capture_record(ids[-1]) if ids else None)
            a, b = values
            row = {"check_id": check_id, "role_id": role_id,
                   "left": a["operation_id"] if a else None, "right": b["operation_id"] if b else None}
            if not a or not b:
                row["state"] = "missing_response"
            else:
                row.update({"state": "same_bytes" if a["body"]["sha256"] == b["body"]["sha256"] else "changed_bytes",
                            "request_changed": a["request"] != b["request"],
                            "status": [a["response"]["status"], b["response"]["status"]],
                            "evaluation": [a["evaluation"]["state"], b["evaluation"]["state"]],
                            "model_changes": object_diff(a["evaluation"]["model"], b["evaluation"]["model"])})
            changes.append(row)
        return {"left_run": left_id, "right_run": right_id, "publication_changed": left["publication"] != right["publication"],
                "left_publication": left["publication"], "right_publication": right["publication"], "changes": changes}

    def export(self, *, operation_id, actor, expected_revision=None):
        request = {"workspace_id": self.workspace_id}
        def apply(state, fingerprint):
            path = self.root / "exports" / f"{operation_id}.zip"
            receipt_path = self.root / "exports" / f"{operation_id}.json"
            prepared_path = self.root / "exports" / f"{operation_id}.prepared.json"
            if receipt_path.exists():
                receipt = load_json(read_file(receipt_path, MAX_CONFIG))
                self.verify(receipt["archive"])
                return receipt
            if prepared_path.exists():
                prepared = load_json(read_file(prepared_path, MAX_CONFIG))
                need(prepared["fingerprint"] == fingerprint, "EXPORT_INPUT_CHANGED", "The original export selection differs")
            else:
                selected = {}
                snapshot = copy.deepcopy(state)
                snapshot["export_provenance"] = {"operation_id": operation_id, "at": stamp(),
                    "source_workspace_id": self.workspace_id,
                    "history": "The selected consistent state retains this export's original in-progress request."}
                snapshot_raw = pack(snapshot)
                snapshot_item = descriptor(f"exports/{operation_id}.snapshot.json", snapshot_raw)
                retain(self.root / snapshot_item["path"], snapshot_raw)
                selected["workspace/review.json"] = snapshot_item
                for run in state["runs"].values():
                    for item in [run["plan"], *run["sources"]]:
                        self.verify(item)
                        selected["workspace/" + item["path"]] = item
                    for roles in run["captures"].values():
                        for ids in roles.values():
                            for capture_id in ids:
                                record = self.capture_record(capture_id)
                                selected["workspace/" + record["body"]["path"]] = record["body"]
                                if record.get("imported_metadata"):
                                    self.verify(record["imported_metadata"])
                                    selected["workspace/" + record["imported_metadata"]["path"]] = record["imported_metadata"]
                                record_raw = pack(record)
                                selected[f"workspace/captures/{capture_id}/capture.json"] = descriptor(
                                    f"captures/{capture_id}/capture.json", record_raw)
                base = Path(__file__).parent
                for name in ("qwc_acceptance.py", "server.py", "publication_plan.py", "native_journey.py",
                             "browser_journey.mjs", "OPERATIONS.md", "PUBLICATION_CONTRACT.md", "QWC_SOURCE_CONTRACTS.md",
                             "static/index.html", "static/app.js", "static/style.css", "static/review-store.js"):
                    raw = read_file(base / name, MAX_SOURCE)
                    item = descriptor("export-software/" + sha(raw) + "/" + name, raw)
                    retain(self.root / item["path"], raw)
                    selected["software/" + name] = item
                report_raw = render_report(self.overview()).encode("utf-8")
                report_item = descriptor(f"exports/{operation_id}.report.html", report_raw, "text/html")
                retain(self.root / report_item["path"], report_raw)
                selected["index.html"] = report_item
                manifest = {"schema": SCHEMA, "workspace_id": self.workspace_id,
                            "revision": state["revision"], "operation_id": operation_id,
                            "operation_fingerprint": fingerprint,
                            "members": [{**item, "path": name} for name, item in sorted(selected.items())]}
                manifest_raw = pack(manifest)
                manifest_item = descriptor(f"exports/{operation_id}.manifest.json", manifest_raw)
                retain(self.root / manifest_item["path"], manifest_raw)
                selected["manifest.json"] = manifest_item
                prepared = {"fingerprint": fingerprint, "selected": selected, "manifest_sha256": sha(manifest_raw)}
                retain(prepared_path, pack(prepared))
            selected = prepared["selected"]
            need(sum(item["bytes"] for item in selected.values()) <= 512 * 1024 * 1024,
                 "EXPORT_SIZE", "The selected complete handover exceeds 512 MiB")
            if path.exists() or path.is_symlink():
                # A completed ZIP can outlive a final receipt write; verify its
                # exact frozen input and restore only that missing receipt.
                with zipfile.ZipFile(path) as archive:
                    names = archive.namelist()
                    need(len(names) == len(set(names)) and set(names) == set(selected),
                         "RETAINED_EXPORT_INVENTORY", "Preserve the existing archive with a different inventory")
                    for name, item in selected.items():
                        info = archive.getinfo(name)
                        need(info.file_size == item["bytes"], "RETAINED_EXPORT_SIZE", name)
                        h, count = hashlib.sha256(), 0
                        with archive.open(name) as stream:
                            while part := stream.read(1024 * 1024):
                                count += len(part)
                                h.update(part)
                        need(count == item["bytes"] and h.hexdigest() == item["sha256"],
                             "RETAINED_EXPORT_HASH", name)
            else:
                path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                fd, temporary = tempfile.mkstemp(prefix="." + operation_id + "-", dir=path.parent)
                try:
                    os.close(fd)
                    with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
                        for name, item in sorted(selected.items()):
                            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
                            info.external_attr = 0o100600 << 16
                            info.compress_type = zipfile.ZIP_STORED if name.endswith("/body") else zipfile.ZIP_DEFLATED
                            h, count = hashlib.sha256(), 0
                            source_path = self.root / relative(item["path"])
                            source_fd = os.open(source_path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                            try:
                                info_source = os.fstat(source_fd)
                                need(stat.S_ISREG(info_source.st_mode) and info_source.st_size == item["bytes"],
                                     "EXPORT_MEMBER_CHANGED", item["path"])
                                with os.fdopen(source_fd, "rb", closefd=False) as source, archive.open(info, "w", force_zip64=True) as target:
                                    while part := source.read(1024 * 1024):
                                        count += len(part)
                                        h.update(part)
                                        target.write(part)
                            finally:
                                os.close(source_fd)
                            need(count == item["bytes"] and h.hexdigest() == item["sha256"],
                                 "EXPORT_MEMBER_CHANGED", item["path"])
                    fd = os.open(temporary, os.O_RDONLY)
                    try:
                        os.fsync(fd)
                    finally:
                        os.close(fd)
                    os.link(temporary, path)
                    fsync_directory(path.parent)
                finally:
                    with contextlib.suppress(FileNotFoundError):
                        os.unlink(temporary)
            h, count = hashlib.sha256(), 0
            with path.open("rb") as source:
                while part := source.read(1024 * 1024):
                    count += len(part)
                    h.update(part)
            receipt = {"schema": SCHEMA, "workspace_id": self.workspace_id, "operation_id": operation_id,
                       "archive": {"path": f"exports/{operation_id}.zip", "bytes": count,
                                   "sha256": h.hexdigest(), "media_type": "application/zip"},
                       "member_count": len(selected), "manifest_sha256": prepared["manifest_sha256"]}
            retain(receipt_path, pack(receipt))
            return receipt
        result = self.mutate("export", operation_id, actor, request, apply, expected_revision, resume_local=True)
        self.verify(result["archive"])
        return result


def object_diff(left, right, path=""):
    if type(left) is not type(right):
        return [{"path": path or "/", "left": left, "right": right}]
    if isinstance(left, dict):
        out = []
        for key in sorted(set(left) | set(right)):
            here = path + "/" + str(key).replace("~", "~0").replace("/", "~1")
            if key not in left or key not in right:
                out.append({"path": here, "left_present": key in left, "right_present": key in right,
                            "left": left.get(key), "right": right.get(key)})
            else:
                out.extend(object_diff(left[key], right[key], here))
        return out
    if isinstance(left, list):
        named = all(isinstance(x, dict) and isinstance(x.get("name"), str)
                    and "sequence" not in x and "group_path" not in x for x in left + right)
        if named and len({x["name"] for x in left}) == len(left) and len({x["name"] for x in right}) == len(right):
            return object_diff({x["name"]: x for x in left}, {x["name"]: x for x in right}, path)
        out = []
        for index in range(max(len(left), len(right))):
            here = path + "/" + str(index)
            if index >= len(left) or index >= len(right):
                out.append({"path": here, "left_present": index < len(left), "right_present": index < len(right),
                            "left": left[index] if index < len(left) else None, "right": right[index] if index < len(right) else None})
            else:
                out.extend(object_diff(left[index], right[index], here))
        return out
    return [] if left == right else [{"path": path or "/", "left": left, "right": right}]


def receive(archive_path, destination, *, expected_sha256=None):
    raw = read_file(archive_path, 512 * 1024 * 1024)
    if expected_sha256:
        need(sha(raw) == expected_sha256, "ARCHIVE_SHA", "The complete archive differs from the original receipt")
    target = Path(destination).absolute()
    need(not target.exists() and not target.is_symlink(), "DESTINATION_EXISTS", "Receive into a new directory")
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        names = archive.namelist()
        need(len(names) == len(set(names)) and len(names) <= 20000, "ARCHIVE_INVENTORY", "Invalid archive inventory")
        for item in archive.infolist():
            relative(item.filename)
            need(not item.is_dir() and stat.S_IFMT(item.external_attr >> 16) in (0, stat.S_IFREG),
                 "ARCHIVE_MEMBER", "Only regular file members are accepted")
        need(archive.getinfo("manifest.json").file_size <= MAX_CONFIG, "ARCHIVE_MANIFEST_SIZE", "The original manifest exceeds 4 MiB")
        manifest = load_json(archive.read("manifest.json"))
        need(manifest.get("schema") == SCHEMA, "ARCHIVE_SCHEMA", "Not a complete publication review")
        members = manifest["members"]
        need(isinstance(members, list), "ARCHIVE_MANIFEST", "Original member descriptors are required")
        for item in members:
            need(isinstance(item, dict) and isinstance(item.get("bytes"), int) and 0 <= item["bytes"] <= 512 * 1024 * 1024 and isinstance(item.get("sha256"), str) and SHA.fullmatch(item["sha256"]), "ARCHIVE_DESCRIPTOR", "Invalid original member descriptor")
            relative(item["path"])
        expected = {x["path"]: x for x in members}
        need(set(names) == set(expected) | {"manifest.json"} and len(expected) == len(members),
             "ARCHIVE_INVENTORY", "The retained manifest and archive inventory differ")
        need(sum(x["bytes"] for x in members) <= 512 * 1024 * 1024,
             "ARCHIVE_SIZE", "The declared receiving size exceeds 512 MiB")
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = Path(tempfile.mkdtemp(prefix="." + target.name + "-", dir=target.parent))
        try:
            for name, item in expected.items():
                need(archive.getinfo(name).file_size == item["bytes"], "ARCHIVE_DECLARED_SIZE", name)
                data = archive.read(name)
                need(len(data) == item["bytes"] and sha(data) == item["sha256"],
                     "ARCHIVE_MEMBER_HASH", f"Original member differs: {name}")
                retain(temporary / name, data)
            retain(temporary / "manifest.json", pack(manifest))
            restored = PublicationReview(temporary / "workspace")
            need(restored.workspace_id == manifest["workspace_id"],
                 "WORKSPACE_ID", "The original workspace identity differs")
            restored.overview()
            retain(temporary / "workspace" / "receiving-context.json", pack({"schema": SCHEMA,
                "archive_sha256": sha(raw), "source_workspace_id": restored.workspace_id,
                "source_revision": restored.read()["revision"], "original_operation_ids": sorted(restored.read()["operations"])}))
            retain(temporary / "receiving.json", pack({"schema": SCHEMA, "archive_sha256": sha(raw),
                "bytes": len(raw), "workspace_id": restored.workspace_id, "received_at": stamp(),
                "original_export_history": "Retained unchanged; the receiving process creates its own later operations."}))
            os.rename(temporary, target)
            fsync_directory(target.parent)
        finally:
            if temporary.exists():
                shutil.rmtree(temporary)
    return {"directory": str(target), "workspace": str(target / "workspace"),
            "workspace_id": manifest["workspace_id"], "archive_sha256": sha(raw), "members": len(names)}


def render_report(overview):
    esc = lambda value: html.escape(str(value), quote=True)
    sections = []
    for run in overview["runs"]:
        rows = []
        for check in run["checks"]:
            for role in run["roles"]:
                captures = run["results"].get(check["id"] + "/" + role["id"], [])
                if not captures:
                    rows.append(f"<tr><td>{esc(check['title'])}</td><td>{esc(role['title'])}</td><td>Awaiting native response</td><td></td></tr>")
                    continue
                for capture in captures:
                    reviews = overview["reviews"].get(capture["operation_id"], [])
                    review = reviews[-1] if reviews else None
                    link = "workspace/" + capture["body"]["path"]
                    preview = ""
                    if capture["request"]["operation"] == "GetMap" and capture["response"]["media_type"].split(";")[0] == "image/png":
                        preview = f'<a href="{esc(link)}"><img loading="lazy" alt="Retained native map" src="{esc(link)}"></a>'
                    rows.append("<tr><td>" + esc(check["title"]) + "<br>" + esc(capture["operation_id"]) +
                        "</td><td>" + esc(role["title"]) + "</td><td>" + esc(capture["evaluation"]["state"]) +
                        "<br>HTTP " + esc(capture["response"]["status"]) + "<br>" + esc(capture["response"]["observed_at"]) +
                        "</td><td>" + (esc(review["decision"]) + "<br>" + esc(review["note"]) if review else "Awaiting operator review") +
                        f'<br><a href="{esc(link)}">Original response</a>{preview}</td></tr>')
        sections.append("<section><h2>" + esc(run["title"]) + "</h2><pre>" +
                        esc(json.dumps(run["publication"], indent=2, ensure_ascii=False)) +
                        "</pre><table><thead><tr><th>Operation</th><th>Existing role</th><th>Native result</th><th>Review and output</th></tr></thead><tbody>" +
                        "".join(rows) + "</tbody></table></section>")
    return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>' + esc(overview["title"]) + \
        '</title><style>body{max-width:1100px;margin:40px auto;padding:0 20px;color:#222;background:#fff;font:16px/1.5 system-ui}table{border-collapse:collapse;width:100%}td,th{padding:12px;text-align:left;border:1px solid #bbb;vertical-align:top}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f3f3;padding:14px}img{display:block;max-width:260px;max-height:180px;margin-top:10px}a{color:#222}section{margin:32px 0}@media(max-width:650px){table{display:block;overflow:auto}body{margin:20px auto}}</style><h1>' + esc(overview["title"]) + \
        '</h1><p>Retained native publication responses, original source bindings and operator decisions. Open the complete package with the supplied operator to continue this same workspace.</p>' + "".join(sections) + "</html>"
