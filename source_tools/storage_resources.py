"""Resource accounting for streamed original-source capture.

Inspect the destination filesystem and the current Linux cgroup hierarchy.
A disk-backed HTTP range retains only its read/write buffers in process memory;
a tmpfs range also consumes memory for every appended byte. Clean filesystem
cache can be reclaimed under cgroup pressure; shared-memory pages cannot.
This module observes resources and plans writes. It changes no host settings.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re

SCHEMA = "upstate.streamed-source-capacity/v1"
MIB = 1024 * 1024
MEMORY_FILESYSTEMS = {"tmpfs", "ramfs", "hugetlbfs"}


def _text(path):
    try:
        return Path(path).read_text(encoding="utf-8").strip()
    except (OSError, UnicodeError):
        return None


def _integer(value):
    if value is None or value == "max":
        return None
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if 0 <= number < (1 << 60) else None


def _values(path):
    result = {}
    for line in (_text(path) or "").splitlines():
        fields = line.split()
        if len(fields) == 2 and fields[1].isdigit():
            result[fields[0]] = int(fields[1])
    return result


def _mount_unescape(value):
    return re.sub(r"\\([0-7]{3})", lambda match: chr(int(match[1], 8)), value)


def _mounts():
    result = []
    for line in (_text("/proc/self/mountinfo") or "").splitlines():
        left, separator, right = line.partition(" - ")
        fields, detail = left.split(), right.split()
        if not separator or len(fields) < 6 or len(detail) < 3:
            continue
        result.append({
            "id": fields[0], "root": _mount_unescape(fields[3]),
            "mountpoint": _mount_unescape(fields[4]), "options": fields[5],
            "filesystem": detail[0], "source": _mount_unescape(detail[1]),
            "super_options": detail[2],
        })
    return result


def _beneath(path, root):
    return path == root or path.startswith(root.rstrip("/") + "/")


def filesystem_snapshot(path, *, mounts=None):
    requested = Path(path).expanduser().absolute()
    resolved = requested.resolve(strict=False)
    probe = resolved
    while not probe.exists() and probe != probe.parent:
        probe = probe.parent
    stat = probe.stat()
    usage = os.statvfs(probe)
    candidates = [row for row in (mounts if mounts is not None else _mounts())
                  if _beneath(str(resolved), row["mountpoint"])]
    # A later overmount at the same path is the visible mount.
    selected = max(enumerate(candidates),
                   key=lambda pair: (len(pair[1]["mountpoint"]), pair[0]))[1] if candidates else {}
    filesystem = selected.get("filesystem")
    available = usage.f_bavail * usage.f_frsize
    free = usage.f_bfree * usage.f_frsize
    return {
        "requested_path": str(requested), "resolved_path": str(resolved),
        "probe_path": str(probe), "device": stat.st_dev,
        "mountpoint": selected.get("mountpoint"), "filesystem": filesystem,
        "memory_backed": filesystem in MEMORY_FILESYSTEMS if filesystem else None,
        "read_only": bool(usage.f_flag & getattr(os, "ST_RDONLY", 1)),
        "allocation_unit_bytes": usage.f_frsize,
        "total_bytes": usage.f_blocks * usage.f_frsize,
        "available_bytes": available, "free_including_reserved_bytes": free,
        "reserved_bytes": max(0, free - available),
        "available_inodes": usage.f_favail,
    }


def _cgroup_locations(mounts):
    result = []
    for line in (_text("/proc/self/cgroup") or "").splitlines():
        fields = line.split(":", 2)
        if len(fields) != 3:
            continue
        hierarchy, controllers, member = fields
        version = 2 if hierarchy == "0" and not controllers else 1
        if version == 1 and "memory" not in controllers.split(","):
            continue
        for mount in mounts:
            if version == 2 and mount["filesystem"] != "cgroup2":
                continue
            if version == 1 and (mount["filesystem"] != "cgroup" or
                    "memory" not in (mount["super_options"] + "," + mount["options"] +
                                     "," + mount["source"]).split(",")):
                continue
            mountpoint = Path(mount["mountpoint"])
            mount_root = mount["root"]
            if _beneath(member, mount_root):
                suffix = member[len(mount_root):].lstrip("/")
            else:
                # In a cgroup namespace, "/" is relative to the visible mount.
                suffix = member.lstrip("/")
            selected = mountpoint / suffix
            if selected.is_dir():
                result.append((version, selected, mountpoint))
    return result


def _cgroup_sample(path, version):
    current_name = "memory.current" if version == 2 else "memory.usage_in_bytes"
    maximum_name = "memory.max" if version == 2 else "memory.limit_in_bytes"
    high_name = "memory.high" if version == 2 else "memory.soft_limit_in_bytes"
    current = _integer(_text(path / current_name))
    maximum = _integer(_text(path / maximum_name))
    if current is None:
        return None
    raw = _values(path / "memory.stat")

    def count(name, fallback=None):
        if version == 1 and "total_" + name in raw:
            return raw["total_" + name]
        return raw.get(name, fallback)

    file_bytes = count("file" if version == 2 else "cache")
    shmem = count("shmem", 0)
    inactive_file = count("inactive_file", 0)
    active_file = count("active_file", 0)
    dirty = count("file_dirty" if version == 2 else "dirty", 0)
    writeback = count("file_writeback" if version == 2 else "writeback", 0)
    file_lru = inactive_file + active_file
    # File-LRU accounting excludes tmpfs/anonymous LRU pages. The independent
    # file-minus-shmem cap prevents shared-memory cache from being counted twice.
    file_cap = file_lru if file_bytes is None else max(0, file_bytes - shmem)
    reclaimable = max(0, min(file_lru, file_cap) - dirty - writeback)
    headroom = max(0, maximum - current) if maximum is not None else None
    reclaim_available = (max(0, min(maximum, maximum - current + reclaimable))
                         if maximum is not None else None)
    return {
        "version": version, "path": str(path), "current_bytes": current,
        "maximum_bytes": maximum, "high_bytes": _integer(_text(path / high_name)),
        "headroom_bytes": headroom, "file_bytes": file_bytes, "shmem_bytes": shmem,
        "active_file_bytes": active_file, "inactive_file_bytes": inactive_file,
        "dirty_file_bytes": dirty, "writeback_bytes": writeback,
        "reclaimable_clean_file_bytes": reclaimable,
        "available_with_reclaim_bytes": reclaim_available,
    }


def memory_snapshot(*, mounts=None):
    selected_mounts = mounts if mounts is not None else _mounts()
    meminfo = {}
    for line in (_text("/proc/meminfo") or "").splitlines():
        name, separator, rest = line.partition(":")
        fields = rest.split()
        if separator and fields and fields[0].isdigit():
            meminfo[name] = int(fields[0]) * (1024 if len(fields) > 1 and fields[1] == "kB" else 1)
    host_available = meminfo.get("MemAvailable", meminfo.get("MemFree"))
    groups, seen = [], set()
    for version, selected, mountpoint in _cgroup_locations(selected_mounts):
        path = selected
        while _beneath(str(path), str(mountpoint)):
            key = (version, str(path))
            if key not in seen:
                seen.add(key)
                sample = _cgroup_sample(path, version)
                if sample is not None:
                    groups.append(sample)
            if path == mountpoint:
                break
            path = path.parent
    finite_groups = [row for row in groups if row["available_with_reclaim_bytes"] is not None]
    limiting = min(finite_groups, key=lambda row: row["available_with_reclaim_bytes"]) if finite_groups else None
    available_values = ([host_available] if host_available is not None else []) + [
        row["available_with_reclaim_bytes"] for row in finite_groups]
    return {
        "host_available_bytes": host_available, "host_total_bytes": meminfo.get("MemTotal"),
        "effective_available_bytes": min(available_values) if available_values else None,
        "limiting_cgroup": limiting, "cgroups": groups,
        "accounting": "minimum host MemAvailable and each finite cgroup limit minus current plus reclaimable clean file LRU; shmem, dirty and writeback excluded",
    }


def capacity_snapshot(path):
    mounts = _mounts()
    filesystem = filesystem_snapshot(path, mounts=mounts)
    memory = memory_snapshot(mounts=mounts)
    limiting = memory["limiting_cgroup"] or {}
    return {
        "schema": SCHEMA, "observed_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "filesystem": filesystem, "memory": memory,
        # Preserve useful fields from the original continuation progress record.
        "filesystem_available_bytes": filesystem["available_bytes"],
        "memory_available_bytes": memory["effective_available_bytes"],
        "memory_headroom_bytes": limiting.get("headroom_bytes"),
        "memory.current": limiting.get("current_bytes"),
        "memory.max": limiting.get("maximum_bytes"),
    }


def plan_range_capacity(snapshot, append_bytes, *, stream_buffer_bytes=MIB,
                        disk_reserve_bytes=4*MIB, memory_reserve_bytes=4*MIB):
    """Plan the next contiguous range using the receiver's actual read buffer."""
    for name, value, positive in (
            ("append_bytes", append_bytes, True),
            ("stream_buffer_bytes", stream_buffer_bytes, True),
            ("disk_reserve_bytes", disk_reserve_bytes, False),
            ("memory_reserve_bytes", memory_reserve_bytes, False)):
        if type(value) is not int or value < (1 if positive else 0):
            raise ValueError(name + " must be a " + ("positive" if positive else "nonnegative") + " integer")
    filesystem, memory = snapshot["filesystem"], snapshot["memory"]
    # Two buffers cover response.read and a partial-write bytes slice.
    streamed_memory = 2 * stream_buffer_bytes
    retained_memory = append_bytes if filesystem["memory_backed"] is not False else 0
    required_storage = append_bytes + disk_reserve_bytes
    required_memory = retained_memory + streamed_memory + memory_reserve_bytes
    available_memory = memory["effective_available_bytes"]
    storage_ok = (not filesystem["read_only"] and
                  filesystem["available_bytes"] >= required_storage)
    memory_ok = available_memory >= required_memory if available_memory is not None else None
    reasons = []
    if filesystem["read_only"]:
        reasons.append("destination filesystem is read-only")
    if filesystem["available_bytes"] < required_storage:
        reasons.append("destination needs " + str(required_storage) + " bytes; available " +
                       str(filesystem["available_bytes"]))
    if memory_ok is False:
        reasons.append("streamed range needs " + str(required_memory) +
                       " memory bytes; available with clean-file reclaim " + str(available_memory))
    return {
        "append_bytes": append_bytes, "stream_buffer_bytes": stream_buffer_bytes,
        "streamed_memory_bytes": streamed_memory, "retained_memory_bytes": retained_memory,
        "disk_reserve_bytes": disk_reserve_bytes, "memory_reserve_bytes": memory_reserve_bytes,
        "required_storage_bytes": required_storage, "required_memory_bytes": required_memory,
        "storage_ok": storage_ok, "memory_ok": memory_ok,
        "can_start": storage_ok and memory_ok is not False, "reasons": reasons,
        "memory_accounting": ("memory-backed appends plus read/write buffers"
                              if filesystem["memory_backed"] is True else
                              "destination type unobserved; appends conservatively counted in memory"
                              if filesystem["memory_backed"] is None else
                              "read/write buffers; range extent resides on disk"),
        "memory_capacity_observed": available_memory is not None,
    }


def range_capacity(path, append_bytes, **options):
    snapshot = capacity_snapshot(path)
    return {**snapshot, "plan": plan_range_capacity(snapshot, append_bytes, **options)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="+", type=Path)
    parser.add_argument("--append-bytes", type=int)
    parser.add_argument("--stream-buffer-bytes", type=int, default=MIB)
    parser.add_argument("--disk-reserve-bytes", type=int, default=4*MIB)
    parser.add_argument("--memory-reserve-bytes", type=int, default=4*MIB)
    args = parser.parse_args()
    rows = []
    for path in args.paths:
        value = (range_capacity(path, args.append_bytes,
                    stream_buffer_bytes=args.stream_buffer_bytes,
                    disk_reserve_bytes=args.disk_reserve_bytes,
                    memory_reserve_bytes=args.memory_reserve_bytes)
                 if args.append_bytes is not None else capacity_snapshot(path))
        rows.append(value)
    print(json.dumps(rows, sort_keys=True, indent=2))
    if any(row.get("plan", {}).get("can_start") is False for row in rows):
        raise SystemExit(75)


if __name__ == "__main__":
    main()
