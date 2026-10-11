"""Map retained native responses into the original customer DatasetDatabase.

No request, signer, acquisition, settlement or native result-store mutation is
performed. A projection is an explicitly selected analytical representation,
with its own manifest; it is never presented as an SF100 delivery.
"""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
import csv
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import time
from urllib.parse import urlsplit, urlunsplit

from .errors import StateError
from .result import FileDelivery
from .sqlite_dataset import _identifier, _scalar, _ORDINAL
from .storage import digest, parse, private_directory, read
from .streams import StreamDelivery, _manifest, read_retained_response

SCHEMA = "stellar-forge.response-table-manifest.v1"
_SOURCE = "stellar-forge.analysis-response-source.v1"
_HASH = re.compile(r"[a-f0-9]{64}")
_MISSING = object()
_MAX_JSON = 32 * 1024 * 1024
_MAX_SOURCE = 256 * 1024 * 1024
_MAX_PROJECTED = 128 * 1024 * 1024
_MAX_ROWS = 1_000_000

# The native MCP store owns quote/invocation binding. Its read-only file()
# method reuses the original SF88 VerifiedFile; no quote database is opened.
_MCP_READER = r"""
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const [checkout,path,expected] = process.argv.slice(1);
const {McpResultStore,readPrivateResultSource} = await import(pathToFileURL(resolve(checkout,'stellar-forge/mcp-paid-agent/result-store.mjs')));
const raw = await readPrivateResultSource(path,{maxBytes:524288});
if(createHash('sha256').update(raw).digest('hex')!==expected) throw Error('ANALYSIS_RESPONSE_SOURCE_CHANGED');
const manifest=JSON.parse(raw);
if(manifest.schema!=='stellar-forge.mcp-result.v1') throw Error('ANALYSIS_MCP_MANIFEST_INVALID');
const store=new McpResultStore({directory:resolve(path,'..'),readOnly:true});
try {
 const file=store.file(manifest.quote);
 await file.verify();
 process.stdout.write(JSON.stringify({saved:file.metadata}));
} finally {await store.close();}
"""


def _json(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":"))


def _now():
    return datetime.now(timezone.utc).isoformat()


def _pointer(value):
    if not isinstance(value, str) or len(value.encode()) > 4096 or (value and not value.startswith("/")):
        raise StateError("RESPONSE_JSON_POINTER_REQUIRED")
    if re.search(r"~(?![01])", value):
        raise StateError("RESPONSE_JSON_POINTER_ESCAPE_INVALID")
    return [] if not value else [part.replace("~1", "/").replace("~0", "~") for part in value[1:].split("/")]


def _at(value, pointer):
    for key in _pointer(pointer):
        if isinstance(value, dict):
            if key not in value:
                return _MISSING
            value = value[key]
        elif isinstance(value, list) and re.fullmatch(r"0|[1-9][0-9]*", key) and int(key) < len(value):
            value = value[int(key)]
        else:
            return _MISSING
    return value


def _escape(value):
    return value.replace("~", "~0").replace("/", "~1")


def _stamp(path):
    info = Path(path).stat(follow_symlinks=False)
    if not stat.S_ISREG(info.st_mode):
        raise StateError("ANALYSIS_RESPONSE_REGULAR_FILE_REQUIRED")
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def _endpoint(value):
    if not isinstance(value, str):
        return None
    url = urlsplit(value)
    if url.scheme not in {"http", "https"} or not url.hostname:
        return None
    host = url.hostname
    if ":" in host:
        host = "[" + host + "]"
    return urlunsplit((url.scheme, host + (":" + str(url.port) if url.port else ""), url.path, "", ""))


def _input(path, role, limit):
    path = Path(path).expanduser().absolute()
    raw = read(path, limit)
    return {"role": role, "path": str(path), "bytes": len(raw), "sha256": digest(raw)}, raw


def _file(saved, destination, maximum):
    if saved.get("status") != "SAVED":
        raise StateError("RESPONSE_COMPLETE_SAVED_FILE_REQUIRED_USE_ORIGINAL_STREAM_EXPORT_FOR_PARTIAL")
    if type(maximum) is not int or not 1 <= maximum <= 1_073_741_824:
        raise StateError("RESPONSE_SOURCE_BYTE_LIMIT_INVALID")
    if type(saved.get("bytes")) is not int or not 0 <= saved["bytes"] <= _MAX_SOURCE:
        raise StateError("RESPONSE_SOURCE_TOO_LARGE")
    return FileDelivery({"native": {"file": saved}}, Path(destination), maximum)


