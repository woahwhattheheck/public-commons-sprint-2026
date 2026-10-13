"""Cooperative memory admission inside the original native supervisor.

The shared index contains reservations for original operation records. The
native supervisor owns waiting, command execution, stop, and recovery. Capacity
comes from worker_capacity; this module never changes limits or signals peers.
"""
from __future__ import annotations

from contextlib import contextmanager
from copy import deepcopy
import fcntl
import hashlib
import json
import os
from pathlib import Path
import resource
import time

if __package__:
    from . import swarm_cloud_job as native
    from . import native_reservation as reservation_lifetime
    from .worker_capacity import snapshot
    from .capacity_fairness import reserve_headroom, memory_backed_storage, STORAGE_MODES
else:
    import swarm_cloud_job as native
    import native_reservation as reservation_lifetime
    from worker_capacity import snapshot
    from capacity_fairness import reserve_headroom, memory_backed_storage, STORAGE_MODES

SCHEMA = "commons.native-cloud-memory/v1"
RECLAIM_MODES = ("none", "clean-cache")
MIB = 1024 * 1024
DEFAULT_ROOT = "/workspace/shared/swarm/capacity/memory"
TREE_SCOPE = "original_command_descendants"
MAX_TREE_PROCESSES = 256


def memory_intent_sha256(value):
    """Identify the exact retained declaration, including future native fields."""
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                     ensure_ascii=False).encode()).hexdigest()


