"""MIT. Exact FHIR Bulk Data sources projected by the original SF30 NativeEngine."""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from decimal import Decimal, localcontext
import hashlib
import io
import json
from pathlib import Path
import re
import sqlite3
import stat
import sys
import tempfile
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit
import zipfile

HERE = Path(__file__).resolve().parent
XML = HERE.parent / "xml"
if str(XML) not in sys.path:
    sys.path.insert(0, str(XML))
from xml_source import InputError, MAX_SOURCE, validate_plan as native_plan, dataset_spec as native_spec, typed, utf16_length

SOURCE_SCHEMA = "stellar-forge.fhir-bulk-source.v1"
PLAN_SCHEMA = "stellar-forge.fhir-bulk-mapping.v1"
CONNECTION_SCHEMA = "stellar-forge.fhir-bulk-connection.v1"
EXPORT_SCHEMA = "stellar-forge.fhir-bulk-export.v1"
MAX_FILES = 4096
MAX_LINE = 16 * 1024 * 1024
MAX_MEMBERS = 32768
MAX_MANIFEST = 16 * 1024 * 1024
MAX_ROWS = 1000000
MAX_PATHS = 8192
IDENTITY = re.compile(r"[0-9a-f]{64}\Z")
FHIR_ID = re.compile(r"[A-Za-z0-9.-]{1,64}\Z")
RESOURCE_TYPE = re.compile(r"[A-Z][A-Za-z0-9]{0,63}\Z")
TOKEN = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,95}\Z")
COLUMN = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,47}\Z")
NUMBER = re.compile(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?\Z")


class Number(str):
    """An original JSON numeric token, never converted through binary floating point."""


def json_value(raw, lexical=False):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise InputError("Duplicate JSON member: " + key)
            result[key] = value
        return result
    def constant(value):
        raise InputError("Nonstandard JSON number: " + value)
    try:
        return json.loads(raw, object_pairs_hook=pairs, parse_constant=constant,
            **({"parse_int": Number, "parse_float": Number} if lexical else {}))
    except (UnicodeError, ValueError, TypeError, RecursionError) as error:
        if isinstance(error, InputError):
            raise
        raise InputError("Expected complete UTF-8 JSON") from error


def lexical_json(value):
    if isinstance(value, Number):
        if not NUMBER.fullmatch(value):
            raise InputError("Invalid retained numeric token")
        return str(value)
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, (str, int, float)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    if isinstance(value, list):
        return "[" + ",".join(lexical_json(item) for item in value) + "]"
    if isinstance(value, dict):
        return "{" + ",".join(json.dumps(key, ensure_ascii=False) + ":" + lexical_json(value[key])
                               for key in sorted(value)) + "}"
    raise InputError("Unsupported JSON value")


def jbytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
                       allow_nan=False) + "\n").encode("utf-8")


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def text(value, label, maximum=4096, empty=True):
    if not isinstance(value, str) or len(value) > maximum or (not empty and not value.strip()):
        raise InputError(label + " must be " + ("nonempty " if not empty else "") + "text")
    if any(ord(char) < 32 and char not in "\n\t" for char in value):
        raise InputError(label + " contains unsupported control characters")
    return value


def exact(raw, allowed, label):
    if not isinstance(raw, dict) or set(raw) - set(allowed):
        raise InputError(label + " contains unsupported fields")
    return raw


def integer(value, minimum, maximum, label):
    if type(value) is not int or not minimum <= value <= maximum:
        raise InputError(label + " must be an integer from " + str(minimum) + " to " + str(maximum))
    return value


def identity(value):
    if not isinstance(value, str) or not IDENTITY.fullmatch(value):
        raise InputError("Expected a complete retained content identity")
    return value


def operation_id(value):
    if not isinstance(value, str) or not TOKEN.fullmatch(value):
        raise InputError("Operation ID must be a 1–96 character literal token")
    return value


def instant(value, label, optional=True):
    if value is None and optional:
        return None
    text(value, label, 64, False)
    if isinstance(value, Number):
        raise InputError(label + " must be a FHIR instant string")
    found = re.fullmatch(r"(\d{4}-\d\d-\d\dT\d\d:\d\d:)(\d\d)(?:\.(\d+))?(Z|[+-]\d\d:\d\d)", value)
    if not found:
        raise InputError(label + " requires an explicit FHIR instant with timezone")
    second, zone = int(found[2]), found[4]
    if second > 60:
        raise InputError(label + " has an invalid second")
    if zone != "Z":
        hours, minutes = int(zone[1:3]), int(zone[4:6])
        if hours > 14 or minutes > 59 or (hours == 14 and minutes != 0):
            raise InputError(label + " has an invalid timezone offset")
    try:
        datetime.fromisoformat(found[1] + ("59" if second == 60 else found[2]) +
                               ("+00:00" if zone == "Z" else zone))
    except ValueError as error:
        raise InputError(label + " is not a valid calendar instant") from error
    return value


def epoch(value):
    # Keep sub-microsecond modification boundaries exact; datetime alone truncates them.
    value = instant(value, "Instant", False)
    found = re.fullmatch(r"(.*T\d\d:\d\d:)(\d\d)(?:\.(\d+))?(Z|[+-]\d\d:\d\d)", value)
    parsed = datetime.fromisoformat(found[1] + ("59" if found[2] == "60" else found[2]) +
                                    ("+00:00" if found[4] == "Z" else found[4]))
    elapsed = parsed.astimezone(timezone.utc) - datetime(1970, 1, 1, tzinfo=timezone.utc)
    seconds = elapsed.days * 86400 + elapsed.seconds + int(found[2] == "60")
    with localcontext() as precision:
        precision.prec = 80
        return Decimal(seconds) + (Decimal("0." + found[3]) if found[3] else Decimal(0))


def http_url(value, label="URL", base=False):
    text(value, label, 16384, False)
    if any(char in value for char in "\r\n\t\\"):
        raise InputError(label + " contains an invalid character")
    parsed = urlsplit(value)
    if parsed.scheme not in {"https", "http"} or not parsed.hostname or parsed.username is not None or parsed.password is not None or parsed.fragment:
        raise InputError(label + " must be an absolute HTTP(S) URL without user credentials or fragment")
    if parsed.scheme == "http" and parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
        raise InputError(label + " must use HTTPS for a remote server")
    try:
        parsed.port
    except ValueError as error:
        raise InputError("Invalid URL port") from error
    if any(part in {".", ".."} for part in parsed.path.split("/")):
        raise InputError(label + " contains path traversal")
    if base and parsed.query:
        raise InputError(label + " must not include a query")
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path.rstrip("/") if base else parsed.path, parsed.query, ""))


def origin(value):
    parsed = urlsplit(http_url(value))
    return parsed.scheme + "://" + parsed.netloc.lower()


