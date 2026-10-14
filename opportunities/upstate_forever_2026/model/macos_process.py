"""Native macOS identity and observations for the existing detached worker.

The Intel and Apple Silicon ABI comes from Apple's xnu bsd/sys/proc_info.h
and libsyscall/wrappers/libproc/libproc.h. KERN_PROCARGS2 is interpreted as
bsd/kern/kern_sysctl.c writes it: argc, executable, alignment, then argv.
Only argument digests leave this module; environment strings are not retained.
No external process, installed package or /proc mount is required.
"""
from __future__ import annotations

import ctypes as c
import errno
from functools import lru_cache
import hashlib
import os
import struct
import sys
import uuid
from collections.abc import Mapping

SCHEMA = "upstate.macos-process/v1"
PROC_PIDTBSDINFO = 3
PROC_PIDTASKINFO = 4
PROC_FLAG_INEXIT = 0x4
SZOMB = 5
_IDENTITY_FIELDS = ("schema", "platform", "pid", "process_group", "session_id",
                    "start_seconds", "start_microseconds", "boot_id", "uid",
                    "executable_sha256", "command_sha256")


class _BSDInfo(c.Structure):
    # Fixed-width Darwin ABI, 136 bytes on both supported 64-bit architectures.
    _fields_ = [(name, c.c_uint32) for name in (
        "flags", "status", "xstatus", "pid", "ppid", "uid", "gid", "ruid",
        "rgid", "svuid", "svgid", "reserved")]
    _fields_ += [("comm", c.c_char * 16), ("name", c.c_char * 32)]
    _fields_ += [(name, c.c_uint32) for name in (
        "nfiles", "pgid", "jobc", "tdev", "tpgid")]
    _fields_ += [("nice", c.c_int32), ("start_seconds", c.c_uint64),
                 ("start_microseconds", c.c_uint64)]


class _TaskInfo(c.Structure):
    _fields_ = [(name, c.c_uint64) for name in (
        "virtual_size", "resident_size", "total_user", "total_system",
        "threads_user", "threads_system")]
    _fields_ += [(name, c.c_int32) for name in (
        "policy", "faults", "pageins", "cow_faults", "messages_sent",
        "messages_received", "syscalls_mach", "syscalls_unix", "csw",
        "threadnum", "numrunning", "priority")]


@lru_cache(maxsize=1)
def _bindings():
    if sys.platform != "darwin":
        raise OSError(errno.ENOSYS, "macOS process inspection requires Darwin")
    if c.sizeof(_BSDInfo) != 136 or c.sizeof(_TaskInfo) != 96:
        raise OSError(errno.ENOSYS, "Unsupported macOS process-information ABI")
    proc = c.CDLL("/usr/lib/libproc.dylib", use_errno=True)
    libc = c.CDLL("/usr/lib/libSystem.B.dylib", use_errno=True)
    proc.proc_pidinfo.argtypes = [c.c_int, c.c_int, c.c_uint64, c.c_void_p, c.c_int]
    proc.proc_pidinfo.restype = c.c_int
    proc.proc_pidpath.argtypes = [c.c_int, c.c_void_p, c.c_uint32]
    proc.proc_pidpath.restype = c.c_int
    libc.sysctl.argtypes = [c.POINTER(c.c_int), c.c_uint, c.c_void_p,
                           c.POINTER(c.c_size_t), c.c_void_p, c.c_size_t]
    libc.sysctl.restype = c.c_int
    libc.sysctlbyname.argtypes = [c.c_char_p, c.c_void_p,
                                 c.POINTER(c.c_size_t), c.c_void_p, c.c_size_t]
    libc.sysctlbyname.restype = c.c_int
    return proc, libc


def _failure(operation):
    # Never put a native buffer (which may include arguments) in an exception.
    number = c.get_errno() or errno.EIO
    return OSError(number, operation + ": " + os.strerror(number))


def _info(pid, kind, structure):
    value = structure()
    c.set_errno(0)
    count = _bindings()[0].proc_pidinfo(pid, kind, 0, c.byref(value), c.sizeof(value))
    if count != c.sizeof(value):
        raise _failure("Reading macOS process information")
    return value


def _executable(pid):
    buffer = c.create_string_buffer(4096)  # PROC_PIDPATHINFO_MAXSIZE.
    c.set_errno(0)
    count = _bindings()[0].proc_pidpath(pid, buffer, len(buffer))
    if count <= 0:
        raise _failure("Reading macOS executable identity")
    raw = buffer.raw
    end = raw.find(b"\0")
    if not 0 < end < len(raw) or count >= len(raw):
        raise ValueError("Incomplete macOS executable identity")
    return raw[:end]


@lru_cache(maxsize=1)
def _boot_id():
    buffer = c.create_string_buffer(64)
    length = c.c_size_t(len(buffer))
    c.set_errno(0)
    if _bindings()[1].sysctlbyname(b"kern.bootsessionuuid", buffer,
                                  c.byref(length), None, 0) != 0:
        raise _failure("Reading macOS boot identity")
    if not 1 < length.value <= len(buffer):
        raise ValueError("Incomplete macOS boot identity")
    value = uuid.UUID(buffer.raw[:length.value].rstrip(b"\0").decode("ascii"))
    if not value.int:
        raise ValueError("Empty macOS boot identity")
    return str(value)