def amend_request(root, *, amendment_id, expected_memory_sha256, memory_mib,
                  reason, reserve_mib=None, reclaim_mode=None, storage_mode=None):
    """Explicitly revise an original memory declaration before any dispatch.

    Request and prior declaration travel in one atomic native save. The original
    admission loop retires dead reservations and reuses the saved queue sequence;
    this operation neither edits that ledger nor launches a process.
    """
    root = Path(root).expanduser().resolve(strict=True)
    if not isinstance(amendment_id, str) or not 1 <= len(amendment_id) <= 128 or any(
            c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-"
            for c in amendment_id):
        raise ValueError("Supply a stable amendment ID using letters, digits, dot, underscore or hyphen")
    if (not isinstance(expected_memory_sha256, str) or len(expected_memory_sha256) != 64 or
            any(c not in "0123456789abcdef" for c in expected_memory_sha256)):
        raise ValueError("Supply the SHA-256 of the exact original memory declaration")
    if not isinstance(reason, str) or not reason.strip() or len(reason) > 2000:
        raise ValueError("Describe the concrete change behind this memory declaration")
    reason = reason.strip()
    # Validate supplied numbers/mode without changing an existing placement.
    specification(memory_mib, 0 if reserve_mib is None else reserve_mib,
                  reclaim_mode="none" if reclaim_mode is None else reclaim_mode,
                  storage_mode="included" if storage_mode is None else storage_mode)
    changes = {"memory_mib": memory_mib, "reserve_mib": reserve_mib,
               "reclaim_mode": reclaim_mode}
    if storage_mode is not None:
        changes["storage_mode"] = storage_mode
    with native.run_lock(root):
        request = native.read_json(root / "request.json")
        if (not request or request.get("schema") != native.SCHEMA or
                not isinstance(request.get("intent", {}).get("memory"), dict)):
            raise ValueError("Select an original operation with its retained memory request")
        intent = request["intent"]
        if native.run_path(intent["operation_id"], root.parent).resolve() != root:
            raise ValueError("The retained request differs from this original operation path")
        previous = intent["memory"]
        history = request.get("memory_amendments", [])
        if not isinstance(history, list) or any(not isinstance(row, dict) for row in history):
            raise ValueError("Preserve the original memory amendment history")
        matching = [row for row in history if row.get("amendment_id") == amendment_id]
        if matching:
            if len(matching) != 1:
                raise ValueError("The original amendment identity is duplicated")
            event = matching[0]
            if (event.get("changes") != changes or event.get("reason") != reason or
                    event.get("previous_sha256") != expected_memory_sha256):
                raise ValueError("This amendment ID already records a different declaration")
            return {"schema": SCHEMA, "operation_id": intent["operation_id"],
                    "record": str(root), "amended": False, "reused": True,
                    "amendment": event, "memory": previous,
                    "memory_sha256": memory_intent_sha256(previous),
                    "superseded": previous != event.get("next")}
        if memory_intent_sha256(previous) != expected_memory_sha256:
            raise ValueError("The retained memory declaration changed; read its current intent before amending")
        # Preserve byte-identical amendment replay above; every new mutation
        # below owns the original supervisor inode before reading its state.
        with native.supervisor_lock(root, reuse_current=True) as descriptor:
            if descriptor is None:
                raise ValueError("The original supervisor lifetime lock is held; preserve its request")
            state = native.read_json(root / "state.json") or {}
            if native._legacy_queue_gate_pending(root, state):
                raise ValueError("Preserve the legacy queue gate until its original parent has observed its exit")
            supervisor = state.get("supervisor")
            if (not isinstance(supervisor, dict) or
                    not all(key in supervisor for key in ("proc_pid", "start_ticks", "boot_id"))):
                raise ValueError("The original queued supervisor identity is missing")
            if native.alive(supervisor):
                raise ValueError("The original supervisor is still alive; preserve its current operation")
            queue_state = state.get("state")
            disk = intent.get("disk")
            combined_queue = (queue_state == "queued_disk" and isinstance(disk, dict) and
                              isinstance(disk.get("paths"), list) and bool(disk["paths"]))
            if ((queue_state != "queued_memory" and not combined_queue) or state.get("process") or any(
                    (root / name).exists() for name in ("process.json", "output.log", "result.json",
                                                       "command-completion.dat", "stop-request.json"))):
                raise ValueError("Only a dead original memory or combined disk/memory queue with no command or stop artifacts may be amended")
            if (root / "runtime-handoff.json").exists():
                if __package__:
                    from . import native_runtime_handoff
                else:
                    import native_runtime_handoff
                handoff = native_runtime_handoff.active(native, root)
                if handoff and handoff.get("phase") not in ("resumed", "resumed_elsewhere"):
                    raise ValueError("Complete the original runtime handoff before amending its bound memory request")
            updated = dict(previous)
            updated["peak_bytes"] = memory_mib * MIB
            if reserve_mib is not None:
                updated["reserve_bytes"] = reserve_mib * MIB
            if reclaim_mode is not None:
                if reclaim_mode == "none":
                    updated.pop("reclaim_mode", None)
                else:
                    updated["reclaim_mode"] = reclaim_mode
            if storage_mode is not None:
                if storage_mode == "included":
                    updated.pop("storage_mode", None)
                else:
                    updated["storage_mode"] = storage_mode
            if updated == previous:
                raise ValueError("The proposed declaration is already the retained memory intent")
            observation = native.read_json(root / "memory.json") or {}
            sequence = observation.get("sequence") if observation.get("operation_id") == intent["operation_id"] else None
            event = {"amendment_id": amendment_id, "amended_at": native.now(),
                     "reason": reason, "changes": changes,
                     "previous": previous, "previous_sha256": expected_memory_sha256,
                     "next": updated, "next_sha256": memory_intent_sha256(updated),
                     "sequence": sequence, "previous_state": queue_state,
                     "previous_supervisor": supervisor,
                     "command_previously_started": False}
            revised = {**request, "intent": {**intent, "memory": updated},
                       "memory_amendments": [*history, event]}
            if (root / "offload.json").exists():
                # The prepared source binding remains immutable. Its original
                # reader must be able to reconnect this exact amendment chain.
                if __package__:
                    from . import offload_build
                else:
                    import offload_build
                reader = getattr(offload_build, "memory_for_native_start", None)
                expected_reader = Path(native.__file__).resolve().parent / "offload_build.py"
                if (Path(offload_build.__file__).resolve() != expected_reader.resolve() or
                        not callable(reader)):
                    raise ValueError("Install the cumulative original offload memory reader before amending a prepared source binding")
                binding = native.read_json(root / "offload.json")
                if reader(binding, revised) != updated:
                    raise ValueError("The original prepared source binding does not match this memory amendment")
            native.save_json(root / "request.json", revised)
            return {"schema": SCHEMA, "operation_id": intent["operation_id"],
                    "record": str(root), "amended": True, "reused": False,
                    "amendment": event, "memory": updated,
                    "memory_sha256": event["next_sha256"], "superseded": False}


def specification(memory_mib, reserve_mib=256, ledger_root=None, reclaim_mode="none",
                  storage_mode="included"):
    if type(memory_mib) is not int or memory_mib < 1:
        raise ValueError("memory_mib must be the positive peak MiB requested by this original job")
    if type(reserve_mib) is not int or reserve_mib < 0:
        raise ValueError("memory_reserve_mib must be a nonnegative MiB value")
    if reclaim_mode not in RECLAIM_MODES:
        raise ValueError("memory_reclaim must be none or clean-cache")
    if storage_mode not in STORAGE_MODES:
        raise ValueError("memory_storage must be included or additional")
    path = Path(ledger_root or os.environ.get("SWARM_MEMORY_RESERVATIONS_ROOT", DEFAULT_ROOT)).expanduser().resolve()
    value = {"peak_bytes": memory_mib * MIB, "reserve_bytes": reserve_mib * MIB,
             "ledger_root": str(path)}
    # Omission retains the exact intent of already submitted original jobs.
    if reclaim_mode != "none":
        value["reclaim_mode"] = reclaim_mode
    if storage_mode != "included":
        value["storage_mode"] = storage_mode
    return value