def _read_source(input_kind, paths, format, checkout, node, cache_dir):
    inputs = []
    def take(role, limit=2 * 1024 * 1024):
        item, raw = _input(paths[role], role, limit)
        inputs.append(item)
        return parse(raw), raw

    if input_kind == "stream":
        directory = private_directory(Path(paths["stream"]), create=False)
        manifest, manifest_raw = take("manifest", 1_048_576)
        payload, payload_raw = take("request", 2 * 1024 * 1024)
        delivery = _manifest(directory, digest(payload_raw))
        record = payload.get("record") or {}
        native = record.get("native") or {}
        saved = native.get("responseFile") or {}
        original_source = {
            "intentId": record.get("intentId") or native.get("intentId"),
            "configurationSha256": record.get("configSha256"),
            "status": saved.get("status"), "path": saved.get("path") or saved.get("partialPath"),
            "bytes": saved.get("bytes"), "sha256": saved.get("sha256") or saved.get("partialSha256"),
            "contentType": saved.get("contentType"), "stream": saved.get("stream"),
        }
        if (manifest != delivery.manifest or payload.get("schema") != "stellar-forge.python-stream-request.v1"
                or payload.get("format") != delivery.format
                or payload.get("options") != manifest.get("options")
                or payload.get("maxExportBytes") != manifest.get("maxExportBytes")
                or original_source != manifest.get("source")
                or delivery.complete != (saved.get("status") == "SAVED")
                or type((saved.get("stream") or {}).get("records")) is not int
                or delivery.count != saved["stream"]["records"]):
            raise StateError("RESPONSE_ORIGINAL_STREAM_BINDING_INVALID")
        format = delivery.format
        file = delivery.file
        context = {"nativeKind": record.get("retainedSourceKind") or "SF88_BUYER_RESPONSE",
                   "intentId": original_source["intentId"], "configurationSha256": original_source["configurationSha256"],
                   "nativeStatus": native.get("status"), "responseFileStatus": saved.get("status"),
                   "paymentStatus": native.get("paymentStatus"), "transportComplete": delivery.complete,
                   "stream": saved.get("stream"), "streamRequestSha256": manifest["requestSha256"],
                   "sourceBytes": saved.get("bytes"), "sourceSha256": original_source["sha256"],
                   "responseError": saved.get("error")}
        return file, delivery, format, inputs, context

    if input_kind == "buyer":
        config, config_raw = take("config", 65536)
        result_record, result_raw = take("result")
        if checkout is None:
            raise StateError("ANALYSIS_ORIGINAL_RUNTIME_CHECKOUT_REQUIRED")
        result = read_retained_response(checkout=checkout, config_file=paths["config"], result_file=paths["result"],
                                        cache_dir=cache_dir, node=node)
        native, saved = result.native, result.delivery
        file = result
        context = {"nativeKind": "SF88_BUYER_RESPONSE", "intentId": result.record.get("intentId") or native.get("intentId"),
                   "configurationSha256": digest(config_raw), "nativeStatus": native.get("status"),
                   "paymentStatus": native.get("paymentStatus"), "responseFileStatus": saved.get("status"),
                   "transportComplete": saved.get("status") == "SAVED",
                   "httpStatus": native.get("httpStatus"), "responseError": saved.get("error"),
                   "endpoint": _endpoint(config.get("request", {}).get("url"))}
    elif input_kind == "sf31":
        config, config_raw = take("config", 65536)
        saved, saved_raw = take("result")
        if not isinstance(config, dict) or not isinstance(saved, dict) or "destination" not in config:
            raise StateError("RESPONSE_SF31_WRITER_CONFIG_AND_RECEIPT_REQUIRED")
        file = _file(saved, config["destination"], config.get("maxBytes"))
        context = {"nativeKind": "SF31_RESPONSE_FILE", "responseFileStatus": saved.get("status"),
                   "transportComplete": saved.get("status") == "SAVED", "paymentStatus": None,
                   "responseError": saved.get("error")}
    elif input_kind == "mcp":
        manifest, manifest_raw = take("manifest", 524288)
        if checkout is None:
            raise StateError("ANALYSIS_ORIGINAL_RUNTIME_CHECKOUT_REQUIRED")
        try:
            process = subprocess.run([node, "--input-type=module", "-e", _MCP_READER, str(checkout),
                                      str(Path(paths["manifest"]).expanduser().absolute()), digest(manifest_raw)],
                                     capture_output=True, timeout=30, check=False)
        except (OSError, subprocess.TimeoutExpired):
            raise StateError("RESPONSE_NATIVE_MCP_READER_UNAVAILABLE") from None
        if process.returncode or len(process.stdout) > 1_048_576:
            raise StateError("RESPONSE_NATIVE_MCP_FILE_NOT_VERIFIED")
        saved = parse(process.stdout)["saved"]
        quote = manifest["quote"]
        if saved != quote.get("result", {}).get("responseFile"):
            raise StateError("RESPONSE_NATIVE_MCP_FILE_CHANGED")
        file = _file(saved, saved["destination"], saved["maxBytes"])
        context = {"nativeKind": "SF32_MCP_RESULT", "quoteId": quote["quoteId"],
                   "invocationSha256": saved["invocationSha256"], "nativeStatus": quote["status"],
                   "paymentStatus": quote["status"], "paidAttempted": quote["result"].get("paidAttempted"),
                   "paymentResponse": quote["result"].get("paymentResponse"),
                   "responseFileStatus": saved["status"], "transportComplete": saved["status"] == "SAVED",
                   "nativePreviewTruncated": quote["result"].get("content", {}).get("truncated"),
                   "toolName": quote["invocation"]["toolName"],
                   "endpoint": _endpoint(quote["invocation"]["endpoint"])}
        format = "json"
    else:
        raise StateError("RESPONSE_ORIGINAL_INPUT_KIND_INVALID")
    if format not in {"json", "csv"}:
        raise StateError("RESPONSE_SELECT_JSON_OR_CSV")
    saved = file.delivery
    context.update(sourceBytes=saved.get("bytes"), sourceSha256=saved.get("sha256"),
                   contentType=saved.get("contentType"))
    return file, None, format, inputs, context


