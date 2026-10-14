"""Native custody and shutdown for the existing Gura receiving commands.

Scientific entries still run in their selected interpreter with their original
argv. POSIX keeps its inherited descriptors and existing process groups. Windows
uses the maintained native Job backend and explicit receiving-handle adoption;
its small bootstrap enters the original command in the same owned child PID.
"""
from __future__ import annotations

import contextlib
import json
import os
from pathlib import Path
import runpy
import signal
import subprocess
import sys
import time

if os.name == "nt":
    from source_tools.native_runtime.platform_runtime import activate_libraries
    activate_libraries()

from source_tools.receiving_process import (
    inherited_descriptor, lock_identity, popen_with_lease, receiving_lock,
)

_BOOTSTRAP = r'''
import json, sys
sys.path.insert(0, sys.argv[1])
from source_tools.native_runtime.platform_runtime import activate_libraries
activate_libraries()
from source_tools.gura_receiving import windows_entry
windows_entry(json.loads(sys.argv[2]), sys.argv[3:])
'''


def windows_entry(logical_descriptors, arguments):
    """Enter one original Python command after adopting the shared native Job."""
    from model import windows_process
    context = json.loads(os.environ.get("ECO_NATIVE_WINDOWS_CONTEXT", "{}"))
    handles = context.get("custody_handles")
    if (context.get("schema") != "upstate.windows-worker-context/v1"
            or not isinstance(handles, list) or len(handles) != len(logical_descriptors)
            or any(type(fd) is not int or fd < 0 for fd in logical_descriptors)
            or len(set(logical_descriptors)) != len(logical_descriptors)):
        raise ValueError("Keep the original Gura child's explicit receiving custody")
    # adopt_worker validates the Job membership and owns these handles until
    # process exit. The receiving helper borrows scoped duplicates when a child
    # needs to forward an operation lease into its own native case.
    windows_process.adopt_worker(None, None)
    os.environ.pop("UPSTATE_RECEIVING_LEASE_HANDLES", None)
    if handles:
        os.environ["UPSTATE_RECEIVING_LEASE_HANDLES"] = json.dumps({
            "schema": "upstate.receiving-lease-handles/v1",
            "handles": {str(fd): handle for fd, handle in zip(logical_descriptors, handles)},
        }, separators=(",", ":"))
    windows_process.start_stop_bridge()
    args = list(arguments)
    while args and args[0] in ("-B", "-u"):
        args.pop(0)
    if not args:
        raise ValueError("Keep the original Gura Python entry")
    if args[0] == "-m" and len(args) >= 2:
        sys.argv = [args[1], *args[2:]]
        runpy.run_module(args[1], run_name="__main__", alter_sys=True)
    elif args[0] == "-c" and len(args) >= 2:
        sys.argv = ["-c", *args[2:]]
        # Use the actual __main__ module, as CPython -c does. Native libraries
        # may inspect it while creating their own ordinary worker processes.
        namespace = sys.modules["__main__"].__dict__
        namespace.update(__name__="__main__", __package__=None, __spec__=None)
        exec(compile(args[1], "<original-gura-command>", "exec"), namespace)
    elif not args[0].startswith("-"):
        target = Path(args[0]).resolve(strict=True)
        sys.path.insert(0, str(target.parent))
        sys.argv = [str(target), *args[1:]]
        runpy.run_path(str(target), run_name="__main__")
    else:
        raise ValueError("Use the existing Gura script, module or native-case entry")


def popen(command, *, pass_fds=(), owned_tree=False, **kwargs):
    """Start the original command with explicit custody; return its real process."""
    descriptors = tuple(dict.fromkeys(pass_fds))
    if not isinstance(command, (list, tuple)) or not command:
        raise ValueError("Use the original Gura argument array")
    if os.name != "nt":
        if owned_tree:
            kwargs["start_new_session"] = True
        child = popen_with_lease(command, pass_fds=descriptors, **kwargs)
        child.gura_owned_session = bool(owned_tree)
        return child
    from model import windows_process
    application = Path(kwargs.get("cwd") or Path(__file__).resolve().parents[1]).resolve(strict=True)
    for descriptor in descriptors:
        os.fstat(descriptor)
    wrapped = [str(command[0]), "-B", "-c", _BOOTSTRAP, str(application),
               json.dumps(descriptors), *[str(value) for value in command[1:]]]
    return windows_process.spawn(
        wrapped, cwd=application, env=kwargs.get("env"), custody_fds=descriptors,
        stdin=kwargs.get("stdin", sys.stdin), stdout=kwargs.get("stdout", sys.stdout),
        stderr=kwargs.get("stderr", sys.stderr))


