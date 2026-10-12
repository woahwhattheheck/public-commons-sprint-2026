"""Read complete Datasette editions for the maintained customer Analysis engine.

This reader consumes retained source bytes or the original finalized merchant
room. It does not fetch a provider or create a buyer request.
"""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
from urllib.parse import parse_qsl, urlsplit
import zipfile

HANDOVER_SCHEMA = "stellar-forge.datasette-analysis-handover.v1"
CAPTURE_SCHEMA = "stellar-forge.datasette-retained-pages.v1"
MAX_FILE = 64 * 1024 * 1024
MAX_DOCUMENT = 32 * 1024 * 1024
HASH = re.compile(r"[a-f0-9]{64}")
NAME = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,63}")


class SourceError(ValueError):
    def __init__(self, code, detail=""):
        self.code = code
        super().__init__(code + (": " + detail if detail else ""))


def require(condition, code, detail=""):
    if not condition:
        raise SourceError(code, detail)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, allow_nan=False,
                       sort_keys=True, separators=(",", ":")) + "\n").encode()


def unique(pairs):
    value = {}
    for key, item in pairs:
        require(key not in value, "DATASETTE_DUPLICATE_JSON_KEY", key)
        value[key] = item
    return value


class NumberToken(str):
    """Original JSON integer/decimal spelling; never a binary float."""


def parse(raw, *, tokens=False):
    try:
        options = {"object_pairs_hook": unique,
                   "parse_constant": lambda value: (_ for _ in ()).throw(
                       SourceError("DATASETTE_NONFINITE_JSON", value))}
        if tokens:
            options.update(parse_int=NumberToken, parse_float=NumberToken)
        return json.loads(raw.decode("utf-8"), **options)
    except (UnicodeError, json.JSONDecodeError) as error:
        raise SourceError("DATASETTE_JSON_INVALID", str(error)) from None


def regular(path, maximum=MAX_FILE):
    path = Path(path).expanduser().absolute()
    require(path.resolve() == path, "DATASETTE_CANONICAL_FILE_REQUIRED", str(path))
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as stream:
        before = os.fstat(stream.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_size <= maximum,
                "DATASETTE_SOURCE_FILE_CAPACITY", path.name)
        raw = stream.read(maximum + 1)
        after = os.fstat(stream.fileno())
    fields = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
    require(len(raw) == before.st_size and len(raw) <= maximum
            and all(getattr(before, key) == getattr(after, key) for key in fields)
            and all(getattr(after, key) == getattr(path.lstat(), key) for key in fields),
            "DATASETTE_SOURCE_CHANGED", path.name)
    return raw


def member(root, name):
    require(isinstance(name, str) and name and "\\" not in name and "\0" not in name,
            "DATASETTE_SOURCE_MEMBER_INVALID")
    value = Path(name)
    require(not value.is_absolute() and all(part not in {"", ".", ".."} for part in name.split("/")),
            "DATASETTE_SOURCE_MEMBER_INVALID", name)
    path = Path(root) / value
    require(path.resolve() == path.absolute(), "DATASETTE_SOURCE_LINK_NOT_SUPPORTED", name)
    return path


def checked_member(root, record):
    require(isinstance(record, dict), "DATASETTE_SOURCE_DESCRIPTOR_REQUIRED")
    name = record.get("file") or record.get("path")
    require(type(record.get("bytes")) is int and 0 <= record["bytes"] <= MAX_FILE
            and isinstance(record.get("sha256"), str) and HASH.fullmatch(record["sha256"]),
            "DATASETTE_SOURCE_IDENTITY_REQUIRED", str(name))
    raw = regular(member(root, name), MAX_FILE)
    require(len(raw) == record["bytes"] and sha(raw) == record["sha256"],
            "DATASETTE_SOURCE_IDENTITY_CHANGED", name)
    return name, raw


def source_url(value):
    require(isinstance(value, str) and len(value) <= 8192, "DATASETTE_SOURCE_URL_REQUIRED")
    url = urlsplit(value)
    require(url.scheme in {"http", "https"} and url.hostname and not url.username
            and not url.password and not url.fragment,
            "DATASETTE_SOURCE_URL_INVALID")
    return url


