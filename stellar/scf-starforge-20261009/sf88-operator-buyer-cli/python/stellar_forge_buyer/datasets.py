"""Python applications use the original SF88 acquisition and SF100 delivery records."""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
import os
from pathlib import Path
import stat

from .errors import DeliveryError, NativeError, StateError
from .result import FileDelivery
from .runtime import Runtime
from .storage import parse, private_directory

_MODE = "ORIGINAL_PYTHON_DATASET"
_ACQUISITION = "stellar-forge.sf88.dataset-acquisition.v1"
_DELIVERY = "stellar-forge.sf88.dataset-delivery.v1"
_PARTIAL = {"RECONCILIATION_REQUIRED", "PAGE_LIMIT_REACHED", "TOTAL_CAP_REACHED"}
_OUTPUTS = {"dataset.jsonl", "dataset.csv", "review.html", "manifest.json"}


def _path(value) -> Path:
    return Path(value).expanduser().absolute()


class DatasetError(NativeError):
    """A native failure or interruption, with any retained native result attached."""
    def __init__(self, code, *, acquisition, native=None, returncode=None):
        self.native = native
        self.report = native.get("report") if isinstance(native, dict) else None
        super().__init__(code, returncode=returncode, operation=acquisition)


class _DatasetOutput(FileDelivery):
    @contextmanager
    def open(self):
        parent = self.expected_destination.parent
        if private_directory(parent, create=False) != parent:
            raise DeliveryError("DATASET_PRIVATE_DIRECTORY_REQUIRED")
        # Reuse the original size/digest verification and the SAME descriptor.
        with super().open() as stream:
            info = os.fstat(stream.fileno())
            if info.st_nlink != 1 or not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
                raise DeliveryError("DATASET_PRIVATE_FILE_REQUIRED")
            yield stream


@dataclass(frozen=True)
class DatasetDelivery:
    """Original finalized data room. Its files are verified before consumption."""
    native: dict
    directory: Path

    @property
    def payment_status(self):
        return self.native["paymentStatus"]

    @property
    def status(self):
        return self.native["nativeStatus"]

    def file(self, name) -> FileDelivery:
        if name not in _OUTPUTS:
            raise DeliveryError("DATASET_OUTPUT_NAME_INVALID")
        output = self.native["outputs"].get(name)
        path = self.directory / name
        if not isinstance(output, dict) or output.get("path") != str(path):
            raise DeliveryError("DATASET_OUTPUT_METADATA_INVALID")
        return _DatasetOutput(
            record={"native":{"status":"DELIVERED", "file":dict(output)}, "returncode":0},
            expected_destination=path, max_bytes=256 * 1024 * 1024,
        )

    def jsonl_rows(self):
        """Yield native typed row dictionaries in the acquired order."""
        with self.file("dataset.jsonl").open() as stream:
            while raw := stream.readline(2_097_153):
                if len(raw) > 2_097_152 or not raw.endswith(b"\n"):
                    raise DeliveryError("DATASET_ROW_LIMIT_OR_FORMAT_INVALID")
                row = parse(raw)
                if not isinstance(row, dict):
                    raise DeliveryError("DATASET_ROW_OBJECT_REQUIRED")
                yield row

    def csv_rows(self):
        """Yield native CSV values as strings; use JSONL to retain data types."""
        yield from self.file("dataset.csv").csv_rows()


class DatasetAcquisition:
    """Reopen one original private session; no parallel Python attempt journal."""
    def __init__(self, *, checkout, session, node="node", environment=None,
                 timeout=360, output_limit=16_777_216):
        self.directory = _path(session)
        self.runtime = Runtime(checkout, node=node, environment=environment,
                               timeout=timeout, output_limit=output_limit)
        self.last_report = None

    @classmethod
    def create(cls, *, checkout, session, max_pages, max_total_atomic,
               config=None, workspace=None, max_rows=1_000_000,
               max_page_bytes=1_048_576, snapshot=None, **runtime_options):
        """Offline create from exactly one existing reviewed config or workspace."""
        if (config is None) == (workspace is None):
            raise StateError("DATASET_ONE_CONFIG_SOURCE_REQUIRED")
        if any(type(value) is not int for value in (max_pages, max_rows, max_page_bytes)):
            raise StateError("DATASET_INTEGER_REQUIRED")
        if not isinstance(max_total_atomic, str):
            raise StateError("DATASET_ATOMIC_STRING_REQUIRED")
        acquisition = cls(checkout=checkout, session=session, **runtime_options)
        options = ["--max-pages", max_pages, "--max-total-atomic", max_total_atomic,
                   "--max-rows", max_rows, "--max-page-bytes", max_page_bytes]
        options += ["--config", _path(config)] if config is not None else ["--workspace", _path(workspace)]
        if snapshot is not None:
            options += ["--snapshot", snapshot]
        acquisition._invoke("init", options)
        return acquisition

    def _invoke(self, command, options=()):
        result = self.runtime.run([command, "--session", self.directory, *options], target="dataset")
        native = result.output
        if not isinstance(native, dict) or native.get("mode") != _MODE:
            raise DatasetError(result.error or "ORIGINAL_DATASET_RESULT_INVALID",
                               acquisition=self, returncode=result.returncode)
        report = native.get("report")
        if isinstance(report, dict) and native.get("command") == command:
            if command in {"init", "status", "run", "recover"}:
                valid = report.get("schema") == _ACQUISITION and report.get("directory") == str(self.directory)
            elif command == "deliver":
                valid = report.get("schema") == _DELIVERY and report.get("sourceDirectory") == str(self.directory)
            else:
                valid = report.get("status") == "EXPORTED"
            if not valid:
                raise DatasetError("ORIGINAL_DATASET_RESULT_INVALID", acquisition=self,
                                   native=native, returncode=result.returncode)
            self.last_report = report
            if not result.error and not native.get("error") and (
                    result.returncode == 0 or result.returncode == 2 and report.get("status") in _PARTIAL):
                return report
        raise DatasetError(result.error or native.get("error") or "ORIGINAL_DATASET_OPERATION_INTERRUPTED",
                           acquisition=self, native=native, returncode=result.returncode)

    def inspect(self):
        """Offline native status. RUNNING means another process owns its lock."""
        return self._invoke("status")

    def run(self):
        """Execute remaining pages with original per-page review and reservations.

        Partial status is returned unchanged. Interruption raises DatasetError;
        use recover() on this same session before explicitly resuming it.
        """
        return self._invoke("run")

    def recover(self):
        """Offline native recovery. It never retries an attempted payment/page."""
        return self._invoke("recover")

    def export_manifest(self, destination):
        return self._invoke("export", ["--out", _path(destination)])

    def deliver(self, destination) -> DatasetDelivery:
        """Create or reopen the same original offline SF100 data room."""
        path = _path(destination)
        report = self._invoke("deliver", ["--out", path])
        if (report.get("directory") != str(path) or not isinstance(report.get("outputs"), dict)
                or set(report["outputs"]) != _OUTPUTS):
            raise DatasetError("ORIGINAL_DATASET_DELIVERY_INVALID", acquisition=self,
                               native={"mode":_MODE, "report":report})
        return DatasetDelivery(native=report, directory=path)
