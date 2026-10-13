"""Metadata-only storage consumers for the existing worker capacity operator.

Selected roots are explicit. Directory walks use held directory descriptors and
do not follow links or cross mounts. Process observations read procfs metadata,
not arguments, environment or file contents. No data is deleted and no process
is signalled by this module.
"""
from __future__ import annotations

from collections import defaultdict
from contextlib import contextmanager
from datetime import datetime, timezone
import math
import os
from pathlib import Path
import stat
import time

_DIRECTORY = os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC | os.O_NOFOLLOW
_PATH_DIRECTORY = getattr(os, "O_PATH", os.O_RDONLY) | os.O_DIRECTORY | os.O_CLOEXEC | os.O_NOFOLLOW


def _now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _error(exc):
    return {"kind": type(exc).__name__, "errno": getattr(exc, "errno", None)}


def _inode(metadata):
    return metadata.st_dev, metadata.st_ino


def _read(path, maximum=65536):
    with Path(path).open("r", encoding="utf-8", errors="backslashreplace") as stream:
        value = stream.read(maximum + 1)
    if len(value) > maximum:
        raise ValueError("Procfs metadata exceeds its read bound")
    return value


def _fd_mount(descriptor):
    fields = {}
    for line in _read(Path("/proc/self/fdinfo") / str(descriptor), 4096).splitlines():
        key, separator, value = line.partition(":")
        if separator and key in ("mnt_id", "ino"):
            if key in fields or not value.strip().isdecimal():
                raise ValueError("File descriptor mount metadata is invalid")
            fields[key] = int(value.strip())
    if "mnt_id" not in fields:
        raise ValueError("File descriptor mount identity is unavailable")
    actual = os.fstat(descriptor)
    if fields.get("ino", actual.st_ino) != actual.st_ino:
        raise ValueError("File descriptor inode changed during observation")
    return fields["mnt_id"]


def _optional_mount(descriptor):
    try:
        return _fd_mount(descriptor), None
    except (OSError, ValueError) as exc:
        return None, _error(exc)


def _owner(path, roots):
    matches = [root for root in roots if path.is_relative_to(root)]
    if not matches:
        return None
    root = max(matches, key=lambda value: len(value.parts))
    relative = path.relative_to(root)
    return str(root / relative.parts[0]) if relative.parts else str(root)


@contextmanager
def _selected_roots(roots):
    selected = []
    try:
        for path in roots:
            path = Path(path)
            before = path.lstat()
            descriptor = os.open(path, _DIRECTORY)
            try:
                opened = os.fstat(descriptor)
                if not stat.S_ISDIR(before.st_mode) or _inode(before) != _inode(opened):
                    raise ValueError("Selected storage root changed while opening")
                mount, mount_error = _optional_mount(descriptor)
                selected.append({"path": path, "fd": descriptor,
                    "device": opened.st_dev, "inode": opened.st_ino,
                    "mount_id": mount, "mount_error": mount_error})
            except BaseException:
                os.close(descriptor)
                raise
        yield selected
    finally:
        for root in selected:
            os.close(root["fd"])


def _public_root(root):
    return {key: str(value) if key == "path" else value
            for key, value in root.items() if key != "fd"}


def _root_changes(roots):
    changes = []
    for root in roots:
        try:
            before = root["path"].lstat()
            descriptor = os.open(root["path"], _PATH_DIRECTORY)
            try:
                current = os.fstat(descriptor)
                mount, error = _optional_mount(descriptor)
            finally:
                os.close(descriptor)
            if (not stat.S_ISDIR(before.st_mode)
                    or _inode(before) != _inode(current)
                    or _inode(current) != (root["device"], root["inode"])
                    or (root["mount_id"] is not None and mount != root["mount_id"])):
                changes.append({"path": str(root["path"]), "status": "root_changed",
                    "selected": _public_root(root),
                    "current": {"device": current.st_dev, "inode": current.st_ino,
                                "mount_id": mount, "mount_error": error}})
        except (OSError, ValueError) as exc:
            changes.append({"path": str(root["path"]), "status": "root_unavailable",
                            "error": _error(exc)})
    return changes