def request_identity(value):
    url = source_url(value)
    port = url.port
    # An observed same-host HTTP -> HTTPS redirect keeps the opaque path/query.
    # Arbitrary origin/port changes never become a continuation.
    if port in {None, 80 if url.scheme == "http" else 443}:
        port = None
    return url.hostname.lower(), port, url.path, url.query


def selection_identity(value):
    url = source_url(value)
    return (url.hostname.lower(), url.port if url.port not in {None, 80, 443} else None,
            url.path, tuple((key, val) for key, val in parse_qsl(url.query, keep_blank_values=True)
                            if key != "_next"))


def scalar(value):
    if isinstance(value, NumberToken):
        return str(value)
    if value is None or type(value) in {str, bool, int}:
        return value
    if isinstance(value, float):
        require(False, "DATASETTE_FLOAT_PROJECTION_NOT_RETAINED")
    return native_json(value)


def native_json(value):
    if isinstance(value, NumberToken):
        return str(value)
    if isinstance(value, dict):
        return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + native_json(v)
                              for k, v in value.items()) + "}"
    if isinstance(value, list):
        return "[" + ",".join(native_json(v) for v in value) + "]"
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


def native_kind(value):
    if isinstance(value, NumberToken) or type(value) in {int, float}:
        return "number"
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, str):
        return "string"
    return "array" if isinstance(value, list) else "object"


def reviewed_columns(columns, requested=None):
    require(isinstance(columns, list) and columns and len(columns) <= 63
            and all(isinstance(name, str) and name and "\0" not in name for name in columns)
            and len(columns) == len(set(columns)), "DATASETTE_COLUMNS_INVALID")
    requested = requested or {}
    require(isinstance(requested, dict) and set(requested) <= set(columns),
            "DATASETTE_COLUMN_MAPPING_INVALID")
    mapping, used = {}, set()
    for index, original in enumerate(columns):
        alias = requested.get(original)
        if alias is None:
            alias = re.sub(r"[^A-Za-z0-9_]", "_", original)[:56]
            if not alias or not alias[0].isalpha() or alias.startswith("sf_"):
                alias = "column_" + alias[:48]
            if alias in used:
                alias = alias[:54] + "_" + str(index + 1)
        require(isinstance(alias, str) and NAME.fullmatch(alias) and alias not in used
                and not alias.startswith("_sf_"), "DATASETTE_COLUMN_ALIAS_INVALID", str(alias))
        used.add(alias)
        mapping[original] = alias
    type_column = "datasette_native_types"
    while type_column in used:
        type_column += "_"
    return mapping, type_column


def normalize_source(source, fallback_url=None):
    require(isinstance(source, dict), "DATASETTE_SOURCE_DESCRIPTION_REQUIRED")
    result = dict(source)
    result["url"] = result.get("url") or result.get("sourceUrl") or fallback_url
    source_url(result["url"])
    result["title"] = str(result.get("title") or result.get("table") or "Datasette edition")[:200]
    result["publisher"] = str(result.get("publisher") or "Datasette publisher")[:200]
    result["captured_at"] = (result.get("captured_at") or result.get("capturedAt")
                             or result.get("retrieved_at"))
    if result["captured_at"] is not None:
        try:
            require(datetime.fromisoformat(result["captured_at"].replace("Z", "+00:00")).utcoffset() is not None,
                    "DATASETTE_CAPTURE_TIME_REQUIRED")
        except (TypeError, ValueError):
            raise SourceError("DATASETTE_CAPTURE_TIME_REQUIRED") from None
    return result