def _reclaimable_cache(directory):
    """Estimate kernel-reclaimable cache, preserving every input counter.

    File LRU lists exclude shmem but can differ from type-based counters.
    Use the smaller bound and exclude mapped/dirty/writeback file pages.
    Reclaimable slab can contain objects still in use. Retain half rather
    than treating the complete counter as allocatable memory. This is a
    scheduling estimate; host MemAvailable and every ancestor still apply.
    This reads counters only; it never requests reclaim or drops caches.
    """
    keys = {"file", "shmem", "inactive_file", "active_file", "file_mapped",
            "file_dirty", "file_writeback", "slab_reclaimable"}
    try:
        with (Path(directory) / "memory.stat").open(encoding="ascii") as stream:
            raw = stream.read(65537)
        if len(raw) > 65536:
            raise ValueError("memory.stat exceeds the counter read limit")
        values = {}
        for line in raw.splitlines():
            key, value = line.split()
            if key in keys:
                if not value.isdecimal():
                    raise ValueError("invalid cgroup memory.stat counter")
                values[key] = int(value)
        if set(values) != keys:
            raise ValueError("cgroup reclaim counters incomplete")
        file_bytes = max(0, min(max(0, values["file"] - values["shmem"]),
                                values["inactive_file"] + values["active_file"]) -
                         values["file_mapped"] - values["file_dirty"] - values["file_writeback"])
        slab_credit = values["slab_reclaimable"] // 2
        return {"status": "estimated", "method": "clean-file-half-slab/v1",
                "stat_bytes": values, "clean_unmapped_file_bytes": file_bytes,
                "slab_reclaimable_bytes": values["slab_reclaimable"],
                "slab_credit_bytes": slab_credit,
                "slab_withheld_bytes": values["slab_reclaimable"] - slab_credit,
                "estimated_bytes": file_bytes + slab_credit}
    except (OSError, UnicodeError, ValueError) as exc:
        return {"status": "unavailable", "estimated_bytes": 0, "error": type(exc).__name__}


def _memory_resources(report):
    """Keep every visible finite ancestor; inode keys survive mount aliases."""
    rows = []
    host = report["host_memory"]
    if type(host.get("available_bytes")) is int:
        rows.append({"id": "host", "kind": "host", "available_bytes": host["available_bytes"],
                     "limit_bytes": host.get("total_bytes"), "source": host["source"]})
    group = report["cgroup_memory"]
    for level in group["levels"]:
        if level.get("max_status") != "finite" or type(level.get("headroom_bytes")) is not int:
            continue
        metadata = Path(level["directory"]).stat()
        cache = _reclaimable_cache(level["directory"])
        rows.append({"id": f"cgroup:{metadata.st_dev}:{metadata.st_ino}", "kind": "cgroup",
                     "available_bytes": level["headroom_bytes"], "limit_bytes": level["max_bytes"],
                     "current_bytes": level["current_bytes"], "source": level["directory"],
                     "raw_headroom_bytes": level["headroom_bytes"], "cache_reclaim": cache,
                     "reclaimable_cache_bytes": min(max(0, level["current_bytes"]), cache["estimated_bytes"])})
    return list({row["id"]: row for row in rows}.values())


def _available(capacity, reclaim_mode):
    # Host MemAvailable already estimates reclaim; never add cgroup cache to it.
    credit = capacity.get("reclaimable_cache_bytes", 0) if reclaim_mode == "clean-cache" else 0
    if capacity["kind"] == "cgroup":
        return max(0, min(capacity["limit_bytes"],
                          capacity["limit_bytes"] - capacity["current_bytes"] + credit))
    return capacity["available_bytes"]


def _process_resident(identity):
    result = {"rss_bytes": 0, "private_bytes": 0, "status": "no_live_original_process"}
    if not native.alive(identity):
        return result
    try:
        values = {}
        path = Path("/proc") / str(identity["proc_pid"]) / "smaps_rollup"
        for line in path.read_text(encoding="ascii").splitlines():
            key, separator, raw = line.partition(":")
            if separator and key in {"Rss", "Private_Clean", "Private_Dirty", "Private_Hugetlb"}:
                value, unit = raw.split()
                if unit != "kB" or not value.isdecimal():
                    raise ValueError("unexpected original process memory counter")
                values[key] = int(value) * 1024
        if not {"Rss", "Private_Clean", "Private_Dirty"}.issubset(values):
            raise ValueError("original process memory counters incomplete")
        if not native.alive(identity):
            return result
        return {"rss_bytes": values["Rss"],
                "private_bytes": values["Private_Clean"] + values["Private_Dirty"],
                "private_hugetlb_bytes": values.get("Private_Hugetlb", 0),
                "status": "original_process", "proc_pid": identity["proc_pid"]}
    except (OSError, UnicodeError, ValueError) as exc:
        return {**result, "status": "unavailable", "error": type(exc).__name__}


