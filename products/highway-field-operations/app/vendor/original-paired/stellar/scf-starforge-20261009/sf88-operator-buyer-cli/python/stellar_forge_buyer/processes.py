"""Run one Linux command with ownership of all of its descendants.

Each command has a separate child subreaper. Detached browser processes are
adopted there when their parent exits. The supervisor signals and reaps only
its own children, including later generations, before reporting completion.
"""
from __future__ import annotations

from contextlib import contextmanager
import ctypes
import json
import locale
import math
import os
import re
from pathlib import Path
import select
import signal
import subprocess
import sys
import threading
import time


@contextmanager
def cancellation():
    """Make default termination unwind Python contexts on the main thread."""
    previous = {}

    def interrupted(number, _frame):
        raise SystemExit(128 + number)

    if threading.current_thread() is threading.main_thread():
        for number in (signal.SIGTERM, signal.SIGHUP):
            handler = signal.getsignal(number)
            if handler == signal.SIG_DFL:
                previous[number] = handler
                signal.signal(number, interrupted)
    try:
        yield
    finally:
        for number, handler in previous.items():
            signal.signal(number, handler)


def _close(descriptor):
    if descriptor is not None:
        os.close(descriptor)


@contextmanager
def _defer_cancellation(*, replay=True):
    """Keep Python signal exceptions outside assignment and cleanup windows."""
    previous = {}
    pending = []

    def defer(number, frame):
        if not pending:
            pending.append((number, frame))

    if threading.current_thread() is threading.main_thread():
        for number in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
            handler = signal.getsignal(number)
            if callable(handler) or handler == signal.SIG_DFL:
                previous[number] = handler
                signal.signal(number, defer)
    try:
        yield
    finally:
        for number, handler in previous.items():
            signal.signal(number, handler)
        if pending and replay:
            number, frame = pending[0]
            handler = previous[number]
            if callable(handler):
                handler(number, frame)
            elif number == signal.SIGINT:
                raise KeyboardInterrupt
            else:
                raise SystemExit(128 + number)


def run_owned(argv, *, timeout=120, env=None, cwd=None, text=True):
    """Return CompletedProcess after the command's complete process tree exits.

    The command has the supplied environment and inherited stdin. Its original
    stdout/stderr and return code are preserved. TimeoutExpired is raised only
    after owned descendants have been terminated and reaped. A caller that
    exits abruptly closes its lifetime pipe and starts the same cleanup.
    """
    if sys.platform != "linux":
        raise RuntimeError("Owned receiving commands require Linux.")
    if timeout is not None and (not math.isfinite(timeout) or timeout <= 0):
        raise ValueError("Command timeout must be a finite positive duration.")
    argv = [os.fsdecode(value) for value in argv]
    if not argv:
        raise ValueError("Provide the original command.")
    status_read = status_write = life_read = life_write = None
    process = None
    try:
        with cancellation():
            try:
                # Defer Python exceptions, not the OS signal mask. The spawned
                # command must inherit an ordinary unblocked signal mask.
                with _defer_cancellation():
                    status_read, status_write = os.pipe()
                    life_read, life_write = os.pipe()
                    process = subprocess.Popen(
                        [sys.executable, "-B", str(Path(__file__).resolve()), "--supervise",
                         str(status_write), str(life_read),
                         "none" if timeout is None else str(timeout), *argv],
                        env=env, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                        pass_fds=(status_write, life_read), start_new_session=True)
                    _close(status_write)
                    status_write = None
                    _close(life_read)
                    life_read = None
                stdout, stderr = process.communicate()
                raw = bytearray()
                while chunk := os.read(status_read, 4096):
                    raw.extend(chunk)
                    if len(raw) > 65536:
                        raise RuntimeError("Owned command status exceeded its size limit.")
                try:
                    status = json.loads(raw)
                except (UnicodeDecodeError, ValueError) as error:
                    raise RuntimeError("Owned command supervisor did not return its status.") from error
                if process.returncode != 0 or not status.get("cleanup_complete"):
                    raise RuntimeError("Owned command cleanup did not complete: " + str(status.get("error", status)))
                if status["reason"] == "TIMEOUT":
                    error = subprocess.TimeoutExpired(argv, timeout, output=stdout, stderr=stderr)
                    error.owned_processes = status
                    raise error
                if status["reason"] != "EXITED":
                    raise RuntimeError("Owned command stopped: " + str(status.get("error", status["reason"])))
                if text:
                    encoding = locale.getpreferredencoding(False)
                    stdout, stderr = stdout.decode(encoding), stderr.decode(encoding)
                result = subprocess.CompletedProcess(argv, status["returncode"], stdout, stderr)
                result.owned_processes = status
                return result
            except BaseException:
                if process is not None:
                    # Every post-launch failure, including signal delivery during
                    # fd closure or status parsing, joins cleanup before returning.
                    with _defer_cancellation(replay=False):
                        _close(life_write)
                        life_write = None
                        process.communicate()
                raise
    finally:
        for descriptor in (status_read, status_write, life_read, life_write):
            _close(descriptor)


