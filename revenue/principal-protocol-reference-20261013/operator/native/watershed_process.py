"""Own one complete DSS native process tree until actual closure. MIT.

Run in the main thread of the dedicated watershed CLI process. The caller holds
its original operation lease for the entire call. Linux uses the maintained
namespace-qualified subreaper/pidfd ownership primitive. Windows 10+ assigns the
child atomically to a no-breakaway, kill-on-close Job through STARTUPINFOEX.
Neither path accepts an existing PID or signals a process found by a name scan.
"""
from __future__ import annotations
import contextlib
import ctypes
import hashlib
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import threading
import time

CHILDREN = {}
_ACTIVE = False


def need(value, message):
    if not value:
        raise RuntimeError(message)


def emit(value):
    try:
        sys.stderr.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
        sys.stderr.flush()
    except (BrokenPipeError, OSError):
        pass


class _Signals:
    def __init__(self):
        self.previous = {}
        self.creating = False
        self.closing = False
        self.interrupted = None

    def interrupt(self, number, frame):
        self.interrupted = number
        if not self.creating and not self.closing:
            raise InterruptedError("The original native operation was interrupted by signal " + str(number))

    def __enter__(self):
        for number in (signal.SIGINT, signal.SIGTERM):
            self.previous[number] = signal.getsignal(number)
            signal.signal(number, self.interrupt)
        return self

    def check(self):
        if self.interrupted is not None:
            raise InterruptedError("The original native operation was interrupted by signal " + str(self.interrupted))

    def __exit__(self, *unused):
        for number, handler in self.previous.items():
            signal.signal(number, handler)


def proc_status(path):
    result = {}
    for line in path.read_text().splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            result[key] = value.strip()
    return result


def child_identity(mounted_pid):
    text = (Path("/proc") / str(mounted_pid) / "stat").read_text()
    return text[text.rfind(")") + 2:].split()[19]


def tracked_popen(child):
    # Popen.pid is a syscall-namespace PID. Retain its actual Popen owner
    # before any procfs observation or optional pidfd acquisition can fail.
    need(child.pid not in CHILDREN, "Keep the original direct child identity.")
    owner = {"popen": child, "pidfd": None, "mountedPid": None, "identity": None}
    CHILDREN[child.pid] = owner
    if hasattr(os, "pidfd_open"):
        try:
            owner["pidfd"] = os.pidfd_open(child.pid)
        except ProcessLookupError:
            child.poll()
    return owner


def descendants():
    # The mounted procfs may use an outer PID namespace. Translate only our
    # actual direct children, then bind their mounted identity around pidfd_open.
    own = proc_status(Path("/proc/thread-self/status"))
    own_ids = [int(value) for value in own["NSpid"].split()]
    need(own_ids and own_ids[-1] == os.getpid(), "The original process namespace identity is unresolved.")
    depth, result = len(own_ids) - 1, []
    for value in Path("/proc/thread-self/children").read_text().split():
        mounted_pid = int(value)
        try:
            path = Path("/proc") / str(mounted_pid)
            entry = proc_status(path / "status")
            ids = [int(part) for part in entry["NSpid"].split()]
            need(int(entry["PPid"]) == own_ids[0] and len(ids) > depth and ids[0] == mounted_pid,
                 "The original direct-child namespace identity changed.")
            result.append({"pid": ids[depth], "mountedPid": mounted_pid,
                           "identity": child_identity(mounted_pid), "parent": own_ids[0], "ids": ids})
        except (FileNotFoundError, ProcessLookupError):
            # Exit is reconciled only by waitpid; an absent proc entry is not
            # evidence that all owned descendants have closed.
            continue
    return result


