#!/usr/bin/env python3
"""Observe memory/filesystem capacity; optionally observe one exact allocation."""
from __future__ import annotations

import argparse
import ctypes
import errno
import json
import os
import re
import shutil
import stat
import sys
from copy import deepcopy
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path, PurePosixPath

SCHEMA = "commons.worker_capacity/v1"
PROCESS_STATUS_BYTES = 65536
LOCAL_ROOT_FILESYSTEMS = frozenset(("ext2", "ext3", "ext4", "xfs",
                                    "btrfs", "f2fs", "tmpfs", "ramfs"))


def _now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _error(exc):
    return {"kind": type(exc).__name__, "errno": getattr(exc, "errno", None)}


def _nonnegative(raw):
    if not re.fullmatch(r"[0-9]+", raw):
        raise ValueError("expected a nonnegative kernel counter")
    return int(raw)


def _host_memory():
    result = {"source": "/proc/meminfo", "total_bytes": None, "available_bytes": None}
    try:
        wanted = {"MemTotal": "total_bytes", "MemAvailable": "available_bytes"}
        for line in Path(result["source"]).read_text(encoding="ascii").splitlines():
            key, _, raw = line.partition(":")
            if key in wanted:
                value, unit = raw.split()
                if unit != "kB":
                    raise ValueError("unexpected memory unit")
                result[wanted[key]] = _nonnegative(value) * 1024
        result["status"] = "ok" if all(result[key] is not None for key in wanted.values()) else "partial"
    except (OSError, UnicodeError, ValueError) as exc:
        result.update(status="unavailable", error=_error(exc))
    return result


def _unescape_mount(value):
    return re.sub(r"\\([0-7]{3})", lambda match: chr(int(match[1], 8)), value)


def _cgroup_location():
    membership = None
    for line in Path("/proc/self/cgroup").read_text(encoding="utf-8").splitlines():
        if line.startswith("0::"):
            membership = PurePosixPath(line[3:])
            break
    if membership is None:
        raise ValueError("no cgroup v2 membership")
    if not membership.is_absolute() or ".." in membership.parts:
        raise ValueError("unresolvable cgroup membership")
    candidates = []
    for line in Path("/proc/self/mountinfo").read_text(encoding="utf-8").splitlines():
        left, separator, right = line.partition(" - ")
        fields = left.split()
        if not separator or not right.startswith("cgroup2 ") or len(fields) < 5:
            continue
        root = PurePosixPath(_unescape_mount(fields[3]))
        mount = Path(_unescape_mount(fields[4]))
        if membership.is_relative_to(root):
            current = mount / str(membership.relative_to(root))
            candidates.append((len(root.parts), str(mount), mount, current))
    if not candidates:
        raise ValueError("no visible cgroup v2 mount matches membership")
    # A subtree mount is more specific than another view of the same hierarchy.
    _, _, mount, current = max(candidates, key=lambda item: item[:2])
    return mount, current, str(membership)


def _pairs(file):
    result = {}
    for line in file.read_text(encoding="ascii").splitlines():
        key, value = line.split()
        if key in result:
            raise ValueError("duplicate kernel counter")
        result[key] = _nonnegative(value)
    return result


def _memory_pressure(file):
    result = {"source": str(file), "status": "unavailable", "some": None, "full": None}
    try:
        rows = {}
        for line in file.read_text(encoding="ascii").splitlines():
            fields = line.split()
            if not fields or fields[0] not in ("some", "full"):
                continue
            kind, *tokens = fields
            if kind in rows:
                raise ValueError("duplicate pressure row")
            values = {}
            for token in tokens:
                key, separator, raw = token.partition("=")
                if not separator or key in values:
                    raise ValueError("invalid pressure field")
                values[key] = raw
            if not {"avg10", "avg60", "avg300", "total"}.issubset(values):
                raise ValueError("missing pressure field")
            row = {}
            for key in ("avg10", "avg60", "avg300"):
                raw = values[key]
                if not re.fullmatch(r"[0-9]+(?:\.[0-9]+)?", raw):
                    raise ValueError("invalid pressure percentage")
                value = float(raw)
                if not 0 <= value <= 100:
                    raise ValueError("pressure percentage out of range")
                row[key + "_percent"] = value
            row["total_us"] = _nonnegative(values["total"])
            rows[kind] = row
        if set(rows) != {"some", "full"}:
            raise ValueError("missing pressure row")
        result.update(status="ok", **rows)
    except (OSError, UnicodeError, ValueError) as exc:
        result["error"] = _error(exc)
    return result