# Adapted from the maintained LocalDeviceAgent tools/cloud_build_runtime.py
# OwnedChildren implementation (source c4b3b0f8294dd10b1a1f51f30fdc9ed8127ea02a).
class OwnedChildren:
    """Adopt this command's detached descendants and bind signals to their identity."""
    def __init__(self):
        self.depth = len(self._namespace_pids(Path('/proc/self/status'))) - 1
        self.host_pid = int(Path('/proc/self/stat').read_text().split(' ', 1)[0])
        if self.children():
            raise OSError('run the receiving supervisor as its own process before starting a command')
        self.handles = {}
        self.sent = {}
        self.leader_reaped = False
        self.closed = False
        # Check pidfd support before launching native work. Descriptors bind a
        # signal to one process even when a PID namespace or PID reuse is involved.
        os.close(os.pidfd_open(os.getpid()))
        self.libc = ctypes.CDLL(None, use_errno=True)
        previous = ctypes.c_int()
        if self.libc.prctl(37, ctypes.byref(previous), 0, 0, 0) != 0:  # PR_GET_CHILD_SUBREAPER
            raise OSError(ctypes.get_errno(), 'cannot read Linux child adoption setting')
        self.previous = previous.value
        if self.libc.prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER
            raise OSError(ctypes.get_errno(), 'cannot adopt receiving command descendants')

    @staticmethod
    def _namespace_pids(status):
        match = re.search(r'(?m)^NSpid:\s*([0-9 \t]+)$', status.read_text())
        if not match:
            raise OSError('Linux process namespace mapping is unavailable')
        return [int(value) for value in match[1].split()]

    def children(self):
        result = set()
        child_list = Path(f'/proc/self/task/{self.host_pid}/children')
        if child_list.is_file():
            host_children = child_list.read_text().split()
        else:
            # Some cloud kernels omit the optional per-thread children file.
            # Read numeric ancestry only, never other commands or environments.
            host_children = []
            for directory in Path('/proc').iterdir():
                if directory.name.isdecimal():
                    try:
                        fields = (directory / 'stat').read_text().rsplit(')', 1)[1].split()
                        if int(fields[1]) == self.host_pid:
                            host_children.append(directory.name)
                    except (OSError, IndexError, ValueError):
                        continue
        # /proc may be mounted in an ancestor PID namespace. Translate ONLY
        # our direct children's IDs instead of treating host IDs as local PIDs.
        for host_pid in host_children:
            try:
                ids = self._namespace_pids(Path('/proc') / host_pid / 'status')
                if len(ids) <= self.depth:
                    raise OSError('child process namespace mapping is unavailable')
                result.add(ids[self.depth])
            except FileNotFoundError:
                continue
        return result

    def collect(self, root_pid):
        for pid in self.children() - {root_pid}:
            if pid not in self.handles:
                try:
                    self.handles[pid] = os.pidfd_open(pid)
                except ProcessLookupError:
                    continue
        for pid, handle in list(self.handles.items()):
            if select.select([handle], [], [], 0)[0]:
                try:
                    os.waitpid(pid, os.WNOHANG)
                except ChildProcessError:
                    pass
                os.close(handle)
                del self.handles[pid]
                self.sent.pop(pid, None)

    def leader_exited(self, process):
        """Observe our child without releasing its PID or process-group identity."""
        if self.leader_reaped:
            return True
        if process.returncode is not None:
            raise OSError('receiving command leader was reaped before owned cleanup')
        try:
            status = os.waitid(os.P_PID, process.pid,
                               os.WEXITED | os.WNOHANG | os.WNOWAIT)
        except ChildProcessError:
            raise OSError('receiving command leader is no longer a retained child') from None
        return status is not None

    def stop(self, process):
        if self.leader_reaped:
            self.close()
            return
        for signum in (signal.SIGTERM, signal.SIGKILL):
            # Keep the leader waitable through the last group signal. Reaping it
            # first would allow an unrelated process group to reuse this number.
            self.leader_exited(process)
            try:
                os.killpg(process.pid, signum)
            except ProcessLookupError:
                pass
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                leader_exited = self.leader_exited(process)
                self.collect(process.pid)
                for pid, handle in self.handles.items():
                    if self.sent.get(pid) != signum:
                        try:
                            signal.pidfd_send_signal(handle, signum)
                        except ProcessLookupError:
                            pass
                        self.sent[pid] = signum
                # A retained zombie leader still belongs to its group. Use the
                # child tree for completion, including descendants adopted while
                # collect() was reaping an exited parent in a detached session.
                if (leader_exited and not self.handles
                        and not (self.children() - {process.pid})):
                    process.wait()
                    self.leader_reaped = True
                    self.close()
                    return
                time.sleep(0.1)
        raise subprocess.TimeoutExpired('owned receiving command processes', 10)

    def close(self):
        if self.closed:
            return
        if self.libc.prctl(36, self.previous, 0, 0, 0) != 0:
            raise OSError(ctypes.get_errno(), 'cannot restore Linux child adoption setting')
        self.closed = True



