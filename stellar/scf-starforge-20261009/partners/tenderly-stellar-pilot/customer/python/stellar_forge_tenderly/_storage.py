"""Private, create-only analyst exports; the original buyer owns purchase state."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import stat
from typing import Any


class TenderlyError(ValueError):
    """A local customer request, response, or retained export is invalid."""


def require(condition: bool, code: str) -> None:
    if not condition:
        raise TenderlyError(code)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "DUPLICATE_JSON_KEY")
        result[key] = value
    return result


def parse(data: bytes) -> Any:
    try:
        return json.loads(data.decode("utf-8"), object_pairs_hook=_pairs,
                          parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except (UnicodeError, ValueError, RecursionError) as error:
        if isinstance(error, TenderlyError):
            raise
        raise TenderlyError("INVALID_JSON") from None


def encode(value: Any) -> bytes:
    try:
        return (json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2) + "\n").encode("utf-8")
    except (ValueError, TypeError, RecursionError):
        raise TenderlyError("JSON_VALUE_REQUIRED") from None


def copy_json(value: Any) -> Any:
    return parse(encode(value))


def read(path, limit: int) -> bytes:
    target = Path(path).expanduser().absolute()
    try:
        fd = os.open(target, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, "rb") as stream:
            info = os.fstat(stream.fileno())
            require(stat.S_ISREG(info.st_mode) and info.st_size <= limit, "FILE_LIMIT_OR_TYPE_INVALID")
            data = stream.read(limit + 1)
            require(len(data) == info.st_size and len(data) <= limit, "FILE_CHANGED_DURING_READ")
            return data
    except OSError:
        raise TenderlyError("RETAINED_FILE_UNAVAILABLE") from None


def object_file(path, limit: int = 262_144) -> dict:
    value = parse(read(path, limit))
    require(isinstance(value, dict), "JSON_OBJECT_REQUIRED")
    return value


def sync_directory(directory: Path) -> None:
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_new(path: Path, data: bytes) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    sync_directory(path.parent)


def private_new_directory(path) -> Path:
    directory = Path(path).expanduser().absolute()
    directory.mkdir(mode=0o700)
    sync_directory(directory.parent)
    return directory

