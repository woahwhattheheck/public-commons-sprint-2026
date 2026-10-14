"""Contained file operations for exact original-object receiving.

POSIX keeps directory-relative no-follow operations and directory flock.
Windows uses the existing windows_fs file/lock primitives and a handle-relative
NtCreateFile backend. No global os replacement or scientific runtime import.
"""
from __future__ import annotations

import contextlib
import ctypes
import errno
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import unicodedata
from typing import Iterator


class PathConflict(ValueError):
    """A destination cannot preserve the requested original name or identity."""


def native(path: Path | str) -> Path:
    if os.name == "nt":
        from model.windows_fs import native_path
        return native_path(path)
    return Path(path)


def is_link(path: Path | str) -> bool:
    try:
        info = native(path).lstat()
    except FileNotFoundError:
        return False
    return stat.S_ISLNK(info.st_mode) or bool(getattr(info, "st_file_attributes", 0) & 0x400)


def file_stat(path: Path):
    if os.name == "nt":
        from model.windows_fs import path_stat
        return path_stat(path)
    return path.lstat()


def fd_stat(fd: int):
    if os.name == "nt":
        from model.windows_fs import fd_stat as windows_stat
        return windows_stat(fd)
    return os.fstat(fd)


def open_file(path: Path, flags: int, mode: int = 0o600) -> int:
    if os.name == "nt":
        from model.windows_fs import no_follow_open
        return no_follow_open(path, flags, mode)
    return os.open(path, flags | os.O_NOFOLLOW | getattr(os, "O_NONBLOCK", 0), mode)


def replace(source: Path, destination: Path) -> None:
    if os.name == "nt":
        from model.windows_fs import replace as windows_replace
        windows_replace(source, destination)
    else:
        os.replace(source, destination)


def sync_directory(path: Path) -> None:
    if os.name == "nt":
        from model.windows_fs import sync_directory as windows_sync
        windows_sync(path)
    else:
        with open_directory(path) as directory:
            directory.sync()


_DEVICES = re.compile(r"(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9\u00b9\u00b2\u00b3]|LPT[1-9\u00b9\u00b2\u00b3])\Z", re.I)


def validate_names(names: list[str], target: str | None = None) -> None:
    """Reject native name aliases before any original destination is written.

    `portable` is available to a package assembler to check Windows and the
    usual case/normalization-insensitive Mac volumes without renaming sources.
    A POSIX-only receiver retains distinct case-sensitive source names.
    """
    target = target or ("windows" if os.name == "nt" else "darwin" if sys.platform == "darwin" else "posix")
    if target not in ("windows", "darwin", "posix", "portable"):
        raise ValueError("Unknown original-path target: " + target)
    fold = target != "posix"
    windows = target in ("windows", "portable")
    seen: dict[tuple[str, ...], tuple[str, bool]] = {}
    for name in names:
        if not isinstance(name, str) or not name or "\\" in name or "\0" in name:
            raise PathConflict("Invalid original relative path: " + repr(name))
        path = PurePosixPath(name)
        if not path.parts or path.is_absolute() or path.as_posix() != name or any(p in (".", "..") for p in path.parts):
            raise PathConflict("Unsafe original relative path: " + repr(name))
        if ":" in path.parts[0] or any(ord(c) < 32 or 0xD800 <= ord(c) <= 0xDFFF for c in name):
            raise PathConflict("Nonportable original path: " + repr(name))
        key: list[str] = []
        original: list[str] = []
        for ordinal, part in enumerate(path.parts):
            if windows:
                if (part.endswith((" ", ".")) or any(c in '<>:"|?*' for c in part)
                        or _DEVICES.fullmatch(part.split(".", 1)[0].rstrip(" "))):
                    raise PathConflict("Windows cannot preserve original component " + repr(part) + " in " + repr(name))
                if len(part.encode("utf-16-le")) > 510:
                    raise PathConflict("Windows original component exceeds 255 UTF-16 units: " + repr(part))
            original.append(part)
            key.append(unicodedata.normalize("NFC", part).casefold() if fold else part)
            prefix = "/".join(original)
            is_file = ordinal == len(path.parts) - 1
            previous = seen.get(tuple(key))
            if previous is not None:
                if previous[0] != prefix:
                    raise PathConflict("Original names collide on the receiving platform: "
                                       + repr(previous[0]) + " and " + repr(prefix))
                if previous[1] != is_file or is_file:
                    raise PathConflict("Repeated original file or file/directory collision: " + repr(prefix))
            else:
                seen[tuple(key)] = (prefix, is_file)