def _directory_consumers(roots):
    seen, walked, rows, errors = set(), set(), {}, []
    started = _now()
    paths = [root["path"] for root in roots]

    def error(path, row, exc):
        row["errors"] += 1
        if len(errors) < 50:
            errors.append({"path": str(path), **_error(exc)})

    def row_for(path):
        owner = _owner(path, paths)
        return rows.setdefault(owner, {"path": owner, "logical_bytes": 0,
            "allocated_bytes": 0, "regular_files": 0, "directories": 0,
            "symbolic_links": 0, "shared_inode_entries": 0,
            "other_entries": 0, "mounts_skipped": 0, "errors": 0})

    def count(path, metadata, root):
        row = row_for(path)
        identity = _inode(metadata)
        if metadata.st_dev != root["device"]:
            row["mounts_skipped"] += 1
            return row
        if identity in seen:
            row["shared_inode_entries"] += 1
            return row
        seen.add(identity)
        row["allocated_bytes"] += getattr(metadata, "st_blocks", 0) * 512
        if stat.S_ISLNK(metadata.st_mode):
            row["symbolic_links"] += 1
        elif stat.S_ISDIR(metadata.st_mode):
            row["directories"] += 1
        elif stat.S_ISREG(metadata.st_mode):
            row["regular_files"] += 1
            row["logical_bytes"] += metadata.st_size
        else:
            row["other_entries"] += 1
        return row

    def walk_key(metadata, root):
        # Aliased inodes share allocation, but separately selected mount views
        # may expose different descendants. Traverse each held mount once.
        return metadata.st_dev, metadata.st_ino, root["mount_id"]

    for root in roots:
        stack = []
        try:
            metadata = os.fstat(root["fd"])
            row = count(root["path"], metadata, root)
            key = walk_key(metadata, root)
            if key in walked:
                continue
            descriptor = os.dup(root["fd"])
            try:
                iterator = os.scandir(descriptor)
            except BaseException:
                os.close(descriptor)
                raise
            walked.add(key)
            stack.append((descriptor, iterator, root["path"]))
            while stack:
                parent_fd, iterator, parent_path = stack[-1]
                try:
                    entry = next(iterator)
                except StopIteration:
                    iterator.close()
                    os.close(parent_fd)
                    stack.pop()
                    continue
                path = parent_path / entry.name
                try:
                    metadata = os.stat(entry.name, dir_fd=parent_fd, follow_symlinks=False)
                except OSError as exc:
                    error(path, row_for(path), exc)
                    continue
                if not stat.S_ISDIR(metadata.st_mode) or metadata.st_dev != root["device"]:
                    count(path, metadata, root)
                    continue
                child = None
                row = row_for(path)
                try:
                    child = os.open(entry.name, _DIRECTORY, dir_fd=parent_fd)
                    held = os.fstat(child)
                    if _inode(held) != _inode(metadata):
                        raise ValueError("Directory changed while opening")
                    # Reject an unselected mount before it enters the inode
                    # accounting set or prevents a later explicit-root walk.
                    if root["mount_id"] is not None and _fd_mount(child) != root["mount_id"]:
                        row["mounts_skipped"] += 1
                        continue
                    count(path, held, root)
                    key = walk_key(held, root)
                    if key in walked:
                        continue
                    child_iterator = os.scandir(child)
                    walked.add(key)
                    stack.append((child, child_iterator, path))
                    child = None
                except (OSError, ValueError) as exc:
                    error(path, row, exc)
                finally:
                    if child is not None:
                        os.close(child)
        except (OSError, ValueError) as exc:
            error(root["path"], row_for(root["path"]), exc)
        finally:
            for descriptor, iterator, path in reversed(stack):
                iterator.close()
                os.close(descriptor)
    result = sorted(rows.values(), key=lambda item: (-item["allocated_bytes"], item["path"]))
    return {"started_at": started, "finished_at": _now(), "consumers": result,
        "unique_allocated_bytes": sum(item["allocated_bytes"] for item in result),
        "unique_logical_bytes": sum(item["logical_bytes"] for item in result),
        "status": "partial" if errors else "ok", "errors": errors,
        "accounting": "st_blocks * 512; each device/inode counted once across held selected roots; symbolic links are not followed",
        "mount_boundary": "mount ID and device when procfs fdinfo is readable; device otherwise"}


def directory_consumers(roots):
    """Read allocation once per inode across the selected directory union."""
    with _selected_roots(roots) as selected:
        result = _directory_consumers(selected)
        result["root_changes"] = _root_changes(selected)
        if result["root_changes"]:
            result["status"] = "partial"
        return result


