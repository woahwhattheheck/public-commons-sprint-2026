"""Retain selected native output bytes inside the original command record.

The supervisor owns copying after its actual child exit. The original finalizer
can finish an interrupted copy using that same manifest and retained exit.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat

SCHEMA = "commons.native-artifact-retention/v1"
FILENAME = "artifact-retention.json"
DIRECTORY = "retained-artifacts"
SHA = re.compile(r"^[0-9a-f]{64}$")
BLOCK = 256 * 1024


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
    intent = request["intent"]
    # Capacity amendments change estimates before dispatch. They do not change
    # this original command, project, operation or creation time.
    return {"operation_id": intent["operation_id"], "created_at": request["created_at"],
            "project": intent["project"], "command_sha256": _digest(intent["command"])}


def enabled(root, request):
    declared = request["intent"].get("retain_artifacts", False)
    if type(declared) is not bool:
        raise ValueError("The original artifact retention declaration is invalid")
    value = _native().read_json(Path(root) / FILENAME)
    if value is not None and (value.get("schema") != SCHEMA or
                              value.get("binding") != _binding(request) or
                              value.get("enabled") is not True):
        raise ValueError("Artifact retention differs from its original command")
    return declared or value is not None


def enable(root, request):
    """Explicit completed-command opt-in; the caller holds the native run lock."""
    if not enabled(root, request):
        _native().save_json(Path(root) / FILENAME, {
            "schema": SCHEMA, "binding": _binding(request), "enabled": True,
            "enabled_at": _native().now()})
    return view(root, request)


def view(root, request):
    return {"schema": SCHEMA, "enabled": enabled(root, request),
            "directory": str(Path(root) / DIRECTORY),
            "configuration": str(Path(root) / FILENAME) if (Path(root) / FILENAME).exists() else None}


def _parts(value):
    if not isinstance(value, str) or not value or "\0" in value:
        raise ValueError("Retained output paths must be explicit relative paths")
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or path == PurePosixPath(".") or path.as_posix() != value:
        raise ValueError("Retained output path leaves its original record")
    return path.parts


def _items(value):
    if not isinstance(value, list):
        raise ValueError("The original output inventory is invalid")
    result, seen = [], set()
    for row in value:
        if (not isinstance(row, dict) or type(row.get("bytes")) is not int or row["bytes"] < 0
                or not isinstance(row.get("sha256"), str) or not SHA.fullmatch(row["sha256"])):
            raise ValueError("The original output inventory lacks exact byte counts and hashes")
        _parts(row.get("path"))
        if row["path"] in seen:
            raise ValueError("The original output inventory repeats a file")
        seen.add(row["path"])
        item = {key: row[key] for key in ("path", "bytes", "sha256")}
        if "mode" in row:
            if type(row["mode"]) is not int or not 0 <= row["mode"] <= 0o777:
                raise ValueError("The retained output mode is invalid")
            item["mode"] = row["mode"]
        result.append(item)
    return result


def _selection(value):
    return {key: value.get(key) for key in ("revision", "selection", "outcome", "paths")}


def _snapshot(request, outcome_sha256, selection, files):
    return _digest({"binding": _binding(request), "outcome_sha256": outcome_sha256,
                    "selection": _selection(selection), "files": _items(files)})


def _directory(root, parts=(), *, create=False):
    # A verified alias is allowed for the original root. Every descendant is
    # opened relative to its parent descriptor without following links.
    descriptor = os.open(Path(root).resolve(strict=True), os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in parts:
            if create:
                try:
                    os.mkdir(part, mode=0o700, dir_fd=descriptor)
                    os.fsync(descriptor)
                except FileExistsError:
                    pass
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def _open(root, path):
    parts = _parts(path)
    descriptor = _directory(root, parts[:-1])
    try:
        return os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=descriptor)
    finally:
        os.close(descriptor)


def _identity(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def _check(descriptor, item):
    before = os.fstat(descriptor)
    if not stat.S_ISREG(before.st_mode) or before.st_size != item["bytes"]:
        raise ValueError("Retained output differs from its original byte count")
    digest, size = hashlib.sha256(), 0
    os.lseek(descriptor, 0, os.SEEK_SET)
    while True:
        block = os.read(descriptor, min(BLOCK, item["bytes"] - size + 1))
        if not block:
            break
        digest.update(block)
        size += len(block)
        if size > item["bytes"]:
            raise ValueError("Retained output grew beyond its original byte count")
    if (_identity(os.fstat(descriptor)) != _identity(before) or size != item["bytes"]
            or digest.hexdigest() != item["sha256"]):
        raise ValueError("Retained output differs from its original bytes")
    os.lseek(descriptor, 0, os.SEEK_SET)


def _existing(parent, name, item):
    try:
        descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    except FileNotFoundError:
        return False
    try:
        _check(descriptor, item)
        return True
    finally:
        os.close(descriptor)


def _install(root, project, target, item, *, allow_source=True):
    parts = _parts(target)
    parent = _directory(root, parts[:-1], create=True)
    staging = None
    partial = hashlib.sha256(item["path"].encode("utf-8")).hexdigest() + ".partial"
    try:
        if _existing(parent, parts[-1], item):
            return
        staging = _directory(root, parts[:2] + ("pending",), create=True)
        try:
            prepared = _existing(staging, partial, item)
        except ValueError:
            prepared = False
        if not prepared:
            if not allow_source:
                raise FileNotFoundError("The original producer did not finish saving this file")
            source = _open(project, item["path"])
            destination = None
            try:
                before = os.fstat(source)
                if not stat.S_ISREG(before.st_mode) or before.st_size != item["bytes"]:
                    raise ValueError("Selected output changed before retention")
                destination = os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW | os.O_NONBLOCK,
                                      0o600, dir_fd=staging)
                if not stat.S_ISREG(os.fstat(destination).st_mode):
                    raise ValueError("Artifact staging must be a regular file")
                digest, size = hashlib.sha256(), 0
                while True:
                    block = os.read(source, min(BLOCK, item["bytes"] - size + 1))
                    if not block:
                        break
                    digest.update(block)
                    size += len(block)
                    if size > item["bytes"]:
                        raise ValueError("Selected output grew beyond its original byte count")
                    written = 0
                    while written < len(block):
                        count = os.write(destination, block[written:])
                        if count <= 0:
                            raise OSError("Retained output write made no progress")
                        written += count
                if (_identity(os.fstat(source)) != _identity(before) or size != item["bytes"]
                        or digest.hexdigest() != item["sha256"]):
                    raise ValueError("Selected output changed while it was being retained")
                os.fchmod(destination, 0o600 | (0o100 if item.get("mode", before.st_mode) & 0o111 else 0))
                os.fsync(destination)
                os.fsync(staging)
            finally:
                os.close(source)
                if destination is not None:
                    os.close(destination)
        try:
            os.link(partial, parts[-1], src_dir_fd=staging, dst_dir_fd=parent, follow_symlinks=False)
        except FileExistsError:
            _existing(parent, parts[-1], item)
        os.fsync(parent)
        os.unlink(partial, dir_fd=staging)
        os.fsync(staging)
    finally:
        if staging is not None:
            os.close(staging)
        os.close(parent)


def _previous(root, request, outcome, selection):
    native = _native()
    previous = native.read_json(Path(root) / "artifacts.json")
    if not isinstance(previous, dict) or _selection(previous.get("artifact_selection") or {}) != _selection(selection):
        return None
    retention = previous.get("retention")
    if retention is not None:
        if (retention.get("schema") != SCHEMA or retention.get("binding") != _binding(request)
                or retention.get("outcome_sha256") != _digest(outcome)):
            raise ValueError("Retained outputs differ from the original command exit")
        if retention.get("snapshot") != _snapshot(request, retention["outcome_sha256"],
                                                    selection, previous.get("files")):
            raise ValueError("The retained output inventory changed")
        if retention.get("collection_complete"):
            _items(previous.get("files"))
            return previous
        if not Path(request["intent"]["project"]).exists():
            return previous
        return None
    # Enabling retention on a completed legacy record preserves its existing
    # original manifest instead of accepting subsequently modified outputs.
    result = native.read_json(Path(root) / "result.json") or {}
    if (result.get("exit_code") == outcome["exit_code"] and result.get("ended_at") == outcome["ended_at"]
            and not previous.get("errors")):
        _items(previous.get("files"))
        return previous
    return None


def retain(root, request, outcome, paths, selection):
    native = _native()
    previous = _previous(root, request, outcome, selection)
    collected = previous if previous is not None else native.collect_artifacts(
        Path(request["intent"]["project"]), paths)
    files = _items(collected["files"])
    for item in files:
        if "mode" not in item:
            try:
                descriptor = _open(Path(request["intent"]["project"]), item["path"])
                try:
                    info = os.fstat(descriptor)
                    if stat.S_ISREG(info.st_mode):
                        item["mode"] = stat.S_IMODE(info.st_mode) & 0o777
                finally:
                    os.close(descriptor)
            except OSError:
                pass  # A saved copy can still finish after its private source disappears.
    errors = [dict(error) for error in collected["errors"] if error.get("stage") != "retention"]
    outcome_sha256 = _digest(outcome)
    snapshot = _snapshot(request, outcome_sha256, selection, files)
    retention = {"schema": SCHEMA, "binding": _binding(request), "outcome_sha256": outcome_sha256,
                 "snapshot": snapshot, "collection_complete": not errors,
                 "state": "retaining", "files": 0, "bytes": 0}
    outputs = {"files": files, "errors": errors, "artifact_selection": selection,
               "observed_at": collected["observed_at"], "retention": retention}
    for item in files:
        item["retained_path"] = DIRECTORY + "/" + snapshot + "/files/" + item["path"]
        item["retained"] = False
    # Persist the exact inventory before copying. A reset after any complete
    # copy can recover from its content even when the private project is gone.
    native.save_json(Path(root) / "artifacts.json", outputs)
    for item in files:
        try:
            _install(root, Path(request["intent"]["project"]), item["retained_path"], item)
            item["retained"] = True
            retention["files"] += 1
            retention["bytes"] += item["bytes"]
        except (OSError, ValueError) as exc:
            outputs["errors"].append({"path": item["path"], "stage": "retention",
                                     "error": str(exc), "error_type": type(exc).__name__,
                                     **({"errno": exc.errno} if isinstance(exc, OSError) else {})})
    retention["state"] = "retained" if not outputs["errors"] else "pending"
    retention["updated_at"] = native.now()
    return outputs


def open_retained(root, request, manifest, item):
    retention = manifest.get("retention") or {}
    if (retention.get("schema") != SCHEMA or retention.get("binding") != _binding(request)
            or not isinstance(retention.get("outcome_sha256"), str)
            or not SHA.fullmatch(retention["outcome_sha256"])):
        raise ValueError("The retained artifact declaration differs from its original command")
    snapshot = _snapshot(request, retention["outcome_sha256"],
                         manifest.get("artifact_selection") or {}, manifest.get("files"))
    target = DIRECTORY + "/" + snapshot + "/files/" + item["path"]
    if retention.get("snapshot") != snapshot or item.get("retained_path") != target or item.get("retained") is not True:
        raise ValueError("The selected file has no completed retained copy")
    return _open(root, target)


def complete(root, request, manifest, outcome=None):
    if not enabled(root, request):
        return True
    if not isinstance(manifest, dict):
        return False
    retention = manifest.get("retention") or {}
    if (retention.get("schema") != SCHEMA or retention.get("binding") != _binding(request)
            or retention.get("state") != "retained" or manifest.get("errors")
            or not isinstance(retention.get("outcome_sha256"), str)
            or not SHA.fullmatch(retention["outcome_sha256"])):
        return False
    if outcome is not None and retention["outcome_sha256"] != _digest(outcome):
        return False
    try:
        files = _items(manifest.get("files"))
        if retention.get("snapshot") != _snapshot(request, retention["outcome_sha256"],
                                                    manifest.get("artifact_selection") or {}, files):
            return False
        if retention.get("files") != len(files) or retention.get("bytes") != sum(item["bytes"] for item in files):
            return False
        for item in manifest["files"]:
            descriptor = open_retained(root, request, manifest, item)
            try:
                info = os.fstat(descriptor)
                if not stat.S_ISREG(info.st_mode) or info.st_size != item["bytes"]:
                    return False
            finally:
                os.close(descriptor)
        return True
    except (OSError, ValueError, TypeError, KeyError):
        return False


def snapshot_binding(request):
    """Bind a saved file snapshot to the original command, independently of exit."""
    return _binding(request)


def snapshot_items(files):
    """Return the original normalized path, byte count, hash and mode inventory."""
    return _items(files)


def open_snapshot_directory(root, parts=(), *, create=False):
    return _directory(root, parts, create=create)


def open_snapshot_file(root, path):
    return _open(root, path)


def copy_snapshot_file(root, project, target, item, *, allow_source=True):
    """Use the original verified, resumable copy for one frozen inventory item."""
    selected = _items([item])[0]
    return _install(root, project, target, selected, allow_source=allow_source)