def _cgroup_memory():
    result = {"status": "unavailable", "scope": "visible_cgroup_v2_ancestors",
              "levels": [], "smallest_observed_headroom_bytes": None}
    try:
        mount, current, membership = _cgroup_location()
    except (OSError, UnicodeError, ValueError) as exc:
        result["error"] = _error(exc)
        return result
    result.update(mountpoint=str(mount), membership=membership)
    finite_headrooms = []
    directory = current
    while True:
        row = {"directory": str(directory), "current_bytes": None,
               "max_bytes": None, "max_status": "unavailable",
               "high_bytes": None, "high_status": "unavailable",
               "headroom_bytes": None, "errors": {}}
        for filename, key in (("memory.current", "current"),
                              ("memory.max", "max"), ("memory.high", "high")):
            try:
                raw = (directory / filename).read_text(encoding="ascii").strip()
                if key != "current" and raw == "max":
                    row[key + "_status"] = "unlimited"
                else:
                    row[key + "_bytes"] = _nonnegative(raw)
                    if key != "current":
                        row[key + "_status"] = "finite"
            except (OSError, UnicodeError, ValueError) as exc:
                row["errors"][filename] = _error(exc)
        # Configured protections are context, not an effective reclaim total.
        # Protection behavior is relative to the selected reclaim target.
        protection = {"min_bytes": None, "low_bytes": None, "errors": {}}
        for filename, key in (("memory.min", "min_bytes"), ("memory.low", "low_bytes")):
            try:
                protection[key] = _nonnegative((directory / filename).read_text(encoding="ascii").strip())
            except (OSError, UnicodeError, ValueError) as exc:
                protection["errors"][filename] = _error(exc)
        row["protection"] = protection
        if row["current_bytes"] is not None and row["max_status"] == "finite":
            row["headroom_bytes"] = max(0, row["max_bytes"] - row["current_bytes"])
            row["over_limit_bytes"] = max(0, row["current_bytes"] - row["max_bytes"])
            finite_headrooms.append(row["headroom_bytes"])
        result["levels"].append(row)
        if directory == mount:
            break
        directory = directory.parent
    result["smallest_observed_headroom_bytes"] = min(finite_headrooms) if finite_headrooms else None
    result["status"] = "ok" if all(not row["errors"] for row in result["levels"]) else "partial"
    for filename, key in (("memory.events", "events"), ("memory.stat", "stat_bytes")):
        try:
            values = _pairs(current / filename)
            if key == "stat_bytes":
                values = {name: values[name] for name in
                          ("anon", "file", "shmem", "kernel", "inactive_file", "active_file",
                           "file_mapped", "file_dirty", "file_writeback", "slab",
                           "slab_reclaimable", "slab_unreclaimable") if name in values}
            result[key] = values
        except (OSError, UnicodeError, ValueError) as exc:
            result[key] = None
            result.setdefault("errors", {})[filename] = _error(exc)
            result["status"] = "partial"
    result["pressure"] = _memory_pressure(current / "memory.pressure")
    if result["pressure"]["status"] != "ok":
        result.setdefault("errors", {})["memory.pressure"] = result["pressure"]["error"]
        result["status"] = "partial"
    return result



CURRENT_CGROUP_RECLAIM_MAX_BYTES = 1024 * 1024 * 1024


def _current_reclaim_binding():
    """Bind only this process's visible cgroup; never select an ancestor."""
    mount, current, membership = _cgroup_location()
    if (mount.resolve(strict=True) != mount or current.resolve(strict=True) != current
            or not current.is_relative_to(mount)):
        raise ValueError("The current cgroup mapping contains an unresolved alias")
    directory = current.lstat()
    if not stat.S_ISDIR(directory.st_mode) or current.is_symlink():
        raise ValueError("The current cgroup is not its original directory")
    # cgroup.procs reports PIDs in the reader\'s active PID namespace; the
    # procfs mount may expose another namespace through /proc/self.
    process_id = os.getpid()
    members = {_nonnegative(line.strip())
               for line in (current / "cgroup.procs").read_text(encoding="ascii").splitlines()
               if line.strip()}
    if process_id not in members:
        raise ValueError("This process is absent from the selected current cgroup")
    return {"mountpoint": str(mount), "directory": str(current),
            "membership": membership, "process_id": process_id,
            "mount_namespace": os.readlink("/proc/self/ns/mnt"),
            "cgroup_namespace": os.readlink("/proc/self/ns/cgroup"),
            "directory_device": directory.st_dev, "directory_inode": directory.st_ino}


