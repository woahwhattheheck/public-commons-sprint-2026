"""Consume the file saved by SF31, independently of payment classification."""
from __future__ import annotations

from contextlib import contextmanager
from copy import deepcopy
import csv
from dataclasses import dataclass
import hashlib
import io
import os
from pathlib import Path
import re
import shutil
import stat

from .errors import DeliveryError, NativeError, StateError
from .storage import parse


class _FileReaders:
    @contextmanager
    def open(self):
        """Verify bytes and digest before yielding the SAME open file descriptor."""
        saved = self.delivery
        if saved.get("status") != "SAVED" or self.expected_destination is None:
            raise DeliveryError("RESPONSE_NOT_SAVED")
        try:
            path = Path(saved["path"])
            count = saved["bytes"]
            expected = saved["sha256"]
            if (not path.is_absolute() or path.resolve() != self.expected_destination.resolve()
                    or type(count) is not int or not 0 <= count <= self.max_bytes
                    or not isinstance(expected, str) or not re.fullmatch(r"[0-9a-f]{64}", expected)):
                raise ValueError()
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        except (KeyError, OSError, TypeError, ValueError):
            raise DeliveryError("RESPONSE_FILE_METADATA_INVALID") from None
        with os.fdopen(fd, "rb") as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size != count:
                raise DeliveryError("RESPONSE_FILE_CHANGED")
            checksum = hashlib.sha256()
            total = 0
            while chunk := stream.read(65536):
                total += len(chunk)
                if total > count:
                    raise DeliveryError("RESPONSE_FILE_CHANGED")
                checksum.update(chunk)
            if total != count or checksum.hexdigest() != expected:
                raise DeliveryError("RESPONSE_FILE_CHANGED")
            stream.seek(0)
            yield stream

    def read_bytes(self, *, limit=8_388_608) -> bytes:
        if type(limit) is not int or limit < 1:
            raise DeliveryError("READ_LIMIT_INVALID")
        with self.open() as stream:
            if os.fstat(stream.fileno()).st_size > limit:
                raise DeliveryError("READ_LIMIT_EXCEEDED_USE_OPEN")
            return stream.read(limit + 1)

    def json(self, *, limit=8_388_608):
        return parse(self.read_bytes(limit=limit))

    def csv_rows(self, *, encoding="utf-8-sig"):
        with self.open() as stream:
            text = io.TextIOWrapper(stream, encoding=encoding, newline="")
            try:
                yield from csv.DictReader(text)
            finally:
                text.detach()

    def save_as(self, destination) -> Path:
        path = Path(destination).expanduser().absolute()
        with self.open() as source:
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            try:
                with os.fdopen(fd, "wb") as target:
                    shutil.copyfileobj(source, target, length=65536)
                    target.flush()
                    os.fsync(target.fileno())
            except BaseException:
                path.unlink(missing_ok=True)
                raise
        return path


@dataclass(frozen=True)
class BuyerResult(_FileReaders):
    record: dict
    expected_destination: Path | None
    max_bytes: int

    @property
    def native(self) -> dict:
        return self.record["native"]

    @property
    def status(self):
        return self.native.get("status")

    @property
    def delivery(self) -> dict:
        return self.native.get("responseFile") or {"status": "NOT_REQUESTED"}

    @property
    def ok(self) -> bool:
        status = self.native.get("httpStatus")
        return (self.record.get("returncode") == 0 and not self.record.get("runtimeError")
                and isinstance(status, int) and 200 <= status < 300
                and not any(self.native.get(key) for key in ("error", "evidenceError", "responseCleanupError")))

    def raise_for_status(self):
        if not self.ok:
            raise NativeError(self.record.get("runtimeError") or "NATIVE_ATTEMPT_NOT_SUCCESSFUL",
                              returncode=self.record.get("returncode"))
        return self


@dataclass(frozen=True)
class FileDelivery(_FileReaders):
    """Verified customer product bytes; separate from the original payment result."""
    record: dict
    expected_destination: Path
    max_bytes: int

    @property
    def native(self):
        return self.record["native"]

    @property
    def status(self):
        return self.native["status"]

    @property
    def delivery(self):
        return {**self.native["file"], "status": "SAVED"}

    @property
    def http_requests(self):
        return self.native.get("httpRequests")

    @property
    def transfer(self):
        return dict(self.native.get("transfer") or {})

    @property
    def resumed_bytes(self):
        return self.transfer.get("resumedBytes", 0)

    @property
    def ok(self):
        return self.record.get("returncode") == 0 and not self.record.get("runtimeError")

    def raise_for_status(self):
        if not self.ok:
            raise DeliveryError("ORIGINAL_FILE_DELIVERY_NOT_COMPLETED")
        return self


@dataclass(frozen=True)
class FileTransfer:
    """A local inspection of the original SF101 retained transfer."""
    record: dict

    @property
    def native(self):
        return self.record["native"]

    @property
    def status(self):
        return self.native["status"]

    @property
    def destination(self):
        return Path(self.native["destination"])

    @property
    def retained_bytes(self):
        return self.native["retainedBytes"]

    @property
    def expected_bytes(self):
        return self.native["expectedBytes"]

    @property
    def resumable(self):
        return self.native["resumable"]

    @property
    def partial_path(self):
        value = self.native.get("partialPath")
        return Path(value) if value else None

    @property
    def removed_partial_bytes(self):
        return self.native.get("removedPartialBytes", 0)


