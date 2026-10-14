"""Shared durable filesystem operations for Windows, macOS and Linux.

Scientific values and logical source names do not change here. Windows uses the
existing windows_fs handle/lock implementation; POSIX keeps descriptor-relative
no-follow operations. Immutable publication never replaces an existing target.
"""
from __future__ import annotations

from contextlib import contextmanager
import ctypes
import errno
import hashlib
import os
from pathlib import Path, PurePosixPath
import stat
import sys
import unicodedata
import uuid

if os.name == "nt":
    from . import windows_fs as _locks
else:
    import fcntl as _locks

file_locks = _locks

BLOCK = 1024 * 1024
_NOFOLLOW = getattr(os, "O_NOFOLLOW", 0)
_NONBLOCK = getattr(os, "O_NONBLOCK", 0)
_NO_LINK = {errno.EXDEV, errno.EPERM, errno.ENOSYS, errno.EOPNOTSUPP}
_RESERVED = {"CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"} | {
    prefix + number for prefix in ("COM", "LPT") for number in "123456789\u00b9\u00b2\u00b3"}


def native_path(path):
    return _locks.native_path(path) if os.name == "nt" else Path(path)


def open_file(path, flags, mode=0o600, *, dir_fd=None):
    """Open a regular file without following its final path component."""
    if os.name == "nt":
        if dir_fd is not None:
            raise ValueError("Use parent_directory for Windows relative file operations")
        return _locks.no_follow_open(path, flags, mode)
    descriptor = os.open(path, flags | _NOFOLLOW | _NONBLOCK, mode, dir_fd=dir_fd)
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise OSError(errno.EINVAL, "Expected an original regular file", str(path))
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def fd_stat(descriptor):
    return _locks.fd_stat(descriptor) if os.name == "nt" else os.fstat(descriptor)


def path_stat(path):
    return _locks.path_stat(path) if os.name == "nt" else Path(path).lstat()


def sync_directory(path):
    if os.name == "nt":
        _locks.sync_directory(path)
        return
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | _NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def replace(source, destination):
    """Publish a completed mutable record; callers have already fsynced its body."""
    if os.name == "nt":
        _locks.replace(source, destination)
    else:
        os.replace(source, destination)


@contextmanager
def locked(path, *, blocking=True, shared=False):
    """Same whole-file lock on each platform, with automatic release on exit."""
    path = native_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = open_file(path, os.O_CREAT | os.O_RDWR)
    acquired = False
    try:
        operation = _locks.LOCK_SH if shared else _locks.LOCK_EX
        if not blocking:
            operation |= _locks.LOCK_NB
        _locks.flock(descriptor, operation)
        acquired = True
        yield descriptor
    finally:
        try:
            if acquired:
                _locks.flock(descriptor, _locks.LOCK_UN)
        finally:
            os.close(descriptor)


def relative_name(name, *, windows=None):
    """Reject path aliases, not original bytes; do not silently rename a source."""
    if not isinstance(name, str) or not name or "\\" in name or "\0" in name:
        raise ValueError("Expected a canonical relative source member")
    parts = name.split("/")
    if PurePosixPath(name).is_absolute() or any(p in ("", ".", "..") for p in parts):
        raise ValueError("Source member escapes its receiving directory: " + name)
    # A colon anywhere can address an alternate data stream on Windows.
    if any(":" in p for p in parts):
        raise ValueError("Drive or alternate-stream member name is not portable: " + name)
    if windows is None:
        windows = os.name == "nt"
    if windows:
        for part in parts:
            if (part.endswith((" ", ".")) or any(ord(c) < 32 or c in '<>"|?*' for c in part)
                    or part.split(".", 1)[0].rstrip(" .").upper() in _RESERVED):
                raise ValueError("Windows cannot receive this original member name: " + name)
    return name


