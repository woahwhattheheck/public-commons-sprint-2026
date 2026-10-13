"""Serialize an explicitly reviewed, completed Analysis query export.

The original QueryExport verifies/decodes its rows and supplies encoded_rows().
This module selects columns and writes external JSON; it does not run SQL,
parse a Data Package, verify a primary key, or publish to a service.

Data Package v1's general data-package/data-resource profiles support external
JSON. Its tabular profile requires non-inline CSV. The declared Table Schema
remains explicit, with missingValues=[] so physical empty strings survive.
https://specs.frictionlessdata.io/data-resource/
https://specs.frictionlessdata.io/tabular-data-resource/
"""
from __future__ import annotations

import base64
import binascii
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import tempfile
from urllib.parse import urlsplit

from .errors import StateError
from .storage import lock, parse, private_directory, sync_directory, write


RECIPE_SCHEMA = "stellar-forge.analysis-dataset-publication-recipe.v1"
PACKAGE_SCHEMA = "stellar-forge.analysis-dataset-publication-package.v1"
QUERY_EXPORT_SCHEMA = "stellar-forge.python-query-export.v1"
MAX_RESOURCE_BYTES = 256 * 1024 * 1024
MAX_DESCRIPTOR_BYTES = 8 * 1024 * 1024
MAX_RECIPE_BYTES = 8 * 1024 * 1024
MAX_MANIFEST_BYTES = 32 * 1024 * 1024
MAX_NATIVE_MANIFEST_BYTES = 16 * 1024 * 1024
SAFE_INTEGER = (1 << 53) - 1

_HASH = re.compile(r"[a-f0-9]{64}\Z")
_ID = re.compile(r"[a-f0-9]{32}\Z")
_NAME = re.compile(r"[a-z][a-z0-9_-]{0,63}\Z")
_FIELD = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,47}\Z")
_RESERVED_FIELDS = {"constructor", "prototype", "__proto__"}
_TYPES = {
    "text": "string", "integer": "integer", "number": "number",
    "boolean01": "boolean", "integer-text": "string",
    "sqlite-json": "string", "base64": "string",
}
_FILE_ROLES = (
    ("recipe.json", MAX_RECIPE_BYTES + 1, "private"),
    ("package/datapackage.json", MAX_DESCRIPTOR_BYTES, "public"),
    ("package/data.json", MAX_RESOURCE_BYTES, "public"),
)
_RECIPE_REQUIRED = {
    "schema", "workspace_id", "query_export_id", "manifest_sha256",
    "name", "title", "resource_name", "fields", "source_rights",
    "max_resource_bytes",
}
_RECIPE_OPTIONAL = {"description", "primary_key", "licenses"}


def _fail(code, **details):
    error = StateError(code)
    if details:
        error.details = details
    raise error


def _require(condition, code, **details):
    if not condition:
        _fail(code, **details)


def _json(value):
    try:
        return json.dumps(value, ensure_ascii=False, allow_nan=False,
                          separators=(",", ":"), sort_keys=True).encode("utf-8")
    except (ValueError, TypeError, UnicodeError, OverflowError):
        _fail("ANALYSIS_PUBLICATION_JSON_INVALID")


def _hash(value):
    return hashlib.sha256(value).hexdigest()


def _text(value, *, field, maximum=None, nonblank=False, controls=False):
    _require(type(value) is str, "ANALYSIS_PUBLICATION_RECIPE_TEXT", field=field)
    _require(not nonblank or bool(value.strip()),
             "ANALYSIS_PUBLICATION_RECIPE_TEXT", field=field)
    _require(maximum is None or len(value) <= maximum,
             "ANALYSIS_PUBLICATION_RECIPE_TEXT", field=field)
    _require(not controls or not any(ord(char) < 32 for char in value),
             "ANALYSIS_PUBLICATION_RECIPE_TEXT", field=field)
    try:
        value.encode("utf-8")
    except UnicodeError:
        _fail("ANALYSIS_PUBLICATION_RECIPE_TEXT", field=field)
    return value


def _columns(value):
    _require(isinstance(value, (list, tuple)) and bool(value)
             and all(type(name) is str for name in value)
             and len(set(value)) == len(value),
             "ANALYSIS_PUBLICATION_SOURCE_COLUMNS")
    return list(value)