def _process_identity(directory):
    raw = _read(directory / "stat")
    end = raw.rfind(")")
    fields = raw[end + 2:].split()
    pid = int(raw.split(" ", 1)[0])
    if end < 0 or len(fields) < 20 or not fields[19].isdecimal():
        raise ValueError("Original process identity is incomplete")
    return {"proc_pid": pid, "start_ticks": fields[19],
        "name": raw[raw.find("(") + 1:end], "parent_proc_pid": int(fields[1]),
        "pid_namespace": os.readlink(directory / "ns/pid"),
        "mount_namespace": os.readlink(directory / "ns/mnt")}


def _same_process(before, after):
    return all(before[key] == after[key] for key in
               ("proc_pid", "start_ticks", "pid_namespace", "mount_namespace"))


def _io(directory):
    fields = {}
    for line in _read(directory / "io").splitlines():
        key, _, value = line.partition(":")
        if key in {"read_bytes", "write_bytes", "cancelled_write_bytes", "syscw"}:
            if key in fields or not value.strip().isdecimal():
                raise ValueError("Process I/O counters are invalid")
            fields[key] = int(value.strip())
    return fields


def _root_for(path, roots):
    return max((root for root in roots if path.is_relative_to(root["path"])),
               key=lambda root: len(root["path"].parts), default=None)


