"""Retain the original child exit before native artifact finalization.

The existing supervisor reserves one small file before command dispatch. Its
second slot records the actual wait result using already allocated bytes. Later
finalization consumes that original outcome and never launches a command.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import stat

SCHEMA = "commons.native-command-completion/v1"
FILENAME = "command-completion.dat"
SLOT_BYTES = 8192
FILE_BYTES = 2 * SLOT_BYTES
MAGIC = b"CNCEXIT1"


def _native():
    if __package__:
        from . import swarm_cloud_job
    else:
        import swarm_cloud_job
    return swarm_cloud_job


def _encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False).encode("utf-8")


def _binding(request):
    return {"schema": SCHEMA, "operation_id": request["intent"]["operation_id"],
            "intent_sha256": hashlib.sha256(_encoded(request["intent"])).hexdigest()}


def _frame(value):
    body = _encoded(value)
    head = MAGIC + b"\n" + str(len(body)).encode("ascii") + b"\n"
    head += hashlib.sha256(body).hexdigest().encode("ascii") + b"\n"
    if len(head) + len(body) > SLOT_BYTES:
        raise ValueError("Original command completion exceeds its reserved slot")
    return (head + body).ljust(SLOT_BYTES, b"\0")


def _decode(data):
    if not data.strip(b"\0"):
        return None
    try:
        magic, raw_size, digest, rest = data.split(b"\n", 3)
        size = int(raw_size)
        if magic != MAGIC or not 0 < size <= len(rest):
            raise ValueError("invalid completion frame")
        body = rest[:size]
        if hashlib.sha256(body).hexdigest().encode("ascii") != digest:
            raise ValueError("incomplete completion write")
        value = json.loads(body)
        if not isinstance(value, dict):
            raise ValueError("invalid completion value")
        return value
    except (UnicodeError, ValueError) as exc:
        raise ValueError("Original command completion record is incomplete or changed") from exc


def _check(value, request, kind):
    if value is None or value.get("kind") != kind or any(
            value.get(key) != expected for key, expected in _binding(request).items()):
        raise ValueError("Completion record differs from its original native request")
    if kind == "exited":
        outcome = value.get("outcome")
        if (not isinstance(outcome, dict) or type(outcome.get("exit_code")) is not int
                or outcome.get("state") not in ("completed", "failed")
                or not outcome.get("ended_at")):
            raise ValueError("Completion record lacks the original child exit outcome")
    return value


def _slots(fd, request):
    metadata = os.fstat(fd)
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_size != FILE_BYTES:
        raise ValueError("Original command completion storage changed")
    prepared = _check(_decode(os.pread(fd, SLOT_BYTES, 0)), request, "prepared")
    ended = _decode(os.pread(fd, SLOT_BYTES, SLOT_BYTES))
    if ended is not None:
        _check(ended, request, "exited")
    return prepared, ended


def _write_at(fd, value, offset):
    data = _frame(value)
    written = 0
    while written < len(data):
        size = os.pwrite(fd, data[written:], offset + written)
        if size <= 0:
            raise OSError("Original completion write made no progress")
        written += size
    os.fsync(fd)


class ExitRecord:
    def __init__(self, fd, request):
        self.fd, self.request = fd, request
        self.outcome = None

    def retain(self, outcome):
        value = {**_binding(self.request), "kind": "exited", "outcome": outcome}
        _check(value, self.request, "exited")
        # wait() has already returned this validated outcome. Preserve it in
        # the supervisor before slot reads/writes or fsync can fail, so the
        # existing result.json fallback can retain the actual exit.
        self.outcome = outcome
        _, prior = _slots(self.fd, self.request)
        if prior:
            if prior["outcome"] != outcome:
                self.outcome = prior["outcome"]
                raise ValueError("An original child exit is already retained")
        else:
            _write_at(self.fd, value, SLOT_BYTES)
        return outcome

    def close(self):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None


def reserve(root, request):
    """Allocate completion bytes and persist the directory before dispatch."""
    path = Path(root) / FILENAME
    flags = os.O_RDWR | getattr(os, "O_NOFOLLOW", 0)
    created = False
    fd = None
    try:
        try:
            fd = os.open(path, flags | os.O_CREAT | os.O_EXCL, 0o600)
            created = True
        except FileExistsError:
            fd = os.open(path, flags)
        if created:
            os.posix_fallocate(fd, 0, FILE_BYTES)
            _write_at(fd, {**_binding(request), "kind": "prepared",
                          "prepared_at": _native().now()}, 0)
            directory = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        _, ended = _slots(fd, request)
        if ended is not None:
            raise ValueError("The original command already has a retained exit; finalize it")
        return ExitRecord(fd, request)
    except BaseException:
        if fd is not None:
            os.close(fd)
        if created:
            path.unlink(missing_ok=True)
        raise


def observe(root, request):
    """Read completion without making an old operation depend on new metadata."""
    path = Path(root) / FILENAME
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except FileNotFoundError:
        return None
    except OSError as exc:
        return {"schema": SCHEMA, "state": "unavailable", "error": type(exc).__name__}
    try:
        prepared, ended = _slots(fd, request)
        return {"schema": SCHEMA, "state": "exited" if ended else "prepared",
                "record": str(path), "reserved_bytes": FILE_BYTES,
                "prepared_at": prepared["prepared_at"],
                **({"outcome": ended["outcome"]} if ended else {})}
    except (OSError, ValueError, KeyError) as exc:
        return {"schema": SCHEMA, "state": "unavailable", "record": str(path),
                "error": type(exc).__name__}
    finally:
        os.close(fd)


def prepared_snapshot(root, request):
    """Select the original prepared allocation while its supervisor lease is held."""
    path = Path(root) / FILENAME
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | os.O_NONBLOCK)
    except FileNotFoundError:
        return None
    try:
        before = os.fstat(fd)
        prepared, ended = _slots(fd, request)
        if ended is not None:
            return None
        raw = os.pread(fd, FILE_BYTES + 1, 0)
        after, named = os.fstat(fd), path.lstat()
        keys = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
        if (len(raw) != FILE_BYTES or
                any(getattr(before, key) != getattr(after, key) for key in keys) or
                any(getattr(after, key) != getattr(named, key) for key in keys)):
            raise ValueError("Original prepared completion changed during selection")
        return {**_binding(request), "state": "prepared", "record": str(path),
                "reserved_bytes": FILE_BYTES, "prepared_at": prepared["prepared_at"],
                "sha256": hashlib.sha256(raw).hexdigest()}
    finally:
        os.close(fd)


def finish(root, request, outcome):
    """Finalize only selected outputs after the original wait result exists."""
    native = _native()
    from native_artifact_selection import selected
    paths, selection = selected(root, request, outcome)
    from native_artifact_retention import enabled, retain
    retaining = enabled(root, request)
    outputs = (retain(root, request, outcome, paths, selection) if retaining else
               {**native.collect_artifacts(Path(request["intent"]["project"]), paths),
                "artifact_selection": selection})
    native.save_json(Path(root) / "artifacts.json", outputs)
    result = {**outcome, "artifact_selection": selection,
              "artifacts": {"manifest": str(Path(root) / "artifacts.json"),
                            "files": len(outputs["files"]),
                            "bytes": sum(row["bytes"] for row in outputs["files"]),
                            "errors": outputs["errors"],
                            **({"retention": outputs["retention"]} if retaining else {})}}
    if outputs["errors"] and (outcome["exit_code"] == 0 or retaining):
        result.update(state="finalization_pending", error="selected_artifacts_incomplete")
    from native_artifact_delivery import finish as finish_deliveries
    deliveries = finish_deliveries(root, request)
    if deliveries["items"]:
        result["deliveries"] = deliveries
        if not deliveries["complete"]:
            result.update(state="finalization_pending", error="prepared_deliveries_incomplete")
    native.save_json(Path(root) / "result.json", result)
    return result


def recover(root, *, selection=None, amendment_id=None, reason=None, expected_revision=None, retain_artifacts=False):
    """Finish or explicitly amend one retained command's artifact selection."""
    native = _native()
    root = Path(root)
    if selection is None and any(value is not None for value in (amendment_id, reason, expected_revision)):
        raise ValueError("Artifact amendment fields require a replacement selection")
    from native_artifact_selection import amend, resume_pending, view
    amendment = None
    finalized = False
    with native.run_lock(root):
        request = native.read_json(root / "request.json")
        if request is None:
            raise ValueError("Original native request not found")
        result = native.read_json(root / "result.json") or {}
        state = native.read_json(root / "state.json") or {}
        identities = (state.get("supervisor"), state.get("process"),
                      native.read_json(root / "process.json"), result.get("supervisor"),
                      result.get("process"))
        if any(native.alive(identity) for identity in identities):
            raise ValueError("The original native execution is still live; reconnect to it")
        observation = observe(root, request) or {}
        outcome = observation.get("outcome")
        if outcome is None and type(result.get("exit_code")) is int and result.get("ended_at"):
            # Older genuine results already retain the actual wait outcome.
            outcome = {key: result[key] for key in
                       ("started_at", "ended_at", "exit_code", "stop_requested", "supervisor", "process")
                       if key in result}
            outcome["state"] = "completed" if outcome["exit_code"] == 0 else "failed"
        if outcome is None:
            raise ValueError("The original child exit is unavailable; preserve this native operation")
        from native_artifact_retention import enable, complete as retained_complete
        if type(retain_artifacts) is not bool:
            raise ValueError("Choose whether to retain original output bytes")
        if retain_artifacts:
            enable(root, request)
        if selection is not None:
            amendment = amend(root, request, outcome, selection=selection,
                              amendment_id=amendment_id, reason=reason, expected_revision=expected_revision)
        else:
            resume_pending(root, request, outcome)
        current = view(root, request)
        manifest = native.read_json(root / "artifacts.json")
        result_revision = (result.get("artifact_selection") or {}).get("revision", 0)
        manifest_revision = ((manifest or {}).get("artifact_selection") or {}).get("revision", 0)
        from native_artifact_delivery import complete as deliveries_complete
        complete = (result.get("state") in ("completed", "failed") and
                    result.get("artifacts") and not result["artifacts"].get("errors") and
                    manifest is not None and not manifest.get("errors") and
                    result_revision == manifest_revision == current["revision"] and
                    retained_complete(root, request, manifest, outcome) and
                    deliveries_complete(root, request))
        if not complete:
            finish(root, request, outcome)
            finalized = True
    # Release after the native record lock; the existing registry lock has its
    # own original liveness checks and never changes the retained child exit.
    try:
        from runtime_consumers import release
        runtime_release = release(root)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        runtime_release = {"released": False, "state": "release_pending", "error": type(exc).__name__}
    return {**native.inspect(root), "reused": True, "finalized": finalized,
            "runtime_release": runtime_release,
            **({"artifact_amendment": amendment} if amendment is not None else {})}