def _command_digest(raw):
    """Hash complete argv, including empty arguments, but not the environment."""
    if len(raw) < 5:
        raise ValueError("Incomplete macOS argument identity")
    argc = struct.unpack_from("=i", raw)[0]
    if not 1 <= argc <= len(raw) - 4:
        raise ValueError("Invalid macOS argument count")
    end = raw.find(b"\0", 4)
    if end <= 4:
        raise ValueError("Missing macOS executable argument")
    digest = hashlib.sha256(b"upstate.macos-argv/v1\0")

    def add(value):
        digest.update(struct.pack(">Q", len(value)))
        digest.update(value)

    add(raw[4:end])
    digest.update(struct.pack(">I", argc))
    cursor = end + 1
    # The kernel's executable-path alignment precedes argv[0]. Native workers
    # always have the nonempty interpreter argv[0] supplied by Popen.
    while cursor < len(raw) and raw[cursor] == 0:
        cursor += 1
    for _ in range(argc):
        end = raw.find(b"\0", cursor)
        if end < 0:
            raise ValueError("Truncated macOS argument identity")
        add(raw[cursor:end])
        cursor = end + 1
    return digest.hexdigest()


def _command(pid):
    libc = _bindings()[1]
    mib = (c.c_int * 3)(1, 49, pid)  # CTL_KERN, KERN_PROCARGS2, pid.
    length = c.c_size_t()
    c.set_errno(0)
    if libc.sysctl(mib, 3, None, c.byref(length), None, 0) != 0:
        raise _failure("Reading macOS argument size")
    # A changed or corrupt size must not cause an unbounded allocation. The
    # current kernel's actual argument limit is checked before the copyout.
    limit = os.sysconf("SC_ARG_MAX") + c.sizeof(c.c_int)
    if not 5 <= length.value <= limit:
        raise ValueError("Invalid macOS argument buffer size")
    buffer = c.create_string_buffer(length.value)
    capacity = len(buffer)
    c.set_errno(0)
    try:
        if libc.sysctl(mib, 3, buffer, c.byref(length), None, 0) != 0:
            raise _failure("Reading macOS argument identity")
        if not 5 <= length.value <= capacity:
            raise ValueError("Changed macOS argument buffer size")
        return _command_digest(buffer.raw[:length.value])
    finally:
        # Do not retain returned environment bytes in the reusable C buffer.
        c.memset(buffer, 0, capacity)


def _creation(value):
    return (value.pid, value.pgid, value.uid,
            value.start_seconds, value.start_microseconds)


def _live(value, pid):
    return (value.pid == pid and value.status in (2, 3, 4)
            and value.status != SZOMB and not value.flags & PROC_FLAG_INEXIT
            and value.start_seconds > 0 and value.start_microseconds < 1_000_000)


def inspect_process(pid=None):
    """Read one complete native identity, raising a useful error on failure."""
    pid = os.getpid() if pid is None else pid
    if type(pid) is not int or not 1 <= pid <= 2_147_483_647:
        raise ValueError("Choose a positive macOS process ID")
    before = _info(pid, PROC_PIDTBSDINFO, _BSDInfo)
    if not _live(before, pid):
        raise ProcessLookupError(errno.ESRCH, "The macOS process is not live")
    executable = _executable(pid)
    command = _command(pid)
    session = os.getsid(pid)
    # Do not combine observations from different processes or an in-flight
    # exec. Creation time uses native microseconds, not rounded `ps` output.
    if executable != _executable(pid) or command != _command(pid):
        raise ProcessLookupError(errno.ESRCH, "The macOS process changed during inspection")
    after = _info(pid, PROC_PIDTBSDINFO, _BSDInfo)
    if (not _live(after, pid) or _creation(before) != _creation(after)
            or session != os.getsid(pid) or after.pgid != os.getpgid(pid)):
        raise ProcessLookupError(errno.ESRCH, "The macOS process changed during inspection")
    return {"schema": SCHEMA, "platform": "darwin", "pid": pid,
            "process_group": after.pgid, "session_id": session,
            "start_seconds": after.start_seconds,
            "start_microseconds": after.start_microseconds, "uid": after.uid,
            "boot_id": _boot_id(),
            "executable_sha256": hashlib.sha256(executable).hexdigest(),
            "command_sha256": command}


def process_identity(pid=None):
    """Return None for a dead, inaccessible or changing process, like Linux."""
    try:
        return inspect_process(pid)
    except (OSError, ValueError):
        return None


def _owned_identity(value):
    if not isinstance(value, Mapping):
        return False
    if value.get("schema") != SCHEMA or value.get("platform") != "darwin":
        return False
    for name in ("pid", "process_group", "session_id", "start_seconds",
                 "start_microseconds", "uid"):
        if type(value.get(name)) is not int:
            return False
    if not (1 < value["pid"] <= 2_147_483_647
            and value["pid"] == value["process_group"] == value["session_id"]
            and value["start_seconds"] > 0
            and 0 <= value["start_microseconds"] < 1_000_000 and value["uid"] >= 0):
        return False
    try:
        if str(uuid.UUID(value["boot_id"])) != value["boot_id"]:
            return False
    except (KeyError, ValueError, TypeError, AttributeError):
        return False
    for name in ("executable_sha256", "command_sha256"):
        text = value.get(name)
        if (not isinstance(text, str) or len(text) != 64
                or any(char not in "0123456789abcdef" for char in text)):
            return False
    return True


def identity_matches(expected):
    """Reconnect only to the same boot, process creation, command and session."""
    if not _owned_identity(expected):
        return False
    current = process_identity(expected["pid"])
    return bool(_owned_identity(current) and all(
        current[name] == expected[name] for name in _IDENTITY_FIELDS))


def process_resources(identity):
    """Return actual task byte/thread counters from this same owned worker."""
    if not identity_matches(identity):
        return {}
    try:
        task = _info(identity["pid"], PROC_PIDTASKINFO, _TaskInfo)
        result = {"resident_bytes": task.resident_size,
                  "virtual_bytes": task.virtual_size, "threads": task.threadnum}
        if task.threadnum < 0 or not identity_matches(identity):
            return {}
        return result
    except (OSError, ValueError):
        return {}