def _licenses(value):
    _require(type(value) is list, "ANALYSIS_PUBLICATION_LICENSES")
    result = []
    for ordinal, item in enumerate(value):
        _require(type(item) is dict and not set(item) - {"name", "path", "title"}
                 and bool(set(item) & {"name", "path"}),
                 "ANALYSIS_PUBLICATION_LICENSE", license=ordinal + 1)
        selected = {}
        for key in ("name", "path", "title"):
            if key in item:
                selected[key] = _text(item[key], field="licenses." + key,
                                      nonblank=True, controls=True)
        if "path" in selected:
            # The serializer does not add license files to package/. An external
            # license URL or an operator-selected license identifier is explicit.
            try:
                url = urlsplit(selected["path"])
                valid = (url.scheme in {"http", "https"} and bool(url.hostname)
                         and url.username is None and url.password is None
                         and not any(char.isspace() for char in selected["path"]))
                _ = url.port
            except ValueError:
                valid = False
            _require(valid, "ANALYSIS_PUBLICATION_LICENSE_URL",
                     license=ordinal + 1)
        result.append(selected)
    return result


def normalize_recipe(value, *, columns):
    """Validate the operator's complete selection without reading any rows."""
    columns = _columns(columns)
    _require(type(value) is dict and _RECIPE_REQUIRED <= set(value)
             and not set(value) - (_RECIPE_REQUIRED | _RECIPE_OPTIONAL),
             "ANALYSIS_PUBLICATION_RECIPE_FIELDS")
    _require(value["schema"] == RECIPE_SCHEMA,
             "ANALYSIS_PUBLICATION_RECIPE_SCHEMA")
    for key in ("workspace_id", "query_export_id"):
        _require(type(value[key]) is str and _ID.fullmatch(value[key]),
                 "ANALYSIS_PUBLICATION_RECIPE_ID", field=key)
    _require(type(value["manifest_sha256"]) is str
             and _HASH.fullmatch(value["manifest_sha256"]),
             "ANALYSIS_PUBLICATION_RECIPE_MANIFEST")
    for key in ("name", "resource_name"):
        _require(type(value[key]) is str and _NAME.fullmatch(value[key]),
                 "ANALYSIS_PUBLICATION_RECIPE_NAME", field=key)
    _text(value["title"], field="title", maximum=160, nonblank=True, controls=True)
    _text(value["source_rights"], field="source_rights", nonblank=True)
    maximum = value["max_resource_bytes"]
    _require(type(maximum) is int and 0 < maximum <= MAX_RESOURCE_BYTES,
             "ANALYSIS_PUBLICATION_RESOURCE_LIMIT")
    _require(type(value["fields"]) is list and bool(value["fields"]),
             "ANALYSIS_PUBLICATION_RECIPE_COLUMNS")
    fields, names = [], set()
    for ordinal, field in enumerate(value["fields"]):
        _require(type(field) is dict
                 and {"source", "name", "representation"} <= set(field)
                 and not set(field) - {"source", "name", "title", "representation"},
                 "ANALYSIS_PUBLICATION_RECIPE_FIELD", field=ordinal + 1)
        _require(type(field["source"]) is str and field["source"] in columns,
                 "ANALYSIS_PUBLICATION_SOURCE_COLUMN", field=ordinal + 1)
        name = field["name"]
        _require(type(name) is str and _FIELD.fullmatch(name)
                 and name not in _RESERVED_FIELDS and name not in names,
                 "ANALYSIS_PUBLICATION_OUTPUT_COLUMN", field=ordinal + 1)
        representation = field["representation"]
        _require(type(representation) is str and representation in _TYPES,
                 "ANALYSIS_PUBLICATION_REPRESENTATION", field=ordinal + 1)
        names.add(name)
        selected = {"source": field["source"], "name": name,
                    "representation": representation}
        if "title" in field:
            selected["title"] = _text(field["title"], field="fields.title")
        fields.append(selected)
    result = {key: value[key] for key in _RECIPE_REQUIRED if key != "fields"}
    result["fields"] = fields
    if "description" in value:
        result["description"] = _text(value["description"], field="description",
                                      maximum=4000)
    if "primary_key" in value:
        selected = value["primary_key"]
        _require(type(selected) is list
                 and all(type(name) is str and name in names for name in selected)
                 and len(selected) == len(set(selected)),
                 "ANALYSIS_PUBLICATION_PRIMARY_KEY")
        result["primary_key"] = list(selected)
    if "licenses" in value:
        result["licenses"] = _licenses(value["licenses"])
    _require(len(_json(result)) <= MAX_RECIPE_BYTES,
             "ANALYSIS_PUBLICATION_RECIPE_TOO_LARGE")
    return deepcopy(result)


