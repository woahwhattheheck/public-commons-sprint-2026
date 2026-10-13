"""Save closed phase outputs inside the original, still-running native record.

The producing command calls capture explicitly. Its command outcome remains
owned by the native supervisor; a checkpoint records only the selected files.
"""
from __future__ import annotations

from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat

if __package__:
    from . import native_artifact_retention as copies
else:
    import native_artifact_retention as copies

SCHEMA = "commons.native-artifact-checkpoint/v1"
DIRECTORY = "checkpoints"
OBJECTS = "checkpoint-files"
MANIFEST = "checkpoint.json"
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$")
SHA = re.compile(r"^[0-9a-f]{64}$")
MAX_MANIFEST = 16 * 1024 * 1024


def _native():
    if __package__:
        from . import swarm_cloud_job
    else:
        import swarm_cloud_job
    return swarm_cloud_job


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                    ensure_ascii=False).encode("utf-8")).hexdigest()


def _key(checkpoint_id):
    if not isinstance(checkpoint_id, str) or not IDENTIFIER.fullmatch(checkpoint_id):
        raise ValueError("Use a stable checkpoint ID of 1 to 160 letters, digits, dots, colons, hyphens or underscores")
    return hashlib.sha256(checkpoint_id.encode("utf-8")).hexdigest()


def _object_id(item):
    return _digest({"sha256": item["sha256"], "bytes": item["bytes"],
                    "executable": bool(item["mode"] & 0o111)})


def _target(item):
    return OBJECTS + "/" + _object_id(item) + "/files/data"


def _paths(paths):
    if not isinstance(paths, list) or not paths:
        raise ValueError("Select the closed files or output directories for this checkpoint")
    result = []
    for value in paths:
        if not isinstance(value, str) or not value or "\0" in value or "\\" in value:
            raise ValueError("Checkpoint outputs must be explicit project-relative paths")
        path = PurePosixPath(value)
        if path.is_absolute() or path == PurePosixPath(".") or ".." in path.parts or path.as_posix() != value:
            raise ValueError("Checkpoint outputs must stay beneath the original project")
        result.append(value)
    return sorted(set(result))


def _request(root):
    native = _native()
    root = Path(root).resolve(strict=True)
    request = native.read_json(root / "request.json")
    if (not isinstance(request, dict) or request.get("schema") != native.SCHEMA or
            native.run_path(request["intent"]["operation_id"], root.parent) != root):
        raise ValueError("Select the original native command record")
    return root, request


def _read(root, key):
    try:
        descriptor = copies.open_snapshot_file(root, DIRECTORY + "/" + key + "/" + MANIFEST)
    except FileNotFoundError:
        return None
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or before.st_size > MAX_MANIFEST:
            raise ValueError("The checkpoint manifest is not a bounded regular file")
        remaining, blocks = before.st_size, []
        while remaining:
            block = os.read(descriptor, min(remaining, 256 * 1024))
            if not block:
                raise ValueError("The checkpoint manifest ended while it was being read")
            blocks.append(block)
            remaining -= len(block)
        after = os.fstat(descriptor)
        identity = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)
        if os.read(descriptor, 1) or identity(before) != identity(after):
            raise ValueError("The checkpoint manifest changed during its read")
        return json.loads(b"".join(blocks))
    finally:
        os.close(descriptor)


