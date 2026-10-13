#!/usr/bin/env python3
"""Bind shared runtime paths to the original native command's lifetime.

The native request/result remains the authority. The shared directory contains
only pointers to those records; it neither schedules nor runs commands.
"""
from __future__ import annotations

from bisect import bisect_left
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat


SCHEMA = "commons.native-runtime-use/v1"
POINTER_SCHEMA = "commons.native-runtime-consumer-pointer/v1"
REPORT_SCHEMA = "commons.native-runtime-consumers/v1"
RECORD_FILE = "runtime-use.json"
MAX_RUNTIME_PATHS = 512
MAX_LINKS = 4096
MAX_ENTRIES = 250000


class RuntimeUseError(ValueError):
    pass


def native():
    import swarm_cloud_job
    return swarm_cloud_job


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                    separators=(",", ":")).encode()).hexdigest()


def lexical_path(value, base=None):
    if not isinstance(value, (str, Path)) or not str(value) or any(ord(c) < 32 for c in str(value)):
        raise RuntimeUseError("Runtime paths must be nonempty printable filesystem paths")
    path = Path(value).expanduser()
    if not path.is_absolute():
        if base is None:
            raise RuntimeUseError("Select an absolute runtime or registry path")
        path = Path(base) / path
    return Path(os.path.abspath(path))


def registry_path(selected=None):
    value = selected or os.environ.get("SWARM_RUNTIME_CONSUMERS_ROOT")
    if value:
        return lexical_path(value).resolve()
    return Path(os.environ.get("SWARM_STATE_ROOT", "/workspace/shared/swarm")).resolve() / "jobs/runtime-consumers"


def declaration_options(paths=(), registry_root=None):
    """Canonical optional shared-path fields for installed/native adapters.

    Adapters send paths on the equipped host. Usability and symlink resolution
    remain the original registration's responsibility immediately before launch.
    Empty defaults add no fields to an existing immutable command specification.
    """
    if not isinstance(paths, (list, tuple)) or len(paths) > MAX_RUNTIME_PATHS:
        raise RuntimeUseError(f"Supply at most {MAX_RUNTIME_PATHS} explicit shared runtime paths")
    result = {}
    if paths:
        result["runtime_paths"] = sorted({str(lexical_path(path)) for path in paths})
    if registry_root is not None:
        result["runtime_consumers_root"] = str(lexical_path(registry_root).resolve())
    return result


