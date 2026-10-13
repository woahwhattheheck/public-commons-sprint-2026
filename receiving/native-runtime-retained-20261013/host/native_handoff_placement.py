"""Physical placement changes inside an original undispatched native handoff.

The existing handoff owns stop, request commit, registration and launch. These
pure joins retain the original source and operation while selecting the actual
prepared project, command and writable runtime directories.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import re
import stat

SCHEMA = "commons.native-placement-amendment/v1"
HISTORY = "placement_amendments"
CAPACITY = ("memory", "disk")
FIELDS = ("project", "command", "worker_root", "temp_root", "runtime_paths")
MAX_FILES = 4096


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def _absolute(value, *, resolve=False):
    if (not isinstance(value, str) or not value or any(ord(c) < 32 for c in value)
            or not Path(value).is_absolute()):
        raise ValueError("Placement paths must be explicit absolute filesystem paths")
    path = Path(os.path.abspath(value))
    return str(path.resolve() if resolve else path)


def _binding(request):
    return digest({"schema": request["schema"], "source": request.get("source"),
                   "created_at": request.get("created_at"),
                   "operation_id": request["intent"]["operation_id"]})


def state(request):
    return {"intent": deepcopy(request["intent"]), "storage": deepcopy(request.get("storage", {}))}


def _without_capacity(intent):
    return {key: value for key, value in intent.items() if key not in CAPACITY}


def _normalized(value, *, resolve_paths):
    required = {"amendment_id", "reason", *FIELDS}
    optional = {"source_files", "optional_runtime_paths", "writable_paths"}
    if not isinstance(value, dict) or not required.issubset(value) or set(value) - required - optional:
        raise ValueError("Select the complete command, project, worker/temp roots and runtime paths")
    identity = value["amendment_id"]
    reason = value["reason"]
    if not isinstance(identity, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", identity):
        raise ValueError("Use a stable placement amendment identity")
    if not isinstance(reason, str) or not reason.strip() or len(reason) > 2000:
        raise ValueError("Describe the concrete physical placement change")
    command = value["command"]
    if (not isinstance(command, list) or not command or len(command) > 4096
            or any(not isinstance(word, str) or "\0" in word for word in command)
            or not command[0] or command[0] == "--"):
        raise ValueError("Select the exact original-work continuation argv, without a shell wrapper")
    result = {"amendment_id": identity, "reason": reason.strip(), "command": list(command)}
    for name in ("project", "worker_root", "temp_root"):
        result[name] = _absolute(value[name], resolve=resolve_paths)
    for name in ("runtime_paths", "optional_runtime_paths", "writable_paths"):
        values = value.get(name, [])
        if not isinstance(values, list) or len(values) > 4096:
            raise ValueError("Select a complete explicit " + name + " list")
        # Runtime declarations retain lexical spellings and resolve their links
        # through the original consumer registry immediately before dispatch.
        result[name] = sorted({_absolute(path, resolve=False) for path in values})
    files = value.get("source_files", [])
    if not isinstance(files, list) or len(files) > MAX_FILES:
        raise ValueError("Select at most 4096 prepared source/input files")
    result["source_files"], seen = [], set()
    for row in files:
        if (not isinstance(row, dict) or set(row) != {"path", "bytes", "sha256"}
                or type(row["bytes"]) is not int or row["bytes"] < 0
                or not isinstance(row["sha256"], str)
                or not re.fullmatch(r"[0-9a-f]{64}", row["sha256"])):
            raise ValueError("Prepared input files retain their exact path, bytes and SHA-256")
        path = _absolute(row["path"], resolve=False)
        if path in seen:
            raise ValueError("A prepared placement input is selected twice")
        seen.add(path)
        result["source_files"].append({**row, "path": path})
    result["source_files"].sort(key=lambda row: row["path"])
    return result


def updated(request, changes):
    """Reconstruct only the reviewed physical fields; preserve all other intent."""
    intent = deepcopy(request["intent"])
    for name in FIELDS:
        intent[name] = deepcopy(changes[name])
    # An empty explicit runtime list has the original start() spelling.
    if not intent["runtime_paths"]:
        intent.pop("runtime_paths")
    storage = {**deepcopy(request.get("storage", {})),
               "worker_root": changes["worker_root"], "temporary_root": changes["temp_root"]}
    return {**deepcopy(request), "intent": intent, "storage": storage}


def declarations(request, changes):
    values = {_absolute(str(Path(request["intent"]["project"]) / "node_modules")): False}
    for path in changes.get("optional_runtime_paths", []):
        values[path] = False
    for path in request["intent"].get("runtime_paths", []):
        values[path] = True
    return [{"path": path, "required": required} for path, required in sorted(values.items())]


def verify_ready(native, request, changes):
    """Read the actual prepared paths and retained inputs without starting work."""
    project = Path(changes["project"]).resolve(strict=True)
    if not project.is_dir() or str(project) != changes["project"]:
        raise ValueError("The reviewed placement project must retain its resolved directory")
    for key in ("worker_root", "temp_root"):
        if str(Path(changes[key]).resolve()) != changes[key]:
            raise ValueError("The reviewed writable root changed its physical target")
    native.artifact_paths(project, request["intent"]["artifacts"])
    for paths in request["intent"].get("artifact_conditions", {}).values():
        native.artifact_paths(project, paths)
    for row in changes["source_files"]:
        fd = os.open(row["path"], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, "rb") as stream:
            before = os.fstat(stream.fileno())
            if not stat.S_ISREG(before.st_mode) or before.st_size != row["bytes"]:
                raise ValueError("A prepared placement input changed shape or size: " + row["path"])
            hasher, size = hashlib.sha256(), 0
            for block in iter(lambda: stream.read(256 * 1024), b""):
                hasher.update(block)
                size += len(block)
            after = os.fstat(stream.fileno())
        identity = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
        if (any(getattr(before, key) != getattr(after, key) for key in identity)
                or size != row["bytes"] or hasher.hexdigest() != row["sha256"]):
            raise ValueError("A prepared placement input changed during its original read: " + row["path"])
    import runtime_consumers as consumers
    from worker_capacity import snapshot
    observed = consumers.observe_paths(declarations(request, changes))
    disk = request["intent"].get("disk")
    if not isinstance(disk, dict) or not disk.get("paths"):
        raise ValueError("Physical storage placement needs its original disk admission declaration")
    writes = sorted({changes["project"], changes["worker_root"], changes["temp_root"],
                     *changes["writable_paths"]})
    requirements = [row["path"] for row in disk["paths"] if row["bytes"] > 0]
    report = snapshot([*requirements, *writes], nearest_existing=True)
    rows = report["filesystems"]
    if len(rows) != len(requirements) + len(writes) or any(row.get("status") != "ok" for row in rows):
        raise ValueError("The actual placement filesystem could not be observed")
    covered = {row["device"] for row in rows[:len(requirements)]}
    uncovered = [path for path, row in zip(writes, rows[len(requirements):])
                 if row["device"] not in covered]
    if uncovered:
        raise ValueError("Declare growth on every actual writable placement filesystem: " + ", ".join(uncovered))
    # The original registry still owns retirement exclusion during register().
    # This read proves availability; it neither reserves nor rewrites capacity.
    return {"writable_paths": writes, "filesystems": rows,
            "resolved_runtime_paths": len(observed), "source_files": len(changes["source_files"])}


def review(native, request, value, *, resolve_paths=True):
    changes = _normalized(value, resolve_paths=resolve_paths)
    history = request.get(HISTORY, [])
    if not isinstance(history, list) or any(not isinstance(row, dict) for row in history):
        raise ValueError("Preserve the original placement amendment history")
    if any(row.get("amendment_id") == changes["amendment_id"] for row in history):
        raise ValueError("This placement identity is already retained by the original request")
    revised = updated(request, changes)
    before, after = state(request), state(revised)
    if before == after:
        raise ValueError("The reviewed command and physical placement are already retained")
    if resolve_paths:
        verify_ready(native, revised, changes)
    return {"changes": changes, "before": before, "after": after,
            "previous_sha256": digest(before), "next_sha256": digest(after),
            "source_binding_sha256": _binding(request)}


def append(request, reviewed, *, handoff_id, authored_at, context):
    revised = updated(request, reviewed["changes"])
    if state(request) != reviewed["before"] or state(revised) != reviewed["after"]:
        raise ValueError("Preserve the exact reviewed placement before committing its request")
    event = {"schema": SCHEMA, "amendment_id": reviewed["changes"]["amendment_id"],
             "amended_at": authored_at, "reason": reviewed["changes"]["reason"],
             "runtime_handoff_id": handoff_id, "command_previously_started": False,
             "capacity_counts": {name: len(request.get(name + "_amendments", [])) for name in CAPACITY},
             "previous_state": context["state"], "previous_supervisor": context["supervisor"],
             "sequences": deepcopy(context["sequences"]), **deepcopy(reviewed)}
    revised[HISTORY] = [*request.get(HISTORY, []), event]
    return revised


def events(request):
    """Validate retained physical transitions without resolving historical paths."""
    history = request.get(HISTORY, [])
    if not isinstance(history, list):
        raise ValueError("Preserve the original placement amendment history")
    seen, counts = set(), {name: 0 for name in CAPACITY}
    for event in history:
        if (not isinstance(event, dict) or event.get("schema") != SCHEMA
                or event.get("command_previously_started") is not False
                or event.get("source_binding_sha256") != _binding(request)
                or not isinstance(event.get("runtime_handoff_id"), str)
                or not event["runtime_handoff_id"] or not isinstance(event.get("previous_supervisor"), dict)):
            raise ValueError("The placement differs from its original source, operation or stopped owner")
        changes = _normalized(event.get("changes"), resolve_paths=False)
        identity = event.get("amendment_id")
        if identity != changes["amendment_id"] or identity in seen or event.get("reason") != changes["reason"]:
            raise ValueError("Preserve the original placement amendment identity")
        seen.add(identity)
        before, after = event.get("before"), event.get("after")
        if (not isinstance(before, dict) or set(before) != {"intent", "storage"}
                or not isinstance(after, dict) or set(after) != {"intent", "storage"}
                or event.get("previous_sha256") != digest(before)
                or event.get("next_sha256") != digest(after) or before == after):
            raise ValueError("The original placement history changed its retained states")
        prior = {**request, **deepcopy(before)}
        if state(updated(prior, changes)) != after:
            raise ValueError("A placement amendment changed fields outside its reviewed selection")
        selected = event.get("capacity_counts")
        if not isinstance(selected, dict) or set(selected) != set(CAPACITY):
            raise ValueError("Preserve the placement's original capacity-history boundaries")
        for name in CAPACITY:
            count = selected[name]
            full = request.get(name + "_amendments", [])
            if (not isinstance(full, list) or any(not isinstance(row, dict) for row in full)
                    or type(count) is not int
                    or not counts[name] <= count <= len(full)):
                raise ValueError("The placement capacity history moved backwards")
            expected = (full[count - 1].get("next") if count else
                        full[0].get("previous") if full else request["intent"].get(name))
            if before["intent"].get(name) != expected or after["intent"].get(name) != expected:
                raise ValueError("Placement changed a resource outside its original capacity amendment")
            counts[name] = count
    if history:
        final = history[-1]["after"]
        if (_without_capacity(final["intent"]) != _without_capacity(request["intent"])
                or final["storage"] != request.get("storage", {})):
            raise ValueError("The current native command is not its last recorded placement")
    return history


def epoch(request, event, side="before"):
    value = {**deepcopy(request), **deepcopy(event[side])}
    value.pop(HISTORY, None)
    for name in CAPACITY:
        key = name + "_amendments"
        if key in value:
            value[key] = value[key][:event["capacity_counts"][name]]
    return value


def validate_epochs(request, history, capacity_reader):
    for index, event in enumerate(history):
        before = epoch(request, event)
        start = history[index - 1]["after"]["intent"] if index else before["intent"]
        prior = {"intent_sha256": digest(start), "intent_amendments": []}
        capacity_reader(prior, before)
    if history:
        capacity_reader({"intent_sha256": digest(history[-1]["after"]["intent"]),
                         "intent_amendments": []}, {**request, HISTORY: []})


def original_intent(request):
    history = events(request)
    if not history:
        return request["intent"]
    import runtime_consumers as consumers
    validate_epochs(request, history, consumers._reconcile_capacity_only)
    return {**deepcopy(history[0]["before"]["intent"]),
            **{name: deepcopy(request["intent"][name]) for name in CAPACITY if name in request["intent"]}}


def reconcile(previous, request, capacity_reader):
    """Advance the original consumer through capacity and physical checkpoints."""
    history = events(request)
    if not history:
        return capacity_reader(previous, request)
    validate_epochs(request, history, capacity_reader)
    if previous is None:
        initial = deepcopy(history[0]["before"]["intent"])
        for name in CAPACITY:
            resource_history = request.get(name + "_amendments", [])
            if resource_history:
                initial[name] = deepcopy(resource_history[0]["previous"])
        previous = {"intent_sha256": digest(initial), "intent_amendments": [],
                    "declarations": [], "paths": []}
    references = previous.get("intent_amendments", [])
    if not isinstance(references, list) or any(not isinstance(row, dict) for row in references):
        raise ValueError("Preserve the original runtime amendment references")
    positions = {event["amendment_id"]: index for index, event in enumerate(history)}
    consumed, seen = [], set()
    for row in references:
        if row.get("resource", "memory") != "placement":
            continue
        identity = row.get("amendment_id")
        if identity not in positions or identity in seen:
            raise ValueError("The runtime placement reference is missing or duplicated")
        seen.add(identity)
        event = history[positions[identity]]
        if row != reference(event):
            raise ValueError("A retained runtime placement reference changed")
        consumed.append(positions[identity])
    if consumed != sorted(consumed):
        raise ValueError("Preserve the runtime placement reference order")
    floor = consumed[-1] + 1 if consumed else 0
    joined, start = None, None
    for index in range(floor, len(history) + 1):
        candidate = epoch(request, history[index]) if index < len(history) else request
        try:
            joined = capacity_reader(previous, candidate)
        except (ValueError, KeyError, TypeError):
            continue
        start = index
        break
    if joined is None:
        raise ValueError("The registered runtime is not anchored in this original placement history")
    for index in range(start, len(history)):
        event = history[index]
        joined = {**joined, "intent_sha256": digest(event["after"]["intent"]),
                  "project": event["after"]["intent"]["project"],
                  "declarations": declarations(epoch(request, event, "after"), event["changes"]),
                  "paths": [],
                  "intent_amendments": [*joined.get("intent_amendments", []), reference(event)]}
        # The complete prior registration is retained with this same handoff.
        # Its declaration edits belonged to the former physical source binding.
        joined.pop("declaration_amendments", None)
        joined.pop("released_at", None)
        target = epoch(request, history[index + 1]) if index + 1 < len(history) else request
        joined = capacity_reader(joined, target)
    return joined


def reference(event):
    return {"resource": "placement", "amendment_id": event["amendment_id"],
            "source": "request.json", "runtime_handoff_id": event["runtime_handoff_id"],
            "previous_intent_sha256": digest(event["before"]["intent"]),
            "intent_sha256": digest(event["after"]["intent"]),
            "amended_at": event["amended_at"], "event_sha256": digest(event)}
