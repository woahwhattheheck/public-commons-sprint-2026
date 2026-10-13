"""Keep original native control and resource lifetime separately from command outcome.

The existing admission lock owns every ledger mutation. A queued native gate
cannot reach command dispatch until its reservation is durably admitted. Keep
that original proof in the memory index before removing a missing record, so
the paired disk reservation can recover regardless of cleanup order.
"""
from __future__ import annotations

from copy import deepcopy
from contextlib import contextmanager
import hashlib
import json
import os
import re
from pathlib import Path

MEMORY_SCHEMA = "commons.native-cloud-memory/v1"
PROOF_SCHEMA = "commons.native-ended-memory-queue/v1"
DEFAULT_MEMORY_ROOT = "/workspace/shared/swarm/capacity/memory"
QUEUE_STATES = {"memory": ("queued", "waiting_disk"), "disk": ("queued", "waiting_memory")}



PROCFS_VIEW_SCHEMA = "commons.native-procfs-view/v1"
NAMESPACE_SCHEMA = "commons.native-pid-namespace-lifetime/v1"
ENDED_NAMESPACE_SCHEMA = "commons.native-ended-pid-namespace/v1"
RESERVATION_STATUS_SCHEMA = "commons.native-reservation-status/v1"
DISK_SCHEMA = "commons.native-cloud-disk/v1"
ENDED_MISSING_STATES = ("missing_record_ended_before_dispatch", "missing_record_namespace_ended")


def control_location_issue(path):
    """Classify the known invocation-local /dev mount before a new record exists.

    /dev/shm is a separate shared mount in the original cloud runtime. Callers
    still own the lifetime of other selected filesystems; a worker/temp root is
    allowed under /dev, but its authoritative request/lock/result is not.
    """
    selected = Path(path).expanduser().resolve()
    dev, shared = Path("/dev"), Path("/dev/shm")
    if (selected == dev or dev in selected.parents) and not (
            selected == shared or shared in selected.parents):
        return {"code": "INVOCATION_LOCAL_NATIVE_RECORD", "path": str(selected),
                "reason": "The original native control record must survive its owning invocation",
                "required": "Select the existing shared native records directory; keep only transient worker/source/temp paths in /dev"}
    return None


def require_persistent_control(path):
    issue = control_location_issue(path)
    if issue is not None:
        raise ValueError(issue["code"] + ": " + issue["reason"] + ". " + issue["required"])
    return str(Path(path).expanduser().resolve())


def _kernel_identity(value):
    return (isinstance(value, dict)
            and all(type(value.get(key)) is int and value[key] > 0
                    for key in ("pid", "proc_pid", "pgid"))
            and isinstance(value.get("start_ticks"), str) and value["start_ticks"].isdecimal()
            and isinstance(value.get("boot_id"), str) and bool(value["boot_id"])
            and isinstance(value.get("namespace"), str)
            and re.fullmatch(r"pid:\[[0-9]+\]", value["namespace"]) is not None)


def _same_kernel(left, right):
    return (_kernel_identity(left) and _kernel_identity(right)
            and all(left[key] == right[key] for key in
                    ("pid", "proc_pid", "pgid", "start_ticks", "boot_id", "namespace")))