def _cancelled(check):
    if check():
        _fail("ANALYSIS_PUBLICATION_CANCELLED")


def _base64(value):
    if type(value) is not str:
        return False
    try:
        raw = base64.b64decode(value, validate=True)
        return base64.b64encode(raw).decode("ascii") == value
    except (ValueError, UnicodeError, binascii.Error):
        return False


def _cell(value, field, ordinal):
    representation = field["representation"]
    if representation == "sqlite-json":
        valid = (value is None or type(value) in (str, bool, int)
                 or (type(value) is float and math.isfinite(value)))
        if type(value) is dict:
            valid = (set(value) == {"$sqliteBlob"} and _base64(value["$sqliteBlob"])
                     or set(value) == {"$sqliteFloat"}
                     and value["$sqliteFloat"] in ("Infinity", "-Infinity", "NaN"))
        if valid:
            try:
                # This is the original encoded SQLite cell as a JSON STRING,
                # including "null". Tagged blobs/nonfinite values and decimal
                # integer text remain distinct from ordinary source strings.
                return _json(value).decode("utf-8")
            except StateError:
                pass
    elif value is None:
        return None
    elif representation == "text" and type(value) is str:
        return value
    elif representation == "integer" and type(value) is int and abs(value) <= SAFE_INTEGER:
        return value
    elif representation == "number":
        if type(value) is int and abs(value) <= SAFE_INTEGER:
            return value
        if (type(value) is float and math.isfinite(value)
                and not (value == 0 and math.copysign(1, value) < 0)):
            return value
    elif representation == "boolean01" and type(value) is int and value in (0, 1):
        return bool(value)
    elif representation == "integer-text" and type(value) is int:
        return str(value)
    elif (representation == "base64" and type(value) is dict
          and set(value) == {"$sqliteBlob"} and _base64(value["$sqliteBlob"])):
        return value["$sqliteBlob"]
    _fail("ANALYSIS_PUBLICATION_VALUE_INVALID", row=ordinal,
          column=field["source"], output=field["name"], representation=representation)


def _directory(value, *, create):
    expected = Path(os.path.abspath(Path(value).expanduser()))
    actual = private_directory(expected, create=create)
    _require(actual == expected and actual.stat().st_uid == os.getuid(),
             "ANALYSIS_PUBLICATION_PRIVATE_DIRECTORY")
    return actual


def _stamp(info):
    return (info.st_dev, info.st_ino, info.st_size,
            info.st_mtime_ns, info.st_ctime_ns)


@contextmanager
def _regular(path, maximum):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as stream:
        first = os.fstat(stream.fileno())
        _require(stat.S_ISREG(first.st_mode) and first.st_uid == os.getuid()
                 and not first.st_mode & 0o077 and first.st_nlink == 1
                 and 0 <= first.st_size <= maximum,
                 "ANALYSIS_PUBLICATION_PRIVATE_FILE")
        yield stream, first
        latest = os.fstat(stream.fileno())
        named = path.lstat()
        _require(_stamp(first) == _stamp(latest) == _stamp(named)
                 and stat.S_ISREG(named.st_mode),
                 "ANALYSIS_PUBLICATION_FILE_CHANGED")


def _read(path, maximum):
    with _regular(path, maximum) as (stream, first):
        raw = stream.read(maximum + 1)
        _require(len(raw) == first.st_size and len(raw) <= maximum,
                 "ANALYSIS_PUBLICATION_FILE_CHANGED")
        return raw


