"""Native Darwin identity for reconnecting an owned scientific worker.

The same libproc ABI is used by the x86_64 and arm64 Mac runtimes.  This
module has no third-party dependency, shells out to no utilities and loads
Darwin libraries only when called on Darwin.  Stored identities contain
hashes of executable/argument bytes, never argument or environment values.

ABI sources: Apple XNU bsd/sys/proc_info.h, bsd/sys/sysctl.h,
bsd/kern/kern_sysctl.c, and libsyscall/wrappers/libproc/libproc.h.
"""
from __future__ import annotations

import ctypes
import errno
from functools import lru_cache
import hashlib
import os
import signal
import struct
import sys
from typing import Any, Mapping
import uuid

SCHEMA = "upstate.macos-process/v1"
_PROC_PIDTBSDINFO = 3
_PROC_PIDPATHINFO_MAXSIZE = 4096
_CTL_KERN = 1
_KERN_PROCARGS2 = 49
_PROC_FLAG_INEXIT = 0x00000004
_SZOMB = 5
_MAX_ARGUMENT_BYTES = 16 * 1024 * 1024
_FIELDS = (
    "schema", "platform", "pid", "start_seconds", "start_microseconds",
    "boot_id", "uid", "real_uid", "process_group", "executable_sha256",
    "command_sha256", "argc",
)


class _ProcBSDInfo(ctypes.Structure):
    # Public proc_bsdinfo, including reserved/alignment fields. Do not pack.
    _fields_ = [
        (name, ctypes.c_uint32) for name in (
            "pbi_flags", "pbi_status", "pbi_xstatus", "pbi_pid", "pbi_ppid",
            "pbi_uid", "pbi_gid", "pbi_ruid", "pbi_rgid", "pbi_svuid",
            "pbi_svgid", "rfu_1",
        )
    ] + [
        ("pbi_comm", ctypes.c_char * 16),
        ("pbi_name", ctypes.c_char * 32),
    ] + [
        (name, ctypes.c_uint32) for name in (
            "pbi_nfiles", "pbi_pgid", "pbi_pjobc", "e_tdev", "e_tpgid",
        )
    ] + [
        ("pbi_nice", ctypes.c_int32),
        ("pbi_start_tvsec", ctypes.c_uint64),
        ("pbi_start_tvusec", ctypes.c_uint64),
    ]


def _argument_identity(data: bytes) -> tuple[int, str]:
    """Hash argc exact NUL-terminated argv entries, excluding env/padding.

    KERN_PROCARGS2 starts with native int argc, the executable path, NUL
    alignment, then argv. Only the nonempty argv[0] used by our Python
    worker is supported. Empty later arguments remain significant.
    """
    if len(data) < 6 or len(data) > _MAX_ARGUMENT_BYTES + 4:
        raise ValueError("Darwin returned an invalid argument buffer")
    argc = struct.unpack_from("=i", data)[0]
    if not 0 < argc <= len(data) - 4:
        raise ValueError("Darwin returned an invalid argument count")
    path_end = data.find(b"\0", 4)
    if path_end <= 4:
        raise ValueError("Darwin returned an incomplete executable prefix")
    start = path_end + 1
    while start < len(data) and data[start] == 0:
        start += 1
    if start == len(data):
        raise ValueError("Darwin returned no worker arguments")
    end = start
    for _ in range(argc):
        terminator = data.find(b"\0", end)
        if terminator < 0:
            raise ValueError("Darwin returned truncated worker arguments")
        end = terminator + 1
    # Length/count binding avoids concatenation ambiguity. Environment values
    # after argv are deliberately neither retained nor included in the hash.
    body = struct.pack("!I", argc) + data[start:end]
    return argc, hashlib.sha256(body).hexdigest()


