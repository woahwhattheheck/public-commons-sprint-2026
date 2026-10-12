"""MIT. Typed directory intake/GET contracts and retained publisher schema access."""
from __future__ import annotations
from functools import lru_cache
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import urlsplit
from directory_runtime import InputError, fhir

HERE = Path(__file__).resolve().parent
SOURCE_SCHEMA = "stellar-forge.directory-source.v1"
INDEX_SCHEMA = "stellar-forge.directory-index.v1"
EDITION_SCHEMA = "stellar-forge.directory-edition.v1"
COMPARISON_SCHEMA = "stellar-forge.directory-comparison.v1"
OPERATION_SCHEMA = "stellar-forge.directory-acquisition.v1"
CAPTURE_SCHEMA = "stellar-forge.directory-capture.v1"
MAX_BYTES = 256 * 1024 * 1024
MAX_RECORD = 16 * 1024 * 1024
MAX_INTERACTIVE = 4 * 1024 * 1024
MAX_ROWS = 100000
MAX_EDITION_ROWS = 250000
MAX_EDGES = 500000
MAX_MEMBERS = 4096
MAX_PAGES = 512
HSD_TYPES = ("Organization", "Location", "HealthcareService", "Endpoint")
HSDS_ENDPOINTS = {"service": "services", "organization": "organizations",
    "taxonomy": "taxonomies", "taxonomy_term": "taxonomy_terms",
    "service_at_location": "service_at_locations"}
ORIGINAL_SHA = "e3312d1577709bb455c50331023f47f61f8527de417e7db7bf09b7f7dd244e27"
sha, jbytes, identity, integer = fhir.sha, fhir.jbytes, fhir.identity, fhir.integer
json_value, lexical_json = fhir.json_value, fhir.lexical_json


@lru_cache(maxsize=1)
def original_sources():
    raw = (HERE / "directory-original-source.json").read_bytes()
    if sha(raw) != ORIGINAL_SHA:
        raise InputError("The complete selected directory publisher source differs from its pinned edition")
    value = json_value(raw)
    if value.get("schema") != "commons.original-directory-source.v1":
        raise InputError("Unsupported original directory source envelope")
    for source in value["sources"]:
        for member in source["files"]:
            body = member["content"].encode("utf-8")
            git = hashlib.sha1(b"blob " + str(len(body)).encode() + b"\0" + body).hexdigest()
            if len(body) != member["bytes"] or git != member["git_blob_sha"]:
                raise InputError("Retained directory publisher source member changed: " + member["path"])
    return value


@lru_cache(maxsize=1)
def standards():
    src = next(s for s in original_sources()["sources"] if s["id"] == "hsds-3.3.1")
    files = {f["path"]: f for f in src["files"]}
    package = json_value(files["datapackage.json"]["content"])
    tables = {}
    for resource in package["resources"]:
        name = resource["name"]
        member = files["schema/" + name + ".json"]
        tables[name] = {"schema": json_value(member["content"]), "tabular": resource,
            "source": {"repository": src["repository"], "ref": src["ref"],
                "release": src["release"], "path": member["path"], "git_blob_sha": member["git_blob_sha"],
                "bytes": member["bytes"]}}
    return {"tables": tables, "datapackage": package,
        "openapi": json_value(files["schema/openapi.json"]["content"]),
        "source": {k: src[k] for k in ("id", "repository", "ref", "release", "license")}}


@lru_cache(maxsize=1)
def _catalogue():
    value = json_value((HERE / "directory-source-schema.json").read_bytes())
    if value.get("schema") != "stellar-forge.directory-source-catalogue.v1":
        raise InputError("Unsupported directory source catalogue")
    return value


def source_catalogue():
    value = json_value(jbytes(_catalogue()))
    native = standards()
    value["tables"] = [{"name": name, "path": item["schema"].get("path"),
        "required": item["schema"].get("required", []),
        "tabularRequired": item["schema"].get("tabular_required", []),
        "fields": item["schema"].get("properties", {}), "foreignKeys": item["tabular"]["schema"].get("foreignKeys", []),
        "source": item["source"]} for name, item in native["tables"].items()]
    value["sourceEditions"] = [{k: s[k] for k in ("id", "repository", "ref", "release", "license")}
        for s in original_sources()["sources"]]
    value["originalDatapackageVersion"] = native["datapackage"].get("version")
    value["hsdsEndpoints"] = HSDS_ENDPOINTS
    value["hsdResourceTypes"] = list(HSD_TYPES)
    return value


