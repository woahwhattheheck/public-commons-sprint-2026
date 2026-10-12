"""Python applications use the original SF88 acquisition and SF100 delivery records."""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
import os
import hashlib
import json
import re
from pathlib import Path
import stat

from .errors import DeliveryError, NativeError, StateError
from .result import FileDelivery, SessionAccountingResult
from .runtime import Runtime
from .storage import digest, parse, private_directory, read

_MODE = "ORIGINAL_PYTHON_DATASET"
_ACQUISITION = "stellar-forge.sf88.dataset-acquisition.v1"
_DELIVERY = "stellar-forge.sf88.dataset-delivery.v1"
_PARTIAL = {"RECONCILIATION_REQUIRED", "PAGE_LIMIT_REACHED", "TOTAL_CAP_REACHED"}
_OUTPUTS = {"dataset.jsonl", "dataset.csv", "review.html", "manifest.json"}


def _path(value) -> Path:
    return Path(os.path.abspath(Path(value).expanduser()))


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

    @classmethod
    def from_finalized_scan(cls, scan):
        """Open an existing direct SF100 delivery using its unchanged native scan.

        The producer calls the original SF100 scan(directory,
        {retainPayload:false}). This receiver binds that completed native result
        to its manifest and original files; it does not create an acquisition.
        """
        hexadecimal = lambda value: isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value)
        if (not isinstance(scan, dict) or scan.get("finalized") is not True
                or scan.get("nextCursor") is not None
                or not isinstance(scan.get("session"), dict)
                or scan["session"].get("schema") != "stellar-forge.buyer-delivery.v1"
                or type(scan.get("count")) is not int
                or not 0 <= scan["count"] <= 1_000_000
                or scan.get("total") != scan["count"]
                or not isinstance(scan.get("pages"), list)
                or not 1 <= len(scan["pages"]) <= 4096
                or not all(hexadecimal(scan.get(key)) for key in ("snapshot", "chain", "queryHash"))
                or not isinstance(scan.get("out"), str)):
            raise DeliveryError("DATASET_FINALIZED_NATIVE_SCAN_REQUIRED")
        directory = private_directory(_path(scan["out"]), create=False)
        if str(directory) != scan["out"]:
            raise DeliveryError("DATASET_NATIVE_SCAN_DIRECTORY_INVALID")
        manifest_raw = read(directory / "manifest.json", 4 * 1024 * 1024)
        manifest = parse(manifest_raw)
        dataset = manifest.get("dataset") if isinstance(manifest, dict) else None
        if (not isinstance(manifest, dict)
                or manifest.get("schema") != "stellar-forge.buyer-delivery-manifest.v1"
                or not isinstance(dataset, dict)
                or dataset.get("rows") != scan["count"]
                or dataset.get("snapshot") != scan["snapshot"]
                or dataset.get("projectedFields") != scan.get("fields")
                or dataset.get("filters") != scan.get("filters")
                or dataset.get("ranges") != scan.get("ranges")
                or dataset.get("order") != (scan.get("order") or "csv-record-order")
                or dataset.get("originalQueryHash") != scan["queryHash"]
                or manifest.get("chainDigest") != scan["chain"]
                or not isinstance(manifest.get("sourcePages"), list)
                or len(manifest["sourcePages"]) != len(scan["pages"])
                or not isinstance(manifest.get("outputs"), dict)
                or set(manifest["outputs"]) != {"dataset.jsonl", "dataset.csv", "review.html"}):
            raise DeliveryError("DATASET_NATIVE_SCAN_MANIFEST_CHANGED")
        if parse(read(directory / "session.json", 4096)) != scan["session"]:
            raise DeliveryError("DATASET_NATIVE_SCAN_SESSION_CHANGED")
        previous, rows = None, 0
        for index, page in enumerate(scan["pages"]):
            if (not isinstance(page, dict) or page.get("index") != index
                    or page.get("previous") != previous
                    or type(page.get("returned")) is not int or page["returned"] < 0
                    or not hexadecimal(page.get("chain"))
                    or not hexadecimal(page.get("sourceSha256"))
                    or not hexadecimal(page.get("signature"))):
                raise DeliveryError("DATASET_NATIVE_SCAN_PAGE_INVALID")
            expected = {"index": index, "intent": page.get("intent"),
                        "sourceSha256": page["sourceSha256"], "evidenceSha256": page.get("evidenceSha256"),
                        "recordDigest": page["chain"], "rows": page["returned"],
                        "requestedCursor": page.get("requestCursor")}
            if manifest["sourcePages"][index] != expected:
                raise DeliveryError("DATASET_NATIVE_SCAN_PAGE_CHANGED")
            archive = parse(read(directory / "pages" / (str(index).zfill(5) + ".json"), 2 * 1024 * 1024 + 4096))
            if (not isinstance(archive, dict)
                    or any(archive.get(key) != page.get(key) for key in
                           ("schema", "index", "previous", "intent", "requestCursor",
                            "sourceSha256", "evidenceSha256", "signature", "chain"))
                    or not isinstance(archive.get("payload"), dict)
                    or archive["payload"].get("page", {}).get("returned") != page["returned"]):
                raise DeliveryError("DATASET_NATIVE_SCAN_ARCHIVE_CHANGED")
            previous, rows = page["chain"], rows + page["returned"]
        if (previous != scan["chain"] or rows != scan["count"]
                or dataset.get("originalQuerySignature") != scan["pages"][0]["signature"]):
            raise DeliveryError("DATASET_NATIVE_SCAN_CHAIN_CHANGED")
        pages = private_directory(directory / "pages", create=False)
        names = sorted(path.name for path in pages.iterdir())
        if names != [str(index).zfill(5) + ".json" for index in range(len(scan["pages"]))]:
            raise DeliveryError("DATASET_NATIVE_SCAN_ARCHIVE_CHANGED")

        def capture(name, limit):
            path = directory / name
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(fd, "rb") as stream:
                before = os.fstat(stream.fileno())
                if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1
                        or before.st_mode & 0o077 or before.st_size > limit):
                    raise DeliveryError("DATASET_PRIVATE_FILE_REQUIRED")
                checksum, size = hashlib.sha256(), 0
                while chunk := stream.read(1024 * 1024):
                    checksum.update(chunk)
                    size += len(chunk)
                    if size > limit:
                        raise DeliveryError("DATASET_OUTPUT_LIMIT")
                after = os.fstat(stream.fileno())
                if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
                        after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                    raise DeliveryError("DATASET_NATIVE_SOURCE_CHANGED")
            return {"path": str(path), "bytes": size, "sha256": checksum.hexdigest()}

        outputs = {}
        for name in ("manifest.json", "dataset.jsonl", "dataset.csv", "review.html"):
            metadata = capture(name, 4 * 1024 * 1024 if name == "manifest.json" else 256 * 1024 * 1024)
            expected = ({"bytes": len(manifest_raw), "sha256": digest(manifest_raw)} if name == "manifest.json"
                        else manifest["outputs"][name])
            if {key: metadata[key] for key in ("bytes", "sha256")} != expected:
                raise DeliveryError("DATASET_NATIVE_OUTPUT_CHANGED")
            outputs[name] = metadata
        archives = {"session.json": capture("session.json", 4096)}
        archives.update({f"pages/{index:05d}.json": capture(f"pages/{index:05d}.json", 2 * 1024 * 1024 + 4096)
                         for index in range(len(scan["pages"]))})
        binding = {"schema": "stellar-forge.sf100.python-delivery-source.v1", "scan": scan,
                   "manifestSha256": digest(manifest_raw), "archives": archives}
        native = {"schema": "stellar-forge.sf100.dataset-delivery.v1", "sourceFormat": "SF100_SCAN",
                  "directory": str(directory), "originalNativeScan": scan,
                  "sourceBindingSha256": digest(json.dumps(binding, ensure_ascii=False, allow_nan=False,
                                                           sort_keys=True, separators=(",", ":")).encode()),
                  "nativeStatus": {"complete": True, "finalized": True, "pages": len(scan["pages"]),
                                   "rows": scan["count"], "total": scan["total"], "snapshot": scan["snapshot"],
                                   "lastRecordDigest": scan["chain"]},
                  "paymentStatus": manifest["paymentStatus"], "outputs": outputs, "archives": archives}
        return cls(native, directory)

    def file_names(self):
        """Original finalized outputs and any direct SF100 session/page archives."""
        names = ("manifest.json", "dataset.jsonl", "dataset.csv", "review.html")
        return names + tuple(sorted(self.native.get("archives", {})))

    def file(self, name) -> FileDelivery:
        archive = (self.native.get("sourceFormat") == "SF100_SCAN" and
                   (name == "session.json" or isinstance(name, str) and re.fullmatch(r"pages/[0-9]{5}\.json", name)))
        if name not in _OUTPUTS and not archive:
            raise DeliveryError("DATASET_OUTPUT_NAME_INVALID")
        output = self.native["outputs"].get(name) or self.native.get("archives", {}).get(name)
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
        self.last_accounting = None

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

    def _accounting(self, *, finalize=False, workspace=None, offset=0, limit=100,
                    outbox=None, merchant_route=None):
        if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 250:
            raise StateError("DATASET_ACCOUNTING_RANGE_INVALID")
        if (outbox is None) != (merchant_route is None):
            raise StateError("OUTBOX_AND_ORIGINAL_MERCHANT_ROUTE_REQUIRED_TOGETHER")
        command = "finalize" if finalize else "accounting"
        options = ["--offset", offset, "--limit", limit]
        if workspace is not None:
            options += ["--workspace", _path(workspace)]
        if outbox is not None:
            options += ["--outbox", _path(outbox), "--merchant-route", _path(merchant_route)]
        run = self.runtime.run([command, "--session", self.directory, *options], target="dataset")
        output = run.output
        if (not isinstance(output, dict) or output.get("mode") != _MODE
                or output.get("command") != command or not isinstance(output.get("report"), dict)):
            raise DatasetError(run.error or "ORIGINAL_DATASET_ACCOUNTING_FAILED",
                               acquisition=self, native=output, returncode=run.returncode)
        view = SessionAccountingResult.from_native(output["report"], kind="dataset", directory=self.directory,
            returncode=run.returncode, runtime_error=run.error, interrupted=run.interrupted)
        self.last_accounting = view
        return view

    def accounting(self, *, offset=0, limit=100) -> SessionAccountingResult:
        """Read the original retained per-page receipts without wallet or RPC."""
        return self._accounting(offset=offset, limit=limit)

    def finalize(self, *, workspace=None, offset=0, limit=100,
                 outbox=None, merchant_route=None) -> SessionAccountingResult:
        """Finish these original page reservations; never run a page again."""
        return self._accounting(finalize=True, workspace=workspace, offset=offset, limit=limit,
                                outbox=outbox, merchant_route=merchant_route)

    def finalize_all(self, *, workspace=None, page_size=25, outbox=None, merchant_route=None):
        """Yield progress while accounting for every existing page, including failures.

        Inspect each view's attention entries. Reopening accounting() reads any
        views saved before interruption, independently of delivered product files.
        """
        offset = 0
        while True:
            view = self.finalize(workspace=workspace, offset=offset, limit=page_size,
                                 outbox=outbox, merchant_route=merchant_route)
            yield view
            if view.interrupted or view.next_offset is None:
                return
            offset = view.next_offset

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
