"""Windows directory-handle backend for exact original-object receiving.

Child opens use NtCreateFile/OBJECT_ATTRIBUTES.RootDirectory, not checked string
joins. Final reparse points are rejected before reading or writing. Publication
renames an already verified independent copy with ReplaceIfExists=false, so
NTFS, FAT and exFAT do not need a hardlink capability. File/lock identities reuse
model.windows_fs; no monkeypatches or global runtime changes.
"""
from __future__ import annotations

import contextlib
import ctypes
from ctypes import wintypes
import errno
import hashlib
import msvcrt
import os
from pathlib import Path

from model import windows_fs

_kernel = ctypes.WinDLL("kernel32", use_last_error=True)
_ntdll = ctypes.WinDLL("ntdll")
_U32 = ctypes.c_uint32
_HANDLE = ctypes.c_void_p
_SYNCHRONIZE = 0x00100000
_READ_ATTRIBUTES = 0x80
_DELETE = 0x00010000
_OPEN_REPARSE = 0x00200000
_SYNC_IO = 0x20


class _UnicodeString(ctypes.Structure):
    _fields_ = [("Length", ctypes.c_uint16), ("MaximumLength", ctypes.c_uint16),
                ("Buffer", ctypes.c_void_p)]


class _ObjectAttributes(ctypes.Structure):
    _fields_ = [("Length", _U32), ("RootDirectory", _HANDLE),
                ("ObjectName", ctypes.POINTER(_UnicodeString)), ("Attributes", _U32),
                ("SecurityDescriptor", ctypes.c_void_p),
                ("SecurityQualityOfService", ctypes.c_void_p)]


class _Status(ctypes.Union):
    _fields_ = [("Status", ctypes.c_int32), ("Pointer", ctypes.c_void_p)]


class _IoStatus(ctypes.Structure):
    _fields_ = [("Result", _Status), ("Information", ctypes.c_size_t)]


class _AttributeTag(ctypes.Structure):
    _fields_ = [("FileAttributes", _U32), ("ReparseTag", _U32)]


class _FileInfo(ctypes.Structure):
    _fields_ = [("FileAttributes", _U32), ("CreationTime", wintypes.FILETIME),
                ("LastAccessTime", wintypes.FILETIME), ("LastWriteTime", wintypes.FILETIME),
                ("VolumeSerialNumber", _U32), ("FileSizeHigh", _U32), ("FileSizeLow", _U32),
                ("NumberOfLinks", _U32), ("FileIndexHigh", _U32), ("FileIndexLow", _U32)]


class _RenameInfo(ctypes.Structure):
    # The BOOLEAN/Flags union is four bytes; normal C pointer alignment follows.
    _fields_ = [("Flags", _U32), ("RootDirectory", _HANDLE),
                ("FileNameLength", _U32), ("FileName", ctypes.c_uint16 * 1)]


class _Disposition(ctypes.Structure):
    _fields_ = [("DeleteFile", ctypes.c_ubyte)]


_kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, _U32, _U32, ctypes.c_void_p, _U32, _U32, _HANDLE]
_kernel.CreateFileW.restype = _HANDLE
_kernel.CloseHandle.argtypes = [_HANDLE]
_kernel.CloseHandle.restype = wintypes.BOOL
_kernel.GetFileInformationByHandleEx.argtypes = [_HANDLE, ctypes.c_int, ctypes.c_void_p, _U32]
_kernel.GetFileInformationByHandleEx.restype = wintypes.BOOL
_kernel.GetFileInformationByHandle.argtypes = [_HANDLE, ctypes.POINTER(_FileInfo)]
_kernel.GetFileInformationByHandle.restype = wintypes.BOOL
_kernel.SetFileInformationByHandle.argtypes = [_HANDLE, ctypes.c_int, ctypes.c_void_p, _U32]
_kernel.SetFileInformationByHandle.restype = wintypes.BOOL
_kernel.FlushFileBuffers.argtypes = [_HANDLE]
_kernel.FlushFileBuffers.restype = wintypes.BOOL
_ntdll.NtCreateFile.argtypes = [ctypes.POINTER(_HANDLE), _U32, ctypes.POINTER(_ObjectAttributes),
                              ctypes.POINTER(_IoStatus), ctypes.c_void_p, _U32, _U32, _U32,
                              _U32, ctypes.c_void_p, _U32]