@dataclass
class ResponseSource:
    file: object
    stream: StreamDelivery | None
    format: str
    inputs: list
    context: dict

    @property
    def identity(self):
        return {"schema": _SOURCE, "format": self.format,
                "inputFiles": [{k: v for k, v in item.items() if k != "path"} for item in self.inputs],
                "retainedFile": {key: self.file.delivery.get(key) for key in ("bytes", "sha256", "contentType")},
                "original": self.context}

    @property
    def sha256(self):
        return digest(_json(self.identity).encode())

    def check_inputs(self):
        for item in self.inputs:
            raw = read(Path(item["path"]), item["bytes"])
            if len(raw) != item["bytes"] or digest(raw) != item["sha256"]:
                raise StateError("ANALYSIS_RESPONSE_SOURCE_CHANGED")

    @contextmanager
    def records(self, mapping, *, declarations=None):
        self.check_inputs()
        stamp = _stamp(self.file.delivery["path"])
        try:
            if self.format == "json":
                raw = self.file.read_bytes(limit=_MAX_JSON)
                document = parse(raw)
                value = _at(document, mapping["collection"])
                if value is _MISSING or not isinstance(value, (list, dict)):
                    raise StateError("RESPONSE_RECORD_COLLECTION_NOT_FOUND")
                if declarations is not None:
                    for pointer in [""] + ["/" + "/".join(mapping["collection"].split("/")[1:i])
                                            for i in range(2, len(mapping["collection"].split("/")))]:
                        parent = _at(document, pointer)
                        if isinstance(parent, dict):
                            kept = {key: parent[key] for key in ("schema", "query", "rowCount", "truncated", "encodings")
                                    if key in parent and not isinstance(parent[key], list)}
                            if kept:
                                declarations.append({"pointer": pointer, **kept})
                yield iter(value if isinstance(value, list) else [value])
            elif self.format == "csv":
                csv.field_size_limit(2_097_152)
                with self.file.open() as binary:
                    text = io.TextIOWrapper(binary, encoding="utf-8-sig", errors="strict", newline="")
                    try:
                        reader = csv.reader(text, strict=True)
                        header = next(reader, None)
                        if not header or len(header) > 1024 or len(set(header)) != len(header):
                            raise StateError("RESPONSE_CSV_UNIQUE_HEADER_REQUIRED")
                        def rows():
                            for number, row in enumerate(reader, 1):
                                if len(row) != len(header):
                                    raise StateError("RESPONSE_CSV_COLUMN_COUNT_ROW_" + str(number))
                                yield dict(zip(header, row))
                        yield rows()
                    finally:
                        text.detach()
            else:
                def rows():
                    for record in self.stream.records():
                        if self.format == "ndjson":
                            yield record.value
                        else:
                            yield {"index": record.index, "event": record.event, "id": record.id, "retry": record.retry,
                                   "data": record.json() if mapping["sse_data"] == "json" else record.data}
                yield rows()
            self.check_inputs()
            if _stamp(self.file.delivery["path"]) != stamp:
                raise StateError("ANALYSIS_RESPONSE_BYTES_CHANGED_DURING_READ")
        except (csv.Error, UnicodeError):
            raise StateError("RESPONSE_TEXT_OR_CSV_INVALID") from None

    def describe(self, *, collection=None, sse_data="text"):
        options = []
        if self.format == "json":
            document = parse(self.file.read_bytes(limit=_MAX_JSON))
            def visit(value, pointer, depth):
                if len(options) >= 24:
                    return
                if isinstance(value, list):
                    options.append({"pointer": pointer, "kind": "array", "records": len(value)})
                elif isinstance(value, dict):
                    if not pointer:
                        options.append({"pointer": "", "kind": "single object", "records": 1})
                    if depth < 4:
                        for key, child in value.items():
                            if isinstance(child, (dict, list)):
                                visit(child, pointer + "/" + _escape(key), depth + 1)
            visit(document, "", 0)
        default = {"collection": next((item["pointer"] for item in options if item["pointer"].endswith("/rows")),
                                      options[1]["pointer"] if len(options) > 1 else ""),
                   "sse_data": sse_data, "columns": []}
        if collection is not None:
            _pointer(collection)
            default["collection"] = collection
        if sse_data not in {"json", "text"}:
            raise StateError("RESPONSE_SSE_DATA_MODE_INVALID")
        # Discovery is a sample only. The explicit projection walks every row.
        samples = []
        with self.records(default) as rows:
            for value in rows:
                samples.append(value)
                if len(samples) == 3:
                    break
        hints = []
        def fields(value, pointer="", depth=0):
            if len(hints) >= 100:
                return
            if isinstance(value, dict) and depth < 4:
                for key, child in value.items():
                    fields(child, pointer + "/" + _escape(key), depth + 1)
            elif pointer not in {item["pointer"] for item in hints}:
                hints.append({"pointer": pointer, "name": pointer.rsplit("/", 1)[-1].replace("~1", "_").replace("~0", "_") or "value",
                              "type": "json" if isinstance(value, (dict, list)) else "native"})
        for sample in samples:
            fields(sample)
        # All preview data is bounded; JSON text remains escaped by the client.
        encoded = _json(samples)
        return {"identity": self.identity, "source_sha256": self.sha256, "collections": options,
                "default_collection": default["collection"], "field_hints": hints,
                "sample_text": encoded[:24000], "sample_clipped": len(encoded) > 24000,
                "sample_only": True}


