"""Exact Timescale commissioning sources for the original DuckDB edition importer.

This is a distinct input format, not a DatasetDelivery or payment receipt.
PostgreSQL text/null and the whole original report remain retained source bytes.
"""
from __future__ import annotations

from contextlib import contextmanager
from copy import deepcopy
from decimal import Decimal
import io
import json
import os
from pathlib import Path
import re
import stat

from ..errors import StateError
from ..storage import digest, parse, unique_object

SCHEMA = "stellar-forge.duckdb-timescale-intake.v1"
DESCRIPTOR = SCHEMA + ".source"
MANIFEST = SCHEMA + ".manifest"
NATIVE = SCHEMA + ".native"
REPORT = "stellar-forge.timescale-commissioning-report.v1"
MAX_REPORT = 256_000_000
MAX_ROWS = 1_000_000
MAX_COLUMNS = 512
MAX_MANIFEST = 4 * 1024 * 1024
_HASH = re.compile(r"[0-9a-f]{64}")
_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
_REQUEST = re.compile(r"[0-9a-f]{32}")
_ROLES = {"tag", "time", "value", "quality", "attribute"}


def fail(code):
    raise StateError("DUCKDB_TIMESCALE_" + code)


def need(condition, code):
    if not condition:
        fail(code)


def fields(value, required=(), optional=()):
    need(isinstance(value, dict) and not set(value) - set(required) - set(optional)
         and set(required) <= set(value), "FIELDS_INVALID")
    return value


def text(value, maximum=8000, empty=False):
    need(isinstance(value, str) and "\x00" not in value
         and (empty or bool(value.strip())) and len(value.encode("utf-8")) <= maximum, "TEXT_INVALID")
    return value


def hash_id(value):
    need(isinstance(value, str) and _HASH.fullmatch(value), "HASH_REQUIRED")
    return value


def request_id(value):
    need(isinstance(value, str) and _REQUEST.fullmatch(value), "WORKSPACE_OR_REQUEST_ID_REQUIRED")
    return value


def uuid(value):
    need(isinstance(value, str) and _UUID.fullmatch(value), "NATIVE_UUID_REQUIRED")
    return value


def integer(value, minimum=0, maximum=1_000_000_000):
    need(type(value) is int and minimum <= value <= maximum, "INTEGER_INVALID")
    return value


def filename(value):
    text(value, 240)
    need(value not in {".", ".."} and "/" not in value and "\\" not in value, "FILENAME_INVALID")
    return value


def private_path(value):
    need(isinstance(value, (str, Path)), "PRIVATE_PATH_REQUIRED")
    path = Path(os.path.abspath(Path(value).expanduser()))
    need(path.is_absolute() and path != Path("/") and str(path) == str(Path(value).expanduser())
         and path.resolve(strict=True) == path, "PRIVATE_PATH_REQUIRED")
    return path


