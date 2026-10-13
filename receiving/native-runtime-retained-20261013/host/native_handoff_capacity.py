"""Reviewed capacity changes within the original pre-dispatch runtime handoff.

The handoff owns stopping, archival and resumption. This module prepares exact
native amendment histories and commits them under that same original run lock;
it does not signal a process, edit a reservation or launch a command.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re

SCHEMA = "commons.native-handoff-capacity/v1"
RESOURCES = ("memory", "disk")

if __package__:
    from . import native_handoff_placement as placement_changes
else:
    import native_handoff_placement as placement_changes
DISPATCH_FILES = ("process.json", "output.log", "command-completion.dat")


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def _modules(native):
    if __package__:
        from . import cloud_memory, cloud_disk, runtime_consumers
    else:
        import cloud_memory, cloud_disk, runtime_consumers
    parent = Path(native.__file__).resolve().parent
    for module in (cloud_memory, cloud_disk, runtime_consumers):
        if Path(module.__file__).resolve().parent != parent:
            raise ValueError("Use the selected runtime's original capacity and consumer modules")
    if not callable(getattr(runtime_consumers, "reconcile_capacity_amendments", None)):
        raise ValueError("Install the original runtime consumer capacity-history reader")
    return cloud_memory, cloud_disk, runtime_consumers


def _identity(value, name):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", value):
        raise ValueError("Supply a stable " + name + " using letters, digits, dot, underscore or hyphen")


def _hash(value, name):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
        raise ValueError("Supply the exact SHA-256 of the retained " + name)


def _change(resource, value, previous, memory, disk, *, resolve_paths=True):
    if not isinstance(value, dict) or not isinstance(previous, dict):
        raise ValueError("Amend only a resource declared by the original native request")
    required = {"amendment_id", "expected_" + resource + "_sha256", "reason"}
    extra = ({"memory_mib", "reserve_mib", "reclaim_mode"} if resource == "memory" else
             {"disk_space", "disk_inodes", "reserve_mib", "reserve_inodes"})
    if not required.issubset(value) or set(value) - required - extra:
        raise ValueError("Use the original " + resource + " amendment fields")
    if resource == "memory" and "memory_mib" not in value:
        raise ValueError("Supply the explicit new native memory peak")
    _identity(value["amendment_id"], "amendment identity")
    expected = value["expected_" + resource + "_sha256"]
    _hash(expected, resource + " declaration")
    if expected != digest(previous):
        raise ValueError("The retained " + resource + " declaration changed; inspect the original queue")
    reason = value["reason"]
    if not isinstance(reason, str) or not reason.strip() or len(reason) > 2000:
        raise ValueError("Describe the concrete change behind this " + resource + " declaration")
    if resource == "memory":
        changes = {"memory_mib": value["memory_mib"], "reserve_mib": value.get("reserve_mib"),
                   "reclaim_mode": value.get("reclaim_mode")}
        memory.specification(changes["memory_mib"],
            0 if changes["reserve_mib"] is None else changes["reserve_mib"],
            reclaim_mode="none" if changes["reclaim_mode"] is None else changes["reclaim_mode"])
        updated = dict(previous)
        updated["peak_bytes"] = changes["memory_mib"] * memory.MIB
        if changes["reserve_mib"] is not None:
            updated["reserve_bytes"] = changes["reserve_mib"] * memory.MIB
        if changes["reclaim_mode"] is not None:
            if changes["reclaim_mode"] == "none":
                updated.pop("reclaim_mode", None)
            else:
                updated["reclaim_mode"] = changes["reclaim_mode"]
    else:
        changes = disk._amendment_options(value.get("disk_space"), value.get("disk_inodes"),
                                         value.get("reserve_mib"), value.get("reserve_inodes"),
                                         resolve_paths=resolve_paths)
        updated = disk.amended_specification(previous, **changes)
    if updated == previous:
        raise ValueError("The proposed " + resource + " declaration is already retained")
    return {**changes, "amendment_id": value["amendment_id"],
            "expected_" + resource + "_sha256": expected, "reason": reason.strip()}, updated


def review(native, request, amendments, *, placement=None, resolve_paths=True):
    """Normalize explicit changes and preview the same original native intent."""
    amendments = {} if amendments is None else amendments
    if (not isinstance(amendments, dict) or set(amendments) - set(RESOURCES)
            or (not amendments and placement is None)):
        raise ValueError("Select original capacity amendments or a complete physical placement")
    if (not isinstance(request, dict) or request.get("schema") != native.SCHEMA or
            not isinstance(request.get("intent"), dict)):
        raise ValueError("Select the original native capacity request")
    memory, disk, _ = _modules(native)
    intent = request["intent"]
    normalized, before, after = {}, {}, {}
    for resource in RESOURCES:
        if resource not in amendments:
            continue
        prior = intent.get(resource)
        change, updated = _change(resource, amendments[resource], prior, memory, disk,
                                  resolve_paths=resolve_paths)
        history = request.get(resource + "_amendments", [])
        if not isinstance(history, list) or any(not isinstance(row, dict) for row in history):
            raise ValueError("Preserve the original " + resource + " amendment history")
        if any(row.get("amendment_id") == change["amendment_id"] for row in history):
            raise ValueError("This " + resource + " amendment identity is already in the original request")
        normalized[resource], before[resource], after[resource] = change, deepcopy(prior), updated
    next_intent = {**intent, **after}
    selected = {}
    if placement is not None:
        reviewed = placement_changes.review(native, {**request, "intent": next_intent},
                                            placement, resolve_paths=resolve_paths)
        selected["placement"] = reviewed
        next_intent = reviewed["after"]["intent"]
    return {"amendments": normalized, "before": before, "after": after,
            "previous_intent_sha256": digest(intent), "next_intent_sha256": digest(next_intent), **selected}


def _request_for_plan(native, original, plan, authored_at):
    # Prepared plans already contain normalized absolute paths and their hashes.
    reviewed = review(native, original, plan["amendments"],
                      placement=(plan.get("placement") or {}).get("changes"), resolve_paths=False)
    if reviewed.get("placement") != plan.get("placement"):
        raise ValueError("Preserve the exact reviewed physical placement")
    for field in ("amendments", "before", "after", "previous_intent_sha256", "next_intent_sha256"):
        if reviewed[field] != plan.get(field):
            raise ValueError("Preserve the exact reviewed capacity declaration")
    context = plan["context"]
    if (context.get("state") not in (*native.CAPACITY_QUEUED_STATES, "starting") or
            not isinstance(context.get("supervisor"), dict) or
            not isinstance(context.get("sequences"), dict)):
        raise ValueError("Preserve the original queued owner and capacity sequence observations")
    revised = deepcopy(original)
    for resource in RESOURCES:
        if resource not in reviewed["amendments"]:
            continue
        change = reviewed["amendments"][resource]
        changes = {key: val for key, val in change.items()
                   if key not in ("amendment_id", "expected_" + resource + "_sha256", "reason")}
        event = {"amendment_id": change["amendment_id"], "amended_at": authored_at,
                 "reason": change["reason"], "changes": changes,
                 "previous": reviewed["before"][resource],
                 "previous_sha256": change["expected_" + resource + "_sha256"],
                 "next": reviewed["after"][resource],
                 "next_sha256": digest(reviewed["after"][resource]),
                 "sequence": context["sequences"].get(resource),
                 "previous_state": context["state"],
                 "previous_supervisor": context["supervisor"],
                 "command_previously_started": False,
                 "runtime_handoff_id": plan["handoff_id"]}
        revised["intent"][resource] = deepcopy(reviewed["after"][resource])
        key = resource + "_amendments"
        revised[key] = [*revised.get(key, []), event]
    if reviewed.get("placement"):
        revised = placement_changes.append(revised, reviewed["placement"],
            handoff_id=plan["handoff_id"], authored_at=authored_at, context=context)
    return revised


def _readers(native, root, request):
    """Use the maintained readers before accepting or applying the same change."""
    _, _, consumers = _modules(native)
    consumers.reconcile_capacity_amendments(consumers.read_use(root), request)
    if (root / "offload.json").exists():
        if __package__:
            from . import offload_build
        else:
            import offload_build
        if (Path(offload_build.__file__).resolve().parent != Path(native.__file__).resolve().parent or
                not callable(getattr(offload_build, "capacity_for_native_start", None))):
            raise ValueError("Install the original offload reader for both capacity histories")
        effective = offload_build.capacity_for_native_start(native.read_json(root / "offload.json"), request)
        if tuple(effective) != tuple(request["intent"].get(key) for key in RESOURCES):
            raise ValueError("The prepared source binding differs from the reviewed capacity amendment")


def prepare(native, root, request, selection, state):
    reviewed = review(native, request, selection.get("capacity_amendments"),
                      placement=selection.get("placement"))
    sequences = {}
    selected_resources = RESOURCES if reviewed.get("placement") else reviewed["amendments"]
    for resource in selected_resources:
        observed = native.read_json(root / (resource + ".json")) or {}
        sequences[resource] = (observed.get("sequence")
                              if observed.get("operation_id") == request["intent"]["operation_id"] else None)
    plan = {"schema": SCHEMA, "handoff_id": selection["handoff_id"],
            "original_request_sha256": selection["expected_request_sha256"],
            "prepared_at": native.now(), **reviewed,
            "context": {"state": state.get("state"), "supervisor": state.get("supervisor"),
                        "sequences": sequences}}
    _readers(native, root, _request_for_plan(native, request, plan, plan["prepared_at"]))
    return plan


def validate_selection(value):
    """Validate the immutable relationship to the original handoff selection."""
    selection = value["selection"]
    selected = selection.get("capacity_amendments")
    placement = selection.get("placement")
    plan = value.get("capacity_plan")
    if selected is None and placement is None:
        if plan is not None or value.get("capacity_application") is not None:
            raise ValueError("An original runtime handoff cannot gain unreviewed capacity changes")
        return
    if (not isinstance(plan, dict) or plan.get("schema") != SCHEMA or
            plan.get("handoff_id") != value["handoff_id"] or
            plan.get("original_request_sha256") != selection.get("expected_request_sha256") or
            plan.get("amendments") != (selected or {}) or
            (plan.get("placement") or {}).get("changes") != placement or
            plan.get("context", {}).get("supervisor") != selection.get("expected_supervisor")):
        raise ValueError("Preserve the original handoff's reviewed capacity selection")


def original_request(value, directory):
    """Read the exact pre-amendment request retained with the authored handoff."""
    raw = (directory / "request.json").read_bytes()
    if hashlib.sha256(raw).hexdigest() != value["selection"]["expected_request_sha256"]:
        raise ValueError("The handoff's retained original request bytes changed")
    return json.loads(raw)



def validate_prepared(native, root, value, directory):
    """Reconcile the complete authored plan before the handoff signals its owner."""
    validate_selection(value)
    plan = value.get("capacity_plan")
    if plan is None:
        return
    original = original_request(value, directory)
    application = value.get("capacity_application")
    authored_at = plan["prepared_at"]
    if application is not None:
        if (not isinstance(application, dict) or application.get("schema") != SCHEMA or
                not isinstance(application.get("authored_at"), str)):
            raise ValueError("Preserve the authored capacity application")
        authored_at = application["authored_at"]
    revised = _request_for_plan(native, original, plan, authored_at)
    if application is not None:
        if application.get("request") != revised or application.get("request_sha256") != digest(revised):
            raise ValueError("The staged capacity request differs from its reviewed history")
        _validate_runtime_archive(application, directory)
    # Once authored, consumer references bind that exact event time and hash.
    # Reconciliation must use it after request commit and supervisor acquisition.
    _readers(native, root, revised)


def matches_request(native, value, request, raw_sha):
    if raw_sha == value["selection"]["expected_request_sha256"]:
        return True
    application = value.get("capacity_application")
    if (not value.get("capacity_plan") or value.get("phase") not in ("archived", "resuming", "resumed",
                                                                      "resumed_elsewhere") or
            not isinstance(application, dict)):
        return False
    return (application.get("request_sha256") == digest(request) and
            application.get("request") == request)


def _validate_runtime_archive(application, directory):
    saved = application.get("runtime_use_before")
    if saved is None:
        return
    if (not isinstance(saved, dict) or set(saved) != {"path", "bytes", "sha256"}
            or saved["path"] != "runtime-use-before-placement-" + saved["sha256"] + ".json"
            or not re.fullmatch(r"[0-9a-f]{64}", saved["sha256"])
            or type(saved["bytes"]) is not int or saved["bytes"] < 0):
        raise ValueError("Preserve the original runtime registration archive")
    raw = (directory / saved["path"]).read_bytes()
    if len(raw) != saved["bytes"] or hashlib.sha256(raw).hexdigest() != saved["sha256"]:
        raise ValueError("The original runtime registration archive changed")


def _archive_runtime(native, root, directory):
    _, _, consumers = _modules(native)
    prior = consumers.read_use(root)
    if prior is None:
        return None
    if __package__:
        from .native_runtime_handoff import _archive
    else:
        from native_runtime_handoff import _archive
    with consumers.registry_lock(Path(prior["registry_root"])):
        raw = (root / consumers.RECORD_FILE).read_bytes()
        sha = hashlib.sha256(raw).hexdigest()
        name = "runtime-use-before-placement-" + sha + ".json"
        _archive(directory / name, raw)
    return {"path": name, "bytes": len(raw), "sha256": sha}


def apply(native, root, value, directory, save_handoff):
    """Commit a staged native request after the original stop has been archived.

    The caller holds run_lock for this record throughout. This entry owns or
    borrows the original supervisor inode before changing any retained bytes.
    The staged request is journaled before its atomic save, so a lost response
    resumes the same change.
    """
    validate_selection(value)
    plan = value.get("capacity_plan")
    if plan is None:
        return value
    if value.get("phase") not in ("archived", "resuming"):
        raise ValueError("Acknowledge and archive the original handoff before applying capacity changes")
    with native.supervisor_lock(root, reuse_current=True) as descriptor:
        if descriptor is None:
            raise ValueError("The original supervisor lifetime lock is held; preserve its handoff")
        state = native.read_json(root / "state.json") or {}
        if native._legacy_queue_gate_pending(root, state):
            raise ValueError("Preserve the legacy queue gate until its original parent has observed its exit")
        supervisor = value["selection"]["expected_supervisor"]
        if (state.get("supervisor") != supervisor or
                not native._supervisor_ended(supervisor) or native.live_supervisors(root)):
            raise ValueError("Preserve the original supervisor until its exact handoff has ended")
        if state.get("process") or any((root / name).exists() for name in DISPATCH_FILES):
            raise ValueError("Preserve the original dispatched command")
        original = original_request(value, directory)
        if plan.get("placement"):
            prepared = _request_for_plan(native, original, plan, plan["prepared_at"])
            placement_changes.verify_ready(native, prepared, plan["placement"]["changes"])
        current_raw = (root / "request.json").read_bytes()
        current = json.loads(current_raw)
        application = value.get("capacity_application")
        if application is None:
            if hashlib.sha256(current_raw).hexdigest() != plan["original_request_sha256"]:
                raise ValueError("The original request changed before its capacity amendment")
            authored_at = native.now()
            revised = _request_for_plan(native, original, plan, authored_at)
            _readers(native, root, revised)
            application = {"schema": SCHEMA, "authored_at": authored_at,
                           "request": revised, "request_sha256": digest(revised)}
            if plan.get("placement"):
                archived = _archive_runtime(native, root, directory)
                if archived is not None:
                    application["runtime_use_before"] = archived
            value = {**value, "capacity_application": application}
            save_handoff(value)
        if (not isinstance(application, dict) or application.get("schema") != SCHEMA or
                not isinstance(application.get("authored_at"), str)):
            raise ValueError("Preserve the authored capacity application")
        _validate_runtime_archive(application, directory)
        expected = _request_for_plan(native, original, plan, application["authored_at"])
        if application.get("request") != expected or application.get("request_sha256") != digest(expected):
            raise ValueError("The staged capacity request differs from its original reviewed history")
        if current != expected:
            if hashlib.sha256(current_raw).hexdigest() != plan["original_request_sha256"]:
                raise ValueError("The original request changed after the handoff was prepared")
            _readers(native, root, expected)
            native.save_json(root / "request.json", expected)
        else:
            _readers(native, root, expected)
        actual_raw = (root / "request.json").read_bytes()
        if json.loads(actual_raw) != expected:
            raise ValueError("The native request did not retain its exact authored capacity change")
        if not application.get("applied_at"):
            application = {**application, "applied_at": native.now(),
                           "saved_request_sha256": hashlib.sha256(actual_raw).hexdigest()}
            value = {**value, "capacity_application": application}
            save_handoff(value)
        elif application.get("saved_request_sha256") != hashlib.sha256(actual_raw).hexdigest():
            raise ValueError("The saved capacity request bytes changed after application")
        return value
