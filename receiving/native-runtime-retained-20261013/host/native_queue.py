#!/usr/bin/env python3
"""Share idle admission work while preserving original native supervisors."""
from __future__ import annotations

import argparse
import fcntl
import json
import os
from pathlib import Path
import signal
import socket
import socketserver
import stat
import subprocess
import sys
import threading
import time

from native_queue_protocol import (
    SCHEMA, DISPATCH_FILES, close_descriptors, digest, environment,
    execution_scope, original_request, private_directory, receive, request,
    runtime_identity, send,
)

# This shell holds no application code or new journal. On dispatch exec keeps
# the same PID/start ticks/process group used by the original admission rows.
# EOF means an undispatched original queue, not a completed or failed command.
_GATE = 'IFS= read -r selected || exit 125; [ "$selected" = dispatch ] || exit 125; exec "$@"'
_SUPERVISOR_LOCK_ENV = "SWARM_NATIVE_SUPERVISOR_LOCK_FD"


def _require_lock_runtime(native):
    if (getattr(native, "NATIVE_LAUNCH_LOCK_SCHEMA", None) != "commons.native-launch-lock/v1"
            or getattr(native, "NATIVE_SUPERVISOR_LOCK_SCHEMA", None) !=
               "commons.native-supervisor-lock/v1"
            or not callable(getattr(native, "launch_lock_descriptor", None))
            or not callable(getattr(native, "supervisor_lock_descriptor", None))
            or not callable(getattr(native, "validate_supervisor_lock_descriptor", None))):
        raise ValueError("Install the complete native shared-queue runtime with supervisor lock transfer")


class QueueLaunch:
    """Original synchronous launch callback; source owns the request and lock."""
    retains_native_supervisor = True
    root = None  # Unlike ForegroundLaunch, the requesting process does not exec.

    def __init__(self, native, directory):
        _require_lock_runtime(native)
        self.native = native
        self.directory = private_directory(directory)
        self.selected_root = self.identity = self.acknowledgement = None
        self.acquired = False

    def __call__(self, root, supplied_environment):
        native = self.native
        original, sha = original_request(native, root)
        selected_environment = environment(supplied_environment)
        descriptors = []
        try:
            descriptors.append(native.launch_lock_descriptor(root))
            descriptors.append(native.supervisor_lock_descriptor(root))
            value = {"schema": SCHEMA, "action": "accept", "record": str(root),
                "request_sha256": sha, "runtime": runtime_identity(native),
                "scope": execution_scope(native, root, original, selected_environment),
                "environment": selected_environment}
            # Failure after send is an uncertain acquisition. Original state
            # and the same record are inspected before any later resume.
            response = request(self.directory, value, descriptors=descriptors)
            if response.get("record") != str(root) or response.get("request_sha256") != sha:
                raise ValueError("The queue acknowledgement selects another original request")
            self.selected_root = root
            self.identity = response["supervisor"]
            self.acquired = response.get("reused") is False
            self.acknowledgement = response
        finally:
            # Never LOCK_UN a transferred open-file description: the accepted
            # gate may already own another copy even if its reply was lost.
            close_descriptors(descriptors)
            selected_environment.clear()


def _rss(identity):
    """Observe this actual process, without attributing another owner's RSS."""
    if not isinstance(identity, dict):
        return None
    try:
        values = {}
        for line in (Path("/proc") / str(identity["proc_pid"]) / "status").read_text().splitlines():
            key, _, value = line.partition(":")
            if key == "VmRSS":
                values["resident_bytes"] = int(value.strip().split()[0]) * 1024
        return values or None
    except (OSError, ValueError, KeyError, IndexError):
        return None


