"""Select native outputs by the retained exit and amend completed selections.

The command request and completion slots remain immutable. An amendment keeps
the earlier result, manifest and delivery in the original record before making
its replacement selection effective. All mutations use the native record lock.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import stat

SCHEMA = "commons.native-artifact-selection/v1"
FILENAME = "artifact-selection.json"
HISTORY = "artifact-history"
GROUPS = ("always", "success", "failure")
PRIOR_FILES = ("result.json", "artifacts.json", "offload-delivery.json", "delivery.zip")


def _native():
    if __package__:
        from . import swarm_cloud_job
    else:
        import swarm_cloud_job
    return swarm_cloud_job


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                    ensure_ascii=False).encode("utf-8")).hexdigest()


def _binding(request):
    return {"schema": SCHEMA, "operation_id": request["intent"]["operation_id"],
            "intent_sha256": _digest(request["intent"])}


def normalize(project, value, *, check_files=True):
    if not isinstance(value, dict) or set(value) - set(GROUPS):
        raise ValueError("Artifact selection contains only always, success and failure path lists")
    result = {}
    for group in GROUPS:
        paths = value.get(group, [])
        if (not isinstance(paths, (list, tuple)) or
                any(not isinstance(path, str) or not path for path in paths)):
            raise ValueError("Each artifact selection group is a list of explicit relative paths")
        if check_files:
            result[group] = _native().artifact_paths(Path(project), paths)
        else:
            relative = [Path(path) for path in paths]
            if any(path.is_absolute() or ".." in path.parts or path == Path(".") for path in relative):
                raise ValueError("Artifacts must be explicit paths relative to the original project")
            result[group] = sorted(set(path.as_posix() for path in relative))
    return result


def initial(request):
    intent = request["intent"]
    conditions = intent.get("artifact_conditions", {})
    if not isinstance(conditions, dict) or set(conditions) - {"success", "failure"}:
        raise ValueError("Original artifact conditions are invalid")
    return normalize(intent["project"], {"always": intent["artifacts"], **conditions}, check_files=False)


def _head(root, request):
    native = _native()
    value = native.read_json(Path(root) / FILENAME)
    if value is None:
        return {**_binding(request), "revision": 0, "selection": initial(request),
                "last_amendment": None, "pending": None}
    if (any(value.get(key) != expected for key, expected in _binding(request).items())
            or type(value.get("revision")) is not int or value["revision"] < 0):
        raise ValueError("Artifact selection differs from its original native request")
    if normalize(request["intent"]["project"], value.get("selection"), check_files=False) != value["selection"]:
        raise ValueError("Retained artifact selection changed")
    return value


def view(root, request):
    value = _head(root, request)
    return {**value, "record": str(Path(root) / FILENAME),
            "history": str(Path(root) / HISTORY)}


def selected(root, request, outcome):
    value = view(root, request)
    if value.get("pending"):
        raise ValueError("Continue the retained artifact amendment with the original finalize command")
    group = "success" if outcome["exit_code"] == 0 else "failure"
    paths = sorted(set(value["selection"]["always"] + value["selection"][group]))
    return paths, {key: value[key] for key in
                   ("schema", "revision", "selection", "last_amendment", "history")} | {
                       "outcome": group, "paths": paths}


def current_revision(root):
    """Small delivery epoch check, also used across ranged artifact reads."""
    value = _native().read_json(Path(root) / FILENAME)
    if value is None:
        return 0
    if (value.get("schema") != SCHEMA or type(value.get("revision")) is not int
            or value["revision"] < 0 or value.get("pending")):
        raise ValueError("The retained artifact selection is awaiting finalization")
    return value["revision"]


def _hash_file(path):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | os.O_NONBLOCK)
    digest, size = hashlib.sha256(), 0
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise ValueError("Retained finalization files must be regular files")
        for block in iter(lambda: stream.read(256 * 1024), b""):
            digest.update(block)
            size += len(block)
        after = os.fstat(stream.fileno())
    if ((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) !=
            (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)):
        raise ValueError("Retained finalization changed while it was being preserved")
    return {"bytes": size, "sha256": digest.hexdigest()}


def _directory_sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _archive(root, entry):
    directory = Path(root) / HISTORY / entry["key"]
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    for name, expected in entry["prior_files"].items():
        source, target = Path(root) / name, directory / name
        if target.exists():
            if _hash_file(target) != expected:
                raise ValueError("An earlier retained finalization archive changed")
            continue
        if _hash_file(source) != expected:
            raise ValueError("The earlier finalization changed before its amendment was retained")
        # Native metadata and deliveries use atomic replacement. A hard link
        # preserves those exact earlier bytes without a second large ZIP copy.
        os.link(source, target, follow_symlinks=False)
        _directory_sync(directory)
        if _hash_file(target) != expected:
            raise ValueError("The earlier finalization could not be retained exactly")
    _directory_sync(directory.parent)
    return directory


def _entry(root, key, request, outcome):
    if not isinstance(key, str) or len(key) != 64 or any(c not in "0123456789abcdef" for c in key):
        raise ValueError("Retain the original artifact amendment identity")
    path = Path(root) / HISTORY / key / "amendment.json"
    value = _native().read_json(path)
    if (not value or value.get("key") != key or
            any(value.get(field) != expected for field, expected in _binding(request).items()) or
            value.get("outcome_sha256") != _digest(outcome)):
        raise ValueError("Artifact amendment differs from the original command and exit")
    return value


def _mark_applied(root, entry):
    path = Path(root) / HISTORY / entry["key"] / "applied.json"
    value = {"schema": SCHEMA, "amendment_id": entry["request"]["amendment_id"],
             "revision": entry["revision"], "selection_sha256": _digest(entry["request"]["selection"])}
    previous = _native().read_json(path)
    if previous is not None:
        if any(previous.get(key) != expected for key, expected in value.items()):
            raise ValueError("Retained artifact amendment completion changed")
        return
    _native().save_json(path, {**value, "applied_at": _native().now()})


def resume_pending(root, request, outcome):
    """Resume only already retained metadata work; caller holds run_lock."""
    native = _native()
    value = _head(root, request)
    pending = value.get("pending")
    if not pending:
        if value.get("last_amendment"):
            entry = _entry(root, value["last_amendment"]["key"], request, outcome)
            if entry["revision"] != value["revision"] or entry["request"]["selection"] != value["selection"]:
                raise ValueError("Retained artifact amendment head changed")
            _mark_applied(root, entry)
        return value
    entry = _entry(root, pending["key"], request, outcome)
    if (entry["previous_revision"] != value["revision"] or
            entry["previous_selection"] != value["selection"] or
            entry["revision"] != value["revision"] + 1):
        raise ValueError("Continue the original pending artifact amendment")
    directory = _archive(root, entry)
    value = {**_binding(request), "revision": entry["revision"],
             "selection": entry["request"]["selection"],
             "last_amendment": {"key": entry["key"], "id": entry["request"]["amendment_id"],
                                "reason": entry["request"]["reason"], "record": str(directory / "amendment.json")},
             "pending": None}
    native.save_json(Path(root) / FILENAME, value)
    _mark_applied(root, entry)
    return value


def amend(root, request, outcome, *, selection, amendment_id, reason, expected_revision=None):
    """Retain one explicit replacement selection under the native record lock."""
    native = _native()
    if (not isinstance(amendment_id, str) or not amendment_id.strip() or len(amendment_id) > 512
            or any(ord(c) < 32 for c in amendment_id)):
        raise ValueError("Retain a stable printable artifact amendment ID")
    if not isinstance(reason, str) or not reason.strip() or len(reason) > 4096:
        raise ValueError("Describe why this completed operation's selected artifacts are changing")
    if expected_revision is not None and (type(expected_revision) is not int or expected_revision < 0):
        raise ValueError("Expected artifact revision must be a nonnegative integer")
    replacement = normalize(request["intent"]["project"], selection)
    value = resume_pending(root, request, outcome)
    payload = {"amendment_id": amendment_id, "reason": reason, "selection": replacement,
               "expected_revision": expected_revision}
    key = hashlib.sha256(amendment_id.encode("utf-8")).hexdigest()
    directory = Path(root) / HISTORY / key
    path = directory / "amendment.json"
    entry = native.read_json(path)
    if entry is not None:
        entry = _entry(root, key, request, outcome)
        if entry["request"] != payload:
            raise ValueError("This artifact amendment ID already records a different selection")
        if native.read_json(directory / "applied.json") is not None:
            _mark_applied(root, entry)
            return {"amendment_id": amendment_id, "revision": entry["revision"],
                    "current_revision": value["revision"], "reused": True, "record": str(path)}
        if (entry["previous_revision"] != value["revision"] or
                entry["previous_selection"] != value["selection"]):
            raise ValueError("The pending amendment belongs to an earlier artifact revision")
    else:
        if expected_revision is not None and expected_revision != value["revision"]:
            raise ValueError("Artifact selection changed; read the current revision")
        prior = {}
        for name in PRIOR_FILES:
            try:
                prior[name] = _hash_file(Path(root) / name)
            except FileNotFoundError:
                pass
        entry = {**_binding(request), "key": key, "request": payload,
                 "revision": value["revision"] + 1, "previous_revision": value["revision"],
                 "previous_selection": value["selection"], "outcome_sha256": _digest(outcome),
                 "created_at": native.now(), "prior_files": prior}
        native.save_json(path, entry)
    native.save_json(Path(root) / FILENAME, {**value, "pending": {"key": key, "revision": entry["revision"]}})
    current = resume_pending(root, request, outcome)
    return {"amendment_id": amendment_id, "revision": entry["revision"],
            "current_revision": current["revision"], "reused": False, "record": str(path)}