def validate_connection(raw):
    exact(raw, {"schema", "label", "baseUrl", "protocol", "authProfile", "origin", "publisher", "sourceUrl", "note"}, "Connection")
    if raw.get("schema", CONNECTION_SCHEMA) != CONNECTION_SCHEMA:
        raise InputError("Unsupported FHIR connection schema")
    profile = raw.get("authProfile")
    if profile is not None:
        operation_id(profile)
    protocol = raw.get("protocol", "stu3")
    classification = raw.get("origin", "operator_source")
    if protocol not in {"stu2", "stu3"} or classification not in {"published_sample", "operator_source"}:
        raise InputError("Choose a published protocol and explicit source origin")
    source_url = raw.get("sourceUrl", "")
    if source_url:
        http_url(source_url, "Publisher source URL")
    return {"schema": CONNECTION_SCHEMA, "label": text(raw.get("label"), "Connection label", 160, False),
            "baseUrl": http_url(raw.get("baseUrl"), "FHIR base", True), "protocol": protocol,
            "authProfile": profile, "origin": classification,
            "publisher": text(raw.get("publisher", ""), "Publisher", 256),
            "sourceUrl": source_url, "note": text(raw.get("note", ""), "Connection note", 8192)}


def strings(values, label, maximum=256, pattern=None):
    if not isinstance(values, list) or len(values) > maximum:
        raise InputError(label + " must be a list within the supported count")
    result = []
    for value in values:
        text(value, label, 4096, False)
        if pattern is not None and not pattern.fullmatch(value):
            raise InputError(label + " contains an invalid literal value")
        if value not in result:
            result.append(value)
    return result


def validate_export(raw, connection):
    exact(raw, {"schema", "connectionId", "label", "scope", "groupId", "method", "parameters",
                "limits", "note", "request"}, "Export")
    if raw.get("schema", EXPORT_SCHEMA) != EXPORT_SCHEMA:
        raise InputError("Unsupported FHIR export schema")
    connection = validate_connection(connection)
    connection_id = sha(jbytes(connection))
    if raw.get("connectionId") != connection_id:
        raise InputError("Export must bind the exact retained connection")
    scope = raw.get("scope", "system")
    method = raw.get("method", "GET")
    if scope not in {"system", "patient", "group"} or method not in {"GET", "POST"}:
        raise InputError("Choose system, patient or group scope and GET or POST")
    group_id = raw.get("groupId")
    if scope == "group":
        if not isinstance(group_id, str) or not FHIR_ID.fullmatch(group_id):
            raise InputError("Group scope requires its original literal Group ID")
    elif group_id not in {None, ""}:
        raise InputError("Group ID applies only to a Group export")
    else:
        group_id = None
    params = raw.get("parameters", {})
    keys = {"types", "since", "until", "elements", "typeFilters", "includeAssociatedData", "patients",
            "organizeOutputBy", "allowPartialManifests", "separateExportStatus", "handling"}
    exact(params, keys, "Export parameters")
    p = {key: strings(params.get(key, []), key, 256, RESOURCE_TYPE if key == "types" else None)
         for key in ["types", "elements", "typeFilters", "includeAssociatedData", "patients"]}
    p["since"] = instant(params.get("since"), "_since")
    p["until"] = instant(params.get("until"), "_until")
    if p["since"] and p["until"] and epoch(p["since"]) >= epoch(p["until"]):
        raise InputError("_until must be after _since")
    for item in p["elements"]:
        if not re.fullmatch(r"(?:[A-Z][A-Za-z0-9]*\.)?[A-Za-z][A-Za-z0-9]*", item):
            raise InputError("_elements selects root elements only")
    for item in p["typeFilters"]:
        rt, marker, query = item.partition("?")
        if not marker or not RESOURCE_TYPE.fullmatch(rt) or not query:
            raise InputError("Each type filter must be a complete ResourceType?search query")
        if any(key in {"_include", "_revinclude", "_sort", "_count", "_elements", "_summary", "_format"}
               for key, _ in parse_qsl(query, keep_blank_values=True)):
            raise InputError("FHIR search-result controls are not type-filter criteria")
    for patient in p["patients"]:
        if not re.fullmatch(r"Patient/[A-Za-z0-9.-]{1,64}", patient):
            raise InputError("Explicit patient references must be Patient/<literal-id>")
    if p["patients"] and (method != "POST" or scope == "system"):
        raise InputError("The patient parameter requires POST with patient or group scope")
    organized = params.get("organizeOutputBy")
    if organized is not None and (not isinstance(organized, str) or not RESOURCE_TYPE.fullmatch(organized)):
        raise InputError("organizeOutputBy must be a FHIR resource type")
    p["organizeOutputBy"] = organized
    for key in ["allowPartialManifests", "separateExportStatus"]:
        value = params.get(key, False)
        if type(value) is not bool:
            raise InputError(key + " must be an explicit boolean")
        p[key] = value
    p["handling"] = params.get("handling", "strict")
    if p["handling"] not in {"strict", "lenient"}:
        raise InputError("Choose strict or explicitly lenient parameter handling")
    if connection["protocol"] == "stu2" and (organized or p["allowPartialManifests"] or p["separateExportStatus"] or p["until"]):
        raise InputError("These optional parameters belong to the selected STU3 profile")
    limits = raw.get("limits", {})
    exact(limits, {"maxBytes", "maxFiles", "maxLineBytes"}, "Source limits")
    limits = {"maxBytes": integer(limits.get("maxBytes", MAX_SOURCE), 1, MAX_SOURCE, "maxBytes"),
              "maxFiles": integer(limits.get("maxFiles", MAX_FILES), 1, MAX_FILES, "maxFiles"),
              "maxLineBytes": integer(limits.get("maxLineBytes", MAX_LINE), 1, MAX_LINE, "maxLineBytes")}
    result = {"schema": EXPORT_SCHEMA, "connectionId": connection_id,
              "label": text(raw.get("label", "FHIR Bulk Data export"), "Export label", 160, False),
              "scope": scope, "groupId": group_id, "method": method, "parameters": p,
              "limits": limits, "note": text(raw.get("note", ""), "Export note", 8192)}
    result["request"] = request_for(result, connection)
    if "request" in raw and raw["request"] != result["request"]:
        raise InputError("Saved request does not match its complete export definition")
    return result


def request_for(export, connection):
    p = export["parameters"]
    path = {"system": "/$export", "patient": "/Patient/$export",
            "group": "/Group/" + quote(export.get("groupId") or "", safe="") + "/$export"}[export["scope"]]
    url = connection["baseUrl"] + path
    parameters = [("_outputFormat", "string", "application/fhir+ndjson")]
    for key, name in [("since", "_since"), ("until", "_until")]:
        if p[key]:
            parameters.append((name, "instant", p[key]))
    for key, name in [("types", "_type"), ("elements", "_elements"),
                      ("includeAssociatedData", "includeAssociatedData")]:
        if p[key]:
            parameters.append((name, "string", ",".join(p[key])))
    for value in p["typeFilters"]:
        parameters.append(("_typeFilter", "string", value))
    if p["organizeOutputBy"]:
        parameters.append(("organizeOutputBy", "string", p["organizeOutputBy"]))
    if p["allowPartialManifests"]:
        parameters.append(("allowPartialManifests", "boolean", True))
    for value in p["patients"]:
        parameters.append(("patient", "reference", value))
    prefer = "respond-async"
    if p["separateExportStatus"]:
        prefer += ",separate-export-status"
    prefer += ",handling=" + p["handling"]
    headers = {"Accept": "application/fhir+json", "Prefer": prefer}
    body = None
    if export["method"] == "GET":
        query = [(name, "true" if value is True else str(value)) for name, _, value in parameters]
        url += "?" + urlencode(query)
    else:
        fhir = []
        for name, kind, value in parameters:
            typed_key = {"string": "valueString", "instant": "valueInstant",
                         "boolean": "valueBoolean", "reference": "valueReference"}[kind]
            fhir.append({"name": name, typed_key: {"reference": value} if kind == "reference" else value})
        body = jbytes({"resourceType": "Parameters", "parameter": fhir}).decode()
        headers["Content-Type"] = "application/fhir+json"
    request = {"method": export["method"], "url": url, "headers": headers, "bodyText": body}
    request["requestSha256"] = sha(jbytes(request))
    return request