def _measure(path, maximum, *, cancelled=lambda: False):
    measured, total = hashlib.sha256(), 0
    with _regular(path, maximum) as (stream, first):
        while True:
            _cancelled(cancelled)
            chunk = stream.read(1024 * 1024)
            if not chunk:
                break
            measured.update(chunk)
            total += len(chunk)
            _require(total <= maximum, "ANALYSIS_PUBLICATION_FILE_TOO_LARGE")
        _require(total == first.st_size, "ANALYSIS_PUBLICATION_FILE_CHANGED")
    return {"bytes": total, "sha256": measured.hexdigest()}


def _existing_json(path, raw, maximum):
    try:
        existing = _read(path, maximum)
    except FileNotFoundError:
        try:
            write(path, raw, exclusive=True)
        except FileExistsError:
            existing = _read(path, maximum)
        else:
            existing = raw
    _require(existing == raw, "ANALYSIS_PUBLICATION_DESTINATION_CHANGED",
             file=path.name)


def _publish(temporary, destination, record, maximum, *, cancelled):
    _cancelled(cancelled)
    try:
        os.link(temporary, destination, follow_symlinks=False)
    except FileExistsError:
        existing = _measure(destination, maximum, cancelled=cancelled)
        _require(existing == record, "ANALYSIS_PUBLICATION_DESTINATION_CHANGED",
                 file=destination.name)
    else:
        sync_directory(destination.parent)
    # Our own temporary is private and is retired before the complete manifest
    # becomes visible. Complete data/descriptor files are never overwritten.
    temporary.unlink()


def _publish_bytes(directory, destination, raw, maximum, *, cancelled):
    _require(len(raw) <= maximum, "ANALYSIS_PUBLICATION_DESCRIPTOR_TOO_LARGE")
    descriptor, name = tempfile.mkstemp(prefix=".package-", suffix=".pending", dir=directory)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as output:
            _cancelled(cancelled)
            output.write(raw)
            output.flush()
            os.fsync(output.fileno())
        record = {"bytes": len(raw), "sha256": _hash(raw)}
        _publish(temporary, destination, record, maximum, cancelled=cancelled)
        return record
    finally:
        temporary.unlink(missing_ok=True)


def _source(native, raw, recipe):
    _require(type(raw) is bytes and len(raw) <= MAX_NATIVE_MANIFEST_BYTES
             and _hash(raw) == recipe["manifest_sha256"],
             "ANALYSIS_PUBLICATION_EXPORT_MANIFEST_CHANGED")
    _require(type(native) is dict and native.get("schema") == QUERY_EXPORT_SCHEMA
             and native.get("queryComplete") is True
             and type(native.get("rowCount")) is int and native["rowCount"] >= 0
             and type(native.get("binding")) is dict,
             "ANALYSIS_PUBLICATION_EXPORT_INCOMPLETE")
    # The original reader owns the typed rows and complete file checks. Preserve
    # its raw manifest identity and complete private binding without exporting SQL.
    _require(parse(raw) == native, "ANALYSIS_PUBLICATION_EXPORT_MANIFEST_CHANGED")
    columns = _columns(native.get("columns"))
    binding_hash = _hash(_json(native["binding"]))
    _require(native.get("bindingSha256") == binding_hash,
             "ANALYSIS_PUBLICATION_EXPORT_BINDING_CHANGED")
    created = native.get("createdAt")
    try:
        timestamp = datetime.fromisoformat(created.replace("Z", "+00:00"))
        valid_time = (type(created) is str and "T" in created
                      and timestamp.tzinfo is not None and timestamp.utcoffset() is not None)
    except (AttributeError, TypeError, ValueError):
        valid_time = False
    _require(valid_time, "ANALYSIS_PUBLICATION_EXPORT_CREATED_AT")
    return {"workspace_id": recipe["workspace_id"],
            "query_export_id": recipe["query_export_id"],
            "manifest_sha256": recipe["manifest_sha256"],
            "binding_sha256": binding_hash, "row_count": native["rowCount"],
            "columns": columns, "binding": deepcopy(native["binding"]),
            "created_at": created}