def _supervise(status_fd, life_fd, timeout, argv):
    result = {"reason": "RUNNING", "returncode": None, "cleanup_complete": False,
              "subreaper": True}
    process = None
    scope = None
    stop_signal = None

    def request_stop(number, _frame):
        nonlocal stop_signal
        stop_signal = number

    for number in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(number, request_stop)
    # Adopted descendants must remain waitable if the caller ignored SIGCHLD.
    signal.signal(signal.SIGCHLD, signal.SIG_DFL)
    os.set_blocking(life_fd, False)

    def parent_exited():
        try:
            return os.read(life_fd, 1) == b""
        except BlockingIOError:
            return False

    try:
        scope = OwnedChildren()
        if parent_exited():
            result["reason"] = "PARENT_EXITED"
        else:
            process = subprocess.Popen(argv, start_new_session=True)
            deadline = None if timeout is None else time.monotonic() + timeout
            while True:
                scope.collect(process.pid)
                if scope.leader_exited(process):
                    result["reason"] = "EXITED"
                    break
                if stop_signal is not None:
                    result["reason"] = "INTERRUPTED"
                    result["signal"] = stop_signal
                    break
                if parent_exited():
                    result["reason"] = "PARENT_EXITED"
                    break
                if deadline is not None and time.monotonic() >= deadline:
                    result["reason"] = "TIMEOUT"
                    break
                select.select([life_fd], [], [], 0.05)
    except BaseException as error:
        result["reason"] = "SUPERVISOR_ERROR"
        result["error"] = str(error)[:512]
    finally:
        try:
            if scope is not None:
                if process is not None:
                    # Keep adoption active until the complete tree has exited.
                    # A kernel task awaiting I/O may take longer to accept KILL.
                    while True:
                        try:
                            scope.stop(process)
                            break
                        except subprocess.TimeoutExpired:
                            continue
                    result["returncode"] = process.returncode
                else:
                    scope.close()
            result["cleanup_complete"] = True
        except BaseException as error:
            result["error"] = str(error)[:512]
        raw = (json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
        # The caller drains command stdout/stderr before this status pipe. Keep
        # the complete status within one atomic pipe write, including errors.
        limit = os.fpathconf(status_fd, "PC_PIPE_BUF")
        if len(raw) > limit:
            result["error"] = "Supervisor error detail exceeded the status channel capacity."
            raw = (json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
        if len(raw) > limit:
            raise RuntimeError("Owned command status channel is too small.")
        try:
            while raw:
                written = os.write(status_fd, raw)
                if written == 0:
                    raise OSError("Owned command status pipe closed.")
                raw = raw[written:]
        except BrokenPipeError:
            pass
        finally:
            os.close(status_fd)
            os.close(life_fd)
    return 0 if result["cleanup_complete"] else 1


if __name__ == "__main__":
    if len(sys.argv) < 6 or sys.argv[1] != "--supervise":
        raise SystemExit("Use run_owned() with the original command.")
    duration = None if sys.argv[4] == "none" else float(sys.argv[4])
    raise SystemExit(_supervise(int(sys.argv[2]), int(sys.argv[3]), duration, sys.argv[5:]))
