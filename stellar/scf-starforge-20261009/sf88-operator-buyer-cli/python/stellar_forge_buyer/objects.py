"""Complete file applications on the original resumable SF88 object session."""
from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
import os
from pathlib import Path
import re

from .errors import DeliveryError, NativeError, StateError
from .result import FileDelivery
from .runtime import Runtime

MODE = "ORIGINAL_PYTHON_OBJECT"
REPORT_SCHEMA = "stellar-forge.sf88.object-acquisition.v1"


def _path(value) -> Path:
    try:
        raw = os.fspath(value)
        if not isinstance(raw, str) or not raw or "\0" in raw:
            raise ValueError()
        # Normalize spelling without following the final file or a symlink.
        # Original Node custody validates private directories and file types.
        return Path(os.path.abspath(os.path.expanduser(raw)))
    except (TypeError, ValueError, OSError):
        raise StateError("OBJECT_PATH_INVALID") from None


def _integer(value, *, minimum=1, maximum=9_007_199_254_740_991):
    if type(value) is not int or not minimum <= value <= maximum:
        raise StateError("OBJECT_INTEGER_INVALID")
    return value


def _atomic(value):
    if (not isinstance(value, str) or not re.fullmatch(r"[1-9][0-9]{0,38}", value)
            or int(value) > 170141183460469231731687303715884105727):
        raise StateError("OBJECT_ATOMIC_STRING_REQUIRED")
    return value


class ObjectDownloadError(DeliveryError):
    """A concrete native progress report is available for the same session."""

    def __init__(self, code, *, progress, operation=None):
        self.progress = progress
        super().__init__(code, operation=operation)


@dataclass(frozen=True)
class ObjectReport:
    """Original summary and paged native chunk/assembly views, with process status."""

    record: dict
    returncode: int = 0
    runtime_error: str | None = None
    interrupted: bool = False

    @property
    def native(self) -> dict:
        return deepcopy(self.record["report"])

    @property
    def status(self) -> str:
        return self.record["report"]["status"]

    @property
    def session_id(self) -> str:
        return self.record["report"]["sessionId"]

    @property
    def directory(self) -> Path:
        return Path(self.record["report"]["directory"])

    @property
    def complete(self) -> bool:
        return self.status == "COMPLETE" and self.returncode == 0 and not self.runtime_error

    @property
    def downloaded_bytes(self) -> int:
        return self.record["report"]["downloadedBytes"]

    @property
    def total_bytes(self) -> int:
        return self.record["report"]["bytes"]

    @property
    def complete_chunks(self) -> int:
        return self.record["report"]["completeChunks"]

    @property
    def chunk_count(self) -> int:
        return self.record["report"]["chunkCount"]

    @property
    def chunks(self) -> list[dict]:
        return deepcopy(self.record["chunkPage"]["items"])

    @property
    def next_chunk_offset(self) -> int | None:
        """Next page of saved chunk views; separate from the next request to run."""
        return self.record["chunkPage"]["nextOffset"]

    @property
    def assemblies(self) -> list[dict]:
        return deepcopy(self.record["assemblyPage"]["items"])

    def to_dict(self) -> dict:
        return {**deepcopy(self.record), "returncode": self.returncode,
                "runtimeError": self.runtime_error, "interrupted": self.interrupted}


@dataclass(frozen=True)
class ObjectDelivery(FileDelivery):
    """Original assembly receipt with the existing verified Python file readers."""

    @property
    def path(self) -> Path:
        return self.expected_destination

    @property
    def assembly(self) -> dict:
        return deepcopy(self.native["assembly"])

    @property
    def session_id(self) -> str:
        return self.native["sessionId"]

    @property
    def receipt_recorded(self) -> bool:
        return self.native["assembly"].get("receiptStatus") != "NOT_RECORDED"

    def verify(self):
        """Rehash the current file using the original same-descriptor reader."""
        with self.open():
            pass
        return self

    def raise_for_status(self):
        super().raise_for_status()
        return self.verify()


