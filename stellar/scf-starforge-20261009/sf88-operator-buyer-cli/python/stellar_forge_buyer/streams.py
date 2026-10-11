"""Typed, reusable records from the original Node retained-response reader."""
from __future__ import annotations

from dataclasses import dataclass
import json
import os
from pathlib import Path
import shutil
import tempfile
from typing import Any, Iterator
from types import SimpleNamespace

from .errors import DeliveryError, StateError
from .storage import digest, lock, parse, private_directory, read, sync_directory, write

SCHEMA = "stellar-forge.python-stream-export.v1"
MAX_EXPORT_BYTES = 256 * 1024 * 1024


@dataclass(frozen=True)
class SSEEvent:
    index: int
    event: str
    data: str
    id: str
    retry: int | None = None

    def json(self) -> Any:
        """Parse application JSON explicitly; ordinary SSE data stays text."""
        return parse(self.data.encode("utf-8"))


@dataclass(frozen=True)
class NDJSONRecord:
    index: int
    value: Any


@dataclass(frozen=True)
class StreamDelivery:
    """The fully validated native record export; original raw bytes stay retained."""
    directory: Path
    manifest: dict

    @property
    def format(self):
        return self.manifest["format"]

    @property
    def complete(self):
        return self.manifest["complete"]

    @property
    def count(self):
        return self.manifest["records"]

    @property
    def source(self):
        return dict(self.manifest["source"])

    @property
    def file(self):
        from .result import FileDelivery
        metadata = {**self.manifest["file"], "path": str(self.directory / "records.jsonl")}
        return FileDelivery({"returncode": 0, "native": {"status": "FILE_SAVED", "file": metadata}},
                            Path(metadata["path"]), self.manifest["maxExportBytes"])

    def records(self, *, start=0) -> Iterator[SSEEvent | NDJSONRecord]:
        """Resume application consumption by original zero-based record index."""
        if type(start) is not int or not 0 <= start <= self.count:
            raise DeliveryError("STREAM_RECORD_INDEX_INVALID")
        # Reuse the existing Python file reader: it hashes the complete file
        # before exposing the same open descriptor, including when resuming.
        with self.file.open() as stream:
            index = 0
            maximum = self.manifest["maxExportBytes"]
            while raw := stream.readline(maximum + 1):
                if len(raw) > maximum or not raw.endswith(b"\n"):
                    raise DeliveryError("STREAM_EXPORT_RECORD_INVALID")
                value = parse(raw)
                if (not isinstance(value, dict) or value.get("format") != self.format
                        or type(value.get("index")) is not int or value["index"] != index):
                    raise DeliveryError("STREAM_EXPORT_RECORD_INVALID")
                if self.format == "sse":
                    if (not all(isinstance(value.get(key), str) for key in ("event", "data", "id"))
                            or ("retry" in value and (type(value["retry"]) is not int or value["retry"] < 0))):
                        raise DeliveryError("STREAM_EXPORT_RECORD_INVALID")
                    record = SSEEvent(index, value["event"], value["data"], value["id"], value.get("retry"))
                else:
                    if "value" not in value:
                        raise DeliveryError("STREAM_EXPORT_RECORD_INVALID")
                    record = NDJSONRecord(index, value["value"])
                if index >= start:
                    yield record
                index += 1
            if index != self.count:
                raise DeliveryError("STREAM_EXPORT_COUNT_CHANGED")

    def events(self, *, start=0) -> Iterator[SSEEvent]:
        if self.format != "sse":
            raise DeliveryError("RESPONSE_STREAM_FORMAT_MISMATCH")
        yield from self.records(start=start)

    def ndjson(self, *, start=0) -> Iterator[Any]:
        if self.format != "ndjson":
            raise DeliveryError("RESPONSE_STREAM_FORMAT_MISMATCH")
        for record in self.records(start=start):
            yield record.value


def _manifest(directory, fingerprint):
    result = parse(read(directory / "manifest.json", 1_048_576))
    if (not isinstance(result, dict) or result.get("schema") != SCHEMA
            or result.get("requestSha256") != fingerprint
            or result.get("format") not in ("sse", "ndjson")
            or type(result.get("complete")) is not bool
            or type(result.get("records")) is not int or result["records"] < 0
            or not isinstance(result.get("source"), dict)
            or not isinstance(result.get("file"), dict)
            or result["file"].get("path") != "records.jsonl"
            or type(result.get("maxExportBytes")) is not int
            or not 1 <= result["maxExportBytes"] <= 1_073_741_824):
        raise DeliveryError("STREAM_EXPORT_MANIFEST_INVALID")
    return StreamDelivery(directory, result)


