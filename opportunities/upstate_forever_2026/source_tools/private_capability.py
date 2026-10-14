"""Read one private operator capability without changing filesystem permissions.

POSIX keeps owner/mode validation. Windows examines the opened file's owner and
DACL, permitting only its owner and the operating system's privileged accounts.
No shell, global account configuration, credential logging, or new dependency.
"""
from __future__ import annotations

import os
import stat

_PRIVATE = "The capability file must be an ordinary owner-only file."


def _windows_descriptor(path):
    import ctypes as c
    from ctypes import wintypes as w
    import msvcrt

    kernel = c.WinDLL("kernel32", use_last_error=True)
    security = c.WinDLL("advapi32", use_last_error=True)
    pointer = c.c_void_p
    pp = c.POINTER(pointer)

    def api(dll, name, arguments, result=w.BOOL):
        function = getattr(dll, name)
        function.argtypes, function.restype = arguments, result
        return function

    create = api(kernel, "CreateFileW", [w.LPCWSTR, w.DWORD, w.DWORD, pointer,
                 w.DWORD, w.DWORD, w.HANDLE], w.HANDLE)
    close = api(kernel, "CloseHandle", [w.HANDLE])
    free = api(kernel, "LocalFree", [pointer], pointer)
    attributes = api(kernel, "GetFileInformationByHandleEx",
                     [w.HANDLE, c.c_int, pointer, w.DWORD])
    process = api(kernel, "GetCurrentProcess", [], w.HANDLE)
    open_token = api(security, "OpenProcessToken",
                     [w.HANDLE, w.DWORD, c.POINTER(w.HANDLE)])
    token_info = api(security, "GetTokenInformation",
                     [w.HANDLE, c.c_int, pointer, w.DWORD, c.POINTER(w.DWORD)])
    file_security = api(security, "GetSecurityInfo",
                         [w.HANDLE, c.c_int, w.DWORD, pp, pp, pp, pp, pp], w.DWORD)
    get_ace = api(security, "GetAce", [pointer, w.DWORD, pp])
    sid_text = api(security, "ConvertSidToStringSidW", [pointer, pp])

    class Attributes(c.Structure):
        _fields_ = [("attributes", w.DWORD), ("reparse_tag", w.DWORD)]

    class TokenUser(c.Structure):
        _fields_ = [("sid", pointer), ("attributes", w.DWORD)]

    class ACL(c.Structure):
        _fields_ = [("revision", w.BYTE), ("reserved", w.BYTE),
                    ("size", w.WORD), ("count", w.WORD), ("reserved2", w.WORD)]

    class ACE(c.Structure):
        _fields_ = [("kind", w.BYTE), ("flags", w.BYTE),
                    ("size", w.WORD), ("mask", w.DWORD)]

    def sid(value):
        text = pointer()
        if not value or not sid_text(value, c.byref(text)):
            raise c.WinError(c.get_last_error())
        try:
            return c.wstring_at(text)
        finally:
            free(text)

    name = os.path.abspath(os.fspath(path))
    if not name.startswith("\\\\?\\"):
        name = "\\\\?\\UNC\\" + name[2:] if name.startswith("\\\\") else "\\\\?\\" + name
    # GENERIC_READ includes READ_CONTROL. Deny simultaneous writers/deleters;
    # FILE_FLAG_OPEN_REPARSE_POINT opens the link itself so it can be rejected.
    handle = create(name, 0x80000000, 1, None, 3, 0x00200000 | 0x02000000, None)
    if handle == pointer(-1).value:
        raise c.WinError(c.get_last_error())
    token, descriptor = w.HANDLE(), pointer()
    try:
        info = Attributes()
        if not attributes(handle, 9, c.byref(info), c.sizeof(info)):
            raise c.WinError(c.get_last_error())
        if info.attributes & (0x10 | 0x400):
            raise ValueError(_PRIVATE)
        if not open_token(process(), 8, c.byref(token)):
            raise c.WinError(c.get_last_error())
        size = w.DWORD()
        token_info(token, 1, None, 0, c.byref(size))
        if not size.value:
            raise c.WinError(c.get_last_error())
        buffer = c.create_string_buffer(size.value)
        if not token_info(token, 1, buffer, size.value, c.byref(size)):
            raise c.WinError(c.get_last_error())
        current_user = sid(c.cast(buffer, c.POINTER(TokenUser)).contents.sid)
        owner, dacl = pointer(), pointer()
        error = file_security(handle, 1, 1 | 4, c.byref(owner), None,
                              c.byref(dacl), None, c.byref(descriptor))
        if error:
            raise c.WinError(error)
        if not dacl.value or sid(owner) != current_user:
            raise ValueError(_PRIVATE)
        trusted = {current_user, "S-1-5-18", "S-1-5-32-544"}  # SYSTEM and Administrators
        # File data access, generic data rights, delete, and ACL/owner mutation.
        sensitive = 0xF0000000 | 0x000D0000 | 0x00000007
        for index in range(c.cast(dacl, c.POINTER(ACL)).contents.count):
            entry = pointer()
            if not get_ace(dacl, index, c.byref(entry)):
                raise c.WinError(c.get_last_error())
            ace = c.cast(entry, c.POINTER(ACE)).contents
            if ace.flags & 0x08 or ace.kind in (1, 6, 10, 12):
                continue  # Inherit-only entries and denial entries grant no access here.
            if ace.kind != 0 or ace.size < c.sizeof(ACE) + 8:
                raise ValueError(_PRIVATE)
            if ace.mask & sensitive and sid(entry.value + c.sizeof(ACE)) not in trusted:
                raise ValueError(_PRIVATE)
        fd = msvcrt.open_osfhandle(handle, os.O_RDONLY | os.O_BINARY)
        handle = None  # The CRT descriptor now owns exactly the validated handle.
        return fd
    finally:
        if descriptor.value:
            free(descriptor)
        if token.value:
            close(token)
        if handle is not None:
            close(handle)


def read_private_file(path, *, limit=4096):
    """Validate the opened file before reading, retaining the bounded byte contract."""
    if type(limit) is not int or limit < 1:
        raise ValueError("A positive private-file byte limit is required.")
    if os.name == "nt":
        fd = _windows_descriptor(path)
    else:
        flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
        flags |= getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
        fd = os.open(path, flags)
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise ValueError(_PRIVATE)
        if os.name != "nt" and (before.st_uid != os.geteuid()
                                or stat.S_IMODE(before.st_mode) & 0o077):
            raise ValueError(_PRIVATE + " Use mode 0600 or 0400.")
        raw = stream.read(limit + 1)
        after = os.fstat(stream.fileno())
        if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
                after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            raise ValueError("The capability file changed while it was being read.")
        if len(raw) > limit:
            raise ValueError("The capability file must contain only the current operator capability.")
    return raw