@contextmanager
def _proc_directory():
    descriptor = os.open("/proc", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        yield descriptor
    finally:
        os.close(descriptor)


def _proc_text(descriptor, relative, maximum=4 * 1024 * 1024):
    """Read through the selected open procfs, never a later global /proc mount."""
    opened = os.open(relative, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=descriptor)
    try:
        chunks, length = [], 0
        while True:
            chunk = os.read(opened, min(65536, maximum + 1 - length))
            if not chunk:
                return b"".join(chunks).decode("utf-8")
            chunks.append(chunk)
            length += len(chunk)
            if length > maximum:
                raise ValueError("The original procfs observation exceeds its complete read bound")
    finally:
        os.close(opened)


def _proc_status(descriptor, relative):
    values = {}
    for line in _proc_text(descriptor, relative + "/status", 65536).splitlines():
        key, separator, value = line.partition(":")
        if separator:
            values[key] = value.strip()
    return values


def _proc_identity(descriptor, relative):
    raw = _proc_text(descriptor, relative + "/stat", 65536)
    fields = raw[raw.rfind(")") + 2:].split()
    if len(fields) <= 19:
        raise ValueError("The original procfs process identity is incomplete")
    if fields[0] in ("Z", "X"):
        return None
    status = _proc_status(descriptor, relative)
    visible = int(raw.split(" ", 1)[0])
    namespace = os.readlink(relative + "/ns/pid", dir_fd=descriptor)
    again = _proc_text(descriptor, relative + "/stat", 65536)
    repeated = again[again.rfind(")") + 2:].split()
    if (len(repeated) <= 19 or repeated[0] in ("Z", "X")
            or again.split(" ", 1)[0] != str(visible)
            or repeated[19] != fields[19] or repeated[2] != fields[2]):
        raise ValueError("The original process changed during its anchored procfs read")
    return {"pid": int(status.get("NSpid", str(visible)).split()[-1]),
            "proc_pid": visible, "start_ticks": fields[19],
            "pgid": int(status.get("NSpgid", fields[2]).split()[-1]),
            "namespace": namespace,
            "boot_id": _proc_text(descriptor, "sys/kernel/random/boot_id", 256).strip()}


def _procfs_view(descriptor):
    """Bind procfs namespace and effective visibility, independently of caller PID."""
    root = os.fstat(descriptor)
    fdinfo = {}
    for line in _proc_text(descriptor, "self/fdinfo/" + str(descriptor), 65536).splitlines():
        key, separator, value = line.partition(":")
        if separator:
            fdinfo[key] = value.strip()
    mount_id = fdinfo.get("mnt_id")
    mounts = []
    for line in _proc_text(descriptor, "self/mountinfo").splitlines():
        left, separator, right = line.partition(" - ")
        fields, filesystem = left.split(), right.split()
        if not separator or len(fields) < 6 or len(filesystem) < 3:
            raise ValueError("The original procfs mount observation is incomplete")
        if re.match(r"^/proc/[0-9]+(?:/|$)", fields[4]):
            raise ValueError("A mounted PID subtree prevents complete original procfs visibility")
        if fields[0] == mount_id:
            mounts.append((fields, filesystem))
    if len(mounts) != 1:
        raise ValueError("The open procfs mount is not visible in this observer's mount table")
    fields, filesystem = mounts[0]
    if (fields[3] != "/" or fields[4] != "/proc" or filesystem[0] != "proc"
            or fields[2] != str(os.major(root.st_dev)) + ":" + str(os.minor(root.st_dev))):
        raise ValueError("Use the original complete procfs view")
    options = sorted(set(fields[5].split(",") + filesystem[2].split(",")))
    if any(option.startswith("hidepid=") and option not in ("hidepid=0", "hidepid=off")
           for option in options):
        raise ValueError("Restricted procfs visibility cannot establish a missing process's death")
    anchor = _proc_identity(descriptor, "1")
    if not _kernel_identity(anchor) or anchor["pid"] != 1 or anchor["proc_pid"] != 1:
        raise ValueError("The original procfs PID-namespace anchor is unreadable")
    status = _proc_status(descriptor, "self")
    uids = [int(value) for value in status["Uid"].split()]
    gids = [int(value) for value in status["Gid"].split()]
    groups = sorted(int(value) for value in status["Groups"].split())
    user_namespace = os.readlink("self/ns/user", dir_fd=descriptor)
    if (len(uids) != 4 or len(gids) != 4
            or re.fullmatch(r"user:\[[0-9]+\]", user_namespace) is None
            or re.fullmatch(r"[0-9a-fA-F]+", status["CapEff"]) is None):
        raise ValueError("The original procfs observer visibility is incomplete")
    return {"schema": PROCFS_VIEW_SCHEMA,
            "root": {"device": root.st_dev, "inode": root.st_ino},
            "boot_id": anchor["boot_id"], "pid_namespace": anchor["namespace"],
            "namespace_init": anchor,
            "mount": {"root": fields[3], "filesystem": filesystem[0], "options": options},
            "observer": {"uids": uids, "gids": gids, "groups": groups,
                         "user_namespace": user_namespace, "cap_effective": status["CapEff"]}}


def _validate_procfs_view(view, boot_id):
    if (not isinstance(view, dict) or set(view) !=
            {"schema", "root", "boot_id", "pid_namespace", "namespace_init", "mount", "observer"}
            or view.get("schema") != PROCFS_VIEW_SCHEMA or view.get("boot_id") != boot_id
            or not isinstance(view.get("root"), dict) or set(view["root"]) != {"device", "inode"}
            or any(type(view["root"][key]) is not int or view["root"][key] < 1
                   for key in ("device", "inode"))
            or not _kernel_identity(view.get("namespace_init"))
            or view["namespace_init"]["pid"] != 1 or view["namespace_init"]["proc_pid"] != 1
            or view["namespace_init"]["boot_id"] != boot_id
            or view["namespace_init"]["namespace"] != view.get("pid_namespace")):
        raise ValueError("Preserve the original captured procfs view")
    mount, observer = view.get("mount"), view.get("observer")
    if (not isinstance(mount, dict) or set(mount) != {"root", "filesystem", "options"}
            or mount["root"] != "/" or mount["filesystem"] != "proc"
            or not isinstance(mount["options"], list) or not mount["options"]
            or any(not isinstance(value, str) for value in mount["options"])
            or any(value.startswith("hidepid=") and value not in ("hidepid=0", "hidepid=off")
                   for value in mount["options"])
            or not isinstance(observer, dict)
            or set(observer) != {"uids", "gids", "groups", "user_namespace", "cap_effective"}
            or any(not isinstance(observer[key], list) for key in ("uids", "gids", "groups"))
            or len(observer["uids"]) != 4 or len(observer["gids"]) != 4
            or any(type(value) is not int or value < 0
                   for key in ("uids", "gids", "groups") for value in observer[key])
            or not isinstance(observer["user_namespace"], str)
            or re.fullmatch(r"user:\[[0-9]+\]", observer["user_namespace"]) is None
            or not isinstance(observer["cap_effective"], str)
            or re.fullmatch(r"[0-9a-fA-F]+", observer["cap_effective"]) is None):
        raise ValueError("Preserve the original procfs visibility context")
    return view


def _require_procfs_view(descriptor, guard):
    expected = _validate_procfs_view(guard.get("procfs_view"), guard["binding"]["supervisor"]["boot_id"])
    if _procfs_view(descriptor) != expected:
        raise ValueError("The original procfs view, boot or observer visibility differs; command lifetime remains unresolved")


def _proc_living(descriptor, identity):
    """ENOENT has meaning only inside an already validated, anchored original view."""
    if identity is None:
        return False
    if (not isinstance(identity, dict) or type(identity.get("proc_pid")) is not int
            or identity["proc_pid"] < 1 or not isinstance(identity.get("start_ticks"), str)
            or not identity["start_ticks"].isdecimal()):
        raise ValueError("Preserve the original process identity in the selected procfs view")
    boot = _proc_text(descriptor, "sys/kernel/random/boot_id", 256).strip()
    if identity.get("boot_id") != boot:
        raise ValueError("A different boot cannot establish the original process outcome")
    try:
        raw = _proc_text(descriptor, str(identity["proc_pid"]) + "/stat", 65536)
    except (FileNotFoundError, ProcessLookupError):
        return False
    fields = raw[raw.rfind(")") + 2:].split()
    if (len(fields) <= 19 or raw.split(" ", 1)[0] != str(identity["proc_pid"])
            or not fields[19].isdecimal()):
        raise ValueError("The original anchored process observation is incomplete")
    return fields[0] not in ("Z", "X") and fields[19] == identity["start_ticks"]


def row_process_living(native, row, identity):
    """New captured rows require their original procfs view on every read path."""
    if identity is None:
        return False
    if row.get("namespace_lifetime") is None:
        return living(native, identity)
    guard = _namespace_guard(row)
    with _proc_directory() as descriptor:
        _require_procfs_view(descriptor, guard)
        active = _proc_living(descriptor, identity)
        _require_procfs_view(descriptor, guard)
        return active


def _guarded_lifetimes(row):
    guard = _namespace_guard(row)
    with _proc_directory() as descriptor:
        _require_procfs_view(descriptor, guard)
        active = (_proc_living(descriptor, row["supervisor"]),
                  _proc_living(descriptor, guard["init"]))
        _require_procfs_view(descriptor, guard)
        return active

def capture_namespace(native, row):
    """Capture only this living supervisor, its namespace init and actual procfs view."""
    selected = binding(row)
    supervisor = selected["supervisor"]
    if not _kernel_identity(supervisor):
        return None
    try:
        with _proc_directory() as descriptor:
            view = _procfs_view(descriptor)
            current = _proc_identity(descriptor, "self")
            if not _same_kernel(current, supervisor):
                return None
            process, visited = current, set()
            for _ in range(1024):
                if (not _kernel_identity(process) or process["namespace"] != supervisor["namespace"]
                        or process["boot_id"] != supervisor["boot_id"] or process["proc_pid"] in visited):
                    return None
                visited.add(process["proc_pid"])
                if process["pid"] == 1:
                    init = process
                    break
                relative = str(process["proc_pid"])
                raw = _proc_text(descriptor, relative + "/stat", 65536)
                fields = raw[raw.rfind(")") + 2:].split()
                if (len(fields) <= 19 or fields[0] in ("Z", "X")
                        or fields[19] != process["start_ticks"]
                        or not _same_kernel(_proc_identity(descriptor, relative), process)):
                    return None
                parent = int(fields[1])
                if parent < 1:
                    return None
                process = _proc_identity(descriptor, str(parent))
            else:
                return None
            if (int(init["start_ticks"]) > int(supervisor["start_ticks"])
                    or not _proc_living(descriptor, init)
                    or not _same_kernel(_proc_identity(descriptor, "self"), supervisor)
                    or _procfs_view(descriptor) != view):
                return None
    except (OSError, ValueError, IndexError, KeyError, TypeError):
        return None
    body = {"schema": NAMESPACE_SCHEMA, "binding": selected,
            "namespace": supervisor["namespace"], "init": deepcopy(init),
            "procfs_view": view, "captured_at": native.now()}
    return {**body, "sha256": sha256(body)}

def _namespace_guard(row):
    guard = row.get("namespace_lifetime")
    if (not isinstance(guard, dict) or set(guard) !=
            {"schema", "binding", "namespace", "init", "procfs_view", "captured_at", "sha256"}
            or guard.get("schema") != NAMESPACE_SCHEMA):
        raise ValueError("The missing record has no original kernel namespace-init receipt; retain its unresolved command lifetime")
    body = {key: value for key, value in guard.items() if key != "sha256"}
    selected = binding(row)
    init, supervisor = guard.get("init"), selected["supervisor"]
    if (guard.get("sha256") != sha256(body) or guard.get("binding") != selected
            or not _kernel_identity(init) or not _kernel_identity(supervisor)
            or init["pid"] != 1 or init["boot_id"] != supervisor["boot_id"]
            or guard["namespace"] != init["namespace"]
            or guard["namespace"] != supervisor["namespace"]
            or int(init["start_ticks"]) > int(supervisor["start_ticks"])
            or not isinstance(guard.get("captured_at"), str) or not guard["captured_at"]):
        raise ValueError("The retained namespace-init receipt belongs to another original reservation")
    _validate_procfs_view(guard.get("procfs_view"), supervisor["boot_id"])
    return guard


def _ended_namespace(native, row, kind):
    if kind not in QUEUE_STATES:
        raise ValueError("Select an original memory or disk reservation")
    guard = _namespace_guard(row)
    if any(_guarded_lifetimes(row)):
        raise ValueError("The original process namespace has not positively ended")
    body = {"schema": ENDED_NAMESPACE_SCHEMA, "kind": kind,
            "reservation_key": reservation_key(row), "reservation": deepcopy(row),
            "namespace_lifetime_sha256": guard["sha256"],
            "command_outcome": "UNKNOWN",
            "resource_lifetime": "original_namespace_init_ended"}
    proof = {**body, "sha256": sha256(body), "observed_at": native.now()}
    return {"alive": False, "process_alive": False,
            "native_state": "missing_record_namespace_ended",
            "reason": "original_kernel_namespace_init_ended",
            "command_outcome": "UNKNOWN", "dispatch_observed": None,
            "ended_namespace": proof}


def _validate_ended_namespace(proof, row, kind):
    if (not isinstance(proof, dict) or proof.get("schema") != ENDED_NAMESPACE_SCHEMA
            or set(proof) != {"schema", "kind", "reservation_key", "reservation",
                             "namespace_lifetime_sha256", "command_outcome",
                             "resource_lifetime", "sha256", "observed_at"}
            or proof.get("kind") != kind or proof.get("reservation") != row
            or proof.get("reservation_key") != reservation_key(row)
            or proof.get("command_outcome") != "UNKNOWN"
            or proof.get("resource_lifetime") != "original_namespace_init_ended"
            or not isinstance(proof.get("observed_at"), str) or not proof["observed_at"]):
        raise ValueError("Preserve the complete original namespace lifetime observation")
    body = {key: value for key, value in proof.items() if key not in ("sha256", "observed_at")}
    if (proof.get("sha256") != sha256(body)
            or proof.get("namespace_lifetime_sha256") != _namespace_guard(row)["sha256"]):
        raise ValueError("The original namespace lifetime proof changed")
    return proof


def retain_namespace_proof(native, index, row, observed, kind):
    """Retain the exact released row in its same admission index before removal."""
    proof = observed.get("ended_namespace")
    if proof is None:
        return
    if (observed.get("alive") is not False or observed.get("process_alive") is not False
            or observed.get("native_state") != "missing_record_namespace_ended"):
        raise ValueError("The original namespace cleanup has no ended resource observation")
    _validate_ended_namespace(proof, row, kind)
    # Recheck kernel identities while the original admission lock is held.
    _ended_namespace(native, row, kind)
    bucket = index.setdefault("ended_namespaces", {}).setdefault(reservation_key(row), {})
    identity = sha256(binding(row))
    prior = bucket.get(identity)
    if prior is None:
        bucket[identity] = proof
    else:
        _validate_ended_namespace(prior, row, kind)
        observed["ended_namespace"] = prior


def inspect_reservation(native, kind, ledger_root, boot_id, key):
    """Read one exact original ledger row; never create a record or write a lock."""
    if kind not in QUEUE_STATES:
        raise ValueError("Select an original memory or disk reservation")
    if not isinstance(boot_id, str) or re.fullmatch(r"[0-9a-fA-F-]{36}", boot_id) is None:
        raise ValueError("Select the original reservation boot ID")
    if not isinstance(key, str) or re.fullmatch(r"[0-9a-f]{64}", key) is None:
        raise ValueError("Select the exact original reservation key")
    root = Path(ledger_root).expanduser()
    if not root.is_absolute() or ".." in root.parts:
        raise ValueError("Select the original absolute admission ledger root")
    path = root / boot_id / "reservations.json"
    index = native.read_json(path)
    result = {"schema": RESERVATION_STATUS_SCHEMA, "kind": kind,
              "index": str(path), "boot_id": boot_id, "reservation_key": key,
              "read_only": True, "observed_at": native.now()}
    if index is None:
        return {**result, "state": "index_absent", "released": False, "releasable": False}
    if index.get("schema") != (MEMORY_SCHEMA if kind == "memory" else DISK_SCHEMA) or index.get("boot_id") != boot_id:
        raise ValueError("Use the original selected admission index")
    row = index.get("reservations", {}).get(key)
    if row is None:
        retained = {"ended_namespaces": deepcopy(index.get("ended_namespaces", {}).get(key, {})),
                    "ended_queues": deepcopy(index.get("ended_queues", {}).get(key, {}))}
        return {**result, "state": "absent", "released": False, "releasable": False,
                "retained_history": retained}
    if not isinstance(row, dict) or reservation_key(row) != key or row["supervisor"].get("boot_id") != boot_id:
        raise ValueError("The original reservation key or boot identity changed")
    result.update(reservation=deepcopy(row), reservation_sha256=sha256(row),
                  command_outcome="UNKNOWN", released=False)
    try:
        # read_json distinguishes a missing path from malformed or unreadable
        # control bytes. Neither malformed bytes nor absence is command success.
        request = native.read_json(Path(row["record"]) / "request.json")
        if request is not None:
            return {**result, "state": "record_present", "releasable": False,
                    "reason": "Use the original native record status and recovery"}
        observed = missing_record(native, row, kind)
        return {**result, "state": "ended_missing_record", "releasable": True,
                "observation": observed}
    except (OSError, ValueError, KeyError, TypeError) as exc:
        return {**result, "state": "unresolved", "releasable": False,
                "reason": str(exc), "error_type": type(exc).__name__}


def sha256(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                     ensure_ascii=False, allow_nan=False).encode()).hexdigest()