def request_matches(expected, actual):
    try:
        left, right = urlsplit(http_url(expected)), urlsplit(http_url(actual))
    except InputError:
        return False
    def query(parsed):
        output = []
        for key, value in parse_qsl(parsed.query, keep_blank_values=True):
            if key in {"_type", "_elements", "includeAssociatedData"}:
                output.extend((key, item) for item in value.split(","))
            else:
                output.append((key, value))
        return sorted(output)
    return (left.scheme.lower(), left.netloc.lower(), left.path, query(left)) == \
           (right.scheme.lower(), right.netloc.lower(), right.path, query(right))


def manifest_value(raw, export, previous=None):
    manifest = json_value(raw)
    if not isinstance(manifest, dict):
        raise InputError("Bulk export status did not contain a JSON manifest")
    instant(manifest.get("transactionTime"), "Manifest transactionTime", False)
    if not isinstance(manifest.get("request"), str) or not request_matches(export["request"]["url"], manifest["request"]):
        raise InputError("Manifest identifies a different original export request")
    if type(manifest.get("requiresAccessToken")) is not bool:
        raise InputError("Manifest requiresAccessToken must be explicit")
    organized = manifest.get("outputOrganizedBy")
    requested = export["parameters"]["organizeOutputBy"]
    # The original SMART reference server spells an ungrouped response as "".
    # Treat that spelling as unspecified for selection comparison only; retain
    # the complete manifest and its lexical value unchanged in the source.
    effective_organized = None if organized == "" else organized
    if effective_organized != requested and not (effective_organized is None and export["parameters"]["handling"] == "lenient"):
        raise InputError("Manifest output organization differs from the reviewed export")
    for kind in ["output", "error", "deleted"]:
        items = manifest.get(kind, [] if kind == "deleted" else None)
        if not isinstance(items, list) or len(items) > export["limits"]["maxFiles"]:
            raise InputError("Manifest " + kind + " must be a complete file list within maxFiles")
        for item in items:
            if not isinstance(item, dict):
                raise InputError("Invalid manifest file entry")
            http_url(item.get("url"), "Original output URL")
            expected_type = "OperationOutcome" if kind == "error" else "Bundle" if kind == "deleted" else None
            resource_type = item.get("type")
            if kind == "output" and organized:
                if resource_type is not None:
                    raise InputError("Organized output entries must not specify a single type")
            elif not isinstance(resource_type, str) or not RESOURCE_TYPE.fullmatch(resource_type):
                raise InputError("Output entry is missing its FHIR resource type")
            if expected_type and resource_type != expected_type:
                raise InputError(kind + " files must contain " + expected_type)
            if "count" in item:
                integer(item["count"], 0, MAX_ROWS, "Original manifest count")
            if item.get("continuesInFile"):
                if not organized or kind != "output":
                    raise InputError("continuesInFile applies to organized output")
                http_url(item["continuesInFile"], "Original continuation URL")
    links = manifest.get("link", [])
    if not isinstance(links, list) or len(links) > 1:
        raise InputError("Manifest must have at most one original next link")
    if links:
        if not isinstance(links[0], dict) or not export["parameters"]["allowPartialManifests"] or links[0].get("relation") != "next":
            raise InputError("Unexpected partial-manifest link")
        http_url(links[0].get("url"), "Original manifest next URL")
    if previous is not None:
        for key in (set(manifest) | set(previous)) - {"output", "deleted", "link"}:
            if key not in manifest or key not in previous or manifest[key] != previous[key]:
                raise InputError("Original manifest pages changed their shared " + key)
    return manifest


def member_name(value):
    text(value, "Source member name", 256, False)
    if value.startswith("/") or "\\" in value or any(part in {"", ".", ".."} for part in value.split("/")):
        raise InputError("Unsafe source member name")
    if not re.fullmatch(r"[A-Za-z0-9_./-]+", value):
        raise InputError("Source member name must be a retained literal path")
    return value


def descriptor(raw):
    if not isinstance(raw, dict):
        raise InputError("Original source member descriptor is required")
    member_name(raw.get("name"))
    identity(raw.get("sha256"))
    integer(raw.get("bytes"), 0, MAX_SOURCE, "Original source member bytes")
    return raw


