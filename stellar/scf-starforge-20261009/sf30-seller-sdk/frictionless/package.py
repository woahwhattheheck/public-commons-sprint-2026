#!/usr/bin/env python3
"""MIT. Retained Frictionless table packages for the original SF30 publisher.

Python standard library only. Retains original descriptors, data, schema,
dialect and rights; explicit projections preserve physical scalar text.
"""
from __future__ import annotations
import argparse
import csv
import datetime as dt
import hashlib
import gzip
import io
import itertools
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import sqlite3
import stat
import sys
import tarfile
import tempfile
import urllib.parse
import urllib.request
from decimal import Decimal, InvalidOperation

CAPTURE = "stellar-forge.frictionless-capture.v1"
SOURCE = "stellar-forge.frictionless-source.v1"
SHA = re.compile(r"[a-f0-9]{64}\Z")
NAME = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,47}\Z")
META_MAX = 8 * 1024 * 1024
DATA_MAX = 256 * 1024 * 1024
FORBIDDEN = {"constructor", "prototype", "__proto__"}

class PackageError(ValueError):
    def __init__(self, code, detail=""):
        self.code = code
        super().__init__(f"{code}: {detail}" if detail else code)

def fail(code, detail=""):
    raise PackageError(code, detail)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode()

def unique_pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            fail("PACKAGE_JSON_DUPLICATE_KEY", key)
        result[key] = value
    return result

def parse(data, exact=False):
    try:
        options = {"parse_float": Decimal, "parse_int": Decimal} if exact else {}
        return json.loads(data.decode("utf-8-sig"), object_pairs_hook=unique_pairs,
                          parse_constant=lambda v: fail("PACKAGE_JSON_NUMBER_INVALID", v), **options)
    except (UnicodeError, json.JSONDecodeError) as issue:
        fail("PACKAGE_JSON_INVALID", str(issue))

def obj(value, code="PACKAGE_OBJECT_REQUIRED"):
    if not isinstance(value, dict):
        fail(code)
    return value

def member(name):
    if not isinstance(name, str) or not name or len(name) > 1024 or "\\" in name or "\0" in name:
        fail("PACKAGE_MEMBER_INVALID")
    p = PurePosixPath(name)
    if p.is_absolute() or str(p) != name or any(v in ("", ".", "..") for v in p.parts):
        fail("PACKAGE_MEMBER_INVALID", name)
    return name