def _proc_stat(pid):
    """Read only ancestry/lifetime metadata in this observer's procfs view."""
    with (Path("/proc") / str(pid) / "stat").open() as stream:
        raw = stream.read(8193)
    if len(raw) > 8192 or int(raw.split(" ", 1)[0]) != pid:
        raise ValueError("process stat identity differs")
    fields = raw.rsplit(") ", 1)[1].split()
    if fields[0] in ("Z", "X"):
        raise ValueError("process has exited")
    if not fields[19].isdecimal():
        raise ValueError("invalid process start ticks")
    return int(fields[1]), fields[19]


def _process_table():
    # One small stat-only scan per admission attempt or owning sample. Some
    # procfs providers omit task/*/children; no cmdline or environment is read.
    children = {}
    for entry in Path("/proc").iterdir():
        if not entry.name.isdecimal():
            continue
        pid = int(entry.name)
        try:
            parent, start = _proc_stat(pid)
            children.setdefault(parent, []).append((pid, start))
        except (OSError, UnicodeError, ValueError, IndexError):
            continue
    return children


def _process_key(identity):
    return identity["boot_id"], identity["proc_pid"], identity["start_ticks"]


def _memory_group(identity):
    try:
        with (Path("/proc") / str(identity["proc_pid"]) / "cgroup").open() as stream:
            raw = stream.read(8193)
        if len(raw) > 8192:
            return None
        for line in raw.splitlines():
            hierarchy, controllers, path = line.split(":", 2)
            if hierarchy == "0" and not controllers and path.startswith("/"):
                return path.rstrip("/") or "/"
    except (OSError, UnicodeError, ValueError, KeyError):
        pass
    return None


def _within_group(parent, child):
    return bool(parent and child and (parent == child or
                (".." not in child.split("/") and
                 child.startswith(parent.rstrip("/") + "/"))))


def _validated_tree(process, tree, rss_reader=None):
    """Revalidate retained ancestry; expired/reparented branches get no credit.

    The optional RSS reader caps each owner's retained private observation.
    Shared RSS and huge pages never become private-page estimates.
    """
    if not isinstance(tree, dict) or tree.get("scope") != TREE_SCOPE:
        return None
    members = tree.get("processes")
    if not isinstance(members, list) or not 1 <= len(members) <= MAX_TREE_PROCESSES:
        return None
    if not native.alive(process):
        return None
    group = _memory_group(process)
    if tree.get("cgroup_path") != group:
        return None
    accepted, seen = {}, set()
    for offset, member in enumerate(members):
        try:
            identity = member["identity"]
            key, pid = _process_key(identity), identity["proc_pid"]
            if type(pid) is not int or pid in seen:
                return None
            seen.add(pid)
            parent, depth = member["parent_proc_pid"], member["depth"]
            if type(depth) is not int or type(parent) is not int:
                return None
            if offset == 0:
                if key != _process_key(process) or depth != 0:
                    return None
            elif parent not in accepted or depth != accepted[parent]["depth"] + 1:
                continue
            if not native.alive(identity):
                continue
            current_parent, start = _proc_stat(pid)
            if start != identity["start_ticks"] or current_parent != parent:
                continue
            if offset and not _within_group(group, _memory_group(identity)):
                continue
            private, rss = member["private_bytes"], member["rss_bytes"]
            if (type(private) is not int or type(rss) is not int or
                    not 0 <= private <= rss):
                return None
            if member.get("status") != "original_process":
                private = rss = 0
            if rss_reader is not None:
                rss = rss_reader(identity)
                if type(rss) is not int or rss < 0:
                    continue
                private = min(private, rss)
            if not native.alive(identity) or _proc_stat(pid) != (parent, start):
                continue
            accepted[pid] = {**member, "rss_bytes": rss, "private_bytes": private}
        except (OSError, UnicodeError, ValueError, KeyError, TypeError, IndexError):
            continue
    # An ancestor can exit during the scan. Remove its whole branch before
    # publishing credit, and require the exact original command throughout.
    live = {}
    for pid, member in accepted.items():
        try:
            identity = member["identity"]
            if ((member["depth"] and member["parent_proc_pid"] not in live) or
                    not native.alive(identity) or
                    _proc_stat(pid) != (member["parent_proc_pid"], identity["start_ticks"]) or
                    (member["depth"] and not _within_group(group, _memory_group(identity)))):
                continue
            live[pid] = member
        except (OSError, UnicodeError, ValueError, KeyError, TypeError, IndexError):
            continue
    if (process["proc_pid"] not in live or not native.alive(process) or
            _memory_group(process) != group):
        return None
    rows = list(live.values())
    return {"scope": TREE_SCOPE, "cgroup_path": group,
            "processes": rows, "process_count": len(rows),
            "private_bytes": sum(row["private_bytes"] for row in rows),
            "rss_bytes": sum(row["rss_bytes"] for row in rows),
            "unavailable_processes": sum(row.get("status") != "original_process" for row in rows),
            "truncated": bool(tree.get("truncated", False))}



class _LazyProcessTable:
    """Build one stat-only index only if direct descendant sampling consumes it."""
    def __init__(self):
        self.value = None

    def get(self, key, default=None):
        if self.value is None:
            try:
                self.value = _process_table()
            except OSError:
                self.value = {}
        return self.value.get(key, default)