class Packet:
    def __init__(self, stream):
        start = stream.tell()
        stream.seek(0)
        digest, size = hashlib.sha256(), 0
        while block := stream.read(65536):
            size += len(block)
            if size > MAX_SOURCE:
                raise InputError("Complete source ZIP exceeds 256 MiB")
            digest.update(block)
        self.source_id = digest.hexdigest()
        stream.seek(start)
        try:
            self.archive = zipfile.ZipFile(stream)
        except zipfile.BadZipFile as error:
            raise InputError("Expected a complete retained FHIR source ZIP") from error
        self.verified = set()
        infos = self.archive.infolist()
        if not 1 <= len(infos) <= MAX_MEMBERS or len({item.filename for item in infos}) != len(infos):
            raise InputError("Source packet has duplicate or too many members")
        self.infos = {}
        total = 0
        for info in infos:
            member_name(info.filename)
            mode = info.external_attr >> 16
            if info.is_dir() or stat.S_ISLNK(mode) or info.flag_bits & 1 or \
               info.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}:
                raise InputError("Unsupported source packet entry")
            total += info.file_size
            if info.file_size > MAX_SOURCE or total > MAX_SOURCE:
                raise InputError("Complete source packet exceeds 256 MiB of retained original members")
            self.infos[info.filename] = info
        if "manifest.json" not in self.infos or self.infos["manifest.json"].file_size > MAX_MANIFEST:
            raise InputError("Source packet requires its complete bounded manifest.json")
        self.manifest = json_value(self.archive.read("manifest.json"))
        m = self.manifest
        if not isinstance(m, dict) or m.get("schema") != SOURCE_SCHEMA or m.get("mode") not in {"capture", "materialized"}:
            raise InputError("Unsupported FHIR Bulk Data source packet")
        self.mode = m["mode"]
        self.members = {}
        if self.mode == "capture":
            operation_id(m.get("operationId"))
            self.connection = validate_connection(m.get("connection"))
            self.export = validate_export(m.get("export"), self.connection)
            instant(m.get("transactionTime"), "Capture transactionTime", False)
            if not isinstance(m.get("files"), list) or len(m["files"]) > self.export["limits"]["maxFiles"]:
                raise InputError("Capture requires its complete file list")
            files = m["files"]
            if len({item.get("id") for item in files}) != len(files):
                raise InputError("Capture repeats a file identity")
            for item in files:
                descriptor(item)
                identity(item.get("id"))
                if item.get("kind") not in {"output", "error", "deleted"}:
                    raise InputError("Unknown source file kind")
                http_url(item.get("url"), "Original source file URL")
                self.members[item["name"]] = item
            protocol = m.get("protocol", [])
            if not isinstance(protocol, list) or len(protocol) > MAX_MEMBERS - 1 - len(files):
                raise InputError("Invalid retained protocol members")
            for item in protocol:
                descriptor(item)
                if item["name"] in self.members:
                    raise InputError("Source member was declared twice")
                self.members[item["name"]] = item
            self.files = files
        else:
            captures = m.get("captures")
            if not isinstance(captures, list) or not 2 <= len(captures) <= 33:
                raise InputError("Materialized source needs a base and 1–32 original deltas")
            for item in captures:
                descriptor(item)
                identity(item.get("sourceId"))
                if item["sha256"] != item["sourceId"] or item["name"] in self.members:
                    raise InputError("Nested original capture identity differs")
                self.members[item["name"]] = item
            if not isinstance(m.get("composition"), dict):
                raise InputError("Materialized source requires its reviewed composition")
            self.connection = validate_connection(m.get("connection"))
            self.export = validate_export(m.get("export"), self.connection)
            instant(m.get("transactionTime"), "Materialized transactionTime", False)
            self.files = []
        if set(self.infos) != set(self.members) | {"manifest.json"}:
            raise InputError("Source packet members differ from its complete manifest")
        for name, item in self.members.items():
            if self.infos[name].file_size != item["bytes"]:
                raise InputError("Source member byte count differs: " + name)

    def __enter__(self):
        validate_capture(self)
        return self

    def __exit__(self, *_):
        self.archive.close()

    def verify(self, name):
        member_name(name)
        if name == "manifest.json":
            return
        if name not in self.members:
            raise InputError("Unknown original source member")
        if name in self.verified:
            return
        expected = self.members[name]
        count, digest = 0, hashlib.sha256()
        with self.archive.open(name) as stream:
            while block := stream.read(65536):
                count += len(block)
                if count > expected["bytes"]:
                    raise InputError("Source member exceeds its retained byte count")
                digest.update(block)
        if count != expected["bytes"] or digest.hexdigest() != expected["sha256"]:
            raise InputError("Original source member failed its byte identity: " + name)
        self.verified.add(name)

    @contextmanager
    def open(self, name):
        if self.mode == "materialized" and "!/" in name:
            outer, inner = name.split("!/", 1)
            if outer not in self.members:
                raise InputError("Unknown original capture member")
            with self.open(outer) as stream, Packet(stream) as nested, nested.open(inner) as member:
                yield member
            return
        self.verify(name)
        with self.archive.open(name) as stream:
            yield stream

    def capture_records(self, kind=None, cancel=None):
        organized = getattr(self, "organization", self.export["parameters"]["organizeOutputBy"])
        count = 0
        for item in self.files:
            if kind is not None and item["kind"] != kind:
                continue
            group = None
            with self.open(item["name"]) as stream:
                line_no = 0
                while raw := stream.readline(self.export["limits"]["maxLineBytes"] + 1):
                    line_no += 1
                    if len(raw) > self.export["limits"]["maxLineBytes"]:
                        raise InputError("Original NDJSON line exceeds maxLineBytes")
                    if cancel and cancel():
                        raise InputError("Original source operation cancelled")
                    if not raw.strip():
                        yield {"_blank": True, "fileId": item["id"], "fileName": item["name"], "line": line_no, "bytes": len(raw)}
                        continue
                    resource = json_value(raw, True)
                    validate_structure(resource)
                    if not isinstance(resource, dict) or not isinstance(resource.get("resourceType"), str) or not RESOURCE_TYPE.fullmatch(resource["resourceType"]):
                        raise InputError("NDJSON line is not a FHIR resource: " + item["name"] + ":" + str(line_no))
                    rt = resource["resourceType"]
                    header = organized and item["kind"] == "output" and rt == "Parameters" and header_reference(resource) is not None
                    if header:
                        group = header_reference(resource)
                    elif item["kind"] == "output" and not organized and rt != item.get("type"):
                        raise InputError("Original file contains a type different from its manifest")
                    if item["kind"] == "error" and rt != "OperationOutcome":
                        raise InputError("Native error file contains a non-OperationOutcome resource")
                    if item["kind"] == "deleted" and (rt != "Bundle" or resource.get("type") != "transaction"):
                        raise InputError("Native deleted file must contain transaction Bundles")
                    meta = resource.get("meta") if isinstance(resource.get("meta"), dict) else {}
                    rid = resource.get("id")
                    if rid is not None and (not isinstance(rid, str) or isinstance(rid, Number) or not FHIR_ID.fullmatch(rid)):
                        raise InputError("Invalid original FHIR resource id")
                    version = meta.get("versionId")
                    if version is not None and (not isinstance(version, str) or isinstance(version, Number) or not FHIR_ID.fullmatch(version)):
                        raise InputError("Invalid original FHIR version id")
                    updated = meta.get("lastUpdated")
                    if updated is not None:
                        instant(updated, "Original meta.lastUpdated", False)
                    record = {"sourceId": self.source_id, "fileId": item["id"], "fileName": item["name"], "line": line_no,
                              "recordId": item["id"] + ":" + str(line_no), "kind": item["kind"],
                              "resourceType": rt, "id": rid, "versionId": version, "lastUpdated": updated,
                              "bytes": len(raw), "lineSha256": sha(raw), "resourceSha256": sha(lexical_json(resource).encode()),
                              "jsonText": raw.decode("utf-8"), "references": references(resource),
                              "deleted": deleted_references(resource, self.connection["baseUrl"]) if item["kind"] == "deleted" else [],
                              "issues": outcome_issues(resource) if item["kind"] == "error" else [],
                              "organizedHeader": bool(header), "organizedReference": group,
                              "_resource": resource}
                    count += 1
                    if count > MAX_ROWS:
                        raise InputError("Source exceeds one million original NDJSON records")
                    yield record

    def records(self, kind=None, cancel=None):
        if self.mode == "capture":
            yield from self.capture_records(kind, cancel)
        else:
            yield from materialized_records(self, kind, cancel)


def validate_structure(value):
    stack, count = [(value, 0)], 0
    while stack:
        item, depth = stack.pop()
        count += 1
        if depth > 64 or count > 200000:
            raise InputError("Original resource exceeds the supported structural working budget")
        if isinstance(item, str):
            try:
                item.encode("utf-8")
            except UnicodeError as error:
                raise InputError("FHIR JSON string contains an isolated Unicode surrogate") from error
        if isinstance(item, dict):
            for key, child in item.items():
                if not isinstance(key, str) or len(key) > 2048:
                    raise InputError("Original JSON property name exceeds the supported budget")
                stack.append((child, depth + 1))
        elif isinstance(item, list):
            stack.extend((child, depth + 1) for child in item)


