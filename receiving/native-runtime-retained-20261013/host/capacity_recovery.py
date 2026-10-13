"""Retain one original pre-dispatch failure before the native resume acquires it."""
from __future__ import annotations

import base64
import hashlib
import json
import os
from pathlib import Path
import re

SCHEMA = "commons.native-capacity-failure-recovery/v1"
DISPATCH_FILES = ("process.json", "output.log", "command-completion.dat")


def _sha(raw):
    return hashlib.sha256(raw).hexdigest()


def _selection(value):
    if not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{64}", value) is None:
        raise ValueError("Select the exact failed result SHA-256 returned by native status")
    return value


def _path(root, sha):
    return root / "capacity-recoveries" / _selection(sha) / "recovery.json"


def _registration_failure(state, result):
    """Recognize start's retained failure before it could launch a supervisor."""
    return (state.get("state") == "launch_pending" and isinstance(result, dict)
            and result.get("state") == "launch_failed"
            and result.get("error") == "runtime_registration_failed"
            and state.get("supervisor") is None and result.get("supervisor") is None)


def _reason(native, root, request, state, result):
    if not request or request.get("schema") != native.SCHEMA:
        return "original_request_unavailable"
    intent = request.get("intent", {})
    if native.run_path(intent.get("operation_id"), root.parent) != root:
        return "original_record_mismatch"
    if not (intent.get("memory") or intent.get("disk")):
        return "capacity_request_required"
    registration_failure = _registration_failure(state, result)
    # Capacity admission enters starting before any command dispatch record.
    # Recover only an explicitly retained failure in those original phases.
    starting_failure = (state.get("state") == "starting" and isinstance(result, dict)
                        and result.get("error_stage") in (
                            "runtime_registration", "completion_reservation", "command_log"))
    if (state.get("state") not in native.CAPACITY_QUEUED_STATES
            and not starting_failure and not registration_failure):
        return "original_state_not_queued"
    if (not result or result.get("state") != "launch_failed" or
            (result.get("stop_requested") is not False
             and not (registration_failure and result.get("stop_requested") is None)) or
            result.get("cancelled_before_dispatch")):
        return "preserve_original_terminal_outcome"
    if state.get("process") or result.get("process") or any((root / name).exists() for name in DISPATCH_FILES):
        return "command_dispatch_recorded"
    if (root / "stop-request.json").exists():
        return "original_cancellation_present"
    if registration_failure:
        # start persists this result inside run_lock before invoking its launcher.
        # Any later launch marker or observed owner invalidates that boundary.
        if any((root / name).exists() for name in ("supervisor-launch.json", "supervisor.log")):
            return "original_supervisor_launch_recorded"
        if native.live_supervisors(root):
            return "original_supervisor_not_ended"
    else:
        if result.get("supervisor") != state.get("supervisor"):
            return "original_supervisor_changed"
        if not native._supervisor_ended(state.get("supervisor")):
            return "original_supervisor_not_ended"
    pointer = native.read_json(root / "runtime-handoff.json")
    if pointer is not None:
        import native_runtime_handoff
        handoff = native_runtime_handoff.active(native, root)
        if handoff and handoff.get("phase") not in ("resumed", "resumed_elsewhere"):
            return "continue_original_runtime_handoff"
    return None


def observe(native, root, request):
    """Expose the explicit selector without changing the original operation."""
    prior = native.read_json(root / "capacity-recovery.json")
    report = None
    if prior is not None:
        if prior.get("schema") != SCHEMA:
            raise ValueError("Preserve the original capacity recovery record")
        saved = native.read_json(_path(root, prior["failure_sha256"]))
        if not saved or saved.get("schema") != SCHEMA:
            raise ValueError("The original capacity recovery archive is incomplete")
        report = {"schema": SCHEMA, "failure_sha256": prior["failure_sha256"],
                  "phase": saved["phase"], "archive": str(_path(root, prior["failure_sha256"]))}
    path = root / "result.json"
    if path.is_file():
        raw = path.read_bytes()
        result = json.loads(raw)
        if result.get("state") == "launch_failed":
            reason = _reason(native, root, request, native.read_json(root / "state.json") or {}, result)
            report = {**(report or {}), "schema": SCHEMA, "failure_sha256": _sha(raw),
                      "can_recover": reason is None, "reason": reason}
    return report