def living(native, identity):
    """Distinguish an ended original kernel identity from an unreadable one."""
    if identity is None:
        return False
    if (not isinstance(identity, dict) or type(identity.get("proc_pid")) is not int
            or identity["proc_pid"] < 1 or not isinstance(identity.get("start_ticks"), str)
            or not identity["start_ticks"].isdecimal()
            or not isinstance(identity.get("boot_id"), str) or not identity["boot_id"]):
        raise ValueError("Preserve the original reservation owner's complete kernel identity")
    if native.alive(identity):
        return True
    if native._supervisor_ended(identity):
        return False
    raise ValueError("Original reservation process identity is temporarily unreadable")


def binding(row):
    record, operation, created, supervisor = (row.get(name) for name in
                                             ("record", "operation_id", "created_at", "supervisor"))
    if (not isinstance(record, str) or not Path(record).is_absolute()
            or str(Path(record)) != record or ".." in Path(record).parts
            or not isinstance(operation, str) or not operation
            or not isinstance(created, str) or not created or not isinstance(supervisor, dict)):
        raise ValueError("Preserve the exact original reservation binding")
    return {"record": record, "operation_id": operation, "created_at": created,
            "supervisor": deepcopy(supervisor)}


def reservation_key(row):
    selected = binding(row)
    return hashlib.sha256((selected["record"] + "\0" + selected["operation_id"]).encode()).hexdigest()