def _peak_with_storage(row):
    return row["peak_bytes"] + row.get("memory_backed_storage", {}).get("additional_bytes", 0)


def _resident(identity, process_table=None):
    memory = _process_resident(identity)
    if memory["status"] != "original_process":
        return memory
    try:
        table = _process_table() if process_table is None else process_table
        parent, start = _proc_stat(identity["proc_pid"])
        if start != identity["start_ticks"]:
            return memory
        members = [{"identity": identity, "parent_proc_pid": parent, "depth": 0, **memory}]
        seen, truncated = {identity["proc_pid"]}, False
        group = _memory_group(identity)
        for member in members:
            for pid, ticks in table.get(member["identity"]["proc_pid"], []):
                if pid in seen:
                    continue
                seen.add(pid)
                if len(members) >= MAX_TREE_PROCESSES:
                    truncated = True
                    break
                try:
                    child = native.identity_at(Path("/proc") / str(pid))
                    if (not child or child["start_ticks"] != ticks or
                            _proc_stat(pid) != (member["identity"]["proc_pid"], ticks) or
                            not _within_group(group, _memory_group(child))):
                        continue
                    members.append({"identity": child, "parent_proc_pid": member["identity"]["proc_pid"],
                                    "depth": member["depth"] + 1, **_process_resident(child)})
                except (OSError, UnicodeError, ValueError, KeyError, TypeError, IndexError):
                    continue
        tree = _validated_tree(identity, {"scope": TREE_SCOPE, "processes": members,
                                          "cgroup_path": group,
                                          "truncated": truncated})
        if tree:
            # Keep v1 root fields unchanged for already-running old readers.
            memory["tree"] = tree
    except (OSError, UnicodeError, ValueError, KeyError, TypeError, IndexError):
        pass
    return memory


def _reservation_credits(participants, observations):
    """Assign an overlapping process once, to its nearest reserved command."""
    owners, amounts = {}, {}
    credits = {key: {"private_bytes": 0, "process_count": 0} for key, _ in participants}
    for key, row in participants:
        observed = observations.get(key, {})
        tree = observed.get("tree")
        members = tree["processes"] if tree else [{"identity": observed.get("process"),
                  "depth": 0, "private_bytes": observed.get("private_bytes", 0),
                  "status": observed.get("status")}]
        for member in members:
            identity, private = member.get("identity"), member.get("private_bytes", 0)
            status = member.get("status")
            if (not identity or type(private) is not int or private < 0 or
                    status not in ("original_process", "original_supervisor_observation", "unavailable")):
                continue
            process_key = _process_key(identity)
            rank = (member["depth"], row["sequence"], key)
            if process_key not in owners or rank < owners[process_key]:
                owners[process_key] = rank
            if status != "unavailable":
                amounts[process_key] = min(amounts.get(process_key, private), private)
    for process_key, private in amounts.items():
        if not private:
            continue
        key = owners[process_key][2]
        credits[key]["private_bytes"] += private
        credits[key]["process_count"] += 1
    return credits


def _observed(row, process_table=None):
    root = Path(row["record"])
    request = native.read_json(root / "request.json")
    if request is None:
        observed = reservation_lifetime.missing_record(native, row, "memory")
        return {**observed, "process": None, "status": "not_started",
                "rss_bytes": 0, "private_bytes": 0,
                "memory_backed_storage": deepcopy(row.get("memory_backed_storage", {}))}
    if request["intent"]["operation_id"] != row["operation_id"]:
        raise ValueError("reservation lost its original native request identity")
    state = native.read_json(root / "result.json") or native.read_json(root / "state.json") or {}
    process = state.get("process") or native.read_json(root / "process.json")
    supervisor = row.get("supervisor", state.get("supervisor"))
    alive = (reservation_lifetime.row_process_living(native, row, supervisor)
             or reservation_lifetime.row_process_living(native, row, process))
    memory = _resident(process, process_table)
    if memory["status"] == "unavailable":
        if __package__:
            from .cloud_residency import retained
        else:
            from cloud_residency import retained
        memory = retained(root, request, supervisor, process) or memory
    if memory.get("tree") and not _within_group(
            _memory_group(supervisor), memory["tree"].get("cgroup_path")):
        memory.pop("tree")
    disk_intent = request["intent"].get("disk")
    filesystems = {}
    if disk_intent:
        try:
            disk = native.read_json(root / "disk.json") or {}
            if (disk.get("operation_id") == row["operation_id"] and
                    disk.get("intent") == disk_intent):
                filesystems = {path: resource for resource in disk.get("resources", [])
                               for path in resource.get("paths", [])}
        except (OSError, ValueError, TypeError, KeyError):
            pass
    # Other supervisors can have private mount namespaces. Their original
    # filesystem observation is authoritative; never stat their path in ours.
    storage = memory_backed_storage(disk_intent, filesystems,
        request["intent"]["memory"].get("storage_mode", "included"))
    return {"alive": bool(alive), "native_state": state.get("state", "launch_pending"),
            "process": process, "memory_backed_storage": storage, **memory}