class Guard:
    def __init__(self, controller, root, original, request_sha256, supplied_environment,
                 supervisor_descriptor):
        self.controller, self.native, self.root = controller, controller.native, root
        self.original, self.request_sha256 = original, request_sha256
        self.memory = self.disk = self.recorder = None
        self.child = self.pipe = self.identity = self.launch = None
        self.supervisor_lock = None
        self.dispatched = False
        self.dispatch_reason = None
        self.released = False
        self.releasing = False
        self.closed = False
        self.stage = "acquiring"
        self.accepted_at = self.native.now()
        self.last_poll = 0.0
        self.last_state = None
        self.last_error = None
        self.key = digest((str(root) + "\0" + original["intent"]["operation_id"]).encode())
        self.journal = root / "queue-launch.json"
        self._start(supplied_environment, supervisor_descriptor)

    def _start(self, supplied_environment, supervisor_descriptor):
        native, root = self.native, self.root
        native.validate_supervisor_lock_descriptor(root, supervisor_descriptor)
        gate_environment = dict(supplied_environment)
        # Keep an owned, close-on-exec copy above the standard streams. Popen
        # replaces descriptors 0/1/2, even when one arrived through SCM_RIGHTS.
        inherited = fcntl.fcntl(supervisor_descriptor, fcntl.F_DUPFD_CLOEXEC, 3)
        try:
            self.supervisor_lock = native.validate_supervisor_lock_descriptor(root, inherited)
            gate_environment[_SUPERVISOR_LOCK_ENV] = str(inherited)
            previous = native.read_json(root / "supervisor-launch.json") or {}
            launch = {"schema": native.NATIVE_LAUNCH_SCHEMA, "started_at": native.now(),
                "attempt": previous.get("attempt", 0) + 1, "parent": self.controller.identity,
                "state": "launch_pending", "mode": "shared_queue_gate",
                "supervisor_lock": dict(self.supervisor_lock)}
            native.save_json(root / "supervisor-launch.json", launch)
            descriptor = os.open(root / "supervisor.log", os.O_CREAT | os.O_APPEND | os.O_WRONLY, 0o600)
            with os.fdopen(descriptor, "ab", buffering=0) as log:
                self.child = subprocess.Popen(
                    ["/bin/sh", "-c", _GATE, "native-queue-gate",
                     sys.executable, "-B", str(Path(native.__file__).resolve()), "_supervise", str(root)],
                    stdin=subprocess.PIPE, stdout=log, stderr=subprocess.STDOUT,
                    env=gate_environment, start_new_session=True, close_fds=True,
                    pass_fds=(inherited,))
            self.pipe = self.child.stdin
            # Original native reconciliation works across inherited procfs
            # mounts: the guard's argv ends with _supervise and this exact root.
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline and self.child.poll() is None:
                found = native.live_supervisors(root)
                if len(found) == 1:
                    self.identity = found[0]
                    break
                if len(found) > 1:
                    raise ValueError("The original record has more than one live supervisor")
                time.sleep(0.02)
            if not self.identity or not native.alive(self.identity):
                raise ValueError("The queue gate did not retain its real native process identity")
            launch.update(supervisor=self.identity, state="supervisor_observed",
                          observed_at=native.now())
            self.launch = launch
            native._OWNED_SUPERVISORS[(str(root.resolve()), native._supervisor_launch_key(launch))] = {
                "key": native._supervisor_launch_key(launch), "launch": launch, "child": self.child}
            native.save_json(root / "supervisor-launch.json", launch)
            intent = self.original["intent"]
            self.stage = "queued_disk" if intent.get("disk") else "queued_memory"
            native.save_json(root / "state.json", {"state": self.stage,
                "supervisor": self.identity, "supervisor_mode": "shared_queue_gate",
                "supervisor_lock": dict(self.supervisor_lock),
                "started_at": native.now(), "queue_controller": self.controller.identity})
            self._save()
            if intent.get("memory"):
                from cloud_memory import MemoryAdmission
                self.memory = MemoryAdmission(root, self.original, self.identity)
            if intent.get("disk"):
                from cloud_disk import DiskAdmission
                self.disk = DiskAdmission(root, self.original, self.identity)
            from native_capacity import Recorder
            # Optional resources come from this controller's verified scope.
            # No gate RSS is claimed through Recorder's self-only sampler.
            self.recorder = Recorder.open(root, self.original, supervisor=None)
        except BaseException:
            self._end_gate()
            # A created gate has never received dispatch. Preserve its original
            # recoverable state and actual wait result, without command output.
            if self.launch:
                native.observe_supervisor(root, self.launch)
            raise
        finally:
            # The handler and any actual child still own their separate copies.
            # Closing this duplicate must not explicitly unlock that description.
            os.close(inherited)
            gate_environment.clear()

    def _save(self):
        self.native.save_json(self.journal, {"schema": SCHEMA,
            "record": str(self.root), "operation_id": self.original["intent"]["operation_id"],
            "request_sha256": self.request_sha256, "queue_directory": str(self.controller.directory),
            "controller": self.controller.identity, "supervisor": self.identity,
            "supervisor_lock": dict(self.supervisor_lock),
            "runtime_sha256": self.controller.runtime["sha256"], "accepted_at": self.accepted_at,
            "state": self.stage, "updated_at": self.native.now(),
            **({"dispatch_reason": self.dispatch_reason} if self.dispatch_reason else {})})

    def view(self):
        return {"record": str(self.root), "operation_id": self.original["intent"]["operation_id"],
            "request_sha256": self.request_sha256, "accepted_at": self.accepted_at,
            "state": self.stage, "supervisor": self.identity,
            "supervisor_lock": dict(self.supervisor_lock),
            "native_dispatched": self.dispatched, "supervisor_process": _rss(self.identity),
            "observation_owner": ("original_native_supervisor" if self.dispatched else
                                  "controller_scope_without_supervisor_rss"),
            **({"dispatch_reason": self.dispatch_reason} if self.dispatch_reason else {}),
            **({"error": self.last_error} if self.last_error else {})}

    def _transition(self, state):
        if self.stage == state and self.last_state == state:
            return
        self.stage = state
        current = self.native.read_json(self.root / "state.json") or {}
        if current.get("supervisor") != self.identity:
            raise ValueError("The original queue supervisor changed")
        self.native.save_observation(self.root / "state.json", {
            **current, "state": state, "supervisor_mode": "shared_queue_gate"})
        self._save()
        self.last_state = state

    def _close_recorder(self):
        if self.recorder is not None:
            self.recorder.close()
            self.recorder = None

    def _finish_admissions(self):
        if self.memory is not None:
            self.memory.finish(record_child_peak=False)
            self.memory = None
        if self.disk is not None:
            self.disk.finish()
            self.disk = None

    def _end_gate(self):
        if self.pipe is not None:
            self.pipe.close()
            self.pipe = None
        if self.child is not None and self.child.poll() is None:
            # This is the controller's actual still-idle direct child. EOF is
            # sufficient; no PID from another namespace is reinterpreted.
            self.child.wait(timeout=5)

    def retire_ended(self):
        """Caller already holds this record's original flock, possibly by IPC."""
        if self.child is None or self.child.poll() is None:
            raise ValueError("The original queue process is still live")
        state = self.native.read_json(self.root / "state.json") or {}
        has_command = any((self.root / name).exists() for name in DISPATCH_FILES)
        if not self.dispatched and not has_command and state.get("supervisor") == self.identity:
            self._finish_admissions()
        else:
            # A native handoff, command, or another acquired identity owns any
            # surviving claims. The old queue never finishes another owner's row.
            self.memory = self.disk = None
        self._close_recorder()
        if self.pipe is not None:
            try:
                self.pipe.close()
            except BrokenPipeError:
                pass
            finally:
                self.pipe = None
        self.native.observe_supervisor(self.root, self.launch)
        self.stage = ("original_supervisor_ended" if self.dispatched or
                      (self.root / "result.json").exists() else "interrupted_before_dispatch")
        self.closed = True
        try:
            self._save()
        except OSError:
            # The actual original exit/result remains authoritative.
            pass

    def _stop_idle(self, state, stop):
        if stop.get("supervisor") != self.identity:
            raise ValueError("The stop request selects another original supervisor")
        self._finish_admissions()
        failed = self.native.read_json(self.root / "result.json")
        if failed is not None:
            if (failed.get("supervisor") != self.identity
                    or failed.get("state") != "launch_failed"
                    or failed.get("stop_requested") is not True
                    or failed.get("error") != "stopped_before_dispatch"):
                raise ValueError("Preserve the original retained supervisor result")
        else:
            failed = {**state, "state": "launch_failed", "ended_at": self.native.now(),
                "stop_requested": True, "error": "stopped_before_dispatch",
                "error_stage": "shared_queue_admission"}
            # An authored handoff needs its original durable stop/result pair.
            # Keep the still-idle gate alive if that acknowledgement cannot save.
            if not self.native._retain_supervisor_failure(self.root, failed, self.recorder):
                self.stage = "waiting_for_stop_persistence"
                self.last_error = {"state": self.stage}
                return
        self._close_recorder()
        self._end_gate()
        self.native.observe_supervisor(self.root, self.launch)
        self.stage, self.closed = "stopped_before_dispatch", True
        self.native._release_cancelled_capacity(self.root, self.original, state)
        self._save()

    def release_idle(self):
        if self.dispatched:
            raise ValueError("A started native supervisor remains with its original completion")
        self.releasing = True
        with self.native.run_lock(self.root, blocking=False):
            state = self.native.read_json(self.root / "state.json") or {}
            if state.get("supervisor") != self.identity:
                raise ValueError("The selected original queue owner changed")
            if any((self.root / name).exists() for name in DISPATCH_FILES):
                raise ValueError("Preserve this original dispatched command")
            stop = self.native.read_json(self.root / "stop-request.json")
            if stop is not None:
                self._stop_idle(state, stop)
                return
            if (self.root / "result.json").exists():
                raise ValueError("Preserve the original retained result")
            self._finish_admissions()
            self._close_recorder()
            self._end_gate()
            self.native.observe_supervisor(self.root, self.launch)
            self.stage = "released_before_dispatch"
            self.released = self.closed = True
            self._save()

    def _dispatch(self, reason):
        # Hold the original record lock while making the last cancellation and
        # immutable-request checks. Closing the recorder is before the write
        # that lets the same process enter its original native supervisor.
        with self.native.run_lock(self.root, blocking=False):
            original, sha = original_request(self.native, self.root)
            state = self.native.read_json(self.root / "state.json") or {}
            if sha != self.request_sha256 or state.get("supervisor") != self.identity:
                raise ValueError("The original queued selection changed before dispatch")
            if any((self.root / name).exists() for name in DISPATCH_FILES):
                raise ValueError("Preserve the original command")
            stop = self.native.read_json(self.root / "stop-request.json")
            if stop is not None:
                self._stop_idle(state, stop)
                return
            if (self.root / "result.json").exists():
                raise ValueError("Preserve the original retained result")
            if runtime_identity(self.native) != self.controller.runtime:
                raise ValueError("The selected queue runtime changed before native dispatch")
            self._close_recorder()
            self.stage, self.dispatch_reason = "native_supervisor", reason
            self._save()
            # Drop parent admission objects WITHOUT finish/relinquish. The same
            # PID now adopts the existing rows; the child owns their lifecycle.
            self.memory = self.disk = None
            # Ownership leaves the controller BEFORE the possibly uncertain
            # pipe write. It must never poll/release these rows after any wake
            # attempt; the real child wait status resolves an interrupted wake.
            self.dispatched = True
            try:
                self.pipe.write(b"dispatch\n")
                self.pipe.flush()
            finally:
                self.pipe.close()
                self.pipe = None

    def poll(self, *, permit_writer_waiter):
        if self.closed:
            return
        if self.releasing and not self.dispatched:
            self.release_idle()
            return
        if self.dispatched:
            self.native.observe_supervisor(self.root, self.launch)
            if self.child.poll() is not None:
                # The unchanged supervisor owns completion. This observation
                # never creates, rewrites or replays its application result.
                self.stage = "native_supervisor_ended"
                self._save()
                self.closed = True
            return
        with self.native.run_lock(self.root, blocking=False):
            original, sha = original_request(self.native, self.root)
            state = self.native.read_json(self.root / "state.json") or {}
            if sha != self.request_sha256 or state.get("supervisor") != self.identity:
                raise ValueError("The queued original request or owner changed")
            if self.child.poll() is not None:
                self.retire_ended()
                return
            if any((self.root / name).exists() for name in DISPATCH_FILES):
                raise ValueError("The idle gate unexpectedly has a command")
            stop = self.native.read_json(self.root / "stop-request.json")
            if stop is not None:
                self._stop_idle(state, stop)
                return
            if (self.root / "result.json").exists():
                raise ValueError("The idle gate unexpectedly has a retained result")
        if self.recorder is not None:
            self.recorder.sample(self.stage)
        memory_decision = None
        if self.memory is not None and self.disk is not None:
            memory_decision = self.memory.attempt(reserve=False)
            if memory_decision["state"] == "memory_request_exceeds_limit":
                self._dispatch("original_limit_decision")
                return
        if self.disk is not None:
            # The parent never performs the gate's same-writer allocation.
            disk_decision = self.disk.attempt(allow_allocation=False)
            if disk_decision["state"] == "disk_request_exceeds_limit":
                self._dispatch("original_limit_decision")
                return
            if disk_decision["state"] != "admitted":
                if self.memory is not None:
                    self.memory.relinquish("waiting_for_disk")
                self._transition("queued_disk")
                if (permit_writer_waiter
                        and disk_decision.get("reason") == "writer_allocation_waiting_for_memory"
                        and (memory_decision is None or
                             memory_decision.get("capacity_feasible") is True
                             and all(memory_decision["requested_bytes"]
                                 + self.original["intent"]["memory"]["reserve_bytes"]
                                 <= row["admission_available_bytes"]
                                 + row.get("resident_private_credit_bytes", 0)
                                 for row in memory_decision["resources"]))):
                    self._dispatch("original_same_writer_allocation")
                return
        if self.memory is not None:
            decision = self.memory.attempt()
            if decision["state"] == "memory_request_exceeds_limit":
                self._dispatch("original_limit_decision")
                return
            if decision["state"] != "admitted":
                if self.disk is not None:
                    self.disk.relinquish()
                self._transition("queued_memory")
                return
        self._dispatch("original_capacity_reserved")

    def storage_wait(self, error):
        if self.dispatched or self.closed:
            return
        # Preserve committed claims until their original relinquish can commit.
        # No command is woken after a failed mandatory journal/ledger write.
        for selected in (self.memory, self.disk):
            if selected is not None:
                try:
                    selected.relinquish("waiting_for_storage")
                except OSError:
                    pass
        self.last_error = {"kind": type(error).__name__, "errno": error.errno,
                           "state": "waiting_for_storage"}
        if self.recorder is not None:
            self.recorder.sample("waiting_for_storage")