def reclaim_current_cgroup(requested_bytes, *, expected_cgroup=None):
    """Request reclaim once, then retain fresh observations of the actual result.

    This reuses the original Correspondence current-cgroup proof. It writes only
    memory.reclaim in this process's proved cgroup. Kernel limits and settings
    remain unchanged. A successful write is not a reservation or a guaranteed
    number of freed bytes; EAGAIN may also follow partial reclamation.
    """
    if (type(requested_bytes) is not int
            or not 0 < requested_bytes <= CURRENT_CGROUP_RECLAIM_MAX_BYTES):
        raise ValueError("Current-cgroup reclaim requires 1..1073741824 bytes")
    if expected_cgroup is not None and not isinstance(expected_cgroup, dict):
        raise ValueError("Use the original observed current-cgroup identity")
    result = {"schema": "commons.current-cgroup-reclaim/v1",
              "started_at": _now(), "requested_bytes": requested_bytes,
              "state": "UNAVAILABLE", "request_attempted": False,
              "request_written": False, "written_bytes": None,
              "allocation_guaranteed": False, "current_cgroup_unchanged": None,
              "selection_cgroup_unchanged": None,
              "before": snapshot(include_filesystems=False)}
    descriptor = directory_fd = None
    binding = None
    try:
        if not sys.platform.startswith("linux"):
            raise NotImplementedError("Current-cgroup reclaim requires Linux cgroup v2")
        binding = _current_reclaim_binding()
        result["binding"] = binding
        if expected_cgroup is not None:
            expected = {"mountpoint": expected_cgroup.get("mountpoint"),
                        "membership": expected_cgroup.get("membership"),
                        "directory": (expected_cgroup.get("levels") or [{}])[0].get("directory")}
            result["selection_cgroup_unchanged"] = all(binding[key] == value for key, value in expected.items())
            if not result["selection_cgroup_unchanged"]:
                raise ValueError("The observed current cgroup changed before reclaim")
        directory_fd = os.open(binding["directory"],
            os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
        opened_directory = os.fstat(directory_fd)
        if ((opened_directory.st_dev, opened_directory.st_ino)
                != (binding["directory_device"], binding["directory_inode"])):
            raise ValueError("The opened current cgroup directory changed")
        original = os.stat("memory.reclaim", dir_fd=directory_fd, follow_symlinks=False)
        if not stat.S_ISREG(original.st_mode):
            raise ValueError("The original memory.reclaim entry is not a regular kernel file")
        descriptor = os.open("memory.reclaim",
            os.O_WRONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=directory_fd)
        opened = os.fstat(descriptor)
        if ((opened.st_dev, opened.st_ino) != (original.st_dev, original.st_ino)
                or opened.st_dev != opened_directory.st_dev
                or _current_reclaim_binding() != binding):
            raise ValueError("The original current-cgroup binding changed before reclaim")
        result.update(state="SELECTED", file_device=opened.st_dev, file_inode=opened.st_ino)
        command = (str(requested_bytes) + "\n").encode("ascii")
        result["request_attempted"] = True
        written = os.write(descriptor, command)
        result.update(written_bytes=written, request_written=written == len(command),
                      state="RETURNED" if written == len(command) else "SHORT_WRITE")
    except (OSError, UnicodeError, ValueError, RuntimeError, NotImplementedError) as exc:
        result.update(state=("KERNEL_SHORTFALL" if isinstance(exc, OSError)
                             and exc.errno == errno.EAGAIN else "UNAVAILABLE"),
                      error={**_error(exc), "message": str(exc)})
    finally:
        for selected in (descriptor, directory_fd):
            if selected is not None:
                try:
                    os.close(selected)
                except OSError as exc:
                    result.setdefault("close_errors", []).append(_error(exc))
        if binding is not None:
            try:
                after_binding = _current_reclaim_binding()
                result["after_binding"] = after_binding
                result["current_cgroup_unchanged"] = after_binding == binding
            except (OSError, UnicodeError, ValueError, RuntimeError) as exc:
                result["current_cgroup_unchanged"] = False
                result["binding_error"] = {**_error(exc), "message": str(exc)}
        result["after"] = snapshot(include_filesystems=False)
        result["finished_at"] = _now()
    return result


def _filesystem_caller():
    """Read this process's filesystem identity without changing credentials."""
    result = {"effective_uid": None, "filesystem_uid": None,
              "mapped_parent_uid": None, "uid_mapping": None, "status": "unavailable",
              "effective_capabilities_hex": None, "cap_sys_resource_effective": None,
              "user_namespace": None}
    if not sys.platform.startswith("linux") or not hasattr(os, "geteuid"):
        return result
    result["effective_uid"] = os.geteuid()
    try:
        with Path("/proc/self/status").open("r", encoding="ascii") as source:
            raw = source.read(PROCESS_STATUS_BYTES + 1)
        if len(raw) > PROCESS_STATUS_BYTES:
            raise ValueError("process identity exceeds read bound")
        rows = [line.split()[1:] for line in raw.splitlines() if line.startswith("Uid:")]
        if len(rows) != 1 or len(rows[0]) != 4:
            raise ValueError("missing or invalid process UID row")
        real, effective, saved, filesystem = map(_nonnegative, rows[0])
        if effective != result["effective_uid"]:
            raise ValueError("process identity changed during observation")
        result["filesystem_uid"] = filesystem
        capability_rows = [line.split()[1:] for line in raw.splitlines()
                           if line.startswith("CapEff:")]
        if (len(capability_rows) != 1 or len(capability_rows[0]) != 1
                or not re.fullmatch(r"[0-9a-fA-F]{1,16}", capability_rows[0][0])):
            raise ValueError("missing or invalid effective capability row")
        capabilities = capability_rows[0][0].lower()
        result.update(effective_capabilities_hex=capabilities,
                      cap_sys_resource_effective=bool(int(capabilities, 16) & (1 << 24)),
                      user_namespace=os.readlink("/proc/self/ns/user"))
        with Path("/proc/self/uid_map").open("r", encoding="ascii") as source:
            raw = source.read(4097)
        if len(raw) > 4096:
            raise ValueError("UID mapping exceeds read bound")
        matches = []
        for line in raw.splitlines():
            inside, parent, count = map(_nonnegative, line.split())
            if count == 0:
                raise ValueError("empty UID mapping range")
            if inside <= filesystem < inside + count:
                matches.append((inside, parent, count))
        if len(matches) != 1:
            raise ValueError("filesystem UID has no unique visible mapping")
        inside, parent, count = matches[0]
        result.update(mapped_parent_uid=parent + filesystem - inside,
                      uid_mapping={"inside_uid": inside, "parent_uid": parent, "count": count},
                      status="ok")
    except (OSError, UnicodeError, ValueError) as exc:
        result["error"] = _error(exc)
    return result


@lru_cache(maxsize=1)
def _mount_topology(raw):
    """Reuse parsing only when freshly read mountinfo bytes are identical."""
    mounts = []
    for line in raw.splitlines():
        left, separator, right = line.partition(" - ")
        fields, filesystem = left.split(), right.split()
        if separator and len(fields) >= 6 and len(filesystem) >= 3:
            mount = Path(_unescape_mount(fields[4]))
            options = set(fields[5].split(",")) | set(filesystem[2].split(","))
            reserved_user = tuple(item.partition("=")[2] for item in options
                                  if item.startswith("resuid="))
            mounts.append((len(mount.parts), str(mount), filesystem[0],
                           "ro" in options, reserved_user))
    return tuple(mounts)


def _filesystem_context(*, namespace=False):
    """Fresh metadata for one observation; no capacity or path cache."""
    value = {"caller": _filesystem_caller(), "mountinfo": None, "mounts": (),
             "mount_namespace": None, "mount_error": None}
    try:
        raw = Path("/proc/self/mountinfo").read_text(encoding="utf-8")
        value.update(mountinfo=raw, mounts=_mount_topology(raw))
        if namespace:
            value["mount_namespace"] = os.readlink("/proc/self/ns/mnt")
    except (OSError, UnicodeError, ValueError) as exc:
        value["mount_error"] = _error(exc)
    return value


def _filesystem(value, *, nearest_existing=False, context=None):
    result = {"requested_path": value, "available_bytes": None,
              "total_bytes": None, "inodes_available": None, "inodes_total": None}
    try:
        path = Path(value).expanduser().resolve(strict=not nearest_existing)
        observed = path
        if nearest_existing:
            while not observed.exists() and observed != observed.parent:
                observed = observed.parent
        selected = observed.stat()
        stat = os.statvfs(observed) if hasattr(os, "statvfs") else None
        if stat is not None:
            unit = stat.f_frsize or stat.f_bsize
            available, total = stat.f_bavail * unit, stat.f_blocks * unit
            source = "statvfs_f_bavail"
        else:
            usage = shutil.disk_usage(observed)
            available, total, source = usage.free, usage.total, "shutil.disk_usage"
        result.update(path=str(path), observed_path=str(observed),
                      requested_path_exists=path.exists(), device=selected.st_dev, status="ok",
                      available_bytes=available, total_bytes=total,
                      available_bytes_source=source)
        context = _filesystem_context() if context is None else context
        mounts = [row for row in context["mounts"] if observed.is_relative_to(Path(row[1]))]
        if mounts:
            _, mount, filesystem, read_only, reserved_user = max(mounts, key=lambda item: item[:2])
            result.update(mountpoint=mount, filesystem=filesystem,
                          memory_backed=filesystem in ("tmpfs", "ramfs"),
                          mount_read_only=read_only)
            if reserved_user:
                result["reserved_user_is_root"] = all(value == "0" for value in reserved_user)
        if context["mount_error"] is not None:
            result["mount_error"] = deepcopy(context["mount_error"])
        if stat is not None:
            caller = deepcopy(context["caller"])
            read_only = bool(stat.f_flag & getattr(os, "ST_RDONLY", 1)) or result.get("mount_read_only", False)
            local_root = (caller["status"] == "ok" and caller["effective_uid"] == 0
                          and caller["filesystem_uid"] == 0 and caller["mapped_parent_uid"] == 0
                          and result.get("filesystem") in LOCAL_ROOT_FILESYSTEMS
                          and result.get("mount_read_only") is False
                          and result.get("reserved_user_is_root", True) and not read_only)
            result.update(total_bytes=stat.f_blocks * unit, inodes_total=stat.f_files,
                          free_including_reserved_bytes=stat.f_bfree * unit,
                          unprivileged_available_bytes=stat.f_bavail * unit,
                          inodes_free_including_reserved=stat.f_ffree,
                          inodes_unprivileged_available=stat.f_favail,
                          caller_identity=caller, read_only=read_only)
            # OverlayFS forwards underlying operations using stashed mount
            # credentials. The visible caller's root UID, capabilities and UID
            # mapping do not establish access to the backing mount's reserves.
            # Keep both observations; only direct qualified local filesystems
            # retain the original root estimate. Neither estimate guarantees a
            # later allocation against quotas or concurrent writers.
            reserve_basis = ("overlay_backing_credentials_unobserved"
                             if result.get("filesystem") == "overlay"
                             else "qualified_direct_local_root_estimate" if local_root
                             else "unprivileged_available_counter")
            result.update(reserved_space_estimate_basis=reserve_basis,
                          allocation_guaranteed=False,
                          reserved_space_bytes=max(0, (stat.f_bfree - stat.f_bavail) * unit))
            if read_only:
                result.update(available_bytes=0, inodes_available=0,
                              available_bytes_source="read_only",
                              inodes_available_source="read_only")
            elif local_root:
                result.update(available_bytes=stat.f_bfree * unit, inodes_available=stat.f_ffree,
                              available_bytes_source="statvfs_f_bfree_local_root",
                              inodes_available_source="statvfs_f_ffree_local_root")
            else:
                result.update(available_bytes=stat.f_bavail * unit, inodes_available=stat.f_favail,
                              available_bytes_source="statvfs_f_bavail",
                              inodes_available_source="statvfs_f_favail")
        else:
            result["inode_status"] = "unavailable"
    except (OSError, ValueError, RuntimeError) as exc:
        result.update(status="error", error=_error(exc))
    return result


def _filesystem_observations(paths, *, nearest_existing=False):
    """Share one checked metadata frame while every path gets fresh counters."""
    values = [str(value) for value in paths]
    if len(values) < 2:
        return [_filesystem(value, nearest_existing=nearest_existing) for value in values]
    context = _filesystem_context(namespace=True)
    shareable = (context["mountinfo"] is not None and context["mount_namespace"] is not None
                 and context["mount_error"] is None and context["caller"].get("status") == "ok")
    if shareable:
        rows = [_filesystem(value, nearest_existing=nearest_existing, context=context)
                for value in values]
        # setns, changed credentials or a changed mount table cannot make a
        # borrowed classification authoritative. Fall back to fresh original
        # per-path reads for this sample when the metadata frame changed.
        if _filesystem_context(namespace=True) == context:
            return rows
    return [_filesystem(value, nearest_existing=nearest_existing) for value in values]


def _allocation_writer():
    """Bind an allocation to the current filesystem and namespace identity."""
    caller = _filesystem_caller()
    for name in ("mnt", "pid"):
        caller[name + "_namespace"] = os.readlink("/proc/self/ns/" + name)
    return caller


def _linux_fallocate(descriptor, amount):
    # The POSIX libc wrapper may emulate allocation by writing zeros on an
    # unsupported filesystem. Admission needs the actual Linux allocation call.
    library = ctypes.CDLL(None, use_errno=True)
    operation = library.fallocate
    operation.argtypes = (ctypes.c_int, ctypes.c_int, ctypes.c_longlong, ctypes.c_longlong)
    operation.restype = ctypes.c_int
    if operation(descriptor, 0, 0, amount):
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code))