def header_reference(resource):
    found = []
    params = resource.get("parameter")
    if isinstance(params, list):
        for item in params:
            if isinstance(item, dict) and item.get("name") == "header":
                ref = item.get("valueReference")
                if isinstance(ref, dict) and isinstance(ref.get("reference"), str):
                    found.append(ref["reference"])
    if len(found) > 1:
        raise InputError("Organized resource header has multiple header references")
    return found[0] if found else None


def references(resource):
    result, stack = [], [(resource, [])]
    while stack:
        value, path = stack.pop()
        if isinstance(value, dict):
            for key, child in reversed(list(value.items())):
                if key == "reference" and isinstance(child, str) and not isinstance(child, Number):
                    result.append({"path": path + [key], "reference": child})
                elif isinstance(child, (dict, list)):
                    stack.append((child, path + [key]))
        elif isinstance(value, list):
            stack.extend((child, path + [str(i)]) for i, child in reversed(list(enumerate(value))))
    return result


def reference_identity(value, base_url):
    if not isinstance(value, str):
        return None
    parsed = urlsplit(value)
    if parsed.query or parsed.fragment:
        return None
    if parsed.scheme or parsed.netloc:
        base = urlsplit(base_url)
        if (parsed.scheme.lower(), parsed.netloc.lower()) != (base.scheme.lower(), base.netloc.lower()):
            return None
        prefix = base.path.rstrip("/") + "/"
        if not parsed.path.startswith(prefix):
            return None
        path = parsed.path[len(prefix):]
    else:
        path = parsed.path
    fields = path.split("/")
    if len(fields) not in {2, 4} or not RESOURCE_TYPE.fullmatch(fields[0]) or not FHIR_ID.fullmatch(fields[1]):
        return None
    version = None
    if len(fields) == 4:
        if fields[2] != "_history" or not FHIR_ID.fullmatch(fields[3]):
            return None
        version = fields[3]
    return {"resourceType": fields[0], "id": fields[1], "versionId": version}


def deleted_references(resource, base_url):
    entries = resource.get("entry")
    if not isinstance(entries, list) or not entries:
        raise InputError("Native deleted transaction Bundle has no entries")
    result = []
    for entry in entries:
        request = entry.get("request") if isinstance(entry, dict) else None
        if not isinstance(request, dict) or request.get("method") != "DELETE" or not isinstance(request.get("url"), str):
            raise InputError("Native deleted entry must contain its original DELETE URL")
        value = request["url"]
        resolved = reference_identity(value, base_url)
        result.append({"url": value, **(resolved or {"resourceType": None, "id": None, "versionId": None}),
                       **({} if resolved else {"reason": "Original reference is conditional, external or not a literal resource identity"})})
    return result


def outcome_issues(resource):
    result = []
    issues = resource.get("issue", [])
    if not isinstance(issues, list):
        raise InputError("OperationOutcome issue must be an array")
    for item in issues:
        if not isinstance(item, dict):
            raise InputError("OperationOutcome issue must be an object")
        result.append({key: item.get(key) for key in ["severity", "code", "diagnostics"]})
    return result


def file_identity(page, kind, index):
    return sha(jbytes({"manifest": page, "kind": kind, "index": index}))


def validate_capture(packet):
    if packet.mode != "capture":
        return
    m = packet.manifest
    manifests = m.get("manifests")
    if not isinstance(manifests, list) or not 1 <= len(manifests) <= MAX_FILES:
        raise InputError("Capture requires its complete original manifest chain")
    expected, previous, next_url = {}, None, None
    for page, item in enumerate(manifests):
        if not isinstance(item, dict) or item.get("name") not in packet.members:
            raise InputError("Original manifest body is not retained")
        if page and not request_matches(next_url, item.get("url", "")):
            raise InputError("Retained manifest chain skips its native next link")
        with packet.open(item["name"]) as stream:
            raw = stream.read(MAX_MANIFEST + 1)
        if len(raw) > MAX_MANIFEST:
            raise InputError("Original manifest exceeds its supported budget")
        value = manifest_value(raw, packet.export, previous)
        if value["transactionTime"] != m["transactionTime"]:
            raise InputError("Capture transaction time differs from its original manifests")
        status = item.get("exportStatus", item.get("status"))
        if status not in {200, 202}:
            raise InputError("Capture retains a manifest with an unsuccessful export status")
        links = value.get("link", [])
        next_url = links[0]["url"] if links else None
        for kind in ["output", "error", "deleted"]:
            for index, f in enumerate(value.get(kind, [])):
                fid = file_identity(page, kind, index)
                expected[fid] = {"kind": kind, "type": f.get("type"), "url": f["url"], "count": f.get("count"),
                                 "continuesInFile": f.get("continuesInFile")}
        previous = value
    if manifests[-1].get("exportStatus", manifests[-1].get("status")) != 200 or next_url is not None:
        raise InputError("Original manifest chain has not reached its completed final page")
    if len(expected) > packet.export["limits"]["maxFiles"]:
        raise InputError("The full manifest chain exceeds the selected complete-file budget")
    if set(expected) != {f["id"] for f in packet.files}:
        raise InputError("Capture omitted or added files compared with its original complete manifest chain")
    for item in packet.files:
        if any(item.get(key) != value for key, value in expected[item["id"]].items()):
            raise InputError("Retained source file differs from its original manifest entry")
        if item.get("continuesInFile") and item["continuesInFile"] not in {f["url"] for f in packet.files if f["kind"] == "output"}:
            raise InputError("Organized resource continuation is missing from the complete capture")


def scope_identity(export):
    p = export["parameters"]
    return {"connectionId": export["connectionId"], "scope": export["scope"], "groupId": export["groupId"],
            "types": sorted(p["types"]), "elements": sorted(p["elements"]), "typeFilters": sorted(p["typeFilters"]),
            "includeAssociatedData": sorted(p["includeAssociatedData"]), "patients": sorted(p["patients"]),
            "organizeOutputBy": p["organizeOutputBy"], "handling": p["handling"]}


def coverage_end(packet):
    bound = packet.export["parameters"]["until"]
    return min(epoch(packet.manifest["transactionTime"]), epoch(bound)) if bound else epoch(packet.manifest["transactionTime"])