def validate_members(names, *, portable=False):
    """Detect file/directory and case/Unicode aliases before any publication."""
    folding = portable or os.name == "nt" or sys.platform == "darwin"
    seen = {}
    for name in names:
        parts = relative_name(name, windows=portable or os.name == "nt").split("/")
        for index in range(1, len(parts) + 1):
            prefix = "/".join(parts[:index])
            key = unicodedata.normalize("NFC", prefix).casefold() if folding else prefix
            kind = "directory" if index < len(parts) else "file"
            previous = seen.get(key)
            if previous is not None and previous != (prefix, kind):
                raise ValueError("Conflicting source destination names: " + previous[0] + " / " + prefix)
            seen[key] = (prefix, kind)


def _rename_new(source, destination, *, src_dir_fd=None, dst_dir_fd=None):
    """Native atomic, create-only rename. Never fall back to replacing rename."""
    if os.name == "nt":
        if src_dir_fd is not None or dst_dir_fd is not None:
            raise ValueError("Windows rename requires pinned directory paths")
        # Deliberately omit REPLACE_EXISTING and COPY_ALLOWED.
        if not _locks._kernel.MoveFileExW(str(native_path(source)), str(native_path(destination)), 8):
            raise _locks._failure(destination)
        return
    libc = ctypes.CDLL(None, use_errno=True)
    if sys.platform.startswith("linux"):
        rename, flag, cwd = getattr(libc, "renameat2", None), 1, -100
    elif sys.platform == "darwin":
        rename, flag, cwd = getattr(libc, "renameatx_np", None), 4, -2
    else:
        rename = None
    if rename is None:
        raise OSError(errno.ENOTSUP, "Atomic create-only rename is unavailable on this filesystem")
    rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    if rename(cwd if src_dir_fd is None else src_dir_fd, os.fsencode(source),
              cwd if dst_dir_fd is None else dst_dir_fd, os.fsencode(destination), flag):
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error), str(destination))


def _identity(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def _copy_new(source, destination, *, src_dir_fd=None, dst_dir_fd=None):
    """Verified same-directory staging for filesystems without hard links."""
    destination = Path(destination)
    pending = destination.with_name(".publish-copy-" + uuid.uuid4().hex)
    source_fd = open_file(source, os.O_RDONLY, dir_fd=src_dir_fd)
    created = False
    try:
        before = fd_stat(source_fd)
        with os.fdopen(os.dup(source_fd), "rb") as incoming:
            descriptor = open_file(pending, os.O_CREAT | os.O_EXCL | os.O_RDWR, dir_fd=dst_dir_fd)
            created = True
            with os.fdopen(descriptor, "w+b") as outgoing:
                digest, size = hashlib.sha256(), 0
                while block := incoming.read(BLOCK):
                    outgoing.write(block)
                    digest.update(block)
                    size += len(block)
                outgoing.flush()
                os.fsync(outgoing.fileno())
                outgoing.seek(0)
                actual = hashlib.sha256()
                while block := outgoing.read(BLOCK):
                    actual.update(block)
                if (size != before.st_size or digest.digest() != actual.digest()
                        or _identity(before) != _identity(fd_stat(source_fd))):
                    raise OSError(errno.ESTALE, "Original changed during verified publication", str(source))
        _rename_new(pending, destination, src_dir_fd=dst_dir_fd, dst_dir_fd=dst_dir_fd)
        created = False
    finally:
        os.close(source_fd)
        if created:
            os.unlink(native_path(pending) if dst_dir_fd is None else pending, dir_fd=dst_dir_fd)


def publish_file(source, destination, *, src_dir_fd=None, dst_dir_fd=None):
    """Create-only publication retaining the source, with verified-copy fallback.

    Like os.link, FileExistsError belongs to the caller's existing idempotency
    policy. Callers synchronize their publication directory after success.
    """
    if src_dir_fd is None:
        source = native_path(source)
    if dst_dir_fd is None:
        destination = native_path(destination)
    try:
        if os.name == "nt":
            if src_dir_fd is not None or dst_dir_fd is not None:
                raise ValueError("Use parent_directory for Windows relative publication")
            _locks.path_stat(source)  # Reject a final reparse point before linking.
            link = _locks._kernel.CreateHardLinkW
            link.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_void_p]
            link.restype = ctypes.c_int
            if not link(str(destination), str(source), None):
                raise _locks._failure(destination)
        else:
            os.link(source, destination, src_dir_fd=src_dir_fd, dst_dir_fd=dst_dir_fd,
                    follow_symlinks=False)
    except OSError as exc:
        if exc.errno not in _NO_LINK and getattr(exc, "winerror", None) not in (1, 17, 50):
            raise
        _copy_new(source, destination, src_dir_fd=src_dir_fd, dst_dir_fd=dst_dir_fd)


