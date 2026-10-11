"""Private local operation storage. No wallet keys or substitute payment ledger."""
from __future__ import annotations

from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile

from .errors import StateError


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise StateError("DUPLICATE_JSON_KEY")
        result[key] = value
    return result


def parse(raw: bytes):
    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object,
                          parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except (ValueError, UnicodeError):
        raise StateError("INVALID_JSON") from None


def read(path: Path, limit: int) -> bytes:
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, "rb") as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
                raise StateError("FILE_LIMIT_OR_TYPE_INVALID")
            data = stream.read(limit + 1)
        if len(data) > limit:
            raise StateError("FILE_LIMIT_OR_TYPE_INVALID")
        return data
    except OSError:
        raise StateError("FILE_UNAVAILABLE") from None


def private_directory(path: Path, *, create=True) -> Path:
    path = path.expanduser().absolute()
    if create:
        path.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        info = path.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_mode & 0o077:
            raise StateError("PRIVATE_DIRECTORY_REQUIRED")
    except OSError:
        raise StateError("PRIVATE_DIRECTORY_REQUIRED") from None
    return path.resolve()


def sync_directory(path: Path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write(path: Path, data: bytes, *, exclusive=False):
    fd, name = tempfile.mkstemp(prefix=".write-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        if exclusive:
            # Publish a complete record without overwriting an existing one.
            # Readers cannot observe an empty/partial final result or attempt.
            os.link(name, path)
        else:
            os.replace(name, path)
        sync_directory(path.parent)
    finally:
        try:
            os.unlink(name)
        except FileNotFoundError:
            pass


def dump(path: Path, value, *, exclusive=False):
    write(path, (json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2) + "\n").encode(),
          exclusive=exclusive)


@contextmanager
def lock(directory: Path):
    fd = os.open(directory / "operation.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise StateError("OPERATION_BUSY") from None
        yield
    finally:
        os.close(fd)
