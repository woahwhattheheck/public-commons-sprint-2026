"""Host file primitives for the same scientific workspace on POSIX and Windows."""
from __future__ import annotations

import contextlib
import errno
import os
from pathlib import Path
import stat
import time


def open_regular(path, flags, mode=0o600):
    """Open the leaf itself and require a regular file; never follow a symlink."""
    if os.name == "nt":
        return _windows_open(path, flags)
    descriptor = os.open(path, flags | os.O_NOFOLLOW | os.O_NONBLOCK, mode)
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise ValueError("Workspace member is not a regular file: " + str(path))
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def stat_regular(path):
    """Use consistent handle metadata when binding a Windows path to its stream.

    Python 3.12 Windows lstat reports birth time as ctime while fstat exposes
    change time. Reopen the leaf without following reparse points so the
    existing inode/size/change-time comparison keeps its original strength.
    """
    if os.name != "nt":
        return Path(path).lstat()
    descriptor = open_regular(path, os.O_RDONLY)
    try:
        return os.fstat(descriptor)
    finally:
        os.close(descriptor)


def _windows_open(path, flags):
    import ctypes
    from ctypes import wintypes
    import msvcrt

    if flags & (os.O_TRUNC | os.O_APPEND):
        raise ValueError("Workspace opens cannot truncate or append through a retained alias")
    access = 0x80000000  # GENERIC_READ
    if flags & os.O_RDWR:
        access |= 0x40000000
    elif flags & os.O_WRONLY:
        access = 0x40000000
    disposition = 1 if flags & os.O_CREAT and flags & os.O_EXCL else (
        4 if flags & os.O_CREAT else 3)  # CREATE_NEW / OPEN_ALWAYS / OPEN_EXISTING
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    create = kernel.CreateFileW
    create.argtypes = (wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                       wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD,
                       wintypes.HANDLE)
    create.restype = wintypes.HANDLE
    close = kernel.CloseHandle
    close.argtypes = (wintypes.HANDLE,)
    close.restype = wintypes.BOOL
    handle = create(str(Path(path).absolute()), access, 7, None, disposition,
                    0x00200000, None)  # OPEN_REPARSE_POINT, share read/write/delete
    if handle == ctypes.c_void_p(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    descriptor = None
    try:
        class Attributes(ctypes.Structure):
            _fields_ = (("attributes", wintypes.DWORD), ("tag", wintypes.DWORD))
        information = Attributes()
        inspect = kernel.GetFileInformationByHandleEx
        inspect.argtypes = (wintypes.HANDLE, ctypes.c_int, wintypes.LPVOID,
                            wintypes.DWORD)
        inspect.restype = wintypes.BOOL
        if not inspect(handle, 9, ctypes.byref(information), ctypes.sizeof(information)):
            raise ctypes.WinError(ctypes.get_last_error())
        if information.attributes & 0x400:  # FILE_ATTRIBUTE_REPARSE_POINT
            raise OSError(errno.ELOOP, "Workspace leaf is a reparse point", str(path))
        if information.attributes & 0x10:  # FILE_ATTRIBUTE_DIRECTORY
            raise ValueError("Workspace member is not a regular file: " + str(path))
        crt_flags = (flags & (os.O_RDONLY | os.O_WRONLY | os.O_RDWR)) | os.O_BINARY | os.O_NOINHERIT
        descriptor = msvcrt.open_osfhandle(handle, crt_flags)
        handle = None  # The CRT descriptor now owns the handle.
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise ValueError("Workspace member is not a regular file: " + str(path))
        return descriptor
    except BaseException:
        if descriptor is not None:
            os.close(descriptor)
        raise
    finally:
        if handle is not None:
            close(handle)


@contextlib.contextmanager
def exclusive_file(path, *, blocking=True):
    """Hold an actual cross-process exclusive lock until this context exits."""
    descriptor = open_regular(path, os.O_CREAT | os.O_RDWR)
    acquired = False
    try:
        if os.name == "nt":
            import msvcrt
            os.lseek(descriptor, 0, os.SEEK_SET)
            while True:
                try:
                    # Lock a byte beyond EOF without changing original lock bytes.
                    msvcrt.locking(descriptor, msvcrt.LK_NBLCK, 1)
                    acquired = True
                    break
                except OSError as error:
                    if error.errno not in (errno.EACCES, errno.EAGAIN, errno.EDEADLK):
                        raise
                    if not blocking:
                        raise BlockingIOError(errno.EAGAIN, "Workspace is locked", str(path)) from error
                    time.sleep(0.05)
        else:
            import fcntl
            fcntl.flock(descriptor, fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB))
            acquired = True
        yield
    finally:
        try:
            if acquired and os.name == "nt":
                import msvcrt
                os.lseek(descriptor, 0, os.SEEK_SET)
                msvcrt.locking(descriptor, msvcrt.LK_UNLCK, 1)
        finally:
            os.close(descriptor)


def sync_directory(path):
    """Flush POSIX directory metadata; Windows retains flushed-file atomic writes.

    Windows' ordinary file API does not expose POSIX directory fsync. Return
    False there rather than pretending an equivalent metadata flush occurred.
    File contents are still fsynced before every atomic publication.
    """
    if os.name == "nt":
        return False
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    return True
