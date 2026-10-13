"""Own and close descendants of one Linux application invocation.

The caller remains single-threaded while the scope is active. Children present
before entry retain their ownership. PID numbers exposed by procfs are translated
to the caller's PID namespace before opening pidfds.
"""
import ctypes
import errno
import json
import os
from pathlib import Path
import select
import signal
import time

PR_SET_CHILD_SUBREAPER = 36
PR_GET_CHILD_SUBREAPER = 37


def utc_now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _status(path):
    result = {}
    for line in Path(path).read_text().splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            result[key] = value.strip()
    return result


def _subreaper(value=None):
    libc = ctypes.CDLL(None, use_errno=True)
    libc.prctl.restype = ctypes.c_int
    if value is None:
        output = ctypes.c_int()
        returned = libc.prctl(
            ctypes.c_int(PR_GET_CHILD_SUBREAPER), ctypes.byref(output),
            ctypes.c_ulong(0), ctypes.c_ulong(0), ctypes.c_ulong(0))
        result = output.value
    else:
        returned = libc.prctl(
            ctypes.c_int(PR_SET_CHILD_SUBREAPER), ctypes.c_ulong(value),
            ctypes.c_ulong(0), ctypes.c_ulong(0), ctypes.c_ulong(0))
        result = value
    if returned == -1:
        number = ctypes.get_errno()
        raise OSError(number, os.strerror(number))
    return result


def resource_snapshot(label):
    """Read the worker's current counters without changing cgroup settings."""
    observed = {"label": label, "at": utc_now(), "pid": os.getpid()}
    try:
        observed["process_cgroup"] = Path("/proc/self/cgroup").read_text().strip()
    except OSError as error:
        observed["process_cgroup_error"] = str(error)
    candidates = [Path("/sys/fs/cgroup")]
    for line in observed.get("process_cgroup", "").splitlines():
        if line.startswith("0::") and line[3:] not in ("", "/"):
            candidates.insert(0, Path("/sys/fs/cgroup") / line[3:].lstrip("/"))
    directory = next((path for path in candidates
                      if (path / "memory.current").is_file()), candidates[-1])
    observed["cgroup_directory"] = str(directory)
    for name in ("memory.current", "memory.max", "memory.peak",
                 "memory.events", "memory.events.local", "memory.stat",
                 "memory.pressure", "pids.current", "pids.max"):
        try:
            value = (directory / name).read_text().strip()
            if name in ("memory.current", "memory.max", "memory.peak",
                        "pids.current", "pids.max"):
                observed[name] = int(value) if value.isdecimal() else value
            elif name in ("memory.events", "memory.events.local", "memory.stat"):
                observed[name] = {key: int(number)
                                  for key, number in
                                  (line.split() for line in value.splitlines())}
            else:
                observed[name] = value
        except (OSError, ValueError) as error:
            observed[name + "_error"] = str(error)
    current = observed.get("memory.current")
    maximum = observed.get("memory.max")
    if isinstance(current, int) and isinstance(maximum, int):
        observed["memory_headroom_bytes"] = max(0, maximum - current)
    return observed