@contextmanager
def registry_lock(root):
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(root / ".lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "a") as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        yield


def pointer_path(registry, record):
    return registry / (hashlib.sha256(str(record).encode()).hexdigest() + ".json")


def request_at(record, supplied=None):
    request = native().read_json(record / "request.json")
    if (not isinstance(request, dict) or request.get("schema") != native().SCHEMA
            or not isinstance(request.get("intent"), dict)):
        raise RuntimeUseError("Select an existing original native command record")
    if supplied is not None and request != supplied:
        raise RuntimeUseError("The supplied request differs from the original native record")
    if record.name != hashlib.sha256(request["intent"]["operation_id"].encode()).hexdigest():
        raise RuntimeUseError("Original operation ID and native record directory differ")
    return request


def same_record_path(retained, record):
    """Keep the original registry identity through a verified directory alias."""
    if retained == str(record):
        return True
    if not isinstance(retained, str) or not Path(retained).is_absolute():
        return False
    try:
        return Path(retained).samefile(record)
    except (OSError, ValueError):
        return False


def read_use(record, request=None):
    value = native().read_json(record / RECORD_FILE)
    if value is None:
        return None
    if (not isinstance(value, dict) or value.get("schema") != SCHEMA
            or not same_record_path(value.get("record"), record) or not isinstance(value.get("paths"), list)):
        raise RuntimeUseError("Original runtime-use record is malformed")
    if request is not None and value.get("intent_sha256") != digest(request["intent"]):
        raise RuntimeUseError("Runtime-use record belongs to a different original command intent")
    return value


def _amendment_anchor_floor(previous, history, resource):
    """Anchor after this record's already consumed resource events.

    A declaration can return to an earlier value. Its intent hash then cannot
    identify which occurrence is current; retained amendment IDs provide that
    boundary while the original reference bytes keep their historical context.
    """
    retained = previous.get("intent_amendments", [])
    if not isinstance(retained, list) or any(not isinstance(row, dict) for row in retained):
        raise RuntimeUseError("Preserve the original runtime amendment references")
    positions = {event.get("amendment_id"): index for index, event in enumerate(history)
                 if isinstance(event, dict)}
    consumed, seen = [], set()
    for row in retained:
        key = (row.get("resource", "memory"), row.get("amendment_id"))
        if key in seen:
            raise RuntimeUseError("The original runtime amendment reference is duplicated")
        seen.add(key)
        if key[0] != resource:
            continue
        if key[1] not in positions:
            raise RuntimeUseError("The retained runtime reference is absent from its original amendment history")
        consumed.append(positions[key[1]])
    if consumed != sorted(consumed):
        raise RuntimeUseError("Preserve the original runtime amendment reference order")
    return consumed[-1] + 1 if consumed else 0


def reconcile_capacity_amendments(previous, request):
    """Join original resource histories and reviewed pre-dispatch placements."""
    if request.get("placement_amendments"):
        if __package__:
            from . import native_handoff_placement
        else:
            import native_handoff_placement
        try:
            return native_handoff_placement.reconcile(previous, request, _reconcile_capacity_only)
        except (ValueError, KeyError, TypeError) as exc:
            raise RuntimeUseError(str(exc)) from exc
    return _reconcile_capacity_only(previous, request)


def _reconcile_capacity_only(previous, request):
    """Join both independent capacity histories to the registered full intent.

    Each valid history changes only its own declaration. Find the retained disk
    version whose complete intent anchors the original memory reader, then carry
    that joined memory forward through the remaining disk events. No timestamp
    ordering is assumed and every non-capacity field remains SHA-bound.
    """
    if previous is None or previous["intent_sha256"] == digest(request["intent"]):
        return previous
    history = request.get("disk_amendments", [])
    if not isinstance(history, list):
        raise RuntimeUseError("Preserve the original disk amendment history")
    if not history:
        return _reconcile_memory_amendments(previous, request)
    from cloud_disk import amended_specification
    intent = request["intent"]
    versions, seen = [], set()
    for event in history:
        if not isinstance(event, dict):
            raise RuntimeUseError("Preserve the original disk amendment history")
        identity, changes = event.get("amendment_id"), event.get("changes")
        if (not isinstance(identity, str) or not 1 <= len(identity) <= 128
                or any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-" for c in identity)
                or identity in seen or event.get("command_previously_started") is not False
                or not isinstance(changes, dict)
                or set(changes) != {"disk_space", "disk_inodes", "reserve_mib", "reserve_inodes"}):
            raise RuntimeUseError("The original disk amendment identity or declaration is invalid")
        seen.add(identity)
        before = event.get("previous")
        if (not isinstance(before, dict) or (versions and versions[-1] != before)
                or event.get("previous_sha256") != digest(before)):
            raise RuntimeUseError("The original disk amendment chain is discontinuous")
        try:
            updated = amended_specification(before, **changes)
        except (ValueError, KeyError, TypeError) as exc:
            raise RuntimeUseError("The original disk amendment values are invalid") from exc
        if (updated == before or event.get("next") != updated
                or event.get("next_sha256") != digest(updated)):
            raise RuntimeUseError("The original disk amendment differs from its retained declaration")
        if not versions:
            versions.append(before)
        versions.append(updated)
    if intent.get("disk") != versions[-1]:
        raise RuntimeUseError("The runtime disk intent is not its recorded amendment")
    joined = None
    anchor_floor = _amendment_anchor_floor(previous, history, "disk")
    for index in range(len(versions) - 1, anchor_floor - 1, -1):
        candidate = {**request, "intent": {**intent, "disk": versions[index]}}
        try:
            joined = _reconcile_memory_amendments(previous, candidate)
        except RuntimeUseError:
            continue
        break
    if joined is None:
        raise RuntimeUseError("The runtime intent is not its original request or recorded capacity amendments")
    references = joined.get("intent_amendments", [])
    if not isinstance(references, list) or any(not isinstance(row, dict) for row in references):
        raise RuntimeUseError("Preserve the original runtime amendment references")
    by_id = {(row.get("resource", "memory"), row.get("amendment_id")): row for row in references}
    if len(by_id) != len(references):
        raise RuntimeUseError("The original runtime amendment reference is duplicated")
    references = list(references)
    for event in history[index:]:
        row = {"resource": "disk", "amendment_id": event["amendment_id"], "source": "request.json",
               "previous_intent_sha256": digest({**intent, "disk": event["previous"]}),
               "intent_sha256": digest({**intent, "disk": event["next"]}),
               "amended_at": event.get("amended_at")}
        key = ("disk", row["amendment_id"])
        if key in by_id:
            if by_id[key] != row:
                raise RuntimeUseError("The original runtime amendment reference changed")
        else:
            references.append(row)
    return {**joined, "intent_sha256": digest(intent), "intent_amendments": references}


def reconcile_memory_amendments(previous, request):
    """Keep the original reader API compatible with both capacity histories."""
    return reconcile_capacity_amendments(previous, request)


def _reconcile_memory_amendments(previous, request):
    """Join an original pre-dispatch amendment to the existing intent binding.

    Only request.json owns the amendment history. Reconstructing each complete
    intent from that history anchors every non-memory field to the previously
    registered SHA; neither this reader nor the shared index changes a request.
    The caller holds the existing registry lock before saving the joined value.
    """
    if previous is None or previous["intent_sha256"] == digest(request["intent"]):
        return previous
    history = request.get("memory_amendments")
    if not isinstance(history, list) or not history:
        raise RuntimeUseError("Runtime-use record belongs to a different original command intent")
    from cloud_memory import RECLAIM_MODES, STORAGE_MODES
    intent = request["intent"]
    anchor_floor = _amendment_anchor_floor(previous, history, "memory")
    seen, references = set(), []
    memory = None
    anchored = False
    for index, event in enumerate(history):
        if not isinstance(event, dict):
            raise RuntimeUseError("Preserve the original memory amendment history")
        identity, changes = event.get("amendment_id"), event.get("changes")
        if (not isinstance(identity, str) or not 1 <= len(identity) <= 128
                or any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-" for c in identity)
                or identity in seen or event.get("command_previously_started") is not False
                or not isinstance(changes, dict)
                or set(changes) not in ({"memory_mib", "reserve_mib", "reclaim_mode"},
                                       {"memory_mib", "reserve_mib", "reclaim_mode", "storage_mode"})):
            raise RuntimeUseError("The original memory amendment identity or declaration is invalid")
        seen.add(identity)
        before = event.get("previous")
        if (not isinstance(before, dict) or (memory is not None and before != memory)
                or event.get("previous_sha256") != digest(before)):
            raise RuntimeUseError("The original memory amendment chain is discontinuous")
        peak, reserve, mode = changes["memory_mib"], changes["reserve_mib"], changes["reclaim_mode"]
        storage = changes.get("storage_mode")
        if (type(peak) is not int or peak < 1
                or (reserve is not None and (type(reserve) is not int or reserve < 0))
                or (mode is not None and mode not in RECLAIM_MODES)
                or ("storage_mode" in changes and storage not in STORAGE_MODES)):
            raise RuntimeUseError("The original memory amendment values are invalid")
        updated = {**before, "peak_bytes": peak * 1024 * 1024}
        if reserve is not None:
            updated["reserve_bytes"] = reserve * 1024 * 1024
        if mode == "none":
            updated.pop("reclaim_mode", None)
        elif mode is not None:
            updated["reclaim_mode"] = mode
        if storage == "included":
            updated.pop("storage_mode", None)
        elif storage is not None:
            updated["storage_mode"] = storage
        if (updated == before or event.get("next") != updated
                or event.get("next_sha256") != digest(updated)):
            raise RuntimeUseError("The original memory amendment differs from its retained declaration")
        prior_sha = digest({**intent, "memory": before})
        next_sha = digest({**intent, "memory": updated})
        anchored = anchored or (index >= anchor_floor and prior_sha == previous["intent_sha256"])
        if anchored:
            references.append({"amendment_id": identity, "source": "request.json",
                               "previous_intent_sha256": prior_sha, "intent_sha256": next_sha,
                               "amended_at": event.get("amended_at")})
        memory = updated
    if not anchored or intent.get("memory") != memory:
        raise RuntimeUseError("The runtime intent is not its original request or a recorded memory amendment")
    retained = previous.get("intent_amendments", [])
    if not isinstance(retained, list) or any(not isinstance(row, dict) for row in retained):
        raise RuntimeUseError("Preserve the original runtime amendment references")
    by_id = {(row.get("resource", "memory"), row.get("amendment_id")): row for row in retained}
    if len(by_id) != len(retained):
        raise RuntimeUseError("The original runtime amendment reference is duplicated")
    joined = list(retained)
    for row in references:
        if ("memory", row["amendment_id"]) in by_id:
            if by_id[("memory", row["amendment_id"])] != row:
                raise RuntimeUseError("The original runtime amendment reference changed")
        else:
            joined.append(row)
    return {**previous, "intent_sha256": digest(intent), "intent_amendments": joined}


def declared_paths(request, selected=(), previous=None):
    project = request["intent"]["project"]
    from runtime_declarations import effective_declarations
    amended = effective_declarations(request, previous)
    if amended is not None:
        declarations = {row["path"]: row["required"] for row in amended}
    else:
        # Keep the project alias even before the original node-deps prepare
        # creates it. Refresh after materialization observes its actual target.
        declarations = {str(lexical_path("node_modules", project)): False}
        if previous:
            declarations.update({row["path"]: row["required"] for row in previous["declarations"]})
        for path in request["intent"].get("runtime_paths", []):
            declarations[str(lexical_path(path, project))] = True
    # Storage roles also identify future outputs, caches and case directories.
    # Protect their exact paths before creation; explicit required runtime
    # declarations and original declaration amendments retain their meaning.
    for row in request["intent"].get("storage_paths", []):
        declarations.setdefault(str(lexical_path(row["path"], project)), False)
    for path in selected:
        declarations[str(lexical_path(path, project))] = True
    return [{"path": path, "required": required} for path, required in sorted(declarations.items())]


def observe_paths(declarations):
    paths, traversed, links = {}, set(), 0
    entries = 0

    def add(path, *, required, origin):
        alias = lexical_path(path)
        try:
            resolved = alias.resolve(strict=True)
            info = resolved.stat()
        except FileNotFoundError:
            if required:
                raise RuntimeUseError("Selected runtime path is unavailable: " + str(alias))
            # Optional Node output is still an exact future path of this job.
            paths[str(alias)] = {"path": str(alias), "kind": "directory", "present": False,
                                 "origin": origin}
            return None
        if not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
            raise RuntimeUseError("Selected runtime must be a regular file or directory: " + str(alias))
        observed = {"kind": "directory" if stat.S_ISDIR(info.st_mode) else "file", "present": True,
                    "device": info.st_dev, "inode": info.st_ino, "origin": origin}
        paths[str(alias)] = {"path": str(alias), "resolved": str(resolved), **observed}
        paths[str(resolved)] = {"path": str(resolved), **observed}
        return resolved if stat.S_ISDIR(info.st_mode) else None

    pending = []
    for row in declarations:
        selected = add(row["path"], required=row["required"], origin="declared")
        if selected is not None:
            pending.append(selected)
    # Package trees may themselves link to another shared package or browser.
    # Walk directory entries only, never hash package bytes or follow loops.
    while pending:
        root = pending.pop()
        if root in traversed:
            continue
        traversed.add(root)

        def fail(error):
            raise RuntimeUseError("Cannot observe selected runtime tree: " + str(error.filename)) from error

        for directory, dirs, files in os.walk(root, followlinks=False, onerror=fail):
            entries += len(dirs) + len(files)
            if entries > MAX_ENTRIES:
                raise RuntimeUseError("Runtime observation exceeds 250000 entries; select the consumed package roots")
            for name in dirs + files:
                path = Path(directory) / name
                if not path.is_symlink():
                    continue
                links += 1
                if links > MAX_LINKS:
                    raise RuntimeUseError("Runtime observation exceeds 4096 links; select the consumed package roots")
                if path.resolve().is_relative_to(root):
                    continue
                # Optional package links can be absent on this platform; retain
                # their lexical paths without converting them into requirements.
                target = add(path, required=False, origin="runtime_symlink")
                if target is not None and not target.is_relative_to(root):
                    pending.append(target)
    return [paths[path] for path in sorted(paths)]


class _ObservedPathIndex:
    """Index this registration's exact lexical paths without resolving them again."""
    def __init__(self, paths):
        scopes = {}
        for row in paths:
            path = Path(row["path"])
            descendants, directories = scopes.setdefault(path.anchor, (set(), set()))
            descendants.add(path.parts)
            if row.get("kind") == "directory":
                directories.add(path.parts)
        self.scopes = {anchor: (sorted(descendants), directories)
                       for anchor, (descendants, directories) in scopes.items()}

    def overlaps(self, selected):
        selected = Path(selected)
        scope = self.scopes.get(selected.anchor)
        if scope is None:
            return False
        descendants, directories = scope
        parts = selected.parts
        # A declared directory protects every selected descendant. A declared
        # file protects only itself or a selected ancestor, as in overlaps().
        if any(parts[:depth] in directories for depth in range(len(parts) + 1)):
            return True
        index = bisect_left(descendants, parts)
        return (index < len(descendants)
                and descendants[index][:len(parts)] == parts)





def _plan_directory(registry, plan_id):
    if (not isinstance(plan_id, str) or len(plan_id) != 64
            or any(c not in "0123456789abcdef" for c in plan_id)):
        raise RuntimeUseError("Retain the original cache plan digest")
    directory = Path(registry) / "cache-plans" / "retained" / plan_id
    return directory



def _retention_directory(registry, plan_id, *, plan=None):
    """Resolve an explicit external journal through the ORIGINAL registry."""
    directory = _plan_directory(registry, plan_id)
    pointer = native().read_json(Path(registry) / "cache-plans" / (plan_id + ".json"))
    frozen = plan.get("external_journal") if plan is not None else None
    selected = pointer.get("external_journal") if isinstance(pointer, dict) else None
    if selected is not None and frozen is not None and selected != frozen:
        raise RuntimeUseError("The registered recovery directory differs from the original plan")
    selected = selected if selected is not None else frozen
    if selected is None:
        return directory
    if (not isinstance(selected, dict) or set(selected) != {"directory", "device", "inode"}
            or not isinstance(selected["directory"], str)
            or not Path(selected["directory"]).is_absolute()):
        raise RuntimeUseError("Malformed external recovery directory binding")
    root = lexical_path(selected["directory"])
    info = root.lstat()
    if (root.resolve() != root or not stat.S_ISDIR(info.st_mode)
            or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077
            or str(info.st_dev) != selected["device"] or str(info.st_ino) != selected["inode"]):
        raise RuntimeUseError("The selected external recovery directory is unavailable or changed")
    return root / plan_id


def _prepare_retention_directory(registry, plan):
    directory = _retention_directory(registry, plan["plan_id"], plan=plan)
    if "external_journal" not in plan:
        return _prepare_plan_directory(registry, plan["plan_id"])
    directory.mkdir(mode=0o700, exist_ok=True)
    from swarm_cloud_cache import sync_dir
    sync_dir(directory.parent)
    info = directory.lstat()
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid()
            or stat.S_IMODE(info.st_mode) & 0o077):
        raise RuntimeUseError("Keep the original owner-private external plan directory")
    return directory