class Controller:
    def __init__(self, native, directory, *, limit=256, poll_seconds=2):
        _require_lock_runtime(native)
        self.native = native
        self.directory = private_directory(directory, create=True)
        self.runtime = runtime_identity(native)
        self.identity = native.process_identity(os.getpid())
        if self.identity is None:
            raise ValueError("The controller cannot retain its actual process identity")
        self.limit, self.poll_seconds = limit, poll_seconds
        self.guards = {}
        self.recent = []
        self.lock = threading.RLock()
        self.draining = self.stopping = False
        self.server = None
        self.version = 0
        self.started_at = native.now()

    def _save(self):
        self.native.save_json(self.directory / "controller.json", self.status())

    def status(self):
        with self.lock:
            return {"schema": SCHEMA, "ok": True, "controller": self.identity,
                "queue_directory": str(self.directory), "started_at": self.started_at,
                "runtime": self.runtime, "accepting": not self.draining and not self.stopping,
                "draining": self.draining, "stopping": self.stopping, "version": self.version,
                "controller_process": _rss(self.identity),
                "records": [guard.view() for _, guard in sorted(self.guards.items())],
                "recent": list(self.recent)}

    def _accept(self, value, descriptors):
        if len(descriptors) != 2:
            raise ValueError("Accept requires the original held record and supervisor locks")
        root = Path(value["record"])
        original, sha = original_request(self.native, root)
        if sha != value.get("request_sha256"):
            raise ValueError("The original native request changed")
        if value.get("runtime") != self.runtime:
            raise ValueError("Client and controller must use the same selected complete runtime")
        selected_environment = environment(value.get("environment"))
        try:
            if execution_scope(self.native, root, original, selected_environment) != value.get("scope"):
                raise ValueError("The selected source/filesystems/cgroups differ from this controller")
            info = os.fstat(descriptors[0])
            selected = (root / ".lock").stat()
            if (not stat.S_ISREG(info.st_mode) or (info.st_dev, info.st_ino) !=
                    (selected.st_dev, selected.st_ino)):
                raise ValueError("The descriptor is not this original native record lock")
            # It is the same open-file description, not a second open of .lock.
            # Closing the received descriptor leaves the sender's flock held.
            fcntl.flock(descriptors[0], fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.native.validate_supervisor_lock_descriptor(root, descriptors[1])
            with self.lock:
                key = digest((str(root) + "\0" + original["intent"]["operation_id"]).encode())
                existing = self.guards.get(key)
                if existing is not None:
                    state = self.native.read_json(root / "state.json") or {}
                    if existing.child is not None and existing.child.poll() is None:
                        if (existing.request_sha256 != sha or
                                state.get("supervisor") != existing.identity or existing.closed):
                            raise ValueError("A live queue entry retains another selected ownership state")
                        return {"schema": SCHEMA, "ok": True, "reused": True,
                                "record": str(root), "request_sha256": sha, **existing.view()}
                    # A synchronous resume may arrive before the next controller
                    # poll. Reconcile its actual ended gate under the PASSED
                    # original flock; never acknowledge a dead acquisition.
                    existing.retire_ended()
                    self.recent.append(existing.view())
                    self.recent = self.recent[-32:]
                    del self.guards[key]
                    self.version += 1
                if self.draining or self.stopping:
                    raise ValueError("The original controller is draining; select its retained queue state")
                if len(self.guards) >= self.limit:
                    raise ValueError("The original controller has reached its active queue limit")
                state = self.native.read_json(root / "state.json") or {}
                if self.native.alive(state.get("supervisor")):
                    raise ValueError("An existing live supervisor still owns this original record")
                if any((root / name).exists() for name in
                       (*DISPATCH_FILES, "result.json", "stop-request.json")):
                    raise ValueError("Preserve the original command, result or stop request")
                if state.get("state") not in (*self.native.CAPACITY_RESUMABLE_STATES, "starting"):
                    raise ValueError("Select the original pre-dispatch capacity queue")
                guard = Guard(self, root, original, sha, selected_environment, descriptors[1])
                self.guards[key] = guard
                self.version += 1
                try:
                    self._save()
                except OSError:
                    # Guard + canonical original record already retain custody.
                    # An uncertain reply must not remove that accepted owner.
                    pass
                return {"schema": SCHEMA, "ok": True, "reused": False,
                        "record": str(root), "request_sha256": sha, **guard.view()}
        finally:
            selected_environment.clear()

    def handle(self, value, descriptors):
        if value.get("schema") != SCHEMA:
            raise ValueError("Unsupported native queue protocol")
        action = value.get("action")
        if action == "accept":
            return self._accept(value, descriptors)
        if descriptors:
            raise ValueError("Only native acceptance receives lock descriptors")
        if action == "status":
            return self.status()
        if action == "drain":
            with self.lock:
                self.draining = True
                self._save()
            return self.status()
        if action in ("stop", "release"):
            with self.lock:
                root = str(Path(value["record"]).resolve())
                selected = [guard for guard in self.guards.values() if str(guard.root) == root]
                if len(selected) != 1:
                    raise ValueError("The selected original record is not active in this controller")
                guard = selected[0]
                if value.get("expected_supervisor") is not None and value["expected_supervisor"] != guard.identity:
                    raise ValueError("The selected original queue owner changed")
                if action == "release":
                    guard.release_idle()
                    return {"schema": SCHEMA, "ok": True, **guard.view()}
                report = self.native.stop(guard.root, expected_supervisor=guard.identity, blocking=False)
                return {"schema": SCHEMA, "ok": True, "native": report, **guard.view()}
        raise ValueError("Select status, accept, stop, release or drain")

    def poll(self):
        with self.lock:
            heavy_waiters = 0
            for guard in self.guards.values():
                if guard.dispatched and not guard.closed and guard.child.poll() is None:
                    state = self.native.read_json(guard.root / "state.json") or {}
                    if not (guard.root / "process.json").exists() and state.get("state") not in self.native.TERMINAL:
                        heavy_waiters += 1
            for key, guard in list(self.guards.items()):
                try:
                    was_dispatched = guard.dispatched
                    guard.last_error = None
                    guard.poll(permit_writer_waiter=heavy_waiters == 0)
                    if not was_dispatched and guard.dispatched:
                        heavy_waiters += 1
                except BlockingIOError:
                    # A source caller may hold this root while requesting
                    # acquisition. Never wait for it under the controller lock.
                    guard.last_error = {"state": "waiting_for_original_record_lock"}
                except OSError as exc:
                    if self.native.space_exhausted(exc):
                        guard.storage_wait(exc)
                    else:
                        guard.last_error = {"kind": type(exc).__name__, "errno": exc.errno}
                except (ValueError, KeyError, TypeError, subprocess.TimeoutExpired) as exc:
                    # Keep the original acquired gate and selected request.
                    # Operators can inspect/release it; no replacement run.
                    guard.last_error = {"kind": type(exc).__name__, "message": str(exc)}
                if guard.closed:
                    self.recent.append(guard.view())
                    self.recent = self.recent[-32:]
                    del self.guards[key]
                    self.version += 1
                    try:
                        self._save()
                    except OSError:
                        pass

    def request_shutdown(self):
        self.stopping = self.draining = True

    def shutdown_idle(self):
        with self.lock:
            for guard in list(self.guards.values()):
                if not guard.dispatched and not guard.closed:
                    try:
                        guard.release_idle()
                    except (OSError, ValueError, subprocess.TimeoutExpired) as exc:
                        guard.last_error = {"kind": type(exc).__name__}

    def close(self):
        self._save()


class QueueServer(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = False
    block_on_close = True
    allow_reuse_address = False

    def __init__(self, address, controller):
        self.controller = controller
        self.admission = threading.BoundedSemaphore(8)
        super().__init__(address, QueueHandler)
        os.chmod(address, 0o600)

    def process_request(self, request_socket, client_address):
        if not self.admission.acquire(blocking=False):
            request_socket.close()
            return
        try:
            super().process_request(request_socket, client_address)
        except BaseException:
            self.admission.release()
            raise

    def process_request_thread(self, request_socket, client_address):
        try:
            super().process_request_thread(request_socket, client_address)
        finally:
            self.admission.release()


class QueueHandler(socketserver.BaseRequestHandler):
    def handle(self):
        descriptors = []
        try:
            self.request.settimeout(30)
            credentials = self.request.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12)
            import struct
            _, uid, _ = struct.unpack("3i", credentials)
            if uid != os.geteuid():
                raise ValueError("The native queue accepts only its owning user")
            value, descriptors = receive(self.request)
            response = self.server.controller.handle(value, descriptors)
            send(self.request, response)
        except (OSError, EOFError, ValueError, KeyError, TypeError) as exc:
            try:
                send(self.request, {"schema": SCHEMA, "ok": False,
                     "error": type(exc).__name__, "message": str(exc)})
            except (OSError, ValueError):
                pass
        finally:
            close_descriptors(descriptors)


def serve(native, directory, *, limit=256, poll_seconds=2):
    directory = private_directory(directory, create=True)
    descriptor = os.open(directory / ".controller.lock", os.O_CREAT | os.O_RDWR, 0o600)
    with os.fdopen(descriptor, "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        controller = Controller(native, directory, limit=limit, poll_seconds=poll_seconds)
        selected_socket = directory / "control.sock"
        if selected_socket.exists():
            info = selected_socket.lstat()
            if not stat.S_ISSOCK(info.st_mode) or info.st_uid != os.geteuid():
                raise ValueError("Preserve the unexpected file at the native queue socket")
            selected_socket.unlink()
        server = QueueServer(str(selected_socket), controller)
        thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.2},
                                  name="native-queue-control", daemon=False)
        previous = {name: signal.getsignal(name) for name in (signal.SIGTERM, signal.SIGINT)}
        started = False
        try:
            for name in previous:
                signal.signal(name, lambda *_: controller.request_shutdown())
            thread.start()
            started = True
            controller._save()
            print(json.dumps({"schema": SCHEMA, "ok": True, "state": "listening",
                "queue_directory": str(directory), "controller": controller.identity,
                "runtime_sha256": controller.runtime["sha256"]}), flush=True)
            while True:
                if controller.stopping:
                    controller.shutdown_idle()
                controller.poll()
                if controller.draining and not controller.guards:
                    break
                time.sleep(poll_seconds)
        finally:
            controller.draining = True
            if started:
                server.shutdown()
                thread.join()
            server.server_close()
            # Active supervisors stay in this retained foreground scope.
            # SIGTERM releases only idle gates and drains original native jobs.
            controller.shutdown_idle()
            while any(not guard.closed for guard in controller.guards.values()):
                controller.poll()
                time.sleep(poll_seconds)
            try:
                controller.close()
            finally:
                selected_socket.unlink(missing_ok=True)
                for name, previous_handler in previous.items():
                    signal.signal(name, previous_handler)
    return 0


