"""Read complete Datasette editions for the maintained customer Analysis engine.

This reader consumes retained source bytes, the original reviewed native edition,
or the original finalized merchant room. It does not fetch a provider or create a buyer request.
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
            if alias.casefold() in used:
                alias = alias[:54] + "_" + str(index + 1)
        require(isinstance(alias, str) and NAME.fullmatch(alias) and alias.casefold() not in used
                and not alias.startswith("_sf_"), "DATASETTE_COLUMN_ALIAS_INVALID", str(alias))
        used.add(alias.casefold())
        mapping[original] = alias
    type_column = "datasette_native_types"
    while type_column.casefold() in used:
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
    require(delivery.get("kind") in {"retained-source", "finalized", "native-edition"},
            "DATASETTE_HANDOVER_KIND_INVALID")
    for key in ("manifest", "room", "session", "edition"):
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
        + ("Capture time records the original native capture commit; "
           "page receipts retain the observed retrieval times. "
           if source.get("capture_time_basis") == "native-capture-commit"
           else "Capture time describes retrieval. ")
        + "Source license and attribution: " + license_text)
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


# The original edition bridge uses the maintained
# handover, reviewed_columns, regular, checked_member, parse, encoded and require
# helpers. It does not replace those helpers or open another Analysis engine.

def read_native_edition(value, *, node):
    """Consume the sibling publisher's complete, hash-bound reviewed edition."""
    import subprocess

    selected = handover(value)
    record, delivery = selected["record"], selected["record"]["delivery"]
    require(delivery.get("kind") == "native-edition",
            "DATASETTE_NATIVE_EDITION_REQUIRED")
    require(isinstance(delivery.get("edition"), str) and Path(delivery["edition"]).is_absolute(),
            "DATASETTE_NATIVE_EDITION_PATH_REQUIRED")
    edition_path = Path(delivery["edition"])
    expected_sha = delivery.get("sha256")
    require(isinstance(expected_sha, str) and HASH.fullmatch(expected_sha),
            "DATASETTE_NATIVE_EDITION_SHA256_REQUIRED")
    original_edition_raw = regular(edition_path)
    require(sha(original_edition_raw) == expected_sha,
            "DATASETTE_NATIVE_EDITION_CHANGED")
    bridge_path = Path(__file__).with_name("edition_bridge.mjs")
    regular(bridge_path)
    require(isinstance(node, (str, os.PathLike)), "DATASETTE_NATIVE_NODE_REQUIRED")
    node_command = os.fspath(node)
    require(isinstance(node_command, str) and node_command and "\0" not in node_command,
            "DATASETTE_NATIVE_NODE_REQUIRED")
    try:
        process = subprocess.run(
            [node_command, str(bridge_path)],
            input=encoded({"edition": str(edition_path), "sha256": expected_sha}),
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            shell=False, check=False, timeout=180,
        )
    except subprocess.TimeoutExpired:
        raise SourceError("DATASETTE_NATIVE_EDITION_READ_TIMEOUT") from None
    except OSError as error:
        raise SourceError("DATASETTE_NATIVE_EDITION_READER_UNAVAILABLE", str(error)) from None
    if process.returncode:
        detail = process.stderr[:8192].decode("utf-8", errors="replace")
        try:
            issue = json.loads(detail)
        except (ValueError, TypeError):
            issue = {}
        code = issue.get("error") if isinstance(issue, dict) else None
        if not isinstance(code, str) or not re.fullmatch(r"[A-Z][A-Z0-9_]{1,127}", code):
            code = "DATASETTE_NATIVE_EDITION_READER_FAILED"
        raise SourceError(code, str(issue.get("message") if isinstance(issue, dict)
                                   and issue.get("message") else detail)[:2000])
    require(len(process.stdout) <= MAX_FILE,
            "DATASETTE_NATIVE_EDITION_BRIDGE_CAPACITY")
    bridge = parse(process.stdout)
    require(isinstance(bridge, dict)
            and bridge.get("schema") == "stellar-forge.datasette-analysis-native-edition.v1"
            and bridge.get("edition_file") == str(edition_path)
            and bridge.get("edition_root") == str(edition_path.parent)
            and bridge.get("edition_sha256") == expected_sha
            and bridge.get("projection_mode") == "reviewed",
            "DATASETTE_NATIVE_EDITION_BRIDGE_BINDING_CHANGED")

    # Read every original from its declared relative member path through the
    # maintained regular-file and SHA checks. The bridge returns descriptors,
    # so it does not base64-copy complete source files through a subprocess pipe.
    native_edition = parse(original_edition_raw)
    require(isinstance(native_edition, dict)
            and native_edition == bridge.get("edition")
            and isinstance(native_edition.get("files"), list),
            "DATASETTE_NATIVE_EDITION_DECLARATION_CHANGED")
    declared = {"edition.json": {"file": "edition.json",
                                "bytes": len(original_edition_raw), "sha256": expected_sha}}
    for descriptor in native_edition["files"]:
        require(isinstance(descriptor, dict) and isinstance(descriptor.get("file"), str)
                and descriptor["file"] not in declared,
                "DATASETTE_NATIVE_EDITION_MEMBER_DUPLICATE")
        declared[descriptor["file"]] = descriptor
    files = bridge.get("files")
    require(isinstance(files, list) and len(files) == len(declared),
            "DATASETTE_NATIVE_EDITION_SOURCE_CLOSURE_CHANGED")
    originals, retained, seen = [], {}, set()
    for descriptor in files:
        require(isinstance(descriptor, dict), "DATASETTE_SOURCE_DESCRIPTOR_REQUIRED")
        name = descriptor.get("file")
        require(isinstance(name, str) and name in declared and name not in seen,
                "DATASETTE_NATIVE_EDITION_SOURCE_CLOSURE_CHANGED")
        seen.add(name)
        expected = declared[name]
        require(descriptor.get("bytes") == expected.get("bytes")
                and descriptor.get("sha256") == expected.get("sha256")
                and descriptor.get("absolute_path") == str(member(edition_path.parent, name)),
                "DATASETTE_NATIVE_EDITION_MEMBER_BINDING_CHANGED", name)
        name, raw = checked_member(edition_path.parent, expected)
        retained[name] = raw
        content_type = descriptor.get("content_type")
        role = descriptor.get("role")
        require(content_type in {"application/json", "application/octet-stream"}
                and isinstance(role, str) and role.startswith("original-native-"),
                "DATASETTE_NATIVE_EDITION_MEMBER_DESCRIPTION_INVALID", name)
        originals.append({"name": "native-edition/" + name, "raw": raw,
                          "content_type": content_type, "role": role})
    require(seen == set(declared) and retained["edition.json"] == original_edition_raw
            and regular(edition_path) == original_edition_raw,
            "DATASETTE_NATIVE_EDITION_SOURCE_CHANGED")
    capture_name, review_name = native_edition.get("captureFile"), native_edition.get("reviewFile")
    require(capture_name in retained and review_name in retained
            and sha(retained[capture_name]) == bridge.get("capture_sha256")
            == native_edition.get("captureSha256")
            and sha(retained[review_name]) == bridge.get("review_sha256")
            == native_edition.get("reviewSha256"),
            "DATASETTE_NATIVE_EDITION_CAPTURE_OR_REVIEW_CHANGED")
    native_capture, native_review = parse(retained[capture_name]), parse(retained[review_name])
    require(native_capture == bridge.get("capture") and native_review == bridge.get("review")
            and native_review.get("approved") is True
            and native_review.get("projection") == bridge.get("projection"),
            "DATASETTE_NATIVE_EDITION_REVIEW_CHANGED")
    columns = bridge.get("columns")
    require(isinstance(columns, list) and columns == list(native_review["projection"]),
            "DATASETTE_NATIVE_EDITION_PROJECTION_COLUMNS_CHANGED")
    # A handover mapping names the reviewed aliases. The maintained helper owns
    # Analysis/SQLite-safe storage names, including case-insensitive collisions.
    mapping, type_column = reviewed_columns(columns, record.get("column_mapping"))
    projected_rows, kinds = bridge.get("rows"), bridge.get("kinds")
    source_columns, source_kinds = bridge.get("source_columns"), bridge.get("source_kinds")
    require(isinstance(projected_rows, list) and isinstance(kinds, list)
            and len(projected_rows) == len(kinds) == native_edition.get("rowCount")
            and source_columns == native_capture.get("columns")
            and isinstance(source_kinds, list) and len(source_kinds) == len(projected_rows),
            "DATASETTE_NATIVE_EDITION_COMPLETE_ROWS_REQUIRED")
    allowed_kinds = {"integer", "number", "string", "boolean", "null", "array", "object"}
    rows, observed = [], {name: set() for name in columns}
    original_observed = {name: set() for name in source_columns}
    for projected, native_types, original_types in zip(projected_rows, kinds, source_kinds):
        require(isinstance(projected, dict) and set(projected) == set(columns)
                and isinstance(native_types, dict) and set(native_types) == set(columns)
                and isinstance(original_types, list) and len(original_types) == len(source_columns),
                "DATASETTE_NATIVE_EDITION_ROW_WIDTH_CHANGED")
        projected_types = {}
        for original, kind in zip(source_columns, original_types):
            require(isinstance(kind, str) and kind in allowed_kinds,
                    "DATASETTE_NATIVE_EDITION_SOURCE_KIND_INVALID")
            original_observed[original].add(kind)
        for alias in columns:
            cell, kind = projected[alias], native_types[alias]
            require((cell is None or isinstance(cell, str)) and isinstance(kind, str) and kind in allowed_kinds,
                    "DATASETTE_NATIVE_EDITION_PROJECTED_CELL_INVALID", alias)
            require((kind == "null") == (cell is None),
                    "DATASETTE_NATIVE_EDITION_NULL_PROJECTION_CHANGED", alias)
            if kind in {"integer", "number"}:
                require(re.fullmatch(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?", cell),
                        "DATASETTE_NATIVE_EDITION_NUMBER_TOKEN_INVALID", alias)
            if kind == "boolean":
                require(cell in {"true", "false"}, "DATASETTE_NATIVE_EDITION_BOOLEAN_CHANGED", alias)
            projected_types[mapping[alias]] = kind
            observed[alias].add(kind)
        row = {mapping[alias]: projected[alias] for alias in columns}
        row[type_column] = json.dumps(projected_types, ensure_ascii=False, separators=(",", ":"))
        rows.append(row)

    source = normalize_source(bridge.get("source"), native_capture["selection"]["url"])
    source_aliases = bridge.get("source_column_aliases")
    semantic_aliases = bridge.get("semantic_aliases")
    require(isinstance(source_aliases, dict) and set(source_aliases) == set(source_columns)
            and isinstance(semantic_aliases, dict), "DATASETTE_NATIVE_EDITION_ALIAS_MAPPING_INVALID")
    mapped_source_aliases = {}
    for original, aliases in source_aliases.items():
        require(isinstance(aliases, list) and len(aliases) == len(set(aliases))
                and all(alias in mapping and native_review["projection"][alias]["column"] == original
                        for alias in aliases),
                "DATASETTE_NATIVE_EDITION_ALIAS_MAPPING_INVALID", original)
        mapped_source_aliases[original] = [mapping[alias] for alias in aliases]
    require(all(original in source_aliases and alias in source_aliases[original]
                for original, alias in semantic_aliases.items()),
            "DATASETTE_NATIVE_EDITION_SEMANTIC_MAPPING_INVALID")
    semantic_mapping = {original: mapping[alias] for original, alias in semantic_aliases.items()}
    key = bridge.get("reviewed_key")
    require(isinstance(key, dict) and key.get("review") == native_review.get("key"),
            "DATASETTE_NATIVE_EDITION_KEY_REVIEW_CHANGED")
    recommended = key.get("recommended_source_columns", [])
    require(isinstance(recommended, list) and (not recommended or
            key.get("business_key_eligible") is True
            and recommended == native_review["key"]["columns"]
            and all(column in semantic_mapping for column in recommended)),
            "DATASETTE_NATIVE_EDITION_KEY_MAPPING_CHANGED")
    local_aliases = key.get("local_locator_aliases")
    require(isinstance(local_aliases, list) and all(alias in mapping for alias in local_aliases),
            "DATASETTE_NATIVE_EDITION_LOCAL_LOCATOR_CHANGED")
    storage_key = {**key,
                   "storage_aliases": [mapping[alias] for alias in key.get("projected_aliases", [])],
                   "recommended_storage_aliases": [mapping[alias] for alias in
                                                   key.get("recommended_projected_aliases", [])],
                   "local_locator_columns": [mapping[alias] for alias in local_aliases]}
    source.update(
        source_mode="native-edition", edition_sha256=expected_sha,
        capture_sha256=bridge["capture_sha256"], review_sha256=bridge["review_sha256"],
        handover_sha256=selected["sha256"], source_columns=source_columns,
        projected_columns=columns, projected_source_columns=[
            native_review["projection"][alias]["column"] for alias in columns],
        column_mapping=semantic_mapping, source_column_aliases=mapped_source_aliases,
        reviewed_alias_mapping=bridge["alias_mapping"], storage_alias_mapping=mapping,
        semantic_alias_rule=bridge["semantic_alias_rule"],
        ambiguous_source_columns=bridge["ambiguous_source_columns"],
        projection_mode="reviewed", reviewed_projection=native_review["projection"],
        type_column=type_column, type_mapping={},
        native_types={name: sorted(values) for name, values in original_observed.items()},
        projected_native_types={mapping[name]: sorted(values) for name, values in observed.items()},
        native_reviewed_key=storage_key, local_locator_columns=storage_key["local_locator_columns"],
        original_source_files=[{key: descriptor[key] for key in
                               ("file", "bytes", "sha256", "content_type", "role")}
                              for descriptor in files],
    )
    require(source.get("captured_at"), "DATASETTE_NATIVE_EDITION_TIME_REQUIRED")
    receiver_description = record.get("source", {})
    require(isinstance(receiver_description, dict), "DATASETTE_SOURCE_DESCRIPTION_REQUIRED")
    if receiver_description:
        source["receiver_description"] = receiver_description
        for field in ("title", "description"):
            if field in receiver_description:
                require(isinstance(receiver_description[field], str),
                        "DATASETTE_SOURCE_DESCRIPTION_INVALID", field)
                source[field] = receiver_description[field]
    # The original key declaration is kept separately from the analysis candidate
    # review. Recommendations use source column names, so the existing recipes
    # and comparison path apply the explicit semantic map exactly once.
    review = {"native_review": native_review, "native_reviewed_key": storage_key,
              "handover_review": record.get("review", {})}
    if recommended:
        review["keys"] = recommended
        source["reviewed_keys"] = recommended
    originals.extend([
        {"name": "native-edition-bridge.json", "raw": process.stdout,
         "content_type": "application/json", "role": "original-native-edition-analysis-handover"},
        {"name": "handover.json", "raw": selected["raw"],
         "content_type": "application/json", "role": "original-handover"},
    ])
    identity = sha(encoded({
        "edition_sha256": expected_sha, "capture_sha256": bridge["capture_sha256"],
        "review_sha256": bridge["review_sha256"], "projection": native_review["projection"],
        "mapping": mapping, "semantic_mapping": semantic_mapping,
        "receiver_description": receiver_description,
        "projection_mode": "native-reviewed-exact-number-text-and-kind.v1",
    }))
    return {"id": identity, "source": source, "columns": [*mapping.values(), type_column],
            "rows": rows, "originals": originals, "handover": record, "review": review}
