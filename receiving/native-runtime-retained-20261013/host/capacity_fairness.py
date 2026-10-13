"""Queue age and attainable headroom shared by the native admission engines.

The original resource ledgers own reservations. Opposite-resource observations
come from the existing operation journals and never acquire another ledger lock.
"""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

SCHEMA = "commons.native-capacity-fairness/v1"
AGING_SECONDS = 60
OBSERVATION_SECONDS = 15



STORAGE_SCHEMA = "commons.native-memory-backed-storage/v1"
STORAGE_MODES = ("included", "additional")


def memory_backed_storage(disk_intent, filesystems, storage_mode="included"):
    """Describe declared filesystem growth and its explicit memory accounting.

    Existing native peaks describe the whole operation, including staged files.
    Only an explicit additional mode declares a process-only peak and adds
    memory-backed storage. Unknown filesystem types keep their declared bytes
    in that opt-in upper bound. This observes metadata, never file contents.
    """
    if storage_mode not in STORAGE_MODES:
        raise ValueError("memory_storage must be included or additional")
    if not disk_intent:
        return {"schema": STORAGE_SCHEMA, "intent_sha256": None, "mode": storage_mode,
                "bytes": 0, "additional_bytes": 0, "known_bytes": 0,
                "unknown_bytes": 0, "complete": True, "resources": []}
    resources = {}
    for requirement in disk_intent["paths"]:
        path, amount = requirement["path"], requirement["bytes"]
        if type(amount) is not int or amount < 0:
            raise ValueError("Invalid original additional storage declaration")
        observed = filesystems.get(path, {})
        backing = observed.get("memory_backed")
        if backing is False:
            continue
        key = ("filesystem:" + str(observed["device"]) if "device" in observed else
               "unobserved:" + path)
        row = resources.setdefault(key, {"id": key, "paths": [], "bytes": 0,
            "memory_backed": backing if type(backing) is bool else None,
            "filesystem": observed.get("filesystem")})
        row["paths"].append(path)
        row["bytes"] += amount
    rows = list(resources.values())
    known = sum(row["bytes"] for row in rows if row["memory_backed"] is True)
    unknown = sum(row["bytes"] for row in rows if row["memory_backed"] is None)
    return {"schema": STORAGE_SCHEMA,
            "intent_sha256": hashlib.sha256(json.dumps(disk_intent, sort_keys=True,
                separators=(",", ":"), ensure_ascii=False).encode()).hexdigest(),
            "mode": storage_mode, "bytes": known + unknown,
            "additional_bytes": known + unknown if storage_mode == "additional" else 0,
            "known_bytes": known, "unknown_bytes": unknown,
            "complete": all(row["memory_backed"] is not None for row in rows),
            "resources": rows}


