"""Cooperative filesystem reservations for the original native command operator.

Callers declare the additional bytes and inodes their command can create. The
existing supervisor retains the request, waits, runs the command and releases
its reservation. Filesystem observation and process identity use the existing
worker implementations. Original file contents and filesystem limits are preserved. Anonymous request
allocations may survive until the original cooperative ledger claim commits.
"""
from __future__ import annotations

from contextlib import ExitStack, contextmanager
from copy import deepcopy
import errno
import fcntl
import hashlib
import json
import os
from pathlib import Path
import time

if __package__:
    from . import swarm_cloud_job as native
    from . import native_reservation as reservation_lifetime
    from .worker_capacity import _allocation_writer, allocation_probe, snapshot
    from .capacity_fairness import reserve_headroom
else:
    import swarm_cloud_job as native
    import native_reservation as reservation_lifetime
    from worker_capacity import _allocation_writer, allocation_probe, snapshot
    from capacity_fairness import reserve_headroom

SCHEMA = "commons.native-cloud-disk/v1"
MIB = 1024 * 1024


def disk_intent_sha256(value):
    """Identify the exact retained filesystem declaration."""
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                     ensure_ascii=False).encode()).hexdigest()


def _declaration_path(value, *, resolve_paths):
    """Resolve a new declaration, or validate a path already retained in intent."""
    if resolve_paths:
        return str(Path(value).expanduser().resolve())
    if (not isinstance(value, str) or not value or "\x00" in value
            or value.startswith("//")):
        raise ValueError("Retained disk paths must be canonical absolute paths")
    path = Path(value)
    if not path.is_absolute() or str(path) != value or ".." in path.parts:
        raise ValueError("Retained disk paths must be canonical absolute paths")
    return value


def _amendment_options(disk_space, disk_inodes, reserve_mib, reserve_inodes, *, resolve_paths=True):
    def paths(values):
        if values is None:
            return None
        if not isinstance(values, (list, tuple)):
            raise ValueError("Disk amendment paths must be lists of absolute PATH=AMOUNT values")
        result = []
        for value in values:
            if not isinstance(value, str):
                raise ValueError("Disk amendment paths use absolute PATH=AMOUNT values")
            supplied, separator, amount = value.rpartition("=")
            path = Path(supplied).expanduser()
            if not separator or not path.is_absolute() or not amount.isdecimal() or int(amount) < 1:
                raise ValueError("Disk amendment paths need an absolute path and a positive whole-number amount")
            result.append(_declaration_path(supplied, resolve_paths=resolve_paths) + "=" + str(int(amount)))
        return result
    for value, name in ((reserve_mib, "disk reserve MiB"), (reserve_inodes, "disk reserve inodes")):
        if value is not None and (type(value) is not int or value < 0):
            raise ValueError(name + " must be a nonnegative integer")
    return {"disk_space": paths(disk_space), "disk_inodes": paths(disk_inodes),
            "reserve_mib": reserve_mib, "reserve_inodes": reserve_inodes}