def _fairness(rows, current, limits):
    capacities = {row["id"]: row for row in limits}

    def feasible(row, keys):
        return all(type(capacities[key].get("limit_bytes")) is not int or
                   _peak_with_storage(row) + row["reserve_bytes"] <= capacities[key]["limit_bytes"]
                   for key in keys)

    def can_accumulate(row, keys):
        return all(_peak_with_storage(row) + row["reserve_bytes"] <=
                   _available(capacities[key], row.get("reclaim_mode", "none")) +
                   capacities[key]["resident_private_credit_bytes"] for key in keys)

    def fits(row, keys):
        return all(_peak_with_storage(row) <= max(0,
                   _available(capacities[key], row.get("reclaim_mode", "none")) -
                   capacities[key]["unallocated_reservations_bytes"] -
                   max(row["reserve_bytes"], capacities[key]["reserve_bytes"])) for key in keys)

    def remaining(row, key):
        capacity = capacities[key]
        # Both requests must fit their own original reclaim semantics.
        available = min(_available(capacity, current.get("reclaim_mode", "none")),
                        _available(capacity, row.get("reclaim_mode", "none")))
        available = max(0, available - capacity["unallocated_reservations_bytes"] -
                        _peak_with_storage(current) - max(row["reserve_bytes"], capacity["reserve_bytes"]))
        return {"id": key, "protected_bytes": _peak_with_storage(row),
                "available_after_current_bytes": available,
                "deficit_bytes": max(0, _peak_with_storage(row) - available),
                "fits_together": available >= _peak_with_storage(row)}

    return reserve_headroom(rows.values(), current, capacities,
                            feasible=feasible, fits=fits, remaining=remaining,
                            can_accumulate=can_accumulate, kind="memory")