def open_source(source, *, checkout=None, node="node", cache_dir=None):
    file, stream, format, inputs, context = _read_source(source["input_kind"], source["paths"],
        source.get("format"), checkout, node, cache_dir)
    result = ResponseSource(file, stream, format, inputs, context)
    if source.get("source_sha256") and result.sha256 != source["source_sha256"]:
        raise StateError("ANALYSIS_REGISTERED_RESPONSE_CHANGED")
    return result


def mapping_spec(value):
    if not isinstance(value, dict):
        raise StateError("RESPONSE_MAPPING_REQUIRED")
    collection, sse_data = value.get("collection", ""), value.get("sse_data", "text")
    _pointer(collection)
    if sse_data not in {"text", "json"}:
        raise StateError("RESPONSE_SSE_DATA_MODE_INVALID")
    columns = value.get("columns")
    if not isinstance(columns, list) or not 1 <= len(columns) <= 256:
        raise StateError("RESPONSE_SELECT_1_TO_256_COLUMNS")
    result, names = [], set()
    for column in columns:
        if not isinstance(column, dict):
            raise StateError("RESPONSE_COLUMN_MAPPING_INVALID")
        name, pointer = column.get("name"), column.get("pointer")
        _identifier(name)
        _pointer(pointer)
        if name.lower() in names or name.lower() == _ORDINAL:
            raise StateError("RESPONSE_COLUMN_NAME_COLLISION")
        names.add(name.lower())
        kind, missing = column.get("type", "native"), column.get("missing", "error")
        if kind not in {"native", "text", "integer", "number", "boolean", "json"} or missing not in {"error", "null"}:
            raise StateError("RESPONSE_COLUMN_TYPE_OR_MISSING_POLICY_INVALID")
        result.append({"name": name, "pointer": pointer, "type": kind, "missing": missing})
    return {"collection": collection, "sse_data": sse_data, "columns": result}


