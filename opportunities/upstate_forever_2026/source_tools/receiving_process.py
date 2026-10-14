"""Portable custody for existing scientific receiving subprocesses.

POSIX uses an inherited flock open description. Windows uses a share-denying
file handle, duplicated into an explicit STARTUPINFO handle list. A byte-range
lock is not a transferable Windows lease. The original command arguments and
scientific request IDs stay unchanged; Windows children adopt their descriptor
from the private per-launch handle map before checking the original file ID.
"""
from __future__ import annotations

import contextlib
import copy
import json
import os
from pathlib import Path
import stat
import subprocess
import threading
import time

_HANDLE_ENV = "UPSTATE_RECEIVING_LEASE_HANDLES"
_HANDLE_SCHEMA = "upstate.receiving-lease-handles/v1"
_SPAWN_LOCK = threading.RLock()


def _windows_open_lease(path):
    """Use the maintained Windows backend's transferable exclusive-share lease."""
    from model.windows_process import open_batch_lease
    return open_batch_lease(path)


def _open_lease(path):
    if os.name == "nt":
        return _windows_open_lease(path)
    import fcntl
    descriptor = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise ValueError("Receiving lease must be an ordinary file")
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


@contextlib.contextmanager
def receiving_lock(path, *, blocking=False, on_wait=None):
    """Yield a non-inheritable descriptor; children receive explicit duplicates.

    Closing this process's descriptor never explicitly unlocks a surviving
    child's lease. Only contention is retried; permission and path errors retain
    their original exception. The optional callback observes existing work.
    """
    path = Path(path).absolute()
    path.parent.mkdir(parents=True, exist_ok=True)
    while True:
        try:
            descriptor = _open_lease(path)
            break
        except BlockingIOError:
            if not blocking:
                raise
            if on_wait is not None:
                on_wait()
            time.sleep(0.2)
    try:
        os.set_inheritable(descriptor, False)
        lock_identity(descriptor, path)
        yield descriptor
    finally:
        os.close(descriptor)


def lock_identity(descriptor, path):
    """Retain the same path/device/inode record on every supported platform."""
    if type(descriptor) is not int or descriptor < 0:
        raise ValueError("Retain the original receiving lock descriptor")
    path = Path(path).absolute()
    if os.name == "nt":
        from model.windows_fs import fd_stat, path_stat
        opened, current = fd_stat(descriptor), path_stat(path)
    else:
        opened, current = os.fstat(descriptor), path.lstat()
    if (not stat.S_ISREG(opened.st_mode) or not stat.S_ISREG(current.st_mode)
            or (opened.st_dev, opened.st_ino) != (current.st_dev, current.st_ino)):
        raise ValueError("The receiving lock path differs from its owned descriptor")
    return {"path": str(path), "device": opened.st_dev, "inode": opened.st_ino}


def popen_with_lease(command, *, pass_fds=(), **kwargs):
    """Spawn the unchanged argument array with only the requested custody handles.

    On Windows, --lock-fd remains the original logical descriptor in the command
    journal, not a claim that CRT descriptor numbers transfer between processes.
    A Python receiver calls inherited_descriptor() before using that argument.
    Node and other opaque children retain the explicitly inherited kernel handle
    until exit without needing to interpret it.
    """
    if not isinstance(command, (list, tuple)) or kwargs.get("shell"):
        raise ValueError("Use a receiving argument array, without a shell")
    descriptors = tuple(dict.fromkeys(pass_fds))
    for descriptor in descriptors:
        if type(descriptor) is not int or descriptor < 0:
            raise ValueError("Retain the original receiving lock descriptor")
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise ValueError("A receiving descriptor must identify an ordinary file")
    if os.name != "nt":
        return subprocess.Popen(command, pass_fds=descriptors, **kwargs)
    if kwargs.get("close_fds") is False:
        raise ValueError("Windows receiving requires an explicit inherited handle list")
    import _winapi
    import msvcrt
    with _SPAWN_LOCK:
        handles = []
        try:
            process = _winapi.GetCurrentProcess()
            mapping = {}
            for descriptor in descriptors:
                handle = _winapi.DuplicateHandle(
                    process, msvcrt.get_osfhandle(descriptor), process, 0, True,
                    _winapi.DUPLICATE_SAME_ACCESS)
                handles.append(handle)
                mapping[str(descriptor)] = handle
            startup = copy.copy(kwargs.pop("startupinfo", None)) or subprocess.STARTUPINFO()
            attributes = dict(startup.lpAttributeList or {})
            attributes["handle_list"] = list(dict.fromkeys(
                [*attributes.get("handle_list", ()), *handles]))
            startup.lpAttributeList = attributes
            environment = dict(os.environ if kwargs.get("env") is None else kwargs["env"])
            environment.pop(_HANDLE_ENV, None)
            if mapping:
                environment[_HANDLE_ENV] = json.dumps(
                    {"schema": _HANDLE_SCHEMA, "handles": mapping}, separators=(",", ":"))
            kwargs.update(startupinfo=startup, close_fds=True, env=environment)
            return subprocess.Popen(command, **kwargs)
        finally:
            for handle in handles:
                _winapi.CloseHandle(handle)


@contextlib.contextmanager
def inherited_descriptor(logical_descriptor):
    """Borrow a POSIX descriptor or adopt one explicitly inherited Windows handle."""
    if type(logical_descriptor) is not int or logical_descriptor < 0:
        raise ValueError("Retain the original receiving lock descriptor")
    if os.name != "nt":
        os.fstat(logical_descriptor)
        yield logical_descriptor
        return
    import _winapi
    import msvcrt
    raw = os.environ.get(_HANDLE_ENV)
    try:
        transfer = json.loads(raw) if raw else {}
        handles = transfer["handles"]
        handle = handles[str(logical_descriptor)]
        if (transfer.get("schema") != _HANDLE_SCHEMA or type(handle) is not int or handle <= 0):
            raise ValueError
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError("The receiving child needs its explicit inherited Windows lease") from error
    remaining = {key: value for key, value in handles.items() if key != str(logical_descriptor)}
    if remaining:
        os.environ[_HANDLE_ENV] = json.dumps({"schema": _HANDLE_SCHEMA, "handles": remaining})
    else:
        os.environ.pop(_HANDLE_ENV, None)
    # Keep the original inherited handle until the child process exits. A
    # scoped inspection may finish before its result/failure record is written.
    # Only the non-inheritable duplicate below belongs to this Python context.
    os.set_handle_inheritable(handle, False)
    process = _winapi.GetCurrentProcess()
    scoped_handle = _winapi.DuplicateHandle(
        process, handle, process, 0, False, _winapi.DUPLICATE_SAME_ACCESS)
    try:
        descriptor = msvcrt.open_osfhandle(scoped_handle, os.O_RDWR | os.O_BINARY)
    except BaseException:
        _winapi.CloseHandle(scoped_handle)
        raise
    try:
        os.set_inheritable(descriptor, False)
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise ValueError("The inherited receiving lease is not an ordinary file")
        yield descriptor
    finally:
        os.close(descriptor)


def process_identity(pid):
    """Use the maintained native worker's platform-aware process identity."""
    from model.native_worker import process_identity as identify
    return identify(pid)


def identity_matches(expected):
    """Match a retained child without requiring it to be a process-group leader."""
    if not isinstance(expected, dict) or type(expected.get("pid")) is not int:
        return False
    current = process_identity(expected["pid"])
    return bool(current and current == expected)