def read(path, maximum=DATA_MAX, private=False):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(fd, "rb") as handle:
        before = os.fstat(handle.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > maximum:
            fail("PACKAGE_FILE_INVALID", str(path))
        if private and (before.st_mode & 0o077 or before.st_nlink != 1):
            fail("PACKAGE_PRIVATE_FILE_REQUIRED", str(path))
        data = handle.read(maximum + 1)
        after = os.fstat(handle.fileno())
        if len(data) != before.st_size or len(data) > maximum or (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            fail("PACKAGE_FILE_CHANGED", str(path))
        return data

def fingerprint(path, maximum=DATA_MAX, private=False):
    """Hash a retained file in bounded memory while checking its original inode."""
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(fd, "rb") as handle:
        before = os.fstat(handle.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > maximum:
            fail("PACKAGE_FILE_INVALID", str(path))
        if private and (before.st_mode & 0o077 or before.st_nlink != 1):
            fail("PACKAGE_PRIVATE_FILE_REQUIRED", str(path))
        total, digest = 0, hashlib.sha256()
        while chunk := handle.read(1024 * 1024):
            total += len(chunk)
            if total > maximum:
                fail("PACKAGE_FILE_INVALID", str(path))
            digest.update(chunk)
        after = os.fstat(handle.fileno())
        if total != before.st_size or (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            fail("PACKAGE_FILE_CHANGED", str(path))
        return {"sha256": digest.hexdigest(), "bytes": total}

def create(path, data):
    path = Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with path.open("xb") as handle:
        os.chmod(path, 0o600)
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())

def sync(path):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def https(url):
    p = urllib.parse.urlsplit(url)
    if p.scheme != "https" or not p.netloc or p.username or p.password or p.fragment:
        fail("PACKAGE_HTTPS_URL_REQUIRED")
    return url

def locator(reference, base=None):
    if not isinstance(reference, str) or not reference:
        fail("PACKAGE_REFERENCE_INVALID")
    if urllib.parse.urlsplit(reference).scheme:
        return https(reference)
    if base and urllib.parse.urlsplit(base).scheme:
        return https(urllib.parse.urljoin(base, reference))
    if base:
        member(reference)
        return str((Path(base).parent / reference).resolve())
    return str(Path(reference).expanduser().resolve())

class HttpsRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        https(newurl)
        return super().redirect_request(request, fp, code, msg, headers, newurl)

def retrieve(url, maximum, timeout):
    if urllib.parse.urlsplit(url).scheme != "https":
        return read(url, maximum), {"requested": url, "resolved": url}
    request = urllib.request.Request(url, headers={"User-Agent": "StellarForge-Frictionless/1", "Accept-Encoding": "identity"})
    with urllib.request.build_opener(HttpsRedirect()).open(request, timeout=timeout) as response:
        data = response.read(maximum + 1)
        if len(data) > maximum:
            fail("PACKAGE_RESOURCE_TOO_LARGE")
        return data, {"requested": url, "resolved": https(response.geturl()), "status": response.status,
                      "etag": response.headers.get("ETag"), "lastModified": response.headers.get("Last-Modified"),
                      "contentType": response.headers.get("Content-Type")}

def capture_package(descriptor, output, selected=(), timeout=60, references=()):
    output = Path(output).absolute()
    if output.exists() or output.is_symlink():
        fail("PACKAGE_OUTPUT_EXISTS", str(output))
    output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=".frictionless-capture-", dir=output.parent))
    files, receipts = {}, []
    try:
        def fetch(reference, base=None, maximum=META_MAX):
            data, receipt = retrieve(locator(reference, base), maximum, timeout)
            digest = sha(data)
            name = "files/" + digest + ".bin"
            if name not in files:
                create(temporary / name, data)
                files[name] = {"file": name, "sha256": digest, "bytes": len(data)}
            receipts.append({**receipt, **files[name]})
            return data, receipt["resolved"], name

        raw, origin, descriptor_file = fetch(descriptor)
        package = obj(parse(raw), "PACKAGE_DESCRIPTOR_INVALID")
        resources = package.get("resources")
        if not isinstance(resources, list) or not resources or len(resources) > 1000:
            fail("PACKAGE_RESOURCES_REQUIRED")
        chosen, names = [], set()
        for index, entry in enumerate(resources):
            resource_origin, resource_file = origin, descriptor_file
            if isinstance(entry, str):
                resource_raw, resource_origin, resource_file = fetch(entry, origin)
                resource = obj(parse(resource_raw), "PACKAGE_RESOURCE_INVALID")
            else:
                resource = obj(entry, "PACKAGE_RESOURCE_INVALID")
            name = resource.get("name")
            if not isinstance(name, str) or not name or name in names:
                fail("PACKAGE_RESOURCE_NAME_INVALID", str(name))
            names.add(name)
            if selected and name not in selected:
                continue
            resolved = {}
            for key in ("schema", "dialect"):
                value, file = resource.get(key, {}), None
                if isinstance(value, str):
                    content, _, file = fetch(value, resource_origin)
                    value = parse(content)
                resolved[key], resolved[key + "File"] = obj(value), file
            members = []
            if "path" in resource:
                paths = resource["path"] if isinstance(resource["path"], list) else [resource["path"]]
                if not paths or len(paths) > 1000 or "data" in resource:
                    fail("PACKAGE_RESOURCE_PATH_INVALID", name)
                for path in paths:
                    data, resolved_url, file = fetch(path, resource_origin, DATA_MAX)
                    members.append({"path": path, "resolved": resolved_url, **files[file]})
            elif "data" in resource:
                members.append({"inline": True, **files[resource_file]})
            else:
                fail("PACKAGE_RESOURCE_DATA_REQUIRED", name)
            chosen.append({"index": index, "name": name, "descriptor": resource,
                           "descriptorFile": resource_file, **resolved, "members": members})
        if selected and set(selected) - {r["name"] for r in chosen}:
            fail("PACKAGE_RESOURCE_NOT_FOUND", ", ".join(sorted(set(selected) - names)))
        reference_files = []
        for reference in references:
            content, resolved_url, reference_file = fetch(reference, maximum=DATA_MAX)
            reference_files.append({"url": reference, "resolved": resolved_url, **files[reference_file]})
        manifest = {"schema": CAPTURE, "state": "COMPLETE", "capturedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
                    "descriptorFile": descriptor_file, "origin": origin, "package": package,
                    "resources": chosen, "files": list(files.values()), "retrievals": receipts, "references": reference_files}
        raw_manifest = encoded(manifest)
        if len(raw_manifest) > META_MAX:
            fail("PACKAGE_CAPTURE_METADATA_TOO_LARGE")
        create(temporary / "capture.json", raw_manifest)
        sync(temporary / "files")
        sync(temporary)
        os.rename(temporary, output)
        sync(output.parent)
        return {"captureFile": str(output / "capture.json"), "sha256": sha(raw_manifest),
                "resources": [r["name"] for r in chosen], "bytes": sum(v["bytes"] for v in files.values())}
    except BaseException:
        shutil.rmtree(temporary, ignore_errors=True)
        raise

def read_capture(filename, expected=None):
    filename = Path(filename).absolute()
    raw = read(filename, META_MAX, True)
    if expected is not None and (not isinstance(expected, str) or not SHA.fullmatch(expected) or sha(raw) != expected):
        fail("PACKAGE_CAPTURE_CHANGED")
    manifest = obj(parse(raw), "PACKAGE_CAPTURE_INVALID")
    if manifest.get("schema") != CAPTURE or manifest.get("state") != "COMPLETE":
        fail("PACKAGE_CAPTURE_INVALID")
    files, verified = {}, {}
    for item in manifest.get("files", []):
        name = member(item.get("file"))
        if name in files or not SHA.fullmatch(item.get("sha256", "")):
            fail("PACKAGE_CAPTURE_FILES_INVALID")
        path = filename.parent / name
        check = path.parent
        while True:
            mode = check.lstat().st_mode
            if not stat.S_ISDIR(mode) or mode & 0o077:
                fail("PACKAGE_PRIVATE_DIRECTORY_REQUIRED", str(check))
            if check == filename.parent:
                break
            check = check.parent
        observed = fingerprint(path, DATA_MAX, True)
        if observed["bytes"] != item.get("bytes") or observed["sha256"] != item["sha256"]:
            fail("PACKAGE_CAPTURE_MEMBER_CHANGED", name)
        files[name], verified[name] = path, observed
    if not files or manifest.get("descriptorFile") not in files:
        fail("PACKAGE_CAPTURE_FILES_INVALID")
    original = parse(read(files[manifest["descriptorFile"]], META_MAX))
    if original != manifest.get("package"):
        fail("PACKAGE_DESCRIPTOR_BINDING_CHANGED")
    resources, names = manifest.get("resources"), set()
    if not isinstance(resources, list) or not resources:
        fail("PACKAGE_CAPTURE_RESOURCES_INVALID")
    for resource in resources:
        name, index = resource.get("name"), resource.get("index")
        if not isinstance(name, str) or name in names or type(index) is not int or not 0 <= index < len(original["resources"]):
            fail("PACKAGE_RESOURCE_BINDING_CHANGED")
        names.add(name)
        entry = original["resources"][index]
        declared = parse(read(files[resource["descriptorFile"]], META_MAX)) if isinstance(entry, str) else entry
        if declared != resource.get("descriptor") or declared.get("name") != name:
            fail("PACKAGE_RESOURCE_BINDING_CHANGED")
        for key in ("schema", "dialect"):
            ref = declared.get(key, {})
            retained = parse(read(files[resource[key + "File"]], META_MAX)) if isinstance(ref, str) else ref
            if retained != resource.get(key):
                fail("PACKAGE_SCHEMA_BINDING_CHANGED")
        declared_paths = declared.get("path")
        if isinstance(declared_paths, str):
            declared_paths = [declared_paths]
        expected_paths = [v.get("path") for v in resource["members"]] if "path" in declared else None
        if declared_paths != expected_paths:
            fail("PACKAGE_RESOURCE_PATH_BINDING_CHANGED")
        for item in resource.get("members", []):
            if item.get("file") not in files or item.get("sha256") != verified[item["file"]]["sha256"]:
                fail("PACKAGE_RESOURCE_MEMBER_INVALID")
    return {"manifest": manifest, "sha256": sha(raw), "files": files, "filename": filename}

def fields_for(resource):
    fields = resource["schema"].get("fields")
    if not isinstance(fields, list) or not fields or len(fields) > 10000:
        fail("PACKAGE_FIELDS_REQUIRED", resource["name"])
    names = set()
    for field in fields:
        if not isinstance(field, dict) or not isinstance(field.get("name"), str) or not field["name"] or field["name"] in names:
            fail("PACKAGE_FIELD_NAME_INVALID", resource["name"])
        names.add(field["name"])
    return fields

def missing_for(field, schema):
    values = field.get("missingValues", schema.get("missingValues", [""]))
    if not isinstance(values, list):
        fail("PACKAGE_MISSING_VALUES_INVALID")
    result = []
    for value in values:
        marker = value.get("value") if isinstance(value, dict) else value
        if not isinstance(marker, str) or marker in result:
            fail("PACKAGE_MISSING_VALUES_INVALID")
        result.append(marker)
    return result

def field_mapping(header, fields, schema):
    names = [v["name"] for v in fields]
    if len(header) != len(set(header)) or any(not isinstance(v, str) or not v for v in header):
        fail("PACKAGE_HEADER_INVALID")
    mode = schema.get("fieldsMatch", "exact")
    allowed = {"exact": header == names, "equal": set(header) == set(names),
               "subset": set(names) <= set(header), "superset": set(header) <= set(names),
               "partial": bool(set(header) & set(names))}
    if mode not in allowed or not allowed[mode]:
        fail("PACKAGE_FIELDS_MATCH_FAILED", mode)
    return {name: header.index(name) if name in header else None for name in names}

def raw_json(value):
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, dict):
        return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + raw_json(v) for k, v in value.items()) + "}"
    if isinstance(value, list):
        return "[" + ",".join(raw_json(v) for v in value) + "]"
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))