def _queued(row, kind):
    if row.get("state") not in QUEUE_STATES[kind]:
        raise ValueError("The missing record has no original undispatched queue proof")
    if type(row.get("sequence")) is not int or row["sequence"] < 1:
        raise ValueError("Preserve the original admission sequence")


def _memory_proof(native, row):
    _queued(row, "memory")
    binding(row)
    if (type(row.get("peak_bytes")) is not int or row["peak_bytes"] <= 0
            or type(row.get("reserve_bytes")) is not int or row["reserve_bytes"] < 0
            or not isinstance(row.get("ledger_root"), str)
            or not Path(row["ledger_root"]).is_absolute()):
        raise ValueError("Preserve the original queued memory declaration")
    body = {"schema": PROOF_SCHEMA, "reservation_key": reservation_key(row),
            "reservation": deepcopy(row)}
    # The row identity is stable whichever resource observes it first.
    return {**body, "sha256": sha256(body), "observed_at": native.now()}


def _validate_proof(proof, row, ledger_root):
    if (not isinstance(proof, dict) or proof.get("schema") != PROOF_SCHEMA
            or set(proof) != {"schema", "reservation_key", "reservation", "sha256", "observed_at"}
            or not isinstance(proof.get("observed_at"), str) or not proof["observed_at"]):
        raise ValueError("Preserve the original ended memory queue proof")
    body = {key: value for key, value in proof.items() if key not in ("sha256", "observed_at")}
    saved = proof.get("reservation")
    if (proof.get("sha256") != sha256(body) or not isinstance(saved, dict)
            or proof.get("reservation_key") != reservation_key(saved)
            or proof["reservation_key"] != reservation_key(row)
            or binding(saved) != binding(row) or saved.get("ledger_root") != ledger_root):
        raise ValueError("The ended memory queue belongs to another original reservation")
    _queued(saved, "memory")
    return proof