def tracked_descendant(selected):
    pid = selected["pid"]
    if pid in CHILDREN:
        return
    need(hasattr(os, "pidfd_open") and hasattr(signal, "pidfd_send_signal"),
         "Use the original Linux pidfd facility for adopted child ownership.")
    fd = None
    try:
        fd = os.pidfd_open(pid)
        current = proc_status(Path("/proc") / str(selected["mountedPid"]) / "status")
        need([int(part) for part in current["NSpid"].split()] == selected["ids"] and
             int(current["PPid"]) == selected["parent"] and
             child_identity(selected["mountedPid"]) == selected["identity"],
             "The translated original child changed during pidfd acquisition.")
        CHILDREN[pid] = {"popen": None, "pidfd": fd, "mountedPid": selected["mountedPid"],
                         "identity": selected["identity"]}
        fd = None
    except (FileNotFoundError, ProcessLookupError):
        pass
    finally:
        if fd is not None:
            os.close(fd)


def signal_child(pid, signum):
    owner = CHILDREN.get(pid)
    if owner is None:
        return
    try:
        if owner["pidfd"] is not None and hasattr(signal, "pidfd_send_signal"):
            signal.pidfd_send_signal(owner["pidfd"], signum)
        elif owner["popen"] is not None:
            # The original Popen polls/reaps its own syscall PID before sending.
            # No PID taken directly from a mounted procfs reaches os.kill.
            owner["popen"].send_signal(signum)
        else:
            raise RuntimeError("Retain the original adopted child until pidfd signaling is available.")
    except ProcessLookupError:
        pass


def release_child(pid, status=None):
    owner = CHILDREN.get(pid)
    if owner is None:
        return
    if status is not None and owner["popen"] is not None and owner["popen"].returncode is None:
        owner["popen"].returncode = os.waitstatus_to_exitcode(status)
    if owner["pidfd"] is not None:
        os.close(owner["pidfd"])
        owner["pidfd"] = None
    del CHILDREN[pid]


def drain_children():
    previous = {sig: signal.getsignal(sig) for sig in (signal.SIGINT, signal.SIGTERM)}
    for sig in previous:
        signal.signal(sig, signal.SIG_IGN)
    begun, reported = time.monotonic(), 0
    try:
        while True:
            failure = None
            empty = False
            try:
                while True:
                    try:
                        pid, status = os.waitpid(-1, os.WNOHANG)
                    except ChildProcessError:
                        empty = True
                        break
                    except InterruptedError:
                        continue
                    if not pid:
                        break
                    release_child(pid, status)
                if empty:
                    for pid in list(CHILDREN):
                        release_child(pid)
                    return
            except BaseException as error:
                failure = error
            # Direct Popen owners remain usable when procfs cannot be observed.
            try:
                for selected in descendants():
                    tracked_descendant(selected)
            except BaseException as error:
                failure = failure or error
            for pid in list(CHILDREN):
                try:
                    signal_child(pid, signal.SIGKILL if time.monotonic() - begun > 5 else signal.SIGTERM)
                except BaseException as error:
                    failure = failure or error
            if (failure or time.monotonic() - begun > 5) and time.monotonic() - reported > 2:
                emit({"state": "CLEANUP_PENDING", "ownedPids": list(CHILDREN),
                      "error": str(failure) if failure else None})
                reported = time.monotonic()
            time.sleep(0.1)
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)


def _linux_empty():
    """Reap every actual child; ECHILD alone proves the owned tree empty."""
    while True:
        try:
            pid, status = os.waitpid(-1, os.WNOHANG)
        except ChildProcessError:
            for pid in list(CHILDREN):
                release_child(pid)
            return True
        except InterruptedError:
            continue
        if not pid:
            return False
        release_child(pid, status)