def main(argv=None):
    from native_foreground import load_native
    values = list(sys.argv[1:] if argv is None else argv)
    command = []
    if "--" in values:
        index = values.index("--")
        command, values = values[index + 1:], values[:index]
    # Resolve only the source selector before constructing its actual native
    # launch arguments. An unfinished subparser must not parse start/resume.
    bootstrap = argparse.ArgumentParser(add_help=False)
    bootstrap.add_argument("--host-root", default=str(Path(__file__).resolve().parent))
    selected, _ = bootstrap.parse_known_args(values)
    try:
        native = load_native(selected.host_root)
    except (OSError, ValueError) as exc:
        print(json.dumps({"schema": SCHEMA, "ok": False,
                         "error": type(exc).__name__, "message": str(exc)}), file=sys.stderr)
        return 2
    parser = argparse.ArgumentParser(description=__doc__, parents=[bootstrap])
    subs = parser.add_subparsers(dest="action", required=True)
    for action in ("serve", "status", "drain"):
        sub = subs.add_parser(action)
        sub.add_argument("--directory", required=True)
        if action == "serve":
            sub.add_argument("--max-queued", type=int, default=256)
            sub.add_argument("--poll-seconds", type=float, default=2)
    for action in ("start", "run"):
        sub = subs.add_parser(action)
        native.launch_options(sub)
        sub.add_argument("--directory", required=True)
    for action in ("resume", "stop", "release"):
        sub = subs.add_parser(action)
        sub.add_argument("operation_id")
        sub.add_argument("--records-root")
        sub.add_argument("--directory", required=True)
        if action == "resume":
            sub.add_argument("--recover-failure")
        else:
            sub.add_argument("--expected-supervisor", type=Path)
    args = parser.parse_args(values)
    try:
        if command and args.action not in ("start", "run"):
            raise ValueError("Only start/run accepts an original command after --")
        if args.action == "serve":
            if not 1 <= args.max_queued <= 256 or not 0.2 <= args.poll_seconds <= 60:
                raise ValueError("Choose 1–256 active records and a 0.2–60 second poll interval")
            return serve(native, args.directory, limit=args.max_queued, poll_seconds=args.poll_seconds)
        if args.action in ("status", "drain"):
            report = request(args.directory, {"schema": SCHEMA, "action": args.action})
        elif args.action in ("start", "run"):
            args.command = command
            if getattr(args, "queue_directory", None):
                raise ValueError("This queue entrypoint uses --directory")
            report = native.start(args, launcher=QueueLaunch(native, args.directory))
        elif args.action == "resume":
            root = native.run_path(args.operation_id, args.records_root)
            report = native.resume_capacity(root, launcher=QueueLaunch(native, args.directory),
                                           recover_failure=args.recover_failure)
        else:
            root = native.run_path(args.operation_id, args.records_root)
            value = {"schema": SCHEMA, "action": args.action, "record": str(root)}
            if args.expected_supervisor is not None:
                value["expected_supervisor"] = json.loads(args.expected_supervisor.read_text())
            report = request(args.directory, value)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        if args.action == "run":
            # Consume the maintained original follower.
            report, _ = native.stream_log(Path(report["record"]), follow=True)
            print(json.dumps(native.report_value(report, "summary")), file=sys.stderr, flush=True)
            return native.exit_status(report)
        return 0
    except (OSError, EOFError, ValueError, KeyError, TypeError) as exc:
        print(json.dumps({"schema": SCHEMA, "ok": False,
                         "error": type(exc).__name__, "message": str(exc)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