def materialized_records(packet, kind=None, cancel=None):
    entries = packet.manifest["captures"]
    composition = packet.manifest["composition"]
    if composition.get("baseSourceId") != entries[0]["sourceId"] or \
       composition.get("deltaSourceIds") != [item["sourceId"] for item in entries[1:]]:
        raise InputError("Composition order differs from its exact original capture list")
    resolutions = composition.get("resolutions", [])
    if not isinstance(resolutions, list) or len(resolutions) > 4096:
        raise InputError("Composition requires a bounded explicit resolution list")
    chosen = {}
    for item in resolutions:
        exact(item, {"sourceId", "resourceType", "id", "fileId", "line"}, "Duplicate resolution")
        key = (identity(item.get("sourceId")), item.get("resourceType"), item.get("id"))
        if not isinstance(key[1], str) or not RESOURCE_TYPE.fullmatch(key[1]) or not isinstance(key[2], str) or not FHIR_ID.fullmatch(key[2]):
            raise InputError("Duplicate resolution needs a literal resource identity")
        identity(item.get("fileId"))
        integer(item.get("line"), 1, MAX_ROWS, "Original line")
        if key in chosen:
            raise InputError("Duplicate identity has more than one resolution")
        chosen[key] = (item["fileId"], item["line"])
    used = set()
    expected_scope, coverage = None, None
    with tempfile.TemporaryDirectory(prefix="sf30-fhir-materialize-") as directory:
        db = sqlite3.connect(Path(directory) / "resources.sqlite")
        try:
            db.executescript("""PRAGMA journal_mode=OFF;
                CREATE TABLE current(k TEXT PRIMARY KEY,body TEXT NOT NULL,version TEXT);
                CREATE TABLE seen(k TEXT PRIMARY KEY,semantic TEXT NOT NULL,body TEXT NOT NULL,version TEXT,
                                  selected INTEGER NOT NULL,conflict INTEGER NOT NULL);
                CREATE TABLE removed(k TEXT PRIMARY KEY,version TEXT);
            """)
            for sequence, entry in enumerate(entries):
                with packet.open(entry["name"]) as source_stream, Packet(source_stream) as source:
                    if source.mode != "capture":
                        raise InputError("Materialization retains only original capture packets")
                    if source.source_id != entry["sourceId"]:
                        raise InputError("Nested original capture changed")
                    validate_capture(source)
                    selected_scope = scope_identity(source.export)
                    if sequence == 0:
                        if source.export["parameters"]["since"]:
                            raise InputError("Retained resource state needs a complete initial export")
                        expected_scope = selected_scope
                    else:
                        if selected_scope != expected_scope:
                            raise InputError("Incremental capture changed its selected source scope or resource filters")
                        since = source.export["parameters"]["since"]
                        if not since or epoch(since) > coverage:
                            raise InputError("Incremental capture leaves a gap in the retained modification coverage")
                        if coverage_end(source) < coverage:
                            raise InputError("Incremental captures must advance or retain modification coverage")
                    coverage = coverage_end(source)
                    db.execute("DELETE FROM seen")
                    db.execute("DELETE FROM removed")
                    for row in source.capture_records(None, cancel):
                        if row.get("_blank"):
                            continue
                        original_file_id = row["fileId"]
                        row = dict(row)
                        row["sourceId"] = entry["sourceId"]
                        row["fileId"] = entry["sourceId"] + ":" + original_file_id
                        row["recordId"] = row["fileId"] + ":" + str(row["line"])
                        row["fileName"] = entry["name"] + "!/" + row["fileName"]
                        if row["kind"] != "output" or row["organizedHeader"]:
                            if kind is None or kind == row["kind"]:
                                yield row
                            if row["kind"] == "deleted":
                                for deletion in row["deleted"]:
                                    if not deletion["resourceType"] or not deletion["id"]:
                                        raise InputError("Retained state cannot apply an unresolved native DELETE reference: " + deletion["url"])
                                    key = deletion["resourceType"] + "/" + deletion["id"]
                                    old = db.execute("SELECT version FROM removed WHERE k=?", (key,)).fetchone()
                                    if old and old[0] != deletion["versionId"]:
                                        raise InputError("A capture contains conflicting DELETE versions for " + key)
                                    db.execute("INSERT OR IGNORE INTO removed VALUES(?,?)", (key, deletion["versionId"]))
                            continue
                        if not row["id"]:
                            raise InputError("Retained resource state requires original resource IDs")
                        key = row["resourceType"] + "/" + row["id"]
                        resolution_key = (entry["sourceId"], row["resourceType"], row["id"])
                        wanted = chosen.get(resolution_key)
                        selected = bool(wanted and wanted == (original_file_id, row["line"]))
                        if selected:
                            used.add(resolution_key)
                        saved_row = {k: v for k, v in row.items() if k != "_resource"}
                        body = jbytes(saved_row).decode()
                        previous = db.execute("SELECT semantic,selected,conflict FROM seen WHERE k=?", (key,)).fetchone()
                        if previous is None:
                            db.execute("INSERT INTO seen VALUES(?,?,?,?,?,?)",
                                       (key, row["resourceSha256"], body, row["versionId"], int(selected), 0))
                        else:
                            conflict = previous[0] != row["resourceSha256"]
                            if selected or (not previous[1] and not wanted and not conflict):
                                db.execute("UPDATE seen SET semantic=?,body=?,version=?,selected=?,conflict=? WHERE k=?",
                                           (row["resourceSha256"], body, row["versionId"], int(selected),
                                            int(previous[2] or conflict), key))
                            elif conflict:
                                db.execute("UPDATE seen SET conflict=1 WHERE k=?", (key,))
                    conflict = db.execute("SELECT k FROM seen WHERE conflict=1 AND selected=0 LIMIT 1").fetchone()
                    if conflict:
                        raise InputError("Conflicting original resource occurrences require an explicit file/line resolution: " + conflict[0])
                    overlap = db.execute("SELECT seen.k FROM seen JOIN removed USING(k) LIMIT 1").fetchone()
                    if overlap:
                        raise InputError("The same original capture both outputs and deletes " + overlap[0])
                    for key, body, version in db.execute("SELECT k,body,version FROM seen ORDER BY k"):
                        db.execute("INSERT INTO current VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET body=excluded.body,version=excluded.version", (key, body, version))
                    for key, version in db.execute("SELECT k,version FROM removed"):
                        if version is None:
                            db.execute("DELETE FROM current WHERE k=?", (key,))
                        else:
                            db.execute("DELETE FROM current WHERE k=? AND version=?", (key, version))
                    if db.execute("SELECT COUNT(*) FROM current").fetchone()[0] > MAX_ROWS:
                        raise InputError("Retained resource state exceeds one million selected resource identities")
            if set(chosen) != used:
                raise InputError("A selected duplicate resolution does not identify an original resource occurrence")
            if kind is None or kind == "output":
                for (body,) in db.execute("SELECT body FROM current ORDER BY k"):
                    row = json_value(body)
                    row["_resource"] = json_value(row["jsonText"], True)
                    yield row
        finally:
            db.close()


def field_values(resource):
    stack = [(resource, [])]
    while stack:
        value, path = stack.pop()
        yield path, value
        if isinstance(value, dict):
            stack.extend((child, path + [key]) for key, child in reversed(list(value.items())))
        elif isinstance(value, list):
            stack.extend((child, path + ["*"]) for child in reversed(value))


def value_type(value):
    if isinstance(value, Number):
        return "number"
    if value is None:
        return "null"
    if type(value) is bool:
        return "boolean"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return "number"


def pointer(path):
    return "/" + "/".join(part.replace("~", "~0").replace("/", "~1") for part in path) if path else ""


