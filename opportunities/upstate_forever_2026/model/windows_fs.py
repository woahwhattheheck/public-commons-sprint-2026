"""Win32 file handles and process locks for the received Windows operator.

This is a local receiving compatibility patch; the scientific source is unchanged.
POSIX callers retain their existing implementations. Windows publication flushes
file bodies and uses write-through replacement. Windows has no unprivileged
directory fsync equivalent; sync_directory validates the directory handle only.
"""
from __future__ import annotations

import ctypes
from ctypes import wintypes
import errno
import msvcrt
import os
from pathlib import Path
from types import SimpleNamespace

LOCK_SH, LOCK_EX, LOCK_NB, LOCK_UN = 1, 2, 4, 8
NOFOLLOW = getattr(os, "O_NOFOLLOW", 0)
NONBLOCK = getattr(os, "O_NONBLOCK", 0)
_kernel = ctypes.WinDLL("kernel32", use_last_error=True)
_invalid = ctypes.c_void_p(-1).value

class _Overlapped(ctypes.Structure):
    _fields_ = [("Internal", ctypes.c_size_t), ("InternalHigh", ctypes.c_size_t),
                ("Offset", wintypes.DWORD), ("OffsetHigh", wintypes.DWORD),
                ("hEvent", wintypes.HANDLE)]

class _AttributeTag(ctypes.Structure):
    _fields_ = [("FileAttributes", wintypes.DWORD), ("ReparseTag", wintypes.DWORD)]

class _BasicInfo(ctypes.Structure):
    _fields_ = [("CreationTime", ctypes.c_longlong), ("LastAccessTime", ctypes.c_longlong),
                ("LastWriteTime", ctypes.c_longlong), ("ChangeTime", ctypes.c_longlong),
                ("FileAttributes", wintypes.DWORD)]

_kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
    ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
_kernel.CreateFileW.restype = wintypes.HANDLE
_kernel.CloseHandle.argtypes = [wintypes.HANDLE]
_kernel.GetFileInformationByHandleEx.argtypes = [wintypes.HANDLE, ctypes.c_int,
    ctypes.c_void_p, wintypes.DWORD]
_kernel.LockFileEx.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.DWORD,
    wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(_Overlapped)]
_kernel.UnlockFileEx.argtypes = [wintypes.HANDLE, wintypes.DWORD,
    wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(_Overlapped)]
_kernel.MoveFileExW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD]

def _failure(path=None):
    error = ctypes.get_last_error()
    if error in (2, 3):
        return FileNotFoundError(errno.ENOENT, ctypes.FormatError(error), str(path))
    if error in (80, 183):
        return FileExistsError(errno.EEXIST, ctypes.FormatError(error), str(path))
    if error in (32, 33):
        return BlockingIOError(errno.EAGAIN, ctypes.FormatError(error), str(path))
    return ctypes.WinError(error)

def _attributes(handle, path):
    info = _AttributeTag()
    if not _kernel.GetFileInformationByHandleEx(handle, 9, ctypes.byref(info), ctypes.sizeof(info)):
        raise _failure(path)
    if info.FileAttributes & 0x400:
        raise OSError(errno.ELOOP, "A reparse point is not an original regular file", str(path))
    return info.FileAttributes

def no_follow_open(path, flags, mode=0o600):
    """Open the final component itself and reject every Win32 reparse point."""
    access_mode = flags & (os.O_WRONLY | os.O_RDWR)
    access = 0xC0000000 if access_mode == os.O_RDWR else (0x40000000 if access_mode == os.O_WRONLY else 0x80000000)
    creation = 1 if flags & os.O_EXCL else (4 if flags & os.O_CREAT else 3)
    handle = _kernel.CreateFileW(str(Path(path).absolute()), access, 7, None,
        creation, 0x00200000 | 0x02000000, None)
    if handle == _invalid:
        raise _failure(path)
    try:
        if _attributes(handle, path) & 0x10:
            raise IsADirectoryError(errno.EISDIR, "Choose an original regular file", str(path))
        descriptor = msvcrt.open_osfhandle(handle, access_mode | os.O_BINARY)
        handle = None
        try:
            if flags & os.O_TRUNC:
                os.ftruncate(descriptor, 0)
        except BaseException:
            os.close(descriptor)
            raise
        return descriptor
    finally:
        if handle is not None:
            _kernel.CloseHandle(handle)

def flock(file, operation):
    """Whole-file byte-range lock, shared or exclusive, released by handle close."""
    descriptor = file.fileno() if hasattr(file, "fileno") else file
    handle = wintypes.HANDLE(msvcrt.get_osfhandle(descriptor))
    overlap = _Overlapped()
    if operation & LOCK_UN:
        ok = _kernel.UnlockFileEx(handle, 0, 0xFFFFFFFF, 0xFFFFFFFF, ctypes.byref(overlap))
    else:
        flags = (2 if operation & LOCK_EX else 0) | (1 if operation & LOCK_NB else 0)
        ok = _kernel.LockFileEx(handle, flags, 0, 0xFFFFFFFF, 0xFFFFFFFF, ctypes.byref(overlap))
    if not ok:
        raise _failure()

def fd_stat(descriptor):
    """Use one native ChangeTime meaning for both path and descriptor checks.

    Python 3.12 on Windows can report creation time for path st_ctime and change
    time for CRT fstat. Native ChangeTime retains the mutation check rather than
    ignoring the mismatched field or substituting a weaker creation timestamp.
    """
    original = os.fstat(descriptor)
    handle = wintypes.HANDLE(msvcrt.get_osfhandle(descriptor))
    info = _BasicInfo()
    if not _kernel.GetFileInformationByHandleEx(handle, 0, ctypes.byref(info), ctypes.sizeof(info)):
        raise _failure()
    fields = {name: getattr(original, name) for name in
        ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_mode", "st_nlink")}
    fields["st_ctime_ns"] = info.ChangeTime * 100 - 11644473600000000000
    return SimpleNamespace(**fields)

def path_stat(path):
    descriptor = no_follow_open(path, os.O_RDONLY)
    try:
        return fd_stat(descriptor)
    finally:
        os.close(descriptor)

def replace(source, destination):
    if not _kernel.MoveFileExW(str(Path(source).absolute()), str(Path(destination).absolute()), 1 | 8):
        raise _failure(destination)

def sync_directory(path):
    """Validate the publish directory; body fsync/write-through rename precedes it."""
    handle = _kernel.CreateFileW(str(Path(path).absolute()), 0, 7, None, 3,
        0x00200000 | 0x02000000, None)
    if handle == _invalid:
        raise _failure(path)
    try:
        if not _attributes(handle, path) & 0x10:
            raise NotADirectoryError(errno.ENOTDIR, "Publish parent is not a directory", str(path))
    finally:
        _kernel.CloseHandle(handle)