def _prepare_plan_directory(registry, plan_id):
    directory = _plan_directory(registry, plan_id)
    current = Path(registry)
    current.mkdir(mode=0o700, parents=True, exist_ok=True)
    for name in ("cache-plans", "retained", plan_id):
        current = current / name
        current.mkdir(mode=0o700, exist_ok=True)
        if not stat.S_ISDIR(current.lstat().st_mode):
            raise RuntimeUseError("Retained plan storage changed directory type: " + str(current))
    return directory


def _regular_bytes(path, *, absent=False):
    """Read one stable regular file without following a replaced final name."""
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW)
    except FileNotFoundError:
        if absent:
            return None
        raise
    try:
        from swarm_cloud_cache import identity
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode):
            raise RuntimeUseError("Retained cache metadata must be a regular file: " + str(path))
        with os.fdopen(os.dup(fd), "rb") as stream:
            raw = stream.read()
        if (identity(os.fstat(fd)) != identity(before)
                or identity(os.stat(path, follow_symlinks=False)) != identity(before)):
            raise RuntimeUseError("Cache metadata changed while being retained: " + str(path))
        return raw
    finally:
        os.close(fd)


def _cache_metadata_bytes(path, *, absent=False):
    """Read the original plan/checkpoint bytes through the supported envelope."""
    from cache_metadata import decode_metadata
    raw = _regular_bytes(path, absent=absent)
    return None if raw is None else decode_metadata(raw)


@contextmanager
def _original_journal(path, plan):
    """Keep an existing progress writer out while copying its exact checkpoint."""
    from swarm_cloud_cache import load_state, state_path, progress_path, encoded
    events = progress_path(path)
    try:
        fd = os.open(events, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW)
    except FileNotFoundError:
        fd = None
    try:
        if fd is not None:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as exc:
                raise RuntimeUseError("The original cache journal still has a writer; preserve that operation") from exc
        checkpoint = _cache_metadata_bytes(state_path(path), absent=True)
        progress = _regular_bytes(events, absent=True)
        state = load_state(path, plan)
        if (checkpoint != _cache_metadata_bytes(state_path(path), absent=True)
                or progress != _regular_bytes(events, absent=True)):
            raise RuntimeUseError("The original cache journal changed during retention")
        if fd is not None:
            opened = os.fstat(fd)
            current = os.stat(events, follow_symlinks=False)
            if (opened.st_dev, opened.st_ino) != (current.st_dev, current.st_ino):
                raise RuntimeUseError("The original cache progress file was replaced")
        yield {"checkpoint": checkpoint, "progress": progress, "state": state,
               "state_sha256": hashlib.sha256(encoded(state)).hexdigest()}
    finally:
        if fd is not None:
            os.close(fd)


def _retained_plan(registry, plan_id, *, plan=None):
    from swarm_cloud_cache import load_plan, load_state, state_path
    directory = _retention_directory(registry, plan_id, plan=plan)
    # A complete pending publication can be read after an interrupted rename.
    # Incomplete staging never becomes a replacement for the original journal.
    publication = directory / "data"
    if not os.path.lexists(publication):
        publication = directory / ".pending"
    if os.path.lexists(publication) and not stat.S_ISDIR(publication.lstat().st_mode):
        raise RuntimeUseError("Retained plan publication changed directory type")
    metadata_file = publication / "retention.json"
    raw = _regular_bytes(metadata_file, absent=True)
    if raw is None:
        pointer = native().read_json(Path(registry) / "cache-plans" / (plan_id + ".json"))
        if isinstance(pointer, dict) and pointer.get("external_journal") is not None:
            raise RuntimeUseError("The registered external recovery journal is missing; preserve its original binding")
        if publication.name == "data" and publication.exists():
            raise RuntimeUseError("Retained cache publication is incomplete")
        return None
    metadata = json.loads(raw)
    if not isinstance(metadata, dict):
        raise RuntimeUseError("Retained cache plan metadata is malformed")
    path = publication / "plan.json"
    plan_raw = _cache_metadata_bytes(path)
    plan = load_plan(path)
    if (metadata.get("schema") != "commons.retained-cache-plan/v1"
            or metadata.get("plan_id") != plan_id or plan["plan_id"] != plan_id
            or metadata.get("cache_root") != plan["cache_root"]
            or metadata.get("plan_bytes") != len(plan_raw)
            or metadata.get("plan_sha256") != hashlib.sha256(plan_raw).hexdigest()
            or not isinstance(metadata.get("source_plan"), str)
            or not Path(metadata["source_plan"]).is_absolute()):
        raise RuntimeUseError("Retained cache plan identity changed: " + str(path))
    if _retention_directory(registry, plan_id, plan=plan) != directory:
        raise RuntimeUseError("The external retained plan changed its selected directory")
    # A missing shared checkpoint must never become load_state's empty default.
    _regular_bytes(state_path(path))
    load_state(path, plan)
    return path, plan, metadata


def _retain_plan(registry, source, plan):
    """Publish one coherent exact-byte plan/checkpoint/event directory."""
    from swarm_cloud_cache import atomic_bytes, encoded, load_plan, load_state
    from swarm_cloud_cache import state_path, progress_path, sync_dir
    source = lexical_path(source).resolve()
    raw = _cache_metadata_bytes(source)
    if load_plan(source) != plan or json.loads(raw) != plan:
        raise RuntimeUseError("The supplied cache plan differs from its original file")
    directory = _prepare_retention_directory(registry, plan)
    publication = directory / "data"
    existing = _retained_plan(registry, plan["plan_id"], plan=plan)
    if existing is not None:
        saved_path, saved_plan, metadata = existing
        if saved_plan != plan or _cache_metadata_bytes(saved_path) != raw:
            raise RuntimeUseError("Retain the original exact plan bytes for this plan ID")
        if source != saved_path:
            with _original_journal(source, plan) as observed:
                if observed["state_sha256"] != metadata["source_state_sha256"]:
                    if observed["state"] != load_state(saved_path, plan):
                        raise RuntimeUseError("Original and retained cache journals diverged; preserve both histories")
        if saved_path.parent.name == ".pending":
            if os.path.lexists(publication):
                raise RuntimeUseError("Preserve both interrupted cache publications")
            os.rename(saved_path.parent, publication)
            sync_dir(directory)
            saved_path = publication / "plan.json"
        return saved_path, saved_plan, metadata
    pending = directory / ".pending"
    pending.mkdir(mode=0o700, exist_ok=True)
    if not stat.S_ISDIR(pending.lstat().st_mode):
        raise RuntimeUseError("Pending cache publication changed directory type")
    path = pending / "plan.json"
    previous = _cache_metadata_bytes(path, absent=True)
    if previous is None:
        atomic_bytes(path, raw, new=True)
    elif previous != raw:
        raise RuntimeUseError("The pending publication belongs to different plan bytes")
    with _original_journal(source, plan) as observed:
        metadata = {"schema": "commons.retained-cache-plan/v1",
                    "plan_id": plan["plan_id"], "cache_root": plan["cache_root"],
                    "plan_bytes": len(raw), "plan_sha256": hashlib.sha256(raw).hexdigest(),
                    "source_plan": str(source), "source_state_sha256": observed["state_sha256"],
                    "source_checkpoint_sha256": (hashlib.sha256(observed["checkpoint"]).hexdigest()
                                                 if observed["checkpoint"] is not None else None),
                    "source_progress_sha256": (hashlib.sha256(observed["progress"]).hexdigest()
                                               if observed["progress"] is not None else None)}
        # Until retention.json is published this directory is incomplete and no
        # borrower uses it. Retry can finish its same-plan checkpoint from the
        # quiescent original source without replacing an authoritative history.
        checkpoint = (observed["checkpoint"] if observed["checkpoint"] is not None
                      else encoded({"plan_id": plan["plan_id"], "items": {}}))
        atomic_bytes(state_path(path), checkpoint)
        if observed["progress"] is not None:
            atomic_bytes(progress_path(path), observed["progress"])
        elif os.path.lexists(progress_path(path)):
            _regular_bytes(progress_path(path))
            progress_path(path).unlink()
            sync_dir(pending)
        if load_plan(path) != plan or load_state(path, plan) != observed["state"]:
            raise RuntimeUseError("Retained plan and journal did not reopen identically")
        if (observed["checkpoint"] != _cache_metadata_bytes(state_path(source), absent=True)
                or observed["progress"] != _regular_bytes(progress_path(source), absent=True)):
            raise RuntimeUseError("The original journal changed before retained publication")
        atomic_bytes(pending / "retention.json", encoded(metadata), new=True)
        sync_dir(pending)
        if os.path.lexists(publication):
            raise RuntimeUseError("Preserve both retained cache publications")
        os.rename(pending, publication)
        sync_dir(directory)
    return publication / "plan.json", plan, metadata