def retain_memory_proof(native, index, row, observed, *, finishing=False):
    retain_namespace_proof(native, index, row, observed, "memory")
    proof = observed.get("ended_memory_queue")
    if proof is None:
        if row.get("state") not in QUEUE_STATES["memory"]:
            return
        if finishing:
            if observed.get("process_alive") is not False:
                raise ValueError("Preserve the original command during memory finalization")
        elif observed.get("alive") is not False or row_process_living(native, row, row["supervisor"]):
            raise ValueError("The original queued owner changed before cleanup")
        # The original finalizer can still own its process while closing an
        # undispatched gate. The later disk reader independently requires its
        # ended identity. Retain this same proof before either deletion path.
        proof = _memory_proof(native, row)
        observed["ended_memory_queue"] = proof
    _validate_proof(proof, row, row["ledger_root"])
    if proof["reservation"] != row:
        raise ValueError("The original missing memory reservation changed before cleanup")
    bucket = index.setdefault("ended_queues", {}).setdefault(reservation_key(row), {})
    identity = sha256(binding(row))
    prior = bucket.get(identity)
    if prior is not None:
        _validate_proof(prior, row, row["ledger_root"])
        if prior["reservation"] != row:
            raise ValueError("Preserve the first ended original queue observation")
        observed["ended_memory_queue"] = prior
    else:
        bucket[identity] = proof