def _linux_run(argv, stream, stderr_stream, signals, cwd, env, lease_fd, on_started, timeout):
    need(hasattr(os, "pidfd_open") and hasattr(signal, "pidfd_send_signal"),
         "This Linux native owner requires pidfd support.")
    need(not Path("/proc/thread-self/children").read_text().strip(),
         "Use a dedicated watershed CLI process with no earlier child processes.")
    own = proc_status(Path("/proc/thread-self/status"))
    need([int(x) for x in own["NSpid"].split()][-1] == os.getpid(),
         "The original syscall namespace cannot be identified.")
    libc = ctypes.CDLL(None, use_errno=True)
    prior = ctypes.c_int()
    need(libc.prctl(37, ctypes.byref(prior), 0, 0, 0) == 0,
         "Cannot read the original subreaper state.")
    need(libc.prctl(36, 1, 0, 0, 0) == 0,
         "Cannot retain orphaned native descendants.")
    child = None
    failure = None
    receipt = None
    started = time.monotonic()
    try:
        # Signal handlers defer exceptions until Popen and direct ownership
        # registration finish. Original direct ownership precedes procfs reads.
        signals.creating = True
        try:
            child = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=stream,
                                     stderr=(subprocess.STDOUT if stderr_stream is None else stderr_stream), cwd=cwd, env=env,
                                     start_new_session=True,
                                     pass_fds=(() if lease_fd is None else (lease_fd,)))
            tracked_popen(child)
        finally:
            signals.creating = False
        receipt = {"platform": "linux", "pid": child.pid, "parentPid": os.getpid(),
                   "parentNamespacePids": [int(x) for x in own["NSpid"].split()],
                   "newSession": True, "pidfdBound": CHILDREN[child.pid]["pidfd"] is not None,
                   "startedAt": time.time()}
        for selected in descendants():
            if selected["pid"] == child.pid:
                receipt["mountedPid"] = selected["mountedPid"]
                receipt["startIdentity"] = selected["identity"]
                receipt["namespacePids"] = selected["ids"]
        if on_started is not None:
            on_started(dict(receipt))
        signals.check()
        while True:
            if _linux_empty():
                break
            for selected in descendants():
                tracked_descendant(selected)
            signals.check()
            if timeout is not None and time.monotonic() - started > timeout:
                raise TimeoutError("The original native process tree exceeded its selected timeout.")
            time.sleep(0.05)
        need(child.returncode is not None, "The original direct child has no observed exit status.")
    except BaseException as error:
        failure = error
    finally:
        signals.closing = True
        # The exact maintained primitive retains all handles and loops through
        # diagnostic failures until actual ECHILD. A failed cleanup never
        # unwinds the caller's original operation lock.
        while True:
            try:
                drain_children()
                break
            except BaseException as error:
                failure = failure or error
                emit({"state": "CLEANUP_PENDING", "error": str(error)})
                time.sleep(0.1)
        if libc.prctl(36, prior.value, 0, 0, 0) != 0:
            failure = failure or OSError(ctypes.get_errno(), "Cannot restore original subreaper state")
        signals.closing = False
    if failure is not None:
        raise failure
    signals.check()
    return {"returncode": child.returncode, "process": receipt, "lifetimes": "CLOSED"}