def _convert(value, column):
    if value is None:
        return None
    kind = column["type"]
    if kind == "json":
        return _json(value)
    if kind == "native":
        _scalar(value)
        return value
    if kind == "text":
        if isinstance(value, (dict, list)):
            raise StateError("RESPONSE_NESTED_VALUE_SELECT_JSON_TYPE")
        return value if isinstance(value, str) else _json(value)
    if kind == "boolean":
        if type(value) is bool:
            return value
        if value in ("true", "false"):
            return value == "true"
        raise StateError("RESPONSE_BOOLEAN_REQUIRES_TRUE_OR_FALSE")
    if kind == "integer":
        if type(value) is int:
            _scalar(value)
            return value
        if isinstance(value, str) and re.fullmatch(r"0|-?[1-9][0-9]*", value):
            value = int(value)
            _scalar(value)
            return value
        raise StateError("RESPONSE_INTEGER_REQUIRES_CANONICAL_INT64")
    if type(value) not in (int, float) and not (isinstance(value, str) and re.fullmatch(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?", value)):
        raise StateError("RESPONSE_NUMBER_INVALID")
    value = float(value)
    if not math.isfinite(value):
        raise StateError("RESPONSE_NUMBER_NOT_FINITE")
    return value


@dataclass
class ResponseProjection:
    path: Path
    manifest: dict
    sample: list
    sample_clipped: bool

    @property
    def manifest_bytes(self):
        return _json(self.manifest).encode()

    @property
    def preview_sha256(self):
        return digest(self.manifest_bytes)

    def preview(self):
        return {"schema": SCHEMA, "preview_sha256": self.preview_sha256, "manifest": self.manifest,
                "sample": self.sample, "sample_clipped": self.sample_clipped, "sample_only": True}


@contextmanager
def project(source, mapping, directory, *, name):
    """Exhaust the retained records before publishing any mapped version."""
    mapping = mapping_spec(mapping)
    fields = [column["name"] for column in mapping["columns"]]
    deadline, count, size = time.monotonic() + 120, 0, 0
    checksum, sample, sample_bytes = hashlib.sha256(), [], 0
    missing = {field: 0 for field in fields}
    declarations = []
    fd, path = tempfile.mkstemp(prefix=".response-projection-", dir=directory)
    path = Path(path)
    try:
        with os.fdopen(fd, "wb") as output, source.records(mapping, declarations=declarations) as rows:
            for row in rows:
                count += 1
                if count > _MAX_ROWS or time.monotonic() >= deadline:
                    raise StateError("RESPONSE_PROJECTION_ROW_OR_TIME_LIMIT")
                mapped = {}
                for column in mapping["columns"]:
                    value = _at(row, column["pointer"])
                    if value is _MISSING:
                        if column["missing"] != "null":
                            raise StateError("RESPONSE_MISSING_FIELD_ROW_" + str(count) + "_COLUMN_" + column["name"])
                        missing[column["name"]] += 1
                        value = None
                    try:
                        mapped[column["name"]] = _convert(value, column)
                    except (ValueError, OverflowError, StateError) as exc:
                        raise StateError("RESPONSE_VALUE_ROW_" + str(count) + "_COLUMN_" + column["name"] + "_" +
                                         str(getattr(exc, "code", type(exc).__name__))) from None
                raw = (_json(mapped) + "\n").encode()
                if len(raw) > 2_097_152:
                    raise StateError("RESPONSE_PROJECTED_ROW_TOO_LARGE")
                size += len(raw)
                if size > _MAX_PROJECTED:
                    raise StateError("RESPONSE_PROJECTED_BYTES_LIMIT")
                output.write(raw)
                checksum.update(raw)
                if count <= 25 and sample_bytes + len(raw) <= 256 * 1024:
                    sample.append(mapped)
                    sample_bytes += len(raw)
            output.flush()
            os.fsync(output.fileno())
        declared_truncated = any(item.get("truncated") is True for item in declarations)
        incomplete = source.context.get("transportComplete") is not True or declared_truncated
        manifest = {"schema": SCHEMA, "sourceBindingSha256": source.sha256,
            "source": source.identity, "name": name, "mapping": mapping,
            "completion": {"allRetainedRecordsMapped": True, "transportComplete": source.context.get("transportComplete"),
                           "providerDeclaredTruncated": declared_truncated,
                           "providerDeclarations": declarations, "requiresIncompleteAcknowledgement": incomplete},
            "rows": count, "projectedFields": fields, "missingAsNull": missing,
            "outputs": {"mapped.jsonl": {"bytes": size, "sha256": checksum.hexdigest()}}}
        yield ResponseProjection(path, manifest, sample, len(sample) < min(count, 25))
    finally:
        path.unlink(missing_ok=True)


class AnalysisResponses:
    """Source registration and complete preview/import jobs in the native DB."""

    def __init__(self, database, *, checkout, node, encode_cell):
        self.database, self.checkout, self.node, self.encode_cell = database, checkout, node, encode_cell
        with database._connection() as db:
            db.execute("CREATE TABLE IF NOT EXISTS sf_analysis_response_sources(name TEXT NOT NULL,revision INTEGER NOT NULL,record TEXT NOT NULL,PRIMARY KEY(name,revision))")
        # Only this workspace's interrupted projection files are temporary.
        for path in database.directory.glob(".response-projection-*"):
            if path.is_file() and not path.is_symlink():
                path.unlink()

    def _open(self, source):
        return open_source(source, checkout=self.checkout, node=self.node, cache_dir=self.database.directory / "response-cache")

    def register(self, name, input_kind, *, config=None, result=None, stream=None, manifest=None,
                 format="json", expected_revision=0):
        if not isinstance(name, str) or not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_-]{0,63}", name):
            raise StateError("ANALYSIS_NAME_INVALID")
        if type(expected_revision) is not int or expected_revision < 0:
            raise StateError("ANALYSIS_SOURCE_REVISION_REQUIRED")
        if input_kind == "stream":
            directory = private_directory(Path(stream), create=False)
            paths = {"stream": str(directory), "manifest": str(directory / "manifest.json"), "request": str(directory / "source.json")}
        elif input_kind == "mcp":
            if not manifest:
                raise StateError("RESPONSE_MCP_MANIFEST_REQUIRED")
            paths = {"manifest": str(Path(manifest).expanduser().absolute())}
        else:
            if input_kind not in {"buyer", "sf31"} or not config or not result:
                raise StateError("RESPONSE_NATIVE_CONFIG_AND_RESULT_REQUIRED")
            paths = {"config": str(Path(config).expanduser().absolute()), "result": str(Path(result).expanduser().absolute())}
        source = {"schema": _SOURCE, "kind": "response", "name": name, "input_kind": input_kind,
                  "format": format, "paths": paths}
        opened = self._open(source)
        # The original same-descriptor reader verifies the retained file now.
        with opened.file.open():
            pass
        opened.check_inputs()
        source.update(format=opened.format, source_sha256=opened.sha256, identity=opened.identity,
                      native_status=opened.context.get("nativeStatus") or opened.context.get("responseFileStatus"),
                      registered_at=_now())
        with self.database._connection() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT revision,record FROM sf_analysis_sources WHERE name=?", (name,)).fetchone()
            if row:
                old = parse(row["record"].encode())
                if old.get("kind") == "response" and all(old.get(k) == source.get(k) for k in ("paths", "source_sha256", "input_kind", "format")):
                    db.commit()
                    return old
            revision = row["revision"] if row else 0
            if revision != expected_revision:
                raise StateError("ANALYSIS_SOURCE_CHANGED")
            source["revision"] = revision + 1
            raw = _json(source)
            db.execute("INSERT INTO sf_analysis_response_sources VALUES(?,?,?)", (name, revision + 1, raw))
            db.execute("INSERT INTO sf_analysis_sources VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET revision=excluded.revision,record=excluded.record", (name, revision + 1, raw))
            db.commit()
        return source

    def _source(self, db, name, revision, *, current=False):
        row = db.execute("SELECT record FROM sf_analysis_response_sources WHERE name=? AND revision=?", (name, revision)).fetchone()
        if row is None:
            raise StateError("ANALYSIS_RESPONSE_SOURCE_NOT_FOUND")
        source = parse(row[0].encode())
        if current:
            row = db.execute("SELECT revision FROM sf_analysis_sources WHERE name=?", (name,)).fetchone()
            if row is None or row[0] != revision:
                raise StateError("ANALYSIS_SOURCE_CHANGED")
        return source

    def describe(self, name, revision, *, collection=None, sse_data="text"):
        with self.database._connection(readonly=True) as db:
            source = self._source(db, name, revision, current=True)
        return {**self._open(source).describe(collection=collection, sse_data=sse_data), "name": source["name"], "source_revision": source["revision"]}

    def prepare(self, kind, request):
        if kind == "response-preview":
            if not isinstance(request.get("source"), str) or type(request.get("source_revision")) is not int:
                raise StateError("ANALYSIS_REVIEWED_RESPONSE_SOURCE_REQUIRED")
            return {"source": request["source"], "source_revision": request["source_revision"],
                    "mapping": mapping_spec(request.get("mapping"))}
        if (not isinstance(request.get("preview_id"), str) or not re.fullmatch(r"[a-f0-9]{32}", request["preview_id"])
                or not isinstance(request.get("preview_sha256"), str) or not _HASH.fullmatch(request["preview_sha256"])
                or type(request.get("allow_incomplete", False)) is not bool):
            raise StateError("ANALYSIS_REVIEWED_RESPONSE_PREVIEW_REQUIRED")
        return {"preview_id": request["preview_id"], "preview_sha256": request["preview_sha256"],
                "allow_incomplete": request.get("allow_incomplete", False)}

    def _preview(self, db, spec):
        row = db.execute("SELECT request,result FROM sf_analysis_jobs WHERE id=? AND kind='response-preview' AND status='COMPLETE'",
                         (spec["preview_id"],)).fetchone()
        if row is None:
            raise StateError("ANALYSIS_COMPLETE_RESPONSE_PREVIEW_REQUIRED")
        request, preview = parse(row["request"].encode()), parse(row["result"].encode())
        if (preview.get("preview_sha256") != spec["preview_sha256"]
                or digest(_json(preview["manifest"]).encode()) != spec["preview_sha256"]):
            raise StateError("ANALYSIS_RESPONSE_PREVIEW_CHANGED")
        if preview["manifest"]["completion"]["requiresIncompleteAcknowledgement"] and not spec["allow_incomplete"]:
            raise StateError("ANALYSIS_ACKNOWLEDGE_INCOMPLETE_RESPONSE")
        return request, preview

    def validate(self, db, kind, spec):
        if kind == "response-preview":
            self._source(db, spec["source"], spec["source_revision"], current=True)
        else:
            request, preview = self._preview(db, spec)
            self._source(db, request["source"], request["source_revision"], current=True)

    def execute(self, kind, spec):
        with self.database._connection(readonly=True) as db:
            db.execute("BEGIN")
            if kind == "response-import":
                request, preview = self._preview(db, spec)
            else:
                request, preview = spec, None
            source = self._source(db, request["source"], request["source_revision"])
        opened = self._open(source)
        with project(opened, request["mapping"], self.database.directory, name=source["name"]) as projected:
            if kind == "response-preview":
                result = projected.preview()
                result["sample"] = [[({"type": "boolean", "text": "true" if row[column["name"]] else "false"}
                                     if type(row[column["name"]]) is bool else self.encode_cell(row[column["name"]]))
                                    for column in request["mapping"]["columns"]] for row in projected.sample]
                result.update(source=source["name"], source_revision=source["revision"])
                return result
            if projected.preview_sha256 != spec["preview_sha256"]:
                raise StateError("ANALYSIS_RESPONSE_CHANGED_SINCE_PREVIEW")
            version = self.database.import_response(projected, allow_incomplete=spec["allow_incomplete"])
            return {"version": version, "source": source["name"], "source_revision": source["revision"],
                    "preview_id": spec["preview_id"], "preview_sha256": spec["preview_sha256"],
                    "allow_incomplete": spec["allow_incomplete"]}