class ObjectBuyer:
    """Prepare or reopen native object sessions; the session is the durable state."""

    def __init__(self, *, checkout, node="node", environment=None, timeout=360,
                 output_limit=2_097_152):
        self.runtime = Runtime(checkout, node=node, environment=environment,
                               timeout=timeout, output_limit=output_limit)

    def open(self, directory):
        session = ObjectSession(self.runtime, directory)
        session.inspect()
        return session

    def _prepare(self, action, directory, *, config_file, workspace, arguments):
        if config_file is None and workspace is None:
            raise StateError("OBJECT_CONFIG_OR_WORKSPACE_REQUIRED")
        session = ObjectSession(self.runtime, directory)
        if config_file is not None:
            arguments += ["--config", _path(config_file)]
        if workspace is not None:
            arguments += ["--workspace", _path(workspace)]
        session._invoke(action, arguments)
        return session

    def prepare(self, directory, *, description_file, object_id, max_total_atomic,
                config_file=None, workspace=None, chunk_bytes=None):
        """Select one actual original objects.json row; no HTTP, keys or signing."""
        if not isinstance(object_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", object_id):
            raise StateError("OBJECT_EXPLICIT_SELECTION_REQUIRED")
        arguments = ["--description", _path(description_file), "--object", object_id,
                     "--max-total-atomic", _atomic(max_total_atomic)]
        if chunk_bytes is not None:
            arguments += ["--chunk-bytes", _integer(chunk_bytes)]
        return self._prepare("prepare", directory, config_file=config_file,
                             workspace=workspace, arguments=arguments)

    def prepare_explicit(self, directory, *, bytes, chunk_bytes, snapshot,
                         max_total_atomic, config_file=None, workspace=None,
                         sha256=None, content_type=None):
        """Use already-reviewed object facts for the same original chunk contract."""
        if not isinstance(snapshot, str) or not re.fullmatch(r"[a-f0-9]{64}", snapshot):
            raise StateError("OBJECT_EXPECTED_SNAPSHOT_REQUIRED")
        arguments = ["--bytes", _integer(bytes), "--chunk-bytes", _integer(chunk_bytes),
                     "--snapshot", snapshot, "--max-total-atomic", _atomic(max_total_atomic)]
        if sha256 is not None:
            if not isinstance(sha256, str) or not re.fullmatch(r"[a-f0-9]{64}", sha256):
                raise StateError("OBJECT_EXPECTED_SHA256_INVALID")
            arguments += ["--sha256", sha256]
        if content_type is not None:
            if not isinstance(content_type, str) or not content_type:
                raise StateError("OBJECT_EXPECTED_CONTENT_TYPE_INVALID")
            arguments += ["--content-type", content_type]
        return self._prepare("prepare-explicit", directory, config_file=config_file,
                             workspace=workspace, arguments=arguments)


class ObjectSession:
    """An existing native session, including ones created by the original CLI."""

    def __init__(self, runtime: Runtime, directory):
        self.runtime = runtime
        self.directory = _path(directory)
        self.session_id = None
        self.last_report = None

    def _invoke(self, action, arguments=(), *, chunk_offset=0, chunk_limit=50):
        _integer(chunk_offset, minimum=0)
        _integer(chunk_limit, maximum=250)
        try:
            run = self.runtime.run([action, "--session", self.directory,
                "--chunk-offset", chunk_offset, "--chunk-limit", chunk_limit, *arguments], target="object")
        except NativeError as error:
            raise NativeError(error.code, returncode=error.returncode, operation=self) from None
        output = run.output
        native = output.get("report") if isinstance(output, dict) else None
        if (not isinstance(native, dict) or output.get("mode") != MODE or output.get("action") != action
                or native.get("schema") != REPORT_SCHEMA or native.get("directory") != str(self.directory)
                or not isinstance(native.get("sessionId"), str)
                or (self.session_id is not None and self.session_id != native["sessionId"])
                or not isinstance(output.get("chunkPage"), dict)
                or not isinstance(output.get("assemblyPage"), dict)):
            raise NativeError(run.error or "ORIGINAL_OBJECT_RESULT_INVALID",
                              returncode=run.returncode, operation=self)
        self.session_id = native["sessionId"]
        result = ObjectReport(deepcopy(output), run.returncode, run.error, run.interrupted)
        self.last_report = result
        # Preserve an interrupted native report for application recovery. The
        # run/download caller receives exactly where the original inbox stopped.
        if action not in ("run", "download") and (run.returncode or run.error):
            raise ObjectDownloadError(run.error or "ORIGINAL_OBJECT_COMMAND_FAILED",
                                      progress=result, operation=self)
        return result

    def inspect(self, *, chunk_offset=0, chunk_limit=50) -> ObjectReport:
        """Offline native byte/header/outcome validation and selected chunk page."""
        return self._invoke("inspect", chunk_offset=chunk_offset, chunk_limit=chunk_limit)

    def run(self, *, workspace=None) -> ObjectReport:
        """Continue untouched native jobs with original terminal approval."""
        arguments = [] if workspace is None else ["--workspace", _path(workspace)]
        return self._invoke("run", arguments)

    def recover(self) -> ObjectReport:
        """Native offline recovery; never issue an HTTP request or repeat payment."""
        return self._invoke("recover")

    def _delivery(self, result) -> ObjectDelivery:
        if not result.complete:
            raise ObjectDownloadError(result.runtime_error or "OBJECT_DOWNLOAD_NOT_COMPLETE",
                                      progress=result, operation=self)
        saved = result.record.get("delivery")
        if not isinstance(saved, dict) or not isinstance(saved.get("file"), dict):
            raise ObjectDownloadError("OBJECT_ASSEMBLY_NOT_AVAILABLE", progress=result, operation=self)
        actual = saved["file"]
        receipt = saved.get("assembly") or {}
        if (saved.get("sessionId") != self.session_id or actual.get("bytes") != result.total_bytes
                or actual.get("sha256") != result.record["report"].get("objectSha256")
                or actual.get("path") != receipt.get("destination")):
            raise StateError("OBJECT_ASSEMBLY_BINDING_INVALID", operation=self)
        record = {"mode": "ORIGINAL_PYTHON_OBJECT_DELIVERY", "native": deepcopy(saved),
                  "report": result.native, "returncode": result.returncode,
                  "runtimeError": result.runtime_error}
        return ObjectDelivery(record, _path(actual["path"]), result.total_bytes)

    def assemble(self, destination) -> ObjectDelivery:
        """Stream complete native chunks to a new private destination."""
        return self._delivery(self._invoke("assemble", ["--out", _path(destination)]))

    def delivery(self, destination=None) -> ObjectDelivery:
        """Reopen a native assembly receipt; open()/verify() checks its current file."""
        arguments = [] if destination is None else ["--out", _path(destination)]
        return self._delivery(self._invoke("delivery", arguments))

    def download(self, destination, *, workspace=None) -> ObjectDelivery:
        """Continue the native session and return the assembled application file.

        Reuses a recorded destination after verifying its bytes. Otherwise only
        original unattempted chunks can run; an uncertain attempt stays retained.
        """
        arguments = ["--out", _path(destination)]
        if workspace is not None:
            arguments += ["--workspace", _path(workspace)]
        result = self._delivery(self._invoke("download", arguments))
        return result if result.native.get("fileRevalidated") else result.verify()

    def export_report(self, destination, *, format="html") -> Path:
        """Save the complete original offline report, including every chunk."""
        if format not in ("html", "json"):
            raise StateError("OBJECT_REPORT_FORMAT_INVALID")
        path = _path(destination)
        result = self._invoke("report", ["--out", path, "--format", format])
        if result.record.get("output", {}).get("path") != str(path):
            raise StateError("OBJECT_REPORT_DESTINATION_MISMATCH", operation=self)
        return path