def publish_directory(staging, destination):
    _rename_new(native_path(staging), native_path(destination))
    sync_directory(Path(destination).parent)


class _Directory:
    def __init__(self, path, descriptor=None):
        self.path, self.descriptor = path, descriptor

    def open(self, name, flags, mode=0o600):
        relative_name(name)
        if "/" in name:
            raise ValueError("Expected one directory member")
        if os.name == "nt":
            return open_file(self.path / name, flags, mode)
        return open_file(name, flags, mode, dir_fd=self.descriptor)

    def unlink(self, name):
        relative_name(name)
        if "/" in name:
            raise ValueError("Expected one directory member")
        if os.name == "nt":
            os.unlink(native_path(self.path / name))
        else:
            os.unlink(name, dir_fd=self.descriptor)

    def publish(self, source, destination):
        for name in (source, destination):
            relative_name(name)
            if "/" in name:
                raise ValueError("Expected one directory member")
        if os.name == "nt":
            publish_file(self.path / source, self.path / destination)
        else:
            publish_file(source, destination, src_dir_fd=self.descriptor, dst_dir_fd=self.descriptor)

    def sync(self):
        if os.name == "nt":
            sync_directory(self.path)
        else:
            os.fsync(self.descriptor)


@contextmanager
def parent_directory(root, name, *, create=False):
    """Keep all traversed parents pinned while publishing one original member."""
    parts = relative_name(name).split("/")
    root = Path(root).absolute()
    handles = []
    try:
        if os.name == "nt":
            # Open every ancestor without WRITE/DELETE sharing. A junction or
            # rename cannot redirect later path-based Win32 operations while held.
            chain = list(reversed(root.parents)) + [root]
            chain += [root.joinpath(*parts[:i]) for i in range(1, len(parts))]
            for index, path in enumerate(chain):
                if create and index > len(root.parents):
                    try:
                        os.mkdir(native_path(path))
                    except FileExistsError:
                        pass
                handle = _locks._kernel.CreateFileW(str(native_path(path)), 0x80, 1, None, 3,
                    0x00200000 | 0x02000000, None)
                if handle == _locks._invalid:
                    raise _locks._failure(path)
                handles.append(handle)
                if not _locks._attributes(handle, path) & 0x10:
                    raise NotADirectoryError(errno.ENOTDIR, "Expected a source directory", str(path))
            yield _Directory(root.joinpath(*parts[:-1])), parts[-1]
        else:
            flags = os.O_RDONLY | os.O_DIRECTORY | _NOFOLLOW
            handles.append(os.open(root, flags))
            for part in parts[:-1]:
                if create:
                    try:
                        os.mkdir(part, dir_fd=handles[-1])
                    except FileExistsError:
                        pass
                handles.append(os.open(part, flags, dir_fd=handles[-1]))
            yield _Directory(root.joinpath(*parts[:-1]), handles[-1]), parts[-1]
    finally:
        for handle in reversed(handles):
            if os.name == "nt":
                _locks._kernel.CloseHandle(handle)
            else:
                os.close(handle)