def export_stream(result, *, format=None, allow_partial=False, max_record_bytes=None,
                  max_records=None, max_export_bytes=MAX_EXPORT_BYTES, cache_dir=None):
    runtime = result._runtime
    configuration = result._response_file
    if runtime is None or not isinstance(configuration, dict):
        raise StateError("ORIGINAL_STREAM_RUNTIME_REQUIRED")
    selected = configuration.get("stream") or result.delivery.get("stream") or {}
    format = selected.get("format") if format is None else format
    if format not in ("sse", "ndjson") or type(allow_partial) is not bool:
        raise DeliveryError("RESPONSE_STREAM_READ_OPTIONS_INVALID")
    if type(max_export_bytes) is not int or not 1 <= max_export_bytes <= 1_073_741_824:
        raise DeliveryError("STREAM_EXPORT_BYTE_LIMIT_INVALID")
    options = {"allowPartial": allow_partial}
    if max_record_bytes is not None:
        options["maxRecordBytes"] = max_record_bytes
    if max_records is not None:
        options["maxRecords"] = max_records
    payload = {"schema": "stellar-forge.python-stream-request.v1", "record": result.record,
               "responseFile": configuration, "format": format, "options": options,
               "maxExportBytes": max_export_bytes}
    raw = (json.dumps(payload, sort_keys=True, ensure_ascii=False, allow_nan=False,
                      separators=(",", ":")) + "\n").encode("utf-8")
    fingerprint = digest(raw)
    if cache_dir is None:
        if result._operation_directory is None:
            raise StateError("STREAM_EXPORT_DIRECTORY_REQUIRED")
        cache_dir = result._operation_directory / "stream-exports"
    root = private_directory(Path(cache_dir))
    destination = root / fingerprint
    with lock(root):
        if destination.exists():
            private_directory(destination, create=False)
            return _manifest(destination, fingerprint)
        temporary = Path(tempfile.mkdtemp(prefix=".stream-", dir=root))
        try:
            request = temporary / "source.json"
            write(request, raw, exclusive=True)
            native = runtime.checked(["export-stream", "--input", request, "--out", temporary],
                                     mode="ORIGINAL_PYTHON_STREAM_EXPORTED", target="consumer")
            saved = _manifest(temporary, fingerprint)
            if native != saved.manifest:
                raise DeliveryError("STREAM_EXPORT_RESULT_CHANGED")
            # Publish a complete directory only after the original reader's
            # framing and both source hash passes have finished successfully.
            os.rename(temporary, destination)
            sync_directory(root)
            return StreamDelivery(destination, saved.manifest)
        finally:
            if temporary.exists():
                shutil.rmtree(temporary)


def read_retained_response(*, checkout, config_file, result_file, cache_dir,
                           node="node", timeout=360):
    """Open an existing SF88 result for local consumption without buyer import.

    Accept the original CLI result or its existing Node/Python application
    envelope. This does not create an operation, approval or payment record.
    """
    from .result import BuyerResult
    from .runtime import Runtime
    config_raw = read(Path(config_file).expanduser().absolute(), 65536)
    result_raw = read(Path(result_file).expanduser().absolute(), 2_097_152)
    config, record = parse(config_raw), parse(result_raw)
    if not isinstance(config, dict) or not isinstance(record, dict):
        raise StateError("ORIGINAL_RETAINED_RESULT_REQUIRED")
    if record.get("mode") == "ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT":
        record = {"native": record}
    native = record.get("native")
    if (not isinstance(native, dict) or native.get("mode") != "ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT"
            or native.get("intentId") != config.get("operation", {}).get("intentId")):
        raise StateError("ORIGINAL_RETAINED_RESULT_REQUIRED")
    # Bind these original files into the export identity without changing them
    # or pretending a raw CLI result recorded a process exit code.
    if record.get("configSha256") is not None and record["configSha256"] != digest(config_raw):
        raise StateError("RESULT_CONFIG_MISMATCH")
    record = {**record, "retainedSourceFiles": {"configSha256": digest(config_raw),
                                              "resultSha256": digest(result_raw)}}
    response = config.get("responseFile")
    if not isinstance(response, dict) or not response.get("destination"):
        raise StateError("ORIGINAL_RESPONSE_FILE_REQUIRED")
    root = private_directory(Path(cache_dir))
    return BuyerResult(record, Path(response["destination"]), response.get("maxBytes", 67_108_864),
                       _runtime=Runtime(checkout, node=node, timeout=timeout),
                       _response_file={"maxBytes": 67_108_864, **response}, _operation_directory=root)


def export_saved_stream(*, checkout, response_file, saved, cache_dir, node="node", timeout=360, **options):
    """Consume an original SF31 writer receipt without creating a buyer attempt.

    ``response_file`` is the actual writer configuration. ``saved`` is its
    retained SAVED/FAILED responseFile view, including original stream metadata.
    The existing Node reader validates the full source hash and framed prefix.
    """
    from .runtime import Runtime
    if not isinstance(response_file, dict) or not isinstance(saved, dict):
        raise StateError("ORIGINAL_RESPONSE_FILE_REQUIRED")
    source = SimpleNamespace(
        record={"retainedSourceKind": "SF31_RESPONSE_FILE", "native": {"responseFile": saved}},
        delivery=saved, _response_file={"maxBytes": 67_108_864, **response_file},
        _runtime=Runtime(checkout, node=node, timeout=timeout),
        _operation_directory=private_directory(Path(cache_dir)),
    )
    return export_stream(source, **options)
