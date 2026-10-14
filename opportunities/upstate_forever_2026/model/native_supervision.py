"""Retained-worker recovery and cancellation for the existing native supervisor.

Process identity and platform signaling stay in native_worker and its OS backends.
This module joins their receipts to the original request, preserves cancellation
progress across reconnect, and closes the parent-exit/worker-registration race.
It never starts a calculation or changes a scientific result.
"""
from __future__ import annotations

import datetime as dt
from pathlib import Path
import signal
import time
from typing import Callable, Mapping

from .common import atomic_json, held, identifier, now, read_json


PROTOCOL = "upstate.native-supervision/v2"


class NativeReceiptError(ValueError):
    """A retained receipt does not belong to the selected original execution."""

    code = "NATIVE_RECEIPT_CHANGED"
    status = 409


def _object(value, label):
    if not isinstance(value, dict):
        raise NativeReceiptError("The saved " + label + " is not an object.")
    return value


def bound_record(directory, name, request, *, digest_required=True):
    """Read one original receipt; a missing file is distinct from a broken one.

    Older heartbeat/reconnection receipts carried execution_id but no request
    digest. Callers explicitly opt into that retained format; a present digest
    is always checked. All original launch/worker/stop/terminal receipts already
    carried both fields and continue to require them.
    """
    path = Path(directory) / name
    try:
        record = read_json(path)
    except FileNotFoundError:
        return None
    except (ValueError, UnicodeError) as error:
        raise NativeReceiptError("The saved " + name + " cannot be read.") from error
    record = _object(record, name)
    if record.get("execution_id") != request["execution_id"]:
        raise NativeReceiptError("The saved " + name + " belongs to another execution.")
    if (digest_required or "request_sha256" in record) and (
            record.get("request_sha256") != request["request_sha256"]):
        raise NativeReceiptError("The saved " + name + " belongs to another request.")
    # A new operator task can reconnect an original programme case. Bind any
    # task/run fields to the retained request, not to that later operator task.
    for key in ("run_id", "task_id"):
        if key in record and key in request and record[key] != request[key]:
            raise NativeReceiptError("The saved " + name + " changed its " + key + ".")
    return record


def _identity(record, name):
    value = record.get("identity")
    if value is None:
        return None
    value = _object(value, name + " process identity")
    if type(value.get("pid")) is not int or value["pid"] <= 0:
        raise NativeReceiptError("The saved " + name + " has an invalid process ID.")
    return value


def refresh_execution(execution):
    """Adopt the original child's complete receipt without importing an OS API."""
    directory, request = execution["directory"], execution["request"]
    launch = bound_record(directory, "launch.json", request)
    worker = bound_record(directory, "worker.json", request)
    if worker is not None:
        identity = _identity(worker, "worker.json")
        if identity is None:
            raise NativeReceiptError("The saved worker has no process identity.")
        # launch.pid is the PID returned by the original owned Popen. A launch
        # sampled before registration may legitimately have identity=None.
        pid = (launch or {}).get("pid")
        if pid is not None and pid != identity["pid"]:
            raise NativeReceiptError("The saved worker differs from its owned launch.")
        execution["worker"], execution["identity"] = worker, identity
    elif launch is not None:
        execution["worker"] = launch
        execution["identity"] = _identity(launch, "launch.json")
    return execution


def worker_lease_held(directory):
    """Observe the original worker lock without acquiring or releasing its owner."""
    try:
        with held(Path(directory) / ".worker.lock", blocking=False):
            return False
    except BlockingIOError:
        return True


def startup_abandoned(directory, request):
    """Called by the child while it holds its original .worker.lock."""
    return bound_record(directory, "startup-abandoned.json", request) is not None


def reconcile_start(execution, identity_matches: Callable[[Mapping], bool]):
    """Resolve a parent that exited between request publication and registration.

    The child publishes worker.json only while holding .worker.lock. Recovery
    uses that same lock and rechecks the complete receipt. If a late child has
    not registered, the marker makes it exit before entering the calculation;
    the supervisor can reconcile this attempt without racing a duplicate run.
    Existing completed/failed work is only read, never rewritten here.
    """
    directory, request = Path(execution["directory"]), execution["request"]
    refresh_execution(execution)
    if execution.get("identity") and identity_matches(execution["identity"]):
        return "registered"
    try:
        with held(directory / ".worker.lock", blocking=False):
            refresh_execution(execution)
            if execution.get("identity") and identity_matches(execution["identity"]):
                return "registered"
            for name in ("result.json", "failure.json", "finished.json"):
                if bound_record(directory, name, request) is not None:
                    return "ended"
            if bound_record(directory, "worker.json", request) is not None:
                return "ended"
            if request.get("supervision_protocol") != PROTOCOL:
                # Old workers did not implement the guarded-start handshake.
                # Retain their original terminal reconciliation, without writing
                # a marker they could ignore. Their live lease is still respected.
                return "ended"
            if not startup_abandoned(directory, request):
                atomic_json(directory / "startup-abandoned.json", {
                    "schema": "upstate.native-startup-abandoned/v1",
                    "execution_id": request["execution_id"],
                    "request_sha256": request["request_sha256"],
                    "at": now(),
                    "reason": "The original launcher ended before worker registration.",
                }, immutable=True)
            return "abandoned"
    except BlockingIOError:
        return "registering"