def _check(value, spec, path):
    if "anyOf" in spec:
        for choice in spec["anyOf"]:
            try:
                _check(value, choice, path)
                return
            except InputError:
                pass
        raise InputError(path + " does not match a supported input type")
    kind = spec.get("type")
    valid = {"object": isinstance(value, dict), "array": isinstance(value, list),
        "string": type(value) is str, "integer": type(value) is int,
        "boolean": type(value) is bool, "null": value is None}.get(kind, True)
    if not valid:
        raise InputError(path + " must be " + str(kind))
    if "enum" in spec and value not in spec["enum"]:
        raise InputError(path + " must be one of: " + ", ".join(str(v) for v in spec["enum"]))
    if kind == "object":
        props = spec.get("properties", {})
        if spec.get("additionalProperties") is False and set(value) - set(props):
            raise InputError(path + " contains unsupported fields: " + ", ".join(sorted(set(value) - set(props))))
        missing = set(spec.get("required", [])) - set(value)
        if missing:
            raise InputError(path + " requires: " + ", ".join(sorted(missing)))
        for key, child in value.items():
            if key in props:
                _check(child, props[key], path + "." + key)
    elif kind == "array":
        if len(value) > spec.get("maxItems", 1000000):
            raise InputError(path + " exceeds its supported item count")
        for n, item in enumerate(value):
            _check(item, spec.get("items", {}), path + "[" + str(n) + "]")
    elif kind == "string":
        if not spec.get("minLength", 0) <= len(value) <= spec.get("maxLength", 10000000):
            raise InputError(path + " has an unsupported text length")
        if "pattern" in spec and not re.fullmatch(spec["pattern"], value):
            raise InputError(path + " does not have the required exact identity syntax")
        if any(ord(c) < 32 and c not in "\r\n\t" for c in value):
            raise InputError(path + " contains unsupported control characters")
    elif kind == "integer":
        if not spec.get("minimum", -10**100) <= value <= spec.get("maximum", 10**100):
            raise InputError(path + " exceeds its supported integer range")


def typed(name, raw):
    try:
        spec = _catalogue()["inputSchemas"][name]
    except KeyError as error:
        raise InputError("Unknown directory source action") from error
    _check(raw, spec, name)
    # This copy also rejects NaN and non-JSON values before retaining an input.
    return json_value(jbytes(raw))


def import_value(raw):
    value = typed("import", raw)
    if not value["label"].strip():
        raise InputError("Give the complete original source a label")
    value.setdefault("members", [])
    value.setdefault("encoding", "utf-8-sig")
    value.setdefault("delimiter", ",")
    value.setdefault("referenceBase", None)
    value.setdefault("sourceUrl", "")
    value.setdefault("publisher", "")
    value.setdefault("scope", "unknown")
    value.setdefault("note", "")
    if value["referenceBase"] is not None:
        value["referenceBase"] = fhir.http_url(value["referenceBase"], "Reviewed FHIR reference base", True)
    if value["format"].startswith("hsds-"):
        if value["format"] == "hsds-json":
            value.setdefault("layout", "entity")
            if value["layout"] != "tables" and not value.get("table"):
                raise InputError("HSDS JSON needs its exact canonical table, unless layout is tables")
        elif value["format"] == "hsds-csv" and not value.get("table"):
            raise InputError("Original CSV needs its explicitly selected canonical table")
        if value["format"] == "hsds-csv-zip":
            if not value["members"] or any(not m.get("table") for m in value["members"]):
                raise InputError("CSV archive intake requires exact selected member paths and canonical tables")
    if value["format"] == "fhir-json-zip" and not value["members"]:
        raise InputError("Select the exact original FHIR JSON members to index; all archive bytes remain retained")
    if not value["format"].endswith("-zip") and value["format"] != "directory-capture" and value["members"]:
        raise InputError("Individual original files do not use an archive-member selection")
    return value


def public_origin(raw):
    return raw.get("origin", "operator_source")


def scalar_id(value):
    # IDs remain lexical source values. Booleans/numbers are not silently made IDs.
    return value if type(value) is str and value != "" else None


def json_types(value, path=""):
    if isinstance(value, fhir.Number):
        yield path, str(value)
    elif isinstance(value, dict):
        for key, item in value.items():
            yield from json_types(item, path + "/" + key.replace("~", "~0").replace("/", "~1"))
    elif isinstance(value, list):
        for n, item in enumerate(value):
            yield from json_types(item, path + "/" + str(n))


def scope_url(base, url):
    from urllib.parse import urljoin
    absolute = fhir.http_url(urljoin(base.rstrip("/") + "/", url), "Selected original directory URL")
    bp, up = urlsplit(base), urlsplit(absolute)
    if fhir.origin(base) != fhir.origin(absolute) or not (
            up.path == bp.path.rstrip("/") or up.path.startswith(bp.path.rstrip("/") + "/")):
        raise InputError("The original directory URL leaves the reviewed provider base")
    return absolute


def descriptor_ref(row, source_id=None):
    return {k: v for k, v in {
        "sourceId": source_id or row.get("sourceId"), "recordId": row["recordId"],
        "table": row["table"], "rowOrdinal": row["rowOrdinal"],
        "rowSha256": row["rowSha256"], "resourceSha256": row["resourceSha256"],
        "memberName": row["memberName"], "memberSha256": row["memberSha256"],
        "pointer": row["pointer"]}.items() if v is not None}