def _windows_job(process, *, terminate=None):
    """Query/finish only the existing returned Job, even after its leader exits.

    The Job's retained random name comes from windows_process.spawn, not a PID
    lookup. A live descendant can outlast its phase leader, so checking only
    process.poll() or signalling a now-dead leader would lose tree cleanup.
    """
    import ctypes
    from ctypes import wintypes
    class Accounting(ctypes.Structure):
        _fields_ = [(name, ctypes.c_longlong) for name in (
            "total_user", "total_kernel", "period_user", "period_kernel")] + [
            (name, wintypes.DWORD) for name in (
                "page_faults", "total_processes", "active_processes", "terminated_processes")]
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    open_job = kernel.OpenJobObjectW
    open_job.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.LPCWSTR]
    open_job.restype = wintypes.HANDLE
    query = kernel.QueryInformationJobObject
    query.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p,
                      wintypes.DWORD, ctypes.c_void_p]
    query.restype = wintypes.BOOL
    finish = kernel.TerminateJobObject
    finish.argtypes = [wintypes.HANDLE, wintypes.UINT]
    finish.restype = wintypes.BOOL
    close = kernel.CloseHandle
    close.argtypes = [wintypes.HANDLE]
    close.restype = wintypes.BOOL
    name = process.names["job"]
    handle = open_job(4 | (8 if terminate is not None else 0), False, name)
    if not handle:
        code = ctypes.get_last_error()
        if code == 2:
            return 0
        raise ctypes.WinError(code)
    try:
        if terminate is not None and not finish(handle, terminate):
            raise ctypes.WinError(ctypes.get_last_error())
        info = Accounting()
        if not query(handle, 1, ctypes.byref(info), ctypes.sizeof(info), None):
            raise ctypes.WinError(ctypes.get_last_error())
        return info.active_processes
    finally:
        close(handle)


def interrupted(code):
    """Keep native Windows status values; do not relabel them as Unix signals."""
    if type(code) is not int:
        return False
    return code < 0 or code in (130, 137, 143) or (os.name == "nt" and bool(code & 0x80000000))


def stop_child(process):
    """Gracefully stop this child, then finish only its owned remaining tree."""
    from datetime import datetime, timezone
    actions = []
    windows = os.name == "nt"
    owned_group = not windows and getattr(process, "gura_owned_session", False)

    def active():
        if windows:
            return bool(_windows_job(process))
        if not owned_group:
            return process.poll() is None
        try:
            os.killpg(process.pid, 0)
            return True
        except ProcessLookupError:
            return False

    # 9 is the backend's explicit force-stop request; signal.SIGKILL is absent
    # on Windows. POSIX still receives the exact original 2/15/9 escalation.
    for signum, grace in ((signal.SIGINT, 10), (signal.SIGTERM, 5), (9, 5)):
        if not active():
            break
        sent = False
        try:
            if windows:
                if signum == signal.SIGINT:
                    from model import windows_process
                    sent = windows_process.signal_owned(process.identity(), signum)
                else:
                    _windows_job(process, terminate=137 if signum == 9 else 143)
                    sent = True
            elif owned_group:
                os.killpg(process.pid, signum)
                sent = True
            elif process.poll() is None:
                process.send_signal(signum)
                sent = True
        except ProcessLookupError:
            pass
        if sent:
            actions.append({"signal": int(signum),
                            "sent_at": datetime.now(timezone.utc).isoformat()})
        until = time.monotonic() + grace
        while time.monotonic() < until:
            process.poll()
            if not active():
                return process.wait(), actions
            time.sleep(0.1)
    try:
        code = process.wait(timeout=1)
    except subprocess.TimeoutExpired:
        code = None
    return code, actions


def close_process(process):
    if os.name == "nt" and process is not None:
        process.close()


def call(command, *, pass_fds=(), **kwargs):
    child = popen(command, pass_fds=pass_fds, **kwargs)
    try:
        return child.wait()
    except BaseException:
        stop_child(child)
        raise
    finally:
        close_process(child)


@contextlib.contextmanager
def supervisor_custody(workspace_root):
    """Adopt and verify the original complete-operation lease for nested cases."""
    raw_fd = os.environ.get("GURA_OPERATION_LOCK_FD")
    raw_path = os.environ.get("GURA_OPERATION_LOCK_PATH")
    if raw_fd is None and raw_path is None:
        yield ()
        return
    if raw_fd is None or raw_path is None:
        raise ValueError("The supervised operation requires its inherited descriptor and lock path")
    try:
        logical = int(raw_fd)
    except (TypeError, ValueError) as error:
        raise ValueError("The inherited operation lock descriptor must be an integer") from error
    path = Path(raw_path)
    if logical < 3 or not path.is_absolute() or path.name != "operation.lock":
        raise ValueError("The supervised operation lock descriptor or path is invalid")
    with inherited_descriptor(logical) as descriptor:
        lock_identity(descriptor, path)
        manifest = json.loads(path.with_name("operation.json").read_text(encoding="utf-8"))
        if (manifest.get("schema") != "commons.gura-complete-operation/v1"
                or manifest.get("workspace") != str(Path(workspace_root).resolve())):
            raise ValueError("The inherited operation lease belongs to a different scientific Workspace")
        if os.name != "nt":
            import fcntl
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield (descriptor,)