def _creation(info: _ProcBSDInfo, pid: int) -> tuple[int, ...]:
    if (info.pbi_pid != pid or info.pbi_status == _SZOMB
            or info.pbi_flags & _PROC_FLAG_INEXIT
            or info.pbi_start_tvsec == 0 or info.pbi_start_tvusec >= 1_000_000
            or info.pbi_pgid == 0):
        raise ProcessLookupError(errno.ESRCH, "Darwin worker is no longer active")
    return (info.pbi_pid, info.pbi_start_tvsec, info.pbi_start_tvusec,
            info.pbi_uid, info.pbi_ruid, info.pbi_pgid)


class _DarwinAPI:
    def __init__(self) -> None:
        if (ctypes.sizeof(_ProcBSDInfo) != 136
                or _ProcBSDInfo.pbi_start_tvsec.offset != 120
                or _ProcBSDInfo.pbi_start_tvusec.offset != 128):
            raise RuntimeError("Unsupported Darwin proc_bsdinfo layout")
        self.proc = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)
        self.system = ctypes.CDLL("/usr/lib/libSystem.B.dylib", use_errno=True)
        self.proc.proc_pidinfo.argtypes = [
            ctypes.c_int, ctypes.c_int, ctypes.c_uint64,
            ctypes.c_void_p, ctypes.c_int,
        ]
        self.proc.proc_pidinfo.restype = ctypes.c_int
        self.proc.proc_pidpath.argtypes = [ctypes.c_int, ctypes.c_void_p,
                                          ctypes.c_uint32]
        self.proc.proc_pidpath.restype = ctypes.c_int
        self.system.sysctlbyname.argtypes = [
            ctypes.c_char_p, ctypes.c_void_p, ctypes.POINTER(ctypes.c_size_t),
            ctypes.c_void_p, ctypes.c_size_t,
        ]
        self.system.sysctlbyname.restype = ctypes.c_int
        self.system.sysctl.argtypes = [
            ctypes.POINTER(ctypes.c_int), ctypes.c_uint, ctypes.c_void_p,
            ctypes.POINTER(ctypes.c_size_t), ctypes.c_void_p, ctypes.c_size_t,
        ]
        self.system.sysctl.restype = ctypes.c_int

    @staticmethod
    def _error(operation: str) -> OSError:
        code = ctypes.get_errno() or errno.EIO
        return OSError(code, "Darwin worker identity: " + operation)

    def bsd(self, pid: int) -> _ProcBSDInfo:
        info = _ProcBSDInfo()
        ctypes.set_errno(0)
        count = self.proc.proc_pidinfo(pid, _PROC_PIDTBSDINFO, 0,
                                      ctypes.byref(info), ctypes.sizeof(info))
        if count != ctypes.sizeof(info):
            raise self._error("cannot read complete process information")
        _creation(info, pid)
        return info

    def executable(self, pid: int) -> bytes:
        buffer = ctypes.create_string_buffer(_PROC_PIDPATHINFO_MAXSIZE)
        ctypes.set_errno(0)
        count = self.proc.proc_pidpath(pid, buffer, len(buffer))
        if not 0 < count < len(buffer):
            raise self._error("cannot read executable identity")
        # libproc returns strlen(path), without the NUL terminator.
        if buffer.raw[count] != 0 or b"\0" in buffer.raw[:count]:
            raise ValueError("Darwin returned an incomplete executable path")
        return buffer.raw[:count]

    def named(self, name: bytes, capacity: int) -> bytes:
        buffer = ctypes.create_string_buffer(capacity)
        size = ctypes.c_size_t(capacity)
        ctypes.set_errno(0)
        if self.system.sysctlbyname(name, buffer, ctypes.byref(size), None, 0):
            raise self._error("cannot read " + name.decode("ascii"))
        if not 0 < size.value <= capacity:
            raise ValueError("Darwin returned an invalid system identity size")
        return buffer.raw[:size.value]

    def boot_id(self) -> str:
        value = self.named(b"kern.bootsessionuuid", 64)
        if not value.endswith(b"\0"):
            raise ValueError("Darwin returned an incomplete boot session")
        return str(uuid.UUID(value[:-1].decode("ascii")))

    def arguments(self, pid: int) -> tuple[int, str]:
        raw_limit = self.named(b"kern.argmax", ctypes.sizeof(ctypes.c_int))
        if len(raw_limit) != ctypes.sizeof(ctypes.c_int):
            raise ValueError("Darwin returned an incomplete argument limit")
        limit = struct.unpack("=i", raw_limit)[0]
        if not 4 <= limit <= _MAX_ARGUMENT_BYTES:
            raise ValueError("Darwin returned an unsupported argument limit")
        # The kernel subtracts sizeof(int) before its ARG_MAX comparison.
        # Supplying ARG_MAX + sizeof(int) prevents truncating a full stack.
        buffer = ctypes.create_string_buffer(limit + 4)
        size = ctypes.c_size_t(len(buffer))
        mib = (ctypes.c_int * 3)(_CTL_KERN, _KERN_PROCARGS2, pid)
        ctypes.set_errno(0)
        if self.system.sysctl(mib, 3, buffer, ctypes.byref(size), None, 0):
            raise self._error("cannot read original worker arguments")
        if not 0 < size.value <= len(buffer):
            raise ValueError("Darwin returned an invalid worker argument size")
        return _argument_identity(buffer.raw[:size.value])