class ProcessFamily:
    """Reap only children created or adopted during the selected invocation."""

    def __init__(self, label, publish=None, interrupt_seconds=8,
                 terminate_seconds=4):
        self.label = label
        self.publish = publish or (lambda report: None)
        self.interrupt_seconds = interrupt_seconds
        self.terminate_seconds = terminate_seconds
        self.handles = {}
        self.report = {
            "schema": "commons.process-family.v1",
            "label": label, "state": "PREPARING", "events": [],
            "children": [], "resources": [], "started_at": utc_now(),
        }
        self.entered = False
        self.closed = False

    def _notify(self, event, **values):
        self.report["events"].append({"event": event, "at": utc_now(), **values})
        try:
            self.publish(self.report)
        except OSError as error:
            self.report["journal_error"] = {"type": type(error).__name__,
                                            "message": str(error), "at": utc_now()}

    def _identity(self, procfs_pid):
        directory = Path("/proc") / str(procfs_pid)
        status = _status(directory / "status")
        namespace_pids = [int(item) for item in status.get("NSpid", "").split()]
        if len(namespace_pids) <= self.namespace_index:
            raise RuntimeError("Child PID namespace cannot be translated")
        stat_text = (directory / "stat").read_text()
        fields = stat_text[stat_text.rfind(")") + 2:].split()
        if len(fields) < 20:
            raise RuntimeError("Child process stat is incomplete")
        return {
            "procfs_pid": int(status["Pid"]),
            "procfs_parent_pid": int(status["PPid"]),
            "pid": namespace_pids[self.namespace_index],
            "namespace_pids": namespace_pids,
            "start_ticks": int(fields[19]),
        }

    @staticmethod
    def _key(identity):
        return (identity["procfs_pid"], identity["start_ticks"],
                tuple(identity["namespace_pids"]))

    def _direct_children(self):
        found = {}
        try:
            candidates = Path("/proc/thread-self/children").read_text().split()
            self.report["discovery"] = "procfs-thread-children"
            parent_scan = False
        except FileNotFoundError:
            # Some kernels omit task/children. Read parent relationships from
            # the same procfs view; inaccessible unrelated namespaces are not
            # evidence about this caller's children.
            candidates = [entry.name for entry in os.scandir("/proc")
                          if entry.name.isdecimal()]
            self.report["discovery"] = "procfs-parent-relationships"
            parent_scan = True
        for item in candidates:
            try:
                if parent_scan:
                    parent = _status(Path("/proc") / item / "status")
                    if int(parent["PPid"]) != self.procfs_self:
                        continue
                identity = self._identity(int(item))
            except (FileNotFoundError, ProcessLookupError):
                continue
            except PermissionError:
                if parent_scan:
                    continue
                raise
            if identity["procfs_parent_pid"] == self.procfs_self:
                found[self._key(identity)] = identity
        return found

    def __enter__(self):
        if self.entered:
            raise RuntimeError("A process-family scope can be entered once")
        if not hasattr(os, "pidfd_open") or not hasattr(signal, "pidfd_send_signal"):
            raise RuntimeError("This Linux runtime needs pidfd process handles")
        own = _status("/proc/self/status")
        namespaces = [int(item) for item in own.get("NSpid", "").split()]
        if not namespaces or namespaces[-1] != os.getpid():
            raise RuntimeError("The caller PID namespace is not observable")
        self.namespace_index = len(namespaces) - 1
        self.procfs_self = int(own["Pid"])
        self.baseline = self._direct_children()
        self.previous_subreaper = _subreaper()
        _subreaper(1)
        self.entered = True
        self.report.update(
            state="RUNNING", caller_pid=os.getpid(),
            procfs_caller_pid=self.procfs_self,
            caller_namespace_pids=namespaces,
            previous_subreaper=self.previous_subreaper,
            preserved_children=list(self.baseline.values()))
        self.report["resources"].append(resource_snapshot("before_application"))
        self._notify("PROCESS_FAMILY_STARTED")
        return self

    def _discover(self):
        added = []
        for key, identity in self._direct_children().items():
            if key in self.baseline or key in self.handles:
                continue
            try:
                handle = os.pidfd_open(identity["pid"], 0)
            except ProcessLookupError:
                continue
            try:
                current = self._identity(identity["procfs_pid"])
            except (FileNotFoundError, ProcessLookupError):
                os.close(handle)
                continue
            except BaseException:
                os.close(handle)
                raise
            if (self._key(current) != key or
                    current["procfs_parent_pid"] != self.procfs_self):
                os.close(handle)
                continue
            row = {**identity, "adopted_at": utc_now(),
                   "state": "OWNED", "signals": []}
            self.report["children"].append(row)
            self.handles[key] = (handle, row)
            added.append(identity["pid"])
        if added:
            self._notify("DESCENDANTS_ADOPTED", pids=added)

    def _reap(self):
        for key, (handle, row) in list(self.handles.items()):
            try:
                result = os.waitid(os.P_PIDFD, handle, os.WEXITED | os.WNOHANG)
            except ChildProcessError:
                if not select.select([handle], [], [], 0)[0]:
                    raise RuntimeError("A live owned child lost its wait owner")
                result = None
                row.update(state="EXIT_REAPED_BY_CALLER", ended_at=utc_now())
            else:
                if result is None:
                    continue
                row.update(state="REAPED", ended_at=utc_now(),
                           wait_pid=result.si_pid, wait_code=result.si_code,
                           wait_status=result.si_status)
            os.close(handle)
            del self.handles[key]

    def _signal(self, number):
        for handle, row in self.handles.values():
            if number in row["signals"]:
                continue
            try:
                signal.pidfd_send_signal(handle, number, None, 0)
            except ProcessLookupError:
                continue
            row["signals"].append(number)

    def close(self):
        if self.closed:
            return self.report
        if not self.entered:
            raise RuntimeError("Enter the process-family scope before closing")
        self.report["state"] = "CLOSING"
        handlers = {}
        for number in (signal.SIGINT, signal.SIGTERM):
            handlers[number] = signal.getsignal(number)
            signal.signal(number, signal.SIG_IGN)
        self.report["resources"].append(resource_snapshot("application_returned"))
        self._notify("PROCESS_FAMILY_CLOSING")
        started = time.monotonic()
        empty_observations = 0
        last_stage = None
        last_notice = started
        try:
            while True:
                self._discover()
                self._reap()
                if not self.handles:
                    # A terminating direct child may have just adopted its
                    # descendants into this scope. Scan again before release.
                    self._discover()
                    self._reap()
                if not self.handles:
                    empty_observations += 1
                    if empty_observations >= 2:
                        break
                else:
                    empty_observations = 0
                    elapsed = time.monotonic() - started
                    if elapsed < self.interrupt_seconds:
                        number = signal.SIGINT
                    elif elapsed < self.interrupt_seconds + self.terminate_seconds:
                        number = signal.SIGTERM
                    else:
                        number = signal.SIGKILL
                    self._signal(number)
                    if number != last_stage:
                        self._notify("DESCENDANT_SIGNAL",
                                     signal=number, live=len(self.handles))
                        last_stage = number
                    if time.monotonic() - last_notice >= 10:
                        self._notify("DESCENDANT_EXIT_WAIT",
                                     live=len(self.handles), signal=number)
                        last_notice = time.monotonic()
                time.sleep(0.05)
            _subreaper(self.previous_subreaper)
            self.closed = True
            self.report.update(state="CLOSED", closed_at=utc_now(),
                               subreaper_restored=_subreaper(),
                               preserved_children_alive=[
                                   identity for key, identity
                                   in self._direct_children().items()
                                   if key in self.baseline])
            self.report["resources"].append(resource_snapshot("family_closed"))
            self._notify("PROCESS_FAMILY_CLOSED",
                         descendants=len(self.report["children"]))
            return self.report
        finally:
            # Do not release a subreaper while any selected descendant remains.
            # Every signal goes through an owned pidfd; baseline children are
            # never signalled or waited by this scope.
            if self.closed:
                for number, handler in handlers.items():
                    signal.signal(number, handler)

    def __exit__(self, exception_type, exception, _traceback):
        if exception_type is not None:
            self.report["application_exception"] = {
                "type": exception_type.__name__, "message": str(exception)}
        self.close()
        return False