_ntdll.NtCreateFile.restype = ctypes.c_int32
_ntdll.RtlNtStatusToDosError.argtypes = [ctypes.c_int32]
_ntdll.RtlNtStatusToDosError.restype = _U32


def _error(path, code=None):
    code = ctypes.get_last_error() if code is None else code
    if code in (2, 3):
        return FileNotFoundError(errno.ENOENT, ctypes.FormatError(code), str(path))
    if code in (80, 183):
        return FileExistsError(errno.EEXIST, ctypes.FormatError(code), str(path))
    if code == 267:
        return NotADirectoryError(errno.ENOTDIR, ctypes.FormatError(code), str(path))
    if code in (32, 33):
        return BlockingIOError(errno.EAGAIN, ctypes.FormatError(code), str(path))
    return ctypes.WinError(code)


def _attributes(handle, path, *, directory: bool):
    info = _AttributeTag()
    if not _kernel.GetFileInformationByHandleEx(handle, 9, ctypes.byref(info), ctypes.sizeof(info)):
        raise _error(path)
    if info.FileAttributes & 0x400:
        raise OSError(errno.ELOOP, "Original destination must not traverse a reparse point", str(path))
    is_directory = bool(info.FileAttributes & 0x10)
    if directory and not is_directory:
        raise NotADirectoryError(errno.ENOTDIR, "Original parent is not a directory", str(path))
    if not directory and is_directory:
        raise IsADirectoryError(errno.EISDIR, "Original file is a directory", str(path))


def _leaf(name: str) -> None:
    if not name or name in (".", "..") or any(c in name for c in ("/", "\\", "\0", ":")):
        raise ValueError("Expected one contained Windows component")