@lru_cache(maxsize=1)
def _api() -> _DarwinAPI:
    return _DarwinAPI()


def process_identity(pid: int | None = None) -> dict[str, Any] | None:
    """Read one live Darwin identity; unavailable/changed processes return None.

    Kernel creation information brackets two executable/argv observations.
    Scheduling-state changes are ignored; a new PID incarnation, credential,
    process group, executable or command makes the observation unusable.
    """
    if sys.platform != "darwin":
        return None
    if pid is None:
        pid = os.getpid()
    if type(pid) is not int or not 0 < pid <= 2_147_483_647:
        return None
    try:
        api = _api()
        before = _creation(api.bsd(pid), pid)
        boot_id = api.boot_id()
        executable = api.executable(pid)
        arguments = api.arguments(pid)
        if (api.executable(pid) != executable or api.arguments(pid) != arguments
                or _creation(api.bsd(pid), pid) != before):
            return None
        return dict(zip(_FIELDS, (
            SCHEMA, "darwin", pid, before[1], before[2], boot_id,
            before[3], before[4], before[5],
            hashlib.sha256(executable).hexdigest(), arguments[1], arguments[0],
        )))
    except (OSError, ValueError, UnicodeError):
        return None


def identity_matches(expected: Mapping[str, Any] | None) -> bool:
    """Reconnect only the exact retained Darwin process-group leader."""
    if (not isinstance(expected, Mapping) or expected.get("schema") != SCHEMA
            or expected.get("platform") != "darwin"
            or type(expected.get("pid")) is not int
            or expected["pid"] <= 1
            or type(expected.get("process_group")) is not int
            or expected["process_group"] != expected["pid"]):
        return False
    current = process_identity(expected["pid"])
    return bool(current and all(
        key in expected and type(expected[key]) is type(current[key])
        and expected[key] == current[key] for key in _FIELDS
    ))


def signal_owned(expected: Mapping[str, Any], signum: int) -> bool:
    """Signal a freshly matched owned POSIX group, retaining normal escalation.

    The caller retains its existing execution-bound signal receipt/lock.
    This is a last identity read immediately before the group operation,
    not a replacement supervisor or a PID-only termination fallback.
    """
    if sys.platform != "darwin":
        return False
    if signum not in (signal.SIGINT, signal.SIGTERM, signal.SIGKILL):
        raise ValueError("Choose an existing native worker stop stage")
    if not identity_matches(expected):
        return False
    try:
        os.killpg(expected["process_group"], signum)
    except ProcessLookupError:
        return False
    return True
