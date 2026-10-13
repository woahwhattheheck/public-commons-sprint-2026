"""Complete native descriptor receiving with an fsync'd resumable file cursor."""
from __future__ import annotations

import base64
from dataclasses import dataclass
import hashlib
import os
from pathlib import Path
import stat
import threading

from ._review_transport import ReviewError, absolute
from .errors import StateError
from .storage import dump, lock, parse, private_directory, read, sync_directory

SCHEMA = "stellar-forge.sf88.python-review-transfer.v1"


@dataclass(frozen=True)
class TransferProgress:
    destination: Path
    committed_bytes: int
    total_bytes: int
    sha256: str
    transfer_directory: Path


@dataclass(frozen=True)
class ReviewFile:
    path: Path
    bytes: int
    sha256: str
    resumed_from: int
    transfer_directory: Path
    source: dict


class ReviewTransferError(ReviewError):
    def __init__(self, code, *, progress: TransferProgress, cause=None):
        self.progress = progress
        self.cause = cause
        super().__init__(code, dispatched=getattr(cause, "dispatched", False),
                         result=getattr(cause, "result", None))


def _hash_file(path: Path, *, prefix=None):
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
    with os.fdopen(os.open(path, flags), "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or (prefix is not None and before.st_size < prefix):
            raise StateError("REVIEW_TRANSFER_FILE_INVALID")
        value = hashlib.sha256()
        remaining = before.st_size if prefix is None else prefix
        while remaining:
            data = stream.read(min(1024 * 1024, remaining))
            if not data:
                raise StateError("REVIEW_TRANSFER_EOF")
            value.update(data)
            remaining -= len(data)
        after = os.fstat(stream.fileno())
        if any(getattr(before, key) != getattr(after, key) for key in ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")):
            raise StateError("REVIEW_TRANSFER_FILE_CHANGED")
        return value, before.st_size


def copy_native_file(library, selection, destination, *, transfer_directory=None,
                     chunk_bytes=1024 * 1024, cancel_event=None, progress=None,
                     resume=True) -> ReviewFile:
    if type(chunk_bytes) is not int or not 1 <= chunk_bytes <= 1024 * 1024:
        raise StateError("REVIEW_TRANSFER_LENGTH_INVALID")
    if cancel_event is not None and not isinstance(cancel_event, threading.Event):
        raise StateError("REVIEW_CANCEL_EVENT_INVALID")
    target = Path(absolute(destination))
    parent = target.parent
    if parent.resolve() != parent or not parent.is_dir():
        raise StateError("REVIEW_CANONICAL_OUTPUT_PARENT_REQUIRED")
    directory = Path(absolute(transfer_directory)) if transfer_directory else parent / ("." + target.name + ".sf88-review-transfer")
    if directory.resolve() != directory:
        raise StateError("REVIEW_CANONICAL_TRANSFER_DIRECTORY_REQUIRED")
    directory = private_directory(directory)
    if directory.stat().st_dev != parent.stat().st_dev:
        raise StateError("REVIEW_TRANSFER_SAME_FILESYSTEM_REQUIRED")
    record_path, partial = directory / "transfer.json", directory / "content.part"
    selected = {key: value for key, value in selection.items() if value is not None}
    selected.setdefault("format", "json")
    with lock(directory):
        if not resume and record_path.exists():
            raise StateError("REVIEW_TRANSFER_EXISTS")
        descriptor = library._call("transfer.open", selected, cancel_event=cancel_event)
        token = descriptor["token"]
        total, expected = descriptor["bytes"], descriptor["sha256"]
        committed = 0

        def status():
            return TransferProgress(target, committed, total, expected, directory)

        try:
            if record_path.exists():
                record = parse(read(record_path, 65536))
                if (record.get("schema") != SCHEMA or record.get("selection") != selected
                        or record.get("destination") != str(target)
                        or record.get("sha256") != expected or record.get("bytes") != total):
                    raise StateError("REVIEW_TRANSFER_BINDING_CHANGED")
                committed = record["committed"]
                if type(committed) is not int or not 0 <= committed <= total:
                    raise StateError("REVIEW_TRANSFER_CURSOR_INVALID")
            else:
                if partial.exists():
                    raise StateError("REVIEW_TRANSFER_UNOWNED_PARTIAL")
                record = {"schema": SCHEMA, "selection": selected, "destination": str(target),
                    "sha256": expected, "bytes": total, "committed": 0, "complete": False,
                    "name": descriptor["name"], "prefixSha256": hashlib.sha256(b"").hexdigest()}
                dump(record_path, record, exclusive=True)
            resumed = committed
            if target.exists() or target.is_symlink():
                value, size = _hash_file(target)
                if size != total or value.hexdigest() != expected:
                    raise StateError("REVIEW_OUTPUT_EXISTS_DIFFERENT")
                committed = total
                record.update(committed=total, prefixSha256=expected, complete=True)
                dump(record_path, record)
                if partial.exists():
                    partial.unlink()
                    sync_directory(directory)
                return ReviewFile(target, total, expected, resumed, directory, selected)
            if record.get("complete"):
                raise StateError("REVIEW_COMPLETED_OUTPUT_MISSING")
            if committed == 0 and not partial.exists():
                fd = os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                os.close(fd)
                sync_directory(directory)
            value, size = _hash_file(partial, prefix=committed)
            if value.hexdigest() != record.get("prefixSha256"):
                raise StateError("REVIEW_TRANSFER_PREFIX_CHANGED")
            fd = os.open(partial, os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(fd, "r+b", buffering=0) as file:
                info = os.fstat(file.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                    raise StateError("REVIEW_TRANSFER_FILE_INVALID")
                # A crash after writing bytes but before committing the cursor
                # leaves only an uncommitted suffix. Never trust that suffix.
                file.truncate(committed)
                file.seek(committed)
                while committed < total:
                    if cancel_event is not None and cancel_event.is_set():
                        raise ReviewTransferError("REVIEW_TRANSFER_CANCELLED", progress=status())
                    chunk = library._call("transfer.read", {"token": token,
                        "offset": committed, "length": chunk_bytes}, cancel_event=cancel_event)
                    try:
                        raw = base64.b64decode(chunk["data"], validate=True)
                    except (ValueError, TypeError, KeyError):
                        raise StateError("REVIEW_TRANSFER_CHUNK_INVALID") from None
                    following = committed + len(raw)
                    next_offset = None if following == total else following
                    if (chunk.get("token") != token or chunk.get("offset") != committed
                            or chunk.get("bytes") != len(raw) or not raw or following > total
                            or len(raw) > chunk_bytes or chunk.get("totalBytes") != total
                            or chunk.get("nextOffset") != next_offset
                            or hashlib.sha256(raw).hexdigest() != chunk.get("sha256")):
                        raise StateError("REVIEW_TRANSFER_CHUNK_INVALID")
                    view = memoryview(raw)
                    while view:
                        written = file.write(view)
                        if not written:
                            raise StateError("REVIEW_TRANSFER_WRITE_FAILED")
                        view = view[written:]
                    file.flush()
                    os.fsync(file.fileno())
                    value.update(raw)
                    committed = following
                    record.update(committed=committed, prefixSha256=value.hexdigest())
                    dump(record_path, record)
                    if progress:
                        progress(status())
                file.flush()
                os.fsync(file.fileno())
            if value.hexdigest() != expected:
                raise StateError("REVIEW_TRANSFER_DIGEST_MISMATCH")
            # Re-read the actual file before create-only publication, not a log
            # or preview. This also checks an interrupted cursor's full prefix.
            checked, size = _hash_file(partial)
            if size != total or checked.hexdigest() != expected:
                raise StateError("REVIEW_TRANSFER_DIGEST_MISMATCH")
            try:
                os.link(partial, target, follow_symlinks=False)
            except FileExistsError:
                existing, size = _hash_file(target)
                if size != total or existing.hexdigest() != expected:
                    raise StateError("REVIEW_OUTPUT_EXISTS_DIFFERENT") from None
            sync_directory(parent)
            partial.unlink()
            sync_directory(directory)
            record.update(complete=True)
            dump(record_path, record)
            return ReviewFile(target, total, expected, resumed, directory, selected)
        except ReviewTransferError:
            raise
        except (ReviewError, StateError, OSError) as error:
            raise ReviewTransferError(getattr(error, "code", "REVIEW_TRANSFER_IO_ERROR"),
                                      progress=status(), cause=error) from error
        finally:
            try:
                library._call("transfer.close", {"token": token})
            except ReviewError:
                pass