class WindowsDirectory:
    def __init__(self, handle, path: Path):
        self.handle = handle
        self.path = path

    @classmethod
    def from_path(cls, path: Path):
        path = windows_fs.native_path(path)
        # Deny rename/deletion of this directory while an operation owns it.
        handle = _kernel.CreateFileW(str(path), _READ_ATTRIBUTES | _SYNCHRONIZE | 0x21,
                                    1, None, 3, _OPEN_REPARSE | 0x02000000, None)
        if handle == ctypes.c_void_p(-1).value:
            raise _error(path)
        try:
            _attributes(handle, path, directory=True)
            return cls(handle, path)
        except BaseException:
            _kernel.CloseHandle(handle)
            raise

    def close(self) -> None:
        if self.handle is not None:
            _kernel.CloseHandle(self.handle)
            self.handle = None

    def _open(self, name: str, access: int, *, directory: bool = False,
              disposition: int = 1, share: int = 3):
        _leaf(name)
        data = name.encode("utf-16-le")
        if len(data) > 510:
            raise OSError(errno.ENAMETOOLONG, "Original component exceeds 255 UTF-16 units", name)
        buffer = ctypes.create_unicode_buffer(name)
        text = _UnicodeString(len(data), len(data) + 2, ctypes.cast(buffer, ctypes.c_void_p))
        attrs = _ObjectAttributes(ctypes.sizeof(_ObjectAttributes), self.handle,
                                  ctypes.pointer(text), 0x40, None, None)
        result, status = _HANDLE(), _IoStatus()
        options = _OPEN_REPARSE | _SYNC_IO | (0x1 if directory else 0x40)
        outcome = _ntdll.NtCreateFile(ctypes.byref(result), access | _READ_ATTRIBUTES | _SYNCHRONIZE,
                    ctypes.byref(attrs), ctypes.byref(status), None, 0x80, share,
                    disposition, options, None, 0)
        if outcome < 0:
            raise _error(self.path / name, _ntdll.RtlNtStatusToDosError(outcome))
        try:
            _attributes(result, self.path / name, directory=directory)
            return result.value
        except BaseException:
            _kernel.CloseHandle(result)
            raise

    def child(self, name: str, create: bool = False):
        handle = self._open(name, _READ_ATTRIBUTES | 0x21, directory=True,
                            disposition=3 if create else 1, share=1)
        return WindowsDirectory(handle, self.path / name)

    def open(self, name: str, flags: int, mode: int = 0o600) -> int:
        access_mode = flags & (os.O_WRONLY | os.O_RDWR)
        access = 0xC0000000 if access_mode == os.O_RDWR else 0x40000000 if access_mode == os.O_WRONLY else 0x80000000
        disposition = 2 if flags & os.O_EXCL else 3 if flags & os.O_CREAT else 1
        handle = self._open(name, access, disposition=disposition)
        try:
            descriptor = msvcrt.open_osfhandle(handle, access_mode | os.O_BINARY)
        except BaseException:
            _kernel.CloseHandle(handle)
            raise
        try:
            if flags & os.O_TRUNC:
                os.ftruncate(descriptor, 0)
        except BaseException:
            os.close(descriptor)
            raise
        return descriptor

    def publish(self, pending: str, destination: str) -> None:
        _leaf(pending); _leaf(destination)
        handle = self._open(pending, 0xC0000000 | _DELETE)
        try:
            raw_name = destination.encode("utf-16-le")
            size = max(ctypes.sizeof(_RenameInfo), _RenameInfo.FileName.offset + len(raw_name) + 2)
            buffer = ctypes.create_string_buffer(size)
            info = _RenameInfo.from_buffer(buffer)
            info.Flags = 0  # ReplaceIfExists=false. Never use the replacement flag.
            info.RootDirectory = self.handle
            info.FileNameLength = len(raw_name)
            ctypes.memmove(ctypes.addressof(buffer) + _RenameInfo.FileName.offset,
                           raw_name, len(raw_name))
            if not _kernel.SetFileInformationByHandle(handle, 3, buffer, size):
                raise _error(self.path / destination)
            if not _kernel.FlushFileBuffers(handle):
                raise _error(self.path / destination)
        finally:
            _kernel.CloseHandle(handle)

    def unlink(self, name: str, *, missing_ok: bool = False) -> None:
        try:
            handle = self._open(name, _DELETE | _READ_ATTRIBUTES, share=7)
        except FileNotFoundError:
            if missing_ok:
                return
            raise
        try:
            disposition = _Disposition(1)
            if not _kernel.SetFileInformationByHandle(handle, 4, ctypes.byref(disposition),
                                                       ctypes.sizeof(disposition)):
                raise _error(self.path / name)
        finally:
            _kernel.CloseHandle(handle)

    def sync(self) -> None:
        # Windows offers no unprivileged POSIX directory-fsync equivalent.
        # Verified body fsync and a flushed no-replace rename precede this.
        _attributes(self.handle, self.path, directory=True)

    @contextlib.contextmanager
    def lock(self):
        info = _FileInfo()
        if not _kernel.GetFileInformationByHandle(self.handle, ctypes.byref(info)):
            raise _error(self.path)
        key = hashlib.sha256((str(info.VolumeSerialNumber) + ":" +
            str((info.FileIndexHigh << 32) | info.FileIndexLow)).encode("ascii")).hexdigest()
        # A stable sibling lock does not become an unrequested source member.
        # Do not unlink it: openers waiting on the old inode must stay serialized.
        parent = WindowsDirectory.from_path(self.path.parent)
        descriptor = None
        try:
            descriptor = parent.open(".source-objects-lock-" + key, os.O_CREAT | os.O_RDWR)
            windows_fs.flock(descriptor, windows_fs.LOCK_EX)
            try:
                yield
            finally:
                windows_fs.flock(descriptor, windows_fs.LOCK_UN)
        finally:
            if descriptor is not None:
                os.close(descriptor)
            parent.close()