class PosixDirectory:
    def __init__(self, descriptor: int, path: Path):
        self.fd = descriptor
        self.path = path

    def close(self) -> None:
        if self.fd >= 0:
            os.close(self.fd)
            self.fd = -1

    def child(self, name: str, create: bool = False):
        _leaf(name)
        if create:
            try:
                os.mkdir(name, mode=0o700, dir_fd=self.fd)
                self.sync()
            except FileExistsError:
                pass
        descriptor = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                             dir_fd=self.fd)
        return PosixDirectory(descriptor, self.path / name)

    def open(self, name: str, flags: int, mode: int = 0o600) -> int:
        _leaf(name)
        return os.open(name, flags | os.O_NOFOLLOW | getattr(os, "O_NONBLOCK", 0),
                       mode, dir_fd=self.fd)

    def unlink(self, name: str, *, missing_ok: bool = False) -> None:
        _leaf(name)
        try:
            os.unlink(name, dir_fd=self.fd)
        except FileNotFoundError:
            if not missing_ok:
                raise

    def publish(self, pending: str, destination: str) -> None:
        """Publish a verified private copy, never overwrite a concurrent file."""
        _leaf(pending); _leaf(destination)
        try:
            os.link(pending, destination, src_dir_fd=self.fd, dst_dir_fd=self.fd,
                    follow_symlinks=False)
        except OSError as error:
            if error.errno not in (errno.EPERM, errno.EOPNOTSUPP, errno.ENOSYS):
                raise
            # exFAT/FAT and some mounted volumes have no hardlinks. Move the
            # already-fsynced independent copy atomically, with no-replace.
            _rename_exclusive(self.fd, pending, destination)

    def sync(self) -> None:
        os.fsync(self.fd)

    @contextlib.contextmanager
    def lock(self):
        import fcntl
        fcntl.flock(self.fd, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(self.fd, fcntl.LOCK_UN)


class _Closing:
    def __init__(self, value):
        self.value = value

    def __enter__(self):
        return self.value

    def __exit__(self, *args):
        self.value.close()


def _leaf(value: str) -> None:
    if not value or value in (".", "..") or any(c in value for c in ("/", "\\", "\0")):
        raise PathConflict("Expected one original path component")


def _rename_exclusive(descriptor: int, source: str, destination: str) -> None:
    """Native same-directory no-replace fallback; never use POSIX os.rename."""
    libc = ctypes.CDLL(None, use_errno=True)
    if sys.platform == "darwin":
        function = getattr(libc, "renameatx_np", None)
        flag = 0x4  # RENAME_EXCL
    else:
        function = getattr(libc, "renameat2", None)
        flag = 0x1  # RENAME_NOREPLACE
    if function is None:
        raise OSError(errno.ENOTSUP, "This volume needs a native no-replace rename to receive original files")
    function.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    function.restype = ctypes.c_int
    if function(descriptor, os.fsencode(source), descriptor, os.fsencode(destination), flag):
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error), destination)


def open_directory(path: Path):
    path = native(path)
    if os.name == "nt":
        from source_tools.original_object_windows import WindowsDirectory
        return _Closing(WindowsDirectory.from_path(path))
    if os.open not in os.supports_dir_fd or not hasattr(os, "O_NOFOLLOW"):
        raise OSError(errno.ENOTSUP, "This host lacks contained directory-relative file operations")
    return _Closing(PosixDirectory(os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW), path))


@contextlib.contextmanager
def parent(root, name: str, create: bool = False):
    parts = PurePosixPath(name).parts
    with contextlib.ExitStack() as stack:
        directory = stack.enter_context(open_directory(root)) if isinstance(root, (Path, str)) else root
        for part in parts[:-1]:
            directory = stack.enter_context(_Closing(directory.child(part, create)))
        _leaf(parts[-1])
        yield directory, parts[-1]


@contextlib.contextmanager
def receiving_root(destination: Path, dry_run: bool = False):
    destination = native(destination)
    if is_link(destination):
        raise PathConflict("Receiving root must not be a symlink or reparse point")
    if not destination.exists():
        if dry_run:
            raise PathConflict("Create the owned destination before a read-only receiving plan")
        destination.mkdir(parents=True, exist_ok=False)
    destination = destination.resolve(strict=True)
    with open_directory(destination) as directory, directory.lock():
        yield directory


def publish_file(pending: Path, destination: Path) -> None:
    pending, destination = native(pending), native(destination)
    if pending.parent != destination.parent:
        raise ValueError("Original publication requires a same-directory verified private copy")
    with open_directory(destination.parent) as directory:
        directory.publish(pending.name, destination.name)
        directory.sync()