@contextmanager
def _plan_writer(registry, plan_id):
    directory = _plan_directory(registry, plan_id)
    _prepare_plan_directory(registry, plan_id)
    fd = os.open(directory / ".writer", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise RuntimeUseError("The retained cache plan already has its original writer") from exc
        yield
    finally:
        os.close(fd)


def _registered_plan(registry, pointer):
    from swarm_cloud_cache import load_plan
    retained = _retained_plan(registry, pointer["plan_id"])
    if retained is None:
        path = Path(pointer["plan"])
        return path, load_plan(path)
    path, plan, metadata = retained
    if (("plan_sha256" in pointer and pointer["plan_sha256"] != metadata["plan_sha256"])
            or ("plan_bytes" in pointer and pointer["plan_bytes"] != metadata["plan_bytes"])):
        raise RuntimeUseError("Registered cache plan bytes no longer match retained identity")
    original = Path(pointer["plan"])
    if original != path and original.exists():
        # An older caller may have republished its original pointer. Never
        # silently prefer an earlier retained checkpoint over that writer.
        if load_plan(original) != plan or _cache_metadata_bytes(original) != _cache_metadata_bytes(path):
            raise RuntimeUseError("Original cache plan differs from retained exact bytes")
        from swarm_cloud_cache import load_state
        with _original_journal(original, plan) as observed:
            if (observed["state_sha256"] != metadata["source_state_sha256"]
                    and observed["state"] != load_state(path, plan)):
                raise RuntimeUseError("Original and retained cache journals diverged; preserve both histories")
    if plan["cache_root"] != pointer["cache_root"]:
        raise RuntimeUseError("Original cache plan pointer no longer matches its plan")
    return path, plan


def available_after_retirement(registry, paths):
    """Read the original cache's journal/markers if retirement won the lock.

    Retained plans keep their original digest and authoritative progress.
    Exact matching markers remain binding even when a legacy journal was lost.
    """
    observed = _ObservedPathIndex(paths)
    for pointer_file in sorted((registry / "cache-plans").glob("*.json")):
        from swarm_cloud_cache import load_plan, load_state, parent_fd, MARKER_LIMIT, CacheError
        pointer = native().read_json(pointer_file)
        if not isinstance(pointer, dict) or not pointer.get("plan") or not pointer.get("cache_root"):
            raise RuntimeUseError("Malformed original cache plan pointer: " + str(pointer_file))
        if not observed.overlaps(pointer["cache_root"]):
            continue
        try:
            retained_path, plan = _registered_plan(registry, pointer)
            state = load_state(retained_path, plan)
        except CacheError as exc:
            raise RuntimeUseError(str(exc)) from exc
        if plan["plan_id"] != pointer.get("plan_id") or plan["cache_root"] != pointer["cache_root"]:
            raise RuntimeUseError("Original cache plan pointer no longer matches its plan")
        for entry in plan["entries"]:
            mutated = bool(state["items"].get(entry["id"], {}).get("phase"))
            target = str(Path(plan["cache_root"]) / entry["path"])
            if not observed.overlaps(target):
                continue
            try:
                with parent_fd(plan["cache_root"], entry["path"]) as (directory, name):
                    fd = os.open(name, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW, dir_fd=directory)
                    try:
                        info = os.fstat(fd)
                        if not stat.S_ISREG(info.st_mode):
                            raise RuntimeUseError("A runtime path changed type: " + target)
                        raw = os.read(fd, MARKER_LIMIT) if info.st_size <= MARKER_LIMIT else None
                    finally:
                        os.close(fd)
                try:
                    marker = json.loads(raw) if raw is not None else None
                except (ValueError, UnicodeError):
                    marker = None
                if isinstance(marker, dict) and marker.get("commons_cloud_cache_retired"):
                    from swarm_cloud_cache import is_marker
                    if not is_marker(marker, plan, entry):
                        raise RuntimeUseError("Runtime path contains a different retirement marker: " + target)
                    raise RuntimeUseError("Runtime path was retired; recover its original plan before dispatch: "
                                          + target + " ; " + str(retained_path))
            except FileNotFoundError as exc:
                if mutated:
                    raise RuntimeUseError("Runtime path was retired; recover its original plan before dispatch: "
                                          + target + " ; " + str(retained_path)) from exc


def _registration_binding(value):
    """The durable selection, independent of observation/revision counters."""
    return {key: value.get(key) for key in (
        "schema", "record", "registry_root", "operation_id", "peer", "project",
        "intent_sha256", "declarations", "paths", "intent_amendments", "declaration_amendments", "released_at")}


def _registration_pointer(value):
    return {"schema": POINTER_SCHEMA, "record": value["record"],
            "intent_sha256": value["intent_sha256"],
            "operation_id": value["operation_id"], "peer": value["peer"],
            "revision": value["revision"], "paths": value["paths"]}


def _pointer_covers(pointer, value):
    """A prior observation revision can already protect this exact selection."""
    if (not isinstance(pointer, dict) or pointer.get("schema") != POINTER_SCHEMA
            or type(pointer.get("revision")) is not int
            or type(value.get("revision")) is not int
            or not 1 <= pointer["revision"] <= value["revision"]):
        return False
    expected = _registration_pointer(value)
    return all(pointer.get(key) == item for key, item in expected.items()
               if key != "revision")


def registration_status(value):
    """Read the original record/index linkage without registering or dispatching."""
    result = {"pointer": None, "record_revision": value.get("revision"),
              "pointer_revision": None}
    try:
        pointer_file = pointer_path(Path(value["registry_root"]), Path(value["record"]))
        result["pointer"] = str(pointer_file)
        pointer = native().read_json(pointer_file)
        if pointer is None:
            return {**result, "state": "released" if value.get("released_at") else "record_only"}
        if isinstance(pointer, dict):
            result["pointer_revision"] = pointer.get("revision")
        return {**result, "state": "linked" if _pointer_covers(pointer, value) else "pointer_differs"}
    except (OSError, ValueError, KeyError, TypeError) as exc:
        return {**result, "state": "pointer_unavailable", "error": type(exc).__name__}


def register(record, request=None, selected_paths=(), *, registry_root=None):
    record = Path(record).expanduser().resolve(strict=True)
    request = request_at(record, request)
    previous = read_use(record)
    if previous:
        # Keep the existing shared pointer and record spelling after a caller
        # moves this same directory while preserving its original path alias.
        record = Path(previous["record"])
    chosen = registry_path(registry_root or (previous or {}).get("registry_root"))
    if previous and chosen != Path(previous["registry_root"]):
        raise RuntimeUseError("Use the original record's shared runtime registry")
    with registry_lock(chosen):
        # Another registration may have augmented the same running record.
        request = request_at(record, request)
        original = read_use(record)
        previous = reconcile_capacity_amendments(original, request)
        declarations = declared_paths(request, selected_paths, previous)
        observed = observe_paths(declarations)
        available_after_retirement(chosen, observed)
        # A loaded process may retain an earlier resolved package after a
        # symlink moves. Preserve every observed path for this same operation.
        retained = {row["path"]: row for row in (previous or {}).get("paths", [])}
        retained.update({row["path"]: row for row in observed})
        checked_at = native().now()
        value = {"schema": SCHEMA, "record": str(record), "registry_root": str(chosen),
                 "operation_id": request["intent"]["operation_id"], "peer": request["intent"]["peer"],
                 "project": request["intent"]["project"], "intent_sha256": digest(request["intent"]),
                 "revision": (previous or {}).get("revision", 0) + 1,
                 "registered_at": (previous or {}).get("registered_at", checked_at),
                 "observed_at": checked_at, "declarations": declarations,
                 "paths": [retained[path] for path in sorted(retained)]}
        if (previous or {}).get("intent_amendments"):
            value["intent_amendments"] = previous["intent_amendments"]
        if (previous or {}).get("declaration_amendments"):
            value["declaration_amendments"] = previous["declaration_amendments"]
        record_written = original is None or _registration_binding(original) != _registration_binding(value)
        if not record_written:
            # Keep exact durable bytes and the original revision on unchanged
            # refresh, including the record-first half of an earlier retry.
            value = original
        pointer_file = pointer_path(chosen, record)
        pointer = native().read_json(pointer_file)
        if (isinstance(pointer, dict) and pointer.get("schema") == POINTER_SCHEMA
                and pointer.get("record") == str(record)
                and type(pointer.get("revision")) is int
                and pointer["revision"] > (original or {}).get("revision", 0)):
            raise RuntimeUseError("The shared pointer is newer than its original runtime-use record")
        pointer_written = not _pointer_covers(pointer, value)
        # Observe paths and retirement under the original shared lock even on
        # reuse. Publish the authoritative record before its protection pointer.
        # A failed second write leaves this same record available for repair;
        # retry never increments its revision without a changed selection.
        if record_written:
            native().save_json(record / RECORD_FILE, value)
        if pointer_written:
            native().save_json(pointer_file, _registration_pointer(value))
    result = snapshot(record, native().inspect(record))
    result["registration"].update(record_written=record_written, pointer_written=pointer_written,
                                   reused=not record_written and not pointer_written,
                                   checked_at=checked_at)
    return result


def refresh(record):
    record = Path(record).resolve(strict=True)
    previous = read_use(record)
    if previous is None:
        return None
    return register(record, registry_root=previous["registry_root"])


def _release_source(record):
    """Select one ended dispatched lifetime without changing its execution."""
    selected = {}
    documents = {}
    names = ("request.json", "state.json", "result.json", "process.json",
             "supervisor-launch.json", "residency.json", "stop-request.json",
             "stop-release.json", "runtime-handoff.json", "command-completion.dat")
    for name in names:
        path = record / name
        try:
            descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        except FileNotFoundError:
            selected[name] = None
            documents[name] = None
            continue
        try:
            before = os.fstat(descriptor)
            if not stat.S_ISREG(before.st_mode) or before.st_size > 2 * 1024 * 1024:
                raise RuntimeUseError("Original lifecycle record has an unsupported file: " + name)
            chunks = []
            while True:
                chunk = os.read(descriptor, 65536)
                if not chunk:
                    break
                chunks.append(chunk)
                if sum(map(len, chunks)) > 2 * 1024 * 1024:
                    raise RuntimeUseError("Original lifecycle record changed while selecting: " + name)
            after = os.fstat(descriptor)
            if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
                    after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                raise RuntimeUseError("Original lifecycle record changed while selecting: " + name)
            raw = b"".join(chunks)
        finally:
            os.close(descriptor)
        selected[name] = {"sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)}
        if name.endswith(".json"):
            documents[name] = json.loads(raw)
    return selected, documents


def _ended_identity(value):
    if (not isinstance(value, dict) or type(value.get("proc_pid")) is not int
            or value["proc_pid"] < 1 or not str(value.get("start_ticks", "")).isdigit()
            or not isinstance(value.get("boot_id"), str)):
        return False
    import uuid
    try:
        uuid.UUID(value["boot_id"])
    except (ValueError, AttributeError):
        return False
    return native()._supervisor_ended(value)


def _interrupted_selection(record):
    files, documents = _release_source(record)
    request = request_at(record, documents["request.json"])
    state = documents["state.json"] or {}
    if not isinstance(state, dict):
        raise RuntimeUseError("Original dispatched state is malformed")
    process = documents["process.json"] or state.get("process")
    supervisor = state.get("supervisor")
    if not process or not supervisor or documents["result.json"] is not None:
        raise RuntimeUseError("Select the dispatched original process with its result still unavailable")
    if state.get("process") and state["process"] != process:
        raise RuntimeUseError("The original command identities differ")
    from native_completion import observe
    completion = observe(record, request)
    if completion and completion.get("outcome"):
        raise RuntimeUseError("The original command has a retained exit; use its normal finalization")
    identities = [{"source": "state.json:supervisor", "identity": supervisor},
                  {"source": "process.json", "identity": process}]
    launch = documents["supervisor-launch.json"]
    if launch is not None and not isinstance(launch, dict):
        raise RuntimeUseError("Original supervisor launch is malformed")
    if launch and launch.get("supervisor"):
        identities.append({"source": "supervisor-launch.json:supervisor",
                           "identity": launch["supervisor"]})
    residency = documents["residency.json"]
    residency_mode = None
    if residency:
        if (not isinstance(residency, dict) or residency.get("schema") != "commons.native-process-residency/v1"
                or not same_record_path(residency.get("record"), record)
                or residency.get("operation_id") != request["intent"]["operation_id"]
                or residency.get("request_sha256") != digest(request)
                or residency.get("supervisor") != supervisor
                or residency.get("process") != process
                or residency.get("scope") != "exact_original_command"):
            raise RuntimeUseError("Retained process residency differs from the original command")
        memory = residency.get("memory")
        if (isinstance(memory, dict) and "tree" not in memory
                and memory.get("status") == "original_process"):
            if (type(memory.get("proc_pid")) is not int or not isinstance(process, dict)
                    or memory["proc_pid"] != process.get("proc_pid")):
                raise RuntimeUseError("Retained original-process residency differs from its command")
            residency_mode = "legacy_original_process"
        else:
            tree = memory.get("tree") if isinstance(memory, dict) else None
            if (not isinstance(tree, dict) or tree.get("scope") != "original_command_descendants"
                    or tree.get("truncated") is not False or tree.get("unavailable_processes") != 0
                    or not isinstance(tree.get("processes"), list) or not tree["processes"]
                    or len(tree["processes"]) > 4096):
                raise RuntimeUseError("Retained command descendants require their original lifecycle observation")
            if not any(isinstance(row, dict) and row.get("identity") == process for row in tree["processes"]):
                raise RuntimeUseError("Retained residency omits the original command identity")
            for row in tree["processes"]:
                if not isinstance(row, dict):
                    raise RuntimeUseError("Retained command descendant is malformed")
                identities.append({"source": "residency.json:command-descendant",
                                   "identity": row.get("identity")})
    if not all(_ended_identity(row["identity"]) for row in identities):
        raise RuntimeUseError("An original process remains live or its ended identity is unavailable")
    previous = read_use(record)
    if previous:
        previous = reconcile_capacity_amendments(previous, request)
    identity = record.stat()
    selection = {"record": str(record), "device": identity.st_dev, "inode": identity.st_ino,
                 "operation_id": request["intent"]["operation_id"], "request_sha256": digest(request),
                 "files": files, "processes": identities,
                 "runtime_use": {key: previous.get(key) for key in
                     ("record", "registry_root", "operation_id", "intent_sha256", "declarations", "paths")}
                     if previous else None}
    if residency_mode is not None:
        selection["residency_mode"] = residency_mode
    return selection, request, supervisor


def _released_interrupted(record):
    """Called inside inspect(); never recurse through native.inspect()."""
    try:
        marker = native().read_json(record / "interrupted-release.json")
        if not isinstance(marker, dict) or marker.get("schema") != "commons.native-interrupted-release/v1":
            return False
        selection, _, _ = _interrupted_selection(record.resolve(strict=True))
        return (marker.get("selection") == selection
                and marker.get("selection_sha256") == digest(selection)
                and bool(marker.get("reason")) and bool(marker.get("released_at")))
    except (OSError, ValueError, KeyError, TypeError):
        return False


def inspect_interrupted(record):
    """Return the exact selection for explicit release of an interrupted use."""
    record = Path(record).resolve(strict=True)
    report = native().inspect(record)
    result = {"schema": "commons.native-interrupted-release-inspection/v1",
              "record": str(record), "operation_id": report["operation_id"],
              "native_state": report["state"], "eligible": False,
              "supervisor_alive": report["supervisor_alive"],
              "process_alive": report["process_alive"]}
    try:
        if report["state"] != "interrupted" or report["supervisor_alive"] or report["process_alive"]:
            raise RuntimeUseError("Select the interrupted original dispatched lifetime")
        selection, _, _ = _interrupted_selection(record)
        result.update(eligible=True, selection=selection, selection_sha256=digest(selection),
                      release=native().read_json(record / "interrupted-release-result.json"))
    except (OSError, ValueError, KeyError, TypeError) as exc:
        result["reason"] = str(exc)
    return result


def _release_reservation(record, request, supervisor, resource):
    """Use the original admission's release, including its retained alias key."""
    if resource == "memory":
        from cloud_memory import MemoryAdmission
        admission = MemoryAdmission(record, request, supervisor)
    else:
        from cloud_disk import DiskAdmission
        admission = DiskAdmission(record, request, supervisor)
    prior = native().read_json(record / (resource + ".json")) or {}
    if (prior and (prior.get("operation_id") != request["intent"]["operation_id"]
                   or prior.get("intent") != request["intent"][resource])):
        raise RuntimeUseError("The original " + resource + " observation differs from its request")
    # A moved record retains its existing ledger key. A previous boot retains
    # its original ledger directory; the observer never creates a new admission.
    admission.boot_id = supervisor["boot_id"]
    admission.directory = Path(request["intent"][resource]["ledger_root"]) / admission.boot_id
    index_path = admission.directory / "reservations.json"
    if prior.get("index") and Path(prior["index"]).resolve() != index_path.resolve():
        raise RuntimeUseError("The original " + resource + " ledger identity changed")
    with admission._index() as index:
        keys = []
        for key, row in index["reservations"].items():
            if row.get("operation_id") != request["intent"]["operation_id"]:
                continue
            if (not same_record_path(row.get("record"), record)
                    or key != hashlib.sha256((row["record"] + "\0" + row["operation_id"]).encode()).hexdigest()
                    or not _ended_identity(row.get("supervisor"))):
                raise RuntimeUseError("Original " + resource + " reservation requires its recorded owner")
            keys.append(key)
    if type(prior.get("observations")) is int:
        admission.observations = max(admission.observations, prior["observations"])
    for key in keys or [admission.key]:
        admission.key = key
        if resource == "memory":
            admission.finish(record_child_peak=False)
        else:
            admission.finish()
    observed = native().read_json(record / (resource + ".json")) or {}
    ledger = native().read_json(index_path) or {}
    present = any(row.get("operation_id") == request["intent"]["operation_id"]
                  for row in ledger.get("reservations", {}).values())
    result = {"state": observed.get("state"), "reservation_present": present,
              "index": str(index_path), "released_at": observed.get("released_at")}
    if present or observed.get("state") != "released":
        raise RuntimeUseError("Original " + resource + " release requires its retained continuation")
    return result


def release_interrupted(record, *, expected_selection_sha256, reason):
    """Release ended resource ownership; retain the original unknown outcome."""
    if (not isinstance(expected_selection_sha256, str) or len(expected_selection_sha256) != 64
            or any(c not in "0123456789abcdef" for c in expected_selection_sha256)):
        raise RuntimeUseError("Supply the inspected original selection SHA-256")
    if (not isinstance(reason, str) or not 1 <= len(reason.strip()) <= 2000
            or any(ord(c) < 32 for c in reason)):
        raise RuntimeUseError("Supply the original operator's concrete release reason")
    record = Path(record).resolve(strict=True)
    with native().run_lock(record):
        report = inspect_interrupted(record)
        if not report["eligible"]:
            raise RuntimeUseError(report["reason"])
        if report["selection_sha256"] != expected_selection_sha256:
            raise RuntimeUseError("The selected original lifetime changed; inspect that same record")
        selection, request, supervisor = _interrupted_selection(record)
        if digest(selection) != expected_selection_sha256:
            raise RuntimeUseError("The original selection changed during release")
        marker_path = record / "interrupted-release.json"
        marker = native().read_json(marker_path)
        if marker is None:
            marker = {"schema": "commons.native-interrupted-release/v1",
                      "selection": selection, "selection_sha256": digest(selection),
                      "reason": reason.strip(), "released_at": native().now(),
                      "native_state": "interrupted", "exit_code": None}
            native().save_json(marker_path, marker)
        elif (not isinstance(marker, dict) or marker.get("schema") != "commons.native-interrupted-release/v1"
              or marker.get("selection") != selection
              or marker.get("selection_sha256") != expected_selection_sha256
              or marker.get("reason") != reason.strip()):
            raise RuntimeUseError("Retain the original interrupted release selection and reason")
        result = {"schema": "commons.native-interrupted-release-result/v1",
                  "record": str(record), "operation_id": request["intent"]["operation_id"],
                  "selection_sha256": expected_selection_sha256, "native_state": "interrupted",
                  "exit_code": None, "released_at": marker["released_at"], "resources": {}}
        if "residency_mode" in selection:
            result["residency_mode"] = selection["residency_mode"]
        try:
            runtime = release(record)
            result["runtime_use"] = {"state": runtime["state"], "released": runtime["released"]}
            for resource in ("memory", "disk"):
                if not request["intent"].get(resource):
                    continue
                result["resources"][resource] = _release_reservation(
                    record, request, supervisor, resource)
            if not runtime["released"] and runtime["state"] != "unregistered":
                raise RuntimeUseError("Original runtime registration remains in use")
            result["state"] = "released"
        except (OSError, ValueError, KeyError, TypeError) as exc:
            result.update(state="release_pending", error=type(exc).__name__, reason=str(exc))
        result["observed_at"] = native().now()
        native().save_json(record / "interrupted-release-result.json", result)
        return result


def finished(report):
    if report.get("supervisor_alive") or report.get("process_alive"):
        return False
    state_name = report.get("state")
    if state_name == "interrupted":
        return _released_interrupted(Path(report["record"]))
    if state_name not in native().TERMINAL:
        # An output-selection repair does not keep an exited process in use.
        # Require its actual retained exit, not merely the absence of a PID.
        if (state_name != "finalization_pending" or
                type(report.get("exit_code")) is not int or not report.get("ended_at")):
            return False
    try:
        record = Path(report["record"])
        state = native().read_json(record / "state.json") or {}
        result = native().read_json(record / "result.json") or {}
        if state_name == "finalization_pending":
            from native_completion import observe
            request = native().read_json(record / "request.json")
            completion = observe(record, request) if request else None
            retained_exit = (completion or {}).get("outcome")
            if retained_exit is None:
                retained_exit = result if (type(result.get("exit_code")) is int and result.get("ended_at")) else None
            if (retained_exit is None or retained_exit["exit_code"] != report["exit_code"] or
                    retained_exit["ended_at"] != report["ended_at"]):
                return False
        # A failed supervisor can leave process.json before state.json recorded
        # that identity. All original identities still use native liveness.
        return not any(native().alive(identity) for identity in (
            state.get("supervisor"), state.get("process"), result.get("supervisor"),
            result.get("process"), native().read_json(record / "process.json")))
    except (OSError, ValueError, KeyError, TypeError):
        return False


def snapshot(record, report=None, *, view="full", paths=(), cursor=None, limit=100):
    """Read metadata only; safe to call from the original native inspect()."""
    record = Path(record).resolve()
    try:
        value = read_use(record)
    except (OSError, ValueError, KeyError) as exc:
        return {"schema": SCHEMA, "record": str(record), "state": "record_unavailable",
                "error": type(exc).__name__}
    if value is None:
        return None
    result = {**value, "report": str(record / RECORD_FILE),
              "registration": registration_status(value)}
    if report is not None:
        result.update(state="complete" if finished(report) else "in_use", native_state=report["state"])
    if view != "full" or paths or cursor is not None:
        from runtime_catalog import project
        return project(value, observed=result, view=view, paths=paths, cursor=cursor, limit=limit)
    return result


def release(record):
    record = Path(record).resolve(strict=True)
    request = request_at(record)
    previous = read_use(record)
    if previous is None:
        return {"schema": SCHEMA, "record": str(record), "released": False, "state": "unregistered"}
    record = Path(previous["record"])
    registry = registry_path(previous["registry_root"])
    with registry_lock(registry):
        report = native().inspect(record)
        if not finished(report):
            return {**snapshot(record, report), "released": False}
        request = request_at(record, request)
        original = read_use(record)
        previous = reconcile_capacity_amendments(original, request)
        if previous["intent_sha256"] != original["intent_sha256"]:
            previous = {**previous, "revision": previous["revision"] + 1, "observed_at": native().now()}
        if not previous.get("released_at"):
            previous = {**previous, "released_at": native().now()}
            native().save_json(record / RECORD_FILE, previous)
        pointer_path(registry, record).unlink(missing_ok=True)
        fd = os.open(registry, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    return {**snapshot(record, report), "released": True}


def overlaps(selected, declared):
    selected, path = Path(selected), Path(declared["path"])
    # Compare lexical components once, rather than constructing every ancestor
    # for each file in a large cache plan. Keep distinct filesystem anchors and
    # component boundaries; resolving symlinks belongs to the caller.
    if selected.anchor != path.anchor:
        return False
    selected_parts, path_parts = selected.parts, path.parts
    return (path_parts[:len(selected_parts)] == selected_parts
            or (declared.get("kind") == "directory"
                and selected_parts[:len(path_parts)] == path_parts))


def _matching_paths(selected, keys, rows):
    """Match original lexical/resolved paths and complete directory ancestry."""
    aliases = {lexical_path(selected), lexical_path(selected).resolve()}
    matched = {}

    def add(index, path):
        matched.setdefault(index, set()).add(path)

    for alias in aliases:
        parts = alias.parts
        offset = bisect_left(keys, parts)
        while offset < len(keys):
            key = keys[offset]
            if key[:len(parts)] != parts:
                break
            for index, path, _ in rows[key]:
                add(index, path)
            offset += 1
        for length in range(1, len(parts)):
            for index, path, directory in rows.get(parts[:length], ()):
                if directory:
                    add(index, path)
    return matched


def _custody_declarations(paths):
    """Observe explicit retained roots without walking or reading their contents."""
    if not isinstance(paths, (list, tuple, set)) or len(paths) > MAX_LINKS:
        raise RuntimeUseError("Supply at most 4096 explicit retained custody paths")
    observed = {}
    for selected in paths:
        alias = lexical_path(selected)
        resolved = alias.resolve(strict=True)
        info = resolved.stat()
        if not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
            raise RuntimeUseError("Retained custody must be a regular file or directory: " + str(alias))
        kind = "directory" if stat.S_ISDIR(info.st_mode) else "file"
        for path in (alias, resolved):
            observed[str(path)] = {"path": str(path), "kind": kind}
    return [observed[path] for path in sorted(observed)]


def _validate_custody_pointer(pointer, path):
    if (not isinstance(pointer.get("custody_paths"), list)
            or not isinstance(pointer.get("plan_id"), str)
            or len(pointer["plan_id"]) != 64
            or any(c not in "0123456789abcdef" for c in pointer["plan_id"])
            or path.name != pointer["plan_id"] + ".json"
            or not isinstance(pointer.get("operation_id"), str) or not pointer["operation_id"]
            or not isinstance(pointer.get("plan"), str)
            or str(lexical_path(pointer["plan"])) != pointer["plan"]
            or not isinstance(pointer.get("cache_root"), str)
            or str(lexical_path(pointer["cache_root"])) != pointer["cache_root"]):
        raise RuntimeUseError("Malformed retained custody pointer: " + str(path))
    if "library_backings" in pointer:
        _validate_library_backing_pointers(pointer["library_backings"])
    seen = set()
    for row in pointer["custody_paths"]:
        if (not isinstance(row, dict) or row.get("kind") not in {"file", "directory"}
                or not isinstance(row.get("path"), str)
                or str(lexical_path(row["path"])) != row["path"]
                or row["path"] in seen):
            raise RuntimeUseError("Malformed retained custody path: " + str(path))
        seen.add(row["path"])



def _validate_library_backing_pointers(values):
    if not isinstance(values, dict) or len(values) > MAX_LINKS:
        raise RuntimeUseError("Malformed retained Library backing pointers")
    for original, value in values.items():
        if (not isinstance(original, str) or str(lexical_path(original)) != original
                or not isinstance(value, dict)
                or set(value) != {"request_path", "request_sha256", "binding_sha256"}
                or not isinstance(value.get("request_path"), str)
                or str(lexical_path(value["request_path"])) != value["request_path"]):
            raise RuntimeUseError("Malformed retained Library backing identity")
        for name in ("request_sha256", "binding_sha256"):
            digest = value.get(name)
            if (not isinstance(digest, str) or len(digest) != 64
                    or any(c not in "0123456789abcdef" for c in digest)):
                raise RuntimeUseError("Malformed retained Library backing digest")


def _library_request_lock(directory, fd):
    """Require the same real request lock before taking the original registry."""
    actual = os.fstat(fd)
    expected = (Path(directory) / ".lock").lstat()
    if (not stat.S_ISREG(actual.st_mode) or actual.st_nlink != 1
            or (actual.st_dev, actual.st_ino) != (expected.st_dev, expected.st_ino)):
        raise RuntimeUseError("Keep the original Library request lock throughout cutover")
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError as exc:
        raise RuntimeUseError("The original Library materialization is still in use") from exc


class RetirementGuard:
    """Serialize exact path retirement with registration; reuse unchanged reads.

    A held mutation observes record identities and matching native jobs afresh.
    inspect_many() is a read-only observation of several paths under one lock;
    its returned reports are never used as a later retirement lease.
    """
    def __init__(self, registry_root=None):
        self.root = registry_path(registry_root)
        self.version = None
        self.pointers = []
        self._records = {}
        self._indexed = ()
        self._path_keys = []
        self._path_rows = {}
        self._custody_version = ()
        self._custody_pointers = []
        self._custody_keys = []
        self._custody_rows = {}

    def _read(self):
        info = self.root.stat()
        version = (info.st_mtime_ns, info.st_ctime_ns, info.st_ino)
        if version != self.version:
            rows = []
            for path in sorted(self.root.glob("*.json")):
                pointer = native().read_json(path)
                if (not isinstance(pointer, dict) or pointer.get("schema") != POINTER_SCHEMA
                        or not isinstance(pointer.get("paths"), list)
                        or path != pointer_path(self.root, Path(pointer.get("record", "")))):
                    raise RuntimeUseError("Malformed runtime consumer pointer: " + str(path))
                rows.append(pointer)
            self.pointers, self.version = rows, version
        return self.pointers

    @staticmethod
    def _file_version(path):
        info = path.stat()
        return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)

    def _record(self, pointer):
        record = Path(pointer["record"])
        previous = self._records.get(str(record))
        try:
            before = self._file_version(record / RECORD_FILE)
        except OSError:
            before = None
        if (before is not None and previous is not None
                and previous["error"] is None
                and previous["pointer"] is pointer and previous["version"] == before):
            return previous

        paths = {row["path"]: row for row in pointer["paths"]}
        error = None
        # Registration writes its original record before its shared pointer.
        # Inspect the original file identity even when the pointer is unchanged.
        try:
            current = read_use(record)
            if current is None or current.get("intent_sha256") != pointer["intent_sha256"]:
                raise RuntimeUseError("Original runtime-use binding is unavailable")
            paths.update({row["path"]: row for row in current["paths"]})
        except (OSError, ValueError, KeyError) as exc:
            error = type(exc).__name__
        try:
            after = self._file_version(record / RECORD_FILE)
        except OSError:
            after = None
        # A failed lookup is retried on every held operation. A file that changed
        # while it was read must also be read again, rather than cached as newer.
        version = after if before is not None and before == after else None
        rows = tuple(paths[path] for path in sorted(paths))
        if (previous is not None and previous["pointer"] is pointer
                and previous["version"] == version and previous["error"] == error
                and previous["paths"] == rows):
            return previous
        value = {"pointer": pointer, "version": version, "paths": rows, "error": error}
        self._records[str(record)] = value
        return value

    def _load(self):
        records = [self._record(pointer) for pointer in self._read()]
        retained = {row["pointer"]["record"] for row in records}
        self._records = {key: value for key, value in self._records.items() if key in retained}
        # Only rebuild the lexical lookup when an actual source observation
        # changes. Native state is intentionally absent from this cache.
        if (len(records) != len(self._indexed)
                or any(a is not b for a, b in zip(records, self._indexed))):
            rows = {}
            for index, value in enumerate(records):
                for row in value["paths"]:
                    key = Path(row["path"]).parts
                    rows.setdefault(key, []).append((index, row["path"], row.get("kind") == "directory"))
            self._path_keys, self._path_rows = sorted(rows), rows
            self._indexed = tuple(records)
        return records

    def _matching(self, selected):
        return _matching_paths(selected, self._path_keys, self._path_rows)

    def _load_custody(self):
        # Original save_json atomically replaces pointers under registry_lock.
        # Directory identity changes therefore refresh this compact path index;
        # blob counts and body sizes do not affect retirement lookup work.
        directory = self.root / "cache-plans"
        try:
            version = self._file_version(directory)
        except FileNotFoundError:
            version = None
        if version == self._custody_version:
            return
        pointers, rows = [], {}
        for path in sorted(directory.glob("*.json")):
            pointer = native().read_json(path)
            if not isinstance(pointer, dict):
                raise RuntimeUseError("Malformed original cache plan pointer: " + str(path))
            if "custody_paths" not in pointer:
                continue
            _validate_custody_pointer(pointer, path)
            index = len(pointers)
            for row in pointer["custody_paths"]:
                key = Path(row["path"]).parts
                rows.setdefault(key, []).append((index, row["path"], row["kind"] == "directory"))
            pointers.append(pointer)
        self._custody_pointers = pointers
        self._custody_keys, self._custody_rows = sorted(rows), rows
        self._custody_version = version

    def _custody_consumers(self, selected):
        self._load_custody()
        matched = _matching_paths(selected, self._custody_keys, self._custody_rows)
        result = []
        for index, paths in sorted(matched.items()):
            pointer = self._custody_pointers[index]
            result.append({"kind": "cache_custody", "state": "retained",
                           "record": pointer["plan"], "plan": pointer["plan"],
                           "plan_id": pointer["plan_id"],
                           "operation_id": pointer["operation_id"], "peer": "saved cache plan",
                           "paths": sorted(paths)})
        return result

    @staticmethod
    def _observe(value):
        pointer = value["pointer"]
        record = Path(pointer["record"])
        result = {"record": str(record), "operation_id": pointer["operation_id"],
                  "peer": pointer["peer"]}
        error = value["error"]
        try:
            request = request_at(record)
            if digest(request["intent"]) != pointer["intent_sha256"]:
                raise RuntimeUseError("Original native request no longer matches its pointer")
            report = native().inspect(record)
            result.update(native_state=report["state"], supervisor_alive=report["supervisor_alive"],
                          process_alive=report["process_alive"])
            if finished(report):
                return result, True
        except (OSError, ValueError, KeyError, TypeError) as exc:
            error = type(exc).__name__
        if error:
            result.update(native_state="record_unavailable", error=error)
        return result, False

    def _consumers(self, selected, records, observations):
        consumers, complete = self._custody_consumers(selected), []
        for index, matching in sorted(self._matching(selected).items()):
            if index not in observations:
                observations[index] = self._observe(records[index])
            value, is_complete = observations[index]
            result = {**value, "paths": sorted(matching)}
            (complete if is_complete else consumers).append(result)
        return {"schema": REPORT_SCHEMA, "path": str(lexical_path(selected)),
                "registry_root": str(self.root), "state": "in_use" if consumers else "unused",
                "consumers": consumers, "completed": complete}

    def inspect_many(self, selected):
        """Read many paths once; the result does not retain a mutation lock."""
        selected = list(selected)
        with registry_lock(self.root):
            started = native().now()
            records, observations = self._load(), {}
            reports = [self._consumers(path, records, observations) for path in selected]
            return {"registry_root": str(self.root), "started_at": started,
                    "finished_at": native().now(), "record_count": len(records),
                    "native_records_observed": len(observations),
                    "custody_plan_count": len(self._custody_pointers), "reports": reports}


    def resolve_plan(self, plan_path, plan=None):
        """Read the same original plan after its submitting directory closes."""
        from swarm_cloud_cache import load_plan
        selected = lexical_path(plan_path)
        with registry_lock(self.root):
            if plan is None:
                try:
                    plan = load_plan(selected)
                except FileNotFoundError:
                    matches = []
                    for file in sorted((self.root / "cache-plans").glob("*.json")):
                        pointer = native().read_json(file)
                        if not isinstance(pointer, dict):
                            raise RuntimeUseError("Malformed original cache plan pointer: " + str(file))
                        if str(selected) in (pointer.get("plan"), pointer.get("source_plan")):
                            matches.append(pointer)
                    if len(matches) != 1:
                        raise RuntimeUseError("Select the retained original cache plan path from its registry")
                    return _registered_plan(self.root, matches[0])
            retained = _retained_plan(self.root, plan["plan_id"], plan=plan)
            if retained is None:
                return selected, plan
            pointer = {"plan": str(selected), "plan_id": plan["plan_id"], "cache_root": plan["cache_root"]}
            path, saved = _registered_plan(self.root, pointer)
            if saved != plan:
                raise RuntimeUseError("Original and retained cache plans differ")
            return path, saved

    @contextmanager
    def metadata_journal(self, plan_path, plan):
        """Keep the original retained-plan writer out during completed compaction."""
        with _plan_writer(self.root, plan["plan_id"]):
            selected, saved = self.resolve_plan(plan_path, plan)
            if selected != lexical_path(plan_path) or saved != plan:
                raise RuntimeUseError("Original cache metadata moved before its writer was acquired")
            yield selected

    @contextmanager
    def plan_journal(self, plan_path, plan, *, custody_paths=None):
        """Keep one original writer on the retained plan and progress journal."""
        with _plan_writer(self.root, plan["plan_id"]):
            with registry_lock(self.root):
                retained = self._remember_plan(plan_path, plan, custody_paths=custody_paths)
            yield retained

    def remember_plan(self, plan_path, plan, *, custody_paths=None):
        """Retain a quiescent original plan and journal while inside hold()."""
        with _plan_writer(self.root, plan["plan_id"]):
            return self._remember_plan(plan_path, plan, custody_paths=custody_paths)

    def _remember_plan(self, plan_path, plan, *, custody_paths=None):
        """Remember the original plan and retained storage inside hold().

        The cache reader supplies its verified backing paths before publishing
        a successful Git plan or retiring source. These dependencies last for
        the saved restore plan, independently of any original command lifetime.
        Replays preserve every previously declared backing path.
        """
        pointer = self.root / "cache-plans" / (plan["plan_id"] + ".json")
        retained, verified, metadata = _retain_plan(self.root, plan_path, plan)
        value = {"plan": str(retained), "plan_id": plan["plan_id"],
                 "cache_root": plan["cache_root"], "source_plan": metadata["source_plan"],
                 "plan_sha256": metadata["plan_sha256"], "plan_bytes": metadata["plan_bytes"]}
        if "external_journal" in plan:
            value["external_journal"] = plan["external_journal"]
        previous = native().read_json(pointer)
        if previous is not None:
            if (not isinstance(previous, dict) or previous.get("plan_id") != plan["plan_id"]
                    or previous.get("cache_root") != plan["cache_root"]):
                raise RuntimeUseError("Original cache plan pointer no longer matches its plan")
            if "library_backings" in previous:
                _validate_library_backing_pointers(previous["library_backings"])
                value["library_backings"] = previous["library_backings"]
            if "custody_paths" in previous:
                _validate_custody_pointer(previous, pointer)
                value["custody_paths"] = previous["custody_paths"]
                value["operation_id"] = previous["operation_id"]
                if previous["operation_id"] != plan.get("operation_id"):
                    raise RuntimeUseError("Retained custody operation differs from its original plan")
        custody_paths = [str(_plan_directory(self.root, plan["plan_id"])),
                         str(_retention_directory(self.root, plan["plan_id"], plan=plan)),
                         *(custody_paths or ())]
        if custody_paths is not None:
            paths = {row["path"]: row for row in value.get("custody_paths", [])}
            for row in _custody_declarations(custody_paths):
                if row["path"] in paths and paths[row["path"]]["kind"] != row["kind"]:
                    raise RuntimeUseError("Retained custody path changed type: " + row["path"])
                paths[row["path"]] = row
            operation_id = plan.get("operation_id")
            if not isinstance(operation_id, str) or not operation_id:
                raise RuntimeUseError("Retained custody requires the original plan operation ID")
            if "operation_id" in value and value["operation_id"] != operation_id:
                raise RuntimeUseError("Retained custody operation differs from its original plan")
            if paths:
                value.update(operation_id=operation_id,
                             custody_paths=[paths[path] for path in sorted(paths)])
        if previous != value:
            native().save_json(pointer, value)
            self._custody_version = ()
        return retained


    def bind_library_backing(self, plan_path, plan, binding, *, request_lock_fd):
        """Publish a validated external binding inside the original plan writer."""
        from native_library_backing import registered_binding
        directory, request, saved = registered_binding(binding, plan)
        _library_request_lock(directory, request_lock_fd)
        with registry_lock(self.root):
            path = self.root / "cache-plans" / (plan["plan_id"] + ".json")
            pointer = native().read_json(path)
            if not isinstance(pointer, dict):
                raise RuntimeUseError("Retain the original plan before binding its Library source")
            _validate_custody_pointer(pointer, path)
            retained, original = _registered_plan(self.root, pointer)
            if original != plan or retained != lexical_path(plan_path):
                raise RuntimeUseError("The original plan changed before external binding")
            previous = dict(pointer.get("library_backings", {}))
            _validate_library_backing_pointers(previous)
            source = saved["original_archive_path"]
            if source in previous and previous[source] != binding:
                raise RuntimeUseError("The original archive already has another immutable Library binding")
            previous[source] = binding
            if pointer.get("library_backings") != previous:
                native().save_json(path, {**pointer, "library_backings": previous})
                self._custody_version = ()
            return binding

    @contextmanager
    def hold_library_backing(self, selected, *, plan_id, binding, request_lock_fd,
                             additional_plan_ids=()):
        """Hold all original sharing plans while their one saved archive moves.

        Only the exact request-bound custody plans are excluded. Every other
        application, transfer or source consumer remains in the report.
        """
        from native_library_backing import registered_binding
        from native_library_custody import plan_bindings
        selected = lexical_path(selected)
        plan_ids = [plan_id, *additional_plan_ids]
        if len(set(plan_ids)) != len(plan_ids):
            raise RuntimeUseError("Keep each original sharing plan once")
        with registry_lock(self.root):
            saved_request = None
            for current_id in plan_ids:
                path = self.root / "cache-plans" / (current_id + ".json")
                pointer = native().read_json(path)
                if not isinstance(pointer, dict):
                    raise RuntimeUseError("The original custody pointer is unavailable")
                _validate_custody_pointer(pointer, path)
                _, plan = _registered_plan(self.root, pointer)
                directory, request, saved = registered_binding(binding, plan)
                _library_request_lock(directory, request_lock_fd)
                original = saved["original_archive_path"]
                if (pointer.get("library_backings", {}).get(original) != binding
                        or str(selected) not in {original, saved["cache_path"]}):
                    raise RuntimeUseError("Select this original binding's archive or hydrated cache")
                if saved_request is not None and saved_request != request:
                    raise RuntimeUseError("Sharing plans must retain the same Library request")
                saved_request = request
            if set(plan_ids) != {row["plan_id"] for row in plan_bindings(saved_request)}:
                raise RuntimeUseError("Hold the complete immutable sharing-plan selection")
            report = self._consumers(selected, self._load(), {})
            own, others = [], []
            for row in report["consumers"]:
                (own if row.get("kind") == "cache_custody" and row.get("plan_id") in plan_ids
                 else others).append(row)
            report.update(consumers=others, state="in_use" if others else "unused",
                          original_binding_custody=own, library_binding=binding)
            yield report


    @contextmanager
    def hold(self, selected):
        # A mutation never consumes a batch report. Each acquisition observes
        # source identities and matching native liveness under the original lock.
        with registry_lock(self.root):
            yield self._consumers(selected, self._load(), {})


def consumers(path, *, registry_root=None):
    with RetirementGuard(registry_root).hold(path) as report:
        return report


def runtime_options(parser):
    parser.add_argument("--runtime-path", action="append", default=[],
                        help=f"existing shared runtime file or directory; repeat for up to {MAX_RUNTIME_PATHS} SDK/browser/PHP paths")
    parser.add_argument("--runtime-consumers-root",
                        help="same shared consumer index used by this VM's cache operator")


def main(argv=None):
    import argparse
    parser = argparse.ArgumentParser(description="Release the original interrupted native runtime lifetime")
    commands = parser.add_subparsers(dest="command", required=True)
    inspect_command = commands.add_parser("inspect-release", help="inspect the original process-ended selection")
    inspect_command.add_argument("record")
    release_command = commands.add_parser("release-interrupted", help="release the selected ended lifetime")
    release_command.add_argument("record")
    release_command.add_argument("--expected-selection-sha256", required=True)
    release_command.add_argument("--reason", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "inspect-release":
            value = inspect_interrupted(args.record)
        else:
            value = release_interrupted(args.record,
                expected_selection_sha256=args.expected_selection_sha256, reason=args.reason)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        parser.exit(2, str(exc) + "\n")
    print(json.dumps(value, ensure_ascii=False, sort_keys=True))
    return 0 if value.get("eligible") or value.get("state") == "released" else 1


if __name__ == "__main__":
    raise SystemExit(main())