def _paired_memory_proof(native, row):
    gate = row.get("memory_gate")
    key = reservation_key(row)
    if gate is None:
        # Older native reservations used the maintained default. A matching
        # exact original row/proof is still required; absence grants nothing.
        ledger_root = DEFAULT_MEMORY_ROOT
    else:
        if (not isinstance(gate, dict) or set(gate) != {"ledger_root", "reservation_key"}
                or gate.get("reservation_key") != key
                or not isinstance(gate.get("ledger_root"), str)
                or not Path(gate["ledger_root"]).is_absolute()):
            raise ValueError("Preserve the disk reservation's original memory gate")
        ledger_root = gate["ledger_root"]
    boot = row["supervisor"]["boot_id"]
    path = Path(ledger_root) / boot / "reservations.json"
    index = native.read_json(path)
    if (not index or index.get("schema") != MEMORY_SCHEMA or index.get("boot_id") != boot):
        raise ValueError("The missing disk record has no retained original memory queue")
    queued = index.get("reservations", {}).get(key)
    if isinstance(queued, dict) and binding(queued) == binding(row):
        if queued.get("ledger_root") != ledger_root:
            raise ValueError("The paired original memory ledger changed")
        proof = _memory_proof(native, queued)
    else:
        proof = index.get("ended_queues", {}).get(key, {}).get(sha256(binding(row)))
    proof = _validate_proof(proof, row, ledger_root)
    saved = proof["reservation"]
    if saved.get("namespace_lifetime") is not None and row_process_living(native, saved, saved["supervisor"]):
        raise ValueError("The paired original queued supervisor is still alive")
    return proof