def _save(root, key, value):
    if len((json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")) > MAX_MANIFEST:
        raise ValueError("The checkpoint inventory exceeds the original 16 MiB manifest limit")
    _native().save_json(root / DIRECTORY / key / MANIFEST, value)


@contextmanager
def _directory_lock(root, parts, *, create):
    descriptor = copies.open_snapshot_directory(root, parts, create=create)
    lock = None
    try:
        lock = os.open(".lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600, dir_fd=descriptor)
        if not stat.S_ISREG(os.fstat(lock).st_mode):
            raise ValueError("The checkpoint lock must remain a regular file")
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield
    finally:
        if lock is not None:
            os.close(lock)
        os.close(descriptor)


def _lock(root, key, *, create):
    return _directory_lock(root, (DIRECTORY, key), create=create)


def _copy_active(root, key):
    """Observe an actual writer without acquiring its exclusive copy lock."""
    try:
        descriptor = copies.open_snapshot_directory(root, (DIRECTORY, key))
    except FileNotFoundError:
        return False
    lock = None
    try:
        try:
            lock = os.open(".lock", os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=descriptor)
        except FileNotFoundError:
            return False
        if not stat.S_ISREG(os.fstat(lock).st_mode):
            raise ValueError("The checkpoint lock must remain a regular file")
        try:
            fcntl.flock(lock, fcntl.LOCK_SH | fcntl.LOCK_NB)
        except BlockingIOError:
            return True
        return False
    finally:
        if lock is not None:
            os.close(lock)
        os.close(descriptor)


def _descendant(process):
    """Follow this caller's actual visible procfs ancestry, including nested PIDs."""
    native = _native()
    caller = native.process_identity(os.getpid())
    if not caller or not isinstance(process, dict) or not native.alive(process):
        raise ValueError("A running original command must produce the checkpoint")
    current, seen = caller, set()
    for _ in range(256):
        if native._same_process(current, process):
            return caller
        proc_pid = current["proc_pid"]
        if proc_pid in seen:
            break
        seen.add(proc_pid)
        try:
            raw = (Path("/proc") / str(proc_pid) / "stat").read_text()
            fields = raw[raw.rfind(")") + 2:].split()
            parent = int(fields[1])
        except (OSError, ValueError, IndexError):
            break
        if parent <= 0:
            break
        current = native.identity_at(Path("/proc") / str(parent))
        if not current:
            break
    raise ValueError("Create the checkpoint from the original command or one of its child processes")


def _producer(root, request):
    native = _native()
    process = native.read_json(root / "process.json")
    caller = _descendant(process)
    if __package__:
        from .native_completion import observe
    else:
        from native_completion import observe
    completion = observe(root, request)
    result = native.read_json(root / "result.json")
    if completion and completion.get("outcome") or result and result.get("ended_at"):
        raise ValueError("The original command has already retained its outcome")
    if native.read_json(root / "stop-request.json"):
        raise ValueError("The original command has received a stop request")
    project = Path(request["intent"]["project"])
    descriptor = copies.open_snapshot_directory(project)
    try:
        info = os.fstat(descriptor)
    finally:
        os.close(descriptor)
    return process, caller, {"device": info.st_dev, "inode": info.st_ino}


def _snapshot(value):
    return _digest({key: value[key] for key in (
        "schema", "binding", "checkpoint_id", "label", "created_at", "source_process",
        "producer", "project_identity", "selection", "collected_at")} |
        {"files": copies.snapshot_items(value["files"])})


def _validate(value, request, checkpoint_id):
    if (not isinstance(value, dict) or value.get("schema") != SCHEMA or
            value.get("checkpoint_id") != checkpoint_id or
            value.get("binding") != copies.snapshot_binding(request) or
            value.get("state") not in ("collecting", "incomplete", "complete")):
        raise ValueError("The checkpoint differs from its original command or phase")
    if (not isinstance(value.get("label"), str) or not 1 <= len(value["label"]) <= 240 or
            not isinstance(value.get("errors"), list) or
            type(value.get("attempts")) is not int or value["attempts"] < 0):
        raise ValueError("The checkpoint journal is invalid")
    selection = value.get("selection") or {}
    if set(selection) != {"paths"} or _paths(selection["paths"]) != selection["paths"]:
        raise ValueError("The checkpoint selection changed")
    items = copies.snapshot_items(value.get("files"))
    snapshot = value.get("snapshot")
    if snapshot is None:
        if value["state"] == "complete" or value.get("collection_complete") or items:
            raise ValueError("The checkpoint has no frozen file inventory")
    else:
        if (not isinstance(snapshot, str) or not SHA.fullmatch(snapshot) or
                not value.get("collection_complete") or snapshot != _snapshot(value)):
            raise ValueError("The frozen checkpoint inventory changed")
        for row in value["files"]:
            target = _target(row)
            if row.get("retained_path") != target or type(row.get("retained")) is not bool:
                raise ValueError("The checkpoint file location changed")
    if value["state"] == "complete" and (
            value["errors"] or not all(row["retained"] for row in value["files"]) or
            not value.get("completed_at")):
        raise ValueError("The completed checkpoint declaration is incomplete")
    return value


def _summary(value):
    files = value["files"]
    retained = [row for row in files if row.get("retained")]
    return {key: value.get(key) for key in (
        "checkpoint_id", "label", "created_at", "updated_at", "completed_at",
        "state", "snapshot", "collection_complete", "attempts", "errors")} | {
        "files": len(files), "bytes": sum(row["bytes"] for row in files),
        "retained_files": len(retained), "retained_bytes": sum(row["bytes"] for row in retained)}


def _directories(root):
    try:
        descriptor = copies.open_snapshot_directory(root, (DIRECTORY,))
    except FileNotFoundError:
        return []
    try:
        result = []
        with os.scandir(descriptor) as entries:
            for entry in entries:
                if not SHA.fullmatch(entry.name) or not entry.is_dir(follow_symlinks=False):
                    continue
                try:
                    saved = os.stat(entry.name + "/" + MANIFEST, dir_fd=descriptor, follow_symlinks=False)
                except FileNotFoundError:
                    continue
                if stat.S_ISREG(saved.st_mode):
                    result.append((entry.name, saved.st_mtime_ns))
        return result
    finally:
        os.close(descriptor)


def view(root, request=None):
    if request is None:
        root, request = _request(root)
    return {"schema": SCHEMA, "count": len(_directories(root)),
            "directory": str(Path(root) / DIRECTORY)}


def listing(root, *, offset=0, limit=25):
    root, request = _request(root)
    if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 100:
        raise ValueError("Use a nonnegative checkpoint offset and a page size from 1 to 100")
    selected = sorted(_directories(root), key=lambda row: (row[1], row[0]), reverse=True)
    items = []
    for key, _ in selected[offset:offset + limit]:
        value = _read(root, key)
        if value is None:
            continue
        if _key(value.get("checkpoint_id")) != key:
            raise ValueError("The checkpoint directory differs from its phase identity")
        items.append(_summary(_validate(value, request, value["checkpoint_id"])) |
                     {"copy_active": _copy_active(root, key)})
    return {"schema": SCHEMA, "operation_id": request["intent"]["operation_id"],
            "items": items, "total": len(selected), "offset": offset, "limit": limit}


def detail(root, checkpoint_id):
    root, request = _request(root)
    value = _read(root, _key(checkpoint_id))
    if value is None:
        raise ValueError("This original command has no saved checkpoint with that ID")
    return {**_validate(value, request, checkpoint_id),
            "copy_active": _copy_active(root, _key(checkpoint_id))}


def _copy(root, request, key, value, *, allow_source):
    native = _native()
    value["state"] = "incomplete"
    value["attempts"] += 1
    value["updated_at"] = native.now()
    value["errors"] = []
    _save(root, key, value)
    project = Path(request["intent"]["project"])
    for item in value["files"]:
        try:
            # Checkpoints share immutable bytes only inside this original record.
            # The per-object lock serializes its original verified staging copy.
            with _directory_lock(root, (OBJECTS, _object_id(item)), create=True):
                copies.copy_snapshot_file(root, project, item["retained_path"], item, allow_source=allow_source)
            item["retained"] = True
        except (OSError, ValueError) as exc:
            item["retained"] = False
            value["errors"].append({"path": item["path"], "stage": "copy",
                "error": str(exc), "error_type": type(exc).__name__,
                **({"errno": exc.errno} if isinstance(exc, OSError) else {})})
    value["updated_at"] = native.now()
    if not value["errors"]:
        value["state"] = "complete"
        value["completed_at"] = value.get("completed_at") or value["updated_at"]
    _save(root, key, value)
    return value


def capture(root, checkpoint_id, paths, *, label=None):
    """Called synchronously by the original producer after closing phase outputs."""
    native = _native()
    root, request = _request(root)
    key, paths = _key(checkpoint_id), _paths(paths)
    label = checkpoint_id if label is None else label
    if not isinstance(label, str) or not label.strip() or len(label) > 240:
        raise ValueError("Use a checkpoint label of 1 to 240 characters")
    process, caller, project_identity = _producer(root, request)
    project = Path(request["intent"]["project"])
    for selected in native.artifact_paths(project, paths):
        target = (project / selected).resolve()
        if root == target or root.is_relative_to(target):
            raise ValueError("Keep the original native record outside the checkpoint's output selection")
    # Acquire only this checkpoint's copy lock before the brief native lock.
    # Neither collection nor file copying holds the lock used by native stop.
    with _lock(root, key, create=True):
        with native.run_lock(root):
            root, current = _request(root)
            if copies.snapshot_binding(current) != copies.snapshot_binding(request):
                raise ValueError("The original command changed before the checkpoint was recorded")
            process, caller, project_identity = _producer(root, current)
            value = _read(root, key)
            if value is not None:
                _validate(value, current, checkpoint_id)
                if value["label"] != label or value["selection"]["paths"] != paths:
                    raise ValueError("A checkpoint ID must retain its original label and selected paths")
                if (value["source_process"] != process or value["project_identity"] != project_identity):
                    raise ValueError("This checkpoint belongs to another original source process")
                if value["state"] == "complete":
                    return value
            else:
                value = {"schema": SCHEMA, "binding": copies.snapshot_binding(current),
                    "checkpoint_id": checkpoint_id, "label": label, "selection": {"paths": paths},
                    "source_process": process, "producer": caller, "project_identity": project_identity,
                    "created_at": native.now(), "updated_at": native.now(), "state": "collecting",
                    "collection_complete": False, "snapshot": None, "files": [], "errors": [], "attempts": 0}
                _save(root, key, value)
            request = current
        if value["snapshot"] is None:
            project = Path(request["intent"]["project"])
            normalized = native.artifact_paths(project, paths)
            for selected in normalized:
                target = (project / selected).resolve()
                if root == target or root.is_relative_to(target):
                    raise ValueError("Keep the original native record outside the checkpoint's output selection")
            collected = native.collect_artifacts(project, normalized)
            if collected["errors"]:
                value.update(state="incomplete", updated_at=native.now(),
                             errors=[{**row, "stage": "inventory"} for row in collected["errors"]])
                _save(root, key, value)
                return value
            descriptor = copies.open_snapshot_directory(project)
            try:
                info = os.fstat(descriptor)
                if {"device": info.st_dev, "inode": info.st_ino} != value["project_identity"]:
                    raise ValueError("The original project directory changed during collection")
            finally:
                os.close(descriptor)
            value["files"] = copies.snapshot_items(collected["files"])
            value["collected_at"] = collected["observed_at"]
            value["collection_complete"] = True
            value["snapshot"] = _snapshot(value)
            value["errors"] = []
            for item in value["files"]:
                item.update(retained=False, retained_path=_target(item))
            # This immutable inventory is committed before the first copy.
            _save(root, key, value)
        return _copy(root, request, key, value, allow_source=True)


def recover(root, checkpoint_id, *, expected_snapshot):
    """Finish already-saved copies without reading a later shell's source paths."""
    native = _native()
    root, request = _request(root)
    key = _key(checkpoint_id)
    if not isinstance(expected_snapshot, str) or not SHA.fullmatch(expected_snapshot):
        raise ValueError("Select the saved checkpoint's exact snapshot SHA-256")
    with _lock(root, key, create=False):
        with native.run_lock(root):
            root, request = _request(root)
            value = _read(root, key)
            if value is None:
                raise ValueError("This original command has no saved checkpoint with that ID")
            _validate(value, request, checkpoint_id)
            if value["snapshot"] != expected_snapshot:
                raise ValueError("The selected checkpoint snapshot changed")
            if value["state"] == "complete":
                return value
        return _copy(root, request, key, value, allow_source=False)


def open_file(root, checkpoint_id, path, *, expected_snapshot):
    root, request = _request(root)
    value = _read(root, _key(checkpoint_id))
    if value is None:
        raise ValueError("This original command has no saved checkpoint with that ID")
    _validate(value, request, checkpoint_id)
    if value["state"] != "complete" or value["snapshot"] != expected_snapshot:
        raise ValueError("Select the completed checkpoint's exact snapshot before downloading")
    selected = [row for row in value["files"] if row["path"] == path]
    if len(selected) != 1:
        raise ValueError("Select one original file from this completed checkpoint")
    item = selected[0]
    return copies.open_snapshot_file(root, item["retained_path"]), {
        **item, "checkpoint_id": checkpoint_id, "checkpoint_snapshot": value["snapshot"]}


def environment(root, request):
    """Original _execute supplies these paths before exec preserves its identity."""
    return {"SWARM_NATIVE_RECORD": str(Path(root).resolve()),
            "SWARM_NATIVE_OPERATION_ID": request["intent"]["operation_id"],
            "SWARM_NATIVE_HOST_ROOT": str(Path(_native().__file__).resolve().parent)}


def selection_paths(paths):
    """Normalize the original explicit closed-output selection for consumers."""
    return _paths(paths)


def producer_context(root):
    """Use the original live-producer guard before a consumer prepares outputs."""
    root, request = _request(root)
    process, caller, project_identity = _producer(root, request)
    return {"root": root, "request": request, "source_process": process,
            "producer": caller, "project_identity": project_identity}