@dataclass(frozen=True)
class AccountingResult:
    """Saved view of original SF36 accounting; never a new payment authority."""
    record: dict

    @property
    def native(self):
        return self.record.get("native") or {}

    @property
    def result(self):
        return self.native.get("result") or {}

    @property
    def status(self):
        return self.result.get("outcome") or "NATIVE_ACCOUNTING_RESULT_UNAVAILABLE"

    @property
    def finalized(self):
        return self.status in ("FINALIZED", "IDEMPOTENT_FINALIZED")

    @property
    def actual_atomic_units(self):
        return self.result.get("actual") if self.finalized else None

    @property
    def receipt(self):
        return self.result.get("receipt_ref") if self.finalized else None

    @property
    def merchant(self):
        return self.result.get("merchant") or {"status": "NOT_RECORDED"}

    @property
    def last_finalized(self):
        return self.record.get("lastFinalized")

    def raise_for_status(self):
        if not self.finalized:
            raise NativeError(self.record.get("runtimeError") or self.result.get("reason") or
                              "ORIGINAL_ACCOUNTING_NOT_FINALIZED",
                              returncode=self.record.get("returncode"))
        return self


@dataclass(frozen=True)
class SessionAccountingResult:
    """One native page/chunk accounting range. The original ledger owns finality.

    Amounts and completion describe this range only. A retained prior receipt
    remains visible in an entry's lastFinalized after a later source failure.
    """
    native: dict
    returncode: int = 0
    runtime_error: str | None = None
    interrupted: bool = False

    @classmethod
    def from_native(cls, native, *, kind, directory, returncode=0,
                    runtime_error=None, interrupted=False):
        if (not isinstance(native, dict)
                or native.get("schema") != "stellar-forge.sf88.session-accounting.v1"
                or native.get("kind") != kind or native.get("directory") != str(directory)
                or not isinstance(native.get("sessionId"), str)
                or not isinstance(native.get("configurationSha256"), str)
                or not re.fullmatch(r"[a-f0-9]{64}", native.get("configurationSha256", ""))
                or native.get("mode") not in ("VIEW", "FINALIZE")
                or not isinstance(native.get("range"), dict)
                or not isinstance(native.get("entries"), list)):
            raise StateError("ORIGINAL_SESSION_ACCOUNTING_RESULT_INVALID")
        window, entries = native["range"], native["entries"]
        if (any(type(window.get(key)) is not int for key in ("offset", "limit", "total"))
                or not 0 <= window["offset"] <= window["total"]
                or not 1 <= window["limit"] <= 250
                or len(entries) > min(window["limit"], window["total"] - window["offset"])):
            raise StateError("ORIGINAL_SESSION_ACCOUNTING_RANGE_INVALID")
        next_offset = window["offset"] + len(entries)
        if not entries and next_offset < window["total"] and not native.get("interrupted"):
            raise StateError("ORIGINAL_SESSION_ACCOUNTING_RANGE_INVALID")
        if window.get("nextOffset") != (next_offset if next_offset < window["total"] else None):
            raise StateError("ORIGINAL_SESSION_ACCOUNTING_RANGE_INVALID")
        for position, entry in enumerate(entries):
            if (not isinstance(entry, dict)
                    or entry.get("index") != window["offset"] + position + (kind == "dataset")
                    or not isinstance(entry.get("outcome"), str)):
                raise StateError("ORIGINAL_SESSION_ACCOUNTING_ENTRY_INVALID")
            if entry["outcome"] in ("FINALIZED", "IDEMPOTENT_FINALIZED") and (
                    not isinstance(entry.get("actualAtomicUnits"), str)
                    or not re.fullmatch(r"[0-9]+", entry["actualAtomicUnits"])
                    or not isinstance(entry.get("receipt"), str)):
                raise StateError("ORIGINAL_SESSION_ACCOUNTING_RECEIPT_INVALID")
        return cls(deepcopy(native), returncode, runtime_error,
                   interrupted or native.get("interrupted") is True)

    @property
    def entries(self):
        return deepcopy(self.native["entries"])

    @property
    def next_offset(self):
        return self.native["range"]["nextOffset"]

    @property
    def attention(self):
        return [entry for entry in self.entries if entry["outcome"] not in
                ("FINALIZED", "IDEMPOTENT_FINALIZED", "NO_PAYMENT_REQUIRED", "NOT_ATTEMPTED")
                or entry.get("viewStatus") == "SAVE_FAILED"]

    @property
    def window_complete(self):
        return self.returncode in (0, 2) and not self.interrupted and not self.runtime_error and not self.attention

    @property
    def recorded_actual_atomic_units(self):
        """Sum only current finalized native amounts in this displayed range."""
        return str(sum(int(entry["actualAtomicUnits"]) for entry in self.native["entries"]
                       if entry["outcome"] in ("FINALIZED", "IDEMPOTENT_FINALIZED")))

    def raise_for_status(self):
        if not self.window_complete:
            raise NativeError(self.runtime_error or "ORIGINAL_SESSION_ACCOUNTING_NEEDS_ATTENTION",
                              returncode=self.returncode)
        return self
