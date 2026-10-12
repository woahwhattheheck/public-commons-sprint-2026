from __future__ import annotations

import os
import stat
from typing import Any, Callable, Optional, Type, Union

_ERROR_TYPE: Type[Exception] = ValueError


def bind_error_type(error_type: Type[Exception]) -> None:
    """Bind the product's public validation error without importing its engine."""
    global _ERROR_TYPE
    if not isinstance(error_type, type) or not issubclass(error_type, Exception):
        raise TypeError("error_type must be an Exception class")
    _ERROR_TYPE = error_type


def _fail(message: str) -> None:
    raise _ERROR_TYPE(message)


def _identity(value: os.stat_result) -> tuple[int, int]:
    return value.st_dev, value.st_ino


def _generation(value: os.stat_result) -> tuple[int, int, int, int, int, int, int]:
    return (
        value.st_dev,
        value.st_ino,
        value.st_mode,
        value.st_nlink,
        value.st_size,
        value.st_mtime_ns,
        value.st_ctime_ns,
    )


def _required_directory_flags() -> int:
    if not hasattr(os, "O_DIRECTORY") or not hasattr(os, "O_NOFOLLOW"):
        _fail("secure output publication requires O_DIRECTORY and O_NOFOLLOW")
    if os.open not in getattr(os, "supports_dir_fd", set()):
        _fail("secure output publication requires dir_fd os.open support")
    return os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0)


def _open_directory_no_follow(directory: Union[str, os.PathLike[str]]) -> dict[str, Any]:
    flags = _required_directory_flags()
    absolute = os.path.abspath(os.fspath(directory))
    if not absolute.startswith(os.sep):
        _fail("secure output publication requires an absolute POSIX path")
    parts = tuple(part for part in absolute.split(os.sep) if part)
    fd = os.open(os.sep, flags)
    try:
        for part in parts:
            if part in {".", ".."} or os.sep in part:
                _fail("invalid output directory component")
            next_fd = os.open(part, flags, dir_fd=fd)
            os.close(fd)
            fd = next_fd
        info = os.fstat(fd)
        if not stat.S_ISDIR(info.st_mode):
            _fail("retained output parent is not a directory")
        return {"fd": fd, "absolute": absolute, "identity": _identity(info)}
    except BaseException:
        try:
            os.close(fd)
        except OSError:
            pass
        raise


def _assert_visible_parent(parent: dict[str, Any]) -> None:
    reopened: Optional[dict[str, Any]] = None
    try:
        reopened = _open_directory_no_follow(parent["absolute"])
        if reopened["identity"] != parent["identity"]:
            _fail("output parent generation changed")
    finally:
        if reopened is not None:
            try:
                os.close(reopened["fd"])
            except OSError:
                pass


def _normalize_outputs(
    outputs: list[tuple[Union[str, os.PathLike[str]], str]]
) -> list[dict[str, Any]]:
    if not outputs:
        _fail("no outputs requested")
    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in outputs:
        if type(item) not in (tuple, list) or len(item) != 2:
            _fail("outputs must contain (path, text) pairs")
        path, text = item
        if type(text) is not str:
            _fail("output payloads must be text")
        absolute = os.path.abspath(os.fspath(path))
        if absolute in seen:
            _fail("output paths must be distinct")
        seen.add(absolute)
        parent = os.path.dirname(absolute) or os.sep
        name = os.path.basename(absolute)
        if not name or name in {".", ".."} or os.sep in name or "\x00" in name:
            _fail("invalid output file name")
        normalized.append(
            {
                "requested": os.fspath(path),
                "absolute": absolute,
                "parent": parent,
                "name": name,
                "content": text.encode("utf-8"),
            }
        )
    return normalized


def _ensure_absent(parent: dict[str, Any], name: str) -> None:
    try:
        os.stat(name, dir_fd=parent["fd"], follow_symlinks=False)
    except FileNotFoundError:
        return
    _fail(f"output already exists: {os.path.join(parent['absolute'], name)}")


def _write_all(fd: int, payload: bytes) -> None:
    offset = 0
    while offset < len(payload):
        written = os.write(fd, payload[offset:])
        if written <= 0:
            _fail("short output write made no progress")
        offset += written


def _neutralize_fd(fd: int) -> Optional[str]:
    try:
        os.ftruncate(fd, 0)
        os.fsync(fd)
        return None
    except OSError as exc:
        return f"{type(exc).__name__}:{exc}"


def _assert_visible_file(parent: dict[str, Any], record: dict[str, Any]) -> None:
    try:
        visible = os.stat(record["name"], dir_fd=parent["fd"], follow_symlinks=False)
    except OSError as exc:
        raise _ERROR_TYPE(f"output ownership changed: {record['absolute']}") from exc
    if (
        not stat.S_ISREG(visible.st_mode)
        or stat.S_ISLNK(visible.st_mode)
        or visible.st_nlink != 1
        or _identity(visible) != record["identity"]
    ):
        _fail(f"output ownership changed: {record['absolute']}")