class _WindowsOwner:
    """One native Job, created empty and assigned during CreateProcessW."""
    def __init__(self):
        self.k = None
        self.job = None
        self.info = None
        self.thread = None
        self.handles = []
        self.attributes = None
        self.attributes_live = False
        self.receipt = None
        self.started = False
        self.empty_verified = False

    def _api(self):
        from ctypes import wintypes as W
        self.W = W
        Q = ctypes.c_ulonglong
        S = ctypes.c_size_t

        class LIMIT(ctypes.Structure):
            _fields_ = [("PerProcessUserTimeLimit", ctypes.c_longlong),
                        ("PerJobUserTimeLimit", ctypes.c_longlong),
                        ("LimitFlags", W.DWORD), ("MinimumWorkingSetSize", S),
                        ("MaximumWorkingSetSize", S), ("ActiveProcessLimit", W.DWORD),
                        ("Affinity", S), ("PriorityClass", W.DWORD),
                        ("SchedulingClass", W.DWORD)]

        class IO(ctypes.Structure):
            _fields_ = [(x, Q) for x in ("ReadOperationCount", "WriteOperationCount",
                         "OtherOperationCount", "ReadTransferCount", "WriteTransferCount",
                         "OtherTransferCount")]

        class EXTENDED(ctypes.Structure):
            _fields_ = [("BasicLimitInformation", LIMIT), ("IoInfo", IO),
                        ("ProcessMemoryLimit", S), ("JobMemoryLimit", S),
                        ("PeakProcessMemoryUsed", S), ("PeakJobMemoryUsed", S)]

        class ACCOUNT(ctypes.Structure):
            _fields_ = [(x, ctypes.c_longlong) for x in ("TotalUserTime", "TotalKernelTime",
                         "ThisPeriodTotalUserTime", "ThisPeriodTotalKernelTime")] + [
                        (x, W.DWORD) for x in ("TotalPageFaultCount", "TotalProcesses",
                         "ActiveProcesses", "TotalTerminatedProcesses")]

        class STARTUP(ctypes.Structure):
            _fields_ = [("cb", W.DWORD), ("lpReserved", W.LPWSTR),
                        ("lpDesktop", W.LPWSTR), ("lpTitle", W.LPWSTR)] + [
                        (x, W.DWORD) for x in ("dwX", "dwY", "dwXSize", "dwYSize",
                         "dwXCountChars", "dwYCountChars", "dwFillAttribute", "dwFlags")] + [
                        ("wShowWindow", W.WORD), ("cbReserved2", W.WORD),
                        ("lpReserved2", ctypes.POINTER(W.BYTE)),
                        ("hStdInput", W.HANDLE), ("hStdOutput", W.HANDLE), ("hStdError", W.HANDLE)]

        class STARTUPEX(ctypes.Structure):
            _fields_ = [("StartupInfo", STARTUP), ("lpAttributeList", ctypes.c_void_p)]

        class INFO(ctypes.Structure):
            _fields_ = [("hProcess", W.HANDLE), ("hThread", W.HANDLE),
                        ("dwProcessId", W.DWORD), ("dwThreadId", W.DWORD)]

        self.ACCOUNT, self.EXTENDED, self.STARTUPEX = ACCOUNT, EXTENDED, STARTUPEX
        self.info = INFO()
        self.k = ctypes.WinDLL("kernel32", use_last_error=True)
        declarations = {
            "CreateJobObjectW": ([ctypes.c_void_p, W.LPCWSTR], W.HANDLE),
            "SetInformationJobObject": ([W.HANDLE, ctypes.c_int, ctypes.c_void_p, W.DWORD], W.BOOL),
            "QueryInformationJobObject": ([W.HANDLE, ctypes.c_int, ctypes.c_void_p, W.DWORD, ctypes.c_void_p], W.BOOL),
            "TerminateJobObject": ([W.HANDLE, W.UINT], W.BOOL),
            "CloseHandle": ([W.HANDLE], W.BOOL),
            "GetCurrentProcess": ([], W.HANDLE),
            "DuplicateHandle": ([W.HANDLE, W.HANDLE, W.HANDLE, ctypes.POINTER(W.HANDLE), W.DWORD, W.BOOL, W.DWORD], W.BOOL),
            "InitializeProcThreadAttributeList": ([ctypes.c_void_p, W.DWORD, W.DWORD, ctypes.POINTER(S)], W.BOOL),
            "UpdateProcThreadAttribute": ([ctypes.c_void_p, W.DWORD, S, ctypes.c_void_p, S, ctypes.c_void_p, ctypes.c_void_p], W.BOOL),
            "DeleteProcThreadAttributeList": ([ctypes.c_void_p], None),
            "CreateProcessW": ([W.LPCWSTR, W.LPWSTR, ctypes.c_void_p, ctypes.c_void_p, W.BOOL,
                               W.DWORD, ctypes.c_void_p, W.LPCWSTR, ctypes.c_void_p, ctypes.POINTER(INFO)], W.BOOL),
            "ResumeThread": ([W.HANDLE], W.DWORD),
            "WaitForSingleObject": ([W.HANDLE, W.DWORD], W.DWORD),
            "GetExitCodeProcess": ([W.HANDLE, ctypes.POINTER(W.DWORD)], W.BOOL),
            "GetProcessTimes": ([W.HANDLE, ctypes.POINTER(W.FILETIME), ctypes.POINTER(W.FILETIME),
                                ctypes.POINTER(W.FILETIME), ctypes.POINTER(W.FILETIME)], W.BOOL),
        }
        for name, (args, result) in declarations.items():
            function = getattr(self.k, name)
            function.argtypes = args
            function.restype = result

    def check(self, value, label):
        if not value:
            raise ctypes.WinError(ctypes.get_last_error(), label)
        return value

    def duplicate(self, handle):
        # Only duplicates listed explicitly in HANDLE_LIST are inherited.
        duplicate = self.W.HANDLE()
        current = self.k.GetCurrentProcess()
        self.check(self.k.DuplicateHandle(current, handle, current, ctypes.byref(duplicate),
                                         0, True, 2), "Duplicate original native log/input handle")
        self.handles.append(duplicate.value)
        return duplicate.value

    def start(self, argv, stream, stderr_stream, signals, cwd, env, on_started):
        import msvcrt
        self._api()
        self.job = self.check(self.k.CreateJobObjectW(None, None), "Create owned native Job")
        limits = self.EXTENDED()
        # Neither BREAKAWAY_OK nor SILENT_BREAKAWAY_OK is enabled.
        limits.BasicLimitInformation.LimitFlags = 0x2000
        self.check(self.k.SetInformationJobObject(self.job, 9, ctypes.byref(limits),
                                                  ctypes.sizeof(limits)), "Bind kill-on-close native Job")
        size = ctypes.c_size_t()
        self.k.InitializeProcThreadAttributeList(None, 2, 0, ctypes.byref(size))
        need(size.value > 0, "This Windows runtime cannot create an explicit process attribute list.")
        self.attributes = ctypes.create_string_buffer(size.value)
        self.check(self.k.InitializeProcThreadAttributeList(self.attributes, 2, 0, ctypes.byref(size)),
                   "Initialize native Job attributes")
        self.attributes_live = True
        self.job_list = (self.W.HANDLE * 1)(self.job)
        self.check(self.k.UpdateProcThreadAttribute(self.attributes, 0, 0x0002000D,
                    self.job_list, ctypes.sizeof(self.job_list), None, None),
                   "Require Windows 10+ atomic native Job assignment")
        stream.flush()
        output = self.duplicate(msvcrt.get_osfhandle(stream.fileno()))
        error_output = output
        if stderr_stream is not None and stderr_stream is not stream:
            stderr_stream.flush()
            error_output = self.duplicate(msvcrt.get_osfhandle(stderr_stream.fileno()))
        with open(os.devnull, "rb", buffering=0) as null:
            input_handle = self.duplicate(msvcrt.get_osfhandle(null.fileno()))
        inherited = [input_handle, output]
        if error_output != output:
            inherited.append(error_output)
        self.handle_list = (self.W.HANDLE * len(inherited))(*inherited)
        self.check(self.k.UpdateProcThreadAttribute(self.attributes, 0, 0x00020002,
                    self.handle_list, ctypes.sizeof(self.handle_list), None, None),
                   "Bind exact inherited native stream handles")
        startup = self.STARTUPEX()
        startup.StartupInfo.cb = ctypes.sizeof(startup)
        startup.StartupInfo.dwFlags = 0x100
        startup.StartupInfo.hStdInput = input_handle
        startup.StartupInfo.hStdOutput = output
        startup.StartupInfo.hStdError = error_output
        startup.lpAttributeList = ctypes.cast(self.attributes, ctypes.c_void_p).value
        # LPWSTR is writable because CreateProcessW can modify its command line.
        command = ctypes.create_unicode_buffer(subprocess.list2cmdline(argv))
        environment = None
        if env is not None:
            values = []
            for key, value in sorted(env.items(), key=lambda item: item[0].upper()):
                need(isinstance(key, str) and isinstance(value, str) and key and
                     "\0" not in key + value and "=" not in key,
                     "Select ordinary complete environment entries.")
                values.append(key + "=" + value)
            environment = ctypes.create_unicode_buffer("\0".join(values) + "\0\0")
        need(not str(argv[0]).lower().endswith((".bat", ".cmd")),
             "Select an executable HEC launcher or an explicit command-interpreter argv for a batch launcher.")
        signals.creating = True
        try:
            # The output INFO object is owned before this call. JOB_LIST applies
            # atomically at creation; a parent crash cannot leave an unowned
            # suspended process between CreateProcess and AssignProcessToJob.
            self.check(self.k.CreateProcessW(None, command, None, None, True,
                       0x00080000 | 0x00000400 | 0x00000004,
                       environment, cwd, ctypes.byref(startup), ctypes.byref(self.info)),
                       "Create original native process in its owned Job")
            self.started = True
        finally:
            signals.creating = False
        created, exited, kernel, user = (self.W.FILETIME() for _ in range(4))
        self.check(self.k.GetProcessTimes(self.info.hProcess, ctypes.byref(created),
                   ctypes.byref(exited), ctypes.byref(kernel), ctypes.byref(user)),
                   "Read original process creation identity")
        self.receipt = {"platform": "windows", "pid": int(self.info.dwProcessId),
                        "threadId": int(self.info.dwThreadId),
                        "createdFileTime": str((created.dwHighDateTime << 32) | created.dwLowDateTime),
                        "atomicJobAssignment": True, "breakaway": False, "startedAt": time.time()}
        if on_started is not None:
            on_started(dict(self.receipt))
        signals.check()
        resumed = self.k.ResumeThread(self.info.hThread)
        need(resumed == 1, "The original suspended native thread did not resume from exactly one suspension.")

    def active(self):
        if not self.job:
            return 0
        value = self.ACCOUNT()
        self.check(self.k.QueryInformationJobObject(self.job, 1, ctypes.byref(value),
                                                   ctypes.sizeof(value), None),
                   "Observe the complete original native Job")
        return int(value.ActiveProcesses)

    def exit_code(self):
        if not self.info or not self.info.hProcess:
            return None
        state = self.k.WaitForSingleObject(self.info.hProcess, 0)
        if state == 0x102:
            return None
        self.check(state != 0xFFFFFFFF, "Wait for original native process")
        need(state == 0, "The native process wait returned an unknown state.")
        code = self.W.DWORD()
        self.check(self.k.GetExitCodeProcess(self.info.hProcess, ctypes.byref(code)),
                   "Read the original native exit code")
        return int(code.value)

    def close_empty(self):
        if not self.empty_verified:
            need(self.active() == 0 and (not self.started or self.exit_code() is not None),
                 "Keep native Job/process ownership through actual complete closure.")
            self.empty_verified = True
        # Retain a failing handle for the next exact cleanup attempt.
        if self.info is not None:
            for name in ("hThread", "hProcess"):
                handle = getattr(self.info, name)
                if handle:
                    self.check(self.k.CloseHandle(handle), "Close original native process/thread handle")
                    setattr(self.info, name, None)
        while self.handles:
            self.check(self.k.CloseHandle(self.handles[-1]), "Close inherited stream duplicate")
            self.handles.pop()
        if self.attributes_live:
            self.k.DeleteProcThreadAttributeList(self.attributes)
            self.attributes_live = False
        if self.job:
            self.check(self.k.CloseHandle(self.job), "Close empty original native Job")
            self.job = None