def handover(value):
    if isinstance(value, (str, Path)):
        path = Path(value).expanduser().absolute()
        raw = regular(path)
        record = parse(raw)
        base = path.parent
    else:
        require(isinstance(value, dict), "DATASETTE_HANDOVER_REQUIRED")
        record = value
        raw = encoded(record)
        base = None
    require(record.get("schema") == HANDOVER_SCHEMA and isinstance(record.get("delivery"), dict),
            "DATASETTE_HANDOVER_SCHEMA_INVALID")
    delivery = dict(record["delivery"])
    require(delivery.get("kind") in {"retained-source", "finalized"},
            "DATASETTE_HANDOVER_KIND_INVALID")
    for key in ("manifest", "room", "session"):
        selected = delivery.get(key)
        if selected is not None:
            require(isinstance(selected, str) and selected and "\0" not in selected,
                    "DATASETTE_HANDOVER_PATH_INVALID", key)
            path = Path(selected).expanduser()
            if not path.is_absolute():
                require(base is not None, "DATASETTE_ABSOLUTE_HANDOVER_PATH_REQUIRED", key)
                path = base / path
            delivery[key] = str(path.absolute())
    return {"record": {**record, "delivery": delivery}, "raw": raw, "sha256": sha(raw)}


def read_retained(value):
    selected = handover(value)
    record, delivery = selected["record"], selected["record"]["delivery"]
    require(delivery["kind"] == "retained-source", "DATASETTE_RETAINED_SOURCE_REQUIRED")
    manifest_path = Path(delivery["manifest"])
    raw_manifest = regular(manifest_path)
    require(isinstance(delivery.get("sha256"), str) and HASH.fullmatch(delivery["sha256"])
            and sha(raw_manifest) == delivery["sha256"],
            "DATASETTE_CAPTURE_MANIFEST_CHANGED")
    capture = parse(raw_manifest)
    require(capture.get("schema") == CAPTURE_SCHEMA, "DATASETTE_CAPTURE_SCHEMA_INVALID")
    pages = capture.get("pages")
    require(isinstance(pages, list) and pages, "DATASETTE_COMPLETE_PAGES_REQUIRED")
    columns = capture.get("columns")
    mapping, type_column = reviewed_columns(columns, record.get("column_mapping"))
    source = normalize_source(capture.get("source", record.get("source", {})),
                              pages[0].get("requested_url"))
    source.update({key: val for key, val in record.get("source", {}).items()
                   if key not in {"url", "database", "table"}})
    originals = [{"name": "capture-manifest.json", "raw": raw_manifest,
                  "content_type": "application/json", "role": "original-capture-manifest"},
                 {"name": "handover.json", "raw": selected["raw"],
                  "content_type": "application/json", "role": "original-handover"}]
    rows, page_records, seen = [], [], set()
    previous_next, first_identity, immutable_version = None, None, None
    all_kinds = {name: set() for name in columns}
    for index, entry in enumerate(pages):
        name, raw = checked_member(manifest_path.parent, entry)
        requested = entry.get("requested_url")
        final = entry.get("final_url") or requested
        current_identity = request_identity(requested)
        require(not (source_url(requested).scheme == "https" and source_url(final).scheme != "https"),
                "DATASETTE_PAGE_REDIRECT_DOWNGRADE", name)
        require(request_identity(final) == current_identity,
                "DATASETTE_PAGE_REDIRECT_CHANGED_SELECTION", name)
        if index:
            require(previous_next is not None and current_identity == request_identity(previous_next)
                    and not (source_url(previous_next).scheme == "https" and source_url(requested).scheme != "https"),
                    "DATASETTE_PAGE_CHAIN_CHANGED", name)
        require(current_identity not in seen, "DATASETTE_CONTINUATION_REPEATED", name)
        seen.add(current_identity)
        if first_identity is None:
            first_identity = selection_identity(requested)
            require(selection_identity(source["url"]) == first_identity,
                    "DATASETTE_FIRST_SOURCE_SELECTION_CHANGED")
        require(selection_identity(requested) == first_identity,
                "DATASETTE_PAGE_FILTERS_CHANGED", name)
        if entry.get("status") is not None:
            require(entry["status"] == 200, "DATASETTE_PAGE_HTTP_ERROR", name)
        else:
            # Some supported file-import providers return a full body and their
            # own receipt, but do not expose the origin response headers.
            require(entry.get("provider_receipt") or entry.get("retrieval") or entry.get("provider"),
                    "DATASETTE_PAGE_RETRIEVAL_RECEIPT_REQUIRED", name)
        page = parse(raw, tokens=True)
        require(isinstance(page, dict) and page.get("ok", True) is True
                and not page.get("error") and isinstance(page.get("rows"), list),
                "DATASETTE_PAGE_ENVELOPE_INVALID", name)
        if "columns" in page:
            require(page["columns"] == columns, "DATASETTE_PAGE_COLUMNS_CHANGED", name)
        for key in ("database", "table"):
            if key in page and source.get(key) is not None:
                require(page[key] == source[key], "DATASETTE_PAGE_SOURCE_CHANGED", key)
        version = page.get("database_hash") or page.get("database_version")
        if version is not None:
            if immutable_version is None:
                immutable_version = version
            require(version == immutable_version, "DATASETTE_SOURCE_VERSION_CHANGED")
        next_url = page.get("next_url")
        require(next_url is None or isinstance(next_url, str) and bool(next_url),
                "DATASETTE_NEXT_URL_INVALID", name)
        if "next_url" in entry:
            require(entry["next_url"] == next_url, "DATASETTE_CAPTURE_CONTINUATION_CHANGED", name)
        require(not page.get("truncated") or next_url is not None,
                "DATASETTE_TRUNCATED_SOURCE_INCOMPLETE", name)
        for original in page["rows"]:
            if isinstance(original, dict):
                require(set(original) == set(columns), "DATASETTE_ROW_FIELDS_CHANGED", name)
                values = [original[column] for column in columns]
            else:
                require(isinstance(original, list) and len(original) == len(columns),
                        "DATASETTE_ROW_WIDTH_CHANGED", name)
                values = original
            kinds = {column: native_kind(cell) for column, cell in zip(columns, values)}
            for column, kind in kinds.items():
                all_kinds[column].add(kind)
            projected = {mapping[column]: scalar(cell) for column, cell in zip(columns, values)}
            projected[type_column] = json.dumps(kinds, ensure_ascii=False, separators=(",", ":"))
            rows.append(projected)
        originals.append({"name": f"pages/{index + 1:05d}.json", "raw": raw,
                          "content_type": "application/json", "role": f"original-page-{index + 1}"})
        page_records.append({**{key: entry.get(key) for key in (
            "bytes", "sha256", "requested_url", "final_url", "status", "retrieved_at",
            "headers", "provider_receipt", "retrieval")}, "row_count": len(page["rows"]),
            "next_url": next_url})
        previous_next = next_url
    require(previous_next is None, "DATASETTE_SOURCE_CONTINUATION_OUTSTANDING")
    expected_rows = capture.get("row_count", capture.get("profile", {}).get("rows", capture.get("rows")))
    if isinstance(expected_rows, int):
        require(expected_rows == len(rows), "DATASETTE_CAPTURE_ROW_COUNT_CHANGED")
    references = capture.get("references", [])
    require(isinstance(references, list), "DATASETTE_REFERENCES_INVALID")
    for index, entry in enumerate(references):
        name, raw = checked_member(manifest_path.parent, entry)
        originals.append({"name": "references/" + Path(name).name, "raw": raw,
                          "content_type": entry.get("content_type") or "application/octet-stream",
                          "role": "original-reference-" + str(index + 1)})
        if entry.get("role") in {"columns", "metadata", "table-metadata"} or name.endswith("table-metadata.json"):
            try:
                metadata = parse(raw)
            except SourceError:
                continue
            if isinstance(metadata, dict) and "columns" in metadata:
                require(metadata["columns"] == columns, "DATASETTE_COLUMN_REFERENCE_CHANGED")
    source.update(capture_sha256=sha(raw_manifest), handover_sha256=selected["sha256"],
                  source_columns=columns, column_mapping=mapping, type_column=type_column,
                  native_types={name: sorted(kinds) for name, kinds in all_kinds.items()},
                  pages=page_records, row_count=len(rows), immutable_version=immutable_version,
                  source_mode="retained-source",
                  captured_at=source.get("captured_at") or pages[0].get("retrieved_at"),
                  observation_end=(pages[-1].get("retrieved_at") or
                                   capture.get("consistency", {}).get("capture_window", {}).get("not_after")),
                  consistency=("IMMUTABLE_VERSION_OBSERVED" if immutable_version else "OBSERVATION_WINDOW"))
    require(source["captured_at"], "DATASETTE_CAPTURE_TIME_REQUIRED")
    identity = sha(encoded({"capture": sha(raw_manifest), "mapping": mapping,
                           "review": record.get("review", {}), "source": source.get("id"),
                           "projection": "exact-number-text-and-native-kind.v1"}))
    return {"id": identity, "source": source, "columns": [*mapping.values(), type_column],
            "rows": rows, "originals": originals, "handover": record,
            "review": record.get("review", {})}