def _descriptor(recipe, recipe_hash, source, resource):
    fields = []
    for selected in recipe["fields"]:
        field = {"name": selected["name"], "type": _TYPES[selected["representation"]],
                 "x-analysis-representation": selected["representation"]}
        if selected["representation"] == "base64":
            field["format"] = "binary"
        if "title" in selected:
            field["title"] = selected["title"]
        fields.append(field)
    schema = {"fields": fields, "missingValues": []}
    if recipe.get("primary_key"):
        schema["primaryKey"] = list(recipe["primary_key"])
    provenance = {key: source[key] for key in (
        "workspace_id", "query_export_id", "manifest_sha256", "binding_sha256")}
    provenance["recipe_sha256"] = recipe_hash
    urn = ("urn:stellar-forge:analysis:" + source["workspace_id"]
           + ":query-export:" + source["query_export_id"]
           + ":manifest:" + source["manifest_sha256"])
    result = {
        "profile": "data-package", "name": recipe["name"], "title": recipe["title"],
        "id": urn, "created": source["created_at"], "x-analysis": provenance,
        "resources": [{
            "profile": "data-resource", "name": recipe["resource_name"],
            "path": "data.json", "format": "json", "mediatype": "application/json",
            "encoding": "utf-8", "bytes": resource["bytes"],
            "hash": "sha256:" + resource["sha256"], "schema": schema,
        }],
    }
    for key in ("description", "licenses"):
        if key in recipe:
            result[key] = deepcopy(recipe[key])
    return result


def _resource(query_export, directory, target, recipe, source, *, cancelled):
    descriptor, name = tempfile.mkstemp(prefix=".data-", suffix=".pending", dir=directory)
    temporary, iterator = Path(name), None
    measured, total, rows = hashlib.sha256(), 0, 0
    stats = [{"name": item["name"], "null_count": 0, "empty_string_count": 0}
             for item in recipe["fields"]]
    maximum = recipe["max_resource_bytes"]
    try:
        with os.fdopen(descriptor, "wb") as output:
            def emit(raw):
                nonlocal total
                _cancelled(cancelled)
                _require(total + len(raw) <= maximum,
                         "ANALYSIS_PUBLICATION_RESOURCE_TOO_LARGE",
                         maximum=maximum, row=rows)
                output.write(raw)
                measured.update(raw)
                total += len(raw)
            emit(b"[")
            iterator = iter(query_export.encoded_rows())
            for original in iterator:
                _cancelled(cancelled)
                rows += 1
                _require(rows <= source["row_count"] and type(original) is dict
                         and set(original) == set(source["columns"]),
                         "ANALYSIS_PUBLICATION_EXPORT_ROWS_CHANGED", row=rows)
                row = {}
                for index, selected in enumerate(recipe["fields"]):
                    _cancelled(cancelled)
                    value = _cell(original[selected["source"]], selected, rows)
                    row[selected["name"]] = value
                    if value is None:
                        stats[index]["null_count"] += 1
                    elif type(value) is str and value == "":
                        stats[index]["empty_string_count"] += 1
                try:
                    # Preserve the operator's selected field order. Canonical
                    # recipe/SQLite-cell serialization is separate from rows.
                    raw = json.dumps(row, ensure_ascii=False, allow_nan=False,
                                     separators=(",", ":")).encode("utf-8")
                except (ValueError, TypeError, UnicodeError, OverflowError):
                    _fail("ANALYSIS_PUBLICATION_ROW_ENCODING", row=rows)
                emit((b",\n" if rows > 1 else b"\n") + raw)
            _require(rows == source["row_count"],
                     "ANALYSIS_PUBLICATION_EXPORT_ROWS_CHANGED", row=rows)
            emit(b"\n]\n" if rows else b"]\n")
            output.flush()
            os.fsync(output.fileno())
        _cancelled(cancelled)
        record = {"bytes": total, "sha256": measured.hexdigest()}
        _publish(temporary, target, record, maximum, cancelled=cancelled)
        return record, stats
    finally:
        try:
            close = getattr(iterator, "close", None)
            if close is not None:
                close()
        finally:
            temporary.unlink(missing_ok=True)