def _windows_run(argv, stream, stderr_stream, signals, cwd, env, on_started, timeout):
    owner = _WindowsOwner()
    failure = None
    result = None
    started = time.monotonic()
    try:
        owner.start(argv, stream, stderr_stream, signals, cwd, env, on_started)
        while True:
            code = owner.exit_code()
            if code is not None and owner.active() == 0:
                result = {"returncode": code, "process": owner.receipt, "lifetimes": "CLOSED"}
                break
            signals.check()
            if timeout is not None and time.monotonic() - started > timeout:
                raise TimeoutError("The original native Job exceeded its selected timeout.")
            time.sleep(0.05)
    except BaseException as error:
        failure = error
    finally:
        signals.closing = True
        reported = 0.0
        while True:
            try:
                if owner.job and owner.active():
                    owner.check(owner.k.TerminateJobObject(owner.job, 130),
                                "Stop the exact original native Job")
                if owner.started and owner.info.hProcess and owner.exit_code() is None:
                    time.sleep(0.1)
                    continue
                owner.close_empty()
                break
            except BaseException as error:
                failure = failure or error
                if time.monotonic() - reported > 2:
                    emit({"state": "CLEANUP_PENDING", "platform": "windows", "error": str(error)})
                    reported = time.monotonic()
                time.sleep(0.1)
        signals.closing = False
    if failure is not None:
        raise failure
    signals.check()
    return result


