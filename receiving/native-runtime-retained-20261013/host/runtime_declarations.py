"""Review and replace runtime declarations on one original undispatched command.

The command request is immutable here. Explicit declaration amendments belong
to its existing runtime-use record, which remains the original cache registry's
authority. The native supervisor still owns admission, dispatch and recovery.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re

import runtime_consumers as consumers

SCHEMA = "commons.native-runtime-declaration-amendment/v1"
HISTORY = "declaration_amendments"
DISPATCH_FILES = ("process.json", "output.log", "command-completion.dat")


def _sha(raw):
    return hashlib.sha256(raw).hexdigest()


def _raw(path):
    try:
        return path.read_bytes()
    except FileNotFoundError:
        return None


def _hash(raw):
    return None if raw is None else _sha(raw)


def _identity(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9._-]{1,128}", value):
        raise consumers.RuntimeUseError("Supply a stable runtime amendment ID")
    return value


def _selection_hash(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
        raise consumers.RuntimeUseError("Supply the exact reviewed runtime selection SHA-256")
    return value


def _canonical(rows):
    if not isinstance(rows, list) or len(rows) > consumers.MAX_RUNTIME_PATHS + 1:
        raise consumers.RuntimeUseError(f"Supply at most {consumers.MAX_RUNTIME_PATHS} explicit runtime paths plus the original project dependency path")
    values = {}
    for row in rows:
        if (not isinstance(row, dict) or set(row) != {"path", "required"}
                or type(row["required"]) is not bool):
            raise consumers.RuntimeUseError("Preserve the original runtime declaration shape")
        path = str(consumers.lexical_path(row["path"]))
        if path != row["path"] or path in values:
            raise consumers.RuntimeUseError("Runtime declarations must be unique canonical absolute paths")
        values[path] = row["required"]
    return [{"path": path, "required": required} for path, required in sorted(values.items())]


def _base(request):
    intent = request["intent"]
    values = {str(consumers.lexical_path("node_modules", intent["project"])): False}
    for path in intent.get("runtime_paths", []):
        values[str(consumers.lexical_path(path, intent["project"]))] = True
    return _canonical([{"path": path, "required": required} for path, required in sorted(values.items())])


def replacement(request, paths, *, optional_paths=()):
    """Select the complete required and optional runtime set for this command.

    Both explicit lists share the existing path limit. A canonical path selected
    as required stays required even when it also occurs in the optional list.
    The original project's implicit dependency declaration remains present.
    """
    if (not isinstance(paths, (list, tuple))
            or not isinstance(optional_paths, (list, tuple))
            or not 1 <= len(paths) + len(optional_paths) <= consumers.MAX_RUNTIME_PATHS):
        raise consumers.RuntimeUseError(f"Select the complete replacement set of one to {consumers.MAX_RUNTIME_PATHS} required and optional consumed runtime paths combined")
    values = {str(consumers.lexical_path("node_modules", request["intent"]["project"])): False}
    for path in optional_paths:
        values[str(consumers.lexical_path(path, request["intent"]["project"]))] = False
    for path in paths:
        values[str(consumers.lexical_path(path, request["intent"]["project"]))] = True
    return _canonical([{"path": path, "required": required} for path, required in sorted(values.items())])


def _covers(actual, expected):
    values = {row["path"]: row["required"] for row in actual}
    return all(row["path"] in values and (not row["required"] or values[row["path"]]) for row in expected)


def _binding(request):
    # Memory/disk retain their own validated amendment histories. Every other
    # command/source/placement field remains bound to this original request.
    intent = {key: value for key, value in request["intent"].items() if key not in ("memory", "disk")}
    return consumers.digest({"schema": request["schema"], "intent": intent,
                             "source": request.get("source"), "storage": request.get("storage"),
                             "created_at": request.get("created_at")})


def effective_declarations(request, previous):
    """Validate explicit history before omitting superseded original roots."""
    if not previous or HISTORY not in previous:
        return None
    history = previous[HISTORY]
    if not isinstance(history, list) or not history:
        raise consumers.RuntimeUseError("Preserve the original runtime declaration amendment history")
    expected, seen = _base(request), set()
    for event in history:
        if (not isinstance(event, dict) or event.get("schema") != SCHEMA
                or event.get("command_previously_started") is not False
                or event.get("source_binding_sha256") != _binding(request)):
            raise consumers.RuntimeUseError("A runtime amendment differs from the original command/source binding")
        identity = _identity(event.get("amendment_id"))
        if identity in seen:
            raise consumers.RuntimeUseError("The original runtime amendment identity is duplicated")
        seen.add(identity)
        before = _canonical(event.get("previous", {}).get("declarations"))
        after = _canonical(event.get("next", {}).get("declarations"))
        selection = event.get("selection")
        if (before == after or not _covers(before, expected)
                or not isinstance(selection, dict)
                or event.get("selection_sha256") != consumers.digest(selection)
                or selection.get("previous_declarations_sha256") != consumers.digest(before)
                or selection.get("next_declarations_sha256") != consumers.digest(after)
                or selection.get("source_binding_sha256") != _binding(request)
                or selection.get("observed_paths_sha256") != event.get("next", {}).get("observed_paths_sha256")
                or not isinstance(event.get("reason"), str) or not event["reason"].strip()):
            raise consumers.RuntimeUseError("The original runtime amendment chain is discontinuous")
        project_path = str(consumers.lexical_path("node_modules", request["intent"]["project"]))
        if not any(row["path"] == project_path for row in after):
            raise consumers.RuntimeUseError("Preserve the original project's dependency declaration")
        expected = after
    current = _canonical(previous.get("declarations"))
    if not _covers(current, expected):
        raise consumers.RuntimeUseError("The current runtime selection omits its explicit amendment")
    return current


def _undispatched(native, root, request, state, result):
    if (not isinstance(state, dict) or state.get("process")
            or (isinstance(result, dict) and result.get("process"))
            or any(os.path.lexists(root / name) for name in DISPATCH_FILES)):
        raise consumers.RuntimeUseError("This original command has dispatch records; preserve its runtime lifetime")
    if (os.path.lexists(root / "stop-request.json")
            or (isinstance(result, dict) and (result.get("stop_requested") or result.get("cancelled_before_dispatch")))):
        raise consumers.RuntimeUseError("The original operation has an explicit cancellation")
    if not (request["intent"].get("memory") or request["intent"].get("disk")):
        raise consumers.RuntimeUseError("Select the original capacity operation supported by native resume")
    if (root / "runtime-handoff.json").exists():
        import native_runtime_handoff
        active = native_runtime_handoff.active(native, root)
        if active and active.get("phase") not in ("resumed", "resumed_elsewhere"):
            raise consumers.RuntimeUseError("Continue the same original runtime handoff before amending its declarations")
    if result is not None:
        import capacity_recovery
        reason = capacity_recovery._reason(native, root, request, state, result)
        if reason is not None:
            raise consumers.RuntimeUseError("Preserve the original terminal result: " + reason)
    else:
        interrupted_start = (state.get("state") == "starting"
                             and native._supervisor_ended(state.get("supervisor")))
        if state.get("state") not in native.CAPACITY_RESUMABLE_STATES and not interrupted_start:
            raise consumers.RuntimeUseError("Select an original undispatched queue supported by native resume")
        supervisor = state.get("supervisor")
        launch = native.read_json(root / "supervisor-launch.json")
        if supervisor is not None:
            if not native._supervisor_ended(supervisor):
                raise consumers.RuntimeUseError("The original supervisor has not positively ended")
        elif state.get("state") != "launch_pending" or launch is not None or (root / "supervisor.log").exists():
            raise consumers.RuntimeUseError("Reconcile the original retained supervisor before changing its declarations")
        if isinstance(launch, dict) and launch.get("supervisor") is not None:
            if not native._supervisor_ended(launch["supervisor"]):
                raise consumers.RuntimeUseError("The original launch owner has not positively ended")
    if native.live_supervisors(root):
        raise consumers.RuntimeUseError("An original supervisor still owns this operation")


def _current(root):
    request_raw = _raw(root / "request.json")
    if request_raw is None:
        raise consumers.RuntimeUseError("Select the existing original native record")
    request = consumers.request_at(root, json.loads(request_raw))
    original = consumers.read_use(root)
    if original:
        # Existing memory/disk histories continue to own any intent transition.
        previous = consumers.reconcile_capacity_amendments(original, request)
        root = Path(original["record"])
    else:
        previous = None
    return root, request_raw, request, original, previous


def _review_locked(root, paths, chosen, *, optional_paths=()):
    native = consumers.native()
    root, request_raw, request, original, previous = _current(root)
    state_raw, result_raw = _raw(root / "state.json"), _raw(root / "result.json")
    state = json.loads(state_raw) if state_raw is not None else {}
    result = json.loads(result_raw) if result_raw is not None else None
    _undispatched(native, root, request, state, result)
    before = consumers.declared_paths(request, previous=previous)
    after = replacement(request, paths, optional_paths=optional_paths)
    if before == after:
        raise consumers.RuntimeUseError("The selected declarations already match this original runtime")
    observed = consumers.observe_paths(after)
    consumers.available_after_retirement(chosen, observed)
    pointer = consumers.pointer_path(chosen, root)
    selection = {
        "record": str(root), "operation_id": request["intent"]["operation_id"],
        "request_sha256": _sha(request_raw), "intent_sha256": consumers.digest(request["intent"]),
        "source_binding_sha256": _binding(request),
        "state_sha256": _hash(state_raw), "result_sha256": _hash(result_raw),
        "runtime_use_sha256": _hash(_raw(root / consumers.RECORD_FILE)),
        "registry_root": str(chosen), "pointer_sha256": _hash(_raw(pointer)),
        "supervisor_launch_sha256": _hash(_raw(root / "supervisor-launch.json")),
        "previous_declarations_sha256": consumers.digest(before),
        "next_declarations_sha256": consumers.digest(after),
        "observed_paths_sha256": consumers.digest(observed)}
    before_paths, after_paths = {row["path"] for row in before}, {row["path"] for row in after}
    report = {
        "schema": SCHEMA, "operation_id": request["intent"]["operation_id"], "record": str(root),
        "eligible": True, "selection": selection, "selection_sha256": consumers.digest(selection),
        "previous_declarations": before, "next_declarations": after,
        "removed_paths": sorted(before_paths - after_paths), "added_paths": sorted(after_paths - before_paths),
        "resolved_path_count": len(observed), "native_state": state.get("state"),
        "failure_sha256": _hash(result_raw), "command_previously_started": False}
    return report, request, original, previous, observed


def review_request(root, *, selected_paths, optional_paths=()):
    """Inspect required and optional paths without changing request or registry data."""
    native = consumers.native()
    root = Path(root).expanduser().resolve(strict=True)
    with native.run_lock(root):
        root, _, request, _, previous = _current(root)
        chosen = consumers.registry_path((previous or {}).get("registry_root")
                                        or request["intent"].get("runtime_consumers_root"))
        with consumers.registry_lock(chosen):
            return _review_locked(root, selected_paths, chosen, optional_paths=optional_paths)[0]


def _report(root, value, event, *, amended):
    current = value["declarations"]
    return {"schema": SCHEMA, "operation_id": value["operation_id"], "record": str(root),
            "amended": amended, "reused": not amended,
            "superseded": current != event["next"]["declarations"],
            "amendment": {"amendment_id": event["amendment_id"], "amended_at": event["amended_at"],
                          "selection_sha256": event["selection_sha256"], "reason": event["reason"]},
            "runtime_declarations": {"report": str(root / consumers.RECORD_FILE),
                "revision": value["revision"], "declarations": current,
                "declarations_sha256": consumers.digest(current),
                "resolved_path_count": len(value["paths"]), "history_count": len(value[HISTORY]),
                "registration": consumers.registration_status(value)},
            "request_sha256": _hash(_raw(root / "request.json")),
            "failure_sha256": _hash(_raw(root / "result.json"))}


def amend_request(root, *, selected_paths, amendment_id, expected_selection_sha256, reason,
                  optional_paths=()):
    """Commit one reviewed declaration replacement, then repair its same pointer.

    The record is durable before the shared pointer. Repeating the same ID and
    selection after a failed pointer write uses the existing register repair;
    it never launches a command or writes the original request/failed result.
    """
    amendment_id = _identity(amendment_id)
    expected_selection_sha256 = _selection_hash(expected_selection_sha256)
    if not isinstance(reason, str) or not reason.strip() or len(reason) > 2000:
        raise consumers.RuntimeUseError("Describe the concrete runtime declaration correction")
    reason = reason.strip()
    native = consumers.native()
    root = Path(root).expanduser().resolve(strict=True)
    with native.run_lock(root):
        root, _, request, original, previous = _current(root)
        proposed = replacement(request, selected_paths, optional_paths=optional_paths)
        history = list((previous or {}).get(HISTORY, []))
        if history:
            effective_declarations(request, previous)
        matching = [event for event in history if event["amendment_id"] == amendment_id]
        if matching:
            event = matching[0]
            if (event["selection_sha256"] != expected_selection_sha256
                    or event["reason"] != reason or event["next"]["declarations"] != proposed):
                raise consumers.RuntimeUseError("This amendment ID already selects another runtime correction")
            if not previous.get("released_at") and consumers.registration_status(previous)["state"] != "linked":
                consumers.register(root, registry_root=previous["registry_root"])
                previous = consumers.read_use(root, request)
            return _report(root, previous, event, amended=False)
        chosen = consumers.registry_path((previous or {}).get("registry_root")
                                        or request["intent"].get("runtime_consumers_root"))
        with consumers.registry_lock(chosen):
            review, request, original, previous, observed = _review_locked(
                root, selected_paths, chosen, optional_paths=optional_paths)
            if review["selection_sha256"] != expected_selection_sha256:
                raise consumers.RuntimeUseError("The original record or runtime paths changed; review the same operation again")
            checked_at = native.now()
            event = {
                "schema": SCHEMA, "amendment_id": amendment_id, "amended_at": checked_at,
                "reason": reason, "selection": review["selection"], "selection_sha256": expected_selection_sha256,
                "source_binding_sha256": _binding(request), "command_previously_started": False,
                "previous": {"declarations": review["previous_declarations"],
                             "paths": (previous or {}).get("paths", []),
                             "revision": (previous or {}).get("revision"),
                             "registered_at": (previous or {}).get("registered_at"),
                             "released_at": (previous or {}).get("released_at")},
                "next": {"declarations": review["next_declarations"],
                         "observed_paths_sha256": consumers.digest(observed)}}
            value = {"schema": consumers.SCHEMA, "record": str(root), "registry_root": str(chosen),
                     "operation_id": request["intent"]["operation_id"], "peer": request["intent"]["peer"],
                     "project": request["intent"]["project"], "intent_sha256": consumers.digest(request["intent"]),
                     "revision": (previous or {}).get("revision", 0) + 1,
                     "registered_at": (previous or {}).get("registered_at", checked_at),
                     "observed_at": checked_at, "declarations": review["next_declarations"],
                     "paths": observed, HISTORY: [*history, event]}
            if (previous or {}).get("intent_amendments"):
                value["intent_amendments"] = previous["intent_amendments"]
            effective_declarations(request, value)
            consumers.native().save_json(root / consumers.RECORD_FILE, value)
            consumers.native().save_json(consumers.pointer_path(chosen, root), consumers._registration_pointer(value))
        return _report(root, value, event, amended=True)