def resource_rows(capture, resource):
    fields = fields_for(resource)
    descriptor, dialect = resource["descriptor"], resource["dialect"]
    fmt = descriptor.get("format", "csv").lower()
    if fmt not in ("csv", "tsv", "json"):
        fail("PACKAGE_TABLE_FORMAT_UNSUPPORTED", fmt)
    for item in resource["members"]:
        data = read(capture["files"][item["file"]])
        if item.get("inline") or fmt == "json":
            doc = parse(data, exact=True)
            if item.get("inline"):
                doc = doc["data"] if resource["descriptorFile"] != capture["manifest"]["descriptorFile"] else doc["resources"][resource["index"]]["data"]
            if not isinstance(doc, list):
                fail("PACKAGE_JSON_ROWS_REQUIRED")
            for number, row in enumerate(doc, 1):
                if isinstance(row, dict):
                    mapping = field_mapping(list(row), fields, resource["schema"])
                    values = {name: row.get(name) for name in mapping}
                elif isinstance(row, list):
                    if len(row) != len(fields):
                        fail("PACKAGE_ROW_WIDTH_INVALID", str(number))
                    values = dict(zip((field["name"] for field in fields), row))
                else:
                    fail("PACKAGE_JSON_ROW_INVALID", str(number))
                yield {name: value if isinstance(value, str) or value is None else raw_json(value) for name, value in values.items()}
            continue
        delimiter = dialect.get("delimiter", "\t" if fmt == "tsv" else ",")
        quote, escape = dialect.get("quoteChar", '"'), dialect.get("escapeChar")
        if not isinstance(delimiter, str) or len(delimiter) != 1 or quote is not None and (not isinstance(quote, str) or len(quote) != 1) or escape is not None and (not isinstance(escape, str) or len(escape) != 1):
            fail("PACKAGE_CSV_CHARACTER_UNSUPPORTED")
        if dialect.get("lineTerminator", "\r\n") not in ("\n", "\r\n", "\r"):
            fail("PACKAGE_CSV_LINE_TERMINATOR_UNSUPPORTED")
        for flag in ("header", "doubleQuote", "skipInitialSpace"):
            if flag in dialect and type(dialect[flag]) is not bool:
                fail("PACKAGE_DIALECT_FLAG_INVALID", flag)
        try:
            text = data.decode(descriptor.get("encoding", "utf-8-sig"))
        except (UnicodeError, LookupError) as issue:
            fail("PACKAGE_ENCODING_INVALID", str(issue))
        header_rows = dialect.get("headerRows", [1]) if dialect.get("header", True) else []
        comments = dialect.get("commentRows", [])
        if not isinstance(header_rows, list) or not isinstance(comments, list) or any(type(v) is not int or v < 1 for v in header_rows + comments) or len(set(header_rows)) != len(header_rows) or sorted(header_rows) != header_rows or set(header_rows) & set(comments):
            fail("PACKAGE_HEADER_ROWS_INVALID")
        comment_char = dialect.get("commentChar")
        if comment_char is not None and (not isinstance(comment_char, str) or not comment_char):
            fail("PACKAGE_COMMENT_CHAR_INVALID")
        def records():
            # A fresh csv.reader consumes exactly one logical record from this
            # shared physical-line iterator. Comments are recognized only at a
            # record boundary, so quoted/multiline values beginning with the
            # comment marker remain data. Comment text need not be valid CSV.
            physical = iter(io.StringIO(text, newline=""))
            for number, first_line in enumerate(physical, 1):
                if number in comments or comment_char and first_line.startswith(comment_char):
                    continue
                reader = csv.reader(itertools.chain([first_line], physical), delimiter=delimiter, quotechar=quote,
                                    escapechar=escape, doublequote=dialect.get("doubleQuote", True),
                                    skipinitialspace=dialect.get("skipInitialSpace", False), strict=True,
                                    quoting=csv.QUOTE_NONE if quote is None else csv.QUOTE_MINIMAL)
                yield number, next(reader)
        headers, mapping, width = [], None, None
        if not header_rows:
            headers = [[field["name"] for field in fields]]
            mapping = field_mapping(headers[0], fields, resource["schema"])
            width = len(headers[0])
        try:
            for number, row in records():
                if number in header_rows:
                    headers.append(row)
                    if len(headers) == len(header_rows):
                        if len({len(part) for part in headers}) != 1:
                            fail("PACKAGE_HEADER_WIDTH_INVALID")
                        joiner = dialect.get("headerJoin", " ")
                        if not isinstance(joiner, str):
                            fail("PACKAGE_HEADER_JOIN_INVALID")
                        header = [joiner.join(parts) for parts in zip(*headers)]
                        mapping = field_mapping(header, fields, resource["schema"])
                        width = len(header)
                    continue
                if mapping is None:
                    if header_rows and number < max(header_rows):
                        continue
                    fail("PACKAGE_HEADER_MISSING")
                if len(row) != width:
                    fail("PACKAGE_ROW_WIDTH_INVALID", f"{resource['name']} record {number}: expected {width}, received {len(row)}")
                values = {name: row[index] if index is not None else None for name, index in mapping.items()}
                null_sequence = dialect.get("nullSequence")
                if null_sequence is not None:
                    if not isinstance(null_sequence, str):
                        fail("PACKAGE_NULL_SEQUENCE_INVALID")
                    values = {name: None if value == null_sequence else value for name, value in values.items()}
                yield values
            if mapping is None:
                fail("PACKAGE_HEADER_MISSING")
        except csv.Error as issue:
            fail("PACKAGE_CSV_INVALID", str(issue))