def prepare(native, root, expected):
    """Called under the original native record lock; never dispatches work."""
    expected = _selection(expected)
    request_raw = (root / "request.json").read_bytes()
    request = json.loads(request_raw)
    state_raw = (root / "state.json").read_bytes()
    state = json.loads(state_raw)
    path = _path(root, expected)
    saved = native.read_json(path)
    result_path = root / "result.json"
    if not result_path.exists():
        pointer = native.read_json(root / "capacity-recovery.json")
        if (not saved or saved.get("schema") != SCHEMA or
                saved.get("failure_sha256") != expected or
                saved.get("request_sha256") != _sha(request_raw) or
                not pointer or pointer.get("schema") != SCHEMA or
                pointer.get("failure_sha256") != expected):
            raise ValueError("Select this original failed result or continue its existing recovery")
        if saved.get("phase") not in ("prepared", "armed", "resumed"):
            raise ValueError("Preserve the original capacity recovery phase")
        if state.get("supervisor") is None and saved.get("previous_supervisor") is None:
            # arm may have removed the selected result before acquisition.
            # Revalidate its byte-exact archive and the same never-launched state.
            archived_raw = base64.b64decode(saved["result_base64"], validate=True)
            archived_state = json.loads(base64.b64decode(saved["state_base64"], validate=True))
            archived_result = json.loads(archived_raw)
            if (_sha(archived_raw) != expected
                    or not _registration_failure(archived_state, archived_result)):
                raise ValueError("Preserve the original registration-failure archive")
            reason = _reason(native, root, request, state, archived_result)
            if reason is not None:
                raise ValueError("The original registration recovery changed: " + reason)
        elif not native._supervisor_ended(state.get("supervisor")):
            raise ValueError("The original queued supervisor has not positively ended")
        return saved
    result_raw = result_path.read_bytes()
    if _sha(result_raw) != expected:
        raise ValueError("The original failure changed; inspect this same operation before recovery")
    result = json.loads(result_raw)
    reason = _reason(native, root, request, state, result)
    if reason is not None:
        raise ValueError("This original failure cannot resume: " + reason)
    if saved:
        if (saved.get("schema") != SCHEMA or saved.get("failure_sha256") != expected or
                saved.get("request_sha256") != _sha(request_raw) or
                saved.get("previous_supervisor") != state.get("supervisor") or
                base64.b64decode(saved["result_base64"], validate=True) != result_raw):
            raise ValueError("Preserve the exact original failed-result recovery archive")
        return saved
    saved = {"schema": SCHEMA, "operation_id": request["intent"]["operation_id"],
             "failure_sha256": expected, "request_sha256": _sha(request_raw),
             "previous_supervisor": state.get("supervisor"), "phase": "prepared", "prepared_at": native.now(),
             "result_base64": base64.b64encode(result_raw).decode("ascii"),
             "state_base64": base64.b64encode(state_raw).decode("ascii"),
             "runtime": str(Path(native.__file__).resolve())}
    native.save_json(path, saved)
    return saved


def arm(native, root, saved):
    """Clear only the verified archived failure immediately before native acquisition."""
    expected = saved["failure_sha256"]
    request_raw = (root / "request.json").read_bytes()
    if _sha(request_raw) != saved["request_sha256"]:
        raise ValueError("The original request changed after recovery preparation")
    result_path = root / "result.json"
    if result_path.exists():
        raw = result_path.read_bytes()
        if _sha(raw) != expected or base64.b64decode(saved["result_base64"], validate=True) != raw:
            raise ValueError("Preserve the new terminal result; it is not this recovery")
        reason = _reason(native, root, json.loads(request_raw), native.read_json(root / "state.json") or {}, json.loads(raw))
        if reason is not None:
            raise ValueError("The original failure changed before acquisition: " + reason)
        # The pointer and archive are durable before removal. A crash here is
        # recoverable through the same hash and the original guarded resume.
        native.save_json(root / "capacity-recovery.json", {"schema": SCHEMA, "failure_sha256": expected})
        result_path.unlink()
        descriptor = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    saved = {**saved, "phase": "armed", "armed_at": native.now()}
    native.save_json(_path(root, expected), saved)
    # A terminal observation may have released the old dependency pointer.
    # Re-register its same declarations before this record waits for capacity.
    from runtime_consumers import refresh
    refresh(root)
    return saved


def acquired(native, root, saved):
    state = native.read_json(root / "state.json") or {}
    value = {**saved, "phase": "resumed", "resumed_at": native.now(),
             "replacement_supervisor": state.get("supervisor")}
    native.save_json(_path(root, saved["failure_sha256"]), value)
    return value


def cancel(native, root):
    """An explicit stop also cancels an eligible terminal launch failure."""
    request = native.read_json(root / "request.json")
    state = native.read_json(root / "state.json") or {}
    result = native.read_json(root / "result.json")
    if _reason(native, root, request, state, result) is not None:
        return False
    native.save_json(root / "stop-request.json", {
        "requested_at": native.now(), "signal": None, "supervisor": state.get("supervisor"),
        "reason": "cancelled_before_dispatch"})
    # Retain every original diagnostic while invalidating its recovery selector.
    native.save_json(root / "result.json", {
        **result, "stop_requested": True, "cancelled_before_dispatch": True,
        "cancelled_at": native.now()})
    return True