def all_file_descriptors(packet):
    if packet.mode == "capture":
        return [dict(item) for item in packet.files]
    result = []
    for entry in packet.manifest["captures"]:
        with packet.open(entry["name"]) as stream, Packet(stream) as nested:
            if nested.mode != "capture":
                raise InputError("Nested source must be an original capture")
            for item in nested.files:
                result.append({**item, "id": entry["sourceId"] + ":" + item["id"],
                               "name": entry["name"] + "!/" + item["name"], "sourceId": entry["sourceId"]})
    return result


def inventory(stream, cancel=None):
    with Packet(stream) as packet, tempfile.TemporaryDirectory(prefix="sf30-fhir-inventory-") as directory:
        validate_capture(packet)
        for name in packet.members:
            packet.verify(name)
        files = all_file_descriptors(packet)
        stats = {item["id"]: {**item, "lines": 0, "resources": 0, "headers": 0, "blankLines": 0} for item in files}
        types, fields, findings = {}, {}, []
        totals = {"files": len(files), "bytes": sum(item["bytes"] for item in files), "resources": 0,
                  "deletedEntries": 0, "outcomes": 0, "organizedHeaders": 0}
        excluded = 0
        db = sqlite3.connect(Path(directory) / "identities.sqlite")
        try:
            db.execute("CREATE TABLE identities(rt TEXT,id TEXT,semantic TEXT,n INTEGER,PRIMARY KEY(rt,id))")
            for row in packet.records(None, cancel):
                file_stat = stats.get(row["fileId"])
                if file_stat:
                    file_stat["lines"] = max(file_stat["lines"], row["line"])
                if row.get("_blank"):
                    if file_stat:
                        file_stat["blankLines"] += 1
                    continue
                if file_stat:
                    file_stat["resources"] += 1
                if row["organizedHeader"]:
                    totals["organizedHeaders"] += 1
                    if file_stat:
                        file_stat["headers"] += 1
                    continue
                if row["kind"] == "deleted":
                    totals["deletedEntries"] += len(row["deleted"])
                    if any(not item["resourceType"] for item in row["deleted"]) and len(findings) < 1000:
                        findings.append({"code": "unresolved-delete", "message": "Original DELETE needs a literal local identity before materialization.",
                                         "fileId": row["fileId"], "line": row["line"]})
                    continue
                if row["kind"] == "error":
                    totals["outcomes"] += len(row["issues"])
                    continue
                totals["resources"] += 1
                rt = row["resourceType"]
                t = types.setdefault(rt, {"type": rt, "count": 0, "identities": 0, "duplicateIdentities": 0,
                                          "conflictingIdentities": 0, "missingIds": 0})
                t["count"] += 1
                if not row["id"]:
                    t["missingIds"] += 1
                else:
                    old = db.execute("SELECT semantic,n FROM identities WHERE rt=? AND id=?", (rt, row["id"])).fetchone()
                    if old is None:
                        db.execute("INSERT INTO identities VALUES(?,?,?,1)", (rt, row["id"], row["resourceSha256"]))
                        t["identities"] += 1
                    else:
                        if old[1] == 1:
                            t["duplicateIdentities"] += 1
                        if old[0] != row["resourceSha256"]:
                            t["conflictingIdentities"] += 1
                        db.execute("UPDATE identities SET n=n+1 WHERE rt=? AND id=?", (rt, row["id"]))
                seen_paths = set()
                for path, value in field_values(row["_resource"]):
                    key = (rt, tuple(path))
                    if key not in fields and len(fields) >= MAX_PATHS:
                        excluded += 1
                        continue
                    field = fields.setdefault(key, {"resourceType": rt, "path": path, "pointer": pointer(path),
                        "types": set(), "occurrences": 0, "resourceCount": 0, "examples": []})
                    field["types"].add(value_type(value))
                    field["occurrences"] += 1
                    if key not in seen_paths:
                        field["resourceCount"] += 1
                        seen_paths.add(key)
                    if len(field["examples"]) < 3:
                        sample = lexical_json(value)
                        if len(sample.encode()) <= 512 and {"jsonText": sample} not in field["examples"]:
                            field["examples"].append({"jsonText": sample})
            for item in stats.values():
                if packet.mode == "capture" and item.get("count") is not None and item["count"] != item["resources"]:
                    findings.append({"code": "manifest-count-differs", "message": "Original manifest count differs from actual NDJSON resource lines.",
                                     "fileId": item["id"], "expected": item["count"], "observed": item["resources"]})
                if item["blankLines"]:
                    findings.append({"code": "blank-original-lines", "message": "Original empty NDJSON lines remain retained.",
                                     "fileId": item["id"], "count": item["blankLines"]})
            p = packet.export["parameters"]
            connection = packet.connection
            capture_list = []
            if packet.mode == "capture":
                capture_list = [{"id": packet.source_id, "transactionTime": packet.manifest["transactionTime"],
                                 "request": packet.export["request"]["url"], "parameters": p}]
            else:
                for entry in packet.manifest["captures"]:
                    with packet.open(entry["name"]) as nested_stream, Packet(nested_stream) as nested:
                        capture_list.append({"id": entry["sourceId"], "transactionTime": nested.manifest["transactionTime"],
                                             "request": nested.export["request"]["url"], "parameters": nested.export["parameters"]})
            return {"schema": "stellar-forge.fhir-bulk-inventory.v1", "mode": packet.mode,
                    "classification": {key: connection[key] for key in ["origin", "publisher", "sourceUrl", "note"]},
                    "export": {"connectionId": packet.export["connectionId"], "baseUrl": connection["baseUrl"],
                               "scope": packet.export["scope"], "groupId": packet.export["groupId"], "parameters": p,
                               "requestSha256": packet.export["request"]["requestSha256"]},
                    "transactionTime": packet.manifest["transactionTime"], "captures": capture_list,
                    "files": list(stats.values()), "resourceTypes": sorted(types.values(), key=lambda item: item["type"]),
                    "fields": [{**item, "types": sorted(item["types"])} for _, item in sorted(fields.items())],
                    "fieldsComplete": excluded == 0, "excludedPathOccurrences": excluded,
                    "totals": totals, "findings": findings[:1000], "findingsOmitted": max(0, len(findings) - 1000),
                    "coverage": {"kind": "retained-resource-state" if packet.mode == "materialized" else "modification-export" if p["since"] else "full-export",
                                 "since": p["since"], "until": p["until"], "transactionTime": packet.manifest["transactionTime"]},
                    "composition": packet.manifest.get("composition")}
        finally:
            db.close()