def source_document(directory, *, collections, edition):
    """Use the original portable ResponseDocument format, including every page."""
    from stellar_forge_buyer.storage import private_directory, write
    directory = private_directory(Path(directory), create=True)
    projection = encoded({name: collection["rows"] for name, collection in collections.items()})
    require(len(projection) <= MAX_DOCUMENT, "DATASETTE_ANALYSIS_DOCUMENT_CAPACITY")
    records = []

    def content(raw, extension, content_type):
        digest = sha(raw)
        name = f"files/{digest}.{extension}"
        target = directory / name
        private_directory(target.parent, create=True)
        if target.exists():
            require(regular(target) == raw, "DATASETTE_RETAINED_DOCUMENT_CHANGED", name)
        else:
            write(target, raw, exclusive=True)
        return {"path": name, "bytes": len(raw), "sha256": digest, "contentType": content_type}

    originals = list(edition["originals"])
    source_raw = encoded(edition["source"])
    originals.append({"name": "source-meaning.json", "raw": source_raw,
                      "content_type": "application/json", "role": "reviewed-source-meaning"})
    if len(originals) > 32:
        # Exact originals stay complete inside one ordinary ZIP. This is a source
        # document attachment; the existing workspace archive remains receiver.
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            used = set()
            for index, item in enumerate(originals):
                name = str(index + 1).zfill(5) + "/" + Path(item["name"]).name
                require(name not in used, "DATASETTE_ORIGINAL_MEMBER_DUPLICATE")
                used.add(name)
                info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                info.external_attr = 0o600 << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, item["raw"])
        originals = [{"name": "original-source.zip", "raw": stream.getvalue(),
                      "content_type": "application/zip", "role": "complete-original-source"}]
    for item in originals:
        extension = "json" if item["content_type"] == "application/json" else "bin"
        records.append({**content(item["raw"], extension, item["content_type"]), "role": item["role"]})
    source = edition["source"]
    license_record = source.get("license")
    license_text = json.dumps(license_record, ensure_ascii=False) if license_record else "See retained publisher metadata."
    scope = f"Complete {source.get('database', '')}/{source.get('table', '')} selection; {len(edition['rows'])} rows."
    description = ("All original source fields and numeric spellings are retained. "
        "The separate native-kind column distinguishes JSON numbers, strings, nulls and structured cells. "
        "Capacity and year fields describe the source's historical observations. "
        "Capture time describes retrieval. Source license and attribution: " + license_text)
    manifest = {"schema": "stellar-forge.analysis-source-document.v1",
                "title": source["title"], "format": "json", "complete": True,
                "document": content(projection, "json", "application/json"),
                "originals": records,
                "provenance": {"kind": "public-source", "publisher": source["publisher"],
                    "sourceUrl": source["url"], "capturedAt": source["captured_at"],
                    "scope": scope[:500], "description": description[:12000],
                    "transform": {"name": "Datasette reviewed exact-source customer projection v1",
                        "sourceUrl": "https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar/scf-starforge-20261009/sf30-seller-sdk/datasette-analysis/source.py",
                        "sha256": sha(regular(Path(__file__)))}}}
    target = directory / "source.json"
    raw = encoded(manifest)
    if target.exists():
        require(regular(target) == raw, "DATASETTE_DOCUMENT_SELECTION_CHANGED")
    else:
        write(target, raw, exclusive=True)
    return target