def allocation_probe(value, required_bytes, *, nearest_existing=True, expected_device=None,
                     retained=None, expected_writer=None):
    """Allocate the exact requested extent through the original writer.

    By default the anonymous extent is released before return, preserving the
    explicit observer/placement API. Native admission may supply its outer
    ExitStack: the returned extent then survives until its ledger claim commits.
    The returned observation records the actual release when that stack closes.
    """
    if type(required_bytes) is not int or not 0 < required_bytes <= (1 << 63) - 1:
        raise ValueError("Allocation bytes must be a positive signed 64-bit integer")
    if retained is not None and not callable(getattr(retained, "callback", None)):
        raise ValueError("Retained allocation requires a caller-owned ExitStack")
    result = {"requested_path": str(value), "requested_bytes": required_bytes,
              "source": "linux_fallocate_anonymous_file", "started_at": _now(),
              "status": "error", "allocation_released": False,
              "allocation_guaranteed_after_release": False}
    directory = descriptor = None

    def release():
        nonlocal directory, descriptor
        if descriptor is not None:
            selected, descriptor = descriptor, None
            try:
                os.close(selected)
                result["allocation_released"] = True
                result["released_at"] = _now()
            except OSError as exc:
                result.update(status="error", release_error=_error(exc))
        if directory is not None:
            selected, directory = directory, None
            try:
                os.close(selected)
            except OSError as exc:
                result.update(status="error", directory_close_error=_error(exc))

    try:
        if (not sys.platform.startswith("linux") or ctypes.sizeof(ctypes.c_long) != 8
                or not hasattr(os, "O_TMPFILE")):
            raise NotImplementedError("Native anonymous Linux allocation is unavailable")
        writer = _allocation_writer()
        if writer.get("status") != "ok" or (expected_writer is not None and writer != expected_writer):
            raise ValueError("Allocation writer differs from the observed native writer")
        supplied = Path(value).expanduser()
        original = supplied.resolve(strict=not nearest_existing)
        path = original
        while nearest_existing and not path.exists() and path != path.parent:
            path = path.parent
        if path.is_file():
            path = path.parent
        directory = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
        parent = os.fstat(directory)
        if expected_device is not None and parent.st_dev != expected_device:
            raise ValueError("Allocation directory moved to a different filesystem")
        result.update(allocation_directory=str(path), device=parent.st_dev,
                      directory_inode=parent.st_ino, writer=writer)
        before = os.fstatvfs(directory)
        if before.f_flag & getattr(os, "ST_RDONLY", 1):
            raise OSError(errno.EROFS, "Allocation filesystem is read-only")
        unit = before.f_frsize or before.f_bsize
        result.update(counter_available_bytes=before.f_bavail * unit,
                      physical_free_bytes=before.f_bfree * unit)
        descriptor = os.open(".", os.O_TMPFILE | os.O_EXCL | os.O_RDWR | os.O_CLOEXEC,
                             0o600, dir_fd=directory)
        _linux_fallocate(descriptor, required_bytes)
        os.fsync(descriptor)
        allocated = os.fstat(descriptor)
        current = os.stat(path, follow_symlinks=False)
        if ((current.st_dev, current.st_ino) != (parent.st_dev, parent.st_ino)
                or supplied.resolve(strict=not nearest_existing) != original
                or allocated.st_dev != parent.st_dev or allocated.st_size != required_bytes
                or allocated.st_nlink != 0 or allocated.st_blocks * 512 < required_bytes
                or _allocation_writer() != writer):
            raise ValueError("Anonymous allocation writer, directory or extent changed")
        if os.fstatvfs(directory).f_flag & getattr(os, "ST_RDONLY", 1):
            raise OSError(errno.EROFS, "Allocation filesystem became read-only")
        result.update(status="ok", allocated_extent_bytes=required_bytes,
                      allocated_blocks_bytes=allocated.st_blocks * 512)
        if retained is not None:
            retained.callback(release)
    except (OSError, ValueError, RuntimeError, NotImplementedError, AttributeError) as exc:
        result.update(status="error", error={**_error(exc), "message": str(exc)})
    finally:
        if retained is None or result["status"] != "ok":
            release()
        result["finished_at"] = _now()
    return result