class StopProgress:
    """Original stop age, then monotonic progress during this attachment."""

    def __init__(self):
        self._key = None
        self._age = 0.0
        self._seen = 0.0

    def elapsed(self, stop):
        key = (stop.get("execution_id"), stop.get("request_sha256"),
               stop.get("requested_at"))
        tick = time.monotonic()
        if key != self._key:
            try:
                requested = dt.datetime.fromisoformat(stop["requested_at"])
                if requested.tzinfo is None:
                    raise ValueError("missing timezone")
                age = (dt.datetime.now(dt.timezone.utc) - requested).total_seconds()
            except (KeyError, TypeError, ValueError) as error:
                raise NativeReceiptError("The saved stop request has no valid timestamp.") from error
            self._key, self._age, self._seen = key, max(0.0, age), tick
        return self._age + max(0.0, tick - self._seen)

    def signal(self, stop):
        age = self.elapsed(stop)
        # 9 is a logical force-stop stage for the existing Win32 Job backend;
        # Windows' Python signal module does not provide SIGKILL.
        return (getattr(signal, "SIGKILL", 9) if age >= 30.0 else
                signal.SIGTERM if age >= 15.0 else signal.SIGINT)


def dispatch_signal(directory, identity, execution_id, request_sha256, signum,
                    *, identity_matches: Callable[[Mapping], bool],
                    dispatch: Callable[[Mapping, int], bool | None]):
    """Deliver a stop stage through the existing platform backend.

    Keep original signal-N.json intentions immutable. A separate dispatch
    receipt distinguishes a successful send from a failed/uncertain attempt.
    An old intention without that receipt can be retried for the exact same
    live process. Only confirmed delivery suppresses another send. No signal
    is sent solely on the strength of a PID or a previous disk receipt.
    """
    directory = Path(directory)
    signum = int(signum)
    if signum not in {int(signal.SIGINT), int(signal.SIGTERM), 9}:
        raise ValueError("Choose a native graceful, terminate or force-stop stage.")
    request = {"execution_id": identifier(execution_id),
               "request_sha256": identifier(request_sha256)}
    with held(directory / ".stop.lock"):
        intent_name = "signal-" + str(signum) + ".json"
        status_name = "signal-" + str(signum) + ".dispatch.json"
        intent = bound_record(directory, intent_name, request)
        status = bound_record(directory, status_name, request)
        for record in (intent, status):
            if record is not None and (record.get("identity") != identity
                                       or record.get("signal_requested") != signum):
                raise NativeReceiptError("The saved stop stage changed its process identity.")
        if not identity_matches(identity):
            return False
        if status and status.get("state") == "sent":
            return True
        if status:
            try:
                retry_age = time.time() - float(status.get("attempt_epoch", 0.0))
            except (ValueError, TypeError) as error:
                raise NativeReceiptError("The saved signal attempt timestamp changed.") from error
            if 0.0 <= retry_age < 0.75:
                return False
        if intent is None:
            atomic_json(directory / intent_name, {
                **request, "signal_requested": signum, "at": now(),
                "identity": identity,
            }, immutable=True)
        previous_attempt = (status or {}).get("attempt", 0)
        if type(previous_attempt) is not int or previous_attempt < 0:
            raise NativeReceiptError("The saved signal attempt count changed.")
        attempt = {
            "schema": "upstate.native-signal-dispatch/v1", **request,
            "signal_requested": signum, "identity": identity,
            "attempt": previous_attempt + 1,
            "attempted_at": now(), "attempt_epoch": time.time(), "state": "attempting",
        }
        atomic_json(directory / status_name, attempt)
        # A backend performs its own final birth/session/job membership check.
        # POSIX dispatch retains killpg; Windows uses its owned Job controller.
        try:
            sent = dispatch(identity, signum) if identity_matches(identity) else False
        except OSError as error:
            attempt.update(state="failed", completed_at=now(), error={
                "type": type(error).__name__, "errno": error.errno,
                "message": str(error),
            })
            atomic_json(directory / status_name, attempt)
            return False
        attempt.update(state="sent" if sent is not False else "not_sent", completed_at=now())
        atomic_json(directory / status_name, attempt)
        return sent is not False


def cancellation_state(directory, request, stop=None):
    """Readable saved progress for the normal task view; never sends a signal."""
    stop = stop if stop is not None else bound_record(directory, "stop.json", request)
    if stop is None:
        return None
    progress = StopProgress()
    elapsed = progress.elapsed(stop)
    rows = []
    for number in (int(signal.SIGINT), int(signal.SIGTERM), 9):
        row = bound_record(directory, "signal-" + str(number) + ".dispatch.json", request)
        if row is not None:
            rows.append({key: value for key, value in row.items()
                         if key not in {"identity", "attempt_epoch"}})
    return {"requested_at": stop["requested_at"], "elapsed_seconds": elapsed,
            "stage": "force_stop" if elapsed >= 30 else "terminate" if elapsed >= 15 else "graceful",
            "dispatches": rows}