def _observed_storage(root, request, memory):
    """Read the same declaration from new or already-installed native readers."""
    disk_intent = request["intent"].get("disk")
    mode = request["intent"]["memory"].get("storage_mode", "included")
    if mode not in STORAGE_MODES:
        raise ValueError("Unknown original memory storage mode")
    if not disk_intent or mode == "included":
        return 0
    selected = memory.get("memory_backed_storage")
    expected = hashlib.sha256(json.dumps(disk_intent, sort_keys=True,
        separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
    if (isinstance(selected, dict) and selected.get("schema") == STORAGE_SCHEMA and
            selected.get("intent_sha256") == expected and selected.get("mode") == mode and
            type(selected.get("additional_bytes")) is int and selected["additional_bytes"] >= 0):
        return selected["additional_bytes"]
    # The disk observation belongs to this request's mount namespace. A missing
    # new memory diagnostic can still use that original classification.
    disk = json.loads((root / "disk.json").read_text())
    if disk.get("operation_id") != request["intent"]["operation_id"] or disk.get("intent") != disk_intent:
        raise ValueError("Original storage observation differs from its request")
    observed = {path: resource for resource in disk.get("resources", [])
                for path in resource.get("paths", [])}
    return memory_backed_storage(disk_intent, observed, mode)["additional_bytes"]


def _timestamp(value):
    try:
        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return moment.replace(tzinfo=timezone.utc).timestamp() if moment.tzinfo is None else moment.timestamp()
    except (AttributeError, TypeError, ValueError, OverflowError):
        return None


def queue_order(row):
    moment = _timestamp(row.get("created_at"))
    return (float("inf") if moment is None else moment,
            row.get("operation_id", ""), row.get("record", ""))


def age_seconds(row, observed_at=None):
    moment = _timestamp(row.get("created_at"))
    current = _timestamp(observed_at) if observed_at else datetime.now(timezone.utc).timestamp()
    return round(max(0.0, current - moment), 3) if moment is not None and current is not None else 0.0


def observed_accumulation(row, kind, observed_at, required_ids=None):
    """Read attainable capacity from this operation's original observation.

    Active unallocated peaks can drain. Validated active private pages can be
    released on completion. Existing background allocations and filesystem
    contents receive no assumed release credit.
    """
    try:
        root = Path(row["record"])
        request = json.loads((root / "request.json").read_text())
        if request["intent"]["operation_id"] != row["operation_id"]:
            return False
        intent = request["intent"].get(kind)
        if not intent:
            return required_ids is None
        value = json.loads((root / (kind + ".json")).read_text())
        if value.get("operation_id") != row["operation_id"] or value.get("intent") != intent:
            return False
        if value.get("state") not in {"queued_disk", "queued_memory", "waiting_memory", "admitted"}:
            return False
        if value.get("capacity_feasible") is False or value.get("reason") in {
                "capacity_unavailable", "inode_capacity_unavailable"}:
            return False
        stamp = value.get("fairness", {}).get("observed_at") or value.get("observed_at")
        observed, now = _timestamp(stamp), _timestamp(observed_at)
        if observed is None or now is None or not 0 <= now - observed <= OBSERVATION_SECONDS:
            return False
        resources = value.get("resources", [])
        if required_ids is not None:
            resources = [item for item in resources if item.get("id") in required_ids]
            if {item.get("id") for item in resources} != set(required_ids):
                return False
        if not resources:
            return False
        storage_bytes = _observed_storage(root, request, value) if kind == "memory" else 0
        for item in resources:
            if kind == "memory":
                available = item.get("admission_available_bytes")
                private = item.get("resident_private_credit_bytes", 0)
                if type(available) is not int or type(private) is not int:
                    return False
                if intent["peak_bytes"] + storage_bytes + intent["reserve_bytes"] > available + private:
                    return False
            else:
                available = item.get("available_bytes")
                if type(available) is not int or item["requested_bytes"] + intent["reserve_bytes"] > available:
                    return False
                inodes = item.get("inodes_available")
                if item["requested_inodes"] and (type(inodes) is not int or
                        item["requested_inodes"] + intent["reserve_inodes"] > inodes):
                    return False
        return True
    except (OSError, ValueError, TypeError, KeyError):
        return False


def reserve_headroom(rows, current, capacities, *, feasible, fits, remaining,
                     can_accumulate, kind, observed_at=None):
    """Protect older headroom when the complete request can accumulate it."""
    now = observed_at or datetime.now(timezone.utc).isoformat()
    age = age_seconds(current, now)
    value = {"schema": SCHEMA, "observed_at": now, "aging_seconds": AGING_SECONDS,
             "joint_observation_seconds": OBSERVATION_SECONDS,
             "request_created_at": current.get("created_at"), "request_age_seconds": age,
             "aged": age >= AGING_SECONDS, "protected_operations": [],
             "protection_deferred": [], "blocked_by": None}
    covered = set()
    known = set(capacities)
    prior = [row for row in rows if row.get("state") in {"queued", "waiting_memory", "waiting_disk"}
             and queue_order(row) < queue_order(current)]
    for row in sorted(prior, key=queue_order):
        scope = set(row.get("resources", []))
        overlap = (scope & known) - covered
        if not overlap or row.get("capacity_feasible") is False or not feasible(row, scope & known):
            continue
        age = age_seconds(row, now)
        aged = age >= AGING_SECONDS
        immediately_ready = (not row.get("waiting_on") and row.get("state") == "queued"
                             and scope <= known and fits(row, scope))
        if not aged and not immediately_ready:
            continue
        deferred = None
        if not can_accumulate(row, scope & known):
            deferred = "current_background_capacity"
        elif scope - known and not observed_accumulation(row, kind, now, scope - known):
            deferred = "other_resource_scope_capacity"
        elif not observed_accumulation(row, "memory" if kind == "disk" else "disk", now):
            deferred = "joint_resource_capacity"
        if deferred:
            value["protection_deferred"].append({
                "operation_id": row["operation_id"], "record": row["record"],
                "request_age_seconds": age, "reason": deferred})
            continue
        covered.update(overlap)
        amounts = [remaining(row, key) for key in sorted(overlap)]
        protected = {"operation_id": row["operation_id"], "record": row["record"],
                     "sequence": row["sequence"], "request_created_at": row.get("created_at"),
                     "request_age_seconds": age, "mode": "aged" if aged else "already_fits",
                     "resources": amounts}
        value["protected_operations"].append(protected)
        if value["blocked_by"] is None and any(not resource["fits_together"] for resource in amounts):
            value["blocked_by"] = {"operation_id": row["operation_id"], "record": row["record"],
                                   "sequence": row["sequence"], "mode": protected["mode"]}
    value["backfill_allowed"] = value["blocked_by"] is None
    return value


def queue_snapshot(request, observations):
    """Expose the original queue age and timestamped resource decisions together."""
    row = {"created_at": request.get("created_at")}
    age = age_seconds(row)
    resources = {}
    for name, value in observations.items():
        if not value:
            continue
        resources[name] = {key: value.get(key) for key in
                           ("state", "reason", "sequence", "observed_at", "fairness")}
    return {"schema": SCHEMA, "request_created_at": request.get("created_at"),
            "request_age_seconds": age, "aging_seconds": AGING_SECONDS,
            "aged": age >= AGING_SECONDS, "resources": resources}