def amended_specification(previous, *, disk_space=None, disk_inodes=None,
                          reserve_mib=None, reserve_inodes=None):
    """Reconstruct a normalized amendment without reinterpreting its past paths.

    New declarations are resolved by amend_request or handoff review first.
    Consumer and prepared-source readers replay these exact saved strings even
    when the original workspace or ledger is later reached through an alias.
    """
    changes = _amendment_options(disk_space, disk_inodes, reserve_mib, reserve_inodes,
                                 resolve_paths=False)
    if not isinstance(previous, dict) or not isinstance(previous.get("paths"), list):
        raise ValueError("Preserve the original disk declaration")
    spaces = [row["path"] + "=" + str(row["bytes"] // MIB)
              for row in previous["paths"] if row["bytes"]]
    inodes = [row["path"] + "=" + str(row["inodes"])
              for row in previous["paths"] if row["inodes"]]
    if specification(spaces, inodes, previous["reserve_bytes"] // MIB,
                     previous["reserve_inodes"], previous["ledger_root"], resolve_paths=False) != previous:
        raise ValueError("The original disk declaration is not its canonical native specification")
    return specification(spaces if changes["disk_space"] is None else changes["disk_space"],
        inodes if changes["disk_inodes"] is None else changes["disk_inodes"],
        previous["reserve_bytes"] // MIB if reserve_mib is None else reserve_mib,
        previous["reserve_inodes"] if reserve_inodes is None else reserve_inodes,
        previous["ledger_root"], resolve_paths=False)


def amend_request(root, *, amendment_id, expected_disk_sha256, reason,
                  disk_space=None, disk_inodes=None, reserve_mib=None, reserve_inodes=None):
    """Amend a dead, undispatched original queue without restarting its age."""
    root = Path(root).expanduser().resolve(strict=True)
    if not isinstance(amendment_id, str) or not 1 <= len(amendment_id) <= 128 or any(
            c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-"
            for c in amendment_id):
        raise ValueError("Supply a stable amendment ID using letters, digits, dot, underscore or hyphen")
    if (not isinstance(expected_disk_sha256, str) or len(expected_disk_sha256) != 64 or
            any(c not in "0123456789abcdef" for c in expected_disk_sha256)):
        raise ValueError("Supply the SHA-256 of the exact original disk declaration")
    if not isinstance(reason, str) or not reason.strip() or len(reason) > 2000:
        raise ValueError("Describe the concrete change behind this disk declaration")
    reason = reason.strip()
    changes = _amendment_options(disk_space, disk_inodes, reserve_mib, reserve_inodes)
    with native.run_lock(root):
        request = native.read_json(root / "request.json")
        if (not request or request.get("schema") != native.SCHEMA or
                not isinstance(request.get("intent", {}).get("disk"), dict)):
            raise ValueError("Select an original operation with its retained disk request")
        intent = request["intent"]
        if native.run_path(intent["operation_id"], root.parent).resolve() != root:
            raise ValueError("The retained request differs from this original operation path")
        previous = intent["disk"]
        history = request.get("disk_amendments", [])
        if not isinstance(history, list) or any(not isinstance(row, dict) for row in history):
            raise ValueError("Preserve the original disk amendment history")
        matching = [row for row in history if row.get("amendment_id") == amendment_id]
        if matching:
            if len(matching) != 1:
                raise ValueError("The original amendment identity is duplicated")
            event = matching[0]
            if (event.get("changes") != changes or event.get("reason") != reason or
                    event.get("previous_sha256") != expected_disk_sha256):
                raise ValueError("This amendment ID already records a different declaration")
            return {"schema": SCHEMA, "operation_id": intent["operation_id"],
                    "record": str(root), "amended": False, "reused": True,
                    "amendment": event, "disk": previous,
                    "disk_sha256": disk_intent_sha256(previous),
                    "superseded": previous != event.get("next")}
        if disk_intent_sha256(previous) != expected_disk_sha256:
            raise ValueError("The retained disk declaration changed; read its current intent before amending")
        # Preserve byte-identical amendment replay above; every new mutation
        # below owns the original supervisor inode before reading its state.
        with native.supervisor_lock(root, reuse_current=True) as descriptor:
            if descriptor is None:
                raise ValueError("The original supervisor lifetime lock is held; preserve its request")
            state = native.read_json(root / "state.json") or {}
            if native._legacy_queue_gate_pending(root, state):
                raise ValueError("Preserve the legacy queue gate until its original parent has observed its exit")
            supervisor = state.get("supervisor")
            if not native._supervisor_ended(supervisor) or native.live_supervisors(root):
                raise ValueError("The original queued supervisor has not ended; preserve its current operation")
            queue_state = state.get("state")
            combined_queue = queue_state == "queued_memory" and isinstance(intent.get("memory"), dict)
            if ((queue_state != "queued_disk" and not combined_queue) or state.get("process") or any(
                    (root / name).exists() for name in ("process.json", "output.log", "result.json",
                                                       "command-completion.dat", "stop-request.json"))):
                raise ValueError("Only a dead original disk or combined memory/disk queue with no command or stop artifacts may be amended")
            if (root / "runtime-handoff.json").exists():
                if __package__:
                    from . import native_runtime_handoff
                else:
                    import native_runtime_handoff
                handoff = native_runtime_handoff.active(native, root)
                if handoff and handoff.get("phase") not in ("resumed", "resumed_elsewhere"):
                    raise ValueError("Complete the original runtime handoff before amending its bound disk request")
            updated = amended_specification(previous, **changes)
            if updated == previous:
                raise ValueError("The proposed declaration is already the retained disk intent")
            observation = native.read_json(root / "disk.json") or {}
            sequence = observation.get("sequence") if observation.get("operation_id") == intent["operation_id"] else None
            event = {"amendment_id": amendment_id, "amended_at": native.now(),
                     "reason": reason, "changes": changes,
                     "previous": previous, "previous_sha256": expected_disk_sha256,
                     "next": updated, "next_sha256": disk_intent_sha256(updated),
                     "sequence": sequence, "previous_state": queue_state,
                     "previous_supervisor": supervisor, "command_previously_started": False}
            revised = {**request, "intent": {**intent, "disk": updated},
                       "disk_amendments": [*history, event]}
            if __package__:
                from . import runtime_consumers
            else:
                import runtime_consumers
            consumer_reader = getattr(runtime_consumers, "reconcile_capacity_amendments", None)
            expected_consumer = Path(native.__file__).resolve().parent / "runtime_consumers.py"
            if (Path(runtime_consumers.__file__).resolve() != expected_consumer.resolve()
                    or not callable(consumer_reader)):
                raise ValueError("Install the original runtime consumer capacity reader before amending this queue")
            consumer_reader(runtime_consumers.read_use(root), revised)
            if (root / "offload.json").exists():
                if __package__:
                    from . import offload_build
                else:
                    import offload_build
                reader = getattr(offload_build, "disk_for_native_start", None)
                expected_reader = Path(native.__file__).resolve().parent / "offload_build.py"
                if Path(offload_build.__file__).resolve() != expected_reader.resolve() or not callable(reader):
                    raise ValueError("Install the cumulative original offload disk reader before amending a prepared source binding")
                if reader(native.read_json(root / "offload.json"), revised) != updated:
                    raise ValueError("The original prepared source binding does not match this disk amendment")
            native.save_json(root / "request.json", revised)
            return {"schema": SCHEMA, "operation_id": intent["operation_id"],
                    "record": str(root), "amended": True, "reused": False,
                    "amendment": event, "disk": updated,
                    "disk_sha256": event["next_sha256"], "superseded": False}


def specification(spaces=None, inodes=None, reserve_mib=64, reserve_inodes=128, ledger_root=None, *,
                  resolve_paths=True):
    """Parse explicit PATH=MIB and PATH=COUNT requirements into stable intent."""
    if type(reserve_mib) is not int or reserve_mib < 0:
        raise ValueError("disk_reserve_mib must be a nonnegative MiB value")
    if type(reserve_inodes) is not int or reserve_inodes < 0:
        raise ValueError("disk_reserve_inodes must be a nonnegative count")
    selected = {}
    for values, field, multiplier in ((spaces or [], "bytes", MIB), (inodes or [], "inodes", 1)):
        for value in values:
            if not isinstance(value, str):
                raise ValueError("Disk requirements use PATH=MIB or PATH=COUNT")
            supplied, separator, amount = value.rpartition("=")
            if not separator or not supplied or not amount.isdecimal() or int(amount) < 1:
                raise ValueError("Disk requirements need a path and a positive whole-number amount")
            path = _declaration_path(supplied, resolve_paths=resolve_paths)
            row = selected.setdefault(path, {"path": path})
            if field in row:
                raise ValueError("The same canonical disk path was supplied twice for " + field)
            row[field] = int(amount) * multiplier
    if not selected:
        raise ValueError("Supply at least one original disk-space or disk-inodes requirement")
    state = Path(os.environ.get("SWARM_STATE_ROOT", "/workspace/shared/swarm"))
    selected_ledger = (ledger_root or os.environ.get("SWARM_DISK_RESERVATIONS_ROOT", str(state / "capacity/disk"))
                       if resolve_paths else ledger_root)
    directory = _declaration_path(selected_ledger, resolve_paths=resolve_paths)
    return {"paths": [{"bytes": 0, "inodes": 0, **selected[key]} for key in sorted(selected)],
            "reserve_bytes": reserve_mib * MIB, "reserve_inodes": reserve_inodes,
            "ledger_root": str(directory)}


def _resources(intent, *, observation=None):
    observations = snapshot([row["path"] for row in intent["paths"]], nearest_existing=True,
                            include_memory=False)
    if observation is not None:
        observation.update(started_at=observations["started_at"],
                           finished_at=observations["finished_at"])
    resources = {}
    for requirement, observed in zip(intent["paths"], observations["filesystems"]):
        if observed.get("status") != "ok" or type(observed.get("available_bytes")) is not int:
            raise ValueError("Filesystem capacity is unavailable for " + requirement["path"])
        key = "filesystem:" + str(observed["device"])
        row = resources.setdefault(key, {"id": key, "device": observed["device"], "paths": [],
            "available_bytes": observed["available_bytes"], "total_bytes": observed["total_bytes"],
            "counter_available_bytes": observed["available_bytes"],
            "available_bytes_source": observed.get("available_bytes_source"),
            "free_including_reserved_bytes": observed.get("free_including_reserved_bytes"),
            "allocation_observations": [], "path_requirements": [],
            "caller_identity": observed.get("caller_identity"), "read_only": observed.get("read_only"),
            "inodes_available": observed.get("inodes_available"), "inodes_total": observed.get("inodes_total"),
            "filesystem": observed.get("filesystem"), "memory_backed": observed.get("memory_backed"),
            "requested_bytes": 0, "requested_inodes": 0})
        row["paths"].append(requirement["path"])
        row["path_requirements"].append(dict(requirement))
        row["requested_bytes"] += requirement["bytes"]
        row["requested_inodes"] += requirement["inodes"]
        row["available_bytes"] = min(row["available_bytes"], observed["available_bytes"])
        row["counter_available_bytes"] = row["available_bytes"]
        if row["available_bytes_source"] != observed.get("available_bytes_source"):
            row["available_bytes_source"] = "mixed_counters"
        physical = observed.get("free_including_reserved_bytes")
        row["free_including_reserved_bytes"] = (min(row["free_including_reserved_bytes"], physical)
            if type(row["free_including_reserved_bytes"]) is int and type(physical) is int else None)
        row["total_bytes"] = min(row["total_bytes"], observed["total_bytes"])
        for field in ("inodes_available", "inodes_total"):
            current = observed.get(field)
            row[field] = min(row[field], current) if type(row[field]) is int and type(current) is int else None
    return resources


def _living(identity):
    return reservation_lifetime.living(native, identity)


def _observed(row):
    root = Path(row["record"])
    request = native.read_json(root / "request.json")
    if request is None:
        return reservation_lifetime.missing_record(native, row, "disk")
    if request["intent"]["operation_id"] != row["operation_id"]:
        raise ValueError("Disk reservation lost its original native request")
    state = native.read_json(root / "result.json") or native.read_json(root / "state.json") or {}
    process = state.get("process") or native.read_json(root / "process.json")
    process_alive = reservation_lifetime.row_process_living(native, row, process)
    return {"alive": process_alive or reservation_lifetime.row_process_living(
                native, row, row.get("supervisor", state.get("supervisor"))),
            "process_alive": process_alive, "native_state": state.get("state", "launch_pending")}


def _fits(capacity, requirement, intent):
    needed_bytes = (requirement["bytes"] + capacity["active_reserved_bytes"] +
                    max(capacity["reserve_bytes"], intent["reserve_bytes"]))
    if capacity["available_bytes"] < needed_bytes:
        return False
    if capacity["inodes_available"] is None:
        return requirement["inodes"] == 0
    needed_inodes = (requirement["inodes"] + capacity["active_reserved_inodes"] +
                     max(capacity["reserve_inodes"], intent["reserve_inodes"]))
    return capacity["inodes_available"] >= needed_inodes


ALLOCATION_RETRY_SECONDS = 5.0


def _allocation_eligible(row):
    return (row.get("filesystem") == "overlay" and row.get("memory_backed") is False
            and row.get("read_only") is False
            and type(row.get("free_including_reserved_bytes")) is int
            and row.get("caller_identity", {}).get("status") == "ok"
            and bool(row.get("path_requirements")))


def _allocation_selection_limits(limits):
    """Physical counters bound candidate selection, never admission."""
    selected = []
    for row in limits:
        value = dict(row)
        if _allocation_eligible(row):
            value["available_bytes"] = max(row["available_bytes"],
                row["free_including_reserved_bytes"])
        selected.append(value)
    return selected


def _allocation_failure_still_current(row, capacities):
    """Let a genuinely failed original tuple yield briefly until space improves."""
    failure = row.get("allocation_failure")
    if not isinstance(failure, dict) or failure.get("supervisor") != row.get("supervisor"):
        return False
    stamp = failure.get("monotonic_at")
    if type(stamp) not in (int, float):
        return False
    elapsed = time.monotonic() - stamp
    if not 0 <= elapsed < ALLOCATION_RETRY_SECONDS:
        return False
    capacity = capacities.get(failure.get("resource_id"), {})
    free = capacity.get("free_including_reserved_bytes")
    return (type(free) is int and type(failure.get("free_before_bytes")) is int
            and free <= failure["free_before_bytes"])


def _allocation_budget(row):
    return (row["requested_bytes"] + row["active_reserved_bytes"] +
            row.get("protected_bytes", 0) +
            row.get("allocation_reserve_bytes", row["reserve_bytes"]))


def _observe_counter_shortfall(limits, current, retained):
    """Retain the selected original request until its equivalent ledger commit.

    The original allocation_probe remains the sole allocation primitive. Check
    all requested paths simultaneously, including active claims, selected aged
    headroom and the maximum original configured reserve. Supplementary extents
    close after the complete check; the current request's extents remain on the
    caller's outer ExitStack through commit.
    """
    missing = [row for row in limits if row["available_bytes"] < _allocation_budget(row)]
    if not missing:
        return limits, None
    if any(not _allocation_eligible(row) for row in missing):
        return limits, {"reason": "writer_allocation_unavailable"}
    try:
        owner = _allocation_writer()
    except OSError:
        return limits, {"reason": "writer_identity_unavailable"}
    if owner.get("status") != "ok" or any(
            any(owner.get(key) != value for key, value in row["caller_identity"].items())
            for row in missing):
        return limits, {"reason": "writer_identity_changed"}
    checks, selected = [], []
    failed_observation = None
    try:
        with ExitStack() as supplements:
            for row in limits:
                value = dict(row)
                selected.append(value)
                if row not in missing:
                    continue
                amount = _allocation_budget(row)
                if not 0 < amount <= min(row["free_including_reserved_bytes"], (1 << 63) - 1):
                    raise OSError(errno.ENOSPC, "Whole budget exceeds observed physical capacity")
                check = {"schema": "commons.native-writer-allocation/v1",
                    "operation_id": current["operation_id"], "supervisor": current["supervisor"],
                    "writer": owner, "resource_id": row["id"], "status": "checking",
                    "checked_bytes": amount, "requested_bytes": row["requested_bytes"],
                    "active_reserved_bytes": row["active_reserved_bytes"],
                    "reserve_bytes": row["reserve_bytes"],
                    "allocation_reserve_bytes": row["allocation_reserve_bytes"],
                    "protected_bytes": row["protected_bytes"],
                    "free_before_bytes": row["free_including_reserved_bytes"],
                    "ordinary_available_bytes": row["available_bytes"],
                    "allocation_guaranteed_after_release": False,
                    "retained_allocated_bytes": 0, "supplement_allocated_bytes": 0,
                    "paths": []}
                value["writer_allocation"] = check
                value["allocation_observations"] = []
                checks.append(check)
                for requirement in row["path_requirements"]:
                    # An inode-only location still receives one unlinked byte
                    # to establish its actual writer/directory permission.
                    observation = allocation_probe(requirement["path"], max(1, requirement["bytes"]),
                        expected_device=row["device"], retained=retained, expected_writer=owner)
                    value["allocation_observations"].append(observation)
                    if observation["status"] != "ok" or observation["allocation_released"]:
                        failed_observation = observation
                        raise OSError(observation.get("error", {}).get("errno") or errno.EIO,
                                      "Original path allocation failed")
                    check["retained_allocated_bytes"] += observation["allocated_blocks_bytes"]
                    check["paths"].append({"requested_path": requirement["path"],
                        "allocation_directory": observation["allocation_directory"],
                        "requested_bytes": requirement["bytes"],
                        "allocated_bytes": observation["allocated_blocks_bytes"],
                        "device": observation["device"], "directory_inode": observation["directory_inode"]})
                extra = amount - row["requested_bytes"]
                if extra:
                    observation = allocation_probe(row["path_requirements"][0]["path"], extra,
                        expected_device=row["device"], retained=supplements, expected_writer=owner)
                    value["allocation_observations"].append(observation)
                    if observation["status"] != "ok" or observation["allocation_released"]:
                        failed_observation = observation
                        raise OSError(observation.get("error", {}).get("errno") or errno.EIO,
                                      "Shared claims and headroom allocation failed")
                    check["supplement_allocated_bytes"] = observation["allocated_blocks_bytes"]
                # Recheck every original path after all simultaneous allocations.
                for item in check["paths"]:
                    location = Path(item["requested_path"]).expanduser().resolve()
                    while not location.exists() and location != location.parent:
                        location = location.parent
                    if location.is_file():
                        location = location.parent
                    if str(location) != item["allocation_directory"]:
                        raise OSError(errno.EXDEV, "Declared path changed during allocation")
                    actual = os.stat(item["allocation_directory"], follow_symlinks=False)
                    if (actual.st_dev, actual.st_ino) != (item["device"], item["directory_inode"]):
                        raise OSError(errno.EXDEV, "Declared directory changed during allocation")
                    current_stat = os.statvfs(item["allocation_directory"])
                    if current_stat.f_flag & getattr(os, "ST_RDONLY", 1):
                        raise OSError(errno.EROFS, "Declared filesystem became read-only")
                check["status"] = "allocated"
                value.update(available_bytes=amount,
                    available_bytes_source="same_writer_full_budget_allocation",
                    admissible_bytes=row["requested_bytes"])
            if _allocation_writer() != owner:
                raise OSError(errno.EAGAIN, "Writer identity changed during allocation")
        for check in checks:
            check["supplement_released"] = True
        return selected, None
    except OSError as exc:
        retained.close()
        failure = {"reason": "writer_budget_unavailable", "errno": exc.errno,
            "error": type(exc).__name__, "supervisor": current["supervisor"],
            "monotonic_at": time.monotonic()}
        if failed_observation is not None:
            failure["allocation_error"] = failed_observation.get("error")
        if checks:
            failure.update(resource_id=checks[-1]["resource_id"],
                           free_before_bytes=checks[-1]["free_before_bytes"])
            checks[-1].update(status="failed", errno=exc.errno, error=type(exc).__name__)
        for check in checks:
            check["request_allocation_released"] = True
        # A partial multi-path allocation never promotes the complete request.
        for original, value in zip(limits, selected):
            value.update(available_bytes=original["available_bytes"],
                         admissible_bytes=original["admissible_bytes"],
                         available_bytes_source=original["available_bytes_source"])
        selected.extend(limits[len(selected):])
        return selected, failure


def _fairness(rows, current, limits):
    capacities = {row["id"]: row for row in limits}

    def feasible(row, keys):
        for key in keys:
            capacity, needed, intent = capacities[key], row["resources"][key], row["intent"]
            if needed["bytes"] + intent["reserve_bytes"] > capacity["total_bytes"]:
                return False
            if needed["inodes"] and (capacity["inodes_available"] is None or
                    type(capacity["inodes_total"]) is int and
                    needed["inodes"] + intent["reserve_inodes"] > capacity["inodes_total"]):
                return False
        return True

    def can_accumulate(row, keys):
        if _allocation_failure_still_current(row, capacities):
            return False
        for key in keys:
            capacity, needed, intent = capacities[key], row["resources"][key], row["intent"]
            if needed["bytes"] + intent["reserve_bytes"] > capacity["available_bytes"]:
                return False
            if needed["inodes"] and (type(capacity["inodes_available"]) is not int or
                    needed["inodes"] + intent["reserve_inodes"] > capacity["inodes_available"]):
                return False
        return True

    def fits(row, keys):
        return all(_fits(capacities[key], row["resources"][key], row["intent"]) for key in keys)

    def remaining(row, key):
        capacity, needed = capacities[key], row["resources"][key]
        own = current["resources"][key]
        available = max(0, capacity["available_bytes"] - capacity["active_reserved_bytes"] -
                        own["bytes"] - max(capacity["reserve_bytes"], row["intent"]["reserve_bytes"]))
        inodes = (max(0, capacity["inodes_available"] - capacity["active_reserved_inodes"] -
                      own["inodes"] - max(capacity["reserve_inodes"], row["intent"]["reserve_inodes"]))
                  if type(capacity["inodes_available"]) is int else None)
        fits_inodes = not needed["inodes"] or inodes is not None and inodes >= needed["inodes"]
        return {"id": key, "protected_bytes": needed["bytes"],
                "available_after_current_bytes": available,
                "deficit_bytes": max(0, needed["bytes"] - available),
                "protected_inodes": needed["inodes"], "available_after_current_inodes": inodes,
                "protected_reserve_bytes": max(capacity["reserve_bytes"], row["intent"]["reserve_bytes"]),
                "fits_together": available >= needed["bytes"] and fits_inodes}

    return reserve_headroom(rows.values(), current, capacities,
                            feasible=feasible, fits=fits, remaining=remaining,
                            can_accumulate=can_accumulate, kind="disk")


class DiskAdmission:
    def __init__(self, root, request, supervisor):
        self.root = Path(root).resolve()
        self.operation_id = request["intent"]["operation_id"]
        self.peer = request["intent"]["peer"]
        self.created_at = request["created_at"]
        self.intent = request["intent"]["disk"]
        self.memory_intent = request["intent"].get("memory")
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
                raise ValueError("Shared disk reservations differ from this original VM")
            before = deepcopy(value)
            yield value
            # A stable waiting row needs no rewritten ledger. A previous
            # failed sync must still be completed before acquisition returns.
            if value != before or self.index_sync_required:
                self.index_sync_required = True
                native.save_json(path, value)
                self.index_sync_required = False

    def _previous_observation(self):
        return (deepcopy(self.latest_observation) if self.latest_observation is not None
                else native.read_json(self.root / "disk.json") or {})

    def _retain_sample(self, value):
        # Retain raw fresh counters before allocation can promote the visible
        # budget. A failed shared commit cannot publish an uncommitted claim.
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
            sampled_at = value.get("sampled_at", value.get("observed_at"))
            saved = native.save_observation_result(self.root / "disk.json", {**value,
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

    def attempt(self, *, allow_allocation=True):
        # Anonymous request bytes live outside the ledger context so they are
        # released only after the equivalent shared claim has committed.
        with ExitStack() as retained:
            with self._index() as index:
                observation = {}
                resources = _resources(self.intent, observation=observation)
                rows = index["reservations"]
                released, errors = [], {}
                for key, row in list(rows.items()):
                    try:
                        observed = _observed(row)
                        if not observed["alive"]:
                            reservation_lifetime.retain_namespace_proof(native, index, row, observed, "disk")
                            released.append(reservation_lifetime.released(row, observed))
                            del rows[key]
                    except (OSError, ValueError, KeyError, TypeError) as exc:
                        errors[key] = type(exc).__name__
                existing = rows.get(self.key)
                if existing is None:
                    prior = native.read_json(self.root / "disk.json") or {}
                    sequence = prior.get("sequence") if prior.get("operation_id") == self.operation_id else None
                    if type(sequence) is not int or sequence < 1:
                        sequence = index["next_sequence"]
                        index["next_sequence"] += 1
                    existing = {"record": str(self.root), "operation_id": self.operation_id, "peer": self.peer,
                                "supervisor": self.supervisor, "intent": self.intent,
                                "sequence": sequence, "created_at": self.created_at, "state": "queued"}
                    namespace = reservation_lifetime.capture_namespace(native, existing)
                    if namespace is not None:
                        existing["namespace_lifetime"] = namespace
                    rows[self.key] = existing
                elif existing["supervisor"] != self.supervisor or existing["intent"] != self.intent:
                    raise ValueError("A different supervisor or request owns this original disk reservation")
                if self.memory_intent:
                    existing["memory_gate"] = {"ledger_root": self.memory_intent["ledger_root"],
                                               "reservation_key": self.key}
                existing["resources"] = {key: {"bytes": row["requested_bytes"], "inodes": row["requested_inodes"]}
                                         for key, row in resources.items()}
                existing["state"] = "queued"
                existing.pop("waiting_on", None)
                existing.pop("admitted_at", None)
                existing["capacity_feasible"] = all(
                    row["requested_bytes"] + self.intent["reserve_bytes"] <= row["total_bytes"] and
                    (not row["requested_inodes"] or row["inodes_available"] is not None and
                     (type(row["inodes_total"]) is not int or
                      row["requested_inodes"] + self.intent["reserve_inodes"] <= row["inodes_total"]))
                    for row in resources.values())
                limits = []
                for key, capacity in resources.items():
                    participants = [row for other, row in rows.items() if other != self.key
                                    and row["state"] == "reserved" and key in row["resources"]]
                    requested_bytes = sum(row["resources"][key]["bytes"] for row in participants)
                    requested_inodes = sum(row["resources"][key]["inodes"] for row in participants)
                    reserve_bytes = max([self.intent["reserve_bytes"], *(row["intent"]["reserve_bytes"] for row in participants)])
                    reserve_inodes = max([self.intent["reserve_inodes"], *(row["intent"]["reserve_inodes"] for row in participants)])
                    limits.append({**capacity, "active_reserved_bytes": requested_bytes,
                        "active_reserved_inodes": requested_inodes, "reserve_bytes": reserve_bytes,
                        "reserve_inodes": reserve_inodes,
                        "admissible_bytes": max(0, capacity["available_bytes"] - requested_bytes - reserve_bytes),
                        "admissible_inodes": (max(0, capacity["inodes_available"] - requested_inodes - reserve_inodes)
                                               if type(capacity["inodes_available"]) is int else None),
                        "active_operations": [{"operation_id": row["operation_id"], "peer": row["peer"],
                                               "record": row["record"], **row["resources"][key]} for row in participants]})
                selected = _allocation_selection_limits(limits)
                fairness = _fairness(rows, existing, selected)
                fairness["capacity_selection_basis"] = "ordinary_or_overlay_physical_upper_bound"
                # A permitted backfill must prove the aged headroom that its
                # fairness decision used, as well as its own complete demand.
                for capacity in limits:
                    protected = [item for operation in fairness["protected_operations"]
                                 for item in operation["resources"] if item["id"] == capacity["id"]]
                    capacity["protected_bytes"] = max([0, *(item["protected_bytes"] for item in protected)])
                    capacity["allocation_reserve_bytes"] = max([capacity["reserve_bytes"],
                        *(item["protected_reserve_bytes"] for item in protected)])
                    capacity["allocation_required_bytes"] = _allocation_budget(capacity)
                needs_allocation = any(row["available_bytes"] < _allocation_budget(row) for row in limits)
                value = {"state": "queued_disk", "sequence": existing["sequence"], "resources": limits,
                         "fairness": fairness, "capacity_feasible": existing["capacity_feasible"],
                         "released_dead_operations": released, "reservation_errors": errors}
                value["sampled_at"] = observation["finished_at"]
                value["observed_at"] = value["sampled_at"]
                self._retain_sample(value)
                if any(row["requested_bytes"] + row["reserve_bytes"] > row["total_bytes"] or
                       (row["requested_inodes"] and type(row["inodes_total"]) is int and
                        row["requested_inodes"] + row["reserve_inodes"] > row["inodes_total"]) for row in limits):
                    value.update(state="disk_request_exceeds_limit", reason="request_exceeds_filesystem_capacity")
                elif any(row["requested_inodes"] and row["admissible_inodes"] is None for row in limits):
                    value["reason"] = "inode_capacity_unavailable"
                elif not all(_fits(row, existing["resources"][row["id"]], self.intent) for row in selected):
                    value["reason"] = "waiting_for_capacity"
                elif not allow_allocation and needs_allocation:
                    value["reason"] = "writer_allocation_waiting_for_memory"
                elif _allocation_failure_still_current(existing, {row["id"]: row for row in limits}):
                    value.update(reason="waiting_for_writer_capacity",
                                 allocation_failure=existing["allocation_failure"])
                elif fairness["blocked_by"]:
                    blocker = fairness["blocked_by"]
                    value.update(reason=("capacity_protected_for_older_operation" if blocker["mode"] == "aged"
                                         else "earlier_fitting_operation"),
                                 preceding_operation_id=blocker["operation_id"])
                else:
                    actual_owner = native.process_identity(os.getpid()) if needs_allocation else self.supervisor
                    if actual_owner != self.supervisor:
                        failure = {"reason": "writer_is_not_original_supervisor"}
                    else:
                        limits, failure = _observe_counter_shortfall(limits, existing, retained)
                        value["resources"] = limits
                    if failure:
                        failure["observed_at"] = native.now()
                        existing["allocation_failure"] = failure
                        value.update(reason=failure["reason"], allocation_failure=failure)
                    else:
                        existing.pop("allocation_failure", None)
                        existing.update(state="reserved", admitted_at=native.now())
                        value.update(state="admitted", reason=("same_writer_budget_reserved" if needs_allocation
                                                              else "visible_filesystem_capacity_reserved"))
            for resource in value["resources"]:
                allocation = resource.get("writer_allocation")
                if allocation and allocation["status"] == "allocated" and value["state"] == "admitted":
                    allocation.update(claim_committed=True, claim_committed_at=native.now())
        for resource in value["resources"]:
            allocation = resource.get("writer_allocation")
            if allocation:
                allocation["request_allocation_released"] = True
        # Publish admission only after the shared reservation commit succeeds.
        self._save_observation(value, force=value["state"] != "queued_disk")
        return value

    def reap_missing(self, key, *, expected_reservation_sha256):
        """Release one reviewed vanished queue through the original disk index."""
        return reservation_lifetime.reap_missing(native, self, _observed, "disk", key,
                                                  expected_reservation_sha256)


    def relinquish(self, reason="waiting_for_memory"):
        """Release unused disk and retain the original cross-resource queue age."""
        with self._index() as index:
            row = index["reservations"].get(self.key)
            if row and row["supervisor"] == self.supervisor:
                row["state"] = "waiting_memory"
                row["waiting_on"] = reason
                row.pop("admitted_at", None)
        prior = self._previous_observation()
        self._save_observation({**prior, "state": "waiting_memory", "reason": reason})

    def finish(self):
        observed = _observed({"record": str(self.root), "operation_id": self.operation_id})
        with self._index() as index:
            if not observed["process_alive"]:
                index["reservations"].pop(self.key, None)
        # The original reservation commit is authoritative even when its
        # best-effort status file cannot be refreshed on a full filesystem.
        read_error = None
        try:
            prior = self._previous_observation()
            if not isinstance(prior, dict):
                raise ValueError("Original disk observation is not an object")
        except (OSError, ValueError) as exc:
            prior = {}
            read_error = {"error_type": type(exc).__name__, "errno": getattr(exc, "errno", None)}
        value = {**prior, "state": "reserved_orphan" if observed["process_alive"] else "released",
                 "native_state": observed["native_state"],
                 "released_at": None if observed["process_alive"] else native.now()}
        publication = self._save_observation(value, force=True)
        return {"schema": SCHEMA, "operation_id": self.operation_id, "record": str(self.root),
                "index": str(self.directory / "reservations.json"), "reservation_key": self.key,
                "state": value["state"], "native_state": value["native_state"],
                "released_at": value["released_at"],
                "observation": {**publication, **({"read_error": read_error} if read_error else {})}}