def _read_exact_retained(fd: int, expected_len: int) -> bytes:
    os.lseek(fd, 0, os.SEEK_SET)
    chunks: list[bytes] = []
    remaining = expected_len + 1
    while remaining:
        chunk = os.read(fd, min(65536, remaining))
        if not chunk:
            break
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def _verify_record(parent: dict[str, Any], record: dict[str, Any]) -> None:
    _assert_visible_parent(parent)
    before = os.fstat(record["fd"])
    if (
        not stat.S_ISREG(before.st_mode)
        or before.st_nlink != 1
        or _generation(before) != record["generation"]
    ):
        _fail(f"retained output generation changed: {record['absolute']}")
    actual = _read_exact_retained(record["fd"], len(record["content"]))
    after = os.fstat(record["fd"])
    if _generation(after) != _generation(before):
        _fail(f"output generation changed during verification: {record['absolute']}")
    if actual != record["content"]:
        _fail(f"output content changed before publication completed: {record['absolute']}")
    _assert_visible_file(parent, record)
    visible = os.stat(record["name"], dir_fd=parent["fd"], follow_symlinks=False)
    if _generation(visible) != _generation(after):
        _fail(f"visible output generation changed: {record['absolute']}")
    _assert_visible_parent(parent)


def _create_one(parent: dict[str, Any], entry: dict[str, Any]) -> dict[str, Any]:
    _assert_visible_parent(parent)
    _ensure_absent(parent, entry["name"])
    flags = (
        os.O_RDWR
        | os.O_CREAT
        | os.O_EXCL
        | os.O_NOFOLLOW
        | getattr(os, "O_CLOEXEC", 0)
    )
    fd = os.open(entry["name"], flags, 0o600, dir_fd=parent["fd"])
    try:
        opened = os.fstat(fd)
        if not stat.S_ISREG(opened.st_mode) or opened.st_nlink != 1:
            _fail(f"created output is not a private regular file: {entry['absolute']}")
        initial_identity = _identity(opened)
        _write_all(fd, entry["content"])
        os.fsync(fd)
        final = os.fstat(fd)
        if (
            not stat.S_ISREG(final.st_mode)
            or final.st_nlink != 1
            or _identity(final) != initial_identity
            or final.st_size != len(entry["content"])
        ):
            _fail(f"output generation changed during write: {entry['absolute']}")
        record = {
            **entry,
            "fd": fd,
            "identity": _identity(final),
            "generation": _generation(final),
        }
        _assert_visible_parent(parent)
        _assert_visible_file(parent, record)
        return record
    except BaseException as exc:
        cleanup_error = _neutralize_fd(fd)
        try:
            os.close(fd)
        except OSError:
            pass
        if cleanup_error is not None:
            raise _ERROR_TYPE(f"{exc}; descriptor cleanup failed: {cleanup_error}") from exc
        raise


def write_outputs_exclusive(
    outputs: list[tuple[Union[str, os.PathLike[str]], str]],
    *,
    after_create: Optional[Callable[[int, str], None]] = None,
) -> None:
    """Publish a text bundle under retained parent/leaf descriptor custody.

    Failure never unlinks a pathname. Invocation-owned descriptors are truncated
    and fsynced instead, so a same-name foreign replacement is never deleted.
    Zero-byte invocation-owned tombstones may remain after a failed transaction.
    """

    entries = _normalize_outputs(outputs)
    if after_create is not None and not callable(after_create):
        _fail("after_create hook must be callable")

    parents: dict[str, dict[str, Any]] = {}
    records: list[tuple[dict[str, Any], dict[str, Any]]] = []
    try:
        for entry in entries:
            if entry["parent"] not in parents:
                parents[entry["parent"]] = _open_directory_no_follow(entry["parent"])
        for entry in entries:
            parent = parents[entry["parent"]]
            _assert_visible_parent(parent)
            _ensure_absent(parent, entry["name"])

        for index, entry in enumerate(entries):
            parent = parents[entry["parent"]]
            record = _create_one(parent, entry)
            records.append((parent, record))
            if after_create is not None:
                after_create(index, entry["absolute"])
            _verify_record(parent, record)

        for parent in parents.values():
            os.fsync(parent["fd"])
            _assert_visible_parent(parent)
        for parent, record in records:
            _verify_record(parent, record)
    except BaseException as exc:
        cleanup_failures: list[str] = []
        for _parent, record in reversed(records):
            failure = _neutralize_fd(record["fd"])
            if failure is not None:
                cleanup_failures.append(f"{record['absolute']}:{failure}")
        for parent in parents.values():
            try:
                os.fsync(parent["fd"])
            except OSError as cleanup_exc:
                cleanup_failures.append(
                    f"{parent['absolute']}:{type(cleanup_exc).__name__}:{cleanup_exc}"
                )
        if cleanup_failures:
            raise _ERROR_TYPE(
                f"{exc}; descriptor cleanup failed: {', '.join(cleanup_failures)}"
            ) from exc
        if isinstance(exc, _ERROR_TYPE):
            raise
        if isinstance(exc, OSError):
            raise _ERROR_TYPE(f"output publication failed: {exc}") from exc
        raise
    finally:
        for _parent, record in reversed(records):
            try:
                os.close(record["fd"])
            except OSError:
                pass
        for parent in parents.values():
            try:
                os.close(parent["fd"])
            except OSError:
                pass


__all__ = ["bind_error_type", "write_outputs_exclusive"]