def run_owned(argv, log_stream, *, cwd=None, env=None, lease_fd=None,
              on_started=None, timeout=None, stderr_stream=None):
    """Return only after the original native process tree has fully closed.

    The caller must keep its operation lock around this call and pass its
    descriptor on Linux. on_started receives one actual identity while that
    process is owned; callback errors stop and drain the same operation.
    Stream ownership remains with the caller. stderr_stream=None preserves the
    original merged log; supply a second regular stream for separate diagnostics.
    No background producer is returned.
    """
    global _ACTIVE
    need(not _ACTIVE and not CHILDREN, "Only one original native operation may use this owner.")
    need(threading.current_thread() is threading.main_thread() and threading.active_count() == 1,
         "Run the native owner in the dedicated single-threaded watershed CLI.")
    need(isinstance(argv, (list, tuple)) and argv and
         all(isinstance(x, str) and x and "\0" not in x for x in argv),
         "Select the complete explicit native command argv.")
    need(timeout is None or isinstance(timeout, (int, float)) and timeout > 0,
         "Select a positive native timeout.")
    streams = [("stdout", log_stream)]
    if stderr_stream is not None and stderr_stream is not log_stream:
        streams.append(("stderr", stderr_stream))
    for label, stream in streams:
        stream.flush()
        need(stat.S_ISREG(os.fstat(stream.fileno()).st_mode),
             "Keep an owned regular native " + label + " file.")
    if lease_fd is not None:
        need(isinstance(lease_fd, int) and lease_fd >= 0 and stat.S_ISREG(os.fstat(lease_fd).st_mode),
             "Retain the exact original regular operation-lock descriptor.")
    if cwd is not None:
        cwd = str(Path(cwd).resolve(strict=True))
    _ACTIVE = True
    result = None
    failure = None
    try:
        with _Signals() as signals:
            if sys.platform.startswith("linux"):
                need(lease_fd is not None, "Pass the held original operation lease to the Linux native launcher.")
                result = _linux_run(list(argv), log_stream, stderr_stream, signals, cwd, env, lease_fd, on_started, timeout)
            elif os.name == "nt":
                result = _windows_run(list(argv), log_stream, stderr_stream, signals, cwd, env, on_started, timeout)
            else:
                raise RuntimeError("Use the supported Linux subreaper or Windows Job native runtime.")
    except BaseException as error:
        failure = error
    finally:
        # Both platform owners have actually drained before control reaches here.
        for label, stream in streams:
            try:
                stream.flush()
                os.fsync(stream.fileno())
            except BaseException as error:
                if failure is None:
                    failure = error
                else:
                    emit({"state": "LOG_SYNC_FAILED", "stream": label, "error": str(error)})
        _ACTIVE = False
    if failure is not None:
        raise failure
    return result