def validate_plan(raw):
    allowed = {"schema", "name", "resourceType", "columns", "filters", "ranges", "sorts", "keys",
               "defaultLimit", "maxLimit", "maxBytes", "maxRows", "maxCellChars", "allowEmpty"}
    exact(raw, allowed, "FHIR mapping")
    if raw.get("schema") != PLAN_SCHEMA:
        raise InputError("Mapping schema must be " + PLAN_SCHEMA)
    rt = raw.get("resourceType")
    if not isinstance(rt, str) or not RESOURCE_TYPE.fullmatch(rt):
        raise InputError("Choose one explicit original FHIR resource type")
    columns = raw.get("columns")
    if not isinstance(columns, list) or not 1 <= len(columns) <= 64:
        raise InputError("Choose 1–64 native columns")
    converted, selected = [], []
    for raw_column in columns:
        exact(raw_column, {"name", "source", "path", "mode", "encoding", "type", "nullable", "missing", "default", "separator"}, "FHIR column")
        name = raw_column.get("name")
        if not isinstance(name, str) or not COLUMN.fullmatch(name) or name in {"constructor", "prototype", "__proto__"}:
            raise InputError("Choose a native column identifier")
        path = raw_column.get("path", [])
        if not isinstance(path, list) or len(path) > 64 or any(not isinstance(v, str) or len(v) > 2048 for v in path):
            raise InputError("Projection path requires exact string tokens")
        source_kind = raw_column.get("source", "resource")
        if source_kind not in {"resource", "record"}:
            raise InputError("Column source must be resource or record")
        if source_kind == "record" and (len(path) != 1 or path[0] not in {"resourceType", "id", "versionId", "lastUpdated", "fileId", "line", "recordId", "sourceId"}):
            raise InputError("Choose an original record metadata field")
        mode = raw_column.get("mode", "single")
        encoding = raw_column.get("encoding", "json")
        typ = raw_column.get("type", "string")
        nullable = raw_column.get("nullable", False)
        missing = raw_column.get("missing", "error")
        if mode not in {"single", "first", "last", "array", "join"} or encoding not in {"plain", "json"}:
            raise InputError("Choose an explicit multiplicity and encoding")
        if encoding == "json" and typ != "string" or mode in {"array", "join"} and typ != "string":
            raise InputError("JSON and repeated-field outputs require native string columns")
        if mode == "array" and encoding != "json":
            raise InputError("Array mode uses exact JSON-cell encoding")
        if mode == "join" and encoding != "plain":
            raise InputError("Joined scalar values use explicit plain encoding")
        item = {"name": name, "source": source_kind, "path": path, "mode": mode, "encoding": encoding,
                "type": typ, "nullable": nullable, "missing": missing}
        native = {"name": name, "path": [], "type": typ, "nullable": nullable, "mode": "single", "missing": missing}
        if missing == "default":
            item["default"] = raw_column.get("default")
            native["default"] = item["default"]
        if mode == "join":
            item["separator"] = text(raw_column.get("separator"), "Join separator", 128)
        selected.append(item)
        converted.append(native)
    proxy = {key: raw[key] for key in allowed - {"resourceType", "columns", "schema"} if key in raw}
    proxy.update({"schema": "stellar-forge.xml-mapping.v1", "recordPath": ["resource"], "columns": converted})
    checked = native_plan(proxy)
    result = {key: checked[key] for key in ["name", "filters", "ranges", "sorts", "keys", "defaultLimit",
              "maxLimit", "maxBytes", "maxRows", "maxCellChars", "allowEmpty"]}
    return {"schema": PLAN_SCHEMA, "resourceType": rt, "columns": selected, **result}


def select_values(root, path):
    values = [root]
    for token in path:
        found = []
        for value in values:
            if token == "*" and isinstance(value, list):
                found.extend(value)
            elif isinstance(value, dict) and token in value:
                found.append(value[token])
            elif isinstance(value, list) and re.fullmatch(r"0|[1-9][0-9]*", token):
                index = int(token)
                if index < len(value):
                    found.append(value[index])
        values = found
    return values


def scalar_text(value, label):
    if isinstance(value, Number):
        return str(value)
    if isinstance(value, str):
        return value
    if value is True:
        return "true"
    if value is False:
        return "false"
    if type(value) is int:
        return str(value)
    if value is None:
        return None
    raise InputError(label + " selected an object or array; choose JSON encoding")


def project(row, column, ordinal, cell_limit):
    source = row["_resource"] if column["source"] == "resource" else row
    values = select_values(source, column["path"])
    label = "Record " + str(ordinal) + ", " + column["name"]
    if column["mode"] == "array":
        cell = lexical_json(values)
    elif not values:
        if column["missing"] == "error":
            raise InputError(label + " is missing; choose an explicit missing-value policy")
        cell = column.get("default", "") if column["missing"] == "default" else ""
    elif column["mode"] == "join":
        strings_ = [scalar_text(value, label) for value in values]
        if any(value is None for value in strings_):
            raise InputError(label + " cannot join a null value; choose array mode")
        cell = column["separator"].join(strings_)
    else:
        if column["mode"] == "single" and len(values) != 1:
            raise InputError(label + " matched multiple values; choose a repeated-field policy")
        value = values[-1] if column["mode"] == "last" else values[0]
        if column["encoding"] == "json":
            cell = lexical_json(value)
        else:
            cell = scalar_text(value, label)
            if cell is None:
                if not column["nullable"]:
                    raise InputError(label + " needs nullable output or JSON encoding for null")
                cell = ""
    if utf16_length(cell) > cell_limit:
        raise InputError(label + " exceeds maxCellChars")
    return cell, typed(cell, column, label)


def extract(stream, plan, on_record, cancel=None):
    plan = validate_plan(plan)
    count = 0
    with Packet(stream) as packet:
        validate_capture(packet)
        for row in packet.records("output", cancel):
            if row.get("_blank") or row.get("organizedHeader") or row["resourceType"] != plan["resourceType"]:
                continue
            count += 1
            if count > plan["maxRows"]:
                raise InputError("Selected original resources exceed maxRows")
            cells = [project(row, column, count, plan["maxCellChars"]) for column in plan["columns"]]
            on_record(count, [pair[0] for pair in cells], [pair[1] for pair in cells])
    return count


def dataset_spec(plan):
    return native_spec(validate_plan(plan))


def default_mapping(shape, resource_type, name=None):
    types = {item["type"]: item for item in shape["resourceTypes"]}
    if resource_type not in types:
        raise InputError("Choose a resource type present in this original source")
    def column(name, source, path, encoding="plain", nullable=False):
        return {"name": name, "source": source, "path": path, "mode": "single", "encoding": encoding,
                "type": "string", "nullable": nullable, "missing": "empty" if nullable else "error"}
    columns = [
        column("resource_type", "record", ["resourceType"]),
        column("resource_id", "record", ["id"], nullable=True),
        column("version_id", "record", ["versionId"], encoding="json", nullable=True),
        column("last_updated", "record", ["lastUpdated"], encoding="json", nullable=True),
        column("record_id", "record", ["recordId"]),
        column("resource_json", "resource", [], encoding="json")
    ]
    if not types[resource_type]["missingIds"]:
        columns[1]["nullable"] = False
        columns[1]["missing"] = "error"
    keys = ["resource_type", "resource_id"] if not types[resource_type]["missingIds"] and not types[resource_type]["duplicateIdentities"] else []
    return validate_plan({"schema": PLAN_SCHEMA, "name": name or resource_type + " FHIR source",
        "resourceType": resource_type, "columns": columns, "filters": ["resource_id", "resource_type"],
        "ranges": [], "sorts": ["resource_id"], "keys": keys, "allowEmpty": False})
