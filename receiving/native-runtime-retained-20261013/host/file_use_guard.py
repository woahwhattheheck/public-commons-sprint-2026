"""Kernel file-use exclusion for the original cache mutation owner.

This module opens only the selected ordinary file. Linux grants an F_WRLCK
lease only when no other open file description conflicts. Each guarded
rename/unlink checks that same lease immediately before its syscall. It
does not discover targets, change custody, or replace runtime-consumer locks.
"""
from __future__ import annotations

import datetime
import errno
import fcntl
import os
from pathlib import Path
import signal
import stat
import threading

SCHEMA = "commons.kernel-file-use/v1"
_ACTIVE = None


def _now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def _identity(info):
    return {"device": info.st_dev, "inode": info.st_ino, "bytes": info.st_size,
            "mtime_ns": info.st_mtime_ns, "ctime_ns": info.st_ctime_ns,
            "mode": stat.S_IMODE(info.st_mode), "links": info.st_nlink,
            "allocated_bytes": info.st_blocks * 512}


class FileUseError(ValueError):
    def __init__(self, code, message, observation):
        super().__init__(message)
        self.code = code
        self.file_use = {**observation, "state": code, "message": message}


class SelectedFile:
    """Own one descriptor and, when required, its Linux file lease.

    The callback passed to change() must be one synchronous filesystem
    operation. Its actual return is recorded before deferred SIGIO handling.
    The original caller persists that observation in its existing journal.
    """
    def __init__(self, path, *, require_unused=False, dir_fd=None, display_path=None):
        if type(require_unused) is not bool:
            raise ValueError("Select the original boolean file-use requirement")
        self.path = path
        self.dir_fd = dir_fd
        self.display_path = str(display_path if display_path is not None else Path(path).absolute())
        self.required = require_unused
        self.fd = None
        self.original = None
        self.started_at = None
        self.acquired_at = None
        self.checked_at = None
        self.observed_lease = None
        self.closed_at = None
        self.close_pending = False
        self.break_requested = False
        self.release_error = None
        self.signal_installed = False
        self.previous_handler = None
        self.previous_mask = None
        self.lease_active = False
        self.change_active = False
        self.actions = []

    def observation(self):
        return {"schema": SCHEMA, "required": self.required,
                "mechanism": "F_SETLEASE" if self.required else "original_descriptor",
                "requested": "F_WRLCK" if self.required else None,
                "path": self.display_path, "owner_pid": os.getpid(),
                "original": self.original, "started_at": self.started_at,
                "acquired_at": self.acquired_at, "checked_at": self.checked_at,
                "observed_lease": self.observed_lease, "closed_at": self.closed_at,
                "close_pending": self.close_pending, "mutation_active": self.change_active,
                "state": "closed" if self.closed_at else "lease_held" if self.lease_active
                         else "opened" if self.fd is not None else "not_opened",
                "break_requested": self.break_requested,
                "release_error": self.release_error,
                "actions": [dict(row) for row in self.actions]}

    def _fail(self, code, message, error=None):
        observation = self.observation()
        if error is not None:
            observation["errno"] = getattr(error, "errno", None)
            observation["native_error"] = str(error)
        failure = FileUseError(code, message, observation)
        failure.owner = self
        raise failure from error

    def _break(self, signum, frame):
        # Do not raise asynchronously through a caller's receipt write or
        # an already-returned rename/unlink. The next check preserves the
        # source. During change(), defer release until the synchronous
        # mutation and its actual-return record have finished.
        self.break_requested = True
        if not self.change_active:
            self._release_break()

    def _release_break(self):
        if self.fd is not None and self.lease_active:
            try:
                fcntl.fcntl(self.fd, fcntl.F_SETLEASE, fcntl.F_UNLCK)
                self.lease_active = False
            except OSError as error:
                self.release_error = {"errno": error.errno, "message": str(error)}

    def __enter__(self):
        global _ACTIVE
        self.started_at = _now()
        try:
            # Reconcile a failed close before opening another descriptor. This
            # cannot accidentally reuse the retained descriptor number here.
            if self.required and _ACTIVE is not None:
                if threading.current_thread() is not threading.main_thread():
                    self._fail("lease_context_unavailable", "Reconcile the original lease from its owning main thread")
                if _ACTIVE.close_pending:
                    _ACTIVE.close()
                if _ACTIVE is not None:
                    self._fail("lease_owner_active", "The original process still owns another active file-use lease")
            try:
                self.fd = os.open(self.path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                                  dir_fd=self.dir_fd)
            except OSError as error:
                if self.required and error.errno in (errno.EAGAIN, errno.EWOULDBLOCK):
                    self._fail("file_in_use", "The selected file has a conflicting kernel lease; preserve it", error)
                raise
            info = os.fstat(self.fd)
            if not stat.S_ISREG(info.st_mode):
                self._fail("not_regular", "Keep the selected ordinary file; special files are not retired")
            self.original = _identity(info)
            if not self.required:
                return self
            if threading.current_thread() is not threading.main_thread():
                self._fail("lease_context_unavailable", "Run original kernel-guarded retirement in its owning main thread")
            needed = ("F_SETLEASE", "F_GETLEASE", "F_SETOWN")
            if (not all(hasattr(fcntl, name) for name in needed)
                    or not all(hasattr(signal, name) for name in
                               ("SIGIO", "pthread_sigmask", "sigpending", "sigtimedwait"))):
                self._fail("lease_unsupported", "This host cannot provide the required Linux file-use exclusion")
            if _ACTIVE is not None:
                self._fail("lease_owner_active", "The original process still owns another file-use lease")
            previous = signal.getsignal(signal.SIGIO)
            if previous not in (signal.SIG_DFL, signal.SIG_IGN):
                self._fail("lease_signal_in_use", "Preserve the process's existing SIGIO owner")
            old_mask = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGIO})
            try:
                if signal.SIGIO in old_mask or signal.SIGIO in signal.sigpending():
                    self._fail("lease_signal_in_use", "Preserve the process's existing blocked or pending SIGIO")
                self.previous_handler = previous
                self.previous_mask = old_mask
                signal.signal(signal.SIGIO, self._break)
                self.signal_installed = True
                _ACTIVE = self
                fcntl.fcntl(self.fd, fcntl.F_SETOWN, os.getpid())
                try:
                    fcntl.fcntl(self.fd, fcntl.F_SETLEASE, fcntl.F_WRLCK)
                except OSError as error:
                    code = "file_in_use" if error.errno in (errno.EAGAIN, errno.EWOULDBLOCK) else "lease_unavailable"
                    self._fail(code, "The kernel did not grant exclusive file-use observation; preserve the selected bytes", error)
                self.lease_active = True
                self.acquired_at = _now()
            finally:
                signal.pthread_sigmask(signal.SIG_SETMASK, old_mask)
            self.check()
            return self
        except BaseException as error:
            try:
                self.close()
            finally:
                if isinstance(error, FileUseError) and getattr(error, "owner", self) is self:
                    error.file_use.update(closed_at=self.closed_at, close_pending=self.close_pending)
            raise

    def check(self):
        if self.fd is None:
            self._fail("descriptor_closed", "The selected file-use descriptor is closed")
        if not self.required:
            return
        try:
            current = fcntl.fcntl(self.fd, fcntl.F_GETLEASE)
        except OSError as error:
            self._fail("lease_unavailable", "The original file-use lease cannot be reconciled", error)
        if (self.break_requested or self.release_error is not None or not self.lease_active
                or current != fcntl.F_WRLCK):
            self._fail("lease_interrupted", "A reader, writer or lease break requires preserving the selected file")
        self.checked_at = _now()
        self.observed_lease = "F_WRLCK"
        current_file = os.fstat(self.fd)
        if (current_file.st_dev, current_file.st_ino) != (self.original["device"], self.original["inode"]):
            self._fail("descriptor_changed", "The original file-use descriptor changed")

    def change(self, action, callback):
        if not isinstance(action, str) or not action:
            raise ValueError("Name the exact original filesystem action")
        if not self.required:
            return callback()
        if self.change_active:
            self._fail("lease_mutation_active", "Finish the original synchronous mutation first")
        previous = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGIO})
        # A Python handler queued by another unblocked thread can still execute
        # on this main thread. It may latch a break, but cannot release the
        # descriptor before the actual callback outcome is recorded.
        self.change_active = True
        try:
            self.check()
            row = {"action": action, "started_at": _now(), "returned": False}
            self.actions.append(row)
            value = callback()
            # Preserve the actual syscall result before a queued SIGIO is
            # delivered. A later journal failure must not turn it into no-op.
            row.update(returned=True, returned_at=_now())
            return value
        finally:
            self.change_active = False
            if self.break_requested and self.lease_active:
                self._release_break()
            signal.pthread_sigmask(signal.SIG_SETMASK, previous)

    def close(self):
        global _ACTIVE
        if self.fd is None and not self.signal_installed:
            return
        self.close_pending = True
        previous = None
        if self.signal_installed:
            previous = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGIO})
        try:
            if self.fd is not None:
                try:
                    selected_info = os.fstat(self.fd)
                except OSError as observed:
                    if observed.errno != errno.EBADF:
                        raise
                    self.fd = None
                    self.lease_active = False
                    self.closed_at = _now()
                else:
                    if self.original and (selected_info.st_dev, selected_info.st_ino) != (
                            self.original["device"], self.original["inode"]):
                        self._fail("descriptor_changed", "The retained descriptor number now refers to another file")
            if self.fd is not None:
                if self.lease_active:
                    try:
                        fcntl.fcntl(self.fd, fcntl.F_SETLEASE, fcntl.F_UNLCK)
                        self.lease_active = False
                    except OSError as error:
                        self.release_error = {"errno": error.errno, "message": str(error)}
                selected_fd = self.fd
                try:
                    os.close(selected_fd)
                except OSError as error:
                    # A reported close error can still have closed the Linux
                    # descriptor. Never retry an fd without checking identity.
                    try:
                        remaining = os.fstat(selected_fd)
                    except OSError as observed:
                        if observed.errno != errno.EBADF:
                            raise
                    else:
                        if self.original and (remaining.st_dev, remaining.st_ino) != (
                                self.original["device"], self.original["inode"]):
                            self._fail("descriptor_changed", "Preserve an unexpectedly reused descriptor", error)
                        self._fail("descriptor_close_pending", "The original selected descriptor still needs closure", error)
                self.fd = None
                self.lease_active = False
                self.closed_at = _now()
            if self.signal_installed:
                # All signals queued under our exclusive SIGIO ownership refer
                # to this finished lease. Drain before restoring the old handler.
                while signal.sigtimedwait({signal.SIGIO}, 0) is not None:
                    self.break_requested = True
                signal.signal(signal.SIGIO, self.previous_handler)
                self.signal_installed = False
                if _ACTIVE is self:
                    _ACTIVE = None
            self.close_pending = False
        finally:
            if previous is not None:
                signal.pthread_sigmask(signal.SIG_SETMASK, previous)

    def __exit__(self, typ, error, traceback):
        try:
            self.close()
        finally:
            if isinstance(error, FileUseError) and getattr(error, "owner", self) is self:
                error.file_use.update(closed_at=self.closed_at, close_pending=self.close_pending)
            elif error is not None and self.required and self.actions and not getattr(error, "file_use", None):
                error.file_use = {**self.observation(), "state": "mutation_interrupted",
                                  "error_type": type(error).__name__, "message": str(error)}
        return False


def selected_file(path, *, require_unused=False, dir_fd=None, display_path=None):
    return SelectedFile(path, require_unused=require_unused, dir_fd=dir_fd,
                        display_path=display_path)