def snapshot(paths=None, *, nearest_existing=False, process_rss=False,
             max_processes=256, max_process_bytes=1048576, storage_roots=None,
             process_storage=False, storage_sample_seconds=0,
             include_memory=True, include_filesystems=True):
    """Observe capacity for an existing caller without creating directories.

    Filesystem aliases share the returned device and are never summed. A future
    output path can observe its existing ancestor explicitly; memory-backed
    storage still consumes the separately observed cgroup/host memory budget.
    """
    if type(include_memory) is not bool or type(include_filesystems) is not bool:
        raise ValueError("Capacity observation scope requires explicit booleans")
    report = {"schema": SCHEMA, "started_at": _now()}
    if include_memory:
        report.update(host_memory=_host_memory(), cgroup_memory=_cgroup_memory())
    if include_filesystems:
        report["filesystems"] = _filesystem_observations(paths or ["."],
            nearest_existing=nearest_existing)
    if process_rss:
        report["process_rss"] = _process_rss(max_processes, max_process_bytes)
    if storage_roots or process_storage or storage_sample_seconds:
        if __package__:
            from .worker_storage import storage_consumers
        else:
            from worker_storage import storage_consumers
        try:
            report["storage_consumers"] = storage_consumers(storage_roots or paths or ["."],
                include_processes=process_storage, sample_seconds=storage_sample_seconds)
        except (OSError, ValueError) as exc:
            report["storage_consumers"] = {"status": "error", "error": _error(exc), "message": str(exc)}
    report["finished_at"] = _now()
    return report