def numeric(value, field):
    text = value
    group, decimal = field.get("groupChar", ""), field.get("decimalChar", ".")
    if not isinstance(group, str) or len(group) > 1 or not isinstance(decimal, str) or len(decimal) != 1 or group and group == decimal:
        fail("PACKAGE_NUMBER_DIALECT_INVALID")
    if group:
        text = text.replace(group, "")
    if decimal != ".":
        text = text.replace(decimal, ".")
    if field.get("bareNumber", True) is False:
        text = re.sub(r"^[^0-9+\-.]+|[^0-9eE+\-.]+$", "", text)
    if text not in ("NaN", "INF", "-INF") and not re.fullmatch(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?", text):
        fail("PACKAGE_NUMBER_INVALID", field["name"])
    try:
        value = Decimal(text.replace("INF", "Infinity"))
    except InvalidOperation:
        fail("PACKAGE_NUMBER_INVALID", field["name"])
    if field.get("type") == "integer" and (not value.is_finite() or value != value.to_integral_value()):
        fail("PACKAGE_INTEGER_INVALID", field["name"])
    return value

def logical(value, field, schema):
    if value is None or value in missing_for(field, schema):
        return None
    kind = field.get("type", "any")
    if kind in ("any", "string"):
        return value
    if kind in ("number", "integer"):
        return numeric(value, field)
    if kind == "boolean":
        yes, no = field.get("trueValues", ["true", "True", "TRUE", "1"]), field.get("falseValues", ["false", "False", "FALSE", "0"])
        if not isinstance(yes, list) or not isinstance(no, list) or any(not isinstance(v, str) for v in yes + no) or set(yes) & set(no):
            fail("PACKAGE_BOOLEAN_DECLARATION_INVALID")
        if value in yes:
            return True
        if value in no:
            return False
        fail("PACKAGE_BOOLEAN_INVALID", field["name"])
    if kind in ("object", "array", "geojson"):
        parsed = parse(value.encode(), exact=True)
        if not isinstance(parsed, list if kind == "array" else dict):
            fail("PACKAGE_FIELD_JSON_TYPE_INVALID", field["name"])
        return parsed
    if kind in ("date", "datetime", "time", "year", "yearmonth"):
        fmt = field.get("format", "default").removeprefix("fmt:")
        try:
            if fmt not in ("default", "any"):
                dt.datetime.strptime(value, fmt)
            elif kind == "date":
                if fmt == "any" and re.fullmatch(r"[0-9]{4}-(0[1-9]|1[0-2])", value):
                    dt.date.fromisoformat(value + "-01")
                else:
                    if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
                        raise ValueError()
                    dt.date.fromisoformat(value)
            elif kind == "datetime":
                if "T" not in value:
                    raise ValueError()
                dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
            elif kind == "time":
                dt.time.fromisoformat(value.replace("Z", "+00:00"))
            elif kind == "year":
                if not re.fullmatch(r"[0-9]{4}", value):
                    raise ValueError()
            elif not re.fullmatch(r"[0-9]{4}-(0[1-9]|1[0-2])", value):
                raise ValueError()
        except ValueError:
            fail("PACKAGE_TEMPORAL_INVALID", field["name"])
        return value
    if kind in ("duration", "geopoint", "list"):
        return value
    fail("PACKAGE_FIELD_TYPE_UNSUPPORTED", kind)

def validate_constraints(value, field):
    constraints = obj(field.get("constraints", {}), "PACKAGE_CONSTRAINTS_INVALID")
    if value is None:
        if constraints.get("required") is True:
            fail("PACKAGE_REQUIRED_VALUE_MISSING", field["name"])
        return
    for key, condition in constraints.items():
        if key in ("minLength", "maxLength"):
            if type(condition) is not int or condition < 0:
                fail("PACKAGE_LENGTH_DECLARATION_INVALID", field["name"])
            if not hasattr(value, "__len__") or (key == "minLength" and len(value) < condition) or (key == "maxLength" and len(value) > condition):
                fail("PACKAGE_LENGTH_CONSTRAINT", field["name"])
        elif key == "pattern":
            try:
                match = re.search(condition, value) if isinstance(value, str) else None
            except (re.error, TypeError):
                fail("PACKAGE_PATTERN_INVALID", field["name"])
            if not match:
                fail("PACKAGE_PATTERN_CONSTRAINT", field["name"])
        elif key == "enum":
            if not isinstance(condition, list):
                fail("PACKAGE_ENUM_DECLARATION_INVALID", field["name"])
            choices = [Decimal(str(v)) if isinstance(value, Decimal) and not isinstance(v, bool) else v for v in condition]
            if value not in choices:
                fail("PACKAGE_ENUM_CONSTRAINT", field["name"])
        elif key in ("minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"):
            other = Decimal(str(condition)) if isinstance(value, Decimal) else condition
            try:
                invalid = {"minimum": lambda: value < other, "maximum": lambda: value > other,
                           "exclusiveMinimum": lambda: value <= other, "exclusiveMaximum": lambda: value >= other}[key]()
            except (TypeError, InvalidOperation):
                invalid = True
            if invalid:
                fail("PACKAGE_RANGE_CONSTRAINT", field["name"])

def key_groups(resource):
    schema = resource["schema"]
    primary = schema.get("primaryKey", [])
    primary = [primary] if isinstance(primary, str) else primary
    groups = [("primaryKey", primary, True)] if primary else []
    unique = schema.get("uniqueKeys", [])
    if not isinstance(unique, list):
        fail("PACKAGE_UNIQUE_KEYS_INVALID")
    groups += [("uniqueKeys:" + str(i), [v] if isinstance(v, str) else v, False) for i, v in enumerate(unique)]
    groups += [("unique:" + f["name"], [f["name"]], False) for f in fields_for(resource) if f.get("constraints", {}).get("unique") is True]
    names = {f["name"] for f in fields_for(resource)}
    for _, columns, _ in groups:
        if not isinstance(columns, list) or not columns or any(not isinstance(v, str) for v in columns) or len(columns) != len(set(columns)) or any(v not in names for v in columns):
            fail("PACKAGE_KEY_FIELDS_INVALID")
    return groups

def review_notes(resource):
    notes = []
    if resource["schema"].get("foreignKeys"):
        notes.append({"kind": "foreignKeys", "declaration": resource["schema"]["foreignKeys"],
                      "review": "Retained references. This table projection does not join another resource."})
    for field in fields_for(resource):
        for key in field.get("constraints", {}):
            if key not in ("required", "unique", "minLength", "maxLength", "pattern", "enum", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"):
                notes.append({"field": field["name"], "kind": key, "review": "Retained constraint requires its original profile validator."})
        if field.get("type") in ("duration", "geopoint", "list", "geojson"):
            notes.append({"field": field["name"], "kind": field["type"], "review": "Physical representation retained; review domain rules in the original source profile."})
    return notes

def exact_key(value):
    if not isinstance(value, Decimal) or not value.is_finite():
        return raw_json(value)
    if not value:
        return "0"
    sign, digits, exponent = value.as_tuple()
    digits = list(digits)
    while digits and digits[-1] == 0:
        digits.pop()
        exponent += 1
    return ("-" if sign else "") + "".join(str(d) for d in digits) + "e" + str(exponent)

def stream_review(capture, resource, db):
    fields, schema = fields_for(resource), resource["schema"]
    groups = key_groups(resource)
    db.execute("CREATE TABLE seen_keys (kind TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(kind,value)) WITHOUT ROWID")
    for index, row in enumerate(resource_rows(capture, resource), 1):
        if index > 1_000_000:
            fail("PACKAGE_ROW_LIMIT")
        values = {}
        for field in fields:
            name = field["name"]
            try:
                values[name] = logical(row[name], field, schema)
                validate_constraints(values[name], field)
            except PackageError as issue:
                fail(issue.code, f"{resource['name']} row {index}, {name}: {issue}")
        for name, columns, required in groups:
            selected = [values[column] for column in columns]
            if any(value is None for value in selected):
                if required:
                    fail("PACKAGE_PRIMARY_KEY_MISSING", f"{resource['name']} row {index}")
                continue
            normalized = [exact_key(v) for v in selected]
            try:
                db.execute("INSERT INTO seen_keys VALUES (?,?)", (name, json.dumps(normalized, ensure_ascii=False)))
            except sqlite3.IntegrityError:
                fail("PACKAGE_KEY_DUPLICATE", f"{resource['name']} row {index}: {name}")
        yield index, row, values

def database(directory):
    fd, filename = tempfile.mkstemp(prefix=".frictionless-rows-", suffix=".sqlite", dir=directory)
    os.close(fd)
    db = sqlite3.connect(filename)
    db.execute("PRAGMA journal_mode=OFF")
    db.execute("PRAGMA cache_size=-2048")
    db.execute("PRAGMA temp_store=FILE")
    return db, filename

def inspect_resources(capture, selections):
    resources = []
    for selection, resource, projection in selections:
        db, temporary = database(capture["filename"].parent.parent)
        fields = {f["name"]: {"declared": f, "missingValues": missing_for(f, resource["schema"]),
                             "missing": 0, "empty": 0, "maxChars": 0} for f in fields_for(resource)}
        count, error = 0, None
        try:
            for count, raw, values in stream_review(capture, resource, db):
                for name, info in fields.items():
                    info["missing"] += values[name] is None
                    info["empty"] += raw[name] == ""
                    info["maxChars"] = max(info["maxChars"], len(raw[name]) if raw[name] is not None else 0)
                for alias, spec in (projection or {}).items():
                    projected_value(raw[spec["field"]], values[spec["field"]], spec, alias)
        except PackageError as issue:
            error = {"code": issue.code, "message": str(issue)}
        finally:
            db.close()
            os.unlink(temporary)
        resources.append({"selection": selection, "name": resource["name"],
                          "state": "COMPLETE" if error is None else "SOURCE_REVIEW_REQUIRED",
                          "rows": count if error is None else None, "rowsRead": count, "error": error, "fields": fields,
                          "keys": [{"name": n, "fields": v, "required": r} for n, v, r in key_groups(resource)],
                          "dialect": resource["dialect"], "review": review_notes(resource),
                          "licenses": resource["descriptor"].get("licenses", capture["manifest"]["package"].get("licenses", []))})
    return {"schema": "stellar-forge.frictionless-inspection.v1", "captureSha256": capture["sha256"],
            "origin": capture["manifest"]["origin"], "package": capture["manifest"]["package"], "resources": resources}

def inspect_capture(filename, expected=None):
    capture = read_capture(filename, expected)
    return inspect_resources(capture, [(r["name"], r, None) for r in capture["manifest"]["resources"]])

def review_source(filename):
    _, raw, config, capture, queries = read_source(filename)
    by_name = {r["name"]: r for r in capture["manifest"]["resources"]}
    selections = []
    for name, query in queries.items():
        resource = by_name[query["resource"]]
        effective = {**resource, "schema": query["schema"], "dialect": query["dialect"]}
        selections.append((name, effective, query["projection"]))
    return {**inspect_resources(capture, selections), "sourceHash": sha(raw)}

def read_source(filename):
    filename = Path(filename).absolute()
    raw = read(filename, META_MAX, True)
    config = obj(parse(raw), "PACKAGE_SOURCE_INVALID")
    if config.get("schema") != SOURCE or set(config) - {"schema", "connection", "queries"}:
        fail("PACKAGE_SOURCE_INVALID")
    connection = obj(config.get("connection"), "PACKAGE_SOURCE_CONNECTION_REQUIRED")
    if set(connection) != {"file", "sha256"} or not isinstance(connection["file"], str):
        fail("PACKAGE_SOURCE_CONNECTION_INVALID")
    capture = read_capture((filename.parent / connection["file"]).absolute(), connection["sha256"])
    queries = obj(config.get("queries"), "PACKAGE_QUERIES_REQUIRED")
    if not queries or len(queries) > 64:
        fail("PACKAGE_QUERIES_REQUIRED")
    by_name = {r["name"]: r for r in capture["manifest"]["resources"]}
    descriptions = {}
    for name, query in queries.items():
        if not NAME.fullmatch(name) or name in FORBIDDEN or not isinstance(query, dict) or not {"resource", "projection"} <= set(query) or set(query) - {"resource", "projection", "dialect", "schemaOverride", "schemaReview"}:
            fail("PACKAGE_QUERY_INVALID")
        resource = by_name.get(query["resource"])
        if resource is None:
            fail("PACKAGE_RESOURCE_NOT_CAPTURED", str(query["resource"]))
        original_resource = resource
        if "schemaOverride" in query:
            review = obj(query.get("schemaReview"), "PACKAGE_SCHEMA_REVIEW_REQUIRED")
            if set(review) != {"reason", "sources"} or not isinstance(review["reason"], str) or not review["reason"].strip() or len(review["reason"]) > 2000 or not isinstance(review["sources"], list) or not review["sources"] or len(review["sources"]) > 20:
                fail("PACKAGE_SCHEMA_REVIEW_REQUIRED")
            references = {item["url"]: item for item in capture["manifest"].get("references", [])}
            if any(not isinstance(url, str) or url not in references for url in review["sources"]):
                fail("PACKAGE_SCHEMA_REVIEW_SOURCE_NOT_RETAINED")
            resource = {**resource, "schema": obj(query["schemaOverride"], "PACKAGE_SCHEMA_OVERRIDE_INVALID")}
        elif "schemaReview" in query:
            fail("PACKAGE_SCHEMA_OVERRIDE_REQUIRED")
        override = obj(query.get("dialect", {}), "PACKAGE_DIALECT_OVERRIDE_INVALID")
        allowed_dialect = {"header", "headerRows", "headerJoin", "commentRows", "commentChar", "delimiter", "lineTerminator", "quoteChar", "doubleQuote", "escapeChar", "nullSequence", "skipInitialSpace"}
        if set(override) - allowed_dialect:
            fail("PACKAGE_DIALECT_OVERRIDE_INVALID")
        fields = {f["name"]: f for f in fields_for(resource)}
        projection = obj(query["projection"], "PACKAGE_PROJECTION_REQUIRED")
        if not projection or len(projection) > 64:
            fail("PACKAGE_PROJECTION_REQUIRED")
        for alias, spec in projection.items():
            if not NAME.fullmatch(alias) or alias in FORBIDDEN or not isinstance(spec, dict) or set(spec) - {"field", "type", "missing", "representation"}:
                fail("PACKAGE_PROJECTION_INVALID", alias)
            if spec.get("field") not in fields or spec.get("type") not in ("string", "integer", "number", "boolean") or spec.get("missing") not in ("literal", "null", "reject") or spec.get("representation", "physical") not in ("physical", "logical"):
                fail("PACKAGE_PROJECTION_INVALID", alias)
            if spec["type"] != "string" and spec["missing"] == "literal":
                fail("PACKAGE_LITERAL_REQUIRES_STRING", alias)
            declared = fields[spec["field"]].get("type", "any")
            if spec["type"] in ("integer", "number") and declared not in ("integer", "number") or spec["type"] == "boolean" and declared != "boolean":
                fail("PACKAGE_NATIVE_TYPE_REQUIRES_DECLARATION", alias)
        descriptions[name] = {"sql": "RETAIN FRICTIONLESS RESOURCE " + json.dumps(query["resource"]),
                              "columns": list(projection), "parameters": {}, "parameterOrder": [],
                              "resource": query["resource"], "projection": projection, "fields": list(fields.values()),
                              "dialect": {**resource["dialect"], **override}, "dialectOverride": override,
                              "schema": resource["schema"], "originalSchema": original_resource["schema"],
                              "schemaReview": query.get("schemaReview"),
                              "review": review_notes(resource)}
    return filename, raw, config, capture, descriptions

def source_inspection(filename):
    _, raw, config, capture, queries = read_source(filename)
    return {"hash": sha(raw), "bytes": len(raw), "queries": queries, "captureSha256": capture["sha256"],
            "captureFile": str(capture["filename"]), "config": config, "capture": capture["manifest"]}

def projected_value(raw, value, spec, alias):
    if value is None:
        if spec["missing"] == "reject":
            fail("PACKAGE_PROJECTED_MISSING", alias)
        if spec["missing"] == "null":
            return None
        if raw is None:
            fail("PACKAGE_PHYSICAL_NULL_REQUIRES_NULL", alias)
        return raw
    kind = spec["type"]
    if kind == "string":
        result = raw if spec.get("representation", "physical") == "physical" else value if isinstance(value, str) else raw_json(value)
        if result == "" and spec["missing"] == "null":
            fail("PACKAGE_EMPTY_NULL_CONFLICT", alias)
        return result
    if kind == "boolean":
        if not isinstance(value, bool):
            fail("PACKAGE_BOOLEAN_PROJECTION_INVALID", alias)
        return "true" if value else "false"
    if not isinstance(value, Decimal) or not value.is_finite():
        fail("PACKAGE_NUMBER_REQUIRES_EXACT_STRING", alias)
    if kind == "integer":
        if value != value.to_integral_value() or abs(value) > 9007199254740991:
            fail("PACKAGE_INTEGER_REQUIRES_EXACT_STRING", alias)
        return str(int(value))
    number = float(value)
    if not math.isfinite(number) or Decimal(str(number)) != value or value == 0 and value.is_signed():
        fail("PACKAGE_NUMBER_REQUIRES_EXACT_STRING", alias)
    return str(number)

def export_rows(filename, query_name, options):
    filename, _, config, capture, queries = read_source(filename)
    if query_name not in queries:
        fail("PACKAGE_QUERY_NOT_FOUND")
    query = config["queries"][query_name]
    resource = next(r for r in capture["manifest"]["resources"] if r["name"] == query["resource"])
    resource = {**resource, "schema": queries[query_name]["schema"],
                "dialect": {**resource["dialect"], **query.get("dialect", {})}}
    projection, columns = query["projection"], list(query["projection"])
    order = options.get("order")
    if not isinstance(order, list) or not order or any(not isinstance(v, dict) or set(v) != {"column", "direction"} or v["column"] not in columns or v["direction"] not in ("asc", "desc") for v in order) or len({v["column"] for v in order}) != len(order):
        fail("PACKAGE_EXTRACTION_ORDER_INVALID")
    limits = {"maxRows": (1, 1_000_000, 250000), "maxBytes": (1024, DATA_MAX, 67108864), "maxRowBytes": (1024, 8388608, 1048576)}
    for key, (low, high, default) in limits.items():
        options.setdefault(key, default)
        if type(options[key]) is not int or not low <= options[key] <= high:
            fail("PACKAGE_EXTRACTION_LIMIT_INVALID", key)
    db, temporary = database(filename.parent)
    count, text_bytes = 0, 0
    try:
        types = ["INTEGER" if spec["type"] in ("integer", "boolean") else "REAL" if spec["type"] == "number" else "TEXT" for spec in projection.values()]
        db.execute("CREATE TABLE projected (ordinal INTEGER PRIMARY KEY, payload TEXT NOT NULL," + ",".join(f'"c{i}" {kind}' for i, kind in enumerate(types)) + ")")
        insert = "INSERT INTO projected VALUES (" + ",".join("?" for _ in range(len(columns) + 2)) + ")"
        for count, raw, values in stream_review(capture, resource, db):
            if count > options["maxRows"]:
                fail("PACKAGE_EXTRACTION_TOO_MANY_ROWS")
            row = {alias: projected_value(raw[spec["field"]], values[spec["field"]], spec, alias) for alias, spec in projection.items()}
            size = sum(len(v.encode()) for v in row.values() if v is not None)
            if size > options["maxRowBytes"]:
                fail("PACKAGE_EXTRACTION_ROW_TOO_LARGE")
            text_bytes += size
            if text_bytes > options["maxBytes"]:
                fail("PACKAGE_EXTRACTION_TOO_MANY_BYTES")
            sort_values = [None if row[a] is None else int(row[a] == "true") if s["type"] == "boolean" else int(row[a]) if s["type"] == "integer" else float(row[a]) if s["type"] == "number" else row[a] for a, s in projection.items()]
            db.execute(insert, (count, json.dumps(row, ensure_ascii=False, separators=(",", ":")), *sort_values))
        db.commit()
        ordering = ",".join(f'"c{columns.index(v["column"])}" {v["direction"].upper()} NULLS LAST' for v in order) + ",ordinal ASC"
        column_types = [{"name": a, "type": s["type"], "nullable": s["missing"] == "null"} for a, s in projection.items()]
        print(json.dumps({"kind": "header", "columnTypes": column_types}), flush=True)
        delivered = 0
        for (payload,) in db.execute("SELECT payload FROM projected ORDER BY " + ordering):
            delivered += 1
            print('{"kind":"row","row":' + payload + ',"rowCount":' + str(delivered) + '}', flush=True)
        manifest = {"schema": "stellar-forge.frictionless-extraction.v1", "query": query_name, "resource": resource["name"],
                    "rowCount": count, "sourceTextBytes": text_bytes, "columns": columns, "columnTypes": column_types,
                    "captureSha256": capture["sha256"], "descriptorSha256": sha(read(capture["files"][capture["manifest"]["descriptorFile"]])),
                    "valueEncoding": "frictionless-reviewed-projection", "nullEncoding": "json-null", "order": order,
                    "tieBreak": "original-member-and-record-order", "reviewedDialect": resource["dialect"], "reviewedSchema": resource["schema"],
                    "schemaReview": query.get("schemaReview"), "review": review_notes(resource)}
        print(json.dumps({"kind": "complete", "extraction": manifest}), flush=True)
    finally:
        db.close()
        os.unlink(temporary)

def suggest_source(filename, output):
    capture = read_capture(filename)
    queries = {}
    for number, resource in enumerate(capture["manifest"]["resources"], 1):
        fields, used = {}, set()
        for index, field in enumerate(fields_for(resource), 1):
            alias = re.sub(r"[^A-Za-z0-9_]", "_", field["name"])[:48]
            if not NAME.fullmatch(alias) or alias in used or alias in FORBIDDEN:
                alias = "Field" + str(index)
                while alias in used:
                    alias += "_"
            used.add(alias)
            fields[alias] = {"field": field["name"], "type": "string", "missing": "literal", "representation": "physical"}
        name = re.sub(r"[^A-Za-z0-9_]", "_", resource["name"])[:48]
        if not NAME.fullmatch(name) or name in queries or name in FORBIDDEN:
            name = "Resource" + str(number)
        queries[name] = {"resource": resource["name"], "projection": fields}
    value = {"schema": SOURCE, "connection": {"file": str(capture["filename"]), "sha256": capture["sha256"]}, "queries": queries}
    create(output, encoded(value))
    return {"sourceFile": str(Path(output).absolute()), "queries": list(queries),
            "review": "Review field aliases, types and missing-value decisions before saving a publication plan."}

def export_bundle(source_file, output):
    _, raw, config, capture, _ = read_source(source_file)
    entries = {"original-source.json": raw, "capture/capture.json": read(capture["filename"], META_MAX, True)}
    config["connection"]["file"] = "capture/capture.json"
    entries["source.json"] = encoded(config)
    descriptions = {name: {"sha256": sha(data), "bytes": len(data)} for name, data in entries.items()}
    for item in capture["manifest"]["files"]:
        name = "capture/" + item["file"]
        entries[name] = capture["files"][item["file"]]
        descriptions[name] = {"sha256": item["sha256"], "bytes": item["bytes"]}
    manifest = {"schema": "stellar-forge.frictionless-source-bundle.v1", "captureSha256": capture["sha256"],
                "files": [{"file": name, **description} for name, description in descriptions.items()]}
    entries["bundle.json"] = encoded(manifest)
    descriptions["bundle.json"] = {"sha256": sha(entries["bundle.json"]), "bytes": len(entries["bundle.json"])}
    if len(entries) > 10000 or sum(item["bytes"] for item in descriptions.values()) > 2 * DATA_MAX:
        fail("PACKAGE_BUNDLE_TOO_LARGE")
    output = Path(output).absolute()
    if output.exists() or output.is_symlink():
        fail("PACKAGE_OUTPUT_EXISTS", str(output))
    output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=".frictionless-export-", dir=output.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, "wb") as handle:
            with gzip.GzipFile(fileobj=handle, mode="wb", filename="", mtime=0) as compressed:
                with tarfile.open(fileobj=compressed, mode="w|", format=tarfile.PAX_FORMAT) as archive:
                    for name, value in entries.items():
                        expected = descriptions[name]
                        item = tarfile.TarInfo(member(name))
                        item.size, item.mode, item.mtime = expected["bytes"], 0o600, 0
                        if isinstance(value, bytes):
                            archive.addfile(item, io.BytesIO(value))
                            continue
                        source_fd = os.open(value, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
                        with os.fdopen(source_fd, "rb") as source:
                            before = os.fstat(source.fileno())
                            if not stat.S_ISREG(before.st_mode) or before.st_mode & 0o077 or before.st_nlink != 1 or before.st_size != item.size:
                                fail("PACKAGE_CAPTURE_MEMBER_CHANGED", name)
                            class RetainedReader:
                                def __init__(self):
                                    self.digest, self.total = hashlib.sha256(), 0
                                def read(self, size):
                                    data = source.read(size)
                                    self.digest.update(data)
                                    self.total += len(data)
                                    return data
                            reader = RetainedReader()
                            archive.addfile(item, reader)
                            extra = source.read(1)
                            after = os.fstat(source.fileno())
                            if extra or reader.total != item.size or reader.digest.hexdigest() != expected["sha256"] or (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                                fail("PACKAGE_CAPTURE_MEMBER_CHANGED", name)
            handle.flush()
            os.fsync(handle.fileno())
        observed = fingerprint(temporary, DATA_MAX, True)
        try:
            os.link(temporary, output)
        except FileExistsError:
            fail("PACKAGE_OUTPUT_EXISTS", str(output))
        temporary.unlink()
        sync(output.parent)
        return {"file": str(output), **observed, "captureSha256": capture["sha256"], "files": len(entries)}
    finally:
        temporary.unlink(missing_ok=True)

def receive_bundle(archive_file, output, expected):
    if not SHA.fullmatch(expected or "") or fingerprint(archive_file)["sha256"] != expected:
        fail("PACKAGE_BUNDLE_HASH_MISMATCH")
    output = Path(output).absolute()
    if output.exists() or output.is_symlink():
        fail("PACKAGE_OUTPUT_EXISTS")
    output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=".frictionless-receive-", dir=output.parent))
    try:
        entries, total = {}, 0
        archive_fd = os.open(archive_file, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(archive_fd, "rb") as raw:
            before = os.fstat(raw.fileno())
            if not stat.S_ISREG(before.st_mode) or before.st_size > DATA_MAX:
                fail("PACKAGE_FILE_INVALID", str(archive_file))
            digest = hashlib.sha256()
            while chunk := raw.read(1024 * 1024):
                digest.update(chunk)
            if digest.hexdigest() != expected:
                fail("PACKAGE_BUNDLE_HASH_MISMATCH")
            raw.seek(0)
            with tarfile.open(fileobj=raw, mode="r|gz") as archive:
                for item in archive:
                    name = member(item.name)
                    if not item.isfile() or item.linkname or name in entries or item.size < 0 or item.size > DATA_MAX or len(entries) >= 10000:
                        fail("PACKAGE_BUNDLE_MEMBER_INVALID")
                    total += item.size
                    if total > 2 * DATA_MAX:
                        fail("PACKAGE_BUNDLE_TOO_LARGE")
                    destination = temporary / name
                    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                    with destination.open("xb") as handle, archive.extractfile(item) as source:
                        os.chmod(destination, 0o600)
                        count, digest = 0, hashlib.sha256()
                        while chunk := source.read(min(1024 * 1024, item.size - count + 1)):
                            count += len(chunk)
                            if count > item.size:
                                fail("PACKAGE_BUNDLE_MEMBER_TRUNCATED")
                            digest.update(chunk)
                            handle.write(chunk)
                        if count != item.size:
                            fail("PACKAGE_BUNDLE_MEMBER_TRUNCATED")
                        handle.flush()
                        os.fsync(handle.fileno())
                    entries[name] = {"sha256": digest.hexdigest(), "bytes": count}
            after = os.fstat(raw.fileno())
            if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                fail("PACKAGE_FILE_CHANGED", str(archive_file))
        manifest = parse(read(temporary / "bundle.json", META_MAX))
        if manifest.get("schema") != "stellar-forge.frictionless-source-bundle.v1":
            fail("PACKAGE_BUNDLE_INVALID")
        declared = {}
        for item in manifest.get("files", []):
            name = member(item["file"])
            if name in declared:
                fail("PACKAGE_BUNDLE_MEMBER_DUPLICATE")
            declared[name] = {"sha256": item["sha256"], "bytes": item["bytes"]}
        if declared != {n: v for n, v in entries.items() if n != "bundle.json"}:
            fail("PACKAGE_BUNDLE_CONTENT_CHANGED")
        config_path = temporary / "source.json"
        config_raw = parse(read(config_path, META_MAX, True))
        if config_raw.get("connection", {}).get("file") != "capture/capture.json":
            fail("PACKAGE_BUNDLE_SOURCE_PATH_INVALID")
        _, _, config, capture, _ = read_source(config_path)
        if capture["sha256"] != manifest.get("captureSha256"):
            fail("PACKAGE_BUNDLE_CAPTURE_CHANGED")
        original_config = parse(read(temporary / "original-source.json", META_MAX, True))
        original_config["connection"]["file"] = "capture/capture.json"
        if original_config != config:
            fail("PACKAGE_BUNDLE_SOURCE_CHANGED")
        sync(temporary / "capture" / "files")
        sync(temporary / "capture")
        sync(temporary)
        os.rename(temporary, output)
        sync(output.parent)
        return {"directory": str(output), "sourceFile": str(output / "source.json"),
                "captureSha256": capture["sha256"], "bundleSha256": expected, "files": len(entries)}
    except BaseException:
        shutil.rmtree(temporary, ignore_errors=True)
        raise

def compare_captures(before, after):
    old, new = read_capture(before), read_capture(after)
    left = {r["name"]: r for r in old["manifest"]["resources"]}
    right = {r["name"]: r for r in new["manifest"]["resources"]}
    changes = []
    for name in sorted(set(left) | set(right)):
        a, b = left.get(name), right.get(name)
        if a is None or b is None:
            changes.append({"resource": name, "change": "added" if a is None else "removed"})
            continue
        fields_a, fields_b = ({f["name"]: f for f in fields_for(r)} for r in (a, b))
        changes.append({"resource": name, "dataChanged": [v["sha256"] for v in a["members"]] != [v["sha256"] for v in b["members"]],
                        "schemaChanged": a["schema"] != b["schema"], "dialectChanged": a["dialect"] != b["dialect"],
                        "descriptorChanged": a["descriptor"] != b["descriptor"],
                        "addedFields": sorted(set(fields_b) - set(fields_a)), "removedFields": sorted(set(fields_a) - set(fields_b)),
                        "changedFields": [n for n in fields_a if n in fields_b and fields_a[n] != fields_b[n]]})
    return {"schema": "stellar-forge.frictionless-edition-comparison.v1", "before": old["sha256"], "after": new["sha256"],
            "packageMetadataChanged": old["manifest"]["package"] != new["manifest"]["package"], "resources": changes}

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    commands = {
        "capture": [("descriptor", True), ("output", True)],
        "inspect-capture": [("capture", True), ("sha256", False)],
        "suggest-source": [("capture", True), ("output", True)],
        "inspect-source": [("source", True)],
        "review-source": [("source", True)],
        "export-rows": [("source", True), ("query", True), ("options", True)],
        "source-export": [("source", True), ("output", True)],
        "source-receive": [("archive", True), ("output", True), ("sha256", True)],
        "compare": [("before", True), ("after", True)],
    }
    for name, arguments in commands.items():
        command = sub.add_parser(name)
        for key, required in arguments:
            command.add_argument("--" + key, required=required)
        if name == "capture":
            command.add_argument("--resource", action="append", default=[])
            command.add_argument("--reference", action="append", default=[])
            command.add_argument("--timeout", type=int, default=60)
    args = parser.parse_args(argv)
    csv.field_size_limit(1048576)
    if args.command == "capture":
        result = capture_package(args.descriptor, args.output, args.resource, args.timeout, args.reference)
    elif args.command == "inspect-capture":
        result = inspect_capture(args.capture, args.sha256)
    elif args.command == "suggest-source":
        result = suggest_source(args.capture, args.output)
    elif args.command == "inspect-source":
        result = source_inspection(args.source)
    elif args.command == "review-source":
        result = review_source(args.source)
    elif args.command == "export-rows":
        export_rows(args.source, args.query, parse(args.options.encode()))
        return
    elif args.command == "source-export":
        result = export_bundle(args.source, args.output)
    elif args.command == "source-receive":
        result = receive_bundle(args.archive, args.output, args.sha256)
    else:
        result = compare_captures(args.before, args.after)
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))

if __name__ == "__main__":
    def interrupted(signum, frame):
        fail("PACKAGE_CANCELLED")
    signal.signal(signal.SIGTERM, interrupted)
    try:
        main()
    except PackageError as issue:
        print(json.dumps({"error": issue.code, "message": str(issue)}), file=sys.stderr)
        sys.exit(1)
    except (OSError, ValueError, KeyError, TypeError, tarfile.TarError) as issue:
        print(json.dumps({"error": "PACKAGE_OPERATION_FAILED", "message": str(issue)}), file=sys.stderr)
        sys.exit(1)