def missing_record(native, row, kind):
    """Use an original queue gate or captured kernel namespace lifetime."""
    binding(row)
    if kind not in QUEUE_STATES:
        raise ValueError("Select an original memory or disk reservation")
    if row_process_living(native, row, row["supervisor"]):
        raise ValueError("The original reservation owner is alive in its private record")
    proof = None
    if kind == "memory":
        if row.get("state") in QUEUE_STATES["memory"]:
            proof = _memory_proof(native, row)
        else:
            return _ended_namespace(native, row, kind)
    elif row.get("state") in QUEUE_STATES["disk"]:
        _queued(row, "disk")
    elif row.get("state") == "reserved":
        try:
            proof = _paired_memory_proof(native, row)
        except (OSError, ValueError, KeyError, TypeError):
            if row.get("namespace_lifetime") is None:
                raise
            return _ended_namespace(native, row, kind)
    else:
        return _ended_namespace(native, row, kind)
    return {"alive": False, "process_alive": False,
            "native_state": "missing_record_ended_before_dispatch",
            "reason": "original_queued_gate_and_ended_supervisor",
            **({"ended_memory_queue": proof} if proof is not None else {})}


def released(row, observed):
    proof = observed.get("ended_memory_queue")
    namespace = observed.get("ended_namespace")
    return {"operation_id": row["operation_id"], "native_state": observed["native_state"],
            **({"reservation_key": reservation_key(row),
                "namespace_proof_sha256": namespace["sha256"], "command_outcome": "UNKNOWN"}
               if namespace is not None else {}),
            **({"reservation_key": reservation_key(row), "queue_proof_sha256": proof["sha256"]}
               if proof is not None else {})}


def reap_missing(native, admission, reader, kind, key, expected_reservation_sha256):
    """Reconcile one reviewed old key through its existing admission lock."""
    if (not isinstance(expected_reservation_sha256, str)
            or len(expected_reservation_sha256) != 64):
        raise ValueError("Supply the reviewed original reservation SHA-256")
    with admission._index() as index:
        row = index["reservations"].get(key)
        if row is None:
            return {"state": "absent", "reservation_key": key, "reused": True, "released": False}
        if reservation_key(row) != key or sha256(row) != expected_reservation_sha256:
            raise ValueError("The reviewed original reservation changed")
        observed = reader(row)
        if (observed.get("alive") or
                observed.get("native_state") not in ENDED_MISSING_STATES):
            raise ValueError("Select an original missing record with retained proof of ended resource lifetime")
        if kind == "memory":
            retain_memory_proof(native, index, row, observed)
        else:
            retain_namespace_proof(native, index, row, observed, kind)
        report = released(row, observed)
        del index["reservations"][key]
    return {"state": "released", "reservation_key": key, "reused": False,
            "released": True, **report}