def _process_row(raw, expected_pid):
    fields = {}
    for line in raw.splitlines():
        key, separator, value = line.partition(b":")
        if separator and key in (b"Name", b"Pid", b"PPid", b"VmRSS"):
            if key in fields:
                raise ValueError("duplicate process status field")
            fields[key] = value
    if not {b"Name", b"Pid", b"PPid"}.issubset(fields):
        raise ValueError("missing process status field")
    pid = _nonnegative(fields[b"Pid"].strip().decode("ascii"))
    parent_pid = _nonnegative(fields[b"PPid"].strip().decode("ascii"))
    if pid != expected_pid:
        raise ValueError("process status PID differs from directory")
    name = fields[b"Name"]
    name = name[1:] if name.startswith(b"\t") else name.lstrip(b" ")
    rss = None
    if b"VmRSS" in fields:
        value, unit = fields[b"VmRSS"].decode("ascii").split()
        if unit != "kB":
            raise ValueError("unexpected process RSS unit")
        rss = _nonnegative(value) * 1024
    return {"pid": pid, "parent_pid": parent_pid,
            "name": name.decode("utf-8", errors="backslashreplace"), "rss_bytes": rss}


def _process_rss(max_processes, max_status_bytes):
    coverage = {"max_processes": max_processes, "max_status_bytes": max_status_bytes,
                "max_bytes_per_status": PROCESS_STATUS_BYTES,
                "max_directory_entries": max_processes + 1024,
                "directory_entries_seen": 0, "pid_entries_seen": 0,
                "status_files_attempted": 0, "status_bytes_read": 0,
                "processes_returned": 0, "processes_with_rss": 0,
                "enumeration_complete": False, "stop_reason": None,
                "pending_pid": None, "unavailable_status_files": [],
                "truncated_status_files": [], "missing_rss_pids": []}
    result = {"source": "/proc/[pid]/status", "scope": "visible_procfs_processes",
              "status": "unavailable", "processes": [], "rss_sum_bytes": None,
              "coverage": coverage}
    try:
        with os.scandir("/proc") as entries:
            while coverage["directory_entries_seen"] < coverage["max_directory_entries"]:
                try:
                    entry = next(entries)
                except StopIteration:
                    coverage["enumeration_complete"] = True
                    break
                coverage["directory_entries_seen"] += 1
                if not entry.name.isascii() or not entry.name.isdecimal():
                    continue
                pid = int(entry.name)
                coverage["pid_entries_seen"] += 1
                if coverage["status_files_attempted"] >= max_processes:
                    coverage.update(stop_reason="process_limit", pending_pid=pid)
                    break
                remaining = max_status_bytes - coverage["status_bytes_read"]
                if remaining == 0:
                    coverage.update(stop_reason="total_byte_limit", pending_pid=pid)
                    break
                allowance = min(PROCESS_STATUS_BYTES, remaining)
                raw = bytearray()
                complete = False
                coverage["status_files_attempted"] += 1
                try:
                    with open(entry.path + "/status", "rb", buffering=0) as stream:
                        while len(raw) < allowance:
                            chunk = stream.read(min(8192, allowance - len(raw)))
                            if not chunk:
                                complete = True
                                break
                            raw.extend(chunk)
                            coverage["status_bytes_read"] += len(chunk)
                except OSError as exc:
                    coverage["unavailable_status_files"].append({"pid": pid, "error": _error(exc)})
                    continue
                if not complete:
                    reason = "total_byte_limit" if coverage["status_bytes_read"] == max_status_bytes else "per_status_byte_limit"
                    coverage["truncated_status_files"].append({"pid": pid, "reason": reason,
                                                              "bytes_read": len(raw)})
                    if reason == "total_byte_limit":
                        coverage["stop_reason"] = reason
                        break
                    continue
                try:
                    row = _process_row(bytes(raw), pid)
                except (UnicodeError, ValueError) as exc:
                    coverage["unavailable_status_files"].append({"pid": pid, "error": _error(exc)})
                    continue
                result["processes"].append(row)
                if row["rss_bytes"] is None:
                    coverage["missing_rss_pids"].append(pid)
            else:
                coverage["stop_reason"] = "directory_entry_limit"
    except OSError as exc:
        result["error"] = _error(exc)
        coverage["stop_reason"] = "directory_read_error"
    rows = result["processes"]
    rows.sort(key=lambda row: (row["rss_bytes"] is None, -(row["rss_bytes"] or 0), row["pid"]))
    coverage["processes_returned"] = len(rows)
    known = [row["rss_bytes"] for row in rows if row["rss_bytes"] is not None]
    coverage["processes_with_rss"] = len(known)
    result["rss_sum_bytes"] = sum(known) if known else None
    if "error" not in result or coverage["status_files_attempted"]:
        result["status"] = "ok" if (coverage["enumeration_complete"]
            and not coverage["unavailable_status_files"]
            and not coverage["truncated_status_files"]
            and not coverage["missing_rss_pids"]) else "partial"
    return result