def _open_descendant(directory_fd, parts):
    descriptor = os.dup(directory_fd)
    try:
        for part in parts:
            next_descriptor = os.open(part, _PATH_DIRECTORY, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = next_descriptor
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def _process_root(directory, root):
    """Compare the selected directory in the process's own filesystem view."""
    descriptor = os.open(directory / "root",
        getattr(os, "O_PATH", os.O_RDONLY) | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        selected = _open_descendant(descriptor, root["path"].parts[1:])
    finally:
        os.close(descriptor)
    try:
        metadata = os.fstat(selected)
        if _inode(metadata) != (root["device"], root["inode"]):
            return {"status": "different_root", "device": metadata.st_dev,
                    "inode": metadata.st_ino}
        return {"status": "same_root", "device": metadata.st_dev,
                "inode": metadata.st_ino, "mount_id": _fd_mount(selected)}
    finally:
        os.close(selected)


def _named_identity(root, path):
    relative = path.relative_to(root["path"])
    if not relative.parts:
        return root["device"], root["inode"]
    descriptor = _open_descendant(root["fd"], relative.parts[:-1])
    try:
        metadata = os.stat(relative.parts[-1], dir_fd=descriptor, follow_symlinks=False)
        if stat.S_ISLNK(metadata.st_mode):
            raise ValueError("Selected path became a symbolic link")
        return _inode(metadata)
    finally:
        os.close(descriptor)


def _path_evidence(path, metadata, mount_id, root, process_root):
    if process_root["status"] != "same_root":
        return None
    if metadata.st_nlink == 0:
        # No current directory entry can prove an unlinked file's old parent.
        # Keep this weaker, explicit evidence separate from exact live paths.
        if metadata.st_dev != root["device"] or mount_id != process_root["mount_id"]:
            return None
        return "unlinked_path_in_matching_root_mount"
    if _named_identity(root, path) != _inode(metadata):
        return None
    return "same_live_path_inode"


def _process_consumers(roots):
    rows, files, errors, excluded = [], {}, defaultdict(int), defaultdict(int)
    inspected = 0
    observer = {}
    try:
        observer = {**_process_identity(Path("/proc/self")),
                    "boot_id": _read("/proc/sys/kernel/random/boot_id", 256).strip()}
    except (OSError, ValueError, IndexError) as exc:
        observer["error"] = _error(exc)
        errors["observer_" + type(exc).__name__] += 1
    try:
        with os.scandir("/proc") as entries:
            directories = [Path(entry.path) for entry in entries
                if entry.name.isascii() and entry.name.isdecimal()]
    except OSError as exc:
        return {"status": "unavailable", "processes": [], "open_files": [],
                "observer": observer, "error": _error(exc)}
    for original in directories:
        inspected += 1
        process_fd = None
        candidates, root_views = [], {}
        try:
            # Relative reads through this held proc directory cannot switch to a
            # new process merely because the numeric PID was reused.
            process_fd = os.open(original, _DIRECTORY)
            directory = Path("/proc/self/fd") / str(process_fd)
            identity = _process_identity(directory)
            if identity["proc_pid"] != int(original.name):
                raise ValueError("Process directory identity differs")

            def view(root):
                key = str(root["path"])
                if key not in root_views:
                    root_views[key] = _process_root(directory, root)
                return root_views[key]

            cwd, cwd_owner, cwd_evidence = None, None, None
            try:
                target = os.readlink(directory / "cwd")
                descriptor = os.open(directory / "cwd",
                    getattr(os, "O_PATH", os.O_RDONLY) | os.O_DIRECTORY | os.O_CLOEXEC)
                try:
                    metadata, mount_id = os.fstat(descriptor), _fd_mount(descriptor)
                    clean = target.removesuffix(" (deleted)") if metadata.st_nlink == 0 else target
                    path = Path(clean)
                    root = _root_for(path, roots) if path.is_absolute() else None
                    if root and os.readlink(directory / "cwd") == target:
                        evidence = _path_evidence(path, metadata, mount_id, root, view(root))
                        if evidence:
                            cwd, cwd_owner, cwd_evidence = clean, _owner(path, [root["path"]]), evidence
                        else:
                            excluded["cwd_root_or_inode_mismatch"] += 1
                finally:
                    os.close(descriptor)
            except (OSError, ValueError) as exc:
                errors["cwd_" + type(exc).__name__] += 1

            try:
                with os.scandir(directory / "fd") as descriptors:
                    for entry in descriptors:
                        pinned = None
                        try:
                            location = directory / "fd" / entry.name
                            target = os.readlink(location)
                            if not target.startswith("/"):
                                continue
                            metadata = os.stat(location)
                            if not stat.S_ISREG(metadata.st_mode):
                                continue
                            clean = target.removesuffix(" (deleted)") if metadata.st_nlink == 0 else target
                            path = Path(clean)
                            root = _root_for(path, roots)
                            if root is None:
                                continue
                            remote = view(root)
                            if remote["status"] != "same_root":
                                excluded["descriptor_root_view_mismatch"] += 1
                                continue
                            pinned = os.open(location, getattr(os, "O_PATH", os.O_RDONLY) | os.O_CLOEXEC)
                            held = os.fstat(pinned)
                            mount_id = _fd_mount(pinned)
                            if _inode(held) != _inode(metadata) or held.st_nlink != metadata.st_nlink:
                                errors["descriptor_changed"] += 1
                                continue
                            evidence = _path_evidence(path, held, mount_id, root, remote)
                            if evidence is None:
                                excluded["descriptor_path_or_mount_mismatch"] += 1
                                continue
                            after = os.stat(location)
                            if (os.readlink(location) != target or _inode(after) != _inode(held)
                                    or after.st_nlink != held.st_nlink):
                                errors["descriptor_changed"] += 1
                                continue
                            candidates.append({"identity": str(held.st_dev) + ":" + str(held.st_ino),
                                "device": held.st_dev, "inode": held.st_ino, "path": clean,
                                "consumer": _owner(path, [root["path"]]),
                                "logical_bytes": held.st_size,
                                "allocated_bytes": getattr(held, "st_blocks", 0) * 512,
                                "unlinked": held.st_nlink == 0, "observed_at": _now(),
                                "holder": {"proc_pid": identity["proc_pid"],
                                    "start_ticks": identity["start_ticks"], "fd": entry.name,
                                    "pid_namespace": identity["pid_namespace"],
                                    "mount_namespace": identity["mount_namespace"],
                                    "mount_id": mount_id, "path": clean,
                                    "consumer": _owner(path, [root["path"]]),
                                    "selection_basis": evidence,
                                    "selected_root": _public_root(root),
                                    "process_root": dict(remote)}})
                        except (OSError, ValueError) as exc:
                            errors[type(exc).__name__] += 1
                        finally:
                            if pinned is not None:
                                os.close(pinned)
            except OSError as exc:
                errors[type(exc).__name__] += 1

            if cwd_owner is None and not candidates:
                continue
            try:
                io, io_error = _io(directory), None
            except (OSError, ValueError) as exc:
                io, io_error = None, _error(exc)
            # The selected path must still identify the same directory in that
            # process's filesystem view before any holder becomes public.
            changed_roots = set()
            for root in roots:
                key = str(root["path"])
                if key in root_views:
                    try:
                        if _process_root(directory, root) != root_views[key]:
                            changed_roots.add(key)
                    except (OSError, ValueError):
                        changed_roots.add(key)
            if changed_roots:
                errors["process_root_changed"] += len(changed_roots)
                candidates = [item for item in candidates
                    if item["holder"]["selected_root"]["path"] not in changed_roots]
                if cwd is not None:
                    root = _root_for(Path(cwd), roots)
                    if root and str(root["path"]) in changed_roots:
                        cwd, cwd_owner, cwd_evidence = None, None, None
            if cwd_owner is None and not candidates:
                continue
            current = _process_identity(directory)
            if not _same_process(identity, current):
                errors["identity_changed"] += 1
                excluded["discarded_process_file_observations"] += len(candidates)
                continue
            matched = set()
            for item in candidates:
                key = item["identity"]
                holder = item.pop("holder")
                row = files.get(key)
                if row is None:
                    row = {**item, "paths": [item["path"]], "consumers": [item["consumer"]],
                           "holders": [], "metadata_changed_during_scan": False}
                    files[key] = row
                else:
                    for field in ("logical_bytes", "allocated_bytes", "unlinked"):
                        if row[field] != item[field]:
                            row["metadata_changed_during_scan"] = True
                            row[field] = item[field]
                    row["observed_at"] = item["observed_at"]
                    if item["path"] not in row["paths"]:
                        row["paths"].append(item["path"])
                    if item["consumer"] not in row["consumers"]:
                        row["consumers"].append(item["consumer"])
                if holder not in row["holders"]:
                    row["holders"].append(holder)
                matched.add(key)
            row = {**current, "cwd": cwd, "cwd_consumer": cwd_owner,
                   "cwd_selection_basis": cwd_evidence,
                   "open_file_identities": sorted(matched), "io": io}
            if io_error is not None:
                row["io_error"] = io_error
            rows.append(row)
        except (OSError, ValueError, IndexError) as exc:
            errors[type(exc).__name__] += 1
            excluded["discarded_process_file_observations"] += len(candidates)
        finally:
            if process_fd is not None:
                os.close(process_fd)
    file_rows = sorted(files.values(), key=lambda item: (-item["allocated_bytes"], item["path"]))
    return {"status": "partial" if errors else "ok", "observed_at": _now(),
        "source": "/proc/[pid]/{stat,cwd,fd,root,ns/pid,ns/mnt,io}; /proc/self/fdinfo",
        "observer": observer, "processes_inspected": inspected,
        "processes": rows, "open_files": file_rows,
        "unlinked_open_allocated_bytes": sum(item["allocated_bytes"] for item in file_rows if item["unlinked"]),
        "unlinked_scope": "last visible pathname plus matching selected-root inode and process mount; not proof of the deleted directory entry or reclaim authority",
        "read_errors": dict(errors), "excluded_observations": dict(excluded),
        "io_scope": "whole process counters; matching cwd/descriptors identify observed consumers, not which filesystem received each write"}


def process_consumers(roots):
    """Read stable process holders of the selected physical storage roots."""
    with _selected_roots(roots) as selected:
        result = _process_consumers(selected)
        result["root_changes"] = _root_changes(selected)
        if result["root_changes"]:
            result["status"] = "partial"
        return result


def _filesystem_sample(roots):
    if __package__:
        from .worker_capacity import snapshot
    else:
        from worker_capacity import snapshot
    rows = snapshot([str(root) for root in roots], include_memory=False)["filesystems"]
    for row in rows:
        row["available_inodes"] = row.get("inodes_available")
        if row.get("status") != "ok" or not row.get("path"):
            continue
        try:
            descriptor = os.open(row["path"], _PATH_DIRECTORY)
            try:
                metadata = os.fstat(descriptor)
                mount, error = _optional_mount(descriptor)
                row["root_identity"] = {"device": metadata.st_dev, "inode": metadata.st_ino,
                                        "mount_id": mount, "mount_error": error}
            finally:
                os.close(descriptor)
        except (OSError, ValueError) as exc:
            row["root_identity_error"] = _error(exc)
    return rows


def _filesystem_deltas(before, after):
    deltas, unmatched = [], []
    keys = ("path", "observed_path", "device", "root_identity", "caller_identity",
            "available_bytes_source", "inodes_available_source", "filesystem", "read_only")
    fields = {"available_bytes": "available_bytes_delta",
              "available_inodes": "available_inodes_delta",
              "free_including_reserved_bytes": "free_including_reserved_bytes_delta",
              "unprivileged_available_bytes": "unprivileged_available_bytes_delta",
              "reserved_space_bytes": "reserved_space_bytes_delta",
              "inodes_free_including_reserved": "inodes_free_including_reserved_delta",
              "inodes_unprivileged_available": "inodes_unprivileged_available_delta"}
    for old, new in zip(before, after):
        path = old.get("path", old.get("requested_path"))
        if (old.get("status") != "ok" or new.get("status") != "ok"
                or "root_identity" not in old or "root_identity" not in new
                or any(old.get(key) != new.get(key) for key in keys)):
            unmatched.append({"path": path, "status": "unavailable_or_changed_identity",
                              "before": old, "after": new})
            continue
        row = {"path": path, "device": old["device"],
               "root_identity": old["root_identity"],
               "available_bytes_source": old.get("available_bytes_source")}
        for source, target in fields.items():
            row[target] = (new[source] - old[source]
                if type(old.get(source)) is int and type(new.get(source)) is int else None)
        deltas.append(row)
    return deltas, unmatched


def storage_consumers(values, *, include_processes=False, sample_seconds=0):
    """Collect selected-root allocation and optional process write deltas."""
    if not math.isfinite(sample_seconds) or not 0 <= sample_seconds <= 30:
        raise ValueError("storage sample seconds must be finite and between 0 and 30")
    roots = sorted({Path(value).expanduser().resolve(strict=True) for value in values},
                   key=lambda path: (len(path.parts), str(path)))
    if not roots or any(not root.is_dir() for root in roots):
        raise ValueError("storage roots must be existing directories")
    # An explicitly selected nested root can be a separate mount. Keep every
    # requested root; descriptor-bound traversal and inode accounting handle
    # overlapping paths without crossing or double-counting their mounts.
    selected = roots
    with _selected_roots(selected) as bindings:
        result = {"schema": "commons.worker_storage/v1", "started_at": _now(),
            "requested_roots": [str(root) for root in roots],
            "roots": [str(root) for root in selected],
            "root_identities": [_public_root(root) for root in bindings],
            "directory_usage": _directory_consumers(bindings)}
        if include_processes or sample_seconds:
            result["process_storage"] = _process_consumers(bindings)
        if sample_seconds:
            before_fs = _filesystem_sample(selected)
            start = time.monotonic()
            time.sleep(sample_seconds)
            after_processes = _process_consumers(bindings)
            after_fs = _filesystem_sample(selected)
            elapsed = time.monotonic() - start
            def key(row):
                return tuple(row[field] for field in
                    ("proc_pid", "start_ticks", "pid_namespace", "mount_namespace"))
            before_processes = {key(row): row for row in result["process_storage"]["processes"]}
            deltas = []
            for row in after_processes["processes"]:
                old = before_processes.get(key(row))
                if not old or old.get("io") is None or row.get("io") is None:
                    continue
                delta = {field: row["io"][field] - old["io"][field]
                         for field in row["io"] if field in old["io"]}
                if any(value < 0 for value in delta.values()):
                    continue
                deltas.append({field: row[field] for field in
                    ("proc_pid", "start_ticks", "pid_namespace", "mount_namespace",
                     "name", "cwd_consumer")} | delta)
            fs_deltas, unmatched = _filesystem_deltas(before_fs, after_fs)
            result["sample"] = {"elapsed_seconds": elapsed,
                "filesystem_before": before_fs, "filesystem_after": after_fs,
                "filesystem_deltas": fs_deltas, "filesystem_unmatched": unmatched,
                "process_io_deltas": sorted(deltas,
                    key=lambda row: (-row.get("write_bytes", 0), row["proc_pid"])),
                "processes_after": after_processes}
        result["root_changes"] = _root_changes(bindings)
        result["status"] = "partial" if (result["root_changes"]
            or result["directory_usage"]["status"] != "ok"
            or result.get("process_storage", {}).get("status", "ok") != "ok"
            or result.get("sample", {}).get("filesystem_unmatched")
            or result.get("sample", {}).get("processes_after", {}).get("status", "ok") != "ok") else "ok"
        result["finished_at"] = _now()
        return result
