"""Consume the file saved by SF31, independently of payment classification."""
from __future__ import annotations

from contextlib import contextmanager
import csv
from dataclasses import dataclass
import hashlib
import io
import os
from pathlib import Path
import re
import shutil
import stat

from .errors import DeliveryError, NativeError
from .storage import parse


@dataclass(frozen=True)
class BuyerResult:
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