def _positive_limit(maximum):
    def parse(raw):
        try:
            value = _nonnegative(raw)
        except ValueError as exc:
            raise argparse.ArgumentTypeError("expected an integer from 1 to " + str(maximum)) from exc
        if not 1 <= value <= maximum:
            raise argparse.ArgumentTypeError("expected an integer from 1 to " + str(maximum))
        return value
    return parse


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--path", action="append", help="existing file/directory; repeat for each output filesystem (default: current directory)")
    parser.add_argument("--scope", choices=("all", "memory", "filesystems"), default="all",
                        help="read all capacity by default, or only the selected resource fields")
    parser.add_argument("--allocation-probe", action="append", default=[], metavar="PATH=MIB",
                        help="explicitly allocate and release this exact positive whole-MiB extent; repeat per destination")
    parser.add_argument("--reclaim-current-cgroup", type=_positive_limit(1024), metavar="MIB",
                        help="explicitly request one current-cgroup reclaim of 1..1024 MiB; retain actual before/after counters")
    parser.add_argument("--process-rss", action="store_true", help="include a bounded read of visible process PID, parent, short name and RSS")
    parser.add_argument("--max-processes", type=_positive_limit(4096), default=256,
                        help="status-file attempts with --process-rss (1..4096; default: 256)")
    parser.add_argument("--max-process-bytes", type=_positive_limit(8388608), default=1048576,
                        help="total status bytes with --process-rss (1..8388608; default: 1048576)")
    parser.add_argument("--storage-root", action="append",
                        help="walk metadata beneath this directory and report per-child allocated bytes; repeat for independent roots")
    parser.add_argument("--process-storage", action="store_true",
                        help="include matching live process cwd/open-file metadata for selected storage roots")
    parser.add_argument("--storage-sample-seconds", type=float, default=0,
                        help="sample matching process writes and filesystem changes for 0..30 seconds")
    args = parser.parse_args(argv)
    report = snapshot(args.path, process_rss=args.process_rss,
                      max_processes=args.max_processes, max_process_bytes=args.max_process_bytes,
                      storage_roots=args.storage_root, process_storage=args.process_storage,
                      storage_sample_seconds=args.storage_sample_seconds,
                      include_memory=args.scope != "filesystems",
                      include_filesystems=args.scope != "memory")
    if args.reclaim_current_cgroup is not None:
        report["current_cgroup_reclaim"] = reclaim_current_cgroup(args.reclaim_current_cgroup * 1024 * 1024)
    if args.allocation_probe:
        probes = []
        for declaration in args.allocation_probe:
            path, separator, amount = declaration.rpartition("=")
            if not separator or not path or not re.fullmatch(r"[0-9]+", amount) or int(amount) <= 0:
                parser.error("--allocation-probe requires PATH=positive-whole-MIB")
            probes.append(allocation_probe(path, int(amount) * 1024 * 1024))
        report["allocation_probes"] = probes
    print(json.dumps(report, indent=2, ensure_ascii=True, allow_nan=False))
    return 2 if (any(row["status"] == "error" for row in report.get("filesystems", []))
        or report.get("storage_consumers", {}).get("status") == "error"
        or any(row["status"] != "ok" for row in report.get("allocation_probes", []))
        or (args.reclaim_current_cgroup is not None
            and (report["current_cgroup_reclaim"]["state"] != "RETURNED"
                 or report["current_cgroup_reclaim"]["current_cgroup_unchanged"] is not True))) else 0


if __name__ == "__main__":
    sys.exit(main())