def read_original(value, maximum=MAX_REPORT):
    path = private_path(value)
    parent = path.parent
    info = parent.lstat()
    need(stat.S_ISDIR(info.st_mode) and not info.st_mode & 0o077, "PRIVATE_DIRECTORY_REQUIRED")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1
             and not before.st_mode & 0o077 and 0 < before.st_size <= maximum, "PRIVATE_FILE_REQUIRED")
        raw = stream.read(maximum + 1)
        after = os.fstat(stream.fileno())
        need(len(raw) == before.st_size and
             (before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
             (after.st_size, after.st_mtime_ns, after.st_ctime_ns), "ORIGINAL_FILE_CHANGED")
    return raw


class _Number:
    """Preserve the producer's JSON number text for its original JS digests."""
    def __init__(self, value):
        self.value = value


def _lexical(raw):
    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object,
                          parse_int=_Number, parse_float=_Number,
                          parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except (ValueError, UnicodeError):
        fail("ORIGINAL_JSON_INVALID")


def _quoted(value):
    # JSON.stringify's well-formed strings escape isolated UTF-16 surrogates.
    result = json.dumps(value, ensure_ascii=False)
    return "".join("\\u%04x" % ord(c) if 0xD800 <= ord(c) <= 0xDFFF else c for c in result)


def _keys(value, canonical):
    keys = list(value)
    if canonical:
        keys.sort(key=lambda key: key.encode("utf-16-be", "surrogatepass"))
    # ECMAScript object enumeration emits index keys first, including after
    # Object.fromEntries(Object.keys(value).sort()) in the original identity().
    indices = [key for key in keys if re.fullmatch(r"0|[1-9][0-9]{0,9}", key)
               and int(key) < 4_294_967_295]
    return sorted(indices, key=int) + [key for key in keys if key not in indices]


def _js(value, *, canonical=False, pretty=False, depth=0):
    if isinstance(value, _Number):
        return value.value
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        return _quoted(value)
    if type(value) is int:
        return str(value)
    if isinstance(value, (list, dict)):
        if isinstance(value, list):
            left, right = "[", "]"
            items = [_js(item, canonical=canonical, pretty=pretty, depth=depth + 1) for item in value]
        else:
            left, right = "{", "}"
            items = [_quoted(key) + (": " if pretty else ":") +
                     _js(value[key], canonical=canonical, pretty=pretty, depth=depth + 1)
                     for key in _keys(value, canonical)]
        if not items:
            return left + right
        if not pretty:
            return left + ",".join(items) + right
        pad, end = "  " * (depth + 1), "  " * depth
        return left + "\n" + pad + (",\n" + pad).join(items) + "\n" + end + right
    fail("ORIGINAL_JSON_VALUE_INVALID")


def native_identity(value):
    return digest(_js(value, canonical=True).encode("utf-8"))


def _same(a, b):
    return _js(a, canonical=True) == _js(b, canonical=True)


def _record(reference, value):
    need(isinstance(reference, dict), "NATIVE_RECORD_REFERENCE_INVALID")
    raw = (_js(value, pretty=True) + "\n").encode("utf-8")
    sha = digest(raw)
    expected_bytes = reference.get("bytes")
    if isinstance(expected_bytes, _Number):
        expected_bytes = int(expected_bytes.value)
    need(reference.get("file") == sha + ".json" and reference.get("sha256") == sha
         and expected_bytes == len(raw), "NATIVE_RECORD_CHANGED")


def native_table(document, table_name):
    selected = document
    if table_name is not None:
        text(table_name, 256)
        need(isinstance(document, dict) and isinstance(document.get("tables"), dict)
             and table_name in document["tables"], "NATIVE_TABLE_NOT_FOUND")
        selected = document["tables"][table_name]
    need(isinstance(selected, dict) and isinstance(selected.get("columns"), list)
         and isinstance(selected.get("rows"), list), "NATIVE_TABLE_REQUIRED")
    names, columns = [], []
    for column in selected["columns"]:
        name = column if isinstance(column, str) else column.get("name") if isinstance(column, dict) else None
        text(name, 1024)
        need(name not in names, "NATIVE_COLUMN_DUPLICATE")
        oid = column.get("oid") if isinstance(column, dict) else None
        if oid is not None:
            need(isinstance(oid, str) and re.fullmatch(r"[0-9]{1,10}", oid), "NATIVE_OID_INVALID")
        names.append(name)
        columns.append({"name": name, "oid": oid})
    need(1 <= len(names) <= MAX_COLUMNS and len(selected["rows"]) <= MAX_ROWS, "NATIVE_TABLE_LIMIT")
    for row in selected["rows"]:
        need(isinstance(row, list) and len(row) == len(names)
             and all(value is None or isinstance(value, str) for value in row), "NATIVE_TEXT_OR_NULL_REQUIRED")
        for value in row:
            if isinstance(value, str):
                need(not any(0xD800 <= ord(c) <= 0xDFFF for c in value), "INVALID_NATIVE_UNICODE")
    if "complete" in selected:
        need(selected["complete"] is True, "INCOMPLETE_NATIVE_TABLE")
    if "rowCount" in selected:
        need(type(selected["rowCount"]) is int and selected["rowCount"] == len(selected["rows"]), "NATIVE_ROW_COUNT_CHANGED")
    return {"names": names, "columns": columns, "rows": selected["rows"],
            "provider_completeness": "DECLARED_COMPLETE" if selected.get("complete") is True else "NOT_DECLARED"}


class CommissioningReport:
    """Check every retained original source and the complete producer history."""
    def __init__(self, raw, expected_sha256=None):
        need(isinstance(raw, bytes) and 0 < len(raw) <= MAX_REPORT, "REPORT_SIZE_INVALID")
        self.raw, self.sha256 = raw, digest(raw)
        if expected_sha256 is not None:
            need(self.sha256 == hash_id(expected_sha256), "REPORT_CHANGED")
        lexical = _lexical(raw)
        report = parse(raw)
        need(isinstance(report, dict) and report.get("schema") == REPORT and report.get("complete") is True,
             "COMPLETE_COMMISSIONING_REPORT_REQUIRED")
        self.document, self.lexical = report, lexical
        uuid(report.get("workspaceId")); uuid(report.get("commissioningId"))
        integer(report.get("revision"), 1)
        hash_id(report.get("digest"))
        project = report.get("project")
        need(isinstance(project, dict) and project.get("workspaceId") == report["workspaceId"]
             and project.get("digest") == report["digest"] and isinstance(project.get("item"), dict), "PROJECT_BINDING_CHANGED")
        item, original_item = project["item"], lexical["project"]["item"]
        need(item.get("schema") == "stellar-forge.timescale-commissioning.v1"
             and item.get("id") == report["commissioningId"] and item.get("workspaceId") == report["workspaceId"]
             and item.get("revision") == report["revision"] and native_identity(original_item) == report["digest"],
             "PROJECT_DIGEST_CHANGED")
        revisions = lexical.get("revisions")
        need(isinstance(revisions, list) and len(revisions) == report["revision"], "COMPLETE_HISTORY_REQUIRED")
        previous, history_ids = None, set()
        for index, row in enumerate(revisions):
            plain = report["revisions"][index]
            need(isinstance(row, dict) and plain.get("schema") == "stellar-forge.timescale-commissioning-change.v1"
                 and plain.get("workspaceId") == report["workspaceId"] and plain.get("commissioningId") == report["commissioningId"]
                 and plain.get("revision") == index + 1 and plain.get("item", {}).get("revision") == index + 1
                 and plain.get("item", {}).get("id") == report["commissioningId"]
                 and plain.get("item", {}).get("workspaceId") == report["workspaceId"]
                 and plain.get("digest") == native_identity(row["item"])
                 and plain["item"].get("previousDigest") == previous, "HISTORY_CHAIN_CHANGED")
            uuid(plain.get("requestId"))
            need(plain["requestId"] not in history_ids, "HISTORY_REQUEST_DUPLICATE")
            history_ids.add(plain["requestId"])
            if index == 0:
                need(plain.get("action") == "create" and plain["requestId"] == report["commissioningId"], "HISTORY_ORIGIN_CHANGED")
            previous = plain["digest"]
        need(previous == report["digest"] and _same(revisions[-1]["item"], original_item), "HISTORY_HEAD_CHANGED")
        need(isinstance(item.get("sources"), list) and isinstance(report.get("sources"), list)
             and len(item["sources"]) == len(report["sources"]) <= 256, "COMPLETE_SOURCES_REQUIRED")
        self.sources = {}
        for index, entry in enumerate(report["sources"]):
            lex_entry = lexical["sources"][index]
            descriptor = entry.get("descriptor") if isinstance(entry, dict) else None
            need(isinstance(descriptor, dict) and _same(lex_entry["descriptor"], original_item["sources"][index]), "SOURCE_DESCRIPTOR_CHANGED")
            source_id = uuid(descriptor.get("id"))
            need(source_id not in self.sources and descriptor.get("role") in {"BASELINE", "OBSERVED"}, "SOURCE_ID_OR_ROLE_INVALID")
            integer(descriptor.get("contractRevision"), 1)
            filename(descriptor.get("filename"))
            original = entry.get("original")
            need(isinstance(original, dict) and original.get("schema") == "stellar-forge.timescale-commissioning-source.v1"
                 and original.get("filename") == descriptor["filename"] and isinstance(original.get("content"), str), "ORIGINAL_SOURCE_REQUIRED")
            content = original["content"].encode("utf-8")
            need(len(content) == descriptor.get("bytes") and digest(content) == descriptor.get("sha256"), "ORIGINAL_SOURCE_CHANGED")
            _record(lex_entry["descriptor"].get("original"), lex_entry["original"])
            source_document = parse(content[3:] if content.startswith(b"\xef\xbb\xbf") else content)
            table = native_table(source_document, descriptor.get("tableName"))
            need(native_identity({"names": table["names"], "rows": table["rows"]}) == descriptor.get("tableDigest")
                 and table["names"] == descriptor.get("columns") and len(table["rows"]) == descriptor.get("rows"),
                 "NATIVE_TABLE_DIGEST_CHANGED")
            self.sources[source_id] = {"descriptor": deepcopy(descriptor), "content": content, "table": table}
        need(isinstance(item.get("intake"), dict) and isinstance(report.get("intake"), dict), "ORIGINAL_INTAKE_REQUIRED")
        intake = report["intake"]
        need(intake.get("schema") == "stellar-forge.timescale-commissioning-intake.v1"
             and intake.get("filename") == item["intake"].get("filename") and isinstance(intake.get("content"), str),
             "ORIGINAL_INTAKE_CHANGED")
        content = intake["content"].encode("utf-8")
        need(len(content) == item["intake"].get("bytes") and digest(content) == item["intake"].get("sha256"), "ORIGINAL_INTAKE_CHANGED")
        _record(original_item["intake"]["original"], lexical["intake"])
        for kind in ("comparisons", "observations"):
            need(isinstance(item.get(kind), list) and isinstance(report.get(kind), list)
                 and len(item[kind]) == len(report[kind]), "COMPLETE_" + kind.upper() + "_REQUIRED")
            for index, entry in enumerate(report[kind]):
                lex_entry = lexical[kind][index]
                need(_same(lex_entry["descriptor"], original_item[kind][index]), "RELATED_RECORD_CHANGED")
                _record(lex_entry["descriptor"]["original"], lex_entry["result"])
                if kind == "comparisons":
                    need(native_identity(lex_entry["result"]) == entry["descriptor"].get("digest"), "COMPARISON_DIGEST_CHANGED")
                else:
                    need(native_identity(lex_entry["result"]["operation"]) == entry["descriptor"].get("operationDigest"), "OBSERVATION_DIGEST_CHANGED")
                    native = lex_entry.get("nativeRecords", [])
                    operation = lex_entry["result"]["operation"]
                    data = operation.get("data") or {}
                    references = [x for x in [(data.get("result") or {}).get("native"),
                                               (data.get("dispatch") or {}).get("before")] if x is not None]
                    need(len(native) == len(references), "COMPLETE_NATIVE_RECORDS_REQUIRED")
                    for retained, reference in zip(native, references):
                        need(_same(retained["reference"], reference), "NATIVE_RECORD_CHANGED")
                        _record(reference, retained["data"])

    def source(self, source_id):
        uuid(source_id)
        need(source_id in self.sources, "SOURCE_NOT_FOUND")
        return self.sources[source_id]

    def summary(self, name=None):
        report, item = self.document, self.document["project"]["item"]
        return {"report_id": self.sha256, "filename": name, "bytes": len(self.raw), "sha256": self.sha256,
                "commissioning_workspace_id": report["workspaceId"], "commissioning_id": report["commissioningId"],
                "revision": report["revision"], "digest": report["digest"], "title": item["title"],
                "created_at": report["generatedAt"], "source_count": len(self.sources)}

    def descriptors(self):
        return [{**deepcopy(source["descriptor"]), "columns": deepcopy(source["table"]["columns"]),
                 "provider_completeness": source["table"]["provider_completeness"]} for source in self.sources.values()]


def interpretation(value, names):
    fields(value, ("columns", "scope_note", "null_note", "time_note"), ("allow_approximate",))
    need(isinstance(value["columns"], list) and len(value["columns"]) == len(names), "COMPLETE_INTERPRETATION_REQUIRED")
    seen, columns = set(), []
    for item in value["columns"]:
        fields(item, ("source", "role", "meaning"), ("units", "timezone", "precision"))
        source = item["source"]
        need(source in names and source not in seen and item["role"] in _ROLES, "COLUMN_INTERPRETATION_INVALID")
        seen.add(source)
        columns.append({"source": source, "role": item["role"], "meaning": text(item["meaning"], 4000),
                        **{key: text(item.get(key, ""), 1000, True) for key in ("units", "timezone", "precision")}})
    need(any(c["role"] == "tag" for c in columns) and any(c["role"] == "value" for c in columns)
         and sum(c["role"] == "time" for c in columns) <= 1, "TAG_VALUE_AND_SINGLE_TIME_REQUIRED")
    approximate = value.get("allow_approximate", False)
    need(type(approximate) is bool, "APPROXIMATE_FLAG_INVALID")
    return {"columns": columns, "allow_approximate": approximate,
            **{key: text(value[key], 8000) for key in ("scope_note", "null_note", "time_note")}}


def no_dataset_semantics(native, manifest):
    """Own-format dispatch; never widen the original SF100 semantic validator."""
    need(isinstance(native, dict) and native.get("schema") == NATIVE
         and native.get("sourceFormat") == "TIMESCALE_COMMISSIONING"
         and isinstance(manifest, dict) and manifest.get("schema") == MANIFEST,
         "SOURCE_FORMAT_CHANGED")
    for value in (manifest, native, native.get("nativeStatus") or {}):
        need(value.get("semantics") is None, "UNEXPECTED_DATASET_SEMANTICS")
    need((manifest.get("outputs") or {}).get("semantics.json") is None
         and (native.get("outputs") or {}).get("semantics.json") is None, "UNEXPECTED_DATASET_SEMANTICS")
    binding = manifest.get("source_binding_sha256")
    need(hash_id(binding) == native.get("sourceBindingSha256")
         and manifest.get("dataset", {}).get("sourceFormat") == "TIMESCALE_COMMISSIONING", "SOURCE_BINDING_CHANGED")
    return None


class _MemoryFile:
    def __init__(self, raw):
        self.raw = raw

    @contextmanager
    def open(self):
        stream = io.BytesIO(self.raw)
        try:
            yield stream
        finally:
            stream.close()

    def read_bytes(self, *, limit):
        need(len(self.raw) <= limit, "FILE_LIMIT")
        return self.raw


class TimescaleDelivery:
    """The original importer's file/row interface over a distinct native source."""
    def __init__(self, report, source_id, interpretation_value, descriptor_raw, descriptor_path, report_filename, guide):
        self.report = report
        source = report.source(source_id)
        self.selected, self.names = source, source["table"]["names"]
        reviewed = interpretation(interpretation_value, self.names)
        self.interpretation = reviewed
        self.input_raw = descriptor_raw
        self.input_descriptor = parse(descriptor_raw)
        original = source["descriptor"]
        self.context = {**report.summary(filename(report_filename)), "source_id": source_id, "role": original["role"],
                        "contract_revision": original["contractRevision"], "native_filename": original["filename"],
                        "native_bytes": original["bytes"], "native_sha256": original["sha256"],
                        "table_name": original.get("tableName"), "table_digest": original["tableDigest"],
                        "native_columns": source["table"]["columns"],
                        "provider_completeness": source["table"]["provider_completeness"], "interpretation": reviewed,
                        "row_reference": "sf_row is the one-based original row position in this selected native table."}
        binding = digest(json.dumps(self.context, ensure_ascii=False, allow_nan=False,
                                    sort_keys=True, separators=(",", ":")).encode())
        self._files = {"original-commissioning.json": report.raw, "original-source.json": source["content"]}
        need(isinstance(guide, bytes) and 0 < len(guide) <= 2 * 1024 * 1024, "OPERATING_GUIDE_REQUIRED")
        self._files["TIMESCALE_INTAKE.md"] = guide
        outputs = {name: {"bytes": len(raw), "sha256": digest(raw)} for name, raw in self._files.items()}
        manifest = {"schema": MANIFEST, "source_binding_sha256": binding,
                    "dataset": {"id": report.document["commissioningId"] + ":" + source_id,
                                "snapshot": original["tableDigest"], "rows": len(source["table"]["rows"]),
                                "projectedFields": self.names, "sourceFormat": "TIMESCALE_COMMISSIONING",
                                "timescale": self.context},
                    "outputs": outputs, "meaning": "Complete selected original native table; provider-wide completeness is not inferred. No payment or SF88/SF100 delivery is asserted."}
        manifest_raw = (json.dumps(manifest, ensure_ascii=False, allow_nan=False,
                                   sort_keys=True, separators=(",", ":")) + "\n").encode()
        need(len(manifest_raw) <= MAX_MANIFEST, "MANIFEST_LIMIT")
        self._files["manifest.json"] = manifest_raw
        output = {name: {**metadata, "path": str(descriptor_path.parent / name)} for name, metadata in outputs.items()}
        output["manifest.json"] = {"bytes": len(manifest_raw), "sha256": digest(manifest_raw),
                                   "path": str(descriptor_path.parent / "manifest.json")}
        self.native = {"schema": NATIVE, "sourceFormat": "TIMESCALE_COMMISSIONING",
                       "directory": str(descriptor_path.parent), "sourceBindingSha256": binding,
                       "reportSha256": report.sha256, "sourceId": source_id, "outputs": output, "archives": {},
                       "nativeStatus": {"complete": True, "rows": len(source["table"]["rows"]),
                                        "providerCompleteness": source["table"]["provider_completeness"]}}
        self.manifest_raw = manifest_raw
        self.source = {"report_path": str(descriptor_path), "native": self.native, "manifest": manifest,
                       "fields": self.names, "row_count": len(source["table"]["rows"]),
                       "manifest_sha256": digest(manifest_raw), "source_binding_sha256": binding,
                       "input_report_sha256": digest(descriptor_raw)}

    def file_names(self):
        return tuple(self._files)

    def file(self, name):
        need(name in self._files, "SOURCE_FILE_NOT_FOUND")
        return _MemoryFile(self._files[name])

    def iter_rows(self):
        for row in self.selected["table"]["rows"]:
            yield dict(zip(self.names, row))

    def convert(self, value, column):
        from ..duckdb_dataset import _convert
        kind = column["type"]
        if value is None or kind == "VARCHAR":
            return _convert(value, column)
        need(isinstance(value, str), "ORIGINAL_NATIVE_TEXT_CHANGED")
        if kind == "BOOLEAN":
            need(value in {"t", "f", "true", "false"}, "NATIVE_BOOLEAN_INVALID")
            value = value in {"t", "true"}
        elif kind == "JSON":
            try:
                value = json.loads(value, object_pairs_hook=unique_object, parse_float=Decimal,
                                   parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
            except (ValueError, UnicodeError):
                fail("NATIVE_JSON_INVALID")
        elif kind == "DOUBLE":
            need(self.interpretation["allow_approximate"], "EXPLICIT_APPROXIMATE_MAPPING_REQUIRED")
        elif kind in {"TIMESTAMP", "TIMESTAMPTZ"}:
            fraction = re.search(r"[T ]\d{2}:\d{2}:\d{2}\.([0-9]+)", value)
            need(fraction is None or len(fraction[1]) <= 6 or not fraction[1][6:].strip("0"),
                 "SUBMICROSECOND_PRECISION_LOSS")
        return _convert(value, column)


def _from_descriptor(value, raw, path, workspace, db=None):
    fields(value, ("schema", "workspace_id", "report_id", "report_filename", "source_id", "interpretation"))
    need(value["schema"] == DESCRIPTOR, "SOURCE_FORMAT_CHANGED")
    from .model import report_bytes, report_guide_bytes
    original, record = report_bytes(workspace, hash_id(value["report_id"]), db=db,
                                     expected_workspace_id=request_id(value["workspace_id"]))
    need(record["filename"] == value["report_filename"], "ORIGINAL_FILENAME_CHANGED")
    report = CommissioningReport(original, value["report_id"])
    guide = report_guide_bytes(workspace, value["report_id"], db=db)
    delivery = TimescaleDelivery(report, uuid(value["source_id"]), value["interpretation"], raw, Path(path), value["report_filename"], guide)
    return delivery, delivery.manifest_raw, delivery.source


def open_delivery(report_path, raw, workspace, db=None):
    value = parse(raw)
    if not isinstance(value, dict) or value.get("schema") != DESCRIPTOR:
        return None
    return _from_descriptor(value, raw, report_path, workspace, db)


def open_review_delivery(review, workspace, db):
    """Reopen the original reviewed descriptor from its immutable native record."""
    context = review.get("timescale_source")
    need(isinstance(context, dict) and isinstance(context.get("descriptor"), dict), "REVIEW_SOURCE_REQUIRED")
    value = context["descriptor"]
    raw = (json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":")) + "\n").encode()
    return _from_descriptor(value, raw, review["report_path"], workspace, db)


def delivery_fields(delivery, manifest):
    no_dataset_semantics(delivery.native, manifest)
    return {"timescale_source": {**deepcopy(delivery.context), "descriptor": deepcopy(delivery.input_descriptor)}}