def _public_directory(directory, *, create):
    public = _directory(directory / "package", create=create)
    _require(not {path.name for path in public.iterdir()} -
             {"data.json", "datapackage.json"},
             "ANALYSIS_PUBLICATION_UNLISTED_PUBLIC_FILE")
    return public


def _open(directory, *, recipe_sha256=None, cancelled=lambda: False):
    directory = _directory(directory, create=False)
    _public_directory(directory, create=False)
    raw = _read(directory / "manifest.json", MAX_MANIFEST_BYTES)
    manifest = parse(raw)
    required = {"schema", "recipe_sha256", "recipe", "source",
                "package", "files", "field_stats"}
    _require(type(manifest) is dict and set(manifest) == required
             and manifest["schema"] == PACKAGE_SCHEMA,
             "ANALYSIS_PUBLICATION_PACKAGE_MANIFEST")
    source = manifest["source"]
    _require(type(source) is dict and set(source) == {
        "workspace_id", "query_export_id", "manifest_sha256", "binding_sha256",
        "row_count", "columns", "binding", "created_at"},
        "ANALYSIS_PUBLICATION_PACKAGE_SOURCE")
    normalized = normalize_recipe(manifest["recipe"], columns=source["columns"])
    recipe_hash = _hash(_json(normalized))
    _require(normalized == manifest["recipe"]
             and recipe_hash == manifest["recipe_sha256"]
             and (recipe_sha256 is None or recipe_sha256 == recipe_hash),
             "ANALYSIS_PUBLICATION_RECIPE_CHANGED")
    _require(all(source[key] == normalized[key] for key in (
        "workspace_id", "query_export_id", "manifest_sha256"))
        and type(source["binding"]) is dict
        and source["binding_sha256"] == _hash(_json(source["binding"]))
        and type(source["row_count"]) is int and source["row_count"] >= 0,
        "ANALYSIS_PUBLICATION_PACKAGE_SOURCE")
    # Validate the preserved timestamp without substituting a new wall time.
    try:
        moment = datetime.fromisoformat(source["created_at"].replace("Z", "+00:00"))
        valid_time = (type(source["created_at"]) is str and "T" in source["created_at"]
                      and moment.tzinfo is not None and moment.utcoffset() is not None)
    except (AttributeError, TypeError, ValueError):
        valid_time = False
    _require(valid_time, "ANALYSIS_PUBLICATION_EXPORT_CREATED_AT")
    _require(manifest["package"] == {
        "descriptor": "package/datapackage.json", "resource": "package/data.json",
        "row_count": source["row_count"]},
        "ANALYSIS_PUBLICATION_PACKAGE_PATHS")
    files = manifest["files"]
    _require(type(files) is list and len(files) == len(_FILE_ROLES),
             "ANALYSIS_PUBLICATION_PACKAGE_FILES")
    selected = {}
    for item, (name, maximum, visibility) in zip(files, _FILE_ROLES):
        _require(type(item) is dict and set(item) == {
            "name", "bytes", "sha256", "mime", "visibility"}
            and item["name"] == name and item["mime"] == "application/json"
            and item["visibility"] == visibility
            and type(item["bytes"]) is int and 0 < item["bytes"] <= maximum
            and type(item["sha256"]) is str and _HASH.fullmatch(item["sha256"]),
            "ANALYSIS_PUBLICATION_PACKAGE_FILE")
        measured = _measure(directory / name, maximum, cancelled=cancelled)
        _require(measured == {key: item[key] for key in ("bytes", "sha256")},
                 "ANALYSIS_PUBLICATION_PACKAGE_FILE_CHANGED", file=name)
        selected[name] = measured
    _require(selected["package/data.json"]["bytes"] <= normalized["max_resource_bytes"],
             "ANALYSIS_PUBLICATION_RESOURCE_LIMIT")
    _require(_read(directory / "recipe.json", MAX_RECIPE_BYTES + 1)
             == _json(normalized) + b"\n",
             "ANALYSIS_PUBLICATION_RECIPE_CHANGED")
    expected_descriptor = _json(_descriptor(
        normalized, recipe_hash, source, selected["package/data.json"])) + b"\n"
    _require(_read(directory / "package/datapackage.json", MAX_DESCRIPTOR_BYTES)
             == expected_descriptor, "ANALYSIS_PUBLICATION_DESCRIPTOR_CHANGED")
    stats = manifest["field_stats"]
    _require(type(stats) is list and len(stats) == len(normalized["fields"]),
             "ANALYSIS_PUBLICATION_FIELD_STATS")
    for item, field in zip(stats, normalized["fields"]):
        _require(type(item) is dict and set(item) == {
            "name", "null_count", "empty_string_count"} and item["name"] == field["name"]
            and type(item["null_count"]) is int and item["null_count"] >= 0
            and type(item["empty_string_count"]) is int and item["empty_string_count"] >= 0
            and item["null_count"] + item["empty_string_count"] <= source["row_count"],
            "ANALYSIS_PUBLICATION_FIELD_STATS")
    _cancelled(cancelled)
    return deepcopy(manifest)