class MemoryAdmission:
    def __init__(self, root, request, supervisor):
        self.root = Path(root).resolve()
        self.operation_id = request["intent"]["operation_id"]
        self.created_at = request["created_at"]
        self.intent = request["intent"]["memory"]
        self.disk_intent = request["intent"].get("disk")
        self.supervisor = supervisor
        self.boot_id = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
        self.directory = Path(self.intent["ledger_root"]) / self.boot_id
        self.key = hashlib.sha256((str(self.root) + "\0" + self.operation_id).encode()).hexdigest()
        self.last_saved = 0.0
        self.last_state = None
        self.last_reason = None
        self.observations = 0
        self.latest_observation = None
        self.sample_sequence = 0
        self.published_sample_sequence = 0
        self.index_sync_required = False

    @contextmanager
    def _index(self):
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        descriptor = os.open(self.directory / ".lock", os.O_RDWR | os.O_CREAT, 0o600)
        with os.fdopen(descriptor, "a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            path = self.directory / "reservations.json"
            value = native.read_json(path) or {"schema": SCHEMA, "boot_id": self.boot_id,
                                              "next_sequence": 1, "reservations": {}}
            if value.get("schema") != SCHEMA or value.get("boot_id") != self.boot_id:
                raise ValueError("shared memory reservation index differs from this original VM")
            before = deepcopy(value)
            yield value
            # A stable waiting row needs no rewritten ledger. A previous
            # failed sync must still be completed before acquisition returns.
            if value != before or self.index_sync_required:
                self.index_sync_required = True
                native.save_json(path, value)
                self.index_sync_required = False

    def _previous_observation(self):
        # A fresh sample may still await the normal write interval. State
        # transitions use that sample, not an older on-disk observation.
        return (deepcopy(self.latest_observation) if self.latest_observation is not None
                else native.read_json(self.root / "memory.json") or {})

    def _retain_sample(self, value):
        # Keep new counters even if the shared index commit fails. State,
        # reason and queue sequence belong to that commit, not to the sample.
        prior = self._previous_observation()
        self.sample_sequence += 1
        sample = {key: item for key, item in value.items()
                  if key not in ("state", "reason", "sequence")}
        self.latest_observation = {**prior, **deepcopy(sample)}

    def _save_observation(self, value, *, force=False):
        self.observations += 1
        self.latest_observation = deepcopy(value)
        current = time.monotonic()
        changed = value["state"] != self.last_state or value.get("reason") != self.last_reason
        fresh = self.sample_sequence != self.published_sample_sequence
        if force or changed or (fresh and current - self.last_saved >= 5):
            # observed_at remains the actual sample time for existing readers.
            # Only updated_at describes this state/report publication.
            sampled_at = value.get("sampled_at", value.get("observed_at"))
            saved = native.save_observation_result(self.root / "memory.json", {**value,
                "schema": SCHEMA, "operation_id": self.operation_id,
                "intent": self.intent, "index": str(self.directory / "reservations.json"),
                "sampled_at": sampled_at, "observed_at": sampled_at,
                "updated_at": native.now(), "observations": self.observations})
            if saved["persisted"]:
                self.last_saved, self.last_state = current, value["state"]
                self.last_reason = value.get("reason")
                self.published_sample_sequence = self.sample_sequence
            return saved
        return {"persisted": False, "reason": "observation_not_due"}


    def attempt(self, *, reserve=True):
        """Observe capacity; optionally retain a waiter without taking RAM."""
        with self._index() as index:
            rows = index["reservations"]
            process_table = _LazyProcessTable()
            observations, errors, released = {}, {}, []
            for key, row in list(rows.items()):
                try:
                    observed = _observed(row, process_table)
                    if not observed["alive"]:
                        reservation_lifetime.retain_memory_proof(native, index, row, observed)
                        released.append(reservation_lifetime.released(row, observed))
                        del rows[key]
                    else:
                        observations[key] = observed
                        row["memory_backed_storage"] = observed["memory_backed_storage"]
                except (OSError, ValueError, KeyError, TypeError) as exc:
                    errors[key] = type(exc).__name__
            # Read charged capacity after resident samples, so newly observed
            # allocations are included in the subsequent kernel counters.
            paths = list(dict.fromkeys(item["path"]
                for item in (self.disk_intent or {}).get("paths", [])))
            report = snapshot(paths, nearest_existing=True, include_filesystems=bool(paths))
            filesystems = dict(zip(paths, report.get("filesystems", [])))
            storage = memory_backed_storage(self.disk_intent, filesystems,
                self.intent.get("storage_mode", "included"))
            resources = _memory_resources(report)
            resource_ids = sorted(row["id"] for row in resources)
            existing = rows.get(self.key)
            if existing is None:
                prior = native.read_json(self.root / "memory.json") or {}
                sequence = prior.get("sequence") if prior.get("operation_id") == self.operation_id else None
                if type(sequence) is not int or sequence < 1:
                    sequence = index["next_sequence"]
                    index["next_sequence"] += 1
                existing = {"record": str(self.root), "operation_id": self.operation_id,
                            "supervisor": self.supervisor, **self.intent,
                            "sequence": sequence, "created_at": self.created_at,
                            "state": "queued", "resources": resource_ids}
                namespace = reservation_lifetime.capture_namespace(native, existing)
                if namespace is not None:
                    existing["namespace_lifetime"] = namespace
                rows[self.key] = existing
            elif (existing["supervisor"] != self.supervisor or
                  any(existing[key] != self.intent[key] for key in self.intent)):
                raise ValueError("a different supervisor or request owns this original memory reservation")
            existing["memory_backed_storage"] = storage
            requested_total = _peak_with_storage(existing)
            existing.update(state="queued" if reserve else "waiting_disk", resources=resource_ids)
            existing.pop("admitted_at", None)
            if reserve:
                existing.pop("waiting_on", None)
            else:
                existing["waiting_on"] = "waiting_for_disk"

            limits = []
            for capacity in resources:
                participants = [(key, row) for key, row in rows.items()
                                if row["state"] == "reserved" and capacity["id"] in row["resources"]]
                credits = _reservation_credits(participants, observations)
                # Each validated live command/descendant reduces one original
                # unallocated peak. Nested reservations never share its credit.
                declared_remaining = sum(max(0, row["peak_bytes"] - credits[key]["private_bytes"])
                                        for key, row in participants if key != self.key)
                storage_remaining = sum(row.get("memory_backed_storage", {}).get("additional_bytes", 0)
                                        for key, row in participants if key != self.key)
                remaining = declared_remaining + storage_remaining
                reserve_bytes = max([self.intent["reserve_bytes"],
                                     *(row["reserve_bytes"] for _, row in participants)])
                available = _available(capacity, self.intent.get("reclaim_mode", "none"))
                limits.append({**capacity, "unallocated_reservations_bytes": remaining,
                               "unallocated_declared_peak_reservations_bytes": declared_remaining,
                               "memory_backed_storage_reservations_bytes": storage_remaining,
                               "resident_private_credit_bytes": sum(min(row["peak_bytes"], credits[key]["private_bytes"])
                                   for key, row in participants if key != self.key),
                               "resident_credited_processes": sum(credits[key]["process_count"]
                                   for key, _ in participants if key != self.key),
                               "reserve_bytes": reserve_bytes,
                               "admission_available_bytes": available,
                               "reclaim_credit_bytes": available - capacity["available_bytes"],
                               "raw_admissible_bytes": max(0, _available(capacity, "none") - remaining - reserve_bytes),
                               "cache_admissible_bytes": max(0, _available(capacity, "clean-cache") - remaining - reserve_bytes),
                               "admissible_bytes": max(0, available - remaining - reserve_bytes)})
            cgroup = report["cgroup_memory"]
            value = {"state": "queued_memory", "sequence": existing["sequence"],
                     "reclaim_mode": self.intent.get("reclaim_mode", "none"),
                     "requested_bytes": requested_total,
                     "requested_declared_peak_bytes": self.intent["peak_bytes"],
                     "storage_mode": self.intent.get("storage_mode", "included"),
                     "memory_backed_storage": storage, "resources": limits,
                     "cgroup_events": cgroup.get("events"), "pressure": cgroup.get("pressure"),
                     "released_dead_operations": released, "reservation_errors": errors,
                     "active_reservations": sum(row["state"] == "reserved" for row in rows.values())}
            unknown_constraint = not cgroup.get("levels") or any(
                row.get("max_status") == "unavailable" or
                (row.get("max_status") == "finite" and type(row.get("headroom_bytes")) is not int)
                for row in cgroup.get("levels", []))
            existing["capacity_feasible"] = bool(limits) and not unknown_constraint and all(
                type(row.get("limit_bytes")) is not int or
                requested_total + self.intent["reserve_bytes"] <= row["limit_bytes"]
                for row in limits)
            fairness = _fairness(rows, existing, limits)
            value["fairness"] = fairness
            value["capacity_feasible"] = existing["capacity_feasible"]
            if not limits or unknown_constraint:
                value["reason"] = "capacity_unavailable"
            elif any(type(row.get("limit_bytes")) is int and
                     requested_total + row["reserve_bytes"] > row["limit_bytes"] for row in limits):
                value.update(state="memory_request_exceeds_limit", reason="requested_peak_and_reserve_exceed_visible_capacity")
            elif not reserve:
                value["reason"] = "waiting_for_disk"
            elif requested_total > min(row["admissible_bytes"] for row in limits):
                value["reason"] = "waiting_for_capacity"
            elif fairness["blocked_by"]:
                blocker = fairness["blocked_by"]
                value.update(reason=("capacity_protected_for_older_operation" if blocker["mode"] == "aged"
                                     else "earlier_fitting_operation"),
                             preceding_operation_id=blocker["operation_id"])
            else:
                existing.update(state="reserved", admitted_at=native.now(), resources=resource_ids)
                value.update(state="admitted", reason="visible_capacity_reserved")
            value["sampled_at"] = report.get("finished_at") or native.now()
            value["observed_at"] = value["sampled_at"]
            self._retain_sample(value)
        # Publish admission only after the shared reservation commit succeeds.
        self._save_observation(value, force=value["state"] != "queued_memory")
        return value

    def reap_missing(self, key, *, expected_reservation_sha256):
        """Release one reviewed vanished queue without admitting another job."""
        return reservation_lifetime.reap_missing(native, self, _observed, "memory", key,
                                                  expected_reservation_sha256)

    def relinquish(self, reason="waiting_for_storage"):
        """Keep this original queue position while releasing unused capacity."""
        with self._index() as index:
            row = index["reservations"].get(self.key)
            if row and row["supervisor"] == self.supervisor:
                row["state"] = "waiting_disk" if reason == "waiting_for_disk" else "queued"
                row["waiting_on"] = reason
                row.pop("admitted_at", None)
        prior = self._previous_observation()
        self._save_observation({**prior, "state": "queued_memory", "reason": reason})

    def finish(self, *, record_child_peak=True):
        """Release this original reservation; only its supervisor owns child peak RSS."""
        observed = _observed({"record": str(self.root), "operation_id": self.operation_id})
        # A supervisor failure can leave its original child running. Its
        # reservation remains until native liveness shows that child has ended.
        process_alive = reservation_lifetime.living(native, observed.get("process"))
        with self._index() as index:
            if not process_alive:
                row = index["reservations"].get(self.key)
                if row is not None:
                    if row.get("supervisor") != self.supervisor:
                        raise ValueError("Another supervisor owns this original memory reservation")
                    reservation_lifetime.retain_memory_proof(native, index, row,
                        {**observed, "process_alive": False}, finishing=True)
                    del index["reservations"][self.key]
        # The index context has committed before this optional status write.
        # A stale or unreadable observation cannot undo that original release.
        read_error = None
        try:
            prior = self._previous_observation()
            if not isinstance(prior, dict):
                raise ValueError("Original memory observation is not an object")
        except (OSError, ValueError) as exc:
            prior = {}
            read_error = {"error_type": type(exc).__name__, "errno": getattr(exc, "errno", None)}
        value = {**prior,
            "state": "reserved_orphan" if process_alive else "released",
            "native_state": observed["native_state"], "process_memory": observed,
            **({"child_peak_rss_bytes": int(resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss) * 1024}
               if record_child_peak else {}),
            "released_at": None if process_alive else native.now()}
        publication = self._save_observation(value, force=True)
        return {"schema": SCHEMA, "operation_id": self.operation_id, "record": str(self.root),
                "index": str(self.directory / "reservations.json"), "reservation_key": self.key,
                "state": value["state"], "native_state": value["native_state"],
                "released_at": value["released_at"],
                "observation": {**publication, **({"read_error": read_error} if read_error else {})}}