def open_package(directory, *, recipe_sha256=None):
    """Verify all complete files and reopen without the Analysis source host."""
    if recipe_sha256 is not None:
        _require(type(recipe_sha256) is str and _HASH.fullmatch(recipe_sha256),
                 "ANALYSIS_PUBLICATION_RECIPE_HASH")
    return _open(directory, recipe_sha256=recipe_sha256)


def build_package(query_export, directory, recipe, *, cancelled=lambda: False):
    """Stream all original result rows; publish the complete manifest last.

    A completed directory reopens its same exact recipe/export. An interrupted
    build may rebuild derived files from those saved rows, comparing any existing
    complete files before reuse. No SQL or provider action is performed.
    """
    _require(callable(cancelled), "ANALYSIS_PUBLICATION_CANCELLATION")
    _cancelled(cancelled)
    native = query_export.manifest
    normalized = normalize_recipe(recipe, columns=native.get("columns"))
    raw = query_export.manifest_bytes
    source = _source(native, raw, normalized)
    recipe_raw = _json(normalized)
    recipe_hash = _hash(recipe_raw)
    directory = _directory(directory, create=True)
    with lock(directory):
        manifest_path = directory / "manifest.json"
        try:
            manifest_path.lstat()
        except FileNotFoundError:
            pass
        else:
            retained = _open(directory, recipe_sha256=recipe_hash, cancelled=cancelled)
            _require(retained["source"] == source,
                     "ANALYSIS_PUBLICATION_EXPORT_CHANGED")
            return retained
        public = _public_directory(directory, create=True)
        _existing_json(directory / "recipe.json", recipe_raw + b"\n",
                       MAX_RECIPE_BYTES + 1)
        _cancelled(cancelled)
        resource, stats = _resource(query_export, directory, public / "data.json",
                                    normalized, source, cancelled=cancelled)
        descriptor_raw = _json(_descriptor(normalized, recipe_hash, source, resource)) + b"\n"
        descriptor = _publish_bytes(directory, public / "datapackage.json",
                                    descriptor_raw, MAX_DESCRIPTOR_BYTES, cancelled=cancelled)
        files = [
            {"name": "recipe.json", "bytes": len(recipe_raw) + 1,
             "sha256": _hash(recipe_raw + b"\n"), "mime": "application/json",
             "visibility": "private"},
            {"name": "package/datapackage.json", **descriptor,
             "mime": "application/json", "visibility": "public"},
            {"name": "package/data.json", **resource,
             "mime": "application/json", "visibility": "public"},
        ]
        manifest = {"schema": PACKAGE_SCHEMA, "recipe_sha256": recipe_hash,
                    "recipe": normalized, "source": source,
                    "package": {"descriptor": "package/datapackage.json",
                                "resource": "package/data.json",
                                "row_count": source["row_count"]},
                    "files": files, "field_stats": stats}
        manifest_raw = _json(manifest) + b"\n"
        _require(len(manifest_raw) <= MAX_MANIFEST_BYTES,
                 "ANALYSIS_PUBLICATION_MANIFEST_TOO_LARGE")
        _cancelled(cancelled)
        write(manifest_path, manifest_raw, exclusive=True)
        # Reopen verifies every final complete file after the publication point.
        # A later cancellation may stop this read, but never removes the receipt.
        return _open(directory, recipe_sha256=recipe_hash, cancelled=cancelled)
